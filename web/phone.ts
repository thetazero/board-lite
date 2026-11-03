// The phone: one player's hidden hand and their choices. Everything public
// is on the TV, so this stays small: resources, cards, and the decision at hand.

import type { CardView, PublicState, SeatState, Snapshot } from '../src/state.ts';
import {
  ELEMENT_COLORS, PLAYER_COLORS, RESOURCES, STAGE_LABEL, buildingIcon, dragonBadge, dragonChip, elemIcon, esc, hpBar, icon, iconText, incomeText, mapSvg, named, playerTag, post, resChips, resIcon, watch,
} from './common.ts';
import { ART_DEFS, cardArt, frameColor, glyph, kindIcon, stageFigure } from './art.ts';

document.body.insertAdjacentHTML('afterbegin', ART_DEFS);

type Me = SeatState & { name: string };

const app = document.getElementById('app')!;
let code = '';
let token = '';
let snap: Snapshot | null = null;
let names: string[] = [];
let stop: (() => void) | null = null;

// UI state that lives only on this phone (not in the game).
let tab: 'none' | 'more' | 'trade' = 'none'; // the panel open above the hand, if any
let picking: { title: string; hexes: string[]; command: (hex: string) => string } | null = null;
let openCard: string | null = null;
let selected = new Set<string>(); // discard picks
let trade = fresh();
let bank = { give: 'stone', get: 'gold', times: 1 };
let busy = false;
// Cards arriving in the hand fly in: the ids already seen, and when each new one lands.
// Null until the hand is first shown, so reloading mid-game doesn't deal it again.
let seenHand: Set<string> | null = null;
const dealtAt = new Map<string, number>();
const DEAL_MS = 650;
const DEAL_GAP_MS = 160;

function fresh() {
  return { to: -1, give: {} as Record<string, number>, get: {} as Record<string, number>, cards: new Set<string>() };
}

// ---------- joining ----------

async function boot() {
  // http://host:port/ABCD is a room's address: the code comes filled in.
  const path = /^\/([A-Za-z]{4})\/?$/.exec(location.pathname);
  if (path) code = path[1].toUpperCase();
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('code') && hash.get('token')) {
    localStorage.setItem('seat', JSON.stringify({ code: hash.get('code'), token: hash.get('token') }));
    history.replaceState(null, '', '/');
  }
  try {
    const saved = JSON.parse(localStorage.getItem('seat') ?? 'null');
    if (saved?.code && saved?.token) {
      const r = await fetch(`/api/rooms/${saved.code}?token=${saved.token}`);
      if (r.ok && (await r.json()).seated) return enter(saved.code, saved.token);
    }
  } catch { /* fall through to the join form */ }
  renderJoin();
}

function renderJoin(err = '') {
  const last = localStorage.getItem('name') ?? '';
  app.innerHTML = `
    <form class="joinform" id="join">
      <h1 class="title">board-lite</h1>
      <label>Room code <input id="code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" value="${esc(code)}" required></label>
      <label>Your name <input id="name" maxlength="12" autocomplete="nickname" value="${esc(last)}" required></label>
      <button class="primary big" type="submit">Join</button>
      <p class="error">${esc(err)}</p>
    </form>`;
  const form = document.getElementById('join') as HTMLFormElement;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const c = (document.getElementById('code') as HTMLInputElement).value.trim().toUpperCase();
    const n = (document.getElementById('name') as HTMLInputElement).value.trim();
    code = c;
    try {
      const r = await post(`/api/rooms/${c}/join`, { name: n });
      localStorage.setItem('name', n);
      localStorage.setItem('seat', JSON.stringify({ code: c, token: r.token }));
      enter(c, String(r.token));
    } catch (er) {
      renderJoin(er instanceof Error ? er.message : String(er));
    }
  };
}

function enter(c: string, t: string) {
  code = c;
  token = t;
  stop?.();
  stop = watch(code, token, onSnapshot, (ok) => document.body.classList.toggle('offline', !ok));
}

function onSnapshot(s: Snapshot) {
  const prev = snap;
  snap = s;
  names = s.lobby.seats.map((x) => x.name);
  if (!s.game) {
    if (s.seat < 0) return leaveToJoin('You were removed from the lobby.');
    seenHand = new Set(); // watching from the lobby: the first hand is dealt in
    return renderLobby();
  }
  if (!s.you) return leaveToJoin('You are not in this game.');
  // Reset per-decision UI when the situation changes under us.
  const key = (x: Snapshot | null) => `${x?.game?.phase}|${x?.game?.turn}|${x?.game?.raid?.step}|${x?.game?.round}`;
  if (key(prev) !== key(s)) {
    picking = null;
    selected = new Set();
    openCard = null;
    if (s.game.phase !== 'action') trade = fresh();
  }
  if (navigator.vibrate && s.you.deciding && !prev?.you?.deciding) navigator.vibrate(120);
  noteDeals(s.you.hand.map((c) => c.id));
  render();
  renderTalk();
}

