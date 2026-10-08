const RUNNER_ONLINE_MS = 2 * 60 * 1000;

export const runnerOnline = (runner: { lastSeenAt: Date | null } | undefined) =>
  !!runner?.lastSeenAt && Date.now() - runner.lastSeenAt.getTime() < RUNNER_ONLINE_MS;
