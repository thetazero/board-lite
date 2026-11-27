//! A finished game's recap, as src/recap.ts builds it.
use crate::data::*;
use crate::engine::*;
use crate::map::K;
use crate::state::Produced;
use serde::Deserialize;
use serde_json::{Value, json};

// The fields of the events a recap reads, whichever event it is.
#[derive(Deserialize, Default)]
#[serde(default)]
struct Ev {
    p: Option<usize>,
    n: Option<i64>,
    t: Option<String>,
    b: Option<String>,
    u: Option<String>,
    d: Option<Value>,
    ds: Vec<Value>,
    home: Vec<Id>,
    hex: Option<K>,
    from: Option<Value>,
    to: Option<Value>,
    fauna: Option<Key>,
    name: Option<String>,
    card: Option<String>,
    won: Option<bool>,
    stage: Option<Value>,
    floors: Option<i64>,
    points: Option<i64>,
    scorer: Option<usize>,
    winners: Vec<usize>,
}
impl Ev {
    fn dragon(&self) -> Option<Id> {
        id(self.d.as_ref()?)
    }
    fn won(&self) -> bool {
        self.won == Some(true)
    }
}
fn id(v: &Value) -> Option<Id> {
    Id::parse(v.as_str()?)
}
fn hex(v: &Option<Value>) -> Option<K> {
    K::parse(v.as_ref()?.as_str()?)
}

struct Fall {
    round: i64,
    name: String,
    ps: Vec<usize>,
    points: Option<i64>,
    scorer: Option<usize>,
    times: Option<i64>,
}
enum Moment {
    Title(i64, usize, usize),
    Beast(i64, Value),
    Fall(Fall),
}
impl Moment {
    fn order(&self) -> (i64, bool) {
        match self {
            Moment::Title(r, ..) => (*r, true),
            Moment::Beast(r, _) => (*r, false),
            Moment::Fall(f) => (f.round, false),
        }
    }
    fn json(&self) -> Value {
        match self {
            Moment::Title(round, t, p) => json!({"round": round, "k": "title", "t": TITLES[*t].0, "name": TITLES[*t].1, "p": p}),
            Moment::Beast(_, v) => v.clone(),
            Moment::Fall(f) => {
                let mut v = json!({"round": f.round, "k": "fall", "name": f.name, "ps": f.ps});
                if let Some(s) = f.scorer {
                    v["points"] = json!(f.points);
                    v["scorer"] = json!(s);
                }
                if let Some(n) = f.times {
                    v["times"] = n.into();
                }
                v
            }
        }
    }
}

fn moments(g: &Game, evs: &[(usize, Ev)]) -> Vec<Moment> {
    let mut out: Vec<Moment> = vec![];
    let mut held = [None; 3];
    let mut titles: Vec<(usize, Option<usize>)> = vec![];
    let (mut round, mut strongest) = (0, 0);
    fn close(round: i64, titles: &mut Vec<(usize, Option<usize>)>, held: &mut [Option<usize>; 3], out: &mut Vec<Moment>) {
        for (t, p) in std::mem::take(titles) {
            if let Some(p) = p.filter(|p| held[t] != Some(*p)) {
                out.push(Moment::Title(round, t, p));
                held[t] = Some(p);
            }
        }
    }
    for (i, ev) in evs {
        let e = &g.log[*i];
        if e.round != round {
            close(round, &mut titles, &mut held, &mut out);
            round = e.round;
        }
        if e.to.is_some() {
            continue;
        }
        match e.kind() {
            "title" => {
                let t = TITLES.iter().position(|t| Some(t.0) == ev.t.as_deref()).unwrap_or(0);
                match titles.iter_mut().find(|x| x.0 == t) {
                    Some(x) => x.1 = ev.p,
                    None => titles.push((t, ev.p)),
                }
            }
            "cleared" if ev.won() && ev.points.is_some_and(|n| n != 0) => {
                out.push(Moment::Beast(round, json!({"round": round, "k": "beast", "p": ev.p, "key": ev.fauna.map_or("", |f| f.0), "name": ev.name, "points": ev.points})))
            }
            "raidEnd" if ev.won() => {
                let power = ev.t.as_deref().and_then(|t| DATA.targets.get(t)).map_or(0, |t| t.power());
                let first = power > strongest;
                strongest = strongest.max(power);
                if ev.scorer.is_none() && !first {
                    continue;
                }
                let again = out.iter_mut().find_map(|m| match m {
                    Moment::Fall(f) if ev.scorer.is_some() && f.round == round && Some(&f.name) == ev.name.as_ref() && f.scorer == ev.scorer => Some(f),
                    _ => None,
                });
                if let Some(f) = again {
                    f.points = Some(f.points.unwrap_or(0) + ev.points.unwrap_or(0));
                    f.times = Some(f.times.unwrap_or(1) + 1);
                    f.ps.extend(&ev.winners);
                    f.ps.sort();
                    f.ps.dedup();
                } else {
                    out.push(Moment::Fall(Fall { round, name: ev.name.clone().unwrap_or_default(), ps: ev.winners.clone(), points: ev.points, scorer: ev.scorer, times: None }));
                }
            }
            _ => {}
        }
    }
    close(round, &mut titles, &mut held, &mut out);
    out.sort_by_key(|m| m.order());
    out
}

