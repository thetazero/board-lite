// The phone: one player's hidden hand and their choices. Everything public
// is on the TV, so this stays small: resources, cards, and the decision at hand.

import type { CardView, PublicState, SeatState, Snapshot, TargetView } from '../src/state.ts';
import {
  ELEMENT_COLORS, PLAYER_COLORS, POINTS_TO_WIN, RESOURCES, STAGE_LABEL, buildingIcon, dragonBadge, dragonChip, dragonLabel as dragonName, elemIcon, esc, foeStack, hpBar, icon, powerTag, iconText, hexCenter, incomeText, mapSvg, named, playerTag, post, resChips, resIcon, standingsHtml, tiebreakNote, watch,
} from './common.ts';
import { ART_DEFS, cardArt, frameColor, glyph, kindIcon, stageFigure, tableScene, towerToken, winnerScene } from './art.ts';

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
// Picking a hex: what for (`about`: what's being placed, shown under the map).
let picking: { title: string; hexes: string[]; command: (hex: string) => string; labels?: Record<string, string>; about: string } | null = null;
// Clearing fauna: the beast's hex, and the dragons picked to send against it.
let hunting: { hex: string; chosen: Set<string> } | null = null;
let openCard: string | null = null;
let selected = new Set<string>(); // discard picks
let trade = fresh();
let bank = { give: 'stone', get: 'gold', times: 1 };
let busy = false;
let menu = false; // the menu under your name (Quit game) is open
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
  // The seat this phone holds comes back on its own: a reload, a closed tab, a
  // phone that slept. A room's address (the TV's QR code) for another room
  // wins over a seat remembered from an earlier game.
  try {
    const saved = JSON.parse(localStorage.getItem('seat') ?? 'null');
    if (saved?.code && saved?.token && (!code || code === saved.code)) {
      const r = await fetch(`/api/rooms/${saved.code}?token=${saved.token}`);
      if (r.ok && (await r.json()).seated) return enter(saved.code, saved.token);
    }
  } catch { /* fall through to the join form */ }
  renderJoin();
}

