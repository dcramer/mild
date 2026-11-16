import { z } from 'zod';

export const deleted = z.object({ deleted: z.number() });
