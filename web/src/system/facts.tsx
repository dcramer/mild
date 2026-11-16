import type { ReactNode } from 'react';

/** What is known about one thing, as terms and values: a sender, a message, a decision. The term column stacks above its value on a phone. */
export function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-5 gap-y-2 sm:grid-cols-[7.5rem_minmax(0,1fr)]">{children}</dl>;
}

/** One term and its value. Leave a fact out rather than give it no value. */
export function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground max-sm:mt-1">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
