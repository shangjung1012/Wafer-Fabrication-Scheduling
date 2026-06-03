/**
 * @vitest-environment jsdom
 */
import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthLoginPanel } from "@/app/(auth)/_components/auth-login-panel";
import type { ClientAuthSession } from "@/modules/auth/client-session";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockPersist = vi.fn();
const mockClear = vi.fn();
const mockSetPostLogoutPath = vi.fn();

vi.mock("@/modules/auth/client-session", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/auth/client-session")
  >("@/modules/auth/client-session");
  return {
    ...actual,
    persistClientAuthSession: (...args: unknown[]) => mockPersist(...args),
    clearClientAuthSession: () => mockClear(),
    setPostLogoutLoginPath: (...args: unknown[]) =>
      mockSetPostLogoutPath(...args),
  };
});

let mockSession: ClientAuthSession | null = null;

vi.mock("@/modules/auth/use-client-auth-session", () => ({
  useClientAuthSession: () => mockSession,
}));

const adminSession: ClientAuthSession = {
  user: {
    id: "u1",
    username: "admin-A",
    email: "admin@example.com",
    role: "ADMIN",
    group: "A",
  },
};

const superAdminSession: ClientAuthSession = {
  user: { ...adminSession.user, role: "SUPERADMIN" },
};

const salesSession: ClientAuthSession = {
  user: { ...adminSession.user, role: "SALES" },
};

function makeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

