import { EmailClient, KnownEmailSendStatus } from "@azure/communication-email";

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

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new MailConfigurationError(`${name} is required.`);
  }
  return value;
}

function getEmailClient(): EmailClient {
  if (!emailClient) {
    emailClient = new EmailClient(
      requiredEnv("AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING"),
    );
  }
  return emailClient;
}

export function resetMailClientForTests(): void {
  emailClient = undefined;
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  if (input.to.length === 0) {
    throw new MailSendError("At least one recipient is required.");
  }

  const senderAddress = requiredEnv("AZURE_COMMUNICATION_EMAIL_SENDER_ADDRESS");
  const abort = new AbortController();
  const timeoutId = setTimeout(
    () => abort.abort(),
    30_000, // 30-second hard timeout
  );

  let poller;
  try {
    poller = await getEmailClient().beginSend({
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
  } catch (err) {
    clearTimeout(timeoutId);
    throw new MailSendError(
      err instanceof Error ? err.message : "Failed to initiate email send.",
    );
  }

  let response;
  try {
    response = await poller.pollUntilDone({ abortSignal: abort.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout =
      err instanceof Error &&
      (err.name === "AbortError" || abort.signal.aborted);
    throw new MailSendError(
      isTimeout
        ? "Email send timed out — the mail service did not respond within 30 seconds."
        : err instanceof Error
          ? err.message
          : "Email send failed.",
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status !== KnownEmailSendStatus.Succeeded) {
    throw new MailSendError(
      response.error?.message ?? `Email send status: ${response.status}`,
    );
  }

  return {
    id: response.id,
    status: response.status,
  };
}
