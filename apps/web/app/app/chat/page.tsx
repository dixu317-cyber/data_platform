import { CompanyChatPage } from "../../../components/app/platform";

export default async function ChatRoute({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const params = await searchParams;
  const q = Array.isArray(params.q) ? params.q[0] : params.q;
  return <CompanyChatPage initialQuery={q} />;
}
