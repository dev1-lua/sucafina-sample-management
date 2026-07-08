import * as React from 'react';
import { motion } from 'framer-motion';

import { useRecord, usePatchRecord } from '@/lib/query';
import type { DetailField, EventRow } from '@/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Timeline } from '@/components/Timeline';

export type DetailDrawerProps = {
  endpoint: string;
  id: string;
  open: boolean;
  onClose: () => void;
  fields: DetailField[];
};

type RowData = Record<string, unknown>;

const DETAIL_SLIDE_TRANSITION = { duration: 0.18, ease: 'easeOut' } as const;

function displayValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  return String(value);
}

/** Mirrors RecordTable's inline-edit-cell contract (commit-on-blur/Enter for text,
 * commit-on-select for select) but laid out as a full-width field row instead of a
 * table cell. */
function InlineEditField({
  editDef,
  row,
  onCommit,
}: {
  editDef: NonNullable<DetailField['edit']>;
  row: RowData;
  onCommit: (field: string, value: string) => void;
}) {
  const initial = row[editDef.field];
  const initialStr = initial === null || initial === undefined ? '' : String(initial);
  const [value, setValue] = React.useState(initialStr);

  React.useEffect(() => {
    setValue(initialStr);
  }, [initialStr]);

  function commit(next: string) {
    if (next !== initialStr) onCommit(editDef.field, next);
  }

  if (editDef.type === 'select') {
    return (
      <Select
        value={value}
        onValueChange={(next) => {
          setValue(next);
          commit(next);
        }}
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(editDef.options ?? []).map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      className="h-8 text-sm"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function DetailsSkeleton() {
  return (
    <div className="flex flex-col gap-4 pt-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

export function DetailDrawer({ endpoint, id, open, onClose, fields }: DetailDrawerProps) {
  const query = useRecord(endpoint, id);
  const { mutate: patchRecord } = usePatchRecord(endpoint);

  const isLoading = query.isLoading;
  const data = (query.data ?? {}) as RowData & { events?: EventRow[] };
  const title = (data.ref as string | undefined) ?? (data.name as string | undefined) ?? id;

  function commitEdit(field: string, value: string) {
    patchRecord({ id, body: { [field]: value } });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[480px]">
        {/* Radix already handles the panel's own enter/exit via Sheet's CSS animation
            (Task 2); this motion.div layers a restrained ~180ms content fade/slide on
            top so the drawer's content feels intentional rather than snapping in. */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={DETAIL_SLIDE_TRANSITION}
          className="flex h-full min-h-0 flex-col"
        >
          <SheetHeader className="shrink-0 border-b border-border px-5 py-4">
            {isLoading ? <Skeleton className="h-5 w-32" /> : <SheetTitle className="text-base">{title}</SheetTitle>}
          </SheetHeader>

          <Tabs defaultValue="details" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-5 mt-3 w-fit">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="related">Related</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="min-h-0 flex-1 overflow-auto px-5 pb-5">
              {isLoading ? (
                <DetailsSkeleton />
              ) : (
                <dl className="flex flex-col gap-4 pt-2">
                  {fields.map((field) => (
                    <div key={field.key} className="flex flex-col gap-1">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {field.label}
                      </dt>
                      <dd className="text-sm text-foreground">
                        {field.edit ? (
                          <InlineEditField editDef={field.edit} row={data} onCommit={commitEdit} />
                        ) : field.render ? (
                          field.render(data)
                        ) : (
                          displayValue(data[field.key])
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </TabsContent>

            <TabsContent value="timeline" className="min-h-0 flex-1 overflow-auto px-5 pb-5">
              {isLoading ? (
                <div className="flex flex-col gap-4 pt-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <div className="pt-2">
                  <Timeline events={data.events ?? []} />
                </div>
              )}
            </TabsContent>

            {/* Intentional Phase-4 boundary: Related records are not part of Phase 3
                scope, so this is a labeled placeholder, not a dangling TODO. */}
            <TabsContent value="related" className="min-h-0 flex-1 overflow-auto px-5 pb-5">
              <p className="pt-2 text-sm text-muted-foreground">Related records — coming in Phase 4.</p>
            </TabsContent>
          </Tabs>
        </motion.div>
      </SheetContent>
    </Sheet>
  );
}
