//! The tables and tuning numbers, as src/data.ts has them: rust/gen/gen.ts
//! writes them out, so no number is written twice.
use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};

pub type S = &'static str;
type Table<T> = IndexMap<S, T>;

pub const RESOURCES: [S; 5] = ["stone", "timber", "crystal", "livestock", "gold"];
pub const GOLD: usize = 4;
pub const LIVESTOCK: usize = 3;
pub const ELEMENTS: [S; 5] = ["fire", "ice", "lightning", "air", "water"];
pub const TITLES: [(S, S); 3] = [("army", "Strongest Dragon Army"), ("tower", "Tallest Tower"), ("hoard", "Largest Hoard")];

pub fn resource(s: &str) -> Option<usize> {
    RESOURCES.iter().position(|r| *r == s)
}

/// An amount of some resources; None where it doesn't say.
#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct Bundle(pub [Option<i64>; 5]);

impl Bundle {
    pub fn get(&self, r: usize) -> i64 {
        self.0[r].unwrap_or(0)
    }
    pub fn one(r: usize, n: i64) -> Bundle {
        let mut b = Bundle::default();
        b.0[r] = Some(n);
        b
    }
    pub fn add(&mut self, r: usize, n: i64) {
        self.0[r] = Some(self.get(r) + n);
    }
    pub fn scale(&self, k: i64) -> Bundle {
        Bundle(self.0.map(|n| n.filter(|n| *n != 0).map(|n| n * k)))
    }
    pub fn empty(&self) -> bool {
        self.0.iter().all(|n| n.is_none())
    }
    pub fn nonzero(&self) -> Bundle {
        self.scale(1)
    }
    pub fn total(&self) -> i64 {
        (0..5).map(|r| self.get(r)).sum()
    }
    pub fn text(&self) -> String {
        let parts: Vec<String> = (0..5).filter(|r| self.get(*r) > 0).map(|r| format!("{} {}", self.get(r), RESOURCES[r])).collect();
        if parts.is_empty() { "nothing".into() } else { parts.join(", ") }
    }
}
impl Serialize for Bundle {
    fn serialize<Z: Serializer>(&self, s: Z) -> Result<Z::Ok, Z::Error> {
        s.collect_map((0..5).filter_map(|r| self.0[r].map(|n| (RESOURCES[r], n))))
    }
}
impl<'de> Deserialize<'de> for Bundle {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Bundle, D::Error> {
        let m = IndexMap::<String, i64>::deserialize(d)?;
        let mut b = Bundle::default();
        for (k, n) in m {
            if let Some(r) = resource(&k) {
                b.0[r] = Some(n);
            }
        }
        Ok(b)
    }
}

/// A key into one of the tables. Copies freely; a saved game's is looked up once.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Key(pub S);

static KNOWN: LazyLock<Mutex<HashSet<S>>> = LazyLock::new(|| {
    let d = &*DATA;
    let mut k: HashSet<S> = HashSet::new();
    k.insert("tower");
    k.extend(d.buildings.keys().chain(d.upgrades.keys()).chain(d.actions.keys()).chain(d.dragons.keys()).chain(d.units.keys()).chain(d.fauna.keys()).chain(d.beasts.keys()).chain(d.targets.keys()));
    Mutex::new(k)
});

impl Key {
    pub fn of(s: &str) -> Key {
        let mut k = KNOWN.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(x) = k.get(s) {
            return Key(x);
        }
        let x: S = Box::leak(s.to_string().into_boxed_str());
        k.insert(x);
        Key(x)
    }
}
impl Serialize for Key {
    fn serialize<Z: Serializer>(&self, s: Z) -> Result<Z::Ok, Z::Error> {
        s.serialize_str(self.0)
    }
}
impl<'de> Deserialize<'de> for Key {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Key, D::Error> {
        Ok(Key::of(&String::deserialize(d)?))
    }
}

