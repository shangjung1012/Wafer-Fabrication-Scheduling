/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  persistClientAuthSession,
  type ClientAuthSession,
} from "@/modules/auth/client-session";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";

const session: ClientAuthSession = {
  user: {
    id: "user-1",
    username: "sa-A",
    email: "sa-a@mail.shangjung.com",
    role: "SUPERADMIN",
    group: "A",
  },
};

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function HydrationProbe() {
  const authSession = useClientAuthSession() ?? null;

  return (
    <button type="button" disabled={!authSession}>
      Logout
    </button>
  );
}

function SnapshotProbe({
  onRender,
}: {
  onRender: (snapshot: ReturnType<typeof useClientAuthSession>) => void;
}) {
  const authSession = useClientAuthSession();
  onRender(authSession);
  return null;
}

describe("useClientAuthSession", () => {
  let container: HTMLDivElement;
  let consoleError: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: window.localStorage,
    });
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError?.mockRestore();
    container.remove();
    window.localStorage.clear();
  });

  it("keeps the first client snapshot aligned with the server snapshot during hydration", async () => {
    const html = renderToString(<HydrationProbe />);
    persistClientAuthSession(session);
    container.innerHTML = html;

    await act(async () => {
      hydrateRoot(container, <HydrationProbe />);
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("A tree hydrated but some attributes"),
      expect.anything(),
    );
  });

  it("defers localStorage-backed session data until after the first client render", async () => {
    const root = createRoot(container);
    const snapshots: Array<ReturnType<typeof useClientAuthSession>> = [];
    persistClientAuthSession(session);

    flushSync(() => {
      root.render(
        <SnapshotProbe onRender={(value) => snapshots.push(value)} />,
      );
    });

    expect(snapshots[0]).toBeUndefined();

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(snapshots.at(-1)).toMatchObject(session);
    root.unmount();
  });
});
