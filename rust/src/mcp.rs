//! POST /mcp: how a Claude client someone brings joins and plays a game.
use crate::data::DATA;
use crate::mapimage::map_image;
use crate::room::{Fail, Heard, Res, Room};
use crate::view;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Map, Value, json};
use std::sync::Arc;

const WAIT_SECS: f64 = 50.0;
const RECENT: usize = 25;

/// A room's code, from its link (or the TV's), or the code itself.
pub fn code_in(link: &str) -> Res<String> {
    let bad = || Fail::Room("A game is its link, like https://example.com/ABCD, or its 4-letter code.".into());
    let link = link.trim();
    // The code ends the link, before a ? or # if there is one; the TV's has it after room=.
    let ends = link.char_indices().filter(|(_, c)| matches!(c, '?' | '#')).map(|(i, _)| i).chain([link.len()]);
    for end in ends {
        let head = &link[..end];
        let head = head.strip_suffix('/').unwrap_or(head);
        let at = head.len().saturating_sub(4);
        let Some(code) = head.get(at..).filter(|c| c.len() == 4 && c.bytes().all(|b| b.is_ascii_alphabetic())) else { continue };
        let before = &head[..at];
        if before.is_empty() || before.ends_with('/') || before.ends_with("?room=") || before.ends_with("&room=") {
            return Ok(code.to_uppercase());
        }
    }
    Err(bad())
}

struct Tool {
    name: &'static str,
    help: &'static str,
    args: Value,
    required: &'static [&'static str],
}
fn tools() -> Vec<Tool> {
    let game = json!({"type": "string", "description": "The game's link, or its 4-letter room code."});
    let token = json!({"type": "string", "description": "Your seat token, from join. Keep it to yourself."});
    let h = &DATA.help;
    let tool = |name, help, args, required| Tool { name, help, args, required };
    vec![
        tool("join", "Take a seat in a game, before it starts (or take back your own seat, by its name, when no one is at it). Returns your seat token, which every other tool needs.", json!({"game": game, "name": {"type": "string", "description": "Your name at the table, up to 12 characters."}}), &["game", "name"]),
        tool("view", &h.view, json!({"game": game, "token": token}), &["game", "token"]),
        tool("act", &h.act, json!({"game": game, "token": token, "command": {"type": "string"}}), &["game", "token", "command"]),
        tool("say", &h.say, json!({"game": game, "token": token, "message": {"type": "string"}, "to": {"type": "string", "description": "A player like \"P2\" for a private message."}}), &["game", "token", "message"]),
        tool("wait", &h.wait, json!({"game": game, "token": token}), &["game", "token"]),
        tool("rules", &h.rules, json!({}), &[]),
    ]
}
fn say(text: impl Into<String>) -> Vec<Value> {
    vec![json!({"type": "text", "text": text.into()})]
}
fn text<'a>(a: &'a Map<String, Value>, k: &str) -> &'a str {
    a.get(k).and_then(|v| v.as_str()).unwrap_or("")
}

async fn listen<T>(room: &Room, tok: &str, secs: f64, then: impl FnOnce(&Room, &Heard, String) -> T) -> Res<T> {
    let since = room.shown(tok).unwrap_or_else(|| room.log_len().saturating_sub(RECENT));
    room.listen(tok, since, secs, |room, heard| {
        let events: Vec<String> = heard.events().iter().map(|e| format!("  {}", view::event_line(e))).collect();
        let status = heard.show(room, view::seat_status);
        heard.mark_shown();
        let news = if events.is_empty() { "No new events.".into() } else { format!("New events:\n{}", events.join("\n")) };
        then(room, heard, format!("{news}\n{status}"))
    })
    .await
}
async fn act(room: &Room, tok: &str, command: &str) -> Res<Vec<Value>> {
    room.command(tok, command, Some("claude"), "")?;
    listen(room, tok, 0.0, |_, _, t| say(format!("Done.\n{t}"))).await
}

async fn run(name: &str, a: &Map<String, Value>, find: impl Fn(&str) -> Res<Arc<Room>>) -> Res<Vec<Value>> {
    if name == "rules" {
        return Ok(say(crate::RULES));
    }
    let room = find(&code_in(text(a, "game"))?)?;
    if name == "join" {
        let (token, p, name) = room.join(text(a, "name"), Some("claude"))?;
        return Ok(say(format!("You are {name}, P{}, in room {}.\nYour token: {token}\nRead the rules, then wait, view and act until the game ends.", p + 1, room.code)));
    }
    let tok = text(a, "token");
    match name {
        "view" => {
            listen(&room, tok, 0.0, |room, heard, news| {
                heard.show(room, |s| match (s.game, s.you) {
                    (Some(g), Some((you, _))) => vec![
                        json!({"type": "text", "text": format!("{}\n\n{}", view::seat_view(s, RECENT), DATA.help.image)}),
                        json!({"type": "image", "data": STANDARD.encode(map_image(g, you.seat)), "mimeType": "image/png"}),
                    ],
                    _ => say(news),
                })
            })
            .await
        }
        "act" => act(&room, tok, text(a, "command")).await,
        "say" => {
            let to = text(a, "to");
            let message = text(a, "message");
            act(&room, tok, &if to.is_empty() { format!("say {message}") } else { format!("tell {to} {message}") }).await
        }
        _ => listen(&room, tok, WAIT_SECS, |_, _, t| say(t)).await,
    }
}

