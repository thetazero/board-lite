//! A room: one game hosted by the server, and the players seated at it. Every
//! client (phones, the TV, the CLI, Claude players) joins with a name, gets a
//! seat token and sends the engine's commands through the room; every change is
//! pushed to whoever is watching. The game is saved after each change, and who
//! sits where beside it (<game>.seats.json), so a restart loses nothing.
use crate::bot;
use crate::command::Command;
use crate::data::DATA;
use crate::engine::{Game, Phase};
use crate::gamelog::{GameLog, Sender, now_ms};
use crate::limits::lock;
use crate::rng::Rng;
use crate::state::{self, Lobby, LobbySeat};
use crate::strongbot::{self, Seen, Tune};
use crate::view::Shown;
use crate::{recap, scenes, store};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use tokio::sync::watch;
use tokio::task::AbortHandle;
use unicode_general_category::{GeneralCategory as Cat, get_general_category};

const MIN_PLAYERS: usize = 2;
const MAX_PLAYERS: usize = 6;
const AWAY_MS: i64 = 60_000;
const OPEN_MS: i64 = 180_000;
const TV_GONE_MS: i64 = 20_000;
const BOT_DELAY_MS: i64 = 700;
const CACHE_MS: i64 = 500; // how long a quiet room keeps the JSON it last sent

