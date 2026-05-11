const USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{1,30}[A-Za-z0-9])$/;

export function normalizeUsername(value: string): string {
  return value.trim();
}

export function isValidUsername(value: string): boolean {
  const username = normalizeUsername(value);
  return USERNAME_PATTERN.test(username) && !username.includes("@");
}

export function usernameValidationMessage(): string {
  return "Username must be 3-32 characters, use letters, numbers, dots, underscores, or hyphens, and start and end with a letter or number.";
}