function noteDeals(ids: string[]) {
  const now = performance.now();
  if (seenHand) {
    let n = 0;
    for (const id of ids) if (!seenHand.has(id) && !dealtAt.has(id)) dealtAt.set(id, now + n++ * DEAL_GAP_MS);
  }
  seenHand = new Set(ids);
  for (const [id, t] of dealtAt) if (now - t > DEAL_MS) dealtAt.delete(id);
}

// A card still flying in keeps flying across re-renders: its animation resumes where it was.
function dealStyle(id: string): string {
  const t = dealtAt.get(id);
  return t === undefined ? '' : `;animation-delay:${Math.round(t - performance.now())}ms`;
}

function seatIndex(): number {
  return snap!.seat;
}

function leaveToJoin(msg: string) {
  talk.el.remove();
  seenHand = null;
  stop?.();
  stop = null;
  localStorage.removeItem('seat');
  renderJoin(msg);
}

// ---------- lobby ----------

function renderLobby() {
  const l = snap!.lobby;
  const me = seatIndex();
  const first = me === 0;
  app.innerHTML = `
    <div class="plobby" style="--pc:${PLAYER_COLORS[me] ?? '#888'}">
      <h1>You're in, ${esc(l.seats[me]?.name ?? '')}!</h1>
      <p>Room <b>${esc(l.code)}</b>. Your colour:</p>
      <div class="swatch"></div>
      <ul class="seats">${l.seats.map((s, i) => `<li style="--pc:${PLAYER_COLORS[i]}"><span class="dot"></span>${esc(s.name)}${s.kind === 'bot' ? ' <small>(bot)</small>' : ''}</li>`).join('')}</ul>
      ${first ? `<button id="bot" ${l.seats.length >= l.maxPlayers ? 'disabled' : ''}>Add a bot</button>
        <button id="start" class="primary big" ${l.seats.length >= l.minPlayers ? '' : 'disabled'}>Start the game</button>`
      : '<p class="hint">Waiting for the first player (or the TV) to start…</p>'}
      <button id="leave" class="ghost">Leave</button>
    </div>`;
  if (first) {
    on('bot', () => post(`/api/rooms/${code}/bot`, { token }));
    on('start', () => post(`/api/rooms/${code}/start`, { token }));
  }
  on('leave', async () => {
    await post(`/api/rooms/${code}/leave`, { token });
    leaveToJoin('');
  });
}

// ---------- the game ----------

function send(command: string) {
  if (busy) return;
  busy = true;
  post(`/api/rooms/${code}/do`, { token, command })
    .catch(toast)
    .finally(() => (busy = false));
}

function on(id: string, fn: () => unknown) {
  const el = document.getElementById(id);
  if (el) el.onclick = () => Promise.resolve(fn()).catch(toast);
}

function bind(sel: string, fn: (el: HTMLElement) => unknown) {
  app.querySelectorAll<HTMLElement>(sel).forEach((el) => (el.onclick = (e) => {
    e.stopPropagation();
    Promise.resolve(fn(el)).catch(toast);
  }));
}

function header(g: PublicState, me: Me): string {
  // Each token with what a round brings in under it, upkeep taken off.
  const res = RESOURCES.map((r) => {
    const inc = me.income[r];
    const sign = inc.base < 0 ? ' minus' : inc.base || inc.dice.length ? '' : ' none';
    return `<div class="res${me.resources[r] ? '' : ' zero'}"><div>${resIcon(r, 1.9)}<b>${me.resources[r]}</b></div><small class="inc${sign}" title="each round">${incomeText(inc)}</small></div>`;
  }).join('');
  const pts = me.hiddenPoints ? `${me.totalPoints} <small>(${me.hiddenPoints} secret)</small>` : `${me.totalPoints}`;
  // Name, points and resources stay on screen together while the page scrolls.
  return `
    <div class="mehead" style="--pc:${PLAYER_COLORS[me.seat]}">
      <header class="me">
        <span class="pname">${esc(me.name)}</span>
        <span class="pts">${icon('points', 1.4)}${pts} <small>/ ${g.pointsToWin}</small></span>
      </header>
      <div class="resbar">${res}</div>
    </div>`;
}

