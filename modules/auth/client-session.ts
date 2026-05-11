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

function emitClientAuthSessionChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CLIENT_AUTH_SESSION_EVENT));
}

export function loadClientAuthSession(): ClientAuthSession | null {
  if (typeof localStorage === "undefined") return null;
  const rawUser = localStorage.getItem(AUTH_USER_KEY);
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
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(session.user));
  localStorage.removeItem(AUTH_ACCESS_TOKEN_KEY);
  localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
  emitClientAuthSessionChange();
}

export function clearClientAuthSession(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(AUTH_ACCESS_TOKEN_KEY);
  localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(LEGACY_ORDERS_TOKEN_KEY);
  localStorage.removeItem(LEGACY_VISUALIZATION_TOKEN_KEY);
  emitClientAuthSessionChange();
}

export async function logoutClientAuthSession(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  }).catch(() => undefined);
  clearClientAuthSession();
}
