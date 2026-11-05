// The game as text, for players at the command line (src/cli.ts) and Claude
// players (src/playtest/seat-server.ts). It reads only the JSON the server
// sends every client (src/state.ts, a phone's snapshot) and prints what a
// phone draws: nothing here knows the rules, and nothing hidden from a player
// is ever in their snapshot.

import type { CardView, DragonView, EventView, FaunaView, HexView, PublicState, Res, SeatState, Snapshot, TargetView } from './state.ts';

const P = (p: number) => `P${p + 1}`;
const resText = (r: Res) => Object.entries(r).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing';
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const TERRAIN_LETTER: Record<string, string> = { mountain: 'M', forest: 'F', ley: 'C', meadow: 'G', plains: '.', harbor: 'H', ocean: '~' };
// Two letters per building on the text map.
const BUILDING_CODE: Record<string, string> = {
  tower: 'TW', quarry: 'qu', lumber_camp: 'lc', crystal_mine: 'cm', pasture: 'pa', roost: 'ro',
  cliff_works: 'cw', stonemason: 'sm', woodcutter: 'wc', sawmill: 'sw', driftwood_yard: 'dy', ley_spire: 'cs', gem_cutter: 'gc', smelter: 'se',
  shepherds_fold: 'sf', drovers_barn: 'db', fishery: 'fi', hatchery: 'ha', port: 'po', market: 'mk',
  monument: 'mo', standing_stones: 'ss', lighthouse: 'lh', guildhall: 'gh',
};
const FAUNA_CODE: Record<string, string> = { wolf_pack: 'W', cave_bear: 'B', basilisk: 'X', thunderbird: 'T', leviathan: 'V' };
const code = (type: string) => BUILDING_CODE[type] ?? type.slice(0, 2);
const faunaCode = (key: string) => FAUNA_CODE[key] ?? key[0].toUpperCase();
const STAGES = ['hatchling', 'young', 'adult']; // a dragon card's stages, in order (STAGE_NAMES in src/data.ts)

function unitStats(u: { power: number; hp: number; attack: string; weak: string[] }): string {
  return `combat power ${u.power}; ${u.hp}hp ${u.attack}${u.weak.length ? ` weak:${u.weak.join('/')}` : ''}`;
}

export function cardText(c: CardView): string {
  const kind = c.kind === 'dragon' ? 'dragon egg' : c.kind;
  const stages = c.dragon ? ` ${c.dragon.stages.map((s, i) => `${STAGES[i]} ${s.hp}hp ${s.attack} power ${s.power}`).join(' / ')}.` : '';
  return `${c.id} ${c.name} [${kind}] cost ${resText(c.cost)}: ${c.text}${stages}`;
}

function dragonLine(d: DragonView): string {
  const growth = d.stage === 3 ? 'fully grown' : `growth ${d.growth}/${d.growthTime}`;
  const health = d.stage ? `${d.hp}/${d.maxHp}hp` : 'egg';
  const status = d.canRaid ? `can raid, clear or perch${d.hp < d.maxHp ? ' (hurt: heals instead of growing)' : ''}` : d.stage === 0 ? 'egg, cannot raid' : d.perch ? `perched on ${d.perch}: no raids until recalled` : 'knocked out: cannot fight until it heals';
  return `${d.id} ${P(d.owner)} ${d.name} (${d.element} ${d.stageName}, ${growth}, ${d.stage ? `power ${d.power}, ` : ''}${health}, ${status}) — ${d.targeting}${d.attack ? `, attacks ${d.attack}` : ''}`;
}

function amounts(x: Record<string, { base: number; dice: number[] }>): string {
  return Object.entries(x).filter(([, v]) => v.base || v.dice.length).map(([r, v]) => `${r} ${v.base}${v.dice.map((d) => `+d${d}`).join('')}`).join(', ') || 'nothing';
}

