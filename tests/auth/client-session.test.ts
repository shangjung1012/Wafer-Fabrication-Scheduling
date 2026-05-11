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
