//! What a public website adds (src/server/public.ts): limits on what one
//! visitor, and everyone together, can use, and clearing old games off the disk.
use crate::room::{Fail, Res};
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

const REQUESTS_PER_MINUTE: u32 = 600;
const ROOMS_PER_HOUR: u32 = 20;
const WRONG_CODES_PER_MINUTE: u32 = 30;
const OPEN: usize = 60;
const OPEN_TOTAL: usize = 3000;
const ROOMS_TOTAL: usize = 500;
const DAY: u64 = 24 * 60 * 60;
pub const SAVED_KEEP: Duration = Duration::from_secs(30 * DAY);
const RECAP_KEEP: Duration = Duration::from_secs(365 * DAY);
const MINUTE: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum What {
    Request,
    Room,
    Code,
}
#[derive(Debug, Default)]
struct Held {
    by: HashMap<String, usize>,
    total: usize,
}
pub struct Limits {
    counts: Mutex<HashMap<(What, String), (u32, Instant)>>,
    open: Arc<Mutex<Held>>,
    most: [u32; 3],
    open_each: usize,
}
/// Something held open (a stream, a wait), until dropped.
#[derive(Debug)]
pub struct Hold {
    open: Arc<Mutex<Held>>,
    who: String,
}
impl Drop for Hold {
    fn drop(&mut self) {
        let mut h = lock(&self.open);
        h.total -= 1;
        if let Some(n) = h.by.get_mut(&self.who) {
            *n -= 1;
            if *n == 0 {
                h.by.remove(&self.who);
            }
        }
    }
}
pub fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
fn busy<T>() -> Res<T> {
    Err(Fail::Limit("Too many requests: try again later."))
}

impl Default for Limits {
    fn default() -> Limits {
        Limits { counts: Default::default(), open: Default::default(), most: [REQUESTS_PER_MINUTE, ROOMS_PER_HOUR, WRONG_CODES_PER_MINUTE], open_each: OPEN }
    }
}
impl Limits {
    fn count(&self, what: What, who: &str, add: u32) -> Res {
        let (max, per) = match what {
            What::Request => (self.most[0], MINUTE),
            What::Room => (self.most[1], MINUTE * 60),
            What::Code => (self.most[2], MINUTE),
        };
        let now = Instant::now();
        let mut counts = lock(&self.counts);
        let c = counts.entry((what, who.to_string())).or_insert((0, now + per));
        if c.1 <= now {
            *c = (0, now + per);
        }
        if c.0 + add.max(1) > max {
            return busy();
        }
        c.0 += add;
        Ok(())
    }
    pub fn request(&self, who: &str) -> Res {
        self.count(What::Request, who, 1)
    }
    pub fn new_room(&self, who: &str, rooms: usize) -> Res {
        if rooms >= ROOMS_TOTAL {
            return Err(Fail::Limit("Too many games are open: try again later."));
        }
        self.count(What::Room, who, 1)
    }
    /// Before looking up a code: refused once this visitor has tried too many wrong ones.
    pub fn may_look_up(&self, who: &str) -> Res {
        self.count(What::Code, who, 0)
    }
    pub fn wrong_code(&self, who: &str) -> Res {
        self.count(What::Code, who, 1)
    }
    pub fn hold(&self, who: &str) -> Res<Hold> {
        let mut h = lock(&self.open);
        if h.by.get(who).copied().unwrap_or(0) >= self.open_each || h.total >= OPEN_TOTAL {
            return Err(Fail::Limit("Too many connections: close one first."));
        }
        h.total += 1;
        *h.by.entry(who.to_string()).or_default() += 1;
        Ok(Hold { open: self.open.clone(), who: who.to_string() })
    }
    pub fn sweep(&self) {
        let now = Instant::now();
        let mut counts = lock(&self.counts);
        counts.retain(|_, c| c.1 > now);
        counts.shrink_to_fit();
    }
}

/// Who a request is from, for the limits. One IPv6 home is a whole /64.
pub fn visitor(peer: IpAddr, forwarded: Option<&str>) -> String {
    let last = forwarded.and_then(|f| f.split(',').next_back()).map(|s| s.trim()).filter(|s| !s.is_empty());
    let ip = match last {
        Some(s) => match s.parse::<IpAddr>() {
            Ok(ip) => ip,
            Err(_) => return s.chars().take(64).collect(),
        },
        None => peer,
    };
    match ip.to_canonical() {
        IpAddr::V4(a) => a.to_string(),
        IpAddr::V6(a) => {
            let s = a.segments();
            format!("{:x}:{:x}:{:x}:{:x}", s[0], s[1], s[2], s[3])
        }
    }
}

