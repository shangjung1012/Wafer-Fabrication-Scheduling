export type UserRole = "SUPERADMIN" | "ADMIN" | "SALES";

export type AuthUser = {
  id: string;
  role: UserRole;
  accountId?: string;
};

export type RequestContext = {
  user: AuthUser;
  requestId: string;
};
