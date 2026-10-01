export interface DatabaseDefinition {
  name: string;
  runtimeRole: string;
  extensions: string[];
}

export interface DatabaseContract {
  schemaVersion: string;
  scope: {
    databaseFoundationOnly: boolean;
    fullStackOwner: string;
  };
  compose: {
    projectName: string;
    services: string[];
    forbiddenBusinessServices: string[];
    volumes: string[];
    portBindings: string[];
  };
  addresses: {
    postgres: { host: string; container: string };
    neo4j: { hostBolt: string; containerBolt: string; hostBrowser: string };
  };
  postgres: {
    versionMajor: number;
    databases: DatabaseDefinition[];
    roles: { bootstrap: string; migrator: string; runtime: string[] };
    runtimePolicy: {
      ownDatabaseOnly: boolean;
      schemaUsage: boolean;
      objectCrud: boolean;
      forbidden: string[];
      nonGraphSchemaCreate: boolean;
    };
    runtimeCreateExceptions: Record<string, { database: string; schema: string }>;
  };
  lightrag: {
    distribution: string;
    version: string;
    strategy: string;
    workSchema: string;
    businessSchema: string;
    searchPath: string[];
    allowedTablePrefix: string;
    allowedIndexPatterns: string[];
    modelVectorObjectRule: { tablePattern: string; indexPattern: string };
    allowlistEnforcement: string;
    extensionCreateAttempt: string;
  };
  explicitlyAbsent: string[];
}

export interface ComposeServiceLike {
  ports?: string[];
  environment?: Record<string, string>;
}

export interface ComposeLike {
  name?: string;
  services: Record<string, ComposeServiceLike>;
  volumes: Record<string, { name?: string }>;
}

const EXPECTED_TOP_LEVEL_KEYS = [
  "addresses",
  "compose",
  "explicitlyAbsent",
  "lightrag",
  "postgres",
  "schemaVersion",
  "scope",
] as const;

const EXPECTED_SERVICES = ["postgres", "neo4j", "migrate"] as const;
const FORBIDDEN_BUSINESS_SERVICES = [
  "web",
  "api",
  "agent-gateway",
  "nano",
  "traditional",
  "graph",
] as const;
const EXPECTED_VOLUMES = [
  "ff_companybrain_m2b_postgres_data",
  "ff_companybrain_m2b_neo4j_data",
] as const;
const EXPECTED_DATABASES: readonly DatabaseDefinition[] = [
  { name: "platform_identity_db", runtimeRole: "ff_identity_app", extensions: [] },
  { name: "platform_core_db", runtimeRole: "ff_platform_app", extensions: [] },
  { name: "nano_brain_db", runtimeRole: "ff_nano_app", extensions: ["vector"] },
  { name: "agent_gateway_db", runtimeRole: "ff_agent_app", extensions: [] },
  {
    name: "traditional_rag_db",
    runtimeRole: "ff_traditional_app",
    extensions: ["vector", "pg_trgm"],
  },
  { name: "graph_rag_db", runtimeRole: "ff_graph_app", extensions: ["vector"] },
];
const EXPECTED_RUNTIME_ROLES = EXPECTED_DATABASES.map(({ runtimeRole }) => runtimeRole);
const EXPECTED_FORBIDDEN_PRIVILEGES = [
  "cross-database-connect",
  "create-database",
  "create-extension",
  "create-role",
  "superuser",
] as const;
const EXPECTED_ABSENT = [
  "image-digest-gate",
  "multi-architecture-gate",
  "offline-proof",
  "ha",
  "pitr",
  "tls",
  "pgbouncer",
  "capacity-32-60-formula",
  "mcp-concurrency",
  "full-stack-services",
] as const;

const LEGACY_FIELD_NAMES = new Set([
  "imagedigest",
  "multiarch",
  "offlineproof",
  "capacityformula",
  "mcpconcurrency",
  "pitr",
  "tls",
  "pgbouncer",
  "ha",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function sameStrings(actual: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.every((item) => typeof item === "string") &&
    JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected))
  );
}

function sameOrderedStrings(actual: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.every((item) => typeof item === "string") &&
    JSON.stringify(actual) === JSON.stringify(expected)
  );
}

function pushUnless(errors: string[], condition: boolean, message: string): void {
  if (!condition) errors.push(message);
}

