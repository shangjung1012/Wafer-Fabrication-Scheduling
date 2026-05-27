import type { MailTemplate } from "@/modules/mail/mail-template";
import type { SendMailInput } from "@/modules/mail/mail-service";

export type CancelRequestMailData = {
  orderName: string;
  issueNumber: number;
  requesterUsername: string | null;
  recipientEmail: string;
  recipientUsername: string | null;
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

export const cancelRequestTemplate: MailTemplate<CancelRequestMailData> = {
  id: "order-cancel-request",
  name: "Order Cancellation Request Notification",
  build(data: CancelRequestMailData): SendMailInput {
    const displayName = data.recipientUsername ?? data.recipientEmail;
    const requester = data.requesterUsername ?? "A sales user";
    const appUrl = process.env.APP_BASE_URL ?? "";
    const issueUrl = `${appUrl}/conflict-issues/${data.issueNumber}`;

    const safeDisplayName = escapeHtml(displayName);
    const safeRequester = escapeHtml(requester);
    const safeOrderName = escapeHtml(data.orderName);
    const safeIssueUrl = escapeHtml(issueUrl);

    return {
      to: [{ address: data.recipientEmail, displayName }],
      subject: `Cancellation Request – "${data.orderName}" (Issue #${data.issueNumber})`,
      plainText: [
        `Hello ${displayName},`,
        "",
        `${requester} has flagged order "${data.orderName}" for cancellation.`,
        "",
        `Review Issue #${data.issueNumber} and cancel or dismiss the request:`,
        issueUrl,
        "",
        "Wafer Scheduling System",
      ].join("\n"),
      html: [
        `<p>Hello ${safeDisplayName},</p>`,
        `<p><strong>${safeRequester}</strong> has flagged order <strong>"${safeOrderName}"</strong> for cancellation.</p>`,
        `<p><a href="${safeIssueUrl}">Review Issue #${data.issueNumber} and cancel or dismiss the request</a></p>`,
        `<p>Wafer Scheduling System</p>`,
      ].join(""),
    };
  },
};