describe("AuthLoginPanel", () => {
  beforeEach(() => {
    mockSession = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the title and login section when there is no session", () => {
    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
      />,
    );

    expect(screen.getByText("Auth Test")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Login" })).toBeTruthy();
    expect(
      screen.getByText(
        "No active session. Login to issue tokens and enable protected API calls.",
      ),
    ).toBeTruthy();
  });

  it("renders session info when a session exists", () => {
    mockSession = adminSession;
    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
      />,
    );

    expect(screen.getByText("admin-A")).toBeTruthy();
    expect(screen.getByText("ADMIN")).toBeTruthy();
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("shows SUPERADMIN role badge", () => {
    mockSession = superAdminSession;
    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
      />,
    );
    expect(screen.getAllByText("SUPERADMIN").length).toBeGreaterThan(0);
  });

  it("shows SALES role badge", () => {
    mockSession = salesSession;
    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
      />,
    );
    expect(screen.getAllByText("SALES").length).toBeGreaterThan(0);
  });

  it("shows default role tone for unknown role", () => {
    mockSession = {
      user: {
        id: "u1",
        username: "x",
        email: "x@x.com",
        role: "SALES",
        group: null,
      },
    };
    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
      />,
    );
    expect(screen.getByText("SALES")).toBeTruthy();
  });

  it("renders quick account buttons and fills username on click", async () => {
    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
        quickAccounts={[
          { label: "SA-1", username: "sa-1", email: "sa-1@mail.com" },
        ]}
      />,
    );

    const btn = screen.getByText("SA-1");
    await act(async () => {
      fireEvent.click(btn);
    });

    const usernameInput = screen.getByPlaceholderText(
      "SA-1 or sa-1@mail.com",
    ) as HTMLInputElement;
    expect(usernameInput.value).toBe("sa-1");
  });

  it("toggles password visibility", async () => {
    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
      />,
    );

    const pwInput = screen.getByLabelText("Password") as HTMLInputElement;
    expect(pwInput.type).toBe("password");

    const showBtn = screen.getByRole("button", { name: "Show password" });
    await act(async () => {
      fireEvent.click(showBtn);
    });
    expect(pwInput.type).toBe("text");

    const hideBtn = screen.getByRole("button", { name: "Hide password" });
    await act(async () => {
      fireEvent.click(hideBtn);
    });
    expect(pwInput.type).toBe("password");
  });

  it("uses demo password input id for login-demo endpoint", () => {
    render(
      <AuthLoginPanel
        title="Demo"
        loginEndpoint="/api/auth/login-demo"
        postLogoutPath="/login-demo"
      />,
    );
    expect(document.getElementById("login-demo-password")).toBeTruthy();
  });

  it("uses login password input id for regular login endpoint", () => {
    render(
      <AuthLoginPanel
        title="Login"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
      />,
    );
    expect(document.getElementById("login-password")).toBeTruthy();
  });

  it("handleLogin success: persists session and redirects", async () => {
    const sessionBody: ClientAuthSession = {
      user: {
        id: "u2",
        username: "bob",
        email: "bob@x.com",
        role: "ADMIN",
        group: null,
      },
    };
    vi.stubGlobal("fetch", makeFetch(200, sessionBody));

    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
        initialUsername="bob"
        initialPassword="Password123!"
      />,
    );

    const loginBtn = screen.getByRole("button", { name: /^Login$/ });
    await act(async () => {
      fireEvent.click(loginBtn);
    });
    await waitFor(() => expect(mockPersist).toHaveBeenCalledWith(sessionBody));
    expect(mockSetPostLogoutPath).toHaveBeenCalledWith("/login");
    expect(mockReplace).toHaveBeenCalledWith("/visualization/dashboard");
  });

  it("handleLogin failure: shows error message", async () => {
    vi.stubGlobal("fetch", makeFetch(401, { error: "unauthorized" }));

    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
        initialUsername="wrong"
        initialPassword="bad"
      />,
    );

    const loginBtn = screen.getByRole("button", { name: /^Login$/ });
    await act(async () => {
      fireEvent.click(loginBtn);
    });
    await waitFor(() =>
      expect(screen.getByText("Login failed (401)")).toBeTruthy(),
    );
  });

  it("handleLogout: clears session and shows message", async () => {
    mockSession = adminSession;
    vi.stubGlobal("fetch", makeFetch(200, {}));

    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
      />,
    );

    const logoutBtn = screen.getByText("Logout");
    await act(async () => {
      fireEvent.click(logoutBtn);
    });
    await waitFor(() => expect(mockClear).toHaveBeenCalled());
    expect(
      screen.getByText("Logged out. Local tokens were cleared."),
    ).toBeTruthy();
  });

  it("handleRefresh success: persists new session and shows message", async () => {
    mockSession = adminSession;
    const refreshedSession: ClientAuthSession = {
      user: { ...adminSession.user, username: "refreshed" },
    };
    vi.stubGlobal("fetch", makeFetch(200, refreshedSession));

    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
      />,
    );

    const refreshBtn = screen.getByText("Refresh token");
    await act(async () => {
      fireEvent.click(refreshBtn);
    });
    await waitFor(() =>
      expect(mockPersist).toHaveBeenCalledWith(refreshedSession),
    );
    expect(screen.getByText("Token refreshed.")).toBeTruthy();
  });

  it("handleRefresh failure: clears session and shows error message", async () => {
    mockSession = adminSession;
    vi.stubGlobal("fetch", makeFetch(401, { error: "expired" }));

    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
      />,
    );

    const refreshBtn = screen.getByText("Refresh token");
    await act(async () => {
      fireEvent.click(refreshBtn);
    });
    await waitFor(() => expect(mockClear).toHaveBeenCalled());
    expect(
      screen.getByText("Refresh failed (401). Please log in again."),
    ).toBeTruthy();
  });

  it("handleProbeUsers success: shows allowed message and api result", async () => {
    mockSession = adminSession;
    const usersData = [{ id: "u1" }];
    vi.stubGlobal("fetch", makeFetch(200, usersData));

    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
      />,
    );

    const testBtn = screen.getByText("Test /api/users");
    await act(async () => {
      fireEvent.click(testBtn);
    });
    await waitFor(() =>
      expect(
        screen.getByText("Protected API allowed this token."),
      ).toBeTruthy(),
    );
  });

  it("handleProbeUsers failure: shows rejected message", async () => {
    mockSession = adminSession;
    vi.stubGlobal("fetch", makeFetch(401, { error: "nope" }));

    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
      />,
    );

    const testBtn = screen.getByText("Test /api/users");
    await act(async () => {
      fireEvent.click(testBtn);
    });
    await waitFor(() =>
      expect(
        screen.getByText("Protected API rejected this token."),
      ).toBeTruthy(),
    );
  });

  it("shows api result JSON when apiResult is set", async () => {
    vi.stubGlobal("fetch", makeFetch(401, { code: "UNAUTH" }));

    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
        initialUsername="u"
        initialPassword="p"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Login$/ }));
    });
    await waitFor(() => expect(screen.getByText(/UNAUTH/)).toBeTruthy());
  });

  it("shows group as dash when group is null", () => {
    mockSession = { user: { ...adminSession.user, group: null } };
    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
      />,
    );
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("populates username and password with initialValues", () => {
    render(
      <AuthLoginPanel
        title="Auth Test"
        loginEndpoint="/api/auth/login"
        postLogoutPath="/login"
        initialUsername="pre-filled"
        initialPassword="pre-pass"
      />,
    );
    const usernameInput = screen.getByPlaceholderText(
      "Username or email",
    ) as HTMLInputElement;
    expect(usernameInput.value).toBe("pre-filled");
  });
});
