import "./app.css";
import { requirePageSession } from "../../lib/server/auth-guards";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requirePageSession({ nextPath: "/app" });
  return <div className="cw-root">{children}</div>;
}
