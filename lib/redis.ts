import Redis, { Cluster } from "ioredis";

type RedisClient = Redis | Cluster;

let redis: RedisClient | undefined;

function isClusterMode(): boolean {
  const value = process.env.REDIS_CLUSTER;
  return value === "1" || value?.toLowerCase() === "true";
}

function redisUrls(): string[] {
  const nodes = process.env.REDIS_CLUSTER_NODES ?? process.env.REDIS_URL;
  if (!nodes) {
    throw new Error("REDIS_URL environment variable is not defined");
  }
  return nodes
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

function createRedisClient(): RedisClient {
  const urls = redisUrls();

  if (!isClusterMode()) {
    return new Redis(urls[0]);
  }

  const parsedUrls = urls.map((url) => new URL(url));
  const firstUrl = parsedUrls[0];
  const usesTls = parsedUrls.some((url) => url.protocol === "rediss:");
  const password = firstUrl.password
    ? decodeURIComponent(firstUrl.password)
    : undefined;
  const username = firstUrl.username
    ? decodeURIComponent(firstUrl.username)
    : undefined;

  return new Cluster(
    parsedUrls.map((url) => ({
      host: url.hostname,
      port: Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379)),
    })),
    {
      redisOptions: {
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
        ...(usesTls ? { tls: {} } : {}),
      },
    },
  );
}

export function getRedis(): RedisClient {
  if (!redis) {
    redis = createRedisClient();
    redis.on?.("error", (error) => {
      console.error("Redis connection error:", error);
    });
  }

  return redis;
}
