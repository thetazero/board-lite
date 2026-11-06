// A kingdom drawn: its defenders, its loot, its combat power, and the card
// you vote on. The TV, its table view (no TV) and the phone all vote on the
// same card, so the choice looks the same wherever it's made.

import type { PublicState, Res, TargetView, UnitView } from '../src/state.ts';
import { elemWords, esc, playerTag, powerTag, resChips, statTag } from './common.ts';
import { icon } from './icons.ts';

// A kingdom to vote for, kept to what the choice needs at a glance: its name,
// combat power on a shield, defenders as pictures, loot, and who has voted for
// it with what each vote is worth, outlined while it leads. Each defender's
// stats wait for the commit step.
// On the phone it's the button you vote with (`attrs` adds data-vote and the like).
export function kingdomCard(t: TargetView, i: number, n: number, votes: (number | null)[], power: number[], names: string[], opts: { tag?: 'div' | 'button'; cls?: string; attrs?: string } = {}): string {
  const tag = opts.tag ?? 'div';
  const lead = leadsVote(votes, power, i, n);
  return `<${tag} class="target cand${lead ? ' lead' : ''}${opts.cls ? ` ${opts.cls}` : ''}"${opts.attrs ? ` ${opts.attrs}` : ''}><h2>${esc(t.name)}</h2>
    <div class="cand-fight">${powerShield(t.power, 4.4)}${foeIcons(t.units, 3)}</div>${lootLine(t.loot, 1.7)}${pointsLine(t, 1.7)}${voters(votes, power, i, names)}</${tag}>`;
}

// What a scoring kingdom is worth when it falls, and to whom: the raider with
// the most power still fighting at the end. With `leader`, who that is now
// (the most power sent; equal powers in turn order). Nothing for the others.
export function pointsLine(t: TargetView, size = 1.3, leader?: { p: number; names: string[] } | null): string {
  if (!t.points) return '';
  const now = leader ? ` <span class="leads">${playerTag(leader.p, leader.names)} leads</span>` : '';
  return `<div class="loot worth"><span class="loot-label">Worth</span><span class="chip">${t.points}${icon('points', size)}</span><small>to the most power still fighting</small>${now}</div>`;
}

// Who would score a kingdom's points if the fight ended now: the most power
// sent (commits[p] is each player's dragons, power[id] each dragon's), equal
// powers in turn order. Null if no one has sent any.
export function pointsLeader(g: PublicState, commits: string[][]): number | null {
  const power = commits.map((ids) => ids.reduce((s, id) => s + (g.dragons.find((d) => d.id === id)?.power ?? 0), 0));
  const best = Math.max(0, ...power);
  return best ? g.turnOrder.find((p) => power[p] === best) ?? null : null;
}

// Combat power drawn: the number on a shield, for where it has to read from across the room.
export function powerShield(n: number, size = 3): string {
  return `<span class="pshield" style="font-size:${size}em" title="combat power">${icon('shield', 1)}<b>${n}</b></span>`;
}

// Who voted for candidate i, as their tags, each with its vote's power: votes
// are public as they're cast.
export function voters(votes: (number | null)[], power: number[], i: number, names: string[]): string {
  const who = votes.flatMap((v, p) => (v === i ? [voterTag(p, power[p], names)] : []));
  return who.length ? `<div class="voters">${who.join('')}</div>` : '';
}

// A voter and what their vote is worth: "Ada Power 26".
export function voterTag(p: number, power: number, names: string[]): string {
  return `<span class="voter">${playerTag(p, names)}${powerTag(power)}</span>`;
}

// Whether candidate i has the most power voted for it so far (ties all lead:
// a tie is a coin flip). No one leads before anyone votes.
export function leadsVote(votes: (number | null)[], power: number[], i: number, n: number): boolean {
  const counts = Array.from({ length: n }, (_, c) => votes.reduce<number>((s, v, p) => s + (v === c ? power[p] : 0), 0));
  const best = Math.max(...counts);
  return best > 0 && counts[i] === best;
}

// A defender's picture, from its name ("Frost Golem" -> the frost_golem icon).
export function unitIcon(name: string, size = 2): string {
  return icon(name.toLowerCase().replace(/[^a-z]+/g, '_'), size, 'ricon unit-art');
}

// A kingdom's defenders by kind, drawn: each kind's picture and name with how
// many there are, then its stats in words: health, attack, and the elements it
// is weak to (takes double from, by the element wheel). Four
// Archers are one picture marked ×4, not four lines.
export function foeStack(units: UnitView[], size = 2): string {
  const kinds: { u: UnitView; n: number; up: number }[] = [];
  for (const u of units) {
    const k = kinds.find((x) => x.u.name === u.name);
    if (k) { k.n++; if (u.hp > 0) k.up++; } else kinds.push({ u, n: 1, up: u.hp > 0 ? 1 : 0 });
  }
  return `<div class="foes">${kinds.map(({ u, n }) => `
    <div class="foe">
      <span class="foe-pic">${unitIcon(u.name, size)}</span>
      <span class="foe-body"><b class="foe-name">${n > 1 ? `${n} ${esc(plural(u.name))}` : esc(u.name)}</b>
      <span class="foe-stats">${statTag('Health', u.maxHp)}${statTag('Attack', esc(u.attack))}</span>
      ${u.weak.length ? `<span class="foe-elem weak">Weak to ${elemWords(u.weak)}</span>` : ''}</span>
    </div>`).join('')}</div>`;
}

// A kingdom's defenders at a glance: one picture per kind, with how many.
// For choosing among kingdoms, where combat power already sums up the fight.
export function foeIcons(units: UnitView[], size = 2): string {
  const kinds: { name: string; n: number }[] = [];
  for (const u of units) {
    const k = kinds.find((x) => x.name === u.name);
    if (k) k.n++; else kinds.push({ name: u.name, n: 1 });
  }
  return `<div class="foeicons">${kinds.map(({ name, n }) => `<span class="foeicon" title="${esc(n > 1 ? `${n} ${plural(name)}` : name)}">${unitIcon(name, size)}${n > 1 ? `<b>×${n}</b>` : ''}</span>`).join('')}</div>`;
}

// "Frost Golem" -> "Frost Golems"; names already plural ("Archers", "Militia") stay.
function plural(name: string): string {
  return /s$|Militia$/.test(name) ? name : `${name}s`;
}

// What a fight pays, labelled: "Loot 3 timber 2 gold", or the points a great beast is worth.
export function lootLine(loot: Res, size = 1.3, points?: number): string {
  const what = points !== undefined ? `<span class="chip">${points}${icon('points', size)}</span>` : resChips(loot, size) || 'none';
  return `<div class="loot"><span class="loot-label">${points !== undefined ? 'Worth' : 'Loot'}</span>${what}</div>`;
}

