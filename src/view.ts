// The game as text, for players at the command line (src/cli.ts) and Claude
// players (src/playtest/seat-server.ts). It reads only the JSON the server
// sends every client (src/state.ts, a phone's snapshot) and prints what a
// phone draws: nothing here knows the rules, and nothing hidden from a player
// is ever in their snapshot.

import type { CardView, DragonView, EventView, FaunaView, HexView, PublicState, Res, SeatState, Snapshot, TargetView } from './state.ts';

const P = (p: number) => `P${p + 1}`;
const resText = (r: Res) => Object.entries(r).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing';
// "4:1" or "4:1, 2:1 for stone": the usual rate, then any port's.
const rateText = (rates: Record<string, number>) => {
  const usual = Math.max(...Object.values(rates));
  return [`${usual}:1`, ...Object.entries(rates).filter(([, n]) => n < usual).map(([r, n]) => `${n}:1 for ${r}`)].join(', ');
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const TERRAIN_LETTER: Record<string, string> = { mountain: 'M', forest: 'F', ley: 'C', meadow: 'G', plains: '.', harbor: 'H', ocean: '~' };
// Two letters per building on the text map.
const BUILDING_CODE: Record<string, string> = {
  tower: 'TW', quarry: 'qu', lumber_camp: 'lc', crystal_mine: 'cm', pasture: 'pa', roost: 'ro',
  cliff_works: 'cw', stonemason: 'sm', woodcutter: 'wc', sawmill: 'sw', driftwood_yard: 'dy', ley_spire: 'cs', gem_cutter: 'gc', smelter: 'se',
  shepherds_fold: 'sf', drovers_barn: 'db', fishery: 'fi', hatchery: 'ha', stone_port: 'sp', timber_port: 'tp', crystal_port: 'cp', livestock_port: 'lp', market: 'mk',
  monument: 'mo', standing_stones: 'ss', lighthouse: 'lh', guildhall: 'gh',
};
const FAUNA_CODE: Record<string, string> = { wolf_pack: 'W', cave_bear: 'B', basilisk: 'X', thunderbird: 'T', leviathan: 'V' };
const code = (type: string) => BUILDING_CODE[type] ?? type.slice(0, 2);
const faunaCode = (key: string) => FAUNA_CODE[key] ?? key[0].toUpperCase();
const STAGES = ['hatchling', 'young', 'adult'];
const STEP_NAMES: Record<string, string> = { vote: 'vote', choose: 'fight or hold back' }; // a raid's steps

function unitStats(u: { power: number; hp: number; attack: string; weak: string[] }): string {
  return `Power ${u.power}, Health ${u.hp}, Attack ${u.attack}${u.weak.length ? `, weak to ${u.weak.join('/')}` : ''}`;
}

export function cardText(c: CardView): string {
  const kind = c.kind === 'dragon' ? 'dragon egg' : c.kind;
  const stages = c.dragon ? ` ${c.dragon.stages.map((s, i) => `${STAGES[i]}: Power ${s.power}, Health ${s.hp}, Attack ${s.attack}`).join('; ')}.` : '';
  return `${c.id} ${c.name} [${kind}] cost ${resText(c.cost)}: ${c.text}${stages}`;
}

function dragonLine(d: DragonView): string {
  const growth = d.stage === 3 ? 'grown' : `growth ${d.growth}/${d.growthTime}`;
  const stats = d.stage ? `Power ${d.power}, Health ${d.hp}/${d.maxHp}, Attack ${d.attack}, ` : '';
  const status = d.canRaid ? `raid-ready${d.hp < d.maxHp ? ', hurt: heals instead of growing' : ''}` : d.stage === 0 ? 'egg' : d.perch ? `perched on ${d.perch}` : 'knocked out';
  const hungry = d.hungry ? ', went hungry this round: did not heal or grow' : '';
  return `${d.id} ${P(d.owner)} ${d.name} (${d.element} ${d.stageName}, ${stats}${growth}; ${status}${hungry}) ${d.targeting}`;
}

function amounts(x: Record<string, { base: number; dice: number[]; eat?: number }>): string {
  return Object.entries(x).filter(([, v]) => v.base || v.dice.length || v.eat).map(([r, v]) => `${r} ${[...(v.base || !v.dice.length ? [v.base] : []), ...v.dice.map((d) => `1d${d}`)].join('+')}${v.eat ? ` (dragons eat ${v.eat})` : ''}`).join(', ') || 'nothing';
}

function mapText(g: PublicState): string[] {
  const lines: string[] = [];
  const built = new Map(g.map.flatMap((h) => (h.building ? [[h.building.type, h.building.name] as const] : [])));
  const fauna = new Map(g.map.flatMap((h) => (h.fauna ? [[h.fauna.key, h.fauna] as const] : [])));
  lines.push('Map (axial q,r). M mountain, F forest, C crystal field, G meadow, . plains, H harbor, ~ ocean, ^ peak.');
  lines.push(`[<owner><code>] a building, + per upgrade: ${[...built].map(([k, name]) => `${code(k)} ${name}`).join(', ')}.`);
  lines.push(`<ids> perched dragons; {code} a beast${fauna.size ? ` (${[...fauna].map(([k, f]) => `${faunaCode(k)} ${f.name}`).join(', ')})` : ''}; {x} held by an adjacent great beast. A building under either is suppressed.`);
  const rows = new Map<number, HexView[]>();
  for (const h of g.map) rows.set(h.r, [...(rows.get(h.r) ?? []), h]);
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    const cells = rows.get(r)!.sort((a, b) => a.q - b.q).map((h) => {
      const b = h.building;
      const label = b ? `[${b.owner + 1}${code(b.type)}${'+'.repeat(b.upgrades.length)}]` : '';
      const held = `${h.fauna ? `{${faunaCode(h.fauna.key)}}` : ''}${h.held ? '{x}' : ''}`;
      const perched = h.perched.length ? `<${h.perched.map((x) => x.d).join(' ')}>` : '';
      return `${h.k}:${TERRAIN_LETTER[h.terrain] ?? '?'}${h.peak ? '^' : ''}${label}${held}${perched}`;
    });
    lines.push(`  ${' '.repeat(Math.abs(r) * 4)}${cells.join('  ')}`);
  }
  return lines;
}

