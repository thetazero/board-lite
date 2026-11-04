// Shared by the TV and phone clients: talking to the server, colours, icons
// and the hex map. Plain DOM, no framework; the server strips the types.

import type { DragonView, EventView, HexView, PublicState, Res, Snapshot, UnitView } from '../src/state.ts';
import { buildingShapes, icon, iconShapes } from './icons.ts';
import { glyph } from './art.ts';

// The colour each great beast marks the hexes it holds with (the TV's board uses the same).
export const HOLD_COLORS: Record<string, string> = { thunderbird: '#5b4bb7', leviathan: '#1f7f9b' };

export const RESOURCES = ['stone', 'timber', 'crystal', 'livestock', 'gold'] as const;

// The lobby and the join form show the goal before there's a game to read it from.
// It must match TUNING.pointsToWin in src/data.ts; test/server.test.ts checks it does.
export const POINTS_TO_WIN = 20;

export const PLAYER_COLORS = ['#e5484d', '#3e7bfa', '#f2b600', '#30a46c', '#a35bd8', '#f76b15'];
export const TERRAIN_COLORS: Record<string, string> = { mountain: '#8d8f96', forest: '#2f6b3a', ley: '#5d4a9c', meadow: '#8fbf4f', plains: '#d9c68e', harbor: '#4fb0a5', ocean: '#2c5f8f' };
export const TERRAIN_NAMES: Record<string, string> = { mountain: 'Mountain', forest: 'Forest', ley: 'Crystal field', meadow: 'Meadow', plains: 'Plains', harbor: 'Harbor (ports)', ocean: 'Ocean' };
export const ELEMENT_COLORS: Record<string, string> = { fire: '#ff5a36', ice: '#8fd8ff', lightning: '#ffd23f', air: '#9fe3c4', water: '#2f8fff' };

// ---------- server ----------

export async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: 'The server sent a bad reply.' }));
  if (!res.ok) throw new Error(String(data.error ?? 'Something went wrong.'));
  return data;
}

// Live snapshots of a room. Reconnects on its own if the connection drops, and
// at once when the page comes back into view or the network comes back: a
// phone that slept or lost Wi-Fi can hold a stream that looks open but is dead.
// While the server is down it keeps trying (a restart brings the room back
// under the same code); `onGone` is called if the server is up and the room
// isn't there any more, and it stops trying.
export function watch(code: string, token: string | null, onSnapshot: (s: Snapshot) => void, onStatus: (ok: boolean) => void, onGone?: () => void): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    clearTimeout(retry);
    es?.close();
    es = new EventSource(`/api/rooms/${code}/events${token ? `?token=${token}` : ''}`);
    es.onmessage = (e) => {
      onStatus(true);
      onSnapshot(JSON.parse(e.data));
    };
    es.onerror = async () => {
      onStatus(false);
      es?.close();
      if (closed) return;
      const status = await fetch(`/api/rooms/${code}`).then((r) => r.status, () => 0);
      if (closed) return;
      if (status === 400 && onGone) {
        stop();
        return onGone();
      }
      retry = setTimeout(open, 1500);
    };
  };
  let hiddenAt = 0;
  const seen = () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (!closed && Date.now() - hiddenAt > 3000) open();
  };
  const online = () => !closed && open();
  document.addEventListener('visibilitychange', seen);
  addEventListener('online', online);
  open();
  return stop;
  function stop() {
    closed = true;
    clearTimeout(retry);
    es?.close();
    document.removeEventListener('visibilitychange', seen);
    removeEventListener('online', online);
  }
}

