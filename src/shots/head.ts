// The site's icons and link preview, all drawn from one fire dragon's head in
// the game's folded-paper look. `node src/shots/head.ts` writes web/favicon.svg
// (browser tabs), web/apple-touch-icon.png (a phone's home screen) and
// web/preview.png (what an app shows for a link). The PNGs need Chrome.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tone } from '../../web/art.ts';
import { ELEMENT_COLORS } from '../../web/common.ts';

type Pt = [number, number];
const FIRE = ELEMENT_COLORS.fire;
const path = (p: Pt[], fill: string) => `<path d="M${p.map((q) => q.join(' ')).join('L')}Z" fill="${fill}" stroke="${fill}" stroke-width=".4" stroke-linejoin="round"/>`;
const f = (p: Pt[], t: number, c = FIRE) => path(p, tone(c, t));

// The head, on a 64 x 64 box, facing right. `gape` opens the jaw, in degrees.
function head(gape = 0): string {
  return [
    f([[21, 20], [8, 2], [33, 15]], -0.5), // far horn
    f([[14, 27], [0, 11], [28, 16]], -0.32), // near horn
    f([[11, 31], [0, 29], [9, 42]], -0.4), // neck spine
    f([[49, 25], [58, 16], [59, 33]], -0.32), // nose spike
    f([[13, 26], [22, 42], [31, 50], [29, 63], [5, 63]], -0.22), // neck
    f([[13, 26], [14, 46], [5, 63], [6, 44]], 0.06), // the neck's back
    `<g transform="rotate(${gape} 25 43)">${f([[23, 42], [58, 43.5], [49, 52], [29, 53]], -0.42)}</g>`, // jaw
    f([[13, 26], [31, 37], [29, 50], [20, 46]], -0.08), // cheek
    f([[31, 37], [62, 35], [60, 42.5], [29, 43.5]], -0.14), // side of the snout
    f([[13, 26], [28, 16], [33, 25], [31, 37]], 0.14), // brow
    f([[28, 16], [53, 26], [62, 35], [31, 37], [33, 25]], 0.32), // top of the snout
    path([[31, 25], [42, 28.5], [34, 33.5]], '#1d1530'), // eye
  ].join('');
}

// Fire from the mouth, at the head's scale.
const fire = [
  f([[40, 47], [74, 27], [80, 35], [98, 27], [95, 38], [122, 45], [95, 51], [100, 62], [81, 57], [75, 65]], -0.04, '#ff7a2f'),
  f([[40, 47], [74, 27], [80, 35], [98, 27], [95, 38], [122, 45]], 0.16, '#ff7a2f'),
  f([[40, 47], [75, 36], [86, 40], [102, 45], [86, 50], [75, 57]], 0, '#ffb02f'),
  f([[40, 47], [75, 36], [86, 40], [102, 45]], 0.12, '#ffc53f'),
  f([[40, 47], [70, 42], [84, 45.5], [70, 51]], 0.45, '#ffd23f'),
].join('');

const svg = (w: number, h: number, box: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${box}">${body}</svg>`;
const NIGHT = '<defs><radialGradient id="n" cx=".5" cy=".4" r=".75"><stop stop-color="#2b2452"/><stop offset=".85" stop-color="#1d1934"/></radialGradient></defs>';
const icon = svg(180, 180, '-8 -8 80 80', `${NIGHT}<rect x="-8" y="-8" width="80" height="80" fill="url(#n)"/>${head()}`);
const preview = svg(1200, 630, '0 0 1200 630', `${NIGHT}<rect width="1200" height="630" fill="url(#n)"/>
  <g transform="translate(340 22) scale(6.6)">${fire}${head(24)}</g>
  <text x="600" y="572" text-anchor="middle" fill="#f5c542" font-family="P052, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif" font-weight="bold" font-size="112" letter-spacing="2">board-lite</text>`);

const web = fileURLToPath(new URL('../../web/', import.meta.url));
writeFileSync(join(web, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${head()}</svg>\n`);
const dir = mkdtempSync(join(homedir(), '.cache', 'board-lite-head-'));
try {
  for (const [name, art, w, h] of [['apple-touch-icon', icon, 180, 180], ['preview', preview, 1200, 630]] as const) {
    const page = join(dir, 'page.html');
    writeFileSync(page, `<!doctype html><style>body{margin:0}svg{display:block}</style>${art}`);
    execFileSync(process.env.CHROME ?? 'google-chrome', ['--headless=new', `--user-data-dir=${join(dir, 'profile')}`, '--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb',
      `--window-size=${w},${h + 200}`, `--screenshot=${join(dir, 'shot.png')}`, `file://${page}`], { stdio: 'ignore' });
    execFileSync('magick', [join(dir, 'shot.png'), '-crop', `${w}x${h}+0+0`, '+repage', '-strip', '-define', 'png:color-type=2', join(web, `${name}.png`)]);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
