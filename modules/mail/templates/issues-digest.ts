import type { MailTemplate } from "@/modules/mail/mail-template";
import type { SendMailInput } from "@/modules/mail/mail-service";

export type IssuesDigestMailData = {
  recipientEmail: string;
  recipientUsername: string | null;
  issues: Array<{
    orderName: string;
    orderQuantity: number;
    dueDate: string;
    deficit: number;
    issueNumber: number;
  }>;
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

export const issuesDigestTemplate: MailTemplate<IssuesDigestMailData> = {
  id: "conflict-issues-digest",
  name: "Conflict Issues Digest Notification",
  build(data: IssuesDigestMailData): SendMailInput {
    const displayName = data.recipientUsername ?? data.recipientEmail;
    const appUrl = process.env.APP_BASE_URL ?? "";
    const count = data.issues.length;
    const subject =
      count === 1
        ? `Your order "${data.issues[0].orderName}" could not be scheduled`
        : `${count} orders could not be scheduled`;

    // Plain text
    const plainLines = [
      `Hello ${displayName},`,
      "",
      count === 1
        ? `The following order could not be accommodated in the latest scheduling run:`
        : `The following ${count} orders could not be accommodated in the latest scheduling run:`,
      "",
    ];
    for (const issue of data.issues) {
      const issueUrl = `${appUrl}/conflict-issues?issue=${issue.issueNumber}`;
      plainLines.push(
        `Order: ${issue.orderName}`,
        `  Quantity: ${issue.orderQuantity}`,
        `  Due date: ${issue.dueDate}`,
        `  Capacity shortfall: short by ${issue.deficit} units`,
        `  Issue: ${issueUrl}`,
        "",
      );
    }
    plainLines.push("Wafer Scheduling System");

    // HTML
    const safeDisplayName = escapeHtml(displayName);
    const intro = escapeHtml(
      count === 1
        ? `The following order could not be accommodated in the latest scheduling run:`
        : `The following ${count} orders could not be accommodated in the latest scheduling run:`,
    );

    const rowsHtml = data.issues
      .map((issue) => {
        const issueUrl = `${appUrl}/conflict-issues?issue=${issue.issueNumber}`;
        return [
          `<tr>`,
          `<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a">${escapeHtml(issue.orderName)}</td>`,
          `<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#334155">${escapeHtml(String(issue.orderQuantity))}</td>`,
          `<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#334155">${escapeHtml(issue.dueDate)}</td>`,
          `<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#991b1b">−${escapeHtml(String(issue.deficit))} units</td>`,
          `<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0"><a href="${escapeHtml(issueUrl)}" style="color:#2563eb">View issue #${issue.issueNumber}</a></td>`,
          `</tr>`,
        ].join("");
      })
      .join("");

    const html = [
      `<p>Hello ${safeDisplayName},</p>`,
      `<p>${intro}</p>`,
      `<table style="border-collapse:collapse;width:100%;font-size:13px;font-family:system-ui,sans-serif">`,
      `<thead>`,
      `<tr style="background:#f8fafc">`,
      `<th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0;color:#475569">Order</th>`,
      `<th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0;color:#475569">Qty</th>`,
      `<th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0;color:#475569">Due date</th>`,
      `<th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0;color:#475569">Shortfall</th>`,
      `<th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e2e8f0;color:#475569">Issue</th>`,
      `</tr>`,
      `</thead>`,
      `<tbody>${rowsHtml}</tbody>`,
      `</table>`,
      `<p style="margin-top:16px;color:#64748b;font-size:12px">Wafer Scheduling System</p>`,
    ].join("");

    return {
      to: [{ address: data.recipientEmail, displayName }],
      subject,
      plainText: plainLines.join("\n"),
      html,
    };
  },
};
