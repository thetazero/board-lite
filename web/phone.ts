// The phone: one player's hidden hand and their choices. Everything public
// is on the TV, so this stays small: resources, cards, and the decision at hand.

import type { CardView, PublicState, SeatState, Snapshot } from '../src/state.ts';
import {
  ELEMENT_COLORS, PLAYER_COLORS, RESOURCES, STAGE_LABEL, dragonBadge, esc, hpBar, mapSvg, named, playerTag, post, resChips, resIcon, watch,
} from './common.ts';

type Me = SeatState & { name: string };

const app = document.getElementById('app')!;
let code = '';
let token = '';
let snap: Snapshot | null = null;
let names: string[] = [];
let stop: (() => void) | null = null;

// UI state that lives only on this phone (not in the game).
let tab: 'hand' | 'more' | 'trade' = 'hand';
let picking: { title: string; hexes: string[]; command: (hex: string) => string } | null = null;
let openCard: string | null = null;
let selected = new Set<string>(); // discard picks, or dragons to flee with
let trade = fresh();
let bank = { give: 'stone', get: 'gold', times: 1 };
let busy = false;

function fresh() {
  return { to: -1, give: {} as Record<string, number>, get: {} as Record<string, number>, cards: new Set<string>() };
}

// ---------- joining ----------

async function boot() {
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
    return renderLobby();
  }
  if (!s.you) return leaveToJoin('You are not in this game.');
  // Reset per-decision UI when the situation changes under us.
  const key = (x: Snapshot | null) => `${x?.game?.phase}|${x?.game?.turn}|${x?.game?.raid?.step}|${x?.game?.raid?.combatRound}|${x?.game?.round}`;
  if (key(prev) !== key(s)) {
    picking = null;
    selected = new Set();
    openCard = null;
    if (s.game.phase !== 'action') trade = fresh();
  }
  if (navigator.vibrate && s.you.deciding && !prev?.you?.deciding) navigator.vibrate(120);
  render();
}

function seatIndex(): number {
  return snap!.seat;
}

function leaveToJoin(msg: string) {
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
      <ul class="seats">${l.seats.map((s, i) => `<li style="--pc:${PLAYER_COLORS[i]}"><span class="dot"></span>${esc(s.name)}${s.bot ? ' <small>(bot)</small>' : ''}</li>`).join('')}</ul>
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
  const res = RESOURCES.map((r) => `<div class="res"><span>${resIcon(r, 26)}</span><b>${me.resources[r]}</b><small>${r}</small></div>`).join('');
  const pts = me.hiddenPoints ? `${me.totalPoints} <small>(${me.hiddenPoints} secret)</small>` : `${me.totalPoints}`;
  return `
    <header class="me" style="--pc:${PLAYER_COLORS[me.seat]}">
      <span class="pname">${esc(me.name)}</span>
      <span class="pts">${pts} <small>/ ${g.pointsToWin} pts</small></span>
    </header>
    <div class="resbar">${res}</div>`;
}

function status(g: PublicState, me: Me): string {
  if (g.phase === 'over') return `<div class="status">Game over: ${playerTag(g.winner!, names)} wins.</div>`;
  if (me.deciding) {
    const what = g.phase === 'action' ? (me.myTurn ? 'Your turn!' : 'An offer for you') : g.phase === 'discard' ? 'Too many cards' : 'Raid: your choice';
    return `<div class="status you">${what}</div>`;
  }
  const w = g.waitingOn.map((p) => playerTag(p, names)).join(' ');
  if (g.phase === 'action') return `<div class="status">${playerTag(g.turn, names)}'s turn. ${g.offers.length ? '' : 'You can offer them a trade.'}</div>`;
  return `<div class="status">Waiting for ${w || 'the table'}…</div>`;
}

