// Which of the phone's two views shows (#455): You, the phone's own screen, or
// Table, the TV's page in a frame (phone.ts). Worked out from two things only:
// the server's snapshots and the player's taps. The frame has no say: it shows
// what it shows, and the phone never waits on it to say a scene is over.
//
// The rules:
// - While the server holds the table for a scene (a snapshot's `scene`, the ms
//   it has left), the phone shows the table, if it has one: always with no TV,
//   and with a TV once the player has opened the table. With no TV, You is off
//   then: there's nothing to do there.
// - The scene ends when a snapshot says so, or when its time is up on the
//   phone's own clock, whichever comes first, so a snapshot that never comes
//   can't keep the phone on the table.
// - Otherwise the player's choice shows: You or Table, as last tapped. A tap on
//   You during a scene goes back to You (with a TV; with none, You is off).
// - A decision that opens for the player (a vote, their turn, a card to keep)
//   always lands on You, whatever was showing.
// - With no TV, a game that ends while the phone watches goes to the table,
//   which plays the game's summary and ends on the final scores.
// - With a TV, a game that ends is the TV's to tell first (#557): the phone shows
//   You, waiting, with Table off, until a snapshot says the TV has shown the
//   final scores, or the wait's time is up on the phone's own clock.

export type View = 'you' | 'table';

export interface ViewSnapshot {
  remote: boolean; // the table has no TV
  scene: number; // ms the server still holds the table for a scene; 0 for none
  ending?: number; // ms the phone still waits, at most, for the TV to show who won; 0 for none
  ask: string; // the decision open for this player, as a key ('' for none): a new key is a new decision
  over: boolean; // the game is over
}

export class PhoneView {
  private choice: View = 'you';
  private sceneEnds = 0; // on this phone's clock (ms); 0: no scene
  private endingEnds = 0; // as sceneEnds, for the TV's summary
  private dismissed = false; // the player went back to You during this scene (with a TV)
  private remote = false;
  private framed = false; // the table is loaded on this phone
  private ask = '';
  private over: boolean | null = null; // null before the first snapshot

  // A snapshot, received at `now` (ms, this phone's clock). `framed`: the
  // phone has the table loaded.
  snapshot(now: number, s: ViewSnapshot, framed: boolean) {
    this.remote = s.remote;
    this.framed = framed;
    const was = this.scene(now);
    this.sceneEnds = s.scene > 0 ? now + s.scene : 0;
    this.endingEnds = s.ending ? now + s.ending : 0;
    if (!was && this.scene(now)) this.dismissed = false;
    if (s.ask && s.ask !== this.ask) this.choice = 'you';
    this.ask = s.ask;
    // While the TV tells it, the end hasn't come yet for the phone: if the TV goes, it comes then.
    const over = s.over && !this.ending(now);
    if (this.over === false && over && s.remote) this.choice = 'table';
    this.over = over;
  }

  // The player taps You or Table.
  tap(now: number, v: View) {
    if (v === 'you' ? this.youOff(now) : this.tableOff(now)) return;
    this.choice = v;
    this.dismissed = v === 'you' && this.scene(now);
  }

  // The table view is loaded or gone (a TV came or went).
  frame(framed: boolean) {
    this.framed = framed;
  }

  // The server holds the table for a scene: the phone's own screen waits.
  scene(now: number): boolean {
    return now < this.sceneEnds;
  }

  // The TV plays the game's summary: the phone doesn't give the winner away.
  ending(now: number): boolean {
    return now < this.endingEnds;
  }

  // When the scene or the wait for the TV next ends on this phone's clock (0: neither is on): the phone looks again then.
  nextEnd(now: number): number {
    const ends = [this.sceneEnds, this.endingEnds].filter((t) => t > now);
    return ends.length ? Math.min(...ends) : 0;
  }

  youOff(now: number): boolean {
    return this.remote && this.scene(now);
  }

  tableOff(now: number): boolean {
    return this.ending(now) && !this.scene(now);
  }

  view(now: number): View {
    if (this.scene(now) && (this.remote || this.framed) && !this.dismissed) return 'table';
    if (this.ending(now)) return 'you';
    return this.choice;
  }
}

// The decision open for a player, as a key: it changes when a new one opens.
// '' when they have nothing to decide.
export function askKey(g: { phase: string; round: number; turn: number; raid?: { step?: string } | null } | null | undefined, deciding: boolean | undefined): string {
  return g && deciding ? `${g.round}|${g.phase}|${g.turn}|${g.raid?.step ?? ''}` : '';
}