type RoomInfo = { lobby: Snapshot['lobby'] } | null;
const roomInfo = (c: string): Promise<RoomInfo> => fetch(`/api/rooms/${c}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

// The join form. Opened from a room's address (the QR code on the TV), it asks
// only for a name; a game that has started instead shows the seats a player
// can take back. What was typed survives a failed join, so a wrong code
// doesn't cost the name too.
// `news` says what just happened to this phone (you quit, you were removed).
async function renderJoin(err = '', typed?: { code: string; name: string }, news = '') {
  const name = typed?.name ?? localStorage.getItem('name') ?? '';
  const c = typed?.code ?? code;
  const room = /^[A-Za-z]{4}$/.test(c) ? await roomInfo(c.toUpperCase()) : null;
  if (room?.lobby.started) return renderSeats(room.lobby, err, name, news);
  const known = !!room; // the room is there: no code to type
  app.innerHTML = `
    <div class="joinpage">
      <div class="hero">${tableScene(PLAYER_COLORS.slice(0, 3), 360, 200)}<h1 class="title">board-lite</h1></div>
      <form class="joinform" id="join">
        ${news ? `<p class="news">${esc(news)}</p>` : ''}
        <p class="subtitle">Wizards raise dragons. First to ${iconText(`${POINTS_TO_WIN} points`)} wins.</p>
        ${known ? `<p class="roomline">Room <b>${esc(room!.lobby.code)}</b></p><input id="code" type="hidden" value="${esc(room!.lobby.code)}">`
          : `<label><span>Room code <small>on the TV</small></span><input id="code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" value="${esc(c)}" required></label>`}
        <label>Your name <input id="name" maxlength="12" autocomplete="nickname" value="${esc(name)}" required></label>
        <button class="primary big" type="submit">Join</button>
        <p class="error">${esc(err)}</p>
      </form>
    </div>`;
  wireJoin();
}

function wireJoin() {
  const form = document.getElementById('join') as HTMLFormElement | null;
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const c = (document.getElementById('code') as HTMLInputElement).value.trim().toUpperCase();
    const n = (document.getElementById('name') as HTMLInputElement).value.trim();
    await join(c, n, n);
  };
}

// `name` is a new player's name, or the name of the seat being taken back.
async function join(c: string, name: string, typed: string) {
  code = c;
  try {
    const r = await post(`/api/rooms/${c}/join`, { name });
    localStorage.setItem('name', name);
    localStorage.setItem('seat', JSON.stringify({ code: c, token: r.token }));
    enter(c, String(r.token));
  } catch (er) {
    renderJoin(er instanceof Error ? er.message : String(er), { code: c, name: typed });
  }
}

// A game that has started: tap your name to take your seat back (after closing
// the tab, on another phone, or after quitting). A seat with someone at it
// isn't offered. A saved game hosted again also has open seats: join those
// with a name.
function renderSeats(l: Snapshot['lobby'], err: string, name: string, news = '') {
  const free = l.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'player' && (s.left || !s.connected));
  const open = l.seats.some((s) => s.kind === 'open');
  const seats = free.map(({ s, i }) => `<button class="seatbtn" data-seat="${esc(s.name)}" style="--pc:${PLAYER_COLORS[i]}">${towerToken(PLAYER_COLORS[i], 1.8)}<span>${esc(s.name)}</span><span class="tag">${s.left ? 'Quit' : 'Away'}</span></button>`).join('');
  app.innerHTML = `
    <div class="joinpage">
      <div class="hero">${tableScene(l.seats.map((_, i) => PLAYER_COLORS[i]), 360, 200)}<h1 class="title">board-lite</h1></div>
      <div class="joinform seats">
        ${news ? `<p class="news">${esc(news)}</p>` : ''}
        <p class="roomline">Room <b>${esc(l.code)}</b>: the game has started.</p>
        ${free.length ? `<p>Tap your name to take your seat back.</p><div class="seatlist">${seats}</div>` : open ? '' : '<p>Every seat is taken.</p>'}
        ${open ? `<form id="join" class="joinform inner"><p>${free.length ? 'Or take' : 'Take'} an open seat:</p><input id="code" type="hidden" value="${esc(l.code)}">
          <label>Your name <input id="name" maxlength="12" autocomplete="nickname" value="${esc(name)}" required></label>
          <button class="primary big" type="submit">Join</button></form>` : ''}
        <p class="error">${esc(err)}</p>
      </div>
    </div>`;
  app.querySelectorAll<HTMLElement>('[data-seat]').forEach((b) => (b.onclick = () => join(l.code, b.dataset.seat!, name)));
  wireJoin();
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
  if (s.seat < 0) return leaveToJoin('Someone else has your seat now.');
  if (!s.you) return leaveToJoin('You are not in this game.');
  // Reset per-decision UI when the situation changes under us.
  const key = (x: Snapshot | null) => `${x?.game?.phase}|${x?.game?.turn}|${x?.game?.raid?.step}|${x?.game?.round}`;
  if (key(prev) !== key(s)) {
    picking = null;
    hunting = null;
    selected = new Set();
    openCard = null;
    if (s.game.phase !== 'action') trade = fresh();
  }
  // The TV is playing a scene (a fight, the round's roll): the whole table
  // watches it, and the next decision waits until it's over. Nothing that
  // changed shows yet, so the phone doesn't give the ending away.
  if (s.scene > 0) {
    renderWatch(s.you);
    renderTalk();
    return;
  }
  if (navigator.vibrate && s.you.deciding && !(prev?.you?.deciding && !prev.scene)) navigator.vibrate(120);
  noteDeals(s.you.hand.map((c) => c.id));
  render();
  renderTalk();
}

function renderWatch(me: Me) {
  document.body.classList.remove('has-hand', 'raiding', 'hand-below');
  app.innerHTML = `<div class="watchtv" style="--pc:${PLAYER_COLORS[me.seat]}"><span class="pname">${esc(me.name)}</span><h1>Watch the TV</h1></div>`;
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
  document.body.classList.remove('has-hand', 'hand-below', 'raiding');
  document.body.style.removeProperty('--hs');
  renderJoin('', undefined, msg);
}

// ---------- lobby ----------

function renderLobby() {
  const l = snap!.lobby;
  const me = seatIndex();
  const first = me === 0;
  const pc = PLAYER_COLORS[me] ?? '#888';
  // Your tower in your colour stands at the front: that's your colour for the game.
  app.innerHTML = `
    <div class="plobby" style="--pc:${pc}">
      <div class="hero">${tableScene([pc])}</div>
      <h1>You're in, ${esc(l.seats[me]?.name ?? '')}!</h1>
      <p class="muted">Room <b>${esc(l.code)}</b></p>
      <ul class="seatlist">${l.seats.map((s, i) => `<li class="${i === me ? 'me' : ''}" style="--pc:${PLAYER_COLORS[i]}">${towerToken(PLAYER_COLORS[i], 1.8)}<span>${esc(s.name)}</span>${s.kind === 'bot' ? '<span class="tag">bot</span>' : ''}</li>`).join('')}</ul>
      ${first ? `<button id="start" class="primary big" ${l.seats.length >= l.minPlayers ? '' : 'disabled'}>Start game</button>
        <button id="bot" ${l.seats.length >= l.maxPlayers ? 'disabled' : ''}>Add a bot</button>`
      : '<p class="hint">The first player or the TV starts the game.</p>'}
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
    return `<div class="res${me.resources[r] ? '' : ' zero'}"><div>${resIcon(r, 1.9)}<b>${me.resources[r]}</b></div><small class="inc${sign}" title="each round">${iconText(incomeText(inc), 1)}</small></div>`;
  }).join('');
  // Points held as cards in the hand count too: shown as a card with how many.
  const hidden = me.hiddenPoints ? `<small class="hiddenpts">${icon('cards', 1.1)}${me.hiddenPoints}${icon('points', 0.9)}</small>` : '';
  // Name, points and resources stay on screen together while the page scrolls.
  return `
    <div class="mehead" style="--pc:${PLAYER_COLORS[me.seat]}">
      <header class="me">
        <span class="pname">${esc(me.name)}</span>
        <span class="pts">${icon('points', 1.4)}${me.totalPoints} <small>/ ${g.pointsToWin}</small>${hidden}</span>
        <button id="menu" class="ghost menubtn" aria-label="Menu" aria-expanded="${menu}">⋯</button>
      </header>
      <div class="resbar">${res}</div>
    </div>`;
}

// The one line that says what's going on. The screen below doesn't say it again.
function status(g: PublicState, me: Me): string {
  if (g.phase === 'over') return `<div class="status you"><span>${g.winner === me.seat ? 'You win!' : `${playerTag(g.winner!, names)} wins`}</span></div>`;
  if (me.deciding) {
    let what = '';
    if (g.phase === 'action') what = me.myTurn ? 'Your turn' : 'An offer for you';
    else if (g.phase === 'discard') what = `Discard ${me.hand.length - me.handCap} <span class="over">${icon('cards', 1.2)}${me.hand.length}/${me.handCap}</span>`;
    else if (g.phase === 'cards') what = `Keep 1 ${icon('cards', 1.2)}`;
    else if (g.raid?.step === 'vote') what = `${icon('raid', 1.3)} Vote`;
    else if (g.raid?.step === 'commit') what = `${icon('raid', 1.3)} ${esc(g.raid.target!.name)} <span class="tag">${icon('public', 1.1)}</span>`;
    else what = `${icon('raid', 1.3)} ${esc(g.raid!.target!.name)} <span class="tag">${icon('secret', 1.1)}</span>`;
    return `<div class="status you"><span>${what}</span></div>`;
  }
  const tags = g.waitingOn.map((p) => playerTag(p, names));
  const w = tags.length < 2 ? tags.join('') : `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]}`;
  if (g.phase === 'action') return `<div class="status"><span>${playerTag(g.turn, names)}'s turn</span></div>${away(g)}`;
  return `<div class="status"><span>Waiting for ${w || 'the table'}.</span></div>${away(g)}`;
}

