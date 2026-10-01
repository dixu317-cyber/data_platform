import { Suspense } from "react";
import { TaskCenterPage } from "../../../components/app/platform";
import { requirePageSession } from "../../../lib/server/auth-guards";
import { userToStoreUser } from "../../../lib/server/auth-store";
import { getStoredPlatformSnapshot } from "@ff/platform/platform-store";

export const dynamic = "force-dynamic";

export default async function TasksRoute() {
  const user = await requirePageSession({ nextPath: "/app/tasks" });
  const snapshot = await getStoredPlatformSnapshot(userToStoreUser(user));
  return <Suspense><TaskCenterPage initialSnapshot={snapshot} /></Suspense>;
}
