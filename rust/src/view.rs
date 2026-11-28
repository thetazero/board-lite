//! The game as text for Claude players, as src/view.ts prints it from the same snapshot.
use crate::data::*;
use crate::engine::{Id, Make, Phase, Purse, Step, ids, keys_or, pname};
use crate::map::K;
use crate::state::*;

/// A snapshot, as far as the text needs it.
pub struct Shown<'a> {
    pub lobby: &'a Lobby,
    pub game: Option<&'a PublicState<'a>>,
    pub you: Option<(&'a SeatState<'a>, &'a str)>,
}

fn res_text(b: &Bundle) -> String {
    let t: Vec<String> = (0..5).filter(|r| b.get(*r) != 0).map(|r| format!("{} {}", b.get(r), RESOURCES[r])).collect();
    if t.is_empty() { "nothing".into() } else { t.join(", ") }
}
fn rate_text(r: &Rates) -> String {
    let usual = r.0.iter().max().unwrap();
    let mut out = vec![format!("{usual}:1")];
    out.extend((0..4).filter(|i| r.0[*i] < *usual).map(|i| format!("{}:1 for {}", r.0[i], RESOURCES[i])));
    out.join(", ")
}
fn plural(n: i64, word: &str) -> String {
    format!("{n} {word}{}", if n == 1 { "" } else { "s" })
}
fn keys(ks: &[K]) -> String {
    keys_or(ks, "")
}
fn code(kind: &str) -> &str {
    match kind {
        "tower" => "TW",
        "quarry" => "qu",
        "lumber_camp" => "lc",
        "crystal_mine" => "cm",
        "pasture" => "pa",
        "roost" => "ro",
        "cliff_works" => "cw",
        "stonemason" => "sm",
        "woodcutter" => "wc",
        "sawmill" => "sw",
        "driftwood_yard" => "dy",
        "ley_spire" => "cs",
        "gem_cutter" => "gc",
        "smelter" => "se",
        "shepherds_fold" => "sf",
        "drovers_barn" => "db",
        "fishery" => "fi",
        "hatchery" => "ha",
        "stone_port" => "sp",
        "timber_port" => "tp",
        "crystal_port" => "cp",
        "livestock_port" => "lp",
        "market" => "mk",
        "monument" => "mo",
        "standing_stones" => "ss",
        "lighthouse" => "lh",
        "guildhall" => "gh",
        _ => &kind[..2.min(kind.len())],
    }
}
pub fn fauna_code(key: &str) -> String {
    match key {
        "wolf" => "W".into(),
        "cave_bear" => "B".into(),
        "basilisk" => "X".into(),
        "thunderbird" => "T".into(),
        "leviathan" => "V".into(),
        _ => key[..1].to_uppercase(),
    }
}
fn letter(terrain: &str) -> char {
    match terrain {
        "mountain" => 'M',
        "forest" => 'F',
        "ley" => 'C',
        "meadow" => 'G',
        "desert" => '.',
        "harbor" => 'H',
        "ocean" => '~',
        _ => '?',
    }
}
fn unit_stats(u: &UnitView) -> String {
    let weak = if u.weak.is_empty() { String::new() } else { format!(", weak to {}", u.weak.join("/")) };
    format!("Power {}, Health {}, Attack {}{weak}", u.power, u.hp, u.attack)
}
fn card_text(c: &CardView) -> String {
    let kind = if c.kind == "dragon" { "dragon egg" } else { c.kind };
    let stages = c.dragon.as_ref().map_or(String::new(), |d| {
        let s: Vec<String> = d.stages.iter().zip(["hatchling", "young", "adult"]).map(|(s, n)| format!("{n}: Power {}, Health {}, Attack {}", s.power, s.hp, s.attack)).collect();
        format!(" {}.", s.join("; "))
    });
    format!("{} {} [{kind}] cost {}: {}{stages}", c.id, c.name, res_text(&c.cost), c.text)
}
fn dragon_line(d: &DragonView) -> String {
    let growth = if d.stage == 3 { "grown".into() } else { format!("growth {}/{}", d.growth, d.growth_time) };
    let stats = if d.stage > 0 { format!("Power {}, Health {}/{}, Attack {}, ", d.power, d.hp, d.max_hp, d.attack) } else { String::new() };
    let status = if d.can_raid {
        format!("raid-ready{}", if d.hp < d.max_hp { ", hurt: heals instead of growing" } else { "" })
    } else if d.stage == 0 {
        "egg".into()
    } else if let Some(k) = d.perch {
        format!("perched on {k}")
    } else {
        "knocked out".into()
    };
    let hungry = if d.hungry { ", went hungry this round: did not heal or grow" } else { "" };
    format!("{} {} {} ({} {}, {stats}{growth}; {status}{hungry}) {}", d.id, pname(d.owner), d.name, d.element, d.stage_name, d.targeting)
}
fn expected(m: &Make) -> f64 {
    m.base as f64 + m.dice.iter().map(|d| (*d + 1) as f64 / 2.0).sum::<f64>()
}
fn num(n: f64) -> String {
    format!("{}", (n * 10.0 + 0.5).floor() / 10.0)
}
fn amounts(rows: &[(S, &Make, i64)]) -> String {
    let rows: Vec<_> = rows.iter().filter(|(_, v, eat)| v.base != 0 || !v.dice.is_empty() || *eat != 0).collect();
    if rows.is_empty() {
        return "nothing".into();
    }
    let each: Vec<String> = rows
        .iter()
        .map(|(r, v, eat)| {
            let mut parts = vec![];
            if v.base != 0 || v.dice.is_empty() {
                parts.push(v.base.to_string());
            }
            parts.extend(v.dice.iter().map(|d| format!("1d{d}")));
            let avg = if v.dice.is_empty() { String::new() } else { format!(" (expected {})", num(expected(v))) };
            let eats = if *eat != 0 { format!(" (dragons eat {eat})") } else { String::new() };
            format!("{r} {}{avg}{eats}", parts.join("+"))
        })
        .collect();
    format!("{}; expected {} in all", each.join(", "), num(rows.iter().map(|(_, v, _)| expected(v)).sum()))
}
fn firsts<T: PartialEq + Copy, U>(it: impl Iterator<Item = (T, U)>) -> Vec<(T, U)> {
    let mut out: Vec<(T, U)> = vec![];
    for (k, v) in it {
        if !out.iter().any(|x| x.0 == k) {
            out.push((k, v));
        }
    }
    out
}
fn map_text(g: &PublicState) -> Vec<String> {
    let built: Vec<String> = firsts(g.map.iter().filter_map(|h| h.building.as_ref()).map(|b| (b.kind, b.name))).iter().map(|(k, n)| format!("{} {n}", code(k))).collect();
    let fauna: Vec<String> = firsts(g.map.iter().filter_map(|h| h.fauna.as_ref()).map(|f| (f.key, f.unit.name))).iter().map(|(k, n)| format!("{} {n}", fauna_code(k))).collect();
    let beasts = if fauna.is_empty() { String::new() } else { format!(" ({})", fauna.join(", ")) };
    let mut lines = vec![
        "Map (axial q,r). M mountain, F forest, C crystal field, G meadow, . desert, H harbor, ~ ocean, ^ peak.".into(),
        format!("[<owner><code>] a building, + per upgrade: {}.", built.join(", ")),
        format!("<ids> perched dragons; {{code}} a beast{beasts}; {{x}} held by an adjacent great beast. A building under either is suppressed."),
    ];
    let mut rows: Vec<i32> = g.map.iter().map(|h| h.r).collect();
    rows.sort();
    rows.dedup();
    for r in rows {
        let mut cells: Vec<&HexView> = g.map.iter().filter(|h| h.r == r).collect();
        cells.sort_by_key(|h| h.q);
        let cells: Vec<String> = cells
            .iter()
            .map(|h| {
                let label = h.building.as_ref().map_or(String::new(), |b| format!("[{}{}{}]", b.owner + 1, code(b.kind), "+".repeat(b.upgrades.len())));
                let beast = h.fauna.as_ref().map_or(String::new(), |f| format!("{{{}}}", fauna_code(f.key)));
                let perched = if h.perched.is_empty() { String::new() } else { format!("<{}>", ids(&h.perched.iter().map(|x| x.d).collect::<Vec<_>>())) };
                format!("{}:{}{}{label}{beast}{}{perched}", h.k, letter(h.terrain), if h.peak.is_some() { "^" } else { "" }, if h.held.is_some() { "{x}" } else { "" })
            })
            .collect();
        lines.push(format!("  {}{}", " ".repeat(r.unsigned_abs() as usize * 4), cells.join("  ")));
    }
    lines
}
fn target_text(t: &TargetView) -> String {
    let mut groups: Vec<(String, String, usize)> = vec![];
    for u in &t.units {
        let stats = unit_stats(u);
        match groups.iter_mut().find(|g| g.0 == u.name && g.1 == stats) {
            Some(g) => g.2 += 1,
            None => groups.push((u.name.into(), stats, 1)),
        }
    }
    let units: Vec<String> = groups.iter().map(|(n, s, k)| if *k > 1 { format!("{n} x{k} ({s})") } else { format!("{n} ({s})") }).collect();
    let points = t.points.map_or(String::new(), |n| format!("; {} to the most power standing", plural(n, "point")));
    format!("{} (Power {}): {}; loot {}{points}", t.name, t.power, units.join(", "), res_text(&t.loot))
}
fn fauna_text(f: &FaunaView) -> String {
    let prize = match f.points {
        Some(n) => format!("great beast: {} to whoever slays it", plural(n, "point")),
        None if !f.loot.empty() => format!("loot {}", res_text(&f.loot)),
        None => "no loot".into(),
    };
    format!("{} ({}; {prize})", f.unit.name, unit_stats(&f.unit))
}
fn raid_text(g: &PublicState, raid: &RaidView, you: &SeatState) -> Vec<String> {
    let mut out = vec![];
    if raid.step == Step::Vote {
        out.push("Raid vote (a vote is worth its voter's raid-ready power; the kingdom with the most is raided):".into());
        for (i, t) in raid.candidates.iter().enumerate() {
            let got: i64 = raid.votes.iter().enumerate().filter(|(_, v)| **v == Some(i)).map(|(q, _)| raid.vote_power[q]).sum();
            out.push(format!("  {}. {}{}", i + 1, target_text(t), if got != 0 { format!("; {got} power voted") } else { String::new() }));
        }
        let votes: Vec<String> = raid
            .votes
            .iter()
            .enumerate()
            .map(|(q, v)| {
                let power = if raid.voters[q] { format!(" (power {})", raid.vote_power[q]) } else { String::new() };
                let vote = v.map_or(if raid.voters[q] { "not yet".into() } else { "no vote".into() }, |v| (v + 1).to_string());
                format!("{}{power} {vote}", pname(q))
            })
            .collect();
        out.push(format!("  Votes: {}", votes.join(", ")));
        if let Some(why) = you.why_no_vote {
            out.push(format!("  {why}"));
        }
        return out;
    }
    let power = |ds: &[Id]| -> i64 { ds.iter().map(|id| g.dragons.iter().find(|d| d.id == *id).map_or(0, |d| d.power)).sum() };
    out.push(format!("Raid: {}", raid.target.as_ref().map_or(String::new(), target_text)));
    let ins: Vec<(usize, &Vec<Id>)> = raid.sent.iter().enumerate().filter(|(_, c)| !c.is_empty()).collect();
    out.push(format!("In the raid (every raid-ready dragon): {}", ins.iter().map(|(q, c)| format!("{} {} (power {})", pname(*q), ids(c), power(c))).collect::<Vec<_>>().join(", ")));
    out.push(format!("Which dragons fight, in secret: {}", ins.iter().map(|(q, _)| format!("{} {}", pname(*q), if raid.decided[*q] { "chosen" } else { "not yet" })).collect::<Vec<_>>().join(", ")));
    if let Some(mine) = you.my_fight {
        let held: Vec<Id> = raid.sent[you.seat].iter().copied().filter(|d| !mine.contains(d)).collect();
        let what = if mine.is_empty() {
            "hold back".into()
        } else if held.is_empty() {
            "fight".into()
        } else {
            format!("fight with {} and hold back {}", ids(mine), ids(&held))
        };
        out.push(format!("  You {what}."));
    }
    out
}
fn afford(ok: bool) -> &'static str {
    if ok { "" } else { " (can't afford yet)" }
}
fn blocked(c: &CardView) -> String {
    c.blocked.as_ref().map_or(String::new(), |b| format!(" ({})", b.strip_suffix('.').unwrap_or(b)))
}
pub fn hints(g: &PublicState, you: &SeatState) -> Vec<String> {
    let mut out = vec![];
    if !you.deciding {
        return out;
    }
    match g.phase {
        Phase::Action => {}
        Phase::Cards => {
            let all: Vec<String> = you.choice.iter().map(|c| c.id.to_string()).collect();
            out.push(format!("{{\"do\":\"keep\",\"card\":\"<{}>\"}}   (the other is discarded)", all.join("|")));
            out.extend(you.choice.iter().map(|c| format!("  {}", card_text(c))));
            return out;
        }
        Phase::Discard => return vec![format!("{{\"do\":\"discard\",\"cards\":[\"<{} card ids>\"]}}   (hand limit {})", you.hand.len() - you.hand_cap, you.hand_cap)],
        _ => {
            if let Some(r) = &g.raid {
                if r.step == Step::Vote && you.why_no_vote.is_none() {
                    out.push(format!("{{\"do\":\"vote\",\"target\":\"<{}>\"}}", r.candidates.iter().map(|t| t.key).collect::<Vec<_>>().join("|")));
                }
                if r.step == Step::Choose {
                    out.push("{\"do\":\"fight\"}  |  {\"do\":\"fight\",\"dragons\":[\"<dragon id>\", ...]}  |  {\"do\":\"hold\"}   (secret: all, some or none of your dragons fight; held back, they stay out of the combat but still share the loot if the kingdom falls)".into());
                }
            }
            return out;
        }
    }
    for o in &g.offers {
        let mine = match o.to {
            None => o.from != you.seat && !o.passed.contains(&you.seat),
            Some(t) => t == you.seat,
        };
        if !mine {
            continue;
        }
        let why = you.cant_accept.0.iter().find(|x| x.0 == o.id).map(|x| &x.1);
        let accept = if why.is_some() { String::new() } else { format!("{{\"do\":\"accept\",\"offer\":\"{}\"}}  |  ", o.id) };
        out.push(format!("{accept}{{\"do\":\"decline\",\"offer\":\"{}\"}}   ({} gives {} for {}{}){}", o.id, pname(o.from), o.give, o.get, if o.to.is_none() { ", to anyone" } else { "" }, why.map_or(String::new(), |w| format!(" {w}"))));
    }
    if !you.my_turn {
        out.push(format!("{{\"do\":\"offer\",\"to\":\"{0}\",\"give\":{{...}},\"get\":{{...}}}}   (out of turn, only with {0})", pname(g.turn)));
        return out;
    }
    let none = |s: String| if s.is_empty() { "none".to_string() } else { s };
    for c in &you.hand {
        let can = afford(c.affordable);
        match c.kind {
            "building" if c.needs == "none" => out.push(format!("{{\"do\":\"build\",\"card\":\"{}\"}}   ({}){can}", c.id, c.name)),
            "building" => {
                let hexes: Vec<String> = match &c.counts {
                    Some(n) => n.0.iter().map(|(k, n)| format!("{k}(x{n})")).collect(),
                    None => c.hexes.iter().map(|k| k.to_string()).collect(),
                };
                out.push(format!("{{\"do\":\"build\",\"card\":\"{}\",\"hex\":\"<hex>\"}}   ({}; hexes: {}){can}", c.id, c.name, none(hexes.join(" "))));
            }
            "upgrade" => out.push(format!("{{\"do\":\"upgrade\",\"card\":\"{}\",\"hex\":\"<hex>\"}}   ({}; on: {}){can}", c.id, c.name, none(keys(&c.hexes)))),
            "dragon" => out.push(format!("{{\"do\":\"play\",\"card\":\"{}\"}}   (hatch {}){can}{}", c.id, c.name, blocked(c))),
            _ if c.needs == "unplayable" => {}
            _ => {
                let arg = match c.needs {
                    "resource" => ",\"resource\":\"<stone|timber|crystal|livestock>\"",
                    "dragon" => ",\"dragon\":\"<dragon id>\"",
                    "hex" => ",\"hex\":\"<hex>\"",
                    _ => "",
                };
                let fauna = c.fauna.as_ref().map_or(String::new(), |f| format!(": a land hex with no tower or beast; {}", fauna_text(f)));
                out.push(format!("{{\"do\":\"play\",\"card\":\"{}\"{arg}}}   ({}{fauna}){can}{}", c.id, c.name, blocked(c)));
            }
        }
    }
    for b in you.basics.iter().filter(|b| !b.hexes.is_empty()) {
        let (arg, at) = if b.on_tower { ("", String::new()) } else { (",\"hex\":\"<hex>\"", format!(" Hexes: {}", keys(&b.hexes))) };
        out.push(format!("{{\"do\":\"build_basic\",\"building\":\"{}\"{arg}}}   (no card, cost {}: {}{at}){}", b.key, res_text(&b.cost), b.text, afford(b.affordable)));
    }
    let ready = ids(&you.raid_ready);
    let any = !you.raid_ready.is_empty();
    if !you.huntable.is_empty() && any {
        let foes: Vec<String> = you
            .huntable
            .iter()
            .map(|k| {
                let h = g.map.iter().find(|h| h.k == *k).expect("a hex on the map");
                let mut who: Vec<String> = h.fauna.iter().map(|f| f.unit.name.to_string()).collect();
                who.extend(h.perched.iter().filter(|x| x.owner != you.seat).map(|x| x.d.to_string()));
                format!("{k} {}", who.join(" and "))
            })
            .collect();
        out.push(format!("{{\"do\":\"clear\",\"hex\":\"<hex>\",\"dragons\":[\"<dragon id>\", ...]}}   (fight its beast and all rivals' dragons perched there, together, to the end; a coin flip says which side strikes first. Dragons not knocked out can clear again this turn, and still raid. Raid-ready: {ready}. Hexes: {})", foes.join(", ")));
    }
    if !you.auto_clear.is_empty() && any {
        out.push(format!("{{\"do\":\"auto_clear\"}}   (your own buildings, weakest first, with all your raid-ready dragons, until one fight is lost. Held: {})", keys(&you.auto_clear)));
    }
    if !you.perchable.is_empty() && any {
        out.push(format!("{{\"do\":\"perch\",\"hex\":\"<hex>\",\"dragons\":[\"<dragon id>\", ...]}}   (a rival's building, not a tower, is suppressed while they stay; they don't raid. Dragons perched on one building fight together when it's cleared; a lone one fights alone. Hexes: {})", keys(&you.perchable)));
    }
    if !you.perched.is_empty() {
        out.push(format!("{{\"do\":\"recall\",\"dragons\":[\"<dragon id>\", ...]}}   (perched: {})", ids(&you.perched)));
    }
    out.push(format!("{{\"do\":\"project_egg\",\"element\":\"<{}>\"}}   (base dragon egg, no card, cost {})", you.egg_project.elements.join("|"), res_text(&you.egg_project.cost)));
    for u in you.upgrade_projects.iter().filter(|u| !u.hexes.is_empty()) {
        out.push(format!("{{\"do\":\"project_upgrade\",\"upgrade\":\"{}\",\"hex\":\"<hex>\"}}   ({}, no card, cost {}: {} On: {}){}", u.key, u.name, res_text(&u.cost), u.text, keys(&u.hexes), afford(u.affordable)));
    }
    out.push(format!("{{\"do\":\"merchants\",\"pay\":\"<resource>\",\"gain\":\"<resource>\",\"times\":1}}   (not gold; {})", rate_text(&you.bank_rates)));
    out.push("{\"do\":\"offer\",\"to\":\"<player|anyone>\",\"give\":{\"stone\":2},\"get\":{\"gold\":1,\"cards\":[\"c12\"]}}   (resources, cards or both; to anyone: the first to accept trades)".into());
    out.extend(g.offers.iter().filter(|o| o.from == you.seat).map(|o| format!("{{\"do\":\"cancel\",\"offer\":\"{}\"}}", o.id)));
    out.push(if g.offers.iter().any(|o| o.to == Some(you.seat)) { "{\"do\":\"end\"}   (after answering the offers to you)".into() } else { "{\"do\":\"end\"}".into() });
    out
}
fn phase_text(g: &PublicState) -> String {
    let r = g.round;
    match g.phase {
        Phase::Over => format!("Game over.{}", g.winner.map_or(String::new(), |w| format!(" {} wins!", pname(w)))),
        Phase::Cards => format!("Round {r}, cards: keep 1 of 2 building cards."),
        Phase::Action => format!("Round {r}, actions: {}'s turn.", pname(g.turn)),
        Phase::Discard => format!("Round {r}, end of round: discard down to the hand limit."),
        Phase::Raid => {
            let step = if g.raid.as_ref().is_some_and(|r| r.step == Step::Choose) { "fight or hold back" } else { "vote" };
            format!("Round {r}, raid: {step}{}.", if g.raids_left > 1 { format!(" ({} left)", plural(g.raids_left, "raid")) } else { String::new() })
        }
    }
}
fn waiting_text(g: &PublicState) -> String {
    if g.waiting_on.is_empty() { "no one".into() } else { g.waiting_on.iter().map(|p| pname(*p)).collect::<Vec<_>>().join(", ") }
}
pub fn event_line(e: &EventView) -> String {
    format!("[r{}] {}", e.round, e.text)
}
fn table_text(l: &Lobby, you: Option<usize>) -> String {
    l.seats
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let note = if Some(i) == you {
                " (you)"
            } else if t.kind == "bot" {
                " (bot)"
            } else if t.kind == "open" {
                " (open seat)"
            } else {
                ""
            };
            format!("{} {}{note}", pname(i), t.name)
        })
        .collect::<Vec<_>>()
        .join(", ")
}
const SAVED: &str = "The game is saved: someone at the table continues it on the TV or a phone.";
const SEATING: &str = "The game goes on once every seat is taken.";

