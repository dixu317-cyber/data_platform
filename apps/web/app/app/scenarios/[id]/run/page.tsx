import { Suspense } from "react";
import { ScenarioDetailByIdPage } from "../../../../../components/app/platform";

export default async function ScenarioRunRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><ScenarioDetailByIdPage id={id} tab="ask" /></Suspense>;
}
