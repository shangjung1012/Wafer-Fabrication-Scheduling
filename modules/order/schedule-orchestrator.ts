/**
 * modules/order/schedule-orchestrator.ts
 *
 * Thin wrapper that combines the scheduling engine (modules/schedule/*) with
 * the order module's auto-issue creation. Lives in modules/order so that the
 * scheduling module stays free of any dependency on the order/issue domain
 * (per modules/schedule/README.md: the engine emits FAILED, issue creation
 * lives in the order module).
 *
 * Every caller of `runSchedule` / `applyScheduleTransaction` should call the
 * orchestrator wrappers here instead — that way the cron worker, the HTTP
 * routes, and any future caller all trigger ConflictIssue creation + email
 * notifications uniformly. There is exactly one place to maintain.
 *
 * Issue creation is fire-and-forget: the wrapper returns the schedule result
 * immediately and never awaits the side-effect. Defensive `.catch` mirrors
 * the original route-level code so unexpected throws are logged, not lost.
 */

import { runSchedule } from "@/modules/schedule/run";
import { applyScheduleTransaction } from "@/modules/schedule/core";
import { type SchedulingConfig } from "@/modules/schedule/strategy";
import { type StrategyResult } from "@/modules/schedule/strategy";

/**
 * Runs the scheduling engine (`runSchedule`) and dispatches deferred emails
 * fire-and-forget for any newly-FAILED orders.
 */
export async function runScheduleWithIssues(input: {
  type: string;
  config: SchedulingConfig;
  currentDate: Date;
  operatorId: string;
}): Promise<{ failedIds: string[] }> {
  const { type, config, currentDate, operatorId } = input;

  const { failedIds, emailsToDispatch } = await runSchedule(
    type,
    config,
    currentDate,
    operatorId,
  );

  if (emailsToDispatch.length > 0) {
    queueMicrotask(() => {
      Promise.allSettled(emailsToDispatch.map((fn) => fn())).catch((err) => {
        console.error("[runScheduleWithIssues] Error dispatching emails:", err);
      });
    });
  }

  return { failedIds };
}

/**
 * Runs `applyScheduleTransaction` (the second phase of preview/apply) and,
 * on completion, fires off ConflictIssue creation for any newly-FAILED
 * orders. Mirrors the call shape that the /api/schedule/apply route used
 * to invoke directly.
 */
export async function applyScheduleTransactionWithIssues(input: {
  type: string;
  config: SchedulingConfig;
  result: StrategyResult;
  operatorId: string;
  runAt: Date;
  expectedVersion?: number;
  previewId?: string;
}): Promise<{ failedIds: string[] }> {
  const { type, config, result, operatorId, expectedVersion, previewId } =
    input;

  const { failedIds, emailsToDispatch } = await applyScheduleTransaction(
    type,
    config,
    result,
    operatorId,
    expectedVersion,
    previewId,
  );

  // Dispatch emails fire-and-forget (not awaited) so the frontend isn't blocked
  if (emailsToDispatch.length > 0) {
    queueMicrotask(() => {
      Promise.allSettled(emailsToDispatch.map((fn) => fn())).catch((err) => {
        console.error(
          "[applyScheduleTransactionWithIssues] Error dispatching emails:",
          err,
        );
      });
    });
  }

  return { failedIds };
}
