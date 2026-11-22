import { type ChangeMessageOrDeleteKeyMessage, type Collection, type SyncConfig, createCollection, createOptimisticAction } from '@tanstack/react-db';
import { onlineManager } from '@tanstack/react-query';
import { type DBSchema, type IDBPDatabase, deleteDB, openDB } from 'idb';
import { useSyncExternalStore } from 'react';
import { type MailConversation, type SyncPage, type SyncedConversation, api, onWrite, queryClientFor } from './api.ts';

/**
 * The page's copy of the person's inbox (docs/sync.md): every conversation with a message in it, kept in this browser
 * encrypted under a key the server gives only to this browser's signed-in page, and brought up to date from the feed of
 * what changed. Screens read it through `conversations`, a TanStack DB collection, and wait on nothing.
 */

/** A conversation as the copy holds it, with what Inbox narrows by beside it. */
export interface Copied {
  key: string;
  accountId: string;
  threadId: string;
  /** When its newest message came. */
  newestAt: number;
  inbox: boolean;
  unread: boolean;
  /** What Mild thinks of its newest message: its label, and what Mild would do. */
  labelId: string | null;
  disposition: string | null;
  conversation: SyncedConversation;
}

export const copiedKey = (accountId: string, threadId: string) => `${accountId}/${threadId}`;

function copiedOf(conversation: SyncedConversation): Copied {
  const labels = new Set(conversation.messages.flatMap((m) => m.labelIds));
  return {
    key: copiedKey(conversation.accountId, conversation.threadId),
    accountId: conversation.accountId,
    threadId: conversation.threadId,
    newestAt: Math.max(...conversation.messages.map((m) => m.receivedAt)),
    inbox: labels.has('INBOX'),
    unread: labels.has('UNREAD'),
    labelId: conversation.thinks?.labelId ?? null,
    disposition: conversation.thinks?.disposition ?? null,
    conversation,
  };
}

/** A conversation as the reader's list of its messages shows it, which the copy holds already. */
export const conversationOf = ({ conversation: c }: Copied): MailConversation => ({
  accountId: c.accountId,
  threadId: c.threadId,
  messages: c.messages.map((m) => ({
    messageId: m.messageId,
    fromAddress: m.fromAddress,
    fromName: m.fromName,
    receivedAt: m.receivedAt,
    unread: m.labelIds.includes('UNREAD'),
    preview: m.preview,
  })),
});

/** Where the copy stands: past every change up to `seq`, asked from `cursor` next; null before its first whole copy. */
interface Standing {
  cursor: string;
  seq: number;
  mailboxes: string[];
}

/** One feed reply's worth of changes, as the asking tab hands them to the others. */
interface Changes {
  reset: boolean;
  /** Each conversation as it is now, or null for gone. */
  changes: { key: string; value: Copied | null }[];
  mailboxes: string[];
  seq: number;
  cursor: string;
}

/** What is kept on the disk: ids and times readable, the conversation sealed. */
interface Kept extends DBSchema {
  conversations: { key: string; value: { key: string; at: number; sealed: Sealed }; indexes: { at: number } };
  standing: { key: 'standing'; value: Sealed };
}
interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

const DATABASE = 'sift-copy';
const CHANNEL = 'sift-copy';
/** Drawn first from the disk, before the rest is decrypted: about a screen of the inbox. */
const FIRST = 50;
/** How often the page asks for what changed while it is in view. Mail reaches Mild at the minute tick's pace. */
const ASK_MS = 30_000;
/** How long a press waits for the copy to hold its change before letting go of the rows it hid. */
const HOLD_MS = 10_000;

const text = new TextEncoder();
const words = new TextDecoder();

async function keyFrom(base64url: string): Promise<CryptoKey> {
  const bytes = Uint8Array.from(atob(base64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Each value is sealed for its own key in the store, so one moved to another record does not open. */
async function seal(key: CryptoKey, name: string, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode(name) }, key, text.encode(JSON.stringify(value))) };
}

async function unseal<T>(key: CryptoKey, name: string, sealed: Sealed): Promise<T> {
  return JSON.parse(words.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv, additionalData: text.encode(name) }, key, sealed.data))) as T;
}

/** The key the page was drawn with, else the one this browser has, else a new one; null where the browser cannot encrypt. */
async function deviceKey(): Promise<CryptoKey | null> {
  if (!globalThis.crypto?.subtle) return null;
  // A sender's page is drawn for everyone, without it: that page asks.
  const drawn = queryClientFor().getQueryData<{ key: string | null }>(['device']) ?? (await api.device(AbortSignal.timeout(30_000)));
  const key = drawn.key ?? (await api.makeDevice()).key;
  return await keyFrom(key);
}

let sync: Parameters<SyncConfig<Copied, string>['sync']>[0] | null = null;
let standing: Standing | null = null;
/** Whether the whole copy is here: before it is, an empty list may only not have arrived yet. */
let whole = false;
const listeners = new Set<() => void>();
const told = () => listeners.forEach((listener) => listener());
/** The counter the copy holds every change up to, and the newest one a write of this page was given. */
let held = 0;
let wanted = 0;

