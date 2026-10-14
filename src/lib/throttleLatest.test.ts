import { afterEach, describe, expect, it, vi } from 'vitest';
import { throttleLatest } from './throttleLatest.ts';

afterEach(() => vi.useRealTimers());

describe('throttleLatest', () => {
  it('keeps updating during continuous input and flushes the final view within one interval', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const updates = throttleLatest(apply, 100);
    updates.update(0);
    for (let i = 1; i <= 12; i++) {
      vi.advanceTimersByTime(16);
      updates.update(i);
    }
    expect(apply.mock.calls).toEqual([[0], [6]]);
    vi.advanceTimersByTime(8);
    expect(apply.mock.calls).toEqual([[0], [6], [12]]);
    vi.advanceTimersByTime(500);
    expect(apply).toHaveBeenCalledTimes(3);
  });

  it('cancels pending work on unmount and can restart after effect cleanup', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const updates = throttleLatest(apply, 100);
    updates.update(1);
    vi.advanceTimersByTime(16);
    updates.update(2);
    updates.cancel();
    vi.advanceTimersByTime(100);
    expect(apply.mock.calls).toEqual([[1]]);
    updates.update(3);
    expect(apply.mock.calls).toEqual([[1], [3]]);
  });
});
