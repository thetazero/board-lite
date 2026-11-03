// The TV: the shared board. Shows everything public, never anyone's hand.
// Lobby -> board, with overlays for production dice, the raid and the end.

import type { DragonView, EventView, PublicState, Snapshot, TargetView } from '../src/state.ts';
import {
  PLAYER_COLORS, RESOURCES, TERRAIN_COLORS, TERRAIN_NAMES, TITLE_ICON, buildingIcon, dieFace, dragonBadge, dragonChip, elemIcon, esc, eventHtml, gainChips, hpBar,
  icon, iconText, mapSvg, named, playerTag, post, resChips, resIcon, standingsHtml, tiebreakNote, watch,
} from './common.ts';
import { ART_DEFS, glyph, tableScene, towerToken, winnerScene } from './art.ts';

document.body.insertAdjacentHTML('afterbegin', ART_DEFS);
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

function phaseLabel(g: PublicState): string {
  if (g.phase === 'over') return 'Game over';
  if (g.phase === 'action') return `${playerTag(g.turn, names)}'s turn`;
  if (g.phase === 'discard') return 'End of round: discarding';
  if (g.phase === 'cards') return 'Picking building cards';
  return `Raid${g.raidsLeft > 1 ? ` (${g.raidsLeft} this round)` : ''}`;
}

function prodChips(prod: Record<string, { base: number; dice: number[] }>): string {
  return RESOURCES.filter((r) => prod[r].base || prod[r].dice.length)
    .map((r) => `<span class="chip">${resIcon(r, 1.2)}${prod[r].base}${prod[r].dice.length ? `<small>+${prod[r].dice.map((d) => `d${d}`).join('+')}</small>` : ''}</span>`)
    .join('');
}

