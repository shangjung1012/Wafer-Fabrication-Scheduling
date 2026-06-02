import { describe, it, expect, vi } from "vitest";
import {
  findUsers,
  findUserById,
  createUser,
  updateUser,
  deleteUser,
  findUserByUsername,
} from "@/infra/db/user-repository";
import type { PrismaClient } from "@/lib/generated/prisma/client";

describe("user-repository", () => {
  describe("findUsers", () => {
    it("builds where with role and group when both provided", async () => {
      const rows = [
        {
          id: "1",
          username: "a",
          email: "a@x.com",
          role: "SALES" as const,
          group: "Type A",
        },
      ];
      const mockDb = {
        user: {
          findMany: vi.fn().mockResolvedValue(rows),
        },
      } as unknown as PrismaClient;

      const result = await findUsers(mockDb, {
        role: "SALES",
        group: "Type A",
      });

      expect(mockDb.user.findMany).toHaveBeenCalledWith({
        where: {
          AND: [{ role: { not: "SYSTEM" } }, { role: "SALES" }],
          group: "Type A",
        },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          group: true,
        },
        orderBy: [{ role: "asc" }, { username: "asc" }, { email: "asc" }],
      });
      expect(result).toEqual(rows);
    });

    it("omits role from where when filters.role is omitted", async () => {
      const mockDb = {
        user: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaClient;

      await findUsers(mockDb, { group: "Type B" });

      expect(mockDb.user.findMany).toHaveBeenCalledWith({
        where: {
          AND: [{ role: { not: "SYSTEM" } }],
          group: "Type B",
        },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          group: true,
        },
        orderBy: [{ role: "asc" }, { username: "asc" }, { email: "asc" }],
      });
    });

    it("uses empty where when no filters", async () => {
      const mockDb = {
        user: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaClient;

      await findUsers(mockDb);

      expect(mockDb.user.findMany).toHaveBeenCalledWith({
        where: { AND: [{ role: { not: "SYSTEM" } }] },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          group: true,
        },
        orderBy: [{ role: "asc" }, { username: "asc" }, { email: "asc" }],
      });
    });
  });

  describe("findUserById", () => {
    it("returns null when Prisma returns null", async () => {
      const mockDb = {
        user: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaClient;

      const result = await findUserById(mockDb, "missing");

      expect(result).toBeNull();
      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: "missing" },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          group: true,
        },
      });
    });

    it("returns row when found", async () => {
      const row = {
        id: "u1",
        username: "bob",
        email: "b@x.com",
        role: "ADMIN" as const,
        group: "Type A",
      };
      const mockDb = {
        user: {
          findUnique: vi.fn().mockResolvedValue(row),
        },
      } as unknown as PrismaClient;

      await expect(findUserById(mockDb, "u1")).resolves.toEqual(row);
    });
  });

  describe("createUser", () => {
    it("persists nullable username, group, password", async () => {
      const mockDb = {
        user: {
          create: vi.fn().mockResolvedValue({ id: "new-id" }),
        },
      } as unknown as PrismaClient;

      const out = await createUser(mockDb, {
        username: null,
        email: "e@x.com",
        role: "SALES",
        group: null,
        password: null,
      });

      expect(out).toEqual({ id: "new-id" });
      expect(mockDb.user.create).toHaveBeenCalledWith({
        data: {
          username: null,
          email: "e@x.com",
          role: "SALES",
          group: null,
          password: null,
        },
        select: { id: true },
      });
    });
  });

  describe("updateUser", () => {
    it("returns null when user does not exist", async () => {
      const mockDb = {
        user: {
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
        },
      } as unknown as PrismaClient;

      await expect(
        updateUser(mockDb, "gone", { email: "x@y.com" }),
      ).resolves.toBeNull();
      expect(mockDb.user.update).not.toHaveBeenCalled();
    });

    it("patches only defined fields when user exists", async () => {
      const mockDb = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: "u1" }),
          update: vi.fn().mockResolvedValue({ id: "u1" }),
        },
      } as unknown as PrismaClient;

      const out = await updateUser(mockDb, "u1", {
        email: "new@x.com",
        password: "secret",
      });

      expect(out).toEqual({ id: "u1" });
      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { email: "new@x.com", password: "secret" },
        select: { id: true },
      });
    });
  });

  describe("deleteUser", () => {
    it("returns null when user does not exist", async () => {
      const mockDb = {
        user: {
          findUnique: vi.fn().mockResolvedValue(null),
          delete: vi.fn(),
        },
      } as unknown as PrismaClient;

      await expect(deleteUser(mockDb, "gone")).resolves.toBeNull();
      expect(mockDb.user.delete).not.toHaveBeenCalled();
    });

    it("deletes and returns id when user exists", async () => {
      const mockDb = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: "u1" }),
          delete: vi.fn().mockResolvedValue({}),
        },
      } as unknown as PrismaClient;

      await expect(deleteUser(mockDb, "u1")).resolves.toEqual({ id: "u1" });
      expect(mockDb.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
    });
  });

  describe("findUserByUsername", () => {
    it("delegates to findUnique on username", async () => {
      const mockDb = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: "x" }),
        },
      } as unknown as PrismaClient;

      await findUserByUsername(mockDb, "alice");

      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { username: "alice" },
      });
    });
  });
});
