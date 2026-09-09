import * as React from 'react';
import { IconCheck, IconUser } from '@tabler/icons-react';

import { getActorName, setActorName } from '@/lib/actor';
import { useTraders } from '@/lib/query';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type ActorPromptControl = { open: boolean; setOpen: (open: boolean) => void };

const ActorPromptContext = React.createContext<ActorPromptControl>({ open: false, setOpen: () => {} });

/** Mounted once in App. Opens the "who's using the dashboard?" prompt on first load
 * when no name is stored yet; the header's user chip reopens it via useActorPrompt(). */
export function ActorPromptProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(() => getActorName() === null);
  const value = React.useMemo(() => ({ open, setOpen }), [open]);
  return (
    <ActorPromptContext.Provider value={value}>
      {children}
      <ActorPrompt open={open} onOpenChange={setOpen} />
    </ActorPromptContext.Provider>
  );
}

export function useActorPrompt(): ActorPromptControl {
  return React.useContext(ActorPromptContext);
}

export type ActorPromptProps = { open: boolean; onOpenChange: (open: boolean) => void };

/** Pick a name off the team roster or type one; it goes out as `x-actor: dashboard:<Name>`
 * on every request so the Quality team can see who made an edit or deletion. */
export function ActorPrompt({ open, onOpenChange }: ActorPromptProps) {
  const traders = useTraders();
  const [name, setName] = React.useState('');

  // Re-seed from storage each time the prompt opens (reopened from the header chip).
  React.useEffect(() => {
    if (open) setName(getActorName() ?? '');
  }, [open]);

  const roster = React.useMemo(
    () => Array.from(new Set((traders.data ?? []).map((t) => t.name.trim()).filter(Boolean))),
    [traders.data],
  );
  const trimmed = name.trim();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    setActorName(trimmed);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Who&rsquo;s using the dashboard?</DialogTitle>
          <DialogDescription>
            Your name goes on edits and deletions so the Quality team knows who made them.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {roster.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pick your name</span>
              <div
                role="group"
                aria-label="Team roster"
                className="flex max-h-48 flex-col gap-0.5 overflow-auto rounded-[4px] border border-border p-1"
              >
                {roster.map((person) => {
                  const selected = person === trimmed;
                  return (
                    <button
                      key={person}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setName(person)}
                      className={cn(
                        'flex items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-sm transition-colors duration-150',
                        selected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted',
                      )}
                    >
                      <IconUser className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
                      <span className="flex-1 truncate">{person}</span>
                      {selected && <IconCheck className="size-3.5 shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="actor-name" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {roster.length > 0 ? 'Or type your name' : 'Your name'}
            </label>
            <Input
              id="actor-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Harriet"
              autoComplete="name"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Not now
            </Button>
            <Button type="submit" disabled={!trimmed}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
