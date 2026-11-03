// What one player is allowed to see, as text. Everything here is either
// public (the TV) or this player's own hidden state (their phone).

import { ACTIONS, BUILDINGS, DRAGONS, ELEMENTS, RESOURCES, STAGE_NAMES, TARGETING_TEXT, TARGETS, TUNING, UNITS, UPGRADES, type Bundle } from './data.ts';
import {
  PROJECT_BUILDINGS, PROJECT_DRAGONS, TITLE_NAMES, bankRate, buildableHexes, bundleText, canAfford, canRaid, cardCost, cardKind, cardName,
  dragonCapacity, dragonName, pname, production, score, specialProjectCost, stageStats, titleValues, tradeText, unitsText, upgradeTargets, waitingOn,
  type Card, type Dragon, type Game, type Title,
} from './engine.ts';
import { mapRadius } from './map.ts';

const TERRAIN_LETTER: Record<string, string> = { mountain: 'M', forest: 'F', ley: 'L', meadow: 'G', plains: '.' };
const BUILDING_LETTER: Record<string, string> = {
  tower: 'T', quarry: 'q', lumber_camp: 'l', crystal_mine: 'c', pasture: 'p', roost: 'r', hatchery: 'h', market: 'm', caravan_post: 'v', tower_floor: 'T', monument: 'o',
};

export function cardText(c: Card): string {
  const kind = cardKind(c);
  const cost = bundleText(cardCost(c));
  if (kind === 'building') {
    const b = BUILDINGS[c.key];
    return `${c.id} ${b.name} [building, ${b.class}${b.terrain ? `, on ${b.terrain}` : ''}] cost ${cost}: ${b.text}`;
  }
  if (kind === 'upgrade') {
    const u = UPGRADES[c.key];
    return `${c.id} ${u.name} [upgrade for a ${u.appliesTo} building] cost ${cost}: ${u.text}`;
  }
  if (kind === 'action') {
    const a = ACTIONS[c.key];
    return `${c.id} ${a.name} [action] cost ${cost}: ${a.text}`;
  }
  return `${c.id} ${DRAGONS[c.key].name} [dragon egg] cost ${cost}: ${dragonCardText(c.key)}`;
}

export function dragonCardText(k: string): string {
  const d = DRAGONS[k];
  const st = d.stages.map((s, i) => `${STAGE_NAMES[i + 1]} ${s.hp}hp ${s.targets}x${s.dice}d${s.sides} spd${s.speed}`).join(' / ');
  return `${d.element}, grows every ${d.growthTime} step(s), ${TARGETING_TEXT[d.targeting]}; ${st}`;
}

function dragonLine(g: Game, d: Dragon): string {
  const st = stageStats(d);
  const def = DRAGONS[d.key];
  const growth = d.stage === 3 ? 'fully grown' : `growth ${d.growth}/${def.growthTime}`;
  const health = st ? `${st.hp - d.damage}/${st.hp}hp` : 'egg';
  const status = canRaid(d) ? 'can raid' : d.stage === 0 ? 'egg, cannot raid' : !d.fed ? 'hungry, cannot raid' : 'hurt, cannot raid';
  return `${d.id} ${pname(d.owner)} ${dragonName(d)} (${def.element} ${STAGE_NAMES[d.stage]}, ${growth}, ${health}, ${status}) — ${TARGETING_TEXT[def.targeting]}${st ? `, attacks ${st.targets}x${st.dice}d${st.sides}, speed ${st.speed}` : ''}`;
}

function productionText(g: Game, p: number): string {
  const prod = production(g, p);
  return RESOURCES.filter((r) => prod[r].base || prod[r].dice.length)
    .map((r) => `${r} ${prod[r].base}${prod[r].dice.map((d) => `+d${d}`).join('')}`)
    .join(', ');
}

