/**
 * Freeze diagnostics
 * ==================
 * Instrumentation for the "whole page becomes unclickable after a filter
 * interaction" freeze (CPU idle, network fine, reload required).
 *
 * There are only a few ways a page can go fully dead while the CPU is idle, and
 * this module watches for every one of them so the console names the culprit the
 * instant it happens — no live DevTools archaeology required:
 *
 *   1. `pointer-events: none` stuck on <html>/<body>/#root  → MutationObserver
 *      fires the moment it flips, with the offending style/class + a stack.
 *   2. A full-viewport overlay swallowing every click        → overlay scan.
 *   3. A leaked pointer capture (setPointerCapture never       → prototype patch
 *      released funnels all pointer events to one element)       tracks live captures.
 *   4. Clicks falling through to <html>/<body>                → elementFromPoint probe.
 *
 * How to use when the page feels stuck:
 *   - Look in the console for `[freeze-diag]` warnings. A click on a dead page
 *     auto-emits `pointer interaction appears BLOCKED` with a full snapshot.
 *   - Or run `window.__freezeDiag()` for an on-demand snapshot.
 *   - Or run `window.__freezeCaptures()` to list outstanding pointer captures.
 *
 * Cheap enough to keep on in every environment: the per-click work is O(1) unless
 * a block is detected, the MutationObserver only fires on <body>/<html> attribute
 * changes, and the capture patch is a Map write.
 */

const TAG = '[freeze-diag]';

function describe(el: Element | null | undefined): string {
  if (!el) return 'null';
  const cls = typeof el.className === 'string' ? el.className : '';
  const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : '';
  let pe = '';
  try {
    pe = getComputedStyle(el).pointerEvents;
  } catch {
    pe = '?';
  }
  return `${el.tagName}${id}.${cls.slice(0, 45)}[pe=${pe}]`;
}

function pe(el: Element | null): string {
  if (!el) return 'no-el';
  try {
    return getComputedStyle(el).pointerEvents;
  } catch {
    return '?';
  }
}

/** Cheap, allocation-free check run on every pointerdown. */
function quickBlocked(x: number, y: number): boolean {
  if (pe(document.body) === 'none') return true;
  if (pe(document.documentElement) === 'none') return true;
  const root = document.getElementById('root');
  if (root && pe(root) === 'none') return true;
  // A visible, interactive page never routes a real click straight to <html>/<body>.
  const top = document.elementFromPoint(x, y);
  if (top && (top.tagName === 'HTML' || top.tagName === 'BODY')) return true;
  return false;
}

export type FreezeSnapshot = {
  bodyPE: string;
  htmlPE: string;
  rootPE: string;
  bodyInlineStyle: string | null;
  scrollLocked: boolean;
  activeElement: string;
  topAt: Record<string, string>;
  overlays: string[];
  captures: string[];
};

const liveCaptures = new Map<number, Element>();

/** Full, detailed snapshot. Walks the DOM for overlays — only call on demand or
 *  once a block has already been detected. */
export function snapshotBlockingState(px?: number, py?: number): FreezeSnapshot {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const top = (x: number, y: number) => describe(document.elementFromPoint(x, y));

  const overlays: string[] = [];
  document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'absolute') {
      const r = el.getBoundingClientRect();
      if (r.width >= vw * 0.5 && r.height >= vh * 0.5) {
        overlays.push(
          `${describe(el)} pos=${cs.position} z=${cs.zIndex} @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(
            r.width,
          )}x${Math.round(r.height)}`,
        );
      }
    }
  });

  const probes: Record<string, [number, number]> = {
    click: px != null && py != null ? [px, py] : [Math.round(vw / 2), Math.round(vh / 2)],
    sidebar: [120, 300],
    header: [Math.round(vw - 120), 60],
    center: [Math.round(vw / 2), Math.round(vh / 2)],
  };
  const topAt: Record<string, string> = {};
  for (const [k, [x, y]] of Object.entries(probes)) topAt[k] = top(x, y);

  return {
    bodyPE: pe(document.body),
    htmlPE: pe(document.documentElement),
    rootPE: pe(document.getElementById('root')),
    bodyInlineStyle: document.body.getAttribute('style'),
    scrollLocked: document.body.hasAttribute('data-scroll-locked'),
    activeElement: describe(document.activeElement),
    topAt,
    overlays,
    captures: [...liveCaptures].map(([id, el]) => `pointerId=${id} -> ${describe(el)}`),
  };
}

