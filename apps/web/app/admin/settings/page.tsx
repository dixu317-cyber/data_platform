import { AdminSettingsPage } from "../../../components/admin/admin-settings-page";
import { requirePageSession } from "../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../lib/server/auth-store";
import { getAdminIntegrationSettings } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function AdminSettingsRoute() {
  const user = await requirePageSession({ nextPath: "/admin/settings", requireAdmin: true });
  const settings = await getAdminIntegrationSettings(userToStoreUser(user));
  return <AdminSettingsPage initialSettings={settings ?? undefined} />;
}
