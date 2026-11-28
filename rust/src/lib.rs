#[cfg(feature = "server")]
pub mod addresses;
pub mod api;
pub mod bot;
pub mod command;
pub mod data;
pub mod engine;
#[cfg(feature = "server")]
pub mod gamelog;
#[cfg(feature = "server")]
pub mod limits;
pub mod map;
pub mod mapimage;
#[cfg(feature = "server")]
pub mod mcp;
pub mod recap;
pub mod rng;
#[cfg(feature = "server")]
pub mod room;
pub mod scenes;
#[cfg(feature = "server")]
pub mod server;
pub mod state;
pub mod store;
pub mod strongbot;
pub mod view;

pub const RULES: &str = include_str!("../generated/rules.md");
