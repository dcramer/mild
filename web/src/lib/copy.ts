import { type ChangeMessageOrDeleteKeyMessage, type Collection, type SyncConfig, createCollection, createOptimisticAction } from '@tanstack/react-db';
import { onlineManager } from '@tanstack/react-query';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { useSyncExternalStore } from 'react';
import { type MailConversation, type SyncPage, type SyncedConversation, api } from './api/endpoints.ts';
import { onWrite } from './api/client.ts';
import { type Sealed, device, seal, unseal } from './device.ts';
import { timed } from './trace.ts';
import { idle } from './utils.ts';

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

const DATABASE = 'sift-copy';
const CHANNEL = 'sift-copy';
/**
 * Read first from the disk, before the rest is decrypted: more than Inbox draws at first (`COPY_PAGE`, and one to know
 * there are more), so the rest, all older, leaves its rows as they are instead of drawing them again.
 */
const FIRST = 120;
/** How often the page asks for what changed while it is in view. Mail reaches Mild at the minute tick's pace. */
const ASK_MS = 30_000;
/** How long a press waits for the copy to hold its change before letting go of the rows it hid. */
const HOLD_MS = 10_000;
/**
 * When the page asks the feed again for conversations an answer moves out of the inbox, each wait after the last: about
 * half a minute in all, which a pass on a host that begins runs late still fits. Spaced out, so it is a few asks, not a poll.
 */
const MOVING_MS = [2_000, 4_000, 8_000, 16_000];

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
 * What the feed has changed since the copy began reading the disk, by key, so the rest read from the disk after it does not
 * put back what it replaced; null once the feed began the copy again, which leaves the rest nothing to add.
 */
let fresher: Set<string> | null = new Set();

/**
 * Write changes into the collection, a part at a time, newest first so the top of the inbox fills first, and each after
 * the last. What was read from the disk (`disk`) leaves out what the feed has changed meanwhile. Told once the last part is in.
 */
function apply({ reset, changes, mailboxes, seq }: Pick<Changes, 'reset' | 'changes' | 'mailboxes' | 'seq'>, disk = false): Promise<void> {
  if (!disk) {
    if (reset) fresher = null;
    else for (const { key } of changes) fresher?.add(key);
  }
  const done = applying.then(async () => {
    // The disk's first part, read before anything was asked, is the copy's start, and taken whole.
    const kept = disk && !reset ? (fresher ? changes.filter(({ key }) => !fresher!.has(key)) : []) : changes;
    const ordered = kept.toSorted((a, b) => (b.value?.newestAt ?? Infinity) - (a.value?.newestAt ?? Infinity));
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
    const key = (await device())?.key;
    if (!key) return null;
    const db = await openDB<Kept>(DATABASE, 1, {
      upgrade: (upgrading) => {
        upgrading.createObjectStore('conversations', { keyPath: 'key' }).createIndex('at', 'at');
        upgrading.createObjectStore('standing');
      },
      // Wiped by the device (sign-out, here or in another tab), which waits until every connection to it is closed.
      blocking: () => {
        db.close();
        disk = null;
      },
    });
    return { db, key };
  })().catch(() => null));
}

/** Read what the disk holds into the collection, newest first, the first screen before the rest. A copy under another key, from someone signed in before, is dropped. */
async function load(markReady: () => void) {
  let start = performance.now();
  const kept = await onDisk();
  timed('Copy opened', 'mild.copy', start, { kept: kept !== null });
  if (!kept) return;
  const { db, key } = kept;
  start = performance.now();
  // idb's own reads (db.get) leave their transaction's done unawaited: aborted under them, as by the page leaving at
  // sign-out, it is an unhandled rejection. Every read and write here awaits its transaction whole.
  const stands = db.transaction('standing');
  const [sealed] = await Promise.all([stands.store.get('standing'), stands.done]);
  standing = sealed ? await unseal<Standing>(key, 'standing', sealed).catch(() => null) : null;
  // A copy under another key, from someone signed in before. With nothing kept yet, another tab may be writing the first.
  if (sealed && !standing) await db.clear('conversations');
  if (!standing) return;
  // The newest first: reading all of them first is most of the wait at thousands. A cursor stepping through them is a
  // trip to the database each, so it goes once to the oldest of the first, and they are read from there in one.
  const tx = db.transaction('conversations');
  const at = tx.store.index('at');
  const newest = async () => {
    const cursor = await at.openKeyCursor(null, 'prev');
    const oldest = cursor ? ((await cursor.advance(FIRST - 1)) ?? null) : null;
    return await at.getAll(oldest ? IDBKeyRange.lowerBound(oldest.key) : undefined);
  };
  const first = (await Promise.all([newest(), tx.done]))[0].toReversed();
  timed('Copy read', 'mild.copy', start, { rows: first.length });
  const opened = async (part: typeof first) =>
    await Promise.all(part.map(async (r) => ({ key: r.key, value: copiedOf(await unseal<SyncedConversation>(key, r.key, r.sealed)) })));
  start = performance.now();
  await apply({ reset: true, changes: await opened(first), mailboxes: standing.mailboxes, seq: standing.seq }, true);
  timed("Copy's first screen", 'mild.copy', start, { rows: first.length });
  markReady();
  // The rest once the first screen is drawn, which would otherwise wait on it.
  await idle();
  start = performance.now();
  const read = new Set(first.map((r) => r.key));
  const all = db.transaction('conversations');
  const rest = (await Promise.all([all.store.index('at').getAll(), all.done]))[0].filter((r) => !read.has(r.key)).toReversed();
  await apply({ reset: false, changes: await opened(rest), mailboxes: standing.mailboxes, seq: standing.seq }, true);
  timed("Copy's rest", 'mild.copy', start, { rows: rest.length });
  whole = true;
  told();
}

