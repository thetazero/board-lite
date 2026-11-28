//! The server: serves the clients and runs rooms, at home or as a public website.
use crate::limits::{Hold, Limits, clear_old, is_recap_id, lock, visitor};
use crate::mcp;
use crate::room::{DOWN, Fail, Here, Place, Res, Room, new_code, remove_files};
use bytes::Bytes;
use futures_util::Stream;
use futures_util::stream::unfold;
use http_body_util::{BodyExt, Limited};
use hyper::body::{Body as HttpBody, Frame, Incoming, SizeHint};
use hyper::header::{self, HeaderMap, HeaderValue};
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde_json::{Map, Value, json};
use std::collections::{HashMap, VecDeque};
use std::convert::Infallible;
use std::net::IpAddr;
use std::path::PathBuf;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio::time::{Interval, MissedTickBehavior, interval, timeout};

pub struct Asset {
    path: &'static str,
    body: &'static [u8],
    mime: &'static str,
    cache: &'static str,
    etag: &'static str,
}
include!("../generated/assets.rs");

const PREVIEW_TEXT: &str = "Raise dragons and raid kingdoms.";
const MAX_BODY: usize = 4096;
const MAX_MCP_BODY: usize = 16384;
const PING: Duration = Duration::from_secs(15); // web/common.ts's STALE_MS allows for a couple missed
const HEALTH: Duration = Duration::from_secs(3); // how long /healthz keeps its answer, so asking often doesn't keep the disk busy

/// A public website's address; a home's server has none.
pub struct Site {
    pub origin: String,
    pub trust_proxy: bool,
}
pub struct Server {
    site: Option<Site>,
    place: Place,
    port: u16,
    hosted: Vec<PathBuf>, // game files named at the start: never forgotten
    rooms: Mutex<HashMap<String, Arc<Room>>>,
    pub limits: Option<Limits>,
    health: Mutex<Option<(Instant, bool)>>,
    drops: watch::Sender<u64>, // closes every connection
    headers: HeaderMap,
}

