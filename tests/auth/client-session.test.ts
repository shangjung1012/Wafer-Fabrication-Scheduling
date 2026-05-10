import { describe, expect, it, beforeEach } from "vitest";

import {
  clearClientAuthSession,
  loadClientAuthSession,
  persistClientAuthSession,
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

  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });

  return store;
}

describe("client auth session", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("persists and loads the login session for protected client pages", () => {
    persistClientAuthSession({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: {
        id: "user-1",
        accountId: "sa-A",
        name: "SuperAdmin A",
        role: "SUPERADMIN",
        group: "A",
      },
    });

    expect(loadClientAuthSession()).toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: { accountId: "sa-A", role: "SUPERADMIN", group: "A" },
    });
    expect(localStorage.getItem("dev_token")).toBe("access-token");
    expect(localStorage.getItem("viz_dev_token")).toBe("access-token");
  });

  it("clears all browser token keys on logout", () => {
    persistClientAuthSession({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: {
        id: "user-1",
        accountId: "sa-A",
        name: "SuperAdmin A",
        role: "SUPERADMIN",
        group: "A",
      },
    });

    clearClientAuthSession();

    expect(loadClientAuthSession()).toBeNull();
    expect(localStorage.getItem("dev_token")).toBeNull();
    expect(localStorage.getItem("viz_dev_token")).toBeNull();
  });
});
