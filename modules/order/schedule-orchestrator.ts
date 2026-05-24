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

import { prisma } from "@/lib/prisma";
import { runSchedule } from "@/modules/schedule/run";
import { applyScheduleTransaction } from "@/modules/schedule/core";
import { type SchedulingConfig } from "@/modules/schedule/strategy";
import { type StrategyResult } from "@/modules/schedule/strategy";
import { createIssuesForFailedOrders } from "@/modules/order/conflict-issue-service";

/**
 * Fire `createIssuesForFailedOrders` without awaiting. Identical defensive
 * `.catch` to what the route handlers used to do — unexpected top-level
 * throws are logged but never bubble up to the caller.
 */
function fireIssueCreation(input: {
  failedOrderIds: string[];
  actorId: string;
  runConfig: SchedulingConfig;
  runAt: Date;
  label: string;
}): void {
  if (input.failedOrderIds.length === 0) return;

  void createIssuesForFailedOrders({
    failedOrderIds: input.failedOrderIds,
    actorId: input.actorId,
    runConfig: input.runConfig,
    runAt: input.runAt,
    prisma,
  }).catch((err) => {
    console.error(
      `[${input.label}] createIssuesForFailedOrders unexpected error:`,
      err,
    );
  });
}

/**
 * Runs the scheduling engine (`runSchedule`) and, on completion, fires off
 * ConflictIssue creation for any newly-FAILED orders as a fire-and-forget
 * side-effect. Returns the same `{ failedIds }` shape that `runSchedule`
 * returns so callers are drop-in compatible.
 */
export async function runScheduleWithIssues(input: {
  type: string;
  config: SchedulingConfig;
  currentDate: Date;
  operatorId: string;
}): Promise<{ failedIds: string[] }> {
  const { type, config, currentDate, operatorId } = input;

  const result = await runSchedule(type, config, currentDate, operatorId);

  fireIssueCreation({
    failedOrderIds: result.failedIds,
    actorId: operatorId,
    runConfig: config,
    runAt: currentDate,
    label: "runScheduleWithIssues",
  });

  return result;
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
}): Promise<{ failedIds: string[] }> {
  const { type, config, result, operatorId, runAt } = input;

  const applyResult = await applyScheduleTransaction(
    type,
    config,
    result,
    operatorId,
  );

  fireIssueCreation({
    failedOrderIds: applyResult.failedIds,
    actorId: operatorId,
    runConfig: config,
    runAt,
    label: "applyScheduleTransactionWithIssues",
  });

  return applyResult;
}