/** One-line human verdict: which (if any) blocking mechanism the snapshot shows. */
function verdict(s: FreezeSnapshot): string {
  const reasons: string[] = [];
  if (s.bodyPE === 'none') reasons.push('<body> pointer-events:none');
  if (s.htmlPE === 'none') reasons.push('<html> pointer-events:none');
  if (s.rootPE === 'none') reasons.push('#root pointer-events:none');
  for (const [k, v] of Object.entries(s.topAt)) {
    if (v.startsWith('HTML') || v.startsWith('BODY')) reasons.push(`clicks at "${k}" fall through to <${v.split('.')[0]}>`);
  }
  if (s.overlays.length) reasons.push(`${s.overlays.length} full-viewport overlay(s)`);
  if (s.captures.length) reasons.push(`${s.captures.length} live pointer capture(s)`);
  return reasons.length ? `LIKELY BLOCKED — ${reasons.join('; ')}` : 'no obvious block detected';
}

/** Snapshot + verdict, logged as PLAIN TEXT (stringified) so it can be copied in
 *  one selection — no expanding nested console objects. Full JSON only when blocked. */
function logState(reason: string, px?: number, py?: number): FreezeSnapshot {
  const s = snapshotBlockingState(px, py);
  const v = verdict(s);
  if (v.startsWith('LIKELY BLOCKED')) {
    console.warn(`${TAG} ${reason} — ${v}\n${JSON.stringify(s, null, 2)}`);
  } else {
    // Even "not blocked" is useful signal; keep it to one line unless you go looking.
    console.warn(`${TAG} ${reason} — ${v} (run window.__freezeDiag() for the full snapshot)`);
  }
  return s;
}

/** Timeline breadcrumb — call from interaction handlers so the console shows the
 *  sequence leading up to a freeze (e.g. "filter:patch" then the auto-probe verdict). */
export function breadcrumb(label: string, data?: unknown): void {
  console.debug(`${TAG} · ${label}`, data ?? '');
  // After a filter change the freeze (if any) lands within a few hundred ms. Auto-probe
  // the interactivity state then, so the culprit is logged with zero manual console steps.
  // Armed only once diagnostics are installed (so it never fires in unit tests).
  if (installed && label.startsWith('filter:')) {
    window.setTimeout(() => logState(`state after ${label} (+400ms)`), 400);
  }
}

let installed = false;

export function installFreezeDiagnostics(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Manual entry points.
  (window as unknown as Record<string, unknown>).__freezeDiag = () => {
    const s = snapshotBlockingState();
    console.warn(`${TAG} manual snapshot — ${verdict(s)}\n${JSON.stringify(s, null, 2)}`);
    return s;
  };
  (window as unknown as Record<string, unknown>).__freezeCaptures = () =>
    [...liveCaptures].map(([id, el]) => ({ pointerId: id, element: describe(el) }));

  // (1) Catch the exact moment <body>/<html> pointer-events flips to none.
  const watchPointerEvents = (el: HTMLElement, name: string) => {
    const obs = new MutationObserver(() => {
      if (pe(el) === 'none') {
        console.warn(`${TAG} <${name}> pointer-events => none (page will be unclickable)`, {
          style: el.getAttribute('style'),
          class: el.getAttribute('class'),
          stack: new Error('pointer-events set to none here').stack,
        });
      }
    });
    obs.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
  };
  watchPointerEvents(document.body, 'body');
  watchPointerEvents(document.documentElement, 'html');

  // (2)+(4) On every pointerdown, cheaply check whether the click can land; only
  // pay for the full snapshot when it looks blocked.
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (quickBlocked(e.clientX, e.clientY)) {
        logState(`pointer interaction BLOCKED at (${e.clientX}, ${e.clientY})`, e.clientX, e.clientY);
      }
    },
    true,
  );

  // (3) Track pointer captures — a capture that is never released funnels every
  // subsequent pointer event to one element, making the whole page feel dead.
  const proto = Element.prototype;
  const origSet = proto.setPointerCapture;
  const origRelease = proto.releasePointerCapture;
  proto.setPointerCapture = function (this: Element, id: number) {
    liveCaptures.set(id, this);
    breadcrumb('setPointerCapture', { id, el: describe(this) });
    return origSet.call(this, id);
  };
  proto.releasePointerCapture = function (this: Element, id: number) {
    liveCaptures.delete(id);
    return origRelease.call(this, id);
  };
  // A capture is also implicitly released when the pointer goes up; mirror that so
  // the live-capture map does not report false positives.
  window.addEventListener('pointerup', (e) => liveCaptures.delete(e.pointerId), true);
  window.addEventListener('pointercancel', (e) => liveCaptures.delete(e.pointerId), true);

  // eslint-disable-next-line no-console
  console.log(`${TAG} installed — run window.__freezeDiag() when the page feels stuck`);
}
