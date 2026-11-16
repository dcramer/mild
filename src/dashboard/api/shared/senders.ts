import { z } from 'zod';

export const SHARED = 'Anyone can get an address at that domain, so it has no standing of its own.';

export const lower = z
  .string()
  .default('')
  .transform((value) => value.toLowerCase());
