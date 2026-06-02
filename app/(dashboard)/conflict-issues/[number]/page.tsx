import { redirect } from "next/navigation";

export default async function ConflictIssueNumberRedirectPage({
  params,
}: Readonly<{
  params: Promise<{ number: string }>;
}>) {
  const { number } = await params;
  redirect(`/conflict-issues?issue=${encodeURIComponent(number)}`);
}
