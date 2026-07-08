import { useState } from 'react';
import { IconPlus } from '@tabler/icons-react';
import { LuaChat, resetLuaChatSession } from '@/components/LuaChat';
import { Button } from '@/components/ui/button';

/**
 * The one place the Lua chat lives. Rendering the (heavy) widget here — rather
 * than app-wide — means its ~22 MB bundle only downloads when this tab is open,
 * keeping every other page instant.
 */
export default function AssistantPage() {
  // Bumping this remounts <LuaChat>, giving it a fresh iframe + widget context.
  const [chatKey, setChatKey] = useState(0);

  // "New chat": forget the persisted session id, then remount so the widget
  // boots a brand-new conversation. The embedded LuaPop widget ships no
  // new-thread control of its own, so we provide one.
  function startNewChat() {
    resetLuaChatSession();
    setChatKey((k) => k + 1);
  }

  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Chat with the Sucafina sample assistant — log samples in plain language, or ask about
          status, tracking, and results. Messages here update the live production data.
        </p>
        <Button variant="outline" size="sm" className="shrink-0" onClick={startNewChat}>
          <IconPlus className="size-4" />
          New chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        <LuaChat key={chatKey} />
      </div>
    </div>
  );
}
