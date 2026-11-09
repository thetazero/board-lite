// The TV: the shared board. Shows everything public, never anyone's hand.
// Opening it on any room, in the lobby or mid-game, makes it that table's TV;
// closing it, the table goes on with no TV (src/server/room.ts, Room.hasTv).
// Lobby -> board, with overlays for production dice, the raid and the end.
// With ?remote, it's the table view inside a phone of a game with no TV
// (phone.ts): the flat map, laid out for a phone, and it tells the phone when
// a cutscene (a banner) starts and ends, so the phone can cut to it.

import type { DragonView, EventView, PublicState, SavedGame, Snapshot, TargetView } from '../src/state.ts';
import {
  ELEMENT_COLORS, PLAYER_COLORS, firstPlayer, POINTS_TO_WIN, STAGE_LABEL, TERRAIN_COLORS, TERRAIN_NAMES, TITLE_ICON, buildingIcon, dieFace, dragonBadge, dragonChip, dragonLabel, dragonState, elemWords, esc, eventHtml, hungerTags, gainChips, netChips, hpBar, statTag, hpFill, powerTag, icon, iconText, lastRoundHtml, mapSvg, pointsTrack, named, playerTag, post, resChips, savedWhen, resIcon, standingsHtml, tiebreakNote, watch, fadeAway,
} from './common.ts';
import { foeStack, kingdomCard, lootLine, pointsLeader, pointsLine, voterTag } from './kingdom.ts';
import { ART_DEFS, tableScene, towerToken, winnerScene } from './art.ts';
import { backdrop, burst, crown, dragonFigure, unitFigure } from './arena.ts';
import type { Board3D, Fighter } from './board3d.ts';
import { qrSvg } from './qr.ts';
import { nextTip, TIP_MS, TIPS } from './tips.ts';
import { breakdownHtml, madeSvg, momentsHtml, powerSvg, raceSvg } from './recap-view.ts';
import type { Recap } from '../src/state.ts';
import { CROWN_AT_MS, FIGHT_LEAD_MS, POINTS_AT_MS, outcomeAt, PROD_LEAD_MS, PROD_PLAYER_IN_MS, PROD_TOTAL_MS, eatOf, hitStep, madeOf, prodSpin, prodRowsOf, prodStep, scenesOf, type Scene } from './scenes.ts';

document.body.insertAdjacentHTML('afterbegin', ART_DEFS);

const $ = (id: string) => document.getElementById(id)!;
const app = $('app');

let code = '';
let hostToken = '';
// A second TV opened on the room's address has no host token: it shows the
// room, but adding bots and starting are for the TV that made the room.
let isHost = false;
let snap: Snapshot | null = null;
let names: string[] = [];
let lan: { lan: string[]; tailscale: string[]; port: number } = { lan: [], tailscale: [], port: Number(location.port) || 80 };
let seenLog = -1; // highest log index already animated
let savedGames: SavedGame[] = []; // the server's saved games, offered in a new room's lobby
// The 3D board lives across re-renders; without WebGL the TV falls back to the flat map.
let board3d: Board3D | null | undefined;
let Board3DClass: typeof Board3D | null = null; // loaded only on a real TV: three.js is the heaviest thing on the page
// The fight's stage and figures, folded from the board's models (board3d.ts);
// null without WebGL, when the fight is drawn in flat paper (arena.ts).
let fight3d: typeof import('./board3d.ts') | null = null;
async function load3d(): Promise<typeof import('./board3d.ts') | null> {
  try {
    const m = await import('./board3d.ts');
    return m.Board3D.supported() ? m : null;
  } catch (e) {
    console.error('No 3D board:', e);
    return null;
  }
}
const remote = new URLSearchParams(location.search).has('remote');

async function boot() {
  const params = new URLSearchParams(location.search);
  code = (params.get('room') ?? '').toUpperCase();
  if (remote) {
    // Inside a phone: watch the room, never make one.
    document.body.classList.add('remote');
    board3d = null;
    // It shows the TV's fights, so it folds their figures too: three.js
    // loads behind the table, never holding it up (a fight before it's in is
    // drawn flat).
    // (`folded` on the body says it has settled, either way.)
    void load3d().then((m) => { fight3d = m; document.body.classList.add('folded'); });
    return watch(code, null, onSnapshot, (ok) => document.body.classList.toggle('offline', !ok));
  }
  // If three.js can't load, the TV still runs, on the flat map.
  fight3d = await load3d();
  Board3DClass = fight3d?.Board3D ?? null;
  hostToken = localStorage.getItem(`tv:${code}`) ?? '';
  if (code) {
    const room = await fetch(`/api/rooms/${code}?token=${hostToken}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!room) code = '';
    isHost = !!room?.host;
    // No TV watching this room (one made from a phone, or this TV's token is
    // in another browser): this one becomes its TV, buttons and all.
    if (room && !isHost) {
      const r = await post(`/api/rooms/${code}/tv`, {}).catch(() => null);
      if (r?.hostToken) {
        hostToken = String(r.hostToken);
        isHost = true;
        localStorage.setItem(`tv:${code}`, hostToken);
      }
    }
  }
  if (!code) {
    const r = await post('/api/rooms', {});
    code = String(r.code);
    hostToken = String(r.hostToken);
    isHost = true;
    localStorage.setItem(`tv:${code}`, hostToken);
    history.replaceState(null, '', `/tv?room=${code}`);
  }
  lan = await fetch('/api/info').then((r) => r.json()).catch(() => lan);
  savedGames = await fetch('/api/saved').then((r) => r.json()).catch(() => []);
  // A room the server no longer has (forgotten after hours idle): open a new one.
  // As a TV: while it watches, the table plays with a TV.
  watch(code, null, onSnapshot, (ok) => document.body.classList.toggle('offline', !ok), () => location.replace('/tv'), true);
}

function onSnapshot(s: Snapshot) {
  const first = !snap?.game && !!s.game && seenLog < 0;
  if (snap?.game && s.game) seatNews(snap, s);
  snap = s;
  names = s.lobby.seats.map((x) => x.name);
  document.body.classList.toggle('playing', isHost && !!s.game && !s.lobby.seating && !s.lobby.saved && s.game.phase !== 'over');
  // Before the game, while a game file hosted again takes its seats, and
  // while the game is saved, the TV shows the lobby.
  if (!s.game || s.lobby.seating || s.lobby.saved) {
    clearOverlay();
    if (remote) return void (app.innerHTML = '');
    if (s.game) seenLog = s.game.log.at(-1)?.i ?? -1; // the game goes on from here: nothing to replay
    return renderLobby();
  }
  if (s.game.phase !== 'over') sawPlay = true;
  const log = s.game.log;
  if (first) {
    // Joined mid-game (e.g. the TV reloaded): only animate what happens from now on,
    // except the opening round, which is worth showing.
    seenLog = s.game.round === 1 && (s.game.phase === 'action' || s.game.phase === 'cards') ? -1 : log.at(-1)?.i ?? -1;
  }
  const fresh = log.filter((e) => e.i > seenLog);
  if (fresh.length) seenLog = fresh.at(-1)!.i;
  queueBanners(s.game, fresh);
  // While a scene plays, the board, the panels, the feed and the titles stay
  // as they were when it began, so nothing in the corners gives its ending
  // away; they catch up when it's over.
  if (!shown || (!bannerUp && !banners.length)) renderGame(s.game);
  else renderGame(shown);
  updateOverlay(s.game);
}

// Mid-game, the table hears when someone quits, when a bot starts playing for
// someone who's away, and when a seat is taken back.
function seatNews(before: Snapshot, now: Snapshot) {
  if (everyoneQuit(now.lobby) && !everyoneQuit(before.lobby)) return note('Everyone quits. The game ends.');
  now.lobby.seats.forEach((s, i) => {
    const was = before.lobby.seats[i];
    if (!was || s.kind !== 'player') return;
    const who = esc(s.name);
    if (s.left && !was.left) note(`${who} quits: a bot plays for them`);
    else if (s.standIn && !was.standIn) note(`${who} is away: a bot plays for them`);
    else if (!s.standIn && was.standIn) note(`${who} is back`);
  });
}

// ---------- lobby ----------

// The room's address: phones open it, and CLI players use it as the game.
function joinUrl(host = lan.lan[0] ?? lan.tailscale[0] ?? location.hostname): string {
  return `${host}${lan.port && lan.port !== 80 ? `:${lan.port}` : ''}/${code}`;
}

// Phones on the same tailnet reach this machine from anywhere at its Tailscale address.
function tailscaleUrl(): string | null {
  const t = lan.tailscale[0];
  return t && lan.lan.length ? joinUrl(t) : null;
}

// The lobby's tip (tips.ts): a random one, changed every TIP_MS. Only the
// tip's text changes, so the rest of the lobby stays still under it.
let tip = Math.floor(Math.random() * TIPS.length);
setInterval(() => {
  const el = document.getElementById('tip');
  if (!el) return;
  tip = nextTip(tip);
  el.textContent = TIPS[tip];
}, TIP_MS);

// The lobby: who's at the table, and how to join. A game file hosted again
// comes back here until every seat is taken: its seats are the game's, the
// open ones waiting in their player's colour. A saved game waits here too,
// with Continue in place of Start game, until someone continues it. A new
// room offers the server's saved games.
function renderLobby() {
  const l = snap!.lobby;
  if (l.saved) return renderSaved();
  const seated = l.seats.map((_, i) => PLAYER_COLORS[i]);
  const open = l.seats.filter((s) => s.kind === 'open').length;
  // Each seat a place card with its tower; empty places wait, dashed, up to a full table.
  const seats = l.seats.map((s, i) => s.kind === 'open'
    ? `<li class="seatcard open needed" style="--pc:${PLAYER_COLORS[i]}">${towerToken(PLAYER_COLORS[i], 2.6)}<span class="pname">Open seat</span></li>`
    : `<li class="seatcard" style="--pc:${PLAYER_COLORS[i]}">${towerToken(PLAYER_COLORS[i], 2.6)}
      <span class="pname">${esc(s.name)}</span>${s.kind === 'bot' ? '<span class="tag">bot</span>' : ''}${s.kind === 'player' && !s.connected ? '<span class="tag">away</span>' : ''}
      ${isHost ? `<button class="x" data-remove="${i}" aria-label="remove ${esc(s.name)}" title="remove">×</button>` : ''}</li>`).join('')
    + (l.seating ? '' : Array.from({ length: l.maxPlayers - l.seats.length }, (_, i) => `<li class="seatcard open${l.seats.length + i < l.minPlayers ? ' needed' : ''}"></li>`).join(''));
  const canStart = l.seats.length >= l.minPlayers;
  const first = firstPlayer(l);
  const hint = l.seating ? 'The game goes on once every seat is taken.'
    : !canStart ? `Waiting for ${l.minPlayers - l.seats.length} more player${l.minPlayers - l.seats.length > 1 ? 's' : ''} (a bot counts).`
    : isHost ? (first ? `Or start from ${esc(first)}'s phone.` : '')
    : first ? `${esc(first)} starts the game.` : 'The TV that made the room starts the game.';
  app.innerHTML = `
    <div class="lobby">
      <div class="hero">${tableScene(seated, 480, 124, 0.4, 1)}${nameplate()}</div>
      <div class="lobby-main">
        ${joinBox(l.seating ? 'Take your seat on your phone' : 'Join on your phone')}
        <div class="table">
          ${l.seating ? `<h2 class="seating">${open} open seat${open > 1 ? 's' : ''}</h2>` : ''}
          <ul class="seatcards">${seats}</ul>
          ${isHost ? `<div class="lobby-actions">
            <button id="bot" ${(l.seating ? !open : l.seats.length >= l.maxPlayers) ? 'disabled' : ''}>Add a bot</button>
            ${l.seating ? '' : `<button id="start" class="primary" ${canStart ? '' : 'disabled'}>Start game</button>`}
          </div>` : ''}
          ${hint ? `<p class="hint">${hint}</p>` : ''}
        </div>
      </div>
      ${(isHost && !snap!.game && savedList()) || `<p class="tipline"><b>Tip</b> <span id="tip">${esc(TIPS[tip])}</span></p>`}
    </div>`;
  if (!isHost) return;
  app.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => (b.onclick = () => location.assign(`/tv?room=${b.dataset.open}`)));
  $('bot').onclick = () => post(`/api/rooms/${code}/bot`, { token: hostToken }).catch(toast);
  if (!l.seating) $('start').onclick = () => post(`/api/rooms/${code}/start`, { token: hostToken }).catch(toast);
  app.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) => (b.onclick = () => post(`/api/rooms/${code}/leave`, { token: hostToken, seat: Number(b.dataset.remove) }).catch(toast)));
}

