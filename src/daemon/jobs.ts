/** Work for the daemon, small enough to go through a hosted queue: ids, never mail. */
export type Job =
  | { kind: 'pass'; person: number; account: string }
  | { kind: 'upkeep'; person: number }
  | { kind: 'backfill'; person: number; account: string; days: number }
  | { kind: 'eval'; person: number; run: number }
  | { kind: 'chatgpt-sign-in'; person: number };

/**
 * Where jobs are sent. A queue may deliver a job twice, so running one twice must be harmless: a pass
 * claims its mailbox before it starts (`lock:pass:<mailbox>`).
 */
export interface Jobs {
  /** Run `job`, after `delayMs` when given. */
  send(job: Job, delayMs?: number): void;
}

/**
 * How long a local job may run before it stops and sends itself again, as a hosted function's time limit
 * would make it, so the same path runs everywhere.
 */
const LOCAL_JOB_MS = 5 * 60_000;

/**
 * Passes run this many at a time: enough that one mailbox's backlog (a minute-long model call, a sync
 * waiting on Gmail's quota) does not hold up everyone's new mail.
 */
const AT_ONCE = 4;

const keyOf = (job: Job) => {
  switch (job.kind) {
    case 'pass':
      return `pass:${job.person}:${job.account}`;
    case 'upkeep':
      return `upkeep:${job.person}`;
    case 'backfill':
      return `backfill:${job.person}:${job.account}`;
    case 'eval':
      return `eval:${job.person}:${job.run}`;
    case 'chatgpt-sign-in':
      return `chatgpt-sign-in:${job.person}`;
  }
};

/**
 * Runs jobs in this process. A job already waiting is not queued again, and two alike never run together.
 * `run` must not reject. `stop` drops what is waiting or delayed and resolves once the running jobs end.
 */
export function localJobs(run: (job: Job, until: number) => Promise<void>): Jobs & { stop(): Promise<void> } {
  const waiting: Job[] = [];
  const running = new Map<string, Promise<void>>();
  const delayed = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;
  const pump = () => {
    if (stopped) return;
    while (running.size < AT_ONCE) {
      const next = waiting.findIndex((job) => !running.has(keyOf(job)));
      if (next < 0) return;
      const job = waiting.splice(next, 1)[0]!;
      const key = keyOf(job);
      running.set(
        key,
        run(job, Date.now() + LOCAL_JOB_MS).finally(() => {
          running.delete(key);
          pump();
        }),
      );
    }
  };
  const send = (job: Job, delayMs = 0) => {
    if (stopped) return;
    if (delayMs > 0) {
      const timer = setTimeout(() => {
        delayed.delete(timer);
        send(job);
      }, delayMs);
      delayed.add(timer);
      return;
    }
    if (waiting.some((queued) => keyOf(queued) === keyOf(job))) return;
    waiting.push(job);
    pump();
  };
  return {
    send,
    async stop() {
      stopped = true;
      waiting.length = 0;
      for (const timer of delayed) clearTimeout(timer);
      delayed.clear();
      await Promise.all(running.values());
    },
  };
}
