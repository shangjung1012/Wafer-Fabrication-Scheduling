import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const appUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";

  if (!token) {
    return NextResponse.redirect(`${appUrl}/profile?emailError=missing_token`);
  }

  const record = await prisma.emailChangeToken.findUnique({
    where: { token },
    select: {
      id: true,
      userId: true,
      newEmail: true,
      expiresAt: true,
      usedAt: true,
    },
  });

  if (!record) {
    return NextResponse.redirect(`${appUrl}/profile?emailError=invalid_token`);
  }

  if (record.usedAt) {
    return NextResponse.redirect(`${appUrl}/profile?emailError=already_used`);
  }

  if (record.expiresAt < new Date()) {
    return NextResponse.redirect(`${appUrl}/profile?emailError=expired`);
  }

  // Check new email is still available (someone else might have taken it in the meantime)
  const conflict = await prisma.user.findUnique({
    where: { email: record.newEmail },
    select: { id: true },
  });
  if (conflict && conflict.id !== record.userId) {
    await prisma.emailChangeToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return NextResponse.redirect(`${appUrl}/profile?emailError=email_taken`);
  }

  // Update email and mark token used atomically
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { email: record.newEmail },
    }),
    prisma.emailChangeToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);

  // Redirect to profile — the page will fetch fresh user data and update the session
  return NextResponse.redirect(`${appUrl}/profile?emailUpdated=true`);
}
