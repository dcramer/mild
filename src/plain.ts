import type { Plain, Sealed } from './confidential.ts';

/**
 * The server's own reading of what is stored encrypted, for what needs the text: the model, search, rules, Gmail
 * filters. `.oxlintrc.json` refuses it in the page and in the frame (`app/`), where it would draw into HTML.
 */
export const plain = <T>(value: T): Plain<T> => value as Plain<T>;

/** Text that names a sender or came from mail, held as what it is. */
export const seal = <T>(value: T): Sealed<T> => value as unknown as Sealed<T>;
