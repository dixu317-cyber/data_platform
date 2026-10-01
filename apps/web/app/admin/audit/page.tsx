import { AdminAuditPage } from "../../../components/admin/admin-pages";
import { requirePageSession } from "../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../lib/server/auth-store";
import { listAdminAuditEvents } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function AdminAuditRoute() {
  const user = await requirePageSession({ nextPath: "/admin/audit", requireAdmin: true });
  const events = await listAdminAuditEvents(userToStoreUser(user));
  return <AdminAuditPage initialEvents={events} />;
}