// ---------- small DOM helpers ----------

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// The engine's log is written for the CLI: players are P1, P2..., dragons and
// cards have ids. The clients show names instead and drop the ids.
export function named(text: string, names: string[], dragons: DragonView[] = []): string {
  let html = iconText(esc(text));
  // "Fire Dragon (d7)" -> that dragon's own label, "Fire Dragon II" when its owner has two.
  for (const d of dragons) html = html.split(`${esc(d.name)} (${d.id})`).join(esc(dragonLabel(d, dragons)));
  return html
    .replace(/ \((?:c|o|d)\d+\)/g, '')
    .replace(/\boffer o\d+/g, 'the offer')
    .replace(/^Offer o\d+ expires\./, 'An open offer expires.')
    .replace(/\bd(\d+)\b/g, (m) => {
      const d = dragons.find((x) => x.id === m);
      return d ? `<b style="color:${PLAYER_COLORS[d.owner]}">${esc(dragonLabel(d, dragons))}</b>` : m;
    })
    .replace(/\bP(\d)\b/g, (m, n) => {
      const i = Number(n) - 1;
      return names[i] ? `<b style="color:${PLAYER_COLORS[i]}">${esc(names[i])}</b>` : m;
    });
}

// A dragon's name, numbered when its owner has more than one of the same kind
// ("Fire Dragon", "Fire Dragon II"), oldest first, so the table can tell them apart.
export function dragonLabel(d: DragonView, all: DragonView[]): string {
  const same = all.filter((x) => x.owner === d.owner && x.name === d.name).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const k = same.findIndex((x) => x.id === d.id);
  return k > 0 ? `${d.name} ${['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][k] ?? k + 1}` : d.name;
}

export function playerTag(i: number, names: string[]): string {
  return `<span class="ptag" style="--pc:${PLAYER_COLORS[i]}">${esc(names[i] ?? `P${i + 1}`)}</span>`;
}

// ---------- icons ----------

export { icon } from './icons.ts';

export function resIcon(r: string, size = 1.25): string {
  return icon(r, size);
}

export function elemIcon(e: string, size = 1.25): string {
  return icon(e, size);
}

// "2 stone, 1 gold" as icons. A free thing shows no cost at all.
export function resChips(b: Res, size = 1.25): string {
  return RESOURCES.filter((r) => (b[r] ?? 0) > 0).map((r) => `<span class="chip">${b[r]}${resIcon(r, size)}</span>`).join('');
}

// Game text (the log, card rules, offers) with the things it names over and
// over drawn as icons: "gains 3 livestock" reads "gains 3" and a sheep. Takes
// text that is already escaped HTML.
const RES_WORD = /\b(?:(\d+) )?(stone|timber|crystal|livestock|gold)\b([.,;:!?)]?)/g;
const POINTS_WORD = /\b(\d+) (?:more )?points?\b([.,;:!?)]?)/g;
// Punctuation right after an icon stays on its line, not wrapped alone onto the next.
const glue = (chip: string, punct: string) => (punct ? `<span class="nobr">${chip}${punct}</span>` : chip);
// Dice to roll, "2d6", read as a count and the die: "2" and a white square.
const DICE_WORD = /\b(\d+)d(4|6|8)\b/g;
export function diceChip(n: number | string, sides: number, size = 1.2): string {
  return `<span class="tchip dicechip">${n}${icon(`d${sides}`, size)}</span>`;
}
export function iconText(html: string, size = 1.2): string {
  return html
    .replace(DICE_WORD, (_, n, s) => diceChip(n, Number(s), size))
    .replace(RES_WORD, (_, n, r, p) => glue(`<span class="tchip">${n ?? ''}${icon(r, size)}</span>`, p))
    .replace(POINTS_WORD, (m, n, p) => glue(`<span class="tchip">${m.includes('more') ? '+' : ''}${n}${icon('points', size)}</span>`, p));
}

// An empty harbour hex's mark on the flat map: an anchor, where a port could go.
const HARBOR_MARK = '<circle cx="0" cy="-5.5" r="2.6"/><circle cx="0" cy="-5.5" r="1.1" fill="#0006"/><rect x="-0.9" y="-3.5" width="1.8" height="11"/><rect x="-4" y="-1.5" width="8" height="1.8"/><path d="M-7 2 Q-6 8 0 8 Q6 8 7 2 L5 3.5 Q4 6 0 6 Q-4 6 -5 3.5 Z"/>';