function mapText(g: PublicState): string[] {
  const lines: string[] = [];
  const built = new Map(g.map.flatMap((h) => (h.building ? [[h.building.type, h.building.name] as const] : [])));
  const fauna = new Map(g.map.flatMap((h) => (h.fauna ? [[h.fauna.key, h.fauna] as const] : [])));
  lines.push('Map (axial q,r). Terrain: M mountain, F forest, C crystal field, G meadow, . plains, H harbor, ~ ocean (no buildings). ^ marks the peak.');
  lines.push(`Buildings show as <owner><code>, + if upgraded: ${[...built].map(([k, name]) => `${code(k)} ${name}`).join(', ')}.`);
  lines.push('Perched dragons show as <ids>: the building there makes nothing while they stay.');
  if (fauna.size) lines.push(`Fauna shows as {code} (no building there; a building under it makes nothing): ${[...fauna].map(([k, f]) => `${faunaCode(k)} ${f.name}${f.points !== undefined ? ' (great beast)' : ''}`).join(', ')}. A great beast also holds the hexes adjacent to it (shown as {x}): nothing is built there until it is slain.`);
  const rows = new Map<number, HexView[]>();
  for (const h of g.map) rows.set(h.r, [...(rows.get(h.r) ?? []), h]);
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    const cells = rows.get(r)!.sort((a, b) => a.q - b.q).map((h) => {
      const b = h.building;
      const label = b ? `[${b.owner + 1}${code(b.type)}${b.upgrade ? '+' : ''}]` : '';
      const held = h.fauna ? `{${faunaCode(h.fauna.key)}}` : h.held ? '{x}' : '';
      const perched = h.perched.length ? `<${h.perched.map((x) => x.d).join(' ')}>` : '';
      return `${h.k}:${TERRAIN_LETTER[h.terrain] ?? '?'}${h.peak ? '^' : ''}${label}${held}${perched}`;
    });
    lines.push(`  ${' '.repeat(Math.abs(r) * 4)}${cells.join('  ')}`);
  }
  return lines;
}

export function targetText(t: TargetView): string {
  return `${t.name} — combat power ${t.power}; defenders: ${t.units.map((u) => `${u.name} (${unitStats(u)})`).join(', ')}; loot ${resText(t.loot)} (split by the combat power each player still has fighting at the end)`;
}

export function faunaText(f: FaunaView): string {
  const prize = f.points !== undefined ? `great beast: ${f.points} point${f.points === 1 ? '' : 's'} for good to whoever slays it; 1 try each round` : Object.keys(f.loot).length ? `loot ${resText(f.loot)}` : 'no loot: a card sent it';
  return `${f.name} (${unitStats(f)}; ${prize})`;
}

function commitPower(g: PublicState, ids: string[]): number {
  return ids.reduce((s, id) => s + (g.dragons.find((d) => d.id === id)?.power ?? 0), 0);
}

function raidText(g: PublicState, you: SeatState | null): string[] {
  const raid = g.raid!;
  const out: string[] = [];
  if (raid.step === 'vote') {
    out.push('Raid: vote for a target. Candidates:');
    raid.candidates.forEach((t, i) => out.push(`  ${i + 1}. ${targetText(t)}`));
    out.push(`  Votes: ${raid.votes.map((v, q) => `${P(q)} ${v !== null ? v + 1 : raid.voters[q] ? 'not yet' : 'no vote (no raid-ready dragon)'}`).join(', ')}`);
    if (you?.whyNoVote) out.push(`  ${you.whyNoVote}`);
    return out;
  }
  out.push(`Raid target: ${targetText(raid.target!)}`);
  if (raid.step === 'commit') {
    out.push(`Commitments (public, not locked until everyone is ready):`);
    raid.commits.forEach((c, q) => out.push(`  ${P(q)}: ${c.length ? `${c.join(' ')} (power ${commitPower(g, c)})` : 'nothing'}${raid.ready[q] ? ' (ready)' : ''}`));
  } else {
    out.push(`Locked commitments: ${raid.commits.map((c, q) => (c.length ? `${P(q)} ${c.join(' ')} (power ${commitPower(g, c)})` : '')).filter(Boolean).join(', ')}`);
    out.push(`Secret fight-or-bail choice. Decided: ${raid.commits.flatMap((c, q) => (c.length ? [`${P(q)} ${raid.decided[q] ? 'yes' : 'not yet'}`] : [])).join(', ')}`);
    if (you?.myChoice) out.push(`  You chose to ${you.myChoice}.`);
  }
  return out;
}