function status(g: PublicState, me: Me): string {
  if (g.phase === 'over') return `<div class="status"><span>Game over: ${playerTag(g.winner!, names)} wins.</span></div>`;
  if (me.deciding) {
    const what = g.phase === 'action' ? (me.myTurn ? 'Your turn!' : 'An offer for you') : g.phase === 'discard' ? 'Too many cards' : 'Raid: your choice';
    return `<div class="status you">${what}</div>`;
  }
  const tags = g.waitingOn.map((p) => playerTag(p, names));
  const w = tags.length < 2 ? tags.join('') : `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]}`;
  if (g.phase === 'action') return `<div class="status"><span>${playerTag(g.turn, names)}'s turn. ${g.offers.length ? '' : 'You can offer them a trade.'}</span></div>`;
  return `<div class="status"><span>Waiting for ${w || 'the table'}.</span></div>`;
}

function render() {
  const g = snap!.game!;
  const me = snap!.you!;
  let body = '';
  if (picking) body = hexPicker(g);
  else if (g.phase === 'over') body = gameOver(g, me);
  else if (g.phase === 'discard') body = me.deciding ? discardView(me) : '<p class="big-note">Waiting for the others to discard…</p>';
  else if (g.phase === 'raid') body = raidView(g, me);
  else body = actionView(g, me);
  const den = !picking && (g.phase === 'action' || g.phase === 'discard') ? roost(g, me) : '';
  // Drawn cards fly into the hand, so the log doesn't also say so.
  // Only this round's news: last round's raid choices don't linger into your turn.
  const recent = me.log.filter((e) => e.round === g.round && !e.text.startsWith('You draw ')).slice(-2).map((e) => `<li>${named(e.text, names, g.dragons)}</li>`).join('');
  const open = !picking && g.phase !== 'discard' ? me.hand.find((c) => c.id === openCard) : undefined;
  const zoom = open ? cardZoom(open, me, me.myTurn && g.phase === 'action') : '';
  // The hand is held along the bottom edge whenever cards matter: your turn, others' turns, discarding.
  const dock = !picking && (g.phase === 'action' || g.phase === 'discard') ? handFan(me, me.myTurn && g.phase === 'action', g.phase === 'discard' && me.deciding) : '';
  document.body.classList.toggle('has-hand', !!dock);
  app.innerHTML = `${header(g, me)}${status(g, me)}<main class="pbody">${den}${body}</main>${recent && !picking ? `<ul class="mylog">${recent}</ul>` : ''}${dock}${zoom}`;
  wire(g, me);
}

// Your dragons at home: one place in the roost per dragon you can house,
// empty places drawn as empty nests.
function roost(g: PublicState, me: Me): string {
  const mine = g.dragons.filter((d) => d.owner === me.seat);
  const empty = Math.max(0, me.dragonCapacity - mine.length);
  const full = !empty;
  return `<section class="roost${full ? ' full' : ''}">
    <div class="rhead">${buildingIcon('roost', 22, '#cfd3dc')}<b>${mine.length}/${me.dragonCapacity}</b></div>
    <div class="nests">${mine.map((d) => dragonChip(d)).join('')}${'<div class="nest" aria-label="room for a dragon"></div>'.repeat(empty)}</div>
  </section>`;
}

// ---- action phase ----

function actionView(g: PublicState, me: Me): string {
  const incoming = g.offers.filter((o) => o.to === me.seat).map((o) => `
    <div class="offer in">${playerTag(o.from, names)} offers <b>${iconText(esc(o.give))}</b> for your <b>${iconText(esc(o.get))}</b>
      <div class="row"><button class="primary" data-accept="${o.id}">Accept</button><button data-decline="${o.id}">Decline</button></div></div>`).join('');
  const mine = g.offers.filter((o) => o.from === me.seat).map((o) => `
    <div class="offer out">You offer ${playerTag(o.to, names)} <b>${iconText(esc(o.give))}</b> for <b>${iconText(esc(o.get))}</b> <button class="small" data-cancel="${o.id}">Withdraw</button></div>`).join('');
  // Build & bank and Trade open over the table and close again; the hand is always below.
  const tabs = `<nav class="tabs">
    ${me.myTurn ? `<button data-tab="more" class="${tab === 'more' ? 'on' : ''}">Build &amp; bank</button>` : ''}
    <button data-tab="trade" class="${tab === 'trade' ? 'on' : ''}">Trade</button></nav>`;
  const t = !me.myTurn && tab === 'more' ? 'none' : tab;
  const content = t === 'more' ? moreView(me) : t === 'trade' ? tradeView(g, me) : '';
  const end = me.myTurn ? '<button id="end" class="primary big endturn">End turn</button>' : '';
  return `${incoming}${mine}${tabs}${content}${end}`;
}

const KIND_LABEL = { building: 'Building', upgrade: 'Upgrade', action: 'Action', dragon: 'Dragon egg' };

// What a card costs, with what you're short of marked.
function costChips(cost: CardView['cost'], me: Me): string {
  const parts = RESOURCES.filter((r) => (cost[r] ?? 0) > 0).map((r) => `<span class="chip${me.resources[r] < cost[r]! ? ' short' : ''}">${cost[r]}${resIcon(r, 1.15)}</span>`);
  return parts.join('') || '<span class="chip free">free</span>';
}

