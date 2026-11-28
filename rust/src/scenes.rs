//! How long the TV's scenes for new events last (web/scenes.ts), which
//! everyone's next decision waits for.
use crate::data::*;
use crate::engine::LogEntry;
use crate::state::Produced;
use serde::{Deserialize, Serialize};

/// A scene, by the entry of the game's log it's for; `kind` as in web/scenes.ts.
#[derive(Clone, Serialize)]
pub struct Scene {
    pub kind: &'static str,
    pub i: usize,
    pub ms: f64,
}

#[derive(Deserialize)]
struct Combat {
    hits: Vec<serde::de::IgnoredAny>,
}
#[derive(Deserialize)]
struct Ended {
    scorer: Option<usize>,
}
fn prod_rows(e: &LogEntry) -> f64 {
    if e.kind() != "produce" {
        return 0.0;
    }
    e.ev::<Produced>().map_or(0.0, |x| {
        let rows = (0..5).filter(|r| x.got.get(*r) > 0).count();
        (rows + (x.eat != 0 && x.got.get(LIVESTOCK) <= 0) as usize) as f64
    })
}
fn prod_ms(rows: &[f64]) -> f64 {
    if rows.is_empty() {
        return 2200.0;
    }
    let all: f64 = rows.iter().sum();
    900.0 + rows.len() as f64 * 1450.0 + all * 900f64.min(10000.0 / all.max(1.0)) + 3500.0
}
fn fight_ms(events: &[&LogEntry], at: usize, last: &str) -> f64 {
    let mut hits = 0;
    let mut scored = false;
    for e in &events[at + 1..] {
        if e.kind() == last {
            scored = last == "raidEnd" && e.ev::<Ended>().is_some_and(|x| x.scorer.is_some());
            break;
        }
        if e.kind() == "combat" {
            hits += e.ev::<Combat>().map_or(0, |c| c.hits.len());
        }
    }
    let n = hits as f64;
    2400.0 + n * 400f64.min(6000.0 / n.max(1.0)) + 400.0 + if scored { 2400.0 + 1100.0 + 3800.0 } else { 4500.0 }
}
/// The kind of scene an entry makes, if any.
pub fn kind(e: &LogEntry) -> Option<&'static str> {
    if e.to.is_some() {
        return None;
    }
    match e.kind() {
        "round" => Some("roll"),
        "tend" => Some("tend"),
        "fight" => Some("fight"),
        "hunt" => Some("hunt"),
        "noRaid" if !e.raw().contains("\"why\":\"unable\"") => Some("noRaid"),
        _ => None,
    }
}
/// The length of the scenes in these events, private ones aside.
pub fn ms(entries: &[LogEntry]) -> f64 {
    of(entries, 0).iter().fold(0.0, |sum, s| sum + s.ms) // (a sum of none is -0)
}
/// The scenes in the entries from index `from` on, in order.
pub fn of(entries: &[LogEntry], from: usize) -> Vec<Scene> {
    let (is, events): (Vec<usize>, Vec<&LogEntry>) = entries.iter().enumerate().skip(from).filter(|(_, e)| e.to.is_none()).unzip();
    let mut out = vec![];
    for (at, e) in events.iter().enumerate() {
        let Some(kind) = kind(e) else { continue };
        let ms = match kind {
            "roll" => prod_ms(&events[at + 1..].iter().filter(|x| x.round == e.round).map(|x| prod_rows(x)).filter(|n| *n > 0.0).collect::<Vec<_>>()),
            "tend" => 4800.0,
            "fight" => fight_ms(&events, at, "raidEnd"),
            "hunt" => fight_ms(&events, at, "cleared"),
            _ => 4000.0,
        };
        out.push(Scene { kind, i: is[at], ms });
    }
    out
}
