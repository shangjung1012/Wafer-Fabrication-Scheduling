import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  AccountLockedError,
  AuthConflictError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  SelfRegistrationDisabledError,
} from "@/modules/auth/auth-service";
import { badRequestResponse } from "@/modules/auth/rbac";

export function parseJsonError(): Response {
  return badRequestResponse("Request body must be valid JSON.");
}

export function validationErrorResponse(error: ZodError): Response {
  return badRequestResponse(
    "Invalid request body.",
    error.flatten().fieldErrors as Record<string, unknown>,
  );
}

export function authErrorResponse(err: unknown): Response | null {
  if (
    err instanceof AuthConflictError ||
    err instanceof InvalidCredentialsError ||
    err instanceof AccountLockedError ||
    err instanceof InvalidRefreshTokenError ||
    err instanceof SelfRegistrationDisabledError
  ) {
    return NextResponse.json(
      { code: err.code, message: err.message },
      { status: err.status },
    );
  }

  return null;
}
