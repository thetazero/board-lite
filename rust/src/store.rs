//! The game file on disk, as src/store.ts keeps it.
use crate::engine::Game;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub fn parse(text: &str) -> Result<Game, String> {
    if text.contains("wolf_pack") || text.contains("plains") {
        // Saved by an older version: the desert was called plains, the Wolf the Wolf Pack.
        let mut v: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
        if let Some(map) = v["map"].as_object_mut() {
            for h in map.values_mut().filter(|h| h["terrain"] == "plains") {
                h["terrain"] = "desert".into();
            }
        }
        rename(&mut v);
        return serde_json::from_str(&v.to_string()).map_err(|e| e.to_string());
    }
    serde_json::from_str(text).map_err(|e| e.to_string())
}
fn rename(v: &mut Value) {
    match v {
        Value::String(s) if s == "wolf_pack" => *s = "wolf".into(),
        Value::Array(a) => a.iter_mut().for_each(rename),
        Value::Object(o) => o.values_mut().for_each(rename),
        _ => {}
    }
}
pub fn load(file: &Path) -> Result<Game, String> {
    parse(&std::fs::read_to_string(file).map_err(|e| e.to_string())?)
}
pub fn save(file: &Path, v: &impl Serialize) -> std::io::Result<()> {
    let tmp = PathBuf::from(format!("{}.{}.tmp", file.display(), std::process::id()));
    std::fs::write(&tmp, serde_json::to_vec(v)?)?;
    std::fs::rename(tmp, file)
}
