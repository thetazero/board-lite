//! The board-lite website (docs/deploy.md), in Rust. `npm run serve` at home is
//! the TypeScript server: it also seats Claude players and strong bots.
use board_lite::server::{Server, Site};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;
use tokio::signal::unix::{SignalKind, signal};

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}
fn die(why: &str) -> ! {
    eprintln!("{why}");
    std::process::exit(1)
}

fn main() {
    let port: u16 = env("PORT").map_or(8080, |p| p.parse().unwrap_or_else(|_| die("PORT is a number.")));
    if std::env::args().any(|a| a == "--health") {
        std::process::exit(!healthy(port) as i32);
    }
    let Some(address) = env("BOARD_LITE_PUBLIC_URL") else { die("Set BOARD_LITE_PUBLIC_URL to the site's address, like https://dragons.example. At home, run: npm run serve") };
    let origin = address.strip_suffix('/').unwrap_or(&address).to_lowercase();
    let host = origin.strip_prefix("https://").or_else(|| origin.strip_prefix("http://"));
    if host.is_none_or(|h| h.is_empty() || h.contains(['/', '?', '#', '@', ' '])) {
        die(&format!("The public address looks like https://example.com, not {address}"));
    }
    let site = Site { origin: origin.clone(), trust_proxy: env("BOARD_LITE_TRUST_PROXY").as_deref() == Some("1"), dir: env("BOARD_LITE_DATA").unwrap_or_else(|| "data".into()).into() };
    board_lite::room::warm();
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("a runtime");
    rt.block_on(async {
        let server = Server::new(site);
        let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.unwrap_or_else(|e| die(&format!("Port {port}: {e}")));
        println!("board-lite is running on port {port}, for {origin} ({} rooms).", server.count());
        let (mut term, mut int) = (signal(SignalKind::terminate()).unwrap(), signal(SignalKind::interrupt()).unwrap());
        // Every change is already saved, so stopping (a deploy) loses nothing.
        tokio::select! {
            _ = server.run(listener) => {}
            _ = term.recv() => {}
            _ = int.recv() => {}
        }
    });
    std::process::exit(0);
}

fn healthy(port: u16) -> bool {
    let ask = || -> std::io::Result<String> {
        let mut s = TcpStream::connect(("127.0.0.1", port))?;
        s.set_read_timeout(Some(Duration::from_secs(4)))?;
        s.write_all(b"GET /healthz HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n")?;
        let mut out = String::new();
        s.read_to_string(&mut out)?;
        Ok(out)
    };
    ask().is_ok_and(|r| r.starts_with("HTTP/1.1 200"))
}
