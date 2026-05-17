import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderAndSend, type MailTemplate } from "@/modules/mail/mail-template";
import * as mailService from "@/modules/mail/mail-service";

vi.mock("@/modules/mail/mail-service", () => ({
  sendMail: vi.fn(),
}));

describe("renderAndSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls sendMail with the input produced by template.build()", async () => {
    const template: MailTemplate<{ name: string }> = {
      id: "test",
      name: "Test Template",
      build: ({ name }) => ({
        to: [{ address: "a@b.com" }],
        subject: `Hello ${name}`,
        plainText: `Hi ${name}`,
      }),
    };

    vi.mocked(mailService.sendMail).mockResolvedValue({
      id: "msg-1",
      status: "Succeeded",
    });

    await renderAndSend(template, { name: "World" });

    expect(mailService.sendMail).toHaveBeenCalledOnce();
    expect(mailService.sendMail).toHaveBeenCalledWith({
      to: [{ address: "a@b.com" }],
      subject: "Hello World",
      plainText: "Hi World",
    });
  });

  it("propagates errors thrown by sendMail", async () => {
    const template: MailTemplate<object> = {
      id: "err-template",
      name: "Error Template",
      build: () => ({
        to: [{ address: "x@y.com" }],
        subject: "s",
        plainText: "p",
      }),
    };

    vi.mocked(mailService.sendMail).mockRejectedValue(
      new Error("network error"),
    );

    await expect(renderAndSend(template, {})).rejects.toThrow("network error");
  });
});
