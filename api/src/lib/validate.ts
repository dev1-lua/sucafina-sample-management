import { z } from 'zod';
import { HttpError } from '../errors.js';

const uuidSchema = z.string().uuid();

export function parseId(id: string): string {
  const r = uuidSchema.safeParse(id);
  if (!r.success) throw new HttpError(400, 'invalid id');
  return r.data;
}