// Every building is drawn in folded paper (icons.ts), in its own colours;
// `owner` colours the tower's roof. A building with no drawing (none should be
// left) wears its class's basic building's. `color` is kept for callers that
// pass one; the drawings don't use it.
const CLASS_ICON: Record<string, string> = { quarry: 'quarry', lumber: 'lumber_camp', mine: 'crystal_mine', pasture: 'pasture', dragon: 'roost', monument: 'monument', trade: 'port' };
export function iconOf(type: string, cls?: string, owner?: number): string {
  const pc = owner === undefined ? undefined : PLAYER_COLORS[owner];
  return buildingShapes(type, pc) || buildingShapes(CLASS_ICON[cls ?? ''] ?? '', pc);
}

export function buildingIcon(type: string, size = 22, color = '#fff', cls?: string, owner?: number): string {
  return `<svg class="bicon" width="${size}" height="${size}" viewBox="-10 -10 20 20" fill="${color}">${iconOf(type, cls, owner)}</svg>`;
}

// A building's mark on its owner's disc: the folded-paper drawing on a paper
// disc ringed in the owner's colour. Drawn round 0,0 with radius r.
function ownedMark(type: string, owner: number, r: number, cls?: string): string {
  const pc = PLAYER_COLORS[owner];
  return `<circle r="${r}" fill="${pc}" stroke="#0009" stroke-width="${r * 0.1}"/><circle r="${r * 0.84}" fill="#f6efdf"/>`
    + `<g transform="scale(${(r * 0.8) / 10})">${iconOf(type, cls, owner)}</g>`;
}

// An upgrade's badge: its icon (the mark it puts by its building on the TV
// board) on a gold-ringed paper disc, drawn round 0,0 with radius r.
export function upgradeBadge(key: string, r: number): string {
  return `<circle r="${r}" fill="#c79314" stroke="#0009" stroke-width="${r * 0.1}"/><circle r="${r * 0.78}" fill="#fff6dc"/><g transform="scale(${(r * 0.66) / 10})">${iconShapes(key)}</g>`;
}

export const STAGE_LABEL = ['Egg', 'Hatchling', 'Young', 'Adult'];

// What someone gains: each resource with a plus, "+2 stone +1 gold".
export function gainChips(b: Res, size = 1.25): string {
  return RESOURCES.filter((r) => (b[r] ?? 0) > 0).map((r) => `<span class="chip">+${b[r]}${resIcon(r, size)}</span>`).join('');
}

// A building as it sits on the map: its owner's disc with the building's mark,
// and the upgrade's badge when it carries one.
export function buildingChip(type: string, owner: number, upgrade: string | null = null, size = 26, cls?: string): string {
  const badge = upgrade ? `<g transform="translate(6.5 -6.5)">${upgradeBadge(upgrade, 4.4)}</g>` : '';
  return `<svg class="bchip" width="${size}" height="${size}" viewBox="-11 -11 22 22">${ownedMark(type, owner, 9.5, cls)}${badge}</svg>`;
}

export const TITLE_ICON: Record<string, string> = { army: 'raid', tower: 'tower', hoard: 'hoard' };

