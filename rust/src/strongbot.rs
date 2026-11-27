//! The strong bot (#482): a seat played by code, no model, as a free baseline
//! for playtests and contests. It looks one step ahead on its turn (every
//! purchase tried on a copy and scored by `worth`), estimates fights with its
//! own dice, sees only what its seat sees, and talks. docs/strongbot.md.
use crate::bot::{first_legal, stand_in_commands};
use crate::data::*;
use crate::engine::*;
use crate::map::*;
use crate::rng::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The bot's own numbers, apart from the game's. The bench plays variants against each other.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", default)]
pub struct Tune {
    pub v_res: f64,
    pub v_gold: f64,
    pub kappa: f64,    // points per point of raid-ready combat power, each round
    pub frontier: f64, // an empty land hex beside its buildings, early on
    pub slot: f64,     // a free dragon space, up to 2
    pub min_gain: f64,
    pub offer_wait_ms: i64,
    pub sims: usize, // fights rolled per estimate
    pub talk_per_round: usize,
    pub others_fight: f64,
    pub pace: f64,
    pub horizon: f64,
    pub pull: f64,
}
impl Default for Tune {
    fn default() -> Tune {
        Tune { v_res: 0.2, v_gold: 0.2, kappa: 0.07, frontier: 0.12, slot: 0.35, min_gain: 0.05, offer_wait_ms: 45_000, sims: 60, talk_per_round: 3, others_fight: 0.6, pace: 0.7, horizon: 0.75, pull: 0.7 }
    }
}

/// When it first saw its own open offers waiting, by offer id.
pub type Seen = HashMap<Id, i64>;

fn copy(g: &Game) -> Game {
    g.clone_without_log()
}
fn try_all(g: &mut Game, p: usize, cmds: &[String]) -> bool {
    cmds.iter().all(|c| g.apply(p, c).is_ok())
}

pub struct Bot<'a> {
    pub p: usize,
    pub name: Option<&'a str>,
    pub now: i64,
    pub tune: &'a Tune,
}

// ---------- fights ----------

#[derive(Clone)]
struct Fighter {
    key: Key,
    hp: i64,
    stage: usize,
}
impl Fighter {
    fn of(d: &Dragon) -> Fighter {
        Fighter { key: d.key, hp: d.stats().unwrap().hp - d.damage, stage: d.stage }
    }
    fn def(&self) -> &'static DragonDef {
        &DATA.dragons[self.key.0]
    }
    fn stats(&self) -> Attack {
        self.def().stages[self.stage - 1]
    }
}
struct Foe {
    attack: Attack,
    element: S,
    hp: i64,
}
impl Foe {
    fn unit(x: &UnitDef) -> Foe {
        Foe { attack: x.attack(), element: x.element, hp: x.hp }
    }
}
fn roll_sum(rng: &mut Rng, a: &Attack) -> i64 {
    (0..a.dice).map(|_| rng.roll(a.sides)).sum()
}
// One fight to the end, as the engine fights it: whether every foe fell, and each fighter's health after.
fn fight_once(fighters: &[Fighter], foes: &[Foe], rng: &mut Rng) -> (bool, Vec<i64>) {
    let mut hp: Vec<i64> = fighters.iter().map(|f| f.hp).collect();
    let mut fhp: Vec<i64> = foes.iter().map(|f| f.hp).collect();
    let dragons_first = rng.next() < 0.5;
    let dragons = |hp: &[i64], fhp: &mut [i64], rng: &mut Rng| {
        for (i, f) in fighters.iter().enumerate() {
            if hp[i] <= 0 {
                continue;
            }
            let (st, def) = (f.stats(), f.def());
            let mut alive: Vec<usize> = (0..fhp.len()).filter(|j| fhp[*j] > 0).collect();
            if alive.is_empty() {
                return;
            }
            rng.shuffle(&mut alive);
            match def.targeting {
                "lowest_health" => alive.sort_by_key(|j| fhp[*j]),
                "strongest_attacker" => alive.sort_by_key(|j| {
                    let a = &foes[*j].attack;
                    -(a.targets * a.dice * (a.sides + 1))
                }),
                "weak_to_me" => alive.sort_by_key(|j| !DATA.element_weak[foes[*j].element].contains(&def.element)),
                _ => {}
            }
            for j in alive.into_iter().take(st.targets as usize) {
                fhp[j] = (fhp[j] - elemental(roll_sum(rng, &st), def.element, foes[j].element)).max(0);
            }
        }
    };
    let strike_back = |hp: &mut [i64], fhp: &[i64], rng: &mut Rng| {
        for (j, foe) in foes.iter().enumerate() {
            if fhp[j] <= 0 {
                continue;
            }
            for _ in 0..foe.attack.targets {
                let up: Vec<usize> = (0..hp.len()).filter(|i| hp[*i] > 0).collect();
                if up.is_empty() {
                    return;
                }
                let i = rng.pick(&up);
                hp[i] = (hp[i] - elemental(roll_sum(rng, &foe.attack), foe.element, fighters[i].def().element)).max(0);
            }
        }
    };
    for _ in 0..60 {
        if !dragons_first {
            strike_back(&mut hp, &fhp, rng);
        }
        dragons(&hp, &mut fhp, rng);
        if dragons_first {
            strike_back(&mut hp, &fhp, rng);
        }
        if fhp.iter().all(|h| *h <= 0) {
            return (true, hp);
        }
        if hp.iter().all(|h| *h <= 0) {
            return (false, hp);
        }
    }
    (false, hp)
}

