import { getRedis } from "@/lib/redis";

export async function getScheduleVersion(type: string): Promise<number> {
  const redis = getRedis();
  const version = await redis.get(`schedule_version:${type}`);
  return version ? parseInt(version, 10) : 0;
}

export async function incrementScheduleVersion(type: string): Promise<number> {
  const redis = getRedis();
  return redis.incr(`schedule_version:${type}`);
}

export async function setPreview(
  previewId: string,
  payload: Record<string, unknown>,
  ttlSeconds: number = 1800,
): Promise<void> {
  const redis = getRedis();
  await redis.setex(
    `preview:${previewId}`,
    ttlSeconds,
    JSON.stringify(payload),
  );
}

export async function getPreview(
  previewId: string,
): Promise<Record<string, unknown> | null> {
  const redis = getRedis();
  const data = await redis.get(`preview:${previewId}`);
  return data ? JSON.parse(data) : null;
}

export async function deletePreview(previewId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(`preview:${previewId}`);
}

export async function withScheduleLock<T>(
  typeOrTypes: string | string[],
  fn: () => Promise<T>,
): Promise<T> {
  const types = Array.isArray(typeOrTypes)
    ? Array.from(new Set(typeOrTypes)).sort()
    : [typeOrTypes];
  const redis = getRedis();
  const acquiredLocks: string[] = [];

  try {
    for (const type of types) {
      const lockKey = `schedule:lock:${type}`;
      const lockAcquired = await redis.set(lockKey, "locked", "EX", 300, "NX");
      if (!lockAcquired) {
        throw new Error(
          `A scheduling process is already running for type: ${type}`,
        );
      }
      acquiredLocks.push(lockKey);
    }
    return await fn();
  } finally {
    for (const lockKey of acquiredLocks) {
      await redis.del(lockKey);
    }
  }
}
