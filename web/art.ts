// Card art: one small illustration per card, drawn as inline SVG so the phone
// downloads nothing extra. Every picture is built from the same few pieces (a
// sky, a ground in the map's terrain colours, a subject with a dark outline and
// one flat shadow side) so the set reads as one deck. All art is on a 120 x 84
// box; the card frame around it lives in phone.ts and style.css.

import { ELEMENT_COLORS, TERRAIN_COLORS } from './common.ts';

const INK = '#1b1612';
const O = `stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"`;
const THIN = `stroke="${INK}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round"`;

// ---------- shared pieces ----------

function sky(id: string, top: string, bottom: string): string {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
    <rect width="120" height="84" fill="url(#${id})"/>`;
}

function glow(x: number, y: number, r: number, color: string, opacity = 0.5): string {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="${opacity * 0.35}"/><circle cx="${x}" cy="${y}" r="${r * 0.6}" fill="${color}" opacity="${opacity * 0.5}"/><circle cx="${x}" cy="${y}" r="${r * 0.3}" fill="${color}" opacity="${opacity}"/>`;
}

// Rolling ground in a terrain colour, with a darker strip along the front.
function ground(color: string, y = 62): string {
  return `<path d="M0 ${y} Q30 ${y - 6} 60 ${y - 1} T120 ${y - 3} V84 H0 Z" fill="${color}"/>
    <path d="M0 ${y + 12} Q40 ${y + 7} 80 ${y + 11} T120 ${y + 9} V84 H0 Z" fill="#000" opacity=".18"/>`;
}

function hills(color: string, y = 52): string {
  return `<path d="M0 ${y} Q20 ${y - 10} 40 ${y - 2} Q62 ${y - 14} 84 ${y - 3} Q102 ${y - 9} 120 ${y - 1} V70 H0 Z" fill="${color}" opacity=".55"/>`;
}

function shadow(x: number, y: number, w: number): string {
  return `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${w * 0.18}" fill="#000" opacity=".28"/>`;
}

function sparkle(x: number, y: number, s: number, color = '#fff'): string {
  return `<path d="M${x} ${y - s} Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y} Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s} Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y} Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s} Z" fill="${color}"/>`;
}

function pine(x: number, y: number, s: number, c = '#2f6b3a', d = '#1e4a27'): string {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-1.5" y="0" width="3" height="5" fill="#5a3a22" ${THIN}/>
    <path d="M0 -22 L9 -6 H4 L11 2 H-11 L-4 -6 H-9 Z" fill="${c}" ${O}/>
    <path d="M0 -22 L9 -6 H4 L11 2 H0 Z" fill="${d}" opacity=".55"/></g>`;
}

function coin(x: number, y: number, r = 4): string {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#f5c542" ${THIN}/><circle cx="${x}" cy="${y}" r="${r * 0.55}" fill="none" stroke="#a37b12" stroke-width="1"/>`;
}

function gem(x: number, y: number, s: number, c = '#b07cff'): string {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 -8 L6 -2 L0 8 L-6 -2 Z" fill="${c}" ${O}/><path d="M-6 -2 L6 -2 L0 8 Z" fill="#000" opacity=".25"/><path d="M0 -8 L-6 -2 H0 Z" fill="#fff" opacity=".35"/></g>`;
}

function egg(x: number, y: number, s: number, c: string, spots = '#0003'): string {
  return `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="6" ry="8" fill="${c}" ${O}/>
    <path d="M0 -8 A6 8 0 0 1 0 8 A4 8 0 0 0 0 -8" fill="#000" opacity=".2"/>
    <circle cx="-2" cy="-3" r="1.3" fill="${spots}"/><circle cx="2" cy="2" r="1.6" fill="${spots}"/><ellipse cx="-2.5" cy="-4.5" rx="1.2" ry="2" fill="#fff" opacity=".45"/></g>`;
}

