// The TV: the shared board. Shows everything public, never anyone's hand.
// Lobby -> board, with overlays for production dice, the raid and the end.

import type { DragonView, EventView, PublicState, Snapshot, TargetView } from '../src/state.ts';
import {
  PLAYER_COLORS, RESOURCES, STAGE_LABEL, TERRAIN_COLORS, TERRAIN_NAMES, buildingIcon, dieFace, dragonBadge, elemIcon, esc, hpBar,
  icon, iconText, mapSvg, named, playerTag, post, resChips, resIcon, watch,
} from './common.ts';

const $ = (id: string) => document.getElementById(id)!;
const app = $('app');

let code = '';
let hostToken = '';
let snap: Snapshot | null = null;
let names: string[] = [];
let lan: { lan: string[]; tailscale: string[]; port: number } = { lan: [], tailscale: [], port: Number(location.port) || 80 };
let seenLog = -1; // highest log index already animated

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

function phaseLabel(g: PublicState): string {
  if (g.phase === 'over') return 'Game over';
  if (g.phase === 'action') return `${playerTag(g.turn, names)}'s turn`;
  if (g.phase === 'discard') return 'End of round: discarding';
  return `Raid${g.raidsLeft > 1 ? ` (${g.raidsLeft} this round)` : ''}`;
}

function dragonChip(d: DragonView, compact = false): string {
  const status = d.status === 'ready' || d.status === 'egg' ? '' : `<em class="st-${d.status}">${d.status}</em>`;
  if (compact) return `<div class="dchip compact" title="${esc(d.name)}">${dragonBadge(d, 30)}<div><span>${STAGE_LABEL[d.stage]}</span>${d.stage ? hpBar(d.hp, d.maxHp) : ''}${status}</div></div>`;
  const hp = d.stage ? hpBar(d.hp, d.maxHp) : '';
  const grow = d.stage < 3 ? `<span class="grow">${'●'.repeat(d.growth)}${'○'.repeat(Math.max(0, d.growthTime - d.growth))}</span>` : '';
  return `<div class="dchip" title="${esc(d.name)}">${dragonBadge(d, 34)}<div><b>${esc(d.name)}</b><span>${STAGE_LABEL[d.stage]} ${grow}</span>${hp}${status}</div></div>`;
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
          <span class="pname">${esc(names[i])}${seat && !seat.connected ? ' <small>(away)</small>' : ''}</span>
          ${waiting.has(i) && g.phase !== 'over' ? '<span class="thinking">deciding…</span>' : ''}
          <span class="pts">${icon('points', 1.5)}<b>${p.publicPoints}</b><small>/${g.pointsToWin}</small></span>
        </div>
        <div class="prow"><span class="chip cards" title="cards in hand">${icon('cards', 1.25)}${p.handSize}</span>${prodChips(p.production)}</div>
        ${titles ? `<div class="prow">${titles}</div>` : ''}
        <div class="dragons">${dragons}</div>
      </div>`;
  }).join('');
  const offers = g.offers.map((o) => `<li>${playerTag(o.from, names)} → ${playerTag(o.to, names)}: gives <b>${iconText(esc(o.give))}</b> for <b>${iconText(esc(o.get))}</b></li>`).join('');
  const titles = g.titles.map((t) => `<li><b>${esc(t.name)}</b>: ${t.holder === null ? 'nobody' : playerTag(t.holder, names)} <small>(${t.values.join(' / ')})</small></li>`).join('');
  const log = g.log.slice(-7).map((e) => `<li>${named(e.text, names, g.dragons)}</li>`).join('');
  const talk = g.talk.slice(-6).map((e) => `<li>${talkLine(e.text, g)}</li>`).join('');
  const legend = Object.keys(TERRAIN_COLORS).map((t) => `<span><i style="background:${TERRAIN_COLORS[t]}"></i>${TERRAIN_NAMES[t]}</span>`).join('');
  const bLegend = (['tower', 'quarry', 'lumber_camp', 'crystal_mine', 'pasture', 'roost', 'hatchery', 'market', 'caravan_post', 'monument'] as const)
    .map((b) => `<span>${buildingIcon(b, 18, '#ddd')}${b.replace('_', ' ')}</span>`).join('');
  app.innerHTML = `
    <div class="board">
      <header class="topbar">
        <span class="round">Round ${g.round}</span>
        <span class="phase">${phaseLabel(g)}</span>
        <span class="roomcode">Join: <b>${esc(joinUrl())}</b>${tailscaleUrl() ? ` <small>· Tailscale <b>${esc(tailscaleUrl()!)}</b></small>` : ''}</span>
      </header>
      <section class="mapwrap">${mapSvg(g.map, { size: 40, highlight: g.phase === 'action' ? g.turn : null })}
        <div class="legend">${legend}</div><div class="legend">${bLegend}</div>
      </section>
      <aside class="side">
        ${players}
        ${many ? '' : `<div class="panel"><h3>Titles <small>(${iconText('2 points')} each)</small></h3><ul>${titles}</ul></div>`}
        ${offers ? `<div class="panel offers"><h3>Trade offers</h3><ul>${offers}</ul></div>` : ''}
      </aside>
      <footer class="ticker"><ul>${log}</ul><div class="talk"><h3>Table talk</h3><ul>${talk || '<li class="none">Nobody has said anything yet.</li>'}</ul></div></footer>
    </div>`;
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
  return done ? '<span class="ok">✔</span>' : '<span class="wait">…</span>';
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
    const rows = names.map((_, p) => `<li>${playerTag(p, names)} ${raid.commits[p].map((id) => dragonChip(dragonById(id))).join('') || '<span class="none">nothing</span>'} ${raid.ready[p] ? '<span class="ok">ready</span>' : '<span class="wait">choosing…</span>'}</li>`).join('');
    body = `<h1>Commit your dragons</h1><p class="sub">Commitments are public. They lock when everyone is ready.</p>
      <div class="raidrow">${targetCard(raid.target!)}<ul class="commits">${rows}</ul></div>`;
  } else if (raid.step === 'bail') {
    const rows = names.flatMap((_, p) => (raid.commits[p].length ? [`<li>${playerTag(p, names)} ${raid.commits[p].map((id) => dragonChip(dragonById(id))).join('')} ${check(raid.decided[p])}</li>`] : [])).join('');
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