pub enum Body {
    Whole(Option<Bytes>),
    Parts(VecDeque<Bytes>),
    Stream(Pin<Box<dyn Stream<Item = Bytes> + Send>>),
}
impl HttpBody for Body {
    type Data = Bytes;
    type Error = Infallible;
    fn poll_frame(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Result<Frame<Bytes>, Infallible>>> {
        let next = match &mut *self {
            Body::Whole(b) => Poll::Ready(b.take().filter(|b| !b.is_empty())),
            Body::Parts(q) => Poll::Ready(q.pop_front()),
            Body::Stream(s) => s.as_mut().poll_next(cx),
        };
        next.map(|b| b.map(|b| Ok(Frame::data(b))))
    }
    fn is_end_stream(&self) -> bool {
        match self {
            Body::Whole(b) => b.as_ref().is_none_or(|b| b.is_empty()),
            Body::Parts(q) => q.is_empty(),
            Body::Stream(_) => false,
        }
    }
    fn size_hint(&self) -> SizeHint {
        match self {
            Body::Whole(b) => SizeHint::with_exact(b.as_ref().map_or(0, |b| b.len()) as u64),
            Body::Parts(q) => SizeHint::with_exact(q.iter().map(|b| b.len()).sum::<usize>() as u64),
            Body::Stream(_) => SizeHint::default(),
        }
    }
}
type Answer = Response<Body>;

fn answer(status: StatusCode, mime: &'static str, cache: &'static str, body: Body) -> Answer {
    let mut r = Response::new(body);
    *r.status_mut() = status;
    r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    r
}
fn parts(parts: Vec<Bytes>) -> Answer {
    answer(StatusCode::OK, "application/json", "no-store", Body::Parts(parts.into()))
}
fn json_text(status: StatusCode, text: impl Into<Bytes>) -> Answer {
    answer(status, "application/json", "no-store", Body::Whole(Some(text.into())))
}
fn ok(v: Value) -> Answer {
    json_text(StatusCode::OK, v.to_string())
}
fn wrong(status: StatusCode, why: &str) -> Answer {
    json_text(status, json!({"error": why}).to_string())
}
fn not_found() -> Answer {
    wrong(StatusCode::NOT_FOUND, "Not found.")
}
fn wrap(mut inner: Vec<Bytes>, before: String, after: &'static str) -> Vec<Bytes> {
    inner.insert(0, before.into());
    inner.push(Bytes::from_static(after.as_bytes()));
    inner
}

struct Events {
    room: Arc<Room>,
    tok: Option<String>,
    changes: watch::Receiver<u64>,
    queue: VecDeque<Bytes>,
    ping: Interval,
    _here: Here,
    _hold: Option<Hold>,
}
impl Events {
    fn send(&mut self) {
        self.changes.mark_unchanged();
        self.queue.extend(wrap(self.room.snapshot(self.tok.as_deref()), "data: ".into(), "\n\n"));
    }
    async fn next(mut self) -> Option<(Bytes, Events)> {
        loop {
            if let Some(b) = self.queue.pop_front() {
                if self.queue.is_empty() {
                    self.queue = VecDeque::new();
                }
                return Some((b, self));
            }
            if self.room.is_closed() {
                return None; // the page asks for the room, and hears it's gone
            }
            // A named event, not an SSE comment: the page hears it, so a stream that went quiet is noticed.
            let ping = tokio::select! {
                r = self.changes.changed() => { r.ok()?; false }
                _ = self.ping.tick() => true,
            };
            if ping {
                return Some((Bytes::from_static(b"event: ping\ndata: 1\n\n"), self));
            }
            if !self.room.is_closed() {
                self.send();
            }
        }
    }
}

fn query(q: Option<&str>) -> HashMap<String, String> {
    let decode = |s: &str| {
        let mut out = vec![];
        let b = s.as_bytes();
        let mut i = 0;
        while i < b.len() {
            let pair = b.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok()).filter(|h| h.bytes().all(|b| b.is_ascii_hexdigit()));
            match (b[i], pair) {
                (b'%', Some(h)) => {
                    out.push(u8::from_str_radix(h, 16).unwrap_or(b'?'));
                    i += 2;
                }
                (b'+', _) => out.push(b' '),
                (c, _) => out.push(c),
            }
            i += 1;
        }
        String::from_utf8_lossy(&out).into_owned()
    };
    let mut map = HashMap::new();
    for kv in q.unwrap_or("").split('&').filter(|s| !s.is_empty()) {
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        map.entry(decode(k)).or_insert_with(|| decode(v));
    }
    map
}
async fn body(req: Request<Incoming>, max: usize) -> Res<Map<String, Value>> {
    let bad = |m: &str| Fail::Room(m.into());
    let read = timeout(Duration::from_secs(30), Limited::new(req.into_body(), max).collect()).await;
    let data = read.map_err(|_| bad("Bad request."))?.map_err(|_| bad("Request too large."))?.to_bytes();
    if data.is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_slice(&data) {
        Ok(Value::Object(m)) => Ok(m),
        Ok(_) => Ok(Map::new()),
        Err(_) => Err(bad("Bad request.")),
    }
}
fn str_of<'a>(m: &'a Map<String, Value>, k: &str) -> &'a str {
    m.get(k).and_then(|v| v.as_str()).unwrap_or("")
}
fn via(s: &str) -> Option<&'static str> {
    ["phone", "cli", "claude"].into_iter().find(|v| *v == s)
}
/// A room's address: its code, and whether it's the Markdown one.
fn room_page(path: &str) -> Option<(&str, bool)> {
    let code = path.get(1..5).filter(|c| c.bytes().all(|b| b.is_ascii_alphabetic()))?;
    match &path[5..] {
        "" | "/" => Some((code, false)),
        ".md" => Some((code, true)),
        _ => None,
    }
}

