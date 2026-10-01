export { assertInternalTokenValid } from "./internal-token";

export type UserContext = {
  userId: string;
  username: string;
  isAdmin: boolean;
  organizationId?: string;
  teamIds?: string[];
};

export type ModuleId = 'nano-brain' | 'traditional-rag' | 'graph-rag';

export type HealthResponse = {
  status: 'ok' | 'error';
  service: string;
};