// The card's corner: its kind, or a dragon's element.
function cornerMark(c: CardView): string {
  return c.kind === 'dragon' && c.element ? elemIcon(c.element, 1) : kindIcon(c.kind);
}

// A card as it sits in the hand: a paper card with its picture, name and cost.
function cardFace(c: CardView, me: Me, playable: boolean, style = '', cls = ''): string {
  const dim = playable && (!c.affordable || c.blocked) ? ' dim' : '';
  const dealt = dealtAt.has(c.id) ? ' dealt' : '';
  return `<div class="card k-${c.kind}${dim}${dealt}${cls}${selected.has(c.id) ? ' picked' : ''}" data-card="${c.id}" style="--kc:${frameColor(c.kind, c.element)};${style}${dealStyle(c.id)}">
    <div class="cart">${cardArt(c.kind, c.key, c.element)}<span class="ckind">${cornerMark(c)}</span></div>
    <b class="cname">${esc(c.name)}</b>
    <div class="ccost">${costChips(c.cost, me)}</div>
  </div>`;
}

// A dragon card's text is its numbers: each life stage drawn small with its
// health and attack, how fast it grows, and one sentence on how it picks targets.
function dragonStats(c: CardView): string {
  const d = c.dragon!;
  const rows = d.stages.map((st, i) => `<div class="drow">${stageFigure(c.key, c.element ?? 'fire', i)}<span>${glyph('health', 'health')}${st.hp}</span><span>${glyph('attack', 'attack')}${esc(st.attack)}</span></div>`).join('');
  const sentence = `${d.targeting[0].toUpperCase()}${d.targeting.slice(1)}.`;
  return `<div class="dstats">${rows}<div class="dgrow" title="Growth steps per life stage (a fed dragon grows a step each round)">${glyph('growth', 'growth steps per stage')}${d.growth} per stage</div></div><p class="ctext">${esc(sentence)}</p>`;
}

// A card tapped open: full size, its rule text, and how to play it.
function cardZoom(c: CardView, me: Me, playable: boolean): string {
  let actions = '';
  if (!playable) actions = `<p class="hint">${c.needs === 'unplayable' ? esc(c.blocked ?? '') : 'You can play cards on your turn.'}</p>`;
  else if (c.blocked) actions = `<p class="blocked">${iconText(esc(c.blocked))}</p>`;
  else if (!c.affordable) actions = `<p class="blocked">You can't afford it yet.</p>`;
  else if (c.needs === 'resource') actions = `<div class="row">${RESOURCES.filter((r) => r !== 'gold').map((r) => `<button class="iconbtn" data-play="${c.id} ${r}" aria-label="${r}">${resIcon(r, 1.9)}</button>`).join('')}</div>`;
  else if (c.needs === 'dragon') actions = `<div class="row">${c.dragons.map((id) => `<button data-play="${c.id} ${id}">${esc(dragonLabel(id))}</button>`).join('')}</div>`;
  else if (c.needs === 'hex') actions = `<button class="primary big" data-pickhex="${c.id}">${c.kind === 'upgrade' ? 'Choose a building' : 'Choose where to build'}</button>`;
  else if (c.kind === 'building') actions = `<button class="primary big" data-build="${c.id}">Build it</button>`;
  else actions = `<button class="primary big" data-play="${c.id}">${c.kind === 'dragon' ? 'Hatch it' : 'Play it'}</button>`;
  return `<div class="zoom" id="zoom">
    <div class="card big k-${c.kind}" style="--kc:${frameColor(c.kind, c.element)}">
      <div class="cart">${cardArt(c.kind, c.key, c.element)}<span class="ckind">${cornerMark(c)}</span></div>
      <b class="cname">${esc(c.name)}</b>
      <div class="ccost"><span>${costChips(c.cost, me)}</span><small>${KIND_LABEL[c.kind]}</small></div>
      ${c.dragon ? dragonStats(c) : `<p class="ctext">${iconText(esc(c.text))}</p>`}
    </div>
    <div class="zoomacts">${actions}</div>
    ${me.hand.length > 1 ? `<div class="zoomnav"><button class="ghost" data-zoomnav="-1" aria-label="Previous card">‹</button><span>${me.hand.indexOf(c) + 1} / ${me.hand.length}</span><button class="ghost" data-zoomnav="1" aria-label="Next card">›</button></div>` : ''}
  </div>`;
}