// What just happened, as a short line the table can read from the couch: who
// did it (their name in their colour), the log's own verb, and the thing
// itself as the board and the cards show it. Returns '' for events the screen
// already shows elsewhere: a turn starting is the player panels, an open offer
// is the offers panel, the raid's steps are its overlay, a dragon sitting out
// is its tag on its owner's panel, and a beast wandering is the board (the
// feed has no hexes to name; one moving onto a building is said).
// Old saves without event data fall back to the text.
export function eventHtml(e: EventView, g: PublicState, names: string[]): string {
  const ev = e.ev;
  if (!ev) return named(e.text, names, g.dragons);
  const who = (p: number) => playerTag(p, names);
  const whose = (p: number) => `<span class="ptag" style="--pc:${PLAYER_COLORS[p]}">${esc(names[p] ?? `P${p + 1}`)}'s</span>`;
  const dragon = (id: string, stage?: number, size = 28) => {
    const d = g.dragons.find((x) => x.id === id);
    return d ? dragonBadge(stage === undefined ? d : { ...d, stage }, size) : '';
  };
  const dname = (id: string) => { const d = g.dragons.find((x) => x.id === id); return d ? `<b>${esc(dragonLabel(d, g.dragons))}</b>` : ''; };
  const res = (b: Res) => resChips(b, 1.2);
  const a = (name: string) => (/^[AEIOU]/i.test(name) ? 'an' : 'a');
  const beast = (fauna: string, name: string) => `the ${icon(fauna, 1.5)} <b>${esc(name)}</b>`;
  switch (ev.k) {
    case 'round': return `<span class="evround">Round ${ev.n}</span>`;
    case 'grow': {
      const d = g.dragons.find((x) => x.id === ev.d);
      return d ? `${whose(d.owner)} ${dragon(ev.d)} ${dname(ev.d)} grows into ${['an egg', 'a hatchling', 'a young dragon', 'an adult'][ev.stage]}` : '';
    }
    case 'build': return `${who(ev.p)} builds ${a(ev.name)} ${buildingChip(ev.b, ev.p, null, 26, g.map.find((h) => h.k === ev.hex)?.building?.cls)} ${esc(ev.name)}`;
    case 'floor': return `${who(ev.p)} adds a tower floor ${buildingChip('tower', ev.p)} <span class="floors">${ev.floors}</span>`;
    case 'upgrade': return `${who(ev.p)} adds ${buildingChip(ev.on, ev.p, ev.u, 26, g.map.find((h) => h.k === ev.hex)?.building?.cls)} ${esc(ev.name)}`;
    case 'hatch': return `${who(ev.p)} hatches ${dragon(ev.d, 0)} ${dname(ev.d)}`;
    case 'play': {
      const on = ev.hex ? g.map.find((h) => h.k === ev.hex)?.building : null;
      const what = ev.gain ? gainChips(ev.gain, 1.2) : ev.d ? dragon(ev.d) : ev.raids ? `${icon('raid', 1.2)}×${ev.raids}` : ev.fauna ? `${icon(ev.fauna, 1.5)}${on ? `<span class="arrow">➜</span>${buildingChip(on.type, on.owner, null, 26, on.cls)}` : ''}` : '';
      return `${who(ev.p)} plays <span class="evcard">${esc(ev.name)}</span> ${what}`;
    }
    case 'bank': return `${who(ev.p)} trades ${res(ev.give)} to the bank for ${res(ev.get)}`;
    case 'trade': return `${who(ev.from)} gives <b>${iconText(esc(ev.give))}</b> to ${who(ev.to)} for <b>${iconText(esc(ev.get))}</b>`;
    case 'decline': return `${who(ev.p)} <span class="no">declines</span> ${whose(ev.from)} offer`;
    case 'title': {
      const t = `<span class="title-badge">${icon(TITLE_ICON[ev.t], 1.1)}</span><b>${esc(g.titles.find((x) => x.key === ev.t)?.name ?? '')}</b>`;
      return ev.p === null ? `No one holds ${t}` : `${who(ev.p)} takes ${t}`;
    }
    case 'discard': return `${who(ev.p)} discards ${ev.n} ${icon('cards', 1.2)}`;
    case 'target': return `${icon('raid', 1.3)} The vote picks <b>${esc(ev.name)}</b>${ev.coin ? ' <small>(coin flip)</small>' : ''}`;
    case 'bail': return `${who(ev.p)} <span class="no">bails</span>`;
    case 'raidEnd': return ev.won
      ? `${icon('raid', 1.3)} <b>${esc(ev.name)}</b> <span class="ok">falls</span>: ${ev.winners.map((p, i) => `${who(p)} ${gainChips(ev.shares[i], 1.2)}`).join(', ')}`
      : `${icon('raid', 1.3)} <b>${esc(ev.name)}</b> <span class="no">holds</span>`;
    case 'noRaid': return ev.why === 'unable' ? '' : `${icon('raid', 1.3)} ${ev.why === 'bailed' ? 'Everyone bails' : 'No one raids'}`;
    case 'again': return `${icon('raid', 1.3)} Another raid follows`;
    // The beast is the subject ("The Wolf Pack falls"), as on the fight's banner.
    case 'cleared': {
      const it = beast(ev.fauna, ev.name);
      const The = it.replace(/^the/, 'The');
      if (!ev.won) return `${The} <span class="no">holds</span> against ${who(ev.p)}`;
      return ev.points ? `${The} <span class="ok">is slain</span>: ${who(ev.p)} +${ev.points} ${icon('points', 1.2)}` : `${The} <span class="ok">falls</span>: ${who(ev.p)} ${gainChips(ev.gain, 1.2)}`;
    }
    case 'wander': {
      const b = g.map.find((h) => h.k === ev.to && h.fauna?.key === ev.fauna)?.building;
      return b && b.type !== 'tower' ? `${beast(ev.fauna, ev.name).replace(/^the/, 'The')} moves onto ${whose(b.owner)} ${buildingChip(b.type, b.owner, b.upgrade, 26, b.cls)} ${esc(b.name)}` : '';
    }
    default: return '';
  }
}

