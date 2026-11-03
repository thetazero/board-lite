// Shared by the TV and phone clients: talking to the server, colours, icons
// and the hex map. Plain DOM, no framework; the server strips the types.

import type { DragonView, EventView, HexView, PublicState, Res, Snapshot } from '../src/state.ts';
import { icon, iconShapes } from './icons.ts';

export const RESOURCES = ['stone', 'timber', 'crystal', 'livestock', 'gold'] as const;

export const PLAYER_COLORS = ['#e5484d', '#3e7bfa', '#f2b600', '#30a46c', '#a35bd8', '#f76b15'];
export const TERRAIN_COLORS: Record<string, string> = { mountain: '#8d8f96', forest: '#2f6b3a', ley: '#5d4a9c', meadow: '#8fbf4f', plains: '#d9c68e', harbor: '#4fb0a5', ocean: '#2c5f8f' };
export const TERRAIN_NAMES: Record<string, string> = { mountain: 'Mountain', forest: 'Forest', ley: 'Ley line', meadow: 'Meadow', plains: 'Plains', harbor: 'Harbor (ports)', ocean: 'Ocean' };
export const ELEMENT_COLORS: Record<string, string> = { fire: '#ff5a36', ice: '#8fd8ff', lightning: '#ffd23f', air: '#9fe3c4', water: '#2f8fff' };

// ---------- server ----------

export async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: 'The server sent a bad reply.' }));
  if (!res.ok) throw new Error(String(data.error ?? 'Something went wrong.'));
  return data;
}

// Live snapshots of a room. Reconnects on its own if the connection drops.
export function watch(code: string, token: string | null, onSnapshot: (s: Snapshot) => void, onStatus: (ok: boolean) => void): () => void {
  let es: EventSource | null = null;
  let closed = false;
  const open = () => {
    es = new EventSource(`/api/rooms/${code}/events${token ? `?token=${token}` : ''}`);
    es.onmessage = (e) => {
      onStatus(true);
      onSnapshot(JSON.parse(e.data));
    };
    es.onerror = () => {
      onStatus(false);
      es?.close();
      if (!closed) setTimeout(open, 1500);
    };
  };
  open();
  return () => {
    closed = true;
    es?.close();
  };
}