impl Server {
    pub fn new(site: Option<Site>, place: Place, port: u16, hosted: Vec<PathBuf>, resume: bool) -> Result<Arc<Server>, String> {
        let mut headers = HeaderMap::new();
        if let Some(site) = &site {
            let mut put = |k: &'static str, v: &'static str| headers.insert(k, HeaderValue::from_static(v));
            put("content-security-policy", CSP);
            put("x-content-type-options", "nosniff");
            put("referrer-policy", "no-referrer");
            put("x-robots-tag", "noindex");
            if site.origin.starts_with("https:") {
                put("strict-transport-security", "max-age=31536000");
            }
        }
        let mut rooms = HashMap::new();
        let saved = if resume { Room::saved(&place.rooms, place.opts.idle_ms, &hosted) } else { vec![] };
        for (code, file) in saved {
            match Room::host(&code, file.clone(), &place, false) {
                Ok(room) => drop(rooms.insert(code, room)),
                Err(e) => eprintln!("Could not host room {code} again ({}): {e}", file.display()),
            }
        }
        // Hosted before, a game file keeps its code and seats; otherwise every seat starts open.
        for file in &hosted {
            let was = Room::saved_code(file).filter(|c| !rooms.contains_key(c));
            let code = was.unwrap_or_else(|| new_code(&place.rooms, |c| rooms.contains_key(c)));
            let room = Room::host(&code, file.clone(), &place, false)?;
            rooms.insert(code, room);
        }
        let limits = site.is_some().then(Limits::default);
        Ok(Arc::new(Server { site, place, port, hosted, rooms: Mutex::new(rooms), limits, health: Mutex::new(None), drops: watch::Sender::new(0), headers }))
    }
    /// The rooms with a game or players, and their files.
    pub fn in_use(&self) -> Vec<(String, PathBuf)> {
        lock(&self.rooms).values().filter(|r| r.in_use()).map(|r| (r.code.clone(), r.file.clone())).collect()
    }
    fn hold(&self, who: &str) -> Res<Option<Hold>> {
        self.limits.as_ref().map(|l| l.hold(who)).transpose()
    }
    fn max_wait(&self) -> f64 {
        if self.site.is_some() { 60.0 } else { 3600.0 }
    }
    pub fn drop_connections(&self) {
        self.drops.send_modify(|n| *n += 1);
    }
    pub fn rooms(&self) -> Vec<Arc<Room>> {
        lock(&self.rooms).values().cloned().collect()
    }
    pub fn set_room(&self, room: Arc<Room>) {
        lock(&self.rooms).insert(room.code.clone(), room);
    }
    pub fn delete_room(&self, code: &str) {
        lock(&self.rooms).remove(code);
    }
    pub fn clear_rooms(&self) {
        lock(&self.rooms).clear();
    }
    /// Whether games can be saved now.
    fn can_save(&self) -> bool {
        let mut health = lock(&self.health);
        if let Some((_, can)) = health.filter(|(at, _)| at.elapsed() < HEALTH) {
            return can;
        }
        let tried = crate::store::can_save(&self.place.rooms);
        if let Err(e) = &tried {
            eprintln!("Could not save in {}: {e}", self.place.rooms.display());
        }
        *health = Some((Instant::now(), tried.is_ok()));
        tried.is_ok()
    }
    pub fn count(&self) -> usize {
        lock(&self.rooms).len()
    }

