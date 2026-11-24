import { onlineManager } from '@tanstack/react-query';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { api } from './api/endpoints.ts';
import { failure } from './api/client.ts';
import { queryClientFor } from './api/query.ts';
import { changeCopied, copied, copiedKey, opened } from './copy.ts';
import { type Sealed, device, seal, unseal } from './device.ts';
import { reportError } from './telemetry.ts';
import { type Change, tellFailed, tellWaiting } from './waiting.ts';

/**
 * Inbox's presses on the way to Gmail (docs/sync.md): kept on the device before anything is shown, so a press is never
 * lost to a closed tab, a page put away and killed, or a network that is not there. Each is shown at once, in the copy
 * where it holds the conversation and hidden from a list where it does not, until Mild has it; a press with a toast is
 * held while the toast shows, so Undo sends nothing. One that cannot reach Mild waits and goes when it can; Mild busy
 * or failing is asked again, a few times; only a refusal comes back, undoing what was shown. A conversation's presses go
 * in the order they were made. Sending one twice is safe: Mild reads the message's labels first and skips what is done.
 */

/** One conversation's part of a press: unread is sent for its newest message alone, as Gmail marks it. */
export interface Pressed {
  accountId: string;
  threadId: string;
  messageIds: readonly string[];
}
interface Press {
  change: Change;
  conversations: Pressed[];
}
interface Entry extends Press {
  id: string;
  /** The tab that holds it, which alone sends it while that tab is open. */
  tab: string;
  at: number;
  /** Held while its toast shows. */
  held: boolean;
  sending: boolean;
  tries: number;
  keys: string[];
}

interface Kept extends DBSchema {
  presses: { key: string; value: { id: string; tab: string; at: number; sealed: Sealed } };
}

const DATABASE = 'sift-outbox';
const CHANNEL = 'sift-outbox';
/** Busy or failing, how many times a press is sent before it is taken as refused. Unreachable waits for as long as it takes. */
const MOST_TRIES = 5;
const RETRY_MS = 2000;
/** Without Web Locks to say which tabs are open, a press this old is taken as left by a closed one. */
const LEFT_MS = 5 * 60_000;

const TAB = 'document' in globalThis ? crypto.randomUUID() : '';
const tabLock = (tab: string) => `sift-tab:${tab}`;
// Held while this tab is open, so another can tell its presses from those of one closed.
if (TAB && 'locks' in navigator) void navigator.locks.request(tabLock(TAB), () => new Promise<never>(() => {}));

const entries = new Map<string, Entry>();
const outcomes = new Map<string, { sent: () => void; refused: (error: Error) => void }>();
const listeners = new Set<() => void>();
function told() {
  const hidden = new Set([...entries.values()].filter((e) => e.change === 'archive' || e.change === 'spam').flatMap((e) => e.keys));
  tellWaiting({ waiting: entries.size, hidden });
  for (const listener of listeners) listener();
}

let disk: Promise<{ db: IDBPDatabase<Kept>; key: CryptoKey } | null> | null = null;
/** Where presses are kept, or null where the browser cannot encrypt or keep anything: then only this tab holds them. */
function onDisk() {
  return (disk ??= (async () => {
    const key = (await device())?.key;
    if (!key) return null;
    const db = await openDB<Kept>(DATABASE, 1, {
      upgrade: (upgrading) => void upgrading.createObjectStore('presses', { keyPath: 'id' }),
      // Wiped with the device at sign-out, which waits until every connection to it is closed.
      blocking: () => {
        db.close();
        disk = null;
      },
    });
    return { db, key };
  })().catch(() => null));
}

// Every read and write awaits its transaction whole: idb's own reads leave theirs unawaited, which a page leaving aborts.
async function keep(entry: Entry) {
  const kept = await onDisk();
  if (!kept) return;
  const sealed = await seal(kept.key, entry.id, { change: entry.change, conversations: entry.conversations } satisfies Press);
  const tx = kept.db.transaction('presses', 'readwrite');
  await Promise.all([tx.store.put({ id: entry.id, tab: entry.tab, at: entry.at, sealed }), tx.done]);
}

