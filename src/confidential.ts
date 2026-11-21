/**
 * Text Mild stores encrypted (`src/store/content.ts`), as the server reads it and the page receives it. At run time
 * it is the string itself, and JSON carries it as one; to the type checker it is opaque, so nothing takes it as text,
 * React least of all, until it is unwrapped: on the page by `reveal` (`web/src/lib/reveal.ts`), which only the
 * browser's part of the page can import, and on the server by `plain` (`src/plain.ts`), which the linter keeps out of
 * the page and the frame. So none of it is drawn into HTML on the server.
 */
declare const sealed: unique symbol;
export interface Confidential {
  readonly [sealed]: true;
}

/** `T` with each string in it held as `Confidential`. Literal types are Mild's own words, not what came from mail, and stay. */
export type Sealed<T> = T extends string ? (string extends T ? Confidential : T) : T extends object ? { [K in keyof T]: Sealed<T[K]> } : T;

/** `T` with each `Confidential` in it as its text. */
export type Plain<T> = T extends Confidential ? string : T extends object ? { [K in keyof T]: Plain<T[K]> } : T;
