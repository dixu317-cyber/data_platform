import { notFound } from "next/navigation";

import { AdminTraceDetailPage } from "../../../../components/admin/admin-monitoring";
import { requirePageSession } from "../../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../../lib/server/auth-store";
import { getMonitoringTrace } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function AdminTraceDetailRoute({ params }: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await params;
  const user = await requirePageSession({ nextPath: `/admin/monitoring/${traceId}`, requireAdmin: true });
  const trace = await getMonitoringTrace(userToStoreUser(user), traceId);
  if (!trace) notFound();
  return <AdminTraceDetailPage trace={trace} />;
}
