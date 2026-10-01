// TODO(P18): 新增 knowledge-bases/graph 静态路由后，静态路由优先匹配，此动态路由已无实际流量入口，下批清理（见 P18 spec §四 决策A 第6步）。
import { notFound } from "next/navigation";

import { AdminKnowledgeEnginePage } from "../../../../components/admin/admin-pages";
import { requirePageSession } from "../../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../../lib/server/auth-store";
import { listAdminKnowledgeAssetDetails, type AdminRagEngine } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ engine: string }>;
};

const engineBySlug: Record<string, AdminRagEngine> = {
  gbrain: "Gbrain",
  naive: "Naive RAG",
  graph: "GraphRAG"
};

export default async function AdminKnowledgeEngineRoute({ params }: RouteContext) {
  const { engine: slug } = await params;
  const engine = engineBySlug[slug];
  if (!engine) notFound();

  const user = await requirePageSession({ nextPath: `/admin/knowledge-bases/${slug}`, requireAdmin: true });
  const assets = await listAdminKnowledgeAssetDetails(userToStoreUser(user), { engine });
  return <AdminKnowledgeEnginePage engine={engine} initialAssets={assets} />;
}
