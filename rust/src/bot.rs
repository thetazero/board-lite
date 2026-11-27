//! The simple bot and the stand-in, as src/bot.ts plays them.
use crate::data::*;
use crate::engine::*;
use crate::map::*;
use crate::rng::Rng;

fn join(ds: &[Id]) -> String {
    ids(ds)
}

pub fn candidates(g: &Game, p: usize, rng: &mut Rng) -> Vec<String> {
    let pl = &g.players[p];
    let mut out: Vec<String> = vec![];
    match g.phase {
        Phase::Action => {}
        Phase::Cards => return if pl.choice.is_empty() { vec![] } else { vec![format!("keep {}", rng.pick(&pl.choice).id)] },
        Phase::Raid => {
            let raid = g.raid.as_ref().unwrap();
            if raid.step == Step::Vote {
                return vec![format!("vote {}", 1 + rng.below(raid.candidates.len()))];
            }
            let fight: Vec<Id> = raid.sent[p].iter().copied().filter(|_| rng.next() < 0.85).collect();
            return vec![if fight.is_empty() { "hold".into() } else { format!("fight {}", join(&fight)) }];
        }
        _ => {
            let over = pl.hand.len().saturating_sub(tuning().hand_cap);
            let mut hand: Vec<Id> = pl.hand.iter().map(|c| c.id).collect();
            rng.shuffle(&mut hand);
            hand.truncate(over);
            return vec![format!("discard {}", join(&hand))];
        }
    }
    for o in g.offers.iter().filter(|o| o.waits_on(p)) {
        if g.accept_problem(o, p).is_none() && rng.next() < 0.5 {
            out.push(format!("accept {}", o.id));
        }
        out.push(format!("decline {}", o.id));
    }
    if p != g.turn {
        return out;
    }
    let room = g.housed(p) < g.dragon_capacity(p);
    let mut hand = pl.hand.clone();
    rng.shuffle(&mut hand);
    for c in hand {
        if !pl.can_afford(c.cost()) {
            continue;
        }
        match c.kind() {
            "building" | "upgrade" => {
                let up = c.kind() == "upgrade";
                let hexes = if up { g.upgrade_targets(p, c.key.0) } else { g.buildable_hexes(p, c.key.0) };
                if !hexes.is_empty() {
                    out.push(format!("{} {} {}", if up { "upgrade" } else { "build" }, c.id, rng.pick(&hexes)));
                }
            }
            "dragon" => {
                if room {
                    out.push(format!("play {}", c.id));
                }
            }
            _ => {
                let some = |it: Vec<Id>, out: &mut Vec<String>, rng: &mut Rng| {
                    if !it.is_empty() {
                        out.push(format!("play {} {}", c.id, rng.pick(&it)));
                    }
                };
                match DATA.actions[c.key.0].effect {
                    "gain_resource" => out.push(format!("play {} {}", c.id, rng.pick(&RESOURCES[..4]))),
                    "gain_gold" | "extra_raid" => out.push(format!("play {}", c.id)),
                    "grow_dragon" => some(g.dragons_of(p).filter(|d| d.stage < 3).map(|d| d.id).collect(), &mut out, rng),
                    "heal_dragon" => some(g.dragons_of(p).filter(|d| d.damage > 0).map(|d| d.id).collect(), &mut out, rng),
                    "send_fauna" => {
                        let theirs: Vec<K> = g.buildings.iter().filter(|(k, b)| b.owner != p && !b.tower() && g.map[*k].fauna.is_none()).map(|(k, _)| *k).collect();
                        if !theirs.is_empty() {
                            out.push(format!("play {} {}", c.id, rng.pick(&theirs)));
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    let ready: Vec<Id> = g.dragons_of(p).filter(|d| d.ready() && d.stage >= 2).map(|d| d.id).collect();
    let hunt = g.huntable(p);
    let near: Vec<K> = hunt.iter().copied().filter(|k| g.buildings.iter().any(|(b, x)| x.owner == p && (b == k || b.adjacent(*k)))).collect();
    if !ready.is_empty() && !near.is_empty() && rng.next() < 0.4 {
        out.push(format!("clear {} {}", rng.pick(&near), join(&ready)));
    }
    let beasts: Vec<K> = hunt.into_iter().filter(|k| g.map[k].beast()).collect();
    if ready.len() >= 3 && !beasts.is_empty() && rng.next() < 0.3 {
        out.push(format!("clear {} {}", rng.pick(&beasts), join(&ready)));
    }
    let rivals = g.perch_hexes(p);
    if !ready.is_empty() && !rivals.is_empty() && rng.next() < 0.2 {
        let k = rng.pick(&rivals);
        out.push(format!("perch {k} {}", rng.pick(&ready)));
    }
    let perched: Vec<Id> = g.dragons_of(p).filter(|d| d.perch.is_some()).map(|d| d.id).collect();
    if !perched.is_empty() && rng.next() < 0.3 {
        out.push(format!("recall {}", rng.pick(&perched)));
    }
    if room && pl.can_afford(&egg_cost("fire_whelp")) && rng.next() < 0.5 {
        out.push(format!("project {}", rng.pick(&ELEMENTS)));
    }
    for u in project_upgrades() {
        let t = g.upgrade_targets(p, u);
        if !t.is_empty() && pl.can_afford(&upgrade_project_cost(u)) {
            out.push(format!("project {u} {}", rng.pick(&t)));
        }
    }
    let mut basics = DATA.basic_buildings.clone();
    rng.shuffle(&mut basics);
    for b in basics {
        if b == "roost" && room {
            continue;
        }
        let hexes = g.buildable_hexes(p, b);
        if !hexes.is_empty() && pl.can_afford(&DATA.buildings[b].cost) {
            out.push(format!("build {b} {}", rng.pick(&hexes)));
        }
    }
    let rates = g.bank_rates(p);
    let (rich, poor): (Vec<usize>, Vec<usize>) = (0..4).partition(|r| pl.resources.0[*r] >= rates[*r] + 2);
    if !rich.is_empty() && !poor.is_empty() && rng.next() < 0.5 {
        let a = rng.pick(&rich);
        out.push(format!("merchants {} {}", RESOURCES[a], RESOURCES[rng.pick(&poor)]));
    }
    out.push("end".into());
    out
}

pub fn first_legal(g: &mut Game, p: usize, cmds: Vec<String>) -> Option<String> {
    cmds.into_iter().find(|c| g.apply(p, c).is_ok())
}

pub fn bot_move(g: &mut Game, p: usize, rng: &mut Rng) -> Option<String> {
    let cmds = candidates(g, p, rng);
    first_legal(g, p, cmds)
}

/// The move made for a seat whose player has gone: as little as possible.
pub fn stand_in_commands(g: &Game, p: usize) -> Vec<String> {
    let pl = &g.players[p];
    match g.phase {
        Phase::Action => g.offers.iter().filter(|o| o.waits_on(p)).map(|o| format!("decline {}", o.id)).chain((g.turn == p).then(|| "end".into())).collect(),
        Phase::Cards => pl.choice.first().map(|c| format!("keep {}", c.id)).into_iter().collect(),
        Phase::Raid => vec![if g.raid.as_ref().unwrap().step == Step::Vote { "vote 1".into() } else { "hold".into() }],
        _ => vec![format!("discard {}", join(&pl.hand[..pl.hand.len().saturating_sub(tuning().hand_cap)].iter().map(|c| c.id).collect::<Vec<_>>()))],
    }
}
pub fn stand_in_move(g: &mut Game, p: usize) -> Option<String> {
    let cmds = stand_in_commands(g, p);
    first_legal(g, p, cmds)
}