fn old(path: &Path, keep: Duration) -> bool {
    let at = std::fs::metadata(path).and_then(|m| m.modified());
    at.is_ok_and(|t| SystemTime::now().duration_since(t).is_ok_and(|d| d > keep))
}
fn names(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir).map_or(vec![], |d| d.filter_map(|e| e.ok()?.file_name().into_string().ok()).collect())
}
/// The room a file in the rooms' folder is of, if the server named it.
fn room_of(name: &str) -> Option<&str> {
    let code = name.get(..4).filter(|c| c.bytes().all(|b| b.is_ascii_uppercase()))?;
    [".json", ".seats.json", ".log.jsonl", ".jsonl", ".seats.jsonl", ".log.json"].contains(&&name[4..]).then_some(code)
}
/// Delete the files of rooms untouched for 30 days (but not those hosted now) and old recaps.
pub fn clear_old(dir: &Path, hosted: impl Fn(&str) -> bool) {
    let mut rooms: HashMap<String, Vec<PathBuf>> = HashMap::new();
    for n in names(dir) {
        if let Some(code) = room_of(&n).filter(|c| !hosted(c)) {
            rooms.entry(code.into()).or_default().push(dir.join(&n));
        }
    }
    for files in rooms.into_values().filter(|fs| fs.iter().all(|f| old(f, SAVED_KEEP))) {
        for f in files {
            let _ = std::fs::remove_file(f);
        }
    }
    let recaps = dir.join("recaps");
    for n in names(&recaps) {
        let f = recaps.join(&n);
        if n.strip_suffix(".json").is_some_and(is_recap_id) && old(&f, RECAP_KEEP) {
            let _ = std::fs::remove_file(f);
        }
    }
}
pub fn is_recap_id(s: &str) -> bool {
    s.len() == 12 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_visitor_is_their_address() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        assert_eq!(visitor(ip("::ffff:10.0.0.1"), None), "10.0.0.1");
        assert_eq!(visitor(ip("10.0.0.1"), Some("9.9.9.9, 1.2.3.4")), "1.2.3.4");
        assert_eq!(visitor(ip("2001:db8:1:2:a:b:c:d"), None), visitor(ip("2001:db8:1:2::9"), None));
        assert_ne!(visitor(ip("2001:db8:1:2::9"), None), visitor(ip("2001:db8:1:3::9"), None));
    }

    #[test]
    fn each_visitor_has_their_own_limits() {
        let l = Limits { most: [600, 2, 2], open_each: 1, ..Default::default() };
        assert!(l.new_room("a", 0).is_ok() && l.new_room("a", 0).is_ok());
        assert!(l.new_room("a", 0).is_err());
        assert!(l.new_room("b", 0).is_ok());
        assert!(l.new_room("c", ROOMS_TOTAL).is_err());
        for _ in 0..2 {
            assert!(l.may_look_up("a").is_ok() && l.wrong_code("a").is_ok());
        }
        assert!(l.may_look_up("a").is_err());
        let held = l.hold("a").unwrap();
        assert!(l.hold("a").is_err());
        drop(held);
        assert!(l.hold("a").is_ok());
    }

    #[test]
    fn old_rooms_and_recaps_are_cleared() {
        let dir = std::env::temp_dir().join(format!("board-lite-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("recaps")).unwrap();
        let put = |n: &str, days: u64| {
            let f = std::fs::File::create(dir.join(n)).unwrap();
            f.set_modified(SystemTime::now() - Duration::from_secs(days * DAY)).unwrap();
        };
        for (n, days) in [("BBBB.json", 40), ("BBBB.seats.json", 40), ("BBBB.log.jsonl", 40), ("CCCC.json", 40), ("DDDD.json", 1), ("EEEE.json", 40), ("EEEE.log.jsonl", 1), ("notes.json", 400), ("recaps/0123456789ab.json", 400), ("recaps/0123456789ac.json", 40)] {
            put(n, days);
        }
        clear_old(&dir, |c| c == "CCCC");
        let mut left: Vec<String> = names(&dir).into_iter().chain(names(&dir.join("recaps"))).collect();
        left.sort();
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(left, ["0123456789ac.json", "CCCC.json", "DDDD.json", "EEEE.json", "EEEE.log.jsonl", "notes.json", "recaps"]);
    }
}