/** Keep what changed on the disk, and where the copy now stands. */
async function keep({ reset, changes, mailboxes, seq, cursor }: Changes) {
  const kept = await onDisk();
  if (!kept) return;
  const { db, key } = kept;
  const sealed = await Promise.all(changes.map(async (c) => ({ ...c, sealed: c.value ? await seal(key, c.key, c.value.conversation) : null })));
  // Sealed before the transaction: one waiting on anything but the database commits meanwhile.
  const where = await seal(key, 'standing', { cursor, seq, mailboxes });
  const tx = db.transaction(['conversations', 'standing'], 'readwrite');
  const store = tx.objectStore('conversations');
  await Promise.all([
    ...(reset ? [store.clear()] : []),
    ...sealed.map((c) => (c.sealed && c.value ? store.put({ key: c.key, at: c.value.newestAt, sealed: c.sealed }) : store.delete(c.key))),
    tx.objectStore('standing').put(where, 'standing'),
    tx.done,
  ]);
}

let channel: BroadcastChannel | null = null;
let leading = false;
let asking: Promise<void> | null = null;
let again = false;

/** Everything that changed since the copy last asked, every page of it, kept and handed to the other tabs. */
async function askOnce(mine = true) {
  const start = performance.now();
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
  timed('Copy asked Mild', 'mild.copy', start, { pages: pages.length, changes: changes.changes.length, reset: changes.reset });
  // Only the tab that asks for them all keeps and hands on what it was told.
  if (!mine) return;
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
let loaded: () => void = () => {};
/** Settles once the copy has read what the device kept, and so holds every conversation a press there could be on. */
export const opened = new Promise<void>((done) => (loaded = done));

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
        // Asked as soon as the first screen is drawn from the disk, not once the rest is read: that waits on the page being
        // idle, and a reopened page would show nothing new until then.
        let begun = false;
        const begin = () => {
          if (begun) return;
          begun = true;
          // One tab asks for all of them; another takes over when it closes.
          const lead = () => {
            leading = true;
            ask();
          };
          const hold = () => (lead(), new Promise<never>(() => {}));
          if ('locks' in navigator)
            void navigator.locks.request(DATABASE, { ifAvailable: true }, (lock) => {
              if (lock) return hold();
              // Another tab asks, and hands on only what changed since then. This one asks once for itself as it opens, from
              // where its own copy stands, so it is up to date without waiting on that tab (which, on a reload, is the page
              // going away): the whole copy where the disk holds none yet, as that tab may still be writing it.
              void askOnce(false).catch((error: unknown) => sync?.reportError(error));
              void navigator.locks.request(DATABASE, hold);
              return undefined;
            });
          else lead();
          const first = () => (whole ? markReady() : undefined);
          listeners.add(first);
          // Another tab may have handed over the whole copy while this one read its disk.
          first();
        };
        void load(() => {
          markReady();
          begin();
        })
          .catch(() => {})
          .finally(() => {
            loaded();
            begin();
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
function caughtUp(): Promise<void> {
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

/** What a press does to a conversation: unread is on its newest message only, as Gmail marks it. */
type Change = 'archive' | 'spam' | 'read' | 'unread';

function changed(labelIds: readonly string[], change: Change, newest: boolean): string[] {
  const without = (...labels: string[]) => labelIds.filter((l) => !labels.includes(l));
  if (change === 'archive') return without('INBOX');
  if (change === 'spam') return [...without('INBOX', 'SPAM'), 'SPAM'];
  if (change === 'read') return without('UNREAD');
  return newest && !labelIds.includes('UNREAD') ? [...labelIds, 'UNREAD'] : [...labelIds];
}

/**
 * Resolves once the copy holds none of `keys` in the inbox, or has stopped asking. An answer is carried out by the pass it
 * begins, after its write, so the counter its reply gives does not cover the move: the feed is asked again until it does.
 */
export async function leftInbox(keys: readonly string[]): Promise<void> {
  const out = () => keys.every((key) => conversations().get(key)?.inbox !== true);
  for (const wait of MOVING_MS) {
    await new Promise((later) => setTimeout(later, wait));
    if (out()) return;
    ask();
  }
}

/**
 * Change conversations the copy holds at once, while `work` sends the change to Gmail: the copy then shows what Gmail
 * took. Undone if `work` fails, and dropped once it is done without sending anything (Undo).
 */
export const changeCopied = createOptimisticAction<{ keys: readonly string[]; change: Change; work: () => Promise<void> }>({
  onMutate: ({ keys, change }) => {
    for (const key of keys)
      conversations().update(key, (draft) => {
        const messages = draft.conversation.messages.map((m, i, all) => ({ ...m, labelIds: changed(m.labelIds, change, i === all.length - 1) }));
        const labels = new Set(messages.flatMap((m) => m.labelIds));
        draft.inbox = labels.has('INBOX');
        draft.unread = labels.has('UNREAD');
        draft.conversation = { ...draft.conversation, messages };
      });
  },
  mutationFn: async ({ work }) => {
    await work();
    await caughtUp();
  },
});
