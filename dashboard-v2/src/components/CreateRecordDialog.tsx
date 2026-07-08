import * as React from 'react';

import { useCreateRecord } from '@/lib/query';
import type { CreateFieldDef } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EditableSelect } from '@/components/EditableSelect';

export type CreateRecordDialogProps = {
  endpoint: string;
  entityLabel: string;
  fields: CreateFieldDef[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FormValues = Record<string, string>;

function initialValues(fields: CreateFieldDef[]): FormValues {
  return Object.fromEntries(
    fields.map((f) => [f.key, f.defaultValue !== undefined ? String(f.defaultValue) : '']),
  );
}

/** Center modal create form, driven entirely by a tab's `createFields` (sourced from the
 * API's exact POST body zod schema — see each tabs/*.tsx config for provenance notes).
 * Server issues the ref/id; on success the list re-fetches via useCreateRecord's
 * invalidation and the dialog closes — no local optimistic row insertion needed. */
export function CreateRecordDialog({ endpoint, entityLabel, fields, open, onOpenChange }: CreateRecordDialogProps) {
  const { mutate: createRecord, isPending, isError, error, reset } = useCreateRecord(endpoint);
  const [values, setValues] = React.useState<FormValues>(() => initialValues(fields));

  // Fresh form + cleared mutation error every time the dialog is (re)opened.
  React.useEffect(() => {
    if (open) {
      setValues(initialValues(fields));
      reset();
    }
  }, [open, fields, reset]);

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.key];
      if (raw === undefined || raw === '') continue; // let the API apply its own nullish/default handling
      body[f.key] = f.type === 'number' ? Number(raw) : raw;
    }
    createRecord(body, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New {entityLabel}</DialogTitle>
          <DialogDescription>Fields left blank use the table&rsquo;s defaults.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {fields.map((f) => {
            const inputId = `create-${endpoint}-${f.key}`;
            return (
              <div key={f.key} className="flex flex-col gap-1.5">
                <label htmlFor={inputId} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {f.label}
                  {f.required && <span className="text-destructive"> *</span>}
                </label>
                {f.type === 'select' && f.allowCustom ? (
                  <EditableSelect
                    id={inputId}
                    value={values[f.key] ?? ''}
                    options={f.options ?? []}
                    humanize
                    placeholder={f.placeholder ?? 'Select…'}
                    onCommit={(v) => setField(f.key, v)}
                  />
                ) : f.type === 'select' ? (
                  <Select value={values[f.key] || undefined} onValueChange={(v) => setField(f.key, v)}>
                    <SelectTrigger id={inputId} className="h-8 text-sm">
                      <SelectValue placeholder={f.placeholder ?? 'Select…'} />
                    </SelectTrigger>
                    <SelectContent>
                      {(f.options ?? []).map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt.replace(/_/g, ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={inputId}
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    required={f.required}
                    className="h-8 text-sm"
                  />
                )}
              </div>
            );
          })}

          {isError && (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : 'Failed to create record.'}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
