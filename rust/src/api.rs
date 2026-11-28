//! The rules as a WASM module, for the TypeScript tools and tests (src/wasm.ts):
//! one JSON request in, one JSON answer out, and no state kept but the strong
//! bots' memory of their own offers.
use crate::data::{Key, set_points_to_win};
use crate::command::Command;
use crate::engine::Game;
use crate::map::K;
use crate::rng::Rng;
use crate::state::ByRes;
use crate::{bot, strongbot};
use serde::Deserialize;
use serde_json::value::RawValue;
use serde_json::{Value, json};
use std::sync::Mutex;

#[derive(Deserialize)]
struct Ask<'a> {
    op: &'a str,
    #[serde(borrow, default)]
    g: Option<&'a RawValue>,
    #[serde(default)]
    q: Value,
    win: i64,
}
static SEEN: Mutex<Option<strongbot::Seen>> = Mutex::new(None);

/// `{"ok": ...}`, `{"rule": "why not"}` for a command refused, or `{"error": ...}`.
pub fn call(text: &str) -> String {
    match answer(text) {
        Ok(v) => v,
        Err(e) => json!({"error": e}).to_string(),
    }
}
fn ok(v: &impl serde::Serialize) -> Result<String, String> {
    Ok(format!("{{\"ok\":{}}}", serde_json::to_string(v).map_err(|e| e.to_string())?))
}
fn answer(text: &str) -> Result<String, String> {
    let a: Ask = serde_json::from_str(text).map_err(|e| e.to_string())?;
    set_points_to_win(a.win);
    let int = |k: &str| a.q[k].as_i64().unwrap_or(0);
    let p = int("p") as usize;
    if a.op == "new" {
        let g = Game::new(int("players") as usize, int("seed"), a.q["first"].as_u64().map(|n| n as usize));
        return Ok(json!({"ok": g}).to_string());
    }
    if a.op == "generateMap" {
        let mut rng = Rng { state: int("state") as i32 };
        let map = crate::map::generate_map(&mut rng, int("players") as usize);
        return ok(&json!({"map": map, "state": rng.state}));
    }
    if a.op == "splitLoot" {
        let loot = serde_json::from_value(a.q["loot"].clone()).map_err(|e| e.to_string())?;
        let nums = |k: &str| -> Vec<i64> { serde_json::from_value(a.q[k].clone()).unwrap_or_default() };
        let order: Vec<usize> = nums("order").into_iter().map(|n| n as usize).collect();
        return ok(&crate::engine::split_loot(&loot, &nums("power"), &order));
    }
    if a.op == "rulebook" {
        return Ok(format!("{{\"ok\":{}}}", json!(crate::state::rulebook())));
    }
    let mut g: Game = serde_json::from_str(a.g.ok_or("no game")?.get()).map_err(|e| e.to_string())?;
    let mut rng = Rng { state: int("state") as i32 };
    let before = g.log.len();
    let name = a.q["name"].as_str();
    let text = |k: &str| a.q[k].as_str().unwrap_or("");
    let moved = |g: &mut Game, cmd: Value, rng: Rng| {
        let log = g.log.split_off(before);
        g.log = log; // the new entries alone
        Ok(format!("{{\"ok\":{{\"cmd\":{cmd},\"state\":{},\"g\":{}}}}}", rng.state, serde_json::to_string(&g).map_err(|e| e.to_string())?))
    };
    let mut strong = SEEN.lock().unwrap_or_else(|e| e.into_inner());
    let seen = strong.get_or_insert_default();
    let tune: strongbot::Tune = serde_json::from_value(a.q["tune"].clone()).unwrap_or_default();
    let b = strongbot::Bot { p, name, now: int("now"), tune: &tune };
    match a.op {
        "apply" => match Command::read(&a.q["cmd"]).and_then(|c| g.apply(p, &c)) {
            Ok(()) => moved(&mut g, Value::Null, rng),
            Err(e) => Ok(json!({"rule": e}).to_string()),
        },
        "botMove" => {
            let cmd = bot::bot_move(&mut g, p, &mut rng).ok_or("the bot found no legal move")?;
            moved(&mut g, json!(cmd), rng)
        }
        "standInMove" => {
            let cmd = bot::stand_in_move(&mut g, p).ok_or("the stand-in found no legal move")?;
            moved(&mut g, json!(cmd), rng)
        }
        "strongMove" => {
            let cmd = strongbot::strong_move(&mut g, &b, &mut rng, seen)?;
            moved(&mut g, json!(cmd), rng)
        }
        "worth" => {
            let h = a.q["h"].as_f64().unwrap_or_else(|| b.horizon(&g));
            Ok(json!({"ok": b.worth(&g, h)}).to_string())
        }
        "merchantPlan" => {
            let cost = serde_json::from_value(a.q["cost"].clone()).map_err(|e| e.to_string())?;
            Ok(json!({"ok": b.merchant_plan(&g, &cost)}).to_string())
        }
        "score" => {
            let s = g.score(p);
            ok(&json!({"buildings": s.buildings, "monuments": s.monuments, "titles": s.titles, "beasts": s.beasts, "raids": s.raids, "hidden": s.hidden, "public": s.public, "total": s.total}))
        }
        "standings" => ok(&g.standings()),
        "turnOrder" => ok(&g.turn_order()),
        "waitingOn" => ok(&g.waiting_on()),
        "titleValues" => ok(&g.title_values(int("t") as usize)),
        "production" => ok(&ByRes(g.production(p).map(Some))),
        "dragonCapacity" => ok(&g.dragon_capacity(p)),
        "bankRates" => ok(&crate::state::Rates(g.bank_rates(p))),
        "buildableHexes" => ok(&g.buildable_hexes(p, text("key"))),
        "upgradeTargets" => ok(&g.upgrade_targets(p, text("key"))),
        "faunaHexes" => ok(&g.fauna_hexes()),
        "autoClearTargets" => ok(&g.auto_clear_targets(p)),
        "lootOf" => ok(&g.loot_of(Key::of(text("t")))),
        "buildingYield" => {
            let k = K::parse(text("k")).ok_or("no such hex")?;
            let b = g.buildings.get(&k).ok_or("no building there")?;
            let ups: Vec<Key> = serde_json::from_value(a.q["upgrades"].clone()).unwrap_or_else(|_| b.upgrades.clone());
            let y = g.building_yield(k, b, &ups);
            ok(&json!({"makes": ByRes(y.makes), "houses": y.houses, "points": y.points}))
        }
        "buildingPoints" => {
            let k = K::parse(text("k")).ok_or("no such hex")?;
            let b = g.buildings.get(&k).ok_or("no building there")?;
            ok(&g.building_points(b, &b.upgrades))
        }
        "publicState" => ok(&crate::state::public_state_with(&g, int("lines") as usize)),
        "seatState" => ok(&crate::state::seat_state_with(&g, p, int("lines") as usize)),
        "visibleEvents" => ok(&crate::state::visible_events(&g, p, int("since") as usize)),
        "recap" => {
            let names: Vec<String> = serde_json::from_value(a.q["names"].clone()).map_err(|e| e.to_string())?;
            ok(&crate::recap::build(&g, &names, a.q["id"].as_str().unwrap_or(""), int("ended")))
        }
        "mapImage" => {
            use base64::Engine;
            ok(&base64::engine::general_purpose::STANDARD.encode(crate::mapimage::map_image(&crate::state::public_state(&g), p)))
        }
        "strongWaits" => Ok(json!({"ok": strongbot::strong_waits(&g, &b, seen)}).to_string()),
        "candidates" => {
            let cmds = bot::candidates(&g, p, &mut rng);
            Ok(json!({"ok": {"cmds": cmds, "state": rng.state}}).to_string())
        }
        "standInCommands" => Ok(json!({"ok": bot::stand_in_commands(&g, p)}).to_string()),
        op => Err(format!("no such call: {op}")),
    }
}

#[cfg(target_arch = "wasm32")]
mod export {
    /// Room for a request of n bytes.
    #[unsafe(no_mangle)]
    pub extern "C" fn room(n: usize) -> *mut u8 {
        Box::into_raw(vec![0u8; n].into_boxed_slice()) as *mut u8
    }
    /// Answers the request at `at` (from `room`), and frees it. The answer's
    /// address and length are packed in one number; give it back to `done`.
    #[unsafe(no_mangle)]
    pub extern "C" fn ask(at: *mut u8, n: usize) -> u64 {
        // SAFETY: `at` came from room(n), and is used once.
        let text = unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(at, n)) };
        let out = super::call(std::str::from_utf8(&text).unwrap_or("")).into_bytes().into_boxed_slice();
        let len = out.len() as u64;
        ((Box::into_raw(out) as *mut u8 as u64) << 32) | len
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn done(at: *mut u8, n: usize) {
        // SAFETY: `at` and `n` are an answer's, given back once.
        drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(at, n)) });
    }
}
