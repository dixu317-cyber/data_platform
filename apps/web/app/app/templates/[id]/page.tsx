import { TemplateDetailPage } from "../../../../components/app/platform";

export default async function TemplateDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TemplateDetailPage id={id} />;
}