const nameplate = () => `<div class="nameplate"><h1 class="title">board-lite</h1><p class="subtitle">Wizards raise dragons. First to ${iconText(`${POINTS_TO_WIN} points`)} wins.</p></div>`;

// How to join: the room's QR code, address and code.
function joinBox(step: string): string {
  return `<div class="join-box">
          ${qrSvg(`http://${joinUrl()}`, 'the room\'s address')}
          <div class="join-text">
            <div class="step">${step}</div>
            <div class="how">Point its camera at the code, or open</div>
            <div class="url">${esc(joinUrl())}</div>
            ${tailscaleUrl() ? `<div class="alt">or over Tailscale <b>${esc(tailscaleUrl()!)}</b></div>` : ''}
            <div class="step">Room code</div>
            <div class="code">${[...snap!.lobby.code].map((c) => `<span>${esc(c)}</span>`).join('')}</div>
          </div>
        </div>`;
}

// The saved games a new room's TV can open instead (the newest few), along
// the bottom in the tip's place: each opens on its own lobby, where the table
// takes its seats and continues it.
function savedList(): string {
  const games = savedGames.filter((s) => s.code !== code).slice(0, 3);
  if (!games.length) return '';
  return `<div class="savedgames"><h3>Saved games</h3><ul>${games.map((s) => `<li><span class="who"><b>${esc(s.names.join(', '))}</b><small>Round ${s.round}, saved ${esc(savedWhen(s.savedAt))}</small></span><button data-open="${esc(s.code)}">Open</button></li>`).join('')}</ul></div>`;
}

// A saved game: who sat where, the join code for their phones, and Continue.
function renderSaved() {
  const l = snap!.lobby;
  const g = snap!.game!;
  const seats = l.seats.map((s, i) => `<li class="seatcard" style="--pc:${PLAYER_COLORS[i]}">${towerToken(PLAYER_COLORS[i], 2.6)}
      <span class="pname">${esc(s.name)}</span>${s.kind === 'bot' ? '<span class="tag">bot</span>' : ''}${s.kind === 'player' && !s.connected ? '<span class="tag">away</span>' : ''}</li>`).join('');
  app.innerHTML = `
    <div class="lobby saved">
      <div class="hero">${tableScene(l.seats.map((_, i) => PLAYER_COLORS[i]), 480, 124, 0.4, 1)}${nameplate()}</div>
      <div class="lobby-main">
        ${joinBox('Take your seat on your phone')}
        <div class="table">
          <h2 class="seating">Game saved</h2>
          <ul class="seatcards">${seats}</ul>
          ${isHost ? '<div class="lobby-actions"><button id="continue" class="primary">Continue</button></div>' : ''}
          <p class="hint">Round ${g.round}, saved ${esc(savedWhen(l.saved!))}. ${isHost ? 'Continue' : 'Continue on a phone'} when everyone is back.</p>
        </div>
      </div>
      <p class="tipline"><b>Tip</b> <span id="tip">${esc(TIPS[tip])}</span></p>
    </div>`;
  if (isHost) $('continue').onclick = () => post(`/api/rooms/${code}/continue`, { token: hostToken }).catch(toast);
}

// ---------- the board ----------

// The round's phases, as the rules name them, and which one the game is in.
// The top bar shows them as a track with the current one lit: the players'
// panels say who the table is waiting on, so the bar only says where in the
// round it is.
const PHASES = ['Production', 'Cards', 'Actions', 'Raid', 'End of round'] as const;
type Phase = (typeof PHASES)[number] | 'Game over';

function phaseNow(g: PublicState): Phase {
  if (bannerTop) return bannerTop.phase;
  if (g.phase === 'over') return 'Game over';
  if (g.phase === 'action') return 'Actions';
  if (g.phase === 'discard') return 'End of round';
  if (g.phase === 'cards') return 'Cards';
  return 'Raid';
}

function phaseTrack(g: PublicState): string {
  const now = phaseNow(g);
  if (now === 'Game over') return '<span class="phase">Game over</span>';
  return `<ol class="phases">${PHASES.map((p) => `<li${p === now ? ' class="phase"' : ''}>${p}</li>`).join('')}</ol>`;
}

// What one player is doing right now, if the table is waiting on them.
function doing(g: PublicState, p: number): string {
  if (bannerUp || !g.waitingOn.includes(p)) return ''; // during a scene, everyone watches
  if (g.phase === 'action') return g.turn === p ? 'Taking a turn' : 'Answering an offer';
  if (g.phase === 'discard') return 'Discarding';
  // The card step shows nothing: everyone keeps a card at once, and the phone asks (#229).
  if (g.phase === 'raid') return g.raid?.step === 'vote' ? 'Voting' : 'Fighting or holding back';
  return '';
}

// A dragon on the TV: always its name, then its stage and how it is: its
// health, or why it can't fight (knocked out, greyed; or perched), and
// whether it went hungry this round.
function tvDragon(d: DragonView, all: DragonView[], roomy: boolean, round: number): string {
  const grow = roomy && d.stage < 3 ? ` <span class="grow">${'●'.repeat(d.growth)}${'○'.repeat(Math.max(0, d.growthTime - d.growth))}</span>` : '';
  return `<div class="tvdragon${d.status === 'out' ? ' out' : ''}">${dragonBadge(d, 44)}<div><b>${esc(dragonLabel(d, all))}${d.hungry ? ` ${hungerTags(d)}` : ''}</b><span>${STAGE_LABEL[d.stage]}${grow}${d.stage ? ` ${powerTag(d.power)}` : ''} ${dragonState(d, round)}</span></div></div>`;
}

// A player's dragons in brief, for a board too crowded for the list (#406):
// each dragon a picture (its size its stage) over its health bar, grouped by
// element, biggest first; knocked out ones greyed, perched ones ringed. Then
// the power of the raid-ready ones (what their vote is worth), and how many
// can't fight and why.
const ELEMENT_ORDER = Object.keys(ELEMENT_COLORS);
function tvDragonsBrief(ds: DragonView[], all: DragonView[]): string {
  if (!ds.length) return '<div class="none">No dragons</div>';
  const sorted = [...ds].sort((a, b) => ELEMENT_ORDER.indexOf(a.element) - ELEMENT_ORDER.indexOf(b.element) || b.stage - a.stage);
  const tiles = sorted.map((d, i) => {
    const gap = i && d.element !== sorted[i - 1].element ? ' gap' : '';
    const st = d.status === 'out' ? ' out' : d.perch ? ' perched' : '';
    return `<span class="bdragon${st}${gap}" title="${esc(dragonLabel(d, all))}">${dragonBadge(d, 40)}${d.stage ? hpBar(d.hp, d.maxHp) : '<i></i>'}</span>`;
  }).join('');
  const power = ds.filter((d) => d.canRaid).reduce((s, d) => s + d.power, 0);
  const out = ds.filter((d) => d.status === 'out').length;
  const perched = ds.filter((d) => d.perch).length;
  const tags = `${powerTag(power)}${out ? ` <em class="st-out">${out} knocked out</em>` : ''}${perched ? ` <em class="st-perched">${perched} perched</em>` : ''}`;
  return `<div class="btiles">${tiles}<span class="bsum">${tags}</span></div>`;
}

// Why a seat isn't a person playing right now.
function seatTag(seat: Snapshot['lobby']['seats'][number] | undefined): string {
  if (!seat || seat.standIn) return '';
  if (seat.kind === 'open') return ' <small>(open seat)</small>';
  return seat.connected ? '' : ' <small>(away)</small>';
}

// Every player has quit: the server stops the game (bots alone never score)
// and soon forgets the room.
function everyoneQuit(l: Snapshot['lobby']): boolean {
  const people = l.seats.filter((s) => s.kind === 'player');
  return people.length > 0 && people.every((s) => s.left);
}

// A bot playing for a player says so on its own line: the table should know
// those moves aren't theirs.
function seatNote(seat: Snapshot['lobby']['seats'][number] | undefined): string {
  if (!seat?.standIn) return '';
  if (everyoneQuit(snap!.lobby)) return '<span class="seatnote">Quit</span>';
  return `<span class="seatnote">${seat.left ? 'Quit' : 'Away'}: bot plays</span>`;
}

let shown: PublicState | null = null; // the state the board is drawn from

function renderGame(g: PublicState) {
  shown = g;
  const n = g.players.length;
  const players = g.players.map((p, i) => {
    const titles = g.titles.filter((t) => t.holder === i).map((t) => `<span class="title-badge" title="${esc(t.name)}">${icon(TITLE_ICON[t.key], 1.1)}</span>`).join('')
      + g.beasts.filter((b) => b.slainBy === i).map((b) => `<span class="title-badge" title="${esc(b.name)} slain">${icon(b.key, 1.1)}</span>`).join('');
    const mine = g.dragons.filter((d) => d.owner === i);
    const dragons = mine.map((d) => tvDragon(d, g.dragons, n <= 4, g.round)).join('') || '<div class="none">No dragons</div>';
    const seat = snap!.lobby.seats[i];
    const turn = g.phase === 'action' && g.turn === i;
    const what = doing(g, i);
    return `
      <div class="pcard${turn ? ' turn' : ''}" style="--pc:${PLAYER_COLORS[i]}">
        <div class="phead">
          <span class="pname">${esc(names[i])}${seatTag(seat)}</span>
          ${titles ? `<span class="badges">${titles}</span>` : ''}
          <span class="hand" title="cards in hand">${icon('cards', 1.2)}${p.handSize}</span>
          <span class="pts">${icon('points', 1.3)}<b>${g.finalTotals?.[i] ?? p.publicPoints}</b></span>
        </div>
        ${g.phase === 'over' ? '' : pointsTrack(p, g.pointsToWin)}
        ${seatNote(seat)}${what ? `<span class="doing">${what}</span>` : ''}
        <div class="dragons">${dragons}</div>
        ${remote ? '' : `<div class="dragons brief">${tvDragonsBrief(mine, g.dragons)}</div>`}
      </div>`;
  });
  const offers = g.offers.map((o) => `<li>${playerTag(o.from, names)} <b>${iconText(esc(o.give))}</b><span class="arrow">⇄</span><b>${iconText(esc(o.get))}</b> ${o.to === null ? '<b>Anyone</b>' : playerTag(o.to, names)}</li>`).join('');
  // Each title: everyone's count in their colour, the holder's ringed, and the
  // count it takes to hold it at all.
  const titles = g.titles.map((t) => `<li>${icon(TITLE_ICON[t.key], 1.3)}<b>${esc(t.name)}</b>
    <span class="tvals">${t.values.map((v, p) => `<span class="tval${t.holder === p ? ' held' : ''}${v < t.min ? ' under' : ''}" style="--pc:${PLAYER_COLORS[p]}">${v}</span>`).join('')}</span><small class="tmin">≥${t.min}</small></li>`).join('');
  // The race for the great beasts: each one, what it's weak to, and who slew it.
  const beasts = g.beasts.map((b) => `<li class="beast${b.slainBy !== null ? ' slain' : ''}">${icon(b.key, 1.5)}<b>${esc(b.name)}</b>
    ${b.slainBy === null ? `<span class="weak">Weak to ${elemWords(b.weak)}</span>` : `<span>Slain by ${playerTag(b.slainBy, names)}</span>`}</li>`).join('');
  // Things that happened and what people said, in the order they did.
  const feed = [...g.log.map((e) => ({ i: e.i, html: eventHtml(e, g, names), said: false })), ...g.talk.map((e) => ({ i: e.i, html: talkLine(e.text, g), said: true }))]
    .filter((x) => x.html).sort((a, b) => a.i - b.i).slice(-5)
    .map((x) => `<li${x.said ? ' class="said"' : ''}>${x.html}</li>`).join('');
  if (board3d === undefined) board3d = Board3DClass?.supported() ? new Board3DClass() : null;
  const highlight = g.phase === 'action' ? g.turn : null;
  // The flat map needs a legend; the 3D board shows what things are.
  const flat = () => {
    const legend = Object.keys(TERRAIN_COLORS).map((t) => `<span><i style="background:${TERRAIN_COLORS[t]}"></i>${TERRAIN_NAMES[t]}</span>`).join('');
    const bLegend = (['tower', 'quarry', 'lumber_camp', 'crystal_mine', 'pasture', 'roost', 'hatchery', 'port', 'monument'] as const)
      .map((b) => `<span>${buildingIcon(b, 18, '#ddd')}${b.replace('_', ' ')}</span>`).join('');
    return `${mapSvg(g.map, { size: 40, highlight })}<div class="legend">${legend}</div><div class="legend">${bLegend}</div>`;
  };
  // The board fills the screen, centred; the player cards stand in the
  // columns either side of it, the first half of the table on the left, and
  // the feed and the titles take the bottom corners. Open trade offers sit
  // over the top of the board while they're open.
  const half = Math.ceil(n / 2);
  const last = lastRoundHtml(g, names);
  app.innerHTML = `
    <div class="board">
      <section class="mapwrap" id="mapwrap">${board3d ? '' : flat()}</section>
      ${offers ? `<div class="panel offers"><h3>Trade offers</h3><ul>${offers}</ul></div>` : ''}
      <header class="topbar">
        <span class="round">Round ${bannerTop?.round ?? g.round}</span>
        ${phaseTrack(g)}
        ${last ? `<span class="goal last">${last}</span>` : `<span class="goal">First to <b>${g.pointsToWin}</b>${icon('points', 1.2)} wins</span>`}
      </header>
      <aside class="side left p${n}">${players.slice(0, half).join('')}<div class="corner feedbox"><ul class="feed">${feed}</ul></div></aside>
      <aside class="side right p${n}">${players.slice(half).join('')}<div class="corner titles"><h3>Titles <span class="chip">+${iconText(`${g.titlePoints} points`)}</span></h3><ul>${titles}</ul>
        <h3>Great beasts <span class="chip">+${iconText(`${g.beasts[0]?.points ?? 0} points`)}</span></h3><ul>${beasts}</ul></div></aside>
    </div>`;
  if (board3d) {
    $('mapwrap').prepend(board3d.el);
    board3d.update(g, highlight);
  }
  fitSide();
  // The feed shows the newest lines at the bottom; an older one that only
  // partly fits at the top is dropped rather than shown sliced in half.
  for (const ul of app.querySelectorAll<HTMLElement>('.side ul.feed')) {
    const top = ul.getBoundingClientRect().top;
    while (ul.children.length > 1 && ul.firstElementChild!.getBoundingClientRect().top < top - 1) ul.firstElementChild!.remove();
  }
}

// The player cards start as large as their count allows (style.css) and step
// down until both columns fit, together, so every card is the same size:
// many dragons in a big game take more room. When the cards are still too
// tall once the lists of dragons have shrunk as far as they read well at TV
// distance, every card shows its dragons in brief instead (#406), from the
// starting size again.
function fitSide() {
  if (remote) return; // a phone's table view scrolls instead
  const sides = [...app.querySelectorAll<HTMLElement>('.side')];
  if (!sides.length) return;
  const start = parseFloat(getComputedStyle(sides[0]).fontSize);
  const min = parseFloat(getComputedStyle(document.body).fontSize) * 1.05;
  // (A corner's size is its own, so a corner too wide isn't helped by shrinking the cards.)
  const rows = app.querySelectorAll<HTMLElement>('.phead, .dragons');
  const tall = () => sides.some((s) => s.scrollHeight > s.clientHeight + 1);
  const over = () => tall() || [...rows].some((r) => r.scrollWidth > r.clientWidth + 1);
  const fit = (floor: number) => {
    let px = start;
    for (const s of sides) s.style.fontSize = `${px}px`;
    while (over() && px > floor) {
      px = Math.max(floor, px * 0.95);
      for (const s of sides) s.style.fontSize = `${px}px`;
    }
  };
  fit(Math.max(min, start * BRIEF_BELOW));
  if (!over()) return;
  if (!tall()) return fit(min);
  // In brief, a card is mostly pictures and a few numbers: it may go a little smaller.
  for (const s of sides) s.classList.add('brief');
  fit(min * 0.85);
}
// How far the list of dragons may shrink, from the size the cards start at,
// before they show in brief instead.
const BRIEF_BELOW = 0.8;

// "P2 says: "hi"" -> the speaker's name, then what they said.
function talkLine(text: string, g: PublicState): string {
  const m = /^(P\d) says: "(.*)"$/.exec(text);
  return m ? `${named(m[1], names)} <q>${esc(m[2])}</q>` : named(text, names, g.dragons);
}

// ---------- overlays ----------

// The raid takes over the screen while it runs. Every step is the same
// arena: the raiders on the left, the kingdom's defenders on the right.
function targetCard(t: TargetView, leader: number | null = null): string {
  return `<div class="target"><h2>${esc(t.name)} ${powerTag(t.power, 'big')}</h2>${foeStack(t.units, 2.6)}${lootLine(t.loot, 1.6)}${pointsLine(t, 1.6, leader === null ? null : { p: leader, names })}</div>`;
}

function check(done: boolean): string {
  return done ? '<span class="ok">✔</span>' : '<span class="wait">○</span>'; // not "…", which reads as text cut off
}

// Raids still to come this round after this one, said in words beside the step's name.
function raidPips(g: PublicState): string {
  if (g.raidsLeft < 2) return '';
  const n = g.raidsLeft - 1;
  return `<span class="moreraids">${n} more raid${n === 1 ? '' : 's'} this round</span>`;
}

// That the table doesn't see a choice as it's made, in words.
const SECRET = '<span class="tag">Secret</span>';

// A raider's dragons in brief, for however many they have in the raid: one picture per
// element with how many of it (drawn at its biggest stage), and their health
// added up in one bar. The power beside it says how strong they are together.
function dragonSummary(ds: DragonView[]): string {
  const groups = Object.keys(ELEMENT_COLORS).flatMap((e) => {
    const of = ds.filter((d) => d.element === e);
    if (!of.length) return [];
    const top = of.reduce((a, b) => (b.stage > a.stage ? b : a));
    return [`<span class="rgroup" title="${of.map((d) => esc(d.name)).join(', ')}"><b>${of.length}</b>${dragonBadge(top, 56)}</span>`];
  });
  const hp = ds.reduce((s, d) => s + d.hp, 0);
  const max = ds.reduce((s, d) => s + d.maxHp, 0);
  return `<span class="rsum">${groups.join('')}<span class="rhp">${statTag('Health', `${hp}/${max}`)}${hpBar(hp, max)}</span></span>`;
}

// Whether a raider has chosen to fight or hold back, never which: a card laid face
// down once they have, an empty place for it while they're choosing.
function choiceMark(done: boolean): string {
  return done ? '<span class="choice done"><i></i>Chosen</span>' : '<span class="choice"><i></i>Choosing</span>';
}

// The raiders' power, each player's share in their colour, pushing against the
// kingdom's from the other end; past the middle, the raiders usually win
// (rules.md, combat power). It counts everyone in, as no one has held back
// yet that the table knows of.
function balance(sides: { p: number; power: number }[], foe: number): string {
  const ours = sides.reduce((s, x) => s + x.power, 0);
  const segs = sides.map((x) => `<i style="--pc:${PLAYER_COLORS[x.p]};flex:${x.power}"></i>`).join('');
  return `<div class="balance${ours > foe ? ' ahead' : ''}"><div class="bside">${powerTag(ours, 'big')}<small>If everyone fights</small></div><div class="bbar">${segs}<i class="foe" style="flex:${foe}"></i><b class="mid"></b></div><div class="bside foe">${powerTag(foe, 'big')}</div></div>`;
}

const HOME = buildingIcon('roost', 40, '#9aa1ad'); // going home: the roost

function renderRaid(g: PublicState) {
  const raid = g.raid;
  if (!raid) return;
  const dragonById = (id: string) => g.dragons.find((d) => d.id === id)!;
  const sum = (ids: string[]) => ids.reduce((s, id) => s + dragonById(id).power, 0);
  const arena = (rows: string, cls = '') => `<div class="arena ${cls}"><ul class="raiders">${rows}</ul><div class="vs">${icon('raid', 3)}</div>${targetCard(raid.target!, pointsLeader(g, raid.sent))}</div>`;
  let body = '';
  if (raid.step === 'vote') {
    body = `<h1>${icon('raid', 1.1)} Vote ${raidPips(g)}</h1>
      <div class="candidates vote" style="--cols:${raid.candidates.length <= 3 ? raid.candidates.length : Math.ceil(raid.candidates.length / 2)}">${raid.candidates.map((t, i) => kingdomCard(t, i, raid.candidates.length, raid.votes, raid.votePower, names)).join('')}</div>
      <div class="status">${names.flatMap((_, p) => (raid.voters[p] ? [`${voterTag(p, raid.votePower[p], names)} ${check(raid.votes[p] !== null)}`] : [])).join(' ')}</div>`;
  } else if (raid.step === 'choose') {
    // Who's in (everyone with a raid-ready dragon, all of them), with what,
    // and whether they've chosen (never what they chose):
    // a face-down card once they have, an empty place while they're choosing.
    // Above them, the power they'd bring together against the kingdom's.
    const ins = names.flatMap((_, p) => (raid.sent[p].length ? [p] : []));
    const rows = ins.map((p) => `<li class="raider${raid.decided[p] ? ' chosen' : ''}" style="--pc:${PLAYER_COLORS[p]}">${playerTag(p, names)}<span class="rds">${dragonSummary(raid.sent[p].map(dragonById))}</span>${powerTag(sum(raid.sent[p]))}${choiceMark(raid.decided[p])}</li>`).join('');
    body = `<h1>${icon('raid', 1.1)} Fight or hold back ${SECRET}${raidPips(g)}</h1>${balance(ins.map((p) => ({ p, power: sum(raid.sent[p]) })), raid.target!.power)}${arena(rows, 'deciding')}`;
  }
  // A new step (or the next raid) rises in; ticks within a step update in place.
  showOverlay('raid', `raid ${g.round} ${g.raidsLeft} ${raid.step}`, `<div class="raidbox">${body}</div>`);
}

// Short banners for things that just happened, shown one after another: the
// result of a raid, production dice at the start of a round. The raid screen
// and the final scores show whenever no banner is up.
// top: what the top bar says while it's up (the board under it is held as it
// was, so its own round and phase may have moved on).
interface Banner { html: string; ms: number; top?: { round: number; phase: Phase }; play?: (el: HTMLElement) => void }
let bannerTop: Banner['top'] | null = null;
const banners: Banner[] = [];
let bannerUp = false;

function queueBanners(g: PublicState, fresh: EventView[]) {
  for (const sc of scenesOf(fresh)) banners.push(banner(g, sc, fresh));
}

function banner(g: PublicState, sc: Scene, fresh: EventView[]): Banner {
  if (sc.kind === 'roll') return rollBanner(fresh[sc.at].round, sc.rolls.map((j) => fresh[j]), sc.ms);
  if (sc.kind === 'fight') return fightBanner(g, sc, fresh);
  if (sc.kind === 'hunt') return huntBanner(g, sc, fresh);
  return { html: `<div class="result"><h1>${eventHtml(fresh[sc.at], g, names)}</h1></div>`, ms: sc.ms, top: { round: fresh[sc.at].round, phase: 'Raid' } };
}

// A new round's production, one player at a time (#230), so someone watching
// can tell what each roll is for: the player's card lists what they make, one
// resource at a time (its icon, the fixed amount, that resource's dice tumbling
// and landing, the total), then their total. At the end, everyone's totals
// together. Every card and the summary share one place on the sheet, so the
// sheet is its final size from the start and nothing moves. The timings are
// scenes.ts's, which the server holds the phones for.
// A round nobody makes anything in still opens with its number, briefly.
function rollBanner(round: number, rolls: EventView[], ms: number): Banner {
  const made = rolls.map((x) => {
    const ev = x.ev as Extract<EventView['ev'], { k: 'produce' }>;
    const eat = eatOf(ev);
    // What their dragons eat comes off the livestock row (#309), so that row
    // shows even when they make no livestock.
    const rs = eat && !madeOf(ev).includes('livestock') ? [...madeOf(ev), 'livestock' as const] : madeOf(ev);
    return { p: ev.p, got: ev.got, eat, rows: rs.map((r) => {
      const dice = (x.dice ?? []).filter((d) => d.resource === r);
      const got = ev.got[r] ?? 0;
      const eats = r === 'livestock' ? eat : 0;
      return { r, dice, eats, base: got - dice.reduce((s, d) => s + d.value, 0), total: got - eats };
    }) };
  });
  const all = rolls.reduce((s, x) => s + prodRowsOf(x.ev), 0);
  const step = prodStep(all), spin = prodSpin(all);
  // A row: what's made, then what the dragons eat of it, in red with the dragon
  // icon ("1 + d4 − 1🐉 = 2"), then what's left.
  const row = (x: (typeof made)[number]['rows'][number]) => {
    // The dice sit together in one strip, which wraps onto more lines when a
    // phone runs out of room, so the row never runs off the screen (#333).
    const base = x.base || !x.dice.length ? `<b class="base">${x.base}</b>` : '';
    const dice = x.dice.length ? `${base ? '<i>+</i>' : ''}<span class="dice">${x.dice.map((d) => dieFace(d.sides, d.value, 'rolling')).join('')}</span>` : '';
    const eat = x.eats ? `<i>−</i><span class="eat" title="your dragons eat this"><b>${x.eats}</b>${icon('dragon', 1.4)}</span>` : '';
    const total = x.total < 0 ? `−${-x.total}` : x.total;
    return `<li class="prow">${resIcon(x.r, 1.5)}<span class="parts">${base}${dice}${eat}</span>${x.dice.length || x.eats ? `<span class="eq"><i>=</i><b>${total}</b></span>` : ''}</li>`;
  };
  const net = (m: (typeof made)[number]) => netChips({ ...m.got, livestock: (m.got.livestock ?? 0) - m.eat }, 1.4);
  const cards = made.map((m) => `<section class="pturn" style="--pc:${PLAYER_COLORS[m.p]}"><div class="who">${playerTag(m.p, names)}</div><ul>${m.rows.map(row).join('')}</ul><div class="ptotal">${net(m)}</div></section>`).join('');
  const sum = made.map((m) => `<li style="--pc:${PLAYER_COLORS[m.p]}">${playerTag(m.p, names)}<span class="gains">${net(m)}</span></li>`).join('');
  const play = (el: HTMLElement) => {
    const at = (t: number, f: () => void) => setTimeout(f, t);
    const cardEls = el.querySelectorAll<HTMLElement>('.production .pturn');
    let t = PROD_LEAD_MS;
    cardEls.forEach((card, k) => {
      at(t, () => { cardEls[k - 1]?.classList.remove('on'); card.classList.add('on'); });
      t += PROD_PLAYER_IN_MS;
      card.querySelectorAll<HTMLElement>('.prow').forEach((li) => {
        at(t, () => {
          li.classList.add('up');
          // Spin the dice for a moment, then land on what they rolled.
          const dice = li.querySelectorAll<HTMLElement>('.die.rolling');
          if (!dice.length) return li.classList.add('landed');
          const finals = Array.from(dice, (d) => d.querySelector('b')!.textContent);
          const tumble = setInterval(() => dice.forEach((d) => (d.querySelector('b')!.textContent = String(1 + Math.floor(Math.random() * Number(d.dataset.sides))))), 70);
          at(spin, () => {
            clearInterval(tumble);
            dice.forEach((d, i) => { d.querySelector('b')!.textContent = finals[i]; d.classList.remove('rolling'); });
            li.classList.add('landed');
          });
        });
        t += step;
      });
      at(t, () => card.querySelector('.ptotal')!.classList.add('up'));
      t += PROD_TOTAL_MS;
    });
    at(t, () => { cardEls[cardEls.length - 1]?.classList.remove('on'); el.querySelector('.production .psum')?.classList.add('on'); });
  };
  const body = made.length ? `<h2>Production</h2><div class="pstage">${cards}<ul class="psum">${sum}</ul></div>` : '';
  return { html: `<div class="production"><h1>Round ${round}</h1>${body}</div>`, ms, play, top: { round, phase: 'Production' } };
}

// The whole fight at once (there is no retreat), replayed blow by blow on its
// own stage (#326): the TV cuts from the map to the kingdom's backdrop, the
// dragons on the left facing its defenders on the right, each a figure drawn
// at its size. Each hit lunges from its attacker with a bolt in the
// attacker's element colour to what it hits, bursting when that element
// beats the target's; the knocked out fall. Then who won and what they took,
// and for a kingdom that scores, a beat of its own: the crown comes down on
// the player with the most power standing, then their points. Whoever held
// back is shown in a corner, out of the fight but still in for the loot.
type Combat = Extract<EventView['ev'], { k: 'combat' }>;
function fightBanner(g: PublicState, sc: Extract<Scene, { kind: 'fight' }>, fresh: EventView[]): Banner {
  const e = fresh[sc.at];
  const ev = e.ev as Extract<EventView['ev'], { k: 'fight' }>;
  const rounds = sc.combat.map((j) => fresh[j].ev as Combat);
  const end = sc.end === null ? null : (fresh[sc.end].ev as Extract<EventView['ev'], { k: 'raidEnd' }>);
  // Who held back in this raid, and which dragons: the ones logged since the vote put everyone in
  // (maybe in an earlier update than the fight's, so from the whole log).
  const lockAt = g.log.findLastIndex((x) => x.i < e.i && x.ev?.k === 'locked');
  const held = g.log.slice(lockAt + 1).filter((x) => x.i < e.i).flatMap((x) => (x.ev?.k === 'hold' ? [{ p: x.ev.p, ds: x.ev.ds }] : []));
  const dragons = ev.ds.map((id) => g.dragons.find((d) => d.id === id)!).filter(Boolean);
  // Their dragons: the ones the lock lists (in an old save, the ones they last committed).
  const lock = g.log[lockAt]?.ev as Extract<EventView['ev'], { k: 'locked' }> | undefined;
  const sentBy = (p: number): string[] => {
    if (lock?.sent) return lock.sent[lock.ps.indexOf(p)] ?? [];
    const old = g.log.slice(0, lockAt + 1).findLast((x) => x.ev?.k === 'commit' && x.ev.p === p)?.ev as Extract<EventView['ev'], { k: 'commit' }> | undefined;
    return old?.ds ?? [];
  };
  const back = held.map(({ p, ds: heldDs }) => {
    const ds = (heldDs ?? sentBy(p)).map((id) => g.dragons.find((d) => d.id === id)).filter((d) => !!d).map((d) => dragonBadge(d!, 40)).join('');
    return `<div class="heldback" style="--pc:${PLAYER_COLORS[p]}">${playerTag(p, names)} ${ds}<small>Holds back</small></div>`;
  }).join('');
  const scored = end?.won && end.scorer !== undefined && end.points ? { p: end.scorer, points: end.points } : null;
  const outcome = !end ? '' : end.won
    ? `<h1>${esc(end.name)} <span class="ok">falls</span></h1><div class="spoils${end.winners.length > 3 ? ' many' : ''}">${end.winners.map((p, i) => `<span>${playerTag(p, names)} <span class="gains">${gainChips(end.shares[i], 1.6)}</span></span>`).join('')}</div>${scored ? `<div class="score">${crown()}<span>${playerTag(scored.p, names)} has the most power standing</span><b class="pts">+${scored.points} ${icon('points', 1.3)}</b></div>` : ''}`
    : `<h1>${esc(end.name)} <span class="no">holds</span></h1>`;
  const head = `${ev.ps.map((p) => playerTag(p, names)).join(' ')} ${icon('raid', 1.2)} ${esc(ev.name)}`;
  const units = ev.units.map((u) => ({ ...u, max: u.hp }));
  const first = ev.first === 'defenders' ? 'Defenders' : 'Dragons';
  return battle(g, ev.t, head, dragons, startHp(ev.ds, ev.hps), back, units, rounds, outcome, scored?.p ?? null, { round: e.round, phase: 'Raid' }, sc.ms, first);
}

// A fight for a hex: one player's dragons against what holds it (a beast,
// great or not, and any rival dragons perched there), to the end, played out
// like a raid's, on the hex's terrain, then what they got for it. Every fight
// in the game gets this replay, so the table sees it happen.
function huntBanner(g: PublicState, sc: Extract<Scene, { kind: 'hunt' }>, fresh: EventView[]): Banner {
  const ev = fresh[sc.at].ev as Extract<EventView['ev'], { k: 'hunt' }>;
  const rounds = sc.combat.map((j) => fresh[j].ev as Combat);
  const end = sc.end === null ? null : (fresh[sc.end].ev as Extract<EventView['ev'], { k: 'cleared' }>);
  const dragons = ev.ds.map((id) => g.dragons.find((d) => d.id === id)!).filter(Boolean);
  const great = g.beasts.some((b) => b.key === ev.fauna);
  const home = (end?.home ?? []).map((id) => g.dragons.find((d) => d.id === id)).filter((d) => !!d).map((d) => dragonBadge(d!, 40)).join('');
  const flown = home ? `<div class="spoils"><span>${home}<span class="arrow">➜</span>${HOME}</span></div>` : '';
  const The = ev.fauna ? `The ${esc(ev.name)}` : 'The perched dragons';
  const outcome = !end ? '' : !end.won ? `<h1>${The} <span class="no">${ev.fauna ? 'holds' : 'hold'}</span></h1>${flown}`
    : great ? `<h1>The ${esc(end.name)} <span class="ok">is slain</span></h1><div class="spoils"><span>${playerTag(end.p, names)} +${end.points ?? 0} ${icon('points', 1.6)}</span></div>${ev.fauna === 'thunderbird' ? peakBoon(g.peakBonus) : ''}`
    : ev.fauna ? `<h1>The ${esc(end.name)} <span class="ok">falls</span></h1><div class="spoils"><span>${playerTag(end.p, names)} ${gainChips(end.gain, 1.6)}</span></div>${flown}`
    : `<h1>The perched dragons <span class="ok">fall</span></h1>${flown}`;
  const head = `${playerTag(ev.p, names)} ${icon('raid', 1.2)} ${ev.fauna ? esc(ev.name) : 'Perched dragons'}`;
  // Saves from before perching carry one beast and no units.
  const units = (ev.units ?? [{ name: ev.name, hp: ev.hp }]).map((u) => {
    const d = u.d ? g.dragons.find((x) => x.id === u.d) : undefined;
    return { name: d ? dragonLabel(d, g.dragons) : u.name, hp: u.hp, max: d?.maxHp ?? u.hp, d, el: (u as { el?: string }).el ?? d?.element };
  });
  const terrain = g.map.find((h) => h.k === ev.hex)?.terrain ?? 'desert';
  const first = ev.first !== 'defenders' ? 'Dragons' : units.length > 1 ? 'Defenders' : units[0].name;
  return battle(g, terrain, head, dragons, startHp(ev.ds, ev.hps), '', units, rounds, outcome, null, undefined, sc.ms, first);
}

// The Thunderbird's fall frees its peak: the rule pops up under the points,
// on the gold token the board then shows on each of the peak's hexes (#354).
function peakBoon(n: number): string {
  return `<div class="boon"><span class="ptoken">+${n}</span><span>Each round, on and adjacent to its peak</span></div>`;
}

// Each fighting dragon's health as its fight started, by id: drawn after the
// fight, the dragon's own health is what it ended with. Saves from before the
// events carried it start them at full health.
function startHp(ds: string[], hps: number[] | undefined): Map<string, number> {
  return new Map(hps ? ds.map((id, i) => [id, hps[i]]) : []);
}

// A figure's size: its full health's square root, so its area goes with its
// health. A Knight (12) is about 3.5, an adult dragon (20 to 30) 4.5 to 5.5,
// the Fire Giant (96) nearly 10 and the Titan (160) over 12: the bosses loom.
const figSize = (maxHp: number) => Math.sqrt(Math.max(1, maxHp));
// Defenders without an element (old saves) and neutral ones strike in steel.
const STEEL = '#c9ced6';

type Foe = { name: string; hp: number; max: number; d?: DragonView; el?: string };
// `first`: who won the fight's coin flip and strikes first each round (#380).
function battle(g: PublicState, place: string, head: string, dragons: DragonView[], start: Map<string, number>, held: string, units: Foe[], rounds: Combat[], outcome: string, scorer: number | null, top: Banner['top'], ms: number, first: string): Banner {
  const hp0 = (d: DragonView) => Math.min(start.get(d.id) ?? d.maxHp, d.maxHp);
  // A figure: its health over its head, the figure standing on its shadow
  // (in its owner's colour, for a dragon), and its name at its feet.
  const fig = (key: string, size: number, art: string, name: string, hp: number, max: number, cls: string, pc?: string, order?: number) =>
    `<div class="fig ${cls}" ${key} style="--s:${size.toFixed(2)}${pc ? `;--pc:${pc}` : ''}${order !== undefined ? `;order:${order}` : ''}">
      <span class="fig-crown">${crown()}</span>${hpBar(hp, max)}<span class="fig-body">${art}</span><b class="fig-name">${esc(name)}</b></div>`;
  // Without WebGL, each figure is a flat paper cut-out (arena.ts), laid out
  // here; with it, the figures are the board's own origami models standing
  // in the place, in one live scene (board3d.ts, FightStage), and this page
  // draws only their bars, names and hits over them. `aspect` is a cut-out's
  // width over its height.
  const live = fight3d;
  const art = (_f: Fighter, _facing: 1 | -1, flat: () => string): { html: string; aspect: number } => ({ html: live ? '' : flat(), aspect: 1.25 });
  const unitKey = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, '_');
  const left = dragons.map((d) => ({ d, max: d.maxHp, ...art({ dragon: { element: d.element, stage: d.stage } }, 1, () => dragonFigure(d.element)) }));
  const right = units.map((u) => ({ u, ...art(u.d ? { dragon: { element: u.d.element, stage: u.d.stage } } : { foe: unitKey(u.name) }, -1, () => (u.d ? dragonFigure(u.d.element) : unitFigure(unitKey(u.name)))) }));
  // A figure's width: its area goes with its full health, whatever its shape.
  const width = (max: number, aspect: number) => figSize(max) * Math.sqrt(aspect / 1.25);
  const leftFigs = left.map(({ d, html: a, aspect }) => fig(`data-d="${d.id}" data-p="${d.owner}"`, width(d.maxHp, aspect), a, dragonLabel(d, g.dragons), hp0(d), d.maxHp, 'fig-d', PLAYER_COLORS[d.owner]));
  const side = leftFigs.join('');
  // The biggest defenders stand at the back, the smallest nearest the dragons.
  const rank = units.map((u, i) => i).sort((a, b) => units[a].max - units[b].max || a - b);
  const foeFigs = right.map(({ u, html: a, aspect }, i) => u.d
    ? fig(`data-u="${i}"`, width(u.max, aspect), a, u.name, u.hp, u.max, 'fig-u fig-d', PLAYER_COLORS[u.d.owner], rank.indexOf(i))
    : fig(`data-u="${i}"`, width(u.max, aspect), a, u.name, u.hp, u.max, 'fig-u', undefined, rank.indexOf(i)));
  const foes = foeFigs.join('');
  // How big a figure is drawn: as big as fits the more crowded side across,
  // and the tallest figure up; a very crowded side takes two rows.
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const across = (xs: number[]) => { const s = sum(xs); return s > 34 ? s / 2 : s; };
  const sl = across(left.map((x) => width(x.max, x.aspect)));
  const sr = across(right.map((x) => width(x.u.max, x.aspect)));
  const mx = Math.max(...left.map((x) => width(x.max, x.aspect) / x.aspect * 1.25), ...right.map((x) => width(x.u.max, x.aspect) / x.aspect * 1.25));
  // The stage drawn at the screen's shape, so a phone held upright isn't a crop of a wide one.
  const shape = Math.min(2.4, Math.max(0.4, innerWidth / Math.max(1, innerHeight)));
  // A screen held upright has no room across for a row of figures: each side
  // stands its figures one above another, as the raid's list does, and past
  // STACK of them adds a column (the first nearest the other side). Every
  // column has the same rows, so a row lines up across the screen. A boss (a
  // defender with four times the health of any other) has no room beside
  // its columns on a phone: it stands over them, at the back, as wide as its
  // side, so it looms.
  const stack = shape < 1;
  const STACK = 4;
  const tall = (max: number, aspect: number) => width(max, aspect) / aspect * 1.25;
  const sorted = rank.map((i) => ({ i, max: units[i].max, w: width(units[i].max, right[i].aspect), h: tall(units[i].max, right[i].aspect) }));
  const boss = sorted.length > 1 && sorted[sorted.length - 1].max >= 4 * sorted[sorted.length - 2].max ? sorted.pop()! : null;
  const split = <T,>(xs: T[]) => { const n = Math.max(1, Math.ceil(xs.length / STACK)), per = Math.ceil(xs.length / n); return Array.from({ length: n }, (_, c) => xs.slice(c * per, (c + 1) * per)); };
  const lcols = split(left.map((x, i) => ({ i, w: width(x.max, x.aspect), h: tall(x.max, x.aspect) })));
  const rcols = split(sorted);
  const colW = (cs: { w: number }[][]) => sum(cs.map((c) => Math.max(0, ...c.map((x) => x.w))));
  // Each side sized on its own: as many rows as its first column, each as tall as its tallest figure.
  const rowsOf = (cs: { h: number }[][]) => Math.max(1, cs[0].length);
  const highOf = (cs: { h: number }[][]) => rowsOf(cs) * Math.max(1, ...cs.flat().map((x) => x.h));
  const col = (figs: string[], c: { i: number }[]) => `<div class="bcol">${c.map((x) => figs[x.i]).join('')}</div>`;
  const fit = stack
    ? `stack" style="--sl:${colW(lcols).toFixed(1)};--sr:${colW(rcols).toFixed(1)};--hl:${highOf(lcols).toFixed(1)};--hr:${highOf(rcols).toFixed(1)};--rl:${rowsOf(lcols)};--rr:${rowsOf(rcols)}"`
    : `" style="--sl:${sl.toFixed(1)};--sr:${sr.toFixed(1)};--mx:${mx.toFixed(1)}"`;
  const sides = stack
    ? `<div class="bside bl">${lcols.map((c) => col(leftFigs, c)).join('')}</div><div class="bside br${boss ? ' bossed' : ''}">${boss ? `<div class="boss" style="--a:${right[boss.i].aspect.toFixed(2)}">${foeFigs[boss.i]}</div><div class="bcols">${rcols.map((c) => col(foeFigs, c)).join('')}</div>` : rcols.map((c) => col(foeFigs, c)).join('')}</div>`
    : `<div class="bside bl">${side}</div><div class="bside br">${foes}</div>`;
  const html = `<div class="fightscene">${live ? '<div class="stagebox"></div>' : backdrop(place)}
      <header class="fhead"><h2>${head}</h2><div class="bvs"><small>Round</small><b class="cround"></b></div><div class="bvs bfirst"><small>Strikes first</small><b>${esc(first)}</b></div></header>
      <div class="outcome">${outcome}</div>
      ${live ? `<div class="battle live">${side}${foes}</div>` : `<div class="battle ${fit}>${sides}</div>`}
      ${held ? `<div class="backrow">${held}</div>` : ''}</div>`;
  const hits = rounds.flatMap((r) => r.hits.map((h) => ({ ...h, round: r.round })));
  const step = hitStep(hits.length);
  const play = (el: HTMLElement) => {
    const hp = new Map<string, [number, number]>();
    dragons.forEach((d) => hp.set(`d${d.id}`, [hp0(d), d.maxHp]));
    units.forEach((u, i) => hp.set(`u${i}`, [u.hp, u.max]));
    const box = (key: string) => el.querySelector<HTMLElement>(key[0] === 'u' ? `[data-u="${key.slice(1)}"]` : `[data-d="${key.slice(1)}"]`);
    // The live scene: the fighters on the place's ground, and each one's
    // bar, name and hits pinned over it.
    // Each figure's plate (its name and bar) as the page draws it, so the scene spaces them to fit.
    const label = (key: string) => {
      const f = box(key), n = f?.querySelector<HTMLElement>('.fig-name');
      if (f && n) f.style.setProperty('--plate', `${n.offsetHeight}px`); // its bar sits in the plate's foot
      return { w: (n?.offsetWidth ?? 80) + 6, h: (n?.offsetHeight ?? 20) + 8 };
    };
    // The outcome's sheet stands under the heading, however many lines that
    // takes, and the fighters stand under the sheet, however many lines the
    // loot takes: it's laid out (unseen) from the start, so the fight is
    // framed for it and nothing moves when it shows.
    const fhead = el.querySelector<HTMLElement>('.fhead')!, sheet = el.querySelector<HTMLElement>('.outcome')!;
    const gap = innerHeight * 0.01;
    sheet.style.top = `${Math.max(sheet.offsetTop, fhead.getBoundingClientRect().bottom + gap)}px`;
    const below = (sheet.getBoundingClientRect().bottom + gap) / innerHeight;
    const safe = remote ? { top: 0.2, bottom: 0.17 } : { top: 0.26, bottom: 0.09 };
    safe.top = Math.max(safe.top, Math.min(below, 0.6));
    const stage = live ? new live.FightStage(place,
      dragons.map((d) => ({ key: `d${d.id}`, fighter: { dragon: { element: d.element, stage: d.stage } }, maxHp: d.maxHp, label: label(`d${d.id}`) })),
      units.map((u, i) => ({ key: `u${i}`, fighter: u.d ? { dragon: { element: u.d.element, stage: u.d.stage } } : { foe: unitKey(u.name) }, maxHp: u.max, label: label(`u${i}`) })),
      shape < 1, safe) : null;
    if (stage) {
      stage.onLayout = () => {
        for (const key of hp.keys()) {
          const a = stage.anchor(key), f = box(key);
          if (!a || !f) continue;
          f.style.cssText += `;left:${a.x0}px;top:${a.y0}px;width:${a.x1 - a.x0}px;height:${a.y1 - a.y0}px;--foot:${a.foot - a.y0}px`;
        }
      };
      stage.mount(el.querySelector<HTMLElement>('.stagebox')!);
    }
    const battle = el.querySelector<HTMLElement>('.battle')!;
    hits.forEach((h, n) => setTimeout(() => {
      el.querySelector('.cround')!.textContent = String(h.round);
      const [from, to] = h.by === 'dragon' ? [`d${h.d}`, `u${h.u}`] : [`u${h.u}`, `d${h.d}`];
      const [cur, max] = hp.get(to)!;
      const now = h.down ? 0 : Math.max(0, cur - h.dmg);
      hp.set(to, [now, max]);
      const a = box(from), t = box(to);
      // The attacker's element colour: a dragon's, or a defender's (steel if it has none).
      const c = h.by === 'dragon' ? ELEMENT_COLORS[dragons.find((d) => d.id === h.d)?.element ?? ''] ?? '#fff' : ELEMENT_COLORS[units[h.u]?.el ?? ''] ?? STEEL;
      // The attacker lunges at what it hits.
      a?.classList.remove('strike'); void a?.offsetWidth; a?.classList.add('strike');
      stage?.strike(from);
      stage?.hit(to);
      if (now <= 0) stage?.fall(to);
      if (a && t) {
        // The bolt: from the attacker to the target, in the attacker's
        // colour. The last one fades out under the new one, never just blinks off.
        battle.querySelectorAll('.beam:not(.gone)').forEach((b) => fade(b));
        battle.append(beam(battle, a.querySelector('.fig-body')!, t.querySelector('.fig-body')!, c));
      }
      if (t) {
        // The bar drains to its new width (style.css eases it) rather than
        // being redrawn at it.
        const fill = t.querySelector<HTMLElement>('.hpbar > span')!;
        const { width, color } = hpFill(now, max);
        fill.style.width = width;
        fill.style.background = color;
        t.classList.remove('hit'); void t.offsetWidth; t.classList.add('hit');
        // Hits can land faster than a number reads. A new one doesn't cut the
        // last: that one moves up a line, smaller, and fades, so a −4 sits
        // over a −8 and never beside it as one −48. Only those two are up at
        // once.
        t.querySelectorAll<HTMLElement>('.dmg').forEach((old) => {
          if (old.classList.contains('gone')) return old.remove();
          old.style.setProperty('--slot', '1');
          fade(old, 450);
        });
        // A hit whose element beats its target's bursts in the attacker's colour.
        const pop = document.createElement('span');
        pop.className = h.beats ? 'dmg beats' : 'dmg';
        pop.style.setProperty('--bc', c);
        pop.innerHTML = `${h.beats ? burst() : ''}<b>−${h.dmg}</b>`;
        t.append(pop);
        pop.addEventListener('animationend', (e) => { if (e.target === pop && e.animationName === 'dmg') pop.remove(); });
        if (now <= 0) t.classList.add('down');
      }
    }, FIGHT_LEAD_MS + n * step));
    const shown = outcomeAt(hits.length);
    setTimeout(() => {
      battle.querySelectorAll('.beam:not(.gone)').forEach((b) => fade(b));
      el.querySelector('.outcome')!.classList.add('show');
    }, shown);
    if (scorer === null) return;
    // The scoring beat: one crown comes down, on the scorer's biggest dragon
    // still standing, and on their name; then their points.
    setTimeout(() => {
      el.classList.add('crowned');
      const max = (f: HTMLElement) => dragons.find((d) => d.id === f.dataset.d)?.maxHp ?? 0;
      const standing = [...el.querySelectorAll<HTMLElement>(`.fig-d[data-p="${scorer}"]:not(.down)`)];
      standing.reduce<HTMLElement | null>((best, f) => (!best || max(f) > max(best) ? f : best), null)?.classList.add('king');
    }, shown + CROWN_AT_MS);
    setTimeout(() => el.classList.add('scored'), shown + CROWN_AT_MS + POINTS_AT_MS);
  };
  return { html, ms, play, top };
}

// Takes a stroke or a number away with a short fade instead of a cut.
function fade(x: Element, ms = 250) {
  x.classList.add('gone');
  setTimeout(() => x.remove(), ms);
}

// A bolt from one figure to another, drawn over the battle: from the
// attacker's facing edge to the target's, at chest height.
function beam(battle: HTMLElement, a: HTMLElement, t: HTMLElement, color: string): HTMLElement {
  const o = battle.getBoundingClientRect(), ra = a.getBoundingClientRect(), rt = t.getBoundingClientRect();
  const rightward = ra.left < rt.left;
  const x1 = (rightward ? ra.right - ra.width * 0.15 : ra.left + ra.width * 0.15) - o.left, y1 = ra.top + ra.height * 0.4 - o.top;
  const x2 = (rightward ? rt.left + rt.width * 0.2 : rt.right - rt.width * 0.2) - o.left, y2 = rt.top + rt.height * 0.45 - o.top;
  const b = document.createElement('div');
  b.className = 'beam';
  b.style.cssText = `left:${x1}px;top:${y1}px;width:${Math.hypot(x2 - x1, y2 - y1)}px;transform:rotate(${Math.atan2(y2 - y1, x2 - x1)}rad);--bc:${color}`;
  return b;
}

// ---------- the end: how the game went, then the final scores ----------

// When the game ends in front of it, the TV plays the game's recap
// (src/recap.ts): the points race drawn a round at a time with what happened
// in each, then everyone's dragon power and production over the game, then
// where everyone's points came from, then the final scores with
// a QR code to the recap page, for anyone to keep or share. A TV opened on a
// game that's already over goes straight to the scores (Watch again plays it).
// The table view in a game with no TV does the same, as a scene the phone cuts
// to, and ends on a link to the recap page instead of its QR code.
let sawPlay = false; // this TV watched the game being played
let recap: Recap | null = null;
let recapAsked = '';
let summary: { step: number; timer: number } | null = null;
let summaryPlayed = false;

type SummaryStep = { kind: 'race'; upTo: number; ms: number } | { kind: 'growth'; ms: number } | { kind: 'points'; ms: number };
const RACE_MS = 24000; // the race at most, however long the game
const GROWTH_MS = 9000;
const POINTS_MS = 8000;

function summarySteps(r: Recap): SummaryStep[] {
  const last = r.race.length - 1;
  const told = (n: number) => r.moments.filter((m) => m.round === n).length;
  // A round where something happened stays up long enough to read it.
  const want = Array.from({ length: last }, (_, i) => (told(i + 1) ? 1600 + 600 * Math.min(told(i + 1), 4) : 600));
  const sum = want.reduce((a, b) => a + b, 0);
  const scale = Math.min(1, RACE_MS / sum);
  // Dragon power and production, whole, for a recap that kept them.
  const growth: SummaryStep[] = r.power && r.made?.length ? [{ kind: 'growth', ms: GROWTH_MS }] : [];
  return [...want.map((ms, i) => ({ kind: 'race' as const, upTo: i + 1, ms: Math.max(250, ms * scale) })), ...growth, { kind: 'points', ms: POINTS_MS }];
}

function showEnd(g: PublicState) {
  if (summary) return; // it ends on the scores
  const id = snap?.recap ?? null;
  if (id && recap?.id !== id) {
    if (recapAsked !== id) {
      recapAsked = id;
      fetch(`/api/recaps/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((r: Recap | null) => {
        recap = r;
        if (!snap?.game || snap.game.phase !== 'over') return;
        if (recap && sawPlay && !summaryPlayed) playSummary();
        else showFinal(snap.game);
      });
    }
    if (!overlayKey.startsWith('end')) return; // a moment, while the recap loads
  }
  showFinal(g);
}

