import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getScheduleVersion,
  incrementScheduleVersion,
  setPreview,
  getPreview,
  deletePreview,
} from "@/infra/redis/schedule-store";
import { getRedis } from "@/lib/redis";

// Mock the ioredis module
vi.mock("ioredis", () => {
  const RedisMock = vi.fn(() => ({
    get: vi.fn(),
    incr: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    on: vi.fn(),
  }));
  return { default: RedisMock };
});

// Mock lib/redis to return our mocked instance
vi.mock("@/lib/redis", () => {
  const mockRedisClient = {
    get: vi.fn(),
    incr: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
  };
  return {
    getRedis: vi.fn(() => mockRedisClient),
  };
});

describe("schedule-store (Redis)", () => {
  let mockRedis:
    | ReturnType<typeof getRedis>
    | Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = getRedis() as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
  });

  describe("getScheduleVersion", () => {
    it("should return 0 if key does not exist", async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(null);
      const version = await getScheduleVersion("Type A");
      expect(version).toBe(0);
      expect(mockRedis.get).toHaveBeenCalledWith("schedule_version:Type A");
    });

    it("should return parsed integer if key exists", async () => {
      vi.mocked(mockRedis.get).mockResolvedValue("42");
      const version = await getScheduleVersion("Type A");
      expect(version).toBe(42);
      expect(mockRedis.get).toHaveBeenCalledWith("schedule_version:Type A");
    });
  });

  describe("incrementScheduleVersion", () => {
    it("should increment the version and return the new value", async () => {
      vi.mocked(mockRedis.incr).mockResolvedValue(43);
      const version = await incrementScheduleVersion("Type A");
      expect(version).toBe(43);
      expect(mockRedis.incr).toHaveBeenCalledWith("schedule_version:Type A");
    });
  });

  describe("preview management", () => {
    const previewId = "test-preview-123";
    const payload = { type: "Type A", version: 1 };

    it("should set preview with JSON stringified payload and default TTL", async () => {
      await setPreview(previewId, payload);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `preview:${previewId}`,
        1800,
        JSON.stringify(payload),
      );
    });

    it("should get preview and parse JSON if exists", async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(payload));
      const data = await getPreview(previewId);
      expect(data).toEqual(payload);
      expect(mockRedis.get).toHaveBeenCalledWith(`preview:${previewId}`);
    });

    it("should return null if preview does not exist", async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(null);
      const data = await getPreview(previewId);
      expect(data).toBeNull();
    });

    it("should delete preview", async () => {
      await deletePreview(previewId);
      expect(mockRedis.del).toHaveBeenCalledWith(`preview:${previewId}`);
    });
  });
});