// Points and dragon power round by round, rebuilt from the log (src/playtest/stats.ts).
fn rebuilt(g: &Game, evs: &[(usize, Ev)]) -> (Vec<Vec<i64>>, Vec<Vec<i64>>) {
    let log = &g.log;
    let mut r = g.clone_without_log();
    for (i, ev) in evs.iter().rev() {
        match log[*i].kind() {
            "wander" => {
                if let (Some(a), Some(b)) = (hex(&ev.from), hex(&ev.to)) {
                    let f = r.map[&b].fauna.take();
                    r.map[&a].fauna = f;
                }
            }
            "play" => {
                if let (Some(_), Some(h)) = (ev.fauna, ev.hex) {
                    r.map[&h].fauna = None;
                }
            }
            "cleared" if ev.won() => {
                if let (Some(f), Some(h)) = (ev.fauna, ev.hex) {
                    r.map[&h].fauna = Some(f);
                }
            }
            _ => {}
        }
    }
    let hatched: Vec<Id> = evs.iter().filter(|(i, _)| log[*i].kind() == "hatch").filter_map(|(_, e)| e.dragon()).collect();
    for pl in &mut r.players {
        pl.hand.clear();
    }
    r.buildings = g.towers.iter().enumerate().map(|(p, k)| (*k, Building { kind: Key::of("tower"), owner: p, upgrades: vec![], floors: 0 })).collect();
    r.dragons = g.dragons.iter().filter(|d| !hatched.contains(&d.id)).map(|d| Dragon { stage: tuning().starting_dragon_stage, perch: None, ..d.clone() }).collect();
    r.titles = Titles { army: None, tower: None, hoard: None };
    r.slain.clear();
    r.raid_points = vec![0; g.players.len()];
    let seen = |r: &Game| (0..r.players.len()).map(|p| r.score(p).public).collect::<Vec<_>>();
    let mut points = vec![];
    let mut power = vec![r.title_values(0)];
    fn dragon(r: &mut Game, d: Option<Id>) -> Option<&mut Dragon> {
        r.dragons.iter_mut().find(|x| Some(x.id) == d)
    }
    for (i, ev) in evs {
        match log[*i].kind() {
            "round" if ev.n.unwrap_or(0) > 1 => {
                points.push(seen(&r));
                power.push(r.title_values(0));
            }
            "build" => {
                if let (Some(h), Some(b), Some(p)) = (ev.hex, &ev.b, ev.p) {
                    r.buildings.insert(h, Building { kind: Key::of(b), owner: p, upgrades: vec![], floors: 0 });
                }
            }
            "floor" => {
                if let Some(p) = ev.p {
                    let k = r.towers[p];
                    r.buildings[&k].floors = ev.floors.unwrap_or(0);
                }
            }
            "upgrade" => {
                if let (Some(h), Some(u)) = (ev.hex, &ev.u) {
                    r.buildings[&h].upgrades.push(Key::of(u));
                }
            }
            "hatch" => {
                if let Some(d) = g.dragons.iter().find(|d| Some(d.id) == ev.dragon()) {
                    r.dragons.push(Dragon { stage: 0, growth: 0, damage: 0, perch: None, hungry: false, ..d.clone() });
                }
            }
            "grow" => {
                if let Some(d) = dragon(&mut r, ev.dragon()) {
                    d.stage = ev.stage.as_ref().and_then(|s| s.as_u64()).unwrap_or(0) as usize;
                }
            }
            "play" => {
                if ev.card.as_deref() == Some("growth_elixir")
                    && let Some(d) = dragon(&mut r, ev.dragon())
                {
                    d.stage += 1;
                }
                if let (Some(f), Some(h)) = (ev.fauna, ev.hex) {
                    r.map[&h].fauna = Some(f);
                }
            }
            "title" => {
                if let Some(t) = TITLES.iter().position(|t| Some(t.0) == ev.t.as_deref()) {
                    r.titles.set(t, ev.p);
                }
            }
            "wander" => {
                if let (Some(a), Some(b)) = (hex(&ev.from), hex(&ev.to)) {
                    let f = r.map[&a].fauna.take();
                    r.map[&b].fauna = f;
                }
            }
            "perch" => {
                for d in &ev.ds {
                    if let Some(d) = dragon(&mut r, id(d)) {
                        d.perch = ev.hex;
                    }
                }
            }
            "recall" => {
                for d in &ev.ds {
                    if let Some(d) = dragon(&mut r, id(d)) {
                        d.perch = None;
                    }
                }
            }
            "cleared" => {
                for d in &ev.home {
                    if let Some(d) = dragon(&mut r, Some(*d)) {
                        d.perch = None;
                    }
                }
                if let (true, Some(f), Some(h)) = (ev.won(), ev.fauna, ev.hex) {
                    r.map[&h].fauna = None;
                    if let Some(p) = ev.p.filter(|_| is_beast(f.0)) {
                        r.slain.insert(f, p);
                    }
                }
            }
            "raidEnd" => {
                if let Some(s) = ev.scorer {
                    r.raid_points[s] += ev.points.unwrap_or(0);
                }
            }
            _ => {}
        }
    }
    points.push(seen(&r));
    power.push(r.title_values(0));
    (points, power)
}

