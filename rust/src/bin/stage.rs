//! The server for the tests, the screenshots and the playtest runner, which
//! drive it through src/host.ts: one JSON request a line on stdin, one answer a
//! line on stdout. It can put a room in any state, so it's never in the image.
use board_lite::data::set_points_to_win;
use board_lite::limits::visitor;
use board_lite::room::{Fail, Here, Opts, Place, Room, new_code};
use board_lite::server::{Server, Site};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Default)]
struct Stage {
    servers: HashMap<i64, (Arc<Server>, tokio::task::AbortHandle)>,
    rooms: HashMap<i64, Arc<Room>>,
    here: HashMap<i64, Here>,
    waits: HashMap<i64, Rc<RefCell<Option<Value>>>>,
    n: i64,
}
fn s<'a>(q: &'a Value, k: &str) -> &'a str {
    q[k].as_str().unwrap_or("")
}
fn whole(parts: Vec<bytes::Bytes>) -> Value {
    serde_json::from_slice(&parts.concat()).unwrap()
}
fn place(q: &Value, home: bool) -> Place {
    let cache = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".cache/board-lite");
    let dir = q["dir"].as_str().map(PathBuf::from);
    let rooms = dir.clone().unwrap_or_else(|| cache.join("rooms"));
    let recaps = q["recaps"].as_str().map(PathBuf::from).unwrap_or_else(|| dir.unwrap_or(cache).join("recaps"));
    Place { rooms, recaps, home, opts: serde_json::from_value::<Opts>(q.clone()).unwrap_or_default() }
}

