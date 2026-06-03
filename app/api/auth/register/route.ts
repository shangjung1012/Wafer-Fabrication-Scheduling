import { NextResponse } from "next/server";

export async function POST(_req: Request) {
  return NextResponse.json(
    {
      code: "SELF_REGISTRATION_DISABLED",
      message:
        "Self registration is disabled. Ask a superadmin for an invitation.",
    },
    { status: 403 },
  );
}
