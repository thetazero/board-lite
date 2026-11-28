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
  const answered: string[] = [];
  const fetched = g.fetch;
  Object.assign(g, {
    fetch: async (url: string, o?: { body?: string }) => (answered.push(`${url} ${o?.body}`), new Response('{}')),
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
    assert.match(first.url, /\/api\/rooms\/ABCD\/events\?token=tok&answers/);
    first.snapshot({ n: 1 });

    // Pinged every 15 s, it's alive: no new stream, however long it lasts.
    for (let i = 0; i < 8; i++) {
      mock.timers.tick(15000);
      first.ping();
    }
    assert.equal(FakeSource.made.length, 1, 'a pinging stream is kept');
    assert.deepEqual(answered, Array(8).fill('/api/rooms/ABCD/here {"token":"tok"}'), 'every ping is answered (#520)');

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
    g.fetch = fetched;
    for (const k of ['EventSource', 'document', 'addEventListener', 'removeEventListener']) delete g[k];
  }
});

// A phone's page is greyed out and can't be tapped while it reconnects (#539).
test('a room gone from the server: the page stops reconnecting before it hears so', async () => {
  const g = globalThis as Record<string, unknown>;
  const fetched = g.fetch;
  Object.assign(g, {
    fetch: async () => new Response('{"error":"No room with code ABCD: check the code."}', { status: 400 }),
    EventSource: FakeSource,
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    addEventListener() {},
    removeEventListener() {},
  });
  try {
    const { watch } = await import('../web/common.ts');
    const heard: unknown[] = [];
    await new Promise<void>((gone) => {
      watch('ABCD', 'tok', () => {}, (ok) => heard.push(ok), () => (heard.push('gone'), gone()));
      FakeSource.made.at(-1)!.onerror!();
    });
    assert.deepEqual(heard, [false, true, 'gone']);
  } finally {
    g.fetch = fetched;
    for (const k of ['EventSource', 'document', 'addEventListener', 'removeEventListener']) delete g[k];
  }
});