function render() {
  const g = snap!.game!;
  const me = snap!.you!;
  let body = '';
  if (picking) body = hexPicker(g);
  else if (g.phase === 'over') body = gameOver(g, me);
  else if (g.phase === 'discard') body = me.deciding ? discardView(me) : handList(me, false);
  else if (g.phase === 'raid') body = raidView(g, me);
  else body = actionView(g, me);
  const recent = me.log.slice(-2).map((e) => `<li>${named(e.text, names, g.dragons)}</li>`).join('');
  app.innerHTML = `${header(g, me)}${status(g, me)}<main class="pbody">${body}</main>${recent && !picking ? `<ul class="mylog">${recent}</ul>` : ''}`;
  wire(g, me);
}

// ---- action phase ----

function actionView(g: PublicState, me: Me): string {
  const incoming = g.offers.filter((o) => o.to === me.seat).map((o) => `
    <div class="offer in">${playerTag(o.from, names)} offers <b>${esc(o.give)}</b> for your <b>${esc(o.get)}</b>
      <div class="row"><button class="primary" data-accept="${o.id}">Accept</button><button data-decline="${o.id}">Decline</button></div></div>`).join('');
  const mine = g.offers.filter((o) => o.from === me.seat).map((o) => `
    <div class="offer out">You offer ${playerTag(o.to, names)} <b>${esc(o.give)}</b> for <b>${esc(o.get)}</b> <button class="small" data-cancel="${o.id}">Withdraw</button></div>`).join('');
  const tabs = `<nav class="tabs">
    <button data-tab="hand" class="${tab === 'hand' ? 'on' : ''}">Hand (${me.hand.length})</button>
    ${me.myTurn ? `<button data-tab="more" class="${tab === 'more' ? 'on' : ''}">Build &amp; bank</button>` : ''}
    <button data-tab="trade" class="${tab === 'trade' ? 'on' : ''}">Trade</button></nav>`;
  const t = !me.myTurn && tab === 'more' ? 'hand' : tab;
  const content = t === 'hand' ? handList(me, me.myTurn) : t === 'more' ? moreView(me) : tradeView(g, me);
  const end = me.myTurn ? '<button id="end" class="primary big endturn">End turn</button>' : '';
  return `${incoming}${mine}${tabs}${content}${end}`;
}

function cardHtml(c: CardView, playable: boolean): string {
  const open = openCard === c.id;
  const kindLabel = { building: 'Building', upgrade: 'Upgrade', action: 'Action', dragon: 'Dragon egg' }[c.kind];
  let actions = '';
  if (open && playable) {
    if (c.blocked) actions = `<p class="blocked">${esc(c.blocked)}</p>`;
    else if (!c.affordable) actions = `<p class="blocked">You can't afford it yet.</p>`;
    else if (c.needs === 'resource') actions = `<div class="row">${RESOURCES.filter((r) => r !== 'gold').map((r) => `<button data-play="${c.id} ${r}">${resIcon(r)} ${r}</button>`).join('')}</div>`;
    else if (c.needs === 'dragon') actions = `<div class="row">${c.dragons.map((id) => `<button data-play="${c.id} ${id}">${esc(dragonLabel(id))}</button>`).join('')}</div>`;
    else if (c.needs === 'hex') actions = `<button class="primary" data-pickhex="${c.id}">${c.kind === 'upgrade' ? 'Choose a building' : 'Choose where to build'}</button>`;
    else if (c.kind === 'building') actions = `<button class="primary" data-build="${c.id}">Build it</button>`;
    else actions = `<button class="primary" data-play="${c.id}">${c.kind === 'dragon' ? 'Hatch it' : 'Play it'}</button>`;
  }
  const dim = playable && (!c.affordable || c.blocked) ? ' dim' : '';
  return `<div class="card k-${c.kind}${open ? ' open' : ''}${dim}${selected.has(c.id) ? ' picked' : ''}" data-card="${c.id}">
    <div class="ctop"><b>${esc(c.name)}</b><span class="cost">${resChips(c.cost)}</span></div>
    <div class="ckind">${kindLabel}</div>
    ${open || !playable ? `<p class="ctext">${esc(c.text)}</p>` : ''}
    ${actions}</div>`;
}

