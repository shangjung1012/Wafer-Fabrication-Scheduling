import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runSchedule } from "@/modules/schedule/run";
import { type SchedulingConfig } from "@/modules/schedule/strategy";
import { createIssuesForFailedOrders } from "@/modules/order/conflict-issue-service";
import {
  OrderStatus,
  UserRole,
  ConflictIssueStatus,
  ConflictIssueEventType,
} from "@/lib/generated/prisma/client";

vi.mock("@/modules/mail/mail-template", () => ({
  renderAndSend: vi.fn().mockResolvedValue(undefined),
}));

// This file contains database integration tests for the auto-issue creation
// flow added in Phase 3. A real PostgreSQL database must be running and
// accessible via process.env.DATABASE_URL — when it is not, the suite logs a
// warning and exits cleanly (mirrors __tests__/integration/schedule-engine.test.ts).

function isDatabaseUnreachable(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("Can't reach database server") ||
      error.message.includes("ECONNREFUSED"))
  );
}

const AUTO_ISSUE_TYPE = "AutoIssueIntegrationType";
const AUTO_ISSUE_USERNAMES = [
  "test-auto-issue-applicant",
  "test-auto-issue-admin",
];

describe("Auto ConflictIssue creation — Database Integration", () => {
  const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  async function cleanup() {
    // Order matters — children before parents to satisfy FK constraints.
    await prisma.conflictIssueEvent.deleteMany({
      where: { issue: { order: { type: AUTO_ISSUE_TYPE } } },
    });
    await prisma.conflictIssueComment.deleteMany({
      where: { issue: { order: { type: AUTO_ISSUE_TYPE } } },
    });
    await prisma.conflictIssue.deleteMany({
      where: { order: { type: AUTO_ISSUE_TYPE } },
    });
    await prisma.orderAssignment.deleteMany({
      where: { factory: { productionType: AUTO_ISSUE_TYPE } },
    });
    await prisma.dailyCapacity.deleteMany({
      where: { factory: { productionType: AUTO_ISSUE_TYPE } },
    });
    await prisma.order.deleteMany({ where: { type: AUTO_ISSUE_TYPE } });
    await prisma.factory.deleteMany({
      where: { productionType: AUTO_ISSUE_TYPE },
    });
    await prisma.user.deleteMany({
      where: { username: { in: AUTO_ISSUE_USERNAMES } },
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    try {
      await cleanup();
    } catch {
      // Swallow — DB likely unreachable; tests will report below.
    }
  });

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      // ignore
    }
    await prisma.$disconnect();
  });

  it(
    "auto-creates a ConflictIssue (with OPENED event + snapshot) for a newly-FAILED order, and is idempotent for repeated failures",
    { timeout: 60_000 },
    async () => {
      try {
        // ---------------------------------------------------------------------
        // 1. Seed users, factory (insufficient capacity), and a PENDING order
        // ---------------------------------------------------------------------
        const applicant = await prisma.user.create({
          data: {
            username: AUTO_ISSUE_USERNAMES[0],
            email: "test-auto-issue-applicant@mail.shangjung.com",
            role: UserRole.SALES,
          },
        });

        const admin = await prisma.user.create({
          data: {
            username: AUTO_ISSUE_USERNAMES[1],
            email: "test-auto-issue-admin@mail.shangjung.com",
            role: UserRole.ADMIN,
          },
        });

        // Factory's maxCapacity is small so dynamic-capacity days remain tiny too.
        const factory = await prisma.factory.create({
          data: {
            productionType: AUTO_ISSUE_TYPE,
            maxCapacity: 10,
            status: "ACTIVE",
            admins: { connect: [{ id: admin.id }] },
          },
        });

        // Provide explicit capacity rows that are deliberately insufficient.
        await prisma.dailyCapacity.createMany({
          data: [
            {
              factoryId: factory.id,
              date: today,
              maxCapacity: 10,
              curCapacity: 5,
            },
            {
              factoryId: factory.id,
              date: addDays(today, 1),
              maxCapacity: 10,
              curCapacity: 5,
            },
            {
              factoryId: factory.id,
              date: addDays(today, 2),
              maxCapacity: 10,
              curCapacity: 5,
            },
          ],
        });

        const order = await prisma.order.create({
          data: {
            name: "Auto Issue Test Order",
            type: AUTO_ISSUE_TYPE,
            applicantId: applicant.id,
            status: OrderStatus.PENDING,
            dueDate: addDays(today, 2),
            // Order requires 1000 units. Even using factory default (10) for any
            // day with no row, the window has at most a handful of days × 10 ≪
            // 1000, so the order must fail.
            quantity: 1000,
          },
        });

        // ---------------------------------------------------------------------
        // 2. Run the real scheduler — order should end up FAILED in DB.
        // ---------------------------------------------------------------------
        const runAt = today;
        const config: SchedulingConfig = {
          startDate: today,
          frozenDays: 0,
          productionDays: 1,
          bufferDays: 0,
          reschedulePolicy: "GAP_FILLING",
          algorithm: "GREEDY_BEST_FIT",
          splittable: true,
        };

        const { failedIds } = await runSchedule(
          AUTO_ISSUE_TYPE,
          config,
          runAt,
          admin.id,
        );

        expect(failedIds).toContain(order.id);

        const failedOrder = await prisma.order.findUnique({
          where: { id: order.id },
        });
        expect(failedOrder?.status).toBe(OrderStatus.FAILED);

        // ---------------------------------------------------------------------
        // 3. Invoke the fire-and-forget service directly (the routes do this in
        //    production after the schedule transaction commits). Option A from
        //    the proposal — deterministic and tests the real DB integration.
        // ---------------------------------------------------------------------
        const firstResult = await createIssuesForFailedOrders({
          failedOrderIds: failedIds,
          actorId: admin.id,
          runConfig: config,
          runAt,
          prisma,
        });

        expect(firstResult.created).toBe(1);
        expect(firstResult.skippedAsDuplicate).toBe(0);

        // -------- Assertions on ConflictIssue row --------
        const issues = await prisma.conflictIssue.findMany({
          where: { orderId: order.id },
          include: { events: true },
        });
        expect(issues).toHaveLength(1);
        const issue = issues[0];

        expect(issue.status).toBe(ConflictIssueStatus.OPEN);
        expect(issue.resolution).toBeNull();
        expect(issue.createdById).toBe(admin.id);
        expect(issue.assigneeId).toBe(applicant.id);

        expect(issue.title).toContain("Auto Issue Test Order");
        expect(issue.title.toLowerCase()).toContain("short by");

        // -------- contextSnapshot shape --------
        const snapshot = issue.contextSnapshot as Record<string, unknown>;
        expect(snapshot).toBeTruthy();
        expect(typeof snapshot.previewRunAt).toBe("string");
        expect(snapshot.reschedulePolicy).toBe("GAP_FILLING");
        expect(typeof snapshot.deficit).toBe("number");
        expect((snapshot.deficit as number) > 0).toBe(true);
        expect(Array.isArray(snapshot.competingOrders)).toBe(true);
        expect(Array.isArray(snapshot.factoriesConsidered)).toBe(true);
        expect(
          (snapshot.factoriesConsidered as unknown[]).length,
        ).toBeGreaterThan(0);

        // -------- OPENED event exists --------
        const openedEvents = issue.events.filter(
          (e) => e.type === ConflictIssueEventType.OPENED,
        );
        expect(openedEvents.length).toBe(1);
        expect(openedEvents[0].actorId).toBe(admin.id);

        // ---------------------------------------------------------------------
        // 4. Second-run idempotency — calling with the same failed id MUST NOT
        //    create a duplicate ConflictIssue. Instead a CAPACITY_CHANGED-style
        //    event (currently REPREVIEW_RAN with payload.reason="CAPACITY_CHANGED")
        //    is appended to the existing issue.
        // ---------------------------------------------------------------------
        const secondResult = await createIssuesForFailedOrders({
          failedOrderIds: [order.id],
          actorId: admin.id,
          runConfig: config,
          runAt,
          prisma,
        });

        expect(secondResult.created).toBe(0);
        expect(secondResult.skippedAsDuplicate).toBe(1);

        const issuesAfterSecondRun = await prisma.conflictIssue.findMany({
          where: { orderId: order.id },
        });
        expect(issuesAfterSecondRun).toHaveLength(1); // unchanged

        const allEvents = await prisma.conflictIssueEvent.findMany({
          where: { issueId: issue.id },
        });

        // The REPREVIEW_RAN event carries the CAPACITY_CHANGED reason — this is
        // the proposal's "CAPACITY_CHANGED" semantic without a dedicated enum.
        const recurrenceEvents = allEvents.filter((e) => {
          if (e.type !== ConflictIssueEventType.REPREVIEW_RAN) return false;
          const payload = (e.payload ?? {}) as { reason?: string };
          return payload.reason === "CAPACITY_CHANGED";
        });
        expect(recurrenceEvents.length).toBe(1);
      } catch (e: unknown) {
        if (isDatabaseUnreachable(e)) {
          console.warn(
            "Skipping auto-issue-creation integration test because database is not reachable.",
          );
          return;
        }
        throw e;
      }
    },
  );
});
