// The TV: the shared board. Shows everything public, never anyone's hand.
// Lobby -> board, with overlays for production dice, the raid and the end.
// With ?remote, it's the table view inside a phone of a game with no TV
// (phone.ts): the flat map, laid out for a phone, and it tells the phone when
// a cutscene (a banner) starts and ends, so the phone can cut to it.

import type { DragonView, EventView, PublicState, Snapshot, TargetView } from '../src/state.ts';
import {
  ELEMENT_COLORS, PLAYER_COLORS, POINTS_TO_WIN, STAGE_LABEL, TERRAIN_COLORS, TERRAIN_NAMES, TITLE_ICON, buildingIcon, dieFace, dragonBadge, dragonChip, dragonLabel, dragonState, elemWords, esc, eventHtml, foeStack, lootLine, gainChips, hpBar, hpFill, powerTag,
  icon, iconText, mapSvg, named, playerTag, post, resChips, resIcon, standingsHtml, tiebreakNote, unitIcon, watch,
  fadeAway,
} from './common.ts';
import { ART_DEFS, tableScene, towerToken, winnerScene } from './art.ts';
import type { Board3D } from './board3d.ts';
import { qrSvg } from './qr.ts';
import { FIGHT_LEAD_MS, PROD_LEAD_MS, PROD_PLAYER_IN_MS, PROD_TOTAL_MS, hitStep, madeOf, prodSpin, prodStep, scenesOf, type Scene } from './scenes.ts';

document.body.insertAdjacentHTML('afterbegin', ART_DEFS);

const $ = (id: string) => document.getElementById(id)!;
const app = $('app');

let code = '';
let hostToken = '';
let snap: Snapshot | null = null;
let names: string[] = [];
let lan: { lan: string[]; tailscale: string[]; port: number } = { lan: [], tailscale: [], port: Number(location.port) || 80 };
let seenLog = -1; // highest log index already animated
// The 3D board lives across re-renders; without WebGL the TV falls back to the flat map.
let board3d: Board3D | null | undefined;
let Board3DClass: typeof Board3D | null = null; // loaded only on a real TV: three.js is the heaviest thing on the page
const remote = new URLSearchParams(location.search).has('remote');

async function boot() {
  const params = new URLSearchParams(location.search);
  code = (params.get('room') ?? '').toUpperCase();
  if (remote) {
    // Inside a phone: watch the room, never make one.
    document.body.classList.add('remote');
    board3d = null;
    return watch(code, null, onSnapshot, (ok) => document.body.classList.toggle('offline', !ok));
  }
  // If three.js can't load, the TV still runs, on the flat map.
  Board3DClass = await import('./board3d.ts').then((m) => m.Board3D, (e) => (console.error('No 3D board:', e), null));
  hostToken = localStorage.getItem(`tv:${code}`) ?? '';
  if (code) {
    const ok = await fetch(`/api/rooms/${code}?token=${hostToken}`).then((r) => r.ok).catch(() => false);
    if (!ok) code = '';
  }
  if (!code) {
    const r = await post('/api/rooms', {});
    code = String(r.code);
    hostToken = String(r.hostToken);
    localStorage.setItem(`tv:${code}`, hostToken);
    history.replaceState(null, '', `/tv?room=${code}`);
  }
  lan = await fetch('/api/info').then((r) => r.json()).catch(() => lan);
  // A room the server no longer has (forgotten after hours idle): open a new one.
  watch(code, null, onSnapshot, (ok) => document.body.classList.toggle('offline', !ok), () => location.replace('/tv'));
}