function scanForbiddenKeys(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenKeys(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
    if (LEGACY_FIELD_NAMES.has(normalized)) {
      errors.push(`${path}.${key} is a production-only v0.4 field`);
    }
    if (/(password|secret|credential|token)/i.test(key)) {
      errors.push(`${path}.${key} must not contain secrets or secret fields`);
    }
    scanForbiddenKeys(child, `${path}.${key}`, errors);
  }
}

export function validateDatabaseContract(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ["contract must be a JSON object"];

  pushUnless(
    errors,
    sameStrings(Object.keys(input), EXPECTED_TOP_LEVEL_KEYS),
    "contract top-level fields must match the v0.6 teaching schema exactly",
  );
  scanForbiddenKeys(input, "$", errors);

  const contract = input as unknown as DatabaseContract;
  pushUnless(errors, contract.schemaVersion === "m2b-teaching-v0.6", "wrong schemaVersion");
  pushUnless(
    errors,
    contract.scope?.databaseFoundationOnly === true && contract.scope?.fullStackOwner === "M3",
    "scope must remain database-only and leave full-stack delivery to M3",
  );
  pushUnless(
    errors,
    contract.compose?.projectName === "ff-companybrain-m2b",
    "wrong Compose project name",
  );
  pushUnless(
    errors,
    sameStrings(contract.compose?.services, EXPECTED_SERVICES),
    "services must be exactly postgres, neo4j, and migrate",
  );
  pushUnless(
    errors,
    sameStrings(contract.compose?.forbiddenBusinessServices, FORBIDDEN_BUSINESS_SERVICES),
    "business-service denylist is incomplete",
  );
  pushUnless(
    errors,
    sameStrings(contract.compose?.volumes, EXPECTED_VOLUMES),
    "volumes must be the two M2-B dedicated names",
  );
  pushUnless(
    errors,
    sameStrings(contract.compose?.portBindings, [
      "127.0.0.1:55432:5432",
      "127.0.0.1:7474:7474",
      "127.0.0.1:7687:7687",
    ]),
    "published database ports must bind explicitly to 127.0.0.1",
  );

  pushUnless(
    errors,
    contract.addresses?.postgres?.host === "localhost:55432" &&
      contract.addresses?.postgres?.container === "postgres:5432",
    "PostgreSQL host/container address contract is wrong",
  );
  pushUnless(
    errors,
    contract.addresses?.neo4j?.hostBolt === "bolt://localhost:7687" &&
      contract.addresses?.neo4j?.containerBolt === "bolt://neo4j:7687" &&
      contract.addresses?.neo4j?.hostBrowser === "http://localhost:7474",
    "Neo4j host/container address contract is wrong",
  );

  pushUnless(errors, contract.postgres?.versionMajor === 17, "PostgreSQL major must be 17");
  const databases = contract.postgres?.databases;
  const databaseMatrixMatches =
    Array.isArray(databases) &&
    databases.length === EXPECTED_DATABASES.length &&
    databases.every((database, index) => {
      const expected = EXPECTED_DATABASES[index];
      return (
        expected !== undefined &&
        database?.name === expected.name &&
        database?.runtimeRole === expected.runtimeRole &&
        sameOrderedStrings(database?.extensions, expected.extensions)
      );
    });
  pushUnless(errors, databaseMatrixMatches, "six-database/role/extension matrix is wrong");

  pushUnless(errors, contract.postgres?.roles?.bootstrap === "postgres", "wrong bootstrap role");
  pushUnless(errors, contract.postgres?.roles?.migrator === "ff_migrator", "wrong migrator role");
  pushUnless(
    errors,
    sameOrderedStrings(contract.postgres?.roles?.runtime, EXPECTED_RUNTIME_ROLES),
    "runtime role list is wrong",
  );
  const policy = contract.postgres?.runtimePolicy;
  pushUnless(
    errors,
    policy?.ownDatabaseOnly === true &&
      policy?.schemaUsage === true &&
      policy?.objectCrud === true &&
      policy?.nonGraphSchemaCreate === false &&
      sameStrings(policy?.forbidden, EXPECTED_FORBIDDEN_PRIVILEGES),
    "runtime minimum-privilege policy is incomplete",
  );
  pushUnless(
    errors,
    JSON.stringify(contract.postgres?.runtimeCreateExceptions) ===
      JSON.stringify({ ff_graph_app: { database: "graph_rag_db", schema: "lightrag" } }),
    "only ff_graph_app may CREATE in graph_rag_db.lightrag",
  );

  const light = contract.lightrag;
  pushUnless(
    errors,
    light?.distribution === "lightrag-hku" && light?.version === "1.5.0",
    "LightRAG distribution/version must be locked to lightrag-hku 1.5.0",
  );
  pushUnless(
    errors,
    light?.strategy === "graph-only-schema-create-exception" &&
      light?.workSchema === "lightrag" &&
      light?.businessSchema === "public" &&
      sameOrderedStrings(light?.searchPath, ["lightrag", "public"]),
    "LightRAG graph-only schema/search_path decision is wrong",
  );
  pushUnless(
    errors,
    light?.allowedTablePrefix === "lightrag_" &&
      sameOrderedStrings(light?.allowedIndexPatterns, [
        "^idx_lightrag_[a-z0-9_]+$",
        "^idx_[0-9a-f]{12}_(hnsw_cosine|workspace_id|id)$",
      ]) &&
      light?.modelVectorObjectRule?.tablePattern ===
        "^lightrag_vdb_(chunks|entity|relation)(_[a-z0-9_]+)?$" &&
      light?.modelVectorObjectRule?.indexPattern ===
        "^idx_[0-9a-f]{12}_(hnsw_cosine|workspace_id|id)$",
    "LightRAG table/index allowlist is incomplete",
  );
  pushUnless(
    errors,
    light?.extensionCreateAttempt === "caught-when-vector-is-preinstalled",
    "LightRAG vector-extension compatibility decision is missing",
  );
  pushUnless(
    errors,
    light?.allowlistEnforcement === "post-smoke-detection-not-postgres-rbac",
    "LightRAG object allowlist must be enforced by post-smoke detection, not claimed as PostgreSQL RBAC",
  );
  pushUnless(
    errors,
    sameStrings(contract.explicitlyAbsent, EXPECTED_ABSENT),
    "production-only exclusions must be explicit and exact",
  );

  return errors;
}

