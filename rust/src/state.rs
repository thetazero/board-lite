//! What the web clients receive, as JSON, as src/state.ts makes it.
use crate::data::*;
use crate::engine::*;
use crate::map::*;
use serde::{Deserialize, Serialize, Serializer};
use serde_json::value::RawValue;

/// Production by resource; None leaves a resource out.
pub struct ByRes<T>(pub [Option<T>; 5]);
impl<T: Serialize> Serialize for ByRes<T> {
    fn serialize<Z: Serializer>(&self, s: Z) -> Result<Z::Ok, Z::Error> {
        s.collect_map(RESOURCES.iter().zip(&self.0).filter_map(|(r, x)| x.as_ref().map(|x| (r, x))))
    }
}
pub struct Rates(pub [i64; 4]);
impl Serialize for Rates {
    fn serialize<Z: Serializer>(&self, s: Z) -> Result<Z::Ok, Z::Error> {
        s.collect_map(RESOURCES.iter().zip(&self.0))
    }
}
/// An object from pairs, in order.
pub struct Pairs<A, B>(pub Vec<(A, B)>);
impl<A: Serialize, B: Serialize> Serialize for Pairs<A, B> {
    fn serialize<Z: Serializer>(&self, s: Z) -> Result<Z::Ok, Z::Error> {
        s.collect_map(self.0.iter().map(|(a, b)| (a, b)))
    }
}