function handList(me: Me, playable: boolean): string {
  if (!me.hand.length) return '<p class="hint">Your hand is empty. You draw 2 building cards and 1 action card each round.</p>';
  return `<div class="hand">${me.hand.map((c) => cardHtml(c, playable)).join('')}</div>${playable ? '' : '<p class="hint">You can play cards on your turn.</p>'}`;
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
  const eggs = egg.elements.map((e) => `<button class="elembtn" style="--ec:${ELEMENT_COLORS[e]}" data-egg="${e}" ${eggOk ? '' : 'disabled'}>${e}</button>`).join('');
  const opts = (sel: string) => RESOURCES.map((r) => `<option value="${r}" ${sel === r ? 'selected' : ''}>${r}</option>`).join('');
  return `
    <section class="panel"><h3>Special projects <small>(no card, double cost)</small></h3>${projects}
      <div class="proj${eggOk ? '' : ' dim'}"><b>Base dragon egg</b> ${resChips(egg.cost)}</div>
      <div class="row">${eggs}</div>${egg.room ? '' : '<p class="blocked">No room for another dragon: build a roost.</p>'}</section>
    <section class="panel"><h3>Bank <small>(${me.bankRate} for 1)</small></h3>
      <div class="bank">Give <b>${me.bankRate * bank.times}</b> <select id="bgive">${opts(bank.give)}</select>
        for <span class="stepper"><button data-btimes="-1">−</button><b>${bank.times}</b><button data-btimes="1">+</button></span>
        <select id="bget">${opts(bank.get)}</select></div>
      <button id="bankgo" ${me.resources[bank.give as 'stone'] >= me.bankRate * bank.times && bank.give !== bank.get ? '' : 'disabled'}>Trade with the bank</button></section>`;
}

function stepper(side: 'give' | 'get', r: string, n: number, max: number): string {
  return `<div class="tres">${resIcon(r, 22)}<span class="stepper"><button data-step="${side} ${r} -1" ${n <= 0 ? 'disabled' : ''}>−</button><b>${n}</b><button data-step="${side} ${r} 1" ${n >= max ? 'disabled' : ''}>+</button></span></div>`;
}

function tradeView(g: PublicState, me: Me): string {
  // On your turn you can offer anyone; otherwise only the player whose turn it is.
  const others = me.myTurn ? names.map((_, i) => i).filter((i) => i !== me.seat) : [g.turn];
  if (!others.includes(trade.to)) trade.to = others[0];
  const who = others.map((i) => `<button data-to="${i}" class="${trade.to === i ? 'on' : ''}" style="--pc:${PLAYER_COLORS[i]}">${esc(names[i])}</button>`).join('');
  const give = RESOURCES.map((r) => stepper('give', r, trade.give[r] ?? 0, me.resources[r])).join('');
  const get = RESOURCES.map((r) => stepper('get', r, trade.get[r] ?? 0, 99)).join('');
  const cards = me.hand.map((c) => `<button class="tcard${trade.cards.has(c.id) ? ' on' : ''}" data-tcard="${c.id}">${esc(c.name)}</button>`).join('');
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
  const myDragons = g.dragons.filter((d) => d.owner === me.seat);
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
    return `<h2>Fight or bail?</h2><p class="hint">Secret. Bailing costs nothing, but you get no loot.</p>
      <div class="row big2"><button id="fight" class="primary big">Fight</button><button id="bail" class="big">Bail</button></div>`;
  }
  const mine = raid.fighters.filter((id) => myDragons.some((d) => d.id === id));
  if (!mine.length) return `<p class="big-note">The battle is on the TV.</p>`;
  if (me.myFlee !== null) return `<p class="big-note">${me.myFlee.length ? `Fleeing with ${me.myFlee.length} dragon(s).` : 'Your dragons stay and fight.'} Waiting for the others…</p>`;
  const list = mine.map((id) => {
    const d = g.dragons.find((x) => x.id === id)!;
    return `<button class="dragon${selected.has(id) ? ' on' : ''}" data-flee="${id}">${dragonBadge(d, 40)}<span><b>${esc(d.name)}</b> ${selected.has(id) ? '<em>flee</em>' : '<em>stay</em>'}<br>${hpBar(d.hp, d.maxHp)} ${d.hp}/${d.maxHp} · speed ${d.speed}</span></button>`;
  }).join('');
  return `<h2>Stay or flee? <span id="clock" class="clock"></span></h2><p class="hint">Tap a dragon to flee with it. Fleeing rolls d6 + speed against the defenders' chase. Anyone who doesn't choose stays.</p>
    ${list}<div class="row big2"><button id="fleego" class="primary big">${selected.size ? `Flee with ${selected.size}` : 'Stay and fight'}</button>${selected.size === mine.length ? '' : '<button id="fleeall" class="big">Flee with all</button>'}</div>`;
}

