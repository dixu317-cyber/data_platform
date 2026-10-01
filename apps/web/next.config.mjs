import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDirectory = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Trace workspace dependencies from the repository root so standalone output
  // includes @ff/platform and its transitive workspace sources.
  outputFileTracingRoot: join(configDirectory, '../..'),
  // P12 Phase 1：apps/web 首次运行时依赖 @ff/platform 的 TS 源（平台逻辑已归位到 packages/platform）。
  // Next 默认不转译 node_modules 里的 workspace TS 包，须显式声明由 Next SWC 编译。
  transpilePackages: ["@ff/platform"],
};

export default nextConfig;
