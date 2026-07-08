import { useMemo } from 'react';

// LuaPop UMD bundle (CDN). There is no reliable npm package.
const LUA_POP_SRC = 'https://lua-ai-global.github.io/lua-pop/lua-pop.umd.js';

// The agent the widget attaches to. Overridable per-environment; falls back to
// the Sucafina sample-chaser agent so the widget still loads if the var is unset.
const AGENT_ID =
  import.meta.env.VITE_LUA_AGENT_ID ?? 'baseAgent_agent_1783420556773_cc6qh9f2y';

// `environment: "production"` bypasses the widget's domain-whitelist check (so it
// runs on localhost too) and points it at the live agent — chat here writes to
// PROD data, regardless of the frontend's VITE_API_BASE.
const CONFIG = {
  agentId: AGENT_ID,
  environment: 'production',
  displayMode: 'embedded',
  embeddedDisplayConfig: { targetContainerId: 'lua-chat-embedded-root', useContainerHeight: true },
  chatTitle: 'Sucafina Sample Chaser',
  welcomeMessage:
    'Hi! Tell me about a sample to log — e.g. "offer sample of AA Swara to Beyers" — ' +
    'or ask me about status, tracking, or which samples are awaiting results.',
  attachmentsEnabled: true,
};

/**
 * Why an iframe, not a direct mount:
 *
 * The LuaPop bundle is ~22 MB AND it installs *global* side effects — it replaces
 * `history.pushState`/`replaceState` (a navigation guard), opens WebSockets, and
 * starts ~20 intervals. Mounted directly in our SPA those survive route changes
 * and drag down (or hang) every other page once the chat has been opened once.
 *
 * Running it inside an iframe sandboxes ALL of that into a separate JS context:
 * our app's `history` is never patched, and when the user leaves this tab React
 * unmounts the iframe and the browser reclaims the entire context — every socket,
 * interval and listener with it. The heavy download+parse also only happens here,
 * on this one route.
 */
function buildSrcDoc(): string {
  const cfgJson = JSON.stringify(CONFIG);
  // The parent origin, baked in at build time (we run in the parent here). The srcdoc
  // frame is same-origin, but its own `location` is `about:srcdoc`, so we can't derive
  // the app origin from inside — hence baking it. Used to resolve relative hrefs and to
  // target postMessage back at the app.
  const originJson = JSON.stringify(window.location.origin);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light dark" />
<style>
  html, body { height: 100%; margin: 0; }
  body { background: transparent; }
  #lua-chat-embedded-root { height: 100%; width: 100%; }
</style>
</head>
<body>
<div id="lua-chat-embedded-root"></div>
<script>
  // In-app jump bridge: when the user clicks a dashboard record link the agent rendered
  // (e.g. /samples/123?hl=created), don't let it navigate this tiny frame or open a new
  // tab — hand the path to the parent SPA router via postMessage so it does a client-side
  // navigate (which flashes + scrolls the row + shows the "Just created" banner).
  // Capture phase so we win over any handler LuaPop attaches to the link. Match by path
  // (not origin) so it works in dev too, where the agent returns the prod absolute URL.
  (function () {
    var ORIGIN = ${originJson};
    var RECORD_RE = /^\\/(samples|bulk|forwarding|clients)\\/[^\\/]+/;
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var url;
      try { url = new URL(a.getAttribute('href') || '', ORIGIN); } catch (_) { return; }
      if (!RECORD_RE.test(url.pathname) || !url.searchParams.has('hl')) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        window.parent.postMessage(
          { source: 'lua-chat', type: 'open-record', path: url.pathname + url.search },
          ORIGIN,
        );
      } catch (_) {}
    }, true);
  })();
  window.__LUA_BOOT = function () {
    try { window.LuaPop && window.LuaPop.init(${cfgJson}); }
    catch (e) { console.error('LuaPop init failed', e); }
  };
</script>
<script src="${LUA_POP_SRC}" onload="window.__LUA_BOOT()"></script>
</body>
</html>`;
}

/**
 * Inline (embedded) LuaPop chat, isolated in an iframe. Rendered only by the
 * Assistant page — see the note above for why isolation matters.
 */
export function LuaChat() {
  // Build once per mount; a fresh iframe (and fresh widget context) each visit.
  const srcDoc = useMemo(buildSrcDoc, []);

  return (
    <iframe
      title="Sucafina Sample Assistant"
      srcDoc={srcDoc}
      className="h-full w-full border-0"
      // The widget offers voice + file attachments; grant the iframe those.
      allow="microphone; clipboard-write"
    />
  );
}

export default LuaChat;
