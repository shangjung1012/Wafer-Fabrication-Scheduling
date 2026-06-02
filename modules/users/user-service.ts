/**
 * modules/users/user-service.ts
 *
 * Business logic for User management.
 * - SUPERADMIN: full CRUD over all users across all groups (global scope)
 * - ADMIN: can list/create SALES users in their group only; account updates and
 *   deletion are reserved for SUPERADMIN.
 */

import type { PrismaClient, UserRole } from "@/lib/generated/prisma/client";
import type { RequestContext } from "@/modules/auth/request-context";
import {
  requireRole,
  ForbiddenError,
  NotFoundError,
} from "@/modules/auth/rbac";
import { resolveActorScope, getScopeGroup } from "@/modules/auth/scope";
import { hashPassword } from "@/modules/auth/password-service";
import {
  findUsers,
  findUserById,
  createUser,
  updateUser,
  deleteUser,
  type UserRow,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/infra/db/user-repository";

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

export type ListUsersInput = {
  role?: UserRole;
};

export async function listUsers(
  ctx: RequestContext,
  db: PrismaClient,
  input: ListUsersInput = {},
): Promise<UserRow[]> {
  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
  const scope = await resolveActorScope(ctx, db);

  if (scope.role === "ADMIN") {
    const group = getScopeGroup(scope);
    // ADMIN can only list SALES users in their group
    return findUsers(db, { role: "SALES", group });
  }

  // SUPERADMIN: global scope, no group restriction
  return findUsers(db, { role: input.role });
}

export type CreateUserServiceInput = {
  username: string;
  email: string;
  role: UserRole;
  group?: string | null;
  password?: string | null;
};

export async function createUserService(
  ctx: RequestContext,
  db: PrismaClient,
  input: CreateUserServiceInput,
): Promise<{ id: string }> {
  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
  const scope = await resolveActorScope(ctx, db);

  if (scope.role === "ADMIN") {
    const adminGroup = getScopeGroup(scope);
    if (input.role !== "SALES") {
      throw new ForbiddenError("Admins can only create SALES users.");
    }
    const targetGroup = input.group ?? adminGroup;
    if (targetGroup !== adminGroup) {
      throw new ForbiddenError(
        `Cannot create user in type '${targetGroup}'. You manage type '${adminGroup}'.`,
      );
    }
    return createUser(db, {
      username: input.username,
      email: input.email,
      role: input.role,
      group: targetGroup,
      password: input.password ? await hashPassword(input.password) : null,
    } satisfies CreateUserInput);
  }

  // SUPERADMIN: global scope, group from input
  return createUser(db, {
    username: input.username,
    email: input.email,
    role: input.role,
    group: input.group ?? null,
    password: input.password ? await hashPassword(input.password) : null,
  } satisfies CreateUserInput);
}

export type UpdateUserServiceInput = {
  username?: string;
  email?: string;
  role?: UserRole;
  group?: string | null;
  password?: string | null;
};

export async function updateUserService(
  ctx: RequestContext,
  db: PrismaClient,
  targetId: string,
  input: UpdateUserServiceInput,
): Promise<{ id: string }> {
  requireRole(ctx, ["SUPERADMIN"]);

  const target = await findUserById(db, targetId);
  if (!target) {
    throw new NotFoundError("User not found.");
  }

  const result = await updateUser(db, targetId, {
    ...input,
    password: input.password
      ? await hashPassword(input.password)
      : input.password,
  } satisfies UpdateUserInput);
  if (!result) {
    throw new NotFoundError("User not found.");
  }
  return result;
}

export async function deleteUserService(
  ctx: RequestContext,
  db: PrismaClient,
  targetId: string,
): Promise<{ id: string }> {
  requireRole(ctx, ["SUPERADMIN"]);

  if (targetId === ctx.user.id) {
    throw new ForbiddenError("You cannot delete your own account.");
  }

  const target = await findUserById(db, targetId);
  if (!target) {
    throw new NotFoundError("User not found.");
  }
  if (target.role === "SUPERADMIN") {
    throw new ForbiddenError("SUPERADMIN accounts cannot be deleted.");
  }

  const result = await deleteUser(db, targetId);
  if (!result) {
    throw new NotFoundError("User not found.");
  }
  return result;
}
