export type UserRole = "SUPERADMIN" | "ADMIN" | "SALES" | "SYSTEM";

export type AuthUser = {
  id: string;
  role: UserRole;
  username?: string;
};

export type RequestContext = {
  user: AuthUser;
  requestId: string;
};
