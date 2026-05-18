import type { PrismaClient } from "@/lib/generated/prisma";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Conflict helpers
// ---------------------------------------------------------------------------

export type ConflictOrderInfo = {
  id: string;
  name: string;
  quantity: number;
  dueDate: string; // YYYY-MM-DD
  applicantEmail: string | null;
  applicantUsername: string | null;
  adminEmail: string | null;
  adminUsername: string | null;
};

export async function fetchConflictOrders(
  db: PrismaClient,
  ids: string[],
): Promise<ConflictOrderInfo[]> {
  const rows = await db.order.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      quantity: true,
      dueDate: true,
      applicant: { select: { email: true, username: true } },
      lastModifiedBy: { select: { email: true, username: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    quantity: r.quantity,
    dueDate: format(r.dueDate, "yyyy-MM-dd"),
    applicantEmail: r.applicant?.email ?? null,
    applicantUsername: r.applicant?.username ?? null,
    adminEmail: r.lastModifiedBy?.email ?? null,
    adminUsername: r.lastModifiedBy?.username ?? null,
  }));
}