// A dragon as a small badge: element colour, a size by life stage, and its
// element's icon in the corner so it reads by shape as well as colour.
export function dragonBadge(d: DragonView, size = 30): string {
  const c = ELEMENT_COLORS[d.element];
  const s = [0.55, 0.7, 0.85, 1][d.stage];
  const mark = `<g transform="translate(6 6) scale(0.4)">${iconShapes(d.element)}</g>`;
  if (d.stage === 0) {
    return `<svg width="${size}" height="${size}" viewBox="-10 -10 20 20"><ellipse cx="0" cy="1" rx="${5 * s + 2}" ry="${7 * s + 2}" fill="${c}" stroke="#0008" stroke-width="1"/><path d="M-3 -1 l2 2 l2 -3 l2 2" stroke="#0007" fill="none"/>${mark}</svg>`;
  }
  // A simple dragon head-and-wings mark, scaled by stage.
  return `<svg width="${size}" height="${size}" viewBox="-10 -10 20 20"><g transform="scale(${s})" fill="${c}" stroke="#0009" stroke-width="0.8">
    <path d="M-9 -2 L-3 -7 L-2 0 Z"/><path d="M9 -2 L3 -7 L2 0 Z"/>
    <path d="M0 -6 C4 -6 5 -1 4 3 L2 8 L0 6 L-2 8 L-4 3 C-5 -1 -4 -6 0 -6 Z"/>
    <circle cx="-1.8" cy="-1.5" r="0.9" fill="#111" stroke="none"/><circle cx="1.8" cy="-1.5" r="0.9" fill="#111" stroke="none"/></g>${mark}</svg>`;
}

// A dragon with its stage, growth, combat power, and its health or why it is
// staying home. `all` numbers same-named dragons.
export function dragonChip(d: DragonView, all: DragonView[], round: number): string {
  const state = dragonState(d, round);
  const grow = d.stage < 3 ? `<span class="grow">${'●'.repeat(d.growth)}${'○'.repeat(Math.max(0, d.growthTime - d.growth))}</span>` : '';
  const name = dragonLabel(d, all);
  return `<div class="dchip" title="${esc(name)}">${dragonBadge(d, 34)}<div><b>${esc(name)}</b><span>${STAGE_LABEL[d.stage]} ${grow}${d.stage ? ` ${powerTag(d.power)}` : ''}</span>${state}</div></div>`;
}

// A round's income of one resource the way the table says it: "+2 +3d6",
// "−1 +1d6". Dice of the same size are counted together.
export function incomeText(x: { base: number; dice: number[] }): string {
  const parts = x.base || !x.dice.length ? [x.base < 0 ? `−${-x.base}` : `+${x.base}`] : [];
  for (const s of [...new Set(x.dice)].sort((a, b) => b - a)) parts.push(`+${x.dice.filter((d) => d === s).length}d${s}`);
  return parts.join(' ');
}

