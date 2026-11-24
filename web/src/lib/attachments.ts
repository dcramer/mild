'use client';
import { useEffect, useState } from 'react';
import { api } from './api/endpoints.ts';
import type { MessageAttachment, MessageDetail } from '../../../src/dashboard/types.ts';

/** A message's files, as the record has them; read from Gmail once where it does not (mail Inbox kept before it kept these). */
export function useFiles(message: MessageDetail | undefined): MessageAttachment[] {
  const [read, setRead] = useState<MessageAttachment[] | null>(null);
  const kept = message?.attachments ?? null;
  const unknown = message !== undefined && kept === null;
  useEffect(() => {
    if (!unknown) return;
    let current = true;
    api.attachments(message.accountId, message.messageId).then(
      (r) => current && setRead(r.attachments),
      () => current && setRead([]),
    );
    return () => {
      current = false;
    };
  }, [unknown, message?.accountId, message?.messageId]);
  return kept ?? read ?? [];
}

/** How long a saved file's address is kept: a browser may still be reading it after the press. */
const KEPT_MS = 60_000;

/** Fetch one of a message's files and hand it to the browser to save, under its own name. */
export async function saveFile(message: Pick<MessageDetail, 'accountId' | 'messageId'>, part: string, name: string): Promise<void> {
  const url = URL.createObjectURL(await api.file(message.accountId, message.messageId, part));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), KEPT_MS);
}