// The hand, held like real cards: fanned along the bottom edge of the screen,
// overlapping when there are many. On your turn the cards you can play now glow.
function handFan(me: Me, playable: boolean, discarding: boolean): string {
  const n = me.hand.length;
  if (!n) return '<div class="handfan empty"><p class="hint">No cards. You draw 2 building cards and 1 action card each round.</p></div>';
  const mid = (n - 1) / 2;
  const tilt = Math.min(6, 36 / n); // degrees between neighbours
  const cards = me.hand.map((c, i) => {
    const d = i - mid;
    const ready = playable && c.affordable && !c.blocked && c.needs !== 'unplayable';
    // --x: offset from the centre as a share of the spread; --r: tilt; --y: the arc's drop.
    const pos = `--x:${n > 1 ? d / mid : 0};--r:${(d * tilt).toFixed(1)}deg;--y:${(Math.abs(d) * Math.abs(d) * tilt * 0.22).toFixed(1)}px;z-index:${i + 1}`;
    return cardFace(c, me, playable, `${pos}`, `${ready ? ' ready' : ''}${c.name.length >= 10 ? ' longname' : ''}`);
  }).join('');
  return `<div class="handfan${discarding ? ' discarding' : ''}" style="--n:${n}">${cards}</div>`;
}

function dragonLabel(id: string): string {
  const d = snap!.game!.dragons.find((x) => x.id === id);
  return d ? `${d.name} (${STAGE_LABEL[d.stage].toLowerCase()}${d.stage ? `, ${d.hp}/${d.maxHp}` : ''})` : id;
}

function moreView(me: Me): string {
  const projects = me.projects.map((p) => `
    <div class="proj${p.affordable && p.hexes.length ? '' : ' dim'}"><b>${esc(p.name)}</b> ${resChips(p.cost)}
      <button data-project="${p.key}" ${p.affordable && p.hexes.length ? '' : 'disabled'}>Build</button></div>`).join('');
  const egg = me.eggProject;
  const eggOk = egg.affordable && egg.room;
  const eggs = egg.elements.map((e) => `<button class="elembtn iconbtn" style="--ec:${ELEMENT_COLORS[e]}" data-egg="${e}" aria-label="${e} egg" ${eggOk ? '' : 'disabled'}>${elemIcon(e, 1.9)}</button>`).join('');
  // Pick a resource by tapping its icon.
  const pick = (side: 'give' | 'get', sel: string) => `<div class="respick">${RESOURCES.map((r) => `<button class="iconbtn${sel === r ? ' on' : ''}" data-bank="${side} ${r}" aria-label="${r}" aria-pressed="${sel === r}">${resIcon(r, 1.8)}</button>`).join('')}</div>`;
  return `
    <section class="panel"><h3>Special projects <small>(no card, double cost)</small></h3>${projects}
      <div class="proj${eggOk ? '' : ' dim'}"><b>Base dragon egg</b> ${resChips(egg.cost)}</div>
      <div class="row">${eggs}</div>${egg.room ? '' : '<p class="blocked">No room for another dragon: build a roost.</p>'}</section>
    <section class="panel"><h3>Bank <small>(${me.bankRate} for 1)</small></h3>
      <div class="bankrow"><span>Give</span>${pick('give', bank.give)}</div>
      <div class="bankrow"><span>Get</span>${pick('get', bank.get)}</div>
      <div class="bank"><span class="stepper"><button data-btimes="-1">−</button><b>${bank.times}</b><button data-btimes="1">+</button></span>
        <button id="bankgo" class="primary" ${me.resources[bank.give as 'stone'] >= me.bankRate * bank.times && bank.give !== bank.get ? '' : 'disabled'}>Trade <span class="chip">${me.bankRate * bank.times}${resIcon(bank.give, 1.25)}</span>→<span class="chip">${bank.times}${resIcon(bank.get, 1.25)}</span></button></div></section>`;
}

function stepper(side: 'give' | 'get', r: string, n: number, max: number): string {
  return `<div class="tres">${resIcon(r, 1.4)}<span class="stepper"><button data-step="${side} ${r} -1" ${n <= 0 ? 'disabled' : ''}>−</button><b>${n}</b><button data-step="${side} ${r} 1" ${n >= max ? 'disabled' : ''}>+</button></span></div>`;
}

