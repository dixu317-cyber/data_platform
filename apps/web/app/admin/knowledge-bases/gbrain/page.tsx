import { AdminPageCurationWorkbench } from "../../../../components/admin/admin-form-curation";
import { requirePageSession } from "../../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../../lib/server/auth-store";
import { listGbrainPageSources } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function AdminGbrainCurationRoute() {
  const user = await requirePageSession({ nextPath: "/admin/knowledge-bases/gbrain", requireAdmin: true });
  const sources = await listGbrainPageSources(userToStoreUser(user));
  return <AdminPageCurationWorkbench sources={sources} />;
}
