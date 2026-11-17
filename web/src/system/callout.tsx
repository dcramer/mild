import type { ReactNode } from 'react';

/**
 * What the reader has to know before anything on the page makes sense: the state Sift is in, and how to
 * read the page because of it. First on the page, framed and set large, at most one per page. `action` is
 * the press that leaves that state; on a phone it goes under the words.
 */
export function Callout({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="sheet flex flex-wrap items-end gap-x-8 gap-y-5 px-5 py-5 md:px-6">
      <div className="flex min-w-0 flex-1 basis-96 flex-col gap-3">
        <h2 className="heading">
          <span className="hl">{title}</span>
        </h2>
        <div className="flex max-w-[44rem] flex-col gap-3 text-base text-muted-foreground">{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </section>
  );
}

/** One way to read what follows on the page, inside a `Callout`: a mark as it appears there, and what it means. */
export function CalloutKey({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-baseline gap-3">
      <span className="flex w-5 shrink-0 justify-center">{mark}</span>
      <span>{children}</span>
    </p>
  );
}
