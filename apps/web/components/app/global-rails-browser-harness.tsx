import { createRoot } from "react-dom/client";
import { CompanyChatPage, SettingsPage } from "./platform";
import { p54ReleaseFixture } from "../../lib/p54-release-fixture";

const root = document.getElementById("p54-browser-root");

if (!root) {
  throw new Error("P54 browser harness root is missing");
}

const accountKnowledge = [
  ...Array.from({ length: p54ReleaseFixture.knowledgeCounts.private }, (_, index) => ({ id: `private-${index}`, visibility: "private" as const })),
  ...Array.from({ length: p54ReleaseFixture.knowledgeCounts.team }, (_, index) => ({ id: `team-${index}`, visibility: "team" as const })),
  ...Array.from({ length: p54ReleaseFixture.knowledgeCounts.company }, (_, index) => ({ id: `company-${index}`, visibility: "company" as const }))
].map((item) => ({
  ...item,
  scenarioId: "p54-account",
  title: item.id,
  content: "P54 deterministic browser fixture",
  ownerName: "P54",
  ragEngine: "Naive RAG" as const,
  sourceOriginalName: `${item.id}.md`,
  createdAt: "2026-07-24T00:00:00.000Z"
}));

createRoot(root).render(
  root.dataset.p54Page === "account" ? (
    <SettingsPage
      initialSnapshot={{
        scenarios: [],
        tasks: [],
        knowledge: accountKnowledge
      }}
    />
  ) : (
    <CompanyChatPage
      initialSnapshot={{
        scenarios: [],
        tasks: [],
        knowledge: []
      }}
    />
  )
);