impl Stage {
    fn id(&mut self) -> i64 {
        self.n += 1;
        self.n
    }
    fn keep(&mut self, room: Arc<Room>) -> Value {
        let known = self.rooms.iter().find(|(_, r)| Arc::ptr_eq(r, &room)).map(|(k, _)| *k);
        let id = known.unwrap_or_else(|| self.id());
        let v = json!({"id": id, "code": room.code, "file": room.file, "hostToken": room.host, "recapId": room.recap_id});
        self.rooms.insert(id, room);
        v
    }
    async fn serve(&mut self, q: &Value) -> Result<Value, Fail> {
        let wrong = |e: String| Fail::Server(e);
        let site = q["site"].as_object().map(|x| Site { origin: x["origin"].as_str().unwrap_or("").into(), trust_proxy: x.get("trustProxy") == Some(&json!(true)) });
        let home = site.is_none();
        let host = q["host"].as_str().unwrap_or("0.0.0.0");
        let listener = tokio::net::TcpListener::bind((host, q["port"].as_u64().unwrap_or(0) as u16)).await.map_err(|e| wrong(e.to_string()))?;
        let port = listener.local_addr().map_err(|e| wrong(e.to_string()))?.port();
        let files = q["files"].as_array().into_iter().flatten().filter_map(|f| f.as_str().map(PathBuf::from)).collect();
        let mut server = Server::new(site, place(&q["opts"], home), port, files, q["resume"] == true).map_err(wrong)?;
        if let Some(l) = Arc::get_mut(&mut server).and_then(|x| x.limits.as_mut()) {
            let over = &q["site"]["limits"];
            for (i, k) in ["requestsPerMinute", "roomsPerHour", "wrongCodesPerMinute"].iter().enumerate() {
                if let Some(n) = over[k].as_u64() {
                    l.most[i] = n as u32;
                }
            }
            if let Some(n) = over["open"].as_u64() {
                l.open_each = n as usize;
            }
        }
        let task = tokio::spawn(server.clone().run(listener)).abort_handle();
        let id = self.id();
        self.servers.insert(id, (server, task));
        Ok(json!({"id": id, "port": port}))
    }
    async fn answer(&mut self, q: &Value) -> Result<Value, Fail> {
        set_points_to_win(q["win"].as_i64().unwrap_or(0));
        let int = |k: &str| q[k].as_i64().unwrap_or(0);
        let op = s(q, "op");
        match op {
            "serve" => return self.serve(q).await,
            "newRoom" => {
                let place = place(&q["opts"], q["opts"]["hideFile"] != true);
                let remote = q["opts"]["remote"] == true;
                let file = q["opts"]["file"].as_str().map(PathBuf::from).unwrap_or_else(|| place.rooms.join(format!("{}.json", s(q, "code"))));
                let room = Room::host(s(q, "code"), file, &place, remote).map_err(Fail::Server)?;
                return Ok(self.keep(room));
            }
            "newCode" => return Ok(json!(new_code(Path::new(s(q, "dir")), |_| false))),
            "visitor" => return Ok(json!(visitor(s(q, "ip").parse().map_err(|_| Fail::Room("bad address".into()))?, q["forwarded"].as_str()))),
            "addresses" => {
                let (lan, tailscale) = board_lite::addresses::addresses();
                return Ok(json!({"lan": lan, "tailscale": tailscale}));
            }
            _ => {}
        }
        if let Some((server, task)) = self.servers.get(&int("server")) {
            let (server, task) = (server.clone(), task.clone());
            match op {
                "rooms" => {
                    let rooms: Vec<Value> = server.rooms().into_iter().map(|r| self.keep(r)).collect();
                    return Ok(json!(rooms));
                }
                "setRoom" => server.set_room(self.rooms[&int("room")].clone()),
                "deleteRoom" => server.delete_room(s(q, "code")),
                "clearRooms" => server.clear_rooms(),
                "drop" => server.drop_connections(),
                "close" => {
                    task.abort();
                    server.drop_connections();
                    self.servers.remove(&int("server"));
                }
                _ => return Err(Fail::Server(format!("no such call: {op}"))),
            }
            return Ok(Value::Null);
        }
        let room = self.rooms.get(&int("room")).cloned().ok_or_else(|| Fail::Server(format!("no such room for {op}")))?;
        if let Some(p) = q.get("push") {
            if let Some(g) = p.get("game") {
                room.stage_game(g.clone(), p["log"].clone()).map_err(Fail::Server)?;
            }
            if let Some(x) = p.get("seats") {
                room.stage_seats(serde_json::from_value(x.clone()).map_err(|e| Fail::Server(e.to_string()))?, p["savedAt"].as_i64());
            }
        }
        let tok = s(q, "tok");
        Ok(match op {
            "sync" => Value::Null,
            "join" => json!(room.stage_join(s(q, "name"), q["kind"] == "bot", q["via"].as_str().map(|v| v.into()))?),
            "addBot" => {
                room.add_bot(&room.host, q["strong"] == true)?;
                Value::Null
            }
            "leave" => json!(room.stage_leave(int("seat").max(0) as usize)?),
            "quit" => json!(room.quit(tok)?),
            "standInFor" => json!(room.stand_in_for(tok, usize::try_from(int("seat")).ok())?),
            "save" => json!(room.save(tok)?),
            "continue" => json!(room.resume(tok)?),
            "canStart" => json!(room.stage_can_start(tok)),
            "start" => json!(match q["seed"].as_i64() {
                Some(n) => room.start_seeded(tok, n)?,
                None => room.start(tok)?,
            }),
            "command" => json!(room.command(tok, s(q, "cmd"), ["phone", "cli", "claude"].into_iter().find(|v| *v == s(q, "via")), s(q, "id"))?),
            "state" => whole(room.state(tok)?),
            "snapshot" => whole(room.snapshot(q["tok"].as_str())),
            "lobby" => room.about("")["lobby"].clone(),
            "mutated" => json!(room.stage_mutated(int("before") as usize)?),
            "changed" => json!(room.stage_changed()),
            "connect" => {
                let here = room.connect(q["tok"].as_str(), q["tv"] == true, q["answers"] == true);
                let id = self.id();
                self.here.insert(id, here);
                json!(id)
            }
            "disconnect" => {
                self.here.remove(&int("here"));
                Value::Null
            }
            "wait" => {
                let id = self.id();
                let slot = Rc::new(RefCell::new(None));
                self.waits.insert(id, slot.clone());
                let (room, tok, secs) = (room.clone(), tok.to_string(), int("ms") as f64 / 1000.0);
                let mut going = Box::pin(async move { room.wait(&tok, secs).await });
                // Its seat counts as here from now, not from when the task first runs.
                let first = std::future::poll_fn(|cx| std::task::Poll::Ready(going.as_mut().poll(cx))).await;
                let done = |r: Result<(u8, Vec<bytes::Bytes>), Fail>| match r {
                    Ok((code, state)) => json!({"code": code, "state": whole(state)}),
                    Err(e) => json!({"error": why(e).1}),
                };
                match first {
                    std::task::Poll::Ready(r) => *slot.borrow_mut() = Some(done(r)),
                    std::task::Poll::Pending => drop(tokio::task::spawn_local(async move { *slot.borrow_mut() = Some(done(going.await)) })),
                }
                json!(id)
            }
            "waited" => {
                let v = self.waits.get(&int("wait")).and_then(|w| w.borrow_mut().take());
                if v.is_some() {
                    self.waits.remove(&int("wait"));
                }
                json!(v)
            }
            "closeRoom" => json!(room.close()),
            _ => return Err(Fail::Server(format!("no such call: {op}"))),
        })
    }
}
fn why(e: Fail) -> (&'static str, String) {
    match e {
        Fail::Room(m) => ("room", m),
        Fail::Limit(m) => ("limit", m.into()),
        Fail::Server(m) => ("server", m),
    }
}

fn main() {
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let local = tokio::task::LocalSet::new();
    local.block_on(&rt, async {
        let mut stage = Stage::default();
        let mut lines = BufReader::new(tokio::io::stdin()).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let q: Value = serde_json::from_str(&line).expect("a request is JSON");
            let mut v = match stage.answer(&q).await {
                Ok(v) => json!({"ok": v}),
                Err(e) => {
                    let (kind, m) = why(e);
                    json!({"fail": kind, "why": m})
                }
            };
            if let Some(room) = stage.rooms.get(&q["room"].as_i64().unwrap_or(0)) {
                v["now"] = room.stage_state(q["rev"].as_i64().unwrap_or(-1), q["logged"].as_u64().unwrap_or(0) as usize);
            }
            let mut out = std::io::stdout().lock();
            writeln!(out, "\0{v}").unwrap();
            out.flush().unwrap();
        }
    });
    std::process::exit(0);
}
