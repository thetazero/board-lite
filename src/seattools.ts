// What the tools a Claude player plays through say they do, shared by the
// sandboxed seat's server (src/playtest/seat-server.ts) and the web server's
// /mcp (rust/src/mcp.rs).

import type { Command } from './command.ts';

export const VIEW_HELP = 'See the game as your seat sees it: scores, your hidden resources and hand, the public board as a text map and as a picture, recent events, and your options when it is your decision.';
export const ACT_HELP = 'Make a game decision as your seat: "do" says which, and each takes only its own fields, e.g. {"do":"keep","card":"c12"}, {"do":"build","card":"c12","hex":"2,-1"}, {"do":"build_basic","building":"quarry","hex":"2,-1"}, {"do":"offer","to":"P2","give":{"stone":2},"get":{"gold":1}}, {"do":"offer","to":"anyone","give":{"crystal":1},"get":{"timber":1}}, {"do":"accept","offer":"o40"}, {"do":"clear","hex":"2,-1","dragons":["d3"]}, {"do":"end"}, {"do":"fight"}, {"do":"hold"}, {"do":"discard","cards":["c4"]}. Your options list them. Returns what happened and your next options.';

// A command's fields (src/command.ts), as the act tool's arguments.
const text = (description: string) => ({ type: 'string', description });
const list = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
const count = { type: 'integer', minimum: 0 };
const side = (description: string, cards: object) => ({
  type: 'object', description,
  properties: { stone: count, timber: count, crystal: count, livestock: count, gold: count, ...cards },
});
export const DO = [
  'keep', 'build', 'build_basic', 'upgrade', 'play', 'clear', 'auto_clear', 'perch', 'recall', 'project_egg', 'project_upgrade', 'merchants', 'end',
  'offer', 'accept', 'decline', 'cancel', 'vote', 'fight', 'hold', 'discard', 'say', 'tell',
] as const satisfies readonly Command['do'][];
export const ACT_FIELDS = {
  do: { type: 'string', enum: DO, description: 'The decision.' },
  card: text('keep, build, upgrade, play: a card, like "c12".'),
  cards: list('discard: the cards.'),
  hex: text('build, build_basic, upgrade, clear, perch, project_upgrade, and play with a fauna card: a hex, like "2,-1".'),
  building: text('build_basic: a basic building, like "quarry".'),
  resource: text('play: the resource to gain.'),
  dragon: text('play: the dragon it\'s played on, like "d3".'),
  dragons: list('clear, perch, recall, fight: the dragons, like ["d3"]. fight with none named is all of them.'),
  element: text('project_egg: an element.'),
  upgrade: text('project_upgrade: an upgrade, like "workshop".'),
  pay: text('merchants: the resource you pay.'),
  gain: text('merchants: the resource you gain.'),
  times: { type: 'integer', minimum: 1, description: 'merchants: how many to gain (1 if left out).' },
  to: text('offer: a player like "P2", or "anyone". tell: a player.'),
  give: side('offer: what you give, like {"stone":2,"cards":["c12"]}. The cards are shown to everyone.', { cards: { type: 'array', items: { type: 'string' } } }),
  get: side('offer: the resources you get.', {}),
  offer: text('accept, decline, cancel: an offer, like "o40".'),
  target: text('vote: a kingdom, as your options list them.'),
  message: text('say, tell: your words.'),
};
export const SAY_HELP = 'Talk to the table, any time. With "to" (like "P2"), only that player hears it. Promises bind no one; only accepted offers do.';
export const waitHelp = (secs: number) => `Wait (up to ${secs}s) until it is your decision, someone talks to you or the table, or the game ends. On your own turn with an offer out, it waits for an answer. Returns the new events, including talk, and your status.`;
export const RULES_HELP = 'The full rules of board-lite.';