function sheep(x: number, y: number, s: number): string {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="-5" y="2" width="2" height="5" fill="${INK}"/><rect x="3" y="2" width="2" height="5" fill="${INK}"/>
    <path d="M-8 0 C-9 -5 -4 -7 -1 -6 C2 -8 7 -6 7 -2 C9 1 6 4 2 3 C-1 5 -6 4 -8 0 Z" fill="#f2eee2" ${O}/>
    <ellipse cx="-9" cy="-3" rx="3" ry="2.4" fill="#3a332c" ${THIN}/></g>`;
}

// ---------- buildings ----------

const BUILDING_SCENES: Record<string, () => string> = {
  quarry: () => `${sky('s-quarry', '#8fb7d6', '#dfe9ee')}
    <path d="M-5 60 L25 14 L42 34 L58 8 L92 52 L125 40 V70 H-5 Z" fill="#7d8088" ${O}/>
    <path d="M58 8 L92 52 L70 52 Z M25 14 L42 34 L32 40 Z" fill="#000" opacity=".2"/>
    <path d="M52 16 L58 8 L64 16 L60 14 L57 18 Z" fill="#f4f6f8"/>
    ${ground(TERRAIN_COLORS.mountain)}
    ${shadow(60, 72, 30)}
    <rect x="36" y="56" width="16" height="12" fill="#b9bcc2" ${O}/><rect x="52" y="56" width="16" height="12" fill="#a6a9b0" ${O}/>
    <rect x="68" y="56" width="16" height="12" fill="#9a9da4" ${O}/><rect x="44" y="44" width="16" height="12" fill="#c6c9ce" ${O}/>
    <rect x="60" y="44" width="16" height="12" fill="#adb0b6" ${O}/><rect x="52" y="32" width="16" height="12" fill="#d0d3d7" ${O}/>
    <path d="M86 70 L100 40" stroke="#6b4426" stroke-width="3" stroke-linecap="round"/>
    <path d="M92 38 Q101 34 110 40 L108 42 Q101 38 94 41 Z" fill="#c8ccd2" ${THIN}/>`,

  lumber_camp: () => `${sky('s-lumber', '#9cc7a5', '#e4eedb')}
    ${pine(14, 52, 1.3, '#3d7a47')}${pine(34, 46, 1.6, '#356d3f')}${pine(100, 48, 1.5, '#356d3f')}${pine(116, 54, 1.2, '#3d7a47')}
    ${ground(TERRAIN_COLORS.forest)}
    ${shadow(62, 73, 32)}
    ${[[44, 66], [58, 66], [72, 66], [51, 57], [65, 57], [58, 48]].map(([x, y]) => `<rect x="${x - 7}" y="${y - 4.5}" width="14" height="9" rx="2" fill="#a0673a" ${O}/><ellipse cx="${x + 7}" cy="${y}" rx="3" ry="4.5" fill="#e0b07a" ${THIN}/><circle cx="${x + 7}" cy="${y}" r="1.4" fill="none" stroke="#a0673a" stroke-width=".8"/>`).join('')}
    <rect x="84" y="60" width="16" height="10" rx="2" fill="#8a5630" ${O}/><ellipse cx="92" cy="60" rx="8" ry="3" fill="#e0b07a" ${O}/>
    <path d="M92 60 L98 46" stroke="#6b4426" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M95 44 L103 47 L100 52 Q96 50 94 48 Z" fill="#c8ccd2" ${THIN}/>`,

  crystal_mine: () => `${sky('s-mine', '#2a2150', '#5d4a9c')}
    ${sparkle(20, 14, 2.5, '#c7b6ff')}${sparkle(100, 10, 2, '#c7b6ff')}${sparkle(84, 22, 1.5, '#fff')}
    <path d="M10 62 Q20 24 60 20 Q100 24 110 62 Z" fill="#6d6680" ${O}/>
    <path d="M60 20 Q100 24 110 62 H86 Q84 36 60 32 Z" fill="#000" opacity=".2"/>
    ${ground(TERRAIN_COLORS.ley)}
    <path d="M38 64 V48 Q38 34 60 34 Q82 34 82 48 V64 Z" fill="#17122a" ${O}/>
    ${glow(60, 52, 22, '#c7b6ff', 0.6)}
    <path d="M38 64 V48 Q38 34 60 34 Q82 34 82 48 V64" fill="none" stroke="#8a5630" stroke-width="4"/>
    <path d="M38 64 V48 Q38 34 60 34 Q82 34 82 48 V64" fill="none" ${O}/>
    ${gem(52, 56, 1.1, '#b07cff')}${gem(64, 52, 1.5, '#c99cff')}${gem(72, 60, 0.9, '#9a68f0')}
    <path d="M14 72 Q40 62 60 70 T110 66" stroke="#c7b6ff" stroke-width="2" fill="none" opacity=".6"/>`,

  pasture: () => `${sky('s-pasture', '#8fc6ee', '#e6f3d6')}
    ${glow(100, 16, 14, '#fff3b0', 0.8)}
    ${hills('#6f9e3c', 50)}
    ${ground(TERRAIN_COLORS.meadow, 58)}
    ${[10, 34, 58, 82, 106].map((x) => `<rect x="${x - 2}" y="44" width="4" height="22" fill="#a0673a" ${THIN}/>`).join('')}
    <rect x="4" y="48" width="112" height="3.5" fill="#c08550" ${THIN}/><rect x="4" y="56" width="112" height="3.5" fill="#c08550" ${THIN}/>
    ${shadow(46, 76, 12)}${shadow(78, 74, 10)}
    ${sheep(46, 70, 1.4)}${sheep(80, 68, 1.15)}
    ${[[20, 74], [100, 78], [64, 80]].map(([x, y]) => `<path d="M${x} ${y} l-2 -4 M${x} ${y} l0 -5 M${x} ${y} l2 -4" stroke="#5f8f2c" stroke-width="1.4"/>`).join('')}`,

  roost: () => `${sky('s-roost', '#f0a35e', '#ffe2b0')}
    ${glow(22, 22, 14, '#fff0c0', 0.8)}
    <path d="M30 84 L40 38 L52 30 L70 32 L82 40 L92 84 Z" fill="#8d8f96" ${O}/>
    <path d="M70 32 L82 40 L92 84 H72 Z" fill="#000" opacity=".22"/>
    <path d="M34 36 Q61 46 88 36 Q86 28 61 26 Q36 28 34 36 Z" fill="#b8874f" ${O}/>
    <path d="M36 34 l8 -4 M46 30 l10 2 M62 28 l10 3 M76 30 l8 4" stroke="#7a5530" stroke-width="1.2"/>
    ${egg(52, 28, 1, '#e8492a')}${egg(68, 27, 1.1, '#7cc8f0')}
    <path d="M100 14 q6 -6 12 0 q-6 -2 -12 0 Z M92 24 q4 -4 8 0 q-4 -1.5 -8 0 Z" fill="${INK}" opacity=".7"/>`,

  hatchery: () => `${sky('s-hatch', '#3a2418', '#8a4a24')}
    ${ground('#d9c68e')}
    ${shadow(60, 70, 34)}
    <path d="M24 68 V46 Q24 20 60 18 Q96 20 96 46 V68 Z" fill="#c9895a" ${O}/>
    <path d="M60 18 Q96 20 96 46 V68 H76 V40 Q74 22 60 18 Z" fill="#000" opacity=".2"/>
    <path d="M28 40 H92 M26 54 H94 M44 20 V68 M76 20 V68" stroke="#8a5630" stroke-width="1.2" opacity=".7"/>
    <path d="M44 68 V52 Q44 40 60 40 Q76 40 76 52 V68 Z" fill="#2a160c" ${O}/>
    ${glow(60, 58, 18, '#ffb347', 0.8)}
    ${egg(52, 60, 0.9, '#ff7a45')}${egg(66, 59, 1.05, '#ffd23f')}${egg(59, 64, 0.8, '#8fd8ff')}
    <path d="M52 10 q-4 -6 2 -9 M62 12 q4 -6 -1 -10" stroke="#ccc" stroke-width="1.6" fill="none" opacity=".5"/>`,

  market: () => `${sky('s-market', '#8fc6ee', '#f2e6c4')}
    ${ground(TERRAIN_COLORS.plains)}
    ${shadow(60, 72, 36)}
    <rect x="28" y="40" width="64" height="30" fill="#c9a16c" ${O}/>
    <rect x="28" y="40" width="64" height="7" fill="#000" opacity=".15"/>
    <path d="M22 40 L30 24 H90 L98 40 Z" fill="#e5484d" ${O}/>
    ${[38, 54, 70].map((x) => `<path d="M${x} 24 H${x + 8} L${x + 10} 40 H${x - 2} Z" fill="#f4efe2"/>`).join('')}
    <path d="M22 40 L30 24 H90 L98 40 Z" fill="none" ${O}/>
    <path d="M22 40 q5 5 10 0 q5 5 10 0 q5 5 10 0 q5 5 10 0 q5 5 10 0 q5 5 10 0 q5 5 10 0 q5 5 10 0" fill="#e5484d" ${THIN}/>
    <rect x="34" y="54" width="52" height="5" fill="#8a5630" ${THIN}/>
    ${coin(42, 50, 3.5)}${gem(54, 49, 0.6)}<circle cx="66" cy="50" r="4" fill="#e9e4d4" ${THIN}/><rect x="73" y="46" width="9" height="7" rx="1.5" fill="#a0673a" ${THIN}/>
    <rect x="12" y="60" width="13" height="11" fill="#a0673a" ${O}/><path d="M12 60 l13 11 M25 60 l-13 11" stroke="#6b4426" stroke-width="1.2"/>`,

  caravan_post: () => `${sky('s-caravan', '#f2b56b', '#f7e3b5')}
    ${glow(96, 30, 16, '#fff3c0', 0.9)}
    <path d="M0 50 Q30 44 60 48 T120 46 V60 H0 Z" fill="#c7a86a" opacity=".6"/>
    ${ground(TERRAIN_COLORS.plains)}
    ${shadow(54, 74, 32)}
    <rect x="20" y="16" width="3.5" height="56" fill="#8a5630" ${THIN}/>
    <path d="M23.5 18 Q34 14 44 20 Q36 24 23.5 28 Z" fill="#3e7bfa" ${O}/>
    <path d="M40 46 Q40 30 62 30 Q84 30 84 46 Z" fill="#f4efe2" ${O}/>
    <path d="M62 30 Q84 30 84 46 H70 Q70 34 62 30 Z" fill="#000" opacity=".12"/>
    <rect x="36" y="46" width="52" height="12" fill="#a0673a" ${O}/>
    <path d="M88 52 L104 50" stroke="#6b4426" stroke-width="2.5" stroke-linecap="round"/>
    ${[48, 76].map((x) => `<circle cx="${x}" cy="64" r="8" fill="#6b4426" ${O}/><circle cx="${x}" cy="64" r="2.4" fill="#c9a16c" ${THIN}/><path d="M${x - 7} 64 H${x + 7} M${x} 57 V71" stroke="#c9a16c" stroke-width="1.2"/>`).join('')}`,

  tower_floor: () => `${sky('s-floor', '#3b5ea8', '#a9c4ee')}
    ${sparkle(18, 12, 2)}${sparkle(98, 20, 1.6)}
    ${ground(TERRAIN_COLORS.meadow, 70)}
    ${shadow(60, 78, 22)}
    <rect x="44" y="40" width="32" height="36" fill="#b9bcc2" ${O}/>
    <rect x="60" y="40" width="16" height="36" fill="#000" opacity=".18"/>
    <path d="M44 52 H76 M44 64 H76 M52 40 V52 M66 52 V64 M54 64 V76" stroke="#7d8088" stroke-width="1.1"/>
    <rect x="42" y="16" width="36" height="24" fill="#f5c542" ${O}/>
    <rect x="60" y="16" width="18" height="24" fill="#000" opacity=".15"/>
    <path d="M40 16 V8 H46 V12 H52 V8 H58 V12 H64 V8 H70 V12 H76 V8 H80 V16 Z" fill="#f5c542" ${O}/>
    <rect x="56" y="22" width="8" height="12" rx="4" fill="#2a2150" ${THIN}/>
    ${glow(60, 28, 26, '#fff3b0', 0.5)}
    ${sparkle(36, 22, 3.5, '#fff3b0')}${sparkle(86, 30, 3, '#fff3b0')}
    <path d="M30 44 L36 40 M90 46 L84 42" stroke="#fff3b0" stroke-width="1.6" stroke-linecap="round"/>`,

  monument: () => `${sky('s-monument', '#5a3a8a', '#f2a35e')}
    ${[...Array(9)].map((_, i) => { const a = (Math.PI / 10) * (i + 0.5) + Math.PI; return `<path d="M60 36 L${60 + Math.cos(a) * 90} ${36 + Math.sin(a) * 90} L${60 + Math.cos(a + 0.12) * 90} ${36 + Math.sin(a + 0.12) * 90} Z" fill="#fff3b0" opacity=".18"/>`; }).join('')}
    ${ground(TERRAIN_COLORS.plains, 66)}
    ${shadow(60, 74, 26)}
    <rect x="38" y="64" width="44" height="8" fill="#b9bcc2" ${O}/><rect x="44" y="58" width="32" height="7" fill="#c6c9ce" ${O}/>
    <path d="M52 58 L55 16 L60 8 L65 16 L68 58 Z" fill="#e4e1d8" ${O}/>
    <path d="M60 8 L65 16 L68 58 H60 Z" fill="#000" opacity=".18"/>
    <path d="M57 26 H63 M56.5 34 H63.5" stroke="#9a9da4" stroke-width="1"/>
    <path d="M55 16 L60 8 L65 16 Z" fill="#f5c542" ${O}/>
    ${sparkle(60, 6, 4, '#fff3b0')}`,
};

