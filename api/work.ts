// One piece of due work, handed here by the cron or by what a person started (vercel.json). See docs/RUNTIME.md.
import { work } from '../src/vercel/host.ts';

export default { fetch: work };
