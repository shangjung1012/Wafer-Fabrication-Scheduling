import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelRequestTemplate } from "@/modules/mail/templates/cancel-request";
import { emailChangeNotifyTemplate } from "@/modules/mail/templates/email-change-notify";
import { emailChangeVerifyTemplate } from "@/modules/mail/templates/email-change-verify";
import { issueCreatedTemplate } from "@/modules/mail/templates/issue-created";
import { issuesDigestTemplate } from "@/modules/mail/templates/issues-digest";

describe("mail templates", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds conflict issue notifications with escaped HTML and issue links", () => {
    vi.stubEnv("APP_BASE_URL", "https://woms.example");

    const mail = issueCreatedTemplate.build({
      orderName: `A&B <Lot "7">`,
      orderQuantity: 2500,
      dueDate: "2026-06-15",
      deficit: 125,
      issueNumber: 42,
      recipientEmail: "planner@example.com",
      recipientUsername: `Seraphine <Admin>`,
    });

    expect(mail.to).toEqual([
      {
        address: "planner@example.com",
        displayName: "Seraphine <Admin>",
      },
    ]);
    expect(mail.subject).toBe(
      `Conflict issue opened for order "A&B <Lot "7">"`,
    );
    expect(mail.plainText).toContain(
      `A scheduling conflict has been recorded for your order "A&B <Lot "7">".`,
    );
    expect(mail.plainText).toContain(
      "https://woms.example/conflict-issues?issue=42",
    );
    expect(mail.html).toContain("Seraphine &lt;Admin&gt;");
    expect(mail.html).toContain("A&amp;B &lt;Lot &quot;7&quot;&gt;");
    expect(mail.html).toContain(
      `href="https://woms.example/conflict-issues?issue=42"`,
    );
  });

  it("builds cancellation request notifications with default names", () => {
    vi.stubEnv("APP_BASE_URL", "https://woms.example");

    const mail = cancelRequestTemplate.build({
      orderName: `Order & <"X"> 'Y'`,
      issueNumber: 9,
      requesterUsername: null,
      recipientEmail: "admin@example.com",
      recipientUsername: null,
    });

    expect(mail.to).toEqual([
      {
        address: "admin@example.com",
        displayName: "admin@example.com",
      },
    ]);
    expect(mail.subject).toBe(
      `Cancellation Request – "Order & <"X"> 'Y'" (Issue #9)`,
    );
    expect(mail.plainText).toContain(
      `A sales user has flagged order "Order & <"X"> 'Y'" for cancellation.`,
    );
    expect(mail.html).toContain("<strong>A sales user</strong>");
    expect(mail.html).toContain(
      "Order &amp; &lt;&quot;X&quot;&gt; &#39;Y&#39;",
    );
    expect(mail.html).toContain(
      `href="https://woms.example/conflict-issues?issue=9"`,
    );
  });

  it("builds email change notifications for the old address", () => {
    const mail = emailChangeNotifyTemplate.build({
      oldEmail: "old@example.com",
      newEmail: `new&<"next">'@example.com`,
      username: `Old & <"User"> 'Name'`,
    });

    expect(mail.to).toEqual([
      {
        address: "old@example.com",
        displayName: `Old & <"User"> 'Name'`,
      },
    ]);
    expect(mail.subject).toBe("Your email change was requested");
    expect(mail.plainText).toContain(
      `A request was made to change your account email to: new&<"next">'@example.com`,
    );
    expect(mail.html).toContain(
      "Old &amp; &lt;&quot;User&quot;&gt; &#39;Name&#39;",
    );
    expect(mail.html).toContain(
      "<strong>new&amp;&lt;&quot;next&quot;&gt;&#39;@example.com</strong>",
    );
  });

  it("builds email verification messages with escaped verification links", () => {
    const mail = emailChangeVerifyTemplate.build({
      newEmail: "new@example.com",
      username: `User & <"New"> 'Name'`,
      verifyUrl: `https://woms.example/verify?token=a&next=<home>&label="go"'`,
    });

    expect(mail.to).toEqual([
      {
        address: "new@example.com",
        displayName: `User & <"New"> 'Name'`,
      },
    ]);
    expect(mail.subject).toBe("Verify your new email address");
    expect(mail.plainText).toContain(
      `https://woms.example/verify?token=a&next=<home>&label="go"'`,
    );
    expect(mail.html).toContain(
      "User &amp; &lt;&quot;New&quot;&gt; &#39;Name&#39;",
    );
    expect(mail.html).toContain(
      "https://woms.example/verify?token=a&amp;next=&lt;home&gt;&amp;label=&quot;go&quot;&#39;",
    );
  });

  it("builds a single conflict issue digest with the order name in the subject", () => {
    vi.stubEnv("APP_BASE_URL", "https://woms.example");

    const mail = issuesDigestTemplate.build({
      recipientEmail: "sales@example.com",
      recipientUsername: null,
      issues: [
        {
          orderName: `A&B <Lot "7"> 'Y'`,
          orderQuantity: 1200,
          dueDate: "2026-06-15",
          deficit: 75,
          issueNumber: 42,
        },
      ],
    });

    expect(mail.to).toEqual([
      { address: "sales@example.com", displayName: "sales@example.com" },
    ]);
    expect(mail.subject).toBe(
      `Your order "A&B <Lot "7"> 'Y'" could not be scheduled`,
    );
    expect(mail.plainText).toContain("Order: A&B <Lot \"7\"> 'Y'");
    expect(mail.plainText).toContain(
      "https://woms.example/conflict-issues?issue=42",
    );
    expect(mail.html).toContain(
      "A&amp;B &lt;Lot &quot;7&quot;&gt; &#39;Y&#39;",
    );
    expect(mail.html).toContain("−75 units");
    expect(mail.html).toContain(
      `href="https://woms.example/conflict-issues?issue=42"`,
    );
  });

  it("builds a multi-issue conflict digest with escaped recipient names", () => {
    const mail = issuesDigestTemplate.build({
      recipientEmail: "planner@example.com",
      recipientUsername: `Planner & <"Lead">`,
      issues: [
        {
          orderName: "Order A",
          orderQuantity: 100,
          dueDate: "2026-06-10",
          deficit: 10,
          issueNumber: 1,
        },
        {
          orderName: "Order B",
          orderQuantity: 200,
          dueDate: "2026-06-11",
          deficit: 20,
          issueNumber: 2,
        },
      ],
    });

    expect(mail.to).toEqual([
      {
        address: "planner@example.com",
        displayName: `Planner & <"Lead">`,
      },
    ]);
    expect(mail.subject).toBe("2 orders could not be scheduled");
    expect(mail.plainText).toContain("The following 2 orders");
    expect(mail.plainText).toContain("/conflict-issues?issue=1");
    expect(mail.plainText).toContain("/conflict-issues?issue=2");
    expect(mail.html).toContain("Planner &amp; &lt;&quot;Lead&quot;&gt;");
    expect(mail.html).toContain("Order A");
    expect(mail.html).toContain("Order B");
  });
});
