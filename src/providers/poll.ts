export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  label?: string;
}

export async function pollUntil<T>(
  check: () => Promise<{ done: boolean; value?: T; status?: string }>,
  options: PollOptions = {},
): Promise<T> {
  const interval = options.intervalMs ?? 2500;
  const timeout = options.timeoutMs ?? 8 * 60_000;
  const started = Date.now();
  for (;;) {
    const result = await check();
    if (result.done && result.value !== undefined) return result.value;
    if (Date.now() - started > timeout) {
      throw new Error(
        `${options.label ?? "provider"} timed out after ${Math.round(timeout / 1000)}s (${result.status ?? "pending"})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export async function readHttpError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `${res.status} ${res.statusText}${text ? `: ${text.slice(0, 400)}` : ""}`;
}
