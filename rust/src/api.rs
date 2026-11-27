//! The rules as a WASM module, for the TypeScript tools and tests (src/wasm.ts):
//! one JSON request in, one JSON answer out, and no state kept but the strong
//! bots' memory of their own offers.
use crate::data::set_points_to_win;
use crate::engine::Game;
use crate::rng::Rng;
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
fn answer(text: &str) -> Result<String, String> {
    let a: Ask = serde_json::from_str(text).map_err(|e| e.to_string())?;
    set_points_to_win(a.win);
    let int = |k: &str| a.q[k].as_i64().unwrap_or(0);
    let p = int("p") as usize;
    if a.op == "new" {
        let g = Game::new(int("players") as usize, int("seed"), a.q["first"].as_u64().map(|n| n as usize));
        return Ok(json!({"ok": g}).to_string());
    }
    let mut g: Game = serde_json::from_str(a.g.ok_or("no game")?.get()).map_err(|e| e.to_string())?;
    let mut rng = Rng { state: int("state") as i32 };
    let before = g.log.len();
    let name = a.q["name"].as_str();
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
        "apply" => match g.apply(p, a.q["cmd"].as_str().unwrap_or("")) {
            Ok(()) => moved(&mut g, Value::Null, rng),
            Err(e) => Ok(json!({"rule": e}).to_string()),
        },
        "botMove" => {
            let cmd = bot::bot_move(&mut g, p, &mut rng).ok_or("the bot found no legal move")?;
            moved(&mut g, cmd.into(), rng)
        }
        "standInMove" => {
            let cmd = bot::stand_in_move(&mut g, p).ok_or("the stand-in found no legal move")?;
            moved(&mut g, cmd.into(), rng)
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
