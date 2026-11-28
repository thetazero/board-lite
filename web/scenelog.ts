// The TV tells the server when it starts and ends each scene, for the game log
// (docs/clients.md): how long a game's scenes really took. Nothing waits on
// it, and a TV that can't reach the server plays on. No DOM here, for the tests.
import { post } from './common.ts';

export class SceneLog {
  // A new id each time the page loads: a reload starts over, so what the old page left unfinished stays so.
  readonly page = Math.random().toString(36).slice(2, 10) || '0';
  private on: { code: string; i: number } | null = null;

  // i: the scene's entry in the game's log.
  start(code: string, i: number) {
    this.end(true);
    this.on = { code, i };
    this.say(code, { i });
  }

  // cut: it stopped before its end.
  end(cut = false) {
    if (!this.on) return;
    const { code, i } = this.on;
    this.on = null;
    this.say(code, { i, ends: true, cut });
  }

  private say(code: string, what: Record<string, unknown>) {
    post(`/api/rooms/${code}/scene`, { tv: this.page, ...what }).catch(() => {});
  }
}
