'use client';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { useStarted } from './started.ts';

/** A value the reader has to carry somewhere else, whole: a command to run, an address to register. */
export function Copyable({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  // The clipboard is only offered to pages on localhost or HTTPS, which the server cannot tell: it draws no button.
  const clipboard = useStarted() ? (navigator.clipboard as Clipboard | undefined) : undefined;
  return (
    <div className="flex items-stretch bg-(--fill)">
      <code className="min-w-0 flex-1 px-3 py-2 font-mono text-sm leading-relaxed break-all select-all">{value}</code>
      {clipboard ? (
        <button
          type="button"
          aria-label={copied ? 'Copied' : `Copy ${label}`}
          className="flex w-9 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:bg-(--fill) hover:text-foreground"
          onClick={() =>
            void clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </button>
      ) : null}
    </div>
  );
}