#[derive(Deserialize)]
#[serde(bound(deserialize = "'de: 'static"))]
pub struct Produces {
    pub resource: S,
    pub base: i64,
    pub die: i64,
}
#[derive(Deserialize, Serialize)]
#[serde(bound(deserialize = "'de: 'static"))]
pub struct BankRate {
    pub resource: S,
    pub rate: i64,
}
#[derive(Deserialize)]
#[serde(bound(deserialize = "'de: 'static"))]
#[serde(rename_all = "camelCase")]
pub struct BuildingDef {
    pub name: S,
    pub class: S,
    pub cost: Bundle,
    pub text: S,
    #[serde(default)]
    pub basic: bool,
    #[serde(default)]
    pub copies: usize,
    pub terrain: Option<S>,
    #[serde(default)]
    pub on_tower: bool,
    pub produces: Option<Produces>,
    #[serde(default)]
    pub makes: Bundle,
    #[serde(default)]
    pub points: i64,
    pub beside: Option<S>,
    #[serde(default)]
    pub dragon_capacity: i64,
    #[serde(default)]
    pub growth_bonus: i64,
    pub bank_rate: Option<BankRate>,
    pub per: Option<S>,
    #[serde(default)]
    pub per_own: bool,
    pub per_max: Option<i64>,
}
#[derive(Deserialize)]
#[serde(bound(deserialize = "'de: 'static"))]
#[serde(rename_all = "camelCase")]
pub struct UpgradeDef {
    pub name: S,
    pub applies_to: Vec<S>,
    pub cost: Bundle,
    pub text: S,
    pub base_bonus: Option<i64>,
    pub stack_bonus: Option<i64>,
    #[serde(default)]
    pub dragon_capacity: i64,
    #[serde(default)]
    pub points: i64,
    #[serde(default)]
    pub copies: usize,
    #[serde(default)]
    pub base: bool,
}
#[derive(Deserialize)]
#[serde(bound(deserialize = "'de: 'static"))]
pub struct ActionDef {
    pub name: S,
    pub effect: S,
    #[serde(default)]
    pub amount: i64,
    pub fauna: Option<S>,
    pub cost: Bundle,
    pub text: S,
    #[serde(default)]
    pub copies: usize,
}
#[derive(Deserialize, Clone, Copy)]
#[serde(bound(deserialize = "'de: 'static"))]
pub struct Attack {
    pub hp: i64,
    pub targets: i64,
    pub dice: i64,
    pub sides: i64,
}
impl Attack {
    pub fn power(&self) -> i64 {
        let avg = (self.targets * self.dice * (self.sides + 1)) as f64 / 2.0;
        ((self.hp as f64 * avg).sqrt() + 0.5).floor() as i64
    }
    pub fn text(&self) -> String {
        format!("{}d{}{}", self.dice, self.sides, if self.targets > 1 { format!(" on {} targets", self.targets) } else { String::new() })
    }
}
#[derive(Deserialize)]
#[serde(bound(deserialize = "'de: 'static"))]
#[serde(rename_all = "camelCase")]
pub struct DragonDef {
    pub name: S,
    pub element: S,
    pub growth_time: i64,
    pub stages: [Attack; 3],
    pub targeting: S,
    pub cost: Bundle,
    #[serde(default)]
    pub copies: usize,
    #[serde(default)]
    pub base: bool,
}
#[derive(Deserialize)]
#[serde(bound(deserialize = "'de: 'static"))]
pub struct UnitDef {
    pub name: S,
    pub hp: i64,
    pub targets: i64,
    pub dice: i64,
    pub sides: i64,
    pub element: S,
    #[serde(default)]
    pub loot: Bundle,
    #[serde(default)]
    pub points: i64,
}
impl UnitDef {
    pub fn attack(&self) -> Attack {
        Attack { hp: self.hp, targets: self.targets, dice: self.dice, sides: self.sides }
    }
}
#[derive(Deserialize)]
#[serde(bound(deserialize = "'de: 'static"))]
pub struct TargetDef {
    pub name: S,
    pub units: Vec<S>,
    pub loot: Bundle,
    pub points: Option<i64>,
}
impl TargetDef {
    pub fn power(&self) -> i64 {
        self.units.iter().map(|u| DATA.units[u].attack().power()).sum()
    }
}
#[derive(Deserialize)]
#[serde(bound(deserialize = "'de: 'static"))]
pub struct TitleMinimum {
    pub army: i64,
    pub tower: i64,
    pub hoard: i64,
}
#[derive(Deserialize)]
#[serde(bound(deserialize = "'de: 'static"))]
pub struct ProjectMultiplier {
    pub egg: i64,
    pub upgrade: i64,
}
#[derive(Deserialize)]
#[serde(bound(deserialize = "'de: 'static"))]
#[serde(rename_all = "camelCase")]
pub struct FairStart {
    pub rings: i32,
    pub ocean_cost: f64,
    pub tolerance: f64,
}
#[derive(Deserialize)]
#[serde(bound(deserialize = "'de: 'static"))]
#[serde(rename_all = "camelCase")]
pub struct Tuning {
    pub points_to_win: i64,
    pub hand_cap: usize,
    pub building_cards_drawn: usize,
    pub action_cards_per_round: usize,
    pub starting_resources: Bundle,
    pub tower_production: Bundle,
    pub bank_rate: i64,
    pub livestock_per_dragon: i64,
    pub title_points: i64,
    pub title_minimum: TitleMinimum,
    pub heal_per_round: i64,
    pub tower_dragon_capacity: i64,
    pub starting_dragon_stage: usize,
    pub special_project_multiplier: ProjectMultiplier,
    pub land_hexes_per_fauna: f64,
    pub fair_start: FairStart,
    pub fauna_wander_odds: i64,
    pub fauna_spread_weight: usize,
    pub peak_bonus: i64,
}
#[derive(Deserialize)]
pub struct Help {
    pub act: String,
    #[serde(rename = "actFields")]
    pub act_fields: serde_json::Map<String, serde_json::Value>,
    pub rules: String,
    pub say: String,
    pub view: String,
    pub wait: String,
    pub image: String,
}
#[derive(Deserialize)]
#[serde(bound(deserialize = "'de: 'static"))]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Data {
    pub tuning: Tuning,
    pub element_beats: Table<S>,
    pub element_weak: Table<Vec<S>>,
    pub terrain_noun: Table<S>,
    pub class_names: Table<S>,
    pub tower_classes: Vec<S>,
    pub production_classes: Vec<S>,
    pub buildings: Table<BuildingDef>,
    pub basic_buildings: Vec<S>,
    pub upgrades: Table<UpgradeDef>,
    pub actions: Table<ActionDef>,
    pub targeting_text: Table<S>,
    pub dragons: Table<DragonDef>,
    pub units: Table<UnitDef>,
    pub fauna: Table<UnitDef>,
    pub beasts: Table<UnitDef>,
    pub fauna_by_distance: Vec<S>,
    pub targets: Table<TargetDef>,
    pub terrain_weights: Table<i64>,
    pub stage_names: Vec<S>,
    pub help: Help,
}

