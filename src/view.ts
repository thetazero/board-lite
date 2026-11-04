// What one player is allowed to see, as text. Everything here is either
// public (the TV) or this player's own hidden state (their phone).

import { ACTIONS, BASIC_BUILDINGS, BEASTS, BUILDINGS, CLASS_NAMES, DRAGONS, ELEMENTS, RESOURCES, faunaDef, STAGE_NAMES, TARGETING_TEXT, TARGETS, TUNING, UNITS, UPGRADES, combatPower, targetPower, type Bundle } from './data.ts';
import {
  PROJECT_DRAGONS, neighbourCount, TITLE_NAMES, backInRound, bankRate, buildableHexes, bundleText, canAfford, canRaid, cardCost, cardKind, cardName,
  dragonCapacity, dragonName, dragonPower, faunaOnMap, huntable, pname, production, score, specialProjectCost, stageStats, titleValues, tradeText, unitsText, upgradeTargets, waitingOn,
  type Card, type Dragon, type Game, type Title,
} from './engine.ts';
import { PEAK, mapRadius, nearBeast } from './map.ts';

const TERRAIN_LETTER: Record<string, string> = { mountain: 'M', forest: 'F', ley: 'L', meadow: 'G', plains: '.', harbor: 'H', ocean: '~' };
// Two letters per building on the text map.
const BUILDING_CODE: Record<string, string> = {
  tower: 'TW', quarry: 'qu', lumber_camp: 'lc', crystal_mine: 'cm', pasture: 'pa', roost: 'ro',
  cliff_works: 'cw', stonemason: 'sm', woodcutter: 'wc', sawmill: 'sw', driftwood_yard: 'dy', ley_spire: 'ls', gem_cutter: 'gc', smelter: 'se',
  shepherds_fold: 'sf', drovers_barn: 'db', fishery: 'fi', hatchery: 'ha', port: 'po', market: 'mk',
  monument: 'mo', standing_stones: 'ss', lighthouse: 'lh', guildhall: 'gh',
};
const FAUNA_CODE: Record<string, string> = { wolf_pack: 'W', cave_bear: 'B', basilisk: 'X', thunderbird: 'T', leviathan: 'V' };
const code = (type: string) => BUILDING_CODE[type] ?? type.slice(0, 2);

export function cardText(c: Card): string {
  const kind = cardKind(c);
  const cost = bundleText(cardCost(c));
  if (kind === 'building') {
    const b = BUILDINGS[c.key];
    return `${c.id} ${b.name} [building, class ${CLASS_NAMES[b.class]}${b.terrain ? `, on ${b.terrain}` : ''}] cost ${cost}: ${b.text}`;
  }
  if (kind === 'upgrade') {
    const u = UPGRADES[c.key];
    return `${c.id} ${u.name} [upgrade for a ${u.appliesTo.map((x) => CLASS_NAMES[x]).join(' or ')}] cost ${cost}: ${u.text}`;
  }
  if (kind === 'action') {
    const a = ACTIONS[c.key];
    return `${c.id} ${a.name} [action] cost ${cost}: ${a.text}`;
  }
  return `${c.id} ${DRAGONS[c.key].name} [dragon egg] cost ${cost}: ${dragonCardText(c.key)}`;
}

export function dragonCardText(k: string): string {
  const d = DRAGONS[k];
  const st = d.stages.map((s, i) => `${STAGE_NAMES[i + 1]} ${s.hp}hp ${s.targets}x${s.dice}d${s.sides} power ${combatPower(s)}`).join(' / ');
  return `${d.element}, grows every ${d.growthTime === 1 ? 'step' : `${d.growthTime} steps`}, ${TARGETING_TEXT[d.targeting]}; ${st}`;
}

function dragonLine(g: Game, d: Dragon): string {
  const st = stageStats(d);
  const def = DRAGONS[d.key];
  const growth = d.stage === 3 ? 'fully grown' : `growth ${d.growth}/${def.growthTime}`;
  const health = st ? `${st.hp - d.damage}/${st.hp}hp` : 'egg';
  const healing = `healing: raids again in round ${backInRound(g, d)}`;
  const rest = { hungry: 'went hungry: no growth or raids this round', hurt: healing, hunted: `fought fauna: no raids this round${d.damage ? `; ${healing}` : ''}` };
  const status = canRaid(d) ? 'can raid or fight fauna' : d.stage === 0 ? 'egg, cannot raid' : d.resting ? rest[d.resting] : healing;
  return `${d.id} ${pname(d.owner)} ${dragonName(d)} (${def.element} ${STAGE_NAMES[d.stage]}, ${growth}, ${st ? `power ${dragonPower(d)}, ` : ''}${health}, ${status}) — ${TARGETING_TEXT[def.targeting]}${st ? `, attacks ${st.targets}x${st.dice}d${st.sides}` : ''}`;
}