// ---------- small DOM helpers ----------

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// The engine's log is written for the CLI: players are P1, P2..., dragons and
// cards have ids. The clients show names instead and drop the ids.
export function named(text: string, names: string[], dragons: DragonView[] = []): string {
  return iconText(esc(text))
    .replace(/ \((?:c|o|d)\d+\)/g, '')
    .replace(/\boffer o\d+/g, 'the offer')
    .replace(/^Offer o\d+ expires\./, 'An open offer expires.')
    .replace(/\bd(\d+)\b/g, (m) => {
      const d = dragons.find((x) => x.id === m);
      return d ? `<b style="color:${PLAYER_COLORS[d.owner]}">${esc(d.name)}</b>` : m;
    })
    .replace(/\bP(\d)\b/g, (m, n) => {
      const i = Number(n) - 1;
      return names[i] ? `<b style="color:${PLAYER_COLORS[i]}">${esc(names[i])}</b>` : m;
    });
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
export function iconText(html: string, size = 1.2): string {
  return html
    .replace(RES_WORD, (_, n, r, p) => glue(`<span class="tchip">${n ?? ''}${icon(r, size)}</span>`, p))
    .replace(POINTS_WORD, (m, n, p) => glue(`<span class="tchip">${m.includes('more') ? '+' : ''}${n}${icon('points', size)}</span>`, p));
}

export const BUILDING_ICON: Record<string, string> = {
  tower: '<path d="M-6 8 V-4 H-6 V-7 H-3.5 V-5 H-1.2 V-7 H1.2 V-5 H3.5 V-7 H6 V8 Z"/><rect x="-1.6" y="2" width="3.2" height="6" fill="#0006"/>',
  quarry: '<rect x="-7" y="1" width="6" height="5"/><rect x="0" y="1" width="6" height="5"/><rect x="-3.5" y="-5" width="6" height="5"/>',
  lumber_camp: '<path d="M0 -8 L6 0 H2 L6 5 H-6 L-2 0 H-6 Z"/><rect x="-1.2" y="5" width="2.4" height="3"/>',
  crystal_mine: '<path d="M0 -8 L6 -2 L0 8 L-6 -2 Z"/>',
  pasture: '<rect x="-7" y="-5" width="2" height="12"/><rect x="5" y="-5" width="2" height="12"/><rect x="-7" y="-3" width="14" height="2"/><rect x="-7" y="2" width="14" height="2"/>',
  roost: '<path d="M-8 1 Q0 10 8 1 Z"/><ellipse cx="0" cy="-2" rx="3.5" ry="4.5"/>',
  hatchery: '<ellipse cx="0" cy="0.5" rx="5.5" ry="7.5"/><path d="M-5 0 L-2 -2 L0 1 L2 -2 L5 0" fill="none" stroke="#0007" stroke-width="1.4"/>',
  port: '<circle cx="0" cy="-5.5" r="2.6"/><circle cx="0" cy="-5.5" r="1.1" fill="#0006"/><rect x="-0.9" y="-3.5" width="1.8" height="11"/><rect x="-4" y="-1.5" width="8" height="1.8"/><path d="M-7 2 Q-6 8 0 8 Q6 8 7 2 L5 3.5 Q4 6 0 6 Q-4 6 -5 3.5 Z"/>',
  tower_floor: '<rect x="-6" y="-6" width="12" height="12"/>',
  monument: '<path d="M-2 -8 L2 -8 L3.5 6 H-3.5 Z"/><rect x="-6" y="6" width="12" height="2"/>',
};

// Until a building has its own icon it wears its class's.
const CLASS_ICON: Record<string, string> = { quarry: 'quarry', lumber: 'lumber_camp', mine: 'crystal_mine', pasture: 'pasture', dragon: 'roost', monument: 'monument', trade: 'port' };
export function iconOf(type: string, cls?: string): string {
  return BUILDING_ICON[type] ?? BUILDING_ICON[CLASS_ICON[cls ?? ''] ?? ''] ?? '';
}

export function buildingIcon(type: string, size = 22, color = '#fff', cls?: string): string {
  return `<svg width="${size}" height="${size}" viewBox="-10 -10 20 20" fill="${color}">${iconOf(type, cls)}</svg>`;
}

export const STAGE_LABEL = ['Egg', 'Hatchling', 'Young', 'Adult'];

// What someone gains: each resource with a plus, "+2 stone +1 gold".
export function gainChips(b: Res, size = 1.25): string {
  return RESOURCES.filter((r) => (b[r] ?? 0) > 0).map((r) => `<span class="chip">+${b[r]}${resIcon(r, size)}</span>`).join('');
}

// A building as it sits on the map: its owner's disc with the building's mark,
// and a gold star when it carries an upgrade.
export function buildingChip(type: string, owner: number, upgraded = false, size = 26, cls?: string): string {
  const star = upgraded ? '<g transform="translate(6.5 -6.5)"><circle r="3.6" fill="#f5c542" stroke="#0009" stroke-width=".8"/><path transform="scale(.3)" d="M0 -9 L2.6 -3 L9 -2.8 L4 1.6 L5.6 8 L0 4.4 L-5.6 8 L-4 1.6 L-9 -2.8 L-2.6 -3 Z" fill="#7a4d00"/></g>' : '';
  return `<svg class="bchip" width="${size}" height="${size}" viewBox="-11 -11 22 22"><circle r="9.5" fill="${PLAYER_COLORS[owner]}" stroke="#0009" stroke-width="1.2"/><g transform="scale(.72)" fill="#fff">${iconOf(type, cls)}</g>${star}</svg>`;
}

export const TITLE_ICON: Record<string, string> = { army: 'raid', tower: 'tower', territory: 'territory' };

// What just happened, drawn rather than told: who did it (their name in their
// colour), then the thing itself as the board and the cards show it. Returns ''
// for events the screen already shows elsewhere (a turn starting is the top
// bar, an open offer is the offers panel, the raid's steps are its overlay).
// Old saves without event data fall back to the text.
export function eventHtml(e: EventView, g: PublicState, names: string[]): string {
  const ev = e.ev;
  if (!ev) return named(e.text, names, g.dragons);
  const who = (p: number) => playerTag(p, names);
  const dragon = (id: string, stage?: number, size = 28) => {
    const d = g.dragons.find((x) => x.id === id);
    return d ? dragonBadge(stage === undefined ? d : { ...d, stage }, size) : '';
  };
  const owner = (id: string) => g.dragons.find((x) => x.id === id)?.owner ?? 0;
  const dname = (id: string) => esc(g.dragons.find((x) => x.id === id)?.name ?? '');
  const res = (b: Res) => resChips(b, 1.2);
  switch (ev.k) {
    case 'round': return `<span class="evround">Round ${ev.n}</span>`;
    case 'grow': return `${who(owner(ev.d))} ${dragon(ev.d, ev.stage - 1, 22)}<span class="arrow">➜</span>${dragon(ev.d)} <small>${STAGE_LABEL[ev.stage]}</small>`;
    case 'rest': return `${who(owner(ev.d))} ${dragon(ev.d)} <em class="st-${ev.why}">${ev.why}</em>`;
    case 'build': return `${who(ev.p)} ${buildingChip(ev.b, ev.p, false, 26, g.map.find((h) => h.k === ev.hex)?.building?.cls)} ${esc(ev.name)}`;
    case 'floor': return `${who(ev.p)} ${buildingChip('tower', ev.p)} <span class="floors">${ev.floors}</span>`;
    case 'upgrade': return `${who(ev.p)} ${buildingChip(ev.on, ev.p, true, 26, g.map.find((h) => h.k === ev.hex)?.building?.cls)} ${esc(ev.name)}`;
    case 'hatch': return `${who(ev.p)} ${dragon(ev.d, 0)} ${dname(ev.d)}`;
    case 'play': {
      const what = ev.gain ? gainChips(ev.gain, 1.2) : ev.d ? dragon(ev.d) : ev.raids ? `${icon('raid', 1.2)}×${ev.raids}` : '';
      return `${who(ev.p)} <span class="evcard">${esc(ev.name)}</span> ${what}`;
    }
    case 'bank': return `${who(ev.p)} ${res(ev.give)}<span class="arrow">➜</span>${res(ev.get)}`;
    case 'trade': return `${who(ev.from)} <b>${iconText(esc(ev.give))}</b><span class="arrow">⇄</span><b>${iconText(esc(ev.get))}</b> ${who(ev.to)}`;
    case 'decline': return `${who(ev.p)} <span class="no">✗</span> ${who(ev.from)}`;
    case 'title': return `<span class="title-badge">${icon(TITLE_ICON[ev.t], 1.1)}${esc(g.titles.find((t) => t.key === ev.t)?.name ?? '')}</span><span class="arrow">➜</span>${ev.p === null ? '<span class="none">—</span>' : who(ev.p)}`;
    case 'discard': return `${who(ev.p)} −${ev.n}${icon('cards', 1.2)}`;
    case 'target': return `${icon('raid', 1.3)} <b>${esc(ev.name)}</b>${ev.coin ? ' <small>coin flip</small>' : ''}`;
    case 'bail': return `${who(ev.p)} <span class="no">bails</span>`;
    case 'raidEnd': return ev.won
      ? `${icon('raid', 1.3)} <b>${esc(ev.name)}</b> <span class="ok">falls</span> ${ev.winners.map(who).join(' ')} ${gainChips(ev.share, 1.2)}`
      : `${icon('raid', 1.3)} <b>${esc(ev.name)}</b> <span class="no">holds</span>`;
    case 'noRaid': return `${icon('raid', 1.3)} <span class="none">${ev.why === 'bailed' ? 'everyone bailed' : 'nobody went'}</span>`;
    case 'again': return `${icon('raid', 1.3)} <b>+1</b>`;
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

// A dragon with its stage, growth, health and why it is staying home, if it is.
export function dragonChip(d: DragonView, compact = false): string {
  const status = d.status === 'ready' || d.status === 'egg' ? '' : `<em class="st-${d.status}">${d.status}</em>`;
  if (compact) return `<div class="dchip compact" title="${esc(d.name)}">${dragonBadge(d, 30)}<div><span>${STAGE_LABEL[d.stage]}</span>${d.stage ? hpBar(d.hp, d.maxHp) : ''}${status}</div></div>`;
  const hp = d.stage ? hpBar(d.hp, d.maxHp) : '';
  const grow = d.stage < 3 ? `<span class="grow">${'●'.repeat(d.growth)}${'○'.repeat(Math.max(0, d.growthTime - d.growth))}</span>` : '';
  return `<div class="dchip" title="${esc(d.name)}">${dragonBadge(d, 34)}<div><b>${esc(d.name)}</b><span>${STAGE_LABEL[d.stage]} ${grow}</span>${hp}${status}</div></div>`;
}

// A round's income of one resource the way the table says it: "+2 +3d6",
// "−1 +1d6". Dice of the same size are counted together.
export function incomeText(x: { base: number; dice: number[] }): string {
  const parts = x.base || !x.dice.length ? [x.base < 0 ? `−${-x.base}` : `+${x.base}`] : [];
  for (const s of [...new Set(x.dice)].sort((a, b) => b - a)) parts.push(`+${x.dice.filter((d) => d === s).length}d${s}`);
  return parts.join(' ');
}

export function hpBar(hp: number, max: number): string {
  const pct = max ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0;
  const color = pct > 60 ? '#4cc26e' : pct > 30 ? '#f2b600' : '#e5484d';
  return `<span class="hpbar"><span style="width:${pct}%;background:${color}"></span></span>`;
}

export function dieFace(sides: number, value: number, cls = ''): string {
  return `<span class="die ${cls}" data-sides="${sides}"><b>${value}</b><small>d${sides}</small></span>`;
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
    if (h.terrain === 'harbor' && !b) cells.push(`<g transform="translate(${x} ${y}) scale(${size / 24})" fill="#f4fbff" opacity=".95">${BUILDING_ICON.port}</g>`);
    if (h.terrain === 'ley') cells.push(`<path d="M${x - size * 0.5} ${y + size * 0.35} Q${x} ${y - size * 0.5} ${x + size * 0.5} ${y + size * 0.35}" stroke="#c7b6ff" stroke-width="${size * 0.06}" fill="none" opacity=".6"/>`);
    if (h.terrain === 'mountain') cells.push(`<path d="M${x - size * 0.55} ${y + size * 0.4} L${x - size * 0.15} ${y - size * 0.35} L${x + size * 0.1} ${y} L${x + size * 0.3} ${y - size * 0.2} L${x + size * 0.6} ${y + size * 0.4} Z" fill="#6d7078" opacity=".55"/>`);
    if (h.terrain === 'forest') for (const [dx, dy] of [[-0.35, 0.1], [0.05, -0.2], [0.35, 0.15]]) cells.push(`<path d="M${x + dx * size} ${y + (dy - 0.3) * size} l${size * 0.18} ${size * 0.42} h${-size * 0.36} Z" fill="#1e4a27" opacity=".7"/>`);
    if (h.terrain === 'meadow') for (const [dx, dy] of [[-0.3, 0.2], [0.25, -0.15], [0.2, 0.35]]) cells.push(`<path d="M${x + dx * size} ${y + dy * size} l-3 -6 M${x + dx * size} ${y + dy * size} l0 -7 M${x + dx * size} ${y + dy * size} l3 -6" stroke="#5f8f2c" stroke-width="1.5"/>`);
    if (b) {
      const r = size * 0.55;
      cells.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${owner}" stroke="#0009" stroke-width="2"/>`);
      cells.push(`<g transform="translate(${x} ${y}) scale(${(r * 1.5) / 20})" fill="#fff">${iconOf(b.type, b.cls)}</g>`);
      if (b.upgrade) cells.push(`<g transform="translate(${x + r * 0.85} ${y - r * 0.85})"><circle r="${size * 0.22}" fill="#f5c542" stroke="#0009" stroke-width="1.5"/><path transform="scale(${size / 90})" d="M0 -9 L2.6 -3 L9 -2.8 L4 1.6 L5.6 8 L0 4.4 L-5.6 8 L-4 1.6 L-9 -2.8 L-2.6 -3 Z" fill="#7a4d00"/></g>`);
      if (b.type === 'tower' && b.floors > 0) cells.push(`<g transform="translate(${x - r * 0.9} ${y - r * 0.85})"><circle r="${size * 0.24}" fill="#fff" stroke="#0009" stroke-width="1.5"/><text text-anchor="middle" dy="0.35em" font-size="${size * 0.32}" font-weight="800" fill="#111">${b.floors}</text></g>`);
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
      ${secret > 0 ? `<small class="hiddenpts" title="secret points">${icon('cards', 1.1)}+${secret}</small>` : '<span></span>'}
      <b class="total">${s.total}${icon('points', 1.25)}</b></li>`;
  }).join('');
  return `<ol class="standings">${rows}</ol>`;
}

// How the winner won a tie, if they did.
export function tiebreakNote(g: PublicState): string {
  const w = g.standings![0];
  return w.tiebreak === 'gold' ? `Won the tie with the most ${resIcon('gold', 1.1)}` : w.tiebreak === 'turn order' ? 'Won the tie by going first this round' : '';
}
