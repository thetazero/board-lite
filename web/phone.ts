// The phone: one player's hidden hand and their choices. Everything public
// is on the TV, so this stays small: resources, cards, and the decision at hand.
// Every game also shows the table: the TV's page for the room, in a frame over
// this one, behind a You / Table switch, and cut to on its own while a cutscene
// plays. In a game with no TV (remote mode: the room was made on a phone) that's
// from the start; in a game with a TV, once the player first opens the table.

import type { CardView, DragonStageView, DragonView, PublicState, SavedGame, SeatState, Snapshot, TargetView } from '../src/state.ts';
import {
  ELEMENT_COLORS, PLAYER_COLORS, fadeAway, firstPlayer, POINTS_TO_WIN, RESOURCES, STAGE_LABEL, buildingIcon, dragonBadge, dragonChip, dragonLabel as dragonName, dragonState, hungerTags, elemIcon, elemWords, esc, hpBar, icon, powerTag, statTag, iconText, hexCenter, incomeText, lastRoundHtml, mapSvg, named, playerTag, post, resChips, resIcon, savedWhen, standingsHtml, tiebreakNote, watch,
} from './common.ts';
import { foeStack, kingdomCard, lootLine, pointsLeader, pointsLine, voterTag } from './kingdom.ts';
import { qrSvg } from './qr.ts';
import { morph } from './morph.ts';
import { bookSheet, loadBook, wheelAt, wheelOrder, type BookTab } from './book.ts';
import { ART_DEFS, cardArt, frameColor, kindIcon, stageFigure, tableScene, towerToken, winnerScene } from './art.ts';

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
// With `confirm`, a tap only picks the hex: what it does shows under the map
// (`detail`), and the confirm button (`verb`) carries out the command.
let picking: {
  title: string; hexes: string[]; command: (hex: string) => string; labels?: Record<string, string>; about: string;
  confirm?: { verb: string; detail: (hex: string) => string }; picked?: string;
} | null = null;
// Clearing fauna: the beast's hex, and the dragons picked to send against it.
// Sending dragons to a hex: to clear what holds it, or to perch on a rival's building.
let hunting: { hex: string; chosen: Set<string>; perch?: boolean } | null = null;
// The dragons ticked to fight in this raid, before Fight is tapped (null: all of them).
let fightDraft: string[] | null = null;
let openCard: string | null = null;
let openDragon: string | null = null; // one of your dragons tapped open: its card
let selected = new Set<string>(); // discard picks
let trade = fresh();
let bank = { give: 'stone', get: 'timber', times: 1 };
// Commands go to the server one at a time, in the order they were tapped:
// quick taps queue up instead of being lost. A tap that repeats the last
// command still waiting (the same button twice) is a double tap, and is dropped.
const outbox: string[] = [];
let sending = false;
let menu = false; // the menu under your name (Save game, Quit game) is open
let bookTab: BookTab | null = null; // the rulebook, from Rules or the wheel in the header, open at this tab
let eggOpen = false; // the base dragon egg's Hatch tapped: choosing its element
// End turn tapped once, waiting for its confirm (#417): a mis-tap alone never ends a turn.
// When it was tapped, so a double tap doesn't land on the confirm too.
let endAsk: number | null = null;
// The hand tucked down to the bottom edge is raised by a tap: on which screen (its key).
// A new screen tucks it again, if no card can be played there either.
let handUp: string | null = null;
let screenKey = ''; // the key of the screen shown now
// Cards arriving in the hand fly in: the ids already seen, and when each new one lands.
// Null until the hand is first shown, so reloading mid-game doesn't deal it again.
let seenHand: Set<string> | null = null;
const dealtAt = new Map<string, number>();
const DEAL_MS = 650;
const DEAL_GAP_MS = 160;

