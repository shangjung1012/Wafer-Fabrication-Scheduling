import type { MailTemplate } from "@/modules/mail/mail-template";
import type { SendMailInput } from "@/modules/mail/mail-service";

export type KickOutMailData = {
  orderName: string;
  applicantEmail: string;
  applicantUsername: string | null;
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

export const kickOutTemplate: MailTemplate<KickOutMailData> = {
  id: "kick-out-notification",
  name: "Order Kicked Out Notification",
  build(data: KickOutMailData): SendMailInput {
    const displayName = data.applicantUsername ?? data.applicantEmail;
    const appUrl = process.env.APP_BASE_URL ?? "";
    const safeDisplayName = escapeHtml(displayName);
    const safeOrderName = escapeHtml(data.orderName);
    const safeAppUrl = escapeHtml(appUrl);
    return {
      to: [{ address: data.applicantEmail, displayName }],
      subject: `Your order "${data.orderName}" could not be scheduled`,
      plainText: [
        `Hello ${displayName},`,
        "",
        `Your order "${data.orderName}" could not be accommodated in the latest scheduling run and has been moved back to APPROVED status.`,
        "",
        "Please log in to review the status or submit a change request.",
        appUrl,
        "",
        "Wafer Scheduling System",
      ].join("\n"),
      html: [
        `<p>Hello ${safeDisplayName},</p>`,
        `<p>Your order <strong>"${safeOrderName}"</strong> could not be accommodated in the latest scheduling run and has been moved back to <strong>APPROVED</strong> status.</p>`,
        `<p>Please <a href="${safeAppUrl}">log in</a> to review the status or submit a change request.</p>`,
        `<p>Wafer Scheduling System</p>`,
      ].join(""),
    };
  },
};