// Combat power: one rough number per dragon or kingdom; a side's add up.
export function powerTag(n: number, cls = ''): string {
  return `<span class="stat power ${cls}" title="combat power">${glyph('power', 'combat power')}${n}</span>`;
}

// Why a dragon sits out, or its health. A healing one says how many rounds
// until it's healed, in words: a bare "Healing 3" leaves "3 what?" (#161).
export function dragonState(d: DragonView, round: number): string {
  if (d.resting === 'hungry') return '<em class="st-hungry">Hungry</em>';
  if (d.resting === 'hunted') return `<em class="st-hunted">Fought</em>${hpBar(d.hp, d.maxHp)}`;
  if (d.backIn !== null && !d.canRaid) return `<em class="st-healing" title="Can raid again from round ${d.backIn}">${healingText(d.backIn - round)}</em>`;
  return d.stage ? hpBar(d.hp, d.maxHp) : '';
}

// "Healed in 3 rounds", counting this round's raids: 1 means it can raid next
// round. It says "healed", not "raids": a healed dragon raids only if sent.
export function healingText(n: number): string {
  return `Healed in ${n} round${n === 1 ? '' : 's'}`;
}

export function hpBar(hp: number, max: number): string {
  const pct = max ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0;
  const color = pct > 60 ? '#4cc26e' : pct > 30 ? '#f2b600' : '#e5484d';
  return `<span class="hpbar"><span style="width:${pct}%;background:${color}"></span></span>`;
}

// ---------- the raid's defenders ----------

// A defender's picture, from its name ("Frost Golem" -> the frost_golem icon).
export function unitIcon(name: string, size = 2): string {
  return icon(name.toLowerCase().replace(/[^a-z]+/g, '_'), size, 'ricon unit-art');
}

// A kingdom's defenders by kind, drawn: each kind's picture with how many
// there are, its health and attack, and the elements it takes double (×2)
// or half (½) from. Four Archers are one picture marked ×4, not four lines.
export function foeStack(units: UnitView[], size = 2): string {
  const kinds: { u: UnitView; n: number; up: number }[] = [];
  for (const u of units) {
    const k = kinds.find((x) => x.u.name === u.name);
    if (k) { k.n++; if (u.hp > 0) k.up++; } else kinds.push({ u, n: 1, up: u.hp > 0 ? 1 : 0 });
  }
  return `<div class="foes">${kinds.map(({ u, n }) => `
    <div class="foe">
      <span class="foe-pic">${unitIcon(u.name, size)}${n > 1 ? `<b class="foe-n">×${n}</b>` : ''}</span>
      <span class="foe-stats"><span class="stat">${glyph('health', 'health')}${u.maxHp}</span><span class="stat">${glyph('attack', 'attack')}${iconText(esc(u.attack))}</span></span>
      <span class="foe-elems">${u.weak.length ? `<span class="weak">×2${u.weak.map((e) => elemIcon(e, 1.15)).join('')}</span>` : ''}${u.strong.length ? `<span class="strong">½${u.strong.map((e) => elemIcon(e, 1.15)).join('')}</span>` : ''}</span>
    </div>`).join('')}</div>`;
}

// A rolled die: the same white shape as a die to roll, with what it landed on.
export function dieFace(sides: number, value: number, cls = ''): string {
  return `<span class="die ${cls}" data-sides="${sides}">${icon(`d${sides}face`, 2.4, 'dieicon')}<b>${value}</b></span>`;
}

// ---------- hex map ----------

const SQ3 = Math.sqrt(3);

export function hexCenter(q: number, r: number, size: number): [number, number] {
  return [size * SQ3 * (q + r / 2), size * 1.5 * r];
}

