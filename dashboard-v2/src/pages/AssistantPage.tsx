import { LuaChat } from '@/components/LuaChat';

/**
 * The one place the Lua chat lives. Rendering the (heavy) widget here — rather
 * than app-wide — means its ~22 MB bundle only downloads when this tab is open,
 * keeping every other page instant.
 */
export default function AssistantPage() {
  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <p className="shrink-0 text-xs text-muted-foreground">
        Chat with the Sucafina sample assistant — log samples in plain language, or ask about
        status, tracking, and results. Messages here update the live production data.
      </p>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        <LuaChat />
      </div>
    </div>
  );
}