/// `ended`: ms since the epoch.
pub fn build(g: &Game, names: &[String], id: &str, ended: i64) -> Value {
    let evs: Vec<(usize, Ev)> = g.log.iter().enumerate().filter(|(_, e)| !matches!(e.kind(), "" | "mine" | "talk" | "combat" | "produce" | "tend")).filter_map(|(i, e)| Some((i, e.ev::<Ev>()?))).collect();
    let n = g.players.len();
    let (points, power) = rebuilt(g, &evs);
    let mut race = vec![vec![0; n]];
    race.extend_from_slice(&points[..points.len() - 1]);
    race.push(g.totals());
    let mut made = vec![vec![0; n]; g.round as usize];
    for e in g.log.iter().filter(|e| e.kind() == "produce" && e.round >= 1) {
        if let Some(x) = e.ev::<Produced>() {
            made[e.round as usize - 1][x.p] += x.got.total();
        }
    }
    let standings: Vec<Value> = g
        .standings()
        .iter()
        .map(|s| {
            let sc = g.score(s.p);
            json!({"p": s.p, "place": s.place, "tied": s.tied, "tiebreak": s.tiebreak, "total": s.total, "buildings": sc.buildings, "monuments": sc.monuments, "titles": sc.titles, "beasts": sc.beasts, "raids": sc.raids, "hidden": sc.hidden})
        })
        .collect();
    json!({
        "v": 1, "id": id, "ended": iso(ended), "rounds": g.round, "pointsToWin": tuning().points_to_win,
        "names": (0..n).map(|p| names.get(p).cloned().unwrap_or_else(|| pname(p))).collect::<Vec<_>>(),
        "race": race, "power": power, "made": made, "standings": standings,
        "moments": moments(g, &evs).iter().map(|m| m.json()).collect::<Vec<_>>(),
    })
}

/// A time as JavaScript's toISOString() writes it.
pub fn iso(ms: i64) -> String {
    let (days, t) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    // Days to a civil date (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let (d, m) = (doy - (153 * mp + 2) / 5 + 1, if mp < 10 { mp + 3 } else { mp - 9 });
    let y = yoe + era * 400 + (m <= 2) as i64;
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", t / 3_600_000, t / 60_000 % 60, t / 1000 % 60, t % 1000)
}
