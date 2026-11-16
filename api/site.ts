// Vercel's catch-all for the API and sign-in (vercel.json rewrites them here). See docs/RUNTIME.md.
import { respond } from '../src/vercel/host.ts';

export default { fetch: respond };
