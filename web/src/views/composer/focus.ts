'use client';
import { useEffect, useRef, useState } from 'react';
import type { Draft, Writing } from '@/lib/compose.ts';

/**
 * Where the focus goes in the composer: the field it starts on (`first`), To or the text; a line once it is asked for
 * (`askFor`) and drawn; and a forward's text at its start, above the quote.
 */
export function useFocus(what: Writing, draft: Draft, inline: boolean) {
  const toField = useRef<HTMLInputElement>(null);
  // A line asked for (To, opened from a reply's names; Cc or Bcc): entered once it is drawn.
  const asked = useRef<'to' | 'cc' | 'bcc' | null>(null);
  const [toInput] = useState(() => (input: HTMLInputElement | null) => {
    toField.current = input;
    if (input && asked.current === 'to') {
      input.focus();
      asked.current = null;
    }
  });
  // One for each line, made once: a ref that changed each render would be attached again each render.
  const [entered] = useState(() => {
    const enter = (line: 'cc' | 'bcc') => (field: HTMLInputElement | null) => {
      if (field && asked.current === line) {
        field.focus();
        asked.current = null;
      }
    };
    return { cc: enter('cc'), bcc: enter('bcc') };
  });
  const textField = useRef<HTMLTextAreaElement>(null);
  // A forward's text starts with the quote; the reader writes above it.
  useEffect(() => {
    if (what.kind === 'forward') textField.current?.setSelectionRange(0, 0);
  }, [what.kind]);
  // A panel is given where to start; in place, it starts there as it opens, below the conversation it answers.
  const first = what.kind !== 'reply' && draft.to.length === 0 ? toField : textField;
  const [opening] = useState(() => (inline ? first : null));
  useEffect(() => opening?.current?.focus(), [opening]);
  const askFor = (line: 'to' | 'cc' | 'bcc') => {
    asked.current = line;
  };
  return { toInput, entered, textField, first, askFor };
}
