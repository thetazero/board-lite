// What a building does, or an upgrade changes, at a glance: the phone's
// preview of a hex before a building, an upgrade or a beast goes on it.

import type { BuildingDoes } from '../src/state.ts';
import { RESOURCES } from './common.ts';

export type Does = BuildingDoes;
// "2 + 1d4 stone": a fixed amount and dice, as the cards write them.
function amountText(r: string, m: { base: number; dice: number[] }): string {
  const parts = m.base ? [String(m.base)] : [];
  for (const s of [...new Set(m.dice)].sort((a, b) => b - a)) parts.push(`${m.dice.filter((d) => d === s).length}d${s}`);
  return `${parts.join(' + ')} ${r}`;
}
// What a building does, at a glance: numbers and icons, no
// sentence ("2 + 1d4 [stone]", "1 [point]", "Houses 2 dragons"). `peak` marks
// how much of what it makes comes from the freed peak.
export function doesParts(d: Does, peak = 0): string[] {
  const out = RESOURCES.filter((r) => d.makes[r]).map((r) => amountText(r, d.makes[r]!) + (peak ? ` (${peak} from the peak)` : ''));
  if (d.houses) out.push(`Houses ${d.houses} dragon${d.houses > 1 ? 's' : ''}`);
  if (d.points) out.push(`${d.points} point${d.points > 1 ? 's' : ''}`);
  if (d.growth) out.push(`Dragons grow ${d.growth} extra step${d.growth > 1 ? 's' : ''}`);
  if (d.rate) out.push(`Trade ${d.rate.resource} at ${d.rate.rate}:1`);
  return out;
}
// What an upgrade changes on a building, one short item per number, before →
// after, with the icon for what it counts: "5 → 7 stone", "1 → 2 points",
// "Houses 1 → 3 dragons". Only what changes; the card under the map says why.
export function changeParts(a: Does, b: Does): string[] {
  const out: string[] = [];
  const none = { base: 0, dice: [] as number[] };
  const amount = (r: string, m?: { base: number; dice: number[] }) => amountText(r, m ?? none).replace(` ${r}`, '') || '0';
  for (const r of RESOURCES) {
    const [x, y] = [amount(r, a.makes[r]), amount(r, b.makes[r])];
    if (x !== y) out.push(`${x} → ${y} ${r}`);
  }
  if (a.houses !== b.houses) out.push(`Houses ${a.houses} → ${b.houses} dragon${b.houses === 1 ? '' : 's'}`);
  if (a.points !== b.points) out.push(`${a.points} → ${b.points} point${b.points === 1 ? '' : 's'}`);
  return out;
}

// Before a hex is tapped: what tapping one shows.
export function tapHint(placing: 'building' | 'upgrade' | 'beast', name: string): string {
  if (placing === 'upgrade') return `Tap a building to see what the ${name} changes.`;
  return placing === 'beast' ? "Tap a hex to see what's built there." : `Tap a hex to see what the ${name} does there.`;
}
