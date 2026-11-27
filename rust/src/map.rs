//! The hex map in axial coordinates, as src/map.ts makes it.
use crate::data::*;
use crate::rng::Rng;
use indexmap::IndexMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error};
use std::cmp::Ordering;
use std::fmt;
use std::hash::{BuildHasherDefault, Hash, Hasher};

/// A hex's key: "q,r" to everything outside, and it sorts as that text does.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct K(pub i32, pub i32);

#[derive(Default)]
pub struct KHash(u64);
impl Hasher for KHash {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, b: &[u8]) {
        for x in b {
            self.write_u64(*x as u64);
        }
    }
    fn write_u64(&mut self, n: u64) {
        self.0 = (self.0 ^ n).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        self.0 ^= self.0 >> 29;
    }
}
pub type Hexes<T> = IndexMap<K, T, BuildHasherDefault<KHash>>;

impl Hash for K {
    fn hash<H: Hasher>(&self, h: &mut H) {
        h.write_u64(((self.0 as u32 as u64) << 32) | self.1 as u32 as u64)
    }
}
impl fmt::Display for K {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{},{}", self.0, self.1)
    }
}
impl Ord for K {
    fn cmp(&self, o: &K) -> Ordering {
        self.to_string().cmp(&o.to_string())
    }
}
impl PartialOrd for K {
    fn partial_cmp(&self, o: &K) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl Serialize for K {
    fn serialize<Z: Serializer>(&self, s: Z) -> Result<Z::Ok, Z::Error> {
        s.collect_str(self)
    }
}
impl<'de> Deserialize<'de> for K {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<K, D::Error> {
        K::parse(&String::deserialize(d)?).ok_or_else(|| D::Error::custom("not a hex"))
    }
}
impl K {
    pub fn parse(s: &str) -> Option<K> {
        let (q, r) = s.trim().split_once(',')?;
        let num = |x: &str| {
            let d = x.strip_prefix('-').unwrap_or(x);
            if d.is_empty() || !d.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            // Off any map, however far.
            let n: i32 = d.parse().unwrap_or(1_000_000_000).min(1_000_000_000);
            Some(if x.starts_with('-') { -n } else { n })
        };
        Some(K(num(q)?, num(r)?))
    }
    pub fn neighbors(self) -> [K; 6] {
        DIRECTIONS.map(|(q, r)| K(self.0 + q, self.1 + r))
    }
    pub fn adjacent(self, o: K) -> bool {
        distance(self.0 - o.0, self.1 - o.1) == 1
    }
}

pub const PEAK: K = K(0, 0);
pub const DIRECTIONS: [(i32, i32); 6] = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)];

