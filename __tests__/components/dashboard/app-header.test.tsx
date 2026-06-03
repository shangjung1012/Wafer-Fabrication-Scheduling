/**
 * @vitest-environment jsdom
 */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/visualization/dashboard",
  replace: vi.fn(),
  logout: vi.fn(),
  session: {
    user: {
      id: "superadmin-1",
      username: "superadmin",
      email: "superadmin@example.com",
      role: "SUPERADMIN",
    },
  },
}));

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
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/modules/auth/use-client-auth-session", () => ({
  useClientAuthSession: () => mocks.session,
}));

vi.mock("@/modules/auth/client-session", () => ({
  logoutClientAuthSession: () => mocks.logout(),
}));

import { AppHeader } from "@/components/dashboard/AppHeader";

beforeEach(() => {
  mocks.pathname = "/visualization/dashboard";
  mocks.replace.mockReset();
  mocks.logout.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppHeader", () => {
  it("renders navigation, superadmin permissions link, and session details", () => {
    render(<AppHeader title="Factory Console" subtitle="Shift overview" />);

    expect(screen.getByText("Factory Console")).toBeTruthy();
    expect(screen.getByText("Shift overview")).toBeTruthy();
    expect(screen.getByText("Dashboard").getAttribute("href")).toBe(
      "/visualization/dashboard",
    );
    expect(screen.getByText("Permissions").getAttribute("href")).toBe(
      "/permissions",
    );
    expect(screen.getByText("superadmin")).toBeTruthy();
    expect(screen.getByText("(superadmin@example.com)")).toBeTruthy();
    expect(screen.getByText("SUPERADMIN")).toBeTruthy();
  });

  it("logs out and navigates to login", async () => {
    render(<AppHeader title="Factory Console" subtitle="Shift overview" />);

    fireEvent.click(screen.getByText("Logout"));

    await waitFor(() => {
      expect(mocks.logout).toHaveBeenCalled();
      expect(mocks.replace).toHaveBeenCalledWith("/login");
    });
  });
});
