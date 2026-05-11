import argon2 from "argon2";

const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 2 ** 16),
  timeCost: Number(process.env.ARGON2_TIME_COST ?? 3),
  parallelism: Number(process.env.ARGON2_PARALLELISM ?? 4),
  hashLength: 32,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
