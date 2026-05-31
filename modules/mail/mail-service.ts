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
let emailClientInitFailed = false;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new MailConfigurationError(`${name} is required.`);
  }
  return value;
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

export function resetMailClientForTests(): void {
  emailClient = undefined;
  emailClientInitFailed = false;
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  if (input.to.length === 0) {
    throw new MailSendError("At least one recipient is required.");
  }

  const senderAddress = requiredEnv("AZURE_COMMUNICATION_EMAIL_SENDER_ADDRESS");
  const poller = await getEmailClient().beginSend({
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

  const response = await poller.pollUntilDone();
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
