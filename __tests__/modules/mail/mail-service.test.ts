import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MailConfigurationError,
  MailSendError,
  resetMailClientForTests,
  sendMail,
} from "@/modules/mail/mail-service";

const beginSend = vi.fn();
const { createTransport, sendSmtpMail } = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendSmtpMail: vi.fn(),
}));

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

vi.mock("nodemailer", () => ({
  default: {
    createTransport,
  },
}));

describe("mail-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTransport.mockReturnValue({ sendMail: sendSmtpMail });
    sendSmtpMail.mockResolvedValue({ messageId: "smtp-message-1" });
    resetMailClientForTests();
    process.env.AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING =
      "endpoint=https://example.communication.azure.com/;accesskey=test";
    process.env.AZURE_COMMUNICATION_EMAIL_SENDER_ADDRESS =
      "DoNotReply@example.com";
    delete process.env.AZURE_COMMUNICATION_EMAIL_SEND_TIMEOUT_MS;
    delete process.env.AZURE_COMMUNICATION_EMAIL_POLL_INTERVAL_MS;
    delete process.env.SMTP_FALLBACK_ENABLED;
    delete process.env.SMTP_FALLBACK_HOST;
    delete process.env.SMTP_FALLBACK_PORT;
    delete process.env.SMTP_FALLBACK_SECURE;
    delete process.env.SMTP_FALLBACK_USER;
    delete process.env.SMTP_FALLBACK_PASSWORD;
    delete process.env.SMTP_FALLBACK_FROM_ADDRESS;
  });

  function enableSmtpFallback() {
    process.env.SMTP_FALLBACK_ENABLED = "true";
    process.env.SMTP_FALLBACK_HOST = "smtp.gmail.com";
    process.env.SMTP_FALLBACK_PORT = "465";
    process.env.SMTP_FALLBACK_SECURE = "true";
    process.env.SMTP_FALLBACK_USER = "mailer@example.com";
    process.env.SMTP_FALLBACK_PASSWORD = "app-password";
    process.env.SMTP_FALLBACK_FROM_ADDRESS = "DoNotReply@example.com";
  }

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

    expect(beginSend).toHaveBeenCalledWith(
      {
        senderAddress: "DoNotReply@example.com",
        content: {
          subject: "Schedule completed",
          plainText: "The schedule has completed.",
          html: "<p>The schedule has completed.</p>",
        },
        recipients: {
          to: [{ address: "user@example.com", displayName: "User" }],
        },
      },
      {
        abortSignal: expect.any(AbortSignal),
        updateIntervalInMs: 1000,
      },
    );
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

  it("falls back to SMTP when Azure returns a failed send status", async () => {
    enableSmtpFallback();
    beginSend.mockResolvedValueOnce({
      pollUntilDone: vi.fn().mockResolvedValue({
        id: "operation-2",
        status: "Failed",
        error: { message: "Domain is not verified." },
      }),
    });

    await expect(
      sendMail({
        to: [{ address: "user@example.com", displayName: "User" }],
        subject: "Fallback",
        plainText: "Use SMTP.",
        html: "<p>Use SMTP.</p>",
      }),
    ).resolves.toEqual({
      id: "smtp-message-1",
      status: "SmtpFallbackSucceeded",
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: "mailer@example.com",
        pass: "app-password",
      },
    });
    expect(sendSmtpMail).toHaveBeenCalledWith({
      from: "DoNotReply@example.com",
      to: [{ address: "user@example.com", name: "User" }],
      subject: "Fallback",
      text: "Use SMTP.",
      html: "<p>Use SMTP.</p>",
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  });

  it("falls back to SMTP when Azure throws during send", async () => {
    enableSmtpFallback();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    beginSend.mockRejectedValueOnce(new Error("Azure request failed"));

    try {
      await expect(
        sendMail({
          to: [{ address: "user@example.com" }],
          subject: "Fallback",
          plainText: "Use SMTP.",
        }),
      ).resolves.toEqual({
        id: "smtp-message-1",
        status: "SmtpFallbackSucceeded",
      });

      expect(sendSmtpMail).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        "Azure email send failed. Falling back to SMTP. Error: Azure request failed",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("defaults SMTP fallback secure to true on port 465", async () => {
    process.env.SMTP_FALLBACK_ENABLED = "true";
    process.env.SMTP_FALLBACK_HOST = "smtp.gmail.com";
    process.env.SMTP_FALLBACK_PORT = "465";
    process.env.SMTP_FALLBACK_USER = "mailer@example.com";
    process.env.SMTP_FALLBACK_PASSWORD = "app-password";
    process.env.SMTP_FALLBACK_FROM_ADDRESS = "DoNotReply@example.com";
    beginSend.mockRejectedValueOnce(new Error("Azure request failed"));

    await expect(
      sendMail({
        to: [{ address: "user@example.com" }],
        subject: "Fallback",
        plainText: "Use SMTP.",
      }),
    ).resolves.toEqual({
      id: "smtp-message-1",
      status: "SmtpFallbackSucceeded",
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: "mailer@example.com",
        pass: "app-password",
      },
    });
  });

  it("can return after Azure accepts the send operation", async () => {
    const pollUntilDone = vi.fn();
    beginSend.mockResolvedValueOnce({
      getResult: vi.fn().mockReturnValue({
        id: "operation-queued",
        status: "Running",
      }),
      pollUntilDone,
    });

    await expect(
      sendMail({
        to: [{ address: "user@example.com" }],
        subject: "Queued",
        plainText: "Do not wait for delivery.",
        waitForDelivery: false,
      }),
    ).resolves.toEqual({ id: "operation-queued", status: "Running" });

    expect(pollUntilDone).not.toHaveBeenCalled();
  });

  it("returns pending when Azure delivery polling times out", async () => {
    vi.useFakeTimers();
    try {
      process.env.AZURE_COMMUNICATION_EMAIL_SEND_TIMEOUT_MS = "25";
      process.env.SMTP_FALLBACK_ENABLED = "true";
      process.env.SMTP_FALLBACK_HOST = "smtp.gmail.com";
      process.env.SMTP_FALLBACK_PORT = "465";
      process.env.SMTP_FALLBACK_USER = "mailer@example.com";
      process.env.SMTP_FALLBACK_PASSWORD = "app-password";
      process.env.SMTP_FALLBACK_FROM_ADDRESS = "DoNotReply@example.com";

      const pollUntilDone = vi.fn(
        (options?: { abortSignal?: AbortSignal }) =>
          new Promise((_, reject) => {
            options?.abortSignal?.addEventListener("abort", () => {
              reject(new Error("aborted"));
            });
          }),
      );
      beginSend.mockResolvedValueOnce({
        getResult: vi.fn().mockReturnValue({
          id: "operation-queued",
          status: "Running",
        }),
        pollUntilDone,
      });

      const promise = sendMail({
        to: [{ address: "user@example.com" }],
        subject: "Timeout",
        plainText: "This should time out.",
      });

      await vi.advanceTimersByTimeAsync(25);
      await expect(promise).resolves.toEqual({
        id: "operation-queued",
        status: "Running",
      });
      expect(pollUntilDone).toHaveBeenCalledWith({
        abortSignal: expect.any(AbortSignal),
      });
      expect(sendSmtpMail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
