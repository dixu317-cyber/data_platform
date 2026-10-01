export const p54ReleaseFixture = {
  sessionCount: 2,
  activeMessageCount: 4,
  citationCount: 3,
  knowledgeCounts: {
    private: 2,
    team: 3,
    company: 5
  },
  authIdentityCount: 4,
  viewports: [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 375, height: 812 }
  ]
} as const;

export function validateP54ReleaseFixture() {
  const errors: string[] = [];
  if (p54ReleaseFixture.sessionCount !== 2) errors.push("sessionCount");
  if (p54ReleaseFixture.activeMessageCount !== 4) errors.push("activeMessageCount");
  if (p54ReleaseFixture.citationCount !== 3) errors.push("citationCount");
  if (p54ReleaseFixture.knowledgeCounts.private !== 2) errors.push("knowledgeCounts.private");
  if (p54ReleaseFixture.knowledgeCounts.team !== 3) errors.push("knowledgeCounts.team");
  if (p54ReleaseFixture.knowledgeCounts.company !== 5) errors.push("knowledgeCounts.company");
  if (p54ReleaseFixture.authIdentityCount !== 4) errors.push("authIdentityCount");
  if (p54ReleaseFixture.viewports.length !== 4) errors.push("viewports");
  return errors;
}
