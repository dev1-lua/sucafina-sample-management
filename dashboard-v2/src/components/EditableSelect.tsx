import * as React from 'react';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// The value that always means "let me type a custom value". Where a field already
// offers it (courier, sample type) we reuse the familiar literal 'other'; for option
// lists without one (e.g. the Yes/No follow-up fields) we append it.
const OTHER = 'other';

function humanizeLabel(v: string): string {
  return v.replace(/_/g, ' ');
}

export type EditableSelectProps = {
  /** The committed value (server value in the drawer, form value in create). */
  value: string;
  /** Suggested options. May or may not already include 'other'. */
  options: string[];
  /** Called with the value to persist (a preset, a typed custom string, or 'other'). */
  onCommit: (next: string) => void;
  /** Humanize preset labels (underscores → spaces). "Other…" is never humanized. */
  humanize?: boolean;
  placeholder?: string;
  id?: string;
  className?: string;
};

/**
 * A select that also accepts a free-text value: choosing "Other…" reveals an input
 * where the operator types the exact value to store (leaving it blank keeps "other").
 * A stored value that isn't one of `options` is treated as custom and shown in the
 * input, so custom entries round-trip when the record is reopened.
 *
 * The backing DB columns for every field that uses this — courier_norm,
 * sample_type_norm, and the free-form chaser follow-up columns — are plain text
 * (migration 004), so any typed string persists.
 */
export function EditableSelect({ value, options, onCommit, humanize, placeholder, id, className }: EditableSelectProps) {
  const isCustom = React.useCallback((v: string) => v !== '' && !options.includes(v), [options]);

  const [customMode, setCustomMode] = React.useState(() => value === OTHER || isCustom(value));
  const [customText, setCustomText] = React.useState(() => (isCustom(value) ? value : ''));

  // Re-sync when the drawer switches records or the underlying value changes.
  React.useEffect(() => {
    setCustomMode(value === OTHER || isCustom(value));
    setCustomText(isCustom(value) ? value : '');
  }, [value, isCustom]);

  // Dropdown items, guaranteeing an "Other…" trigger exists.
  const items = options.includes(OTHER) ? options : [...options, OTHER];

  // What the trigger shows as selected: the value itself when it's a known option,
  // otherwise the "Other…" item (for custom values or after picking Other on a blank
  // field); undefined only when there's nothing chosen and we're not typing.
  const selectValue = options.includes(value) ? value : value === '' && !customMode ? undefined : OTHER;

  function handleSelect(next: string) {
    if (next === OTHER) {
      // Enter custom mode but don't commit yet — wait for the typed value (or keep 'other').
      setCustomMode(true);
      setCustomText(isCustom(value) ? value : '');
      return;
    }
    setCustomMode(false);
    setCustomText('');
    if (next !== value) onCommit(next);
  }

  function commitCustom() {
    const trimmed = customText.trim();
    const next = trimmed === '' ? OTHER : trimmed;
    if (next !== value) onCommit(next);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Select value={selectValue} onValueChange={handleSelect}>
        <SelectTrigger id={id} className={className ?? 'h-8 text-sm'}>
          <SelectValue placeholder={placeholder ?? 'Select…'} />
        </SelectTrigger>
        <SelectContent>
          {items.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt === OTHER ? 'Other…' : humanize ? humanizeLabel(opt) : opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {customMode && (
        <Input
          className="h-8 text-sm"
          autoFocus
          placeholder="Type a custom value (optional)"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onBlur={commitCustom}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      )}
    </div>
  );
}
