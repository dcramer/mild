import { z } from 'zod';

export const DESCRIPTION = z.string().max(600);
