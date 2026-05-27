import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MailConfigurationError,
  MailSendError,
  resetMailClientForTests,
  sendMail,
} from "@/modules/mail/mail-service";

const beginSend = vi.fn();

vi.mock("@azure/communication-email", () => ({
  EmailClient: vi.fn(
    class {
      beginSend = beginSend;
    },
  ),
  KnownEmailSendStatus: {
    Succeeded: "Succeeded",
    Failed: "Failed",
  },
}));

describe("mail-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMailClientForTests();
    process.env.AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING =
      "endpoint=https://example.communication.azure.com/;accesskey=test";
    process.env.AZURE_COMMUNICATION_EMAIL_SENDER_ADDRESS =
      "DoNotReply@example.com";
  });

  it("sends mail through Azure Communication Services Email", async () => {
    beginSend.mockResolvedValueOnce({
      pollUntilDone: vi.fn().mockResolvedValue({
        id: "operation-1",
        status: "Succeeded",
      }),
    });

    await expect(
      sendMail({
        to: [{ address: "user@example.com", displayName: "User" }],
        subject: "Schedule completed",
        plainText: "The schedule has completed.",
        html: "<p>The schedule has completed.</p>",
      }),
    ).resolves.toEqual({ id: "operation-1", status: "Succeeded" });

    expect(beginSend).toHaveBeenCalledWith({
      senderAddress: "DoNotReply@example.com",
      content: {
        subject: "Schedule completed",
        plainText: "The schedule has completed.",
        html: "<p>The schedule has completed.</p>",
      },
      recipients: {
        to: [{ address: "user@example.com", displayName: "User" }],
      },
    });
  });

  it("requires Azure Email configuration", async () => {
    delete process.env.AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING;

    await expect(
      sendMail({
        to: [{ address: "user@example.com" }],
        subject: "Missing config",
        plainText: "This should fail.",
      }),
    ).rejects.toThrow(MailConfigurationError);
  });

  it("rejects empty recipients", async () => {
    await expect(
      sendMail({
        to: [],
        subject: "No recipients",
        plainText: "This should fail.",
      }),
    ).rejects.toThrow(MailSendError);
  });

  it("raises send errors from failed Azure operations", async () => {
    beginSend.mockResolvedValueOnce({
      pollUntilDone: vi.fn().mockResolvedValue({
        id: "operation-2",
        status: "Failed",
        error: { message: "Domain is not verified." },
      }),
    });

    await expect(
      sendMail({
        to: [{ address: "user@example.com" }],
        subject: "Failure",
        plainText: "This should fail.",
      }),
    ).rejects.toThrow("Domain is not verified.");
  });
});
