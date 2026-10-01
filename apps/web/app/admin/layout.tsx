import { requirePageSession } from "../../lib/server/auth-guards";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePageSession({ nextPath: "/admin", requireAdmin: true });
  return children;
}