// The menu under your name: quitting is there, out of the way of the game.
function menuSheet(): string {
  return `<div class="menuback" id="menuclose"></div><div class="menu"><h3>Quit game</h3>
    <p>A bot plays your seat for the rest of the game, as little as it can. To come back, open the room's address and tap your name.</p>
    <div class="row"><button id="quit" class="danger">Quit game</button><button id="menucancel">Cancel</button></div></div>`;
}

// The table waits on someone whose phone is gone (closed, asleep, out of
// Wi-Fi): anyone may let a bot play for them, so the game doesn't stall. Their
// phone coming back hands the seat back to them.
function away(g: PublicState): string {
  const seats = snap!.lobby.seats;
  return g.waitingOn.filter((p) => seats[p]?.kind === 'player' && !seats[p].connected && !seats[p].standIn)
    .map((p) => `<div class="awayline"><span>${playerTag(p, names)} is away.</span><button class="small" data-standin="${p}">Let a bot play</button></div>`).join('');
}

function render() {
  const g = snap!.game!;
  const me = snap!.you!;
  let body = '';
  // Choosing a hex or the dragons to send is a choice of its own: the hand steps aside for it.
  const choosing = !!picking || !!(hunting && g.phase === 'action' && me.myTurn);
  if (picking) body = hexPicker(g);
  else if (choosing) body = huntView(g, me);
  else if (g.phase === 'over') body = gameOver(g, me);
  else if (g.phase === 'discard') body = me.deciding ? discardView(me) : '';
  else if (g.phase === 'raid') body = raidView(g, me);
  else if (g.phase === 'cards') body = me.choice.length ? keepView(me) : '';
  else body = actionView(g, me);
  const den = !picking && (g.phase === 'action' || g.phase === 'discard') ? roost(g, me) : '';
  const open = !picking && g.phase !== 'discard' ? me.hand.find((c) => c.id === openCard) : undefined;
  const zoom = open ? cardZoom(open, me, me.myTurn && g.phase === 'action') : '';
  // The hand is held along the bottom edge whenever cards matter: your turn, others' turns, discarding.
  const dock = !choosing && g.phase !== 'over' ? handFan(me, me.myTurn && g.phase === 'action', g.phase === 'discard' && me.deciding, tradeOpen(g, me)) : '';
  document.body.classList.toggle('has-hand', !!dock);
  document.body.classList.toggle('raiding', g.phase === 'raid');
  // Picking a hex is always on your turn: the ribbon saying so gives the map its room.
  app.innerHTML = g.phase === 'over' && !picking ? body : `${header(g, me)}${picking ? '' : status(g, me)}<main class="pbody">${den}${body}</main>${dock}${zoom}${menu ? menuSheet() : ''}`;
  fitHand();
  fitMap(g);
  wire(g, me);
}

// The hand grows into the free screen below the buttons, so a turn with nothing
// open isn't a few buttons up top, the cards at the bottom and nothing between.
// It never shrinks below its usual size, and a card never gets wider than about
// two fifths of the screen. When the page is too long for the hand to fit below
// it (an open panel, a long choice, a short screen), the hand stops being held
// along the bottom edge and sits after the page instead, so it never covers
// what's above it: scroll down to it.
function fitHand() {
  const fan = app.querySelector<HTMLElement>('.handfan:not(.empty)');
  const main = app.querySelector<HTMLElement>('.pbody');
  document.body.classList.remove('hand-below');
  if (!fan || !main) return document.body.style.removeProperty('--hs');
  const em = parseFloat(getComputedStyle(document.body).fontSize);
  const width = Math.min(innerWidth, 34 * em);
  const top = main.getBoundingClientRect().bottom + scrollY; // where the page's content ends
  const room = innerHeight - top - 3.9 * em - 0.6 * em; // down to the talk bar, a little air above the cards
  const byHeight = room / (9.4 * em);
  const byWidth = (0.42 * width) / (6.6 * 0.78 * em);
  const hs = Math.max(1, Math.min(byHeight, byWidth));
  document.body.style.setProperty('--hs', hs.toFixed(3));
  document.body.classList.toggle('hand-below', byHeight < 1);
}
function refit() {
  if (!snap?.game || !snap.you) return;
  fitHand();
  fitMap(snap.game);
}
addEventListener('resize', refit);
document.fonts?.ready.then(refit); // the buttons' height changes once the web fonts are in

// The trade form is open, so tapping a card in the hand offers it.
function tradeOpen(g: PublicState, me: Me): boolean {
  return g.phase === 'action' && tab === 'trade' && !picking && me.hand.length > 0;
}

// Your dragons at home: one place in the roost per dragon you can house,
// empty places drawn as empty nests. The nests are the count: no "1/3".
const NEST = `<svg class="nest" viewBox="-12 -12 24 24" role="img" aria-label="room for a dragon"><title>room for a dragon</title>
  <path d="M-10 -1 Q0 3 10 -1 L8 5 Q0 10 -8 5 Z" fill="#8a5a32"/><path d="M-10 -1 Q0 -5 10 -1 Q0 3 -10 -1 Z" fill="#3b2a1c"/>
  <path d="M-9 1 L7 4 M-8 4 L9 1 M-6 6.5 L6 6" stroke="#c48a52" stroke-width="1" fill="none" stroke-linecap="round"/></svg>`;
function roost(g: PublicState, me: Me): string {
  const mine = g.dragons.filter((d) => d.owner === me.seat);
  const empty = Math.max(0, me.dragonCapacity - mine.length);
  if (!mine.length && !empty) return '';
  return `<section class="roost"><div class="nests">${mine.map((d) => dragonChip(d, g.dragons, g.round)).join('')}${NEST.repeat(empty)}</div></section>`;
}

// ---- action phase ----

