import { AdminGraphCurationWorkbench } from "../../../../components/admin/admin-graph-curation";
import { requirePageSession } from "../../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../../lib/server/auth-store";
import { listGraphCurationSources } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function AdminGraphCurationRoute() {
  const user = await requirePageSession({ nextPath: "/admin/knowledge-bases/graph", requireAdmin: true });
  const sources = await listGraphCurationSources(userToStoreUser(user));
  return <AdminGraphCurationWorkbench sources={sources} />;
}