// ---------- upgrades: a golden object on a lit plinth ----------

function plinth(id: string, top: string, bottom: string, inner: string): string {
  return `${sky(id, top, bottom)}
    ${[...Array(12)].map((_, i) => { const a = (Math.PI / 6) * i; return `<path d="M60 40 L${60 + Math.cos(a) * 80} ${40 + Math.sin(a) * 80} L${60 + Math.cos(a + 0.18) * 80} ${40 + Math.sin(a + 0.18) * 80} Z" fill="#fff3b0" opacity=".12"/>`; }).join('')}
    ${glow(60, 40, 34, '#ffe9a0', 0.55)}
    <path d="M30 74 H90 L84 66 H36 Z" fill="#6d6680" ${O}/><rect x="24" y="74" width="72" height="10" fill="#57506a" ${O}/>
    ${inner}`;
}

const UPGRADE_SCENES: Record<string, () => string> = {
  workshop: () => plinth('s-workshop', '#3a2418', '#7a4a2a', `
    <path d="M42 66 V58 H34 Q34 50 44 50 H80 Q88 50 90 44 V58 H78 V66 Z" fill="#7d8088" ${O}/>
    <path d="M44 50 H80 Q88 50 90 44 V58 H44 Z" fill="#fff" opacity=".15"/>
    <g transform="rotate(-35 64 30)"><rect x="61" y="24" width="5" height="34" rx="1.5" fill="#a0673a" ${O}/><rect x="52" y="16" width="23" height="11" rx="2" fill="#c8ccd2" ${O}/><rect x="52" y="16" width="23" height="4" fill="#fff" opacity=".3"/></g>
    ${sparkle(34, 38, 4, '#ffd23f')}${sparkle(86, 30, 3, '#ffd23f')}${sparkle(40, 24, 2, '#fff3b0')}`),

  gilding: () => plinth('s-gilding', '#2a2150', '#5d4a9c', `
    <path d="M38 64 L34 34 L47 46 L60 26 L73 46 L86 34 L82 64 Z" fill="#f5c542" ${O}/>
    <path d="M60 26 L73 46 L86 34 L82 64 H60 Z" fill="#a37b12" opacity=".35"/>
    <rect x="38" y="60" width="44" height="6" fill="#e0a92a" ${O}/>
    ${gem(60, 52, 0.7, '#e5484d')}<circle cx="34" cy="33" r="2.6" fill="#fff3b0" ${THIN}/><circle cx="86" cy="33" r="2.6" fill="#fff3b0" ${THIN}/><circle cx="60" cy="24" r="2.8" fill="#fff3b0" ${THIN}/>
    ${sparkle(26, 22, 4, '#fff3b0')}${sparkle(94, 50, 3, '#fff3b0')}`),

  nesting_grounds: () => plinth('s-nesting', '#2b4a2f', '#6f9e3c', `
    <path d="M34 60 Q60 76 86 60 Q88 48 60 46 Q32 48 34 60 Z" fill="#b8874f" ${O}/>
    <path d="M36 56 l10 -4 M48 50 l12 2 M64 50 l12 3 M78 52 l8 4 M40 62 l12 2 M66 64 l12 -2" stroke="#7a5530" stroke-width="1.3"/>
    ${egg(48, 48, 1.05, '#ffd23f')}${egg(62, 44, 1.3, '#f5c542')}${egg(75, 49, 1, '#ffe08a')}
    ${sparkle(30, 30, 3.5, '#fff3b0')}${sparkle(92, 36, 3, '#fff3b0')}`),

  trade_charter: () => plinth('s-charter', '#13314a', '#2f6b8f', `
    <rect x="32" y="30" width="56" height="34" fill="#f4efe2" ${O}/>
    <rect x="28" y="26" width="8" height="42" rx="4" fill="#c9a16c" ${O}/><rect x="84" y="26" width="8" height="42" rx="4" fill="#c9a16c" ${O}/>
    <path d="M42 38 H78 M42 44 H74 M42 50 H70" stroke="#9a8a6a" stroke-width="1.4"/>
    <circle cx="70" cy="58" r="7" fill="#e5484d" ${O}/><path d="M66 63 L64 72 L68 69 L71 73 L72 64" fill="#e5484d" ${THIN}/>
    ${coin(46, 60, 5)}${coin(54, 66, 4)}
    ${sparkle(24, 18, 3, '#fff3b0')}${sparkle(98, 22, 3.5, '#fff3b0')}`),
};

