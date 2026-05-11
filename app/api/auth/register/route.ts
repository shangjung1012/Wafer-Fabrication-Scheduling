import { NextResponse } from "next/server";

export async function POST(req: Request) {
  void req;
  return NextResponse.json(
    {
      code: "SELF_REGISTRATION_DISABLED",
      message:
        "Self registration is disabled. Ask a superadmin for an invitation.",
    },
    { status: 403 },
  );
}