#[derive(Serialize)]
pub struct UnitView {
    pub name: S,
    pub hp: i64,
    #[serde(rename = "maxHp")]
    pub max_hp: i64,
    pub attack: String,
    pub power: i64,
    pub element: S,
    pub weak: &'static [S],
}
#[derive(Serialize)]
pub struct FaunaView {
    pub key: S,
    #[serde(flatten)]
    pub unit: UnitView,
    pub loot: Bundle,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points: Option<i64>,
}
#[derive(Serialize)]
pub struct Does {
    pub makes: ByRes<Make>,
    pub houses: i64,
    pub points: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<S>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak: Option<S>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildingView<'a> {
    #[serde(rename = "type")]
    pub kind: S,
    pub cls: S,
    pub name: S,
    pub owner: usize,
    pub upgrades: &'a [Key],
    pub upgrade_name: Option<String>,
    pub floors: i64,
    pub does: Does,
}
#[derive(Serialize)]
pub struct Perched {
    pub d: Id,
    pub owner: usize,
    pub element: S,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HexView<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub held: Option<S>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak: Option<S>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak_zone: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suppressed: Option<bool>,
    pub k: K,
    pub q: i32,
    pub r: i32,
    pub terrain: S,
    pub building: Option<BuildingView<'a>>,
    pub fauna: Option<FaunaView>,
    pub perched: Vec<Perched>,
}
#[derive(Serialize, Clone)]
pub struct StageView {
    pub hp: i64,
    pub attack: String,
    pub power: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DragonView {
    pub id: Id,
    pub owner: usize,
    pub name: S,
    pub element: S,
    pub stage: usize,
    pub stage_name: S,
    pub growth: i64,
    pub growth_time: i64,
    pub hp: i64,
    pub max_hp: i64,
    pub can_raid: bool,
    pub perch: Option<K>,
    pub hungry: bool,
    pub weak: &'static [S],
    pub power: i64,
    pub status: S,
    pub targeting: S,
    pub attack: String,
    pub key: Key,
    pub stages: Vec<StageView>,
}
#[derive(Serialize)]
pub struct TargetView {
    pub key: S,
    pub name: S,
    pub loot: Bundle,
    pub power: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points: Option<i64>,
    pub units: Vec<UnitView>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaidView<'a> {
    pub step: Step,
    pub candidates: Vec<TargetView>,
    pub votes: &'a [Option<usize>],
    pub voters: Vec<bool>,
    pub vote_power: Vec<i64>,
    pub target: Option<TargetView>,
    pub sent: &'a [Vec<Id>],
    pub decided: Vec<bool>,
    pub fighting: Vec<bool>,
    pub fighters: &'a [Id],
}
#[derive(Serialize)]
pub struct EventView<'a> {
    pub i: usize,
    pub round: i64,
    pub text: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dice: Option<&'a [Die]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ev: Option<&'a RawValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private: Option<bool>,
}
#[derive(Serialize)]
pub struct LastMade {
    pub round: i64,
    pub total: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerView {
    pub public_points: i64,
    pub buildings: i64,
    pub monuments: i64,
    pub titles: i64,
    pub beasts: i64,
    pub raids: i64,
    pub hand_size: usize,
    pub gold: i64,
    pub production: ByRes<Make>,
    pub last_made: Option<LastMade>,
    pub bank_rates: Rates,
}
#[derive(Serialize)]
pub struct TitleView {
    pub key: S,
    pub name: S,
    pub holder: Option<usize>,
    pub values: Vec<i64>,
    pub min: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeastView {
    pub key: S,
    pub name: S,
    pub hex: Option<K>,
    pub slain_by: Option<usize>,
    pub points: i64,
    pub hp: i64,
    pub weak: &'static [S],
}
#[derive(Serialize)]
pub struct OfferView<'a> {
    pub id: Id,
    pub from: usize,
    pub to: Option<usize>,
    pub passed: &'a [usize],
    pub give: String,
    pub get: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicState<'a> {
    pub round: i64,
    pub phase: Phase,
    pub turn: usize,
    pub turn_order: Vec<usize>,
    pub points_to_win: i64,
    pub title_points: i64,
    pub element_beats: &'static indexmap::IndexMap<S, S>,
    pub fauna_wander_odds: i64,
    pub fauna_spread_weight: usize,
    pub waiting_on: Vec<usize>,
    pub players: Vec<PlayerView>,
    pub titles: Vec<TitleView>,
    pub beasts: Vec<BeastView>,
    pub peak_bonus: i64,
    pub map: Vec<HexView<'a>>,
    pub dragons: Vec<DragonView>,
    pub offers: Vec<OfferView<'a>>,
    pub raid: Option<RaidView<'a>>,
    pub kingdoms: Vec<TargetView>,
    pub raids_left: i64,
    pub winner: Option<usize>,
    pub final_totals: Option<Vec<i64>>,
    pub standings: Option<Vec<Standing>>,
    pub log: Vec<EventView<'a>>,
    pub talk: Vec<EventView<'a>>,
}
#[derive(Serialize)]
pub struct DragonCard {
    pub growth: i64,
    pub targeting: S,
    pub stages: Vec<StageView>,
}
#[derive(Serialize)]
pub struct CardView {
    pub id: Id,
    pub kind: S,
    pub key: Key,
    pub name: S,
    pub cost: Bundle,
    pub affordable: bool,
    pub hexes: Vec<K>,
    pub dragons: Vec<Id>,
    pub blocked: Option<String>,
    pub text: String,
    pub needs: S,
    pub verb: S,
    pub why: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cls: Option<S>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub counts: Option<Pairs<K, i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<Pairs<K, Does>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub element: Option<S>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dragon: Option<DragonCard>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fauna: Option<FaunaView>,
}
#[derive(Serialize)]
pub struct Income {
    #[serde(flatten)]
    pub make: Make,
    pub eat: i64,
    pub blocked: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Basic {
    pub key: S,
    pub cls: S,
    pub name: S,
    pub text: String,
    pub cost: Bundle,
    pub affordable: bool,
    pub hexes: Vec<K>,
    pub after: Pairs<K, Does>,
    pub on_tower: bool,
    pub why: Option<String>,
}
#[derive(Serialize)]
pub struct EggProject {
    pub cost: Bundle,
    pub affordable: bool,
    pub elements: [S; 5],
    pub room: bool,
    pub why: Option<String>,
}
#[derive(Serialize)]
pub struct UpgradeProject {
    pub key: S,
    pub name: S,
    pub text: S,
    pub cost: Bundle,
    pub affordable: bool,
    pub hexes: Vec<K>,
    pub after: Pairs<K, Does>,
    pub why: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatState<'a> {
    pub seat: usize,
    pub resources: &'a Purse,
    pub hidden_points: i64,
    pub total_points: i64,
    pub bank_rates: Rates,
    pub dragons_housed: i64,
    pub dragon_capacity: i64,
    pub income: ByRes<Income>,
    pub hand: Vec<CardView>,
    pub choice: Vec<CardView>,
    pub hand_cap: usize,
    pub my_turn: bool,
    pub deciding: bool,
    pub basics: Vec<Basic>,
    pub egg_project: EggProject,
    pub upgrade_projects: Vec<UpgradeProject>,
    pub raid_ready: Vec<Id>,
    pub huntable: Vec<K>,
    pub auto_clear: Vec<K>,
    pub perchable: Vec<K>,
    pub perched: Vec<Id>,
    pub cant_accept: Pairs<Id, String>,
    pub my_vote: Option<usize>,
    pub why_no_vote: Option<S>,
    pub my_fight: Option<&'a [Id]>,
    pub log: Vec<EventView<'a>>,
    pub talk: Vec<EventView<'a>>,
}
#[derive(Serialize, Deserialize)]
pub struct LobbySeat {
    pub name: String,
    pub kind: String,
    pub connected: bool,
    #[serde(rename = "standIn")]
    pub stand_in: bool,
    pub left: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub strong: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lobby {
    pub code: String,
    pub started: bool,
    pub seating: bool,
    pub saved: Option<i64>,
    pub seats: Vec<LobbySeat>,
    pub min_players: usize,
    pub max_players: usize,
    pub file: String,
    pub remote: bool,
}

fn stage_views(d: &DragonDef) -> Vec<StageView> {
    d.stages.iter().map(|s| StageView { hp: s.hp, attack: s.text(), power: s.power() }).collect()
}
fn dragon_view(d: &Dragon) -> DragonView {
    let def = d.def();
    let st = d.stats();
    let status = if d.ready() {
        "ready"
    } else if d.stage == 0 {
        "egg"
    } else if d.perch.is_some() {
        "perched"
    } else {
        "out"
    };
    DragonView {
        id: d.id,
        owner: d.owner,
        name: def.name,
        element: def.element,
        stage: d.stage,
        stage_name: DATA.stage_names[d.stage],
        growth: d.growth,
        growth_time: def.growth_time,
        hp: st.map_or(0, |s| s.hp - d.damage),
        max_hp: st.map_or(0, |s| s.hp),
        can_raid: d.ready(),
        perch: d.perch,
        hungry: d.hungry,
        weak: &DATA.element_weak[def.element],
        power: d.power(),
        status,
        targeting: DATA.targeting_text[def.targeting],
        attack: st.map_or(String::new(), |s| s.text()),
        key: d.key,
        stages: stage_views(def),
    }
}
fn unit_view(x: &'static UnitDef, hp: i64) -> UnitView {
    UnitView { name: x.name, hp, max_hp: x.hp, attack: x.attack().text(), power: x.attack().power(), element: x.element, weak: &DATA.element_weak[x.element] }
}
fn target_view(g: &Game, key: S, hp: Option<&[RaidUnit]>) -> TargetView {
    let t = &DATA.targets[key];
    let units = t.units.iter().enumerate().map(|(i, u)| {
        let x = &DATA.units[u];
        unit_view(x, hp.and_then(|h| h.get(i)).map_or(x.hp, |u| u.hp))
    });
    TargetView { key, name: t.name, loot: g.loot_of(Key::of(key)).nonzero(), power: t.power(), points: t.points, units: units.collect() }
}
fn fauna_view(key: S, loot: Bundle) -> FaunaView {
    let x = fauna_def(key);
    FaunaView { key, unit: unit_view(x, x.hp), loot: loot.nonzero(), points: is_beast(key).then_some(x.points) }
}
fn side_text(g: &Game, s: &TradeSide) -> String {
    let mut parts: Vec<String> = (0..5).filter(|r| s.res.get(*r) > 0).map(|r| format!("{} {}", s.res.get(r), RESOURCES[r])).collect();
    parts.extend(s.cards.iter().map(|id| g.any_card(id).map_or(format!("card {id}"), |c| format!("{} card", c.name()))));
    if parts.is_empty() { "nothing".into() } else { parts.join(", ") }
}
pub fn is_talk(text: &str) -> bool {
    text.contains(" says: \"") || text.contains(" (private): \"")
}
fn events(g: &Game, keep: impl Fn(&LogEntry) -> bool, n: usize, since: usize) -> Vec<EventView<'_>> {
    let mut out: Vec<EventView> = g
        .log
        .iter()
        .enumerate()
        .skip(since)
        .rev()
        .filter(|(_, e)| keep(e))
        .take(n)
        .map(|(i, e)| EventView { i, round: e.round, text: &e.text, dice: e.dice.as_deref(), ev: e.ev.as_deref(), private: e.to.as_ref().map(|_| true) })
        .collect();
    out.reverse();
    out
}
pub fn visible_events(g: &Game, p: usize, since: usize) -> Vec<EventView<'_>> {
    events(g, |e| e.seen_by(p), usize::MAX, since)
}
#[derive(Deserialize)]
pub struct Produced {
    pub p: usize,
    pub got: Bundle,
    #[serde(default)]
    pub eat: i64,
}
fn last_made(g: &Game, p: usize) -> Option<LastMade> {
    let e = g.log.iter().rev().find(|e| e.kind() == "produce" && e.ev::<Produced>().is_some_and(|x| x.p == p))?;
    Some(LastMade { round: e.round, total: e.ev::<Produced>()?.got.total() })
}
fn upgrade_names(ups: &[Key]) -> Option<String> {
    let mut keys: Vec<Key> = vec![];
    for u in ups {
        if !keys.contains(u) {
            keys.push(*u);
        }
    }
    let names: Vec<String> = keys
        .iter()
        .map(|u| {
            let (n, name) = (ups.iter().filter(|x| *x == u).count(), DATA.upgrades[u.0].name);
            match n {
                1 => name.into(),
                _ => format!("{n} {name}{}", if name.ends_with('s') { "" } else { "s" }),
            }
        })
        .collect();
    (!names.is_empty()).then(|| names.join(", "))
}
fn does(g: &Game, k: K, b: &Building, upgrades: &[Key]) -> Does {
    let y = g.building_yield(k, b, upgrades);
    let note = (!b.tower() && (b.def().growth_bonus != 0 || b.def().bank_rate.is_some())).then(|| b.def().text);
    Does { makes: ByRes(y.makes), houses: y.houses, points: y.points, note, peak: None }
}
fn does_if_built(g: &Game, p: usize, key: S, hexes: &[K]) -> Pairs<K, Does> {
    let b = Building { kind: Key::of(key), owner: p, upgrades: vec![], floors: 0 };
    let made = made_resource(b.def()).is_some();
    Pairs(hexes.iter().map(|k| (*k, Does { peak: g.on_peak(*k).then_some(if made { "more" } else { "none" }), ..does(g, *k, &b, &[]) })).collect())
}
fn does_if_upgraded(g: &Game, up: S, hexes: &[K]) -> Pairs<K, Does> {
    Pairs(
        hexes
            .iter()
            .map(|k| {
                let b = &g.buildings[k];
                let mut ups = b.upgrades.clone();
                ups.push(Key::of(up));
                (*k, does(g, *k, b, &ups))
            })
            .collect(),
    )
}

pub fn public_state(g: &Game) -> PublicState<'_> {
    let n = g.players.len();
    let t = tuning();
    let min = [t.title_minimum.army, t.title_minimum.tower, t.title_minimum.hoard];
    let over = g.phase == Phase::Over;
    PublicState {
        round: g.round,
        phase: g.phase,
        turn: g.turn,
        turn_order: g.turn_order(),
        points_to_win: points_to_win(),
        title_points: t.title_points,
        element_beats: &DATA.element_beats,
        fauna_wander_odds: t.fauna_wander_odds,
        fauna_spread_weight: t.fauna_spread_weight,
        waiting_on: g.waiting_on(),
        players: (0..n)
            .map(|p| {
                let s = g.score(p);
                PlayerView {
                    public_points: s.public,
                    buildings: s.buildings,
                    monuments: s.monuments,
                    titles: s.titles,
                    beasts: s.beasts,
                    raids: s.raids,
                    hand_size: g.players[p].hand.len(),
                    gold: g.players[p].gold(),
                    production: ByRes(g.production(p).map(Some)),
                    last_made: last_made(g, p),
                    bank_rates: Rates(g.bank_rates(p)),
                }
            })
            .collect(),
        titles: TITLES.iter().enumerate().map(|(i, (key, name))| TitleView { key, name, holder: g.titles.all()[i], values: g.title_values(i), min: min[i] }).collect(),
        beasts: DATA
            .beasts
            .iter()
            .map(|(key, x)| BeastView {
                key,
                name: x.name,
                hex: g.map.iter().find(|(_, h)| h.fauna.is_some_and(|f| f.0 == *key)).map(|(k, _)| *k),
                slain_by: g.slain.get(&Key(key)).copied(),
                points: x.points,
                hp: x.hp,
                weak: &DATA.element_weak[x.element],
            })
            .collect(),
        peak_bonus: t.peak_bonus,
        map: g
            .map
            .iter()
            .map(|(k, h)| {
                let b = g.buildings.get(k);
                let held = if h.beast() || h.ocean() { None } else { k.neighbors().iter().filter_map(|n| g.map.get(n)).find(|n| n.beast()).map(|n| n.fauna.unwrap().0) };
                HexView {
                    held,
                    peak: (*k == PEAK).then_some(if h.fauna.is_some() { "held" } else { "free" }),
                    peak_zone: (!h.ocean() && g.on_peak(*k)).then_some(t.peak_bonus),
                    suppressed: (b.is_some() && g.blocked(*k)).then_some(true),
                    k: *k,
                    q: h.q,
                    r: h.r,
                    terrain: h.terrain.0,
                    building: b.map(|b| BuildingView {
                        kind: b.kind.0,
                        cls: building_class(b)[0],
                        name: b.name(),
                        owner: b.owner,
                        upgrades: &b.upgrades,
                        upgrade_name: upgrade_names(&b.upgrades),
                        floors: b.floors,
                        does: does(g, *k, b, &b.upgrades),
                    }),
                    fauna: h.fauna.map(|f| fauna_view(f.0, g.fauna_loot(*k))),
                    perched: g.perched_on(*k).map(|d| Perched { d: d.id, owner: d.owner, element: d.def().element }).collect(),
                }
            })
            .collect(),
        dragons: g.dragons.iter().map(dragon_view).collect(),
        offers: g.offers.iter().map(|o| OfferView { id: o.id, from: o.from, to: o.to, passed: o.passed(), give: side_text(g, &o.give), get: side_text(g, &o.get) }).collect(),
        raid: g.raid.as_ref().map(|r| RaidView {
            step: r.step,
            candidates: r.candidates.iter().map(|t| target_view(g, t.0, None)).collect(),
            votes: &r.votes,
            voters: (0..n).map(|p| g.can_vote(p)).collect(),
            vote_power: (0..n).map(|p| g.vote_power(p)).collect(),
            target: r.target.map(|t| target_view(g, t.0, Some(&r.units))),
            sent: &r.sent,
            decided: r.choices.iter().map(|c| c.is_some()).collect(),
            fighting: (0..n).map(|p| r.fighters.iter().any(|d| g.dragon(*d).owner == p)).collect(),
            fighters: &r.fighters,
        }),
        kingdoms: DATA.targets.keys().map(|t| target_view(g, t, None)).collect(),
        raids_left: g.raids_left,
        winner: g.winner,
        final_totals: over.then(|| g.totals()),
        standings: over.then(|| g.standings()),
        log: events(g, |e| e.to.is_none() && !is_talk(&e.text), 60, 0),
        talk: events(g, |e| e.to.is_none() && is_talk(&e.text), 12, 0),
    }
}

