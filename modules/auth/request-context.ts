export type UserRole = "SUPERADMIN" | "ADMIN" | "SALES";

export type AuthUser = {
  id: string;
  role: UserRole;
};

export type RequestContext = {
  user: AuthUser;
  requestId: string;
};

