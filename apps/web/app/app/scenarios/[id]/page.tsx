import { ScenarioDetailByIdPage } from "../../../../components/app/platform";

export default async function ScenarioDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScenarioDetailByIdPage id={id} />;
}