// Command hints for this seat right now. Empty if they have nothing to decide.
export function commandHints(g: PublicState, you: SeatState): string[] {
  if (!you.deciding) return [];
  const out: string[] = [];
  const afford = (c: { affordable: boolean }) => (c.affordable ? '' : ' (cannot afford yet)');
  if (g.phase === 'action') {
    for (const o of g.offers.filter((x) => x.to === you.seat)) {
      const why = you.cantAccept[o.id];
      out.push(`${why ? '' : `accept ${o.id}  |  `}decline ${o.id}   (${P(o.from)} gives ${o.give} for ${o.get})${why ? ` ${why}` : ''}`);
    }
    if (!you.myTurn) {
      out.push(`offer ${P(g.turn)} give <items> get <items>   (out of turn you may only trade with ${P(g.turn)})`);
      return out;
    }
    for (const c of you.hand) {
      if (c.kind === 'building') {
        // For a building that counts its neighbours, each hex shows its count, like 2,-1(x3).
        const hexes = c.hexes.map((k) => (c.counts ? `${k}(x${c.counts[k]})` : k));
        if (c.needs === 'none') out.push(`build ${c.id}   (${c.name})${afford(c)}`);
        else out.push(`build ${c.id} <hex>   (${c.name}; open hexes: ${hexes.join(' ') || 'none'})${afford(c)}`);
      } else if (c.kind === 'upgrade') {
        out.push(`upgrade ${c.id} <hex>   (${c.name}; on: ${c.hexes.join(' ') || 'none'})${afford(c)}`);
      } else if (c.kind === 'dragon') {
        out.push(`play ${c.id}   (hatch ${c.name})${afford(c)}${c.blocked ? ` (${c.blocked.replace(/\.$/, '')})` : ''}`);
      } else if (c.needs !== 'unplayable') {
        const arg = { resource: ' <stone|timber|crystal|livestock>', dragon: ' <dragon id>', hex: ' <hex>', none: '' }[c.needs];
        out.push(`play ${c.id}${arg}   (${c.name}${c.fauna ? `: any land hex without fauna or a tower; ${faunaText(c.fauna)}` : ''})${afford(c)}`);
      }
    }
    for (const b of you.basics) {
      if (b.hexes.length) out.push(`build ${b.key}${b.onTower ? '' : ' <hex>'}   (basic, no card: ${b.text} Costs ${resText(b.cost)}${b.onTower ? '' : `; open hexes: ${b.hexes.join(' ')}`})${afford(b)}`);
    }
    if (you.huntable.length && you.raidReady.length) {
      const foes = you.huntable.map((k) => {
        const h = g.map.find((x) => x.k === k)!;
        const ds = h.perched.filter((x) => x.owner !== you.seat).map((x) => x.d);
        return `${k} ${[...(h.fauna ? [h.fauna.name] : []), ...ds].join(' and ')}`;
      });
      out.push(`clear <hex> <dragon ids...>   (fight what holds the hex, its beast and any rival dragons perched there, to the end; the hits they take stay on them. One try at a great beast a round. Your ready dragons: ${you.raidReady.join(' ')}; you can fight: ${foes.join(', ')})`);
    }
    if (you.perchable.length && you.raidReady.length) out.push(`perch <hex> <dragon ids...>   (perch on a rival's building, not a tower: it makes nothing while they stay, and they don't raid. Rivals' buildings: ${you.perchable.join(' ')})`);
    if (you.perched.length) out.push(`recall <dragon ids...>   (bring perched dragons home: ${you.perched.join(' ')})`);
    out.push(`project <${you.eggProject.elements.join('|')}>   (base dragon egg, no card needed, costs ${resText(you.eggProject.cost)})`);
    out.push(`bank <give resource> <get resource> [times]   (your rate: ${you.bankRate}:1)`);
    out.push(`offer <player> give <items> get <items>   (items: "2 stone", card ids like "c12")`);
    for (const o of g.offers.filter((x) => x.from === you.seat)) out.push(`cancel ${o.id}`);
    out.push(g.offers.some((o) => o.to === you.seat) ? 'end   (end your turn, once you have answered the offers to you)' : 'end   (end your turn)');
    return out;
  }
  if (g.phase === 'cards') {
    out.push(`keep <${you.choice.map((c) => c.id).join('|')}>   (keep one of the building cards you drew; the other is discarded)`);
    for (const c of you.choice) out.push(`  ${cardText(c)}`);
    return out;
  }
  if (g.phase === 'discard') {
    const n = you.hand.length - you.handCap;
    out.push(`discard <${n} card ids>   (discard exactly ${n} of your ${you.hand.length} cards, like "discard ${you.hand.slice(0, n).map((c) => c.id).join(' ')}"; the hand limit is ${you.handCap})`);
    return out;
  }
  const raid = g.raid;
  if (raid?.step === 'vote' && !you.whyNoVote) out.push(`vote <1-${raid.candidates.length}>`);
  if (raid?.step === 'commit') {
    out.push(`commit <dragon ids...>   (your raid-ready dragons: ${you.raidReady.join(' ')}; "commit none" to withdraw; replaces your commitment)`);
    out.push('ready   (lock in your commitment)');
  }
  if (raid?.step === 'bail') out.push('fight  |  bail   (secret)');
  return out;
}

