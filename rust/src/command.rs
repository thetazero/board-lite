//! What a player may ask of the game: JSON, `{"do": "build", "card": "c12", "hex": "2,-1"}`.
//! src/command.ts has the same commands as TypeScript's types.
use crate::data::*;
use crate::engine::{Id, pname, project_upgrades};
use crate::map::K;
use serde::de::Error;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "do", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    // At the start of the round.
    Keep {
        #[serde(deserialize_with = "card")]
        card: Id,
    },
    // On your turn. A tower floor needs no hex.
    Build {
        #[serde(deserialize_with = "card")]
        card: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hex: Option<K>,
    },
    BuildBasic {
        #[serde(deserialize_with = "basic")]
        building: Key,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hex: Option<K>,
    },
    Upgrade {
        #[serde(deserialize_with = "card")]
        card: Id,
        hex: K,
    },
    // An action card, with what it's played on if it needs one, or a dragon card.
    Play {
        #[serde(deserialize_with = "card")]
        card: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resource: Option<Resource>,
        #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "maybe_dragon")]
        dragon: Option<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hex: Option<K>,
    },
    Clear {
        hex: K,
        #[serde(deserialize_with = "dragons")]
        dragons: Vec<Id>,
    },
    AutoClear {},
    Perch {
        hex: K,
        #[serde(deserialize_with = "dragons")]
        dragons: Vec<Id>,
    },
    Recall {
        #[serde(deserialize_with = "dragons")]
        dragons: Vec<Id>,
    },
    ProjectEgg {
        #[serde(deserialize_with = "element")]
        element: Key,
    },
    ProjectUpgrade {
        #[serde(deserialize_with = "base_upgrade")]
        upgrade: Key,
        hex: K,
    },
    Merchants {
        pay: Resource,
        gain: Resource,
        #[serde(default = "once")]
        times: u32,
    },
    End {},
    // While anyone has a turn.
    Offer {
        to: To,
        #[serde(default)]
        give: Side,
        #[serde(default)]
        get: Side,
    },
    Accept {
        #[serde(deserialize_with = "offer")]
        offer: Id,
    },
    Decline {
        #[serde(deserialize_with = "offer")]
        offer: Id,
    },
    Cancel {
        #[serde(deserialize_with = "offer")]
        offer: Id,
    },
    // In the raid. `Fight` with no dragons named is all of them.
    Vote {
        #[serde(deserialize_with = "target")]
        target: Key,
    },
    Fight {
        #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "maybe_dragons")]
        dragons: Option<Vec<Id>>,
    },
    Hold {},
    // At the end of the round.
    Discard {
        #[serde(deserialize_with = "cards")]
        cards: Vec<Id>,
    },
    // Any time.
    Say {
        message: String,
    },
    Tell {
        to: Seat,
        message: String,
    },
}

impl Command {
    /// The command a client sent.
    pub fn read(v: &Value) -> Result<Command, String> {
        if v.is_string() {
            return Err("A command is JSON, like {\"do\":\"end\"}.".into());
        }
        Command::deserialize(v).map_err(|e| format!("No such command: {e}."))
    }
}

fn once() -> u32 {
    1
}

/// A resource, by name; its number is its place in RESOURCES.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Resource {
    Stone,
    Timber,
    Crystal,
    Livestock,
    Gold,
}
impl Resource {
    pub const ALL: [Resource; 5] = [Resource::Stone, Resource::Timber, Resource::Crystal, Resource::Livestock, Resource::Gold];
}

/// A player, "P2".
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Seat(pub usize);
impl Seat {
    fn parse(s: &str) -> Option<Seat> {
        let d = s.strip_prefix(['P', 'p'])?;
        if !d.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        Some(Seat(d.parse::<usize>().ok()?.checked_sub(1)?))
    }
}
impl Serialize for Seat {
    fn serialize<Z: Serializer>(&self, s: Z) -> Result<Z::Ok, Z::Error> {
        s.serialize_str(&pname(self.0))
    }
}
impl<'de> Deserialize<'de> for Seat {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Seat, D::Error> {
        let s = String::deserialize(d)?;
        Seat::parse(&s).ok_or_else(|| D::Error::custom(format!("{s:?} isn't a player, like \"P2\"")))
    }
}

/// Who an offer is to: a player, or "anyone".
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum To {
    Anyone,
    Player(Seat),
}
impl Serialize for To {
    fn serialize<Z: Serializer>(&self, s: Z) -> Result<Z::Ok, Z::Error> {
        match self {
            To::Anyone => s.serialize_str("anyone"),
            To::Player(p) => p.serialize(s),
        }
    }
}
impl<'de> Deserialize<'de> for To {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<To, D::Error> {
        let s = String::deserialize(d)?;
        if s == "anyone" {
            return Ok(To::Anyone);
        }
        Seat::parse(&s).map(To::Player).ok_or_else(|| D::Error::custom(format!("{s:?} isn't a player, like \"P2\", or \"anyone\"")))
    }
}