function hexPoints(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + size * Math.cos(a)).toFixed(1)},${(cy + size * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

export interface MapOptions {
  size?: number;
  selectable?: string[]; // hex keys the viewer can tap
  highlight?: number | null; // a player whose buildings are emphasised
  coords?: boolean;
  labels?: Record<string, string>; // short text shown on hexes, like a count
}

// The map as an SVG string. Selectable hexes carry data-hex for click handlers.
export function mapSvg(map: HexView[], opts: MapOptions = {}): string {
  const size = opts.size ?? 40;
  const sel = new Set(opts.selectable ?? []);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const h of map) {
    const [x, y] = hexCenter(h.q, h.r, size);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = size * 1.1;
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  const cells: string[] = [];
  for (const h of map) {
    const [x, y] = hexCenter(h.q, h.r, size);
    const b = h.building;
    const dim = sel.size && !sel.has(h.k);
    const owner = b ? PLAYER_COLORS[b.owner] : null;
    cells.push(`<g class="hex${sel.has(h.k) ? ' selectable' : ''}" ${sel.has(h.k) ? `data-hex="${h.k}"` : ''} opacity="${dim ? 0.45 : 1}">`);
    const sea = h.terrain === 'ocean';
    cells.push(`<polygon points="${hexPoints(x, y, size * (sea ? 1.01 : 0.97))}" fill="${TERRAIN_COLORS[h.terrain]}" stroke="${owner ?? (sea ? TERRAIN_COLORS.ocean : '#1b1d24')}" stroke-width="${owner ? size * 0.12 : size * 0.04}"/>`);
    if (sea) for (const dy of [-0.2, 0.25]) cells.push(`<path d="M${x - size * 0.45} ${y + dy * size} q${size * 0.15} ${-size * 0.15} ${size * 0.3} 0 t${size * 0.3} 0 t${size * 0.3} 0" stroke="#8fb8de" stroke-width="${size * 0.05}" fill="none" opacity=".6"/>`);
    if (h.terrain === 'harbor' && !b) cells.push(`<g transform="translate(${x} ${y}) scale(${size / 24})" fill="#f4fbff" opacity=".95">${HARBOR_MARK}</g>`);
    if (h.terrain === 'ley') cells.push(`<path d="M${x - size * 0.5} ${y + size * 0.35} Q${x} ${y - size * 0.5} ${x + size * 0.5} ${y + size * 0.35}" stroke="#c7b6ff" stroke-width="${size * 0.06}" fill="none" opacity=".6"/>`);
    if (h.terrain === 'mountain') cells.push(`<path d="M${x - size * 0.55} ${y + size * 0.4} L${x - size * 0.15} ${y - size * 0.35} L${x + size * 0.1} ${y} L${x + size * 0.3} ${y - size * 0.2} L${x + size * 0.6} ${y + size * 0.4} Z" fill="#6d7078" opacity=".55"/>`);
    if (h.terrain === 'forest') for (const [dx, dy] of [[-0.35, 0.1], [0.05, -0.2], [0.35, 0.15]]) cells.push(`<path d="M${x + dx * size} ${y + (dy - 0.3) * size} l${size * 0.18} ${size * 0.42} h${-size * 0.36} Z" fill="#1e4a27" opacity=".7"/>`);
    if (h.terrain === 'meadow') for (const [dx, dy] of [[-0.3, 0.2], [0.25, -0.15], [0.2, 0.35]]) cells.push(`<path d="M${x + dx * size} ${y + dy * size} l-3 -6 M${x + dx * size} ${y + dy * size} l0 -7 M${x + dx * size} ${y + dy * size} l3 -6" stroke="#5f8f2c" stroke-width="1.5"/>`);
    if (b) {
      const r = size * 0.62;
      // Shut down by a beast on it: the building's mark goes grey (the hex's rim keeps its owner).
      cells.push(`<g transform="translate(${x} ${y})"${h.fauna ? ' style="filter:grayscale(1) brightness(.75)"' : ''}>${ownedMark(b.type, b.owner, r, b.cls)}</g>`);
      if (b.upgrade) cells.push(`<g transform="translate(${x + r * 0.85} ${y - r * 0.85})">${upgradeBadge(b.upgrade, size * 0.3)}</g>`);
      if (b.type === 'tower' && b.floors > 0) cells.push(`<g transform="translate(${x - r * 0.9} ${y - r * 0.85})"><circle r="${size * 0.24}" fill="#fff" stroke="#0009" stroke-width="1.5"/><text text-anchor="middle" dy="0.35em" font-size="${size * 0.32}" font-weight="800" fill="#111">${b.floors}</text></g>`);
    }
    // A great beast's hold on the hexes round it, and the freed peak's richer ground.
    const ring = h.held ? HOLD_COLORS[h.held] : h.peakZone ? '#e7b43f' : '';
    if (ring) cells.push(`<polygon points="${hexPoints(x, y, size * 0.82)}" fill="none" stroke="${ring}" stroke-width="${size * 0.1}" stroke-dasharray="${size * 0.3} ${size * 0.14}" opacity=".9"/>`);
    // A beast holding the hex, on its dark lair: in its middle, or in front of the building it shuts down.
    if (h.fauna) {
      const great = h.fauna.points !== undefined;
      const [fx, fy, fs] = b ? [x + size * 0.12, y + size * 0.3, size * 0.042] : [x, y, size * (great ? 0.065 : 0.05)];
      cells.push(`<g class="fauna" transform="translate(${fx} ${fy})"><circle r="${fs * 11}" fill="#2b2420" stroke="#efe5cf" stroke-width="${fs * 1.2}" opacity=".9"/><g transform="scale(${fs})">${iconShapes(h.fauna.key)}</g></g>`);
    }
    if (sel.has(h.k)) cells.push(`<polygon points="${hexPoints(x, y, size * 0.8)}" fill="none" stroke="#fff" stroke-width="${size * 0.08}" stroke-dasharray="${size * 0.2} ${size * 0.12}" class="pulse"/>`);
    const label = opts.labels?.[h.k];
    if (label) cells.push(`<g transform="translate(${x} ${y})"><circle r="${size * 0.36}" fill="#fff" stroke="#0009" stroke-width="2"/><text text-anchor="middle" dy="0.35em" font-size="${size * 0.42}" font-weight="800" fill="#111">${label}</text></g>`);
    if (opts.coords) cells.push(`<text x="${x}" y="${y + size * 0.82}" text-anchor="middle" font-size="${size * 0.22}" fill="#0009">${h.k}</text>`);
    cells.push('</g>');
  }
  return `<svg class="map" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${cells.join('')}</svg>`;
}

// ---------- the final standings ----------

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

// The final order as a list: place, name, points, and a mark on everyone level
// on points with someone. Points that were secret (cards in hand) show as such.
export function standingsHtml(g: PublicState, names: string[], me = -1): string {
  const rows = g.standings!.map((s) => {
    const secret = s.total - g.players[s.p].publicPoints;
    return `<li class="${s.place === 1 ? 'won' : ''}${s.p === me ? ' you' : ''}">
      <span class="place">${ORDINAL[s.place - 1]}</span>
      <span class="who">${playerTag(s.p, names)}${s.tied ? ' <span class="tie">tie</span>' : ''}</span>
      ${secret > 0 ? `<small class="hiddenpts" title="Secret Hoard cards in hand, counted in the total">${secret}${icon('points', 0.9)} in hand</small>` : '<span></span>'}
      <b class="total">${s.total}${icon('points', 1.25)}</b></li>`;
  }).join('');
  return `<ol class="standings">${rows}</ol>`;
}

// How the winner won a tie, if they did.
export function tiebreakNote(g: PublicState): string {
  const w = g.standings![0];
  return w.tiebreak === 'gold' ? `Wins the tie with the most ${resIcon('gold', 1.1)}` : w.tiebreak === 'turn order' ? 'Wins the tie by being earliest in turn order' : '';
}
