/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";

import {
  clearClientAuthSession,
  getPostLogoutLoginPath,
  loadClientAuthSession,
  persistClientAuthSession,
  setPostLogoutLoginPath,
} from "@/modules/auth/client-session";

function installLocalStorage() {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => store.delete(key),
    setItem: (key, value) => {
      store.set(key, value);
    },
  };

  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });

  return store;
}

function installSessionStorage() {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => store.delete(key),
    setItem: (key, value) => {
      store.set(key, value);
    },
  };

  Object.defineProperty(window, "sessionStorage", {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: storage,
    configurable: true,
  });

  return store;
}

describe("client auth session", () => {
  beforeEach(() => {
    installLocalStorage();
    installSessionStorage();
  });

  it("persists only the real login session for protected client pages", () => {
    persistClientAuthSession({
      user: {
        id: "user-1",
        username: "sa-A",
        email: "sa-a@mail.shangjung.com",
        role: "SUPERADMIN",
        group: "A",
      },
    });

    expect(loadClientAuthSession()).toMatchObject({
      user: { username: "sa-A", role: "SUPERADMIN", group: "A" },
    });
    expect(localStorage.getItem("auth_access_token")).toBeNull();
    expect(localStorage.getItem("auth_refresh_token")).toBeNull();
    expect(localStorage.getItem("dev_token")).toBeNull();
    expect(localStorage.getItem("viz_dev_token")).toBeNull();
  });

  it("clears active and legacy browser token keys on logout", () => {
    persistClientAuthSession({
      user: {
        id: "user-1",
        username: "sa-A",
        email: "sa-a@mail.shangjung.com",
        role: "SUPERADMIN",
        group: "A",
      },
    });
    localStorage.setItem("dev_token", "legacy-dev-token");
    localStorage.setItem("viz_dev_token", "legacy-viz-token");

    clearClientAuthSession();

    expect(loadClientAuthSession()).toBeNull();
    expect(localStorage.getItem("dev_token")).toBeNull();
    expect(localStorage.getItem("viz_dev_token")).toBeNull();
  });
});

describe("post-logout login path", () => {
  beforeEach(() => {
    installLocalStorage();
    installSessionStorage();
  });

  it("defaults to /login when unset", () => {
    expect(getPostLogoutLoginPath()).toBe("/login");
  });

  it("returns /login-demo after setPostLogoutLoginPath", () => {
    setPostLogoutLoginPath("/login-demo");
    expect(getPostLogoutLoginPath()).toBe("/login-demo");
  });

  it("returns /login after setPostLogoutLoginPath", () => {
    setPostLogoutLoginPath("/login-demo");
    setPostLogoutLoginPath("/login");
    expect(getPostLogoutLoginPath()).toBe("/login");
  });

  it("ignores invalid stored values", () => {
    window.sessionStorage.setItem("post_logout_login_path", "/evil");
    expect(getPostLogoutLoginPath()).toBe("/login");
  });
});

describe("logoutClientAuthSession", () => {
  beforeEach(() => {
    installLocalStorage();
    installSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls logout API and clears the session on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    persistClientAuthSession({
      user: {
        id: "u1",
        username: "alice",
        email: "a@x.com",
        role: "ADMIN",
        group: null,
      },
    });

    const { logoutClientAuthSession } =
      await import("@/modules/auth/client-session");
    await logoutClientAuthSession();

    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
    expect(loadClientAuthSession()).toBeNull();
  });

  it("still clears the session even when the logout API call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    persistClientAuthSession({
      user: {
        id: "u1",
        username: "alice",
        email: "a@x.com",
        role: "ADMIN",
        group: null,
      },
    });

    const { logoutClientAuthSession } =
      await import("@/modules/auth/client-session");
    await logoutClientAuthSession();

    expect(loadClientAuthSession()).toBeNull();
  });
});