/** Rows written to the collection at a time, the page drawing between: a whole copy at once holds it for most of a second. */
const PART = 500;
let applying = Promise.resolve();

/**
 * Write changes into the collection, a part at a time, newest first so the top of the inbox fills first, and each
 * after the last so a part read from the disk never lands over a newer change. Told once the last part is in.
 */
function apply({ reset, changes, mailboxes, seq }: Pick<Changes, 'reset' | 'changes' | 'mailboxes' | 'seq'>): Promise<void> {
  const ordered = changes.toSorted((a, b) => (b.value?.newestAt ?? Infinity) - (a.value?.newestAt ?? Infinity));
  const done = applying.then(async () => {
    for (let at = 0; at === 0 || at < ordered.length; at += PART) {
      if (at > 0) await new Promise((next) => setTimeout(next));
      writePart({ reset: reset && at === 0, changes: ordered.slice(at, at + PART), mailboxes });
    }
    held = Math.max(held, seq);
    told();
  });
  applying = done.catch(() => {});
  return done;
}

function writePart({ reset, changes, mailboxes }: Pick<Changes, 'reset' | 'changes' | 'mailboxes'>) {
  if (!sync) return;
  const { begin, write, commit } = sync;
  begin(reset ? { snapshot: true } : undefined);
  const theirs = new Set(mailboxes);
  for (const { key, value } of changes) {
    const message: ChangeMessageOrDeleteKeyMessage<Copied, string> | null = value
      ? { type: !reset && conversations().has(key) ? 'update' : 'insert', value }
      : !reset && conversations().has(key)
        ? { type: 'delete', key }
        : null;
    if (message) write(message);
  }
  // Removing a mailbox marks none of its conversations: what is not theirs any more goes.
  if (!reset) for (const row of conversations().state.values()) if (!theirs.has(row.accountId)) write({ type: 'delete', key: row.key });
  void commit();
}

let disk: Promise<{ db: IDBPDatabase<Kept>; key: CryptoKey } | null> | null = null;

/** The copy on the disk, or null where there is none to keep: the browser cannot encrypt, or keeps nothing. */
function onDisk() {
  return (disk ??= (async () => {
    const key = await deviceKey();
    if (!key) return null;
    const db = await openDB<Kept>(DATABASE, 1, {
      upgrade: (upgrading) => {
        upgrading.createObjectStore('conversations', { keyPath: 'key' }).createIndex('at', 'at');
        upgrading.createObjectStore('standing');
      },
    });
    return { db, key };
  })().catch(() => null));
}

/** Read what the disk holds into the collection, newest first, the first screen before the rest. A copy under another key, from someone signed in before, is dropped. */
async function load(markReady: () => void) {
  const kept = await onDisk();
  if (!kept) return;
  const { db, key } = kept;
  const sealed = await db.get('standing', 'standing');
  standing = sealed ? await unseal<Standing>(key, 'standing', sealed).catch(() => null) : null;
  if (!standing) {
    await db.clear('conversations');
    return;
  }
  const rows = (await db.getAllFromIndex('conversations', 'at')).toReversed();
  const opened = async (part: typeof rows) =>
    await Promise.all(part.map(async (r) => ({ key: r.key, value: copiedOf(await unseal<SyncedConversation>(key, r.key, r.sealed)) })));
  await apply({ reset: true, changes: await opened(rows.slice(0, FIRST)), mailboxes: standing.mailboxes, seq: standing.seq });
  markReady();
  await apply({ reset: false, changes: await opened(rows.slice(FIRST)), mailboxes: standing.mailboxes, seq: standing.seq });
  whole = true;
  told();
}

/** Keep what changed on the disk, and where the copy now stands. */
async function keep({ reset, changes, mailboxes, seq, cursor }: Changes) {
  const kept = await onDisk();
  if (!kept) return;
  const { db, key } = kept;
  const sealed = await Promise.all(changes.map(async (c) => ({ ...c, sealed: c.value ? await seal(key, c.key, c.value.conversation) : null })));
  const tx = db.transaction(['conversations', 'standing'], 'readwrite');
  const store = tx.objectStore('conversations');
  if (reset) await store.clear();
  for (const c of sealed) await (c.sealed && c.value ? store.put({ key: c.key, at: c.value.newestAt, sealed: c.sealed }) : store.delete(c.key));
  await tx.objectStore('standing').put(await seal(key, 'standing', { cursor, seq, mailboxes }), 'standing');
  await tx.done;
}

let channel: BroadcastChannel | null = null;
let leading = false;
let asking: Promise<void> | null = null;
let again = false;