#[derive(Debug)]
pub enum Fail {
    Room(String),
    Limit(&'static str),
    Server(String), // it couldn't be saved, so it didn't happen
}
/// What a player is told then; web/common.ts says the same when nothing answers for the server.
pub const DOWN: &str = "The server is down. Refresh the page.";
pub type Res<T = ()> = Result<T, Fail>;
fn no<T>(m: impl Into<String>) -> Res<T> {
    Err(Fail::Room(m.into()))
}

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Player,
    Bot,
    Open,
}
impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Player => "player",
            Kind::Bot => "bot",
            Kind::Open => "open",
        }
    }
}
#[derive(Clone)]
pub struct Seat {
    uid: u64, // which seat a stream or a removal is on, as seats come and go in the lobby: new with each token
    pub name: String,
    pub token: String,
    pub kind: Kind,
    connected: usize,
    answering: usize, // the connected streams whose pages answer pings: no sign of anyone by themselves
    seen: i64,        // when it was last heard from
    stand_in: bool,
    left: bool,
    opened: bool, // the first player opened it, though its phone is still here: only its player's own tap takes it back
    strong: bool, // a bot seat played by the strong bot
    via: Option<&'static str>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedSeat {
    #[serde(default)]
    id: u64,
    name: String,
    token: String,
    kind: Kind,
    #[serde(default)]
    stand_in: bool,
    #[serde(default)]
    left: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    opened: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    strong: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    claude: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedRoom {
    code: String,
    host_token: String,
    #[serde(default)]
    remote: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    saved_at: Option<i64>,
    #[serde(default)]
    last_id: u64, // the last seat id given: none is given twice
    seats: Vec<SavedSeat>,
}
fn read_saved(file: &Path) -> Option<SavedRoom> {
    serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()
}
fn beside(file: &Path, end: &str) -> PathBuf {
    let f = file.to_string_lossy();
    PathBuf::from(format!("{}{end}", f.strip_suffix(".json").unwrap_or(&f)))
}
pub fn remove_files(file: &Path) {
    for end in [".json", ".seats.json", ".log.jsonl"] {
        let _ = std::fs::remove_file(beside(file, end));
    }
}

fn random<const N: usize>() -> [u8; N] {
    let mut b = [0; N];
    getrandom::fill(&mut b).expect("the system's randomness");
    b
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn token() -> String {
    hex(&random::<12>())
}
pub fn new_code(dir: &Path, taken: impl Fn(&str) -> bool) -> String {
    const LETTERS: &[u8] = b"BCDFGHJKLMNPQRSTVWXZ"; // no vowels: no accidental words
    loop {
        let c: String = random::<4>().iter().map(|b| LETTERS[*b as usize % LETTERS.len()] as char).collect();
        if !taken(&c) && !dir.join(format!("{c}.json")).exists() && !dir.join(format!("{c}.seats.json")).exists() {
            return c;
        }
    }
}

// A name as the table shows it: spaces collapsed, no control or invisible
// characters, at most 12 characters. A joiner inside an emoji stays.
fn tidy_name(name: &str) -> String {
    let spaced = name.split(crate::engine::js_space).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
    let seen: String = spaced.chars().filter(|c| *c == '\u{200d}' || !(matches!(get_general_category(*c), Cat::Control | Cat::Format) || "\u{115F}\u{1160}\u{2800}\u{3164}\u{FFA0}".contains(*c))).collect();
    let one = seen.split(' ').filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
    one.chars().take(12).collect::<String>().trim().to_string()
}
fn shows(c: char) -> bool {
    use Cat::*;
    !matches!(get_general_category(c), NonspacingMark | SpacingMark | EnclosingMark | SpaceSeparator | LineSeparator | ParagraphSeparator | Control | Format | Surrogate | PrivateUse | Unassigned)
}

struct Inner {
    seats: Vec<Seat>,
    next_uid: u64,
    last_active: i64,
    saved_at: Option<i64>,
    game: Option<Box<Game>>,
    log: GameLog,
    bot_timer: Option<AbortHandle>,
    away_timer: Option<AbortHandle>,
    open_timer: Option<AbortHandle>,
    waited: HashMap<u64, i64>, // since when the game has waited on each seat, without a word from it
    scene_timer: Option<AbortHandle>,
    tv_timer: Option<AbortHandle>,
    version: u64,
    game_rev: u64, // how many times the game has changed
    done_ids: VecDeque<String>,
    bot_rng: Rng,
    offers_seen: Seen, // the strong bots' own offers, and since when they've waited
    saved_seats: String,
    behind: bool, // the seats or the recap couldn't be saved when they changed
    screens: usize,
    scene_until: i64,
    tvs: usize,
    has_tv: bool,
    recapped: bool,
    closed: bool,
    // The game as JSON, as it was last sent: everyone watching gets the same public bytes.
    public: Option<Bytes>,
    seen: HashMap<String, usize>, // the events each Claude player has been shown up to (mcp.rs)
}

/// What a room waits, and what tests and screenshots fix.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Opts {
    pub bot_delay_ms: i64, // a pause before a bot moves, so the TV can show it
    pub away_ms: i64,
    pub open_ms: i64, // how long the game waits on someone who is here before their seat can be opened
    pub tv_gone_ms: i64,
    pub first_seat: Option<usize>,
    pub recap_id: Option<String>,
    pub ended: Option<i64>, // the time a recap is dated by
}
impl Default for Opts {
    fn default() -> Opts {
        Opts { bot_delay_ms: BOT_DELAY_MS, away_ms: AWAY_MS, open_ms: OPEN_MS, tv_gone_ms: TV_GONE_MS, first_seat: None, recap_id: None, ended: None }
    }
}
/// Where rooms and recaps go, and whether it's a home's server.
pub struct Place {
    pub rooms: PathBuf,
    pub recaps: PathBuf,
    pub home: bool,
    pub opts: Opts,
}

pub struct Room {
    pub code: String,
    pub file: PathBuf,
    pub host: String,
    pub recap_id: String,
    home: bool, // not a public website: strong bots, and clients are told where the file is
    recaps: PathBuf,
    opts: Opts,
    changes: watch::Sender<u64>,
    inner: Mutex<Inner>,
    me: Weak<Room>,
}

/// A seat's client is here (a stream, a wait), or a screen is, until dropped.
pub struct Here {
    room: Arc<Room>,
    who: Who,
}
enum Who {
    Nobody,
    Seat { uid: u64, stream: bool, answers: bool },
    Screen { tv: bool },
}
impl Drop for Here {
    fn drop(&mut self) {
        let room = &self.room;
        let i = &mut *lock(&room.inner);
        match self.who {
            Who::Nobody => {}
            Who::Screen { tv } => {
                i.screens -= 1;
                if tv {
                    i.tvs -= 1;
                    if i.tvs == 0 {
                        room.tv_gone(i);
                    }
                }
                i.log.write("disconnect", if tv { &Sender::TV } else { &Sender::GAME }, json!({"what": if tv { "tv" } else { "screen" }}));
            }
            Who::Seat { uid, stream, answers } => {
                let Some(p) = i.seats.iter().position(|s| s.uid == uid) else { return };
                let s = &mut i.seats[p];
                s.connected -= 1;
                // A page that answers was last there when it last answered: its stream can end long after it's gone.
                if answers {
                    s.answering = s.answering.saturating_sub(1);
                } else {
                    s.seen = now_ms();
                }
                if stream {
                    let streams = i.seats[p].connected;
                    let by = i.sender(p);
                    i.log.write("disconnect", &by, json!({"seat": p, "streams": streams}));
                    room.changed(i);
                } else {
                    room.watch_away(i);
                }
            }
        }
    }
}

impl Seat {
    /// Whether it counts as here however long it says nothing.
    fn held(&self) -> bool {
        self.connected > self.answering
    }
    fn here(&self, now: i64, away: i64) -> bool {
        self.kind == Kind::Bot || (!self.left && (self.held() || now - self.seen < away))
    }
    /// Whether the first player may let a bot play it, and its name on another phone takes it back.
    fn vacant(&self, now: i64, away: i64) -> bool {
        self.kind == Kind::Player && (self.opened || !self.here(now, away))
    }
}

impl Inner {
    fn seat_of(&mut self, tok: &str) -> Option<usize> {
        let p = self.seats.iter().position(|s| s.token == tok)?;
        self.seats[p].seen = now_ms();
        Some(p)
    }
    /// The player whose token this is, now. A wait asks each time it wakes:
    /// players are removed while it sleeps, and seat numbers change.
    fn player_of(&self, tok: &str) -> Res<usize> {
        match self.seats.iter().position(|s| s.token == tok && s.kind == Kind::Player) {
            Some(p) => Ok(p),
            None => no("You are not in this game."),
        }
    }
    fn sender(&self, p: usize) -> Sender {
        let s = &self.seats[p];
        let kind = if s.kind == Kind::Bot { "bot" } else { s.via.unwrap_or("player") };
        Sender { kind, seat: Some(p), name: Some(s.name.clone()) }
    }
    fn seating(&self) -> bool {
        self.game.is_some() && self.seats.iter().any(|s| s.kind == Kind::Open)
    }
    fn abandoned(&self) -> bool {
        let mut people = self.seats.iter().filter(|s| s.kind == Kind::Player).peekable();
        self.game.is_some() && people.peek().is_some() && people.all(|s| s.left)
    }
    fn phase(&self) -> Option<Phase> {
        self.game.as_ref().map(|g| g.phase)
    }
    fn scene_left(&self) -> i64 {
        (self.scene_until - now_ms()).max(0)
    }
    fn watched(&self) -> bool {
        self.screens > 0 || (!self.has_tv && self.seats.iter().any(|s| s.via == Some("phone") && s.connected > 0))
    }
    fn clean_name(&self, name: &str) -> Res<String> {
        let clean = tidy_name(name);
        if !clean.chars().any(shows) {
            return no("Choose a name.");
        }
        if self.seats.iter().any(|s| s.kind != Kind::Open && s.name.to_lowercase() == clean.to_lowercase()) {
            return no(format!("Someone is already called {clean}: choose another name."));
        }
        Ok(clean)
    }
    fn new_seat(&mut self, name: String, kind: Kind) -> Seat {
        self.next_uid += 1;
        Seat { uid: self.next_uid, name, token: token(), kind, connected: 0, answering: 0, seen: 0, stand_in: false, left: false, opened: false, strong: false, via: None }
    }
    /// The seat's token is no longer the one it was, and whoever held that is
    /// not here: their streams and waits still open count for no one.
    fn new_hands(&mut self, p: usize) {
        self.next_uid += 1;
        let s = &mut self.seats[p];
        (s.uid, s.token, s.connected, s.answering) = (self.next_uid, token(), 0, 0);
    }
    /// Whether the game waits on seat p now.
    fn waits_on(&self, p: usize) -> bool {
        self.game.as_ref().is_some_and(|g| g.waiting_on().contains(&p)) && self.scene_left() == 0 && !self.seating() && self.saved_at.is_none()
    }
}

fn clear(t: &mut Option<AbortHandle>) {
    if let Some(t) = t.take() {
        t.abort();
    }
}

impl Room {
    pub fn new(code: &str, place: &Place, remote: bool) -> Result<Arc<Room>, String> {
        let file = place.rooms.join(format!("{code}.json"));
        let room = Room::host(code, file, place, remote)?;
        if lock(&room.inner).saved_seats.is_empty() {
            room.close();
            return Err(format!("Room {code}: could not save the new room"));
        }
        Ok(room)
    }
    /// Hosted again after a restart: the same TV, the same players in the same seats.
    pub fn host(code: &str, file: PathBuf, place: &Place, remote: bool) -> Result<Arc<Room>, String> {
        std::fs::create_dir_all(file.parent().unwrap_or(&place.rooms)).map_err(|e| e.to_string())?;
        let saved = read_saved(&beside(&file, ".seats.json"));
        let game = if file.exists() { Some(Box::new(store::load(&file)?)) } else { None };
        let host = saved.as_ref().map_or_else(token, |s| s.host_token.clone());
        let mut i = Inner {
            seats: vec![],
            next_uid: saved.as_ref().map_or(0, |s| s.last_id),
            last_active: now_ms(),
            saved_at: saved.as_ref().and_then(|s| s.saved_at),
            game,
            log: GameLog::new(beside(&file, ".log.jsonl")),
            bot_timer: None,
            away_timer: None,
            open_timer: None,
            waited: HashMap::new(),
            scene_timer: None,
            tv_timer: None,
            version: 0,
            game_rev: 1,
            done_ids: VecDeque::new(),
            bot_rng: Rng::new(now_ms()),
            offers_seen: Seen::new(),
            saved_seats: String::new(),
            behind: false,
            screens: 0,
            scene_until: 0,
            tvs: 0,
            has_tv: saved.as_ref().map_or(!remote, |s| !s.remote),
            recapped: false,
            closed: false,
            public: None,
            seen: HashMap::new(),
        };
        let again = saved.is_some();
        for s in saved.into_iter().flat_map(|s| s.seats) {
            let seat = i.new_seat(s.name, s.kind);
            let uid = if s.id == 0 { seat.uid } else { s.id }; // (saved before seats had ids)
            // Everyone has as long to come back as if their phone had just dropped.
            i.seats.push(Seat { uid, token: s.token, seen: now_ms(), stand_in: s.stand_in, left: s.left, opened: s.opened, strong: s.strong, via: s.claude.then_some("claude"), ..seat });
        }
        if let Some(g) = &i.game {
            let seats: Vec<Value> = i.seats.iter().map(|s| json!({"name": s.name, "kind": s.kind.name(), "standIn": s.stand_in, "left": s.left, "opened": s.opened})).collect();
            i.log.write("load", &Sender::GAME, json!({"code": code, "entries": g.log.len(), "round": g.round, "phase": g.phase, "saved": i.saved_at.is_some(), "seats": seats}));
            let n = g.players.len();
            if i.seats.len() != n {
                i.seats.clear();
                for p in 0..n {
                    let s = i.new_seat(format!("P{}", p + 1), Kind::Open);
                    i.seats.push(s);
                }
            }
        }
        let recap_id = place.opts.recap_id.clone().unwrap_or_else(|| hex(&Sha256::digest(format!("recap:{host}")))[..12].to_string());
        let room = Arc::new_cyclic(|me| Room { code: code.into(), file, host, recap_id, home: place.home, recaps: place.recaps.clone(), opts: place.opts.clone(), changes: watch::Sender::new(0), inner: Mutex::new(i), me: me.clone() });
        {
            let i = &mut *lock(&room.inner);
            i.recapped = room.recap_file().exists();
            if let Err(Fail::Server(e)) = room.save_seats(i) {
                i.behind = true;
                eprintln!("{e}");
            }
            room.watch_away(i);
            if again && i.has_tv {
                room.tv_gone(i);
            }
        }
        Ok(room)
    }
    /// The code a game file was hosted under before, if its seats were saved.
    pub fn saved_code(file: &Path) -> Option<String> {
        read_saved(&beside(file, ".seats.json")).map(|s| s.code)
    }
    /// When it was saved, if it's waiting to be continued, with its round and who's at the table.
    pub fn waiting(&self) -> Option<(i64, Value)> {
        let i = &*lock(&self.inner);
        let (at, g) = (i.saved_at?, i.game.as_ref()?);
        let names: Vec<&str> = i.seats.iter().map(|s| s.name.as_str()).collect();
        Some((at, json!({"code": self.code, "savedAt": at, "round": g.round, "names": names})))
    }
    /// Whether anyone is in it: what the terminal lists at the start.
    pub fn in_use(&self) -> bool {
        let i = &*lock(&self.inner);
        i.game.is_some() || !i.seats.is_empty()
    }
    /// The folders of the Claude runners that have played in this game (src/playtest/run.ts lists them).
    pub fn claude_runners(&self) -> Vec<PathBuf> {
        let v: Value = std::fs::read_to_string(beside(&self.file, ".claude.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
        v["runners"].as_array().into_iter().flatten().filter_map(|d| d.as_str().map(PathBuf::from)).collect()
    }
    /// Rooms saved in `dir` and active in the last `within`, and every saved game however old.
    pub fn saved(dir: &Path, within: Duration) -> Vec<(String, PathBuf)> {
        let touched = |f: &Path| std::fs::metadata(f).and_then(|m| m.modified()).ok();
        let recent = |f: &Path| touched(f).is_some_and(|t| t.elapsed().map_or(true, |d| d <= within));
        let Ok(files) = std::fs::read_dir(dir) else { return vec![] };
        files
            .filter_map(|e| {
                let path = e.ok()?.path();
                let base = path.to_str()?.strip_suffix(".seats.json")?.to_string();
                let saved = read_saved(&path)?;
                let file = PathBuf::from(format!("{base}.json"));
                (saved.saved_at.is_some() || recent(&path) || recent(&file)).then_some((saved.code, file))
            })
            .collect()
    }

    fn recap_file(&self) -> PathBuf {
        self.recaps.join(format!("{}.json", self.recap_id))
    }
    fn save_seats(&self, i: &mut Inner) -> Res {
        let saved = SavedRoom {
            code: self.code.clone(),
            host_token: self.host.clone(),
            remote: !i.has_tv,
            saved_at: i.saved_at,
            last_id: i.next_uid,
            seats: i.seats.iter().map(|s| SavedSeat { id: s.uid, name: s.name.clone(), token: s.token.clone(), kind: s.kind, stand_in: s.stand_in, left: s.left, opened: s.opened, strong: s.strong, claude: s.via == Some("claude") }).collect(),
        };
        let text = json!(saved).to_string();
        if text == i.saved_seats {
            return Ok(());
        }
        store::save(&beside(&self.file, ".seats.json"), &saved).map_err(|e| Fail::Server(format!("Room {}: could not save the seats: {e}", self.code)))?;
        i.saved_seats = text;
        Ok(())
    }
    // Seats, or whether the game is saved, changed by someone's tap: one that can't be saved didn't happen.
    fn change(&self, i: &mut Inner, change: impl FnOnce(&mut Inner)) -> Res {
        let was = (i.seats.clone(), i.saved_at);
        change(i);
        let saved = self.save_seats(i);
        if saved.is_err() {
            (i.seats, i.saved_at) = was;
        }
        saved
    }
    /// What couldn't be saved when it changed (someone coming back, a recap) is saved now.
    pub fn catch_up(&self) {
        let i = &mut *lock(&self.inner);
        if i.behind && !i.closed {
            self.save_rest(i);
            self.changes.send_replace(i.version); // with the recap, if it was that
        }
    }
    fn save_rest(&self, i: &mut Inner) {
        i.behind = false;
        if let Err(Fail::Server(e)) = self.save_seats(i) {
            i.behind = true;
            eprintln!("{e}");
        }
        self.save_recap(i);
    }
    fn save_recap(&self, i: &mut Inner) {
        if i.recapped || i.phase() != Some(Phase::Over) {
            return;
        }
        let names: Vec<String> = i.seats.iter().map(|s| s.name.clone()).collect();
        let r = recap::build(i.game.as_ref().unwrap(), &names, &self.recap_id, self.opts.ended.unwrap_or_else(now_ms));
        match std::fs::create_dir_all(&self.recaps).and_then(|_| store::save(&self.recap_file(), &r)) {
            Ok(()) => i.recapped = true,
            Err(e) => {
                i.behind = true;
                eprintln!("Room {}: could not save the recap: {e}", self.code);
            }
        }
    }

    fn after(&self, ms: i64, then: impl FnOnce(&Room, &mut Inner) + Send + 'static) -> Option<AbortHandle> {
        let me = self.me.clone();
        let task = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(ms.max(0) as u64)).await;
            if let Some(room) = me.upgrade() {
                let i = &mut *lock(&room.inner);
                if !i.closed {
                    then(&room, i);
                }
            }
        });
        Some(task.abort_handle())
    }

