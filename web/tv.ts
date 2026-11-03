// The TV: the shared board. Shows everything public, never anyone's hand.
// Lobby -> board, with overlays for production dice, the raid and the end.

import type { DragonView, EventView, PublicState, Snapshot, TargetView } from '../src/state.ts';
import {
  ELEMENT_COLORS, PLAYER_COLORS, STAGE_LABEL, TERRAIN_COLORS, TERRAIN_NAMES, TITLE_ICON, buildingIcon, dieFace, dragonBadge, dragonChip, dragonLabel, esc, eventHtml, foeStack, gainChips, hpBar,
  icon, iconText, mapSvg, named, playerTag, post, resChips, standingsHtml, tiebreakNote, unitIcon, watch,
} from './common.ts';
import { ART_DEFS, glyph, tableScene, towerToken, winnerScene } from './art.ts';
import { Board3D } from './board3d.ts';

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

async function boot() {
  const params = new URLSearchParams(location.search);
  code = (params.get('room') ?? '').toUpperCase();
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
  watch(code, null, onSnapshot, (ok) => document.body.classList.toggle('offline', !ok));
}

function onSnapshot(s: Snapshot) {
  const first = !snap?.game && !!s.game && seenLog < 0;
  snap = s;
  names = s.lobby.seats.map((x) => x.name);
  if (!s.game) {
    $('overlay').className = 'overlay hidden';
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
  renderGame(s.game);
  queueBanners(s.game, fresh);
  updateOverlay(s.game);
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
        <div class="nameplate"><h1 class="title">board-lite</h1><p class="subtitle">Wizards raise dragons. First to ${iconText('15 points')} wins.</p></div>
      </div>
      <div class="lobby-main">
        <div class="join-box">
          <div class="step">Join on your phone</div>
          <div class="url">${esc(joinUrl())}</div>
          ${tailscaleUrl() ? `<div class="alt">or over Tailscale <b>${esc(tailscaleUrl()!)}</b></div>` : ''}
          <div class="step">room code</div>
          <div class="code">${[...l.code].map((c) => `<span>${esc(c)}</span>`).join('')}</div>
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

// "Ada", "Ada and Dax", "Ada, Dax and Eve".
function nameList(ps: number[]): string {
  const tags = ps.map((p) => playerTag(p, names));
  return tags.length <= 1 ? tags.join('') : `${tags.slice(0, -1).join(', ')} and ${tags.at(-1)}`;
}

function phaseLabel(g: PublicState): string {
  if (g.phase === 'over') return 'Game over';
  if (g.phase === 'action') return `${playerTag(g.turn, names)}'s turn`;
  if (raidBanner) return 'Raid';
  if (g.phase === 'discard') return `End of round: ${g.waitingOn.length ? `${nameList(g.waitingOn)} discard${g.waitingOn.length === 1 ? 's' : ''} down to the hand limit` : 'discarding'}`;
  if (g.phase === 'cards') return 'Picking building cards';
  return `Raid${g.raidsLeft > 1 ? ` (${g.raidsLeft} this round)` : ''}`;
}

// What one player is doing right now, if the table is waiting on them.
function doing(g: PublicState, p: number): string {
  if (!g.waitingOn.includes(p)) return '';
  if (g.phase === 'action') return g.turn === p ? 'their turn' : 'answering a trade';
  if (g.phase === 'discard') return 'discarding';
  if (g.phase === 'cards') return 'picking a card';
  if (g.phase === 'raid') return g.raid?.step === 'vote' ? 'voting' : g.raid?.step === 'commit' ? 'sending dragons' : 'fight or bail?';
  return '';
}

// A dragon on the TV: always its name, then its stage and how it is. A dragon
// sitting out the round says why instead of showing its (full) health.
function tvDragon(d: DragonView, all: DragonView[], roomy: boolean): string {
  const grow = roomy && d.stage < 3 ? ` <span class="grow">${'●'.repeat(d.growth)}${'○'.repeat(Math.max(0, d.growthTime - d.growth))}</span>` : '';
  const state = d.resting === 'hungry' ? '<em class="st-hungry">hungry</em>'
    : d.resting === 'hurt' ? '<em class="st-healing">healing</em>'
    : d.resting === 'hunted' ? `<em class="st-hunted">hunted</em> ${hpBar(d.hp, d.maxHp)}`
    : d.stage ? hpBar(d.hp, d.maxHp) : '';
  return `<div class="tvdragon">${dragonBadge(d, 44)}<div><b>${esc(dragonLabel(d, all))}</b><span>${STAGE_LABEL[d.stage]}${grow} ${state}</span></div></div>`;
}

function renderGame(g: PublicState) {
  const n = g.players.length;
  const players = g.players.map((p, i) => {
    const titles = g.titles.filter((t) => t.holder === i).map((t) => `<span class="title-badge" title="${esc(t.name)}">${icon(TITLE_ICON[t.key], 1.1)}</span>`).join('')
      + g.beasts.filter((b) => b.slainBy === i).map((b) => `<span class="title-badge" title="${esc(b.name)} slain">${icon(b.key, 1.1)}</span>`).join('');
    const dragons = g.dragons.filter((d) => d.owner === i).map((d) => tvDragon(d, g.dragons, n <= 4)).join('') || '<div class="none">no dragons</div>';
    const seat = snap!.lobby.seats[i];
    const turn = g.phase === 'action' && g.turn === i;
    const what = doing(g, i);
    return `
      <div class="pcard${turn ? ' turn' : ''}" style="--pc:${PLAYER_COLORS[i]}">
        <div class="phead">
          <span class="pname">${esc(names[i])}${seat?.kind === 'open' ? ' <small>(open seat)</small>' : seat && !seat.connected ? ' <small>(away)</small>' : ''}</span>
          ${titles}
          <span class="hand" title="cards in hand">${icon('cards', 1.2)}${p.handSize}</span>
          <span class="pts">${icon('points', 1.3)}<b>${p.publicPoints}</b></span>
        </div>
        ${what ? `<span class="doing">${what}</span>` : ''}
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
    ${b.slainBy === null ? `<span class="weak">${b.weak.map((e) => icon(e, 1.1)).join('')}×2</span>` : playerTag(b.slainBy, names)}</li>`).join('');
  // Things that happened and what people said, in the order they did.
  const feed = [...g.log.map((e) => ({ i: e.i, html: eventHtml(e, g, names), said: false })), ...g.talk.map((e) => ({ i: e.i, html: talkLine(e.text, g), said: true }))]
    .filter((x) => x.html).sort((a, b) => a.i - b.i).slice(-5)
    .map((x) => `<li${x.said ? ' class="said"' : ''}>${x.html}</li>`).join('');
  if (board3d === undefined) board3d = Board3D.supported() ? new Board3D() : null;
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
  // over the top of the board, on its tray, while they're open.
  const half = Math.ceil(n / 2);
  app.innerHTML = `
    <div class="board">
      <section class="mapwrap" id="mapwrap">${board3d ? '' : flat()}</section>
      ${offers ? `<div class="panel offers"><h3>Trade offers</h3><ul>${offers}</ul></div>` : ''}
      <header class="topbar">
        <span class="round">Round ${g.round}</span>
        <span class="phase">${phaseLabel(g)}</span>
        <span class="goal">first to <b>${g.pointsToWin}</b>${icon('points', 1.2)}</span>
        <span class="roomcode">Join: <b>${esc(joinUrl())}</b>${tailscaleUrl() ? ` <small>· Tailscale <b>${esc(tailscaleUrl()!)}</b></small>` : ''}</span>
      </header>
      <aside class="side left p${n}">${players.slice(0, half).join('')}<div class="corner feedbox"><ul class="feed">${feed}</ul></div></aside>
      <aside class="side right p${n}">${players.slice(half).join('')}<div class="corner titles"><h3>Titles <span class="chip">+${iconText('2 points')}</span></h3><ul>${titles}</ul>
        <h3>Great beasts <span class="chip">+${iconText('1 point')}</span></h3><ul>${beasts}</ul></div></aside>
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
  return m ? `${named(m[1], names)} <q>${named(m[2], names, g.dragons)}</q>` : named(text, names, g.dragons);
}

// ---------- overlays ----------

// The raid takes over the screen while it runs. Every step is the same
// arena: the raiders on the left, the kingdom's defenders on the right.
function targetCard(t: TargetView, extra = ''): string {
  return `<div class="target">${extra}<h2>${esc(t.name)}</h2>${foeStack(t.units, 2.6)}<div class="loot">${resChips(t.loot, 1.6)}</div></div>`;
}

function check(done: boolean): string {
  return done ? '<span class="ok">✔</span>' : '<span class="wait">○</span>'; // not "…", which reads as text cut off
}

// This raid lit, and one dim mark for each raid still to come this round.
function raidPips(g: PublicState): string {
  if (g.raidsLeft < 2) return '';
  return `<span class="pips" title="${g.raidsLeft - 1} more raid${g.raidsLeft > 2 ? 's' : ''} this round">${icon('raid', 1)}${`<span class="later">${icon('raid', 1)}</span>`.repeat(g.raidsLeft - 1)}</span>`;
}

// One dragon in a raider's row: lit if sent, faint if it could go but isn't.
function raiderDragon(d: DragonView, sent: boolean, all: DragonView[]): string {
  const name = esc(dragonLabel(d, all));
  return `<span class="rd${sent ? ' sent' : ''}" title="${name}">${dragonBadge(d, 60)}${sent ? `${hpBar(d.hp, d.maxHp)}<small>${name}</small>` : ''}</span>`;
}

const HOME = buildingIcon('roost', 40, '#9aa1ad'); // staying home: the roost

function renderRaid(g: PublicState) {
  const raid = g.raid;
  const el = $('overlay');
  if (!raid) return;
  el.className = 'overlay raid';
  const dragonById = (id: string) => g.dragons.find((d) => d.id === id)!;
  const arena = (rows: string) => `<div class="arena"><ul class="raiders">${rows}</ul><div class="vs">${icon('raid', 3)}</div>${targetCard(raid.target!)}</div>`;
  let body = '';
  if (raid.step === 'vote') {
    body = `<h1>${icon('raid', 1.1)} Vote ${raidPips(g)}<span class="tag">${icon('secret', 1)}</span></h1>
      <div class="candidates">${raid.candidates.map((t, i) => targetCard(t, `<div class="num">${i + 1}</div>`)).join('')}</div>
      <div class="status">${names.map((_, p) => `${playerTag(p, names)} ${check(raid.voted[p])}`).join(' ')}</div>`;
  } else if (raid.step === 'commit') {
    // Each player's dragons that could go, the sent ones lit; a roost for
    // anyone keeping theirs home; a tick once they're ready.
    const row = (p: number) => {
      const able = g.dragons.filter((d) => d.owner === p && d.canRaid);
      const sent = new Set(raid.commits[p]);
      const home = !able.length || (raid.ready[p] && !sent.size);
      const ds = home ? `<span class="home">${HOME}</span>` : able.map((d) => raiderDragon(d, sent.has(d.id), g.dragons)).join('');
      return `<li class="raider${home ? ' out' : ''}" style="--pc:${PLAYER_COLORS[p]}">${playerTag(p, names)}<span class="rds">${ds}</span>${able.length ? check(raid.ready[p]) : ''}</li>`;
    };
    body = `<h1>Who's going? ${raidPips(g)}<span class="tag">${icon('public', 1)}</span></h1>${arena(names.map((_, p) => row(p)).join(''))}`;
  } else if (raid.step === 'bail') {
    // Who's in, with what; a tick once they've chosen (not what they chose).
    const rows = names.flatMap((_, p) => (raid.commits[p].length
      ? [`<li class="raider" style="--pc:${PLAYER_COLORS[p]}">${playerTag(p, names)}<span class="rds">${raid.commits[p].map((id) => raiderDragon(dragonById(id), true, g.dragons)).join('')}</span>${check(raid.decided[p])}</li>`]
      : [])).join('');
    body = `<h1>Fight or bail? ${raidPips(g)}<span class="tag">${icon('secret', 1)}</span></h1>${arena(rows)}`;
  }
  el.innerHTML = `<div class="raidbox">${body}</div>`;
}

// Short banners for things that just happened, shown one after another: the
// result of a raid, production dice at the start of a round. The raid screen
// and the final scores show whenever no banner is up.
interface Banner { html: string; ms: number; raid?: boolean; play?: (el: HTMLElement) => void }
let raidBanner = false; // a raid's fight is on screen: the top bar still says "Raid"
const banners: Banner[] = [];
let bannerUp = false;

function queueBanners(g: PublicState, fresh: EventView[]) {
  for (const e of fresh) {
    const ev = e.ev;
    if (ev?.k === 'fight') banners.push(fightBanner(g, e, fresh));
    if (ev?.k === 'hunt' && g.beasts.some((b) => b.key === ev.fauna)) banners.push(huntBanner(g, e, fresh));
    if (ev?.k === 'noRaid') banners.push({ html: `<div class="result"><h1>${eventHtml(e, g, names)}</h1></div>`, ms: 4000, raid: true });
    if (ev?.k === 'round') {
      const rolls = fresh.filter((x) => x.i > e.i && x.round === e.round && x.ev?.k === 'produce' && x.dice?.length);
      banners.push(rollBanner(e.round, rolls));
    }
  }
}

// A new round's production, as the table would roll it: one player at a
// time, their dice tumbling and landing, for everyone to watch. Only the
// rolls: what they bring in is each player's own business, on their phone.
// A round nobody rolls in still opens with its number, briefly.
const ROLL_MS = 1300;
function rollBanner(round: number, rolls: EventView[]): Banner {
  const rows = rolls.map((x) => {
    const p = (x.ev as Extract<EventView['ev'], { k: 'produce' }>).p;
    return `<li style="--pc:${PLAYER_COLORS[p]}">${playerTag(p, names)}<span class="dice">${x.dice!.map((d) => dieFace(d.sides, d.value, 'rolling')).join('')}</span></li>`;
  }).join('');
  const play = (el: HTMLElement) => {
    el.querySelectorAll<HTMLElement>('.production li').forEach((li, k) => setTimeout(() => {
      el.querySelector('.production li.now')?.classList.remove('now');
      li.classList.add('up', 'now');
      // Spin the dice for a moment, then land on what they rolled.
      const dice = li.querySelectorAll<HTMLElement>('.die.rolling');
      const finals = Array.from(dice, (d) => d.querySelector('b')!.textContent);
      const spin = setInterval(() => dice.forEach((d) => (d.querySelector('b')!.textContent = String(1 + Math.floor(Math.random() * Number(d.dataset.sides))))), 70);
      setTimeout(() => {
        clearInterval(spin);
        dice.forEach((d, i) => {
          d.querySelector('b')!.textContent = finals[i];
          d.classList.remove('rolling');
        });
      }, ROLL_MS * 0.6);
    }, 300 + k * ROLL_MS));
  };
  return { html: `<div class="production"><h1>Round ${round}</h1>${rows ? `<ul>${rows}</ul>` : ''}</div>`, ms: rolls.length ? 300 + rolls.length * ROLL_MS + 1500 : 1500, play };
}

// The whole fight at once (there is no retreat), replayed blow by blow: the
// dragons on one side, the defenders on the other, a stroke from each attacker
// to what it hits, health bars falling as the hits land, then who won and what
// they took. Whoever bailed is shown flown home, under the fighters.
const HIT_MS = 300;
function fightBanner(g: PublicState, e: EventView, fresh: EventView[]): Banner {
  const ev = e.ev as Extract<EventView['ev'], { k: 'fight' }>;
  const later = fresh.filter((x) => x.i > e.i);
  const endAt = later.findIndex((x) => x.ev?.k === 'raidEnd');
  const rounds = (endAt < 0 ? later : later.slice(0, endAt)).flatMap((x) => (x.ev?.k === 'combat' ? [x.ev] : []));
  const end = endAt < 0 ? null : (later[endAt].ev as Extract<EventView['ev'], { k: 'raidEnd' }>);
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
    ? `<h1>${esc(end.name)} <span class="ok">falls!</span></h1><div class="spoils">${end.winners.map((p) => `<span>${playerTag(p, names)} ${gainChips(end.share, 1.6)}</span>`).join('')}</div>`
    : `<h1>${esc(end.name)} <span class="no">holds</span></h1>`;
  const head = `${ev.ps.map((p) => playerTag(p, names)).join(' ')} ${icon('raid', 1.2)} ${esc(ev.name)}`;
  return battle(g, head, dragons, fled, ev.units, rounds, outcome, true);
}

// A great beast's fight: one player's dragons against it, to the end, played
// out like a raid's. The table watches the race.
function huntBanner(g: PublicState, e: EventView, fresh: EventView[]): Banner {
  const ev = e.ev as Extract<EventView['ev'], { k: 'hunt' }>;
  const later = fresh.filter((x) => x.i > e.i);
  const endAt = later.findIndex((x) => x.ev?.k === 'cleared');
  const rounds = (endAt < 0 ? later : later.slice(0, endAt)).flatMap((x) => (x.ev?.k === 'combat' ? [x.ev] : []));
  const end = endAt < 0 ? null : (later[endAt].ev as Extract<EventView['ev'], { k: 'cleared' }>);
  const dragons = ev.ds.map((id) => g.dragons.find((d) => d.id === id)!).filter(Boolean);
  const beast = g.beasts.find((b) => b.key === ev.fauna)!;
  const outcome = !end ? '' : end.won
    ? `<h1>The ${esc(end.name)} <span class="ok">is slain!</span></h1><div class="spoils"><span>${playerTag(end.p, names)} +${end.points ?? beast.points} ${icon('points', 1.6)}</span></div>`
    : `<h1>The ${esc(end.name)} <span class="no">drives them off</span></h1>`;
  const head = `${playerTag(ev.p, names)} ${icon('raid', 1.2)} ${icon(ev.fauna, 1.4)} ${esc(ev.name)}`;
  return battle(g, head, dragons, '', [{ name: ev.name, hp: beast.hp }], rounds, outcome, false);
}

function battle(g: PublicState, head: string, dragons: DragonView[], fled: string, units: { name: string; hp: number }[], rounds: Extract<EventView['ev'], { k: 'combat' }>[], outcome: string, raid: boolean): Banner {
  const side = dragons.map((d) => `<div class="fighter" data-d="${d.id}" style="--pc:${PLAYER_COLORS[d.owner]}">${dragonBadge(d, 56)}<b>${esc(dragonLabel(d, g.dragons))}</b>${hpBar(d.maxHp, d.maxHp)}</div>`).join('');
  const foes = units.map((u, i) => `<div class="fighter unit" data-u="${i}">${unitIcon(u.name, 2.2)}<b>${esc(u.name)}</b>${hpBar(u.hp, u.hp)}</div>`).join('');
  const html = `<div class="result fight">
      <h2>${head}</h2>
      <div class="battle"><div class="bside">${side}${fled}</div><div class="bvs"><small>round</small><b class="cround"></b></div><div class="bside foes">${foes}</div></div>
      <div class="outcome">${outcome}</div></div>`;
  const hits = rounds.flatMap((r) => r.hits.map((h) => ({ ...h, round: r.round })));
  const step = Math.min(HIT_MS, 5000 / Math.max(1, hits.length));
  const play = (el: HTMLElement) => {
    const hp = new Map<string, [number, number]>();
    dragons.forEach((d) => hp.set(`d${d.id}`, [d.maxHp, d.maxHp]));
    units.forEach((u, i) => hp.set(`u${i}`, [u.hp, u.hp]));
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
        battle.querySelector('.beam')?.remove();
        battle.append(beam(battle, a, t, h.by === 'dragon', c));
      }
      if (t) {
        t.querySelector('.hpbar')!.outerHTML = hpBar(now, max);
        const pop = document.createElement('span');
        pop.className = 'dmg';
        pop.textContent = `−${h.dmg}`;
        t.append(pop);
        setTimeout(() => pop.remove(), 900);
        if (now <= 0) t.classList.add('down');
      }
    }, 800 + n * step));
    setTimeout(() => {
      battle.querySelector('.beam')?.remove();
      el.querySelector('.outcome')!.classList.add('show');
    }, 800 + hits.length * step + 400);
  };
  return { html, ms: 800 + hits.length * step + 4500, play, raid };
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

