// Updating a page in place instead of rebuilding it. The phone draws each
// screen as one string of HTML; setting innerHTML with it would replace every
// element on every update, so an open card would zoom in again, a card rising
// out of the hand would land in one frame, and the rest of the hand would jump
// to its new places. morph() turns the page that's there into the new one,
// keeping every element that's still wanted, so its CSS transitions run and
// its running animations carry on.
//
// Elements are matched by key, then by kind: an element with a key (an id,
// data-key, or a hand card's data-card) only ever stands for the same thing.
// One with no key is reused for the next element of its kind: the same tag
// and data-* attributes (a button's data-step, data-to, data-accept: what
// tapping it does), or, with none, the same tag and first class. So when
// something comes or goes above them (an offer, a line saying why, the
// roost), the buttons below stay the elements they were, not each rewritten
// into the one before it while it's being tapped (#331). An element no kind
// matches is reused only if it has no data-* of its own and nothing else
// wants it: a hint, a line of text.
// A screen that changes gets a new data-key, so it's built fresh (and its
// entry animation plays) rather than morphed out of the last one.
//
// An element that goes and carries data-leave doesn't cut: it is taken out of
// the page where it stood and fades away there (style.css, .leaving), "up" as
// the last screen, "down" as the hand, "fade" as an open card.
//
// The event handlers set as properties (onclick, onpointerdown, oncontextmenu)
// are cleared on every element kept: the caller binds them again after each
// morph, and a button reused for another must not keep the last one's.

const keyOf = (n: Node): string | null => {
  if (!(n instanceof Element)) return null;
  const k = n.getAttribute('data-key') ?? (n.id || null);
  if (k) return `k:${k}`;
  const c = n.getAttribute('data-card');
  return c ? `c:${c}` : null;
};

export function morph(root: Element, html: string) {
  // Where each leaving element stands, measured before anything moves.
  const leaving = new Map<Element, DOMRect>();
  root.querySelectorAll('[data-leave]').forEach((el) => leaving.set(el, el.getBoundingClientRect()));
  const t = document.createElement('template');
  t.innerHTML = html;
  children(root, t.content, leaving);
}

// What an element with no key stands for (see above). Null for a text node.
function kindOf(n: Node): string | null {
  if (!(n instanceof Element)) return null;
  const data = [...n.attributes].filter((a) => a.name.startsWith('data-') && a.name !== 'data-leave').map((a) => `${a.name}=${a.value}`).sort();
  return data.length ? `${n.tagName} ${data.join(' ')}` : `${n.tagName} .${n.classList[0] ?? ''}`;
}
const hasData = (n: Element) => [...n.attributes].some((a) => a.name.startsWith('data-'));

function children(from: Element, to: ParentNode, leaving: Map<Element, DOMRect>) {
  const keyed = new Map<string, Element>();
  const kinds = new Map<string, Element[]>(); // the unkeyed elements there, by kind, in order
  for (const c of from.children) {
    const k = keyOf(c);
    if (k) {
      if (!keyed.has(k)) keyed.set(k, c);
    } else {
      const kind = kindOf(c)!;
      kinds.set(kind, [...(kinds.get(kind) ?? []), c]);
    }
  }
  // How many of each kind the new page has: those beyond it are spare.
  const wanted = new Map<string, number>();
  for (const w of to.children) if (!keyOf(w)) wanted.set(kindOf(w)!, (wanted.get(kindOf(w)!) ?? 0) + 1);
  const spare: Element[] = [];
  for (const [kind, els] of kinds) for (const el of els.splice(wanted.get(kind) ?? 0)) if (!hasData(el)) spare.push(el);
  spare.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  let cur: ChildNode | null = from.firstChild;
  for (const want of [...to.childNodes]) {
    const k = keyOf(want);
    let match: ChildNode | null = null;
    if (k) {
      match = keyed.get(k) ?? null;
      if (match && (match as Element).tagName !== (want as Element).tagName) match = null;
      if (match) keyed.delete(k);
    } else if (want instanceof Element) {
      match = kinds.get(kindOf(want)!)?.shift() ?? null;
      if (!match && !hasData(want)) {
        const i = spare.findIndex((el) => el.tagName === want.tagName);
        if (i >= 0) match = spare.splice(i, 1)[0];
      }
    } else if (cur && cur.nodeType === want.nodeType && !(cur instanceof Element)) {
      match = cur;
    }
    if (!match) {
      from.insertBefore(want, cur);
      continue;
    }
    if (match === cur) cur = cur.nextSibling;
    else from.insertBefore(match, cur);
    update(match, want, leaving);
  }
  while (cur) {
    const next: ChildNode | null = cur.nextSibling;
    remove(cur, leaving);
    cur = next;
  }
}

function update(el: ChildNode, want: ChildNode, leaving: Map<Element, DOMRect>) {
  if (!(el instanceof Element)) {
    if (el.nodeValue !== want.nodeValue) el.nodeValue = want.nodeValue;
    return;
  }
  const w = want as Element;
  for (const a of [...el.attributes]) if (!w.hasAttribute(a.name)) el.removeAttribute(a.name);
  for (const a of w.attributes) {
    let v = a.value;
    // An animation already running on an element that stays keeps its clock:
    // its delay was set when it started (a card being dealt, phone.ts dealStyle).
    if (a.name === 'style') {
      const was = /animation-delay:[^;]*/.exec(el.getAttribute('style') ?? '');
      if (was && /animation-delay:/.test(v)) v = v.replace(/animation-delay:[^;]*/, was[0]);
    }
    if (el.getAttribute(a.name) !== v) el.setAttribute(a.name, v);
  }
  if (el instanceof HTMLElement) {
    el.onclick = null;
    el.onpointerdown = null;
    el.oncontextmenu = null;
  }
  children(el, w, leaving);
}

function remove(n: ChildNode, leaving: Map<Element, DOMRect>) {
  const r = n instanceof HTMLElement ? leaving.get(n) : undefined;
  if (!r || !(n instanceof HTMLElement)) return n.remove();
  leaveFrom(n, r);
}

// An element taken out of the page fades away where it stood, then goes.
export function leaveFrom(el: HTMLElement, r: DOMRect) {
  el.classList.add('leaving', `leave-${el.dataset.leave || 'up'}`);
  el.removeAttribute('id'); // it no longer answers for the screen
  el.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
  el.style.cssText += `;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  el.inert = true;
  document.body.append(el);
  // Gone once it has faded; at once if nothing animates (screenshots).
  if (getComputedStyle(el).animationName === 'none') return el.remove();
  el.onanimationend = (e) => e.target === el && el.remove();
  setTimeout(() => el.remove(), 1000);
}
