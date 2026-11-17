import { type Ephemeral, memoryEphemeral, tracedEphemeral } from './ephemeral.ts';
import { redisEphemeral } from './redis.ts';

/** Redis when one is given, each call traced; otherwise this process's memory, which holds only while one process runs. */
export const openEphemeral = async (redisUrl: string | undefined): Promise<Ephemeral> =>
  redisUrl ? tracedEphemeral(await redisEphemeral(redisUrl)) : memoryEphemeral();