function tradeView(g: PublicState, me: Me): string {
  // On your turn you can offer anyone; otherwise only the player whose turn it is.
  const others = me.myTurn ? names.map((_, i) => i).filter((i) => i !== me.seat) : [g.turn];
  if (!others.includes(trade.to)) trade.to = others[0];
  const who = others.map((i) => `<button data-to="${i}" class="${trade.to === i ? 'on' : ''}" style="--pc:${PLAYER_COLORS[i]}">${esc(names[i])}</button>`).join('');
  const give = RESOURCES.map((r) => stepper('give', r, trade.give[r] ?? 0, me.resources[r])).join('');
  const get = RESOURCES.map((r) => stepper('get', r, trade.get[r] ?? 0, 99)).join('');
  const cards = me.hand.map((c) => `<button class="tcard${trade.cards.has(c.id) ? ' on' : ''}" data-tcard="${c.id}" style="--kc:${frameColor(c.kind, c.element)}">${cardArt(c.kind, c.key, c.element)}<span>${esc(c.name)}</span></button>`).join('');
  const any = Object.values(trade.give).some(Boolean) || trade.cards.size || Object.values(trade.get).some(Boolean);
  return `
    <section class="panel trade">
      <h3>Offer a trade to</h3><div class="row who">${who}</div>
      <h3>You give</h3><div class="tgrid">${give}</div>
      ${cards ? `<div class="row tcards">${cards}</div>` : ''}
      <h3>You get</h3><div class="tgrid">${get}</div>
      <button id="offer" class="primary" ${any ? '' : 'disabled'}>Send offer</button>
      <p class="hint">Offers show on the TV. Accepted trades are binding; open offers end with the turn.</p>
    </section>`;
}

function hexPicker(g: PublicState): string {
  return `<section class="picker"><h3>${esc(picking!.title)}</h3><p class="hint">Tap a highlighted hex. It matches the map on the TV.</p>
    <div class="pmap">${mapSvg(g.map, { size: 40, selectable: picking!.hexes })}</div>
    <button id="cancelpick" class="ghost">Cancel</button></section>`;
}

// ---- raid ----

function raidView(g: PublicState, me: Me): string {
  const raid = g.raid!;
  if (raid.step === 'vote') {
    if (me.myVote !== null) return `<p class="big-note">You voted for <b>${esc(raid.candidates[me.myVote].name)}</b>. Waiting for the others…</p>`;
    return `<h2>Vote for the raid target</h2><p class="hint">Details are on the TV.</p>${raid.candidates.map((t, i) => `
      <button class="choice" data-vote="${i + 1}"><b>${i + 1}. ${esc(t.name)}</b><span>${t.units.map((u) => esc(u.name)).join(', ')}</span><span>Loot ${resChips(t.loot)}</span></button>`).join('')}`;
  }
  if (raid.step === 'commit') {
    if (!me.raidReady.length) return `<p class="big-note">None of your dragons can raid this time (eggs, hungry or hurt dragons stay home).</p>`;
    const committed = new Set(raid.commits[me.seat]);
    const ready = raid.ready[me.seat];
    const list = me.raidReady.map((id) => {
      const d = g.dragons.find((x) => x.id === id)!;
      return `<button class="dragon${committed.has(id) ? ' on' : ''}" data-commit="${id}" ${ready ? 'disabled' : ''}>${dragonBadge(d, 40)}<span><b>${esc(d.name)}</b><br>${STAGE_LABEL[d.stage]} · ${d.hp}hp · hits ${esc(d.attack)}</span></button>`;
    }).join('');
    return `<h2>Raid on ${esc(raid.target!.name)}</h2><p class="hint">Everyone sees what you commit. Tap dragons to send them, then lock in.</p>
      ${list}${ready ? `<p class="big-note">Locked in with ${committed.size || 'no'} dragon${committed.size === 1 ? '' : 's'}.</p>` : `<button id="ready" class="primary big">Lock in ${committed.size ? `${committed.size} dragon${committed.size === 1 ? '' : 's'}` : '(stay home)'}</button>`}`;
  }
  if (raid.step === 'bail') {
    if (!raid.commits[me.seat].length) return `<p class="big-note">You're not in this raid. The others are choosing in secret.</p>`;
    if (me.myChoice) return `<p class="big-note">You chose to <b>${me.myChoice}</b>. Nobody else knows yet.</p>`;
    return `<h2>Fight or bail?</h2><p class="hint">Secret. Bailing costs nothing, but you get no loot. Once the fight starts there is no retreat, and a dragon that takes a hit sits out next round.</p>
      <div class="row big2"><button id="fight" class="primary big">Fight</button><button id="bail" class="big">Bail</button></div>`;
  }
  return `<p class="big-note">The battle is on the TV.</p>`;
}

// ---- discard / end ----

function discardView(me: Me): string {
  const n = me.hand.length - me.handCap;
  return `<h2>Discard ${n} card${n === 1 ? '' : 's'}</h2><p class="hint">The hand limit is ${me.handCap}. Tap cards in your hand to pick them.</p>
    <button id="discard" class="primary big" ${selected.size === n ? '' : 'disabled'}>Discard ${selected.size}/${n}</button>`;
}