fn power_at(key: Key, stage: usize) -> i64 {
    if stage == 0 { 0 } else { DATA.dragons[key.0].stages[stage - 1].power() }
}
fn expected_makes(g: &Game, p: usize) -> [f64; 5] {
    g.production(p).map(|m| m.base as f64 + m.dice.iter().fold(0.0, |s, d| s + (*d + 1) as f64 / 2.0))
}
fn growth_rate(g: &Game, p: usize) -> i64 {
    1 + g.buildings.iter().filter(|(k, b)| b.owner == p && b.kind.0 == "hatchery" && g.map[*k].fauna.is_none()).count() as i64
}
fn army_of(g: &Game, q: usize) -> i64 {
    g.dragons_of(q).map(|d| d.power()).sum()
}
// A round of a dragon healing or growing.
fn age(def: &DragonDef, stage: &mut usize, growth: &mut i64, dmg: &mut i64, rate: i64) {
    if *dmg > 0 {
        *dmg = (*dmg - tuning().heal_per_round).max(0);
    } else if *stage < 3 {
        *growth += rate;
        while *stage < 3 && *growth >= def.growth_time {
            *growth -= def.growth_time;
            *stage += 1;
        }
    }
}
fn power_soon(d: &Dragon, rate: i64, rounds: i64) -> i64 {
    let (mut stage, mut growth, mut dmg) = (d.stage, d.growth, d.damage);
    for _ in 0..rounds {
        age(d.def(), &mut stage, &mut growth, &mut dmg, rate);
    }
    power_at(d.key, stage)
}
// Resources held count in full up to what a few purchases take; past that, a quarter each.
fn stock(n: i64, r: usize) -> f64 {
    let cap = if r == GOLD { 24 } else { 12 };
    n.min(cap) as f64 + (n - cap).max(0) as f64 * 0.25
}
fn held(h: f64) -> f64 {
    (h / 6.0).clamp(0.25, 1.0)
}
fn add(a: &Bundle, b: &Bundle) -> Bundle {
    Bundle(std::array::from_fn(|r| Some(a.get(r) + b.get(r)).filter(|n| *n != 0)))
}
fn ready_by(g: &Game) -> Vec<Vec<Dragon>> {
    (0..g.players.len()).map(|q| g.dragons_of(q).filter(|d| d.ready()).cloned().collect()).collect()
}
fn power_of(ds: &[Dragon]) -> i64 {
    ds.iter().map(|d| d.power()).sum()
}
fn loot_text(b: &Bundle) -> String {
    let parts: Vec<String> = (0..5).filter(|r| b.get(*r) > 0).map(|r| format!("{} {}", b.get(r), RESOURCES[r])).collect();
    and_list(&parts)
}
// Does `text` have `word`, whatever its case, between word boundaries (a regular expression's \b)?
fn has_word(text: &str, word: &str) -> bool {
    let t: Vec<char> = text.chars().flat_map(|c| c.to_lowercase()).collect();
    let w: Vec<char> = word.chars().flat_map(|c| c.to_lowercase()).collect();
    if w.is_empty() || w.len() > t.len() {
        return false;
    }
    let is_word = |i: Option<usize>| i.and_then(|i| t.get(i)).is_some_and(|c| c.is_ascii_alphanumeric() || *c == '_');
    let edge = |i: usize| is_word(i.checked_sub(1)) != is_word(Some(i));
    (0..=t.len() - w.len()).any(|i| t[i..i + w.len()] == w[..] && edge(i) && edge(i + w.len()))
}

struct Heard {
    from: usize,
    text: String,
    private: bool,
}
// A line of talk: who said it, whether privately, and what.
fn talk_line(text: &str) -> Option<(usize, bool, &str)> {
    let (n, rest) = text.strip_prefix('P')?.split_once(' ')?;
    let from = n.parse::<usize>().ok()?.checked_sub(1)?;
    if let Some(said) = rest.strip_prefix("says: \"") {
        return Some((from, false, said.strip_suffix('"')?));
    }
    let (to, said) = rest.strip_prefix("to P")?.split_once(" (private): \"")?;
    to.parse::<usize>().ok()?;
    Some((from, true, said.strip_suffix('"')?))
}

pub struct Purchase {
    pub cmds: Vec<String>,
    pub gain: f64,
}

