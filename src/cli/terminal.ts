import { type Interface, createInterface } from 'node:readline';

// One reader for the whole process. Separate readers each buffer ahead, so a second one would miss
// lines the first already took; that loses answers when input is piped or pasted quickly.
let reader: Interface | undefined;
let ended = false;
const buffered: string[] = [];
const waiting: ((line: string | null) => void)[] = [];

function start(): void {
  if (reader) return;
  reader = createInterface({ input: process.stdin });
  reader.on('line', (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else buffered.push(line);
  });
  reader.on('close', () => {
    ended = true;
    for (const waiter of waiting.splice(0)) waiter(null);
  });
}

/** The next line of input. Null when input has ended, or when `signal` aborts before a line arrives. */
export function readLine(signal?: AbortSignal): Promise<string | null> {
  start();
  const ready = buffered.shift();
  if (ready !== undefined) return Promise.resolve(ready);
  if (ended || signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const waiter = (line: string | null) => {
      signal?.removeEventListener('abort', onAbort);
      resolve(line);
    };
    const onAbort = () => {
      const at = waiting.indexOf(waiter);
      if (at !== -1) waiting.splice(at, 1);
      resolve(null);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    waiting.push(waiter);
  });
}

/**
 * Ask one question and return the trimmed answer. If `signal` aborts first (something else answered
 * for the user, such as a browser callback) the answer is an empty string. Throws if input has ended.
 */
export async function ask(question: string, signal?: AbortSignal): Promise<string> {
  process.stdout.write(`${question} `);
  const line = await readLine(signal);
  if (line === null) {
    process.stdout.write('\n');
    if (signal?.aborted) return '';
    throw new Error('Input ended before this question was answered.');
  }
  return line.trim();
}

/** Stop reading input so the process can exit. */
export function closeTerminal(): void {
  reader?.close();
}
