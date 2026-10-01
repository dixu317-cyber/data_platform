import { AdminStrategiesPage } from "../../../components/admin/admin-pages";
import { requirePageSession } from "../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../lib/server/auth-store";
import { getAdminStrategies, getAdminEvaluations } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function AdminStrategiesRoute() {
  const user = await requirePageSession({ nextPath: "/admin/strategies", requireAdmin: true });
  const storeUser = userToStoreUser(user);
  const [strategies, evaluations] = await Promise.all([getAdminStrategies(storeUser), getAdminEvaluations(storeUser)]);
  return <AdminStrategiesPage initialStrategies={strategies} initialEvaluations={evaluations} />;
}
