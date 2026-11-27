//! Seeded RNG (mulberry32), the same stream as src/rng.ts.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Rng {
    pub state: i32,
}

impl Rng {
    pub fn new(seed: i64) -> Rng {
        Rng { state: seed as i32 }
    }
    pub fn next(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let s = self.state as u32;
        let mut t = (s ^ (s >> 15)).wrapping_mul(s | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
    pub fn below(&mut self, n: usize) -> usize {
        (self.next() * n as f64) as usize
    }
    pub fn roll(&mut self, sides: i64) -> i64 {
        1 + (self.next() * sides as f64) as i64
    }
    pub fn pick<T: Copy>(&mut self, items: &[T]) -> T {
        items[self.below(items.len())]
    }
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.below(i + 1);
            items.swap(i, j);
        }
    }
}
