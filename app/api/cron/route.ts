// Each minute: Vercel Cron (vercel.json), or `mild run`. See docs/runtime.md.
import { cron } from '../../../src/sift/instance.ts';

export const maxDuration = 300;
export { cron as GET };