function onSnapshot(s: Snapshot) {
  const first = !snap?.game && !!s.game && seenLog < 0;
  if (snap?.game && s.game) seatNews(snap, s);
  snap = s;
  names = s.lobby.seats.map((x) => x.name);
  if (!s.game) {
    clearOverlay();
    if (remote) return void (app.innerHTML = '');
    return renderLobby();
  }
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
    if (s.left && !was.left) note(`${who} quits. A bot plays for them.`);
    else if (s.standIn && !was.standIn) note(`${who} is away. A bot plays for them.`);
    else if (!s.standIn && was.standIn) note(`${who} is back.`);
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

function renderLobby() {
  const l = snap!.lobby;
  const seated = l.seats.map((_, i) => PLAYER_COLORS[i]);
  // Each seat a place card with its tower; empty places wait, dashed, up to a full table.
  const seats = l.seats.map((s, i) => `
    <li class="seatcard" style="--pc:${PLAYER_COLORS[i]}">${towerToken(PLAYER_COLORS[i], 2.6)}
      <span class="pname">${esc(s.name)}</span>${s.kind === 'bot' ? '<span class="tag">bot</span>' : ''}${s.kind === 'player' && !s.connected ? '<span class="tag">away</span>' : ''}
      <button class="x" data-remove="${i}" aria-label="remove ${esc(s.name)}" title="remove">×</button></li>`).join('')
    + Array.from({ length: l.maxPlayers - l.seats.length }, (_, i) => `<li class="seatcard open${l.seats.length + i < l.minPlayers ? ' needed' : ''}"></li>`).join('');
  const canStart = l.seats.length >= l.minPlayers;
  app.innerHTML = `
    <div class="lobby">
      <div class="hero">${tableScene(seated, 480, 124, 0.4, 1)}
        <div class="nameplate"><h1 class="title">board-lite</h1><p class="subtitle">Wizards raise dragons. First to ${iconText(`${POINTS_TO_WIN} points`)} wins.</p></div>
      </div>
      <div class="lobby-main">
        <div class="join-box">
          ${qrSvg(`http://${joinUrl()}`, 'the room\'s address')}
          <div class="join-text">
            <div class="step">Join on your phone</div>
            <div class="how">Point its camera at the code, or open</div>
            <div class="url">${esc(joinUrl())}</div>
            ${tailscaleUrl() ? `<div class="alt">or over Tailscale <b>${esc(tailscaleUrl()!)}</b></div>` : ''}
            <div class="step">Room code</div>
            <div class="code">${[...l.code].map((c) => `<span>${esc(c)}</span>`).join('')}</div>
          </div>
        </div>
        <div class="table">
          <ul class="seatcards">${seats}</ul>
          <div class="lobby-actions">
            <button id="bot" ${l.seats.length >= l.maxPlayers ? 'disabled' : ''}>Add a bot</button>
            <button id="start" class="primary" ${canStart ? '' : 'disabled'}>Start game</button>
          </div>
          <p class="hint">${canStart ? 'Or start from the first player\'s phone.' : `${l.minPlayers - l.seats.length > 1 ? `${l.minPlayers - l.seats.length} more players` : 'One more player'} to start (a bot counts).`}</p>
        </div>
      </div>
    </div>`;
  $('bot').onclick = () => post(`/api/rooms/${code}/bot`, { token: hostToken }).catch(toast);
  $('start').onclick = () => post(`/api/rooms/${code}/start`, { token: hostToken }).catch(toast);
  app.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) => (b.onclick = () => post(`/api/rooms/${code}/leave`, { token: hostToken, seat: Number(b.dataset.remove) }).catch(toast)));
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
  if (g.phase === 'cards') return 'Keeping a card';
  if (g.phase === 'raid') return g.raid?.step === 'vote' ? 'Voting' : g.raid?.step === 'commit' ? 'Sending dragons' : 'Fighting or bailing';
  return '';
}

// A dragon on the TV: always its name, then its stage and how it is. A dragon
// sitting out the round says why instead of showing its (full) health.
function tvDragon(d: DragonView, all: DragonView[], roomy: boolean, round: number): string {
  const grow = roomy && d.stage < 3 ? ` <span class="grow">${'●'.repeat(d.growth)}${'○'.repeat(Math.max(0, d.growthTime - d.growth))}</span>` : '';
  return `<div class="tvdragon">${dragonBadge(d, 44)}<div><b>${esc(dragonLabel(d, all))}</b><span>${STAGE_LABEL[d.stage]}${grow}${d.stage ? ` ${powerTag(d.power)}` : ''} ${dragonState(d, round)}</span></div></div>`;
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
  return `<span class="seatnote">${seat.left ? 'Quit' : 'Away'}: a bot plays for them</span>`;
}

let shown: PublicState | null = null; // the state the board is drawn from

function renderGame(g: PublicState) {
  shown = g;
  const n = g.players.length;
  const players = g.players.map((p, i) => {
    const titles = g.titles.filter((t) => t.holder === i).map((t) => `<span class="title-badge" title="${esc(t.name)}">${icon(TITLE_ICON[t.key], 1.1)}</span>`).join('')
      + g.beasts.filter((b) => b.slainBy === i).map((b) => `<span class="title-badge" title="${esc(b.name)} slain">${icon(b.key, 1.1)}</span>`).join('');
    const dragons = g.dragons.filter((d) => d.owner === i).map((d) => tvDragon(d, g.dragons, n <= 4, g.round)).join('') || '<div class="none">No dragons</div>';
    const seat = snap!.lobby.seats[i];
    const turn = g.phase === 'action' && g.turn === i;
    const what = doing(g, i);
    return `
      <div class="pcard${turn ? ' turn' : ''}" style="--pc:${PLAYER_COLORS[i]}">
        <div class="phead">
          <span class="pname">${esc(names[i])}${seatTag(seat)}</span>
          ${titles}
          <span class="hand" title="cards in hand">${icon('cards', 1.2)}${p.handSize}</span>
          <span class="pts">${icon('points', 1.3)}<b>${g.finalTotals?.[i] ?? p.publicPoints}</b></span>
        </div>
        ${seatNote(seat)}${what ? `<span class="doing">${what}</span>` : ''}
        <div class="dragons">${dragons}</div>
      </div>`;
  });
  const offers = g.offers.map((o) => `<li>${playerTag(o.from, names)} <b>${iconText(esc(o.give))}</b><span class="arrow">⇄</span><b>${iconText(esc(o.get))}</b> ${playerTag(o.to, names)}</li>`).join('');
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
  app.innerHTML = `
    <div class="board">
      <section class="mapwrap" id="mapwrap">${board3d ? '' : flat()}</section>
      ${offers ? `<div class="panel offers"><h3>Trade offers</h3><ul>${offers}</ul></div>` : ''}
      <header class="topbar">
        <span class="round">Round ${bannerTop?.round ?? g.round}</span>
        ${phaseTrack(g)}
        <span class="goal">First to <b>${g.pointsToWin}</b>${icon('points', 1.2)} wins</span>
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
// many dragons in a big game take more room.
function fitSide() {
  if (remote) return; // a phone's table view scrolls instead
  const sides = [...app.querySelectorAll<HTMLElement>('.side')];
  if (!sides.length) return;
  let px = parseFloat(getComputedStyle(sides[0]).fontSize);
  const min = parseFloat(getComputedStyle(document.body).fontSize) * 1.05;
  const rows = app.querySelectorAll<HTMLElement>('.phead, .dragons, .corner');
  const over = () => sides.some((s) => s.scrollHeight > s.clientHeight + 1) || [...rows].some((r) => r.scrollWidth > r.clientWidth + 1);
  while (over() && px > min) {
    px = Math.max(min, px * 0.95);
    for (const s of sides) s.style.fontSize = `${px}px`;
  }
}

// "P2 says: "hi"" -> the speaker's name, then what they said.
function talkLine(text: string, g: PublicState): string {
  const m = /^(P\d) says: "(.*)"$/.exec(text);
  return m ? `${named(m[1], names)} <q>${esc(m[2])}</q>` : named(text, names, g.dragons);
}

// ---------- overlays ----------

// The raid takes over the screen while it runs. Every step is the same
// arena: the raiders on the left, the kingdom's defenders on the right.
function targetCard(t: TargetView, extra = ''): string {
  return `<div class="target">${extra}<h2>${esc(t.name)} ${powerTag(t.power, 'big')}</h2>${foeStack(t.units, 2.6)}${lootLine(t.loot, 1.6)}</div>`;
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

// Whether the table sees each choice as it's made, in words.
const SECRET = '<span class="tag">Secret</span>';
const OPEN = '<span class="tag">Everyone sees it</span>';

// One dragon in a raider's row: lit if sent, faint if it could go but isn't.
function raiderDragon(d: DragonView, sent: boolean, all: DragonView[]): string {
  const name = esc(dragonLabel(d, all));
  return `<span class="rd${sent ? ' sent' : ''}" title="${name}">${dragonBadge(d, 60)}${sent ? `${hpBar(d.hp, d.maxHp)}<small>${name}</small>` : ''}</span>`;
}

const HOME = buildingIcon('roost', 40, '#9aa1ad'); // staying home: the roost

function renderRaid(g: PublicState) {
  const raid = g.raid;
  if (!raid) return;
  const dragonById = (id: string) => g.dragons.find((d) => d.id === id)!;
  const sum = (ids: string[]) => ids.reduce((s, id) => s + dragonById(id).power, 0);
  const arena = (rows: string) => `<div class="arena"><ul class="raiders">${rows}</ul><div class="vs">${icon('raid', 3)}</div>${targetCard(raid.target!)}</div>`;
  let body = '';
  if (raid.step === 'vote') {
    body = `<h1>${icon('raid', 1.1)} Vote ${SECRET}${raidPips(g)}</h1>
      <div class="candidates">${raid.candidates.map((t, i) => targetCard(t, `<div class="num">${i + 1}</div>`)).join('')}</div>
      <div class="status">${names.map((_, p) => `${playerTag(p, names)} ${check(raid.voted[p])}`).join(' ')}</div>`;
  } else if (raid.step === 'commit') {
    // Each player's dragons that could go, the sent ones lit; a roost for
    // anyone keeping theirs home; a tick once they're ready.
    const row = (p: number) => {
      const able = g.dragons.filter((d) => d.owner === p && d.canRaid);
      const sent = new Set(raid.commits[p]);
      const home = !able.length || (raid.ready[p] && !sent.size);
      const ds = !able.length ? '<span class="home none">No raid-ready dragon</span>' : home ? `<span class="home">${HOME}<b>Stays home</b></span>` : able.map((d) => raiderDragon(d, sent.has(d.id), g.dragons)).join('');
      return `<li class="raider${home ? ' out' : ''}" style="--pc:${PLAYER_COLORS[p]}">${playerTag(p, names)}<span class="rds">${ds}</span>${sent.size ? powerTag(sum(raid.commits[p])) : ''}${able.length ? check(raid.ready[p]) : ''}</li>`;
    };
    body = `<h1>${icon('raid', 1.1)} Commit ${OPEN}${raidPips(g)}</h1>${arena(names.map((_, p) => row(p)).join(''))}`;
  } else if (raid.step === 'bail') {
    // Who's in, with what; a tick once they've chosen (not what they chose).
    const rows = names.flatMap((_, p) => (raid.commits[p].length
      ? [`<li class="raider" style="--pc:${PLAYER_COLORS[p]}">${playerTag(p, names)}<span class="rds">${raid.commits[p].map((id) => raiderDragon(dragonById(id), true, g.dragons)).join('')}</span>${powerTag(sum(raid.commits[p]))}${check(raid.decided[p])}</li>`]
      : [])).join('');
    body = `<h1>${icon('raid', 1.1)} Fight or bail ${SECRET}${raidPips(g)}</h1>${arena(rows)}`;
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
    return { p: ev.p, got: ev.got, rows: madeOf(ev).map((r) => {
      const dice = (x.dice ?? []).filter((d) => d.resource === r);
      return { r, dice, base: ev.got[r]! - dice.reduce((s, d) => s + d.value, 0), total: ev.got[r]! };
    }) };
  });
  const all = made.reduce((s, m) => s + m.rows.length, 0);
  const step = prodStep(all), spin = prodSpin(all);
  const row = (x: (typeof made)[number]['rows'][number]) => {
    const parts = [x.base ? `<b class="base">${x.base}</b>` : '', ...x.dice.map((d) => dieFace(d.sides, d.value, 'rolling'))].filter(Boolean);
    return `<li class="prow">${resIcon(x.r, 1.5)}<span class="parts">${parts.join('<i>+</i>')}</span>${x.dice.length ? `<span class="eq"><i>=</i><b>${x.total}</b></span>` : ''}</li>`;
  };
  const cards = made.map((m) => `<section class="pturn" style="--pc:${PLAYER_COLORS[m.p]}"><div class="who">${playerTag(m.p, names)}</div><ul>${m.rows.map(row).join('')}</ul><div class="ptotal">${gainChips(m.got, 1.4)}</div></section>`).join('');
  const sum = made.map((m) => `<li style="--pc:${PLAYER_COLORS[m.p]}">${playerTag(m.p, names)}<span class="gains">${gainChips(m.got, 1.4)}</span></li>`).join('');
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

// The whole fight at once (there is no retreat), replayed blow by blow: the
// dragons on one side, the defenders on the other, a stroke from each attacker
// to what it hits, health bars falling as the hits land, then who won and what
// they took. Whoever bailed is shown flown home, under the fighters.
type Combat = Extract<EventView['ev'], { k: 'combat' }>;
function fightBanner(g: PublicState, sc: Extract<Scene, { kind: 'fight' }>, fresh: EventView[]): Banner {
  const e = fresh[sc.at];
  const ev = e.ev as Extract<EventView['ev'], { k: 'fight' }>;
  const rounds = sc.combat.map((j) => fresh[j].ev as Combat);
  const end = sc.end === null ? null : (fresh[sc.end].ev as Extract<EventView['ev'], { k: 'raidEnd' }>);
  // This raid's bails: the ones logged since its commitments locked (maybe
  // in an earlier update than the fight's, so from the whole log).
  const lockAt = g.log.findLastIndex((x) => x.i < e.i && x.ev?.k === 'locked');
  const bailed = g.log.slice(lockAt + 1).filter((x) => x.i < e.i).flatMap((x) => (x.ev?.k === 'bail' ? [x.ev.p] : []));
  const dragons = ev.ds.map((id) => g.dragons.find((d) => d.id === id)!).filter(Boolean);
  // A bailer's dragons are the ones they last committed before the lock.
  const sentBy = (p: number) => g.log.slice(0, lockAt + 1).findLast((x) => x.ev?.k === 'commit' && x.ev.p === p)?.ev as Extract<EventView['ev'], { k: 'commit' }> | undefined;
  const fled = bailed.map((p) => {
    const ds = (sentBy(p)?.ds ?? []).map((id) => g.dragons.find((d) => d.id === id)).filter((d) => !!d).map((d) => dragonBadge(d!, 40)).join('');
    return `<div class="fled" style="--pc:${PLAYER_COLORS[p]}">${playerTag(p, names)} ${ds}<span class="arrow">➜</span>${HOME}</div>`;
  }).join('');
  const outcome = !end ? '' : end.won
    ? `<h1>${esc(end.name)} <span class="ok">falls</span></h1><div class="spoils">${end.winners.map((p, i) => `<span>${playerTag(p, names)} ${gainChips(end.shares[i], 1.6)}</span>`).join('')}</div>`
    : `<h1>${esc(end.name)} <span class="no">holds</span></h1>`;
  const head = `${ev.ps.map((p) => playerTag(p, names)).join(' ')} ${icon('raid', 1.2)} ${esc(ev.name)}`;
  return battle(g, head, dragons, fled, ev.units, rounds, outcome, { round: e.round, phase: 'Raid' }, sc.ms);
}

// A fight for a hex: one player's dragons against what holds it (a beast,
// great or not, and any rival dragons perched there), to the end, played out
// like a raid's, then what they got for it. Every fight in the game gets this
// replay, so the table sees it happen.
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
    : great ? `<h1>The ${esc(end.name)} <span class="ok">is slain</span></h1><div class="spoils"><span>${playerTag(end.p, names)} +${end.points ?? 0} ${icon('points', 1.6)}</span></div>`
    : ev.fauna ? `<h1>The ${esc(end.name)} <span class="ok">falls</span></h1><div class="spoils"><span>${playerTag(end.p, names)} ${gainChips(end.gain, 1.6)}</span></div>${flown}`
    : `<h1>The perched dragons <span class="ok">are driven off</span></h1>${flown}`;
  const head = `${playerTag(ev.p, names)} ${icon('raid', 1.2)} ${ev.fauna ? `${icon(ev.fauna, 1.4)} ${esc(ev.name)}` : 'Perched dragons'}`;
  // Saves from before perching carry one beast and no units.
  const units = (ev.units ?? [{ name: ev.name, hp: ev.hp }]).map((u) => {
    const d = u.d ? g.dragons.find((x) => x.id === u.d) : undefined;
    return { name: d ? dragonLabel(d, g.dragons) : u.name, hp: u.hp, max: d?.maxHp ?? u.hp, d };
  });
  return battle(g, head, dragons, '', units, rounds, outcome, undefined, sc.ms);
}

function battle(g: PublicState, head: string, dragons: DragonView[], fled: string, units: { name: string; hp: number; max?: number; d?: DragonView }[], rounds: Combat[], outcome: string, top: Banner['top'], ms: number): Banner {
  const side = dragons.map((d) => `<div class="fighter" data-d="${d.id}" style="--pc:${PLAYER_COLORS[d.owner]}">${dragonBadge(d, 56)}<b>${esc(dragonLabel(d, g.dragons))}</b>${hpBar(d.maxHp, d.maxHp)}</div>`).join('');
  const foes = units.map((u, i) => u.d
    ? `<div class="fighter unit" data-u="${i}" style="--pc:${PLAYER_COLORS[u.d.owner]}">${dragonBadge(u.d, 56)}<b>${esc(u.name)}</b>${hpBar(u.hp, u.max ?? u.hp)}</div>`
    : `<div class="fighter unit" data-u="${i}">${unitIcon(u.name, 2.2)}<b>${esc(u.name)}</b>${hpBar(u.hp, u.hp)}</div>`).join('');
  const html = `<div class="result fight">
      <h2>${head}</h2>
      <div class="battle"><div class="bside">${side}${fled}</div><div class="bvs"><small>round</small><b class="cround"></b></div><div class="bside foes">${foes}</div></div>
      <div class="outcome">${outcome}</div></div>`;
  const hits = rounds.flatMap((r) => r.hits.map((h) => ({ ...h, round: r.round })));
  const step = hitStep(hits.length);
  const play = (el: HTMLElement) => {
    const hp = new Map<string, [number, number]>();
    dragons.forEach((d) => hp.set(`d${d.id}`, [d.maxHp, d.maxHp]));
    units.forEach((u, i) => hp.set(`u${i}`, [u.hp, u.max ?? u.hp]));
    const box = (key: string) => el.querySelector<HTMLElement>(key[0] === 'u' ? `[data-u="${key.slice(1)}"]` : `[data-d="${key.slice(1)}"]`);
    const battle = el.querySelector<HTMLElement>('.battle')!;
    hits.forEach((h, n) => setTimeout(() => {
      el.querySelector('.cround')!.textContent = String(h.round);
      const [from, to] = h.by === 'dragon' ? [`d${h.d}`, `u${h.u}`] : [`u${h.u}`, `d${h.d}`];
      const [cur, max] = hp.get(to)!;
      const now = h.down ? 0 : Math.max(0, cur - h.dmg);
      hp.set(to, [now, max]);
      const a = box(from), t = box(to);
      a?.classList.remove('strike'); void a?.offsetWidth; a?.classList.add('strike');
      if (a && t) {
        // The stroke: from the attacker's inner edge to the target's, in the
        // dragon's element colour, or the defenders' steel.
        const c = h.by === 'dragon' ? ELEMENT_COLORS[dragons.find((d) => d.id === h.d)?.element ?? ''] ?? '#fff' : '#c9ced6';
        // The last stroke fades out under the new one, never just blinks off.
        battle.querySelectorAll('.beam:not(.gone)').forEach((b) => fade(b));
        battle.append(beam(battle, a, t, h.by === 'dragon', c));
      }
      if (t) {
        // The bar drains to its new width (style.css eases it) rather than
        // being redrawn at it.
        const fill = t.querySelector<HTMLElement>('.hpbar > span')!;
        const { width, color } = hpFill(now, max);
        fill.style.width = width;
        fill.style.background = color;
        // Hits can land faster than a number reads. A new one doesn't cut the
        // last: that one moves up a line, smaller, and fades, so a −4 sits
        // over a −8 and never beside it as one −48. Only those two are up at
        // once, so none rises into the fighter above.
        t.querySelectorAll<HTMLElement>('.dmg').forEach((old) => {
          if (old.classList.contains('gone')) return old.remove();
          old.style.setProperty('--slot', '1');
          fade(old, 450);
        });
        const pop = document.createElement('span');
        pop.className = 'dmg';
        pop.textContent = `−${h.dmg}`;
        t.append(pop);
        pop.addEventListener('animationend', (e) => { if (e.target === pop && e.animationName === 'dmg') pop.remove(); });
        if (now <= 0) t.classList.add('down');
      }
    }, FIGHT_LEAD_MS + n * step));
    setTimeout(() => {
      battle.querySelectorAll('.beam:not(.gone)').forEach((b) => fade(b));
      el.querySelector('.outcome')!.classList.add('show');
    }, FIGHT_LEAD_MS + hits.length * step + 400);
  };
  return { html, ms, play, top };
}

// Takes a stroke or a number away with a short fade instead of a cut.
function fade(x: Element, ms = 250) {
  x.classList.add('gone');
  setTimeout(() => x.remove(), ms);
}

// A line from one fighter's facing edge to another's, drawn over the battle.
function beam(battle: HTMLElement, a: HTMLElement, t: HTMLElement, rightward: boolean, color: string): HTMLElement {
  const o = battle.getBoundingClientRect(), ra = a.getBoundingClientRect(), rt = t.getBoundingClientRect();
  const x1 = (rightward ? ra.right : ra.left) - o.left, y1 = ra.top + ra.height / 2 - o.top;
  const x2 = (rightward ? rt.left : rt.right) - o.left, y2 = rt.top + rt.height / 2 - o.top;
  const b = document.createElement('div');
  b.className = 'beam';
  b.style.cssText = `left:${x1}px;top:${y1}px;width:${Math.hypot(x2 - x1, y2 - y1)}px;transform:rotate(${Math.atan2(y2 - y1, x2 - x1)}rad);--bc:${color}`;
  return b;
}

// Whether the board itself comes next, with no overlay over it.
const boardNext = (g: PublicState) => !banners.length && g.phase !== 'over' && !(g.phase === 'raid' && g.raid);

function updateOverlay(g: PublicState) {
  if (bannerUp) return;
  const next = banners.shift();
  if (next) return showBanner(next);
  if (g.phase === 'over') {
    const w = g.standings![0].p;
    showOverlay('end', 'end', `<div class="endbox" style="--pc:${PLAYER_COLORS[w]}">${winnerScene(PLAYER_COLORS[w], g.players.map((_, i) => PLAYER_COLORS[i]), 340, 100)}
      <h1>${playerTag(w, names)} wins!</h1>${tiebreakNote(g) ? `<p class="tiebreak">${tiebreakNote(g)}</p>` : ''}
      ${standingsHtml(g, names)}
      ${remote ? '' : '<button class="primary" id="again">New game</button>'}</div>`);
    if (!remote) $('again').onclick = () => (location.href = '/tv');
    return;
  }
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
      cut(false);
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

boot().catch(toast);
