import { ScenarioDetailByIdPage } from "../../../../../components/app/platform";

export default async function ScenarioAskRoute({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string | string[]; session?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const q = Array.isArray(query.q) ? query.q[0] : query.q;
  const session = Array.isArray(query.session) ? query.session[0] : query.session;
  return <ScenarioDetailByIdPage id={id} tab="ask" initialQuery={q} initialSessionId={session} />;
}
