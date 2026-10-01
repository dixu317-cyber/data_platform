import { AdminDocCurationWorkbench } from "../../../../components/admin/admin-form-curation";
import { requirePageSession } from "../../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../../lib/server/auth-store";
import { listNaiveDocuments } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function AdminNaiveCurationRoute() {
  const user = await requirePageSession({ nextPath: "/admin/knowledge-bases/naive", requireAdmin: true });
  const documents = await listNaiveDocuments(userToStoreUser(user));
  return <AdminDocCurationWorkbench documents={documents} />;
}
