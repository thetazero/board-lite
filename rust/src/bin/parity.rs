//! A line-by-line door into the engine for test/rust-parity.test.ts: one JSON
//! request a line on stdin, one JSON answer a line on stdout.
use board_lite::engine::Game;
use board_lite::rng::Rng;
use board_lite::{bot, mapimage, recap, scenes, state, store, view};
use serde_json::{Value, json};
use std::io::{BufRead, Write};

fn main() {
    let mut g: Option<Game> = None;
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
            "rulebook" => serde_json::from_str(board_lite::RULEBOOK).unwrap(),
            op => {
                let g = g.as_mut().unwrap();
                match op {
                    "apply" => json!(g.apply(p, q["cmd"].as_str().unwrap()).err()),
                    "bot" => {
                        let mut rng = Rng { state: int("state") as i32 };
                        let cmd = bot::bot_move(g, p, &mut rng);
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
