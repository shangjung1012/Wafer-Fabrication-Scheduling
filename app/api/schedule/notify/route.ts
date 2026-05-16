import { NextResponse } from "next/server";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import { z } from "zod";
import { renderAndSend } from "@/modules/mail/mail-template";
import { kickOutTemplate } from "@/modules/mail/templates/kick-out";

const ConflictOrderSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.number().optional(),
  dueDate: z.string().optional(),
  applicantEmail: z.string().email().nullable(),
  applicantUsername: z.string().nullable(),
  adminEmail: z.string().email().nullable().optional(),
  adminUsername: z.string().nullable().optional(),
});

const NotifySchema = z.object({
  orders: z.array(ConflictOrderSchema).min(1, "At least one order is required"),
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

    // Build one email job per recipient (applicant + admin) per order
    type EmailJob = {
      orderId: string;
      email: string;
      username: string | null;
      orderName: string;
    };
    const emailJobs: EmailJob[] = orders.flatMap((o) => {
      const jobs: EmailJob[] = [];
      if (o.applicantEmail) {
        jobs.push({
          orderId: o.id,
          email: o.applicantEmail,
          username: o.applicantUsername,
          orderName: o.name,
        });
      }
      if (o.adminEmail) {
        jobs.push({
          orderId: o.id,
          email: o.adminEmail,
          username: o.adminUsername ?? null,
          orderName: o.name,
        });
      }
      return jobs;
    });

    const results = await Promise.allSettled(
      emailJobs.map((j) =>
        renderAndSend(kickOutTemplate, {
          orderName: j.orderName,
          applicantEmail: j.email,
          applicantUsername: j.username,
        }),
      ),
    );

    const orderFailedSet = new Set<string>();
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        console.error(
          `Conflict email failed for order ${emailJobs[i].orderId} → ${emailJobs[i].email}:`,
          result.reason,
        );
        orderFailedSet.add(emailJobs[i].orderId);
      }
    });

    orders.forEach((o) => {
      if (orderFailedSet.has(o.id)) {
        failed.push(o.id);
      } else if (emailJobs.some((j) => j.orderId === o.id)) {
        sent.push(o.id);
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

    console.error("Error sending conflict notifications:", error);
    return NextResponse.json(
      {
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to send notifications",
      },
      { status: 500 },
    );
  }
}
