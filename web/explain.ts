// The TV lobby's explanation of the game, looping while people join: a round
// played on the TV's own board (board3d.ts), with the phone's cards, the
// kingdoms as they're voted on, and the fight's own stage. Without WebGL it
// plays on the flat map and the flat cut-paper fight.
// What it says and when is in explain-steps.ts.

import type { DragonView, HexView, PublicState, Rulebook } from '../src/state.ts';
import type { Board3D, FightStage, Portrait, portraits } from './board3d.ts';
import { PLAYER_COLORS, POINTS_TO_WIN, TITLE_ICON, buildingIcon, dieFace, esc, gainChips, icon, mapSvg, playerTag, resChips } from './common.ts';
import { kingdomCard, lootLine } from './kingdom.ts';
import { cardArt, frameColor, kindIcon } from './art.ts';
import { backdrop, dragonFigure, unitFigure } from './arena.ts';
import { BUILT, DRAWN, HEXES, KINGDOMS, RAIDED, ROUND, STEPS, TITLES, TITLE_POINTS, BEAST_POINTS, BUILDING_POINTS, MONUMENT_POINTS, type Show } from './explain-steps.ts';

type Board = Pick<PublicState, 'map' | 'dragons'>;
type Act = [at: number, run: () => void];

// What scores, drawn by the board's models. The Largest Hoard has none: its icon stands in.
const PORTRAITS: Record<string, Portrait> = {
  army: { terrain: 'desert', dragon: { element: 'fire', stage: 3 } },
  tower: { terrain: 'desert', building: 'tower', floors: 4 },
  thunderbird: { terrain: 'mountain', beast: 'thunderbird' },
  leviathan: { terrain: 'ocean', beast: 'leviathan' },
  quarry: { terrain: 'mountain', building: 'quarry' },
  monument: { terrain: 'meadow', building: 'monument' },
};
const NAMES = ['Ada', 'Bram'];
const ELEMENTS = ['fire', 'fire']; // everyone starts with a Fire Dragon egg

// The board as it stands at `n`: the buildings so far, and each player's
// Fire Dragon, an egg until 3, a stage older at each of 4, 5 and 6.
function boardAt(n: number): Board {
  const map = HEXES.map(({ q, r, terrain }): HexView => {
    const b = BUILT.find((x) => x.at === `${q},${r}` && x.from <= n);
    return {
      k: `x${q},${r}`, q, r, terrain, fauna: null, perched: [],
      building: b ? { type: b.type, cls: b.type === 'stonemason' ? 'quarry' : '', name: '', owner: b.owner, upgrades: [], upgradeName: null, floors: 0, does: { makes: {}, houses: 0, points: 0 } } : null,
    };
  });
  const dragon = (owner: number, stage: number) => ({
    id: `x${owner}`, owner, name: '', element: ELEMENTS[owner], stage, perch: null, status: stage ? 'ready' : 'egg', canRaid: stage > 0, hp: 1, maxHp: 1,
  }) as DragonView;
  return { map, dragons: [0, 1].map((p) => dragon(p, Math.min(3, Math.max(0, n - 3)))) };
}

export interface Explainer { title: (html: string) => void }

