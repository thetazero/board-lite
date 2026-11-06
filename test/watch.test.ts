// The clients' live stream of a room (web/common.ts, watch): a stream that goes
// quiet without an error, as one can after a server restart or a network
// change, is opened again, so a vote or a turn shows up without a reload (#329).
// The browser's EventSource, document and clock are stand-ins here.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

class FakeSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static made: FakeSource[] = [];
  readyState = FakeSource.CONNECTING;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Record<string, (() => void)[]> = {};
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSource.made.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.readyState = FakeSource.CLOSED;
  }
  // What the server sends.
  snapshot(v: unknown) {
    this.readyState = FakeSource.OPEN;
    this.onmessage?.({ data: JSON.stringify(v) });
  }
  ping() {
    for (const fn of this.listeners.ping ?? []) fn();
  }
}

test('a stream that goes quiet is opened again; one that pings stays', async () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const g = globalThis as Record<string, unknown>;
  Object.assign(g, {
    EventSource: FakeSource,
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    addEventListener() {},
    removeEventListener() {},
  });
  try {
    const { watch } = await import('../web/common.ts');
    const got: unknown[] = [];
    const status: boolean[] = [];
    const stop = watch('ABCD', 'tok', (s) => got.push(s), (ok) => status.push(ok));
    assert.equal(FakeSource.made.length, 1);
    const first = FakeSource.made[0];
    assert.match(first.url, /\/api\/rooms\/ABCD\/events\?token=tok/);
    first.snapshot({ n: 1 });

    // Pinged every 15 s, it's alive: no new stream, however long it lasts.
    for (let i = 0; i < 8; i++) {
      mock.timers.tick(15000);
      first.ping();
    }
    assert.equal(FakeSource.made.length, 1, 'a pinging stream is kept');

    // Then nothing at all, and no error: dead. It's opened again, and the
    // phone says it's reconnecting until the new one sends the game.
    mock.timers.tick(45000);
    assert.equal(FakeSource.made.length, 2, 'a quiet stream is opened again');
    assert.equal(first.readyState, FakeSource.CLOSED);
    assert.equal(status.at(-1), false);
    FakeSource.made[1].snapshot({ n: 2 });
    assert.deepEqual(got, [{ n: 1 }, { n: 2 }]);
    assert.equal(status.at(-1), true);

    // A new stream that never connects (the request hangs) is tried again too.
    mock.timers.tick(45000);
    FakeSource.made[2].readyState = FakeSource.CONNECTING;
    mock.timers.tick(45000);
    assert.equal(FakeSource.made.length, 4, 'a stream stuck connecting is tried again');

    stop();
    mock.timers.tick(120000);
    assert.equal(FakeSource.made.length, 4, 'nothing once stopped');
  } finally {
    mock.timers.reset();
    for (const k of ['EventSource', 'document', 'addEventListener', 'removeEventListener']) delete g[k];
  }
});
