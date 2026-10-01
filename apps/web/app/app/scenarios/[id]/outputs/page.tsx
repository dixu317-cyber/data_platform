import { ScenarioDetailByIdPage } from "../../../../../components/app/platform";

export default async function ScenarioOutputsRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScenarioDetailByIdPage id={id} tab="outputs" />;
}
