import { AdminTemplatesPage } from "../../../components/admin/admin-pages";
import { requirePageSession } from "../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../lib/server/auth-store";
import { listAdminScenarioTemplates } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function AdminTemplatesRoute() {
  const user = await requirePageSession({ nextPath: "/admin/templates", requireAdmin: true });
  const templates = await listAdminScenarioTemplates(userToStoreUser(user));
  return <AdminTemplatesPage initialTemplates={templates} />;
}
