//! The rules engine. `apply` is the only way to change a game; its dice and log
//! are in the game, so a saved one goes on the same.
use crate::command::{self, Command, Seat, To};
use crate::data::*;
use crate::map::*;
use crate::rng::Rng;
use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::value::RawValue;
use std::fmt;
use std::mem;

/// What happened, as JSON text: the server sends events on, and reads few of them.
macro_rules! ev {
    ($($t:tt)*) => { serde_json::value::to_raw_value(&serde_json::json!({$($t)*})).unwrap() };
}

/// A card's, dragon's or offer's id: "c12".
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Id(pub u8, pub u32);
impl fmt::Display for Id {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self.0 {
            0 => f.write_str(odd_ids().get(self.1 as usize).copied().unwrap_or("?")),
            c => write!(f, "{}{}", c as char, self.1),
        }
    }
}
// Ids the engine didn't make (a test's "cX"), by number.
static ODD: std::sync::Mutex<Vec<S>> = std::sync::Mutex::new(Vec::new());
fn odd_ids() -> std::sync::MutexGuard<'static, Vec<S>> {
    ODD.lock().unwrap_or_else(|e| e.into_inner())
}
impl Id {
    /// The id this names, whatever it looks like: for saved games, not for what players send.
    fn saved(s: &str) -> Id {
        Id::parse(s).unwrap_or_else(|| {
            let mut odd = odd_ids();
            odd.push(Box::leak(s.to_string().into_boxed_str()));
            Id(0, odd.len() as u32 - 1)
        })
    }
    pub fn parse(s: &str) -> Option<Id> {
        if let Some(i) = odd_ids().iter().position(|x| *x == s) {
            return Some(Id(0, i as u32));
        }
        let (a, n) = (s.as_bytes().first()?, s.get(1..)?);
        if n.is_empty() || (n.len() > 1 && n.starts_with('0')) || !n.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        Some(Id(*a, n.parse().ok()?))
    }
}
impl Serialize for Id {
    fn serialize<Z: Serializer>(&self, s: Z) -> Result<Z::Ok, Z::Error> {
        s.collect_str(self)
    }
}
impl<'de> Deserialize<'de> for Id {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Id, D::Error> {
        Ok(Id::saved(&String::deserialize(d)?))
    }
}
pub fn ids(ds: &[Id]) -> String {
    ds.iter().map(|d| d.to_string()).collect::<Vec<_>>().join(" ")
}

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Deck {
    Building,
    Action,
}
#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
pub struct Card {
    pub id: Id,
    pub deck: Deck,
    pub key: Key,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Building {
    #[serde(rename = "type")]
    pub kind: Key,
    pub owner: usize,
    pub upgrades: Vec<Key>,
    pub floors: i64,
}
impl Building {
    pub fn tower(&self) -> bool {
        self.kind.0 == "tower"
    }
    pub fn def(&self) -> &'static BuildingDef {
        &DATA.buildings[self.kind.0]
    }
    pub fn name(&self) -> S {
        if self.tower() { "Tower" } else { self.def().name }
    }
}
fn is_false(b: &bool) -> bool {
    !*b
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Dragon {
    pub id: Id,
    pub owner: usize,
    pub key: Key,
    pub stage: usize,
    pub growth: i64,
    pub damage: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub perch: Option<K>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub hungry: bool,
}
impl Dragon {
    pub fn def(&self) -> &'static DragonDef {
        &DATA.dragons[self.key.0]
    }
    pub fn name(&self) -> S {
        self.def().name
    }
    pub fn stats(&self) -> Option<Attack> {
        (self.stage > 0).then(|| self.def().stages[self.stage - 1])
    }
    pub fn power(&self) -> i64 {
        self.stats().map_or(0, |s| s.power())
    }
    pub fn health(&self) -> i64 {
        self.stats().map_or(0, |s| (s.hp - self.damage).max(0))
    }
    /// Raid-ready: hatched, with health left, and home.
    pub fn ready(&self) -> bool {
        self.stats().is_some_and(|s| self.damage < s.hp) && self.perch.is_none()
    }
}
#[derive(Clone, Debug)]
pub struct Purse(pub [i64; 5]);
impl Serialize for Purse {
    fn serialize<Z: Serializer>(&self, s: Z) -> Result<Z::Ok, Z::Error> {
        Bundle(self.0.map(Some)).serialize(s)
    }
}
impl<'de> Deserialize<'de> for Purse {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Purse, D::Error> {
        Ok(Purse(Bundle::deserialize(d)?.0.map(|n| n.unwrap_or(0))))
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Player {
    pub resources: Purse,
    pub hand: Vec<Card>,
    pub choice: Vec<Card>,
}
impl Player {
    pub fn can_afford(&self, cost: &Bundle) -> bool {
        (0..5).all(|r| self.resources.0[r] >= cost.get(r))
    }
    pub fn afford(&self, cost: &Bundle) -> Option<String> {
        (!self.can_afford(cost)).then(|| format!("You can't afford {}.", cost.text()))
    }
    fn pay(&mut self, cost: &Bundle) -> Rule {
        if let Some(why) = self.afford(cost) {
            return Err(why);
        }
        for r in 0..5 {
            self.resources.0[r] -= cost.get(r);
        }
        Ok(())
    }
    fn gain(&mut self, b: &Bundle) {
        for r in 0..5 {
            self.resources.0[r] += b.get(r);
        }
    }
    pub fn gold(&self) -> i64 {
        self.resources.0[GOLD]
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TradeSide {
    pub res: Bundle,
    pub cards: Vec<String>,
}
impl TradeSide {
    fn nothing(&self) -> bool {
        self.cards.is_empty() && self.res.0.iter().all(|n| n.unwrap_or(0) == 0)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Offer {
    pub id: Id,
    pub from: usize,
    pub to: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passed: Option<Vec<usize>>,
    pub give: TradeSide,
    pub get: TradeSide,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Closed {
    Expired,
    Withdrawn,
    Declined,
    Accepted,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClosedOffer {
    pub id: Id,
    pub from: usize,
    pub to: Option<usize>,
    pub how: Closed,
    /// Who accepted it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<usize>,
}
const CLOSED_KEPT: usize = 60;
impl Offer {
    pub fn passed(&self) -> &[usize] {
        self.passed.as_deref().unwrap_or(&[])
    }
    /// Whether the offer waits on p's answer.
    pub fn waits_on(&self, p: usize) -> bool {
        match self.to {
            None => self.from != p && !self.passed().contains(&p),
            Some(to) => to == p,
        }
    }
}
#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    Vote,
    Choose,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RaidUnit {
    pub key: Key,
    pub hp: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Raid {
    pub step: Step,
    pub candidates: Vec<Key>,
    pub votes: Vec<Option<usize>>,
    pub target: Option<Key>,
    pub sent: Vec<Vec<Id>>,
    pub choices: Vec<Option<Vec<Id>>>,
    pub units: Vec<RaidUnit>,
    pub fighters: Vec<Id>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Die {
    pub sides: i64,
    pub value: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<Key>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LogEntry {
    pub round: i64,
    pub text: Box<str>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ev: Option<Box<RawValue>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<Box<[usize]>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dice: Option<Box<[Die]>>,
}
impl LogEntry {
    pub fn raw(&self) -> &str {
        self.ev.as_ref().map_or("", |e| e.get())
    }
    /// Its kind: the event's `k`, which the engine always writes first.
    pub fn kind(&self) -> &str {
        self.raw().strip_prefix("{\"k\":\"").and_then(|r| r.split('"').next()).unwrap_or("")
    }
    pub fn ev<'a, T: Deserialize<'a>>(&'a self) -> Option<T> {
        serde_json::from_str(self.raw()).ok()
    }
    pub fn seen_by(&self, p: usize) -> bool {
        self.to.as_ref().is_none_or(|t| t.contains(&p))
    }
}
#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Cards,
    Action,
    Raid,
    Discard,
    Over,
}
#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
pub struct Titles {
    pub army: Option<usize>,
    pub tower: Option<usize>,
    pub hoard: Option<usize>,
}
impl Titles {
    pub fn all(&self) -> [Option<usize>; 3] {
        [self.army, self.tower, self.hoard]
    }
    pub fn set(&mut self, t: usize, p: Option<usize>) {
        *[&mut self.army, &mut self.tower, &mut self.hoard][t] = p;
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Decks {
    pub building: Vec<Card>,
    pub action: Vec<Card>,
}
impl Decks {
    fn of(&mut self, d: Deck) -> &mut Vec<Card> {
        match d {
            Deck::Building => &mut self.building,
            Deck::Action => &mut self.action,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub version: i64,
    pub players: Vec<Player>,
    pub round: i64,
    pub phase: Phase,
    pub turn: usize,
    pub map: Hexes<Hex>,
    pub buildings: Hexes<Building>,
    pub towers: Vec<K>,
    pub dragons: Vec<Dragon>,
    pub decks: Decks,
    pub discards: Decks,
    pub offers: Vec<Offer>,
    /// The latest offers no longer open, so a late answer to one hears why.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub closed_offers: Vec<ClosedOffer>,
    pub raids_left: i64,
    pub raid: Option<Raid>,
    #[serde(default)]
    pub hoard: IndexMap<Key, i64>,
    pub titles: Titles,
    #[serde(default)]
    pub slain: IndexMap<Key, usize>,
    #[serde(default)]
    pub raid_points: Vec<i64>,
    #[serde(default)]
    pub beast_tried: Vec<i64>,
    pub winner: Option<usize>,
    pub next_id: u32,
    pub log: Vec<LogEntry>,
    pub rng: Rng,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_seat: Option<usize>,
}

pub type Rule<T = ()> = Result<T, String>;
fn fail<T>(m: impl Into<String>) -> Rule<T> {
    Err(m.into())
}
pub fn pname(p: usize) -> String {
    format!("P{}", p + 1)
}
fn pnames(ps: &[usize]) -> Vec<String> {
    ps.iter().map(|p| pname(*p)).collect()
}
fn n_cards(n: usize) -> String {
    format!("{n} card{}", if n == 1 { "" } else { "s" })
}
fn points_text(n: i64) -> String {
    format!("{n} point{}", if n == 1 { "" } else { "s" })
}
const STAGE_INTO: [S; 4] = ["an egg", "a hatchling", "a young dragon", "an adult"];

// What JavaScript's \s and trim() take as a space.
pub fn js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(js_space)
}
impl Card {
    pub fn kind(&self) -> S {
        let k = self.key.0;
        if DATA.buildings.contains_key(k) {
            "building"
        } else if DATA.upgrades.contains_key(k) {
            "upgrade"
        } else if DATA.actions.contains_key(k) {
            "action"
        } else {
            "dragon"
        }
    }
    pub fn name(&self) -> S {
        let k = self.key.0;
        match self.kind() {
            "building" => DATA.buildings[k].name,
            "upgrade" => DATA.upgrades[k].name,
            "action" => DATA.actions[k].name,
            _ => DATA.dragons[k].name,
        }
    }
    pub fn cost(&self) -> &'static Bundle {
        let k = self.key.0;
        match self.kind() {
            "building" => &DATA.buildings[k].cost,
            "upgrade" => &DATA.upgrades[k].cost,
            "action" => &DATA.actions[k].cost,
            _ => &DATA.dragons[k].cost,
        }
    }
    fn named(&self) -> String {
        format!("{} ({})", self.name(), self.id)
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Side {
    Dragons,
    Defenders,
}
impl Side {
    fn key(self) -> S {
        if self == Side::Dragons { "dragons" } else { "defenders" }
    }
    fn text(self, them: &str, many: bool) -> String {
        match self {
            Side::Dragons => "Coin flip: the dragons strike first.".into(),
            Side::Defenders => format!("Coin flip: {them} {} first.", if many { "strike" } else { "strikes" }),
        }
    }
}
// A defender: a unit or beast by its key, or a perched dragon.
struct Foe {
    key: Key,
    hp: i64,
    d: Option<Id>,
}
struct Battle {
    units: Vec<Foe>,
    fighters: Vec<Id>,
}
impl Battle {
    fn cleared(&self) -> bool {
        self.units.iter().all(|u| u.hp <= 0)
    }
}
struct FoeStats {
    name: S,
    attack: Attack,
    element: S,
}

/// What a building makes of one resource: a fixed amount and dice.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Make {
    pub base: i64,
    pub dice: Vec<i64>,
}
pub type Makes = [Option<Make>; 5];
pub struct Yield {
    pub makes: Makes,
    pub houses: i64,
    pub points: i64,
}

#[derive(Clone, Copy, Default)]
pub struct Score {
    pub buildings: i64,
    pub monuments: i64,
    pub titles: i64,
    pub beasts: i64,
    pub raids: i64,
    pub hidden: i64,
    pub public: i64,
    pub total: i64,
}
#[derive(Clone, Serialize)]
pub struct Standing {
    pub p: usize,
    pub total: i64,
    pub place: usize,
    pub tied: bool,
    pub tiebreak: Option<S>,
}

pub fn project_dragon(element: &str) -> Key {
    Key::of(DATA.dragons.iter().find(|(_, d)| d.base && d.element == element).unwrap().0)
}
pub fn project_upgrades() -> impl Iterator<Item = S> {
    DATA.upgrades.iter().filter(|(_, u)| u.base).map(|(k, _)| *k)
}
pub fn egg_cost(key: &str) -> Bundle {
    DATA.dragons[key].cost.scale(tuning().special_project_multiplier.egg)
}
pub fn upgrade_project_cost(key: &str) -> Bundle {
    DATA.upgrades[key].cost.scale(tuning().special_project_multiplier.upgrade)
}
pub fn beside_text(what: &str) -> String {
    let noun = DATA.terrain_noun.get(what).copied().unwrap_or_else(|| if what == "production" { "production building" } else { DATA.class_names[what] });
    format!("{} {noun}", if noun.starts_with(['a', 'e', 'i', 'o', 'u']) { "an" } else { "a" })
}
pub fn made_resource(def: &BuildingDef) -> Option<usize> {
    def.produces.as_ref().and_then(|p| resource(p.resource)).or_else(|| (0..5).find(|r| def.makes.get(*r) != 0))
}
fn tower_houses(floors: i64) -> i64 {
    tuning().tower_dragon_capacity + floors * DATA.buildings["tower_floor"].dragon_capacity
}
pub fn building_class(b: &Building) -> &'static [S] {
    if b.tower() { &DATA.tower_classes } else { std::slice::from_ref(&b.def().class) }
}
pub fn split_loot(loot: &Bundle, power: &[i64], order: &[usize]) -> Vec<Bundle> {
    let total: i64 = power.iter().sum();
    let winners: Vec<usize> = (0..power.len()).filter(|p| power[*p] != 0).collect();
    let at = |p: usize| order.iter().position(|x| *x == p);
    let mut by_power = winners.clone();
    by_power.sort_by(|a, b| power[*b].cmp(&power[*a]).then(at(*a).cmp(&at(*b))));
    let mut shares = vec![Bundle::default(); power.len()];
    let mut next = 0;
    for r in 0..5 {
        let all = loot.get(r);
        let mut left = all;
        for p in &winners {
            let n = all * power[*p] / total;
            if n != 0 {
                shares[*p].0[r] = Some(n);
            }
            left -= n;
        }
        while left > 0 && !by_power.is_empty() {
            shares[by_power[next % by_power.len()]].add(r, 1);
            left -= 1;
            next += 1;
        }
    }
    shares
}

impl Game {
    pub fn new(players: usize, seed: i64, first: Option<usize>) -> Game {
        let mut rng = Rng::new(seed);
        let map = generate_map(&mut rng, players);
        let first = first.unwrap_or_else(|| Rng::new((seed as i32 ^ 0x51a7) as i64).roll(players as i64) as usize - 1);
        let mut g = Game {
            version: 1,
            players: vec![],
            round: 0,
            phase: Phase::Action,
            turn: 0,
            map,
            buildings: Hexes::default(),
            towers: tower_spots(players),
            dragons: vec![],
            decks: Decks::default(),
            discards: Decks::default(),
            offers: vec![],
            closed_offers: vec![],
            raids_left: 0,
            raid: None,
            hoard: DATA.targets.keys().map(|t| (Key::of(t), 0)).collect(),
            titles: Titles { army: None, tower: None, hoard: None },
            slain: IndexMap::new(),
            raid_points: vec![0; players],
            beast_tried: vec![0; players],
            winner: None,
            next_id: 1,
            log: vec![],
            rng,
            first_seat: Some(first),
        };
        let cards = |m: Vec<(S, usize)>| m.into_iter().flat_map(|(k, n)| vec![Key::of(k); n]).collect::<Vec<_>>();
        let building = cards(DATA.buildings.iter().map(|(k, d)| (*k, d.copies)).chain(DATA.upgrades.iter().map(|(k, d)| (*k, d.copies))).collect());
        let action = cards(DATA.actions.iter().map(|(k, d)| (*k, d.copies)).chain(DATA.dragons.iter().map(|(k, d)| (*k, d.copies))).collect());
        g.decks.building = g.build_deck(Deck::Building, building);
        g.decks.action = g.build_deck(Deck::Action, action);
        for p in 0..players {
            g.players.push(Player { resources: Purse(tuning().starting_resources.0.map(|n| n.unwrap_or(0))), hand: vec![], choice: vec![] });
            g.buildings.insert(g.towers[p], Building { kind: Key::of("tower"), owner: p, upgrades: vec![], floors: 0 });
            let id = g.id(b'd');
            g.dragons.push(Dragon { id, owner: p, key: project_dragon("fire"), stage: tuning().starting_dragon_stage, growth: 0, damage: 0, perch: None, hungry: false });
        }
        g.log(format!("A {players}-player game begins. {} goes first. First to {} points wins.", pname(first), points_to_win()), ev! {"k": "begin", "players": players, "first": first});
        g.start_round();
        g
    }

    pub fn clone_without_log(&self) -> Game {
        Game {
            version: self.version,
            players: self.players.clone(),
            round: self.round,
            phase: self.phase,
            turn: self.turn,
            map: self.map.clone(),
            buildings: self.buildings.clone(),
            towers: self.towers.clone(),
            dragons: self.dragons.clone(),
            decks: self.decks.clone(),
            discards: self.discards.clone(),
            offers: self.offers.clone(),
            closed_offers: self.closed_offers.clone(),
            raids_left: self.raids_left,
            raid: self.raid.clone(),
            hoard: self.hoard.clone(),
            titles: self.titles,
            slain: self.slain.clone(),
            raid_points: self.raid_points.clone(),
            beast_tried: self.beast_tried.clone(),
            winner: self.winner,
            next_id: self.next_id,
            log: vec![],
            rng: self.rng,
            first_seat: self.first_seat,
        }
    }
    fn build_deck(&mut self, deck: Deck, mut keys: Vec<Key>) -> Vec<Card> {
        self.rng.shuffle(&mut keys);
        keys.into_iter().map(|key| Card { id: self.id(b'c'), deck, key }).collect()
    }
    fn id(&mut self, prefix: u8) -> Id {
        self.next_id += 1;
        Id(prefix, self.next_id - 1)
    }
    fn log(&mut self, text: impl Into<String>, ev: Box<RawValue>) {
        self.log_to(text, ev, None, None)
    }
    fn log_to(&mut self, text: impl Into<String>, ev: Box<RawValue>, to: Option<Vec<usize>>, dice: Option<Vec<Die>>) {
        self.log.push(LogEntry { round: self.round, text: text.into().into_boxed_str(), ev: Some(ev), to: to.map(|t| t.into()), dice: dice.map(|d| d.into()) });
    }
    /// For one player alone.
    fn mine(&mut self, p: usize, text: String) {
        self.log_to(text, ev! {"k": "mine"}, Some(vec![p]), None)
    }

    // ---------- derived values ----------

    fn n(&self) -> usize {
        self.players.len()
    }
    pub fn dragons_of(&self, p: usize) -> impl Iterator<Item = &Dragon> {
        self.dragons.iter().filter(move |d| d.owner == p)
    }
    pub fn ready(&self, p: usize) -> Vec<Id> {
        self.dragons_of(p).filter(|d| d.ready()).map(|d| d.id).collect()
    }
    pub fn dragon(&self, id: Id) -> &Dragon {
        self.dragons.iter().find(|d| d.id == id).expect("a dragon in the game")
    }
    fn dragon_mut(&mut self, id: Id) -> &mut Dragon {
        self.dragons.iter_mut().find(|d| d.id == id).expect("a dragon in the game")
    }
    pub fn perched_on(&self, k: K) -> impl Iterator<Item = &Dragon> {
        self.dragons.iter().filter(move |d| d.perch == Some(k))
    }
    pub fn rivals_perched(&self, p: usize, k: K) -> Vec<&Dragon> {
        self.perched_on(k).filter(|d| d.owner != p).collect()
    }
    /// Is the building on hex k shut down? Nothing stops a tower.
    pub fn blocked(&self, k: K) -> bool {
        if self.buildings.get(&k).is_some_and(|b| b.tower()) {
            return false;
        }
        near_beast(&self.map, k) || self.map.get(&k).is_some_and(|h| h.fauna.is_some()) || self.perched_on(k).next().is_some()
    }
    /// Player p's buildings that count: not suppressed.
    pub fn owned(&self, p: usize) -> impl Iterator<Item = (K, &Building)> {
        self.buildings.iter().filter(move |(k, b)| b.owner == p && !self.blocked(**k)).map(|(k, b)| (*k, b))
    }
    fn counts(&self, k: K, what: &str) -> bool {
        if self.map.get(&k).is_some_and(|h| h.terrain.0 == what) {
            return true;
        }
        let Some(b) = self.buildings.get(&k) else { return false };
        let is = building_class(b).iter().any(|c| if what == "production" { DATA.production_classes.contains(c) } else { *c == what });
        is && !self.blocked(k)
    }
    pub fn neighbour_count(&self, k: K, what: &str) -> i64 {
        k.neighbors().into_iter().filter(|n| self.counts(*n, what)).count() as i64
    }
    pub fn per_count(&self, k: K, def: &BuildingDef, p: usize) -> i64 {
        let Some(per) = def.per else { return 1 };
        let n = k.neighbors().into_iter().filter(|n| self.counts(*n, per) && (!def.per_own || self.buildings.get(n).is_some_and(|b| b.owner == p))).count() as i64;
        def.per_max.map_or(n, |m| n.min(m))
    }
    fn placed(&self, p: usize) -> impl Iterator<Item = (&'static BuildingDef, i64)> {
        self.owned(p).filter(|(_, b)| !b.tower()).map(move |(k, b)| (b.def(), self.per_count(k, b.def(), b.owner)))
    }
    pub fn dragon_capacity(&self, p: usize) -> i64 {
        let mut cap = tower_houses(self.buildings.get(&self.towers[p]).map_or(0, |b| b.floors));
        cap += self.placed(p).map(|(d, n)| d.dragon_capacity * n).sum::<i64>();
        cap + self.owned(p).flat_map(|(_, b)| b.upgrades.iter()).map(|u| DATA.upgrades[u.0].dragon_capacity).sum::<i64>()
    }
    pub fn housed(&self, p: usize) -> i64 {
        self.dragons_of(p).count() as i64
    }
    pub fn bank_rates(&self, p: usize) -> [i64; 4] {
        let mut rates = [tuning().bank_rate; 4];
        for (d, _) in self.placed(p) {
            if let Some(b) = &d.bank_rate {
                let r = resource(b.resource).unwrap();
                rates[r] = rates[r].min(b.rate);
            }
        }
        rates
    }
    fn growth_per_round(&self, p: usize) -> i64 {
        1 + self.placed(p).map(|(d, n)| d.growth_bonus * n).sum::<i64>()
    }
    pub fn building_points(&self, b: &Building, upgrades: &[Key]) -> i64 {
        let up: i64 = upgrades.iter().map(|u| DATA.upgrades.get(u.0).map_or(0, |u| u.points)).sum();
        up + if b.tower() { 0 } else { b.def().points }
    }
    pub fn on_peak(&self, k: K) -> bool {
        self.slain.contains_key(&Key("thunderbird")) && (k == PEAK || PEAK.adjacent(k))
    }
    /// What building b does each round at hex k (standing there or not), with these upgrades.
    pub fn building_yield(&self, k: K, b: &Building, upgrades: &[Key]) -> Yield {
        let up_houses: i64 = upgrades.iter().map(|u| DATA.upgrades[u.0].dragon_capacity).sum();
        let mut makes = Makes::default();
        fn add(makes: &mut Makes, r: usize, base: i64, die: Option<i64>) {
            if base == 0 && die.is_none() {
                return;
            }
            let m = makes[r].get_or_insert_default();
            m.base += base;
            m.dice.extend(die);
        }
        if b.tower() {
            for r in 0..5 {
                add(&mut makes, r, tuning().tower_production.get(r), None);
            }
            return Yield { makes, houses: tower_houses(b.floors) + up_houses, points: 0 };
        }
        let def = b.def();
        let n = self.per_count(k, def, b.owner);
        if let Some(p) = &def.produces {
            add(&mut makes, resource(p.resource).unwrap(), p.base, Some(p.die).filter(|d| *d != 0));
        }
        for r in 0..5 {
            add(&mut makes, r, def.makes.get(r) * n, None);
        }
        if let Some(made) = made_resource(def) {
            for (i, u) in upgrades.iter().enumerate() {
                let d = &DATA.upgrades[u.0];
                let first = upgrades.iter().position(|x| x == u) == Some(i);
                add(&mut makes, made, if first { d.base_bonus } else { d.stack_bonus.or(d.base_bonus) }.unwrap_or(0), None);
            }
            if self.on_peak(k) {
                add(&mut makes, made, tuning().peak_bonus, None);
            }
        }
        Yield { makes, houses: def.dragon_capacity * n + up_houses, points: self.building_points(b, upgrades) }
    }
    pub fn production(&self, p: usize) -> [Make; 5] {
        let mut out: [Make; 5] = Default::default();
        for (k, b) in self.owned(p) {
            for (r, m) in self.building_yield(k, b, &b.upgrades).makes.into_iter().enumerate() {
                if let Some(m) = m {
                    out[r].base += m.base;
                    out[r].dice.extend(m.dice);
                }
            }
        }
        out
    }
    pub fn title_values(&self, t: usize) -> Vec<i64> {
        (0..self.n())
            .map(|p| match t {
                0 => self.dragons_of(p).map(|d| d.power()).sum(),
                1 => self.buildings[&self.towers[p]].floors,
                _ => self.players[p].gold(),
            })
            .collect()
    }
    fn update_titles(&mut self) {
        let min = &tuning().title_minimum;
        for (t, (key, name)) in TITLES.iter().enumerate() {
            let vals = self.title_values(t);
            let best = *vals.iter().max().unwrap();
            let leaders: Vec<usize> = (0..vals.len()).filter(|p| vals[*p] == best).collect();
            let holder = self.titles.all()[t];
            let next = if best < [min.army, min.tower, min.hoard][t] {
                None
            } else if holder.is_some_and(|h| leaders.contains(&h)) {
                holder
            } else if leaders.len() == 1 {
                Some(leaders[0])
            } else {
                None
            };
            if next != holder {
                self.titles.set(t, next);
                let text = next.map_or(format!("No one holds {name} now."), |p| format!("{} takes {name}.", pname(p)));
                self.log(text, ev! {"k": "title", "t": key, "p": next});
            }
        }
    }
    pub fn score(&self, p: usize) -> Score {
        let mut s = Score::default();
        for (_, b) in self.owned(p) {
            let n = self.building_points(b, &b.upgrades);
            s.buildings += n;
            if !b.tower() && b.def().class == "monument" {
                s.monuments += n;
            }
        }
        s.titles = self.titles.all().iter().filter(|h| **h == Some(p)).count() as i64 * tuning().title_points;
        s.hidden = self.players[p].hand.iter().filter_map(|c| DATA.actions.get(c.key.0)).filter(|a| a.effect == "hidden_point").map(|a| a.amount).sum();
        s.beasts = self.slain.iter().filter(|(_, by)| **by == p).map(|(k, _)| DATA.beasts[k.0].points).sum();
        s.raids = self.raid_points.get(p).copied().unwrap_or(0);
        s.public = s.buildings + s.titles + s.beasts + s.raids;
        s.total = s.public + s.hidden;
        s
    }
    pub fn totals(&self) -> Vec<i64> {
        (0..self.n()).map(|p| self.score(p).total).collect()
    }
    pub fn first_player(&self) -> usize {
        (self.first_seat.unwrap_or(0) + self.round as usize + self.n() - 1) % self.n()
    }
    pub fn turn_order(&self) -> Vec<usize> {
        (0..self.n()).map(|i| (self.first_player() + i) % self.n()).collect()
    }
    pub fn standings(&self) -> Vec<Standing> {
        let totals = self.totals();
        let mut sorted = self.turn_order();
        sorted.sort_by(|a, b| totals[*b].cmp(&totals[*a]).then(self.players[*b].gold().cmp(&self.players[*a].gold())));
        let mut out: Vec<Standing> = sorted.into_iter().map(|p| Standing { p, total: totals[p], place: 0, tied: totals.iter().filter(|t| **t == totals[p]).count() > 1, tiebreak: None }).collect();
        for i in 0..out.len() {
            out[i].place = if i > 1 && out[i].total == out[i - 1].total { out[i - 1].place } else { i + 1 };
        }
        if out.len() > 1 && out[0].total == out[1].total {
            let gold = |s: &Standing| self.players[s.p].gold();
            out[0].tiebreak = Some(if gold(&out[0]) > gold(&out[1]) { "gold" } else { "turn order" });
        }
        out
    }

    // ---------- round flow ----------

    fn draw(&mut self, deck: Deck) -> Option<Card> {
        if self.decks.of(deck).is_empty() {
            let mut cards = mem::take(self.discards.of(deck));
            self.rng.shuffle(&mut cards);
            *self.decks.of(deck) = cards;
        }
        self.decks.of(deck).pop()
    }

    fn start_round(&mut self) {
        let t = tuning();
        self.round += 1;
        self.log(format!("=== Round {} ===", self.round), ev! {"k": "round", "n": self.round});
        let mut fed: Vec<Id> = vec![];
        for p in self.turn_order() {
            let prod = self.production(p);
            let mut got = Bundle::default();
            let mut dice = vec![];
            for (r, m) in prod.iter().enumerate() {
                let mut n = m.base;
                for sides in &m.dice {
                    let value = self.rng.roll(*sides);
                    dice.push(Die { sides: *sides, value, resource: Some(Key::of(RESOURCES[r])) });
                    n += value;
                }
                got.0[r] = Some(n);
            }
            let pl = &mut self.players[p];
            pl.gain(&got);
            let mut eat = 0;
            for d in self.dragons.iter().filter(|d| d.owner == p) {
                if d.stage == 0 {
                    fed.push(d.id);
                    continue;
                }
                let stock = &mut pl.resources.0[LIVESTOCK];
                if *stock < t.livestock_per_dragon {
                    break;
                }
                *stock -= t.livestock_per_dragon;
                eat += t.livestock_per_dragon;
                fed.push(d.id);
            }
            let ate = if eat > 0 { format!(" {}'s dragons eat {eat} livestock.", pname(p)) } else { String::new() };
            self.log_to(format!("{} makes {}.{ate}", pname(p), got.text()), ev! {"k": "produce", "p": p, "got": got, "eat": eat}, None, Some(dice));
        }
        self.wander();
        self.roam();
        let now = |d: &Dragon| {
            let st = d.stats();
            (d.stage, d.growth, st.map_or(0, |s| s.hp - d.damage), st.map_or(0, |s| s.hp), d.power())
        };
        let json = |x: (usize, i64, i64, i64, i64)| serde_json::json!({"stage": x.0, "growth": x.1, "hp": x.2, "maxHp": x.3, "power": x.4});
        let mut tended = vec![];
        for i in 0..self.dragons.len() {
            let from = now(&self.dragons[i]);
            self.tend(i, &fed);
            let d = &self.dragons[i];
            let to = now(d);
            if d.hungry || from != to {
                let mut x = serde_json::json!({"d": d.id, "p": d.owner, "from": json(from), "to": json(to)});
                if d.hungry {
                    x["hungry"] = true.into();
                }
                tended.push((x, d.hungry));
            }
        }
        if !tended.is_empty() {
            let any = tended.iter().any(|(_, hungry)| !hungry);
            let ds: Vec<_> = tended.into_iter().map(|(x, _)| x).collect();
            self.log(if any { "Dragons heal and grow." } else { "No dragon heals or grows." }, ev! {"k": "tend", "ds": ds});
        }
        for p in 0..self.n() {
            let mut actions = vec![];
            for _ in 0..t.action_cards_per_round {
                actions.extend(self.draw(Deck::Action));
            }
            for _ in 0..t.building_cards_drawn {
                let c = self.draw(Deck::Building);
                self.players[p].choice.extend(c);
            }
            self.players[p].hand.extend(&actions);
            let named = |cs: &[Card]| cs.iter().map(|c| c.named()).collect::<Vec<_>>().join(", ");
            let choice = self.players[p].choice.clone();
            let drew = if actions.is_empty() { "no action card".into() } else { named(&actions) };
            let kept = if choice.is_empty() { String::new() } else { format!(", and building cards {}: keep 1", named(&choice)) };
            self.mine(p, format!("You draw {drew}{kept}."));
            let n = actions.len() + choice.len();
            self.log(format!("{} draws {}.", pname(p), n_cards(n)), ev! {"k": "draw", "p": p, "n": n});
            if choice.len() == 1 {
                self.keep(p, choice[0]);
            }
        }
        self.phase = Phase::Cards;
        if self.players.iter().all(|pl| pl.choice.is_empty()) {
            return self.start_actions();
        }
        self.log("Everyone keeps 1 of their 2 building cards.", ev! {"k": "pick"});
    }

    fn tend(&mut self, i: usize, fed: &[Id]) {
        let growth = self.growth_per_round(self.dragons[i].owner);
        let d = &mut self.dragons[i];
        let hurt = d.damage > 0;
        let fed = fed.contains(&d.id);
        d.hungry = !fed;
        let (id, who, name) = (d.id, pname(d.owner), d.name());
        if !fed || hurt {
            let what = if fed { "heals instead of growing" } else { "goes hungry: it doesn't heal or grow" };
            self.log(format!("{who}'s {name} ({id}) {what}."), ev! {"k": "rest", "d": id, "why": if fed { "hurt" } else { "hungry" }});
        }
        if !fed {
            return;
        }
        let d = &mut self.dragons[i];
        if hurt {
            d.damage = (d.damage - tuning().heal_per_round).max(0);
            return;
        }
        if d.stage == 3 {
            return;
        }
        d.growth += growth;
        let need = d.def().growth_time;
        while self.dragons[i].stage < 3 && self.dragons[i].growth >= need {
            let d = &mut self.dragons[i];
            d.growth -= need;
            d.stage += 1;
            let stage = d.stage;
            self.log(format!("{who}'s {name} ({id}) grows into {}.", STAGE_INTO[stage]), ev! {"k": "grow", "d": id, "stage": stage});
        }
        if self.dragons[i].stage == 3 {
            self.dragons[i].growth = 0;
        }
    }

    fn keep(&mut self, p: usize, c: Card) {
        let choice = mem::take(&mut self.players[p].choice);
        self.discards.building.extend(choice.into_iter().filter(|x| x.id != c.id));
        self.players[p].hand.push(c);
        self.mine(p, format!("You keep {}.", c.named()));
    }
    fn start_actions(&mut self) {
        self.update_titles();
        self.phase = Phase::Action;
        self.turn = self.first_player();
        self.raids_left = 1;
        self.log(format!("Actions: {}'s turn.", pname(self.turn)), ev! {"k": "turn", "p": self.turn});
    }
    fn end_turn(&mut self) {
        for o in mem::take(&mut self.offers) {
            let (give, get) = (self.trade_text(&o.give), self.trade_text(&o.get));
            self.close(&o, Closed::Expired, None);
            self.log(format!("Offer {} expires.", o.id), ev! {"k": "expire", "from": o.from, "to": o.to, "give": give, "get": get});
        }
        let next = (self.turn + 1) % self.n();
        if next != self.first_player() {
            self.turn = next;
            return self.log(format!("{}'s turn.", pname(next)), ev! {"k": "turn", "p": next});
        }
        self.start_raid();
    }
    fn start_raid(&mut self) {
        self.phase = Phase::Raid;
        let n = self.n();
        if !self.dragons.iter().any(|d| d.ready()) {
            self.log("No one has a raid-ready dragon: no raid this round.", ev! {"k": "noRaid", "why": "unable"});
            return self.finish_raid(None);
        }
        let candidates: Vec<Key> = DATA.targets.keys().map(|t| Key::of(t)).collect();
        let names: Vec<String> = candidates.iter().enumerate().map(|(i, t)| format!("{}. {}", i + 1, DATA.targets[t.0].name)).collect();
        let ev = ev! {"k": "raid", "targets": candidates};
        self.raid = Some(Raid { step: Step::Vote, candidates, votes: vec![None; n], target: None, sent: vec![vec![]; n], choices: vec![None; n], units: vec![], fighters: vec![] });
        self.log(format!("Raid vote: {}.", names.join(", ")), ev);
    }
    pub fn loot_of(&self, t: Key) -> Bundle {
        let mut loot = DATA.targets[t.0].loot;
        let extra = self.hoard.get(&t).copied().unwrap_or(0);
        if extra != 0 {
            loot.add(GOLD, extra);
        }
        loot
    }
    fn finish_raid(&mut self, fell: Option<Key>) {
        for t in DATA.targets.keys() {
            let n = self.hoard.entry(Key::of(t)).or_insert(0);
            *n = if fell.is_some_and(|f| f.0 == *t) { 0 } else { *n + 1 };
        }
        self.raid = None;
        self.raids_left -= 1;
        self.update_titles();
        if self.raids_left > 0 {
            self.log("Another raid follows this round.", ev! {"k": "again"});
            return self.start_raid();
        }
        self.phase = Phase::Discard;
        self.maybe_end_round();
    }
    fn maybe_end_round(&mut self) {
        if self.players.iter().any(|pl| pl.hand.len() > tuning().hand_cap) {
            return;
        }
        let totals = self.totals();
        let best = *totals.iter().max().unwrap();
        if best >= points_to_win() {
            let w = self.standings()[0].p;
            self.winner = Some(w);
            self.phase = Phase::Over;
            let all: Vec<String> = totals.iter().enumerate().map(|(p, t)| format!("{} {t}", pname(p))).collect();
            self.log(format!("Final scores: {}.", all.join(", ")), ev! {"k": "final", "totals": totals, "winner": w});
            return self.log(format!("{} wins with {best} points!", pname(w)), ev! {"k": "final", "totals": totals, "winner": w});
        }
        self.start_round();
    }

    // ---------- raid ----------

    pub fn can_vote(&self, p: usize) -> bool {
        self.dragons_of(p).any(|d| d.ready())
    }
    pub fn vote_power(&self, p: usize) -> i64 {
        self.dragons_of(p).filter(|d| d.ready()).map(|d| d.power()).sum()
    }
    fn resolve_vote(&mut self) {
        let raid = self.raid.as_ref().unwrap();
        let powers: Vec<i64> = (0..self.n()).map(|p| self.vote_power(p)).collect();
        let counts: Vec<i64> = (0..raid.candidates.len()).map(|i| raid.votes.iter().enumerate().filter(|(_, v)| **v == Some(i)).map(|(p, _)| powers[p]).sum()).collect();
        let best = *counts.iter().max().unwrap();
        let tied: Vec<Key> = raid.candidates.iter().zip(&counts).filter(|(_, n)| **n == best).map(|(t, _)| *t).collect();
        let votes = raid.votes.clone();
        let told: Vec<String> = votes.iter().enumerate().filter_map(|(p, v)| v.map(|v| format!("{} (power {})→{}", pname(p), powers[p], DATA.targets[raid.candidates[v].0].name))).collect();
        let coin = tied.len() > 1;
        let t = if coin { self.rng.pick(&tied) } else { tied[0] };
        let name = DATA.targets[t.0].name;
        self.log(format!("Votes: {}.", told.join(", ")), ev! {"k": "votes", "votes": votes});
        self.log(format!("The raid target is {name}{}.", if coin { " (tie broken by a coin flip)" } else { "" }), ev! {"k": "target", "t": t, "name": name, "votes": counts, "coin": coin});
        let sent: Vec<Vec<Id>> = (0..self.n()).map(|p| self.ready(p)).collect();
        let ins: Vec<usize> = (0..self.n()).filter(|p| !sent[*p].is_empty()).collect();
        let who: Vec<String> = ins.iter().map(|p| format!("{} ({})", pname(*p), ids(&sent[*p]))).collect();
        let theirs: Vec<&Vec<Id>> = ins.iter().map(|p| &sent[*p]).collect();
        self.log(format!("In the raid: {}. Each chooses in secret which dragons fight; the rest hold back.", who.join(", ")), ev! {"k": "locked", "ps": ins, "sent": theirs});
        let raid = self.raid.as_mut().unwrap();
        raid.target = Some(t);
        raid.sent = sent;
        raid.step = Step::Choose;
    }
    fn resolve_choices(&mut self) {
        let raid = self.raid.clone().unwrap();
        let target = raid.target.unwrap();
        let def = &DATA.targets[target.0];
        let mut fighters = vec![];
        let mut held_back = vec![];
        for p in 0..self.n() {
            let Some(fight) = &raid.choices[p] else { continue };
            if !fight.is_empty() {
                fighters.push(p);
            }
            let held: Vec<Id> = raid.sent[p].iter().copied().filter(|d| !fight.contains(d)).collect();
            if held.is_empty() {
                continue;
            }
            let text = if fight.is_empty() { format!("{} holds back.", pname(p)) } else { format!("{} holds back {}.", pname(p), ids(&held)) };
            self.log(text, ev! {"k": "hold", "p": p, "ds": held});
            held_back.push(serde_json::json!({"p": p, "ds": held}));
        }
        if fighters.is_empty() {
            self.log("Everyone holds back. The raid is off.", ev! {"k": "noRaid", "why": "held"});
            return self.finish_raid(None);
        }
        let mut b = Battle {
            units: def.units.iter().map(|u| Foe { key: Key::of(u), hp: DATA.units[u].hp, d: None }).collect(),
            fighters: fighters.iter().flat_map(|p| raid.choices[*p].clone().unwrap()).collect(),
        };
        let first = self.coin_flip();
        let hps: Vec<i64> = b.fighters.iter().map(|d| self.dragon(*d).health()).collect();
        let units: Vec<_> = b.units.iter().map(|u| serde_json::json!({"name": DATA.units[u.key.0].name, "hp": u.hp, "el": DATA.units[u.key.0].element})).collect();
        self.log(
            format!("{} {} {}. {}", and_list(&pnames(&fighters)), if fighters.len() == 1 { "attacks" } else { "attack" }, def.name, first.text("the defenders", true)),
            ev! {"k": "fight", "ps": fighters, "t": target, "name": def.name, "ds": b.fighters, "hps": hps, "units": units, "first": first.key(), "held": held_back},
        );
        let mut round = 1;
        while !self.raid_over(&b) {
            self.combat_round(&mut b, round, first);
            round += 1;
        }
    }
    fn raid_over(&mut self, b: &Battle) -> bool {
        let raid = self.raid.as_ref().unwrap();
        let t = raid.target.unwrap();
        let def = &DATA.targets[t.0];
        if b.cleared() {
            let mut power = vec![0; self.n()];
            for d in raid.sent.iter().flatten().map(|d| self.dragon(*d)).filter(|d| d.health() > 0) {
                power[d.owner] += d.power();
            }
            let winners: Vec<usize> = (0..self.n()).filter(|p| power[*p] != 0).collect();
            let order = self.turn_order();
            let shares = split_loot(&self.loot_of(t), &power, &order);
            for p in &winners {
                self.players[*p].gain(&shares[*p]);
            }
            let take: Vec<String> = winners.iter().map(|p| format!("{} (power {}) takes {}", pname(*p), power[*p], shares[*p].text())).collect();
            let best = power.iter().copied().max().unwrap().max(0);
            let scorer = if best > 0 { order.iter().copied().find(|p| power[*p] == best) } else { None };
            let mut ev = serde_json::json!({"k": "raidEnd", "t": t, "name": def.name, "won": true, "winners": winners, "shares": winners.iter().map(|p| shares[*p]).collect::<Vec<_>>(), "power": winners.iter().map(|p| power[*p]).collect::<Vec<_>>()});
            let mut scored = String::new();
            if let (Some(points), Some(s)) = (def.points, scorer) {
                self.raid_points.resize(self.players.len(), 0);
                self.raid_points[s] += points;
                scored = format!(" {} has the most power standing and scores {}.", pname(s), points_text(points));
                ev["points"] = points.into();
                ev["scorer"] = s.into();
            }
            self.log(format!("{} falls. {}.{scored}", def.name, take.join("; ")), serde_json::value::to_raw_value(&ev).unwrap());
            self.finish_raid(Some(t));
            return true;
        }
        if b.fighters.is_empty() {
            self.log(format!("{} holds.", def.name), ev! {"k": "raidEnd", "t": t, "name": def.name, "won": false, "winners": [], "shares": [], "power": []});
            self.finish_raid(None);
            return true;
        }
        false
    }

    // ---------- fights ----------

    fn coin_flip(&mut self) -> Side {
        if self.rng.roll(2) == 1 { Side::Dragons } else { Side::Defenders }
    }
    fn roll_attack(&mut self, a: &Attack) -> i64 {
        (0..a.dice).map(|_| self.rng.roll(a.sides)).sum()
    }
    fn foe(&self, u: &Foe) -> FoeStats {
        if let Some(id) = u.d {
            let d = self.dragon(id);
            return FoeStats { name: d.name(), attack: d.stats().unwrap(), element: d.def().element };
        }
        let x = DATA.units.get(u.key.0).unwrap_or_else(|| fauna_def(u.key.0));
        FoeStats { name: x.name, attack: x.attack(), element: x.element }
    }
    fn pick_targets(&mut self, b: &Battle, d: Id, n: i64) -> Vec<usize> {
        let mut order: Vec<usize> = (0..b.units.len()).filter(|i| b.units[*i].hp > 0).collect();
        self.rng.shuffle(&mut order);
        let def = self.dragon(d).def();
        match def.targeting {
            "lowest_health" => order.sort_by_key(|i| b.units[*i].hp),
            "strongest_attacker" => order.sort_by_key(|i| {
                let a = self.foe(&b.units[*i]).attack;
                -(a.targets * a.dice * (a.sides + 1))
            }),
            "weak_to_me" => order.sort_by_key(|i| !DATA.element_weak[self.foe(&b.units[*i]).element].contains(&def.element)),
            _ => {}
        }
        order.truncate(n as usize);
        order
    }
    fn combat_round(&mut self, b: &mut Battle, round: i64, first: Side) {
        let mut lines = vec![];
        let mut hits = vec![];
        if first == Side::Defenders {
            self.defenders_strike(b, &mut lines, &mut hits);
        }
        self.dragons_strike(b, &mut lines, &mut hits);
        if first == Side::Dragons {
            self.defenders_strike(b, &mut lines, &mut hits);
        }
        self.log(format!("Combat round {round}: {}.", lines.join("; ")), ev! {"k": "combat", "round": round, "hits": hits});
    }
    fn dragons_strike(&mut self, b: &mut Battle, lines: &mut Vec<String>, hits: &mut Vec<serde_json::Value>) {
        for id in b.fighters.clone() {
            let (st, el) = (self.dragon(id).stats().unwrap(), self.dragon(id).def().element);
            for ui in self.pick_targets(b, id, st.targets) {
                let def = self.foe(&b.units[ui]);
                let roll = self.roll_attack(&st);
                let dmg = elemental(roll, el, def.element);
                let u = &mut b.units[ui];
                u.hp = (u.hp - dmg).max(0);
                if let Some(x) = u.d {
                    let hp = u.hp;
                    let d = self.dragon_mut(x);
                    d.damage = d.stats().unwrap().hp - hp;
                    if hp == 0 {
                        d.perch = None;
                    }
                }
                let down = u.hp == 0;
                lines.push(format!("{id} hits {} #{} for {dmg}{}", def.name, ui + 1, if down { " (falls)" } else { "" }));
                hits.push(hit(id, ui, "dragon", dmg, down, roll));
            }
        }
    }
    fn defenders_strike(&mut self, b: &mut Battle, lines: &mut Vec<String>, hits: &mut Vec<serde_json::Value>) {
        for ui in 0..b.units.len() {
            if b.units[ui].hp <= 0 {
                continue;
            }
            let def = self.foe(&b.units[ui]);
            for _ in 0..def.attack.targets {
                if b.fighters.is_empty() {
                    break;
                }
                let id = self.rng.pick(&b.fighters);
                let roll = self.roll_attack(&def.attack);
                let d = self.dragon_mut(id);
                let dmg = elemental(roll, def.element, d.def().element);
                let full = d.stats().unwrap().hp;
                d.damage = (d.damage + dmg).min(full);
                let down = d.damage >= full;
                if down {
                    b.fighters.retain(|x| *x != id);
                }
                lines.push(format!("{} #{} hits {id} for {dmg}{}", def.name, ui + 1, if down { " (knocked out, goes home)" } else { "" }));
                hits.push(hit(id, ui, "unit", dmg, down, roll));
            }
        }
    }

    // ---------- fauna ----------

    fn clear_hex(&mut self, p: usize, k: K, ds: &[Id]) -> Rule<bool> {
        let f = self.map[&k].fauna;
        let great = f.and_then(|f| DATA.beasts.get(f.0));
        if great.is_some() {
            if self.beast_tried[p] == self.round {
                return fail("You've fought a great beast this round already: 1 try each round.");
            }
            self.beast_tried[p] = self.round;
        }
        let perched: Vec<Dragon> = self.rivals_perched(p, k).into_iter().cloned().collect();
        let mut units: Vec<Foe> = f.iter().map(|f| Foe { key: *f, hp: fauna_def(f.0).hp, d: None }).collect();
        units.extend(perched.iter().map(|d| Foe { key: d.key, hp: d.health(), d: Some(d.id) }));
        let mut b = Battle { units, fighters: ds.to_vec() };
        let name = f.map_or_else(|| perched[0].name(), |f| fauna_def(f.0).name);
        let mut foes: Vec<String> = f.iter().map(|_| format!("the {name}")).collect();
        foes.extend(perched.iter().map(|d| format!("{}'s {} ({})", pname(d.owner), d.name(), d.id)));
        let first = self.coin_flip();
        let many = b.units.len() > 1;
        let them = if many {
            "the defenders".to_string()
        } else if f.is_some() {
            format!("the {name}")
        } else {
            format!("{}'s {}", pname(perched[0].owner), perched[0].name())
        };
        let hps: Vec<i64> = ds.iter().map(|d| self.dragon(*d).health()).collect();
        let shown: Vec<serde_json::Value> = b
            .units
            .iter()
            .map(|u| {
                let x = self.foe(u);
                match u.d {
                    Some(d) => serde_json::json!({"name": x.name, "hp": u.hp, "d": d, "el": x.element}),
                    None => serde_json::json!({"name": x.name, "hp": u.hp, "el": x.element}),
                }
            })
            .collect();
        self.log(
            format!("{} sends {} against {} at {k}. {}", pname(p), ids(ds), foes.join(" and "), first.text(&them, many)),
            ev! {"k": "hunt", "p": p, "hex": k, "fauna": f, "name": name, "hp": b.units[0].hp, "ds": ds, "hps": hps, "units": shown, "first": first.key()},
        );
        let mut round = 1;
        while !b.cleared() && !b.fighters.is_empty() {
            self.combat_round(&mut b, round, first);
            round += 1;
        }
        let won = b.cleared();
        let home: Vec<Id> = perched.iter().map(|d| d.id).filter(|d| self.dragon(*d).perch.is_none()).collect();
        let loot = if f.is_some() { self.fauna_loot(k) } else { Bundle::default() };
        if let Some(f) = f.filter(|_| won) {
            let h = &mut self.map[&k];
            h.fauna = None;
            h.sent = false;
            self.players[p].gain(&loot);
            if great.is_some() {
                self.slain.insert(f, p);
            }
        }
        let flown = if home.is_empty() { String::new() } else { format!(" {} {} home.", ids(&home), if home.len() == 1 { "goes" } else { "go" }) };
        let me = pname(p);
        let text = match (f, great) {
            (None, _) if won => format!("{me} clears {k}.{flown}"),
            (None, _) => format!("The dragons at {k} hold against {me}.{flown}"),
            _ if !won => format!("The {name} at {k} holds against {me}.{flown}"),
            (Some(f), Some(g)) => {
                let peak = if f.0 == "thunderbird" { format!(" Production buildings on and adjacent to its peak make {} more each round.", tuning().peak_bonus) } else { String::new() };
                format!("The {name} is slain. {me} scores {}.{peak}", points_text(g.points))
            }
            _ => {
                let gains = if loot.empty() { String::new() } else { format!(" {me} gains {}.", loot.text()) };
                format!("The {name} at {k} falls.{gains}{flown}")
            }
        };
        let mut ev = serde_json::json!({"k": "cleared", "p": p, "hex": k, "fauna": f, "name": name, "won": won, "gain": if won { loot } else { Bundle::default() }});
        if let Some(g) = great.filter(|_| won) {
            ev["points"] = g.points.into();
        }
        if !home.is_empty() {
            ev["home"] = serde_json::json!(home);
        }
        self.log(text, serde_json::value::to_raw_value(&ev).unwrap());
        Ok(won)
    }
    pub fn perch_hexes(&self, p: usize) -> Vec<K> {
        sorted(self.buildings.iter().filter(|(_, b)| b.owner != p && !b.tower()).map(|(k, _)| *k))
    }
    pub fn fauna_loot(&self, k: K) -> Bundle {
        let h = &self.map[&k];
        if h.sent { Bundle::default() } else { fauna_def(h.fauna.unwrap().0).loot }
    }
    fn wander(&mut self) {
        let mut open = self.fauna_hexes();
        for k in self.fauna_on_map() {
            let f = self.map[&k].fauna.unwrap();
            if is_beast(f.0) || self.rng.roll(tuning().fauna_wander_odds) != 1 {
                continue;
            }
            let lonely = |n: K| !n.neighbors().iter().any(|m| *m != k && self.map.get(m).is_some_and(|h| h.fauna.is_some()));
            let to: Vec<K> = k.neighbors().into_iter().filter(|n| open.contains(n)).flat_map(|n| vec![n; if lonely(n) { tuning().fauna_spread_weight } else { 1 }]).collect();
            if to.is_empty() {
                continue;
            }
            let n = self.rng.pick(&to);
            let sent = mem::take(&mut self.map[&k].sent);
            self.map[&k].fauna = None;
            let h = &mut self.map[&n];
            h.fauna = Some(f);
            h.sent |= sent;
            open.retain(|x| *x != n);
            open.push(k);
            let onto = self.buildings.get(&n).map_or(String::new(), |b| format!(", onto {}'s {}", pname(b.owner), b.name()));
            let name = DATA.fauna[f.0].name;
            self.log(format!("The {name} at {k} moves to {n}{onto}."), ev! {"k": "wander", "from": k, "to": n, "fauna": f, "name": name});
        }
    }
    fn roam(&mut self) {
        let Some(k) = self.fauna_on_map().into_iter().find(|k| self.map[k].fauna.unwrap().0 == "leviathan") else { return };
        let to: Vec<K> = leviathan_waters(&self.map, self.n()).into_iter().filter(|n| *n != k).flat_map(|n| vec![n; distance(n.0 - k.0, n.1 - k.1) as usize]).collect();
        if to.is_empty() {
            return;
        }
        let n = self.rng.pick(&to);
        self.map[&n].fauna = mem::take(&mut self.map[&k].fauna);
        self.log(format!("The Leviathan dives at {k} and surfaces at {n}."), ev! {"k": "wander", "from": k, "to": n, "fauna": "leviathan", "name": DATA.beasts["leviathan"].name});
    }
    pub fn fauna_hexes(&self) -> Vec<K> {
        sorted(self.map.iter().filter(|(k, h)| !h.ocean() && h.fauna.is_none() && !self.buildings.get(*k).is_some_and(|b| b.tower())).map(|(k, _)| *k))
    }
    fn fauna_on_map(&self) -> Vec<K> {
        sorted(self.map.iter().filter(|(_, h)| h.fauna.is_some()).map(|(k, _)| *k))
    }
    pub fn huntable(&self, p: usize) -> Vec<K> {
        let mut out = self.fauna_on_map();
        out.retain(|k| !self.map[k].beast() || self.beast_tried[p] != self.round);
        out.extend(self.dragons.iter().filter(|d| d.owner != p).filter_map(|d| d.perch));
        out.sort();
        out.dedup();
        out
    }
    pub fn auto_clear_targets(&self, p: usize) -> Vec<K> {
        let mut out: Vec<(i64, K)> = self
            .buildings
            .iter()
            .filter(|(k, b)| b.owner == p && !self.map[*k].beast())
            .filter_map(|(k, _)| {
                let (f, perched) = (self.map[k].fauna, self.rivals_perched(p, *k));
                let power = f.map_or(0, |f| fauna_def(f.0).attack().power()) + perched.iter().map(|d| d.power()).sum::<i64>();
                (f.is_some() || !perched.is_empty()).then_some((power, *k))
            })
            .collect();
        out.sort();
        out.into_iter().map(|x| x.1).collect()
    }
    fn auto_clear(&mut self, p: usize) -> Rule {
        if self.auto_clear_targets(p).is_empty() {
            return fail("Nothing holds your buildings: there's nothing to auto clear.");
        }
        if self.ready(p).is_empty() {
            return fail("You have no raid-ready dragon to send.");
        }
        loop {
            let ds = self.ready(p);
            let Some(k) = self.auto_clear_targets(p).first().copied() else { return Ok(()) };
            if ds.is_empty() || !self.clear_hex(p, k, &ds)? {
                return Ok(());
            }
        }
    }

    // ---------- commands ----------

    fn seat(&self, s: Seat) -> Rule<usize> {
        if s.0 >= self.n() {
            return fail(format!("There is no {}: players are P1 to P{}.", pname(s.0), self.n()));
        }
        Ok(s.0)
    }
    fn hand_card(&self, p: usize, id: Id) -> Rule<Card> {
        self.players[p].hand.iter().find(|c| c.id == id).copied().ok_or_else(|| format!("You have no card {id} in hand."))
    }
    fn own_dragon(&self, p: usize, id: Id) -> Rule<Id> {
        self.dragons_of(p).find(|d| d.id == id).map(|d| d.id).ok_or_else(|| format!("You have no dragon {id}."))
    }
    fn own_dragons(&self, p: usize, ids: &[Id]) -> Rule<Vec<Id>> {
        unique(ids).into_iter().map(|d| self.own_dragon(p, d)).collect()
    }
    fn ready_dragons(&self, p: usize, ids: &[Id]) -> Rule<Vec<Id>> {
        if ids.is_empty() {
            return fail("Send at least 1 dragon.");
        }
        let ds = self.own_dragons(p, ids)?;
        for d in &ds {
            if !self.dragon(*d).ready() {
                return fail(format!("{d} isn't raid-ready (hatched, not knocked out, not perched)."));
            }
        }
        Ok(ds)
    }
    pub fn trade_text(&self, s: &TradeSide) -> String {
        let mut parts = vec![];
        if s.res.0.iter().any(|n| n.unwrap_or(0) != 0) {
            parts.push(s.res.text());
        }
        for id in &s.cards {
            parts.push(match self.any_card(id) {
                Some(c) => format!("{} card ({id})", c.name()),
                None => format!("card {id}"),
            });
        }
        if parts.is_empty() { "nothing".into() } else { parts.join(", ") }
    }
    pub fn any_card(&self, id: &str) -> Option<&Card> {
        let want = Id::parse(id)?;
        self.players.iter().flat_map(|p| &p.hand).find(|c| c.id == want)
    }
    fn has_side(&self, p: usize, s: &TradeSide) -> bool {
        self.players[p].can_afford(&s.res) && s.cards.iter().all(|id| Id::parse(id).is_some_and(|id| self.hand_card(p, id).is_ok()))
    }
    pub fn accept_problem(&self, o: &Offer, p: usize) -> Option<String> {
        if !self.has_side(o.from, &o.give) {
            return Some(format!("{} no longer has what they offered.", pname(o.from)));
        }
        (!self.has_side(p, &o.get)).then(|| format!("You don't have {}.", self.trade_text(&o.get)))
    }
    fn move_side(&mut self, from: usize, to: usize, s: &TradeSide) -> Rule {
        self.players[from].pay(&s.res)?;
        self.players[to].gain(&s.res);
        for id in &s.cards {
            let c = Id::parse(id).map_or_else(|| fail("No such card."), |id| self.hand_card(from, id))?;
            self.players[from].hand.retain(|x| x.id != c.id);
            self.players[to].hand.push(c);
        }
        Ok(())
    }
    fn place_check(&self, p: usize, key: &str, hex: Option<K>) -> Rule<K> {
        let def = &DATA.buildings[key];
        if def.on_tower {
            return Ok(self.towers[p]);
        }
        let Some(k) = hex else { return fail("Choose a hex to build on, like \"2,-1\".") };
        let Some(hex) = self.map.get(&k) else { return fail(format!("{k} is not on the map.")) };
        let noun = |t: &str| DATA.terrain_noun[t];
        if hex.ocean() {
            return fail(format!("{k} is ocean: build on land."));
        }
        if self.buildings.contains_key(&k) {
            return fail(format!("{k} already has a building."));
        }
        if let Some(f) = hex.fauna {
            return fail(format!("A {} holds {k}: clear it first.", fauna_def(f.0).name));
        }
        if near_beast(&self.map, k) {
            return fail(format!("A great beast holds {k} from an adjacent hex: slay it first."));
        }
        if let Some(t) = def.terrain.filter(|t| *t != hex.terrain.0) {
            return fail(format!("A {} must go on a {}; {k} is a {}.", def.name, noun(t), noun(hex.terrain.0)));
        }
        if !k.neighbors().into_iter().any(|n| self.buildings.get(&n).is_some_and(|b| b.owner == p) && !self.blocked(n)) {
            return fail(format!("{k} isn't adjacent to any of your buildings."));
        }
        if let Some(w) = def.beside.filter(|w| self.neighbour_count(k, w) == 0) {
            return fail(format!("A {} must go adjacent to {}; {k} isn't.", def.name, beside_text(w)));
        }
        Ok(k)
    }
    pub fn buildable_hexes(&self, p: usize, key: &str) -> Vec<K> {
        let def = &DATA.buildings[key];
        if def.on_tower {
            return vec![self.towers[p]];
        }
        let mut out: Vec<K> = vec![];
        for (k, _) in self.owned(p) {
            for n in k.neighbors() {
                let Some(h) = self.map.get(&n) else { continue };
                if h.ocean() || h.fauna.is_some() || def.terrain.is_some_and(|t| t != h.terrain.0) || out.contains(&n) || self.buildings.contains_key(&n) || near_beast(&self.map, n) {
                    continue;
                }
                if def.beside.is_none_or(|w| self.neighbour_count(n, w) > 0) {
                    out.push(n);
                }
            }
        }
        out.sort();
        out
    }
    fn place_building(&mut self, p: usize, key: Key, k: K) {
        let me = pname(p);
        let def = &DATA.buildings[key.0];
        if def.on_tower {
            let b = &mut self.buildings[&k];
            b.floors += 1;
            let n = b.floors;
            self.log(format!("{me} adds a floor to their tower (now {n})."), ev! {"k": "floor", "p": p, "floors": n});
        } else {
            self.buildings.insert(k, Building { kind: key, owner: p, upgrades: vec![], floors: 0 });
            self.log(format!("{me} builds a {} at {k}.", def.name), ev! {"k": "build", "p": p, "b": key, "name": def.name, "hex": k});
        }
    }
    pub fn upgrade_targets(&self, p: usize, up: &str) -> Vec<K> {
        let on = &DATA.upgrades[up].applies_to;
        sorted(self.owned(p).filter(|(_, b)| building_class(b).iter().any(|c| on.contains(c))).map(|(k, _)| k))
    }
    fn upgrade_check(&self, p: usize, up: &str, k: K) -> Rule<K> {
        let ok = self.upgrade_targets(p, up);
        Some(k).filter(|k| ok.contains(k)).ok_or_else(|| format!("{} can go on: {}.", DATA.upgrades[up].name, keys_or(&ok, "none of your buildings")))
    }
    fn place_upgrade(&mut self, p: usize, up: Key, k: K, project: bool) {
        let b = &mut self.buildings[&k];
        b.upgrades.push(up);
        let name = DATA.upgrades[up.0].name;
        let text = format!("{} adds {name} to their {} at {k}{}.", pname(p), b.name(), if project { " as a special project" } else { "" });
        let on = b.kind;
        let ev = if project { ev! {"k": "upgrade", "p": p, "u": up, "name": name, "on": on, "hex": k, "project": true} } else { ev! {"k": "upgrade", "p": p, "u": up, "name": name, "on": on, "hex": k} };
        self.log(text, ev);
    }
    fn room_for_dragon(&self, p: usize) -> Rule {
        if self.housed(p) >= self.dragon_capacity(p) { fail("No room for another dragon: build a roost first.") } else { Ok(()) }
    }
    fn hatch(&mut self, p: usize, key: Key, project: bool) -> Rule {
        let (mine, cap) = (self.housed(p), self.dragon_capacity(p));
        if mine >= cap {
            return fail(format!("No room for another dragon ({mine}/{cap}): build a roost first."));
        }
        let id = self.id(b'd');
        let d = Dragon { id, owner: p, key, stage: 0, growth: 0, damage: 0, perch: None, hungry: false };
        let text = format!("{} hatches an egg: {} ({id}), a {} dragon{}.", pname(p), d.name(), d.def().element, if project { ", as a special project" } else { "" });
        self.dragons.push(d);
        self.log(text, if project { ev! {"k": "hatch", "p": p, "d": id, "project": true} } else { ev! {"k": "hatch", "p": p, "d": id} });
        Ok(())
    }
    fn discard(&mut self, p: usize, c: Card) {
        self.players[p].hand.retain(|x| x.id != c.id);
        self.discards.of(c.deck).push(c);
    }

    /// Takes note of how an offer closed, for a late answer to it.
    fn close(&mut self, o: &Offer, how: Closed, by: Option<usize>) {
        self.closed_offers.push(ClosedOffer { id: o.id, from: o.from, to: o.to, how, by });
        let old = self.closed_offers.len().saturating_sub(CLOSED_KEPT);
        self.closed_offers.drain(..old);
    }
    // Why p can't answer an offer (or withdraw one of their own) that isn't open to it.
    fn no_offer(&self, p: usize, id: Id, own: bool) -> String {
        if !own && self.offers.iter().any(|o| o.id == id && o.passed().contains(&p)) {
            return "You've already declined that offer.".into();
        }
        let theirs = |o: &ClosedOffer| if own { o.from == p } else { o.from != p && o.to.is_none_or(|q| q == p) };
        match self.closed_offers.iter().find(|o| o.id == id && theirs(o)) {
            Some(o) => match (o.how, o.by) {
                (Closed::Expired, _) => "That offer has expired.".into(),
                (Closed::Withdrawn, _) => if own { "You've already withdrawn that offer.".into() } else { format!("{} has withdrawn that offer.", pname(o.from)) },
                (Closed::Declined, _) => if own { "That offer has been declined.".into() } else { "You've already declined that offer.".into() },
                (Closed::Accepted, Some(q)) if q != p => format!("{} has already accepted that offer.", pname(q)),
                (Closed::Accepted, _) => "You've already accepted that offer.".into(),
            },
            None if own => format!("You have no open offer {id}."),
            None => format!("There is no offer {id} made to you."),
        }
    }
    // Answers to offers: what's true of the offer, whatever the game has moved on to.
    fn open_offer(&self, p: usize, id: Id, own: bool) -> Rule<usize> {
        self.offers.iter().position(|o| o.id == id && if own { o.from == p } else { o.waits_on(p) }).ok_or_else(|| self.no_offer(p, id, own))
    }
    fn accept(&mut self, p: usize, id: Id) -> Rule {
        let i = self.open_offer(p, id, false)?;
        if let Some(why) = self.accept_problem(&self.offers[i], p) {
            return fail(why);
        }
        let o = self.offers.remove(i);
        self.close(&o, Closed::Accepted, Some(p));
        let (give, get) = (self.trade_text(&o.give), self.trade_text(&o.get));
        self.move_side(o.from, p, &o.give)?;
        self.move_side(p, o.from, &o.get)?;
        self.log(format!("{} accepts offer {}: {} gives {give} for {get}.", pname(p), o.id, pname(o.from)), ev! {"k": "trade", "from": o.from, "to": p, "give": give, "get": get});
        Ok(())
    }
    fn decline(&mut self, p: usize, id: Id) -> Rule {
        let i = self.open_offer(p, id, false)?;
        if self.offers[i].to.is_none() {
            self.offers[i].passed.get_or_insert_default().push(p);
        }
        let o = self.offers[i].clone();
        if o.to.is_some() || (0..self.n()).all(|q| !o.waits_on(q)) {
            self.offers.remove(i);
            self.close(&o, Closed::Declined, None);
        }
        let (give, get) = (self.trade_text(&o.give), self.trade_text(&o.get));
        self.log(format!("{} declines offer {}.", pname(p), o.id), ev! {"k": "decline", "p": p, "from": o.from, "give": give, "get": get});
        Ok(())
    }
    fn cancel(&mut self, p: usize, id: Id) -> Rule {
        let i = self.open_offer(p, id, true)?;
        let o = self.offers.remove(i);
        self.close(&o, Closed::Withdrawn, None);
        self.log(format!("{} withdraws offer {}.", pname(p), o.id), ev! {"k": "withdraw", "p": p});
        Ok(())
    }
    fn offer(&mut self, p: usize, to: To, give: &command::Side, get: &command::Side) -> Rule {
        let to = match to {
            To::Anyone => None,
            To::Player(s) => Some(self.seat(s)?),
        };
        if to == Some(p) {
            return fail("You can't trade with yourself.");
        }
        if p != self.turn && to != Some(self.turn) {
            return fail(format!("Out of turn, you can only offer to {}.", pname(self.turn)));
        }
        let id = self.id(b'o');
        let side = |s: &command::Side| TradeSide { res: s.bundle(), cards: s.cards.iter().map(|c| c.to_string()).collect() };
        let o = Offer { id, from: p, to, passed: to.is_none().then(Vec::new), give: side(give), get: side(get) };
        if o.give.nothing() && o.get.nothing() {
            return fail("The offer is empty: give or get something.");
        }
        let all: Vec<Id> = give.cards.iter().chain(&get.cards).copied().collect();
        if unique(&all).len() < all.len() {
            return fail("Name each card once.");
        }
        if !self.has_side(p, &o.give) {
            return fail(format!("You don't have {}.", self.trade_text(&o.give)));
        }
        let gold = match to {
            None => (0..self.n()).filter(|q| *q != p).map(|q| self.players[q].gold()).max().unwrap(),
            Some(q) => self.players[q].gold(),
        };
        if o.get.res.get(GOLD) > gold {
            return fail(to.map_or(format!("No other player has more than {gold} gold."), |q| format!("{} has {gold} gold.", pname(q))));
        }
        let text = format!("{} offers {} ({id}): {} for {}.", pname(p), to.map_or("anyone".into(), pname), self.trade_text(&o.give), self.trade_text(&o.get));
        self.offers.push(o);
        self.log(text, ev! {"k": "offer", "p": p, "to": to});
        Ok(())
    }

    fn action_command(&mut self, p: usize, cmd: &Command) -> Rule {
        if let Command::Offer { to, give, get } = cmd {
            return self.offer(p, *to, give, get);
        }
        let me = pname(p);
        if p != self.turn {
            return fail(format!("It's {}'s turn: out of turn, you can only trade.", pname(self.turn)));
        }
        match cmd {
            Command::End {} => {
                let open: Vec<String> = self.offers.iter().filter(|o| o.waits_on(p)).map(|o| format!("{}'s offer {}", pname(o.from), o.id)).collect();
                if !open.is_empty() {
                    return fail(format!("Answer {} first: accept or decline.", open.join(" and ")));
                }
                self.log(format!("{me} ends their turn."), ev! {"k": "end", "p": p});
                self.end_turn();
                Ok(())
            }
            Command::Merchants { pay, gain, times } => {
                let (give, get, times) = (*pay as usize, *gain as usize, i64::from(*times));
                if give == GOLD || get == GOLD {
                    return fail("The merchants don't trade gold.");
                }
                if give == get {
                    return fail("Trade 2 different resources.");
                }
                if times < 1 {
                    return fail("Trade at least once.");
                }
                let (g, t) = (Bundle::one(give, self.bank_rates(p)[give] * times), Bundle::one(get, times));
                self.players[p].pay(&g)?;
                self.players[p].gain(&t);
                self.log(format!("{me} trades {} to the merchants for {}.", g.text(), t.text()), ev! {"k": "bank", "p": p, "give": g, "get": t});
                Ok(())
            }
            Command::BuildBasic { building, hex } => {
                let k = self.place_check(p, building.0, *hex)?;
                self.players[p].pay(&DATA.buildings[building.0].cost)?;
                self.place_building(p, *building, k);
                Ok(())
            }
            Command::Build { card, hex } => {
                let c = self.hand_card(p, *card)?;
                if c.kind() != "building" {
                    return fail(format!("{} is not a building card.", c.name()));
                }
                let k = self.place_check(p, c.key.0, *hex)?;
                self.players[p].pay(c.cost())?;
                self.discard(p, c);
                self.place_building(p, c.key, k);
                Ok(())
            }
            Command::Upgrade { card, hex } => {
                let c = self.hand_card(p, *card)?;
                if c.kind() != "upgrade" {
                    return fail(format!("{} is not an upgrade card.", c.name()));
                }
                let k = self.upgrade_check(p, c.key.0, *hex)?;
                self.players[p].pay(c.cost())?;
                self.discard(p, c);
                self.place_upgrade(p, c.key, k, false);
                Ok(())
            }
            Command::Clear { hex, dragons } => {
                let k = *hex;
                if self.map.get(&k).is_none_or(|h| h.fauna.is_none()) && self.rivals_perched(p, k).is_empty() {
                    return fail(format!("Nothing to clear at {k}. Clear: {}.", keys_or(&self.huntable(p), "nowhere")));
                }
                let ds = self.ready_dragons(p, dragons)?;
                self.clear_hex(p, k, &ds)?;
                Ok(())
            }
            Command::AutoClear {} => self.auto_clear(p),
            Command::Perch { hex, dragons } => {
                let (k, ok) = (*hex, self.perch_hexes(p));
                if !ok.contains(&k) {
                    return fail(format!("Perch on a rival's building (not a tower). Rivals' buildings: {}.", keys_or(&ok, "none")));
                }
                let ds = self.ready_dragons(p, dragons)?;
                for d in &ds {
                    self.dragon_mut(*d).perch = Some(k);
                }
                let b = &self.buildings[&k];
                let text = format!("{me}'s {} {} on {}'s {} at {k}: it's suppressed while they stay.", ids(&ds), if ds.len() == 1 { "perches" } else { "perch" }, pname(b.owner), b.name());
                let ev = ev! {"k": "perch", "p": p, "hex": k, "ds": ds, "on": b.kind, "owner": b.owner};
                self.log(text, ev);
                Ok(())
            }
            Command::Recall { dragons } => {
                if dragons.is_empty() {
                    return fail("Choose a perched dragon to recall.");
                }
                let ds = self.own_dragons(p, dragons)?;
                for d in &ds {
                    if self.dragon(*d).perch.is_none() {
                        return fail(format!("{d} isn't perched."));
                    }
                }
                for d in &ds {
                    self.dragon_mut(*d).perch = None;
                }
                self.log(format!("{me} recalls {} home.", ids(&ds)), ev! {"k": "recall", "p": p, "ds": ds});
                Ok(())
            }
            Command::ProjectEgg { element } => {
                self.room_for_dragon(p)?;
                let key = project_dragon(element.0);
                self.players[p].pay(&egg_cost(key.0))?;
                self.hatch(p, key, true)
            }
            Command::ProjectUpgrade { upgrade, hex } => {
                let k = self.upgrade_check(p, upgrade.0, *hex)?;
                self.players[p].pay(&upgrade_project_cost(upgrade.0))?;
                self.place_upgrade(p, *upgrade, k, true);
                Ok(())
            }
            Command::Play { .. } => self.play(p, cmd),
            _ => fail(self.not_now(p, cmd)),
        }
    }

    fn play(&mut self, p: usize, cmd: &Command) -> Rule {
        let Command::Play { card, resource, dragon, hex } = cmd else { return fail(self.not_now(p, cmd)) };
        let c = self.hand_card(p, *card)?;
        let on_dragon = |name: S| dragon.ok_or_else(|| format!("Choose a dragon for the {name}."));
        match c.kind() {
            "dragon" => {
                self.room_for_dragon(p)?;
                self.players[p].pay(c.cost())?;
                self.discard(p, c);
                return self.hatch(p, c.key, false);
            }
            "action" => {}
            "building" => return fail(format!("{} is a building card: build it.", c.name())),
            _ => return fail(format!("{} is an upgrade card: upgrade a building with it.", c.name())),
        }
        let def = &DATA.actions[c.key.0];
        let mut ev = serde_json::json!({"k": "play", "p": p, "card": c.key, "name": def.name});
        let what = match def.effect {
            "hidden_point" => return fail(format!("{} isn't played; it scores while it stays in your hand.", def.name)),
            "gain_resource" | "gain_gold" => {
                let r = match resource {
                    _ if def.effect == "gain_gold" => GOLD,
                    Some(r) => *r as usize,
                    None => return fail("Choose a resource to gain."),
                };
                if def.effect == "gain_resource" && r == GOLD {
                    return fail(format!("{} doesn't gain gold: choose another resource.", def.name));
                }
                self.players[p].pay(&def.cost)?;
                let b = Bundle::one(r, def.amount);
                self.players[p].gain(&b);
                ev["gain"] = serde_json::json!(b);
                format!("gains {} {}", def.amount, RESOURCES[r])
            }
            "grow_dragon" => {
                let id = self.own_dragon(p, on_dragon(def.name)?)?;
                if self.dragon(id).stage == 3 {
                    return fail(format!("{id} is already an adult."));
                }
                self.players[p].pay(&def.cost)?;
                let d = self.dragon_mut(id);
                d.stage += 1;
                d.growth = 0;
                ev["d"] = serde_json::json!(id);
                format!("grows {} ({id}) into {}", d.name(), STAGE_INTO[d.stage])
            }
            "heal_dragon" => {
                let id = self.own_dragon(p, on_dragon(def.name)?)?;
                if self.dragon(id).damage == 0 {
                    return fail(format!("{id} isn't hurt."));
                }
                self.players[p].pay(&def.cost)?;
                self.dragon_mut(id).damage = 0;
                ev["d"] = serde_json::json!(id);
                format!("heals {id}")
            }
            "send_fauna" => {
                let f = def.fauna.unwrap();
                let name = DATA.fauna[f].name;
                let ok = self.fauna_hexes();
                let Some(k) = hex.filter(|k| ok.contains(k)) else { return fail(format!("Choose a hex for the {name}: land, with no tower or beast.")) };
                self.players[p].pay(&def.cost)?;
                let h = &mut self.map[&k];
                h.fauna = Some(Key::of(f));
                h.sent = true;
                ev["hex"] = serde_json::json!(k);
                ev["fauna"] = f.into();
                let on = self.buildings.get(&k).map_or(String::new(), |b| format!(", on {}'s {}", pname(b.owner), b.name()));
                format!("places a {name} on {k}{on}")
            }
            _ => {
                self.players[p].pay(&def.cost)?;
                self.raids_left += 1;
                ev["raids"] = self.raids_left.into();
                format!("sounds the horn: {} raids this round", self.raids_left)
            }
        };
        self.discard(p, c);
        self.log(format!("{} plays {} and {what}.", pname(p), def.name), serde_json::value::to_raw_value(&ev).unwrap());
        Ok(())
    }

    fn vote(&mut self, p: usize, t: Key) -> Rule {
        let raid = self.raid.as_ref().unwrap();
        if !self.can_vote(p) {
            return fail(NO_VOTE);
        }
        if raid.votes[p].is_some() {
            return fail("You already voted.");
        }
        let Some(i) = raid.candidates.iter().position(|c| *c == t) else { return fail(format!("{} isn't in this vote.", DATA.targets[t.0].name)) };
        self.raid.as_mut().unwrap().votes[p] = Some(i);
        self.log(format!("{} votes for {}.", pname(p), DATA.targets[t.0].name), ev! {"k": "voted", "p": p, "t": t});
        let votes = &self.raid.as_ref().unwrap().votes;
        if votes.iter().enumerate().all(|(q, v)| v.is_some() || !self.can_vote(q)) {
            self.resolve_vote();
        }
        Ok(())
    }
    /// The dragons that fight: all of them when it names none, or (None) all hold back.
    fn choose(&mut self, p: usize, named: Option<Option<&[Id]>>) -> Rule {
        let raid = self.raid.as_ref().unwrap();
        let mine = &raid.sent[p];
        if mine.is_empty() {
            return fail("You aren't in this raid: you had no raid-ready dragon when the vote ended.");
        }
        if raid.choices[p].is_some() {
            return fail("You already chose.");
        }
        let fight: Vec<Id> = match named {
            None => vec![],
            Some(None) => mine.clone(),
            Some(Some([])) => return fail("Choose dragons to fight, or hold back."),
            Some(Some(ds)) => {
                if let Some(d) = ds.iter().find(|d| !mine.contains(d)) {
                    return fail(format!("{d} isn't one of your dragons in this raid ({}).", ids(mine)));
                }
                mine.iter().copied().filter(|d| ds.contains(d)).collect()
            }
        };
        let held: Vec<Id> = mine.iter().copied().filter(|d| !fight.contains(d)).collect();
        let text = if fight.is_empty() {
            "You hold back.".into()
        } else if held.is_empty() {
            "You fight.".into()
        } else {
            format!("You fight with {} and hold back {}.", ids(&fight), ids(&held))
        };
        self.raid.as_mut().unwrap().choices[p] = Some(fight);
        self.mine(p, text);
        let raid = self.raid.as_ref().unwrap();
        if raid.sent.iter().zip(&raid.choices).all(|(s, c)| s.is_empty() || c.is_some()) {
            self.resolve_choices();
        }
        Ok(())
    }
    fn keep_command(&mut self, p: usize, card: Id) -> Rule {
        let choice = &self.players[p].choice;
        if choice.is_empty() {
            return fail("You've kept your card: wait for the others.");
        }
        let Some(c) = choice.iter().find(|c| c.id == card).copied() else { return fail(format!("Keep 1 of {}.", choice.iter().map(|c| c.named()).collect::<Vec<_>>().join(", "))) };
        self.keep(p, c);
        self.log(format!("{} keeps a building card.", pname(p)), ev! {"k": "keep", "p": p});
        if self.players.iter().all(|x| x.choice.is_empty()) {
            self.start_actions();
        }
        Ok(())
    }
    fn discard_command(&mut self, p: usize, cards: &[Id]) -> Rule {
        let hand = &self.players[p].hand;
        let cap = tuning().hand_cap;
        if hand.len() <= cap {
            return fail("You don't need to discard.");
        }
        let over = hand.len() - cap;
        let named = unique(cards);
        if named.len() != over {
            return fail(format!("You hold {} and the hand limit is {cap}: discard {}.", hand.len(), n_cards(over)));
        }
        let cards = named.into_iter().map(|id| self.hand_card(p, id)).collect::<Rule<Vec<Card>>>()?;
        for c in &cards {
            self.discard(p, *c);
        }
        self.log(format!("{} discards {}.", pname(p), n_cards(cards.len())), ev! {"k": "discard", "p": p, "n": cards.len()});
        self.maybe_end_round();
        Ok(())
    }
    fn talk(&mut self, p: usize, to: Option<Seat>, message: &str) -> Rule {
        let to = to.map(|s| self.seat(s)).transpose()?;
        if to == Some(p) {
            return fail("You can't tell yourself.");
        }
        let text = message.split(js_space).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
        if text.is_empty() {
            return fail("Type a message.");
        }
        if text.encode_utf16().count() > 500 {
            return fail("Keep it under 500 characters.");
        }
        let line = match to {
            Some(q) => format!("{} to {} (private): \"{text}\"", pname(p), pname(q)),
            None => format!("{} says: \"{text}\"", pname(p)),
        };
        self.log_to(line, ev! {"k": "talk"}, to.map(|q| vec![p, q]), None);
        Ok(())
    }

    // Why p can't do this in the phase the game is in: what's true of the command, not what the phase wants.
    fn not_now(&self, p: usize, cmd: &Command) -> String {
        let voting = self.raid.as_ref().is_some_and(|r| r.step == Step::Vote);
        match cmd {
            Command::Keep { .. } => "Keep a building card at the start of the round.".into(),
            Command::Discard { .. } => format!("Discard at the end of the round, after the raids, if you hold more than {} cards.", tuning().hand_cap),
            Command::Vote { .. } if self.phase == Phase::Raid => "The vote is over.".into(),
            Command::Vote { .. } => "Vote for a target in the raid, after everyone's turn.".into(),
            Command::Fight { .. } | Command::Hold {} if voting => "Fight or hold back after the vote.".into(),
            Command::Fight { .. } | Command::Hold {} => "Fight or hold back in the raid, after everyone's turn.".into(),
            _ if self.phase == Phase::Cards && self.players[p].choice.is_empty() => "Turns start once everyone has kept a card: wait for the others.".into(),
            _ if self.phase == Phase::Cards => "Turns start once everyone has kept a card: keep 1 of your 2 building cards.".into(),
            Command::Offer { .. } => "Turns are over for this round: make offers during the next round's turns.".into(),
            _ => "Turns are over for this round: do it on your next turn.".into(),
        }
    }

    /// A player's command. A refused one changes nothing.
    pub fn apply(&mut self, p: usize, cmd: &Command) -> Rule {
        if p >= self.n() {
            return fail("No such player.");
        }
        // Answering an offer that's gone is about the offer, even once the game is over.
        match cmd {
            Command::Accept { offer } | Command::Decline { offer } => self.open_offer(p, *offer, false).map(|_| ())?,
            Command::Cancel { offer } => self.open_offer(p, *offer, true).map(|_| ())?,
            _ => {}
        }
        if self.phase == Phase::Over {
            return fail("The game is over.");
        }
        match cmd {
            Command::Say { message } => return self.talk(p, None, message),
            Command::Tell { to, message } => return self.talk(p, Some(*to), message),
            _ => {}
        }
        let logged = self.log.len();
        let before = self.clone_without_log();
        let step = self.raid.as_ref().map(|r| r.step);
        let done = match (self.phase, cmd) {
            (_, Command::Accept { offer }) => self.accept(p, *offer),
            (_, Command::Decline { offer }) => self.decline(p, *offer),
            (_, Command::Cancel { offer }) => self.cancel(p, *offer),
            (Phase::Cards, Command::Keep { card }) => self.keep_command(p, *card),
            (Phase::Discard, Command::Discard { cards }) => self.discard_command(p, cards),
            (Phase::Raid, Command::Vote { target }) if step == Some(Step::Vote) => self.vote(p, *target),
            (Phase::Raid, Command::Fight { dragons }) if step == Some(Step::Choose) => self.choose(p, Some(dragons.as_deref())),
            (Phase::Raid, Command::Hold {}) if step == Some(Step::Choose) => self.choose(p, None),
            (Phase::Action, Command::Keep { .. } | Command::Discard { .. } | Command::Vote { .. } | Command::Fight { .. } | Command::Hold {}) => fail(self.not_now(p, cmd)),
            (Phase::Action, _) => self.action_command(p, cmd),
            _ => fail(self.not_now(p, cmd)),
        };
        match done {
            Ok(()) => self.update_titles(),
            Err(_) => {
                let mut log = mem::take(&mut self.log);
                log.truncate(logged);
                *self = before;
                self.log = log;
            }
        }
        done
    }

    /// Whose decision it is.
    pub fn waiting_on(&self) -> Vec<usize> {
        let all = 0..self.n();
        match self.phase {
            Phase::Over => vec![],
            Phase::Action => std::iter::once(self.turn).chain(all.filter(|p| *p != self.turn && self.offers.iter().any(|o| o.waits_on(*p)))).collect(),
            Phase::Discard => all.filter(|p| self.players[*p].hand.len() > tuning().hand_cap).collect(),
            Phase::Cards => all.filter(|p| !self.players[*p].choice.is_empty()).collect(),
            Phase::Raid => {
                let raid = self.raid.as_ref().unwrap();
                match raid.step {
                    Step::Vote => all.filter(|p| raid.votes[*p].is_none() && self.can_vote(*p)).collect(),
                    Step::Choose => all.filter(|p| !raid.sent[*p].is_empty() && raid.choices[*p].is_none()).collect(),
                }
            }
        }
    }
}

pub const NO_VOTE: &str = "You have no raid-ready dragon, so you don't vote.";

fn hit(d: Id, u: usize, by: S, dmg: i64, down: bool, roll: i64) -> serde_json::Value {
    let mut h = serde_json::json!({"d": d, "u": u, "by": by, "dmg": dmg, "down": down});
    if dmg > roll {
        h["beats"] = true.into();
    }
    h
}
fn sorted(ks: impl Iterator<Item = K>) -> Vec<K> {
    let mut v: Vec<K> = ks.collect();
    v.sort();
    v
}
pub fn keys_or(ks: &[K], none: &str) -> String {
    if ks.is_empty() { none.into() } else { ks.iter().map(|k| k.to_string()).collect::<Vec<_>>().join(" ") }
}
fn unique(xs: &[Id]) -> Vec<Id> {
    let mut out: Vec<Id> = vec![];
    for x in xs {
        if !out.contains(x) {
            out.push(*x);
        }
    }
    out
}