function playSummary(from = 0) {
  if (!recap) return;
  if (summary) clearTimeout(summary.timer);
  summaryPlayed = true;
  summary = { step: from, timer: 0 };
  cut(true);
  summaryStep();
}
// For the screenshots: play it from a step (from the end if negative).
(window as unknown as { summaryAt: (n: number) => void }).summaryAt = (n) => recap && playSummary(n < 0 ? summarySteps(recap).length + n : n);

function stopSummary() {
  if (summary) clearTimeout(summary.timer);
  summary = null;
  if (snap?.game) showFinal(snap.game);
  cut(false);
}

function summaryStep() {
  const steps = summarySteps(recap!);
  const step = steps[summary!.step];
  if (!step) return stopSummary();
  const r = recap!;
  if (step.kind === 'race') {
    if (overlayKey !== 'end race') {
      showOverlay('end', 'end race', `<div class="summary race-step">
        <h1>How the game went</h1>
        <div class="sumbody"><div class="chart" id="sumchart"></div><div class="told" id="sumtold"></div></div>
        <button id="skip">Skip</button></div>`);
      $('skip').onclick = stopSummary;
    }
    $('sumchart').innerHTML = raceSvg(r, { upTo: step.upTo });
    // What happened lately: this round's moments under the ones before it.
    const told = $('sumtold');
    const recent = [...new Set(r.moments.filter((m) => m.round <= step.upTo).map((m) => m.round))].slice(-3);
    told.innerHTML = momentsHtml({ ...r, moments: r.moments.filter((m) => recent.includes(m.round)) });
    told.querySelector(`.moments > li:last-child`)?.classList.toggle('now', recent.at(-1) === step.upTo);
    $('overlay').querySelector<HTMLElement>('.summary')!.dataset.step = `race-${step.upTo}`;
  } else if (step.kind === 'growth') {
    const box = showOverlay('end', 'end growth', `<div class="summary growth-step" data-step="growth">
      <h1>Dragon power and production</h1>
      <div class="growth">
        <figure><figcaption>Dragon power</figcaption>${powerSvg(r, { width: 700, height: 460 })}</figure>
        <figure><figcaption>Resources made each round</figcaption>${madeSvg(r, { width: 700, height: 460 })}</figure>
      </div>
      <button id="skip">Skip</button></div>`);
    if (box) $('skip').onclick = stopSummary;
  } else {
    const box = showOverlay('end', 'end points', `<div class="summary points-step" data-step="points">
      <h1>Points</h1>
      ${breakdownHtml(r)}
      <button id="skip">Skip</button></div>`);
    if (box) $('skip').onclick = stopSummary;
  }
  summary!.timer = window.setTimeout(() => {
    if (!summary) return;
    summary.step++;
    summaryStep();
  }, step.ms);
}

