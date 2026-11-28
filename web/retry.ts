// Something loaded from the server that the page can't do without: a load that
// fails is tried again until it works or `wanted` says it's no longer needed
// (then null). No DOM here, so the tests can fail it.

export const RETRY_MS = 4000;

export async function keepTrying<T>(load: () => Promise<T>, wanted: () => boolean, ms = RETRY_MS): Promise<T | null> {
  for (;;) {
    try {
      return await load();
    } catch {
      await new Promise((r) => setTimeout(r, ms));
      if (!wanted()) return null;
    }
  }
}
