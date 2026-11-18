// Each minute: Vercel Cron (vercel.json), or `sift run`. See docs/runtime.md.
import { cron } from '../../../src/app/instance.ts';

export const maxDuration = 300;
export { cron as GET };
