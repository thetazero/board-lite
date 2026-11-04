// Odd commands from a table of CLI seats (the same room API the phones use).
const BASE = process.env.BASE, CODE = process.env.CODE;
const post = async (a, b) => { const r = await fetch(`${BASE}/api/rooms/${CODE}/${a}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return [r.status, await r.json().catch(() => null)]; };
const view = async (t) => (await fetch(`${BASE}/api/rooms/${CODE}/view?token=${t}`)).text();
const toks = [];
for (const n of ['Ada', 'Bram', 'Cleo']) toks.push((await post('join', { name: n }))[1].token);
const v0 = await Promise.all(toks.map(view));
const acting = v0.findIndex((v) => /Your options[\s\S]*\bend\b/.test(v) && /your turn/i.test(v));
console.log('acting seat', acting);
const A = toks[acting], B = toks[(acting + 1) % 3];
const hand = (v) => [...v.matchAll(/\b(c\d+)\b/g)].map((m) => m[1]);
const va = await view(A);
console.log(va.split('\n').filter((l) => /resources|Hand|hand|Your options/i.test(l)).slice(0, 8).join('\n'));
const cards = [...new Set(hand(va.split(/hand/i)[1] ?? ''))];
console.log('A cards', cards.slice(0, 6));
const tries = [
  [A, `offer P${acting + 1} give 1 stone get 1 timber`], // to self
  [A, `offer P${(acting + 1) % 3 + 1} give 0 stone get 0 gold`],
  [A, `offer P${(acting + 1) % 3 + 1} give -2 stone get 1 gold`],
  [A, `offer P${(acting + 1) % 3 + 1} give 999 stone get 1 gold`],
  [A, `offer P${(acting + 1) % 3 + 1} give 1 stone get 999 gold`],
  [A, `offer P9 give 1 stone get 1 gold`],
  [A, `bank stone gold 0`],
  [A, `bank stone gold -1`],
  [A, `bank stone stone 1`],
  [A, `bank stone gold 1.5`],
  [A, `build quarry 99,99`],
  [A, `say ${'x'.repeat(5000)}`],
  [A, `say <img src=x onerror=alert(1)>`],
  [A, `tell P${acting + 1} hello me`],
  [B, `say hi from B`],
  [B, `end`],
  [B, `offer P${(acting + 2) % 3 + 1} give 1 stone get 1 gold`], // out of turn, not to the acting player
];
for (const [t, c] of tries) { const [s, b] = await post('do', { token: t, command: c }); console.log(s, c.slice(0, 60), '->', (b?.error ?? b?.text ?? '').toString().replace(/\s+/g, ' ').slice(0, 160)); }
// offer a card, then play/discard it before it's accepted
if (cards[0]) {
  const [s1, b1] = await post('do', { token: A, command: `offer P${(acting + 1) % 3 + 1} give ${cards[0]} get 1 stone` });
  console.log('offer card', s1, (b1?.error ?? b1?.text ?? '').replace(/\s+/g, ' ').slice(0, 200));
}
console.log((await view(B)).split('\n').filter((l) => /offer|o\d+/i.test(l)).join('\n'));
