export type AssignmentStatus =
  | "SCHEDULED"
  | "IN_PRODUCTION"
  | "COMPLETED"
  | "CANCELLED";
export type ConflictType = "CAPACITY" | "DUE_DATE" | "ASSIGNMENT";
export type ConflictSeverity = "ERROR" | "WARNING";

export type FactoryInfo = {
  id: string;
  label: string;
  productionType: string;
  maxCapacity: number;
};

export type TimelineItem = {
  assignmentId: string;
  orderId: string;
  orderName: string;
  factoryId: string;
  productionDate: string; // YYYY-MM-DD
  assignedQuantity: number;
  status: AssignmentStatus;
  dueDate: string; // YYYY-MM-DD
  applicantId: string;
  lastModifiedById: string | null;
};

export type ConflictInfo = {
  conflictType: ConflictType;
  severity: ConflictSeverity;
  factoryId: string;
  date: string; // YYYY-MM-DD
  orderIds: string[];
  message: string;
};

export type DailyCapacityInfo = {
  factoryId: string;
  date: string; // YYYY-MM-DD
  maxCapacity: number;
  usedCapacity: number;
};

export type DiffEntry = {
  orderId: string;
  orderName: string;
  field: "productionDate";
  before: string; // YYYY-MM-DD
  after: string; // YYYY-MM-DD
  reason: string;
};

export type OrderRisk = "ON_TRACK" | "AT_RISK" | "OVERDUE";

export type PendingOrderInfo = {
  id: string;
  name: string;
  status: "PENDING";
  quantity: number;
  dueDate: string; // YYYY-MM-DD
  createdAt: string; // YYYY-MM-DD
  risk: OrderRisk;
};

export type SalesContext = {
  myOrderIds: string[];
  pendingOrders: PendingOrderInfo[];
};

export type AdminContext = {
  pendingOrders: PendingOrderInfo[];
};

export type TimelineResponse = {
  factories: FactoryInfo[];
  timeline: TimelineItem[];
  conflicts: ConflictInfo[];
  dailyCapacities: DailyCapacityInfo[];
  diffs: DiffEntry[];
  salesContext?: SalesContext;
  adminContext?: AdminContext;
  today: string; // YYYY-MM-DD, reflects simulation date if active
};

export type SchedulePreviewResponse = {
  algorithm: string;
  factories: FactoryInfo[];
  timeline: TimelineItem[];
  dailyCapacities: DailyCapacityInfo[];
  conflicts: ConflictInfo[];
  diffs: DiffEntry[];
  unscheduledOrders: {
    id: string;
    name: string;
    quantity: number;
    dueDate: string;
  }[];
};

export type AlgorithmInfo = {
  id: string;
  label: string;
  description: string;
};
