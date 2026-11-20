export function urlValue(env: NodeJS.ProcessEnv, key: string): URL
export function directHost(host: string): string
export function httpsUrl(env: NodeJS.ProcessEnv, key: string, originOnly?: boolean): URL
export function assertDemoTarget(
  env: NodeJS.ProcessEnv,
  requireDirect?: boolean,
): { pooled: URL; direct: URL }
export function validateDeployment(env: NodeJS.ProcessEnv, target: string): void
