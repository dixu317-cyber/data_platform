import { AdminKnowledgeBasesPage } from "../../../components/admin/admin-pages";
import { requirePageSession } from "../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../lib/server/auth-store";
import { listAdminKnowledgeAssetDetails } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function AdminKnowledgeBasesRoute() {
  const user = await requirePageSession({ nextPath: "/admin/knowledge-bases", requireAdmin: true });
  const assets = await listAdminKnowledgeAssetDetails(userToStoreUser(user));
  return <AdminKnowledgeBasesPage initialAssets={assets} />;
}