function renderGame(g: PublicState) {
  const waiting = new Set(g.waitingOn);
  const many = g.players.length >= 5; // compact player cards so six fit
  const players = g.players.map((p, i) => {
    const titles = g.titles.filter((t) => t.holder === i).map((t) => `<span class="title-badge">${esc(t.name)}</span>`).join('');
    const dragons = g.dragons.filter((d) => d.owner === i).map((d) => dragonChip(d, many)).join('') || '<div class="none">no dragons</div>';
    const seat = snap!.lobby.seats[i];
    const turn = g.phase === 'action' && g.turn === i;
    return `
      <div class="pcard${turn ? ' turn' : ''}${many ? ' compact' : ''}" style="--pc:${PLAYER_COLORS[i]}">
        <div class="phead">
          <span class="pname">${esc(names[i])}${seat?.kind === 'open' ? ' <small>(open seat)</small>' : seat && !seat.connected ? ' <small>(away)</small>' : ''}</span>
          ${waiting.has(i) && g.phase !== 'over' ? '<span class="thinking">deciding…</span>' : ''}
          <span class="pts">${icon('points', 1.5)}<b>${p.publicPoints}</b><small>/${g.pointsToWin}</small></span>
        </div>
        <div class="prow"><span class="chip cards" title="cards in hand">${icon('cards', 1.25)}${p.handSize}</span>${prodChips(p.production)}</div>
        ${titles ? `<div class="prow">${titles}</div>` : ''}
        <div class="dragons">${dragons}</div>
      </div>`;
  }).join('');
  const offers = g.offers.map((o) => `<li>${playerTag(o.from, names)} <b>${iconText(esc(o.give))}</b><span class="arrow">⇄</span><b>${iconText(esc(o.get))}</b> ${playerTag(o.to, names)}</li>`).join('');
  // Each title: everyone's count in their colour, the holder's ringed, and the
  // count it takes to hold it at all.
  const titles = g.titles.map((t) => `<li>${icon(TITLE_ICON[t.key], 1.3)}<b>${esc(t.name)}</b>
    <span class="tvals">${t.values.map((v, p) => `<span class="tval${t.holder === p ? ' held' : ''}${v < t.min ? ' under' : ''}" style="--pc:${PLAYER_COLORS[p]}">${v}</span>`).join('')}</span><small class="tmin">≥${t.min}</small></li>`).join('');
  const log = g.log.map((e) => eventHtml(e, g, names)).filter(Boolean).slice(-7).map((h) => `<li>${h}</li>`).join('');
  const talk = g.talk.slice(-6).map((e) => `<li>${talkLine(e.text, g)}</li>`).join('');
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
        <span class="roomcode">Join: <b>${esc(joinUrl())}</b>${tailscaleUrl() ? ` <small>· Tailscale <b>${esc(tailscaleUrl()!)}</b></small>` : ''}</span>
      </header>
      <section class="mapwrap" id="mapwrap">${board3d ? '' : flat()}</section>
      <aside class="side">
        ${players}
        ${many ? '' : `<div class="panel titles"><h3>Titles <span class="chip">+${iconText('2 points')}</span></h3><ul>${titles}</ul></div>`}
        ${offers ? `<div class="panel offers"><h3>Trade offers</h3><ul>${offers}</ul></div>` : ''}
      </aside>
      <footer class="ticker"><ul>${log}</ul><div class="talk"><h3>Table talk</h3><ul>${talk || '<li class="none">Nobody has said anything yet.</li>'}</ul></div></footer>
    </div>`;
  if (board3d) {
    $('mapwrap').append(board3d.el);
    board3d.update(g, highlight);
  }
  // The ticker shows the newest lines at the bottom; an older one that only
  // partly fits at the top is dropped rather than shown sliced in half.
  for (const ul of app.querySelectorAll<HTMLElement>('.ticker ul')) {
    const top = ul.getBoundingClientRect().top;
    while (ul.children.length > 1 && ul.firstElementChild!.getBoundingClientRect().top < top - 1) ul.firstElementChild!.remove();
  }
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
      <small>${glyph('attack', 'attack')}${esc(u.attack)}${u.weak.length ? ` <span class="weak">×2 ${u.weak.map(elem).join('')}</span>` : ''}${u.strong.length ? ` <span class="strong">½ ${u.strong.map(elem).join('')}</span>` : ''}</small>
    </div>`).join('');
  return `<div class="target">${extra}<h2>${esc(t.name)}</h2>${units}<div class="loot">${resChips(t.loot, 1.4)}</div></div>`;
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
    body = `<h1>${icon('raid', 1.1)} Vote</h1>
      <div class="candidates">${raid.candidates.map((t, i) => targetCard(t, `<div class="num">${i + 1}</div>`)).join('')}</div>
      <div class="status">${names.map((_, p) => `${playerTag(p, names)} ${check(raid.voted[p])}`).join(' ')}</div>`;
  } else if (raid.step === 'commit') {
    // Each row says plainly where that player stands: what they've sent, that
    // they're keeping their dragons home, that none of theirs can go, or how
    // many could while they're still choosing.
    const commitRow = (p: number) => {
      const sent = raid.commits[p].map((id) => dragonChip(dragonById(id))).join('');
      const able = g.dragons.filter((d) => d.owner === p && d.canRaid).length;
      let what: string;
      if (sent) what = `${sent} ${raid.ready[p] ? '<span class="ok">ready</span>' : '<span class="wait">choosing…</span>'}`;
      else if (!able) what = '<span class="none">no dragon can go</span>';
      else if (raid.ready[p]) what = '<span class="none">stays home</span> <span class="ok">ready</span>';
      else what = `<span class="wait">choosing…</span> <span class="none">${able} dragon${able === 1 ? '' : 's'} can go</span>`;
      return `<li>${playerTag(p, names)} ${what}</li>`;
    };
    const rows = names.map((_, p) => commitRow(p)).join('');
    body = `<h1>${icon('raid', 1.1)} Who's going? <span class="tag">${icon('public', 1)}</span></h1>
      <div class="raidrow">${targetCard(raid.target!)}<ul class="commits">${rows}</ul></div>`;
  } else if (raid.step === 'bail') {
    const rows = names.flatMap((_, p) => (raid.commits[p].length ? [`<li>${playerTag(p, names)} ${raid.commits[p].map((id) => dragonChip(dragonById(id))).join('')} ${check(raid.decided[p])}</li>`] : [])).join('');
    body = `<h1>Fight or bail? <span class="tag">${icon('secret', 1)}</span></h1>
      <div class="raidrow">${targetCard(raid.target!)}<ul class="commits">${rows}</ul></div>`;
  }
  el.innerHTML = `<div class="raidbox">${body}</div>`;
}

// Short banners for things that just happened, shown one after another: the
// result of a raid, production dice at the start of a round. The raid screen
// and the final scores show whenever no banner is up.
interface Banner { html: string; ms: number; dice?: boolean; play?: (el: HTMLElement) => void }
const banners: Banner[] = [];
let bannerUp = false;

