export type ClientAuthUser = {
  id: string;
  accountId: string;
  name: string;
  role: "SUPERADMIN" | "ADMIN" | "SALES";
  group: string | null;
};

export type ClientAuthSession = {
  accessToken: string;
  refreshToken: string;
  user: ClientAuthUser;
};

const AUTH_ACCESS_TOKEN_KEY = "auth_access_token";
const AUTH_REFRESH_TOKEN_KEY = "auth_refresh_token";
const AUTH_USER_KEY = "auth_user";
const LEGACY_ORDERS_TOKEN_KEY = "dev_token";
const LEGACY_VISUALIZATION_TOKEN_KEY = "viz_dev_token";
export const CLIENT_AUTH_SESSION_EVENT = "client-auth-session-change";

function emitClientAuthSessionChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CLIENT_AUTH_SESSION_EVENT));
}

export function loadClientAuthSession(): ClientAuthSession | null {
  if (typeof localStorage === "undefined") return null;
  const accessToken = localStorage.getItem(AUTH_ACCESS_TOKEN_KEY);
  const refreshToken = localStorage.getItem(AUTH_REFRESH_TOKEN_KEY);
  const rawUser = localStorage.getItem(AUTH_USER_KEY);
  if (!accessToken || !refreshToken || !rawUser) return null;

  try {
    return {
      accessToken,
      refreshToken,
      user: JSON.parse(rawUser) as ClientAuthUser,
    };
  } catch {
    return null;
  }
}

export function persistClientAuthSession(session: ClientAuthSession): void {
  localStorage.setItem(AUTH_ACCESS_TOKEN_KEY, session.accessToken);
  localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, session.refreshToken);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(session.user));
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

export async function logoutClientAuthSession(refreshToken?: string): Promise<void> {
  if (refreshToken) {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
  clearClientAuthSession();
}