export function targetText(t: TargetView): string {
  // Identical defenders once, counted: "Knights x4 (...)".
  const groups = new Map<string, number>();
  for (const u of t.units) { const k = `${u.name} (${unitStats(u)})`; groups.set(k, (groups.get(k) ?? 0) + 1); }
  return `${t.name} (Power ${t.power}): ${[...groups].map(([k, n]) => (n > 1 ? k.replace(' (', ` x${n} (`) : k)).join(', ')}; loot ${resText(t.loot)}${t.points ? `; ${plural(t.points, 'point')} to the most power standing` : ''}`;
}

export function faunaText(f: FaunaView): string {
  const prize = f.points !== undefined ? `great beast: ${plural(f.points, 'point')} to whoever slays it` : Object.keys(f.loot).length ? `loot ${resText(f.loot)}` : 'no loot';
  return `${f.name} (${unitStats(f)}; ${prize})`;
}

function sentPower(g: PublicState, ids: string[]): number {
  return ids.reduce((s, id) => s + (g.dragons.find((d) => d.id === id)?.power ?? 0), 0);
}

function raidText(g: PublicState, you: SeatState | null): string[] {
  const raid = g.raid!;
  const out: string[] = [];
  if (raid.step === 'vote') {
    out.push("Raid vote (a vote is worth its voter's raid-ready power; the kingdom with the most is raided):");
    raid.candidates.forEach((t, i) => {
      const got = raid.votes.reduce<number>((s, v, q) => s + (v === i ? raid.votePower[q] : 0), 0);
      out.push(`  ${i + 1}. ${targetText(t)}${got ? `; ${got} power voted` : ''}`);
    });
    out.push(`  Votes: ${raid.votes.map((v, q) => `${P(q)}${raid.voters[q] ? ` (power ${raid.votePower[q]})` : ''} ${v !== null ? v + 1 : raid.voters[q] ? 'not yet' : 'no vote'}`).join(', ')}`);
    if (you?.whyNoVote) out.push(`  ${you.whyNoVote}`);
    return out;
  }
  out.push(`Raid: ${targetText(raid.target!)}`);
  out.push(`In the raid (every raid-ready dragon): ${raid.sent.map((c, q) => (c.length ? `${P(q)} ${c.join(' ')} (power ${sentPower(g, c)})` : '')).filter(Boolean).join(', ')}`);
  out.push(`Which dragons fight, in secret: ${raid.sent.flatMap((c, q) => (c.length ? [`${P(q)} ${raid.decided[q] ? 'chosen' : 'not yet'}`] : [])).join(', ')}`);
  if (you?.myFight) {
    const held = raid.sent[you.seat].filter((id) => !you.myFight!.includes(id));
    out.push(`  You ${!you.myFight.length ? 'hold back' : held.length ? `fight with ${you.myFight.join(' ')} and hold back ${held.join(' ')}` : 'fight'}.`);
  }
  return out;
}

// Command hints for this seat right now. Empty if they have nothing to decide.
export function commandHints(g: PublicState, you: SeatState): string[] {
  if (!you.deciding) return [];
  const out: string[] = [];
  const afford = (c: { affordable: boolean }) => (c.affordable ? '' : " (can't afford yet)");
  if (g.phase === 'action') {
    for (const o of g.offers.filter((x) => (x.to === null ? x.from !== you.seat && !x.passed.includes(you.seat) : x.to === you.seat))) {
      const why = you.cantAccept[o.id];
      out.push(`${why ? '' : `accept ${o.id}  |  `}decline ${o.id}   (${P(o.from)} gives ${o.give} for ${o.get}${o.to === null ? ', to anyone' : ''})${why ? ` ${why}` : ''}`);
    }
    if (!you.myTurn) {
      out.push(`offer ${P(g.turn)} give <items> get <items>   (out of turn, only with ${P(g.turn)})`);
      return out;
    }
    for (const c of you.hand) {
      if (c.kind === 'building') {
        // For a building that counts its neighbours, each hex shows its count, like 2,-1(x3).
        const hexes = c.hexes.map((k) => (c.counts ? `${k}(x${c.counts[k]})` : k));
        if (c.needs === 'none') out.push(`build ${c.id}   (${c.name})${afford(c)}`);
        else out.push(`build ${c.id} <hex>   (${c.name}; hexes: ${hexes.join(' ') || 'none'})${afford(c)}`);
      } else if (c.kind === 'upgrade') {
        out.push(`upgrade ${c.id} <hex>   (${c.name}; on: ${c.hexes.join(' ') || 'none'})${afford(c)}`);
      } else if (c.kind === 'dragon') {
        out.push(`play ${c.id}   (hatch ${c.name})${afford(c)}${c.blocked ? ` (${c.blocked.replace(/\.$/, '')})` : ''}`);
      } else if (c.needs !== 'unplayable') {
        const arg = { resource: ' <stone|timber|crystal|livestock>', dragon: ' <dragon id>', hex: ' <hex>', none: '' }[c.needs];
        out.push(`play ${c.id}${arg}   (${c.name}${c.fauna ? `: a land hex with no tower or beast; ${faunaText(c.fauna)}` : ''})${afford(c)}${c.blocked ? ` (${c.blocked.replace(/\.$/, '')})` : ''}`);
      }
    }
    for (const b of you.basics) {
      if (b.hexes.length) out.push(`build ${b.key}${b.onTower ? '' : ' <hex>'}   (no card, cost ${resText(b.cost)}: ${b.text}${b.onTower ? '' : ` Hexes: ${b.hexes.join(' ')}`})${afford(b)}`);
    }
    if (you.huntable.length && you.raidReady.length) {
      const foes = you.huntable.map((k) => {
        const h = g.map.find((x) => x.k === k)!;
        const ds = h.perched.filter((x) => x.owner !== you.seat).map((x) => x.d);
        return `${k} ${[...(h.fauna ? [h.fauna.name] : []), ...ds].join(' and ')}`;
      });
      out.push(`clear <hex> <dragon ids...>   (fight its beast and all rivals' dragons perched there, together, to the end; a coin flip says which side strikes first. Dragons not knocked out can clear again this turn, and still raid. 1 try at a great beast each round. Raid-ready: ${you.raidReady.join(' ')}. Hexes: ${foes.join(', ')})`);
    }
    if (you.autoClear.length && you.raidReady.length) out.push(`autoclear   (your own buildings, weakest first, with all your raid-ready dragons, until one fight is lost. Held: ${you.autoClear.join(' ')})`);
    if (you.perchable.length && you.raidReady.length) out.push(`perch <hex> <dragon ids...>   (a rival's building, not a tower, is suppressed while they stay; they don't raid. Dragons perched on one building fight together when it's cleared; a lone one fights alone. Hexes: ${you.perchable.join(' ')})`);
    if (you.perched.length) out.push(`recall <dragon ids...>   (perched: ${you.perched.join(' ')})`);
    out.push(`project <${you.eggProject.elements.join('|')}>   (base dragon egg, no card, cost ${resText(you.eggProject.cost)})`);
    for (const u of you.upgradeProjects) {
      if (u.hexes.length) out.push(`project ${u.key} <hex>   (${u.name}, no card, cost ${resText(u.cost)}: ${u.text} On: ${u.hexes.join(' ')})${afford(u)}`);
    }
    out.push(`merchants <give resource> <get resource> [times]   (not gold; ${rateText(you.bankRates)})`);
    out.push(`offer <player|anyone> give <items> get <items>   (items like "2 stone" or "c12"; to anyone: the first to accept trades)`);
    for (const o of g.offers.filter((x) => x.from === you.seat)) out.push(`cancel ${o.id}`);
    out.push(g.offers.some((o) => o.to === you.seat) ? 'end   (after answering the offers to you)' : 'end');
    return out;
  }
  if (g.phase === 'cards') {
    out.push(`keep <${you.choice.map((c) => c.id).join('|')}>   (the other is discarded)`);
    for (const c of you.choice) out.push(`  ${cardText(c)}`);
    return out;
  }
  if (g.phase === 'discard') {
    const n = you.hand.length - you.handCap;
    out.push(`discard <${n} card ids>   (hand limit ${you.handCap})`);
    return out;
  }
  const raid = g.raid;
  if (raid?.step === 'vote' && !you.whyNoVote) out.push(`vote <1-${raid.candidates.length}>`);
  if (raid?.step === 'choose') out.push('fight  |  fight <dragon ids>  |  hold   (secret: all, some or none of your dragons fight; held back, they stay out of the combat but still share the loot if the kingdom falls)');
  return out;
}

function phaseText(g: PublicState): string {
  if (g.phase === 'over') return `Game over.${g.winner !== null ? ` ${P(g.winner)} wins!` : ''}`;
  if (g.phase === 'cards') return `Round ${g.round}, cards: keep 1 of 2 building cards.`;
  if (g.phase === 'action') return `Round ${g.round}, actions: ${P(g.turn)}'s turn.`;
  if (g.phase === 'discard') return `Round ${g.round}, end of round: discard down to the hand limit.`;
  return `Round ${g.round}, raid: ${STEP_NAMES[g.raid!.step]}${g.raidsLeft > 1 ? ` (${plural(g.raidsLeft, 'raid')} left)` : ''}.`;
}

const waitingText = (g: PublicState) => g.waitingOn.map(P).join(', ') || 'no one';

/** Every event in the snapshot, in order: the public log and talk, and the viewer's own private events and messages. */
export function snapshotEvents(s: Snapshot): EventView[] {
  const all = [...(s.game?.log ?? []), ...(s.you ? [...s.you.log, ...s.you.talk] : (s.game?.talk ?? []))];
  const byIndex = new Map(all.map((e) => [e.i, e]));
  return [...byIndex.values()].sort((a, b) => a.i - b.i);
}

export const eventLine = (e: EventView) => `[r${e.round}] ${e.text}`;

// Who sits where: the engine calls players P1, P2...; people know each other by name.
function tableText(s: Snapshot, you = -1): string {
  return s.lobby.seats.map((t, i) => `${P(i)} ${t.name}${i === you ? ' (you)' : t.kind === 'bot' ? ' (bot)' : t.kind === 'open' ? ' (open seat)' : ''}`).join(', ');
}

const SAVED = 'The game is saved: someone at the table continues it on the TV or a phone.';

/** The public summary: the table, the phase, who the game waits on, the public scores. */
export function statusText(s: Snapshot): string {
  const names = tableText(s);
  const g = s.game;
  if (!g) return `Room ${s.lobby.code}, in the lobby: ${names || 'no one yet'}. ${s.lobby.minPlayers} to ${s.lobby.maxPlayers} players; ${s.lobby.remote ? 'the first to join starts' : 'the TV or the first to join starts'}.`;
  const out = [`Room ${s.lobby.code}: ${names}.`, phaseText(g)];
  if (s.lobby.seating) out.push('The game goes on once every seat is taken.');
  else if (s.lobby.saved) out.push(SAVED);
  else if (g.waitingOn.length) out.push(`Waiting for ${waitingText(g)}.`);
  g.players.forEach((pl, q) => out.push(`${P(q)}: ${pl.publicPoints} public points, ${pl.handSize} cards in hand`));
  return out.join('\n');
}

/** Everything one seat sees, and its options: what its phone shows, as text. */
export function seatView(s: Snapshot, logLines = 25): string {
  const g = s.game;
  const you = s.you;
  if (!you) return statusText(s);
  const p = you.seat;
  if (!g) return `You are seat ${p + 1} (${you.name}) in room ${s.lobby.code}. The game hasn't started.\n${statusText(s)}`;
  const out: string[] = [];
  out.push(`Table: ${tableText(s, p)}.`);
  out.push(`You are ${P(p)}. ${phaseText(g)}`);
  const hints = commandHints(g, you);
  out.push(s.lobby.seating ? 'The game goes on once every seat is taken.' : s.lobby.saved ? SAVED : hints.length ? '>>> Your decision.' : `Waiting for ${waitingText(g)}.`);
  out.push('');
  out.push(`== Scores (first to ${g.pointsToWin}; hidden points count at the end) ==`);
  g.players.forEach((pl, q) => {
    const extra = q === p ? ` + ${you.hiddenPoints} hidden = ${you.totalPoints}` : '';
    out.push(`${P(q)}${q === p ? ' (you)' : ''}: ${pl.publicPoints} public (buildings ${pl.buildings - pl.monuments}${pl.monuments ? `, monuments ${pl.monuments}` : ''}${pl.titles ? `, titles ${pl.titles}` : ''}${pl.beasts ? `, great beasts ${pl.beasts}` : ''}${pl.raids ? `, kingdoms ${pl.raids}` : ''})${extra}; ${pl.handSize} cards in hand; makes ${amounts(pl.production)}`);
  });
  const last = g.phase === 'over' ? [] : g.players.flatMap((pl, q) => ((q === p ? you.totalPoints : pl.publicPoints) >= g.pointsToWin ? [q === p ? 'you' : P(q)] : []));
  if (last.length) out.push(`${last.join(' and ').replace(/^you/, 'You')} ${last.length > 1 || last[0] === 'you' ? 'have' : 'has'} ${g.pointsToWin} or more points, so this is the last round.`);
  out.push(`Titles (${g.titlePoints} points each): ${g.titles.map((t) => `${t.name}: ${t.holder === null ? 'no one' : P(t.holder)} [${t.values.join('/')}; needs ${t.min}]`).join('; ')}`);
  out.push('');
  out.push('== You (hidden from others) ==');
  out.push(`Resources: ${Object.entries(you.resources).map(([r, n]) => `${n} ${r}`).join(', ')}`);
  out.push(`Each round you make: ${amounts(you.income)}.`);
  out.push(`Merchants ${rateText(you.bankRates)}. Dragons ${you.dragonsHoused}/${you.dragonCapacity} housed${you.dragonsHoused > you.dragonCapacity ? `: ${you.dragonsHoused - you.dragonCapacity} over, no hatching until there's room` : ''}.`);
  const over = you.hand.length - you.handCap;
  out.push(`Hand (${you.hand.length}/${you.handCap})${over > 0 && g.phase !== 'discard' ? `: ${over} over the limit, discarded at the end of the round` : ''}:`);
  for (const c of you.hand) out.push(`  ${cardText(c)}`);
  if (you.choice.length) out.push(`Keep 1: ${you.choice.map(cardText).join(' | ')}`);
  out.push('');
  out.push('== Dragons (public) ==');
  for (const d of g.dragons) out.push(`  ${dragonLine(d)}`);
  out.push('');
  out.push('== Buildings (public) ==');
  g.players.forEach((_, q) => {
    const list = g.map.filter((h) => h.building?.owner === q).map((h) => {
      const b = h.building!;
      return `${b.type === 'tower' ? `Tower${b.floors ? `(${plural(b.floors, 'floor')})` : ''}` : b.name}${b.upgradeName ? `+${b.upgradeName}` : ''}@${h.k}`;
    });
    out.push(`  ${P(q)}: ${list.join(', ')}`);
  });
  out.push(...mapText(g));
  const fauna = g.map.filter((h) => h.fauna).sort((a, b) => (a.k < b.k ? -1 : 1));
  out.push(`Fauna: ${fauna.length ? fauna.map((h) => `${h.k} ${faunaText(h.fauna!)}${h.building ? ` on ${P(h.building.owner)}'s ${h.building.type}` : ''}`).join('; ') : 'none'}.`);
  const peak = g.map.find((h) => h.peak)?.k;
  const slain = g.beasts.filter((b) => b.slainBy !== null).map((b) => `${b.name} by ${P(b.slainBy!)}`);
  out.push(`Great beasts slain: ${slain.join(', ') || 'none'}. Once the Thunderbird is slain, production buildings on or adjacent to the peak${peak ? ` (${peak})` : ''} make ${g.peakBonus} more each round.`);
  out.push(`Kingdoms (loot now; +1 gold after each raid it doesn't fall in): ${g.kingdoms.map((t) => `${t.name} (Power ${t.power}) ${resText(t.loot)}${t.points ? `, ${plural(t.points, 'point')}` : ''}`).join('; ')}.`);
  if (g.raid) {
    out.push('');
    out.push(...raidText(g, you));
  }
  if (g.offers.length) {
    out.push('');
    out.push('== Open offers ==');
    for (const o of g.offers) out.push(`  ${o.id}: ${P(o.from)} offers ${o.to === null ? 'anyone' : P(o.to)} ${o.give} for ${o.get}${o.passed.length ? `; ${o.passed.map(P).join(', ')} ${o.passed.length === 1 ? 'declines' : 'decline'}` : ''}`);
  }
  out.push('');
  out.push(`== Recent events ==`);
  for (const e of snapshotEvents(s).slice(-logLines)) out.push(`  ${eventLine(e)}`);
  if (hints.length) {
    out.push('');
    out.push('== Your options ==');
    for (const h of hints) out.push(`  ${h}`);
  }
  if (g.phase !== 'over') out.push(`Talk any time: say <message>, or tell <P#> <message> (private). Promises bind no one.`);
  return out.join('\n');
}

/** One line for a seat: its options when it's its decision, else who the game waits on. */
export function seatStatus(s: Snapshot): string {
  const g = s.game;
  if (!g) return "The game hasn't started.";
  if (g.phase === 'over') return `Game over.${g.winner !== null ? ` ${P(g.winner)} wins!` : ''}`;
  const hints = s.you ? commandHints(g, s.you) : [];
  if (hints.length) return `Your options:\n${hints.map((h) => `  ${h}`).join('\n')}`;
  return `Waiting for ${waitingText(g)}.`;
}

/** After a move: the events this seat sees from log index `since` on, then its options or who the game waits on. */
export function afterMove(s: Snapshot, since: number): string {
  const lines = snapshotEvents(s).filter((e) => e.i >= since).map((e) => `  ${eventLine(e)}`);
  const g = s.game;
  const hints = g && s.you ? commandHints(g, s.you) : [];
  const tail = !g ? "The game hasn't started." : g.phase === 'over' ? 'Game over.' : hints.length ? `Your options:\n${hints.map((h) => `  ${h}`).join('\n')}` : `Waiting for ${waitingText(g)}.`;
  return [...lines, tail].join('\n');
}

/** The log index just past the last event in a snapshot: where the next move's events start. */
export const nextIndex = (s: Snapshot) => Math.max(-1, ...snapshotEvents(s).map((e) => e.i)) + 1;
