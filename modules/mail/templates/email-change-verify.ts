import type { MailTemplate } from "@/modules/mail/mail-template";
import type { SendMailInput } from "@/modules/mail/mail-service";

export type EmailChangeVerifyData = {
  newEmail: string;
  username: string | null;
  verifyUrl: string;
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

export const emailChangeVerifyTemplate: MailTemplate<EmailChangeVerifyData> = {
  id: "email-change-verify",
  name: "Email Change Verification",
  build(data: EmailChangeVerifyData): SendMailInput {
    const displayName = data.username ?? data.newEmail;
    const safeDisplayName = escapeHtml(displayName);
    const safeVerifyUrl = escapeHtml(data.verifyUrl);

    return {
      to: [{ address: data.newEmail, displayName }],
      subject: "Verify your new email address",
      plainText: [
        `Hello ${displayName},`,
        "",
        "You requested to change your email address on the Wafer Scheduling System.",
        "",
        "Click the link below to confirm your new email. The link expires in 3 minutes.",
        "",
        data.verifyUrl,
        "",
        "If you did not request this change, you can ignore this email.",
        "",
        "Wafer Scheduling System",
      ].join("\n"),
      html: [
        `<p>Hello ${safeDisplayName},</p>`,
        `<p>You requested to change your email address on the Wafer Scheduling System.</p>`,
        `<p>Click the button below to confirm your new email. <strong>The link expires in 3 minutes.</strong></p>`,
        `<p><a href="${safeVerifyUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Verify Email</a></p>`,
        `<p>Or copy this link: <a href="${safeVerifyUrl}">${safeVerifyUrl}</a></p>`,
        `<p style="color:#64748b;font-size:13px;">If you did not request this change, you can ignore this email.</p>`,
        `<p>Wafer Scheduling System</p>`,
      ].join(""),
    };
  },
};
