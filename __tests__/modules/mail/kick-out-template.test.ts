import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { kickOutTemplate } from "@/modules/mail/templates/kick-out";

describe("kickOutTemplate", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("has the correct id and name", () => {
    expect(kickOutTemplate.id).toBe("kick-out-notification");
    expect(kickOutTemplate.name).toBe("Order Kicked Out Notification");
  });

  it("sends to the applicant email", () => {
    const result = kickOutTemplate.build({
      orderName: "Order #1",
      applicantEmail: "sales@example.com",
      applicantUsername: "salesperson",
    });

    expect(result.to).toEqual([
      { address: "sales@example.com", displayName: "salesperson" },
    ]);
  });

  it("uses email as displayName when username is null", () => {
    const result = kickOutTemplate.build({
      orderName: "Order #1",
      applicantEmail: "sales@example.com",
      applicantUsername: null,
    });

    expect(result.to[0].displayName).toBe("sales@example.com");
  });

  it("includes the order name in the subject", () => {
    const result = kickOutTemplate.build({
      orderName: "Wafer Batch 42",
      applicantEmail: "s@e.com",
      applicantUsername: null,
    });

    expect(result.subject).toContain("Wafer Batch 42");
  });

  it("includes the order name and app URL in the plain text body", () => {
    const result = kickOutTemplate.build({
      orderName: "Batch X",
      applicantEmail: "s@e.com",
      applicantUsername: "seller",
    });

    expect(result.plainText).toContain("Batch X");
    expect(result.plainText).toContain("http://localhost:3000");
    expect(result.plainText).toContain("APPROVED");
  });

  it("includes the order name in the HTML body", () => {
    const result = kickOutTemplate.build({
      orderName: "Batch X",
      applicantEmail: "s@e.com",
      applicantUsername: "seller",
    });

    expect(result.html).toContain("Batch X");
    expect(result.html).toContain("APPROVED");
  });

  it("HTML-escapes special characters in order name", () => {
    const result = kickOutTemplate.build({
      orderName: '<script>alert("xss")</script>',
      applicantEmail: "s@e.com",
      applicantUsername: null,
    });

    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });

  it("falls back to empty string when APP_BASE_URL is unset", () => {
    vi.unstubAllEnvs();

    const result = kickOutTemplate.build({
      orderName: "O",
      applicantEmail: "s@e.com",
      applicantUsername: null,
    });

    // Should not throw and should still produce a valid email
    expect(result.to[0].address).toBe("s@e.com");
  });
});