pub fn lobby_text(l: &Lobby) -> String {
    let names = table_text(l, None);
    let starter = l.starter.and_then(|p| l.seats.get(p)).map_or("the first to join", |s| s.name.as_str());
    format!(
        "Room {}, in the lobby: {}. {} to {} players; {}{starter} starts.",
        l.code,
        if names.is_empty() { "no one yet" } else { &names },
        l.min_players,
        l.max_players,
        if l.remote { "" } else { "the TV or " }
    )
}

fn seat_rows<'a>(r: &'a ByRes<Income>) -> Vec<(S, &'a Make, i64)> {
    r.0.iter().enumerate().filter_map(|(i, x)| x.as_ref().map(|x| (RESOURCES[i], &x.make, x.eat))).collect()
}
fn purse_text(p: &Purse) -> String {
    (0..5).map(|r| format!("{} {}", p.0[r], RESOURCES[r])).collect::<Vec<_>>().join(", ")
}

/// Everything one seat sees, and its options.
pub fn seat_view(s: &Shown, log_lines: usize) -> String {
    let (Some(g), Some((you, _))) = (s.game, s.you) else { return lobby_text(s.lobby) };
    let p = you.seat;
    let mut out: Vec<String> = vec![];
    out.push(format!("Table: {}.", table_text(s.lobby, Some(p))));
    out.push(format!("You are {}. {}", pname(p), phase_text(g)));
    let hints = hints(g, you);
    out.push(if s.lobby.seating {
        SEATING.into()
    } else if s.lobby.saved.is_some() {
        SAVED.into()
    } else if !hints.is_empty() {
        ">>> Your decision.".into()
    } else {
        format!("Waiting for {}.", waiting_text(g))
    });
    out.push(String::new());
    out.push(format!("== Scores (first to {}; hidden points count at the end) ==", g.points_to_win));
    for (q, pl) in g.players.iter().enumerate() {
        let me = q == p;
        let extra = if me { format!(" + {} hidden = {}", you.hidden_points, you.total_points) } else { String::new() };
        let part = |n: i64, what: &str| if n != 0 { format!(", {what} {n}") } else { String::new() };
        let rows: Vec<(S, &Make, i64)> = pl.production.0.iter().enumerate().filter_map(|(i, m)| m.as_ref().map(|m| (RESOURCES[i], m, 0))).collect();
        let made = pl.last_made.as_ref().map_or(String::new(), |m| format!("; made {} in round {}", m.total, m.round));
        out.push(format!(
            "{}{}: {} public (buildings {}{}{}{}{}){extra}; {} cards in hand; makes {} each round{made}",
            pname(q),
            if me { " (you)" } else { "" },
            pl.public_points,
            pl.buildings - pl.monuments,
            part(pl.monuments, "monuments"),
            part(pl.titles, "titles"),
            part(pl.beasts, "great beasts"),
            part(pl.raids, "kingdoms"),
            pl.hand_size,
            amounts(&rows)
        ));
    }
    let last: Vec<String> = if g.phase == Phase::Over { vec![] } else { g.players.iter().enumerate().filter(|(q, pl)| (if *q == p { you.total_points } else { pl.public_points }) >= g.points_to_win).map(|(q, _)| if q == p { "you".into() } else { pname(q) }).collect() };
    if !last.is_empty() {
        let who = last.join(" and ");
        let who = who.strip_prefix("you").map_or(who.clone(), |r| format!("You{r}"));
        out.push(format!("{who} {} {} or more points, so this is the last round.", if last.len() > 1 || last[0] == "you" { "have" } else { "has" }, g.points_to_win));
    }
    let titles: Vec<String> = g.titles.iter().map(|t| format!("{}: {} [{}; needs {}]", t.name, t.holder.map_or("no one".into(), pname), t.values.iter().map(|v| v.to_string()).collect::<Vec<_>>().join("/"), t.min)).collect();
    out.push(format!("Titles ({} points each): {}", g.title_points, titles.join("; ")));
    out.push(String::new());
    out.push("== You (hidden from others) ==".into());
    out.push(format!("Resources: {}", purse_text(you.resources)));
    out.push(format!("Each round you make: {}.", amounts(&seat_rows(&you.income))));
    let over = you.dragons_housed - you.dragon_capacity;
    out.push(format!("Merchants {}. Dragons {}/{} housed{}.", rate_text(&you.bank_rates), you.dragons_housed, you.dragon_capacity, if over > 0 { format!(": {over} over, no hatching until there's room") } else { String::new() }));
    let over = you.hand.len() as i64 - you.hand_cap as i64;
    out.push(format!("Hand ({}/{}){}:", you.hand.len(), you.hand_cap, if over > 0 && g.phase != Phase::Discard { format!(": {over} over the limit, discarded at the end of the round") } else { String::new() }));
    out.extend(you.hand.iter().map(|c| format!("  {}", card_text(c))));
    if !you.choice.is_empty() {
        out.push(format!("Keep 1: {}", you.choice.iter().map(card_text).collect::<Vec<_>>().join(" | ")));
    }
    out.push(String::new());
    out.push("== Dragons (public) ==".into());
    out.extend(g.dragons.iter().map(|d| format!("  {}", dragon_line(d))));
    out.push(String::new());
    out.push("== Buildings (public) ==".into());
    for q in 0..g.players.len() {
        let list: Vec<String> = g
            .map
            .iter()
            .filter_map(|h| h.building.as_ref().filter(|b| b.owner == q).map(|b| (h.k, b)))
            .map(|(k, b)| {
                let name = if b.kind == "tower" { format!("Tower{}", if b.floors != 0 { format!("({})", plural(b.floors, "floor")) } else { String::new() }) } else { b.name.into() };
                format!("{name}{}@{k}", b.upgrade_name.as_ref().map_or(String::new(), |u| format!("+{u}")))
            })
            .collect();
        out.push(format!("  {}: {}", pname(q), list.join(", ")));
    }
    out.extend(map_text(g));
    let mut fauna: Vec<&HexView> = g.map.iter().filter(|h| h.fauna.is_some()).collect();
    fauna.sort_by_key(|h| h.k);
    let beasts: Vec<String> = fauna.iter().map(|h| format!("{} {}{}", h.k, fauna_text(h.fauna.as_ref().unwrap()), h.building.as_ref().map_or(String::new(), |b| format!(" on {}'s {}", pname(b.owner), b.kind)))).collect();
    out.push(format!("Fauna: {}.", if beasts.is_empty() { "none".into() } else { beasts.join("; ") }));
    let peak = g.map.iter().find(|h| h.peak.is_some()).map_or(String::new(), |h| format!(" ({})", h.k));
    let slain: Vec<String> = g.beasts.iter().filter_map(|b| b.slain_by.map(|p| format!("{} by {}", b.name, pname(p)))).collect();
    out.push(format!("Great beasts slain: {}. Once the Thunderbird is slain, production buildings on or adjacent to the peak{peak} make {} more each round.", if slain.is_empty() { "none".into() } else { slain.join(", ") }, g.peak_bonus));
    let kingdoms: Vec<String> = g.kingdoms.iter().map(|t| format!("{} (Power {}) {}{}", t.name, t.power, res_text(&t.loot), t.points.map_or(String::new(), |n| format!(", {}", plural(n, "point"))))).collect();
    out.push(format!("Kingdoms (loot now; +1 gold each round it doesn't fall in): {}.", kingdoms.join("; ")));
    if let Some(r) = &g.raid {
        out.push(String::new());
        out.extend(raid_text(g, r, you));
    }
    if !g.offers.is_empty() {
        out.push(String::new());
        out.push("== Open offers ==".into());
        for o in &g.offers {
            let passed: Vec<String> = o.passed.iter().map(|p| pname(*p)).collect();
            let declined = if passed.is_empty() { String::new() } else { format!("; {} {}", passed.join(", "), if passed.len() == 1 { "declines" } else { "decline" }) };
            out.push(format!("  {}: {} offers {} {} for {}{declined}", o.id, pname(o.from), o.to.map_or("anyone".into(), pname), o.give, o.get));
        }
    }
    out.push(String::new());
    out.push("== Recent events ==".into());
    let mut all: Vec<&EventView> = g.log.iter().chain(&you.log).chain(&you.talk).collect();
    all.sort_by_key(|e| e.i);
    all.dedup_by_key(|e| e.i);
    out.extend(all[all.len().saturating_sub(log_lines)..].iter().map(|e| format!("  {}", event_line(e))));
    if !hints.is_empty() {
        out.push(String::new());
        out.push("== Your options ==".into());
        out.extend(hints.iter().map(|h| format!("  {h}")));
    }
    if g.phase != Phase::Over {
        out.push("Talk any time: {\"do\":\"say\",\"message\":\"...\"}, or {\"do\":\"tell\",\"to\":\"P2\",\"message\":\"...\"} (private). Promises bind no one.".into());
    }
    out.join("\n")
}

/// One line for a seat: its options when it's its decision, else who the game waits on.
pub fn seat_status(s: &Shown) -> String {
    let Some(g) = s.game else { return "The game hasn't started.".into() };
    if g.phase == Phase::Over {
        return phase_text(g);
    }
    let hints = s.you.map_or(vec![], |(you, _)| hints(g, you));
    if hints.is_empty() {
        return format!("Waiting for {}.", waiting_text(g));
    }
    format!("Your options:\n{}", hints.iter().map(|h| format!("  {h}")).collect::<Vec<_>>().join("\n"))
}
