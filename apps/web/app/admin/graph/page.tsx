import { redirect } from "next/navigation";

// P18：GraphRAG 归位（决策 A），旧链接保留跳转不 404，唯一治理入口迁到 /admin/knowledge-bases/graph。
export default function AdminGraphLegacyRoute() {
  redirect("/admin/knowledge-bases/graph");
}
