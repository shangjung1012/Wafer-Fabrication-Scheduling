import { EmailClient, KnownEmailSendStatus } from "@azure/communication-email";
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
  waitForDelivery?: boolean;
  azureSendTimeoutMs?: number;
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

const DEFAULT_SEND_TIMEOUT_MS = 15000;
const DEFAULT_POLL_INTERVAL_MS = 1000;

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

async function fallbackOrThrow(
  input: SendMailInput,
  error: unknown,
  message: string,
): Promise<SendMailResult> {
  if (isSmtpFallbackEnabled()) {
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    console.warn(`${message} ${detail}`);
    return sendWithSmtpFallback(input);
  }

  throw error;
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  if (input.to.length === 0) {
    throw new MailSendError("At least one recipient is required.");
  }

  const sendTimeoutMs =
    input.azureSendTimeoutMs ??
    readPositiveIntegerEnv(
      "AZURE_COMMUNICATION_EMAIL_SEND_TIMEOUT_MS",
      DEFAULT_SEND_TIMEOUT_MS,
    );
  const pollIntervalMs = readPositiveIntegerEnv(
    "AZURE_COMMUNICATION_EMAIL_POLL_INTERVAL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  );
  const abortController = new AbortController();
  let timedOut = false;
  let sendOperation:
    | {
        getResult: () => { id?: string; status?: string } | undefined;
        pollUntilDone: (options: { abortSignal?: AbortSignal }) => Promise<{
          id: string;
          status: string;
          error?: { message?: string };
        }>;
      }
    | undefined;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, sendTimeoutMs);

  try {
    const senderAddress = requiredEnv(
      "AZURE_COMMUNICATION_EMAIL_SENDER_ADDRESS",
    );
    sendOperation = await getEmailClient().beginSend(
      {
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
      },
      {
        abortSignal: abortController.signal,
        updateIntervalInMs: pollIntervalMs,
      },
    );

    if (input.waitForDelivery === false) {
      const response = sendOperation.getResult();
      return {
        id: response?.id ?? "unknown",
        status: response?.status ?? "Accepted",
      };
    }

    const response = await sendOperation.pollUntilDone({
      abortSignal: abortController.signal,
    });
    if (response.status !== KnownEmailSendStatus.Succeeded) {
      throw new MailSendError(
        response.error?.message ?? `Email send status: ${response.status}`,
      );
    }

    return {
      id: response.id,
      status: response.status,
    };
  } catch (error) {
    if (timedOut) {
      if (sendOperation) {
        const response = sendOperation.getResult();
        return {
          id: response?.id ?? "unknown",
          status: response?.status ?? "Pending",
        };
      }

      return fallbackOrThrow(
        input,
        new MailSendError(
          `Email send timed out after ${sendTimeoutMs}ms while waiting for Azure Communication Services.`,
        ),
        `Azure email send timed out after ${sendTimeoutMs}ms. Falling back to SMTP.`,
      );
    }

    return fallbackOrThrow(
      input,
      error,
      "Azure email send failed. Falling back to SMTP.",
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