function fresh() {
  return { to: -1 as number | null, give: {} as Record<string, number>, get: {} as Record<string, number>, cards: new Set<string>() };
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
  // With no room yet, the server's saved games are offered too: each opens on its seats.
  const saved: SavedGame[] = known ? [] : await fetch('/api/saved').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  app.innerHTML = `
    <div class="joinpage">
      <div class="hero">${tableScene(PLAYER_COLORS.slice(0, 3), 360, 200)}<h1 class="title">board-lite</h1></div>
      <form class="joinform" id="join">
        ${news ? `<p class="news">${esc(news)}</p>` : ''}
        <p class="subtitle">Wizards raise dragons. First to ${iconText(`${POINTS_TO_WIN} points`)} wins.</p>
        ${known ? `<p class="roomline">Room <b>${esc(room!.lobby.code)}</b></p><input id="code" type="hidden" value="${esc(room!.lobby.code)}">`
          : `<label><span>Room code <small>on the TV</small></span><input id="code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="4 letters" value="${esc(c)}" required></label>`}
        <label>Your name <input id="name" maxlength="12" autocomplete="nickname" value="${esc(name)}" required></label>
        <button class="primary big" type="submit">Join</button>
        <p class="error">${esc(err)}</p>
        ${known ? '' : '<div class="hostline"><p>No TV: start a game on this phone, and the others join from it.</p><button id="host" type="button">New game</button></div>'}
        ${saved.length ? `<div class="hostline savedgames"><p>Saved games</p><ul>${saved.slice(0, 5).map((g) => `<li><a class="button" href="/${esc(g.code)}"><b>${esc(g.names.join(', '))}</b><small>Round ${g.round}, saved ${esc(savedWhen(g.savedAt))}</small></a></li>`).join('')}</ul></div>` : ''}
      </form>
    </div>`;
  wireJoin();
}

function wireJoin() {
  const form = document.getElementById('join') as HTMLFormElement | null;
  if (!form) return;
  // A game with no TV: this phone makes the room and is its first player.
  const host = document.getElementById('host');
  if (host) host.onclick = async () => {
    const name = document.getElementById('name') as HTMLInputElement;
    if (!name.reportValidity()) return;
    try {
      const r = await post('/api/rooms', { remote: true });
      await join(String(r.code), name.value.trim(), name.value.trim());
    } catch (er) {
      renderJoin(er instanceof Error ? er.message : String(er), { code: '', name: name.value });
    }
  };
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
    const r = await post(`/api/rooms/${c}/join`, { name, via: 'phone' });
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
        <p class="roomline">Room <b>${esc(l.code)}</b>: the game ${l.saved ? 'is saved' : 'has started'}.</p>
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
  offerSeen = null;
  stop?.();
  // Offline, nothing on the page can be tapped (a tap couldn't reach the
  // table): it greys out under the Reconnecting banner until the phone is back.
  stop = watch(code, token, onSnapshot, (ok) => {
    document.body.classList.toggle('offline', !ok);
    app.inert = !ok;
  }, () => {
    const gone = code;
    code = '';
    leaveToJoin(`Room ${gone} is no longer on the server.`);
  });
}

function onSnapshot(s: Snapshot) {
  const prev = snap;
  snap = s;
  names = s.lobby.seats.map((x) => x.name);
  // Before the game, and while a saved game hosted again takes its seats, the phone shows the lobby.
  if (!s.game || s.lobby.seating) {
    if (s.seat < 0) return leaveToJoin('You were removed from the lobby.');
    seenHand = new Set(); // watching from the lobby: the first hand is dealt in
    return renderLobby();
  }
  if (s.seat < 0) return leaveToJoin('Someone else has your seat now.');
  if (!s.you) return leaveToJoin('You are not in this game.');
  if (s.lobby.saved) return renderSaved();
  table.show(code, s.lobby.remote);
  table.hold(s.lobby.remote && s.scene > 0);
  noteOffers(s.game, s.seat);
  // Reset per-decision UI when the situation changes under us.
  const key = (x: Snapshot | null) => `${x?.game?.phase}|${x?.game?.turn}|${x?.game?.raid?.step}|${x?.game?.round}`;
  if (key(prev) !== key(s)) {
    picking = null;
    hunting = null;
    fightDraft = null;
    selected = new Set();
    openCard = null;
    openDragon = null;
    eggOpen = false;
    if (s.game.phase !== 'action') trade = fresh();
  }
  // The TV (or, with no TV, each phone's table view) is playing a scene (a
  // fight, the round's roll): the whole table watches it, and the next
  // decision waits until it's over. Nothing that
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

// What became of the offers you made: the player you offered accepts or
// declines, or the turn ends and the offer expires. Each answer shows once, when
// it happens, and stays until tapped, so a phone left on the table still has it.
let offerSeen: number | null = null; // the last log line looked at; null until the first snapshot
function noteOffers(g: PublicState, seat: number) {
  const last = g.log.at(-1)?.i ?? -1;
  // What happened before this phone joined (or reloaded) is old news.
  if (offerSeen === null) return void (offerSeen = last);
  for (const e of g.log) {
    if (e.i <= offerSeen) continue;
    const text = offerAnswer(e.ev, seat);
    if (text) offerNotice(text);
  }
  offerSeen = Math.max(offerSeen, last);
}

function offerAnswer(ev: PublicState['log'][number]['ev'], seat: number): string {
  if (!ev || !('from' in ev) || ev.from !== seat) return '';
  if (ev.k === 'trade') return `P${ev.to + 1} accepts: ${ev.give} for ${ev.get}.`;
  if (ev.k === 'decline') return `P${ev.p + 1} declines: ${ev.give} for ${ev.get}.`;
  if (ev.k === 'expire') return `Your offer expires: ${ev.give} for ${ev.get}.`;
  return '';
}

function offerNotice(text: string) {
  let box = document.querySelector<HTMLElement>('.notices');
  if (!box) {
    box = document.createElement('div');
    box.className = 'notices';
    document.body.append(box);
  }
  const n = document.createElement('button');
  n.className = 'toast news';
  n.innerHTML = `${named(text, names, snap?.game?.dragons)} <small>Tap to close</small>`;
  n.onclick = () => fadeAway(n);
  box.append(n);
  const up = [...box.children].filter((x) => !x.classList.contains('gone'));
  for (const old of up.slice(0, -3)) fadeAway(old as HTMLElement);
  if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
}

function renderWatch(me: Me) {
  document.body.classList.remove('has-hand', 'hand-tucked', 'hand-below');
  morph(app, screen('watch', `<div class="watchtv" style="--pc:${PLAYER_COLORS[me.seat]}"><span class="pname">${esc(me.name)}</span><h1>${snap?.lobby.remote ? 'Watch the table' : 'Watch the TV'}</h1></div>`));
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
  table.hide();
  seenHand = null;
  stop?.();
  stop = null;
  localStorage.removeItem('seat');
  document.body.classList.remove('has-hand', 'hand-below', 'hand-tucked');
  document.body.style.removeProperty('--hs');
  renderJoin('', undefined, msg);
}

// ---------- lobby ----------

// The lobby: who's at the table. The first player starts the game and adds or
// removes bots (as the TV does); everyone else waits for them. A saved game
// hosted again comes back here until every seat is taken.
function renderLobby() {
  const l = snap!.lobby;
  const me = seatIndex();
  const host = me === 0;
  const pc = PLAYER_COLORS[me] ?? '#888';
  const open = l.seats.filter((s) => s.kind === 'open').length;
  const first = firstPlayer(l);
  const seat = (s: Snapshot['lobby']['seats'][number], i: number) => s.kind === 'open'
    ? `<li class="open" style="--pc:${PLAYER_COLORS[i]}">${towerToken(PLAYER_COLORS[i], 1.8)}<span>Open seat</span></li>`
    : `<li class="${i === me ? 'me' : ''}" style="--pc:${PLAYER_COLORS[i]}">${towerToken(PLAYER_COLORS[i], 1.8)}<span>${esc(s.name)}</span>${s.kind === 'bot' ? '<span class="tag">bot</span>' : ''}${s.kind === 'player' && !s.connected ? '<span class="tag">away</span>' : ''}
      ${host && i !== me ? `<button class="x" data-remove="${i}" aria-label="remove ${esc(s.name)}" title="remove">×</button>` : ''}</li>`;
  const hint = l.seating ? `The game goes on once every seat is taken.`
    : host ? '' : `${first ? esc(first) : 'The first to join'}${l.remote ? '' : ' or the TV'} starts the game.`;
  // Your tower in your colour stands at the front: that's your colour for the game.
  morph(app, screen('lobby', `
    <div class="plobby" style="--pc:${pc}">
      <div class="hero">${tableScene([pc])}</div>
      <div class="lobbybody">
        <h1>You're in, ${esc(l.seats[me]?.name ?? '')}</h1>
        <p class="muted">Room <b>${esc(l.code)}</b>${l.seating ? `: ${open > 1 ? `${open} open seats` : '1 open seat'}` : ''}</p>
        ${l.remote ? invite(l.code) : ''}
        <ul class="seatlist">${l.seats.map(seat).join('')}</ul>
        ${host && !l.seating ? act('Start game', 'id="start"', l.seats.length >= l.minPlayers ? null : `You need ${l.minPlayers} players: add a bot.`) : ''}
        ${host ? act('Add a bot', 'id="bot"', l.seating ? null : l.seats.length >= l.maxPlayers ? `The table is full: ${l.maxPlayers} players.` : null, '') : ''}
        ${hint ? `<p class="hint">${hint}</p>` : ''}
        <button id="leave" class="ghost">Leave</button>
      </div>
    </div>`));
  if (host) {
    on('bot', () => post(`/api/rooms/${code}/bot`, { token }));
    if (!l.seating) on('start', () => post(`/api/rooms/${code}/start`, { token }));
    app.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) => (b.onclick = () => post(`/api/rooms/${code}/leave`, { token, seat: Number(b.dataset.remove) }).catch(toast)));
  }
  on('leave', async () => {
    await post(`/api/rooms/${code}/leave`, { token });
    leaveToJoin('');
  });
}

// A saved game: the table stopped partway through, to continue later. Anyone
// at it continues it here, on the TV, or on another phone; the Claude players
// come back by themselves. Leave goes to the join form, where the game is
// under Saved games.
function renderSaved() {
  const l = snap!.lobby;
  const me = seatIndex();
  const pc = PLAYER_COLORS[me] ?? '#888';
  menu = false;
  bookTab = null;
  table.hide();
  talk.el.remove();
  document.body.classList.remove('has-hand', 'hand-below', 'hand-tucked');
  const seat = (s: Snapshot['lobby']['seats'][number], i: number) => `<li class="${i === me ? 'me' : ''}" style="--pc:${PLAYER_COLORS[i]}">${towerToken(PLAYER_COLORS[i], 1.8)}<span>${esc(s.name)}</span>${s.kind === 'bot' ? '<span class="tag">bot</span>' : ''}${s.kind === 'player' && !s.connected ? '<span class="tag">away</span>' : ''}</li>`;
  morph(app, screen('saved', `
    <div class="plobby" style="--pc:${pc}">
      <div class="hero">${tableScene([pc])}</div>
      <div class="lobbybody">
        <h1>Game saved</h1>
        <p class="muted">Room <b>${esc(l.code)}</b>: round ${snap!.game!.round}, saved ${esc(savedWhen(l.saved!))}</p>
        <ul class="seatlist">${l.seats.map(seat).join('')}</ul>
        ${act('Continue', 'id="continue"')}
        <p class="hint">Continue when everyone is back, here or on the TV.</p>
        <button id="leave" class="ghost">Leave</button>
      </div>
    </div>`));
  on('continue', () => post(`/api/rooms/${code}/continue`, { token }));
  on('leave', () => leaveToJoin('The game is saved. To continue it, open it under Saved games and tap your name.'));
}

// A game with no TV: the others join from this phone's screen, at the address
// this phone reached the server on, or (on the server's own machine) the
// address the TV would show.
let lan: { lan: string[]; tailscale: string[]; port: number } | null = null;
function invite(c: string): string {
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  if (local && !lan) {
    fetch('/api/info').then((r) => r.json()).then((v) => {
      lan = v;
      if (snap && !snap.game) renderLobby();
    }).catch(() => {});
  }
  const host = local && lan ? `${lan.lan[0] ?? lan.tailscale[0] ?? location.hostname}${lan.port && lan.port !== 80 ? `:${lan.port}` : ''}` : location.host;
  const url = `${host}/${c}`;
  // A TV can join the table at any time, and then it's a game with a TV.
  return `<div class="invite">${qrSvg(`${location.protocol}//${url}`, 'the room\'s address')}
    <p><b>Join on another phone</b>Point its camera at the code, or open <span class="url">${esc(url)}</span></p></div>
    <p class="hint tvhint">On a TV, open <b class="url">${esc(`${host}/tv?room=${c}`)}</b> to play there.</p>`;
}

// ---------- the table ----------

// The TV's page for the room, in a frame over this page, kept loaded (and
// hidden) for the rest of the game so its cutscenes are queued as they happen.
// The switch sits by the talk bar in both views. While a cutscene plays (the
// round's dice, a raid's or a beast's fight) the frame tells this page, and in a
// game with no TV so does the server's snapshot (its `scene`); the phone cuts to
// the table and back after, unless the player switched by hand. While the
// server's scene plays with no TV, You is off: there's nothing to do there.
// In a game with a TV the frame is only made when Table is first tapped, so a
// phone at the TV doesn't load a second board or cut away from the hand; there
// the server's scene doesn't hold the table, and You says to watch the TV.
// A TV can come or go at any time (src/server/room.ts, Room.hasTv), and the
// phone follows.
const table = (() => {
  let wrap: HTMLElement | null = null;
  let sw: HTMLElement | null = null;
  let room = '';
  let on = false;
  let auto = false; // showing the table because a cutscene cut to it
  let framed = false; // the frame says its cutscene is playing
  let held = false; // the server says a scene is playing: there's nothing to do on the You side
  let noTv = false; // the table is playing with no TV
  let tapped = false; // the player opened Table by hand
  const set = (v: boolean) => {
    on = v;
    document.body.classList.toggle('table-on', v);
    sw?.querySelectorAll<HTMLElement>('button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.view === 'table') === v)));
    wrap?.setAttribute('aria-hidden', String(!v));
  };
  // Cut to the table while either says a scene plays, and back once neither does.
  const update = () => {
    if (!wrap) return;
    const you = sw?.querySelector<HTMLButtonElement>('[data-view="you"]');
    if (you) you.disabled = held;
    if ((framed || held) && !on) {
      auto = true;
      set(true);
    } else if (!framed && !held && auto) {
      auto = false;
      set(false);
    }
  };
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.boardLite !== 'cut' || !wrap) return;
    framed = !!e.data.on;
    update();
  });
  const frame = () => {
    if (wrap?.firstChild) return;
    wrap!.innerHTML = `<iframe src="/tv?room=${encodeURIComponent(room)}&remote" title="The table"></iframe>`;
  };
  return {
    // The server's word on whether a scene plays, in a game with no TV: a phone
    // joining mid-scene, or one whose frame missed it, still cuts to the table
    // rather than saying to watch it.
    hold(v: boolean) {
      held = v;
      update();
    },
    // `remote`: no TV. The table can get a TV or lose it mid-game: with no TV
    // the table loads now; once a TV is back, a table nobody tapped goes, so
    // the phone stops cutting away from the hand.
    show(c: string, remote: boolean) {
      if (wrap && room === c) {
        if (remote === noTv) return;
        noTv = remote;
        document.body.classList.toggle('remote', remote);
        if (remote) frame();
        else if (!tapped) {
          wrap.innerHTML = '';
          framed = auto = false;
          if (on) set(false);
        }
        return update();
      }
      this.hide();
      noTv = remote;
      room = c;
      wrap = document.createElement('div');
      wrap.className = 'tableview';
      if (remote) frame();
      sw = document.createElement('div');
      sw.className = 'viewswitch';
      sw.setAttribute('role', 'group');
      sw.setAttribute('aria-label', 'View');
      sw.innerHTML = `<button type="button" data-view="you">You</button><button type="button" data-view="table">Table</button>`;
      sw.querySelectorAll<HTMLElement>('button').forEach((b) => (b.onclick = () => {
        auto = false;
        if (b.dataset.view === 'table') {
          tapped = true;
          frame();
        }
        set(b.dataset.view === 'table');
      }));
      document.body.append(wrap, sw);
      document.body.classList.add('has-table');
      document.body.classList.toggle('remote', remote);
      set(false);
      update();
    },
    hide() {
      wrap?.remove();
      sw?.remove();
      wrap = sw = null;
      room = '';
      on = auto = framed = held = tapped = noTv = false;
      document.body.classList.remove('has-table', 'remote', 'table-on');
    },
  };
})();

// ---------- the game ----------

// A second tap on a button whose command is still on its way is a double tap,
// and dropped, except the merchants' Trade: each tap trades again (#331).
function send(command: string) {
  endAsk = null; // doing anything else on your turn takes back an End turn waiting for its confirm
  if (outbox[outbox.length - 1] === command && !command.startsWith('merchants ')) return;
  outbox.push(command);
  if (!sending) void flush();
}

async function flush() {
  sending = true;
  while (outbox.length) {
    try {
      await post(`/api/rooms/${code}/do`, { token, command: outbox[0], via: 'phone' });
      outbox.shift();
    } catch (e) {
      // What was tapped after it was tapped expecting it to work: drop it too.
      outbox.length = 0;
      toast(e);
    }
  }
  sending = false;
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

// Every button the phone offers is drawn by `act`, and every choice by
// `choose`, so each screen says the same things the same way:
// - A button that's off says why under it, in the "why you can't" words of
//   docs/wording.md ("Build it on your turn."). The reason comes with the
//   option from the server (a card's or a building's `why`) or, for what only
//   this phone knows (the lobby, the trade form), is worked out here. Not
//   being able to afford it is the one reason left unsaid: the cost is beside
//   the greyed button, so the line would only repeat it.
// - A choice is a prompt naming what to choose ("Choose a resource"), then a
//   button for each option, each carrying its verb.
function act(label: string, attrs: string, why: string | null = null, cls = 'primary big'): string {
  return `${btn(label, attrs, why, cls)}${whyLine(why)}`;
}
// The button alone, for a row that puts the reason under the whole row.
function btn(label: string, attrs: string, why: string | null, cls: string): string {
  return `<button class="${cls}" ${attrs} ${why ? 'disabled' : ''}>${label}</button>`;
}
function whyLine(why: string | null | undefined): string {
  return why && !CANT_AFFORD.test(why) ? `<p class="blocked">${named(why, names, snap?.game?.dragons)}</p>` : '';
}
// The engine's words for a cost you can't pay (src/engine.ts, `afford`).
const CANT_AFFORD = /^You can't afford /;
function choose(prompt: string, options: string[], after = ''): string {
  return `<div class="choose"><h3 class="ask">${prompt}</h3><div class="row">${options.join('')}</div>${after}</div>`;
}

function header(g: PublicState, me: Me): string {
  // Each token with what a round brings in under it, and what your dragons eat.
  const res = RESOURCES.map((r) => {
    const inc = me.income[r];
    // Red when a beast or a perched dragon shuts down one of your buildings that makes it (#298).
    const sign = inc.base < 0 || inc.blocked ? ' minus' : inc.base || inc.dice.length ? '' : ' none';
    // What your dragons eat, after what's made, in red with the dragon icon (#309).
    const eat = inc.eat ? ` <span class="eat" title="your dragons eat this each round">−${inc.eat}${icon('dragon', 1.3)}</span>` : '';
    return `<div class="res${me.resources[r] ? '' : ' zero'}"><div>${resIcon(r, 1.9)}<b>${me.resources[r]}</b></div><small class="inc${sign}" title="each round">${iconText(incomeText(inc), 1)}${eat}</small></div>`;
  }).join('');
  // Points held as cards in the hand count too: said in words, so it can't read as a card count.
  const hidden = me.hiddenPoints ? `<small class="hiddenpts" title="Secret Hoard cards in your hand, counted in the total">${me.hiddenPoints}${icon('points', 0.9)} in hand</small>` : '';
  // Name, points and resources stay on screen together while the page scrolls.
  return `
    <div class="mehead" data-key="head" data-leave="up" style="--pc:${PLAYER_COLORS[me.seat]}">
      <header class="me">
        <span class="pname">${esc(me.name)}</span>
        <span class="pts">${icon('points', 1.4)}${me.totalPoints} <small>/ ${g.pointsToWin}</small>${hidden}</span>
        <button id="book" class="ghost bookbtn" aria-expanded="${!!bookTab}">Rules</button>
        <button id="wheel" class="ghost wheelbtn" aria-label="Element wheel" aria-expanded="${bookTab === 'elements'}">${wheelMark(g)}</button>
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
    else if (g.phase === 'discard') { const n = me.hand.length - me.handCap; what = `Discard ${n} card${n === 1 ? '' : 's'}`; }
    else if (g.phase === 'cards') what = 'Keep 1 card';
    else what = raidStep(g);
    return `<div class="status you"><span>${what}</span></div>`;
  }
  if (g.phase === 'action') return `<div class="status"><span>${playerTag(g.turn, names)}'s turn</span></div>${away(g)}`;
  return `<div class="status"><span>${waitText(g)}</span></div>${away(g)}`;
}