impl Bot<'_> {
    /// A guess at how many rounds are left: the leader's pace so far.
    pub fn rounds_left(&self, g: &Game) -> f64 {
        let lead = (0..g.players.len())
            .map(|q| {
                let s = g.score(q);
                if q == self.p { s.total } else { s.public }
            })
            .max()
            .unwrap() as f64;
        let pace = 1.6f64.max(lead / g.round.max(1) as f64);
        (((tuning().points_to_win as f64 - lead) / pace) * self.tune.pace).min(18.0).max(1.0)
    }
    pub fn horizon(&self, g: &Game) -> f64 {
        self.rounds_left(g) * self.tune.horizon
    }

    // A dragon over the next h rounds: the power it has raid-ready, round by round, less what it eats.
    fn dragon_worth(&self, d: &Dragon, rate: i64, h: f64, food: f64) -> f64 {
        let (mut stage, mut growth, mut dmg, mut sum, mut eats) = (d.stage, d.growth, d.damage, 0, 0);
        for _ in 0..h.ceil() as i64 {
            if stage > 0 {
                eats += 1;
            }
            age(d.def(), &mut stage, &mut growth, &mut dmg, rate);
            if stage > 0 && dmg < d.def().stages[stage - 1].hp && d.perch.is_none() {
                sum += power_at(d.key, stage);
            }
        }
        sum as f64 * self.tune.kappa - eats as f64 * food
    }
    // How close it is to each title it doesn't hold, in points.
    fn title_pull(&self, g: &Game, h: f64) -> f64 {
        let p = self.p;
        let rate = growth_rate(g, p);
        let soon = (h.ceil() as i64).min(3);
        let t = tuning();
        let min = [t.title_minimum.army, t.title_minimum.tower, t.title_minimum.hoard];
        let floors = |q: usize| g.buildings[&g.towers[q]].floors;
        let mut sum = 0.0;
        for i in 0..3 {
            let mine = match i {
                0 => g.dragons_of(p).map(|d| power_soon(d, rate, soon)).sum(),
                1 => floors(p),
                _ => g.players[p].gold(),
            };
            let theirs = |q: usize| match i {
                0 => army_of(g, q),
                1 => floors(q),
                _ => g.players[q].gold(),
            };
            let best = (0..g.players.len()).filter(|q| *q != p).map(theirs).max().unwrap_or(0).max(0);
            if g.titles.all()[i] == Some(p) {
                let margin = (mine - best) as f64 / min[i].max(1) as f64;
                sum += t.title_points as f64 * 0.25 * (margin * 3.0).max(0.0).min(1.0);
                continue;
            }
            let need = min[i].max(best + 1);
            let frac = (mine as f64 / need as f64).min(1.0);
            sum += t.title_points as f64 * frac.powf(1.5) * if h >= 2.0 { self.tune.pull } else { self.tune.pull * 0.65 };
        }
        sum
    }
    // Empty land hexes beside its buildings: where it can still build.
    fn frontier(&self, g: &Game) -> f64 {
        let mut seen: Vec<K> = vec![];
        let mut n = 0.0;
        for (k, b) in &g.buildings {
            if b.owner != self.p {
                continue;
            }
            for m in k.neighbors() {
                let Some(hex) = g.map.get(&m) else { continue };
                if hex.ocean() || seen.contains(&m) || g.buildings.contains_key(&m) {
                    continue;
                }
                seen.push(m);
                let w = match hex.terrain.0 {
                    "desert" => 0.3,
                    "harbor" => 0.6,
                    _ => 1.0,
                };
                n += if hex.fauna.is_some() { w / 2.0 } else { w };
            }
        }
        n
    }
    /// What the position is worth, in points, by what it can see.
    pub fn worth(&self, g: &Game, h: f64) -> f64 {
        let (p, t) = (self.p, self.tune);
        let pl = &g.players[p];
        let held = held(h);
        let mut v = g.score(p).total as f64;
        let makes = expected_makes(g, p);
        for r in 0..5 {
            let unit = if r == GOLD { t.v_gold } else { t.v_res };
            v += makes[r] * h * unit + stock(pl.resources.0[r], r) * unit * held;
        }
        let rate = growth_rate(g, p);
        let mine = g.housed(p);
        let food = t.v_res * held * if pl.resources.0[LIVESTOCK] > 12 + mine * 2 { 0.25 } else { 1.0 };
        for d in g.dragons_of(p) {
            v += self.dragon_worth(d, rate, h, food);
        }
        let free = (g.dragon_capacity(p) - mine).max(0);
        v += free.min(2) as f64 * t.slot * (h / 6.0).min(1.0);
        v += self.frontier(g) * t.frontier * (h / 8.0).min(1.0);
        v + self.title_pull(g, h)
    }
    fn public_worth(&self, g: &Game, q: usize, h: f64) -> f64 {
        let makes = expected_makes(g, q);
        g.score(q).public as f64 + makes.iter().fold(0.0, |s, m| s + m * h * self.tune.v_res)
    }

    /// The merchants trades that would let it pay `cost`, or None if they can't.
    pub fn merchant_plan(&self, g: &Game, cost: &Bundle) -> Option<Vec<String>> {
        let mut have = g.players[self.p].resources.0;
        if cost.get(GOLD) > have[GOLD] {
            return None;
        }
        let rates = g.bank_rates(self.p);
        let mut cmds = vec![];
        for r in 0..4 {
            let mut need = cost.get(r) - have[r];
            while need > 0 {
                let mut best = None;
                let mut most = 0;
                for s in (0..4).filter(|s| *s != r) {
                    let n = (have[s] - cost.get(s)).div_euclid(rates[s]);
                    if n > most {
                        (best, most) = (Some(s), n);
                    }
                }
                let s = best?;
                let n = need.min(most);
                cmds.push(format!("merchants {} {} {n}", RESOURCES[s], RESOURCES[r]));
                have[s] -= n * rates[s];
                have[r] += n;
                need -= n;
            }
        }
        Some(cmds)
    }

    // What the hits a dragon takes cost, in points.
    fn hurt_cost(&self, d: &Fighter, after: i64, h: f64) -> f64 {
        let lost = d.hp - after;
        if lost <= 0 {
            return 0.0;
        }
        let heals = ((d.stats().hp - after) as f64 / tuning().heal_per_round as f64).ceil();
        let growing = if d.stage < 3 { heals * 0.35 } else { 0.0 };
        let ko = if after <= 0 { 0.3 + power_at(d.key, d.stage) as f64 * self.tune.kappa * 2.0 } else { 0.0 };
        h.min(6.0) / 6.0 * (growing + ko + lost as f64 * 0.02)
    }
    fn value_of(&self, b: &Bundle, h: f64) -> f64 {
        (0..5).fold(0.0, |s, r| s + b.get(r) as f64 * if r == GOLD { self.tune.v_gold } else { self.tune.v_res }) * held(h).max(0.6)
    }
    // Clearing hex k with dragons ds: the chance it works, and what it costs in hits.
    fn clear_odds(&self, g: &Game, k: K, ds: &[Dragon], rng: &mut Rng, h: f64) -> (f64, f64) {
        let mut foes: Vec<Foe> = g.map[&k].fauna.iter().map(|f| Foe::unit(fauna_def(f.0))).collect();
        foes.extend(g.rivals_perched(self.p, k).into_iter().map(|d| {
            let attack = d.stats().unwrap();
            Foe { attack, element: d.def().element, hp: attack.hp - d.damage }
        }));
        let fs: Vec<Fighter> = ds.iter().map(Fighter::of).collect();
        let (mut wins, mut hurt) = (0, 0.0);
        for _ in 0..self.tune.sims {
            let (won, hp) = fight_once(&fs, &foes, rng);
            wins += won as usize;
            for (f, after) in fs.iter().zip(hp) {
                hurt += self.hurt_cost(f, after, h);
            }
        }
        (wins as f64 / self.tune.sims as f64, hurt / self.tune.sims as f64)
    }

    // ---------- raids ----------

    fn raid_value(&self, g: &Game, t: Key, in_raid: &[Vec<Dragon>], mine: &[Id], rng: &mut Rng, h: f64) -> f64 {
        let loot = g.loot_of(t);
        let def = &DATA.targets[t.0];
        let units: Vec<Foe> = def.units.iter().map(|u| Foe::unit(&DATA.units[u])).collect();
        let order = g.turn_order();
        let points = def.points.unwrap_or(0);
        let mut ev = 0.0;
        for _ in 0..self.tune.sims {
            let mut fighters: Vec<&Dragon> = vec![];
            for (q, ds) in in_raid.iter().enumerate() {
                if q == self.p {
                    fighters.extend(ds.iter().filter(|d| mine.contains(&d.id)));
                } else if !ds.is_empty() && rng.next() < self.tune.others_fight {
                    fighters.extend(ds);
                }
            }
            if fighters.is_empty() {
                continue;
            }
            let fs: Vec<Fighter> = fighters.iter().map(|d| Fighter::of(d)).collect();
            let (won, hp) = fight_once(&fs, &units, rng);
            for (i, d) in fighters.iter().enumerate().filter(|(_, d)| d.owner == self.p) {
                let _ = d;
                ev -= self.hurt_cost(&fs[i], hp[i], h);
            }
            if !won {
                continue;
            }
            let up = |d: &Dragon| fighters.iter().position(|f| f.id == d.id).is_none_or(|i| hp[i] > 0);
            let power: Vec<i64> = in_raid.iter().map(|ds| ds.iter().filter(|d| up(d)).map(|d| d.power()).sum()).collect();
            let total: i64 = power.iter().sum();
            if power[self.p] == 0 {
                continue;
            }
            ev += self.value_of(&loot, h) * power[self.p] as f64 / total as f64;
            let best = *power.iter().max().unwrap();
            if points != 0 && order.iter().find(|q| power[**q] == best) == Some(&self.p) {
                ev += points as f64;
            }
        }
        ev / self.tune.sims as f64
    }
    // The best of the ways it might fight: hold back, all in, or just the grown ones.
    fn best_raid_plan(&self, g: &Game, t: Key, in_raid: &[Vec<Dragon>], rng: &mut Rng, h: f64) -> (f64, Vec<Id>) {
        let mine = &in_raid[self.p];
        let of = |least: usize| mine.iter().filter(|d| d.stage >= least).map(|d| d.id).collect::<Vec<_>>();
        let mut options: Vec<Vec<Id>> = vec![vec![]];
        for o in [of(0), of(2), of(3)] {
            if !options.contains(&o) {
                options.push(o);
            }
        }
        let mut best = (f64::NEG_INFINITY, vec![]);
        for fight in options {
            let ev = self.raid_value(g, t, in_raid, &fight, rng, h);
            if ev > best.0 + 0.02 {
                best = (ev, fight);
            }
        }
        best
    }

    // ---------- talk ----------

    fn this_round<'a>(&self, g: &'a Game) -> impl Iterator<Item = &'a LogEntry> {
        let round = g.round;
        g.log.iter().rev().take_while(move |e| e.round == round)
    }
    fn says(&self) -> String {
        format!("{} says: \"", pname(self.p))
    }
    fn talked(&self, g: &Game) -> bool {
        let (says, tells) = (self.says(), format!("{} to P", pname(self.p)));
        self.this_round(g).filter(|e| e.text.starts_with(&says) || e.text.starts_with(&tells)).count() >= self.tune.talk_per_round
    }
    fn said_this_turn(&self, g: &Game, words: &str) -> bool {
        let says = self.says();
        g.log.iter().rev().take_while(|e| e.kind() != "turn").any(|e| e.text.starts_with(&says) && e.text.contains(words))
    }
    fn said_this_round(&self, g: &Game, words: &str) -> bool {
        let says = self.says();
        self.this_round(g).any(|e| e.text.starts_with(&says) && e.text.contains(words))
    }
    // The latest thing someone said to it (privately, or publicly by name) that it hasn't answered.
    fn unanswered(&self, g: &Game) -> Option<Heard> {
        for e in g.log.iter().rev().take(79) {
            if e.kind() != "talk" || !e.seen_by(self.p) {
                continue;
            }
            let Some((from, private, text)) = talk_line(&e.text) else { continue };
            if from == self.p {
                return None; // spoken since
            }
            if private || has_word(text, &pname(self.p)) || self.name.is_some_and(|n| has_word(text, n)) {
                return Some(Heard { from, text: text.to_string(), private });
            }
        }
        None
    }
    // The player most likely to win, by what the table sees.
    fn leader(&self, g: &Game) -> (usize, i64) {
        let mut lead = (usize::MAX, -1);
        for q in (0..g.players.len()).filter(|q| *q != self.p) {
            let s = g.score(q).public;
            if s > lead.1 {
                lead = (q, s);
            }
        }
        lead
    }
    fn warning(&self, g: &Game) -> Option<String> {
        let (q, pts) = self.leader(g);
        let win = tuning().points_to_win;
        if pts < win - 14 || pts <= g.score(self.p).total || self.talked(g) || self.said_this_round(g, "points") {
            return None;
        }
        let who = pname(q);
        Some(format!("say {who} has {pts} points, {} from winning. Don't trade with {who}, and let's not raid where {who} scores.", win - pts))
    }
    fn reply(&self, g: &Game, h: f64, rng: &mut Rng) -> Option<String> {
        if self.talked(g) {
            return None;
        }
        let m = self.unanswered(g)?;
        let to = if m.private { format!("tell {} ", pname(m.from)) } else { "say ".into() };
        let any = |words: &[&str]| words.iter().any(|w| has_word(&m.text, w));
        if any(&["raid", "vote", "fight", "attack", "kingdom", "hold back", "join"]) {
            let in_raid = ready_by(g);
            if in_raid[self.p].is_empty() {
                return Some(format!("{to}I have no dragon ready to raid this round."));
            }
            let mut best: Option<(f64, S)> = None;
            for (t, def) in &DATA.targets {
                let ev = self.best_raid_plan(g, Key::of(t), &in_raid, rng, h).0;
                if best.is_none_or(|b| ev > b.0) {
                    best = Some((ev, def.name));
                }
            }
            return Some(format!("{to}I'll vote {}: that's the one we can take.", best?.1));
        }
        if any(&["stone", "timber", "crystal", "livestock", "gold", "trade", "offer", "swap", "deal", "need", "want", "give"]) {
            let (q, pts) = self.leader(g);
            if m.from == q && pts >= tuning().points_to_win - 12 {
                return Some(format!("{to}You're too close to winning: no trades with you."));
            }
            return Some(format!("{to}Make me an offer. I take any trade that helps me, and 2 for 1 usually does."));
        }
        Some(format!("{to}{}", rng.pick(&["Noted.", "Good luck to you too.", "We'll see.", "Fair enough."])))
    }

    // ---------- the moves ----------

    /// What it does next; None while it waits on answers to its own offer.
    pub fn commands(&self, g: &Game, rng: &mut Rng, seen: &mut Seen) -> Option<Vec<String>> {
        let p = self.p;
        let pl = &g.players[p];
        let h = self.horizon(g);
        match g.phase {
            Phase::Cards => {
                if let Some(r) = self.reply(g, h, rng) {
                    return Some(vec![r]);
                }
                return Some(if pl.choice.is_empty() { vec![] } else { vec![format!("keep {}", self.keep_choice(g, h))] });
            }
            Phase::Discard => return Some(vec![format!("discard {}", ids(&self.discard_choice(g, h)))]),
            Phase::Raid => return Some(self.raid_move(g, h)),
            Phase::Over => return Some(vec![]),
            Phase::Action => {}
        }
        if let Some(o) = g.offers.iter().find(|o| o.waits_on(p)) {
            return Some(vec![self.answer(g, o, h)]);
        }
        if p != g.turn {
            return Some(vec![]);
        }
        if let Some(r) = self.reply(g, h, rng) {
            return Some(vec![r]);
        }
        let mut open = false;
        for o in g.offers.iter().filter(|o| o.from == p) {
            let since = *seen.entry(o.id).or_insert(self.now);
            if self.now - since > self.tune.offer_wait_ms {
                return Some(vec![format!("cancel {}", o.id)]);
            }
            open |= (0..g.players.len()).any(|q| o.waits_on(q));
        }
        if open {
            return None;
        }
        let one = self.warning(g).or_else(|| self.best_clear(g, rng, h)).or_else(|| self.sabotage(g, h)).or_else(|| self.horn(g, rng, h));
        if let Some(c) = one {
            return Some(vec![c]);
        }
        if let Some(buy) = self.best_purchase(g, h) {
            let ask = if buy.cmds.len() > 1 { self.ask_table(g, &buy.cmds) } else { None };
            return Some(ask.unwrap_or_else(|| vec![buy.cmds[0].clone()]));
        }
        Some(vec!["end".into()])
    }

    // ---------- purchases ----------

    // Everything it might buy now: the commands that buy it, and its cost.
    fn purchases(&self, g: &Game) -> Vec<(Vec<String>, Bundle)> {
        let p = self.p;
        let mut out: Vec<(Vec<String>, Bundle)> = vec![];
        let room = g.housed(p) < g.dragon_capacity(p);
        let mut roosts: Vec<(String, Bundle)> = vec![];
        for b in &DATA.basic_buildings {
            let def = &DATA.buildings[b];
            for k in g.buildable_hexes(p, b) {
                let cmd = if def.on_tower { format!("build {b}") } else { format!("build {b} {k}") };
                if def.dragon_capacity != 0 {
                    roosts.push((cmd.clone(), def.cost));
                }
                out.push((vec![cmd], def.cost));
            }
        }
        let mut eggs = vec![(format!("project {}", self.egg_element(g)), egg_cost("fire_whelp"))];
        let mut seen: Vec<Key> = vec![];
        for c in &g.players[p].hand {
            if seen.contains(&c.key) {
                continue;
            }
            seen.push(c.key);
            match c.kind() {
                "building" => out.extend(g.buildable_hexes(p, c.key.0).into_iter().map(|k| (vec![format!("build {} {k}", c.id)], *c.cost()))),
                "upgrade" => out.extend(g.upgrade_targets(p, c.key.0).into_iter().map(|k| (vec![format!("upgrade {} {k}", c.id)], *c.cost()))),
                "dragon" => eggs.push((format!("play {}", c.id), *c.cost())),
                _ => {
                    let a = &DATA.actions[c.key.0];
                    let mut one = |what: String| out.push((vec![format!("play {}{what}", c.id)], a.cost));
                    match a.effect {
                        "gain_gold" => one(String::new()),
                        "gain_resource" => RESOURCES[..4].iter().for_each(|r| one(format!(" {r}"))),
                        "grow_dragon" => g.dragons_of(p).filter(|d| d.stage < 3).for_each(|d| one(format!(" {}", d.id))),
                        "heal_dragon" => g.dragons_of(p).filter(|d| d.damage > 0).for_each(|d| one(format!(" {}", d.id))),
                        _ => {}
                    }
                }
            }
        }
        for (cmd, cost) in eggs {
            if room {
                out.push((vec![cmd], cost));
            } else {
                // No room: the roost or floor first. A roost's hex barely matters, so a few are tried.
                out.extend(roosts.iter().take(4).map(|(r, c)| (vec![r.clone(), cmd.clone()], add(c, &cost))));
            }
        }
        for u in project_upgrades() {
            out.extend(g.upgrade_targets(p, u).into_iter().map(|k| (vec![format!("project {u} {k}")], upgrade_project_cost(u))));
        }
        out
    }
    // The element for a new egg: what the great beasts and the big kingdoms are weak to, the ones it has fewest of first.
    fn egg_element(&self, g: &Game) -> S {
        let mut wanted = vec![];
        if !g.slain.contains_key(&Key("thunderbird")) {
            wanted.push("ice");
        }
        if !g.slain.contains_key(&Key("leviathan")) {
            wanted.push("lightning");
        }
        wanted.extend(["water", "air", "ice", "lightning", "fire"]);
        let have = |e: S| g.dragons_of(self.p).filter(|d| d.def().element == e).count();
        wanted.into_iter().reduce(|a, b| if have(b) < have(a) { b } else { a }).unwrap()
    }
    pub fn best_purchase(&self, g: &Game, h: f64) -> Option<Purchase> {
        let base = self.worth(g, h);
        let mut best: Option<Purchase> = None;
        for (buy, cost) in self.purchases(g) {
            let Some(mut cmds) = self.merchant_plan(g, &cost) else { continue };
            cmds.extend(buy);
            let mut c = copy(g);
            if !try_all(&mut c, self.p, &cmds) {
                continue;
            }
            let gain = self.worth(&c, h) - base;
            if gain > self.tune.min_gain && best.as_ref().is_none_or(|b| gain > b.gain) {
                best = Some(Purchase { cmds, gain });
            }
        }
        best
    }
    // Before trading 4 for 1 with the merchants for a resource it's 1 or 2
    // short of, ask the table for it at 2 for 1, once a turn.
    fn ask_table(&self, g: &Game, cmds: &[String]) -> Option<Vec<String>> {
        let m: Vec<Vec<&str>> = cmds.iter().filter(|c| c.starts_with("merchants ")).map(|c| c.split(' ').collect()).collect();
        let [m] = &m[..] else { return None };
        let (give, get, times) = (m[1], m[2], m[3].parse::<i64>().ok()?);
        if g.bank_rates(self.p)[resource(give)?] < 4 || times > 2 {
            return None;
        }
        let mine = format!("{{\"k\":\"offer\",\"p\":{},", self.p);
        if g.log.iter().rev().take_while(|e| e.kind() != "turn").any(|e| e.raw().starts_with(&mine)) {
            return None;
        }
        let offer = format!("offer anyone give {} {give} get {times} {get}", times * 2);
        let line = format!("Anyone spare {times} {get}? {} {give} for {}.", times * 2, if times == 1 { "it" } else { "them" });
        if !self.said_this_turn(g, &line) && !self.talked(g) {
            return Some(vec![format!("say {line}"), offer]);
        }
        Some(vec![offer])
    }

    // ---------- answering offers ----------

    fn prospects(&self, g: &Game, h: f64) -> f64 {
        self.worth(g, h) + self.best_purchase(g, h).map_or(0.0, |b| b.gain)
    }
    fn answer(&self, g: &Game, o: &Offer, h: f64) -> String {
        let no = format!("decline {}", o.id);
        if !o.get.cards.is_empty() || g.accept_problem(o, self.p).is_some() {
            return no;
        }
        let (q, pts) = self.leader(g);
        if o.from == q && (pts >= tuning().points_to_win - 12 || pts > g.score(self.p).total + 8) {
            return no;
        }
        let before = self.prospects(g, h);
        let mut c = copy(g);
        for r in 0..5 {
            c.players[self.p].resources.0[r] += o.give.res.get(r) - o.get.res.get(r);
        }
        let after = self.prospects(&c, h) + o.give.cards.len() as f64 * 0.4;
        let margin = if o.from == q { 0.5 } else { 0.15 };
        if after > before + margin { format!("accept {}", o.id) } else { no }
    }

    // ---------- clearing hexes, and cards that hurt rivals or call raids ----------

    fn best_clear(&self, g: &Game, rng: &mut Rng, h: f64) -> Option<String> {
        let p = self.p;
        let mut by_power: Vec<Dragon> = g.dragons_of(p).filter(|d| d.ready()).cloned().collect();
        if by_power.is_empty() {
            return None;
        }
        let base = self.worth(g, h);
        let mut targets: Vec<K> = vec![];
        let mut aim = |k: K| {
            if !targets.contains(&k) {
                targets.push(k);
            }
        };
        for (k, b) in g.buildings.iter().filter(|(_, b)| b.owner == p) {
            let _ = b;
            if g.map[k].fauna.is_some() || !g.rivals_perched(p, *k).is_empty() {
                aim(*k);
            }
            for m in k.neighbors() {
                if g.map.get(&m).is_some_and(|x| x.fauna.is_some() && !x.beast()) {
                    aim(m);
                }
            }
        }
        if g.beast_tried[p] != g.round {
            g.map.iter().filter(|(_, x)| x.beast()).for_each(|(k, _)| aim(*k));
        }
        by_power.sort_by_key(|d| -d.power());
        let n = by_power.len();
        let mut best: Option<(String, f64)> = None;
        for k in targets {
            let f = g.map[&k].fauna;
            let great = f.is_some_and(|f| is_beast(f.0));
            let mut c = copy(g);
            c.map[&k].fauna = None;
            for d in c.dragons.iter_mut().filter(|d| d.perch == Some(k) && d.owner != p) {
                d.perch = None;
            }
            if let Some(f) = f.filter(|_| great) {
                c.slain.insert(f, p);
            }
            let gain = self.worth(&c, h) - base + if f.is_some() { self.value_of(&g.fauna_loot(k), h) } else { 0.0 };
            if gain <= 0.2 {
                continue;
            }
            for size in std::iter::once(n).chain(1..n) {
                let ds = &by_power[..size];
                let (win, hurt) = self.clear_odds(g, k, ds, rng, h);
                if win < if great { 0.45 } else { 0.7 } {
                    continue;
                }
                let ev = win * gain - hurt;
                if ev > 0.3 && best.as_ref().is_none_or(|b| ev > b.1) {
                    best = Some((format!("clear {k} {}", ids(&ds.iter().map(|d| d.id).collect::<Vec<_>>())), ev));
                }
            }
        }
        best.map(|b| b.0)
    }
    // Rouse the Bear or Wake the Basilisk on the leading rival's best building.
    fn sabotage(&self, g: &Game, h: f64) -> Option<String> {
        let pl = &g.players[self.p];
        let card = pl.hand.iter().find(|c| DATA.actions.get(c.key.0).is_some_and(|a| a.effect == "send_fauna"))?;
        let a = &DATA.actions[card.key.0];
        if pl.resources.0[2] < a.cost.get(2) {
            return None;
        }
        let (q, pts) = self.leader(g);
        let weight = if pts >= g.score(self.p).total { 0.6 } else { 0.3 };
        let beast = fauna_def(a.fauna?).attack().power();
        let theirs: i64 = g.dragons_of(q).filter(|d| d.ready()).map(|d| d.power()).sum();
        let lasts = if theirs >= 2 * beast {
            0.25
        } else if theirs >= beast {
            0.5
        } else {
            1.0
        };
        let h = h.min(4.0);
        let before = self.public_worth(g, q, h);
        let mut best: Option<(K, f64)> = None;
        for (k, b) in &g.buildings {
            if b.owner != q || b.tower() || g.map[k].fauna.is_some() || k.neighbors().iter().any(|m| g.buildings.get(m).is_some_and(|x| x.owner == self.p)) {
                continue;
            }
            let mut c = copy(g);
            c.map[k].fauna = a.fauna.map(Key::of);
            c.map[k].sent = true;
            let harm = (before - self.public_worth(&c, q, h)) * lasts * weight;
            if best.is_none_or(|b| harm > b.1) {
                best = Some((*k, harm));
            }
        }
        best.filter(|b| b.1 > 0.6).map(|b| format!("play {} {}", card.id, b.0))
    }
    // A War Horn, when another raid is worth more than its crystal.
    fn horn(&self, g: &Game, rng: &mut Rng, h: f64) -> Option<String> {
        let pl = &g.players[self.p];
        let card = pl.hand.iter().find(|c| DATA.actions.get(c.key.0).is_some_and(|a| a.effect == "extra_raid"))?;
        let in_raid = ready_by(g);
        if pl.resources.0[2] < 1 || in_raid[self.p].is_empty() {
            return None;
        }
        let best = DATA.targets.keys().map(|t| self.best_raid_plan(g, Key::of(t), &in_raid, rng, h).0).fold(f64::NEG_INFINITY, f64::max);
        (best > 1.2).then(|| format!("play {}", card.id))
    }

    // ---------- the raid ----------

    fn raid_move(&self, g: &Game, h: f64) -> Vec<String> {
        let p = self.p;
        let raid = g.raid.as_ref().expect("a raid");
        // Its own dice, seeded by the round and the raid, so saying its vote
        // and then casting it pick the same kingdom.
        let raids = self.this_round(g).filter(|e| e.kind() == "raid").count() as i64;
        let mut rng = Rng::new(g.round * 7919 + p as i64 * 104_729 + g.raids_left * 31 + raids * 17);
        if raid.step == Step::Choose {
            let in_raid: Vec<Vec<Dragon>> = raid.sent.iter().map(|ds| ds.iter().map(|d| g.dragon(*d).clone()).collect()).collect();
            let (_, fight) = self.best_raid_plan(g, raid.target.expect("a target"), &in_raid, &mut rng, h);
            return vec![if fight.is_empty() { "hold".into() } else { format!("fight {}", ids(&fight)) }];
        }
        let in_raid = ready_by(g);
        let evs: Vec<f64> = raid.candidates.iter().map(|t| self.best_raid_plan(g, *t, &in_raid, &mut rng, h).0).collect();
        let tally: Vec<i64> = (0..raid.candidates.len()).map(|i| raid.votes.iter().enumerate().filter(|(_, v)| **v == Some(i)).map(|(q, _)| power_of(&in_raid[q])).sum()).collect();
        let (mut pick, mut pick_ev) = (0, f64::NEG_INFINITY);
        for i in 0..tally.len() {
            let mut t = tally.clone();
            t[i] += power_of(&in_raid[p]);
            let top = *t.iter().max().unwrap();
            let tied: Vec<usize> = (0..t.len()).filter(|j| t[*j] == top).collect();
            let ev = tied.iter().fold(0.0, |s, j| s + evs[*j]) / tied.len() as f64;
            if ev > pick_ev + 1e-9 {
                (pick, pick_ev) = (i, ev);
            }
        }
        let t = raid.candidates[pick];
        let mut out = vec![format!("vote {}", pick + 1)];
        let others = in_raid.iter().enumerate().any(|(q, ds)| q != p && !ds.is_empty());
        if others && !self.talked(g) && !self.said_this_round(g, "I vote") {
            let name = DATA.targets[t.0].name;
            let (_, fight) = self.best_raid_plan(g, t, &in_raid, &mut rng, h);
            let line = if fight.is_empty() { format!("I vote {name}.") } else { format!("I vote {name}. Fight with me and it falls; we split {}.", loot_text(&g.loot_of(t))) };
            out.insert(0, format!("say {line}"));
        }
        out
    }

    // ---------- cards ----------

    // What a card is worth: what it would add if it could be paid for now.
    fn card_worth(&self, g: &Game, c: &Card, h: f64) -> f64 {
        let p = self.p;
        if let Some(a) = DATA.actions.get(c.key.0) {
            let n = a.amount as f64;
            let any = |f: &dyn Fn(&Dragon) -> bool| if g.dragons_of(p).any(f) { 0.9 } else { 0.3 };
            return match a.effect {
                "hidden_point" => n + 1.0,
                "gain_gold" => n * self.tune.v_gold + 0.2,
                "gain_resource" => n * self.tune.v_res + 0.2,
                "send_fauna" | "extra_raid" => 0.5,
                "grow_dragon" => any(&|d| d.stage < 3),
                _ => any(&|d| d.stage > 0),
            };
        }
        let base = self.worth(g, h);
        let kind = c.kind();
        let tries: Vec<String> = match kind {
            "building" => g.buildable_hexes(p, c.key.0).iter().map(|k| format!("build {} {k}", c.id)).collect(),
            "upgrade" => g.upgrade_targets(p, c.key.0).iter().map(|k| format!("upgrade {} {k}", c.id)).collect(),
            _ => vec![format!("play {}", c.id)],
        };
        let mut best: f64 = if kind == "building" { 0.2 } else { 0.0 };
        for cmd in tries {
            let mut x = copy(g);
            let pl = &mut x.players[p];
            for r in 0..5 {
                pl.resources.0[r] += c.cost().get(r);
            }
            if !pl.hand.iter().any(|y| y.id == c.id) {
                pl.hand.push(*c);
            }
            if try_all(&mut x, p, &[cmd]) {
                best = best.max(self.worth(&x, h) - base);
            }
        }
        best
    }
    fn keep_choice(&self, g: &Game, h: f64) -> Id {
        let choice = &g.players[self.p].choice;
        let mut best = (choice[0].id, f64::NEG_INFINITY);
        for c in choice {
            let v = self.card_worth(g, c, h);
            if v > best.1 {
                best = (c.id, v);
            }
        }
        best.0
    }
    fn discard_choice(&self, g: &Game, h: f64) -> Vec<Id> {
        let hand = &g.players[self.p].hand;
        let mut ranked: Vec<(f64, Id)> = hand.iter().map(|c| (self.card_worth(g, c, h), c.id)).collect();
        ranked.sort_by(|a, b| a.0.total_cmp(&b.0));
        ranked.into_iter().take(hand.len().saturating_sub(tuning().hand_cap)).map(|x| x.1).collect()
    }
}

/// Whether it's waiting on answers to its own offer, with nothing to do till they come.
pub fn strong_waits(g: &Game, bot: &Bot, seen: &mut Seen) -> bool {
    bot.commands(g, &mut Rng::new(g.next_id as i64), seen).is_none()
}
/// Applies its next move and returns it: Ok(None) while it waits on answers to its offer.
pub fn strong_move(g: &mut Game, bot: &Bot, rng: &mut Rng, seen: &mut Seen) -> Result<Option<String>, String> {
    let Some(mut cmds) = bot.commands(g, rng, seen) else { return Ok(None) };
    cmds.extend(stand_in_commands(g, bot.p));
    first_legal(g, bot.p, cmds).map(Some).ok_or_else(|| format!("The strong bot found no legal move for {} in phase {:?}", pname(bot.p), g.phase))
}
