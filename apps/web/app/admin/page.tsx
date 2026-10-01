import { AdminOverviewPage } from "../../components/admin/admin-pages";
import { requirePageSession } from "../../lib/server/auth-guards";
import { userToStoreUser } from "../../lib/server/auth-store";
import { getAdminDashboardSnapshot, listAdminIntakeRequests } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const user = await requirePageSession({ nextPath: "/admin", requireAdmin: true });
  const storeUser = userToStoreUser(user);
  const [requests, dashboard] = await Promise.all([
    listAdminIntakeRequests(storeUser),
    getAdminDashboardSnapshot(storeUser)
  ]);
  return <AdminOverviewPage initialRequests={requests} dashboard={dashboard} />;
}
