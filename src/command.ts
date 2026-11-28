// What a player may ask of the game, as JSON: the only thing the engine is sent
// (rust/src/command.rs reads it, and refuses anything else).
import type { Resource } from './data.ts';

// One side of a trade: { stone: 2, cards: ['c12'] }.
export type Side = Partial<Record<Resource, number>> & { cards?: string[] };

export type Command =
  | { do: 'keep'; card: string }
  | { do: 'build'; card: string; hex?: string } // a tower floor needs no hex
  | { do: 'build_basic'; building: string; hex?: string }
  | { do: 'upgrade'; card: string; hex: string }
  | { do: 'play'; card: string; resource?: Resource; dragon?: string; hex?: string } // an action card, with what it's played on if it needs one, or a dragon card
  | { do: 'clear'; hex: string; dragons: string[] }
  | { do: 'auto_clear' }
  | { do: 'perch'; hex: string; dragons: string[] }
  | { do: 'recall'; dragons: string[] }
  | { do: 'project_egg'; element: string }
  | { do: 'project_upgrade'; upgrade: string; hex: string }
  | { do: 'merchants'; pay: Resource; gain: Resource; times?: number }
  | { do: 'end' }
  | { do: 'offer'; to: string; give?: Side; get?: Side } // to 'P2', or 'anyone'
  | { do: 'accept' | 'decline' | 'cancel'; offer: string }
  | { do: 'vote'; target: string } // a kingdom
  | { do: 'fight'; dragons?: string[] } // all of yours in the raid, if it names none
  | { do: 'hold' }
  | { do: 'discard'; cards: string[] }
  | { do: 'say'; message: string }
  | { do: 'tell'; to: string; message: string };
