import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listUsers,
  createUserService,
  updateUserService,
  deleteUserService,
} from "@/modules/users/user-service";
import * as userRepo from "@/infra/db/user-repository";
import * as scopeModule from "@/modules/auth/scope";
import * as passwordService from "@/modules/auth/password-service";
import { ForbiddenError, NotFoundError } from "@/modules/auth/rbac";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { RequestContext } from "@/modules/auth/request-context";

vi.mock("@/infra/db/user-repository", () => ({
  findUsers: vi.fn(),
  findUserById: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock("@/modules/auth/scope", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth/scope")>(
    "@/modules/auth/scope",
  );
  return { ...actual, resolveActorScope: vi.fn() };
});

vi.mock("@/modules/auth/password-service", () => ({
  hashPassword: vi.fn(async (p: string) => `hashed:${p}`),
}));

const prisma = {} as unknown as PrismaClient;

function ctx(
  role: RequestContext["user"]["role"],
  id = "actor-1",
): RequestContext {
  return { user: { id, role, username: "actor" }, requestId: "req-1" };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("user-service", () => {
  describe("listUsers", () => {
    it("rejects SALES before scope resolution", async () => {
      await expect(listUsers(ctx("SALES"), prisma)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect(scopeModule.resolveActorScope).not.toHaveBeenCalled();
      expect(userRepo.findUsers).not.toHaveBeenCalled();
    });

    it("ADMIN lists only SALES in their production type group", async () => {
      vi.mocked(scopeModule.resolveActorScope).mockResolvedValue({
        role: "ADMIN",
        userId: "actor-1",
        factoryIds: ["f1"],
        productionType: "Type A",
        group: "Type A",
      });
      vi.mocked(userRepo.findUsers).mockResolvedValue([]);

      await listUsers(ctx("ADMIN"), prisma);

      expect(userRepo.findUsers).toHaveBeenCalledWith(prisma, {
        role: "SALES",
        group: "Type A",
      });
    });

    it("SUPERADMIN lists all users globally (no group filter)", async () => {
      vi.mocked(scopeModule.resolveActorScope).mockResolvedValue({
        role: "SUPERADMIN",
        userId: "sa-1",
        group: null,
      });
      vi.mocked(userRepo.findUsers).mockResolvedValue([]);

      await listUsers(ctx("SUPERADMIN"), prisma, { role: "ADMIN" });

      expect(userRepo.findUsers).toHaveBeenCalledWith(prisma, {
        role: "ADMIN",
      });
    });
  });

  describe("createUserService", () => {
    it("ADMIN cannot create non-SALES users", async () => {
      vi.mocked(scopeModule.resolveActorScope).mockResolvedValue({
        role: "ADMIN",
        userId: "actor-1",
        factoryIds: ["f1"],
        productionType: "Type A",
        group: "Type A",
      });

      await expect(
        createUserService(ctx("ADMIN"), prisma, {
          username: "x",
          email: "x@x.com",
          role: "ADMIN",
        }),
      ).rejects.toMatchObject({ name: "ForbiddenError" });
      expect(userRepo.createUser).not.toHaveBeenCalled();
    });

    it("SUPERADMIN can create user in any group (global scope)", async () => {
      vi.mocked(scopeModule.resolveActorScope).mockResolvedValue({
        role: "SUPERADMIN",
        userId: "sa-1",
        group: null,
      });
      vi.mocked(userRepo.createUser).mockResolvedValue({ id: "new-u" });

      await expect(
        createUserService(ctx("SUPERADMIN"), prisma, {
          username: "x",
          email: "x@x.com",
          role: "SALES",
          group: "Type B",
        }),
      ).resolves.toEqual({ id: "new-u" });
      expect(userRepo.createUser).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ group: "Type B" }),
      );
    });

    it("hashes password and creates SALES user for ADMIN", async () => {
      vi.mocked(scopeModule.resolveActorScope).mockResolvedValue({
        role: "ADMIN",
        userId: "actor-1",
        factoryIds: ["f1"],
        productionType: "Type A",
        group: "Type A",
      });
      vi.mocked(userRepo.createUser).mockResolvedValue({ id: "new-u" });

      const out = await createUserService(ctx("ADMIN"), prisma, {
        username: "sales-new",
        email: "s@x.com",
        role: "SALES",
        password: "plain",
      });

      expect(passwordService.hashPassword).toHaveBeenCalledWith("plain");
      expect(userRepo.createUser).toHaveBeenCalledWith(prisma, {
        username: "sales-new",
        email: "s@x.com",
        role: "SALES",
        group: "Type A",
        password: "hashed:plain",
      });
      expect(out).toEqual({ id: "new-u" });
    });
  });

  describe("updateUserService", () => {
    it("throws NotFound when target id does not exist", async () => {
      vi.mocked(userRepo.findUserById).mockResolvedValue(null);

      await expect(
        updateUserService(ctx("SUPERADMIN"), prisma, "missing", {
          email: "a@b.com",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(userRepo.updateUser).not.toHaveBeenCalled();
    });

    it("SUPERADMIN can update user in any group (global scope)", async () => {
      vi.mocked(userRepo.findUserById).mockResolvedValue({
        id: "u1",
        username: "x",
        email: "x@x.com",
        role: "SALES",
        group: "Type B",
      });
      vi.mocked(userRepo.updateUser).mockResolvedValue({ id: "u1" });

      await expect(
        updateUserService(ctx("SUPERADMIN"), prisma, "u1", {
          email: "new@x.com",
        }),
      ).resolves.toEqual({ id: "u1" });
    });

    it("ADMIN cannot update any user (SUPERADMIN-only operation)", async () => {
      await expect(
        updateUserService(ctx("ADMIN"), prisma, "u1", { email: "z@z.com" }),
      ).rejects.toMatchObject({ name: "ForbiddenError" });
      expect(userRepo.findUserById).not.toHaveBeenCalled();
    });

    it("SUPERADMIN can move user to a different group", async () => {
      vi.mocked(userRepo.findUserById).mockResolvedValue({
        id: "u1",
        username: "s",
        email: "s@x.com",
        role: "SALES",
        group: "Type A",
      });
      vi.mocked(userRepo.updateUser).mockResolvedValue({ id: "u1" });

      await expect(
        updateUserService(ctx("SUPERADMIN"), prisma, "u1", { group: "Type B" }),
      ).resolves.toEqual({ id: "u1" });
    });

    it("throws NotFound when repository update returns null", async () => {
      vi.mocked(userRepo.findUserById).mockResolvedValue({
        id: "u1",
        username: "s",
        email: "s@x.com",
        role: "SALES",
        group: "Type A",
      });
      vi.mocked(userRepo.updateUser).mockResolvedValue(null);

      await expect(
        updateUserService(ctx("SUPERADMIN"), prisma, "u1", {
          email: "n@n.com",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("returns id on successful update", async () => {
      vi.mocked(userRepo.findUserById).mockResolvedValue({
        id: "u1",
        username: "s",
        email: "s@x.com",
        role: "SALES",
        group: "Type A",
      });
      vi.mocked(userRepo.updateUser).mockResolvedValue({ id: "u1" });

      await expect(
        updateUserService(ctx("SUPERADMIN"), prisma, "u1", {
          email: "n@n.com",
        }),
      ).resolves.toEqual({ id: "u1" });
    });
  });

  describe("deleteUserService", () => {
    it("forbids deleting own account", async () => {
      await expect(
        deleteUserService(ctx("SUPERADMIN", "self-id"), prisma, "self-id"),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(userRepo.findUserById).not.toHaveBeenCalled();
    });

    it("throws NotFound when target id does not exist", async () => {
      vi.mocked(userRepo.findUserById).mockResolvedValue(null);

      await expect(
        deleteUserService(ctx("SUPERADMIN"), prisma, "gone"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("ADMIN cannot delete any user (SUPERADMIN-only operation)", async () => {
      await expect(
        deleteUserService(ctx("ADMIN"), prisma, "u1"),
      ).rejects.toMatchObject({ name: "ForbiddenError" });
      expect(userRepo.deleteUser).not.toHaveBeenCalled();
    });

    it("throws NotFound when repository delete returns null", async () => {
      vi.mocked(userRepo.findUserById).mockResolvedValue({
        id: "u1",
        username: "s",
        email: "s@x.com",
        role: "SALES",
        group: "Type A",
      });
      vi.mocked(userRepo.deleteUser).mockResolvedValue(null);

      await expect(
        deleteUserService(ctx("SUPERADMIN"), prisma, "u1"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("returns id on successful delete", async () => {
      vi.mocked(userRepo.findUserById).mockResolvedValue({
        id: "u1",
        username: "s",
        email: "s@x.com",
        role: "SALES",
        group: "Type A",
      });
      vi.mocked(userRepo.deleteUser).mockResolvedValue({ id: "u1" });

      await expect(
        deleteUserService(ctx("SUPERADMIN"), prisma, "u1"),
      ).resolves.toEqual({ id: "u1" });
    });
  });
});
