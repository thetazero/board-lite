// The rulebook on each phone: what every piece on the TV is and does, so the
// board needs no labels (#275). Opened from the header on every screen of the
// game, it lies over the screen and closes back to it.
//
// Each building, beast and dragon is drawn by the TV's own 3D models
// (board3d.ts, portraits): the same hex, paper and light, so a piece looks the
// same in the book as on the board. three.js loads only when the book first
// opens; until the pictures are drawn the entries show without them. The
// kingdoms are drawn as the TV draws them, with their defenders' pictures, and
// action cards (never on the board) as they are in the hand.

import type { BookBuilding, FaunaView, Rulebook } from '../src/state.ts';
import type { Portrait } from './board3d.ts';
import { ELEMENT_COLORS, STAGE_LABEL, elemIcon, elemWords, esc, iconText, powerTag, resChips, statTag } from './common.ts';
import { foeStack, lootLine, pointsLine } from './kingdom.ts';
import { cardArt, frameColor } from './art.ts';

export const BOOK_TABS = { board: 'Board', buildings: 'Buildings', beasts: 'Beasts', dragons: 'Dragons', elements: 'Elements', kingdoms: 'Kingdoms', cards: 'Cards' } as const;
export type BookTab = keyof typeof BOOK_TABS;

let book: Rulebook | null = null;
let failed = false;
let loading: Promise<void> | null = null;
let picsFor = -1; // the seat the pictures were drawn for (their buildings are in its color)
const pics = new Map<string, string>();

const TERRAIN_NOUN: Record<string, string> = { mountain: 'mountain hex', forest: 'forest hex', ley: 'crystal field hex', meadow: 'meadow hex', plains: 'plains hex', harbor: 'harbor hex', ocean: 'ocean hex' };
const CLASS_HEAD: Record<string, string> = { quarry: 'Stone buildings', lumber: 'Timber buildings', mine: 'Crystal buildings', pasture: 'Livestock buildings', dragon: 'Dragon buildings', trade: 'Trade buildings', monument: 'Monuments' };
// What each upgrade is shown on: a building of its class.
const UPGRADE_ON: Record<string, { building: string; terrain: string }> = { workshop: { building: 'quarry', terrain: 'mountain' }, nesting_grounds: { building: 'roost', terrain: 'plains' } };
const ELEMENTS = ['fire', 'ice', 'lightning', 'air', 'water'];
const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

// Fetches the book (again, if it failed last time), then draws its pictures
// in the seat's color; `ready` re-renders the page after each.
export async function loadBook(seat: number, ready: () => void) {
  if (!book) {
    if (!loading) {
      failed = false;
      loading = fetch('/api/rulebook').then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((b: Rulebook) => { book = b; })
        .catch(() => { failed = true; })
        .finally(() => { loading = null; });
    }
    await loading;
    ready();
    if (!book) return;
  }
  if (picsFor === seat) return;
  picsFor = seat;
  const list = portraitList(book, seat);
  try {
    const { portraits, Board3D } = await import('./board3d.ts');
    if (!Board3D.supported()) return;
    const urls = await portraits(list.map((x) => x.p), 300, 240);
    for (const old of pics.values()) URL.revokeObjectURL(old);
    pics.clear();
    list.forEach((x, i) => urls[i] && pics.set(x.id, urls[i]));
    ready();
  } catch (e) {
    console.warn('rulebook pictures', e); // the book still reads without them
  }
}