const NO_ROOM: &str = "No room for another dragon: build a roost first.";
fn no_upgrade_hex(u: &UpgradeDef) -> String {
    let what = if DATA.production_classes.iter().all(|c| u.applies_to.contains(c)) { "production building".into() } else { or_list(&u.applies_to.iter().map(|c| DATA.class_names[c]).collect::<Vec<_>>()) };
    format!("You have no {what}.")
}
fn no_hex(b: &BuildingDef) -> String {
    format!("No empty {} is adjacent to your buildings{}.", b.terrain.map_or("land hex", |t| DATA.terrain_noun[t]), b.beside.map_or(String::new(), |w| format!(" and to {}", beside_text(w))))
}
fn place_text(b: &BuildingDef) -> String {
    let terrain = b.terrain.map_or(String::new(), |t| format!(" Build on a {}.", DATA.terrain_noun[t]));
    let beside = b.beside.map_or(String::new(), |w| format!(" Build adjacent to {}.", beside_text(w)));
    format!("{}{terrain}{beside}", b.text)
}

fn card_view(g: &Game, p: usize, c: &Card) -> CardView {
    let pl = &g.players[p];
    let key = c.key.0;
    let mut v = CardView {
        id: c.id,
        kind: c.kind(),
        key: c.key,
        name: c.name(),
        cost: c.cost().nonzero(),
        affordable: pl.can_afford(c.cost()),
        hexes: vec![],
        dragons: vec![],
        blocked: None,
        text: String::new(),
        needs: "none",
        verb: "Play",
        why: None,
        cls: None,
        counts: None,
        after: None,
        element: None,
        dragon: None,
        fauna: None,
    };
    match v.kind {
        "building" => {
            let b = &DATA.buildings[key];
            v.verb = "Build";
            v.text = place_text(b);
            v.cls = Some(b.class);
            if !b.on_tower {
                v.needs = "hex";
                v.hexes = g.buildable_hexes(p, key);
                v.blocked = v.hexes.is_empty().then(|| no_hex(b));
            }
            v.counts = b.per.map(|_| Pairs(v.hexes.iter().map(|k| (*k, g.per_count(*k, b, p))).collect()));
            v.after = Some(does_if_built(g, p, key, &v.hexes));
        }
        "upgrade" => {
            let u = &DATA.upgrades[key];
            v.verb = "Upgrade";
            v.text = u.text.into();
            v.needs = "hex";
            v.hexes = g.upgrade_targets(p, key);
            v.after = Some(does_if_upgraded(g, key, &v.hexes));
            v.blocked = v.hexes.is_empty().then(|| no_upgrade_hex(u));
        }
        "dragon" => {
            let d = &DATA.dragons[key];
            let adult = &d.stages[2];
            v.verb = "Hatch";
            v.text = format!(
                "{}{} dragon. Hatches as an egg and grows every {} step{}. Adult: Health {}, Attack {}; {}.",
                d.element[..1].to_uppercase(),
                &d.element[1..],
                d.growth_time,
                if d.growth_time > 1 { "s" } else { "" },
                adult.hp,
                adult.text(),
                DATA.targeting_text[d.targeting]
            );
            v.element = Some(d.element);
            v.dragon = Some(DragonCard { growth: d.growth_time, targeting: DATA.targeting_text[d.targeting], stages: stage_views(d) });
            v.blocked = (g.housed(p) >= g.dragon_capacity(p)).then(|| NO_ROOM.into());
        }
        _ => {
            let a = &DATA.actions[key];
            v.text = a.text.into();
            match a.effect {
                "hidden_point" => {
                    v.needs = "unplayable";
                    v.blocked = Some("It’s never played.".into());
                }
                "gain_resource" => v.needs = "resource",
                "grow_dragon" => {
                    v.needs = "dragon";
                    v.dragons = g.dragons_of(p).filter(|d| d.stage < 3).map(|d| d.id).collect();
                    v.blocked = v.dragons.is_empty().then(|| "All your dragons are adults.".into());
                }
                "heal_dragon" => {
                    v.needs = "dragon";
                    v.dragons = g.dragons_of(p).filter(|d| d.damage > 0).map(|d| d.id).collect();
                    v.blocked = v.dragons.is_empty().then(|| "None of your dragons is hurt.".into());
                }
                "send_fauna" => {
                    v.verb = "Place";
                    v.needs = "hex";
                    v.fauna = a.fauna.map(|f| fauna_view(f, Bundle::default()));
                    v.hexes = g.fauna_hexes();
                }
                _ => {}
            }
        }
    }
    v.why = v.blocked.clone().or_else(|| pl.afford(c.cost())).or_else(|| (!(g.phase == Phase::Action && g.turn == p)).then(|| format!("{} it on your turn.", v.verb)));
    v
}