function actionView(g: PublicState, me: Me): string {
  const incoming = g.offers.filter((o) => o.to === me.seat).map((o) => `
    <div class="offer in">${playerTag(o.from, names)} offers <b>${iconText(esc(o.give))}</b> ${o.get === 'nothing' ? 'for <b>nothing</b>' : `for your <b>${iconText(esc(o.get))}</b>`}
      <div class="row"><button class="primary" data-accept="${o.id}">Accept</button><button data-decline="${o.id}">Decline</button></div></div>`).join('');
  const mine = g.offers.filter((o) => o.from === me.seat).map((o) => `
    <div class="offer out">You offer ${playerTag(o.to, names)} <b>${iconText(esc(o.give))}</b> for <b>${iconText(esc(o.get))}</b> <button class="small" data-cancel="${o.id}">Withdraw</button></div>`).join('');
  // Build & bank and Trade open over the table and close again; the hand is always below.
  const tabs = `<nav class="tabs">
    ${me.myTurn ? `<button data-tab="more" class="${tab === 'more' ? 'on' : ''}">Build &amp; bank</button>` : ''}
    <button data-tab="trade" class="${tab === 'trade' ? 'on' : ''}">Trade</button></nav>`;
  const t = !me.myTurn && tab === 'more' ? 'none' : tab;
  const content = t === 'more' ? moreView(me) : t === 'trade' ? tradeView(g, me) : '';
  // Fauna anywhere on the map, and dragons fit to fight it: clearing is one tap away.
  const beasts = g.map.filter((h) => h.fauna && me.huntable.includes(h.k));
  const clear = me.myTurn && beasts.length && me.raidReady.length
    ? `<button id="hunt" class="huntbtn">${[...new Set(beasts.map((h) => h.fauna!.key))].map((k) => icon(k, 1.6)).join('')} Clear fauna</button>` : '';
  // An offer to you needs your answer before your turn can end.
  const end = !me.myTurn ? '' : incoming ? '<button id="end" class="primary big endturn" disabled>Answer the offer to end your turn</button>' : '<button id="end" class="primary big endturn">End turn</button>';
  // End turn sits above an open panel, so a long one (Build & bank runs past the
  // screen) never pushes it down under the hand.
  return `${incoming}${mine}${tabs}${clear}${end}${content}`;
}

// "1 dragon", "2 dragons".
const dragons = (n: number) => `${n} dragon${n === 1 ? '' : 's'}`;

const KIND_LABEL = { building: 'Building', upgrade: 'Upgrade', action: 'Action', dragon: 'Dragon' };

