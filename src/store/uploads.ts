import { randomBytes } from 'node:crypto';
import { Refusal } from '../refusal.ts';
import { plain } from '../plain.ts';
import { openData, openJson, sealData, sealJson, uploadName } from './content.ts';
import { asc, eq, inArray, lt, uploadPieces, uploads } from './query.ts';
import type { Sql } from './sql.ts';

/** A piece's bytes: as base64 in JSON, about 4 MB, under the 4.5 MB Vercel takes in a request. */
export const PIECE_BYTES = 3_000_000;
/** What Gmail sends attached to one message. */
export const MOST_ATTACHED = 25 * 1024 * 1024;
/** Long enough to write the mail it is for; past it, the pass removes it (`upkeep`). */
const UPLOAD_KEEP_MS = 86_400_000;

const MISSING = 'An attachment did not finish uploading. Remove it and attach it again.';

/** A file, whole, to attach. */
export interface Upload {
  name: string;
  type: string;
  data: Buffer;
}

const piecesOf = (size: number) => Math.max(1, Math.ceil(size / PIECE_BYTES));

/** Begin a file of `size` bytes, to be sent in `PIECE_BYTES` pieces. Returns its id. */
export async function startUpload(db: Sql, file: { name: string; type: string; size: number }, now: number): Promise<string> {
  if (file.size > MOST_ATTACHED) throw new Refusal(`${file.name} is larger than the 25 MB Gmail sends.`);
  const id = randomBytes(16).toString('hex');
  await db.insert(uploads).values({
    id,
    about: sealJson(db, uploadName(db, id, 'about'), { name: file.name, type: file.type }),
    size: file.size,
    pieces: piecesOf(file.size),
    createdAt: now,
  });
  return id;
}

/** Keep piece `piece` of upload `id`. Safe to repeat. False when there is no such upload, as after it was sent or removed. */
export async function addPiece(db: Sql, id: string, piece: number, data: Buffer): Promise<boolean> {
  const [upload] = await db.select({ size: uploads.size, pieces: uploads.pieces }).from(uploads).where(eq(uploads.id, id));
  if (!upload) return false;
  const expected = piece === upload.pieces - 1 ? upload.size - piece * PIECE_BYTES : PIECE_BYTES;
  if (piece < 0 || piece >= upload.pieces || data.length !== expected) throw new Refusal('That piece of the file is not the size it should be.');
  await db
    .insert(uploadPieces)
    .values({ uploadId: id, piece, data: sealData(db, uploadName(db, id, piece), data) })
    .onConflictDoNothing();
  return true;
}

/** The files, whole and in the order asked. Refuses one that is gone, or has not all come. */
export async function uploaded(db: Sql, ids: readonly string[]): Promise<Upload[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: uploads.id, about: uploads.about, size: uploads.size, pieces: uploads.pieces })
    .from(uploads)
    .where(inArray(uploads.id, [...ids]));
  const pieces = await db
    .select({ id: uploadPieces.uploadId, piece: uploadPieces.piece, data: uploadPieces.data })
    .from(uploadPieces)
    .where(inArray(uploadPieces.uploadId, [...ids]))
    .orderBy(asc(uploadPieces.uploadId), asc(uploadPieces.piece));
  return ids.map((id) => {
    const row = rows.find((r) => r.id === id);
    const own = pieces.filter((p) => p.id === id);
    if (!row || own.length !== row.pieces) throw new Refusal(MISSING);
    const about = plain(openJson<{ name: string; type: string }>(db, uploadName(db, id, 'about'), row.about));
    return { ...about, data: Buffer.concat(own.map((p) => openData(db, uploadName(db, id, p.piece), p.data))) };
  });
}

/** Returns how many there were. */
export async function removeUploads(db: Sql, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return (
    await db
      .delete(uploads)
      .where(inArray(uploads.id, [...ids]))
      .returning({ id: uploads.id })
  ).length;
}

/** Refuses mail naming a file that is not there: not finished, removed, or already sent with it. */
export async function refuseMissing(db: Sql, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const held = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(inArray(uploads.id, [...ids]));
  if (held.length !== new Set(ids).size) throw new Refusal(MISSING);
}

/** Files attached to mail that was never sent. */
export async function pruneUploads(db: Sql, now: number): Promise<void> {
  await db.delete(uploads).where(lt(uploads.createdAt, now - UPLOAD_KEEP_MS));
}
