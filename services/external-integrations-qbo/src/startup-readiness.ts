import "server-only";

export function createQboStartupReadiness(check: () => Promise<void>): () => Promise<boolean> {
  let ready = false;
  let pending: Promise<boolean> | null = null;

  return async () => {
    if (ready) return true;
    if (!pending) {
      pending = Promise.resolve()
        .then(check)
        .then(() => {
          ready = true;
          return true;
        }, () => false)
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };
}
