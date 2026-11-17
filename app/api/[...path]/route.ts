// The API on Vercel. `sift run` answers it in its own process (src/cli/host.ts). See docs/runtime.md.
import { respond } from '../../../src/vercel/host.ts';

export const maxDuration = 300;
export { respond as GET, respond as POST };
