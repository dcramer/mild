// A server component that imports this, however far down, fails `next build`: what it reveals is never drawn on the server.
import 'client-only';
import type { Plain } from '../../../src/confidential.ts';

/** What Sift stores encrypted (`Confidential`, src/confidential.ts), as text to draw or send back: a string, or each one in a value. */
export const reveal = <T>(value: T): Plain<T> => value as Plain<T>;
