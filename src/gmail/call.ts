import { traced } from '../telemetry.ts';
import type { Pace } from './quota.ts';

/** One Gmail request, by the API's name for its method and what it costs of the quota. */
export type Call = <T>(method: string, units: number, request: () => Promise<{ data: T; status: number }>) => Promise<T>;

export const isNotFound = (error: unknown) => {
  const e = error as { status?: unknown; code?: unknown };
  return e?.status === 404 || e?.code === 404 || e?.code === '404';
};

/**
 * Requests that each wait their turn under the mailbox's quota, then go as an `http.client` span named by the
 * method alone: the path would name the message. A 404 is an answer (the message is gone), not a failure.
 */
export const calls =
  (pace: Pace): Call =>
  async (method, units, request) => {
    await pace(units);
    const settled = await traced('http.client', `gmail ${method}`, { 'server.address': 'gmail.googleapis.com', 'sift.quota_units': units }, async (span) => {
      try {
        const response = await request();
        span.set({ 'http.response.status_code': response.status });
        return { data: response.data };
      } catch (error) {
        const status = (error as { status?: unknown }).status;
        if (typeof status === 'number') span.set({ 'http.response.status_code': status });
        if (!isNotFound(error)) span.fail();
        return { error };
      }
    });
    if ('error' in settled) throw settled.error;
    return settled.data;
  };
