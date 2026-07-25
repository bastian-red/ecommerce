/**
 * Race a promise against a deadline, resolving to `fallback` on timeout or
 * rejection.
 *
 * The health check uses this so a hung dependency makes `/health` return 503
 * quickly rather than blocking forever. A disconnected Redis is the concrete
 * case: with `maxRetriesPerRequest: null` its commands queue silently instead of
 * failing, so without a bound the probe hangs and the monitor reports a timeout
 * rather than a clean 503.
 */
export function withTimeout<T>(promise: Promise<T>, fallback: T, ms = 2_000): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