// Who the table waits on, and for what: "Waiting for Bram and Cora to discard."
function waitText(g: PublicState): string {
  const tags = g.waitingOn.map((p) => playerTag(p, names));
  const w = tags.length < 2 ? tags.join('') : `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]}`;
  if (!w) return 'Waiting for the table.';
  const step = g.raid?.step;
  const what = g.phase === 'discard' ? 'to discard' : g.phase === 'cards' ? 'to keep a card' : g.phase === 'action' ? 'to answer an offer'
    : g.phase === 'raid' ? (step === 'vote' ? 'to vote' : 'to fight or hold back') : '';
  return `Waiting for ${w}${what ? ` ${what}` : ''}.`;
}

// The raid's step by its rules name. The kingdom is named on its panel below,
// which every raid screen shows, whatever you've done.
function raidStep(g: PublicState): string {
  const r = g.raid!;
  return `${icon('raid', 1.3)} ${r.step === 'vote' ? 'Vote' : 'Fight or hold back'}`;
}

// The menu under your name: quitting is there, out of the way of the game.
function menuSheet(): string {
  const saving = snap!.game?.phase !== 'over';
  return `<div class="menuback" id="menuclose"></div><div class="menu">${saving ? `<h3>Save game</h3>
    <p>The game stops here for everyone, to continue later from the TV or any phone.</p>
    <div class="row"><button id="save" class="primary">Save game</button></div>` : ''}<h3>Quit game</h3>
    <p>A bot plays your seat for the rest of the game, as little as it can. To come back, open the room's address and tap your name.</p>
    <div class="row"><button id="quit" class="danger">Quit game</button><button id="menucancel">Cancel</button></div></div>`;
}