function updateOverlay(g: PublicState) {
  const el = $('overlay');
  if (bannerUp) return;
  const next = banners.shift();
  if (next) return showBanner(next);
  if (g.phase === 'over') {
    const w = g.standings![0].p;
    el.className = 'overlay end';
    el.innerHTML = `<div class="endbox" style="--pc:${PLAYER_COLORS[w]}">${winnerScene(PLAYER_COLORS[w], g.players.map((_, i) => PLAYER_COLORS[i]), 340, 100)}
      <h1>${playerTag(w, names)} wins!</h1>${tiebreakNote(g) ? `<p class="tiebreak">${tiebreakNote(g)}</p>` : ''}
      ${standingsHtml(g, names)}
      <button class="primary" id="again">New game</button></div>`;
    $('again').onclick = () => (location.href = '/tv');
    return;
  }
  if (g.phase === 'raid' && g.raid) return renderRaid(g);
  el.className = 'overlay hidden';
  el.innerHTML = '';
}

function setRaidBanner(on: boolean) {
  raidBanner = on;
  const ph = app.querySelector('.topbar .phase');
  if (ph && snap?.game) ph.innerHTML = phaseLabel(snap.game);
}

function showBanner(b: Banner) {
  const el = $('overlay');
  bannerUp = true;
  setRaidBanner(!!b.raid);
  el.className = 'overlay banner';
  el.innerHTML = b.html;
  b.play?.(el);
  setTimeout(() => {
    bannerUp = false;
    setRaidBanner(false);
    if (snap?.game) updateOverlay(snap.game);
  }, b.ms);
}

function toast(e: unknown) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = e instanceof Error ? e.message : String(e);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

boot().catch(toast);