// The recap page's address, as phones reach this machine.
function recapUrl(id: string): string {
  const host = lan.lan[0] ?? lan.tailscale[0] ?? location.hostname;
  return `${host}${lan.port && lan.port !== 80 ? `:${lan.port}` : ''}/recap/${id}`;
}

function showFinal(g: PublicState) {
  const w = g.standings![0].p;
  const qr = remote ? '' : recap ? `<div class="recapqr">${qrSvg(`http://${recapUrl(recap.id)}`, "the game's recap")}
      <div class="step">Scan for the recap</div><div class="url">${esc(recapUrl(recap.id)).replace('/recap/', '/<wbr>recap/')}</div></div>` : '';
  showOverlay('end', 'end', `<div class="endbox${qr ? ' with-recap' : ''}" data-step="final" style="--pc:${PLAYER_COLORS[w]}">${winnerScene(PLAYER_COLORS[w], g.players.map((_, i) => PLAYER_COLORS[i]), 340, 100)}
      <h1>${playerTag(w, names)} wins!</h1>${tiebreakNote(g) ? `<p class="tiebreak">${tiebreakNote(g)}</p>` : ''}
      <div class="endbody">${standingsHtml(g, names)}${qr}</div>
      ${remote
        ? recap ? `<div class="endactions"><button id="replay">Watch again</button><a class="button primary" href="/recap/${recap.id}" target="_blank" rel="noopener">Open the recap</a></div>` : ''
        : `<div class="endactions">${recap ? '<button id="replay">Watch again</button>' : ''}<button class="primary" id="again">New game</button></div>`}</div>`);
  if (recap) $('replay').onclick = () => playSummary();
  if (remote) return;
  $('again').onclick = () => (location.href = '/tv');
}

// Whether the board itself comes next, with no overlay over it.
const boardNext = (g: PublicState) => !banners.length && g.phase !== 'over' && !(g.phase === 'raid' && g.raid);

function updateOverlay(g: PublicState) {
  if (bannerUp) return;
  const next = banners.shift();
  if (next) return showBanner(next);
  if (g.phase === 'over') return showEnd(g);
  if (g.phase === 'raid' && g.raid) return renderRaid(g);
  hideOverlay();
}

let bannerN = 0;

function showBanner(b: Banner) {
  bannerUp = true;
  bannerTop = b.top ?? null;
  cut(true);
  const key = `banner ${++bannerN}`;
  const box = showOverlay('banner', key, b.html);
  if (box) b.play?.(box);
  if (shown) renderGame(shown); // no one is being waited on while it plays
  // The last scene's last moment: if the board comes next, it catches up
  // under the scene, then the scene fades away, and what changed during the
  // scene folds up as it clears (each thing a beat after the last, board3d.ts),
  // rather than all of it landing in the frame the scene ends. The fade starts
  // once the caught-up board is drawn: drawing it takes a while on a slow TV,
  // and would eat the fade.
  setTimeout(() => {
    if (!bannerUp || !snap?.game || !boardNext(snap.game)) return;
    bannerTop = null;
    renderGame(snap.game);
    requestAnimationFrame(() => requestAnimationFrame(() => overlayKey === key && hideOverlay()));
  }, Math.max(0, b.ms - FADE_MS - CATCH_UP_MS));
  setTimeout(() => {
    bannerUp = false;
    bannerTop = null;
    if (!snap?.game) return;
    updateOverlay(snap.game);
    if (!bannerUp) {
      renderGame(snap.game); // the scenes are over: the board catches up
      if (!summary) cut(false);
    }
  }, b.ms);
}

// The overlay over the board: a banner, a raid step or the final scores.
// Nothing in it cuts (style.css): it fades in over the board and out again,
// and a new screen in it rises in while the one before fades away above it.
// key names the screen: the same key again updates it in place.
const FADE_MS = 400; // as style.css's .overlay transitions
const CATCH_UP_MS = 200; // to draw the board's catch-up before a scene fades off it
let overlayKey = ''; // '' while the overlay is hidden or fading out
let hideTimer = 0;

function showOverlay(kind: 'banner' | 'raid' | 'end', key: string, html: string): HTMLElement | null {
  const el = $('overlay');
  clearTimeout(hideTimer);
  const was = overlayKey;
  overlayKey = key;
  const hidden = el.classList.contains('hidden');
  el.className = `overlay ${kind}${hidden || el.classList.contains('in') ? ' in' : ''}`;
  if (was === key) {
    el.innerHTML = html;
    return el.firstElementChild as HTMLElement | null;
  }
  // The screen it replaces fades away where it stood, above the new one.
  const old = hidden ? null : (el.firstElementChild as HTMLElement | null);
  if (old) {
    const r = old.getBoundingClientRect();
    old.classList.add('overlay-ghost');
    old.style.cssText += `;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    document.body.append(old);
    old.onanimationend = () => old.remove();
    setTimeout(() => old.remove(), FADE_MS * 2); // if nothing animates (screenshots)
  }
  el.innerHTML = html;
  const box = el.firstElementChild as HTMLElement | null;
  if (!hidden) box?.classList.add('enter');
  return box;
}

