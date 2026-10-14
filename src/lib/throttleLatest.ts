/** Leading + trailing throttle: continuous input never postpones the next update. */
export function throttleLatest<T>(apply: (value: T) => void, intervalMs: number) {
  let last = -Infinity;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let latest: T;
  const flush = () => {
    pending = undefined;
    last = performance.now();
    apply(latest);
  };
  return {
    update(value: T) {
      latest = value;
      if (pending !== undefined) return;
      const remaining = intervalMs - (performance.now() - last);
      if (remaining <= 0) flush();
      else pending = setTimeout(flush, remaining);
    },
    cancel() {
      clearTimeout(pending);
      pending = undefined;
      last = -Infinity;
    },
  };
}