pub static DATA: LazyLock<Data> = LazyLock::new(|| serde_json::from_str(include_str!("../generated/data.json")).expect("data.json"));

pub fn tuning() -> &'static Tuning {
    &DATA.tuning
}
pub fn fauna_def(k: &str) -> &'static UnitDef {
    DATA.fauna.get(k).unwrap_or_else(|| &DATA.beasts[k])
}
pub fn is_beast(k: &str) -> bool {
    DATA.beasts.contains_key(k)
}
pub fn elemental(dmg: i64, by: &str, to: &str) -> i64 {
    if DATA.element_beats.get(by).is_some_and(|x| *x == to) { dmg * 2 } else { dmg }
}
pub fn or_list<T: AsRef<str>>(xs: &[T]) -> String {
    list(xs, "or")
}
pub fn and_list<T: AsRef<str>>(xs: &[T]) -> String {
    list(xs, "and")
}
fn list<T: AsRef<str>>(xs: &[T], word: &str) -> String {
    let v: Vec<&str> = xs.iter().map(|x| x.as_ref()).collect();
    match v.split_last() {
        None => String::new(),
        Some((l, [])) => l.to_string(),
        Some((l, h)) => format!("{} {word} {l}", h.join(", ")),
    }
}

static WIN: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
/// The points that win: the tuning's, unless a test plays to fewer.
pub fn points_to_win() -> i64 {
    match WIN.load(std::sync::atomic::Ordering::Relaxed) {
        0 => DATA.tuning.points_to_win,
        n => n,
    }
}
pub fn set_points_to_win(n: i64) {
    WIN.store(n, std::sync::atomic::Ordering::Relaxed);
}
