// The API, on Vercel and under `mild run` alike. See docs/runtime.md.
import { respond } from '../../../src/sift/instance.ts';

export const maxDuration = 300;
export { respond as GET, respond as POST };
