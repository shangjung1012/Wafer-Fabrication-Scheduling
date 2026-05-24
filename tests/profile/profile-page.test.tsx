/**
 * @vitest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProfilePage from "@/app/(dashboard)/profile/page";
import type { ClientAuthSession } from "@/modules/auth/client-session";

const replace = vi.fn();
const session: ClientAuthSession = {
  user: {
    id: "user-1",
    username: "sales-a",
    email: "old@example.com",
    role: "SALES",
    group: "A",
  },
};

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("@/modules/auth/use-client-auth-session", () => ({
  useClientAuthSession: () => session,
}));

vi.mock("@/modules/auth/client-session", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/auth/client-session")
  >("@/modules/auth/client-session");
  return {
    ...actual,
    persistClientAuthSession: vi.fn(),
    logoutClientAuthSession: vi.fn(),
  };
});

describe("ProfilePage", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let replaceState: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.history.pushState(
      {},
      "",
      "/profile?emailChangeToken=raw-token&emailError=expired",
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const originalReplaceState = window.history.replaceState.bind(
      window.history,
    );
    replaceState = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation((...args) => {
        const stack = new Error().stack ?? "";
        if (stack.includes("mountState") || stack.includes("renderWithHooks")) {
          throw new Error("replaceState called during render");
        }
        return originalReplaceState(...args);
      });
  });

  afterEach(() => {
    replaceState.mockRestore();
    root.unmount();
    container.remove();
    vi.clearAllMocks();
  });

  it("does not update browser history while rendering email-change query params", () => {
    expect(() => {
      flushSync(() => {
        root.render(<ProfilePage />);
      });
    }).not.toThrow("replaceState called during render");
  });
});
