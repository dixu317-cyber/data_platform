import { CompanyChatPage } from "../../../components/app/platform";
import { requirePageSession } from "../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../lib/server/auth-store";
import { getStoredPlatformSnapshot } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function AskRoute({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const user = await requirePageSession({ nextPath: "/app/ask" });
  const snapshot = await getStoredPlatformSnapshot(userToStoreUser(user));
  const params = await searchParams;
  const q = Array.isArray(params.q) ? params.q[0] : params.q;
  return <CompanyChatPage initialQuery={q} initialSnapshot={snapshot} />;
}
