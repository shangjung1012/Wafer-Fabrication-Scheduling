"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";
import {
  getPostLogoutLoginPath,
  logoutClientAuthSession,
} from "@/modules/auth/client-session";

const NAV = [
  { label: "Orders", href: "/orders" },
  { label: "Issues", href: "/conflict-issues" },
  { label: "Visualization", href: "/visualization" },
  { label: "Dashboard", href: "/visualization/dashboard" },
  { label: "Users", href: "/users" },
  { label: "Profile", href: "/profile" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/visualization") {
    return (
      pathname.startsWith("/visualization") &&
      !pathname.startsWith("/visualization/dashboard")
    );
  }
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useClientAuthSession();

  const handleLogout = async () => {
    await logoutClientAuthSession();
    router.replace(getPostLogoutLoginPath());
  };

  return (
    <div className="flex-none border-b border-gray-200 bg-white px-3 py-3 sm:px-4 lg:px-6">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        <div className="min-w-0 lg:w-52 lg:shrink-0">
          <h1 className="text-base font-semibold text-gray-900">{title}</h1>
          <p className="text-xs text-gray-500 truncate">{subtitle}</p>
        </div>

        <div className="-mx-3 overflow-x-auto px-3 sm:-mx-4 sm:px-4 lg:mx-0 lg:overflow-visible lg:px-0">
          <nav
            className="flex min-w-max items-center gap-2 lg:min-w-0 lg:flex-wrap"
            aria-label="Dashboard navigation"
          >
            {NAV.map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                className={`text-xs font-medium px-2.5 py-1.5 rounded border ${
                  isActive(pathname ?? "", href)
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-gray-200 bg-white text-gray-600 hover:text-gray-900"
                }`}
              >
                {label}
              </Link>
            ))}
            {session?.user.role === "SUPERADMIN" && (
              <Link
                href="/permissions"
                className={`text-xs font-medium px-2.5 py-1.5 rounded border ${
                  isActive(pathname ?? "", "/permissions")
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-gray-200 bg-white text-gray-600 hover:text-gray-900"
                }`}
              >
                Permissions
              </Link>
            )}
          </nav>
        </div>

        {session && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1 lg:ml-auto lg:max-w-[34rem] lg:flex-nowrap">
            <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
              Signed in as:
            </span>
            <span className="min-w-0 truncate text-xs font-semibold text-gray-800">
              {session.user.username}
            </span>
            <span className="min-w-0 max-w-full truncate text-xs text-gray-500 lg:max-w-48">
              ({session.user.email})
            </span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
              {session.user.role}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="text-xs font-medium px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
