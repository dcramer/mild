'use client';
import { api } from '@/lib/api/endpoints.ts';
import { useFiles } from '@/lib/attachments.ts';
import type { Draft, Writing } from '@/lib/compose.ts';
import { reveal } from '@/lib/reveal.ts';
import { useUploads } from '@/lib/upload.ts';
import type { DraftFile } from '@/system';
import type { MessageDetail } from '../../../../src/dashboard/types.ts';

/**
 * The files a draft goes with: those of the message it answers that it carries (`carried`), those uploaded and being
 * uploaded, all as the composer lists them (`shown`) in the order they were added after the carried, and `detach`
 * taking any of them off.
 */
export function useDraftFiles(what: Writing, draft: Draft, change: (next: (was: Draft) => Partial<Draft>) => void, answered: MessageDetail | undefined) {
  const { uploading, attach, cancel } = useUploads(change);
  const files = useFiles(what.kind === 'forward' || draft.withFiles ? answered : undefined);
  const carried = files.filter((f) => !draft.dropped.includes(f.part));

  const detach = (key: string) => {
    if (cancel(key)) return;
    if (files.some((f) => f.part === key)) {
      change((was) => ({ dropped: [...was.dropped, key] }));
      return;
    }
    change((was) => ({ files: was.files.filter((f) => f.id !== key) }));
    api.removeUpload(key).catch(() => {});
  };
  const shown: DraftFile[] = [
    ...carried.map((f) => ({ key: f.part, name: reveal(f.name), size: f.size })),
    ...[
      ...draft.files.map((f) => ({ added: f.added, file: { key: f.id, name: f.name, size: f.size } })),
      ...uploading.map((u) => ({
        added: u.added,
        file: { key: u.key, name: u.file.name, size: u.file.size, sent: u.sent, ...(u.failed ? { failed: u.failed } : {}) },
      })),
    ]
      .toSorted((a, b) => a.added - b.added)
      .map((f) => f.file),
  ];
  return { uploading, attach, carried, shown, detach };
}