// Every picture the book shows, by id.
function portraitList(b: Rulebook, seat: number): { id: string; p: Portrait }[] {
  const out: { id: string; p: Portrait }[] = [];
  const add = (id: string, p: Portrait) => out.push({ id, p: { owner: seat, ...p } });
  for (const t of b.terrains) add(`terrain ${t}`, { terrain: t });
  add('border', { terrain: 'meadow', building: 'pasture', border: true });
  add('shut', { terrain: 'meadow', building: 'pasture', beast: 'wolf_pack' });
  add('perched', { terrain: 'meadow', building: 'pasture', dragon: { element: 'ice', stage: 3 } });
  add('held thunderbird', { terrain: 'meadow', held: 'thunderbird' });
  add('held leviathan', { terrain: 'harbor', held: 'leviathan' });
  add('peak zone', { terrain: 'meadow', peakZone: true });
  add('tower', { terrain: 'plains', building: 'tower' });
  for (const x of b.buildings) add(`building ${x.key}`, x.key === 'tower_floor' ? { terrain: 'plains', building: 'tower', floors: 3 } : { terrain: x.terrain ?? 'plains', building: x.key });
  for (const u of b.upgrades) add(`upgrade ${u.key}`, { ...UPGRADE_ON[u.key], upgrade: u.key });
  for (const f of b.fauna) add(`beast ${f.key}`, { terrain: 'plains', beast: f.key });
  for (const f of b.greatBeasts) add(`beast ${f.key}`, { terrain: f.key === 'leviathan' ? 'ocean' : 'mountain', beast: f.key });
  for (const e of ELEMENTS) for (const s of [0, 3]) add(`dragon ${e} ${s}`, { terrain: 'plains', dragon: { element: e, stage: s } });
  return out;
}

// The element wheel in order, each element followed by the one it beats:
// water, fire, ice, air, lightning. From the server, so it is the engine's.
export function wheelOrder(beats: Record<string, string>): string[] {
  const start = 'water' in beats ? 'water' : Object.keys(beats)[0];
  const order = [start];
  for (let e = beats[start]; e && e !== start && order.length < 10; e = beats[e]) order.push(e);
  return order;
}
// A point on the wheel: element i of n, clockwise from the top, round 0,0.
export function wheelAt(i: number, n: number, r: number): [number, number] {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
  return [r * Math.cos(a), r * Math.sin(a)];
}

// The element wheel: each element with an arrow to the one it beats, neutral
// in the middle (no arrows: it beats nothing and nothing beats it).
function wheel(beats: Record<string, string>): string {
  const es = wheelOrder(beats);
  const n = es.length, R = 36, gap = 13;
  const arrows = es.map((_, i) => {
    const [x1, y1] = wheelAt(i, n, R), [x2, y2] = wheelAt(i + 1, n, R);
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
    const ux = dx / d, uy = dy / d;
    return `<line x1="${(x1 + ux * gap).toFixed(2)}" y1="${(y1 + uy * gap).toFixed(2)}" x2="${(x2 - ux * gap).toFixed(2)}" y2="${(y2 - uy * gap).toFixed(2)}" marker-end="url(#wheelhead)"/>`;
  }).join('');
  const nodes = es.map((e, i) => {
    const [x, y] = wheelAt(i, n, R);
    return `<span class="wnode" style="left:${50 + x}%;top:${50 + y}%;--ec:${ELEMENT_COLORS[e]}">${elemIcon(e, 2)}<b>${cap(e)}</b></span>`;
  }).join('') + `<span class="wnode" style="left:50%;top:50%">${elemIcon('neutral', 2)}<b>Neutral</b></span>`;
  return `<div class="wheel"><svg viewBox="-50 -50 100 100" aria-hidden="true"><defs><marker id="wheelhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="currentColor"/></marker></defs><g stroke="currentColor" stroke-width="1.6">${arrows}</g></svg>${nodes}</div>`;
}

function pic(id: string, alt: string): string {
  const src = pics.get(id);
  return src ? `<img class="bpic" src="${src}" alt="${esc(alt)}">` : '<span class="bpic none"></span>';
}

function entry(picHtml: string, name: string, body: string, key: string): string {
  return `<article class="bentry" data-key="b ${esc(key)}">${picHtml}<div class="bbody"><h4>${esc(name)}</h4>${body}</div></article>`;
}
const text = (s: string) => `<p class="btext">${iconText(esc(s))}</p>`;
const cost = (c: Rulebook['buildings'][number]['cost']) => `<div class="bcost">${resChips(c, 1.1) || '<span class="chip free">Free</span>'}</div>`;
const head = (h: string, intro = '') => `<h3 class="bhead">${esc(h)}</h3>${intro ? `<p class="bintro">${iconText(esc(intro))}</p>` : ''}`;

