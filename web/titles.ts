// What the TV says when a title changes hands (tv.ts). It compares who holds
// each title with what the table was last told, whenever no scene is on: a
// title that changes in a scene is told after it, as who ends up with it.

import type { PublicState } from '../src/state.ts';

type Titles = PublicState['titles'];
export interface TitleChange { key: Titles[number]['key']; name: string; from: number | null; to: number | null }

export const TITLE_TOAST_MS = 6000;
export const TITLE_READ_MS = 3000; // up this long, a toast a scene cuts off has been read

interface At { titles: Titles; log: { i: number }[] }

export class TitleNews {
  private told: Map<string, number | null> | null = null;
  private at = -1; // how far the log had come

  // The table sees the titles as they are: nothing to tell.
  skip(g: At) {
    this.told = new Map(g.titles.map((t) => [t.key, t.holder]));
    this.at = g.log.at(-1)?.i ?? -1;
  }

  // What to tell the table now. Nothing the first time (the TV just opened), nor when the game went back a move.
  next(g: At): TitleChange[] {
    const told = this.told;
    if (!told || (g.log.at(-1)?.i ?? -1) < this.at) {
      this.skip(g);
      return [];
    }
    const out = g.titles.flatMap((t) => {
      const from = told.get(t.key) ?? null;
      return from === t.holder ? [] : [{ key: t.key, name: t.name, from, to: t.holder }];
    });
    this.skip(g);
    return out;
  }

  // A scene cut these off (in the order they came) before they were read: told again after it, if still so.
  unread(changes: TitleChange[]) {
    for (const c of [...changes].reverse()) this.told?.set(c.key, c.from);
  }
}