// What a card costs, with what you're short of marked.
function costChips(cost: CardView['cost'], me: Me): string {
  const parts = RESOURCES.filter((r) => (cost[r] ?? 0) > 0).map((r) => `<span class="chip${me.resources[r] < cost[r]! ? ' short' : ''}">${cost[r]}${resIcon(r, 1.15)}</span>`);
  return parts.join('');
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
    <div class="cart">${cardArt(c.kind, c.key, c.element, c.cls)}<span class="ckind">${cornerMark(c)}</span></div>
    <b class="cname">${esc(c.name)}</b>
    <div class="ccost">${costChips(c.cost, me)}</div>
  </div>`;
}

// A dragon card's text is its numbers: each life stage drawn small, named as
// the roost names it, with its health and attack, how fast it grows, and one sentence on how it picks targets.
function dragonStats(c: CardView): string {
  const d = c.dragon!;
  const rows = d.stages.map((st, i) => `<div class="drow"><span class="sfig">${stageFigure(c.key, c.element ?? 'fire', i)}<small>${STAGE_LABEL[i + 1]}</small></span><span>${glyph('health', 'health')}${st.hp}</span><span>${glyph('attack', 'attack')}${iconText(esc(st.attack))}</span></div>`).join('');
  const sentence = `${d.targeting[0].toUpperCase()}${d.targeting.slice(1)}.`;
  return `<div class="dstats">${rows}<div class="dgrow" title="Growth steps per life stage (a fed dragon grows a step each round)">${glyph('growth', 'growth steps per stage')}${d.growth} per stage</div></div><p class="ctext">${esc(sentence)}</p>`;
}

// A card tapped open: full size, its rule text, and how to play it.
function cardZoom(c: CardView, me: Me, playable: boolean): string {
  let actions = '';
  // Off your turn there's nothing to do with a card but read it; one you can't
  // afford shows its button greyed, the missing resources already red on the cost.
  if (c.needs === 'unplayable') actions = `<p class="hint">${esc(c.blocked ?? '')}</p>`;
  else if (!playable) actions = '';
  else if (c.blocked) actions = `<p class="blocked">${iconText(esc(c.blocked))}</p>`;
  else if (!c.affordable) actions = `<button class="primary big" disabled>${c.kind === 'dragon' ? 'Hatch' : c.kind === 'action' ? 'Play' : c.kind === 'upgrade' ? 'Upgrade' : 'Build'}</button>`;
  else if (c.needs === 'resource') actions = `<div class="row">${RESOURCES.filter((r) => r !== 'gold').map((r) => `<button class="iconbtn" data-play="${c.id} ${r}" aria-label="${r}">${resIcon(r, 1.9)}</button>`).join('')}</div>`;
  else if (c.needs === 'dragon') actions = `<div class="row">${c.dragons.map((id) => `<button data-play="${c.id} ${id}">${esc(dragonLabel(id))}</button>`).join('')}</div>`;
  else if (c.needs === 'hex') actions = `<button class="primary big" data-pickhex="${c.id}">${c.kind === 'upgrade' ? 'Upgrade' : c.fauna ? 'Place' : c.kind === 'action' ? 'Play' : 'Build'}</button>`;
  else if (c.kind === 'building') actions = `<button class="primary big" data-build="${c.id}">Build</button>`;
  else actions = `<button class="primary big" data-play="${c.id}">${c.kind === 'dragon' ? 'Hatch' : 'Play'}</button>`;
  return `<div class="zoom" id="zoom">
    <div class="card big k-${c.kind}" style="--kc:${frameColor(c.kind, c.element)}">
      <div class="cart">${cardArt(c.kind, c.key, c.element, c.cls)}<span class="ckind">${cornerMark(c)}</span></div>
      <b class="cname">${esc(c.name)}</b>
      <div class="ccost"><span>${costChips(c.cost, me)}</span><small>${KIND_LABEL[c.kind]}</small></div>
      ${c.dragon ? dragonStats(c) : `${c.fauna ? foeStack([c.fauna], 1.6) : ''}<p class="ctext">${iconText(esc(c.text))}</p>`}
    </div>
    <div class="zoomacts">${actions}</div>
    ${me.hand.length > 1 ? `<div class="zoomnav"><button class="ghost" data-zoomnav="-1" aria-label="Previous card">‹</button><span>${me.hand.indexOf(c) + 1} / ${me.hand.length}</span><button class="ghost" data-zoomnav="1" aria-label="Next card">›</button></div>` : ''}
  </div>`;
}

// The hand, held like real cards: fanned along the bottom edge of the screen,
// overlapping when there are many. On your turn the cards you can play now glow.
function handFan(me: Me, playable: boolean, discarding: boolean, offering = false): string {
  const n = me.hand.length;
  if (!n) return '<div class="handfan empty"></div>';
  const mid = (n - 1) / 2;
  const tilt = Math.min(6, 36 / n); // degrees between neighbours
  const cards = me.hand.map((c, i) => {
    const d = i - mid;
    const ready = playable && c.affordable && !c.blocked && c.needs !== 'unplayable';
    // --x: offset from the centre as a share of the spread; --r: tilt; --y: the arc's drop.
    const pos = `--x:${n > 1 ? d / mid : 0};--r:${(d * tilt).toFixed(1)}deg;--y:${(Math.abs(d) * Math.abs(d) * tilt * 0.22).toFixed(1)}px;z-index:${i + 1}`;
    return cardFace(c, me, playable, `${pos}`, `${ready && !offering ? ' ready' : ''}${offering && trade.cards.has(c.id) ? ' offered' : ''}${c.name.length >= 10 ? ' longname' : ''}`);
  }).join('');
  return `<div class="handfan${discarding ? ' discarding' : ''}${offering ? ' offering' : ''}" style="--n:${n}">${cards}</div>`;
}

function dragonLabel(id: string): string {
  const d = snap!.game!.dragons.find((x) => x.id === id);
  return d ? `${dragonName(d, snap!.game!.dragons)} (${STAGE_LABEL[d.stage].toLowerCase()}${d.stage ? `, ${d.hp}/${d.maxHp}` : ''})` : id;
}

function moreView(me: Me): string {
  const basics = me.basics.map((b) => {
    const ok = b.affordable && b.hexes.length;
    return `<div class="proj${ok ? '' : ' dim'}">${buildingIcon(b.key, 22, '#4a3d45', b.cls)}<b>${esc(b.name)}</b> ${resChips(b.cost)}
      <button data-basic="${b.key}" ${ok ? '' : 'disabled'}>Build</button></div>`;
  }).join('');
  const egg = me.eggProject;
  const eggOk = egg.affordable && egg.room;
  const eggs = egg.elements.map((e) => `<button class="elembtn iconbtn" style="--ec:${ELEMENT_COLORS[e]}" data-egg="${e}" aria-label="${e} egg" ${eggOk ? '' : 'disabled'}>${elemIcon(e, 1.9)}</button>`).join('');
  // Pick a resource by tapping its icon.
  const pick = (side: 'give' | 'get', sel: string) => `<div class="respick">${RESOURCES.map((r) => `<button class="iconbtn${sel === r ? ' on' : ''}" data-bank="${side} ${r}" aria-label="${r}" aria-pressed="${sel === r}">${resIcon(r, 1.8)}</button>`).join('')}</div>`;
  return `
    <section class="panel"><h3>Basic buildings</h3>${basics}</section>
    <section class="panel"><h3>Special projects</h3>
      <div class="proj${eggOk ? '' : ' dim'}"><b>Base dragon egg</b> ${resChips(egg.cost)}</div>
      <div class="row">${eggs}</div>${egg.room ? '' : '<p class="blocked">No room for another dragon: build a roost first.</p>'}</section>
    <section class="panel"><h3>Bank</h3>
      <div class="bankrow"><span>Give</span>${pick('give', bank.give)}</div>
      <div class="bankrow"><span>Get</span>${pick('get', bank.get)}</div>
      <div class="bank"><span class="stepper"><button data-btimes="-1">−</button><b>${bank.times}</b><button data-btimes="1">+</button></span>
        <button id="bankgo" class="primary" ${me.resources[bank.give as 'stone'] >= me.bankRate * bank.times && bank.give !== bank.get ? '' : 'disabled'}>Trade <span class="chip">${me.bankRate * bank.times}${resIcon(bank.give, 1.25)}</span>→<span class="chip">${bank.times}${resIcon(bank.get, 1.25)}</span></button></div></section>`;
}

function stepper(side: 'give' | 'get', r: string, n: number, max: number): string {
  return `<span class="stepper"><button data-step="${side} ${r} -1" ${n <= 0 ? 'disabled' : ''}>−</button><b>${n}</b><button data-step="${side} ${r} 1" ${n >= max ? 'disabled' : ''}>+</button></span>`;
}

function tradeView(g: PublicState, me: Me): string {
  // On your turn you can offer anyone; otherwise only the player whose turn it is.
  const others = me.myTurn ? names.map((_, i) => i).filter((i) => i !== me.seat) : [g.turn];
  if (!others.includes(trade.to)) trade.to = others[0];
  const who = others.map((i) => `<button data-to="${i}" class="${trade.to === i ? 'on' : ''}" style="--pc:${PLAYER_COLORS[i]}">${esc(names[i])}</button>`).join('');
  // One row per resource: what you give and what you get side by side.
  const rows = RESOURCES.map((r) => `${resIcon(r, 1.4)}${stepper('give', r, trade.give[r] ?? 0, me.resources[r])}${stepper('get', r, trade.get[r] ?? 0, 99)}`).join('');
  // Cards are offered from the hand itself, the same cards as everywhere: tapped
  // ones rise out of the fan and are named here.
  const offered = me.hand.filter((c) => trade.cards.has(c.id));
  const cards = me.hand.length
    ? `<p class="tpick">${offered.length ? `${icon('cards', 1.2)} ${offered.map((c) => `<b>${esc(c.name)}</b>`).join(', ')}` : '<small>Tap cards in your hand to offer them too.</small>'}</p>`
    : '';
  const any = Object.values(trade.give).some(Boolean) || trade.cards.size || Object.values(trade.get).some(Boolean);
  return `
    <section class="panel trade">
      <h3>Offer a trade to</h3><div class="row who">${who}</div>
      <div class="tgrid"><span></span><h3>You give</h3><h3>You get</h3>${rows}</div>
      ${cards}
      <button id="offer" class="primary" ${any ? '' : 'disabled'}>Send offer</button>
    </section>`;
}

// Sending dragons against one beast: the beast drawn as a raid's defenders
// are, with its loot; your fit dragons to pick from, as for a raid.
function huntView(g: PublicState, me: Me): string {
  const h = g.map.find((x) => x.k === hunting!.hex);
  if (!h?.fauna) return '';
  const list = me.raidReady.map((id) => {
    const d = g.dragons.find((x) => x.id === id)!;
    return `<button class="dragon${hunting!.chosen.has(id) ? ' on' : ''}" data-hunter="${id}">${dragonBadge(d, 40)}<span><b>${esc(dragonName(d, g.dragons))}</b><br>${STAGE_LABEL[d.stage]} ${powerTag(d.power)} <span class="stat">${glyph('health', 'health')}${d.hp}</span> <span class="stat">${glyph('attack', 'attack')}${iconText(esc(d.attack))}</span></span></button>`;
  }).join('');
  const on = h.building ? ` on ${h.building.owner === me.seat ? 'your' : `${playerTag(h.building.owner, names)}'s`} ${esc(h.building.name)}` : '';
  const n = hunting!.chosen.size;
  const sent = [...hunting!.chosen].reduce((s, id) => s + (g.dragons.find((x) => x.id === id)?.power ?? 0), 0);
  // A great beast pays in points, for good; it's 1 try each round, to the end.
  const great = h.fauna.points !== undefined;
  const prize = great ? iconText(`${h.fauna.points} point`, 1.4) : resChips(h.fauna.loot, 1.4);
  return `<h3 class="huntname">${great ? 'Slay' : 'Clear'} the ${esc(h.fauna.name)}${on}</h3><section class="ptarget">${powerTag(h.fauna.power, 'big')}${foeStack([h.fauna], 1.8)}<div class="loot">${prize}</div></section>
    ${list}
    <p class="hint">Dragons you send sit out this round's raids.${great ? ' You get 1 try each round.' : ''}</p>
    <div class="row big2"><button id="huntgo" class="primary big" ${n ? '' : 'disabled'}>${icon('raid', 1.3)} ${n ? `Send ${dragons(n)} ${powerTag(sent)}` : 'Send'}</button><button id="huntoff" class="big ghost">Cancel</button></div>`;
}

// Picking a hex: the map, what you're placing and Cancel, on one screen. The
// map takes all the height the rest leaves (fitMap), so it isn't a small map
// up top with a third of the screen empty under it.
function hexPicker(g: PublicState): string {
  return `<section class="picker"><h3>${esc(picking!.title)}</h3>
    <div class="pmap">${mapSvg(g.map, { size: MAP_SIZE, selectable: picking!.hexes, labels: picking!.labels })}</div>
    ${picking!.about}
    <button id="cancelpick" class="ghost big">Cancel</button></section>`;
}

// What a pick is for, under the map: the card (or basic building) being placed,
// small, with its rule text, so the numbers on the hexes have their reason in view.
function pickAbout(art: string, name: string, text: string, color: string): string {
  return `<div class="pabout" style="--kc:${color}"><span class="pabart">${art}</span><span><b>${esc(name)}</b><small>${iconText(esc(text))}</small></span></div>`;
}

const MAP_SIZE = 40;
const SIDEWAYS = '(orientation: landscape) and (max-height: 600px)'; // as in style.css
// The picker's map fills the room below the page's content, down to the talk
// bar. Where the hexes to pick sit in one part of the map, it zooms in on them
// (with a sliver of what lies around them) as far as the room allows; where
// they're spread over all of it, it shows all of it but the outer sea. It never
// shrinks below a screen's worth, so a short or sideways screen scrolls to it instead.
function fitMap(g: PublicState) {
  const svg = app.querySelector<SVGSVGElement>('.pmap svg');
  const main = app.querySelector<HTMLElement>('.pbody');
  if (!svg || !main || !picking) return;
  const box = svg.parentElement!;
  const pad = parseFloat(getComputedStyle(box).paddingTop) + parseFloat(getComputedStyle(box).paddingBottom);
  svg.style.height = '0px';
  // Sideways, the map stands beside the rest (style.css), taking up to three fifths of the width.
  const beside = matchMedia(SIDEWAYS).matches;
  const w = beside ? 0.6 * box.parentElement!.clientWidth - pad : box.clientWidth - pad;
  const free = innerHeight - parseFloat(getComputedStyle(document.body).paddingBottom) - (main.getBoundingClientRect().bottom + scrollY);
  // The least it gets: what shows between the header (it stays put) and the talk bar, scrolled to.
  const head = app.querySelector<HTMLElement>('.mehead')?.offsetHeight ?? 0;
  const screen = innerHeight - head - parseFloat(getComputedStyle(document.body).paddingBottom) - pad - 8;
  const h = Math.max(free, Math.min(0.7 * w, screen));
  const bounds = (keys: Set<string> | null, mx: number, my = mx) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const hx of g.map) {
      if (keys && !keys.has(hx.k)) continue;
      const [x, y] = hexCenter(hx.q, hx.r, MAP_SIZE);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x0: x0 - mx, x1: x1 + mx, y0: y0 - my, y1: y1 + my };
  };
  const all = bounds(null, MAP_SIZE * 1.1); // as mapSvg frames it
  const picks = picking.hexes.length ? bounds(new Set(picking.hexes), MAP_SIZE, MAP_SIZE * 1.3) : all; // the picks whole, a sliver around
  // At least about six hexes across and five rows down, so a lone pick still shows where it is.
  const tw = Math.max(picks.x1 - picks.x0, MAP_SIZE * 10.4), th = Math.max(picks.y1 - picks.y0, MAP_SIZE * 8);
  const W = all.x1 - all.x0, H = all.y1 - all.y0;
  const s = Math.max(Math.min(w / tw, h / th), Math.min(w / W, h / H)); // px per map unit
  const vh = Math.min(H, h / s);
  // Beside the panel, width the map can't fill goes to the panel instead.
  const vw = Math.min(W, w / s, beside ? Math.max(tw, vh) : Infinity);
  const clamp = (c: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, c));
  const cx = clamp((picks.x0 + picks.x1) / 2, all.x0 + vw / 2, all.x1 - vw / 2);
  const cy = clamp((picks.y0 + picks.y1) / 2, all.y0 + vh / 2, all.y1 - vh / 2);
  svg.setAttribute('viewBox', `${cx - vw / 2} ${cy - vh / 2} ${vw} ${vh}`);
  svg.style.width = `${vw * s}px`;
  svg.style.height = `${vh * s}px`;
}

// ---- raid ----

// The kingdom under attack, drawn: its defenders by kind and its loot.
function targetPanel(t: TargetView): string {
  return `<section class="ptarget">${powerTag(t.power, 'big')}${foeStack(t.units, 1.8)}<div class="loot">${resChips(t.loot, 1.4)}</div></section>`;
}

// Each raid step is its choices as buttons. A choice once made stays on screen,
// lit, so the screen shows what you chose instead of saying it. The target is
// always drawn, so you decide looking at what you'd be fighting.
function raidView(g: PublicState, me: Me): string {
  const raid = g.raid!;
  const dragon = (id: string) => g.dragons.find((d) => d.id === id)!;
  const sum = (ids: string[]) => ids.reduce((s, id) => s + dragon(id).power, 0);
  if (raid.step === 'vote') {
    const voted = me.myVote !== null;
    return `${roost(g, me)}${raid.candidates.map((t, i) => `
      <button class="choice${me.myVote === i ? ' on' : ''}" data-vote="${i + 1}" ${voted ? 'disabled' : ''}><b>${i + 1}. ${esc(t.name)} ${powerTag(t.power, 'big')}</b>${foeStack(t.units, 1.7)}<span class="loot">${resChips(t.loot, 1.3)}</span></button>`).join('')}`;
  }
  if (raid.step === 'commit') {
    if (!me.raidReady.length) return `${roost(g, me)}${targetPanel(raid.target!)}`; // nobody fit to go: the roost shows why
    const committed = new Set(raid.commits[me.seat]);
    const ready = raid.ready[me.seat];
    const list = me.raidReady.map((id) => {
      const d = dragon(id);
      return `<button class="dragon${committed.has(id) ? ' on' : ''}" data-commit="${id}" ${ready ? 'disabled' : ''}>${dragonBadge(d, 40)}<span><b>${esc(dragonName(d, g.dragons))}</b><br>${STAGE_LABEL[d.stage]} ${powerTag(d.power)} <span class="stat">${glyph('health', 'health')}${d.hp}</span> <span class="stat">${glyph('attack', 'attack')}${iconText(esc(d.attack))}</span></span></button>`;
    }).join('');
    const hint = !ready && !committed.size ? '<p class="hint"><small>Tap dragons to send them.</small></p>' : '';
    return `${targetPanel(raid.target!)}${list}${hint}${ready ? '' : `<button id="ready" class="primary big">${committed.size ? `Send ${dragons(committed.size)} ${powerTag(sum(raid.commits[me.seat]))}` : `${buildingIcon('roost', 22, '#fff')} Stay home`}</button>`}`;
  }
  if (raid.step === 'bail') {
    const mine = raid.commits[me.seat];
    // Who else is going, and with what: the more dragons fight, the fewer hits each takes.
    const others = g.players.flatMap((_, p) => (p !== me.seat && raid.commits[p].length
      ? [`<div class="ally">${playerTag(p, names)} ${raid.commits[p].map((id) => dragonBadge(dragon(id), 34)).join('')} ${powerTag(sum(raid.commits[p]))}</div>`] : [])).join('');
    if (!mine.length) return `${roost(g, me)}${targetPanel(raid.target!)}${others ? `<div class="allies">${others}</div>` : ''}`;
    const sent = mine.map((id) => dragonChip(dragon(id), g.dragons, g.round)).join('');
    const chose = me.myChoice;
    return `${targetPanel(raid.target!)}
      <div class="sent">${sent}${powerTag(sum(mine))}</div>
      ${others ? `<div class="allies">${others}</div>` : ''}
      <div class="row big2"><button id="fight" class="primary big${chose === 'fight' ? ' on' : ''}" ${chose ? 'disabled' : ''}>${icon('raid', 1.3)} Fight<small>${resChips(raid.target!.loot, 1.1)}</small></button>
      <button id="bail" class="big${chose === 'bail' ? ' on' : ''}" ${chose ? 'disabled' : ''}>${buildingIcon('roost', 26, '#4a3d45')} Bail</button></div>`;
  }
  return '';
}

// ---- cards: keep one of the two building cards drawn ----

function keepView(me: Me): string {
  const cards = me.choice.map((c) => `
    <div class="keepone">
      <div class="card big k-${c.kind}" style="--kc:${frameColor(c.kind, c.element)}">
        <div class="cart">${cardArt(c.kind, c.key, c.element, c.cls)}<span class="ckind">${cornerMark(c)}</span></div>
        <b class="cname">${esc(c.name)}</b>
        <div class="ccost"><span>${costChips(c.cost, me)}</span><small>${KIND_LABEL[c.kind]}</small></div>
        <p class="ctext">${iconText(esc(c.text))}</p>
      </div>
      <button class="primary" data-keep="${c.id}">Keep</button>
    </div>`).join('');
  return `<div class="keeprow">${cards}</div>`;
}

// ---- discard / end ----

function discardView(me: Me): string {
  const n = me.hand.length - me.handCap;
  return `<button id="discard" class="primary big" ${selected.size === n ? '' : 'disabled'}>Discard ${selected.size}/${n}</button>`;
}

// The end: the winner's moment, then where everyone finished. Nothing from the
// game in progress (resources, income, the last decision) is left on screen.
function gameOver(g: PublicState, me: Me): string {
  const w = g.standings![0].p;
  const mine = g.standings!.find((s) => s.p === me.seat)!;
  const place = ['1st', '2nd', '3rd', '4th', '5th', '6th'][mine.place - 1];
  const note = tiebreakNote(g);
  return `<div class="pover" style="--pc:${PLAYER_COLORS[w]}">
    <div class="hero">${winnerScene(PLAYER_COLORS[w], g.players.map((_, i) => PLAYER_COLORS[i]))}</div>
    <h1>${w === me.seat ? 'You win!' : `${playerTag(w, names)} wins!`}</h1>
    ${note ? `<p class="tiebreak">${note}</p>` : ''}
    ${w === me.seat ? '' : `<p class="mine">You finish ${place}${mine.tied ? ' (tied)' : ''} with ${mine.total}${icon('points', 1.1)}</p>`}
    ${standingsHtml(g, names, me.seat)}
    <button id="newgame" class="primary big">New game</button>
  </div>`;
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
    <button class="latest" type="button"><span></span><b class="unread" hidden></b></button>
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
  talk.list.innerHTML = lines.map((e) => `<li class="${e.private ? 'private' : ''}${mine(e.text) ? ' mine' : ''}">${talkHtml(e.text, g)}</li>`).join('') || '<li><small>No one has said anything yet. Players who aren\'t in the room (like Claude) only hear what you send here.</small></li>';
  if (atBottom) talk.list.scrollTop = talk.list.scrollHeight;
  const last = lines.at(-1);
  if ((talk.open || talk.read < 0) && last) talk.read = last.i; // opening the page counts as having heard what came before
  const unread = lines.filter((e) => e.i > talk.read && !mine(e.text)).length;
  talk.latest.innerHTML = `${icon('talk', 1.3)} ${last ? talkHtml(last.text, g) : '<span class="none">Table talk</span>'}`;
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
    } else if (tradeOpen(g, me)) {
      if (trade.cards.has(id)) trade.cards.delete(id);
      else trade.cards.add(id);
    } else openCard = openCard === id ? null : id;
    render();
  });
  bind('[data-play]', (el) => send(`play ${el.dataset.play}`));
  bind('[data-build]', (el) => send(`build ${el.dataset.build}`));
  bind('[data-pickhex]', (el) => {
    const c = me.hand.find((x) => x.id === el.dataset.pickhex)!;
    const verb = c.kind === 'upgrade' ? 'upgrade' : c.kind === 'action' ? 'play' : 'build';
    const labels = c.counts && Object.fromEntries(Object.entries(c.counts).map(([k, n]) => [k, String(n)]));
    const title = c.kind === 'upgrade' ? `Choose a building for the ${c.name}` : `Choose a hex for the ${c.fauna ? c.fauna.name : c.name}`;
    const about = pickAbout(cardArt(c.kind, c.key, c.element, c.cls), c.name, c.text, frameColor(c.kind, c.element));
    picking = { title, hexes: c.hexes, command: (h) => `${verb} ${c.id} ${h}`, labels, about };
    render();
  });
  bind('[data-basic]', (el) => {
    const b = me.basics.find((x) => x.key === el.dataset.basic)!;
    if (b.onTower) return send(`build ${b.key}`);
    const about = pickAbout(cardArt('building', b.key, undefined, b.cls), b.name, b.text, frameColor('building'));
    picking = { title: `Choose a hex for the ${b.name}`, hexes: b.hexes, command: (h) => `build ${b.key} ${h}`, about };
    render();
  });
  bind('[data-keep]', (el) => send(`keep ${el.dataset.keep}`));
  bind('[data-egg]', (el) => send(`project ${el.dataset.egg}`));
  app.querySelectorAll<SVGElement>('[data-hex]').forEach((el) => (el.onclick = () => {
    const cmd = picking!.command(el.dataset.hex!);
    picking = null;
    // Picking a beast to clear opens the dragon choice; everything else is a command.
    if (cmd.startsWith('hunt ')) hunting = { hex: el.dataset.hex!, chosen: new Set() };
    render();
    if (!cmd.startsWith('hunt ')) send(cmd);
  }));
  on('hunt', () => {
    const about = '<p class="hint pabout">Tap a beast, then choose the dragons to send against it. If it falls, the hex is free and its loot is yours.</p>';
    picking = { title: 'Choose a beast to clear', hexes: me.huntable, command: (h) => `hunt ${h}`, about };
    render();
  });
  bind('[data-hunter]', (el) => {
    const id = el.dataset.hunter!;
    if (hunting!.chosen.has(id)) hunting!.chosen.delete(id);
    else hunting!.chosen.add(id);
    render();
  });
  on('huntgo', () => {
    const cmd = `clear ${hunting!.hex} ${[...hunting!.chosen].join(' ')}`;
    hunting = null;
    render();
    send(cmd);
  });
  on('huntoff', () => {
    hunting = null;
    render();
  });
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
  on('offer', () => {
    const side = (m: Record<string, number>, cards: string[] = []) => [...RESOURCES.filter((r) => m[r]).map((r) => `${m[r]} ${r}`), ...cards].join(' ');
    const cmd = `offer P${trade.to + 1} give ${side(trade.give, [...trade.cards].filter((id) => me.hand.some((c) => c.id === id)))} get ${side(trade.get)}`;
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
  on('newgame', () => {
    code = ''; // a new game is in a new room: type its code, or scan the TV
    leaveToJoin('');
  });
  on('menu', () => {
    menu = !menu;
    render();
  });
  for (const id of ['menuclose', 'menucancel']) {
    on(id, () => {
      menu = false;
      render();
    });
  }
  on('quit', async () => {
    stop?.(); // the seat stops being this phone's: don't hear that as someone taking it
    stop = null;
    try {
      await post(`/api/rooms/${code}/quit`, { token });
    } catch (e) {
      enter(code, token);
      throw e;
    }
    menu = false;
    leaveToJoin('You quit. A bot plays your seat.');
  });
  bind('[data-standin]', (el) => post(`/api/rooms/${code}/standin`, { token, seat: Number(el.dataset.standin) }));
}

function toast(e: unknown) {
  const t = document.createElement('div');
  t.className = 'toast';
  // The engine names players P1, P2...; the toast names them as every other screen does.
  t.innerHTML = named(e instanceof Error ? e.message : String(e), names);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

boot().catch(toast);
