import { AdminPipelinesPage } from "../../../components/admin/admin-pages";
import { requirePageSession } from "../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../lib/server/auth-store";
import { listAdminIntakeRequests } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function AdminPipelinesRoute() {
  const user = await requirePageSession({ nextPath: "/admin/pipelines", requireAdmin: true });
  const requests = await listAdminIntakeRequests(userToStoreUser(user));
  return <AdminPipelinesPage initialRequests={requests} />;
}
