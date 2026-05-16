import { NextResponse } from "next/server";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import { z } from "zod";
import { renderAndSend } from "@/modules/mail/mail-template";
import { kickOutTemplate } from "@/modules/mail/templates/kick-out";

const KickedOutOrderSchema = z.object({
  id: z.string(),
  name: z.string(),
  applicantEmail: z.string().email(),
  applicantUsername: z.string().nullable(),
});

const NotifySchema = z.object({
  orders: z
    .array(KickedOutOrderSchema)
    .min(1, "At least one order is required"),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request);

    if (ctx.user.role !== "SUPERADMIN" && ctx.user.role !== "ADMIN") {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = NotifySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          code: "BAD_REQUEST",
          message: "Invalid input",
          details: parsed.error.format(),
        },
        { status: 400 },
      );
    }

    const { orders } = parsed.data;
    const sent: string[] = [];
    const failed: string[] = [];

    const results = await Promise.allSettled(
      orders.map((o) =>
        renderAndSend(kickOutTemplate, {
          orderName: o.name,
          applicantEmail: o.applicantEmail,
          applicantUsername: o.applicantUsername,
        }),
      ),
    );

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        sent.push(orders[i].id);
      } else {
        console.error(
          `Kick-out email failed for order ${orders[i].id}:`,
          result.reason,
        );
        failed.push(orders[i].id);
      }
    });

    return NextResponse.json({ sent, failed });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: error.message },
        { status: 401 },
      );
    }
    if (error instanceof CsrfError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status },
      );
    }

    console.error("Error sending kick-out notifications:", error);
    return NextResponse.json(
      {
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to send notifications",
      },
      { status: 500 },
    );
  }
}
