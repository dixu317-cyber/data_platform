import { AdminEvaluationsPage } from "../../../components/admin/admin-pages";
import { requirePageSession } from "../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../lib/server/auth-store";
import { getAdminEvaluations } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function AdminEvaluationsRoute() {
  const user = await requirePageSession({ nextPath: "/admin/evaluations", requireAdmin: true });
  const evaluations = await getAdminEvaluations(userToStoreUser(user));
  return <AdminEvaluationsPage initialEvaluations={evaluations} />;
}
