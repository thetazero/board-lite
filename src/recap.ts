// A finished game's recap: how it went, as data. The TV plays it at the end
// and the recap page (web/recap.ts) shows it to anyone with its link. It is
// built once, when the game ends, and holds everything the page needs (names
// and all), so it outlives the room and can be served from anywhere: the
// local server today, a website later, as the same file.

import type { Game } from './engine.ts';
import type { Recap } from './state.ts';
import { ask } from './wasm.ts';

export const buildRecap = (g: Game, names: string[], id: string, ended: Date): Recap => ask('recap', g, { names, id, ended: ended.getTime() }, true);
