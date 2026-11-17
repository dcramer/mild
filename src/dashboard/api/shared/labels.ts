import { z } from 'zod';
import { MAX_DESCRIPTION } from '../../../store/labels.ts';

export const DESCRIPTION = z.string().max(MAX_DESCRIPTION);