function servicePorts(service: ComposeServiceLike | undefined): string[] {
  return Array.isArray(service?.ports)
    ? service.ports.filter((port): port is string => typeof port === "string")
    : [];
}

export function validateComposeShape(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ["Compose shape must be an object"];
  const compose = input as unknown as ComposeLike;
  const services = isRecord(compose.services) ? compose.services : {};
  const volumes = isRecord(compose.volumes) ? compose.volumes : {};

  pushUnless(errors, compose.name === "ff-companybrain-m2b", "wrong Compose project name");
  pushUnless(
    errors,
    sameStrings(Object.keys(services), EXPECTED_SERVICES),
    "Compose services must be exactly postgres, neo4j, and migrate",
  );
  const businessServices = Object.keys(services).filter((name) =>
    FORBIDDEN_BUSINESS_SERVICES.includes(name as (typeof FORBIDDEN_BUSINESS_SERVICES)[number]),
  );
  pushUnless(errors, businessServices.length === 0, `business services are forbidden: ${businessServices.join(", ")}`);

  pushUnless(
    errors,
    sameStrings(servicePorts(services.postgres), ["127.0.0.1:55432:5432"]),
    "PostgreSQL port mapping must be 127.0.0.1:55432:5432",
  );
  pushUnless(
    errors,
    sameStrings(servicePorts(services.neo4j), [
      "127.0.0.1:7474:7474",
      "127.0.0.1:7687:7687",
    ]),
    "Neo4j port mappings must bind 7474 and 7687 explicitly to 127.0.0.1",
  );
  pushUnless(errors, servicePorts(services.migrate).length === 0, "migrate must not publish ports");

  const volumeNames = Object.values(volumes).map((definition) =>
    isRecord(definition) && typeof definition.name === "string" ? definition.name : "",
  );
  pushUnless(
    errors,
    sameStrings(volumeNames, EXPECTED_VOLUMES),
    "Compose must resolve exactly the two M2-B dedicated volume names",
  );

  const environment = isRecord(services.migrate?.environment)
    ? services.migrate.environment
    : {};
  pushUnless(
    errors,
    environment.POSTGRES_HOST === "postgres" && environment.POSTGRES_PORT === "5432",
    "migrate must use postgres:5432 inside Compose",
  );
  pushUnless(
    errors,
    environment.NEO4J_URI === "bolt://neo4j:7687",
    "migrate must use bolt://neo4j:7687 inside Compose",
  );
  const loopbackReference = /(^|[\/:@])(localhost|127\.0\.0\.1|\[?::1\]?)(?=[:\/]|$)/i;
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value === "string" && loopbackReference.test(value)) {
      errors.push(`migrate environment ${name} must not reference a host loopback address`);
    }
  }

  return errors;
}
