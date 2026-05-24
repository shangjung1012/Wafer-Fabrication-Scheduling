import { randomUUID } from "node:crypto";

import { getRedis } from "@/lib/redis";

const SCHEDULE_LOCK_TTL_SECONDS = 300;
const RELEASE_SCHEDULE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

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
  const acquiredLocks: Array<{ lockKey: string; ownerToken: string }> = [];

  try {
    for (const type of types) {
      const lockKey = `schedule:lock:${type}`;
      const ownerToken = randomUUID();
      const lockAcquired = await redis.set(
        lockKey,
        ownerToken,
        "EX",
        SCHEDULE_LOCK_TTL_SECONDS,
        "NX",
      );
      if (!lockAcquired) {
        throw new Error(
          `A scheduling process is already running for type: ${type}`,
        );
      }
      acquiredLocks.push({ lockKey, ownerToken });
    }
    return await fn();
  } finally {
    for (const { lockKey, ownerToken } of acquiredLocks) {
      await redis.eval(RELEASE_SCHEDULE_LOCK_SCRIPT, 1, lockKey, ownerToken);
    }
  }
}