// The header's mark for the wheel: a dot of each element's colour in a ring,
// always on screen, so the wheel (the rulebook's Elements tab) is one tap away.
function wheelMark(g: PublicState): string {
  const es = wheelOrder(g.elementBeats);
  const dots = es.map((e, i) => { const [x, y] = wheelAt(i, es.length, 6); return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.6" fill="${ELEMENT_COLORS[e]}"/>`; }).join('');
  return `<svg viewBox="-10 -10 20 20" aria-hidden="true"><circle r="6" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".5"/>${dots}</svg>`;
}

// The table waits on someone whose phone is gone (closed, asleep, out of
// Wi-Fi): anyone may let a bot play for them, so the game doesn't stall. Their
// phone coming back hands the seat back to them.
// Once someone has the points to win, every phone says this round is the last.
function lastRound(g: PublicState, me: Me): string {
  const text = lastRoundHtml(g, names, { seat: me.seat, total: me.totalPoints });
  return text ? `<div class="lastround">${text}</div>` : '';
}

function away(g: PublicState): string {
  const seats = snap!.lobby.seats;
  return g.waitingOn.filter((p) => seats[p]?.kind === 'player' && !seats[p].connected && !seats[p].standIn)
    .map((p) => `<div class="awayline"><span>${playerTag(p, names)} is away.</span><button class="small" data-standin="${p}">Let a bot play</button></div>`).join('');
}

function render() {
  const g = snap!.game!;
  const me = snap!.you!;
  if (!me.myTurn || g.phase !== 'action') endAsk = null; // a turn that ends drops its confirm
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
  // Your dragons are on every screen of the game, so their cards are always a tap away,
  // but each only once: a dragon the screen lists below (to send, or in the raid) isn't in the roost too.
  const listed = choosing && body ? me.raidReady
    : g.phase === 'raid' && g.raid?.step === 'choose' ? g.raid.sent[me.seat] : [];
  const den = !picking && g.phase !== 'over' ? roost(g, me, new Set(listed)) : '';
  const open = !picking ? me.hand.find((c) => c.id === openCard) : undefined;
  const dragonOpen = !picking ? g.dragons.find((d) => d.id === openDragon && d.owner === me.seat) : undefined;
  const zoom = open ? cardZoom(open, me, me.myTurn && g.phase === 'action', g.phase === 'discard' && me.deciding) : dragonOpen ? dragonZoom(g, dragonOpen) : '';
  // Picking a hex is always on your turn: the ribbon saying so gives the map its room.
  const key = picking ? `pick ${picking.title}` : choosing ? 'hunt' : g.phase === 'over' ? 'over'
    : g.phase === 'raid' ? `raid ${g.round} ${g.raidsLeft} ${g.raid?.step}` : g.phase === 'action' ? `action ${me.myTurn}` : `${g.phase} ${me.deciding} ${me.choice.length > 0}`;
  // The hand is held along the bottom edge when its cards can be used: played on your
  // turn, discarded, offered in a trade. Otherwise (others' turns, the raid, keeping a
  // card) it's tucked down, only the tops of the cards showing: tap it to raise it.
  const playable = me.myTurn && g.phase === 'action';
  const discarding = g.phase === 'discard' && me.deciding;
  const offering = tradeOpen(g, me);
  screenKey = key;
  const tucked = !playable && !discarding && !offering && handUp !== key;
  const dock = !choosing && g.phase !== 'over' ? handFan(me, playable, discarding, offering, tucked) : '';
  document.body.classList.toggle('has-hand', !!dock);
  document.body.classList.toggle('hand-tucked', !!dock && tucked && me.hand.length > 0);
  morph(app, g.phase === 'over' && !picking ? screen(key, body) : `${header(g, me)}${screen(key, `${picking ? '' : status(g, me) + lastRound(g, me)}<main class="pbody">${den}${body}</main>`)}${dock}${zoom}${menu ? menuSheet() : bookTab ? bookSheet(bookTab) : ''}`);
  fitHand();
  fitMap(g);
  wire(g, me);
  // A raised hand no card can be played from goes back down at a tap on the page above it.
  const scr = app.querySelector<HTMLElement>('.screen');
  if (scr) scr.onpointerdown = dock && !tucked && handUp === key && !playable && !discarding && !offering ? () => { handUp = null; render(); } : null;
}

// What the phone is asking or showing, as one screen: a new one (your turn,
// the raid's next step, the card to keep, Watch the TV) rises in while the
// last one fades away above it (morph.ts, style.css), and everything that
// stays on it (an open card, the hand) updates in place, with no cut.
function screen(key: string, html: string): string {
  return `<div class="screen" data-key="screen ${esc(key)}" data-leave="up">${html}</div>`;
}

// The hand grows into the free screen below the buttons, so a turn with nothing
// open isn't a few buttons up top, the cards at the bottom and nothing between.
// It never shrinks below its usual size, and a card never gets wider than about
// two fifths of the screen. When the page is too long for the hand to fit below
// it (an open panel, a long choice, a short screen), the hand stops being held
// along the bottom edge and sits after the page instead, so it never covers
// what's above it: scroll down to it.
let lastFan: HTMLElement | null = null;
function fitHand() {
  const fan = app.querySelector<HTMLElement>('.handfan:not(.empty)');
  const main = app.querySelector<HTMLElement>('.pbody');
  const was = document.body.classList.contains('hand-below');
  const from = fan && fan === lastFan ? fan.getBoundingClientRect() : null;
  lastFan = fan;
  document.body.classList.remove('hand-below');
  if (!fan || !main) return document.body.style.removeProperty('--hs');
  const em = parseFloat(getComputedStyle(document.body).fontSize);
  const top0 = main.getBoundingClientRect().bottom + scrollY;
  if (fan.classList.contains('tucked')) { // only its tops showing: it never grows, and goes after a long page too
    document.body.style.removeProperty('--hs');
    return document.body.classList.toggle('hand-below', innerHeight - top0 - 3.9 * em - 3.6 * em < 0);
  }
  const width = Math.min(innerWidth, 34 * em);
  const top = top0; // where the page's content ends
  const room = innerHeight - top - 3.9 * em - 0.6 * em; // down to the talk bar, a little air above the cards
  const byHeight = room / (9.4 * em);
  const byWidth = (0.42 * width) / (6.6 * 0.78 * em);
  const hs = Math.max(1, Math.min(byHeight, byWidth));
  document.body.style.setProperty('--hs', hs.toFixed(3));
  document.body.classList.toggle('hand-below', byHeight < 1);
  // Moving between the bottom edge and the end of the page, the hand slides there.
  if (from && was !== byHeight < 1 && getComputedStyle(fan).animationName !== 'none') {
    const to = fan.getBoundingClientRect();
    fan.animate([{ translate: `${from.left - to.left}px ${from.top - to.top}px` }, { translate: '0 0' }], { duration: 350, easing: 'ease-out' });
  }
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

// Your dragons at home, then the room left for more: one empty nest with the
// count in words, so the row doesn't fill with unlabelled baskets. With more
// dragons than room (a suppressed roost counts for nothing, #352), it says so
// in red, as numbers: you hatch no more until there's room, and that's all.
// Tapping a dragon opens its card. Dragons the screen lists below are left
// out; with none left, so is the roost.
const NEST = `<svg class="nest" viewBox="-12 -12 24 24" role="img" aria-label="room for a dragon"><title>room for a dragon</title>
  <path d="M-10 -1 Q0 3 10 -1 L8 5 Q0 10 -8 5 Z" fill="#8a5a32"/><path d="M-10 -1 Q0 -5 10 -1 Q0 3 -10 -1 Z" fill="#3b2a1c"/>
  <path d="M-9 1 L7 4 M-8 4 L9 1 M-6 6.5 L6 6" stroke="#c48a52" stroke-width="1" fill="none" stroke-linecap="round"/></svg>`;
function roost(g: PublicState, me: Me, listed: Set<string>): string {
  const all = g.dragons.filter((d) => d.owner === me.seat);
  const mine = all.filter((d) => !listed.has(d.id));
  const empty = Math.max(0, me.dragonCapacity - all.length);
  const over = all.length - me.dragonCapacity;
  if (!mine.length && (!empty || mine.length < all.length) && over <= 0) return '';
  const room = empty ? `<span class="room">${NEST}Room for ${empty} more dragon${empty === 1 ? '' : 's'}</span>`
    : over > 0 ? `<span class="room over">${all.length} dragon${all.length === 1 ? '' : 's'}, room for ${me.dragonCapacity}</span>` : '';
  return `<section class="roost"><div class="nests">${mine.map((d) => myDragon(d, g)).join('')}${room}</div></section>`;
}
function myDragon(d: DragonView, g: PublicState): string {
  return `<button class="dtap${d.status === 'out' ? ' out' : ''}" data-dragon="${d.id}" aria-label="${esc(dragonName(d, g.dragons))}: open its card">${dragonChip(d, g.dragons, g.round)}</button>`;
}

// ---- action phase ----

function actionView(g: PublicState, me: Me): string {
  const incoming = g.offers.filter((o) => (o.to === null ? o.from !== me.seat && !o.passed.includes(me.seat) : o.to === me.seat)).map((o) => `
    <div class="offer in" data-key="offer ${o.id}">${playerTag(o.from, names)} offers <b>${iconText(esc(o.give))}</b> ${o.get === 'nothing' ? 'for <b>nothing</b>' : `for your <b>${iconText(esc(o.get))}</b>`}
      ${o.to === null ? '<p class="open">To anyone: the first to accept trades.</p>' : ''}
      ${me.cantAccept[o.id] ? `<p class="blocked">${named(me.cantAccept[o.id], names)}</p>` : ''}
      <div class="row"><button class="primary" data-accept="${o.id}" ${me.cantAccept[o.id] ? 'disabled' : ''}>Accept</button><button data-decline="${o.id}">Decline</button></div></div>`).join('');
  const mine = g.offers.filter((o) => o.from === me.seat).map((o) => `
    <div class="offer out" data-key="offer ${o.id}">You offer ${o.to === null ? '' : `${playerTag(o.to, names)} `}<b>${iconText(esc(o.give))}</b> for <b>${iconText(esc(o.get))}</b>${o.to === null ? ' to anyone' : ''} <button class="small" data-cancel="${o.id}">Withdraw</button>${o.passed.length ? `<p class="declined">${o.passed.map((p) => playerTag(p, names)).join(', ')} ${o.passed.length === 1 ? 'declines' : 'decline'}</p>` : ''}</div>`).join('');
  // Build and Trade (with the merchants) open over the table and close again; the hand is always below.
  const tabs = `<nav class="tabs">
    ${me.myTurn ? `<button data-tab="more" class="${tab === 'more' ? 'on' : ''}">Build</button>` : ''}
    <button data-tab="trade" class="${tab === 'trade' ? 'on' : ''}">Trade</button></nav>`;
  const t = !me.myTurn && tab === 'more' ? 'none' : tab;
  const content = t === 'more' ? moreView(me) : t === 'trade' ? tradeView(g, me) : '';
  // Fauna or rivals' perched dragons anywhere on the map, and dragons fit to
  // fight them: clearing is one tap away, and so is perching.
  const beasts = g.map.filter((h) => h.fauna && me.huntable.includes(h.k));
  const clear = me.myTurn && me.huntable.length && me.raidReady.length
    ? `<button id="hunt" class="huntbtn">${[...new Set(beasts.map((h) => h.fauna!.key))].map((k) => icon(k, 1.6)).join('')} ${beasts.length === me.huntable.length ? 'Clear fauna' : 'Clear'}</button>` : '';
  // Auto clear (#374): clearing your own buildings, weakest first, with every raid-ready dragon each time.
  const auto = me.myTurn && me.autoClear.length && me.raidReady.length ? `<button id="autoclear" class="huntbtn">${icon('raid', 1.3)} Auto clear</button>` : '';
  const perch = me.myTurn && me.perchable.length && me.raidReady.length ? '<button id="perch" class="huntbtn">Perch</button>' : '';
  // Your perched dragons, each with its way home.
  const recall = me.myTurn ? me.perched.map((id) => {
    const d = g.dragons.find((x) => x.id === id)!;
    const b = g.map.find((h) => h.k === d.perch)?.building;
    return `<div class="proj" data-key="perched ${id}">${dragonBadge(d, 32)}<span class="what"><b>${esc(dragonName(d, g.dragons))}</b><small>Perched on ${b ? `${playerTag(b.owner, names)}'s ${esc(b.name)}` : d.perch}</small></span><button data-recall="${id}">Recall</button></div>`;
  }).join('') : '';
  // An offer to you needs your answer before your turn can end.
  // End turn takes a confirm (#417): the first tap swaps it for Keep playing and End turn.
  const end = !me.myTurn ? '' : endAsk !== null && !incoming
    ? `<div class="endask"><p class="hint">Your turn ends, and you can't take it back.</p><div class="row big2"><button class="big" id="endno">Keep playing</button><button class="primary big" id="endyes">End turn</button></div></div>`
    : act('End turn', 'id="end"', incoming ? 'An offer to you is open: answer it first.' : null, 'primary big endturn');
  // End turn sits above an open panel, so a long one (Trade, with the merchants, runs past the
  // screen) never pushes it down under the hand.
  return `${incoming}${mine}${tabs}${clear}${auto}${perch}${recall}${end}${content}`;
}

// "1 dragon", "2 dragons".
const dragons = (n: number) => `${n} dragon${n === 1 ? '' : 's'}`;

const KIND_LABEL = { building: 'Building', upgrade: 'Upgrade', action: 'Action', dragon: 'Dragon' };

// What a card costs, with what you're short of marked.
function costChips(cost: CardView['cost'], me: Me): string {
  const parts = RESOURCES.filter((r) => (cost[r] ?? 0) > 0).map((r) => `<span class="chip${me.resources[r] < cost[r]! ? ' short' : ''}">${cost[r]}${resIcon(r, 1.15)}</span>`);
  return parts.join('') || '<span class="chip free">Free</span>'; // a blank strip reads as a cost that failed to show
}

// The card's corner: its kind, or a dragon's element.
function cornerMark(c: CardView): string {
  return c.kind === 'dragon' && c.element ? elemIcon(c.element, 1) : kindIcon(c.kind);
}

// A card as it sits in the hand: a paper card with its picture, name and cost.
function cardFace(c: CardView, me: Me, playable: boolean, style = '', cls = ''): string {
  const dim = playable && c.why ? ' dim' : '';
  const dealt = dealtAt.has(c.id) ? ' dealt' : '';
  return `<div class="card k-${c.kind}${dim}${dealt}${cls}${selected.has(c.id) ? ' picked' : ''}" data-card="${c.id}" style="--kc:${frameColor(c.kind, c.element)};${style}${dealStyle(c.id)}">
    <div class="cart">${cardArt(c.kind, c.key, c.element, c.cls)}<span class="ckind">${cornerMark(c)}</span></div>
    <b class="cname">${esc(c.name)}</b>
    <div class="ccost">${costChips(c.cost, me)}</div>
  </div>`;
}

// A dragon card's text is its numbers: each life stage drawn small, named as
// the roost names it, with its health and attack, how fast it grows, and one sentence on how it picks targets.
// A hatched dragon's card marks the stage it's at now.
function dragonStats(key: string, element: string, d: { growth: number; targeting: string; stages: DragonStageView[] }, now = 0): string {
  const rows = d.stages.map((st, i) => `<div class="drow${i + 1 === now ? ' now' : ''}"><span class="sfig">${stageFigure(key, element, i)}<small>${STAGE_LABEL[i + 1]}</small></span><span class="dvals">${statTag('Health', st.hp)}${statTag('Attack', esc(st.attack))}</span></div>`).join('');
  const sentence = `${d.targeting[0].toUpperCase()}${d.targeting.slice(1)}.`;
  return `<div class="dstats">${rows}<div class="dgrow">Grows a stage every ${d.growth} round${d.growth === 1 ? '' : 's'} it's fed</div></div><p class="ctext">${esc(sentence)}</p>`;
}

// A card tapped open: full size, its rule text, and how to play it. The ✕ on
// its corner closes it, for whoever doesn't know a tap outside does too.
function cardZoom(c: CardView, me: Me, playable: boolean, discarding = false): string {
  let actions = '';
  const left = me.hand.length - me.handCap - selected.size;
  if (discarding) actions = selected.has(c.id) ? act("Don't discard", `data-discardpick="${c.id}"`, null, 'big') : act('Discard', `data-discardpick="${c.id}"`, left > 0 ? null : 'You have chosen enough cards: put one back first.');
  // A card kept, not played, says so instead of offering a button.
  else if (c.needs === 'unplayable') actions = `<p class="hint">${esc(c.blocked ?? '')}</p>`;
  // A card that can't be played now (not your turn, can't afford it, nothing
  // to play it on) shows its button greyed, and why under it (unless it's the
  // cost: its chips show that, the short ones marked).
  else if (c.why || !playable) actions = act(c.verb, '', c.why ?? `${c.verb} it on your turn.`);
  else if (c.needs === 'resource') actions = choose('Choose a resource to gain', RESOURCES.filter((r) => r !== 'gold').map((r) => `<button class="primary" data-play="${c.id} ${r}" aria-label="Gain ${r}">Gain ${resIcon(r, 1.6)}</button>`));
  else if (c.needs === 'dragon') actions = choose(`Choose a dragon for the ${esc(c.name)}`, c.dragons.map((id) => dragonOption(id, `data-play="${c.id} ${id}"`)));
  else if (c.needs === 'hex') actions = act(c.verb, `data-pickhex="${c.id}"`);
  else if (c.kind === 'building') actions = act(c.verb, `data-build="${c.id}"`);
  else actions = act(c.verb, `data-play="${c.id}"`);
  return `<div class="zoom" id="zoom" data-leave="fade">
    <div class="card big k-${c.kind}" data-key="big ${c.id}" style="--kc:${frameColor(c.kind, c.element)}">
      <button class="ghost zoomx" data-zoomclose aria-label="Close">✕</button>
      <div class="cart">${cardArt(c.kind, c.key, c.element, c.cls)}<span class="ckind">${cornerMark(c)}</span></div>
      <b class="cname">${esc(c.name)}</b>
      <div class="ccost"><span>${costChips(c.cost, me)}</span><small>${KIND_LABEL[c.kind]}</small></div>
      ${c.dragon ? dragonStats(c.key, c.element ?? 'fire', c.dragon) : `${c.fauna ? `${powerTag(c.fauna.power)}${foeStack([c.fauna], 1.6)}${lootLine(c.fauna.loot, 1.2)}` : ''}<p class="ctext">${iconText(esc(c.text))}</p>`}
    </div>
    <div class="zoomacts">${actions}</div>
    ${me.hand.length > 1 ? `<div class="zoomnav"><button class="ghost" data-zoomnav="-1" aria-label="Previous card">‹</button><span>${me.hand.indexOf(c) + 1} / ${me.hand.length}</span><button class="ghost" data-zoomnav="1" aria-label="Next card">›</button></div>` : ''}
  </div>`;
}

// One of your dragons tapped open: its card, as it was in your hand, with the
// stage it's at now, its growth and health, and the stage marked on the card.
// Read only; ✕ or a tap outside closes it, or leaf through your other dragons.
function dragonZoom(g: PublicState, d: DragonView): string {
  const mine = g.dragons.filter((x) => x.owner === d.owner);
  const i = mine.indexOf(d);
  const grow = d.stage < 3 ? ` <span class="grow">${'●'.repeat(d.growth)}${'○'.repeat(Math.max(0, d.growthTime - d.growth))}</span>` : '';
  const resting = d.status === 'out' || d.perch ? ` ${dragonState(d)}` : ''; // why it can't fight, as the roost says
  const hunger = hungerTags(d);
  const now = `${STAGE_LABEL[d.stage]}${grow}${d.stage ? ` ${statTag('Health', `${d.hp}/${d.maxHp}`)}` : ''}${resting}`;
  return `<div class="zoom" id="zoom" data-leave="fade">
    <div class="card big k-dragon" data-key="big ${d.id}" style="--kc:${frameColor('dragon', d.element)}">
      <button class="ghost zoomx" data-zoomclose aria-label="Close">✕</button>
      <div class="cart">${cardArt('dragon', d.key, d.element)}<span class="ckind">${elemIcon(d.element, 1)}</span></div>
      <b class="cname">${esc(dragonName(d, g.dragons))}</b>
      <div class="ccost"><span class="dnow">${now}</span><small>${KIND_LABEL.dragon}</small></div>
      ${hunger ? `<div class="dhunger">${hunger}</div>` : ''}
      ${dragonStats(d.key, d.element, { growth: d.growthTime, targeting: d.targeting, stages: d.stages }, d.stage)}
    </div>
    ${mine.length > 1 ? `<div class="zoomnav"><button class="ghost" data-dragonnav="-1" aria-label="Previous dragon">‹</button><span>${i + 1} / ${mine.length}</span><button class="ghost" data-dragonnav="1" aria-label="Next dragon">›</button></div>` : ''}
  </div>`;
}

// The hand, held like real cards: fanned along the bottom edge of the screen,
// overlapping when there are many. On your turn the cards you can play now glow.
// Tucked, it sits low with only the tops of the cards showing, and a tap raises it.
function handFan(me: Me, playable: boolean, discarding: boolean, offering = false, tucked = false): string {
  const n = me.hand.length;
  if (!n) return '<div class="handfan empty" id="hand"></div>';
  const mid = (n - 1) / 2;
  const tilt = Math.min(6, 36 / n); // degrees between neighbours
  const cards = me.hand.map((c, i) => {
    const d = i - mid;
    const ready = playable && !c.why;
    // --x: offset from the centre as a share of the spread; --r: tilt; --y: the arc's drop.
    const pos = `--x:${n > 1 ? d / mid : 0};--r:${(d * tilt).toFixed(1)}deg;--y:${(Math.abs(d) * Math.abs(d) * tilt * 0.22).toFixed(1)}px;z-index:${i + 1}`;
    return cardFace(c, me, playable, `${pos}${gripStyle(c.id)}`, `${ready && !offering ? ' ready' : ''}${offering && trade.cards.has(c.id) ? ' offered' : ''}${c.name.length >= 10 ? ' longname' : ''}${gripClass(c.id)}`);
  }).join('');
  return `<div class="handfan${discarding ? ' discarding' : ''}${offering ? ' offering' : ''}${tucked ? ' tucked' : ''}" id="hand" data-leave="down" style="--n:${n}"${tucked ? ' data-raisehand role="button" aria-label="Show your hand"' : ''}>${cards}</div>`;
}

// One of your dragons as an option to tap, the same on every screen that
// offers dragons: its badge, its name, and under it its stage and `stats`,
// by default its health, or why it can't fight, as the roost says. A dragon
// picked among several (`ticked` given) has a box that ticks when tapped.
function dragonOption(id: string, attrs: string, stats?: string, ticked?: boolean): string {
  const g = snap!.game!;
  const d = g.dragons.find((x) => x.id === id)!;
  const now = stats ?? (d.status === 'out' || d.perch ? dragonState(d) : d.stage ? statTag('Health', `${d.hp}/${d.maxHp}`) : '');
  const tick = ticked === undefined ? '' : '<i class="tick"></i>';
  return `<button class="dragon pick${ticked ? ' on' : ''}" ${attrs}>${dragonBadge(d, 40)}<span><b>${esc(dragonName(d, g.dragons))}</b><br>${STAGE_LABEL[d.stage]} ${now}</span>${tick}</button>`;
}

function moreView(me: Me): string {
  // Each row: what it is, its cost and its button, and why when the button is off.
  const row = (art: string, name: string, cost: CardView['cost'], button: string, why: string | null) =>
    `<div class="proj${why ? ' dim' : ''}">${art}<span class="what"><b>${esc(name)}</b><span class="costs">${resChips(cost)}</span></span>${button}</div>${whyLine(why)}`;
  const basics = me.basics.map((b) => row(buildingIcon(b.key, 22, '#4a3d45', b.cls), b.name, b.cost, btn('Build', `data-basic="${b.key}"`, b.why, ''), b.why)).join('');
  // The egg's button opens the choice of its element, as a basic building's opens the choice of its hex.
  const egg = me.eggProject;
  const eggs = eggOpen && !egg.why ? choose('Choose an element for the egg', egg.elements.map((e) => `<button class="elembtn" style="--ec:${ELEMENT_COLORS[e]}" data-egg="${e}">${elemIcon(e, 1.5)} ${e[0].toUpperCase()}${e.slice(1)}</button>`)) : '';
  // An upgrade's button opens the choice of its building, as its card's does.
  const ups = me.upgradeProjects.map((u) => row('', u.name, u.cost, btn('Upgrade', `data-upproject="${u.key}"`, u.why, ''), u.why)).join('');
  return `
    <section class="panel"><h3>Basic buildings</h3>${basics}</section>
    <section class="panel"><h3>Special projects</h3>
      ${row('', 'Base dragon egg', egg.cost, btn('Hatch', 'id="egg"', egg.why, eggOpen && !egg.why ? 'on' : ''), egg.why)}${eggs}${ups}</section>`;
}

function stepper(side: 'give' | 'get', r: string, n: number, max: number): string {
  return `<span class="stepper"><button data-step="${side} ${r} -1" ${n <= 0 ? 'disabled' : ''}>−</button><b>${n}</b><button data-step="${side} ${r} 1" ${n >= max ? 'disabled' : ''}>+</button></span>`;
}

// The merchants, on your turn: give your rate of one resource for 1 of another.
function bankView(me: Me): string {
  const rate = me.bankRates[bank.give as 'stone'];
  // The merchants' Trade: what you give has to be there, and differ from what you gain.
  const bankWhy = bank.give === bank.get ? 'You give and gain the same resource: choose another.'
    : me.resources[bank.give as 'stone'] < rate * bank.times ? `You can't afford ${rate * bank.times} ${bank.give}.` : null;
  // Pick a resource by tapping its icon.
  // A resource a port trades better wears its rate, on the Give side.
  const usual = Math.max(...Object.values(me.bankRates));
  const tag = (side: string, r: string) => (side === 'give' && me.bankRates[r as 'stone'] < usual ? `<span class="rate">${me.bankRates[r as 'stone']}:1</span>` : '');
  // Only what the merchants trade: the basic resources, never gold.
  const traded = RESOURCES.filter((r): r is keyof Me['bankRates'] => r in me.bankRates);
  const pick = (side: 'give' | 'get', sel: string) => `<div class="respick">${traded.map((r) => `<button class="iconbtn${sel === r ? ' on' : ''}" data-bank="${side} ${r}" aria-label="${r}${tag(side, r) ? `, ${me.bankRates[r]}:1` : ''}" aria-pressed="${sel === r}">${resIcon(r, 1.8)}${tag(side, r)}</button>`).join('')}</div>`;
  return `<section class="panel"><h3>Merchants</h3>
      <div class="bankrow"><span>Give</span>${pick('give', bank.give)}</div>
      <div class="bankrow"><span>Gain</span>${pick('get', bank.get)}</div>
      <div class="bank"><span class="steplabel">Times</span><span class="stepper"><button data-btimes="-1" aria-label="Trade 1 time fewer">−</button><b>${bank.times}</b><button data-btimes="1" aria-label="Trade 1 time more">+</button></span>
        ${btn(`Trade <span class="chip">${rate * bank.times}${resIcon(bank.give, 1.25)}</span>→<span class="chip">${bank.times}${resIcon(bank.get, 1.25)}</span>`, 'id="bankgo"', bankWhy, 'primary')}</div>${whyLine(bankWhy)}</section>`;
}

function tradeView(g: PublicState, me: Me): string {
  // On your turn you can offer one player, or anyone at once (the first to
  // accept trades); otherwise only the player whose turn it is.
  const seats = me.myTurn ? names.map((_, i) => i).filter((i) => i !== me.seat) : [g.turn];
  const others: (number | null)[] = me.myTurn && seats.length > 1 ? [...seats, null] : seats;
  if (!others.includes(trade.to)) trade.to = others[0];
  const who = others.map((i) => i === null
    ? `<button data-to="anyone" class="${trade.to === null ? 'on' : ''}" style="--pc:#bcae9c">Anyone</button>`
    : `<button data-to="${i}" class="${trade.to === i ? 'on' : ''}" style="--pc:${PLAYER_COLORS[i]}">${esc(names[i])}</button>`).join('');
  // One row per resource: what you give and what you get side by side.
  // Gold is public, so you can't ask for more than they have; the rest of what
  // they hold is hidden, and they find out when they answer.
  const theirGold = trade.to === null ? Math.max(...seats.map((i) => g.players[i].gold)) : g.players[trade.to].gold;
  if ((trade.get.gold ?? 0) > theirGold) trade.get.gold = theirGold;
  const rows = RESOURCES.map((r) => `${resIcon(r, 1.4)}${stepper('give', r, trade.give[r] ?? 0, me.resources[r])}${stepper('get', r, trade.get[r] ?? 0, r === 'gold' ? theirGold : 99)}`).join('');
  // Cards are offered from the hand itself, the same cards as everywhere: tapped
  // ones rise out of the fan and are named here.
  const offered = me.hand.filter((c) => trade.cards.has(c.id));
  const cards = me.hand.length
    ? `<p class="tpick">${offered.length ? `${icon('cards', 1.2)} ${offered.map((c) => `<b>${esc(c.name)}</b>`).join(', ')}` : '<small>Tap cards in your hand to add them.</small>'}</p>`
    : '';
  const any = Object.values(trade.give).some(Boolean) || trade.cards.size || Object.values(trade.get).some(Boolean);
  // On your turn the merchants come first: it's the shorter form, and the one used most.
  return `${me.myTurn ? bankView(me) : ''}
    <section class="panel trade">
      <h3>Offer a trade to</h3><div class="row who">${who}</div>
      <div class="tgrid"><span></span><h3>You give</h3><h3>You get</h3>${rows}</div>
      ${cards}
      ${act('Send offer', 'id="offer"', any ? null : 'Empty offer: choose what you give or get.', 'primary')}
    </section>`;
}

// Sending dragons to one hex. To clear it: what holds it (its beast, drawn as
// a raid's defenders are, with its loot, and any rivals' dragons perched
// there); your fit dragons to pick from, as for a raid. To perch: the
// rival's building they'll sit on.
function huntView(g: PublicState, me: Me): string {
  const h = g.map.find((x) => x.k === hunting!.hex);
  if (!h) return '';
  const whose = (p: number) => (p === me.seat ? 'your' : `${playerTag(p, names)}'s`);
  const on = h.building ? ` on ${whose(h.building.owner)} ${esc(h.building.name)}` : '';
  const off = '<button id="huntoff" class="big ghost">Cancel</button>';
  if (hunting!.perch) {
    if (!h.building) return '';
    return `<h3 class="huntname">Perch${on}</h3>
      ${sendPicker(g, me, hunting!.chosen, 'hunter', { go: 'huntgo', out: off, note: `The ${esc(h.building.name)} is suppressed, as if it weren't there, while they perch. Perched dragons don't raid.` })}`;
  }
  const perched = h.perched.filter((x) => x.owner !== me.seat).map((x) => g.dragons.find((d) => d.id === x.d)!).filter(Boolean);
  if (!h.fauna && !perched.length) return '';
  // A great beast pays in points, for good; it's 1 try each round, to the end.
  const great = h.fauna?.points !== undefined;
  const power = (h.fauna?.power ?? 0) + perched.reduce((s, d) => s + d.power, 0);
  const title = h.fauna ? `${great ? 'Slay' : 'Clear'} the ${esc(h.fauna.name)}` : 'Clear the perched dragons';
  const beast = h.fauna ? `${foeStack([h.fauna], 1.8)}${lootLine(h.fauna.loot, 1.4, h.fauna.points)}` : '';
  const ds = perched.map((d) => `<div class="foe"><span class="foe-pic">${dragonBadge(d, 40)}</span><span class="foe-body"><b class="foe-name">${playerTag(d.owner, names)} ${esc(dragonName(d, g.dragons))}</b><span class="foe-stats">${statTag('Health', `${d.hp}/${d.maxHp}`)}${statTag('Attack', esc(d.attack))}</span>${d.weak.length ? `<span class="foe-elem weak">Weak to ${elemWords(d.weak)}</span>` : ''}</span></div>`).join('');
  return `<h3 class="huntname">${title}${on}</h3><section class="ptarget">${powerTag(power, 'big')}${beast}${ds ? `<div class="foes">${ds}</div>` : ''}</section>
    ${sendPicker(g, me, hunting!.chosen, 'hunter', { go: 'huntgo', out: off, note: great ? '1 try each round' : undefined })}`;
}

// Choosing dragons to send into a fight (a beast to clear or slay, or which
// of your dragons in a raid fight): under "Choose dragons to send", your
// raid-ready dragons, each with a box that ticks when you tap it, then Send
// (with the power you send) beside the way out. Locked in, the picks stay on
// screen, ticked, and the buttons go.
function sendPicker(g: PublicState, me: Me, chosen: Set<string>, attr: string,
  o: { go: string; out: string; note?: string; ids?: string[]; ask?: string; verb?: string; locked?: boolean }): string {
  const ids = o.ids ?? me.raidReady;
  const verb = o.verb ?? 'Send';
  const list = ids.map((id) => {
    const d = g.dragons.find((x) => x.id === id)!;
    return dragonOption(id, `data-${attr}="${id}"${o.locked ? ' disabled' : ''}`, `${powerTag(d.power)} ${statTag('Health', d.hp)} ${statTag('Attack', esc(d.attack))}`, chosen.has(id));
  }).join('');
  const n = chosen.size;
  const sent = [...chosen].reduce((s, id) => s + (g.dragons.find((x) => x.id === id)?.power ?? 0), 0);
  const note = o.note ? `<p class="hint">${o.note}</p>` : '';
  const buttons = o.locked ? '' : `<div class="row big2"><button id="${o.go}" class="primary big" ${n ? '' : 'disabled'}>${icon('raid', 1.3)} ${n ? `${verb} ${dragons(n)} ${powerTag(sent)}` : verb}</button>${o.out}</div>`;
  // With 2 or more to choose from, a tick on the prompt's line, in the column of
  // the dragons' own, chooses them all in one tap (or, all chosen, none).
  const all = n > 0 && n === ids.length;
  const ask = `<h3 class="ask">${o.ask ?? 'Choose dragons to send'}</h3>`;
  const head = ids.length > 1 && !o.locked ? `<div class="askrow">${ask}<button id="${attr}all" class="allpick${all ? ' on' : ''}">Choose all<i class="tick"></i></button></div>` : ask;
  return `${head}${list}${note}${buttons}`;
}

// Picking a hex: the map, what you're placing and Cancel, on one screen. The
// map takes all the height the rest leaves (fitMap), so it isn't a small map
// up top with a third of the screen empty under it.
function hexPicker(g: PublicState): string {
  const p = picking!;
  const map = `<div class="pmap">${mapSvg(g.map, { size: MAP_SIZE, selectable: p.hexes, labels: p.labels, picked: p.picked })}</div>`;
  const cancel = '<button id="cancelpick" class="ghost big">Cancel</button>';
  if (!p.confirm) return `<section class="picker"><h3>${esc(p.title)}</h3>${map}${p.about}${cancel}</section>`;
  // The box keeps its place before a tap, so the map doesn't move under the finger.
  if (p.picked && !p.hexes.includes(p.picked)) p.picked = undefined;
  const detail = p.picked ? p.confirm.detail(p.picked) : `<p class="hint">Tap a ${p.title.startsWith('Choose a building') ? 'building' : 'hex'} to see what it makes.</p>`;
  return `<section class="picker"><h3>${esc(p.title)}</h3>${map}<div class="pchosen">${detail}</div>
    <div class="row big2"><button id="confirmpick" class="primary big" ${p.picked ? '' : 'disabled'}>${esc(p.confirm.verb)}</button>${cancel}</div>
    ${p.about}</section>`;
}

type Does = NonNullable<PublicState['map'][number]['building']>['does'];
// "2 + 1d4 stone": a fixed amount and dice, as the cards write them.
function amountText(r: string, m: { base: number; dice: number[] }): string {
  const parts = m.base ? [String(m.base)] : [];
  for (const s of [...new Set(m.dice)].sort((a, b) => b - a)) parts.push(`${m.dice.filter((d) => d === s).length}d${s}`);
  return `${parts.join(' + ')} ${r}`;
}
// What a building does each round, at a glance: numbers and icons, no
// sentence ("2 + 1d4 [stone]", "1 [point]", "Houses 2 dragons"). `peak` marks
// how much of what it makes comes from the freed peak.
function doesParts(d: Does, peak = 0): string[] {
  const out = RESOURCES.filter((r) => d.makes[r]).map((r) => amountText(r, d.makes[r]!) + (peak ? ` (${peak} from the peak)` : ''));
  if (d.houses) out.push(`Houses ${d.houses} dragon${d.houses > 1 ? 's' : ''}`);
  if (d.points) out.push(`${d.points} point${d.points > 1 ? 's' : ''}`);
  return out.length ? out : ['Makes nothing'];
}
// What an upgrade changes on a building, one short item per number, before →
// after, with the icon for what it counts: "5 → 7 stone", "1 → 2 points",
// "Houses 1 → 3 dragons". Only what changes; the card under the map says why.
function changeParts(a: Does, b: Does): string[] {
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
// Items side by side on one line, each kept whole, with its icons.
const glance = (parts: string[]) => parts.map((x) => `<span class="nobr">${iconText(esc(x)).replace('→', '<span class="pcto">→</span>')}</span>`).join('');
// The hex picked for a beast or an upgrade: whose building it is and what it
// does, with (for an upgrade) each change as before → after.
function hexDetail(g: PublicState, me: SeatState, k: string, after?: Does): string {
  const h = g.map.find((x) => x.k === k)!;
  const b = h.building;
  if (!b) return '<p class="pchead"><b>An empty hex</b></p><p>Nothing is built here.</p>';
  const whose = b.owner === me.seat ? 'Your ' : `${playerTag(b.owner, names)}'s `;
  const holder = h.suppressed ? h.fauna?.name ?? g.beasts.find((x) => x.key === h.held)?.name : undefined;
  const stopped = holder ? `<p class="hint">Suppressed, as if it weren't there, while the ${esc(holder)} holds it.</p>`
    : h.perched.length ? `<p class="hint">Suppressed, as if it weren't there, while a dragon perches on it.</p>` : '';
  const name = `<b>${esc(b.name)}</b>${b.upgradeName ? ` with ${b.upgrades.length === 1 ? 'a ' : ''}${esc(b.upgradeName)}` : ''}`;
  // An upgrade only goes on your own building, so its name alone says which,
  // and what changes sits on the same line.
  const parts = after ? changeParts(b.does, after) : [];
  if (parts.length) return `<p class="pchead pcdelta">${name}${glance(parts)}</p>${stopped}`;
  const note = b.does.note ? `<p class="hint">${iconText(esc(b.does.note))}</p>` : '';
  return `<p class="pchead pcdelta">${whose}${name}${glance(doesParts(b.does))}</p>${note}${stopped}`;
}

// The hex picked for a building before it's built: what it would do there,
// and, on or next to the freed peak, whether it makes the peak's bonus (#366).
function placeDetail(g: PublicState, name: string, d: Does | undefined): string {
  if (!d) return '';
  // The card is in view under the map, so its rule text isn't repeated here.
  const none = d.peak === 'none' ? `<p class="hint">No bonus from the peak</p>` : '';
  return `<p class="pchead pcdelta"><b>${esc(name)}</b>${glance(doesParts(d, d.peak === 'more' ? g.peakBonus : 0))}</p>${none}`;
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
// A kingdom that scores also shows what it's worth, and who leads for it.
function targetPanel(t: TargetView, leader: number | null = null): string {
  return `<section class="ptarget"><h3 class="tname">${esc(t.name)}</h3>${powerTag(t.power, 'big')}${foeStack(t.units, 1.8)}${lootLine(t.loot, 1.4)}${pointsLine(t, 1.4, leader === null ? null : { p: leader, names })}</section>`;
}

// Each raid step is its choices as buttons. A choice once made stays on screen,
// lit, so the screen shows what you chose instead of saying it. The target is
// always drawn, so you decide looking at what you'd be fighting.
function raidView(g: PublicState, me: Me): string {
  const raid = g.raid!;
  const dragon = (id: string) => g.dragons.find((d) => d.id === id)!;
  const sum = (ids: string[]) => ids.reduce((s, id) => s + dragon(id).power, 0);
  if (raid.step === 'vote') {
    const voted = me.myVote !== null || !!me.whyNoVote;
    // What each vote is worth, cast or not: the kingdom with the most power voted for it is raided.
    const worth = `<div class="vote-power">${names.flatMap((_, p) => (raid.voters[p] ? [voterTag(p, raid.votePower[p], names)] : [])).join('')}</div>`;
    return worth + raid.candidates.map((t, i) => kingdomCard(t, i, raid.candidates.length, raid.votes, raid.votePower, names,
      { tag: 'button', cls: `choice${me.myVote === i ? ' on' : ''}`, attrs: `data-vote="${i + 1}"${voted ? ' disabled' : ''}` })).join('');
  }
  const lead = pointsLeader(g, raid.sent);
  if (raid.step === 'choose') {
    // Everyone's raid-ready dragons are in, all of them: the ones whose power counted in the vote.
    const mine = raid.sent[me.seat];
    // Who else is going, and with what: the more dragons fight, the fewer hits each takes.
    const others = g.players.flatMap((_, p) => (p !== me.seat && raid.sent[p].length
      ? [`<div class="ally">${playerTag(p, names)} ${raid.sent[p].map((id) => dragonBadge(dragon(id), 34)).join('')} ${powerTag(sum(raid.sent[p]))}</div>`] : [])).join('');
    // Under the kingdom, the other players' dragons in the raid, then yours to choose from.
    const sentHead = `<h3 class="ask">In the raid</h3>`;
    if (!mine.length) return `${targetPanel(raid.target!, lead)}${others ? `${sentHead}<div class="allies">${others}</div>` : ''}`;
    // Which of yours fight, ticked: all of them until you untick some, then
    // Fight with the ticked ones or Hold back all. Once chosen, your pick stays on screen.
    const chose = me.myFight;
    const chosen = new Set(chose ?? fightDraft ?? mine);
    const note = 'Fought or held back, every dragon in the raid not knocked out shares the loot by power. Held back, a dragon takes no hits.';
    const hold = `<button id="hold" class="big${chose && !chose.length ? ' on' : ''}">Hold back</button>`;
    const picked = sendPicker(g, me, chosen, 'fighter', { go: 'fight', out: hold, ids: mine, ask: chose ? (chose.length ? 'You fight with' : 'You hold back') : 'Choose dragons to fight', verb: 'Fight with', note: chose ? undefined : note, locked: !!chose });
    return `${targetPanel(raid.target!, lead)}${others ? `${sentHead}<div class="allies">${others}</div>` : ''}${picked}`;
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

// The cards picked to discard are laid out above the button, face up, one
// place for each card still to pick: what goes is there to read before it goes.
// Tapping one there (or again in the hand) puts it back.
function discardView(me: Me): string {
  const n = me.hand.length - me.handCap;
  const picks = me.hand.filter((c) => selected.has(c.id));
  const tray = picks.map((c) => cardFace(c, me, false, '', ' traycard')).join('') + '<div class="slot"></div>'.repeat(Math.max(0, n - picks.length));
  const left = n - picks.length;
  const why = left ? `Hand limit ${me.handCap}: choose ${left}${picks.length ? ' more' : ''}.` : null;
  const hint = picks.length ? '' : '<p class="hint">Tap a card in your hand to choose it. Hold a card to read it.</p>';
  return `<div class="discardtray">${tray}</div>${act(`Discard ${n} card${n === 1 ? '' : 's'}`, 'id="discard"', why)}${hint}`;
}

// The end: the winner's moment, where everyone finished, and a link to the
// game's recap page (the summary the TV or the table view plays, to keep or
// share). Nothing from the game in progress (resources, income, the last
// decision) is left on screen.
function gameOver(g: PublicState, me: Me): string {
  const w = g.standings![0].p;
  const note = tiebreakNote(g);
  return `<div class="pover" style="--pc:${PLAYER_COLORS[w]}">
    <div class="hero">${winnerScene(PLAYER_COLORS[w], g.players.map((_, i) => PLAYER_COLORS[i]))}</div>
    <h1>${w === me.seat ? 'You win!' : `${playerTag(w, names)} wins!`}</h1>
    ${note ? `<p class="tiebreak">${note}</p>` : ''}
    ${standingsHtml(g, names, me.seat)}
    ${snap?.recap ? `<a class="button big" href="/recap/${snap.recap}" target="_blank" rel="noopener">Open the recap</a>` : ''}
    <button id="newgame" class="primary big">New game</button>
  </div>`;
}

// ---------- the hand under your thumb ----------

// Held the way digital card games hold a hand: press a card and slide along the
// hand, and the card under your thumb rises, big enough to read (a full hand
// overlaps, so this is how you read it); hold still on one to open it; drag one
// up out of the hand to play it (or, while discarding or offering a trade, to
// pick it). A plain tap does what it always did.
type Grip = { id: string; x0: number; y0: number; x: number; y: number; moved: boolean; lift: { x: number; y: number } | null; top: number; strips: { id: string; left: number; width: number }[]; hold: number };
let grip: Grip | null = null;
let swallowClick = 0; // a click until then ends a swipe, not a tap
let held = false; // a hold opened a card, and the finger is still down
let eatClick = 0; // the click that ends a press on the hand, until then: handled when it let go
let swipe: { x: number; y: number } | null = null; // a finger down on an open card
const MOVE_PX = 8; // further than this is a slide, not a tap
const LIFT_PX = 50; // this far up is pulling a card out of the hand
const HOLD_MS = 450;

// A tap on a card: pick it to discard, offer it, or open it.
function tapCard(g: PublicState, me: Me, id: string) {
  if (g.phase === 'discard' && me.deciding) {
    if (selected.has(id)) selected.delete(id);
    else if (selected.size < me.hand.length - me.handCap) selected.add(id);
  } else if (tradeOpen(g, me)) {
    if (trade.cards.has(id)) trade.cards.delete(id);
    else trade.cards.add(id);
  } else openCard = openCard === id ? null : id;
  render();
}

// A card dragged out of the hand: played if it can be, straight away or on to
// the choice it needs; otherwise opened, which says why not.
function pullOut(id: string) {
  const g = snap?.game;
  const me = snap?.you;
  const c = me?.hand.find((x) => x.id === id);
  if (!g || !me || !c) return;
  if ((g.phase === 'discard' && me.deciding) || tradeOpen(g, me)) return tapCard(g, me, id);
  const ready = !c.why;
  if (ready && c.needs === 'hex') return pickHexFor(c);
  if (ready && c.needs === 'none') return send(`${c.kind === 'building' ? 'build' : 'play'} ${c.id}`);
  openCard = id;
  render();
}

function pickHexFor(c: CardView) {
  const verb = c.kind === 'upgrade' ? 'upgrade' : c.kind === 'action' ? 'play' : 'build'; // the command, not the button
  const labels = c.counts && Object.fromEntries(Object.entries(c.counts).map(([k, n]) => [k, String(n)]));
  const title = c.kind === 'upgrade' ? `Choose a building for the ${c.name}` : `Choose a hex for the ${c.fauna ? c.fauna.name : c.name}`;
  const about = pickAbout(cardArt(c.kind, c.key, c.element, c.cls), c.name, c.text, frameColor(c.kind, c.element));
  // Placing a building, a beast or an upgrade shows what the hex does before it's final (#246, #366).
  const now = () => ({ g: snap!.game!, me: snap!.you! });
  const after = (k: string) => (now().me.hand.find((x) => x.id === c.id) ?? c).after?.[k];
  const confirm = c.kind === 'upgrade' ? { verb: c.verb, detail: (k: string) => hexDetail(now().g, now().me, k, after(k)) }
    : c.kind === 'building' ? { verb: c.verb, detail: (k: string) => placeDetail(now().g, c.name, after(k)) }
    : c.fauna ? { verb: c.verb, detail: (k: string) => hexDetail(now().g, now().me, k) } : undefined;
  picking = { title, hexes: c.hexes, command: (h) => `${verb} ${c.id} ${h}`, labels, about, confirm };
  openCard = null;
  render();
}

function grab(e: PointerEvent, el: HTMLElement) {
  if (e.button > 0 || grip) return;
  const fan = el.closest<HTMLElement>('.handfan')!;
  const strips = [...fan.querySelectorAll<HTMLElement>('[data-card]')].map((c) => {
    const r = c.getBoundingClientRect();
    return { id: c.dataset.card!, left: r.left, width: r.width };
  });
  const id = el.dataset.card!;
  grip = { id, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, lift: null, top: fan.getBoundingClientRect().top, strips, hold: 0 };
  grip.hold = window.setTimeout(() => {
    // Held still: open the card to read it.
    grip = null;
    held = true;
    openCard = id;
    render();
  }, HOLD_MS);
  showGrip();
}

addEventListener('pointermove', (e) => {
  if (!grip) return;
  grip.x = e.clientX;
  grip.y = e.clientY;
  if (!grip.moved && Math.hypot(grip.x - grip.x0, grip.y - grip.y0) < MOVE_PX) return;
  if (!grip.moved) {
    grip.moved = true;
    clearTimeout(grip.hold);
  }
  if (!grip.lift && grip.y0 - grip.y > LIFT_PX && grip.y0 - grip.y > Math.abs(grip.x - grip.x0)) grip.lift = { x: grip.x, y: grip.y };
  if (!grip.lift) {
    // The card on top under the thumb: the last one whose left edge it has passed.
    const under = grip.strips.filter((s) => s.left <= grip!.x).at(-1) ?? grip.strips[0];
    if (under) grip.id = under.id;
  }
  showGrip();
});
// The press ends here, not in the card's click: the risen card has left the
// thumb, so its click lands on whatever is under it now, often the next card
// (#295). A tap is the card pressed, and the click that follows is eaten.
function letGo(cancel: boolean) {
  if (held) {
    held = false;
    eatClick = performance.now() + 600;
  }
  const g = grip;
  if (!g) return;
  grip = null;
  clearTimeout(g.hold);
  eatClick = performance.now() + 600;
  showGrip();
  if (cancel) return;
  if (g.lift && g.y < g.top) return pullOut(g.id);
  const gs = snap?.game;
  const me = snap?.you;
  if (!g.moved && gs && me && me.hand.some((c) => c.id === g.id)) tapCard(gs, me, g.id);
}
addEventListener('pointerup', (e) => {
  letGo(false);
  // A swipe across an open card leafs through the hand (or your dragons).
  const s = swipe;
  swipe = null;
  const dx = s ? e.clientX - s.x : 0;
  if (!s || Math.abs(dx) < 50 || Math.abs(dx) < 1.5 * Math.abs(e.clientY - s.y)) return;
  const nav = app.querySelector<HTMLElement>(`#zoom [data-zoomnav="${dx < 0 ? 1 : -1}"], #zoom [data-dragonnav="${dx < 0 ? 1 : -1}"]`);
  if (!nav) return;
  swallowClick = performance.now() + 400;
  nav.click();
});
addEventListener('pointerdown', () => (eatClick = 0), true); // a new press: the last one's click isn't coming
addEventListener('click', (e) => {
  if (!e.isTrusted || performance.now() >= eatClick) return;
  eatClick = 0;
  e.stopPropagation();
  e.preventDefault();
}, true);
addEventListener('pointercancel', () => {
  letGo(true); // the page took the touch to scroll
  swipe = null;
});

// The grip drawn on the hand, without a render: called on every move.
function showGrip() {
  app.querySelectorAll<HTMLElement>('.handfan [data-card]').forEach((el) => {
    const id = el.dataset.card!;
    el.classList.toggle('peek', grip?.id === id);
    el.classList.toggle('lift', grip?.id === id && !!grip.lift);
    el.classList.toggle('out', grip?.id === id && !!grip.lift && grip.y < grip.top);
    el.setAttribute('style', el.getAttribute('style')!.replace(/;--g[xy]:[^;]*/g, '') + gripStyle(id));
  });
}
function gripClass(id: string): string {
  if (grip?.id !== id) return '';
  return ` peek${grip.lift ? ' lift' : ''}${grip.lift && grip.y < grip.top ? ' out' : ''}`;
}
// Where the risen card sits: following the thumb once pulled out, and kept on the screen.
function gripStyle(id: string): string {
  if (grip?.id !== id) return '';
  const s = grip.strips.find((x) => x.id === id);
  let gx = grip.lift ? grip.x - grip.lift.x : 0;
  if (s) {
    const grown = s.width * 0.55 / 2; // the peek is 1.55 times as big, grown from its middle
    gx += Math.max(0, 6 - (s.left - grown)) - Math.max(0, s.left + s.width + grown - (innerWidth - 6));
  }
  const gy = grip.lift ? grip.y - grip.lift.y : 0;
  return `;--gx:${gx.toFixed(0)}px;--gy:${gy.toFixed(0)}px`;
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
  post(`/api/rooms/${code}/do`, { token, via: 'phone', command: to >= 0 ? `tell P${to + 1} ${text}` : `say ${text}` })
    .then(() => (talk.input.value = ''))
    .catch(toast);
};

function talkHtml(text: string, g: PublicState): string {
  const pub = /^(P\d) says: "(.*)"$/.exec(text);
  if (pub) return `${named(pub[1], names)} <q>${esc(pub[2])}</q>`;
  const priv = /^(P\d) to (P\d) \(private\): "(.*)"$/.exec(text);
  if (priv) return `${named(priv[1], names)} <small>to</small> ${named(priv[2], names)} <small>(private)</small> <q>${esc(priv[3])}</q>`;
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
  talk.list.innerHTML = lines.map((e) => `<li class="${e.private ? 'private' : ''}${mine(e.text) ? ' mine' : ''}">${talkHtml(e.text, g)}</li>`).join('') || '<li><small>No messages yet. Players not in the room (like Claude) only see what\'s sent here.</small></li>';
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
    if (performance.now() < swallowClick) return; // the end of a swipe, not a tap
    tapCard(g, me, el.dataset.card!);
  });
  bind('[data-raisehand]', () => {
    handUp = screenKey;
    render();
  });
  app.querySelectorAll<HTMLElement>('.handfan:not(.tucked) [data-card]').forEach((el) => {
    el.onpointerdown = (e) => grab(e, el);
    el.oncontextmenu = (e) => e.preventDefault(); // holding a card opens it, not the browser's menu
  });
  bind('[data-discardpick]', (el) => {
    tapCard(g, me, el.dataset.discardpick!);
    openCard = null;
    render();
  });
  bind('[data-play]', (el) => send(`play ${el.dataset.play}`));
  bind('[data-build]', (el) => send(`build ${el.dataset.build}`));
  bind('[data-pickhex]', (el) => pickHexFor(me.hand.find((x) => x.id === el.dataset.pickhex)!));
  bind('[data-basic]', (el) => {
    const b = me.basics.find((x) => x.key === el.dataset.basic)!;
    if (b.onTower) return send(`build ${b.key}`);
    const about = pickAbout(cardArt('building', b.key, undefined, b.cls), b.name, b.text, frameColor('building'));
    const after = (k: string) => (snap!.you!.basics.find((x) => x.key === b.key) ?? b).after[k];
    const confirm = { verb: 'Build', detail: (k: string) => placeDetail(snap!.game!, b.name, after(k)) };
    picking = { title: `Choose a hex for the ${b.name}`, hexes: b.hexes, command: (h) => `build ${b.key} ${h}`, about, confirm };
    render();
  });
  bind('[data-upproject]', (el) => {
    const u = me.upgradeProjects.find((x) => x.key === el.dataset.upproject)!;
    const about = pickAbout(cardArt('upgrade', u.key), u.name, u.text, frameColor('upgrade'));
    // As placing the card: what the building does with it shows before it's final (#246).
    const now = () => ({ g: snap!.game!, me: snap!.you! });
    const after = (k: string) => (now().me.upgradeProjects.find((x) => x.key === u.key) ?? u).after[k];
    const confirm = { verb: 'Upgrade', detail: (k: string) => hexDetail(now().g, now().me, k, after(k)) };
    picking = { title: `Choose a building for the ${u.name}`, hexes: u.hexes, command: (h) => `project ${u.key} ${h}`, about, confirm };
    render();
  });
  bind('[data-keep]', (el) => send(`keep ${el.dataset.keep}`));
  on('egg', () => {
    eggOpen = !eggOpen;
    render();
  });
  bind('[data-egg]', (el) => {
    eggOpen = false;
    send(`project ${el.dataset.egg}`);
  });
  app.querySelectorAll<SVGElement>('[data-hex]').forEach((el) => (el.onclick = () => {
    if (picking!.confirm) {
      picking!.picked = el.dataset.hex!;
      return render();
    }
    const cmd = picking!.command(el.dataset.hex!);
    picking = null;
    // Picking a beast to clear opens the dragon choice; everything else is a command.
    const send2 = /^(hunt|perch) /.exec(cmd);
    if (send2) hunting = { hex: el.dataset.hex!, chosen: new Set(), perch: send2[1] === 'perch' };
    render();
    if (!send2) send(cmd);
  }));
  on('confirmpick', () => {
    const cmd = picking!.command(picking!.picked!);
    picking = null;
    render();
    send(cmd);
  });
  on('hunt', () => {
    const beastsOnly = me.huntable.every((k) => !snap!.game!.map.find((h) => h.k === k)?.perched.some((x) => x.owner !== me.seat));
    const about = beastsOnly
      ? ''
      : '<p class="hint pabout">You fight its beast and any rival dragons perched there.</p>';
    picking = { title: beastsOnly ? 'Choose a beast to clear' : 'Choose a hex to clear', hexes: me.huntable, command: (h) => `hunt ${h}`, about };
    render();
  });
  on('autoclear', () => send('autoclear'));
  on('perch', () => {
    picking = { title: 'Choose a building to perch on', hexes: me.perchable, command: (h) => `perch ${h}`, about: '' };
    render();
  });
  bind('[data-recall]', (el) => send(`recall ${el.dataset.recall}`));
  bind('[data-hunter]', (el) => {
    const id = el.dataset.hunter!;
    if (hunting!.chosen.has(id)) hunting!.chosen.delete(id);
    else hunting!.chosen.add(id);
    render();
  });
  on('hunterall', () => {
    hunting!.chosen = hunting!.chosen.size === me.raidReady.length ? new Set() : new Set(me.raidReady);
    render();
  });
  on('huntgo', () => {
    const cmd = `${hunting!.perch ? 'perch' : 'clear'} ${hunting!.hex} ${[...hunting!.chosen].join(' ')}`;
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
  // Your dragons' cards: open one from the roost, leaf through the rest.
  bind('[data-dragon]', (el) => {
    openDragon = el.dataset.dragon!;
    openCard = null;
    render();
  });
  bind('[data-dragonnav]', (el) => {
    const mine = g.dragons.filter((d) => d.owner === me.seat);
    const i = mine.findIndex((d) => d.id === openDragon);
    openDragon = mine[(i + Number(el.dataset.dragonnav) + mine.length) % mine.length].id;
    render();
  });
  // The ✕ on an open card, or a tap outside it, closes it.
  bind('[data-zoomclose]', () => {
    openCard = null;
    openDragon = null;
    render();
  });
  const zoomEl = document.getElementById('zoom');
  if (zoomEl) zoomEl.onpointerdown = (e) => (swipe = { x: e.clientX, y: e.clientY });
  if (zoomEl) zoomEl.onclick = (e) => {
    if (e.target !== zoomEl || performance.now() < swallowClick) return;
    openCard = null;
    openDragon = null;
    render();
  };
  on('cancelpick', () => {
    picking = null;
    render();
  });
  on('end', () => {
    endAsk = performance.now();
    render();
  });
  on('endno', () => {
    endAsk = null;
    render();
  });
  // A tap within a moment of End turn is the same finger bouncing, not a confirm.
  on('endyes', () => endAsk !== null && performance.now() - endAsk > 400 && send('end'));
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
  on('bankgo', () => send(`merchants ${bank.give} ${bank.get} ${bank.times}`));
  // trade
  bind('[data-to]', (el) => {
    trade.to = el.dataset.to === 'anyone' ? null : Number(el.dataset.to);
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
    const cmd = `offer ${trade.to === null ? 'anyone' : `P${trade.to + 1}`} give ${side(trade.give, [...trade.cards].filter((id) => me.hand.some((c) => c.id === id)))} get ${side(trade.get)}`;
    trade = fresh();
    tab = 'none';
    send(cmd);
  });
  // raid
  bind('[data-vote]', (el) => send(`vote ${el.dataset.vote}`));
  bind('[data-fighter]', (el) => {
    const cur = new Set(fightDraft ?? g.raid!.sent[me.seat]);
    const id = el.dataset.fighter!;
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    fightDraft = [...cur];
    render();
  });
  on('fighterall', () => {
    const mine = g.raid!.sent[me.seat];
    fightDraft = (fightDraft ?? mine).length === mine.length ? [] : [...mine];
    render();
  });
  on('fight', () => send(`fight ${(fightDraft ?? g.raid!.sent[me.seat]).join(' ')}`));
  on('hold', () => send('hold'));
  on('discard', () => send(`discard ${[...selected].join(' ')}`));
  on('newgame', () => {
    code = ''; // a new game is in a new room: type its code, or scan the TV
    leaveToJoin('');
  });
  on('menu', () => {
    menu = !menu;
    bookTab = null;
    render();
  });
  // The rulebook lies over whatever the screen is, and closes back to it.
  // Rules opens it at its first tab, the wheel's ring of dots at Elements.
  const openBook = (tab: BookTab) => {
    bookTab = bookTab ? null : tab;
    menu = false;
    render();
    if (bookTab) loadBook(me.seat, () => bookTab && render());
  };
  on('book', () => openBook('board'));
  on('wheel', () => openBook('elements'));
  for (const id of ['bookclose', 'bookdone']) {
    on(id, () => {
      bookTab = null;
      render();
    });
  }
  bind('[data-booktab]', (el) => {
    bookTab = el.dataset.booktab as BookTab;
    render();
    app.querySelector('.bookpage')?.scrollTo(0, 0);
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
  on('save', async () => {
    menu = false;
    await post(`/api/rooms/${code}/save`, { token });
  });
  bind('[data-standin]', (el) => post(`/api/rooms/${code}/standin`, { token, seat: Number(el.dataset.standin) }));
}

function toast(e: unknown) {
  const t = document.createElement('div');
  t.className = 'toast';
  // The engine names players P1, P2...; the toast names them as every other screen does.
  t.innerHTML = named(e instanceof Error ? e.message : String(e), names);
  document.body.append(t);
  setTimeout(() => fadeAway(t), 3500);
}

boot().catch(toast);