/// One side of a trade: `{"stone": 2, "cards": ["c12"]}`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct Side {
    #[serde(skip_serializing_if = "none")]
    pub stone: u32,
    #[serde(skip_serializing_if = "none")]
    pub timber: u32,
    #[serde(skip_serializing_if = "none")]
    pub crystal: u32,
    #[serde(skip_serializing_if = "none")]
    pub livestock: u32,
    #[serde(skip_serializing_if = "none")]
    pub gold: u32,
    #[serde(skip_serializing_if = "Vec::is_empty", deserialize_with = "cards")]
    pub cards: Vec<Id>,
}
impl Side {
    pub fn of(r: Resource, n: u32) -> Side {
        let mut s = Side::default();
        match r {
            Resource::Stone => s.stone = n,
            Resource::Timber => s.timber = n,
            Resource::Crystal => s.crystal = n,
            Resource::Livestock => s.livestock = n,
            Resource::Gold => s.gold = n,
        }
        s
    }
    pub fn bundle(&self) -> Bundle {
        Bundle([self.stone, self.timber, self.crystal, self.livestock, self.gold].map(|n| (n > 0).then_some(n as i64)))
    }
}
fn none(n: &u32) -> bool {
    *n == 0
}

// ---- names, checked as they're read ----

fn id<E: Error>(s: &str, prefix: char, what: &str) -> Result<Id, E> {
    Id::parse(s).filter(|_| s.starts_with(prefix)).ok_or_else(|| E::custom(format!("{s:?} isn't {what} id, like \"{prefix}12\"")))
}
fn list<'de, D: Deserializer<'de>>(d: D, prefix: char, what: &str) -> Result<Vec<Id>, D::Error> {
    let mut out = vec![];
    for s in Vec::<String>::deserialize(d)? {
        out.push(id(&s, prefix, what)?);
    }
    Ok(out)
}
fn card<'de, D: Deserializer<'de>>(d: D) -> Result<Id, D::Error> {
    id(&String::deserialize(d)?, 'c', "a card's")
}
fn cards<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Id>, D::Error> {
    list(d, 'c', "a card's")
}
fn offer<'de, D: Deserializer<'de>>(d: D) -> Result<Id, D::Error> {
    id(&String::deserialize(d)?, 'o', "an offer's")
}
fn maybe_dragon<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Id>, D::Error> {
    Option::<String>::deserialize(d)?.map(|s| id(&s, 'd', "a dragon's")).transpose()
}
fn dragons<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Id>, D::Error> {
    list(d, 'd', "a dragon's")
}
fn maybe_dragons<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<Id>>, D::Error> {
    let Some(names) = Option::<Vec<String>>::deserialize(d)? else { return Ok(None) };
    names.iter().map(|s| id(s, 'd', "a dragon's")).collect::<Result<_, _>>().map(Some)
}
// One of the names the game has: never a new one, so nothing a player sends is kept.
fn known<'de, D: Deserializer<'de>>(d: D, what: &str, all: &[&'static str]) -> Result<Key, D::Error> {
    let s = String::deserialize(d)?;
    all.iter().find(|x| **x == s).map(|x| Key(x)).ok_or_else(|| D::Error::custom(format!("{s:?} isn't {what}: {}", all.join(", "))))
}
fn basic<'de, D: Deserializer<'de>>(d: D) -> Result<Key, D::Error> {
    let all: Vec<&'static str> = DATA.basic_buildings.iter().map(|b| Key::of(b).0).collect();
    known(d, "a basic building", &all)
}
fn element<'de, D: Deserializer<'de>>(d: D) -> Result<Key, D::Error> {
    known(d, "an element", &ELEMENTS)
}
fn base_upgrade<'de, D: Deserializer<'de>>(d: D) -> Result<Key, D::Error> {
    let all: Vec<&'static str> = project_upgrades().map(|u| Key::of(u).0).collect();
    known(d, "an upgrade built as a special project", &all)
}
fn target<'de, D: Deserializer<'de>>(d: D) -> Result<Key, D::Error> {
    let all: Vec<&'static str> = DATA.targets.keys().map(|t| Key::of(t).0).collect();
    known(d, "a kingdom", &all)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn commands_read_back_as_written() {
        for v in [
            json!({"do": "keep", "card": "c12"}),
            json!({"do": "build_basic", "building": "quarry", "hex": "2,-1"}),
            json!({"do": "auto_clear"}),
            json!({"do": "offer", "to": "anyone", "give": {"stone": 2, "cards": ["c12"]}, "get": {"gold": 1}}),
            json!({"do": "fight", "dragons": ["d3"]}),
            json!({"do": "tell", "to": "P2", "message": "hi"}),
        ] {
            assert_eq!(json!(Command::read(&v).unwrap()), v);
        }
    }

    #[test]
    fn what_isnt_a_command_is_refused() {
        for v in [
            json!("end"),
            json!(null),
            json!({}),
            json!({"do": "dance"}),
            json!({"do": "end", "now": true}),
            json!({"do": "keep"}),
            json!({"do": "keep", "card": "d3"}),
            json!({"do": "build_basic", "building": "castle"}),
            json!({"do": "merchants", "pay": "stone", "gain": "gold", "times": -1}),
            json!({"do": "merchants", "pay": "stone", "gain": "mud"}),
            json!({"do": "offer", "to": "P0", "give": {"stone": 1}}),
            json!({"do": "offer", "to": "P2", "give": {"stone": 1.5}}),
            json!({"do": "offer", "give": {"stone": 1}}),
        ] {
            assert!(Command::read(&v).is_err(), "{v}");
        }
    }
}
