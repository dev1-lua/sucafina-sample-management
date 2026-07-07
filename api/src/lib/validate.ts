import { z } from 'zod';
import { HttpError } from '../errors.js';

const uuidSchema = z.string().uuid();

export function parseId(id: string): string {
  const r = uuidSchema.safeParse(id);
  if (!r.success) throw new HttpError(400, 'invalid id');
  return r.data;
}

export function clampInt(value: unknown, def: number, min: number, max: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function assertIn<T extends string>(value: string, allowed: readonly T[], fieldName: string): T {
  if (!(allowed as readonly string[]).includes(value)) throw new HttpError(400, `invalid ${fieldName}`);
  return value as T;
}
