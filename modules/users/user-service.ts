/**
 * modules/users/user-service.ts
 *
 * Business logic for User management.
 * All operations are restricted to SUPERADMIN, scoped to their production type (group).
 */

import type { PrismaClient, UserRole } from "@/lib/generated/prisma/client";
import type { RequestContext } from "@/modules/auth/request-context";
import { requireRole, ForbiddenError } from "@/modules/auth/rbac";
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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the production type (group) for the authenticated SUPERADMIN.
 * Throws if missing — every SUPERADMIN must have a group set.
 */
async function getAdminGroup(ctx: RequestContext, db: PrismaClient): Promise<string> {
  const me = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: { group: true },
  });
  if (!me?.group) {
    throw new ForbiddenError("Your account does not have a production type (group) assigned.");
  }
  return me.group;
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

export type ListUsersInput = {
  role?: UserRole;
};

export async function listUsers(
  ctx: RequestContext,
  db: PrismaClient,
  input: ListUsersInput = {}
): Promise<UserRow[]> {
  requireRole(ctx, ["SUPERADMIN"]);
  const group = await getAdminGroup(ctx, db);

  // Scope: only users within the same production type
  return findUsers(db, { role: input.role, group });
}

export type CreateUserServiceInput = {
  name: string;
  role: UserRole;
  group?: string | null;
};

export async function createUserService(
  ctx: RequestContext,
  db: PrismaClient,
  input: CreateUserServiceInput
): Promise<{ id: string }> {
  requireRole(ctx, ["SUPERADMIN"]);
  const adminGroup = await getAdminGroup(ctx, db);

  // SUPERADMIN can only create users in their own type
  const targetGroup = input.group ?? adminGroup;
  if (targetGroup !== adminGroup) {
    throw new ForbiddenError(
      `Cannot create user in type '${targetGroup}'. You manage type '${adminGroup}'.`
    );
  }

  return createUser(db, {
    name: input.name,
    role: input.role,
    group: targetGroup,
  } satisfies CreateUserInput);
}

export type UpdateUserServiceInput = {
  name?: string;
  role?: UserRole;
  group?: string | null;
};

export async function updateUserService(
  ctx: RequestContext,
  db: PrismaClient,
  targetId: string,
  input: UpdateUserServiceInput
): Promise<{ id: string }> {
  requireRole(ctx, ["SUPERADMIN"]);
  const adminGroup = await getAdminGroup(ctx, db);

  // Verify target user exists and is in the same type
  const target = await findUserById(db, targetId);
  if (!target) {
    return Promise.reject(Object.assign(new Error("User not found."), { status: 404, code: "NOT_FOUND" }));
  }
  if (target.group !== adminGroup) {
    throw new ForbiddenError(
      `User '${targetId}' belongs to type '${target.group}', not your type '${adminGroup}'.`
    );
  }

  // Prevent changing group to a different type
  if (input.group !== undefined && input.group !== adminGroup) {
    throw new ForbiddenError(
      `Cannot move user to type '${input.group}'. You manage type '${adminGroup}'.`
    );
  }

  const result = await updateUser(db, targetId, input satisfies UpdateUserInput);
  if (!result) {
    return Promise.reject(Object.assign(new Error("User not found."), { status: 404, code: "NOT_FOUND" }));
  }
  return result;
}

export async function deleteUserService(
  ctx: RequestContext,
  db: PrismaClient,
  targetId: string
): Promise<{ id: string }> {
  requireRole(ctx, ["SUPERADMIN"]);
  const adminGroup = await getAdminGroup(ctx, db);

  // Cannot delete yourself
  if (targetId === ctx.user.id) {
    throw new ForbiddenError("You cannot delete your own account.");
  }

  // Verify target exists and is in scope
  const target = await findUserById(db, targetId);
  if (!target) {
    return Promise.reject(Object.assign(new Error("User not found."), { status: 404, code: "NOT_FOUND" }));
  }
  if (target.group !== adminGroup) {
    throw new ForbiddenError(
      `User '${targetId}' belongs to type '${target.group}', not your type '${adminGroup}'.`
    );
  }

  const result = await deleteUser(db, targetId);
  if (!result) {
    return Promise.reject(Object.assign(new Error("User not found."), { status: 404, code: "NOT_FOUND" }));
  }
  return result;
}
