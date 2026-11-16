import { type Ephemeral, memoryEphemeral } from './ephemeral.ts';
import { redisEphemeral } from './redis.ts';

/** Redis when one is given; otherwise this process's memory, which holds only while one process runs. */
export const openEphemeral = async (redisUrl: string | undefined): Promise<Ephemeral> => (redisUrl ? await redisEphemeral(redisUrl) : memoryEphemeral());
