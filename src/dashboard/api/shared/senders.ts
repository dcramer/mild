import { z } from 'zod';

export const SHARED = 'Anyone can get an address at that domain, so it has no standing of its own.';
export const UNKNOWN = 'No mail from them, and no rule about them.';

export const lower = z
  .string()
  .default('')
  .transform((value) => value.toLowerCase());
