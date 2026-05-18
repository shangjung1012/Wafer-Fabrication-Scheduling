import Redis from "ioredis";

let redis: Redis | undefined;

export function getRedis(): Redis {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL environment variable is not defined");
    }

    redis = new Redis(redisUrl);
    redis.on?.("error", (error) => {
      console.error("Redis connection error:", error);
    });
  }

  return redis;
}
