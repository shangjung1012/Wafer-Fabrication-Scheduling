import { sendMail, type SendMailInput } from "@/modules/mail/mail-service";

export interface MailTemplate<T> {
  id: string;
  name: string;
  build(data: T): SendMailInput;
}

export async function renderAndSend<T>(
  template: MailTemplate<T>,
  data: T,
): Promise<void> {
  const input = template.build(data);
  await sendMail(input);
}
