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
      getResult: vi.fn().mockReturnValue({
        id: "operation-1",
        status: "Accepted",
      }),
    });

    await expect(
      sendMail({
        to: [{ address: "user@example.com", displayName: "User" }],
        subject: "Schedule completed",
        plainText: "The schedule has completed.",
        html: "<p>The schedule has completed.</p>",
      }),
    ).resolves.toEqual({ id: "operation-1", status: "Accepted" });

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

  it("sends mail through SMTP when fallback is enabled", async () => {
    enableSmtpFallback();
    beginSend.mockResolvedValueOnce({
      getResult: vi.fn().mockReturnValue({
        id: "operation-2",
        status: "Accepted",
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

    expect(beginSend).not.toHaveBeenCalled();
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

  it("uses SMTP_FALLBACK_USER as from address when SMTP_FALLBACK_FROM_ADDRESS is unset", async () => {
    process.env.SMTP_FALLBACK_ENABLED = "true";
    process.env.SMTP_FALLBACK_HOST = "smtp.example.com";
    process.env.SMTP_FALLBACK_PORT = "587";
    process.env.SMTP_FALLBACK_SECURE = "false";
    process.env.SMTP_FALLBACK_USER = "noreply@example.com";
    process.env.SMTP_FALLBACK_PASSWORD = "pass";
    delete process.env.SMTP_FALLBACK_FROM_ADDRESS;

    await sendMail({
      to: [{ address: "user@example.com" }],
      subject: "Test",
      plainText: "Hello",
    });

    expect(sendSmtpMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "noreply@example.com" }),
    );
  });

  it("includes cc, bcc, and replyTo fields in SMTP send when provided", async () => {
    process.env.SMTP_FALLBACK_ENABLED = "true";
    process.env.SMTP_FALLBACK_HOST = "smtp.example.com";
    process.env.SMTP_FALLBACK_PORT = "587";
    process.env.SMTP_FALLBACK_USER = "noreply@example.com";
    process.env.SMTP_FALLBACK_PASSWORD = "pass";
    process.env.SMTP_FALLBACK_FROM_ADDRESS = "DoNotReply@example.com";

    await sendMail({
      to: [{ address: "to@example.com" }],
      cc: [{ address: "cc@example.com" }],
      bcc: [{ address: "bcc@example.com" }],
      replyTo: [{ address: "reply@example.com" }],
      subject: "Full Test",
      plainText: "Body",
      html: "<p>Body</p>",
    });

    expect(sendSmtpMail).toHaveBeenCalledWith(
      expect.objectContaining({
        cc: expect.arrayContaining([
          expect.objectContaining({ address: "cc@example.com" }),
        ]),
        bcc: expect.arrayContaining([
          expect.objectContaining({ address: "bcc@example.com" }),
        ]),
      }),
    );
  });

  it("defaults SMTP fallback secure to true on port 465", async () => {
    process.env.SMTP_FALLBACK_ENABLED = "true";
    process.env.SMTP_FALLBACK_HOST = "smtp.gmail.com";
    process.env.SMTP_FALLBACK_PORT = "465";
    process.env.SMTP_FALLBACK_USER = "mailer@example.com";
    process.env.SMTP_FALLBACK_PASSWORD = "app-password";
    process.env.SMTP_FALLBACK_FROM_ADDRESS = "DoNotReply@example.com";

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

    expect(beginSend).not.toHaveBeenCalled();
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

  it("falls back to default port when SMTP_FALLBACK_PORT is not a positive integer", async () => {
    process.env.SMTP_FALLBACK_ENABLED = "true";
    process.env.SMTP_FALLBACK_HOST = "smtp.example.com";
    process.env.SMTP_FALLBACK_PORT = "not-a-number";
    process.env.SMTP_FALLBACK_USER = "user@example.com";
    process.env.SMTP_FALLBACK_PASSWORD = "pass";
    process.env.SMTP_FALLBACK_FROM_ADDRESS = "noreply@example.com";

    await sendMail({
      to: [{ address: "to@example.com" }],
      subject: "Test",
      plainText: "Hello",
    });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465 }),
    );
  });

  it("falls back to default port when SMTP_FALLBACK_PORT is negative", async () => {
    process.env.SMTP_FALLBACK_ENABLED = "true";
    process.env.SMTP_FALLBACK_HOST = "smtp.example.com";
    process.env.SMTP_FALLBACK_PORT = "-1";
    process.env.SMTP_FALLBACK_USER = "user@example.com";
    process.env.SMTP_FALLBACK_PASSWORD = "pass";
    process.env.SMTP_FALLBACK_FROM_ADDRESS = "noreply@example.com";

    await sendMail({
      to: [{ address: "to@example.com" }],
      subject: "Test",
      plainText: "Hello",
    });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465 }),
    );
  });

  it("includes replyTo in Azure send when provided", async () => {
    beginSend.mockResolvedValueOnce({
      getResult: vi.fn().mockReturnValue({ id: "op-2", status: "Accepted" }),
    });

    await sendMail({
      to: [{ address: "to@example.com" }],
      cc: [{ address: "cc@example.com" }],
      bcc: [{ address: "bcc@example.com" }],
      replyTo: [{ address: "reply@example.com" }],
      subject: "Azure Full",
      plainText: "body",
    });

    expect(beginSend).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: [{ address: "reply@example.com" }],
        recipients: expect.objectContaining({
          cc: [{ address: "cc@example.com" }],
          bcc: [{ address: "bcc@example.com" }],
        }),
      }),
    );
  });

  it("caches the smtp transporter across calls", async () => {
    process.env.SMTP_FALLBACK_ENABLED = "true";
    process.env.SMTP_FALLBACK_HOST = "smtp.example.com";
    process.env.SMTP_FALLBACK_PORT = "587";
    process.env.SMTP_FALLBACK_USER = "user@example.com";
    process.env.SMTP_FALLBACK_PASSWORD = "pass";
    process.env.SMTP_FALLBACK_FROM_ADDRESS = "noreply@example.com";

    await sendMail({
      to: [{ address: "to@example.com" }],
      subject: "First",
      plainText: "Hello",
    });
    await sendMail({
      to: [{ address: "to@example.com" }],
      subject: "Second",
      plainText: "Hello again",
    });

    // createTransport only called once (transporter is cached)
    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it("re-throws emailClient init failure on subsequent calls", async () => {
    delete process.env.AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING;

    await expect(
      sendMail({
        to: [{ address: "to@example.com" }],
        subject: "First fail",
        plainText: "Hello",
      }),
    ).rejects.toThrow();

    await expect(
      sendMail({
        to: [{ address: "to@example.com" }],
        subject: "Second fail",
        plainText: "Hello",
      }),
    ).rejects.toThrow(MailConfigurationError);
  });
});
