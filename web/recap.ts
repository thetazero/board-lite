// A finished game's recap page, at /recap/<id>: the TV's QR code at the end of
// a game leads here. Everything on it comes from one file, the recap
// (src/recap.ts), fetched from /api/recaps/<id>, so the page works wherever
// that file is served from: this server today, a website later.

import type { Recap } from '../src/state.ts';
import { PLAYER_COLORS, esc, playerTag } from './common.ts';
import { ART_DEFS, winnerScene } from './art.ts';
import { breakdownHtml, momentsHtml, raceSvg } from './recap-view.ts';

const app = document.getElementById('app')!;
document.body.insertAdjacentHTML('afterbegin', ART_DEFS);

function page(r: Recap): string {
  const w = r.standings[0];
  const when = new Date(r.ended).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const tiebreak = w.tiebreak === 'gold' ? 'Wins the tie with the most gold' : w.tiebreak === 'turn order' ? 'Wins the tie by being earliest in turn order' : '';
  const moments = momentsHtml(r);
  return `<div class="sheet" style="--pc:${PLAYER_COLORS[w.p]}">
    ${winnerScene(PLAYER_COLORS[w.p], r.names.map((_, i) => PLAYER_COLORS[i]), 340, 100)}
    <header><h1>${playerTag(w.p, r.names)} wins!</h1>
      <p class="when">${esc(when)} · ${r.names.length} players · ${r.rounds} rounds</p>${tiebreak ? `<p class="when">${tiebreak}</p>` : ''}</header>
    <section><h2>Final scores</h2>${breakdownHtml(r)}</section>
    <section><h2>How the game went</h2>${raceSvg(r, { width: 600, height: 400 })}</section>
    ${moments ? `<section><h2>What happened</h2>${moments}</section>` : ''}
  </div>`;
}

async function boot() {
  const id = location.pathname.split('/').filter(Boolean)[1] ?? '';
  const r: Recap | null = await fetch(`/api/recaps/${encodeURIComponent(id)}`).then((res) => (res.ok ? res.json() : null)).catch(() => null);
  if (!r) {
    app.innerHTML = '<div class="sheet missing"><h1>No recap here</h1><p>This link is wrong, or the server that hosted the game no longer has it.</p></div>';
    return;
  }
  document.title = `${r.names[r.standings[0].p]} wins: board-lite recap`;
  app.innerHTML = page(r);
}

void boot();
