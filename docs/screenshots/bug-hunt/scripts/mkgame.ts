// node mkgame.ts <players> <seed> <condition> <out.json>
import { newGame, score } from '../../../../src/engine.ts';
import { drive } from '../../../../src/shots/scenes.ts';
import { save } from '../../../../src/store.ts';

const [n, seed, cond, out] = process.argv.slice(2);
const conds: Record<string, (g: any) => boolean> = {
  // round 3+, action phase, first player's turn, and seat 0 has a hatched dragon
  action3: (g) => g.round >= 3 && g.phase === 'action' && g.dragons?.some?.((d: any) => d.owner === 0 && d.stage > 0),
  raid: (g) => g.phase === 'raid' && g.raid?.step === 'vote',
  raid2: (g) => g.phase === 'raid' && g.raid?.step === 'vote' && [0, 1, 2].some((p) => g.dragons.filter((d: any) => d.owner === p && d.stage > 0 && !d.damage && !d.resting).length >= 2),
  nearend: (g) => g.phase === 'action' && g.players.some((_: any, p: number) => score(g, p).total >= 18),
  late: (g) => g.round >= 8 && g.phase === 'action',
  discard: (g) => g.phase === 'discard',
};
for (let s = Number(seed); s < Number(seed) + 50; s++) {
  const g = newGame(Number(n), s);
  if (drive(g, { state: s }, conds[cond])) {
    save(out, g);
    console.log('seed', s, 'round', g.round, 'phase', g.phase, 'turn', (g as any).turn);
    process.exit(0);
  }
}
console.log('no seed worked');