function gameOver(g: PublicState, me: Me): string {
  const order = g.finalTotals!.map((t, p) => [t, p]).sort((a, b) => b[0] - a[0]);
  return `<h2>${g.winner === me.seat ? 'You win!' : `${esc(names[g.winner!])} wins.`}</h2>
    <ol class="final">${order.map(([t, p]) => `<li>${playerTag(p, names)} <span class="chip">${t}${icon('points', 1.25)}</span></li>`).join('')}</ol>
    <button id="newgame" class="primary">Join another game</button>`;
}

// ---------- table talk ----------

// People at the table just talk, but players who aren't in the room (Claude, or
// anyone at a terminal) only hear what goes through the game: "say" reaches
// everyone (it shows on the TV), "tell P2" only that player. The bar is built
// once and only its messages change, so a snapshot never wipes what you're typing.
const talk = (() => {
  const el = document.createElement('div');
  el.className = 'talkbar';
  el.innerHTML = `
    <button class="latest" type="button"><span>Table talk</span><b class="unread" hidden></b></button>
    <div class="sheet">
      <header><b>Table talk</b><button class="ghost small close" type="button">Close</button></header>
      <ul></ul>
      <form><select aria-label="To"></select><input maxlength="300" placeholder="Say something…" autocomplete="off" enterkeyhint="send"><button class="primary">Send</button></form>
    </div>`;
  const q = <T extends Element>(sel: string) => el.querySelector(sel) as T;
  return { el, latest: q<HTMLElement>('.latest span'), unread: q<HTMLElement>('.unread'), list: q<HTMLUListElement>('ul'), to: q<HTMLSelectElement>('select'), input: q<HTMLInputElement>('input'), form: q<HTMLFormElement>('form'), open: false, read: -1, toKey: '' };
})();

talk.el.querySelector<HTMLElement>('.latest')!.onclick = () => {
  talk.open = true;
  talk.el.classList.add('open');
  renderTalk();
  talk.list.scrollTop = talk.list.scrollHeight;
};
talk.el.querySelector<HTMLElement>('.close')!.onclick = () => {
  talk.open = false;
  talk.el.classList.remove('open');
  renderTalk();
};
talk.form.onsubmit = (e) => {
  e.preventDefault();
  const text = talk.input.value.trim();
  if (!text) return;
  const to = Number(talk.to.value);
  post(`/api/rooms/${code}/do`, { token, command: to >= 0 ? `tell P${to + 1} ${text}` : `say ${text}` })
    .then(() => (talk.input.value = ''))
    .catch(toast);
};

function talkHtml(text: string, g: PublicState): string {
  const pub = /^(P\d) says: "(.*)"$/.exec(text);
  if (pub) return `${named(pub[1], names)} <q>${named(pub[2], names, g.dragons)}</q>`;
  const priv = /^(P\d) to (P\d) \(private\): "(.*)"$/.exec(text);
  if (priv) return `${named(priv[1], names)} <small>to</small> ${named(priv[2], names)} <small>(private)</small> <q>${named(priv[3], names, g.dragons)}</q>`;
  return named(text, names, g.dragons);
}

function renderTalk() {
  const g = snap?.game;
  const me = snap?.you;
  if (!g || !me) return talk.el.remove();
  if (!talk.el.isConnected) document.body.append(talk.el);
  // Who you can talk to: everyone, or one other player.
  const key = names.join('|');
  if (key !== talk.toKey) {
    const keep = talk.to.value;
    talk.to.innerHTML = `<option value="-1">Everyone</option>${names.map((n, i) => (i === me.seat ? '' : `<option value="${i}">${esc(n)} only</option>`)).join('')}`;
    talk.to.value = keep || '-1';
    talk.toKey = key;
  }
  const lines = me.talk;
  const mine = (text: string) => text.startsWith(`P${me.seat + 1} `);
  const atBottom = talk.list.scrollHeight - talk.list.scrollTop - talk.list.clientHeight < 40;
  talk.list.innerHTML = lines.map((e) => `<li class="${e.private ? 'private' : ''}${mine(e.text) ? ' mine' : ''}">${talkHtml(e.text, g)}</li>`).join('') || '<li><small>Nobody has said anything yet. Players who aren\'t in the room (like Claude) only hear what you send here.</small></li>';
  if (atBottom) talk.list.scrollTop = talk.list.scrollHeight;
  const last = lines.at(-1);
  if ((talk.open || talk.read < 0) && last) talk.read = last.i; // opening the page counts as having heard what came before
  const unread = lines.filter((e) => e.i > talk.read && !mine(e.text)).length;
  talk.latest.innerHTML = last ? talkHtml(last.text, g) : 'Table talk: tap to talk to the other players';
  talk.unread.hidden = !unread;
  talk.unread.textContent = String(unread);
  const prevLast = talk.el.dataset.last;
  if (last && prevLast !== String(last.i) && !mine(last.text) && last.private && navigator.vibrate) navigator.vibrate([60, 60, 60]);
  talk.el.dataset.last = last ? String(last.i) : '';
}

