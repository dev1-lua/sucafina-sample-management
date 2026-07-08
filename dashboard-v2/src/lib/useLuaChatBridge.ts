import * as React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Bridge from the embedded Lua chat (iframe) to the app's router.
 *
 * When the user clicks a record link the agent rendered inside the chat, the
 * iframe's relay (see LuaChat.buildSrcDoc) posts `{source:'lua-chat',
 * type:'open-record', path}` up to us instead of doing a full-page navigation.
 * We turn that into a client-side `navigate(path)` — no new tab, no reload — so
 * the existing `?hl=` machinery flashes + scrolls the row and opens the record
 * (see lib/highlight.ts, RecordTable, DetailDrawer).
 *
 * Mount once, high in the tree (App), so the listener outlives the /assistant
 * route: the chat iframe (the sender) only exists there, but we want the
 * navigation to run as we leave it.
 */
export function useLuaChatBridge(): void {
  const navigate = useNavigate();

  React.useEffect(() => {
    function onMessage(e: MessageEvent) {
      // The srcdoc frame is same-origin, so a genuine message carries our origin.
      if (e.origin !== window.location.origin) return;
      const data = e.data as { source?: string; type?: string; path?: unknown } | null;
      if (!data || data.source !== 'lua-chat' || data.type !== 'open-record') return;
      // Only ever navigate to an in-app path (leading slash) — never an absolute URL.
      if (typeof data.path !== 'string' || !data.path.startsWith('/')) return;
      navigate(data.path);
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate]);
}
