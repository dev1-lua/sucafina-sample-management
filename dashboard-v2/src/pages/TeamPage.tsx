import { useEffect, useState } from 'react';
import { IconMailOff, IconPlus, IconUsersGroup } from '@tabler/icons-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { useCreateTeamMember, usePatchTeamMember, useTeamRoster, type TeamMember } from '@/lib/query';

const ROLE_LABEL: Record<TeamMember['role'], string> = { trader: 'Sales Trader', qc: 'Quality' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Round 10 (C): the roster is colleagues only. Customers had landed on it via the loop-in
// question; their contacts live on the client record instead. Domain match is case-insensitive.
const SUCAFINA_EMAIL_RE = /^[^\s@]+@sucafina\.com$/i;
const DOMAIN_ERROR = "Team emails must be @sucafina.com — a client's contact goes on the client record";

/** Inline validation message for a typed email, or null when it can be saved. */
function emailError(email: string): string | null {
  if (!email) return null;
  if (!EMAIL_RE.test(email)) return 'Not a valid email';
  if (!SUCAFINA_EMAIL_RE.test(email)) return DOMAIN_ERROR;
  return null;
}

/** The API's own message on a 400 (`{ "error": "..." }`, e.g. the roster domain rule), else a generic one. */
function saveErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (message.startsWith('400:')) {
    try {
      const parsed = JSON.parse(message.slice(4).trim()) as { error?: unknown };
      if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
    } catch {
      // not JSON — fall through to the generic message
    }
  }
  return 'Save failed — try again';
}

/** Commit-on-blur/Enter email cell (the DetailDrawer InlineEditField contract). */
function EmailCell({ member }: { member: TeamMember }) {
  const patch = usePatchTeamMember();
  const initial = member.email ?? '';
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  useEffect(() => setValue(member.email ?? ''), [member.email]);

  const commit = () => {
    const next = value.trim();
    if (next === initial) return;
    const invalid = emailError(next);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError('');
    patch.mutate(
      { id: member.id, body: { email: next || null } },
      { onError: (err) => setError(saveErrorMessage(err)) },
    );
  };

  return (
    <div className="flex flex-col gap-0.5">
      <Input
        value={value}
        placeholder="add email…"
        aria-label={`Email for ${member.name}`}
        className="h-7 max-w-[16rem] text-sm"
        onChange={(e) => {
          setValue(e.target.value);
          setError('');
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        disabled={patch.isPending}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function RoleCell({ member }: { member: TeamMember }) {
  const patch = usePatchTeamMember();
  return (
    <Select
      value={member.role}
      onValueChange={(role) => role !== member.role && patch.mutate({ id: member.id, body: { role: role as TeamMember['role'] } })}
      disabled={patch.isPending}
    >
      <SelectTrigger className="h-7 w-[9.5rem] text-sm" aria-label={`Role for ${member.name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="trader">{ROLE_LABEL.trader}</SelectItem>
        <SelectItem value="qc">{ROLE_LABEL.qc}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ActiveCell({ member }: { member: TeamMember }) {
  const patch = usePatchTeamMember();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('h-7 px-2 text-xs', member.active ? 'text-muted-foreground' : 'text-primary')}
      disabled={patch.isPending}
      onClick={() => patch.mutate({ id: member.id, body: { active: !member.active } })}
    >
      {member.active ? 'Deactivate' : 'Reactivate'}
    </Button>
  );
}

function AddPersonDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateTeamMember();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamMember['role']>('trader');
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setRole('trader');
      setError('');
    }
  }, [open]);

  const submit = () => {
    const n = name.trim();
    const e = email.trim();
    if (!n) {
      setError('Name is required');
      return;
    }
    const invalid = emailError(e);
    if (invalid) {
      setError(invalid);
      return;
    }
    create.mutate(
      { name: n, email: e || null, role },
      { onSuccess: () => onOpenChange(false), onError: (err) => setError(saveErrorMessage(err)) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add person</DialogTitle>
          <DialogDescription>
            Use the short first name the desk goes by (e.g. “Muki”) — samples and pings match on it. An
            existing name updates that person instead of duplicating them.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Muki" autoFocus />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email (optional)</span>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="muki@sucafina.com" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Role</span>
            <Select value={role} onValueChange={(r) => setRole(r as TeamMember['role'])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trader">{ROLE_LABEL.trader}</SelectItem>
                <SelectItem value="qc">{ROLE_LABEL.qc}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Add person'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TeamPage() {
  const { data: roster, isLoading, isError } = useTeamRoster();
  const [addOpen, setAddOpen] = useState(false);
  const missingEmails = (roster ?? []).filter((m) => m.active && !m.email).length;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm text-muted-foreground">
          Who the bot notifies: Quality members with an email get a ping for every new sample request; the
          Sales Trader on a sample gets updates as it progresses (preparing, dispatched, AWB). People
          without an email aren’t notified — the bot also asks for missing trader emails at intake.
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <IconPlus className="size-3.5" /> Add person
        </Button>
      </div>

      {missingEmails > 0 && (
        <div className="flex items-center gap-2 rounded-[4px] border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <IconMailOff className="size-4 shrink-0" />
          {missingEmails} {missingEmails === 1 ? 'person has' : 'people have'} no email on file yet — they
          won’t receive notifications until one is added.
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <IconUsersGroup className="size-4 shrink-0 text-blue-500 dark:text-blue-400" />
          <h3 className="flex-1 text-sm font-semibold">Roster</h3>
          <Badge variant="outline">{roster?.length ?? 0}</Badge>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="px-4 py-6 text-sm text-destructive">Couldn’t load the roster — refresh to retry.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-28 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(roster ?? []).map((m) => (
                <TableRow key={m.id} className={cn(!m.active && 'opacity-60')}>
                  <TableCell className="font-medium">
                    {m.name}
                    {!m.active && (
                      <Badge variant="outline" className="ml-2">
                        inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <EmailCell member={m} />
                  </TableCell>
                  <TableCell>
                    <RoleCell member={m} />
                  </TableCell>
                  <TableCell className="text-right">
                    <ActiveCell member={m} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <AddPersonDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
