import { type DBSchema, type IDBPDatabase, deleteDB, openDB } from 'idb';
import { api } from './api/endpoints.ts';
import { BUILT } from './build.ts';
import { timed } from './trace.ts';

/**
 * What this browser keeps of the person, so the page opens on it without waiting for Mild (docs/sync.md): the key the
 * copy is encrypted with, which no script can read out, and the frame's data (who is signed in, Settings' data, usage, For review's list and the rules Mild proposes),
 * encrypted with it. The server knows the device by its cookie, and a device it no longer knows wipes what it kept.
 */

interface Kept extends DBSchema {
  key: { key: 'key'; value: CryptoKey };
  frame: { key: string; value: Sealed };
}
export interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

const DATABASE = 'sift-device';
/** The copy of the inbox (`web/src/lib/copy.ts`) and the presses on their way (`web/src/lib/outbox.ts`), wiped with the device. */
const COPY = 'sift-copy';
const OUTBOX = 'sift-outbox';

const text = new TextEncoder();
const words = new TextDecoder();

/** Each value is sealed for its own name, so one moved to another record does not open. */
export async function seal(key: CryptoKey, name: string, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode(name) }, key, text.encode(JSON.stringify(value))) };
}

export async function unseal<T>(key: CryptoKey, name: string, sealed: Sealed): Promise<T> {
  return JSON.parse(words.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv, additionalData: text.encode(name) }, key, sealed.data))) as T;
}

/** The server's word for this device's key, the first time: what a copy kept before the key moved here was sealed with. */
async function fromServer(): Promise<CryptoKey> {
  const key = (await api.device(AbortSignal.timeout(30_000))).key ?? (await api.makeDevice()).key;
  const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

let opened: Promise<{ db: IDBPDatabase<Kept>; key: CryptoKey } | null> | null = null;

async function store() {
  const db = await openDB<Kept>(DATABASE, 1, {
    upgrade: (upgrading) => {
      upgrading.createObjectStore('key');
      upgrading.createObjectStore('frame');
    },
    // Wiped from another tab, which waits until every connection to it is closed.
    blocking: () => {
      db.close();
      opened = null;
    },
  });
  return db;
}

/**
 * The device's store and key, made the first time from the server's, or null where the browser cannot encrypt or keep
 * anything: then nothing is kept. Only for someone signed in: asking for a key with nobody signed in is refused.
 */
export function device(): Promise<{ db: IDBPDatabase<Kept>; key: CryptoKey } | null> {
  return (opened ??= (async () => {
    if (!globalThis.crypto?.subtle || typeof indexedDB === 'undefined') return null;
    const db = await store();
    const tx = db.transaction('key');
    const [kept] = await Promise.all([tx.store.get('key'), tx.done]);
    if (kept) return { db, key: kept };
    const key = await fromServer();
    await db.put('key', key, 'key');
    return { db, key };
  })().catch(() => {
    opened = null;
    return null;
  }));
}

/** Whether this browser held a key when the page opened: one made since is the one the server just gave. */
let held: Promise<boolean> = Promise.resolve(false);

/** What the frame was last drawn with, by the key the page loads each under, or nothing kept. Makes no key: who is signed in is not known yet. */
export function keptFrame(): Promise<Record<string, unknown>> {
  const read = readFrame();
  held = read.then(({ key }) => key);
  return read.then(({ frame }) => frame);
}

async function readFrame(): Promise<{ key: boolean; frame: Record<string, unknown> }> {
  const start = performance.now();
  // Wiped meanwhile (signed out, here or in another tab), its connection closes under the read: nothing is kept.
  const read = await readKept().catch(() => ({ key: false, frame: {} }));
  timed('Frame from the device', 'mild.device', start, { kept: Object.keys(read.frame).length });
  return read;
}

async function readKept(): Promise<{ key: boolean; frame: Record<string, unknown> }> {
  if (!globalThis.crypto?.subtle || typeof indexedDB === 'undefined') return { key: false, frame: {} };
  const db = await store().catch(() => null);
  if (!db) return { key: false, frame: {} };
  // idb's own reads (db.get) leave their transaction's done unawaited: aborted under them, as by the page leaving at
  // sign-out, it is an unhandled rejection. Every read here awaits its transaction whole.
  const tx = db.transaction(['key', 'frame']);
  const frame = tx.objectStore('frame');
  const [key, names, sealed] = await Promise.all([tx.objectStore('key').get('key'), frame.getAllKeys(), frame.getAll(), tx.done]).finally(() => db.close());
  if (!key) return { key: false, frame: {} };
  const values = await Promise.all(
    names.map(async (name, at) => {
      const kept = await unseal<{ build: string | null; value: unknown }>(key, name, sealed[at]).catch(() => null);
      // Another build's may not be what this one reads: the page waits on Mild instead, once.
      return [name, kept?.build === BUILT ? kept.value : undefined] as const;
    }),
  );
  return { key: true, frame: Object.fromEntries(values.filter(([, value]) => value !== undefined)) };
}

let turn = Promise.resolve();
/** Keeping and wiping one after another: a wipe closes the store a write still had open. Neither fails the page. */
const inTurn = (work: () => Promise<unknown>) =>
  (turn = turn.then(work).then(
    () => {},
    () => {},
  ));

/** Keep what the frame is drawn with, for the next time the page opens. */
export function keepFrame(name: string, value: unknown): Promise<void> {
  return inTurn(async () => {
    const kept = await device();
    if (kept) await kept.db.put('frame', await seal(kept.key, name, { build: BUILT, value }), name);
  });
}

/** Drop the frame kept, but not the key or the copy: what it holds may be what failed to draw. */
export function forgetFrame(): Promise<void> {
  return inTurn(async () => {
    await (await device())?.db.clear('frame');
  });
}

/**
 * Wipe everything this browser kept of the person: at sign-out, when Mild says nobody is signed in here, and when it no
 * longer knows this device (removed, or signed in again elsewhere).
 */
export function forgetDevice(): Promise<void> {
  return inTurn(wipe);
}

async function wipe() {
  const kept = await opened?.catch(() => null);
  kept?.db.close();
  opened = null;
  held = Promise.resolve(false);
  await Promise.all([deleteDB(DATABASE), deleteDB(COPY), deleteDB(OUTBOX)]);
}

/**
 * The server does not know this browser's device (removed, or its sign-in ended elsewhere): wipe what it kept before
 * the page opened. A session read before this page's first key was made says the same of a device that is new.
 */
export function unknownDevice(): Promise<void> {
  return inTurn(async () => {
    if (await held) await wipe();
  });
}