// ---------- wiring ----------

function wire(g: PublicState, me: Me) {
  bind('[data-tab]', (el) => {
    tab = tab === el.dataset.tab ? 'none' : (el.dataset.tab as typeof tab);
    render();
  });
  bind('[data-card]', (el) => {
    const id = el.dataset.card!;
    if (g.phase === 'discard') {
      const n = me.hand.length - me.handCap;
      if (selected.has(id)) selected.delete(id);
      else if (selected.size < n) selected.add(id);
    } else openCard = openCard === id ? null : id;
    render();
  });
  bind('[data-play]', (el) => send(`play ${el.dataset.play}`));
  bind('[data-build]', (el) => send(`build ${el.dataset.build}`));
  bind('[data-pickhex]', (el) => {
    const c = me.hand.find((x) => x.id === el.dataset.pickhex)!;
    const verb = c.kind === 'upgrade' ? 'upgrade' : 'build';
    picking = { title: `${c.kind === 'upgrade' ? 'Put' : 'Build'} ${c.name}${c.kind === 'upgrade' ? ' on…' : ' where?'}`, hexes: c.hexes, command: (h) => `${verb} ${c.id} ${h}` };
    render();
  });
  bind('[data-project]', (el) => {
    const p = me.projects.find((x) => x.key === el.dataset.project)!;
    picking = { title: `Build a ${p.name} (special project) where?`, hexes: p.hexes, command: (h) => `project ${p.key} ${h}` };
    render();
  });
  bind('[data-egg]', (el) => send(`project ${el.dataset.egg}`));
  app.querySelectorAll<SVGElement>('[data-hex]').forEach((el) => (el.onclick = () => {
    const cmd = picking!.command(el.dataset.hex!);
    picking = null;
    render();
    send(cmd);
  }));
  // Leafing through the hand from an open card.
  bind('[data-zoomnav]', (el) => {
    const i = me.hand.findIndex((c) => c.id === openCard);
    openCard = me.hand[(i + Number(el.dataset.zoomnav) + me.hand.length) % me.hand.length].id;
    render();
  });
  // Tapping outside an open card closes it.
  const zoomEl = document.getElementById('zoom');
  if (zoomEl) zoomEl.onclick = (e) => {
    if (e.target !== zoomEl) return;
    openCard = null;
    render();
  };
  on('cancelpick', () => {
    picking = null;
    render();
  });
  on('end', () => send('end'));
  bind('[data-accept]', (el) => send(`accept ${el.dataset.accept}`));
  bind('[data-decline]', (el) => send(`decline ${el.dataset.decline}`));
  bind('[data-cancel]', (el) => send(`cancel ${el.dataset.cancel}`));
  // bank
  bind('[data-bank]', (el) => {
    const [side, r] = el.dataset.bank!.split(' ');
    bank[side as 'give' | 'get'] = r;
    render();
  });
  bind('[data-btimes]', (el) => {
    bank.times = Math.max(1, bank.times + Number(el.dataset.btimes));
    render();
  });
  on('bankgo', () => send(`bank ${bank.give} ${bank.get} ${bank.times}`));
  // trade
  bind('[data-to]', (el) => {
    trade.to = Number(el.dataset.to);
    render();
  });
  bind('[data-step]', (el) => {
    const [side, r, d] = el.dataset.step!.split(' ');
    const m = side === 'give' ? trade.give : trade.get;
    m[r] = Math.max(0, (m[r] ?? 0) + Number(d));
    render();
  });
  bind('[data-tcard]', (el) => {
    const id = el.dataset.tcard!;
    if (trade.cards.has(id)) trade.cards.delete(id);
    else trade.cards.add(id);
    render();
  });
  on('offer', () => {
    const side = (m: Record<string, number>, cards: string[] = []) => [...RESOURCES.filter((r) => m[r]).map((r) => `${m[r]} ${r}`), ...cards].join(' ');
    const cmd = `offer P${trade.to + 1} give ${side(trade.give, [...trade.cards])} get ${side(trade.get)}`;
    trade = fresh();
    tab = 'none';
    send(cmd);
  });
  // raid
  bind('[data-vote]', (el) => send(`vote ${el.dataset.vote}`));
  bind('[data-commit]', (el) => {
    const cur = new Set(g.raid!.commits[me.seat]);
    const id = el.dataset.commit!;
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    send(`commit ${[...cur].join(' ') || 'none'}`);
  });
  on('ready', () => send('ready'));
  on('fight', () => send('fight'));
  on('bail', () => send('bail'));
  on('discard', () => send(`discard ${[...selected].join(' ')}`));
  on('newgame', () => leaveToJoin(''));
}

function toast(e: unknown) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = e instanceof Error ? e.message : String(e);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

boot().catch(toast);
