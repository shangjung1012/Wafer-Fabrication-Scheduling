// @vitest-environment jsdom

import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";

// mock next/navigation before importing the page so useRouter is available
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import PermissionsPage from "@/app/(dashboard)/permissions/page";

describe("Permissions page invite flow", () => {
  let originalFetch: any;
  let originalAlert: any;

  beforeEach(() => {
    // capture originals
    originalFetch = global.fetch;
    originalAlert = (globalThis as any).alert;

    // set a superadmin session in localStorage so useClientAuthSession returns it
    localStorage.setItem(
      "auth_user",
      JSON.stringify({
        id: "admin1",
        username: "super",
        email: "admin@example.com",
        role: "SUPERADMIN",
        group: "A",
      }),
    );

    // default fetch: GET /api/users -> empty list
    global.fetch = vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input);
      if (url.startsWith("/api/users") && (!init || init.method === "GET")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [] }),
        });
      }
      // fallback
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({}),
      });
    }) as any;

    (globalThis as any).alert = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    (globalThis as any).alert = originalAlert;
    localStorage.clear();
    vi.resetAllMocks();
  });

  it("shows alert and adds invited user to list optimistically", async () => {
    // Mock fetch to handle both GET and POST for /api/users
    (global.fetch as any).mockImplementation(
      (input: RequestInfo, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (url === "/api/users" && init && init.method === "POST") {
          const body = JSON.parse(String(init.body));
          const created = {
            id: "u-new",
            email: body.email,
            role: body.role,
            group: body.group,
            invitationExpiresAt: new Date().toISOString(),
          };
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => created,
          });
        }
        if (url.startsWith("/api/users") && (!init || init.method === "GET")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ items: [] }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({}),
        });
      },
    );

    const { container } = render(<PermissionsPage />);

    // wait for initial loadUsers to complete
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    // fill form
    const emailInput = screen.getByPlaceholderText("person@example.com");
    fireEvent.change(emailInput, { target: { value: "newuser@example.com" } });
    await waitFor(() =>
      expect((emailInput as HTMLInputElement).value).toBe(
        "newuser@example.com",
      ),
    );

    // submit the form explicitly
    const form = container.querySelector("form") as HTMLFormElement | null;
    if (!form) throw new Error("form not found");
    fireEvent.submit(form);

    // expect alert called
    await waitFor(() =>
      expect(window.alert).toHaveBeenCalledWith(
        "Invitation sent to newuser@example.com.",
      ),
    );

    // the new user's email should appear in the table (optimistic add)
    expect(await screen.findByText("newuser@example.com")).toBeInTheDocument();
  });
});
