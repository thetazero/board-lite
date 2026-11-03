// A server with a game already under way, for trying the clients alone (and
// for screenshots): bots fast-forward every seat to the given round, then keep
// playing every seat but the first, which is yours on the printed phone link.
//
//   node src/server/demo.ts [--players 3] [--round 3] [--seed 7] [--port 8080] [--all-bots]

import { botMove } from '../bot.ts';
import { waitingOn } from '../engine.ts';
import { Room } from './room.ts';
import { lanAddresses, startServer } from './server.ts';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

const players = arg('players', 3);
const round = arg('round', 3);
const seed = arg('seed', 7);
const port = arg('port', 8080);
const allBots = process.argv.includes('--all-bots');

const { server, rooms } = startServer(port);
const room = new Room(Room.newCode((c) => rooms.has(c)));
rooms.set(room.code, room);
const names = ['Ada', 'Bram', 'Cora', 'Dax', 'Eve', 'Finn'];
for (let p = 0; p < players; p++) room.join(names[p]);
room.start(room.hostToken, seed);

// Fast-forward: random bot moves for every seat until the round is reached
// and it's the first player's turn in the action phase.
const g = room.game!;
const rng = { state: seed };
let steps = 0;
while (g.phase !== 'over' && !(g.round >= round && g.phase === 'action' && g.turn === 0 && !g.offers.length) && steps++ < 20000) {
  botMove(g, waitingOn(g)[0], rng);
}
room.seats.forEach((s, i) => (s.bot = allBots || i > 0));
room.changed();

server.on('listening', () => {
  const host = lanAddresses()[0] ?? 'localhost';
  console.log(`Demo game ${room.code}: round ${g.round}, ${g.phase} phase.`);
  console.log(`  TV:            http://${host}:${port}/tv?room=${room.code}`);
  console.log(`  ${names[0]}'s phone:  http://${host}:${port}/#code=${room.code}&token=${room.seats[0].token}`);
  console.log(allBots ? '  Every seat is a bot.' : `  Every other seat is a bot.`);
});
