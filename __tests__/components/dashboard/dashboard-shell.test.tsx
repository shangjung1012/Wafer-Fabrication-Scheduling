/**
 * @vitest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement("a", { href, className }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: vi.fn().mockReturnValue("/visualization"),
  useRouter: vi.fn().mockReturnValue({ replace: vi.fn() }),
}));

vi.mock("@/modules/auth/use-client-auth-session", () => ({
  useClientAuthSession: vi.fn().mockReturnValue({
    user: {
      id: "u-1",
      username: "alice",
      email: "alice@example.com",
      role: "ADMIN",
      group: "A",
    },
  }),
}));

vi.mock("@/modules/auth/client-session", () => ({
  logoutClientAuthSession: vi.fn().mockResolvedValue(undefined),
}));

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";
import { usePathname } from "next/navigation";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  root.unmount();
  container.remove();
  vi.clearAllMocks();
});

const BASE_PROPS = {
  title: "My App",
  subtitle: "Subtitle here",
  leftSection: React.createElement("div", null, "left content"),
  onBack: vi.fn(),
};

describe("DashboardShell", () => {
  it("renders title, subtitle, and nav links", () => {
    flushSync(() => {
      root.render(React.createElement(DashboardShell, BASE_PROPS));
    });
    expect(container.textContent).toContain("My App");
    expect(container.textContent).toContain("Subtitle here");
    expect(container.textContent).toContain("Schedule");
    expect(container.textContent).toContain("Dashboard");
  });

  it("renders the left section content", () => {
    flushSync(() => {
      root.render(React.createElement(DashboardShell, BASE_PROPS));
    });
    expect(container.textContent).toContain("left content");
  });

  it("renders the right section when provided and not hidden", () => {
    flushSync(() => {
      root.render(
        React.createElement(DashboardShell, {
          ...BASE_PROPS,
          rightSection: React.createElement("div", null, "right content"),
        }),
      );
    });
    expect(container.textContent).toContain("right content");
  });

  it("hides the right section when hideRightSection is true", () => {
    flushSync(() => {
      root.render(
        React.createElement(DashboardShell, {
          ...BASE_PROPS,
          rightSection: React.createElement("div", null, "right content"),
          hideRightSection: true,
        }),
      );
    });
    expect(container.textContent).not.toContain("right content");
  });

  it("hides the top bar when hideTopBar is true", () => {
    flushSync(() => {
      root.render(
        React.createElement(DashboardShell, {
          ...BASE_PROPS,
          hideTopBar: true,
        }),
      );
    });
    expect(container.querySelector("nav")).toBeNull();
  });

  it("shows Permissions link for SUPERADMIN users", () => {
    vi.mocked(useClientAuthSession).mockReturnValue({
      user: {
        id: "sa",
        username: "sa-A",
        email: "sa@x.com",
        role: "SUPERADMIN",
        group: "A",
      },
    });
    flushSync(() => {
      root.render(React.createElement(DashboardShell, BASE_PROPS));
    });
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.some((a) => a.textContent?.includes("Permissions"))).toBe(
      true,
    );
  });

  it("does not show Permissions link for non-SUPERADMIN users", () => {
    vi.mocked(useClientAuthSession).mockReturnValue({
      user: {
        id: "u-1",
        username: "alice",
        email: "alice@example.com",
        role: "ADMIN",
        group: "A",
      },
    });
    flushSync(() => {
      root.render(React.createElement(DashboardShell, BASE_PROPS));
    });
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.some((a) => a.textContent?.includes("Permissions"))).toBe(
      false,
    );
  });

  it("highlights the Schedule link when on /visualization", () => {
    vi.mocked(usePathname).mockReturnValue("/visualization");
    flushSync(() => {
      root.render(React.createElement(DashboardShell, BASE_PROPS));
    });
    const scheduleLink = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "Schedule",
    );
    expect(scheduleLink?.className).toContain("blue");
  });

  it("shows the session box with username and logout button", () => {
    flushSync(() => {
      root.render(React.createElement(DashboardShell, BASE_PROPS));
    });
    expect(container.textContent).toContain("alice");
    const logoutBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Logout"),
    );
    expect(logoutBtn).toBeDefined();
  });

  it("renders topSection when provided and top bar is visible", () => {
    flushSync(() => {
      root.render(
        React.createElement(DashboardShell, {
          ...BASE_PROPS,
          topSection: React.createElement("div", null, "top section content"),
        }),
      );
    });
    expect(container.textContent).toContain("top section content");
  });
});
