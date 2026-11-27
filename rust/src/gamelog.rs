//! The game log, for development, as src/server/gamelog.ts writes it.
use crate::engine::LogEntry;
use crate::recap::iso;
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::fmt::Write as _;
use std::io::Write as _;
use std::path::PathBuf;

/// Who sent something; the seat and its name, when it's a seat's.
#[derive(Clone, Serialize)]
pub struct Sender {
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seat: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}
impl Sender {
    pub const GAME: Sender = Sender { kind: "game", seat: None, name: None };
    pub const TV: Sender = Sender { kind: "tv", seat: None, name: None };
}

// What the game does on its own, rather than the player whose command it followed.
const AUTO: &[&str] = &[
    "round", "produce", "rest", "grow", "tend", "draw", "pick", "turn", "wander", "expire", "title", "raid", "votes", "target", "locked", "fight", "combat", "raidEnd", "noRaid", "again", "begin", "final",
];

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

pub struct GameLog {
    file: PathBuf,
    broken: bool,
}
impl GameLog {
    pub fn new(file: PathBuf) -> GameLog {
        GameLog { file, broken: false }
    }
    fn append(&mut self, text: &str) {
        if self.broken || text.is_empty() {
            return;
        }
        let done = std::fs::OpenOptions::new().append(true).create(true).open(&self.file).and_then(|mut f| f.write_all(text.as_bytes()));
        if let Err(e) = done {
            self.broken = true; // say so once, and never stop a game over it
            eprintln!("Could not write the game log {}: {e}", self.file.display());
        }
    }
    pub fn write(&mut self, kind: &str, by: &Sender, fields: Value) {
        let ms = now_ms();
        let mut line = Map::new();
        line.insert("t".into(), iso(ms).into());
        line.insert("ms".into(), ms.into());
        line.insert("type".into(), kind.into());
        line.insert("by".into(), json!(by));
        if let Value::Object(f) = fields {
            line.extend(f);
        }
        self.append(&format!("{}\n", Value::Object(line)));
    }
    /// The game's log entries from index `from` on, sent by `by` (with the command, when one made them).
    pub fn events(&mut self, entries: &[LogEntry], from: usize, by: &Sender, command: Option<&str>) {
        let ms = now_ms();
        let t = iso(ms);
        let sender = json!(by);
        let mut text = String::new();
        for (i, e) in entries.iter().enumerate().skip(from) {
            let auto = by.kind != "game" && AUTO.contains(&e.kind());
            let who = if auto { json!(Sender::GAME) } else { sender.clone() };
            let _ = write!(text, r#"{{"t":"{t}","ms":{ms},"type":"event","by":{who},"i":{i},"round":{},"text":{}"#, e.round, json!(&*e.text));
            if e.ev.is_some() {
                let _ = write!(text, r#","ev":{}"#, e.raw());
            }
            if let Some(to) = &e.to {
                let _ = write!(text, r#","to":{}"#, json!(to));
            }
            if let Some(dice) = &e.dice {
                let _ = write!(text, r#","dice":{}"#, json!(dice));
            }
            if let Some(c) = command {
                let _ = write!(text, r#","command":{}"#, json!(c));
            }
            if auto {
                let _ = write!(text, r#","cause":{sender}"#);
            }
            text.push_str("}\n");
        }
        self.append(&text);
    }
}