    // The only way the room changes the game: through the engine, then saved. A
    // move that can't be saved didn't happen: the game goes back to before it.
    fn mutate(&self, i: &mut Inner, by: Sender, make: impl FnOnce(&mut Game, &mut Rng) -> Result<Command, String>) -> Res {
        let Some(g) = i.game.as_mut() else { return no("The game hasn't started.") };
        let before = g.log.len();
        let was = g.clone_without_log();
        let command = make(g, &mut i.bot_rng).map_err(Fail::Room)?;
        if let Err(e) = store::save(&self.file, &**g) {
            let mut log = std::mem::take(&mut g.log);
            log.truncate(before);
            **g = Game { log, ..was };
            return Err(Fail::Server(format!("Room {}: could not save the game: {e}", self.code)));
        }
        i.log.events(&g.log, before, &by, Some(&command));
        i.public = None;
        i.game_rev += 1;
        let ms = scenes::ms(&g.log[before..]);
        self.hold_for(i, ms);
        self.changed(i);
        Ok(())
    }
    fn hold_for(&self, i: &mut Inner, ms: f64) {
        if ms <= 0.0 || !i.watched() {
            return;
        }
        i.scene_until = now_ms().max(i.scene_until) + ms.ceil() as i64;
        self.wake_after_scene(i);
    }
    fn wake_after_scene(&self, i: &mut Inner) {
        clear(&mut i.scene_timer);
        i.scene_timer = self.after(i.scene_left() + 1, |room, i| {
            i.scene_timer = None;
            if i.scene_left() > 0 { room.wake_after_scene(i) } else { room.changed(i) }
        });
    }