function productionText(g: Game, p: number): string {
  const prod = production(g, p);
  return RESOURCES.filter((r) => prod[r].base || prod[r].dice.length)
    .map((r) => `${r} ${prod[r].base}${prod[r].dice.map((d) => `+d${d}`).join('')}`)
    .join(', ');
}

function mapText(g: Game): string[] {
  const R = mapRadius(g.players.length) + 1;
  const lines: string[] = [];
  lines.push('Map (axial q,r). Terrain: M mountain, F forest, L ley line, G meadow, . plains, H harbor, ~ ocean (no buildings).');
  lines.push(`Buildings show as <owner><code>, + if upgraded: ${Object.entries(BUILDING_CODE).map(([k, c]) => `${c} ${k === 'tower' ? 'tower' : BUILDINGS[k].name}`).join(', ')}.`);
  lines.push(`Fauna shows as {code} (no building there; a building under it makes nothing): ${Object.entries(FAUNA_CODE).map(([k, c]) => `${c} ${faunaDef(k).name}${BEASTS[k] ? ' (great beast)' : ''}`).join(', ')}. A great beast also holds the hexes adjacent to it (shown as {x}): nothing is built there until it is slain.`);
  for (let r = -R; r <= R; r++) {
    const cells: string[] = [];
    for (let q = -R; q <= R; q++) {
      const k = `${q},${r}`;
      const hex = g.map[k];
      if (!hex) continue;
      const b = g.buildings[k];
      const label = b ? `${b.owner + 1}${code(b.type)}${b.upgrade ? '+' : ''}` : '';
      const held = hex.fauna ? `{${FAUNA_CODE[hex.fauna]}}` : nearBeast(g.map, k) && hex.terrain !== 'ocean' ? '{x}' : '';
      cells.push(`${k}:${TERRAIN_LETTER[hex.terrain]}${k === PEAK ? '^' : ''}${label ? `[${label}]` : ''}${held}`);
    }
    lines.push(`  ${' '.repeat(Math.abs(r) * 4)}${cells.join('  ')}`);
  }
  return lines;
}

function raidText(g: Game, p: number): string[] {
  const raid = g.raid!;
  const out: string[] = [];
  if (raid.step === 'vote') {
    out.push('Raid: vote for a target. Candidates:');
    raid.candidates.forEach((t, i) => out.push(`  ${i + 1}. ${targetText(t)}`));
    out.push(`  Voted: ${raid.votes.map((v, q) => `${pname(q)} ${v === null ? 'not yet' : 'yes'}`).join(', ')}`);
    return out;
  }
  out.push(`Raid target: ${targetText(raid.target!)}`);
  if (raid.step === 'commit') {
    out.push(`Commitments (public, not locked until everyone is ready):`);
    for (let q = 0; q < g.players.length; q++) out.push(`  ${pname(q)}: ${raid.commits[q].length ? `${raid.commits[q].join(' ')} (power ${commitPower(g, raid.commits[q])})` : 'nothing'}${raid.ready[q] ? ' (ready)' : ''}`);
  } else {
    out.push(`Locked commitments: ${raid.commits.map((c, q) => (c.length ? `${pname(q)} ${c.join(' ')} (power ${commitPower(g, c)})` : '')).filter(Boolean).join(', ')}`);
  }
  if (raid.step === 'bail') {
    out.push(`Secret fight-or-bail choice. Decided: ${raid.commits.flatMap((c, q) => (c.length ? [`${pname(q)} ${raid.choices[q] ? 'yes' : 'not yet'}`] : [])).join(', ')}`);
    if (raid.choices[p]) out.push(`  You chose to ${raid.choices[p]}.`);
  }
  return out;
}

function commitPower(g: Game, ids: string[]): number {
  return ids.reduce((s, id) => s + dragonPower(g.dragons.find((d) => d.id === id)!), 0);
}

