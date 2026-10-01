import { LoginPage } from "../../components/auth/login-page";
import { safeNextPath } from "../../lib/server/auth-guards";

export default async function LoginRoute({ searchParams }: { searchParams: Promise<{ next?: string | string[]; reason?: string | string[] }> }) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  return <LoginPage nextPath={safeNextPath(next)} reason={reason} />;
}
