//! The simple bot and the stand-in.
use crate::command::{Command, Resource};
use crate::data::*;
use crate::engine::*;
use crate::map::*;
use crate::rng::Rng;

pub fn candidates(g: &Game, p: usize, rng: &mut Rng) -> Vec<Command> {
    let pl = &g.players[p];
    let mut out: Vec<Command> = vec![];
    match g.phase {
        Phase::Action => {}
        Phase::Cards => return if pl.choice.is_empty() { vec![] } else { vec![Command::Keep { card: rng.pick(&pl.choice).id }] },
        Phase::Raid => {
            let raid = g.raid.as_ref().unwrap();
            if raid.step == Step::Vote {
                return vec![Command::Vote { target: raid.candidates[rng.below(raid.candidates.len())] }];
            }
            let fight: Vec<Id> = raid.sent[p].iter().copied().filter(|_| rng.next() < 0.85).collect();
            return vec![if fight.is_empty() { Command::Hold {} } else { Command::Fight { dragons: Some(fight) } }];
        }
        _ => {
            let over = pl.hand.len().saturating_sub(tuning().hand_cap);
            let mut hand: Vec<Id> = pl.hand.iter().map(|c| c.id).collect();
            rng.shuffle(&mut hand);
            hand.truncate(over);
            return vec![Command::Discard { cards: hand }];
        }
    }
    for o in g.offers.iter().filter(|o| o.waits_on(p)) {
        if g.accept_problem(o, p).is_none() && rng.next() < 0.5 {
            out.push(Command::Accept { offer: o.id });
        }
        out.push(Command::Decline { offer: o.id });
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
        let play = |resource, dragon, hex| Command::Play { card: c.id, resource, dragon, hex };
        match c.kind() {
            "building" | "upgrade" => {
                let up = c.kind() == "upgrade";
                let hexes = if up { g.upgrade_targets(p, c.key.0) } else { g.buildable_hexes(p, c.key.0) };
                if !hexes.is_empty() {
                    let hex = rng.pick(&hexes);
                    out.push(if up { Command::Upgrade { card: c.id, hex } } else { Command::Build { card: c.id, hex: Some(hex) } });
                }
            }
            "dragon" => {
                if room {
                    out.push(play(None, None, None));
                }
            }
            _ => {
                let some = |it: Vec<Id>, out: &mut Vec<Command>, rng: &mut Rng| {
                    if !it.is_empty() {
                        out.push(play(None, Some(rng.pick(&it)), None));
                    }
                };
                match DATA.actions[c.key.0].effect {
                    "gain_resource" => out.push(play(Some(rng.pick(&Resource::ALL[..4])), None, None)),
                    "gain_gold" | "extra_raid" => out.push(play(None, None, None)),
                    "grow_dragon" => some(g.dragons_of(p).filter(|d| d.stage < 3).map(|d| d.id).collect(), &mut out, rng),
                    "heal_dragon" => some(g.dragons_of(p).filter(|d| d.damage > 0).map(|d| d.id).collect(), &mut out, rng),
                    "send_fauna" => {
                        let theirs: Vec<K> = g.buildings.iter().filter(|(k, b)| b.owner != p && !b.tower() && g.map[*k].fauna.is_none()).map(|(k, _)| *k).collect();
                        if !theirs.is_empty() {
                            out.push(play(None, None, Some(rng.pick(&theirs))));
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
        out.push(Command::Clear { hex: rng.pick(&near), dragons: ready.clone() });
    }
    let beasts: Vec<K> = hunt.into_iter().filter(|k| g.map[k].beast()).collect();
    if ready.len() >= 3 && !beasts.is_empty() && rng.next() < 0.3 {
        out.push(Command::Clear { hex: rng.pick(&beasts), dragons: ready.clone() });
    }
    let rivals = g.perch_hexes(p);
    if !ready.is_empty() && !rivals.is_empty() && rng.next() < 0.2 {
        let k = rng.pick(&rivals);
        out.push(Command::Perch { hex: k, dragons: vec![rng.pick(&ready)] });
    }
    let perched: Vec<Id> = g.dragons_of(p).filter(|d| d.perch.is_some()).map(|d| d.id).collect();
    if !perched.is_empty() && rng.next() < 0.3 {
        out.push(Command::Recall { dragons: vec![rng.pick(&perched)] });
    }
    if room && pl.can_afford(&egg_cost("fire_whelp")) && rng.next() < 0.5 {
        out.push(Command::ProjectEgg { element: Key(rng.pick(&ELEMENTS)) });
    }
    for u in project_upgrades() {
        let t = g.upgrade_targets(p, u);
        if !t.is_empty() && pl.can_afford(&upgrade_project_cost(u)) {
            out.push(Command::ProjectUpgrade { upgrade: Key::of(u), hex: rng.pick(&t) });
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
            out.push(Command::BuildBasic { building: Key::of(b), hex: Some(rng.pick(&hexes)) });
        }
    }
    let rates = g.bank_rates(p);
    let (rich, poor): (Vec<usize>, Vec<usize>) = (0..4).partition(|r| pl.resources.0[*r] >= rates[*r] + 2);
    if !rich.is_empty() && !poor.is_empty() && rng.next() < 0.5 {
        let a = rng.pick(&rich);
        out.push(Command::Merchants { pay: Resource::ALL[a], gain: Resource::ALL[rng.pick(&poor)], times: 1 });
    }
    out.push(Command::End {});
    out
}

pub fn first_legal(g: &mut Game, p: usize, cmds: Vec<Command>) -> Option<Command> {
    cmds.into_iter().find(|c| g.apply(p, c).is_ok())
}

pub fn bot_move(g: &mut Game, p: usize, rng: &mut Rng) -> Option<Command> {
    let cmds = candidates(g, p, rng);
    first_legal(g, p, cmds)
}

/// The move made for a seat whose player has gone: as little as possible.
pub fn stand_in_commands(g: &Game, p: usize) -> Vec<Command> {
    let pl = &g.players[p];
    match g.phase {
        Phase::Action => g.offers.iter().filter(|o| o.waits_on(p)).map(|o| Command::Decline { offer: o.id }).chain((g.turn == p).then_some(Command::End {})).collect(),
        Phase::Cards => pl.choice.first().map(|c| Command::Keep { card: c.id }).into_iter().collect(),
        Phase::Raid => vec![{
            let raid = g.raid.as_ref().unwrap();
            if raid.step == Step::Vote { Command::Vote { target: raid.candidates[0] } } else { Command::Hold {} }
        }],
        _ => vec![Command::Discard { cards: pl.hand[..pl.hand.len().saturating_sub(tuning().hand_cap)].iter().map(|c| c.id).collect() }],
    }
}
pub fn stand_in_move(g: &mut Game, p: usize) -> Option<Command> {
    let cmds = stand_in_commands(g, p);
    first_legal(g, p, cmds)
}