async function drop(id: string) {
  const kept = await onDisk();
  if (!kept) return;
  const tx = kept.db.transaction('presses', 'readwrite');
  await Promise.all([tx.store.delete(id), tx.done]);
}

/** Takes a closed tab's press for this one, unless another tab took it first. */
async function claim(id: string, from: string): Promise<boolean> {
  const kept = await onDisk();
  if (!kept) return false;
  const tx = kept.db.transaction('presses', 'readwrite');
  const take = async () => {
    const row = await tx.store.get(id);
    if (row?.tab !== from) return false;
    await tx.store.put({ ...row, tab: TAB });
    return true;
  };
  const [taken] = await Promise.all([take(), tx.done]);
  return taken;
}

const channel = TAB && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
/** What one tab tells the others: a press made, shown there at once, which only the tab that made it sends; or how one settled. */
type Heard = { added: Press & { id: string; tab: string; at: number } } | { settled: string; refused: string | null };
const tell = (heard: Heard) => channel?.postMessage(heard);
channel?.addEventListener('message', ({ data }: MessageEvent<Heard>) => {
  if ('settled' in data) return settle(data.settled, data.refused);
  const { added } = data;
  if (entries.has(added.id)) return;
  const entry: Entry = { ...added, held: false, sending: false, tries: 0, keys: keysOf(added.conversations) };
  entries.set(entry.id, entry);
  show(entry);
  told();
});

/**
 * Shows a press until it settles: in the copy where it holds every conversation (`changeCopied`, which then waits for the
 * copy to hold what Mild did), and in `useOutbox().hidden` (`web/src/lib/waiting.ts`) for a list that is not the copy's.
 */
function show(entry: Entry) {
  const done = new Promise<void>((sent, refused) => outcomes.set(entry.id, { sent, refused }));
  const inCopy = entry.keys.filter((key) => copied(key));
  if (inCopy.length > 0)
    void changeCopied({ keys: inCopy, change: entry.change, work: () => done })
      .when('settled')
      .catch(() => {});
  else void done.catch(() => {});
}

function settle(id: string, refused: string | null) {
  const entry = entries.get(id);
  if (!entry) return;
  entries.delete(id);
  const outcome = outcomes.get(id);
  outcomes.delete(id);
  if (refused === null) outcome?.sent();
  else outcome?.refused(new Error(refused));
  told();
  // A list that is not the copy's shows what Mild did once it loads again.
  if (refused === null) void queryClientFor().invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith('mail-threads') });
  pump();
}

/** Every press on the disk this tab does not know yet, shown; and those of a tab since closed, taken to send. */
async function look() {
  const kept = await onDisk();
  if (!kept) return;
  const tx = kept.db.transaction('presses');
  const [rows] = await Promise.all([tx.store.getAll(), tx.done]);
  const open = 'locks' in navigator ? new Set((await navigator.locks.query()).held?.map((lock) => lock.name)) : null;
  for (const row of rows.toSorted((a, b) => a.at - b.at)) {
    const left = open ? !open.has(tabLock(row.tab)) : row.at < Date.now() - LEFT_MS;
    if (entries.has(row.id) && !(left && row.tab !== TAB)) continue;
    const press = await unseal<Press>(kept.key, row.id, row.sealed).catch(() => null);
    // Sealed under a key this device no longer holds: someone signed in before.
    if (!press) {
      await drop(row.id);
      continue;
    }
    const known = entries.get(row.id);
    const entry: Entry = known ?? { ...press, id: row.id, tab: row.tab, at: row.at, held: false, sending: false, tries: 0, keys: keysOf(press.conversations) };
    if (!known) {
      entries.set(row.id, entry);
      show(entry);
    }
    if (left && (await claim(row.id, row.tab))) entry.tab = TAB;
  }
  told();
  pump();
}

const keysOf = (conversations: readonly Pressed[]) => conversations.map((c) => copiedKey(c.accountId, c.threadId));

