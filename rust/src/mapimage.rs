//! The board as a PNG for Claude players, pixel for pixel as src/mapimage.ts draws it.
use crate::data::S;
use crate::map::{DIRECTIONS, K};
use crate::state::{HexView, PublicState};
use crate::view::fauna_code;
use std::collections::HashMap;

type Rgb = [u8; 3];
const PLAYER: [Rgb; 6] = [[0xe5, 0x48, 0x4d], [0x3e, 0x7b, 0xfa], [0xf2, 0xb6, 0x00], [0x30, 0xa4, 0x6c], [0xa3, 0x5b, 0xd8], [0xf7, 0x6b, 0x15]];
const BG: Rgb = [0xff; 3];
const LINE: Rgb = [0x6b, 0x6f, 0x78];
const INK: Rgb = [0x11; 3];
fn terrain(t: S) -> Rgb {
    match t {
        "mountain" => [0xc4, 0xc5, 0xc9],
        "forest" => [0xa9, 0xc4, 0xad],
        "ley" => [0xc6, 0xbe, 0xdd],
        "meadow" => [0xd6, 0xe8, 0xbf],
        "harbor" => [0xb5, 0xdf, 0xda],
        "ocean" => [0x9f, 0xba, 0xd6],
        _ => [0xef, 0xe6, 0xcb],
    }
}
fn round(x: f64) -> f64 {
    (x + 0.5).floor()
}
fn mix(a: Rgb, b: Rgb, t: f64) -> Rgb {
    std::array::from_fn(|i| round(a[i] as f64 + (b[i] as f64 - a[i] as f64) * t) as u8)
}
fn light(c: Rgb) -> bool {
    0.299 * c[0] as f64 + 0.587 * c[1] as f64 + 0.114 * c[2] as f64 > 150.0
}
const FONT: &[(char, [&str; 7])] = &[
    ('0', [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."]),
    ('1', ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."]),
    ('2', [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"]),
    ('3', ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."]),
    ('4', ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."]),
    ('5', ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."]),
    ('6', ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."]),
    ('7', ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."]),
    ('8', [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."]),
    ('9', [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."]),
    ('-', [".....", ".....", ".....", ".###.", ".....", ".....", "....."]),
    (',', [".....", ".....", ".....", ".....", ".##..", "..#..", ".#..."]),
    (':', [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."]),
    (' ', [".....", ".....", ".....", ".....", ".....", ".....", "....."]),
    ('B', ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."]),
    ('E', ["#####", "#....", "#....", "####.", "#....", "#....", "#####"]),
    ('H', ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"]),
    ('O', [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."]),
    ('P', ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."]),
    ('S', [".####", "#....", "#....", ".###.", "....#", "....#", "####."]),
    ('T', ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."]),
    ('U', ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."]),
    ('V', ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."]),
    ('W', ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."]),
    ('X', ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"]),
    ('Y', ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."]),
];

struct Canvas {
    px: Vec<u8>,
    w: i64,
    h: i64,
}
impl Canvas {
    fn set(&mut self, x: i64, y: i64, c: Rgb) {
        if x >= 0 && y >= 0 && x < self.w && y < self.h {
            let i = ((y * self.w + x) * 3) as usize;
            self.px[i..i + 3].copy_from_slice(&c);
        }
    }
    fn rect(&mut self, x: i64, y: i64, w: i64, h: i64, c: Rgb) {
        for j in 0..h {
            for i in 0..w {
                self.set(x + i, y + j, c);
            }
        }
    }
    // (The TypeScript steps from the floor by 1 to the far edge, fractional or not.)
    fn disc(&mut self, cx: f64, cy: f64, r: f64, c: Rgb) {
        let mut y = (cy - r).floor();
        while y <= cy + r {
            let mut x = (cx - r).floor();
            while x <= cx + r {
                if (x - cx).powi(2) + (y - cy).powi(2) <= r * r {
                    self.set(x as i64, y as i64, c);
                }
                x += 1.0;
            }
            y += 1.0;
        }
    }
    fn text(&mut self, s: &str, cx: f64, cy: f64, c: Rgb, scale: i64) {
        let w = (s.len() as i64 * 6 - 1) * scale;
        let x0 = round(cx - w as f64 / 2.0) as i64;
        let y0 = round(cy - (7 * scale) as f64 / 2.0) as i64;
        for (n, ch) in s.chars().enumerate() {
            let Some((_, g)) = FONT.iter().find(|f| f.0 == ch.to_ascii_uppercase()) else { continue };
            for (j, row) in g.iter().enumerate() {
                for (i, b) in row.bytes().enumerate() {
                    if b == b'#' {
                        self.rect(x0 + (n * 6 + i) as i64 * scale, y0 + j as i64 * scale, scale, scale, c);
                    }
                }
            }
        }
    }
    fn png(&self) -> Vec<u8> {
        let row = self.w as usize * 3;
        let mut raw = Vec::with_capacity((row + 1) * self.h as usize);
        for r in self.px.chunks(row) {
            raw.push(0);
            raw.extend_from_slice(r);
        }
        let mut out = vec![137, 80, 78, 71, 13, 10, 26, 10];
        let mut chunk = |kind: &[u8], data: &[u8]| {
            out.extend((data.len() as u32).to_be_bytes());
            let at = out.len();
            out.extend(kind);
            out.extend(data);
            let crc = crc32(&out[at..]);
            out.extend(crc.to_be_bytes());
        };
        let mut head = vec![];
        head.extend((self.w as u32).to_be_bytes());
        head.extend((self.h as u32).to_be_bytes());
        head.extend([8, 2, 0, 0, 0]);
        chunk(b"IHDR", &head);
        chunk(b"IDAT", &miniz_oxide::deflate::compress_to_vec_zlib(&raw, 6));
        chunk(b"IEND", &[]);
        out
    }
}
fn crc32(data: &[u8]) -> u32 {
    let mut c = !0u32;
    for b in data {
        c ^= *b as u32;
        for _ in 0..8 {
            c = if c & 1 == 1 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
        }
    }
    !c
}

const R: f64 = 30.0; // hex size: centre to corner, in pixels

/// The empty land hexes each player can build on.
fn buildable(h: &HexView, by: &HashMap<K, &HexView>) -> Vec<usize> {
    if h.terrain == "ocean" || h.building.is_some() || h.fauna.is_some() || h.held.is_some() {
        return vec![];
    }
    let mut who: Vec<usize> = h.k.neighbors().iter().filter_map(|n| by.get(n)).filter(|n| n.suppressed.is_none()).filter_map(|n| n.building.as_ref().map(|b| b.owner)).collect();
    who.sort();
    who.dedup();
    who
}

pub fn map_image(g: &PublicState, you: usize) -> Vec<u8> {
    let sq3 = 3f64.sqrt();
    let center = |q: f64, r: f64| (R * sq3 * (q + r / 2.0), R * 1.5 * r);
    let by: HashMap<K, &HexView> = g.map.iter().map(|h| (h.k, h)).collect();
    let owner = |h: &HexView| h.building.as_ref().map(|b| b.owner);
    let sides = DIRECTIONS.map(|(q, r)| {
        let (x, y) = center(q as f64, r as f64);
        let l = x.hypot(y);
        (x / l, y / l, q, r)
    });
    let (mut x0, mut x1, mut y0, mut y1) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
    for h in &g.map {
        let (x, y) = center(h.q as f64, h.r as f64);
        x0 = x0.min(x);
        x1 = x1.max(x);
        y0 = y0.min(y);
        y1 = y1.max(y);
    }
    let pad = 8.0;
    let (ox, oy) = (-x0 + R + pad, -y0 + R + pad);
    let players = g.players.len() as i64;
    let row = 26;
    let board = (y1 - y0 + 2.0 * R + 2.0 * pad).ceil() as i64;
    let w = (x1 - x0 + 2.0 * R + 2.0 * pad).ceil() as i64;
    let h = board + row * ((players + 2) / 3) + pad as i64;
    let mut c = Canvas { px: vec![0xff; (w * h * 3) as usize], w, h };
    let inr = (R * sq3) / 2.0;
    for py in 0..board {
        for px in 0..w {
            let (x, y) = (px as f64 - ox, py as f64 - oy);
            let (fq, fr) = (((sq3 / 3.0) * x - y / 3.0) / R, ((2.0 / 3.0) * y) / R);
            let (mut rq, mut rr) = (round(fq), round(fr));
            let rs = round(-fq - fr);
            let (dq, dr, ds) = ((rq - fq).abs(), (rr - fr).abs(), (rs + fq + fr).abs());
            if dq > dr && dq > ds {
                rq = -rr - rs;
            } else if dr > ds {
                rr = -rq - rs;
            }
            let Some(h) = by.get(&K(rq as i32, rr as i32)) else { continue };
            let (cx, cy) = center(h.q as f64, h.r as f64);
            let (lx, ly) = (x - cx, y - cy);
            let (mut d, mut side) = (-1.0, sides[0]);
            for s in sides {
                let v = (lx * s.0 + ly * s.1) / inr;
                if v > d {
                    d = v;
                    side = s;
                }
            }
            let own = owner(h);
            let mut col = own.map_or_else(|| terrain(h.terrain), |p| PLAYER[p]);
            if (h.held.is_some() || h.suppressed.is_some()) && (px + py) % 8 < 2 {
                col = mix(col, INK, 0.55);
            }
            if h.building.as_ref().is_some_and(|b| b.kind == "tower") && d > 0.62 && d < 0.74 {
                col = BG;
            }
            let across = by.get(&K(h.q + side.2, h.r + side.3)).and_then(|h| owner(h));
            match own {
                Some(p) if across != own && d > 0.84 => col = mix(PLAYER[p], INK, 0.6),
                _ if d > 0.95 => col = LINE,
                _ => {}
            }
            c.set(px, py, col);
        }
    }
    for h in &g.map {
        let (x, y) = center(h.q as f64, h.r as f64);
        let (x, y) = (x + ox, y + oy);
        let fill = owner(h).map_or_else(|| terrain(h.terrain), |p| PLAYER[p]);
        if let Some(f) = &h.fauna {
            c.disc(x, y - R * 0.38, 8.0, INK);
            c.text(&fauna_code(f.key), x + 0.5, y - R * 0.38, BG, 1);
        }
        if h.terrain != "ocean" || h.fauna.is_some() {
            c.text(&h.k.to_string(), x, y + if h.fauna.is_some() { 4.0 } else { 0.0 }, if light(fill) { INK } else { BG }, 1);
        }
        let dots = buildable(h, &by);
        for (i, p) in dots.iter().enumerate() {
            let dx = (i as f64 - (dots.len() - 1) as f64 / 2.0) * 9.0;
            c.disc(x + dx, y - R * 0.42, 4.2, INK);
            c.disc(x + dx, y - R * 0.42, 3.2, PLAYER[*p]);
        }
    }
    for p in 0..players {
        let lx = pad as i64 + (p % 3) * ((w - 16) / 3);
        let ly = board + (p / 3) * row + 4;
        c.rect(lx, ly, 18, 18, INK);
        c.rect(lx + 2, ly + 2, 14, 14, PLAYER[p as usize]);
        let n = g.map.iter().filter(|h| owner(h) == Some(p as usize)).count();
        let label = format!("P{}{}: {n} HEXES", p + 1, if p as usize == you { " YOU" } else { "" });
        c.text(&label, (lx + 24) as f64 + ((label.len() * 6 - 1) * 2) as f64 / 2.0, (ly + 9) as f64, INK, 2);
    }
    c.png()
}