function mapText(g: Game): string[] {
  const R = mapRadius(g.players.length);
  const lines: string[] = [];
  lines.push('Map (axial q,r). Terrain: M mountain, F forest, L ley line, G meadow, . plains.');
  lines.push('Buildings show as <owner><letter>: T tower, q quarry, l lumber camp, c crystal mine, p pasture, r roost, h hatchery, m market, v caravan post, o monument (lowercase=no upgrade, +=upgraded).');
  for (let r = -R; r <= R; r++) {
    const cells: string[] = [];
    for (let q = -R; q <= R; q++) {
      const k = `${q},${r}`;
      const hex = g.map[k];
      if (!hex) continue;
      const b = g.buildings[k];
      const label = b ? `${b.owner + 1}${BUILDING_LETTER[b.type]}${b.upgrade ? '+' : ''}` : '';
      cells.push(`${k}:${TERRAIN_LETTER[hex.terrain]}${label ? `[${label}]` : ''}`);
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
    for (let q = 0; q < g.players.length; q++) out.push(`  ${pname(q)}: ${raid.commits[q].join(' ') || 'nothing'}${raid.ready[q] ? ' (ready)' : ''}`);
  } else {
    out.push(`Locked commitments: ${raid.commits.map((c, q) => (c.length ? `${pname(q)} ${c.join(' ')}` : '')).filter(Boolean).join(', ')}`);
  }
  if (raid.step === 'bail') {
    out.push(`Secret fight-or-bail choice. Decided: ${raid.commits.flatMap((c, q) => (c.length ? [`${pname(q)} ${raid.choices[q] ? 'yes' : 'not yet'}`] : [])).join(', ')}`);
    if (raid.choices[p]) out.push(`  You chose to ${raid.choices[p]}.`);
  }
  if (raid.step === 'flee') {
    out.push(`Combat round ${raid.combatRound} done. Defenders: ${unitsText(g)}`);
    out.push(`Dragons still fighting: ${raid.fighters.join(' ')}`);
    out.push(`Flee decisions made: ${g.players.flatMap((_, q) => (raid.fighters.some((id) => g.dragons.find((d) => d.id === id)!.owner === q) ? [`${pname(q)} ${raid.flee[q] === null ? 'not yet' : 'yes'}`] : [])).join(', ')}`);
  }
  return out;
}

export function targetText(t: string): string {
  const def = TARGETS[t];
  const units = def.units.map((u) => {
    const x = UNITS[u];
    return `${x.name} (${x.hp}hp ${x.targets}x${x.dice}d${x.sides} chase${x.chase}${x.weak.length ? ` weak:${x.weak.join('/')}` : ''}${x.strong.length ? ` strong:${x.strong.join('/')}` : ''})`;
  });
  return `${def.name} — defenders: ${units.join(', ')}; loot ${bundleText(def.loot)} (split among winners)`;
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
        const hexes = buildableHexes(g, p, c.key);
        if (BUILDINGS[c.key].onTower) out.push(`build ${c.id}   (${cardName(c)})${afford}`);
        else out.push(`build ${c.id} <hex>   (${cardName(c)}; open hexes: ${hexes.join(' ') || 'none'})${afford}`);
      } else if (kind === 'upgrade') {
        out.push(`upgrade ${c.id} <hex>   (${cardName(c)}; on: ${upgradeTargets(g, p, c.key).join(' ') || 'none'})${afford}`);
      } else if (kind === 'dragon') {
        const full = g.dragons.filter((d) => d.owner === p).length >= dragonCapacity(g, p) ? ' (no room: build a roost first)' : '';
        out.push(`play ${c.id}   (hatch ${cardName(c)})${afford}${full}`);
      } else {
        const a = ACTIONS[c.key];
        const arg = { gain_resource: ' <stone|timber|crystal|livestock>', grow_dragon: ' <dragon id>', heal_dragon: ' <dragon id>', gain_gold: '', extra_raid: '', hidden_point: null }[a.effect];
        if (arg !== null) out.push(`play ${c.id}${arg}   (${a.name})${afford}`);
      }
    }
    out.push(`project <${PROJECT_BUILDINGS.join('|')}> <hex>   (no card needed, costs ${TUNING.specialProjectMultiplier}x the card cost)`);
    out.push(`project <${ELEMENTS.join('|')}>   (base dragon egg, no card needed, costs ${bundleText(specialProjectCost(DRAGONS.fire_whelp.cost))})`);
    out.push(`bank <give resource> <get resource> [times]   (your rate: ${bankRate(g, p)}:1)`);
    out.push(`offer <player> give <items> get <items>   (items: "2 stone", card ids like "c12")`);
    for (const o of g.offers.filter((x) => x.from === p)) out.push(`cancel ${o.id}`);
    out.push('end   (end your turn)');
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
  if (raid.step === 'flee') {
    const mine = raid.fighters.filter((id) => g.dragons.find((d) => d.id === id)!.owner === p);
    out.push(`stay  |  flee all  |  flee <${mine.join('|')}>`);
  }
  return out;
}

function phaseText(g: Game): string {
  if (g.phase === 'over') return `Game over. ${pname(g.winner!)} won.`;
  if (g.phase === 'action') return `Round ${g.round}, action phase, ${pname(g.turn)}'s turn.`;
  if (g.phase === 'discard') return `Round ${g.round}, end of round: discarding down to ${TUNING.handCap} cards.`;
  return `Round ${g.round}, raid phase (${g.raid!.step}), ${g.raidsLeft} raid(s) left this round.`;
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
  out.push(hints.length ? `>>> It's your decision.` : `Waiting on: ${waitingOn(g).map(pname).join(', ') || 'nobody'}.`);
  out.push('');
  out.push(`== Scores (first to ${TUNING.pointsToWin}; hidden points count at the end) ==`);
  for (let q = 0; q < g.players.length; q++) {
    const s = score(g, q);
    const extra = q === p ? ` + ${s.hidden} hidden = ${s.total}` : '';
    out.push(`${pname(q)}${q === p ? ' (you)' : ''}: ${s.public} public (dragons ${s.dragons}, buildings ${s.buildings}, titles ${s.titles})${extra}; ${g.players[q].hand.length} cards in hand; produces ${productionText(g, q)}`);
  }
  out.push(`Titles (${TUNING.titlePoints} points each): ${(Object.keys(TITLE_NAMES) as Title[]).map((t) => `${TITLE_NAMES[t]}: ${g.titles[t] === null ? 'nobody' : pname(g.titles[t]!)} [${titleValues(g, t).join('/')}]`).join('; ')}`);
  out.push('');
  out.push('== You (hidden from others) ==');
  out.push(`Resources: ${RESOURCES.map((r) => `${pl.resources[r]} ${r}`).join(', ')}`);
  out.push(`Bank rate ${bankRate(g, p)}:1. Dragons ${g.dragons.filter((d) => d.owner === p).length}/${dragonCapacity(g, p)} housed. Each dragon eats ${TUNING.livestockPerDragon} livestock per round.`);
  out.push(`Hand (${pl.hand.length}/${TUNING.handCap}):`);
  for (const c of pl.hand) out.push(`  ${cardText(c)}`);
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
  return out.join('\n');
}

export { costLine };
