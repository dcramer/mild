import { api } from './api/endpoints.ts';
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
export async function uploadFile(file: File, sent: (bytes: number) => void, signal: AbortSignal): Promise<string> {
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