// ---------- actions: a magic item on a starry violet ground ----------

function arcane(id: string, inner: string): string {
  return `${sky(id, '#1c1436', '#3d2a6e')}
    ${[[12, 10], [30, 20], [96, 12], [108, 30], [18, 40], [84, 8], [104, 54], [10, 62]].map(([x, y], i) => sparkle(x, y, 1 + (i % 3) * 0.6, '#d9ccff')).join('')}
    <ellipse cx="60" cy="74" rx="40" ry="8" fill="#8b6bd8" opacity=".35"/>
    <ellipse cx="60" cy="74" rx="26" ry="5" fill="#c7b6ff" opacity=".3"/>
    ${inner}`;
}

function flask(liquid: string, light: string): string {
  return `${glow(60, 52, 28, light, 0.55)}${shadow(60, 74, 18)}
    <path d="M54 14 H66 V28 Q84 38 82 56 Q80 74 60 74 Q40 74 38 56 Q36 38 54 28 Z" fill="#dfe9f5" fill-opacity=".35" ${O}/>
    <path d="M40 50 Q60 44 80 50 Q82 72 60 72 Q38 72 40 50 Z" fill="${liquid}"/>
    <path d="M40 50 Q60 44 80 50" stroke="${light}" stroke-width="1.6" fill="none"/>
    <path d="M54 14 H66 V28 Q84 38 82 56 Q80 74 60 74 Q40 74 38 56 Q36 38 54 28 Z" fill="none" ${O}/>
    <rect x="52" y="8" width="16" height="7" rx="2" fill="#a0673a" ${O}/>
    <path d="M45 40 Q42 50 45 60" stroke="#fff" stroke-width="2.4" fill="none" opacity=".6" stroke-linecap="round"/>
    <circle cx="66" cy="58" r="2.4" fill="#fff" opacity=".5"/><circle cx="56" cy="64" r="1.6" fill="#fff" opacity=".5"/>`;
}

