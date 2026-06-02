import { EmailClient } from "@azure/communication-email";
import nodemailer, { type Transporter } from "nodemailer";

type Recipient = {
  address: string;
  displayName?: string;
};

export type SendMailInput = {
  to: Recipient[];
  cc?: Recipient[];
  bcc?: Recipient[];
  subject: string;
  plainText: string;
  html?: string;
  replyTo?: Recipient[];
};

export type SendMailResult = {
  id: string;
  status: string;
};

export class MailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConfigurationError";
  }
}

export class MailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailSendError";
  }
}

let emailClient: EmailClient | undefined;
let emailClientInitFailed = false;
let smtpTransporter: Transporter | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new MailConfigurationError(`${name} is required.`);
  }
  return value;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (Number.isFinite(value) && value > 0) {
    return value;
  }

  console.warn(`${name} must be a positive integer. Using ${fallback}.`);
  return fallback;
}

function readBooleanEnv(name: string): boolean {
  return ["1", "true", "yes", "on"].includes(
    process.env[name]?.trim().toLowerCase() ?? "",
  );
}

function readOptionalBooleanEnv(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return undefined;

  return ["1", "true", "yes", "on"].includes(raw);
}

function isSmtpFallbackEnabled(): boolean {
  return readBooleanEnv("SMTP_FALLBACK_ENABLED");
}

function shouldUseSmtpTransport(): boolean {
  return isSmtpFallbackEnabled();
}

function getEmailClient(): EmailClient {
  if (emailClientInitFailed) {
    throw new MailConfigurationError(
      "AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING is invalid.",
    );
  }
  if (!emailClient) {
    const connectionString = requiredEnv(
      "AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING",
    );
    try {
      emailClient = new EmailClient(connectionString);
    } catch (err) {
      emailClientInitFailed = true;
      throw err;
    }
  }
  return emailClient;
}

function getSmtpTransporter(): Transporter {
  if (smtpTransporter) return smtpTransporter;

  const host = requiredEnv("SMTP_FALLBACK_HOST");
  const port = readPositiveIntegerEnv("SMTP_FALLBACK_PORT", 465);
  const secure = readOptionalBooleanEnv("SMTP_FALLBACK_SECURE") ?? port === 465;
  const user = requiredEnv("SMTP_FALLBACK_USER");
  const pass = requiredEnv("SMTP_FALLBACK_PASSWORD");

  smtpTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return smtpTransporter;
}

export function resetMailClientForTests(): void {
  emailClient = undefined;
  emailClientInitFailed = false;
  smtpTransporter = undefined;
}

function toSmtpRecipients(recipients: Recipient[]) {
  return recipients.map((recipient) => ({
    address: recipient.address,
    name: recipient.displayName ?? recipient.address,
  }));
}

async function sendWithSmtpFallback(
  input: SendMailInput,
): Promise<SendMailResult> {
  const from = process.env.SMTP_FALLBACK_FROM_ADDRESS?.trim()
    ? process.env.SMTP_FALLBACK_FROM_ADDRESS.trim()
    : requiredEnv("SMTP_FALLBACK_USER");

  const response = await getSmtpTransporter().sendMail({
    from,
    to: toSmtpRecipients(input.to),
    ...(input.cc?.length ? { cc: toSmtpRecipients(input.cc) } : {}),
    ...(input.bcc?.length ? { bcc: toSmtpRecipients(input.bcc) } : {}),
    ...(input.replyTo?.length
      ? { replyTo: toSmtpRecipients(input.replyTo) }
      : {}),
    subject: input.subject,
    text: input.plainText,
    ...(input.html ? { html: input.html } : {}),
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    id: response.messageId,
    status: "SmtpFallbackSucceeded",
  };
}

async function sendWithAzure(input: SendMailInput): Promise<SendMailResult> {
  const senderAddress = requiredEnv("AZURE_COMMUNICATION_EMAIL_SENDER_ADDRESS");
  const response = await getEmailClient().beginSend({
    senderAddress,
    content: {
      subject: input.subject,
      plainText: input.plainText,
      ...(input.html ? { html: input.html } : {}),
    },
    recipients: {
      to: input.to,
      ...(input.cc?.length ? { cc: input.cc } : {}),
      ...(input.bcc?.length ? { bcc: input.bcc } : {}),
    },
    ...(input.replyTo?.length ? { replyTo: input.replyTo } : {}),
  });

  const result = response.getResult();
  return {
    id: result?.id ?? "unknown",
    status: result?.status ?? "Accepted",
  };
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  if (input.to.length === 0) {
    throw new MailSendError("At least one recipient is required.");
  }

  if (shouldUseSmtpTransport()) {
    return sendWithSmtpFallback(input);
  }

  return sendWithAzure(input);
}