function queueBanners(g: PublicState, fresh: EventView[]) {
  for (const e of fresh) {
    const ev = e.ev;
    if (ev?.k === 'fight') banners.push(fightBanner(g, e, fresh));
    if (ev?.k === 'noRaid') banners.push({ html: `<div class="result"><h1>${eventHtml(e, g, names)}</h1></div>`, ms: 4000 });
    if (ev?.k === 'round') {
      const prod = fresh.filter((x) => x.i > e.i && x.round === e.round && x.ev?.k === 'produce');
      if (!prod.length) continue;
      const rows = prod.map((x) => {
        const pe = x.ev as Extract<typeof x.ev, { k: 'produce' }>;
        return `<li>${playerTag(pe.p, names)} <span class="dice">${(x.dice ?? []).map((d) => dieFace(d.sides, d.value, 'rolling')).join('')}</span> <span class="got">${gainChips(pe.got, 1.3)}</span></li>`;
      }).join('');
      banners.push({ html: `<div class="production"><h1>Round ${e.round}</h1><ul>${rows}</ul></div>`, ms: 4500, dice: true });
    }
  }
}

// The whole fight at once (there is no retreat), replayed blow by blow: the
// dragons on one side, the defenders on the other, health bars falling as the
// hits land, then who won and what they took.
const HIT_MS = 300;
function fightBanner(g: PublicState, e: EventView, fresh: EventView[]): Banner {
  const ev = e.ev as Extract<EventView['ev'], { k: 'fight' }>;
  const later = fresh.filter((x) => x.i > e.i);
  const endAt = later.findIndex((x) => x.ev?.k === 'raidEnd');
  const rounds = (endAt < 0 ? later : later.slice(0, endAt)).flatMap((x) => (x.ev?.k === 'combat' ? [x.ev] : []));
  const end = endAt < 0 ? null : (later[endAt].ev as Extract<EventView['ev'], { k: 'raidEnd' }>);
  const dragons = ev.ds.map((id) => g.dragons.find((d) => d.id === id)!).filter(Boolean);
  const side = dragons.map((d) => `<div class="fighter" data-d="${d.id}" style="--pc:${PLAYER_COLORS[d.owner]}">${dragonBadge(d, 56)}<b>${esc(d.name)}</b>${hpBar(d.maxHp, d.maxHp)}</div>`).join('');
  const foes = ev.units.map((u, i) => `<div class="fighter unit" data-u="${i}"><b>${esc(u.name)}</b>${hpBar(u.hp, u.hp)}</div>`).join('');
  const outcome = !end ? '' : end.won
    ? `<h1>${esc(end.name)} <span class="ok">falls!</span></h1><div class="spoils">${end.winners.map((p) => `<span>${playerTag(p, names)} ${gainChips(end.share, 1.6)}</span>`).join('')}</div>`
    : `<h1>${esc(end.name)} <span class="no">holds</span></h1>`;
  const html = `<div class="result fight">
      <h2>${ev.ps.map((p) => playerTag(p, names)).join(' ')} ${icon('raid', 1.2)} ${esc(ev.name)}</h2>
      <div class="battle"><div class="bside">${side}</div><div class="bvs"><small>round</small><b class="cround"></b></div><div class="bside foes">${foes}</div></div>
      <div class="outcome">${outcome}</div></div>`;
  const hits = rounds.flatMap((r) => r.hits.map((h) => ({ ...h, round: r.round })));
  const step = Math.min(HIT_MS, 5000 / Math.max(1, hits.length));
  const play = (el: HTMLElement) => {
    const hp = new Map<string, [number, number]>();
    dragons.forEach((d) => hp.set(`d${d.id}`, [d.maxHp, d.maxHp]));
    ev.units.forEach((u, i) => hp.set(`u${i}`, [u.hp, u.hp]));
    const box = (key: string) => el.querySelector<HTMLElement>(key[0] === 'u' ? `[data-u="${key.slice(1)}"]` : `[data-d="${key.slice(1)}"]`);
    hits.forEach((h, n) => setTimeout(() => {
      el.querySelector('.cround')!.textContent = String(h.round);
      const [from, to] = h.by === 'dragon' ? [`d${h.d}`, `u${h.u}`] : [`u${h.u}`, `d${h.d}`];
      const [cur, max] = hp.get(to)!;
      const now = h.down ? 0 : Math.max(0, cur - h.dmg);
      hp.set(to, [now, max]);
      const a = box(from), t = box(to);
      a?.classList.remove('strike'); void a?.offsetWidth; a?.classList.add('strike');
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
    setTimeout(() => el.querySelector('.outcome')!.classList.add('show'), 800 + hits.length * step + 400);
  };
  return { html, ms: 800 + hits.length * step + 4500, play };
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

function showBanner(b: Banner) {
  const el = $('overlay');
  bannerUp = true;
  el.className = 'overlay banner';
  el.innerHTML = b.html;
  b.play?.(el);
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