function hideOverlay() {
  const el = $('overlay');
  if (!overlayKey) return;
  overlayKey = '';
  el.classList.add('out');
  // Gone once it has faded, however slow the frames come; the timer is for
  // when nothing animates (screenshots).
  el.ontransitionend = (e) => {
    if (e.target === el && !e.pseudoElement && e.propertyName === 'opacity' && el.classList.contains('out')) clearOverlay();
  };
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(clearOverlay, FADE_MS * 2);
}

function clearOverlay() {
  const el = $('overlay');
  clearTimeout(hideTimer);
  el.ontransitionend = null;
  overlayKey = '';
  el.className = 'overlay hidden';
  el.innerHTML = '';
}

// In a phone (remote mode): a cutscene starts or ends.
function cut(on: boolean) {
  if (remote && parent !== window) parent.postMessage({ boardLite: 'cut', on }, location.origin);
}

// News for the table, not an error: shown longer, without the error's red edge.
function note(html: string) {
  const t = document.createElement('div');
  t.className = 'toast news';
  t.innerHTML = html;
  document.body.append(t);
  setTimeout(() => fadeAway(t), 8000);
}


function toast(e: unknown) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = e instanceof Error ? e.message : String(e);
  document.body.append(t);
  setTimeout(() => fadeAway(t), 3500);
}

