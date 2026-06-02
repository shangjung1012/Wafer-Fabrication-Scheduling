export type ClientAuthUser = {
  id: string;
  username: string;
  email: string;
  role: "SUPERADMIN" | "ADMIN" | "SALES";
  group: string | null;
};

export type ClientAuthSession = {
  user: ClientAuthUser;
};

const AUTH_USER_KEY = "auth_user";
const AUTH_ACCESS_TOKEN_KEY = "auth_access_token";
const AUTH_REFRESH_TOKEN_KEY = "auth_refresh_token";
const LEGACY_ORDERS_TOKEN_KEY = "dev_token";
const LEGACY_VISUALIZATION_TOKEN_KEY = "viz_dev_token";
export const CLIENT_AUTH_SESSION_EVENT = "client-auth-session-change";

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function emitClientAuthSessionChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CLIENT_AUTH_SESSION_EVENT));
}

export function loadClientAuthSession(): ClientAuthSession | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  const rawUser = storage.getItem(AUTH_USER_KEY);
  if (!rawUser) return null;

  try {
    return {
      user: JSON.parse(rawUser) as ClientAuthUser,
    };
  } catch {
    return null;
  }
}

export function persistClientAuthSession(session: ClientAuthSession): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  storage.setItem(AUTH_USER_KEY, JSON.stringify(session.user));
  storage.removeItem(AUTH_ACCESS_TOKEN_KEY);
  storage.removeItem(AUTH_REFRESH_TOKEN_KEY);
  emitClientAuthSessionChange();
}

export function clearClientAuthSession(): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  storage.removeItem(AUTH_ACCESS_TOKEN_KEY);
  storage.removeItem(AUTH_REFRESH_TOKEN_KEY);
  storage.removeItem(AUTH_USER_KEY);
  storage.removeItem(LEGACY_ORDERS_TOKEN_KEY);
  storage.removeItem(LEGACY_VISUALIZATION_TOKEN_KEY);
  emitClientAuthSessionChange();
}

export async function logoutClientAuthSession(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  }).catch(() => undefined);
  clearClientAuthSession();
}
