//! A line-by-line door into the engine for test/rust-parity.test.ts: one JSON
//! request a line on stdin, one JSON answer a line on stdout.
use board_lite::command::Command;
use board_lite::engine::Game;
use board_lite::rng::Rng;
use board_lite::{bot, mapimage, recap, scenes, state, store, strongbot, view};
use serde_json::{Value, json};
use std::io::{BufRead, Write};

fn main() {
    let mut g: Option<Game> = None;
    let mut seen = strongbot::Seen::new();
    let mut out = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let q: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let int = |k: &str| q[k].as_i64().unwrap_or(0);
        let p = int("p") as usize;
        let answer = match q["op"].as_str().unwrap() {
            "new" => {
                g = Some(Game::new(int("players") as usize, int("seed"), q["first"].as_u64().map(|n| n as usize)));
                json!(null)
            }
            "load" => {
                g = Some(store::parse(q["text"].as_str().unwrap()).unwrap());
                json!(null)
            }
            "rulebook" => state::rulebook(),
            op => {
                let g = g.as_mut().unwrap();
                match op {
                    "apply" => json!(Command::read(&q["cmd"]).and_then(|c| g.apply(p, &c)).err()),
                    "bot" => {
                        let mut rng = Rng { state: int("state") as i32 };
                        let cmd = bot::bot_move(g, p, &mut rng);
                        json!({"cmd": cmd, "state": rng.state})
                    }
                    "strong" => {
                        let mut rng = Rng { state: int("state") as i32 };
                        let tune = strongbot::Tune::default();
                        let bot = strongbot::Bot { p, name: q["name"].as_str(), now: int("now"), tune: &tune };
                        let cmd = strongbot::strong_move(g, &bot, &mut rng, &mut seen).unwrap();
                        json!({"cmd": cmd, "state": rng.state})
                    }
                    "standin" => json!(bot::stand_in_move(g, p)),
                    "game" => json!(g),
                    "public" => json!(state::public_state(g)),
                    "seat" => json!(state::seat_state(g, p)),
                    "events" => json!(state::visible_events(g, p, int("since") as usize)),
                    "recap" => json!(recap::build(g, &["Ada".into(), "Bram".into()], "abc", 0)),
                    "scenes" => json!(scenes::ms(&g.log[int("since") as usize..])),
                    "image" => json!(mapimage::map_image(&state::public_state(g), p)),
                    "view" => {
                        let lobby = serde_json::from_value(q["lobby"].clone()).unwrap();
                        let (gs, you) = (state::public_state(g), state::seat_state(g, p));
                        let s = view::Shown { lobby: &lobby, game: Some(&gs), you: Some((&you, q["name"].as_str().unwrap())) };
                        json!([view::seat_view(&s, 25), view::seat_status(&s)])
                    }
                    _ => panic!("{op}"),
                }
            }
        };
        writeln!(out, "{answer}").unwrap();
        out.flush().unwrap();
    }
}
