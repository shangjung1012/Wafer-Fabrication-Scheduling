import type { MailTemplate } from "@/modules/mail/mail-template";
import type { SendMailInput } from "@/modules/mail/mail-service";

export type IssueCreatedMailData = {
  orderName: string;
  orderQuantity: number;
  dueDate: string;
  deficit: number;
  issueNumber: number;
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

export const issueCreatedTemplate: MailTemplate<IssueCreatedMailData> = {
  id: "conflict-issue-created",
  name: "Conflict Issue Created Notification",
  build(data: IssueCreatedMailData): SendMailInput {
    const displayName = data.recipientUsername ?? data.recipientEmail;
    const appUrl = process.env.APP_BASE_URL ?? "";
    const issueUrl = `${appUrl}/conflict-issues?issue=${data.issueNumber}`;

    const safeDisplayName = escapeHtml(displayName);
    const safeOrderName = escapeHtml(data.orderName);
    const safeDueDate = escapeHtml(data.dueDate);
    const safeIssueUrl = escapeHtml(issueUrl);
    const safeQuantity = escapeHtml(String(data.orderQuantity));
    const safeDeficit = escapeHtml(String(data.deficit));

    return {
      to: [{ address: data.recipientEmail, displayName }],
      subject: `Conflict issue opened for order "${data.orderName}"`,
      plainText: [
        `Hello ${displayName},`,
        "",
        `A scheduling conflict has been recorded for your order "${data.orderName}".`,
        "",
        `Order: ${data.orderName}`,
        `Quantity: ${data.orderQuantity}`,
        `Due date: ${data.dueDate}`,
        `Capacity shortfall: short by ${data.deficit} units`,
        "",
        "Open issue and join the discussion:",
        issueUrl,
        "",
        "Wafer Scheduling System",
      ].join("\n"),
      html: [
        `<p>Hello ${safeDisplayName},</p>`,
        `<p>A scheduling conflict has been recorded for your order <strong>"${safeOrderName}"</strong>.</p>`,
        `<ul>`,
        `<li><strong>Order:</strong> ${safeOrderName}</li>`,
        `<li><strong>Quantity:</strong> ${safeQuantity}</li>`,
        `<li><strong>Due date:</strong> ${safeDueDate}</li>`,
        `<li><strong>Capacity shortfall:</strong> short by ${safeDeficit} units</li>`,
        `</ul>`,
        `<p><a href="${safeIssueUrl}">Open issue and join the discussion</a></p>`,
        `<p>Wafer Scheduling System</p>`,
      ].join(""),
    };
  },
};
