// The table talk a phone has heard, so its talk bar can count what's unread
// (phone.ts). One game's: a phone going to another game starts it afresh. No DOM
// here, so the tests can read it.

export interface TalkLine { i: number; text: string }

export class Heard {
  private last: number | null = null; // the last line heard; null until the talk is first shown

  // How many of the talk's lines are unread: what others said since it was last
  // open. What was said before this phone first showed it counts as heard.
  unread(lines: TalkLine[], seat: number, open: boolean): number {
    if (open || this.last === null) this.last = lines.at(-1)?.i ?? -1;
    return lines.filter((e) => e.i > this.last! && !said(e.text, seat)).length;
  }

  forget() {
    this.last = null;
  }
}

// Whether this line is the seat's own.
export const said = (text: string, seat: number): boolean => text.startsWith(`P${seat + 1} `);