    pub async fn run(self: Arc<Server>, listener: TcpListener) {
        let me = self.clone();
        tokio::spawn(async move { me.keep_house().await });
        loop {
            let (sock, peer) = match listener.accept().await {
                Ok(x) => x,
                Err(_) => {
                    tokio::time::sleep(Duration::from_millis(50)).await; // out of files: wait for some to close
                    continue;
                }
            };
            let _ = sock.set_nodelay(true);
            let me = self.clone();
            let me_drops = self.drops.subscribe();
            tokio::spawn(async move {
                let service = hyper::service::service_fn(move |req| {
                    let me = me.clone();
                    async move { Ok::<_, Infallible>(me.serve(req, peer.ip()).await) }
                });
                let mut drops = me_drops;
                // A broken connection is the visitor's business.
                let serving = hyper::server::conn::http1::Builder::new().timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(60)).max_buf_size(16 * 1024).serve_connection(TokioIo::new(sock), service);
                tokio::select! {
                    _ = serving => {}
                    _ = drops.changed() => {}
                }
            });
        }
    }
    /// Every minute: what couldn't be saved is, and idle rooms are saved or forgotten.
    pub fn tidy(&self) {
        for r in self.rooms() {
            r.catch_up();
            if self.hosted.contains(&r.file) {
                continue;
            }
            if let Some(files) = r.forget() {
                self.delete_room(&r.code); // first: a page whose stream ends asks for the room at once
                r.close();
                if files {
                    remove_files(&r.file);
                }
            }
        }
    }
    async fn keep_house(&self) {
        let mut tick = interval(Duration::from_secs(1));
        tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
        for n in 0u64.. {
            tick.tick().await;
            let rooms: Vec<Arc<Room>> = lock(&self.rooms).values().cloned().collect();
            for r in &rooms {
                r.rest();
            }
            if n % 60 == 0 {
                if let Some(l) = &self.limits {
                    l.sweep();
                }
                self.tidy();
            }
            if n % 3600 == 0 && self.site.is_some() {
                clear_old(&self.place.rooms, |code| lock(&self.rooms).contains_key(code));
            }
        }
    }

    async fn serve(&self, req: Request<Incoming>, peer: IpAddr) -> Answer {
        let mut r = match self.route(req, peer).await {
            Ok(r) => r,
            Err(Fail::Limit(m)) => wrong(StatusCode::TOO_MANY_REQUESTS, m),
            Err(Fail::Room(m)) => wrong(StatusCode::BAD_REQUEST, &m),
            Err(Fail::Server(m)) => {
                eprintln!("{m}");
                wrong(StatusCode::SERVICE_UNAVAILABLE, DOWN)
            }
        };
        for (k, v) in &self.headers {
            r.headers_mut().insert(k.clone(), v.clone());
        }
        r
    }
    fn who(&self, req: &Request<Incoming>, peer: IpAddr) -> String {
        let last = req.headers().get_all("x-forwarded-for").iter().next_back();
        visitor(peer, last.filter(|_| self.site.as_ref().is_some_and(|s| s.trust_proxy)).and_then(|v| v.to_str().ok()))
    }
    // `by` looks it up: the website limits how many wrong codes one visitor tries.
    fn room(&self, code: &str, by: &str) -> Res<Arc<Room>> {
        if let Some(l) = &self.limits {
            l.may_look_up(by)?;
        }
        let code = code.to_uppercase();
        if let Some(r) = lock(&self.rooms).get(&code) {
            return Ok(r.clone());
        }
        if let Some(l) = &self.limits {
            l.wrong_code(by)?;
        }
        Err(Fail::Room(format!("No room with code {code}: check the code.")))
    }

    async fn route(&self, req: Request<Incoming>, peer: IpAddr) -> Res<Answer> {
        let uri = req.uri().clone();
        let path = uri.path();
        if path.starts_with("//") || !path.starts_with('/') {
            return Ok(wrong(StatusCode::BAD_REQUEST, "Bad request."));
        }
        let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        let first = parts.first().copied().unwrap_or("");
        if path == "/healthz" {
            let can = self.can_save();
            return Ok(json_text(if can { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE }, json!({"ok": can, "rooms": self.count()}).to_string()));
        }
        let who = self.who(&req, peer);
        if let Some(l) = self.limits.as_ref().filter(|_| first == "api" || first == "mcp") {
            l.request(&who)?;
        }
        if path == "/mcp" {
            return self.mcp(req, &who).await;
        }
        if path == "/llms.txt" {
            return Ok(self.guide(&req, None));
        }
        let page = room_page(path);
        if let Some((code, md)) = page {
            let accepts = |v: &HeaderValue| v.to_str().is_ok_and(|s| s.split([',', ';']).any(|t| t.trim() == "text/markdown"));
            if md || req.headers().get_all(header::ACCEPT).iter().any(accepts) {
                return Ok(self.guide(&req, Some(&code.to_uppercase())));
            }
        }
        if first == "api" {
            return self.api(req, &parts[1..], &query(uri.query()), &who).await;
        }
        let file = match path {
            "/" => "/phone.html",
            "/tv" => "/tv.html",
            "/favicon.ico" => "/favicon.svg",
            _ if page.is_some() => "/phone.html",
            _ if first == "recap" && parts.len() == 2 && is_recap_id(parts[1]) => "/recap.html",
            p => p,
        };
        let mut r = asset(file, req.headers());
        if file.ends_with(".html") && r.status() == StatusCode::OK {
            self.put_preview(&mut r, &req, page.map(|(code, _)| code.to_uppercase()));
        }
        Ok(r)
    }
    /// Fills in what an app that previews links reads: it runs no scripts and
    /// needs the image's whole address. A game's link gives the code whether or
    /// not there's such a game, so a preview can't be used to find games.
    fn put_preview(&self, r: &mut Answer, req: &Request<Incoming>, code: Option<String>) {
        let Body::Whole(Some(html)) = r.body() else { return };
        let Ok(html) = std::str::from_utf8(html) else { return };
        let origin = self.origin(req);
        let origin: String = origin.chars().filter(|c| c.is_ascii_alphanumeric() || ":/.-_[]".contains(*c)).collect(); // the visitor's Host header, at home
        let title = code.map_or_else(|| "board-lite".into(), |c| format!("Join game {c}"));
        let tags = format!(
            r#"<meta name="description" content="{PREVIEW_TEXT}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="board-lite">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{PREVIEW_TEXT}">
  <meta property="og:image" content="{origin}/preview.png">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="A fire dragon breathing fire">
  <meta name="twitter:card" content="summary_large_image">"#
        );
        let html = html.replacen("<!--preview-->", &tags, 1);
        *r.body_mut() = Body::Whole(Some(html.into()));
    }
    fn origin(&self, req: &Request<Incoming>) -> String {
        let host = req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("localhost");
        self.site.as_ref().map_or_else(|| format!("http://{host}"), |s| s.origin.clone())
    }

    async fn mcp(&self, req: Request<Incoming>, who: &str) -> Res<Answer> {
        if req.method() != Method::POST {
            let mut r = Response::new(Body::Whole(None));
            *r.status_mut() = StatusCode::METHOD_NOT_ALLOWED;
            r.headers_mut().insert(header::ALLOW, HeaderValue::from_static("POST"));
            return Ok(r);
        }
        let _hold = self.hold(who)?; // a wait is held open
        let m = body(req, MAX_MCP_BODY).await?;
        Ok(match mcp::rpc(&m, |code| self.room(code, who)).await {
            Some(v) => ok(v),
            None => {
                let mut r = Response::new(Body::Whole(None));
                *r.status_mut() = StatusCode::ACCEPTED;
                r
            }
        })
    }
    fn guide(&self, req: &Request<Incoming>, code: Option<&str>) -> Answer {
        let text = mcp::guide(&self.origin(req), code);
        let mut r = answer(StatusCode::OK, "text/markdown; charset=utf-8", "no-cache", Body::Whole(Some(text.into())));
        r.headers_mut().insert(header::VARY, HeaderValue::from_static("accept"));
        r
    }
    fn events(&self, room: Arc<Room>, tok: Option<&str>, tv: Option<&str>, answers: bool, who: &str) -> Res<Answer> {
        let hold = self.hold(who)?;
        let changes = room.watch();
        let here = room.connect(tok, tv.filter(|_| tok.is_none()), answers);
        let mut ping = tokio::time::interval_at(tokio::time::Instant::now() + PING, PING);
        ping.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut e = Events { room, tok: tok.map(|t| t.into()), changes, queue: VecDeque::new(), ping, _here: here, _hold: hold };
        e.send();
        let mut r = answer(StatusCode::OK, "text/event-stream", "no-store", Body::Stream(Box::pin(unfold(e, Events::next))));
        r.headers_mut().insert("x-accel-buffering", HeaderValue::from_static("no"));
        Ok(r)
    }

    async fn api(&self, req: Request<Incoming>, parts_: &[&str], q: &HashMap<String, String>, who: &str) -> Res<Answer> {
        let get = req.method() == Method::GET;
        let post = req.method() == Method::POST;
        let first = parts_.first().copied().unwrap_or("");
        match first {
            "info" => return Ok(ok(match &self.site {
                // A public website has one address, and says nothing about its machine.
                Some(s) => json!({"lan": [], "tailscale": [], "port": 0, "origin": s.origin}),
                None => {
                    let (lan, tailscale) = crate::addresses::addresses();
                    json!({"lan": lan, "tailscale": tailscale, "port": self.port})
                }
            })),
            "rulebook" if get => return Ok(ok(crate::state::rulebook())),
            "recaps" if get && parts_.len() == 2 => return Ok(self.recap(parts_[1])),
            "saved" if get => return Ok(ok(self.saved())), // strangers' games aren't listed: open the room's link
            "rooms" => {}
            _ => return Ok(not_found()),
        }
        if parts_.len() == 1 && post {
            let remote = body(req, MAX_BODY).await?.get("remote") == Some(&Value::Bool(true));
            if let Some(l) = &self.limits {
                l.new_room(who, self.count())?;
            }
            let mut rooms = lock(&self.rooms);
            let code = new_code(&self.place.rooms, |c| rooms.contains_key(c));
            let room = Room::new(&code, &self.place, remote).map_err(Fail::Server)?;
            let host = room.host.clone();
            rooms.insert(code.clone(), room);
            if self.site.is_none() {
                let url = format!("http://localhost:{}/{code}", self.port);
                println!("Room {code} is open.\n  At a terminal:  node src/cli.ts join {url} <name>\n  Claude players: node src/playtest/run.ts --room {url} --models opus+expected,haiku+expected\n  On a TV, any time: http://localhost:{}/tv?room={code}", self.port);
            }
            return Ok(ok(json!({"code": code, "hostToken": host})));
        }
        let room = self.room(parts_.get(1).copied().unwrap_or(""), who)?;
        let action = parts_.get(2).copied().unwrap_or("");
        let token = q.get("token").map(|s| s.as_str());
        let tok = token.unwrap_or("");
        let num = |k: &str| q.get(k).and_then(|s| s.trim().parse::<f64>().ok()).filter(|n| n.is_finite() && *n > 0.0);
        if get {
            return match action {
                "events" => self.events(room, token, q.get("tv").map(|s| s.as_str()), q.contains_key("answers"), who),
                "state" => Ok(parts(room.state(tok)?)),
                "wait" => {
                    let _hold = self.hold(who)?;
                    let (code, s) = room.wait(tok, num("timeout").unwrap_or(60.0).min(self.max_wait())).await?;
                    Ok(parts(wrap(s, format!(r#"{{"code":{code},"state":"#), "}")))
                }
                "listen" => {
                    let _hold = self.hold(who)?;
                    let heard = room
                        .listen(tok, num("since").unwrap_or(0.0) as usize, num("timeout").unwrap_or(0.0).min(self.max_wait()), |room, h| {
                            let before = format!(r#"{{"events":{},"next":{},"state":"#, json!(h.events()), h.next());
                            wrap(h.snapshot(room), before, "}")
                        })
                        .await?;
                    Ok(parts(heard))
                }
                "" => Ok(ok(room.about(tok))),
                _ => Ok(not_found()),
            };
        }
        if !post {
            return Ok(not_found());
        }
        let b = body(req, MAX_BODY).await?;
        let tok = str_of(&b, "token");
        let seat = b.get("seat").and_then(|v| v.as_f64());
        // A seat that isn't one is no player's.
        let seat = seat.map(|n| if n >= 0.0 && n.fract() == 0.0 { n as usize } else { usize::MAX });
        // Who to remove, by the seat's id. A seat number, as older pages send, names no player.
        let player = match (b.get("player"), b.get("seat")) {
            (Some(v), _) => Some(v.as_u64().unwrap_or(u64::MAX)),
            (None, Some(_)) => Some(u64::MAX),
            (None, None) => None,
        };
        match action {
            "join" => {
                let (token, p, _) = room.join(str_of(&b, "name"), via(str_of(&b, "via")))?;
                return Ok(ok(json!({"token": token, "seat": p + 1})));
            }
            "bot" => room.add_bot(tok, b.get("strong") == Some(&Value::Bool(true)))?,
            "leave" => room.leave(tok, player)?,
            "quit" => room.quit(tok)?,
            "open" => room.open(tok, seat)?,
            "back" => room.return_to(tok)?,
            "standin" => room.stand_in_for(tok, seat)?,
            // A TV opening the room while no other TV watches it becomes the room's TV, with its buttons.
            "tv" => return Ok(ok(if room.tv_watching() { json!({}) } else { json!({"hostToken": room.host}) })),
            // A TV's scene starts or ends, for the game log.
            "scene" => {
                let at = b.get("i").and_then(|v| v.as_u64()).map_or(usize::MAX, |n| n as usize);
                room.scene_played(str_of(&b, "tv"), at, b.get("ends") == Some(&Value::Bool(true)), b.get("cut") == Some(&Value::Bool(true)))?
            }
            "shown" => room.final_shown(),
            "skip" => room.skip_scene(tok, b.get("seen").and_then(Value::as_u64).map_or(0, |n| n as usize))?,
            "here" => room.answer(tok)?,
            "start" => room.start(tok)?,
            "save" => room.save(tok)?,
            "continue" => {
                if room.resume(tok)? && self.site.is_none() {
                    self.bring_back_claude(&room);
                }
            }
            "do" => {
                if tok == room.host {
                    return Err(Fail::Room("The TV has no seat.".into()));
                }
                room.command(tok, b.get("command").unwrap_or(&Value::Null), via(str_of(&b, "via")), str_of(&b, "id"))?;
                return Ok(parts(wrap(room.snapshot(Some(tok)), r#"{"state":"#.into(), "}")));
            }
            _ => return Ok(not_found()),
        }
        Ok(ok(json!({})))
    }
    // Saved games, newest first; strangers' games aren't listed on a public website.
    fn saved(&self) -> Value {
        if self.site.is_some() {
            return json!([]);
        }
        let mut all: Vec<(i64, Value)> = lock(&self.rooms).values().filter_map(|r| r.waiting()).collect();
        all.sort_by_key(|x| -x.0);
        all.into_iter().map(|x| x.1).collect()
    }
    // Continuing a saved game at home brings back the Claude players who were
    // at it: each of their runners starts again with --resume. Only runners on
    // this machine that listed themselves are: nothing a phone sends names a folder.
    fn bring_back_claude(&self, room: &Room) {
        for dir in room.claude_runners().into_iter().filter(|d| d.exists()) {
            let Ok(errors) = std::fs::OpenOptions::new().append(true).create(true).open(dir.join("runner.errors.log")) else { continue };
            let url = format!("http://127.0.0.1:{}/{}", self.port, room.code);
            let run = tokio::process::Command::new("node").arg("src/playtest/run.ts").arg("--resume").arg(&dir).arg("--room").arg(url).stdin(Stdio::null()).stdout(Stdio::null()).stderr(errors).spawn();
            match run {
                Ok(mut child) => {
                    println!("Room {} continues: bringing back the Claude players in {}.", room.code, dir.display());
                    tokio::spawn(async move { child.wait().await });
                }
                Err(e) => eprintln!("Room {}: could not bring the Claude players in {} back: {e}", room.code, dir.display()),
            }
        }
    }
    fn recap(&self, id: &str) -> Answer {
        let text = if is_recap_id(id) { std::fs::read(self.place.recaps.join(format!("{id}.json"))).ok() } else { None };
        match text {
            Some(t) => answer(StatusCode::OK, "application/json", "no-cache", Body::Whole(Some(t.into()))),
            None => wrong(StatusCode::NOT_FOUND, "No recap with that link."),
        }
    }
}

fn asset(path: &str, headers: &HeaderMap) -> Answer {
    let Some(a) = ASSETS.iter().find(|a| a.path == path) else { return not_found() };
    // Always checked with the server (no-cache), but a page the browser already has comes back as a 304.
    let fresh = !a.etag.is_empty() && headers.get(header::IF_NONE_MATCH).is_some_and(|v| v == a.etag);
    let mut r = answer(StatusCode::OK, a.mime, a.cache, Body::Whole(Some(Bytes::from_static(a.body))));
    if fresh {
        *r.status_mut() = StatusCode::NOT_MODIFIED;
        *r.body_mut() = Body::Whole(None);
        r.headers_mut().remove(header::CONTENT_TYPE);
    }
    if !a.etag.is_empty() {
        r.headers_mut().insert(header::ETAG, HeaderValue::from_static(a.etag));
    }
    r
}
