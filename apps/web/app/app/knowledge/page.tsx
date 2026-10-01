import { KnowledgeSpacePage } from "../../../components/app/platform";
import { requirePageSession } from "../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../lib/server/auth-store";
import { getStoredPlatformSnapshot } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function KnowledgeRoute() {
  const user = await requirePageSession({ nextPath: "/app/knowledge" });
  const snapshot = await getStoredPlatformSnapshot(userToStoreUser(user));
  return <KnowledgeSpacePage initialSnapshot={snapshot} />;
}