    fn changed(&self, i: &mut Inner) {
        i.version += 1;
        i.last_active = now_ms();
        self.watch_waits(i);
        self.save_rest(i);
        self.schedule_bot(i);
        self.watch_away(i);
        self.changes.send_replace(i.version);
    }

    // ---- lobby ----

    /// The seat's token and number.
    pub fn join(&self, name: &str, via: Option<&'static str>) -> Res<(String, usize, String)> {
        let i = &mut *lock(&self.inner);
        let p = self.join_as(i, name, Kind::Player, via, false)?;
        Ok((i.seats[p].token.clone(), p, i.seats[p].name.clone()))
    }
    fn join_as(&self, i: &mut Inner, name: &str, kind: Kind, via: Option<&'static str>, strong: bool) -> Res<usize> {
        let now = now_ms();
        if i.game.is_some() {
            let typed = tidy_name(name).to_lowercase();
            let own = i.seats.iter().position(|s| s.kind == Kind::Player && s.name.to_lowercase() == typed);
            if let Some(p) = own.filter(|_| kind == Kind::Player) {
                let s = &i.seats[p];
                if !s.vacant(now, self.opts.away_ms) {
                    return no(format!("{} is playing on another phone.", s.name));
                }
                let was = (s.stand_in, s.left);
                self.change(i, |i| {
                    i.new_hands(p);
                    let s = &mut i.seats[p];
                    (s.stand_in, s.left, s.opened, s.seen, s.via) = (false, false, false, now, via);
                })?;
                let by = i.sender(p);
                i.log.write("handover", &by, json!({"seat": p, "back": true, "standIn": was.0, "left": was.1}));
                self.changed(i);
                return Ok(p);
            }
            let clean = i.clean_name(name)?;
            let Some(p) = i.seats.iter().position(|s| s.kind == Kind::Open).or_else(|| self.open_seat(i).filter(|_| kind == Kind::Player)) else {
                return no("The game has started and every seat is taken.");
            };
            let was = i.seats[p].name.clone();
            self.change(i, |i| {
                i.new_hands(p);
                let s = &mut i.seats[p];
                (s.name, s.kind, s.via, s.strong) = (clean, kind, via, strong);
                (s.opened, s.seen) = (false, now);
            })?;
            let by = i.sender(p);
            i.log.write("handover", &by, json!({"seat": p, "was": was}));
            self.changed(i);
            return Ok(p);
        }
        let clean = i.clean_name(name)?;
        if i.seats.len() >= MAX_PLAYERS {
            return no(format!("The game is full ({MAX_PLAYERS} players)."));
        }
        let seat = i.new_seat(clean, kind);
        self.change(i, |i| i.seats.push(Seat { seen: now, via, strong, ..seat }))?;
        let p = i.seats.len() - 1;
        let by = i.sender(p);
        i.log.write(if kind == Kind::Bot { "bot" } else { "join" }, &by, json!({"seat": p}));
        self.changed(i);
        Ok(p)
    }
    pub fn add_bot(&self, tok: &str, strong: bool) -> Res {
        let i = &mut *lock(&self.inner);
        i.seat_of(tok);
        if !self.can_start(i, tok) {
            return no(format!("Only {} can add bots.", self.who_starts(i)));
        }
        let free = ["Tick", "Gizmo", "Widget", "Pinion", "Cog", "Ratchet", "Bolt"].into_iter().find(|n| !i.seats.iter().any(|s| s.kind != Kind::Open && s.name.eq_ignore_ascii_case(n)));
        let name = free.map_or_else(|| format!("Cog {}", i.seats.len() + 1), |n| n.into());
        // On a public website a strong bot's thinking would hold up every other game.
        self.join_as(i, &name, Kind::Bot, None, strong && self.home)?;
        Ok(())
    }
    /// A player leaves the lobby; the TV or whoever can start can remove anyone, by
    /// the seat's id: its number may be someone else's by now.
    pub fn leave(&self, tok: &str, id: Option<u64>) -> Res {
        let i = &mut *lock(&self.inner);
        let own = i.seat_of(tok);
        let p = id.map_or(own, |id| i.seats.iter().position(|s| s.uid == id));
        if p != own && !self.can_start(i, tok) {
            return no("You can only remove yourself.");
        }
        let by = self.sender_of(i, tok);
        self.leave_seat(i, p, by)
    }
    fn leave_seat(&self, i: &mut Inner, p: Option<usize>, by: Sender) -> Res {
        let Some(p) = p.filter(|p| i.seats.get(*p).is_some_and(|s| s.kind != Kind::Open)) else { return no("No such player.") };
        let seating = i.seating();
        if i.game.is_some() && !seating {
            return no("The game has started.");
        }
        let name = i.seats[p].name.clone();
        self.change(i, |i| {
            if seating {
                i.seats[p] = i.new_seat(format!("P{}", p + 1), Kind::Open);
            } else {
                i.seats.remove(p);
            }
        })?;
        i.log.write("leave", &by, json!({"seat": p, "name": name}));
        self.changed(i);
        Ok(())
    }
    /// Mid-game, a bot plays the seat from now on.
    pub fn quit(&self, tok: &str) -> Res {
        let i = &mut *lock(&self.inner);
        let p = self.player_seat(i, tok)?;
        let by = i.sender(p);
        if i.game.is_none() || i.seating() {
            return self.leave_seat(i, Some(p), by);
        }
        if i.phase() == Some(Phase::Over) {
            return no("The game is over.");
        }
        let name = i.seats[p].name.clone();
        self.change(i, |i| {
            i.new_hands(p);
            let s = &mut i.seats[p];
            (s.stand_in, s.left, s.opened) = (true, true, false);
        })?;
        i.log.write("quit", &by, json!({"seat": p}));
        i.log.write("standIn", &Sender::GAME, json!({"seat": p, "name": name, "why": "quit"}));
        self.changed(i);
        Ok(())
    }
    /// The seat someone with a name of their own takes mid-game: one the first
    /// player opened, then one the game waits on, then whoever is gone longest.
    /// A seat a bot plays is kept for its player.
    fn open_seat(&self, i: &Inner) -> Option<usize> {
        let now = now_ms();
        if i.saved_at.is_some() || i.phase() == Some(Phase::Over) {
            return None;
        }
        let open = (0..i.seats.len()).filter(|p| i.seats[*p].vacant(now, self.opts.away_ms) && !i.seats[*p].stand_in);
        open.min_by_key(|p| (!i.seats[*p].opened, !i.waits_on(*p), i.seats[*p].seen))
    }
    fn waited_long(&self, i: &Inner, p: usize) -> bool {
        i.waits_on(p) && i.waited.get(&i.seats[p].uid).is_some_and(|at| now_ms() - at >= self.opts.open_ms)
    }
    /// Who decides about seat p: the first player who is here, as in the lobby,
    /// never p itself. If that player's phone is here with no one at it, a seat
    /// whose phone is gone would hold the game up forever: after as long as it
    /// takes to open a seat, anyone decides about it.
    fn deciders(&self, i: &Inner, p: usize) -> Vec<usize> {
        let now = now_ms();
        let able = |q: &usize| {
            let s = &i.seats[*q];
            *q != p && s.kind == Kind::Player && !s.left && !s.stand_in && !s.opened
        };
        let players = (0..i.seats.len()).filter(able);
        if !i.seats[p].here(now, self.opts.away_ms) && self.waited_long(i, p) {
            return players.collect();
        }
        players.min_by_key(|q| (i.seats[*q].via == Some("claude"), !i.seats[*q].here(now, self.opts.away_ms))).into_iter().collect()
    }
    fn decides(&self, i: &mut Inner, tok: &str, seat: Option<usize>) -> Res<usize> {
        let me = self.player_seat(i, tok)?;
        if i.game.is_none() || i.seating() || i.phase() == Some(Phase::Over) {
            return no("The game is not running.");
        }
        let Some(p) = seat.filter(|p| i.seats.get(*p).is_some_and(|s| s.kind == Kind::Player)) else { return no("No such player.") };
        let who = self.deciders(i, p);
        if !who.contains(&me) {
            return no(who.first().map_or("No one can decide that.".into(), |q| format!("Only {} can do that.", i.seats[*q].name)));
        }
        Ok(p)
    }
    /// The first player opens the seat of someone whose phone is here, once the
    /// game has waited on them long enough.
    pub fn open(&self, tok: &str, seat: Option<usize>) -> Res {
        let i = &mut *lock(&self.inner);
        let p = self.decides(i, tok, seat)?;
        let s = &i.seats[p];
        if s.vacant(now_ms(), self.opts.away_ms) {
            return Ok(());
        }
        if !self.waited_long(i, p) {
            return no(format!("{} is playing.", s.name));
        }
        let fields = json!({"seat": p, "name": s.name});
        let by = self.sender_of(i, tok);
        self.change(i, |i| i.seats[p].opened = true)?;
        i.log.write("open", &by, fields);
        self.changed(i);
        Ok(())
    }
    /// The player of an opened seat is at their phone after all.
    pub fn return_to(&self, tok: &str) -> Res {
        let i = &mut *lock(&self.inner);
        let p = self.player_seat(i, tok)?;
        self.take_back(i, p);
        Ok(())
    }
    /// The first player lets a bot play an open seat.
    pub fn stand_in_for(&self, tok: &str, seat: Option<usize>) -> Res {
        let i = &mut *lock(&self.inner);
        let p = self.decides(i, tok, seat)?;
        let s = &i.seats[p];
        if s.stand_in {
            return Ok(());
        }
        if !s.vacant(now_ms(), self.opts.away_ms) {
            return no(format!("{} is back.", s.name));
        }
        let fields = json!({"seat": p, "name": s.name, "why": if s.opened { "opened" } else { "away" }, "seen": Some(s.seen).filter(|n| *n != 0)});
        let by = self.sender_of(i, tok);
        self.change(i, |i| i.seats[p].stand_in = true)?;
        i.log.write("standIn", &by, fields);
        self.changed(i);
        Ok(())
    }