// Plays in `el` until it's taken off the page. `title` is its first scene,
// drawn by the lobby (it shows who has joined).
export function explain(el: HTMLElement, title: string, board: Board3D | null, stage3d: { FightStage: typeof FightStage; portraits: typeof portraits } | null): Explainer {
  el.innerHTML = `<div class="xboard"></div><div class="xfight"></div><div class="xtitle">${title}</div><div class="xshow"></div>
    <ol class="xphases">${ROUND.map((p) => `<li>${p}</li>`).join('')}</ol><p class="xtext"></p>`;
  const part = (c: string) => el.querySelector<HTMLElement>(`.${c}`)!;
  const boardBox = part('xboard'), fightBox = part('xfight'), showBox = part('xshow'), textBox = part('xtext');
  if (board) boardBox.append(board.el);
  let book: Rulebook | null = null;
  let timers: number[] = [];
  const pics = new Map<string, string>();

  function put(n: number) {
    const g = boardAt(n);
    if (board) board.update(g, null);
    else boardBox.innerHTML = mapSvg(g.map);
  }
  const later = (ms: number, run: () => void) => timers.push(setTimeout(() => { if (el.isConnected) run(); }, ms));

  function card(key: string): string {
    const c = book!.buildings.find((x) => x.key === key)!;
    return `<div class="card k-building" style="--kc:${frameColor('building')}"><div class="cart">${cardArt('building', c.key, undefined, c.cls)}<span class="ckind">${kindIcon('building')}</span></div>
      <b class="cname">${esc(c.name)}</b><div class="ccost">${resChips(c.cost)}</div></div>`;
  }

  // What scores, each a picture, its points and, for a title, who holds it.
  function prizes(list: { pic: string; name?: string; points: number; holder?: number }[]) {
    showBox.innerHTML = `<div class="xprizes">${list.map((p) => `<div class="xprize">${pics.has(p.pic) ? `<img src="${pics.get(p.pic)}" alt="">` : `<span class="xpic">${PORTRAITS[p.pic]?.building ? buildingIcon(p.pic, 90, '#8d8f96') : icon(TITLE_ICON[p.pic] ?? p.pic, 5)}</span>`}
      ${p.name ? `<b>${esc(p.name)}</b>` : ''}<span class="xworth">${p.points}${icon('points', 1.2)}${p.holder === undefined ? '' : playerTag(p.holder, NAMES)}</span></div>`).join('')}</div>`;
  }

  // What each step shows over the board, and what happens during it.
  const shows: Record<Show, () => Act[]> = {
    title: () => { put(0); return []; },
    production: () => {
      put(0);
      const rows = [`<div class="xrow">${buildingIcon('tower', 46, PLAYER_COLORS[0])}${gainChips(book!.tower.makes, 1.6)}</div>`, `<div class="xrow">${buildingIcon('quarry', 46, '#8d8f96')}<span class="xdie">${dieFace(4, 3, 'rolling')}</span></div>`];
      showBox.innerHTML = `<div class="xsheet">${rows.join('')}</div>`;
      const rolls: Act[] = [1, 4, 2, 4, 1, 2, 4, 1, 2, 4].map((n, i) => [(i + 1) * 180, () => { showBox.querySelector('.xdie b')!.textContent = String(n); }]);
      return [...rolls, [2200, () => { showBox.querySelector('.xdie')!.innerHTML = `${dieFace(4, 3)}${gainChips({ stone: 3 }, 1.6)}`; }]];
    },
    cards: () => {
      put(0);
      const action = book!.actions[0];
      showBox.innerHTML = `<div class="xcards"><div class="card k-action" style="--kc:${frameColor('action')}"><div class="cart">${cardArt('action', action.key)}<span class="ckind">${kindIcon('action')}</span></div>
        <b class="cname">${esc(action.name)}</b><div class="ccost">${resChips(action.cost) || '<span class="chip free">Free</span>'}</div></div><i></i>${DRAWN.map(card).join('')}</div>`;
      const [kept, other] = showBox.querySelectorAll('.k-building');
      return [[3400, () => { kept.classList.add('kept'); other.classList.add('gone'); }]];
    },
    actions: () => {
      put(0);
      return [[1000, () => put(1)], [2900, () => put(2)]];
    },
    grow: () => {
      put(3);
      return [[600, () => put(4)], [1900, () => put(5)], [3200, () => put(6)]];
    },
    vote: () => {
      put(6);
      const ts = KINGDOMS.map((k) => book!.kingdoms.find((t) => t.key === k)!);
      const power = ELEMENTS.map((e) => book!.dragons.find((d) => d.base && d.element === e)!.stages[2].power);
      const votes: (number | null)[] = [null, null];
      const draw = () => { showBox.innerHTML = `<div class="xkingdoms">${ts.map((t, i) => kingdomCard(t, i, ts.length, votes, power, NAMES)).join('')}</div>`; };
      draw();
      return [[1300, () => { votes[0] = RAIDED; draw(); }], [2500, () => { votes[1] = RAIDED; draw(); }]];
    },
    fight: () => {
      const t = book!.kingdoms.find((x) => x.key === KINGDOMS[RAIDED])!;
      const unit = (n: string) => n.toLowerCase().replace(/[^a-z]+/g, '_');
      const hps = ELEMENTS.map((e) => book!.dragons.find((d) => d.base && d.element === e)!.stages[2].hp);
      const label = { w: 0, h: 0 };
      let hit: (from: string, to: string, falls: boolean) => void;
      if (stage3d) {
        const stage = new stage3d.FightStage(t.key,
          ELEMENTS.map((element, i) => ({ key: `d${i}`, fighter: { dragon: { element, stage: 3 } }, maxHp: hps[i], label })),
          t.units.map((u, i) => ({ key: `u${i}`, fighter: { foe: unit(u.name) }, maxHp: u.maxHp, label })), false, { top: 0.18, bottom: 0.2 }, true);
        const box = document.createElement('div');
        box.className = 'xstage';
        fightBox.append(box);
        stage.mount(box);
        hit = (from, to, falls) => { stage.strike(from); stage.hit(to); if (falls) stage.fall(to); };
      } else {
        fightBox.innerHTML = `${backdrop(t.key)}<div class="xflat"><div>${ELEMENTS.map((e, i) => `<span data-f="d${i}">${dragonFigure(e)}</span>`).join('')}</div><div>${t.units.map((u, i) => `<span data-f="u${i}">${unitFigure(unit(u.name))}</span>`).join('')}</div></div>`;
        hit = (_, to, falls) => { if (falls) fightBox.querySelector(`[data-f="${to}"]`)!.classList.add('down'); };
      }
      const acts: Act[] = [];
      t.units.forEach((_, i) => {
        acts.push([700 + i * 750, () => hit(`d${i % 2}`, `u${i}`, true)]);
        if (i + 1 < t.units.length) acts.push([1050 + i * 750, () => hit(`u${i + 1}`, `d${i % 2}`, false)]);
      });
      acts.push([700 + t.units.length * 750, () => { showBox.innerHTML = `<div class="xsheet"><h2>${esc(t.name)} <span class="ok">falls</span></h2>${lootLine(t.loot, 1.6)}</div>`; }]);
      return acts;
    },
    goal: () => {
      put(7);
      showBox.innerHTML = `<div class="xgoal">${POINTS_TO_WIN}${icon('points', 1)}</div>`;
      return [];
    },
    titles: () => {
      put(7);
      const hold = [0, 0, 1]; // who holds each title
      const draw = () => prizes(TITLES.map((t, i) => ({ pic: t.key, name: t.name, points: TITLE_POINTS, holder: hold[i] })));
      draw();
      return [[4500, () => { hold[0] = 1; draw(); }]]; // Bram takes it
    },
    beasts: () => {
      put(7);
      prizes(book!.greatBeasts.map((b) => ({ pic: b.key, name: b.name, points: b.points ?? BEAST_POINTS })));
      return [];
    },
    buildings: () => {
      put(7);
      prizes([{ pic: 'quarry', points: BUILDING_POINTS }, { pic: 'monument', points: MONUMENT_POINTS }]);
      return [];
    },
  };

  function play(i: number, hold?: number) {
    timers.forEach(clearTimeout);
    timers = [];
    const s = STEPS[i];
    showBox.innerHTML = '';
    fightBox.replaceChildren(); // the fight's stage stops itself off the page
    el.dataset.show = s.show;
    textBox.textContent = s.text; // words, not icons: they're new to the icons
    el.querySelectorAll('.xphases li').forEach((li) => li.classList.toggle('phase', li.textContent === s.phase));
    const acts = shows[s.show]();
    if (hold !== undefined) return acts.slice(0, hold).forEach(([, run]) => run());
    for (const [at, run] of acts) later(at, run);
    // Nothing to play without the rules: the title stays.
    later(s.ms, () => play(book ? (i + 1) % STEPS.length : 0));
  }
  play(0);
  const keys = Object.keys(PORTRAITS);
  const drawn = stage3d?.portraits(keys.map((k) => PORTRAITS[k]), 420, 336).then((urls) => keys.forEach((k, i) => urls[i] && pics.set(k, urls[i]))).catch(() => {});
  const loaded = fetch('/api/rulebook').then((r) => (r.ok ? r.json() : null)).then((b: Rulebook | null) => { book = b; }).catch(() => {});
  // For screenshots: a step as it ends (or after `n` of what happens in it), held.
  Object.assign(window, { explainAt: async (show: Show, n = Infinity) => { await loaded; await drawn; play(STEPS.findIndex((s) => s.show === show), n); } });
  return { title: (html) => { const t = part('xtitle'); if (t.innerHTML !== html) t.innerHTML = html; } };
}