// The book, open at a tab, over the screen.
export function bookSheet(tab: BookTab): string {
  const tabs = (Object.keys(BOOK_TABS) as BookTab[]).map((t) => `<button data-booktab="${t}" class="${t === tab ? 'on' : ''}">${BOOK_TABS[t]}</button>`).join('');
  const body = book ? PAGES[tab](book) : `<p class="bintro">${failed ? 'The rules didn’t load.' : 'Loading…'}</p>`;
  return `<div class="menuback" id="bookclose"></div><div class="menu booksheet" role="dialog" aria-label="Rules">
    <div class="bookbar"><h3>Rules</h3><button id="bookdone">Close</button></div>
    <nav class="booktabs">${tabs}</nav>
    <div class="bookpage" data-key="bookpage ${tab}">${body}</div></div>`;
}

const PAGES: Record<BookTab, (b: Rulebook) => string> = {
  board(b) {
    const land = b.terrains.filter((t) => t !== 'ocean').map((t) => {
      const here = b.buildings.filter((x) => x.terrain === t).map((x) => `the ${x.name}`);
      const line = here.length ? `${cap(here.length < 2 ? here[0] : `${here.slice(0, -1).join(', ')} and ${here.at(-1)}`)} ${here.length < 2 ? 'is' : 'are'} built only here.` : 'No building needs it.';
      return entry(pic(`terrain ${t}`, cap(TERRAIN_NOUN[t])), cap(TERRAIN_NOUN[t]), text(line), `terrain ${t}`);
    }).join('');
    return `${head('Hexes', 'A building whose card names no terrain goes on any land hex.')}${land}
      ${entry(pic('terrain ocean', 'Ocean hex'), 'Ocean hex', text('Nothing is built on it.'), 'terrain ocean')}
      ${head('Borders and marks')}
      ${entry(pic('border', 'A border in your color'), 'A border in a player’s color', text('Runs round the hexes that player’s buildings stand on.'), 'border')}
      ${entry(pic('shut', 'A grey building with a beast'), 'A grey building', text('A beast holds it: it makes nothing until someone clears the beast.'), 'shut')}
      ${entry(pic('perched', 'A dragon on a building'), 'A dragon on a building', text('The dragon perches there: the building makes nothing until its owner recalls it or it’s knocked out.'), 'perched')}
      ${b.greatBeasts.map((f) => entry(pic(`held ${f.key}`, `Held by the ${f.name}`), `A border in the ${f.name}’s color`, text(`The ${f.name} holds this hex: nothing is built here while the ${f.name} lives.`), `held ${f.key}`)).join('')}
      ${entry(pic('peak zone', 'A gold border'), 'A gold border', text(`On or adjacent to the Thunderbird’s peak, once the Thunderbird is slain: a production building here makes ${b.peakBonus} more each round.`), 'peak zone')}`;
  },
  buildings(b) {
    const one = (x: BookBuilding) => entry(pic(`building ${x.key}`, x.name), x.name, `${text(x.text)}${cost(x.cost)}`, `building ${x.key}`);
    const made = (['stone', 'timber', 'crystal', 'livestock'] as const).filter((r) => b.tower.makes[r]).join(', ').replace(/, (\w+)$/, ' and $1');
    const tower = entry(pic('tower', 'Your tower'), 'Tower', text(`Makes 1 ${made} each round. Houses ${b.tower.houses} dragon${b.tower.houses === 1 ? '' : 's'}. Every player starts with one. No beast or dragon goes on it.`), 'tower');
    const basics = b.buildings.filter((x) => x.basic).map(one).join('');
    const classes = [...new Set(b.buildings.filter((x) => !x.basic).map((x) => x.cls))];
    const cards = classes.map((c) => `${head(CLASS_HEAD[c] ?? c)}${b.buildings.filter((x) => !x.basic && x.cls === c).map(one).join('')}`).join('');
    const ups = b.upgrades.map((u) => entry(pic(`upgrade ${u.key}`, u.name), u.name, `${text(`${u.text} On the board: a golden rim, and a mark beside the building.`)}${cost(u.cost)}`, `upgrade ${u.key}`)).join('');
    return `${tower}${head('Basic buildings', 'Built without a card.')}${basics}${cards}${head('Upgrades', 'Each building takes 1 upgrade.')}${ups}`;
  },
  beasts(b) {
    const beast = (f: FaunaView, more: string) => entry(pic(`beast ${f.key}`, f.name), f.name,
      `<div class="bstats">${powerTag(f.power)}${statTag('Health', f.maxHp)}${statTag('Attack', esc(f.attack))}</div>${f.weak.length ? `<p class="btext">Weak to ${elemWords(f.weak)}</p>` : ''}${f.points !== undefined ? lootLine({}, 1.1, f.points) : lootLine(f.loot, 1.1)}${more ? text(more) : ''}`, `beast ${f.key}`);
    return `${head('Fauna', `Nothing is built on a beast’s hex, and a building under a beast makes nothing. Clear a beast with your dragons for its loot; a beast a card placed has none. In production each beast has a 1 in ${b.faunaWanderOdds} chance to move to an adjacent hex.`)}
      ${b.fauna.map((f) => beast(f, '')).join('')}
      ${head('Great beasts', 'Each holds its hex and every adjacent hex: nothing is built there while it lives. Each player gets 1 try at a great beast each round. Whoever slays it scores its points for good.')}
      ${b.greatBeasts.map((f) => beast(f, f.key === 'thunderbird' ? 'Lives on the peak at the center of the map.' : 'Lives in the ocean beside a harbor.')).join('')}`;
  },
  dragons(b) {
    const groups = ELEMENTS.map((e) => {
      const cards = b.dragons.filter((d) => d.element === e).map((d) => {
        const rows = d.stages.map((s, i) => `<div class="bstage"><small>${STAGE_LABEL[i + 1]}</small>${statTag('Health', s.hp)}${statTag('Attack', esc(s.attack))}</div>`).join('');
        return `<div class="bdragon" data-key="b dragon ${d.key}"><div class="bdhead"><b>${esc(d.name)}</b>${cost(d.cost)}</div>${rows}
          <p class="btext">Grows a stage every ${d.growth} round${d.growth === 1 ? '' : 's'} it’s fed. ${esc(cap(d.targeting))}.${d.base ? ' Also hatched as a special project.' : ''}</p></div>`;
      }).join('');
      return `<section class="belem" style="--ec:${ELEMENT_COLORS[e]}"><div class="bepics">${pic(`dragon ${e} 0`, `A ${e} dragon egg`)}${pic(`dragon ${e} 3`, `An adult ${e} dragon`)}</div>
        <h3 class="bhead">${cap(e)} dragons</h3>${cards}</section>`;
    }).join('');
    return `<p class="bintro">On the board a dragon is the color of its element, whatever its card, and grows bigger at each life stage: egg, hatchling, young, adult.</p>${groups}`;
  },
  elements(b) {
    return `${wheel(b.elementBeats)}<p class="wheelrule">Double damage where the arrow points.</p>`;
  },
  kingdoms(b) {
    return `<p class="bintro">Raids attack these. A kingdom that doesn’t fall adds 1 gold to its loot after every raid.</p>
      ${b.kingdoms.map((t) => `<section class="ptarget bking" data-key="b king ${t.key}"><h3 class="tname">${esc(t.name)}</h3>${powerTag(t.power, 'big')}${foeStack(t.units, 1.6)}${lootLine(t.loot, 1.2)}${pointsLine(t, 1.2)}</section>`).join('')}`;
  },
  cards(b) {
    return `<p class="bintro">Action cards. Building cards and upgrades are under Buildings, dragon cards under Dragons.</p>
      ${b.actions.map((a) => entry(`<span class="bpic bcard" style="--kc:${frameColor('action')}">${cardArt('action', a.key)}</span>`, a.name, `${text(a.text)}${cost(a.cost)}`, `action ${a.key}`)).join('')}`;
  },
};
