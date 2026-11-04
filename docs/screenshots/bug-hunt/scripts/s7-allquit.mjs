const BASE = 'http://localhost:8931';
const post = async (u, b) => { const r = await fetch(BASE + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return [r.status, await r.json().catch(() => null)]; };
const [, room] = await post('/api/rooms', {});
const C = room.code;
const [, a] = await post(`/api/rooms/${C}/join`, { name: 'Ada' });
const [, b] = await post(`/api/rooms/${C}/join`, { name: 'Bram' });
console.log('start', await post(`/api/rooms/${C}/start`, { token: room.hostToken }));
console.log('quit a', await post(`/api/rooms/${C}/quit`, { token: a.token }));
console.log('quit b', await post(`/api/rooms/${C}/quit`, { token: b.token }));
console.log('quit a again', await post(`/api/rooms/${C}/quit`, { token: a.token }));
const t0 = Date.now();
let last = '';
while (Date.now() - t0 < 240000) {
  const s = await (await fetch(`${BASE}/api/rooms/${C}/status`)).text();
  const line = s.split('\n').slice(1, 2).join(' ');
  if (/over|wins/i.test(s)) { console.log('OVER after', (Date.now() - t0) / 1000, 's:', s.slice(0, 300)); break; }
  if (line !== last) { last = line; }
  await new Promise((r) => setTimeout(r, 5000));
}
console.log('last status', last);
console.log(C);
