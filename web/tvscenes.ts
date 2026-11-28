// Which scenes the TV plays, and which is up (tv.ts draws them). No DOM here, so the tests can run it.
//
// A scene is played as it happens or not at all: a TV that lost its connection,
// was reloaded, or whose game was saved shows the game as it is now.

import { scenesOf, type SceneEvent } from './scenes.ts';

type Entry = SceneEvent & { i: number };
// What a snapshot means for the scenes: the events to play (none if they were missed), and whether the one up is over with.
export interface Fresh<E> { play: E[]; missed: boolean }

export class TvScenes<B> {
  seen = -1; // the highest log index already played or skipped
  up = false;
  private queue: B[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];

  // `back`: the snapshot is the first since the TV lost its connection, not the first it ever had.
  take<E extends Entry>(log: E[], back: boolean): Fresh<E> {
    const fresh = log.filter((e) => e.i > this.seen);
    if (fresh.length || back) this.skip(log);
    const missed = back && scenesOf(fresh).length > 0;
    return { play: missed ? [] : fresh, missed };
  }

  // What has happened so far isn't played.
  skip(log: { i: number }[]) {
    this.seen = log.at(-1)?.i ?? -1;
  }

  add(b: B) {
    this.queue.push(b);
  }

  next(): B | undefined {
    return this.queue.shift();
  }

  get waiting(): boolean {
    return this.queue.length > 0;
  }

  // A scene goes up; what's to happen while it's up, after so many ms, unless it ends first.
  start(...then: [ms: number, run: () => void][]) {
    this.end();
    this.up = true;
    this.timers = then.map(([ms, run]) => setTimeout(run, ms));
  }

  // The one up is over.
  end() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.up = false;
  }

  // The one up and those waiting are over.
  drop() {
    this.queue = [];
    this.end();
  }
}
