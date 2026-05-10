import type { RequestContext } from "@/modules/auth/request-context";
import { requireAuth, UnauthorizedError } from "@/modules/auth/require-auth";
import { ForbiddenError, forbiddenResponse, unauthorizedResponse } from "@/modules/auth/rbac";

type MaybePromise<T> = T | Promise<T>;

export type AuthenticatedRouteHandler<
  TRequest extends Request = Request,
  TArgs extends unknown[] = [],
> = (request: TRequest, ctx: RequestContext, ...args: TArgs) => MaybePromise<Response>;

export function withAuth<
  TRequest extends Request = Request,
  TArgs extends unknown[] = [],
>(
  handler: AuthenticatedRouteHandler<TRequest, TArgs>
): (request: TRequest, ...args: TArgs) => Promise<Response> {
  return async (request, ...args) => {
    try {
      const ctx = await requireAuth(request);
      return await handler(request, ctx, ...args);
    } catch (err) {
      if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
      if (err instanceof ForbiddenError) return forbiddenResponse(err);
      throw err;
    }
  };
}