function phaseText(g: PublicState): string {
  if (g.phase === 'over') return `Game over.${g.winner !== null ? ` ${P(g.winner)} won.` : ''}`;
  if (g.phase === 'cards') return `Round ${g.round}, cards: everyone keeps one of the two building cards they drew.`;
  if (g.phase === 'action') return `Round ${g.round}, action phase, ${P(g.turn)}'s turn.`;
  if (g.phase === 'discard') return `Round ${g.round}, end of round: everyone over the hand limit discards down to it.`;
  return `Round ${g.round}, raid phase (${g.raid!.step}), ${plural(g.raidsLeft, 'raid')} left this round.`;
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

/** The public summary: the table, the phase, who the game waits on, the public scores. */
export function statusText(s: Snapshot): string {
  const names = tableText(s);
  const g = s.game;
  if (!g) return `Room ${s.lobby.code}, in the lobby: ${names || 'nobody yet'}. ${s.lobby.minPlayers} to ${s.lobby.maxPlayers} players; ${s.lobby.remote ? 'the first player starts' : 'the TV or the first player starts'}.`;
  const out = [`Room ${s.lobby.code}: ${names}.`, phaseText(g)];
  if (g.waitingOn.length) out.push(`Waiting on: ${waitingText(g)}`);
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
  out.push(hints.length ? `>>> It's your decision.` : `Waiting on: ${waitingText(g)}.`);
  out.push('');
  out.push(`== Scores (first to ${g.pointsToWin}; hidden points count at the end) ==`);
  g.players.forEach((pl, q) => {
    const extra = q === p ? ` + ${you.hiddenPoints} hidden = ${you.totalPoints}` : '';
    out.push(`${P(q)}${q === p ? ' (you)' : ''}: ${pl.publicPoints} public (buildings ${pl.buildings}, titles ${pl.titles}${pl.beasts ? `, great beasts ${pl.beasts}` : ''})${extra}; ${pl.handSize} cards in hand; produces ${amounts(pl.production)}`);
  });
  out.push(`Titles (${g.titlePoints} points each): ${g.titles.map((t) => `${t.name}: ${t.holder === null ? 'no one' : P(t.holder)} [${t.values.join('/')}; needs ${t.min}]`).join('; ')}`);
  out.push('');
  out.push('== You (hidden from others) ==');
  out.push(`Resources: ${Object.entries(you.resources).map(([r, n]) => `${n} ${r}`).join(', ')}`);
  out.push(`Each round you gain (production minus what your dragons eat): ${amounts(you.income)}.`);
  out.push(`Bank rate ${you.bankRate}:1. Dragons ${you.dragonsHoused}/${you.dragonCapacity} housed.`);
  const over = you.hand.length - you.handCap;
  out.push(`Hand (${you.hand.length}/${you.handCap})${over > 0 && g.phase !== 'discard' ? `, over the limit: at the end of the round you discard ${over}, unless you play ${over === 1 ? 'a card' : 'some'} first` : ''}:`);
  for (const c of you.hand) out.push(`  ${cardText(c)}`);
  if (you.choice.length) out.push(`Drawn, keep one: ${you.choice.map(cardText).join(' | ')}`);
  out.push('');
  out.push('== Dragons (public) ==');
  for (const d of g.dragons) out.push(`  ${dragonLine(d)}`);
  out.push('');
  out.push('== Buildings (public) ==');
  g.players.forEach((_, q) => {
    const list = g.map.filter((h) => h.building?.owner === q).map((h) => {
      const b = h.building!;
      return `${b.type === 'tower' ? `Tower(${b.floors} floors)` : b.name}${b.upgradeName ? `+${b.upgradeName}` : ''}@${h.k}`;
    });
    out.push(`  ${P(q)}: ${list.join(', ')}`);
  });
  out.push(...mapText(g));
  const fauna = g.map.filter((h) => h.fauna).sort((a, b) => (a.k < b.k ? -1 : 1));
  out.push(`Fauna: ${fauna.length ? fauna.map((h) => `${h.k} ${faunaText(h.fauna!)}${h.building ? ` on ${P(h.building.owner)}'s ${h.building.type}` : ''}`).join('; ') : 'none'}. Any player clears fauna, or rivals' perched dragons, on their turn with "clear <hex> <dragons>"; a beast's loot goes to them. In production, each beast (not a great beast) has a 1 in ${g.faunaWanderOdds} chance to move to an adjacent land hex with no tower or beast.`);
  const peak = g.map.find((h) => h.peak)?.k;
  const slain = g.beasts.filter((b) => b.slainBy !== null).map((b) => `${b.name} by ${P(b.slainBy!)}`);
  out.push(`Great beasts: ${g.beasts.map((b) => b.name).join(' and ')}, each worth ${g.beasts[0]?.points ?? 0} point${g.beasts[0]?.points === 1 ? '' : 's'} for good to whoever slays it, and never back. Once the Thunderbird falls, production buildings on or adjacent to the peak${peak ? ` (${peak})` : ''} make ${g.peakBonus} more. Slain so far: ${slain.join(', ') || 'none'}.`);
  out.push(`Kingdoms (raid loot now; each adds 1 gold after every raid it doesn't fall in): ${g.kingdoms.map((t) => `${t.name} (power ${t.power}) ${resText(t.loot)}`).join('; ')}.`);
  if (g.raid) {
    out.push('');
    out.push(...raidText(g, you));
  }
  if (g.offers.length) {
    out.push('');
    out.push('== Open offers ==');
    for (const o of g.offers) out.push(`  ${o.id}: ${P(o.from)} offers ${P(o.to)} ${o.give} for ${o.get}`);
  }
  out.push('');
  out.push(`== Recent events ==`);
  for (const e of snapshotEvents(s).slice(-logLines)) out.push(`  ${eventLine(e)}`);
  if (hints.length) {
    out.push('');
    out.push('== Your options ==');
    for (const h of hints) out.push(`  ${h}`);
  }
  if (g.phase !== 'over') out.push(`Talk any time: say <message> (everyone hears), tell <P#> <message> (private). Talk binds no one; only accepted offers do.`);
  return out.join('\n');
}

/** One line for a seat: its options when it's its decision, else who the game waits on. */
export function seatStatus(s: Snapshot): string {
  const g = s.game;
  if (!g) return 'The game has not started yet.';
  if (g.phase === 'over') return `The game is over.${g.winner !== null ? ` ${P(g.winner)} won.` : ''}`;
  const hints = s.you ? commandHints(g, s.you) : [];
  if (hints.length) return `It's your decision. Your options:\n${hints.map((h) => `  ${h}`).join('\n')}`;
  return `Not your decision. Waiting on: ${waitingText(g)}.`;
}

/** After a move: the events this seat sees from log index `since` on, then its options or who the game waits on. */
export function afterMove(s: Snapshot, since: number): string {
  const lines = snapshotEvents(s).filter((e) => e.i >= since).map((e) => `  ${eventLine(e)}`);
  const g = s.game;
  const hints = g && s.you ? commandHints(g, s.you) : [];
  const tail = !g ? 'The game has not started yet.' : g.phase === 'over' ? 'The game is over.' : hints.length ? `Your options:\n${hints.map((h) => `  ${h}`).join('\n')}` : `Waiting on: ${waitingText(g)}.`;
  return [...lines, tail].join('\n');
}

/** The log index just past the last event in a snapshot: where the next move's events start. */
export const nextIndex = (s: Snapshot) => Math.max(-1, ...snapshotEvents(s).map((e) => e.i)) + 1;