// Full screen, for setting the TV up: a button in the top corner while the
// page isn't full screen. It's always there in the lobby; in a game it shows
// only while the mouse moves, so it never sits over the board for long.
// Not in a phone's table view, nor in a browser that can't go full screen.
function fullscreenButton() {
  if (remote || !document.fullscreenEnabled) return;
  const b = document.createElement('button');
  b.id = 'fullscreen';
  b.className = 'ghost';
  b.textContent = 'Full screen';
  b.onclick = () => void document.documentElement.requestFullscreen().catch(toast);
  corner().append(b);
  // (F11 fills the screen without the page knowing: the button stays, and
  // pressing it changes nothing a player sees.)
  document.addEventListener('fullscreenchange', () => document.body.classList.toggle('fullscreen', !!document.fullscreenElement));
  let still = 0;
  addEventListener('pointermove', () => {
    document.body.classList.add('pointing');
    clearTimeout(still);
    still = setTimeout(() => document.body.classList.remove('pointing'), 3000);
  });
}

// The top corner's buttons (Full screen, Save game), side by side.
function corner(): HTMLElement {
  let c = document.getElementById('tvbtns');
  if (!c) {
    c = document.createElement('div');
    c.id = 'tvbtns';
    document.body.append(c);
  }
  return c;
}

// Save game, for leaving partway through: in a game, beside Full screen while
// the mouse moves (only on the TV with the room's buttons). The game stops for
// everyone and waits in the lobby until someone continues it, here or on a phone.
function saveButton() {
  if (remote) return;
  const b = document.createElement('button');
  b.id = 'savegame';
  b.className = 'ghost';
  b.textContent = 'Save game';
  b.onclick = () => void post(`/api/rooms/${code}/save`, { token: hostToken }).catch(toast);
  corner().prepend(b);
}

fullscreenButton();
saveButton();
boot().catch(toast);
