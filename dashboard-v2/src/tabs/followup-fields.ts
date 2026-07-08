import type { ColumnDef, DetailField } from '@/types';

// Client-requested "Sample Chaser" follow-up fields (feedback #9). These have no
// source data in the workbook or DB — operators fill them in while chasing a sample,
// so each is a free-text column (migration 004) that can hold "Yes"/"No", a date, or
// free text. The edit control (EditableSelect via allowCustom) suggests Yes/No but
// accepts any typed value. Shared verbatim across specialty, bulk, and forwarding.
export const FOLLOWUP_YES_NO = ['Yes', 'No'];

const FOLLOWUP_FIELDS: { key: string; header: string }[] = [
  { key: 'feedback_requested', header: 'Feedback Requested' },
  { key: 'feedback_received', header: 'Feedback Received' },
  { key: 'order_placed', header: 'Order Placed' },
  { key: 'new_sample_requested', header: 'New Sample Requested' },
  { key: 'new_sample', header: 'New Sample' },
];

export const followupColumns: ColumnDef[] = FOLLOWUP_FIELDS.map((f): ColumnDef => ({
  key: f.key,
  header: f.header,
  sortKey: f.key,
}));

export const followupDetailFields: DetailField[] = FOLLOWUP_FIELDS.map((f): DetailField => ({
  key: f.key,
  label: f.header,
  edit: { field: f.key, type: 'select', options: FOLLOWUP_YES_NO, allowCustom: true },
}));