function chest(open: boolean): string {
  const lid = open
    ? `<path d="M34 42 L38 22 Q60 14 82 22 L86 42 Z" fill="#8a5630" ${O}/><path d="M38 22 Q60 14 82 22" stroke="#f5c542" stroke-width="3" fill="none"/>`
    : `<path d="M34 46 Q34 30 60 30 Q86 30 86 46 Z" fill="#a0673a" ${O}/><path d="M34 40 Q60 34 86 40" stroke="#f5c542" stroke-width="3" fill="none"/>`;
  return `${shadow(60, 74, 30)}${lid}
    <rect x="34" y="46" width="52" height="26" fill="#a0673a" ${O}/>
    <rect x="34" y="46" width="52" height="6" fill="#000" opacity=".15"/>
    <rect x="44" y="46" width="5" height="26" fill="#f5c542" ${THIN}/><rect x="71" y="46" width="5" height="26" fill="#f5c542" ${THIN}/>`;
}

const ACTION_SCENES: Record<string, () => string> = {
  windfall: () => arcane('s-windfall', `
    <path d="M18 56 Q30 30 60 34 Q86 38 80 54 Q74 64 62 58 Q54 52 62 46" stroke="#cfe6ff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".85"/>
    <path d="M10 40 Q40 20 74 26" stroke="#cfe6ff" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".6"/>
    <path d="M24 70 Q60 62 100 44" stroke="#cfe6ff" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".5"/>
    <g transform="translate(36 30) rotate(-15)"><path d="M-7 4 L-5 -4 L2 -7 L7 -2 L6 5 L-1 7 Z" fill="#9aa0a6" ${O}/></g>
    <g transform="translate(88 30) rotate(20)"><rect x="-8" y="-4" width="14" height="8" rx="2" fill="#a0673a" ${O}/><ellipse cx="6" cy="0" rx="3" ry="4" fill="#e0b07a" ${THIN}/></g>
    ${gem(70, 56, 0.9)}${sheep(36, 62, 0.8)}`),

  treasure: () => arcane('s-treasure', `
    ${glow(60, 36, 26, '#ffe08a', 0.8)}
    ${chest(true)}
    <path d="M36 46 Q46 34 60 36 Q74 34 84 46 Z" fill="#f5c542" ${O}/>
    ${coin(46, 40, 4)}${coin(58, 34, 4.5)}${coin(72, 39, 4)}${gem(64, 40, 0.6, '#e5484d')}
    ${coin(26, 70, 3.5)}${coin(94, 68, 3.5)}
    ${sparkle(30, 24, 3.5, '#fff3b0')}${sparkle(90, 26, 3, '#fff3b0')}`),

  growth_elixir: () => arcane('s-elixir', `${flask('#4cc26e', '#b6ffb0')}
    <path d="M86 30 q6 -10 14 -8 q-2 8 -12 10 Z M88 30 q-2 -8 -10 -10" fill="#4cc26e" ${THIN}/>
    ${sparkle(28, 26, 3.5, '#b6ffb0')}${sparkle(92, 50, 2.5, '#b6ffb0')}`),

  healing_potion: () => arcane('s-heal', `${flask('#e5484d', '#ffb0b0')}
    <path d="M60 66 C50 60 48 54 52 51 C55 49 58 50 60 53 C62 50 65 49 68 51 C72 54 70 60 60 66 Z" fill="#ffd6d6" ${THIN}/>
    ${sparkle(28, 26, 3.5, '#ffd6d6')}${sparkle(92, 50, 2.5, '#ffd6d6')}`),

  war_horn: () => arcane('s-horn', `
    ${glow(60, 46, 26, '#ff8a5c', 0.5)}${shadow(56, 74, 26)}
    <path d="M28 40 Q52 70 86 34 L94 22 Q100 38 92 42 Q56 82 24 46 Z" fill="#e9e4d4" ${O}/>
    <path d="M86 34 L94 22 Q100 38 92 42 Z" fill="#cdbf9c" ${O}/>
    <path d="M40 54 l3 -6 M52 60 l2 -7 M64 60 l0 -7 M76 52 l-2 -6" stroke="#a0673a" stroke-width="3"/>
    <ellipse cx="26" cy="43" rx="4" ry="5" fill="#a0673a" ${O}/>
    <path d="M100 16 q8 4 6 14 M106 8 q12 8 8 24" stroke="#ff8a5c" stroke-width="2.4" fill="none" stroke-linecap="round"/>`),

  secret_hoard: () => arcane('s-hoard', `
    ${chest(false)}
    <rect x="54" y="44" width="12" height="12" rx="2" fill="#f5c542" ${O}/><circle cx="60" cy="49" r="2" fill="${INK}"/><path d="M59 50 h2 l1 4 h-4 Z" fill="${INK}"/>
    <path d="M24 30 Q60 6 96 30 Q60 52 24 30 Z" fill="#1c1436" opacity=".6"/>
    <path d="M36 24 Q60 12 84 24 Q72 30 60 30 Q48 30 36 24 Z" fill="#2a2150" ${O}/>
    <ellipse cx="50" cy="23" rx="4" ry="2.4" fill="#c7b6ff"/><ellipse cx="70" cy="23" rx="4" ry="2.4" fill="#c7b6ff"/>
    ${sparkle(22, 58, 2.5, '#d9ccff')}${sparkle(98, 60, 2.5, '#d9ccff')}`),
};

