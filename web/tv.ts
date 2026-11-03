// The TV: the shared board. Shows everything public, never anyone's hand.
// Lobby -> board, with overlays for production dice, the raid and the end.

import type { DragonView, EventView, PublicState, Snapshot, TargetView } from '../src/state.ts';
import {
  PLAYER_COLORS, RESOURCES, STAGE_LABEL, TERRAIN_COLORS, TERRAIN_NAMES, buildingIcon, dieFace, dragonBadge, dragonChip, dragonLabel, elemIcon, esc, hpBar,
  icon, iconText, mapSvg, named, playerTag, post, resChips, resIcon, watch,
} from './common.ts';
import { Board3D } from './board3d.ts';

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
    seenLog = s.game.round === 1 && s.game.phase === 'action' ? -1 : log.at(-1)?.i ?? -1;
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
  const seats = l.seats.map((s, i) => `
    <li style="--pc:${PLAYER_COLORS[i]}"><span class="dot"></span>${esc(s.name)}${s.kind === 'bot' ? ' <small>(bot)</small>' : s.kind === 'open' ? ' <small>(open seat)</small>' : ''}${!s.connected ? ' <small>(away)</small>' : ''}
      <button class="ghost small" data-remove="${i}">remove</button></li>`).join('');
  const canStart = l.seats.length >= l.minPlayers;
  app.innerHTML = `
    <div class="lobby">
      <h1 class="title">board-lite</h1>
      <p class="subtitle">Wizards raise dragons. First to ${iconText('15 points')} wins.</p>
      <div class="join-box">
        <div>On your phone, open</div>
        <div class="url">${esc(joinUrl())}</div>
        ${tailscaleUrl() ? `<div class="alt">or over Tailscale: <b>${esc(tailscaleUrl()!)}</b></div>` : ''}
        <div>room code</div>
        <div class="code">${esc(l.code)}</div>
        <div class="cli">At a terminal: <code>node src/cli.ts join http://${esc(joinUrl())} &lt;name&gt;</code></div>
        <div class="cli">Claude players: <code>node src/playtest/run.ts --room http://${esc(joinUrl('localhost'))} --models opus,haiku</code></div>
      </div>
      <ul class="seats">${seats || '<li class="empty">Waiting for players to join…</li>'}</ul>
      <div class="lobby-actions">
        <button id="bot" ${l.seats.length >= l.maxPlayers ? 'disabled' : ''}>Add a bot</button>
        <button id="start" class="primary" ${canStart ? '' : 'disabled'}>Start game (${l.seats.length} players)</button>
      </div>
      <p class="hint">${canStart ? 'Start here, or the first player can start from their phone.' : `Need at least ${l.minPlayers} players (bots count).`}</p>
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
  if (g.phase === 'discard') return `End of round: ${g.waitingOn.length ? `${nameList(g.waitingOn)} discard${g.waitingOn.length === 1 ? 's' : ''} down to the hand limit` : 'discarding'}`;
  return `Raid${g.raidsLeft > 1 ? ` (${g.raidsLeft} this round)` : ''}`;
}

// What one player is doing right now, if the table is waiting on them.
function doing(g: PublicState, p: number): string {
  if (!g.waitingOn.includes(p)) return '';
  if (g.phase === 'action') return g.turn === p ? 'their turn' : 'answering a trade';
  if (g.phase === 'discard') return 'discarding';
  if (g.phase === 'raid') return g.raid?.step === 'vote' ? 'voting' : g.raid?.step === 'commit' ? 'sending dragons' : 'fight or bail?';
  return '';
}

// A round's income: every resource, always in the same order, so the columns
// line up from card to card; nothing coming in shows dimmed.
function incomeRow(prod: Record<string, { base: number; dice: number[] }>): string {
  return RESOURCES.map((r) => {
    const x = prod[r];
    const none = !x.base && !x.dice.length;
    // "+d6", or "+2d6" for two of them.
    const dice = [...new Set(x.dice)].sort((a, b) => b - a).map((s) => {
      const k = x.dice.filter((d) => d === s).length;
      return `<small>+${k > 1 ? k : ''}d${s}</small>`;
    }).join('');
    return `<span class="inc${none ? ' zero' : ''}">${resIcon(r, 1.25)}<b>${x.base < 0 ? '−' : '+'}${Math.abs(x.base)}</b>${dice}</span>`;
  }).join('');
}

// Titles go by their short names on the TV: the card badge and the titles box match.
const TITLE_SHORT: Record<string, string> = { army: 'Army', tower: 'Tower', territory: 'Territory' };
const TITLE_UNIT: Record<string, [string, string]> = { army: ['dragon point', 'dragon points'], tower: ['floor', 'floors'], territory: ['building', 'buildings'] };

function titleRow(g: PublicState, t: PublicState['titles'][number]): string {
  const unit = (n: number) => `${n} ${TITLE_UNIT[t.key][n === 1 ? 0 : 1]}`;
  const best = Math.max(...t.values);
  const leaders = t.values.flatMap((v, p) => (v === best ? [p] : []));
  const who = t.holder !== null
    ? `${playerTag(t.holder, names)} <small>${unit(t.values[t.holder])}</small>`
    : `<span class="none">nobody</span> <small>needs ${unit(t.min)}${best <= 0 ? '' : leaders.length > 2 ? `; ${leaders.length} tied on ${best}` : `; best ${nameList(leaders)} ${best}`}</small>`;
  return `<li><span class="title-badge">${esc(TITLE_SHORT[t.key])}</span><span>${who}</span></li>`;
}

// A dragon on the TV: always its name, then its stage and how it is. A dragon
// sitting out the round says why instead of showing its (full) health.
function tvDragon(d: DragonView, all: DragonView[], roomy: boolean): string {
  const grow = roomy && d.stage < 3 ? ` <span class="grow">${'●'.repeat(d.growth)}${'○'.repeat(Math.max(0, d.growthTime - d.growth))}</span>` : '';
  const state = d.resting === 'hungry' ? '<em class="st-hungry">hungry</em>'
    : d.resting === 'hurt' ? '<em class="st-healing">healing</em>'
    : d.stage ? hpBar(d.hp, d.maxHp) : '';
  return `<div class="tvdragon">${dragonBadge(d, 44)}<div><b>${esc(dragonLabel(d, all))}</b><span>${STAGE_LABEL[d.stage]}${grow} ${state}</span></div></div>`;
}

function renderGame(g: PublicState) {
  const n = g.players.length;
  const players = g.players.map((p, i) => {
    const titles = g.titles.filter((t) => t.holder === i).map((t) => `<span class="title-badge">${esc(TITLE_SHORT[t.key])}</span>`).join('');
    const dragons = g.dragons.filter((d) => d.owner === i).map((d) => tvDragon(d, g.dragons, n <= 4)).join('') || '<div class="none">no dragons</div>';
    const seat = snap!.lobby.seats[i];
    const turn = g.phase === 'action' && g.turn === i;
    const what = doing(g, i);
    return `
      <div class="pcard${turn ? ' turn' : ''}" style="--pc:${PLAYER_COLORS[i]}">
        <div class="phead">
          <span class="pname">${esc(names[i])}${seat && !seat.connected ? ' <small>(away)</small>' : ''}</span>
          ${what ? `<span class="doing">${what}</span>` : ''}
          ${titles}
          <span class="hand" title="cards in hand">${icon('cards', 1.2)}${p.handSize}</span>
          <span class="pts">${icon('points', 1.3)}<b>${p.publicPoints}</b></span>
        </div>
        <div class="prow"><span class="lbl">per round</span>${incomeRow(p.production)}</div>
        <div class="dragons">${dragons}</div>
      </div>`;
  }).join('');
  const offers = g.offers.map((o) => `<li>${playerTag(o.from, names)} gives <b>${iconText(esc(o.give))}</b>, ${playerTag(o.to, names)} gives <b>${iconText(esc(o.get))}</b></li>`).join('');
  const titles = g.titles.map((t) => titleRow(g, t)).join('');
  // Things that happened and what people said, in the order they did.
  const feed = [...g.log.map((e) => ({ e, talk: false })), ...g.talk.map((e) => ({ e, talk: true }))]
    .sort((a, b) => a.e.i - b.e.i).slice(-8)
    .map(({ e, talk }) => (talk ? `<li class="said">${talkLine(e.text, g)}</li>` : `<li>${named(e.text, names, g.dragons)}</li>`)).join('');
  if (board3d === undefined) board3d = Board3D.supported() ? new Board3D() : null;
  const highlight = g.phase === 'action' ? g.turn : null;
  // The flat map needs a legend; the 3D board shows what things are.
  const flat = () => {
    const legend = Object.keys(TERRAIN_COLORS).map((t) => `<span><i style="background:${TERRAIN_COLORS[t]}"></i>${TERRAIN_NAMES[t]}</span>`).join('');
    const bLegend = (['tower', 'quarry', 'lumber_camp', 'crystal_mine', 'pasture', 'roost', 'hatchery', 'port', 'monument'] as const)
      .map((b) => `<span>${buildingIcon(b, 18, '#ddd')}${b.replace('_', ' ')}</span>`).join('');
    return `${mapSvg(g.map, { size: 40, highlight })}<div class="legend">${legend}</div><div class="legend">${bLegend}</div>`;
  };
  app.innerHTML = `
    <div class="board">
      <header class="topbar">
        <span class="round">Round ${g.round}</span>
        <span class="phase">${phaseLabel(g)}</span>
        <span class="goal">first to <b>${g.pointsToWin}</b>${icon('points', 1.2)}</span>
        <span class="roomcode">Join: <b>${esc(joinUrl())}</b>${tailscaleUrl() ? ` <small>· Tailscale <b>${esc(tailscaleUrl()!)}</b></small>` : ''}</span>
      </header>
      <section class="mapwrap" id="mapwrap">${board3d ? '' : flat()}${offers ? `<div class="panel offers"><h3>Trade offers</h3><ul>${offers}</ul></div>` : ''}</section>
      <aside class="side p${n}">${players}</aside>
      <footer class="ticker"><ul class="feed">${feed}</ul><div class="titles"><h3>Titles <small>${iconText('2 points')} each</small></h3><ul>${titles}</ul></div></footer>
    </div>`;
  if (board3d) {
    $('mapwrap').prepend(board3d.el);
    board3d.update(g, highlight);
  }
  fitSide();
  // The feed shows the newest lines at the bottom; an older one that only
  // partly fits at the top is dropped rather than shown sliced in half.
  for (const ul of app.querySelectorAll<HTMLElement>('.ticker ul.feed')) {
    const top = ul.getBoundingClientRect().top;
    while (ul.children.length > 1 && ul.firstElementChild!.getBoundingClientRect().top < top - 1) ul.firstElementChild!.remove();
  }
}

// The player cards start as large as their count allows (style.css) and step
// down until they all fit: many dragons in a big game take more room.
function fitSide() {
  const side = app.querySelector<HTMLElement>('.side');
  if (!side) return;
  let px = parseFloat(getComputedStyle(side).fontSize);
  const min = parseFloat(getComputedStyle(document.body).fontSize) * 1.05;
  const rows = side.querySelectorAll<HTMLElement>('.phead, .prow, .dragons');
  const over = () => side.scrollHeight > side.clientHeight + 1 || [...rows].some((r) => r.scrollWidth > r.clientWidth + 1);
  while (over() && px > min) side.style.fontSize = `${(px = Math.max(min, px * 0.95))}px`;
}

// "P2 says: "hi"" -> the speaker's name, then what they said.
function talkLine(text: string, g: PublicState): string {
  const m = /^(P\d) says: "(.*)"$/.exec(text);
  return m ? `${named(m[1], names)} <q>${named(m[2], names, g.dragons)}</q>` : named(text, names, g.dragons);
}

// ---------- overlays ----------

// The raid takes over the screen while it runs.
function targetCard(t: TargetView, extra = ''): string {
  const units = t.units.map((u) => `
    <div class="unit${u.hp <= 0 ? ' down' : ''}">
      <b>${esc(u.name)}</b> ${hpBar(u.hp, u.maxHp)} <span class="hp">${u.hp}/${u.maxHp}</span>
      <small>hits ${esc(u.attack)}${u.weak.length ? ` · <span class="weak">weak: ${u.weak.map(elem).join(' ')}</span>` : ''}${u.strong.length ? ` · <span class="strong">resists: ${u.strong.map(elem).join(' ')}</span>` : ''}</small>
    </div>`).join('');
  return `<div class="target">${extra}<h2>${esc(t.name)}</h2>${units}<div class="loot">Loot ${resChips(t.loot, 1.4)} <small>split among the winners</small></div></div>`;
}

function elem(e: string): string {
  return elemIcon(e, 1.25);
}

function check(done: boolean): string {
  return done ? '<span class="ok">✔</span>' : '<span class="wait">○</span>'; // not "…", which reads as text cut off
}

function renderRaid(g: PublicState) {
  const raid = g.raid;
  const el = $('overlay');
  if (!raid) return;
  el.className = 'overlay raid';
  const dragonById = (id: string) => g.dragons.find((d) => d.id === id)!;
  let body = '';
  if (raid.step === 'vote') {
    body = `<h1>Raid! Vote for a target on your phone</h1>
      <div class="candidates">${raid.candidates.map((t, i) => targetCard(t, `<div class="num">${i + 1}</div>`)).join('')}</div>
      <div class="status">${names.map((_, p) => `${playerTag(p, names)} ${check(raid.voted[p])}`).join(' ')}</div>`;
  } else if (raid.step === 'commit') {
    // Each row says plainly where that player stands: what they've sent, that
    // they're keeping their dragons home, that none of theirs can go, or how
    // many could while they're still choosing.
    const commitRow = (p: number) => {
      const sent = raid.commits[p].map((id) => dragonChip(dragonById(id), g.dragons)).join('');
      const able = g.dragons.filter((d) => d.owner === p && d.canRaid).length;
      let what: string;
      if (sent) what = `${sent} ${raid.ready[p] ? '<span class="ok">ready</span>' : '<span class="wait">choosing…</span>'}`;
      else if (!able) what = '<span class="none">no dragon can go</span>';
      else if (raid.ready[p]) what = '<span class="none">stays home</span> <span class="ok">ready</span>';
      else what = `<span class="wait">choosing…</span> <span class="none">${able} dragon${able === 1 ? '' : 's'} can go</span>`;
      return `<li>${playerTag(p, names)} ${what}</li>`;
    };
    const rows = names.map((_, p) => commitRow(p)).join('');
    body = `<h1>Commit your dragons</h1><p class="sub">Commitments are public. They lock when everyone is ready.</p>
      <div class="raidrow">${targetCard(raid.target!)}<ul class="commits">${rows}</ul></div>`;
  } else if (raid.step === 'bail') {
    const rows = names.flatMap((_, p) => (raid.commits[p].length ? [`<li>${playerTag(p, names)} ${raid.commits[p].map((id) => dragonChip(dragonById(id), g.dragons)).join('')} ${check(raid.decided[p])}</li>`] : [])).join('');
    body = `<h1>Fight or bail?</h1><p class="sub">Each committed player chooses in secret on their phone.</p>
      <div class="raidrow">${targetCard(raid.target!)}<ul class="commits">${rows}</ul></div>`;
  }
  el.innerHTML = `<div class="raidbox">${body}</div>`;
}

// Short banners for things that just happened, shown one after another: the
// result of a raid, production dice at the start of a round. The raid screen
// and the final scores show whenever no banner is up.
interface Banner { html: string; ms: number; dice?: boolean }
const banners: Banner[] = [];
let bannerUp = false;

function queueBanners(g: PublicState, fresh: EventView[]) {
  for (const e of fresh) {
    if (/^Fighting:/.test(e.text)) {
      // There is no retreat, so the whole fight resolves at once: replay it.
      const rounds = fresh.filter((x) => x.i > e.i && x.round === e.round && /^Combat round/.test(x.text));
      const rows = rounds.map((x) => `<li>${named(x.text, names, g.dragons)}</li>`).join('');
      const end = fresh.find((x) => x.i > e.i && /falls!|holds\./.test(x.text));
      banners.push({ html: `<div class="result"><h2>${named(e.text, names, g.dragons)}</h2><ul class="combatlog">${rows}</ul>${end ? `<h1>${named(end.text, names, g.dragons)}</h1>` : ''}</div>`, ms: 5000 + 1500 * rounds.length });
    }
    if (/Everyone bailed|Nobody commits/.test(e.text)) {
      banners.push({ html: `<div class="result"><h1>${named(e.text, names, g.dragons)}</h1></div>`, ms: 5000 });
    }
    if (/^=== Round \d+ ===$/.test(e.text)) {
      const prod = fresh.filter((x) => x.i > e.i && x.round === e.round && / produces /.test(x.text));
      if (!prod.length) continue;
      const rows = prod.map((x) => `<li>${named(x.text.replace(/ produces .*/, ''), names)} <span class="dice">${(x.dice ?? []).map((d) => dieFace(d.sides, d.value, 'rolling')).join('') || '<small>no dice</small>'}</span> <span class="got">${named(x.text.replace(/^P\d produces /, '+ ').replace(/\.$/, ''), names)}</span></li>`).join('');
      banners.push({ html: `<div class="production"><h1>Round ${e.round}: production</h1><ul>${rows}</ul></div>`, ms: 4500, dice: true });
    }
  }
}

function updateOverlay(g: PublicState) {
  const el = $('overlay');
  if (bannerUp) return;
  const next = banners.shift();
  if (next) return showBanner(next);
  if (g.phase === 'over') {
    const order = g.finalTotals!.map((t, p) => [t, p]).sort((a, b) => b[0] - a[0]);
    el.className = 'overlay end';
    el.innerHTML = `<div class="endbox"><h1>${playerTag(g.winner!, names)} wins!</h1>
      <ol>${order.map(([t, p]) => `<li>${playerTag(p, names)} <span class="chip"><b>${t}</b>${icon('points', 1.8)}</span> <small>(${g.players[p].publicPoints} on the board, ${t - g.players[p].publicPoints} hidden)</small></li>`).join('')}</ol>
      <button class="primary" id="again">New game</button></div>`;
    $('again').onclick = () => (location.href = '/tv');
    return;
  }
  if (g.phase === 'raid' && g.raid) return renderRaid(g);
  el.className = 'overlay hidden';
  el.innerHTML = '';
}

function showBanner(b: Banner) {
  const el = $('overlay');
  bannerUp = true;
  el.className = 'overlay banner';
  el.innerHTML = b.html;
  if (b.dice) {
    // Spin the dice for a moment, then land on what they rolled.
    const dice = el.querySelectorAll<HTMLElement>('.die.rolling');
    const finals = Array.from(dice, (d) => d.querySelector('b')!.textContent);
    const spin = setInterval(() => dice.forEach((d) => (d.querySelector('b')!.textContent = String(1 + Math.floor(Math.random() * Number(d.dataset.sides))))), 70);
    setTimeout(() => {
      clearInterval(spin);
      dice.forEach((d, i) => {
        d.querySelector('b')!.textContent = finals[i];
        d.classList.remove('rolling');
      });
      el.querySelectorAll('.got').forEach((x) => x.classList.add('show'));
    }, 1300);
  }
  setTimeout(() => {
    bannerUp = false;
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