/// Answers one JSON-RPC message; None for a notification, which has no answer.
pub async fn rpc(m: &Map<String, Value>, find: impl Fn(&str) -> Res<Arc<Room>>) -> Option<Value> {
    let id = m.get("id").filter(|i| i.is_string() || i.is_number()).cloned().unwrap_or(Value::Null);
    let error = |code: i64, message: String| Some(json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}));
    let result = |r: Value| Some(json!({"jsonrpc": "2.0", "id": id, "result": r}));
    let Some(method) = m.get("method").and_then(|v| v.as_str()) else { return error(-32600, "Invalid request".into()) };
    if id.is_null() {
        return None;
    }
    let empty = Map::new();
    let params = m.get("params").and_then(|p| p.as_object()).unwrap_or(&empty);
    match method {
        "initialize" => {
            let asked = text(params, "protocolVersion");
            let version = ["2025-11-25", "2025-06-18", "2025-03-26"].into_iter().find(|v| *v == asked).unwrap_or("2025-11-25");
            result(json!({
                "protocolVersion": version,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "board-lite", "version": "0.1.0"},
                "instructions": "Play a seat in a game of board-lite, given its link: join, then wait, view and act until the game ends.",
            }))
        }
        "ping" => result(json!({})),
        "tools/list" => result(json!({"tools": tools().into_iter().map(|t| json!({"name": t.name, "description": t.help, "inputSchema": {"type": "object", "properties": t.args, "required": t.required}})).collect::<Vec<_>>()})),
        "tools/call" => {
            let name = text(params, "name");
            if !tools().iter().any(|t| t.name == name) {
                return error(-32602, format!("Unknown tool {name}"));
            }
            let args = params.get("arguments").and_then(|a| a.as_object()).unwrap_or(&empty);
            match run(name, args, find).await {
                Ok(content) => result(json!({"content": content})),
                Err(e) => {
                    let why = match e {
                        Fail::Room(m) => m,
                        Fail::Limit(m) => m.into(),
                        Fail::Server(m) => {
                            eprintln!("{m}");
                            "The server is down: try again later.".into()
                        }
                    };
                    result(json!({"content": say(format!("Not allowed: {why}")), "isError": true}))
                }
            }
        }
        _ => error(-32601, format!("Method not found: {method}")),
    }
}

/// How a Claude client plays, as it reads it from the game's link or /llms.txt.
pub fn guide(origin: &str, room: Option<&str>) -> String {
    let link = format!("{origin}/{}", room.unwrap_or("ABCD"));
    let game = if room.is_some() { link.clone() } else { format!("its link, like {link}") };
    let list: Vec<String> = tools()
        .into_iter()
        .map(|t| {
            let args: Vec<&String> = t.args.as_object().unwrap().keys().collect();
            let args = if args.is_empty() { "no arguments".into() } else { args.into_iter().cloned().collect::<Vec<_>>().join(", ") };
            format!("- `{}` ({args}): {}", t.name, t.help)
        })
        .collect();
    format!(
        "# board-lite: how an AI player joins

board-lite is a board game played on phones and a TV. Anyone with a game's link can take a seat, AI players included.

- Game: {game}
- MCP server: {origin}/mcp (streamable HTTP, no sign-in)

## With MCP

Claude Code: `claude mcp add --transport http board-lite {origin}/mcp`. On claude.ai, add {origin}/mcp as a custom connector.

Call `join` with the game's link and a name. It returns a seat token: pass the link and that token to every other tool. Read `rules`, then repeat `wait`, `view` and `act` until the game ends. Use `say` to talk to the table.

## With plain HTTP

The same tools, one JSON-RPC POST each, with nothing to set up:

```
curl -s {origin}/mcp -H 'content-type: application/json' \\
  -d '{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{{\"name\":\"join\",\"arguments\":{{\"game\":\"{link}\",\"name\":\"Claude\"}}}}}}'
```

{}
",
        list.join("\n")
    )
}

#[cfg(test)]
mod tests {
    use super::code_in;

    #[test]
    fn a_game_is_its_link_or_its_code() {
        for (link, want) in [("https://x.example/abcd", "ABCD"), ("https://x.example/ABCD/", "ABCD"), ("https://x.example/ABCD?x=1#y", "ABCD"), ("https://x.example/tv?room=ABCD", "ABCD"), ("https://x.example/tv?a=b&room=ABCD", "ABCD"), (" abcd ", "ABCD")] {
            assert!(code_in(link).is_ok_and(|c| c == want), "{link}");
        }
        for bad in ["https://x.example/", "", "abc", "abcde", "https://x.example/ABCDE", "https://x.example/ab1d"] {
            assert!(code_in(bad).is_err(), "{bad}");
        }
    }
}
