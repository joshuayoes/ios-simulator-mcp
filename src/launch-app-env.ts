type LaunchArgsInput = {
  udid: string;
  bundleId: string;
  terminateRunning?: boolean;
  env?: Record<string, string>;
};

type LaunchArgsOutput = {
  args: string[];
  env: Record<string, string>;
};

export function buildLaunchArgs({
  udid,
  bundleId,
  terminateRunning,
  env,
}: LaunchArgsInput): LaunchArgsOutput {
  const args: string[] = ["launch"];

  if (terminateRunning) {
    args.push("--terminate-running-process");
  }

  const simctlEnv: Record<string, string> = {};

  if (env) {
    const entries = Object.entries(env)
      .map(([key, value]) => [key.trim(), value] as const)
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [key, value] of entries) {
      if (!key) {
        throw new Error("Environment variable keys must be non-empty.");
      }
      simctlEnv[`SIMCTL_CHILD_${key}`] = value;
    }
  }

  args.push(udid, bundleId);
  return { args, env: simctlEnv };
}