/** Everything that changed since the copy last asked, every page of it, kept and handed to the other tabs. */
async function askOnce() {
  const pages: SyncPage[] = [];
  let since = standing?.cursor ?? null;
  do {
    const page = await api.sync(since, AbortSignal.timeout(60_000));
    // A reset partway (Inbox turned off meanwhile) starts the whole copy again from that page.
    if (page.reset) pages.length = 0;
    pages.push(page);
    since = page.cursor;
  } while (pages.at(-1)!.more);
  const last = pages.at(-1)!;
  const byKey = new Map(
    pages.flatMap((p) => p.conversations).map((c) => [copiedKey(c.accountId, c.threadId), c.conversation ? copiedOf(c.conversation) : null] as const),
  );
  const changes: Changes = {
    reset: pages[0].reset,
    changes: [...byKey].map(([key, value]) => ({ key, value })),
    mailboxes: last.mailboxes,
    seq: last.seq,
    cursor: last.cursor,
  };
  standing = { cursor: last.cursor, seq: last.seq, mailboxes: last.mailboxes };
  if (changes.reset) whole = true;
  await apply(changes);
  channel?.postMessage(changes);
  await keep(changes).catch(() => {});
}

/** Ask the feed now, once at a time: asked again meanwhile, it asks once more after. */
function ask(): void {
  if (!leading) {
    channel?.postMessage('ask');
    return;
  }
  if (asking) {
    again = true;
    return;
  }
  asking = (async () => {
    do {
      again = false;
      await askOnce().catch((error: unknown) => sync?.reportError(error));
    } while (again);
  })().finally(() => (asking = null));
}

let collection: Collection<Copied, string> | null = null;

/** The copy's conversations. Made, and started, the first time it is asked for, in the browser. */
export function conversations(): Collection<Copied, string> {
  return (collection ??= createCollection<Copied, string>({
    id: 'conversations',
    getKey: (row) => row.key,
    startSync: true,
    sync: {
      rowUpdateMode: 'full',
      sync: (params) => {
        sync = params;
        channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
        channel?.addEventListener('message', ({ data }: MessageEvent<Changes | 'ask'>) => {
          if (data === 'ask') {
            if (leading) ask();
          } else if (!leading) {
            standing = { cursor: data.cursor, seq: data.seq, mailboxes: data.mailboxes };
            if (data.reset) whole = true;
            void apply(data);
          }
        });
        let ready = false;
        const markReady = () => {
          if (ready) return;
          ready = true;
          params.markReady();
        };
        void load(markReady)
          .catch(() => {})
          .finally(() => {
            // One tab asks for all of them; another takes over when it closes.
            const lead = () => {
              leading = true;
              ask();
            };
            if ('locks' in navigator) void navigator.locks.request(DATABASE, () => (lead(), new Promise<never>(() => {})));
            else lead();
            const first = () => (whole ? markReady() : undefined);
            listeners.add(first);
          });
        const timer = setInterval(() => document.visibilityState === 'visible' && ask(), ASK_MS);
        const shown = () => document.visibilityState === 'visible' && ask();
        document.addEventListener('visibilitychange', shown);
        const back = onlineManager.subscribe((online) => online && ask());
        onWrite((seq) => {
          wanted = Math.max(wanted, seq);
          ask();
        });
        return () => {
          clearInterval(timer);
          document.removeEventListener('visibilitychange', shown);
          back();
          channel?.close();
          sync = null;
        };
      },
    },
  }));
}

/** The copy's row for a conversation, where the copy has been started and holds it. */
export const copied = (key: string): Copied | undefined => collection?.get(key);

/** Whether the whole copy is here, so an empty list means there is nothing, not that it has not arrived. */
export function useWhole(): boolean {
  return useSyncExternalStore(
    (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    () => whole,
    () => false,
  );
}

/** Resolves once the copy holds every write this page made, so rows a press hid do not come back meanwhile. */
export function caughtUp(): Promise<void> {
  if (!collection || held >= wanted) return Promise.resolve();
  return new Promise((done) => {
    const check = () => {
      if (held < wanted) return;
      listeners.delete(check);
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(() => (listeners.delete(check), done()), HOLD_MS);
    listeners.add(check);
  });
}

/**
 * Mark conversations the copy holds read or unread at once, while the change goes to Gmail: `work` sends it, and the
 * copy then shows what Gmail took. Undone if it fails.
 */
export const markCopied = createOptimisticAction<{ keys: readonly string[]; unread: boolean; work: () => Promise<void> }>({
  onMutate: ({ keys, unread }) => {
    for (const key of keys)
      conversations().update(key, (draft) => {
        const messages = draft.conversation.messages.map((m, i, all) => ({
          ...m,
          labelIds: unread
            ? i === all.length - 1 && !m.labelIds.includes('UNREAD')
              ? [...m.labelIds, 'UNREAD']
              : m.labelIds
            : m.labelIds.filter((l) => l !== 'UNREAD'),
        }));
        draft.unread = unread;
        draft.conversation = { ...draft.conversation, messages };
      });
  },
  mutationFn: async ({ work }) => {
    await work();
    await caughtUp();
  },
});

/** Forget the copy on this device, at sign-out. */
export async function dropCopy(): Promise<void> {
  const kept = await disk;
  kept?.db.close();
  await deleteDB(DATABASE).catch(() => {});
}
