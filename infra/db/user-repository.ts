/**
 * infra/db/user-repository.ts
 *
 * All DB access for the User model.
 * Business logic (role checks, scope filtering) belongs in modules/users/.
 */

import type { PrismaClient, UserRole } from "@/lib/generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserRow = {
  id: string;
  name: string;
  role: UserRole;
  group: string | null;
};

export type CreateUserInput = {
  name: string;
  role: UserRole;
  group?: string | null;
};

export type UpdateUserInput = {
  name?: string;
  role?: UserRole;
  group?: string | null;
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function findUsers(
  db: PrismaClient,
  filters: { role?: UserRole; group?: string } = {}
): Promise<UserRow[]> {
  return db.user.findMany({
    where: {
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.group ? { group: filters.group } : {}),
    },
    select: { id: true, name: true, role: true, group: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
}

export async function findUserById(
  db: PrismaClient,
  id: string
): Promise<UserRow | null> {
  return db.user.findUnique({
    where: { id },
    select: { id: true, name: true, role: true, group: true },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createUser(
  db: PrismaClient,
  input: CreateUserInput
): Promise<{ id: string }> {
  const user = await db.user.create({
    data: {
      name: input.name,
      role: input.role,
      group: input.group ?? null,
    },
    select: { id: true },
  });
  return user;
}

export async function updateUser(
  db: PrismaClient,
  id: string,
  input: UpdateUserInput
): Promise<{ id: string } | null> {
  const exists = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;

  const user = await db.user.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.group !== undefined ? { group: input.group } : {}),
    },
    select: { id: true },
  });
  return user;
}

export async function deleteUser(
  db: PrismaClient,
  id: string
): Promise<{ id: string } | null> {
  const exists = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;

  await db.user.delete({ where: { id } });
  return { id };
}