    // ---- saving ----

    pub fn save(&self, tok: &str) -> Res {
        let i = &mut *lock(&self.inner);
        self.at_table(i, tok)?;
        let Some(g) = i.game.as_ref().filter(|_| !i.seating()) else { return no("The game isn't under way.") };
        if g.phase == Phase::Over {
            return no("The game is over.");
        }
        if i.saved_at.is_some() {
            return Ok(());
        }
        let fields = json!({"round": g.round, "phase": g.phase, "entries": g.log.len()});
        let by = self.sender_of(i, tok);
        self.change(i, |i| i.saved_at = Some(now_ms()))?;
        i.log.write("save", &by, fields);
        self.changed(i);
        Ok(())
    }
    /// True if it was saved.
    pub fn resume(&self, tok: &str) -> Res<bool> {
        let i = &mut *lock(&self.inner);
        self.at_table(i, tok)?;
        let Some(at) = i.saved_at else { return Ok(false) };
        let by = self.sender_of(i, tok);
        self.change(i, |i| i.saved_at = None)?;
        i.log.write("continue", &by, json!({"savedAt": recap::iso(at)}));
        self.changed(i);
        Ok(true)
    }
    fn at_table(&self, i: &mut Inner, tok: &str) -> Res {
        let p = i.seat_of(tok);
        if tok != self.host && p.is_none_or(|p| i.seats[p].kind != Kind::Player) {
            return no("You are not in this game.");
        }
        Ok(())
    }
    fn can_start(&self, i: &Inner, tok: &str) -> bool {
        tok == self.host || self.starter(i).is_some_and(|p| i.seats[p].token == tok)
    }
    /// Who starts the game from their seat: the first player who is here. A
    /// Claude player has no way to, so it's only ever one if no one else could be.
    fn starter(&self, i: &Inner) -> Option<usize> {
        let now = now_ms();
        let players = (0..i.seats.len()).filter(|p| i.seats[*p].kind == Kind::Player);
        players.min_by_key(|p| {
            let s = &i.seats[*p];
            (s.via == Some("claude"), !s.here(now, self.opts.away_ms))
        })
    }
    fn who_starts(&self, i: &Inner) -> String {
        let name = self.starter(i).map_or("the first to join", |p| i.seats[p].name.as_str());
        if i.has_tv { format!("the TV or {name}") } else { name.into() }
    }
    pub fn start(&self, tok: &str) -> Res {
        self.start_seeded(tok, now_ms())
    }
    pub fn start_seeded(&self, tok: &str, seed: i64) -> Res {
        let i = &mut *lock(&self.inner);
        i.seat_of(tok);
        if !self.can_start(i, tok) {
            return no(format!("Only {} can start the game.", self.who_starts(i)));
        }
        if i.game.is_some() || self.file.exists() {
            return no("The game has already started.");
        }
        if i.seats.len() < MIN_PLAYERS {
            return no(format!("The game needs at least {MIN_PLAYERS} players."));
        }
        let g = Box::new(Game::new(i.seats.len(), seed, self.opts.first_seat));
        store::save(&self.file, &*g).map_err(|e| Fail::Server(format!("Room {}: could not save the game: {e}", self.code)))?;
        let seats: Vec<Value> = (0..i.seats.len()).map(|p| json!({"name": i.seats[p].name, "kind": i.sender(p).kind})).collect();
        let by = self.sender_of(i, tok);
        i.log.write("start", &by, json!({"code": self.code, "seed": seed, "seats": seats}));
        i.log.events(&g.log, 0, &Sender::GAME, None);
        let ms = scenes::ms(&g.log);
        i.game = Some(g);
        i.game_rev += 1;
        if !i.has_tv {
            self.hold_for(i, ms);
        }
        self.changed(i);
        Ok(())
    }

    fn sender_of(&self, i: &Inner, tok: &str) -> Sender {
        if tok == self.host {
            return Sender::TV;
        }
        i.seats.iter().position(|s| s.token == tok).map_or(Sender::GAME, |p| i.sender(p))
    }

    // ---- play ----

