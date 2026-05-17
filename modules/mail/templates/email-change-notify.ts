import type { MailTemplate } from "@/modules/mail/mail-template";
import type { SendMailInput } from "@/modules/mail/mail-service";

export type EmailChangeNotifyData = {
  oldEmail: string;
  newEmail: string;
  username: string | null;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

export const emailChangeNotifyTemplate: MailTemplate<EmailChangeNotifyData> = {
  id: "email-change-notify",
  name: "Email Change Notification",
  build(data: EmailChangeNotifyData): SendMailInput {
    const displayName = data.username ?? data.oldEmail;
    const safeDisplayName = escapeHtml(displayName);
    const safeNewEmail = escapeHtml(data.newEmail);

    return {
      to: [{ address: data.oldEmail, displayName }],
      subject: "Your email change was requested",
      plainText: [
        `Hello ${displayName},`,
        "",
        `A request was made to change your account email to: ${data.newEmail}`,
        "",
        "A verification link has been sent to the new address. Your current email will remain active until the change is confirmed.",
        "",
        "If you did not request this change, please contact support immediately.",
        "",
        "Wafer Scheduling System",
      ].join("\n"),
      html: [
        `<p>Hello ${safeDisplayName},</p>`,
        `<p>A request was made to change your account email to: <strong>${safeNewEmail}</strong></p>`,
        `<p>A verification link has been sent to the new address. Your current email will remain active until the change is confirmed.</p>`,
        `<p style="color:#991b1b;background:#fee2e2;padding:10px;border-radius:6px;">If you did not request this change, please contact support immediately.</p>`,
        `<p>Wafer Scheduling System</p>`,
      ].join(""),
    };
  },
};
