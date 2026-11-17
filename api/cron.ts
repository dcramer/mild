// Vercel Cron, each minute (vercel.json). See docs/runtime.md.
import { cron } from '../src/vercel/host.ts';

export default { fetch: cron };