export function targetText(t: string): string {
  const def = TARGETS[t];
  const units = def.units.map((u) => {
    const x = UNITS[u];
    return `${x.name} (combat power ${combatPower(x)}; ${x.hp}hp ${x.targets}x${x.dice}d${x.sides}${x.weak.length ? ` weak:${x.weak.join('/')}` : ''}${x.strong.length ? ` strong:${x.strong.join('/')}` : ''})`;
  });
  return `${def.name} — combat power ${targetPower(t)}; defenders: ${units.join(', ')}; loot ${bundleText(def.loot)} (split by the combat power each player still has fighting at the end)`;
}

export function faunaText(k: string): string {
  const x = faunaDef(k);
  const prize = BEASTS[k] ? `great beast: ${BEASTS[k].points} point for good to whoever slays it; 1 try each round` : `loot ${bundleText(x.loot)}`;
  return `${x.name} (combat power ${combatPower(x)}; ${x.hp}hp ${x.targets}x${x.dice}d${x.sides}${x.weak.length ? ` weak:${x.weak.join('/')}` : ''}${x.strong.length ? ` strong:${x.strong.join('/')}` : ''}; ${prize})`;
}

// Command hints for this player right now. Empty if they have nothing to decide.
export function commandHints(g: Game, p: number): string[] {
  if (!waitingOn(g).includes(p)) return [];
  const pl = g.players[p];
  const out: string[] = [];
  if (g.phase === 'action') {
    for (const o of g.offers.filter((x) => x.to === p)) out.push(`accept ${o.id}  |  decline ${o.id}   (${pname(o.from)} gives ${tradeText(g, o.give)} for ${tradeText(g, o.get)})`);
    if (p !== g.turn) {
      out.push(`offer ${pname(g.turn)} give <items> get <items>   (out of turn you may only trade with ${pname(g.turn)})`);
      return out;
    }
    for (const c of pl.hand) {
      const kind = cardKind(c);
      const afford = canAfford(pl, cardCost(c)) ? '' : ' (cannot afford yet)';
      if (kind === 'building') {
        const def = BUILDINGS[c.key];
        // For a building that counts its neighbours, each hex shows its count, like 2,-1(x3).
        const hexes = buildableHexes(g, p, c.key).map((k) => (def.per ? `${k}(x${neighbourCount(g, k, def.per)})` : k));
        if (def.onTower) out.push(`build ${c.id}   (${cardName(c)})${afford}`);
        else out.push(`build ${c.id} <hex>   (${cardName(c)}; open hexes: ${hexes.join(' ') || 'none'})${afford}`);
      } else if (kind === 'upgrade') {
        out.push(`upgrade ${c.id} <hex>   (${cardName(c)}; on: ${upgradeTargets(g, p, c.key).join(' ') || 'none'})${afford}`);
      } else if (kind === 'dragon') {
        const full = g.dragons.filter((d) => d.owner === p).length >= dragonCapacity(g, p) ? ' (no room: build a roost first)' : '';
        out.push(`play ${c.id}   (hatch ${cardName(c)})${afford}${full}`);
      } else {
        const a = ACTIONS[c.key];
        const arg = { gain_resource: ' <stone|timber|crystal|livestock>', grow_dragon: ' <dragon id>', heal_dragon: ' <dragon id>', gain_gold: '', extra_raid: '', hidden_point: null, send_fauna: ' <hex>' }[a.effect];
        if (arg !== null) out.push(`play ${c.id}${arg}   (${a.name}${a.effect === 'send_fauna' ? `: any land hex without fauna or a tower; ${faunaText(a.fauna!)}` : ''})${afford}`);
      }
    }
    for (const b of BASIC_BUILDINGS) {
      const def = BUILDINGS[b];
      const hexes = buildableHexes(g, p, b);
      if (hexes.length) out.push(`build ${b}${def.onTower ? '' : ' <hex>'}   (basic, no card: ${def.text} Costs ${bundleText(def.cost)}${def.onTower ? '' : `; open hexes: ${hexes.join(' ')}`})${canAfford(pl, def.cost) ? '' : ' (cannot afford yet)'}`);
    }
    const fighters = g.dragons.filter((d) => d.owner === p && canRaid(d)).map((d) => d.id);
    const fauna = huntable(g, p);
    if (fauna.length && fighters.length) out.push(`clear <hex> <dragon ids...>   (fight the beast there to the end; those dragons then sit out this round's raids. One try at a great beast a round. Your ready dragons: ${fighters.join(' ')}; you can fight: ${fauna.map((k) => `${k} ${faunaDef(g.map[k].fauna!).name}`).join(', ')})`);
    out.push(`project <${ELEMENTS.join('|')}>   (base dragon egg, no card needed, costs ${bundleText(specialProjectCost(DRAGONS.fire_whelp.cost))})`);
    out.push(`bank <give resource> <get resource> [times]   (your rate: ${bankRate(g, p)}:1, not gold)`);
    out.push(`offer <player> give <items> get <items>   (items: "2 stone", card ids like "c12")`);
    for (const o of g.offers.filter((x) => x.from === p)) out.push(`cancel ${o.id}`);
    out.push(g.offers.some((o) => o.to === p) ? 'end   (end your turn, once you have answered the offers to you)' : 'end   (end your turn)');
    return out;
  }
  if (g.phase === 'cards') {
    out.push(`keep <${pl.choice.map((c) => c.id).join('|')}>   (keep one of the building cards you drew; the other is discarded)`);
    for (const c of pl.choice) out.push(`  ${cardText(c)}`);
    return out;
  }
  if (g.phase === 'discard') {
    out.push(`discard <${pl.hand.length - TUNING.handCap} card ids>   (hand cap is ${TUNING.handCap})`);
    return out;
  }
  const raid = g.raid!;
  if (raid.step === 'vote') out.push(`vote <1-${raid.candidates.length}>`);
  if (raid.step === 'commit') {
    const ids = g.dragons.filter((d) => d.owner === p && canRaid(d)).map((d) => d.id);
    out.push(`commit <dragon ids...>   (your raid-ready dragons: ${ids.join(' ')}; "commit none" to withdraw; replaces your commitment)`);
    out.push('ready   (lock in your commitment)');
  }
  if (raid.step === 'bail') out.push('fight  |  bail   (secret)');
  return out;
}

