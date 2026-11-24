import { useState } from 'react';
import { api } from './api/endpoints.ts';
import type { Draft } from './compose.ts';
import { holdReload } from './build.ts';

/** A piece is sent again this many times before the file is said to have failed. */
const TRIES = 3;

/** A slice of a file as base64, as the piece route takes it, a run of bytes at a time so no call takes millions of arguments. */
async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

/**
 * Upload a file to attach, a piece to a request (a request is at most a few megabytes on Vercel), telling `sent` how many
 * bytes have gone. Resolves with its id, which Send names; Mild keeps it a day, or until it is sent.
 */
async function uploadFile(file: File, sent: (bytes: number) => void, signal: AbortSignal): Promise<string> {
  const release = holdReload();
  try {
    const { id, piece } = await api.startUpload({ name: file.name, type: file.type, size: file.size });
    for (let at = 0, index = 0; at < file.size || index === 0; at += piece, index++) {
      const data = await base64(file.slice(at, at + piece));
      for (let tried = 1; ; tried++) {
        if (signal.aborted) throw signal.reason;
        try {
          await api.uploadPiece(id, index, data);
          break;
        } catch (error) {
          if (tried === TRIES) throw error;
        }
      }
      sent(Math.min(at + piece, file.size));
    }
    return id;
  } finally {
    release();
  }
}

/** Files being uploaded, by a key of their own until Mild gives them an id. */
interface Uploading {
  key: string;
  file: File;
  added: number;
  sent: number;
  failed?: string;
  abort: AbortController;
}

/**
 * The files being uploaded to attach to a draft: `attach` sends each, and puts it in the draft through `change` once it
 * has gone; `cancel` stops one, and says whether it was one of them.
 */
export function useUploads(change: (next: (was: Draft) => Partial<Draft>) => void) {
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const attach = (picked: readonly File[]) => {
    for (const [index, file] of picked.entries()) {
      const key = crypto.randomUUID();
      const added = Date.now() + index;
      const abort = new AbortController();
      const set = (more: Partial<Uploading>) => setUploading((all) => all.map((u) => (u.key === key ? { ...u, ...more } : u)));
      setUploading((all) => [...all, { key, file, added, sent: 0, abort }]);
      uploadFile(file, (sent) => set({ sent }), abort.signal).then(
        (id) => {
          // Taken off as it finished: Mild need not keep it.
          if (abort.signal.aborted) {
            api.removeUpload(id).catch(() => {});
            return;
          }
          setUploading((all) => all.filter((u) => u.key !== key));
          change((was) => ({ files: [...was.files, { id, name: file.name, size: file.size, added }] }));
        },
        (failure: unknown) => {
          if (!abort.signal.aborted) set({ failed: failure instanceof Error ? failure.message : 'It did not upload.' });
        },
      );
    }
  };
  const cancel = (key: string) => {
    const going = uploading.find((u) => u.key === key);
    if (!going) return false;
    going.abort.abort();
    setUploading((all) => all.filter((u) => u.key !== key));
    return true;
  };
  return { uploading, attach, cancel };
}
