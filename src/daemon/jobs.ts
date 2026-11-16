/** Work for the daemon, small enough to go through a hosted queue: ids, never mail. */
export type Job = { kind: 'pass'; person: number; account: string } | { kind: 'upkeep'; person: number };

/**
 * Where jobs are sent. A queue may deliver a job twice, so running one twice must be harmless: a pass
 * claims its mailbox before it starts (`claimMailbox`).
 */
export interface Jobs {
  send(job: Job): void;
}

/**
 * Passes run this many at a time: enough that one mailbox's backlog (a minute-long model call, a sync
 * waiting on Gmail's quota) does not hold up everyone's new mail.
 */
const AT_ONCE = 4;

const keyOf = (job: Job) => (job.kind === 'pass' ? `pass:${job.person}:${job.account}` : `upkeep:${job.person}`);

/**
 * Runs jobs in this process. A job already waiting is not queued again, and two alike never run together.
 * `run` must not reject. `stop` drops what is waiting and resolves once the running jobs end.
 */
export function localJobs(run: (job: Job) => Promise<void>): Jobs & { stop(): Promise<void> } {
  const waiting: Job[] = [];
  const running = new Map<string, Promise<void>>();
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
        run(job).finally(() => {
          running.delete(key);
          pump();
        }),
      );
    }
  };
  return {
    send(job) {
      if (stopped || waiting.some((queued) => keyOf(queued) === keyOf(job))) return;
      waiting.push(job);
      pump();
    },
    async stop() {
      stopped = true;
      waiting.length = 0;
      await Promise.all(running.values());
    },
  };
}