pub fn seat_state(g: &Game, p: usize) -> SeatState<'_> {
    let pl = &g.players[p];
    let s = g.score(p);
    let raid = g.raid.as_ref();
    let housed = g.housed(p);
    let capacity = g.dragon_capacity(p);
    let room = housed < capacity;
    let egg = egg_cost("fire_whelp");
    let mut shut = [false; 5];
    for (k, b) in g.buildings.iter().filter(|(k, b)| b.owner == p && g.blocked(**k)) {
        for (r, m) in g.building_yield(*k, b, &b.upgrades).makes.iter().enumerate() {
            shut[r] |= m.is_some();
        }
    }
    let eats = g.dragons_of(p).filter(|d| d.stage > 0).count() as i64 * tuning().livestock_per_dragon;
    let mut r = 0;
    let income = g.production(p).map(|make| {
        r += 1;
        Some(Income { make, eat: if r - 1 == LIVESTOCK { eats } else { 0 }, blocked: shut[r - 1] })
    });
    SeatState {
        seat: p,
        resources: &pl.resources,
        hidden_points: s.hidden,
        total_points: s.total,
        bank_rates: Rates(g.bank_rates(p)),
        dragons_housed: housed,
        dragon_capacity: capacity,
        income: ByRes(income),
        hand: pl.hand.iter().map(|c| card_view(g, p, c)).collect(),
        choice: pl.choice.iter().map(|c| card_view(g, p, c)).collect(),
        hand_cap: tuning().hand_cap,
        my_turn: g.phase == Phase::Action && g.turn == p,
        deciding: g.waiting_on().contains(&p),
        basics: DATA
            .basic_buildings
            .iter()
            .map(|k| {
                let b = &DATA.buildings[k];
                let hexes = g.buildable_hexes(p, k);
                let why = (!b.on_tower && hexes.is_empty()).then(|| no_hex(b)).or_else(|| pl.afford(&b.cost));
                Basic { key: k, cls: b.class, name: b.name, text: place_text(b), cost: b.cost.nonzero(), affordable: pl.can_afford(&b.cost), after: does_if_built(g, p, k, &hexes), hexes, on_tower: b.on_tower, why }
            })
            .collect(),
        egg_project: EggProject { cost: egg.nonzero(), affordable: pl.can_afford(&egg), elements: ELEMENTS, room, why: if room { pl.afford(&egg) } else { Some(NO_ROOM.into()) } },
        upgrade_projects: project_upgrades()
            .map(|key| {
                let u = &DATA.upgrades[key];
                let cost = upgrade_project_cost(key);
                let hexes = g.upgrade_targets(p, key);
                let why = hexes.is_empty().then(|| no_upgrade_hex(u)).or_else(|| pl.afford(&cost));
                UpgradeProject { key, name: u.name, text: u.text, cost: cost.nonzero(), affordable: pl.can_afford(&cost), after: does_if_upgraded(g, key, &hexes), hexes, why }
            })
            .collect(),
        raid_ready: g.ready(p),
        huntable: g.huntable(p),
        auto_clear: g.auto_clear_targets(p),
        perchable: g.perch_hexes(p),
        perched: g.dragons_of(p).filter(|d| d.perch.is_some()).map(|d| d.id).collect(),
        cant_accept: Pairs(g.offers.iter().filter(|o| o.waits_on(p)).filter_map(|o| g.accept_problem(o, p).map(|why| (o.id, why))).collect()),
        my_vote: raid.and_then(|r| r.votes[p]),
        why_no_vote: raid.filter(|r| r.step == Step::Vote && !g.can_vote(p)).map(|_| NO_VOTE),
        my_fight: raid.and_then(|r| r.choices[p].as_deref()),
        log: events(g, |e| e.to.as_ref().is_some_and(|t| t.contains(&p)) && !is_talk(&e.text), 15, 0),
        talk: events(g, |e| is_talk(&e.text) && e.seen_by(p), 40, 0),
    }
}
