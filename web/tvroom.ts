// Which room a TV page shows. No DOM here, so the tests can open a TV on a
// server that fails.
import { post } from './common.ts';

export type TvRoom = { code: string; hostToken: string; isHost: boolean };

// The room with `code`, or a new one if the address names none; null if the
// server says there's no such room. Only that answer means it: while the
// server fails, or is too busy, it asks again, so a reload gets back to its game.
export async function openRoom(code: string, hostToken: string, onStatus: (ok: boolean) => void, retryMs = 2000): Promise<TvRoom | null> {
  if (!code) {
    const r = await post('/api/rooms', {});
    return { code: String(r.code), hostToken: String(r.hostToken), isHost: true };
  }
  if (!/^\w+$/.test(code)) return null;
  for (;;) {
    const room = await find(code, hostToken).catch(() => undefined);
    onStatus(room !== undefined);
    if (room !== undefined) return room;
    await new Promise((r) => setTimeout(r, retryMs));
  }
}

async function find(code: string, hostToken: string): Promise<TvRoom | null> {
  const res = await fetch(`/api/rooms/${code}?token=${hostToken}`, { signal: AbortSignal.timeout(5000) });
  const room = await res.json();
  if (res.status === 400 && room?.error) return null;
  if (!res.ok || !room?.lobby) throw new Error('No answer.');
  if (room.host) return { code, hostToken, isHost: true };
  // No TV watching this room (one made from a phone, or this TV's token is
  // in another browser): this one becomes its TV, buttons and all.
  const r = await post(`/api/rooms/${code}/tv`, {});
  return r.hostToken ? { code, hostToken: String(r.hostToken), isHost: true } : { code, hostToken, isHost: false };
}
