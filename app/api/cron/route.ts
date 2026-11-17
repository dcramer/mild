// Vercel Cron, each minute (vercel.json). See docs/runtime.md.
import { cron } from '../../../src/vercel/host.ts';

export const maxDuration = 300;
export { cron as GET };
