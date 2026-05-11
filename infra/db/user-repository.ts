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
  username: string | null;
  email: string;
  role: UserRole;
  group: string | null;
};

export type CreateUserInput = {
  username?: string | null;
  email: string;
  role: UserRole;
  group?: string | null;
  password?: string | null;
};

export type UpdateUserInput = {
  username?: string;
  email?: string;
  role?: UserRole;
  group?: string | null;
  password?: string | null;
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function findUsers(
  db: PrismaClient,
  filters: { role?: UserRole; group?: string } = {},
): Promise<UserRow[]> {
  return db.user.findMany({
    where: {
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.group ? { group: filters.group } : {}),
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
}

export async function findUserById(
  db: PrismaClient,
  id: string,
): Promise<UserRow | null> {
  return db.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      group: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createUser(
  db: PrismaClient,
  input: CreateUserInput,
): Promise<{ id: string }> {
  const user = await db.user.create({
    data: {
      username: input.username ?? null,
      email: input.email,
      role: input.role,
      group: input.group ?? null,
      password: input.password ?? null,
    },
    select: { id: true },
  });
  return user;
}

export async function updateUser(
  db: PrismaClient,
  id: string,
  input: UpdateUserInput,
): Promise<{ id: string } | null> {
  const exists = await db.user.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!exists) return null;

  const user = await db.user.update({
    where: { id },
    data: {
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.group !== undefined ? { group: input.group } : {}),
      ...(input.password !== undefined ? { password: input.password } : {}),
    },
    select: { id: true },
  });
  return user;
}

export async function deleteUser(
  db: PrismaClient,
  id: string,
): Promise<{ id: string } | null> {
  const exists = await db.user.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!exists) return null;

  await db.user.delete({ where: { id } });
  return { id };
}
