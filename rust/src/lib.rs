pub mod bot;
pub mod data;
pub mod engine;
pub mod gamelog;
pub mod limits;
pub mod map;
pub mod mapimage;
pub mod mcp;
pub mod recap;
pub mod rng;
pub mod room;
pub mod scenes;
pub mod server;
pub mod state;
pub mod store;
pub mod view;

pub const RULEBOOK: &str = include_str!("../generated/rulebook.json");
pub const RULES: &str = include_str!("../generated/rules.md");