fn is_false(b: &bool) -> bool {
    !*b
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Hex {
    pub q: i32,
    pub r: i32,
    pub terrain: Key,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fauna: Option<Key>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub sent: bool,
}
impl Hex {
    pub fn ocean(&self) -> bool {
        self.terrain.0 == "ocean"
    }
    pub fn beast(&self) -> bool {
        self.fauna.is_some_and(|f| is_beast(f.0))
    }
}

pub fn distance(q: i32, r: i32) -> i32 {
    q.abs().max(r.abs()).max((q + r).abs())
}
fn map_radius(players: usize) -> i32 {
    match players {
        ..=3 => 4,
        4 => 5,
        _ => 6,
    }
}
pub fn tower_spots(players: usize) -> Vec<K> {
    if players == 5 {
        return vec![K(4, -1), K(3, -4), K(-2, -2), K(-4, 2), K(-1, 4)];
    }
    let d = map_radius(players) - 1;
    let corners: &[usize] = match players {
        2 => &[0, 3],
        3 => &[0, 2, 4],
        4 => &[0, 1, 3, 4],
        _ => &[0, 1, 2, 3, 4, 5],
    };
    corners.iter().map(|i| K(DIRECTIONS[*i].0 * d, DIRECTIONS[*i].1 * d)).collect()
}
fn ring(d: i32) -> Vec<(i32, i32)> {
    let mut out = vec![];
    for i in 0..6 {
        let (c, s) = (DIRECTIONS[i], DIRECTIONS[(i + 2) % 6]);
        for j in 0..d {
            out.push((c.0 * d + s.0 * j, c.1 * d + s.1 * j));
        }
    }
    out
}
fn terrain_deck(players: usize) -> Vec<Key> {
    let radius = map_radius(players) as i64;
    let open = 3 * radius * (radius + 1) + 1 - tower_spots(players).len() as i64 - 1 - 6;
    let total: i64 = DATA.terrain_weights.values().sum();
    let mut deck = vec![];
    for (t, w) in &DATA.terrain_weights {
        if *t != "desert" {
            deck.extend(vec![Key::of(t); (open * w / total) as usize]);
        }
    }
    let desert = open as usize - deck.len();
    deck.extend(vec![Key::of("desert"); desert]);
    deck
}

const MAX_ROLLS: usize = 2000;

pub fn generate_map(rng: &mut Rng, players: usize) -> Hexes<Hex> {
    let mut best: Option<(f64, Hexes<Hex>)> = None;
    for _ in 0..MAX_ROLLS {
        let hexes = roll_map(rng, players);
        let spread = start_spread(&hexes, players);
        if spread <= tuning().fair_start.tolerance {
            return hexes;
        }
        if best.as_ref().is_none_or(|b| spread < b.0) {
            best = Some((spread, hexes));
        }
    }
    best.unwrap().1
}

fn opportunity(hexes: &Hexes<Hex>, t: K, ring: &[(i32, i32)]) -> f64 {
    let mut sum = 0.0;
    for (q, r) in ring {
        let Some(h) = hexes.get(&K(t.0 + q, t.1 + r)) else { continue };
        if DATA.basic_buildings.iter().any(|b| DATA.buildings[b].terrain == Some(h.terrain.0)) {
            sum += 1.0;
        } else if h.ocean() {
            sum += 1.0 - tuning().fair_start.ocean_cost;
        }
    }
    sum
}

fn start_spread(hexes: &Hexes<Hex>, players: usize) -> f64 {
    let rings: Vec<Vec<(i32, i32)>> = (1..=tuning().fair_start.rings).map(ring).collect();
    let rows: Vec<Vec<f64>> = tower_spots(players)
        .into_iter()
        .map(|t| {
            let mut row: Vec<f64> = rings.iter().map(|r| opportunity(hexes, t, r)).collect();
            row.push(row.iter().fold(0.0, |a, b| a + b));
            row
        })
        .collect();
    let mut worst: f64 = 0.0;
    for c in 0..rows[0].len() {
        let avg = rows.iter().fold(0.0, |a, r| a + r[c]) / rows.len() as f64;
        if avg == 0.0 {
            continue;
        }
        for r in &rows {
            worst = worst.max((r[c] - avg).abs() / avg);
        }
    }
    worst
}

fn roll_map(rng: &mut Rng, players: usize) -> Hexes<Hex> {
    let radius = map_radius(players);
    let (ocean, desert, harbor) = (Key::of("ocean"), Key::of("desert"), Key::of("harbor"));
    let mut hexes: Hexes<Hex> = Hexes::default();
    for q in -radius - 1..=radius + 1 {
        for r in (-radius - 1).max(-q - radius - 1)..=(radius + 1).min(-q + radius + 1) {
            hexes.insert(K(q, r), Hex { q, r, terrain: if distance(q, r) > radius { ocean } else { desert }, fauna: None, sent: false });
        }
    }
    let towers = tower_spots(players);
    let coast = ring(radius);
    for side in 0..6 {
        let between = &coast[(side * radius + 1) as usize..((side + 1) * radius) as usize];
        let open: Vec<(i32, i32)> = between.iter().copied().filter(|(q, r)| !K(*q, *r).neighbors().iter().any(|n| towers.contains(n))).collect();
        let (q, r) = rng.pick(if open.is_empty() { between } else { &open });
        hexes[&K(q, r)].terrain = harbor;
    }
    let mut deck = terrain_deck(players);
    let open: Vec<K> = hexes.iter().filter(|(k, h)| h.terrain == desert && !towers.contains(k) && **k != PEAK).map(|(k, _)| *k).collect();
    rng.shuffle(&mut deck);
    for (t, k) in deck.into_iter().zip(open) {
        hexes[&k].terrain = t;
    }
    place_beasts(rng, &mut hexes, players);
    place_fauna(rng, &mut hexes, players);
    hexes
}

/// Is hex k held by a great beast: on it, or next to it?
pub fn near_beast(hexes: &Hexes<Hex>, k: K) -> bool {
    hexes.get(&k).is_some_and(|h| h.beast()) || k.neighbors().iter().any(|n| hexes.get(n).is_some_and(|h| h.beast()))
}

fn place_beasts(rng: &mut Rng, hexes: &mut Hexes<Hex>, players: usize) {
    hexes[&PEAK].terrain = Key::of("mountain");
    hexes[&PEAK].fauna = Some(Key::of("thunderbird"));
    let mut harbors: Vec<K> = hexes.iter().filter(|(_, h)| h.terrain.0 == "harbor").map(|(k, _)| *k).collect();
    harbors.sort();
    let harbor = rng.pick(&harbors);
    let waters = leviathan_waters(hexes, players);
    let sea: Vec<K> = harbor.neighbors().into_iter().filter(|n| hexes.get(n).is_some_and(|h| h.ocean())).collect();
    let clear: Vec<K> = sea.iter().copied().filter(|n| waters.contains(n)).collect();
    let k = rng.pick(if clear.is_empty() { &sea } else { &clear });
    hexes[&k].fauna = Some(Key::of("leviathan"));
}

pub fn leviathan_waters(hexes: &Hexes<Hex>, players: usize) -> Vec<K> {
    let towers = tower_spots(players);
    let near = |k: K| towers.iter().any(|t| distance(t.0 - k.0, t.1 - k.1) <= 1);
    let mut sea: Vec<K> = hexes.iter().filter(|(_, h)| h.ocean()).map(|(k, _)| *k).collect();
    sea.sort();
    let clear: Vec<K> = sea.iter().copied().filter(|s| !s.neighbors().iter().any(|n| hexes.contains_key(n) && near(*n))).collect();
    if clear.is_empty() { sea } else { clear }
}

fn place_fauna(rng: &mut Rng, hexes: &mut Hexes<Hex>, players: usize) {
    let towers = tower_spots(players);
    let away = |k: K| towers.iter().map(|t| distance(k.0 - t.0, k.1 - t.1)).min().unwrap();
    let land: Vec<K> = hexes.iter().filter(|(_, h)| !h.ocean()).map(|(k, _)| *k).collect();
    let mut open: Vec<K> = land.iter().copied().filter(|k| away(*k) >= 2 && !near_beast(hexes, *k)).collect();
    rng.shuffle(&mut open);
    let n = (land.len() as f64 / tuning().land_hexes_per_fauna + 0.5).floor() as usize;
    for k in open.into_iter().take(n) {
        let i = (away(k) as usize - 2).min(DATA.fauna_by_distance.len() - 1);
        hexes[&k].fauna = Some(Key::of(DATA.fauna_by_distance[i]));
    }
}
