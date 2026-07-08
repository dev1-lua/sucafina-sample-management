import * as React from 'react';
import { IconChevronDown, IconSearch, IconX } from '@tabler/icons-react';

import { cn } from '@/lib/cn';
import type { FilterDef, FilterState } from '@/types';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type FilterBarProps = {
  defs: FilterDef[];
  value: FilterState;
  onChange: (next: FilterState) => void;
};

type Patch = Record<string, string | string[] | undefined>;

/** Applies a patch of key -> value|undefined onto `value` without mutating it.
 *  `undefined` (or an empty string / empty array) drops the key entirely. */
function applyPatch(value: FilterState, patch: Patch): FilterState {
  const next: FilterState = { ...value };
  for (const [key, v] of Object.entries(patch)) {
    const isEmpty = v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
    if (isEmpty) delete next[key];
    else next[key] = v;
  }
  return next;
}

function asString(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : '';
}

function asArray(v: string | string[] | undefined): string[] {
  return Array.isArray(v) ? v : [];
}

/** Shared pill shell — fully rounded (Twenty's soft chip look), hairline
 * border, `bg-accent text-accent-foreground` (the one sparing use of the blue
 * accent) once a value is set, with a trailing × clear control. */
function Chip({
  active,
  onClear,
  clearLabel,
  children,
}: {
  active: boolean;
  onClear?: () => void;
  clearLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'inline-flex h-7 items-center rounded-full border border-border bg-background text-xs text-foreground/80 transition-colors duration-150 hover:border-foreground/20',
        active && 'border-transparent bg-accent text-accent-foreground hover:border-transparent',
      )}
    >
      {children}
      {active && onClear && (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={onClear}
          className="flex h-full items-center rounded-r-full py-0 pl-1 pr-2.5 hover:bg-accent-foreground/10"
        >
          <IconX className="size-3.5" />
        </button>
      )}
    </div>
  );
}

const TriggerLabel = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ children, className, ...props }, ref) => (
    <button ref={ref} type="button" className={cn('flex h-full items-center gap-1 px-3', className)} {...props}>
      <span className="max-w-[12rem] truncate">{children}</span>
      <IconChevronDown className="size-3.5 shrink-0 opacity-60" />
    </button>
  ),
);
TriggerLabel.displayName = 'TriggerLabel';

