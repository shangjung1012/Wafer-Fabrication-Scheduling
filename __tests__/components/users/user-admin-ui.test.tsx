/**
 * @vitest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RoleBadge, StatusBadge } from "@/components/users/user-admin-ui";

describe("user admin UI badges", () => {
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
  });

  it("renders role labels with the matching tone", () => {
    flushSync(() => {
      root.render(
        <>
          <RoleBadge role="SUPERADMIN" />
          <RoleBadge role="ADMIN" />
          <RoleBadge role="SALES" />
          <RoleBadge role="AUDITOR" />
        </>,
      );
    });

    const badges = Array.from(container.querySelectorAll("span"));
    expect(badges.map((badge) => badge.textContent)).toEqual([
      "SUPERADMIN",
      "ADMIN",
      "SALES",
      "AUDITOR",
    ]);
    expect(badges[1].style.background).toBe("rgb(219, 234, 254)");
    expect(badges[1].style.color).toBe("rgb(30, 64, 175)");
  });

  it("renders pending and active status labels", () => {
    flushSync(() => {
      root.render(
        <>
          <StatusBadge pending={true} />
          <StatusBadge pending={false} />
        </>,
      );
    });

    expect(container.textContent).toContain("PENDING");
    expect(container.textContent).toContain("ACTIVE");
  });
});