// ---- discard / end ----

function discardView(me: Me): string {
  const n = me.hand.length - me.handCap;
  return `<h2>Discard ${n} card${n === 1 ? '' : 's'}</h2><p class="hint">The hand limit is ${me.handCap}. Tap cards to pick them.</p>
    <div class="hand">${me.hand.map((c) => cardHtml(c, false)).join('')}</div>
    <button id="discard" class="primary big" ${selected.size === n ? '' : 'disabled'}>Discard ${selected.size}/${n}</button>`;
}

function gameOver(g: PublicState, me: Me): string {
  const order = g.finalTotals!.map((t, p) => [t, p]).sort((a, b) => b[0] - a[0]);
  return `<h2>${g.winner === me.seat ? 'You win!' : `${esc(names[g.winner!])} wins.`}</h2>
    <ol class="final">${order.map(([t, p]) => `<li>${playerTag(p, names)} ${t} points</li>`).join('')}</ol>
    <button id="newgame" class="primary">Join another game</button>`;
}

// ---------- wiring ----------

function wire(g: PublicState, me: Me) {
  bind('[data-tab]', (el) => {
    tab = el.dataset.tab as typeof tab;
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
  on('cancelpick', () => {
    picking = null;
    render();
  });
  on('end', () => send('end'));
  bind('[data-accept]', (el) => send(`accept ${el.dataset.accept}`));
  bind('[data-decline]', (el) => send(`decline ${el.dataset.decline}`));
  bind('[data-cancel]', (el) => send(`cancel ${el.dataset.cancel}`));
  // bank
  const bg = document.getElementById('bgive') as HTMLSelectElement | null;
  const bt = document.getElementById('bget') as HTMLSelectElement | null;
  if (bg) bg.onchange = () => { bank.give = bg.value; render(); };
  if (bt) bt.onchange = () => { bank.get = bt.value; render(); };
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
    tab = 'hand';
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
  bind('[data-flee]', (el) => {
    const id = el.dataset.flee!;
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    render();
  });
  on('fleego', () => send(selected.size ? `flee ${[...selected].join(' ')}` : 'stay'));
  on('fleeall', () => send('flee all'));
  on('discard', () => send(`discard ${[...selected].join(' ')}`));
  on('newgame', () => leaveToJoin(''));
}

function tickClock() {
  const c = document.getElementById('clock');
  const dl = snap?.lobby.fleeDeadline;
  if (c) c.textContent = dl ? `${Math.max(0, Math.ceil((dl - Date.now()) / 1000))}s` : '';
}

function toast(e: unknown) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = e instanceof Error ? e.message : String(e);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

setInterval(tickClock, 250);
boot().catch(toast);
