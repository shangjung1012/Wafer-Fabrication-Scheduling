export type AssignmentStatus = "SCHEDULED" | "IN_PRODUCTION" | "COMPLETED" | "CANCELLED";
export type ConflictType = "CAPACITY" | "DUE_DATE" | "ASSIGNMENT";
export type ConflictSeverity = "ERROR" | "WARNING";

export type FactoryInfo = {
  id: string;
  label: string;
  productionType: string;
  maxCapacity: number;
};

export type TimelineItem = {
  orderId: string;
  orderName: string;
  factoryId: string;
  productionDate: string; // YYYY-MM-DD
  assignedQuantity: number;
  status: AssignmentStatus;
  dueDate: string;        // YYYY-MM-DD
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
  after: string;  // YYYY-MM-DD
  reason: string;
};

export type TimelineResponse = {
  factories: FactoryInfo[];
  timeline: TimelineItem[];
  conflicts: ConflictInfo[];
  dailyCapacities: DailyCapacityInfo[];
  diffs: DiffEntry[];
};
