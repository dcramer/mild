// Google sign-in, on Vercel and under `sift run` alike. See docs/runtime.md.
import { respond } from '../../../src/sift/instance.ts';

export const maxDuration = 300;
export { respond as GET, respond as POST };
