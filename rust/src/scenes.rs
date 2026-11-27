//! How long the TV's scenes for new events last (web/scenes.ts), which
//! everyone's next decision waits for.
use crate::data::*;
use crate::engine::LogEntry;
use crate::state::Produced;
use serde::Deserialize;

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
/// The length of the scenes in these events, private ones aside.
pub fn ms(entries: &[LogEntry]) -> f64 {
    let events: Vec<&LogEntry> = entries.iter().filter(|e| e.to.is_none()).collect();
    let mut sum = 0.0;
    for (at, e) in events.iter().enumerate() {
        sum += match e.kind() {
            "round" => prod_ms(&events[at + 1..].iter().filter(|x| x.round == e.round).map(|x| prod_rows(x)).filter(|n| *n > 0.0).collect::<Vec<_>>()),
            "tend" => 4800.0,
            "fight" => fight_ms(&events, at, "raidEnd"),
            "hunt" => fight_ms(&events, at, "cleared"),
            "noRaid" if !e.raw().contains("\"why\":\"unable\"") => 4000.0,
            _ => 0.0,
        };
    }
    sum
}
