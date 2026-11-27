// Writes what the Rust server compiles in, from the same sources the Node one
// reads: the tables in src/data.ts, and the web pages with their TypeScript
// stripped of types. `node rust/gen/gen.ts` before `cargo build`.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from '../../src/data.ts';
import { ACT_HELP, RULES_HELP, SAY_HELP, VIEW_HELP, waitHelp } from '../../src/seattools.ts';
import { headers } from '../../src/server/public.ts';
import { MAP_IMAGE_KEY } from '../../src/mapimage.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, 'rust/generated');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const data = Object.fromEntries(Object.entries(D).filter(([, v]) => typeof v !== 'function'));
writeFileSync(join(out, 'data.json'), JSON.stringify({ ...data, HELP: { act: ACT_HELP, rules: RULES_HELP, say: SAY_HELP, view: VIEW_HELP, wait: waitHelp(50), image: MAP_IMAGE_KEY } }));
writeFileSync(join(out, 'rules.md'), readFileSync(join(root, 'docs/rules.md')));

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ts': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const rows: string[] = [];
const add = (path: string, text: string, type: string, cache: string) => {
  const file = path.slice(1).replace(/\W/g, '_');
  writeFileSync(join(out, file), text);
  const etag = cache === 'no-cache' ? `"${createHash('sha1').update(text).digest('base64url')}"` : '';
  rows.push(`    Asset { path: ${JSON.stringify(path)}, body: include_bytes!(${JSON.stringify(`../generated/${file}`)}), mime: ${JSON.stringify(type)}, cache: ${JSON.stringify(cache)}, etag: ${JSON.stringify(etag)} },`);
};
for (const n of readdirSync(join(root, 'web')).sort()) {
  const ext = extname(n);
  if (!TYPES[ext]) continue;
  const src = readFileSync(join(root, 'web', n), 'utf8');
  add(`/${n}`, ext === '.ts' ? stripTypeScriptTypes(src, { mode: 'strip' }) : src, TYPES[ext], 'no-cache');
}
const three = fileURLToPath(new URL('./', import.meta.resolve('three')));
for (const n of ['three.module.js', 'three.core.js']) add(`/vendor/three/${n}`, readFileSync(join(three, n), 'utf8'), TYPES['.js'], 'max-age=86400');
const csp = headers('https://x', join(root, 'web/'))['content-security-policy'];
writeFileSync(join(out, 'assets.rs'), `pub static CSP: &str = ${JSON.stringify(csp)};\npub static ASSETS: &[Asset] = &[\n${rows.join('\n')}\n];\n`);