function phaseText(g: Game): string {
  if (g.phase === 'over') return `Game over. ${pname(g.winner!)} won.`;
  if (g.phase === 'cards') return `Round ${g.round}, cards: everyone keeps one of the two building cards they drew.`;
  if (g.phase === 'action') return `Round ${g.round}, action phase, ${pname(g.turn)}'s turn.`;
  if (g.phase === 'discard') return `Round ${g.round}, end of round: discarding down to ${TUNING.handCap} cards.`;
  return `Round ${g.round}, raid phase (${g.raid!.step}), ${g.raidsLeft} raid${g.raidsLeft === 1 ? '' : 's'} left this round.`;
}

function costLine(b: Bundle): string {
  return bundleText(b);
}

export function publicStatus(g: Game): string {
  const out: string[] = [];
  out.push(phaseText(g));
  const w = waitingOn(g);
  if (w.length) out.push(`Waiting on: ${w.map(pname).join(', ')}`);
  for (let q = 0; q < g.players.length; q++) {
    out.push(`${pname(q)}: ${score(g, q).public} public points, ${g.players[q].hand.length} cards in hand`);
  }
  return out.join('\n');
}

export function playerView(g: Game, p: number, logLines = 25): string {
  const pl = g.players[p];
  const out: string[] = [];
  out.push(`You are ${pname(p)}. ${phaseText(g)}`);
  const hints = commandHints(g, p);
  out.push(hints.length ? `>>> It's your decision.` : `Waiting on: ${waitingOn(g).map(pname).join(', ') || 'no one'}.`);
  out.push('');
  out.push(`== Scores (first to ${TUNING.pointsToWin}; hidden points count at the end) ==`);
  for (let q = 0; q < g.players.length; q++) {
    const s = score(g, q);
    const extra = q === p ? ` + ${s.hidden} hidden = ${s.total}` : '';
    out.push(`${pname(q)}${q === p ? ' (you)' : ''}: ${s.public} public (dragons ${s.dragons}, buildings ${s.buildings}, titles ${s.titles}${s.beasts ? `, great beasts ${s.beasts}` : ''})${extra}; ${g.players[q].hand.length} cards in hand; produces ${productionText(g, q)}`);
  }
  out.push(`Titles (${TUNING.titlePoints} points each): ${(Object.keys(TITLE_NAMES) as Title[]).map((t) => `${TITLE_NAMES[t]}: ${g.titles[t] === null ? 'no one' : pname(g.titles[t]!)} [${titleValues(g, t).join('/')}; needs ${TUNING.titleMinimum[t]}]`).join('; ')}`);
  out.push('');
  out.push('== You (hidden from others) ==');
  out.push(`Resources: ${RESOURCES.map((r) => `${pl.resources[r]} ${r}`).join(', ')}`);
  out.push(`Bank rate ${bankRate(g, p)}:1. Dragons ${g.dragons.filter((d) => d.owner === p).length}/${dragonCapacity(g, p)} housed. Each dragon eats ${TUNING.livestockPerDragon} livestock per round.`);
  out.push(`Hand (${pl.hand.length}/${TUNING.handCap}):`);
  for (const c of pl.hand) out.push(`  ${cardText(c)}`);
  if (pl.choice.length) out.push(`Drawn, keep one: ${pl.choice.map((c) => cardText(c)).join(' | ')}`);
  out.push('');
  out.push('== Dragons (public) ==');
  for (const d of g.dragons) out.push(`  ${dragonLine(g, d)}`);
  out.push('');
  out.push('== Buildings (public) ==');
  for (let q = 0; q < g.players.length; q++) {
    const list = Object.entries(g.buildings)
      .filter(([, b]) => b.owner === q)
      .map(([k, b]) => `${b.type === 'tower' ? `Tower(${b.floors} floors)` : BUILDINGS[b.type].name}${b.upgrade ? `+${UPGRADES[b.upgrade].name}` : ''}@${k}`);
    out.push(`  ${pname(q)}: ${list.join(', ')}`);
  }
  out.push(...mapText(g));
  const fauna = faunaOnMap(g);
  out.push(`Fauna: ${fauna.length ? fauna.map((k) => `${k} ${faunaText(g.map[k].fauna!)}${g.buildings[k] ? ` on ${pname(g.buildings[k].owner)}'s ${g.buildings[k].type}` : ''}`).join('; ') : 'none'}. Any player clears fauna on their turn with "clear <hex> <dragons>"; the loot goes to them.`);
  const slain = Object.entries(g.slain).map(([k, q]) => `${BEASTS[k].name} by ${pname(q)}`);
  out.push(`Great beasts: a Thunderbird on the peak (${PEAK}) and a Leviathan off a coast, each worth ${BEASTS.thunderbird.points} point for good to whoever slays it, and never back. Once the Thunderbird falls, production buildings on or adjacent to the peak make ${TUNING.peakBonus} more. Slain so far: ${slain.join(', ') || 'none'}.`);
  if (g.phase === 'raid') {
    out.push('');
    out.push(...raidText(g, p));
  }
  if (g.offers.length) {
    out.push('');
    out.push('== Open offers ==');
    for (const o of g.offers) out.push(`  ${o.id}: ${pname(o.from)} offers ${pname(o.to)} ${tradeText(g, o.give)} for ${tradeText(g, o.get)}`);
  }
  out.push('');
  out.push(`== Recent events ==`);
  const visible = g.log.filter((e) => !e.to || e.to.includes(p));
  for (const e of visible.slice(-logLines)) out.push(`  [r${e.round}] ${e.text}`);
  if (hints.length) {
    out.push('');
    out.push('== Your options ==');
    for (const h of hints) out.push(`  ${h}`);
  }
  if (g.phase !== 'over') out.push(`Talk any time: say <message> (everyone hears), tell <P#> <message> (private). Talk binds no one; only accepted offers do.`);
  return out.join('\n');
}

// After a seat's move: the events it can see since `before` (a count of its
// visible log), then its options or who the game is waiting on.
export function visibleLog(g: Game, p: number) {
  return g.log.filter((e) => !e.to || e.to.includes(p));
}

// One line for a seat: its options when it's its decision, else who the game waits on.
export function seatStatus(g: Game, p: number): string {
  if (g.phase === 'over') return `The game is over.${g.winner !== null ? ` ${pname(g.winner)} won.` : ''}`;
  const hints = commandHints(g, p);
  if (hints.length) return `It's your decision. Your options:\n${hints.map((h) => `  ${h}`).join('\n')}`;
  return `Not your decision. Waiting on: ${waitingOn(g).map(pname).join(', ')}.`;
}

export function afterMove(g: Game, p: number, before: number): string {
  const lines = visibleLog(g, p).slice(before).map((e) => `  [r${e.round}] ${e.text}`);
  const hints = commandHints(g, p);
  const tail = g.phase === 'over' ? 'The game is over.' : hints.length ? `Your options:\n${hints.map((h) => `  ${h}`).join('\n')}` : `Waiting on: ${waitingOn(g).map(pname).join(', ')}.`;
  return `${lines.join('\n')}\n${tail}`;
}

export { costLine };