    /// A player's command. `id`, when the client gives one, names this one
    /// sending of it: the same id again is the same tap retried.
    pub fn command(&self, tok: &str, cmd: &Value, via: Option<&'static str>, id: &str) -> Res {
        let i = &mut *lock(&self.inner);
        let p = self.player_seat(i, tok)?;
        if via.is_some() {
            i.seats[p].via = via;
        }
        self.take_back(i, p);
        let uid = i.seats[p].uid;
        if let Some(at) = i.waited.get_mut(&uid) {
            *at = now_ms(); // whatever it says, someone is there
        }
        let key = (!id.is_empty()).then(|| format!("{p} {id}"));
        if key.as_ref().is_some_and(|k| i.done_ids.contains(k)) {
            return Ok(());
        }
        self.act(i, p, cmd)?;
        if let Some(k) = key {
            i.done_ids.push_back(k);
            if i.done_ids.len() > 500 {
                i.done_ids.pop_front();
            }
        }
        Ok(())
    }
    fn act(&self, i: &mut Inner, p: usize, cmd: &Value) -> Res {
        if i.game.is_none() {
            return no("The game hasn't started.");
        }
        if i.seating() {
            return no("The game goes on once every seat is taken.");
        }
        if i.saved_at.is_some() {
            return no("The game is saved: continue it first.");
        }
        let by = i.sender(p);
        let done = match Command::read(cmd) {
            Ok(c) => self.mutate(i, by.clone(), |g, _| g.apply(p, &c).map(|_| c)),
            // A page left open from when commands were text.
            Err(_) if cmd.is_string() && i.seats[p].via == Some("phone") => no("This page is out of date: reload it."),
            Err(why) => Err(Fail::Room(why)),
        };
        if let Err(Fail::Room(why)) = &done {
            i.log.write("refused", &by, json!({"command": cmd, "error": why}));
        }
        done
    }
    fn player_seat(&self, i: &mut Inner, tok: &str) -> Res<usize> {
        let p = i.player_of(tok)?;
        i.seats[p].seen = now_ms();
        self.back(i, p);
        Ok(p)
    }
    // A player a bot was playing for while they were away is back.
    fn back(&self, i: &mut Inner, p: usize) {
        // (A phone still here with no one at it answers pings: that's no one back.)
        if i.seats[p].stand_in && !i.seats[p].opened {
            self.take_back(i, p);
        }
    }
    fn take_back(&self, i: &mut Inner, p: usize) {
        let s = &mut i.seats[p];
        if s.left || !(s.stand_in || s.opened) {
            return;
        }
        (s.stand_in, s.opened) = (false, false);
        let uid = s.uid;
        i.waited.remove(&uid);
        let by = i.sender(p);
        i.log.write("back", &by, json!({"seat": p}));
        self.changed(i);
    }
    // All a wait knows of its seat between wakes is its token: the number holds
    // only inside `look`, with the room locked.
    fn seated<T>(&self, tok: &str, look: impl FnOnce(&mut Inner, usize) -> T) -> Res<T> {
        let i = &mut *lock(&self.inner);
        let p = i.player_of(tok)?;
        Ok(look(i, p))
    }
    fn holding(&self, i: &mut Inner, p: usize) -> Here {
        i.seats[p].connected += 1;
        Here { room: self.me.upgrade().expect("a room in use"), who: Who::Seat { uid: i.seats[p].uid, stream: false, answers: false } }
    }

    /// What a client that holds no stream open asks for: the snapshot a phone gets.
    pub fn state(&self, tok: &str) -> Res<Vec<Bytes>> {
        let i = &mut *lock(&self.inner);
        if !tok.is_empty() && tok != self.host {
            self.player_seat(i, tok)?;
        }
        Ok(self.snapshot_of(i, Some(tok).filter(|t| !t.is_empty())))
    }
    /// Waits for this seat's decision, or the game's end (0), or until time runs out (2).
    pub async fn wait(&self, tok: &str, secs: f64) -> Res<(u8, Vec<Bytes>)> {
        let end = tokio::time::Instant::now() + Duration::from_secs_f64(secs);
        let (here, mut rx) = {
            let i = &mut *lock(&self.inner);
            let p = self.player_seat(i, tok)?;
            (self.holding(i, p), self.changes.subscribe())
        };
        let code = loop {
            if self.seated(tok, |i, p| i.phase() == Some(Phase::Over) || i.waits_on(p))? {
                break 0;
            }
            tokio::select! {
                _ = rx.changed() => {}
                _ = tokio::time::sleep_until(end) => break 2,
            }
        };
        drop(here);
        self.seated(tok, |i, _| (code, self.snapshot_of(i, Some(tok))))
    }
    /// Every event this seat can see from `since` on, the index to ask from
    /// next, and what `then` makes of them. With a time, waits first until it's
    /// this seat's decision, someone else talks or the game ends.
    pub async fn listen<T>(&self, tok: &str, since: usize, secs: f64, then: impl FnOnce(&Room, &mut Heard) -> T) -> Res<T> {
        let end = tokio::time::Instant::now() + Duration::from_secs_f64(secs);
        let (here, mut rx) = {
            let i = &mut *lock(&self.inner);
            let p = self.player_seat(i, tok)?;
            let here = (secs > 0.0 && !ready(i, p, since)).then(|| self.holding(i, p));
            (here, self.changes.subscribe())
        };
        while here.is_some() {
            tokio::select! {
                _ = rx.changed() => {}
                _ = tokio::time::sleep_until(end) => break,
            }
            if self.seated(tok, |i, p| ready(i, p, since))? {
                break;
            }
        }
        drop(here);
        self.seated(tok, |i, p| {
            i.seats[p].seen = now_ms();
            then(self, &mut Heard { i, p, since, tok })
        })
    }
    /// For a Claude player: what it has been shown so far, if anything.
    pub fn shown(&self, tok: &str) -> Option<usize> {
        lock(&self.inner).seen.get(tok).copied()
    }
    pub fn log_len(&self) -> usize {
        lock(&self.inner).game.as_ref().map_or(0, |g| g.log.len())
    }

    // ---- timers ----

    // Since when the game waits on whom, and the table hears when that's long enough to open a seat.
    fn watch_waits(&self, i: &mut Inner) {
        clear(&mut i.open_timer);
        let now = now_ms();
        let on: Vec<u64> = (0..i.seats.len()).filter(|p| i.waits_on(*p) && !bot_plays(i, *p)).map(|p| i.seats[p].uid).collect();
        i.waited.retain(|uid, _| on.contains(uid));
        for uid in on {
            i.waited.entry(uid).or_insert(now);
        }
        if let Some(at) = i.waited.values().map(|at| at + self.opts.open_ms).filter(|at| *at > now).min() {
            i.open_timer = self.after(at - now + 10, |room, i| {
                i.open_timer = None;
                room.changed(i);
            });
        }
    }

    fn watch_away(&self, i: &mut Inner) {
        clear(&mut i.away_timer);
        let now = now_ms();
        let due: Vec<(u64, i64)> = i.seats.iter().filter(|s| s.kind == Kind::Player && !s.left && !s.held() && s.here(now, self.opts.away_ms)).map(|s| (s.uid, s.seen + self.opts.away_ms)).collect();
        let ends = due.iter().map(|d| d.1).min();
        // (The screenshots mark everyone here for good: no timer for that.)
        if let Some(at) = ends.filter(|at| at - now < i32::MAX as i64) {
            i.away_timer = self.after(at - now + 10, move |room, i| {
                i.away_timer = None;
                // Heard from since then, they're still here, and nothing has changed.
                let now = now_ms();
                let gone = i.seats.iter().any(|s| due.iter().any(|d| d.0 == s.uid) && !s.here(now, room.opts.away_ms));
                if gone { room.changed(i) } else { room.watch_away(i) }
            });
        }
    }
    fn schedule_bot(&self, i: &mut Inner) {
        let Some(g) = &i.game else { return };
        if i.bot_timer.is_some() || g.phase == Phase::Over || i.abandoned() || i.seating() || i.saved_at.is_some() {
            return;
        }
        if i.scene_left() > 0 {
            if i.scene_timer.is_none() {
                self.wake_after_scene(i);
            }
            return;
        }
        if !g.waiting_on().into_iter().any(|p| bot_plays(i, p)) {
            return;
        }
        i.bot_timer = self.after(self.opts.bot_delay_ms, |room, i| {
            i.bot_timer = None;
            if i.abandoned() || i.saved_at.is_some() {
                return;
            }
            if i.scene_left() > 0 {
                return room.schedule_bot(i);
            }
            // The first bot waited on that moves: a strong bot waiting on answers to its
            // own offer passes, and is woken again in a few seconds.
            let waiting: Vec<usize> = i.game.as_ref().map_or(vec![], |g| g.waiting_on().into_iter().filter(|p| bot_plays(i, *p)).collect());
            for p in waiting {
                let (bot, strong, name) = (i.seats[p].kind == Kind::Bot, i.seats[p].strong, i.seats[p].name.clone());
                let by = Sender { kind: if bot { "bot" } else { "standIn" }, seat: Some(p), name: Some(name.clone()) };
                let mut seen = std::mem::take(&mut i.offers_seen);
                let player = strongbot::Bot { p, name: Some(&name), now: now_ms(), tune: &Tune::default() };
                if bot && strong && i.game.as_ref().is_some_and(|g| strongbot::strong_waits(g, &player, &mut seen)) {
                    i.offers_seen = seen;
                    continue;
                }
                let before = seen.clone();
                let done = room.mutate(i, by, |g, rng| {
                    let cmd = match (bot, strong) {
                        (true, true) => strongbot::strong_move(g, &player, rng, &mut seen)?,
                        (true, false) => bot::bot_move(g, p, rng),
                        _ => bot::stand_in_move(g, p),
                    };
                    cmd.ok_or_else(|| "no legal move".into())
                });
                i.offers_seen = seen;
                match done {
                    Err(Fail::Server(e)) => {
                        eprintln!("{e}");
                        i.offers_seen = before;
                        room.bots_later(i); // until it can be saved
                    }
                    Err(Fail::Room(e)) => eprintln!("Room {}: a bot is stuck: {e}", room.code),
                    _ => {}
                }
                return;
            }
            room.bots_later(i);
        });
    }
    fn bots_later(&self, i: &mut Inner) {
        i.bot_timer = self.after(3000, |room, i| {
            i.bot_timer = None;
            room.schedule_bot(i);
        });
    }