function EnumPill({
  def,
  value,
  onPatch,
}: {
  def: Extract<FilterDef, { type: 'enum' }>;
  value: FilterState;
  onPatch: (patch: Patch) => void;
}) {
  const raw = value[def.key];
  const selected = def.multi ? asArray(raw) : asString(raw);
  const active = def.multi ? (selected as string[]).length > 0 : selected !== '';
  const summary = active
    ? `${def.label}: ${def.multi ? (selected as string[]).join(', ') : selected}`
    : def.label;

  function toggle(opt: string) {
    if (def.multi) {
      const arr = selected as string[];
      const next = arr.includes(opt) ? arr.filter((o) => o !== opt) : [...arr, opt];
      onPatch({ [def.key]: next });
    } else {
      onPatch({ [def.key]: opt });
    }
  }

  return (
    <Chip active={active} clearLabel={`Clear ${def.label} filter`} onClear={() => onPatch({ [def.key]: undefined })}>
      <Popover>
        <PopoverTrigger asChild>
          <TriggerLabel>{summary}</TriggerLabel>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          <div className="flex flex-col">
            {def.options.map((opt) => {
              const checked = def.multi ? (selected as string[]).includes(opt) : selected === opt;
              return (
                <label
                  key={opt}
                  className="flex cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <input
                    type={def.multi ? 'checkbox' : 'radio'}
                    name={def.key}
                    checked={checked}
                    onChange={() => toggle(opt)}
                    className="size-3.5 accent-primary"
                  />
                  {opt}
                </label>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </Chip>
  );
}

function BoolPill({
  def,
  value,
  onPatch,
}: {
  def: Extract<FilterDef, { type: 'bool' }>;
  value: FilterState;
  onPatch: (patch: Patch) => void;
}) {
  const trueValue = def.trueValue ?? 'true';
  const active = value[def.key] === trueValue;

  return (
    <Chip active={active} clearLabel={`Clear ${def.label} filter`} onClear={() => onPatch({ [def.key]: undefined })}>
      <button
        type="button"
        onClick={() => onPatch({ [def.key]: active ? undefined : trueValue })}
        className="flex h-full items-center px-3"
      >
        {def.label}
      </button>
    </Chip>
  );
}

function TextPill({
  def,
  value,
  onPatch,
}: {
  def: Extract<FilterDef, { type: 'text' }>;
  value: FilterState;
  onPatch: (patch: Patch) => void;
}) {
  const current = asString(value[def.key]);
  const active = current !== '';
  const summary = active ? `${def.label}: ${current}` : def.label;

  return (
    <Chip active={active} clearLabel={`Clear ${def.label} filter`} onClear={() => onPatch({ [def.key]: undefined })}>
      <Popover>
        <PopoverTrigger asChild>
          <TriggerLabel>{summary}</TriggerLabel>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <Input
            aria-label={def.label}
            value={current}
            onChange={(e) => onPatch({ [def.key]: e.target.value })}
            placeholder={def.label}
            className="h-8"
          />
        </PopoverContent>
      </Popover>
    </Chip>
  );
}

function DatePill({
  def,
  value,
  onPatch,
}: {
  def: Extract<FilterDef, { type: 'date' }>;
  value: FilterState;
  onPatch: (patch: Patch) => void;
}) {
  const from = asString(value.date_from);
  const to = asString(value.date_to);
  const active = from !== '' || to !== '';
  const summary = active ? `${def.label}: ${from || '…'} → ${to || '…'}` : def.label;

  return (
    <Chip
      active={active}
      clearLabel={`Clear ${def.label} filter`}
      onClear={() => onPatch({ date_from: undefined, date_to: undefined })}
    >
      <Popover>
        <PopoverTrigger asChild>
          <TriggerLabel>{summary}</TriggerLabel>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-2 p-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <Input
              aria-label="From"
              type="date"
              value={from}
              onChange={(e) => onPatch({ date_from: e.target.value })}
              className="h-8"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <Input
              aria-label="To"
              type="date"
              value={to}
              onChange={(e) => onPatch({ date_to: e.target.value })}
              className="h-8"
            />
          </label>
        </PopoverContent>
      </Popover>
    </Chip>
  );
}

function NumRangePill({
  def,
  value,
  onPatch,
}: {
  def: Extract<FilterDef, { type: 'numrange' }>;
  value: FilterState;
  onPatch: (patch: Patch) => void;
}) {
  const min = asString(value[def.minKey]);
  const max = asString(value[def.maxKey]);
  const active = min !== '' || max !== '';
  const summary = active ? `${def.label}: ${min || '…'}–${max || '…'}` : def.label;

  return (
    <Chip
      active={active}
      clearLabel={`Clear ${def.label} filter`}
      onClear={() => onPatch({ [def.minKey]: undefined, [def.maxKey]: undefined })}
    >
      <Popover>
        <PopoverTrigger asChild>
          <TriggerLabel>{summary}</TriggerLabel>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2">
          <div className="flex items-center gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Min
              <Input
                aria-label="Min"
                type="number"
                value={min}
                onChange={(e) => onPatch({ [def.minKey]: e.target.value })}
                className="h-8"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Max
              <Input
                aria-label="Max"
                type="number"
                value={max}
                onChange={(e) => onPatch({ [def.maxKey]: e.target.value })}
                className="h-8"
              />
            </label>
          </div>
        </PopoverContent>
      </Popover>
    </Chip>
  );
}

function FilterPill({ def, value, onPatch }: { def: FilterDef; value: FilterState; onPatch: (patch: Patch) => void }) {
  switch (def.type) {
    case 'enum':
      return <EnumPill def={def} value={value} onPatch={onPatch} />;
    case 'bool':
      return <BoolPill def={def} value={value} onPatch={onPatch} />;
    case 'text':
      return <TextPill def={def} value={value} onPatch={onPatch} />;
    case 'date':
      return <DatePill def={def} value={value} onPatch={onPatch} />;
    case 'numrange':
      return <NumRangePill def={def} value={value} onPatch={onPatch} />;
    default:
      return null;
  }
}

export function FilterBar({ defs, value, onChange }: FilterBarProps) {
  const q = asString(value.q);

  const onPatch = React.useCallback(
    (patch: Patch) => onChange(applyPatch(value, patch)),
    [value, onChange],
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => onPatch({ q: e.target.value })}
          placeholder="Search…"
          aria-label="Search"
          className="h-7 w-48 pl-7 text-xs"
        />
      </div>
      {defs.map((def) => (
        <FilterPill key={def.key} def={def} value={value} onPatch={onPatch} />
      ))}
    </div>
  );
}