// ---------- dragons ----------

const DRAGON_PAL: Record<string, { body: string; dark: string; belly: string; wing: string }> = {
  fire: { body: '#e8492a', dark: '#8f2414', belly: '#ffb347', wing: '#b8321c' },
  ice: { body: '#7cc8f0', dark: '#2d6f9e', belly: '#e8f8ff', wing: '#4c9cd0' },
  lightning: { body: '#f2c230', dark: '#9a6a00', belly: '#fff2a8', wing: '#d49a10' },
  air: { body: '#b8c8d4', dark: '#4c6273', belly: '#f4f7f9', wing: '#8aa0b0' },
  water: { body: '#2f8fff', dark: '#124a8f', belly: '#8fe8e0', wing: '#1f6cc8' },
};

function elementScene(id: string, element: string): string {
  switch (element) {
    case 'fire': return `${sky(id, '#2a0b08', '#c4401c')}${glow(96, 66, 30, '#ffb347', 0.6)}
      <path d="M0 70 L14 52 L26 60 L40 46 L54 62 L70 50 L84 64 L100 48 L120 60 V84 H0 Z" fill="#2a1a17"/>
      <path d="M10 76 L30 70 L44 78 M70 74 L90 68 L104 76" stroke="#ff7a3c" stroke-width="1.6" fill="none"/>
      ${[[20, 18], [88, 12], [104, 28], [40, 8]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2" fill="#ffb347"/>`).join('')}`;
    case 'ice': return `${sky(id, '#5aa7d6', '#e6f6ff')}
      <path d="M0 64 L18 40 L30 54 L50 30 L70 56 L88 36 L120 60 V84 H0 Z" fill="#cfe8f6"/>
      <path d="M50 30 L70 56 H58 Z M88 36 L120 60 H100 Z" fill="#8fbcd8" opacity=".6"/>
      <path d="M0 72 Q60 64 120 70 V84 H0 Z" fill="#f2f9fd"/>
      ${[[12, 12], [32, 24], [80, 10], [108, 20], [96, 44], [20, 50]].map(([x, y]) => `<g transform="translate(${x} ${y})" stroke="#fff" stroke-width="1"><path d="M-3 0 H3 M0 -3 V3 M-2 -2 L2 2 M-2 2 L2 -2"/></g>`).join('')}`;
    case 'lightning': return `${sky(id, '#120e26', '#4b3a7a')}
      <path d="M0 22 Q16 10 32 18 Q46 4 64 14 Q84 2 98 14 Q112 8 120 16 V0 H0 Z" fill="#2a2244"/>
      <path d="M96 14 L88 34 L96 34 L86 56" stroke="#ffe066" stroke-width="2.2" fill="none" stroke-linejoin="round"/>
      <path d="M22 18 L18 30 L24 30 L18 42" stroke="#ffe066" stroke-width="1.6" fill="none" stroke-linejoin="round" opacity=".7"/>
      <path d="M0 70 Q30 62 60 68 T120 66 V84 H0 Z" fill="#231c3a"/>`;
    case 'air': return `${sky(id, '#5fb0ea', '#d8eefc')}${glow(18, 14, 14, '#fff8d0', 0.9)}
      ${[[20, 62, 1.4], [92, 70, 1.6], [96, 22, 0.9], [56, 76, 1.2]].map(([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s})" fill="#fff"><circle cx="-8" cy="2" r="6"/><circle cx="0" cy="-2" r="8"/><circle cx="9" cy="2" r="6"/><rect x="-14" y="2" width="29" height="6" rx="3"/></g>`).join('')}
      <path d="M8 34 Q24 30 34 36 M80 50 Q96 46 110 52" stroke="#fff" stroke-width="1.6" fill="none" opacity=".8" stroke-linecap="round"/>`;
    default: return `${sky(id, '#0b2147', '#1e6fb8')}
      ${[[18, 14], [44, 26], [92, 18], [104, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="none" stroke="#8fe8e0" stroke-width=".8" opacity=".7"/>`).join('')}
      <path d="M0 66 Q10 60 20 66 T40 66 T60 66 T80 66 T100 66 T120 66 V84 H0 Z" fill="#1450a0"/>
      <path d="M0 74 Q10 68 20 74 T40 74 T60 74 T80 74 T100 74 T120 74 V84 H0 Z" fill="#0d3a7a"/>
      <path d="M0 66 Q10 60 20 66 T40 66 T60 66 T80 66 T100 66 T120 66" stroke="#8fe8e0" stroke-width="1.2" fill="none" opacity=".7"/>`;
  }
}

// A side-on dragon facing left. Whelps are small and round-headed, drakes are
// lean with spread wings, wyrms are long with great wings and horns.
function dragonFigure(element: string, kind: 'whelp' | 'drake' | 'wyrm'): string {
  const p = DRAGON_PAL[element] ?? DRAGON_PAL.fire;
  const big = kind === 'wyrm';
  const farWing = big
    ? `<path d="M62 40 L74 4 L82 18 L94 6 L96 22 L112 16 L104 34 L116 34 L90 48 Z" fill="${p.dark}" ${O}/>`
    : kind === 'drake'
      ? `<path d="M62 40 L76 10 L82 22 L94 14 L94 28 L106 26 L88 46 Z" fill="${p.dark}" ${O}/>`
      : `<path d="M62 42 L70 24 L76 30 L84 26 L82 36 L88 38 L76 48 Z" fill="${p.dark}" ${O}/>`;
  const nearWing = big
    ? `<path d="M56 42 L54 8 L64 20 L70 10 L76 26 L88 24 L74 46 Z" fill="${p.wing}" ${O}/><path d="M56 42 L64 20 M58 42 L70 10 M62 44 L76 26" stroke="${p.dark}" stroke-width="1"/>`
    : kind === 'drake'
      ? `<path d="M56 42 L58 14 L66 24 L72 16 L76 30 L86 30 L72 46 Z" fill="${p.wing}" ${O}/><path d="M58 42 L66 24 M62 44 L72 16" stroke="${p.dark}" stroke-width="1"/>`
      : `<path d="M58 44 L60 30 L66 34 L70 30 L72 40 L68 48 Z" fill="${p.wing}" ${O}/>`;
  const tail = big
    ? `<path d="M76 58 C94 70 112 66 114 50 L118 42 L110 46 C106 58 94 62 80 52 Z" fill="${p.body}" ${O}/>`
    : `<path d="M76 58 C88 66 102 64 106 54 L110 48 L102 50 C98 58 90 58 80 52 Z" fill="${p.body}" ${O}/>`;
  const horns = big
    ? `<path d="M34 20 L44 8 L40 20 Z M30 20 L36 6 L36 20 Z" fill="${p.belly}" ${O}/>`
    : kind === 'drake'
      ? `<path d="M33 21 L42 12 L39 22 Z" fill="${p.belly}" ${O}/>`
      : `<path d="M32 22 L36 15 L37 23 Z" fill="${p.belly}" ${O}/>`;
  const spikes = `<path d="M46 40 l3 -5 l2 5 M54 37 l3 -5 l2 5 M62 37 l3 -5 l2 5 M70 40 l3 -5 l2 5" fill="${p.dark}" ${THIN}/>`;
  const head = kind === 'whelp'
    ? `<path d="M46 48 C42 40 40 34 36 30 L30 34 C34 38 38 44 42 52 Z" fill="${p.body}" ${O}/>
       <path d="M18 30 C18 20 30 16 38 22 C42 26 40 34 34 36 C28 38 18 38 18 30 Z" fill="${p.body}" ${O}/>
       <circle cx="30" cy="27" r="3.2" fill="#fff" ${THIN}/><circle cx="29.2" cy="27.4" r="1.7" fill="${INK}"/>
       <circle cx="21" cy="31" r=".9" fill="${INK}"/>`
    : `<path d="M48 48 C42 38 40 30 36 26 L30 30 C34 34 38 44 42 52 Z" fill="${p.body}" ${O}/>
       <path d="M12 30 L20 24 C24 18 34 16 38 22 C40 26 38 30 34 32 L22 34 L14 34 Z" fill="${p.body}" ${O}/>
       <path d="M14 34 L22 34 L34 32 L30 36 L18 37 Z" fill="${p.dark}" ${THIN}/>
       <path d="M27 24 L33 23 L31 26 Z" fill="#fff" ${THIN}/><circle cx="31" cy="24.6" r=".9" fill="${INK}"/>
       <circle cx="15" cy="29" r=".9" fill="${INK}"/>`;
  const breath = {
    fire: `<path d="M12 31 Q4 28 0 34 Q6 32 4 38 Q10 34 12 33 Z" fill="#ffb347" opacity=".9"/>`,
    ice: `<path d="M12 31 L2 28 M12 32 L0 34 M12 33 L4 40" stroke="#e8f8ff" stroke-width="1.4"/>`,
    lightning: `<path d="M12 31 L6 27 L8 32 L0 30" stroke="#fff2a8" stroke-width="1.4" fill="none"/>`,
    air: `<path d="M12 31 Q6 26 2 30 M12 33 Q6 36 0 34" stroke="#fff" stroke-width="1.4" fill="none"/>`,
    water: `<circle cx="8" cy="30" r="1.6" fill="none" stroke="#8fe8e0"/><circle cx="4" cy="35" r="1.2" fill="none" stroke="#8fe8e0"/>`,
  }[element] ?? '';
  const scale = kind === 'whelp' ? 'translate(16 18) scale(.78)' : kind === 'drake' ? 'translate(6 6) scale(.92)' : '';
  return `${shadow(62, 76, kind === 'whelp' ? 22 : 30)}<g transform="${scale}">
    ${farWing}${tail}
    <path d="M70 60 L72 72 L80 72 L78 60 Z" fill="${p.dark}" ${O}/>
    <path d="M42 50 C42 40 66 36 78 46 C86 54 78 64 62 64 C50 64 42 58 42 50 Z" fill="${p.body}" ${O}/>
    <path d="M44 54 C48 62 62 64 72 60 C64 58 52 58 44 54 Z" fill="${p.belly}"/>
    <path d="M44 54 C48 62 62 64 72 60" stroke="${p.dark}" stroke-width="1" fill="none"/>
    ${spikes}
    <path d="M50 58 L48 72 L56 72 L56 60 Z" fill="${p.body}" ${O}/>
    ${nearWing}${horns}${head}${kind === 'whelp' ? '' : breath}</g>`;
}

export function dragonArt(key: string, element: string): string {
  const kind = key.endsWith('_whelp') ? 'whelp' : key.endsWith('_wyrm') ? 'wyrm' : 'drake';
  return `${elementScene(`s-${key}`, element)}${dragonFigure(element, kind)}`;
}

// ---------- entry point ----------

export function cardArt(kind: string, key: string, element: string | null): string {
  const draw = kind === 'building' ? BUILDING_SCENES[key]
    : kind === 'upgrade' ? UPGRADE_SCENES[key]
      : kind === 'action' ? ACTION_SCENES[key]
        : () => dragonArt(key, element ?? 'fire');
  const body = draw ? draw() : `<rect width="120" height="84" fill="#272b35"/>`;
  return `<svg class="art" viewBox="0 0 120 84" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${body}</svg>`;
}

// The colour of a card's frame: what kind of card it is at a glance.
export function frameColor(kind: string, element: string | null): string {
  if (kind === 'dragon') return ELEMENT_COLORS[element ?? 'fire'] ?? '#ff5a36';
  return { building: '#c08550', upgrade: '#f5c542', action: '#a07cff' }[kind] ?? '#888';
}