    // ---- what clients see ----

    fn lobby_of(&self, i: &Inner) -> Lobby {
        let now = now_ms();
        Lobby {
            code: self.code.clone(),
            started: i.game.is_some(),
            seating: i.seating(),
            saved: i.saved_at,
            seats: i
                .seats
                .iter()
                .enumerate()
                .map(|(p, s)| {
                    // Only while there's something to decide: the game waits on a seat that's open, or could be.
                    let due = i.phase() != Some(Phase::Over) && i.waits_on(p) && !s.stand_in && s.kind == Kind::Player && (s.vacant(now, self.opts.away_ms) || self.waited_long(i, p));
                    let deciders = if due { self.deciders(i, p) } else { vec![] };
                    LobbySeat { id: s.uid, name: s.name.clone(), kind: s.kind.name().into(), connected: s.here(now, self.opts.away_ms), stand_in: s.stand_in, left: s.left, opened: s.opened, deciders, strong: s.strong }
                })
                .collect(),
            min_players: MIN_PLAYERS,
            max_players: MAX_PLAYERS,
            starter: self.starter(i),
            file: if self.home { self.file.display().to_string() } else { String::new() }, // a public website doesn't say where its files are
            remote: !i.has_tv,
        }
    }
    /// Does the room exist, is this token seated in it, and who's in it.
    pub fn about(&self, tok: &str) -> Value {
        let i = &mut *lock(&self.inner);
        let seated = i.seat_of(tok).is_some();
        json!({"seated": seated, "host": tok == self.host, "lobby": self.lobby_of(i)})
    }
    pub fn snapshot(&self, tok: Option<&str>) -> Vec<Bytes> {
        self.snapshot_of(&mut lock(&self.inner), tok)
    }
    /// The snapshot's JSON, in pieces: the game's are shared by everyone who gets them.
    fn snapshot_of(&self, i: &mut Inner, tok: Option<&str>) -> Vec<Bytes> {
        // (Not seat_of: being sent a snapshot is no sign that anyone is there.)
        let p = tok.and_then(|t| i.seats.iter().position(|s| s.token == t));
        let lobby = json!(self.lobby_of(i));
        let seat = p.map_or(-1, |p| p as i64);
        let mut out = vec![Bytes::from(format!(r#"{{"lobby":{lobby},"seat":{seat},"game":"#))];
        out.push(match &i.game {
            None => Bytes::from_static(b"null"),
            Some(g) => i.public.get_or_insert_with(|| json_bytes(&state::public_state(g))).clone(),
        });
        let recap = (i.recapped && i.phase() == Some(Phase::Over)).then_some(&self.recap_id);
        let head = format!(r#","scene":{},"v":{},"recap":{},"you":"#, i.scene_left(), i.version, json!(recap));
        match (&i.game, p.filter(|p| i.seats[*p].kind == Kind::Player)) {
            (Some(g), Some(p)) => {
                let you = json_bytes(&state::seat_state(g, p));
                out.push(Bytes::from(format!(r#"{head}{{"name":{},"#, json!(i.seats[p].name))));
                out.push(you.slice(1..));
                out.push(Bytes::from_static(b"}"));
            }
            _ => out.push(Bytes::from(format!("{head}null}}"))),
        }
        out
    }
    pub fn watch(&self) -> watch::Receiver<u64> {
        self.changes.subscribe()
    }
    /// A page answers its stream's ping: its player is here.
    pub fn answer(&self, tok: &str) -> Res {
        let i = &mut *lock(&self.inner);
        let was: Vec<bool> = i.seats.iter().map(|s| s.here(now_ms(), self.opts.away_ms)).collect();
        let p = self.player_seat(i, tok)?;
        if !was[p] {
            self.changed(i);
        }
        Ok(())
    }
    /// A stream with no seat is a screen; `tv` says it's a TV page, `answers` that a seat's page answers pings.
    pub fn connect(&self, tok: Option<&str>, tv: bool, answers: bool) -> Here {
        let room = self.me.upgrade().expect("a room in use");
        let i = &mut *lock(&self.inner);
        let Some(tok) = tok else {
            i.screens += 1;
            if tv {
                i.tvs += 1;
                clear(&mut i.tv_timer);
                if !i.has_tv {
                    i.has_tv = true;
                    self.changed(i);
                }
                self.schedule_bot(i); // after a restart, a game of only bots has no one else to wake it
            }
            i.log.write("connect", if tv { &Sender::TV } else { &Sender::GAME }, json!({"what": if tv { "tv" } else { "screen" }}));
            return Here { room, who: Who::Screen { tv } };
        };
        let Some(p) = i.seats.iter().position(|s| s.token == tok) else { return Here { room, who: Who::Nobody } };
        let s = &mut i.seats[p];
        if s.kind == Kind::Player {
            s.via = Some("phone");
        }
        s.connected += 1;
        s.answering += answers as usize;
        s.seen = s.seen.max(now_ms());
        let (uid, streams) = (s.uid, s.connected);
        let by = i.sender(p);
        i.log.write("connect", &by, json!({"seat": p, "streams": streams}));
        self.back(i, p);
        self.changed(i);
        Here { room, who: Who::Seat { uid, stream: true, answers } }
    }
    pub fn tv_watching(&self) -> bool {
        lock(&self.inner).tvs > 0
    }
    fn tv_gone(&self, i: &mut Inner) {
        clear(&mut i.tv_timer);
        i.tv_timer = self.after(self.opts.tv_gone_ms, |room, i| {
            i.tv_timer = None;
            if i.tvs == 0 && i.has_tv {
                i.has_tv = false;
                room.changed(i);
            }
        });
    }

    // ---- housekeeping ----

    /// Let go of what can be made again once the room is quiet.
    pub fn rest(&self) {
        let i = &mut *lock(&self.inner);
        if now_ms() - i.last_active > CACHE_MS {
            i.public = None;
        }
    }
    /// Whether the server forgets the room now, and if so whether its files go too.
    pub fn forget(&self) -> Option<bool> {
        const HOUR: i64 = 60 * 60 * 1000;
        let i = &*lock(&self.inner);
        let idle = now_ms() - i.last_active;
        if let Some(at) = i.saved_at {
            if self.home {
                return None;
            }
            let keep = crate::limits::SAVED_KEEP.as_millis() as i64;
            return (now_ms() - at > keep && idle > 6 * HOUR).then_some(true);
        }
        let empty = !self.home && i.game.is_none() && idle > HOUR && self.changes.receiver_count() == 0;
        (idle > 6 * HOUR || empty || (i.abandoned() && idle > 10 * 60 * 1000)).then_some(false)
    }
    pub fn close(&self) {
        let i = &mut *lock(&self.inner);
        i.closed = true;
        for t in [&mut i.bot_timer, &mut i.away_timer, &mut i.open_timer, &mut i.scene_timer, &mut i.tv_timer] {
            clear(t);
        }
    }
}

fn bot_plays(i: &Inner, p: usize) -> bool {
    i.seats.get(p).is_some_and(|s| s.kind == Kind::Bot || s.stand_in)
}
fn json_bytes(v: &impl Serialize) -> Bytes {
    let mut b = serde_json::to_vec(v).expect("a state is JSON");
    b.shrink_to_fit();
    b.into()
}
fn ready(i: &Inner, p: usize, since: usize) -> bool {
    let Some(g) = &i.game else { return false };
    if g.phase == Phase::Over {
        return true;
    }
    let me = format!("P{} ", p + 1);
    let mut others = g.log.iter().skip(since).filter(|e| e.seen_by(p) && !e.text.starts_with(&me)).peekable();
    let any = others.peek().is_some();
    if others.any(|e| state::is_talk(&e.text)) {
        return true;
    }
    let awaiting = g.phase == Phase::Action && g.turn == p && g.offers.iter().any(|o| o.from == p) && !any;
    i.waits_on(p) && !awaiting
}

/// What a listen heard.
pub struct Heard<'a> {
    i: &'a mut Inner,
    p: usize,
    since: usize,
    tok: &'a str,
}
impl Heard<'_> {
    pub fn events(&self) -> Vec<state::EventView<'_>> {
        self.i.game.as_ref().map_or(vec![], |g| state::visible_events(g, self.p, self.since))
    }
    pub fn next(&self) -> usize {
        self.i.game.as_ref().map_or(0, |g| g.log.len())
    }
    pub fn mark_shown(&mut self) {
        let n = self.next();
        self.i.seen.insert(self.tok.to_string(), n);
    }
    pub fn snapshot(&mut self, room: &Room) -> Vec<Bytes> {
        room.snapshot_of(self.i, Some(self.tok))
    }
    /// The seat's snapshot as the text views take it, and its picture's bytes if `then` makes one.
    pub fn show<T>(&self, room: &Room, then: impl FnOnce(&Shown) -> T) -> T {
        let lobby = room.lobby_of(self.i);
        let game = self.i.game.as_ref().map(|g| state::public_state(g));
        let you = self.i.game.as_ref().filter(|_| self.i.seats[self.p].kind == Kind::Player).map(|g| state::seat_state(g, self.p));
        let shown = Shown { lobby: &lobby, game: game.as_ref(), you: you.as_ref().map(|y| (y, self.i.seats[self.p].name.as_str())) };
        then(&shown)
    }
}

/// Makes the tables now rather than in the first game.
pub fn warm() {
    let _ = DATA.tuning.points_to_win;
}

// ---- for the tests, the screenshots and the playtest runner (src/bin/stage.rs) ----

#[cfg(feature = "stage")]
pub mod stage {
    use super::*;

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SeatNow {
        uid: u64,
        name: String,
        token: String,
        kind: Kind,
        #[serde(skip_serializing_if = "Option::is_none")]
        connected: Option<usize>,
        seen: i64,
        stand_in: bool,
        left: bool,
        #[serde(default)]
        opened: bool,
        strong: bool,
        via: Option<String>,
    }
    fn via(v: Option<String>) -> Option<&'static str> {
        ["phone", "cli", "claude"].into_iter().find(|x| v.as_deref() == Some(*x))
    }
    impl Room {
        /// What a driver keeps of the room, past the log it has and the game it's seen.
        pub fn stage_state(&self, seen: i64, logged: usize) -> Value {
            let i = &*lock(&self.inner);
            let seats: Vec<SeatNow> = i.seats.iter().map(|s| SeatNow { uid: s.uid, name: s.name.clone(), token: s.token.clone(), kind: s.kind, connected: Some(s.connected), seen: s.seen, stand_in: s.stand_in, left: s.left, opened: s.opened, strong: s.strong, via: s.via.map(|v| v.into()) }).collect();
            let mut v = json!({"seats": seats, "savedAt": i.saved_at, "version": i.version, "lastActive": i.last_active, "abandoned": i.abandoned(), "sceneLeft": i.scene_left(), "gameRev": i.game_rev});
            if let Some(g) = i.game.as_ref().filter(|_| seen != i.game_rev as i64) {
                v["game"] = json!(g.clone_without_log());
                v["log"] = json!(&g.log[logged.min(g.log.len())..]);
                v["logFrom"] = logged.min(g.log.len()).into();
            }
            v
        }
        /// Seats, and when it was saved, as the driver has changed them.
        pub fn stage_seats(&self, seats: Vec<SeatNow>, saved_at: Option<i64>) {
            let i = &mut *lock(&self.inner);
            let mut old: Vec<Seat> = std::mem::take(&mut i.seats);
            for s in seats {
                let (connected, answering) = old.iter().find(|o| o.uid == s.uid).map_or((0, 0), |o| (o.connected, o.answering));
                let connected = s.connected.unwrap_or(connected);
                i.seats.push(Seat { uid: s.uid, name: s.name, token: s.token, kind: s.kind, connected, answering: answering.min(connected), seen: s.seen, stand_in: s.stand_in, left: s.left, opened: s.opened, strong: s.strong, via: via(s.via) });
            }
            old.clear();
            i.saved_at = saved_at;
        }
        /// The game as the driver has changed it: what it is without its log, and the entries added.
        pub fn stage_game(&self, g: Value, added: Value) -> Result<(), String> {
            let i = &mut *lock(&self.inner);
            let mut g: Game = serde_json::from_str(&g.to_string()).map_err(|e| e.to_string())?;
            g.log = std::mem::take(&mut i.game.as_mut().ok_or("no game")?.log);
            let more: Vec<crate::engine::LogEntry> = serde_json::from_str(&added.to_string()).map_err(|e| e.to_string())?;
            g.log.extend(more);
            i.game = Some(Box::new(g));
            i.game_rev += 1;
            i.public = None;
            Ok(())
        }
        /// After such a change, as if the room had made it: log entries from `before` on are news.
        pub fn stage_mutated(&self, before: usize) -> Res {
            let i = &mut *lock(&self.inner);
            let Some(g) = i.game.as_ref() else { return no("The game hasn't started.") };
            i.log.events(&g.log, before, &Sender::GAME, None);
            let saved = store::save(&self.file, &**g);
            let ms = scenes::ms(&g.log[before.min(g.log.len())..]);
            self.hold_for(i, ms);
            self.changed(i);
            saved.map_err(|e| Fail::Server(e.to_string()))
        }
        pub fn stage_changed(&self) {
            self.changed(&mut lock(&self.inner));
        }
        pub fn stage_join(&self, name: &str, bot: bool, v: Option<String>) -> Res<usize> {
            self.join_as(&mut lock(&self.inner), name, if bot { Kind::Bot } else { Kind::Player }, via(v), false)
        }
        pub fn stage_leave(&self, seat: usize) -> Res {
            self.leave_seat(&mut lock(&self.inner), Some(seat), Sender::GAME)
        }
        pub fn stage_can_start(&self, tok: &str) -> bool {
            self.can_start(&lock(&self.inner), tok)
        }
    }
}
