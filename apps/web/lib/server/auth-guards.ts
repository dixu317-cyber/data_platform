import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AUTH_COOKIE_NAME, getSessionUser, type IdentityUser } from "./auth-store";

export async function getPageSession(): Promise<IdentityUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  return getSessionUser(token);
}

export async function requirePageSession(input: { nextPath: string; requireAdmin?: boolean }): Promise<IdentityUser> {
  const user = await getPageSession();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNextPath(input.nextPath))}`);
  if (input.requireAdmin && !user.is_admin) {
    redirect(`/login?next=${encodeURIComponent(safeNextPath(input.nextPath))}&reason=admin`);
  }
  return user;
}

export function safeNextPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}