/** Sends every press of this tab that is due and waits on no earlier press of the same conversation. */
function pump() {
  if (!onlineManager.isOnline()) return;
  const ahead = new Set<string>();
  for (const entry of [...entries.values()].toSorted((a, b) => a.at - b.at)) {
    const waits = entry.keys.some((key) => ahead.has(key));
    for (const key of entry.keys) ahead.add(key);
    if (waits || entry.held || entry.sending || entry.tab !== TAB) continue;
    void send(entry);
  }
}

async function send(entry: Entry) {
  entry.sending = true;
  try {
    const replies = await Promise.all(
      [...Map.groupBy(entry.conversations, (c) => c.accountId)].map(([accountId, mine]) =>
        api.changeMail({
          accountId,
          messageIds: mine.flatMap((c) => (entry.change === 'unread' ? c.messageIds.slice(-1) : c.messageIds)),
          change: entry.change,
        }),
      ),
    );
    await drop(entry.id).catch(reportError);
    tell({ settled: entry.id, refused: null });
    settle(entry.id, null);
    // What Gmail took stays as it is; what it did not, the copy shows once it has what Mild did.
    if (replies.some((reply) => reply.missed > 0))
      tellFailed({
        change: entry.change,
        count: entry.conversations.length,
        why: `Gmail did not take ${entry.conversations.length === 1 ? 'it' : 'all of them'}. Try again.`,
      });
  } catch (error) {
    entry.sending = false;
    const why = failure(error);
    // Not reached: tried again once Mild answers (`onlineManager`). Signed out: the sign-in screen takes over.
    if (why === 'unreachable' || why === 'signed out') return;
    if (why === 'busy' && ++entry.tries < MOST_TRIES) {
      setTimeout(pump, RETRY_MS * 2 ** (entry.tries - 1));
      return;
    }
    const words = error instanceof Error ? error.message : String(error);
    await drop(entry.id).catch(reportError);
    tell({ settled: entry.id, refused: words });
    settle(entry.id, words);
    tellFailed({ change: entry.change, count: entry.conversations.length, why: words });
  }
}

if (TAB) {
  onlineManager.subscribe((online) => online && pump());
  // What a closed tab left, once the copy holds the conversations it shows in.
  void opened.then(look);
}

/** A press made here: `send` lets a held one go, and `cancel` takes it back, true while it has not been sent. */
export interface Handle {
  send: () => void;
  cancel: () => boolean;
}

/** Make a press: shown at once, and sent now, or with `held` once `send` is called. */
export function press(change: Change, conversations: readonly Pressed[], held: boolean): Handle {
  const entry: Entry = {
    id: crypto.randomUUID(),
    tab: TAB,
    at: Date.now(),
    change,
    conversations: conversations.map(({ accountId, threadId, messageIds }) => ({ accountId, threadId, messageIds: [...messageIds] })),
    held,
    sending: false,
    tries: 0,
    keys: keysOf(conversations),
  };
  entries.set(entry.id, entry);
  show(entry);
  told();
  tell({ added: { id: entry.id, tab: TAB, at: entry.at, change, conversations: entry.conversations } });
  // On the disk before it can be sent, so a press sent and then lost with its tab is still there to send again.
  const kept = keep(entry).catch(reportError);
  const go = () => {
    entry.held = false;
    void kept.then(pump);
  };
  if (!held) go();
  return {
    send: go,
    cancel: () => {
      if (!entries.has(entry.id) || entry.sending || !entry.held) return false;
      void kept.then(() => drop(entry.id)).catch(reportError);
      tell({ settled: entry.id, refused: null });
      settle(entry.id, null);
      return true;
    },
  };
}

/** Sends everything this tab holds now, held or not, and waits for it, for at most `ms`: before signing out, which wipes the device. */
export async function sendAll(ms: number): Promise<void> {
  for (const entry of entries.values()) entry.held = false;
  pump();
  await new Promise<void>((done) => {
    const check = () => {
      if ([...entries.values()].some((e) => e.tab === TAB)) return;
      listeners.delete(check);
      done();
    };
    listeners.add(check);
    setTimeout(() => (listeners.delete(check), done()), ms);
    check();
  });
}
