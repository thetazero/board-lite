// Taps on the phone, over a slow or flaky connection (#456).
//
// A tap that goes to the server is answered a while later, and until the phone
// shows the table as it is after it, the screen still offers the same button.
// A second tap on it in that time is a finger bouncing, or a player who thinks
// the first didn't land: it's dropped. So a button does what one tap does,
// however often it's tapped and however slow the Wi-Fi, and nothing is tapped
// on a screen that's out of date. Taps on different buttons all count, and
// their commands go to the server one at a time, in the order tapped (#131).
//
// Each sending of a command carries an id. When the server's answer is lost
// (it timed out, the Wi-Fi dropped), the command may have been carried out or
// not: sent again, it goes under the same id, and the server does it at most
// once. So a message retried after "try again" isn't said twice.
//
// No DOM here, so the tests can tap with a slow server of their own.

export type Taps = {
  // A button tapped: `key` names it (the same button, the same key), `fn` does
  // what it does. Ignored while that button's last tap is still being carried out.
  tap(key: string, fn: () => unknown): void;
  // A game command, queued behind the ones before it. A command that repeats
  // the last one still waiting is the same tap again, and sent once. Resolves
  // true once it's done, false if it was refused or got no answer.
  send(command: string): Promise<boolean>;
  // Any other request to the server a tap makes (join, add a bot, quit): the
  // button waits for its answer, and for the table to show it, too.
  call<T>(request: Promise<T>): Promise<T>;
  // A new snapshot is on screen.
  seen(): void;
};

type Outcome = 'shown' | 'sent' | 'failed'; // on screen now; done, but the screen hasn't caught up yet; refused

export function taps(opts: {
  post: (command: string, id: string) => Promise<unknown>; // one command to the server, resolving with its reply
  answer: (reply: unknown) => boolean; // shows the reply's snapshot: true if it was newer than the one on screen
  fail: (e: unknown) => void; // says what went wrong
  waitMs?: number; // the longest a button waits for the screen to catch up, once the server has answered
}): Taps {
  const waitMs = opts.waitMs ?? 4000;
  const busy = new Set<string>();
  const outbox: { command: string; id: string; done: Promise<Outcome>; settle: (o: Outcome) => void }[] = [];
  let lost: { command: string; id: string } | null = null; // the last command whose answer never came
  let sending = false;
  let work: Promise<Outcome>[] | null = null; // what the tap being run asked of the server
  let shown = 0; // snapshots shown so far
  let waiting: (() => void)[] = [];

  function tap(key: string, fn: () => unknown) {
    if (busy.has(key)) return;
    busy.add(key);
    const asked: Promise<Outcome>[] = (work = []);
    let ran: unknown;
    try {
      ran = fn();
    } catch (e) {
      ran = Promise.reject(e);
    } finally {
      work = null;
    }
    void (async () => {
      try {
        await ran;
        const outcomes = await Promise.all(asked);
        // Answered, but the screen still shows the table from before: the button
        // stays put until the next snapshot (or a while, if none comes).
        if (outcomes.includes('sent')) await nextSnapshot();
      } catch (e) {
        opts.fail(e);
      } finally {
        busy.delete(key);
      }
    })();
  }

  function send(command: string): Promise<boolean> {
    let done = outbox.at(-1)?.command === command ? outbox.at(-1)!.done : null;
    if (!done) {
      let settle!: (o: Outcome) => void;
      done = new Promise<Outcome>((r) => (settle = r));
      const id = lost?.command === command ? lost.id : newId();
      lost = null;
      outbox.push({ command, id, done, settle });
      if (!sending) void flush();
    }
    work?.push(done);
    return done.then((o) => o !== 'failed');
  }

  async function flush() {
    sending = true;
    while (outbox.length) {
      const o = outbox[0];
      const before = shown;
      try {
        const reply = await opts.post(o.command, o.id);
        outbox.shift();
        o.settle(opts.answer(reply) || shown > before ? 'shown' : 'sent');
      } catch (e) {
        if ((e as { unanswered?: boolean }).unanswered) lost = { command: o.command, id: o.id };
        // What was tapped after it was tapped expecting it to work: drop it too.
        for (const x of outbox.splice(0)) x.settle('failed');
        opts.fail(e);
      }
    }
    sending = false;
  }

  function call<T>(request: Promise<T>): Promise<T> {
    const before = shown;
    work?.push(request.then((): Outcome => (shown > before ? 'shown' : 'sent'), (): Outcome => 'failed'));
    return request;
  }

  function nextSnapshot(): Promise<void> {
    return new Promise((done) => {
      const t = setTimeout(done, waitMs);
      waiting.push(() => {
        clearTimeout(t);
        done();
      });
    });
  }

  function seen() {
    shown++;
    const w = waiting;
    waiting = [];
    for (const fn of w) fn();
  }

  return { tap, send, call, seen };
}

// Unique enough for one phone's commands. (crypto.randomUUID needs https,
// and a table on Wi-Fi is usually plain http.)
function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
