import { describe, expect, it } from 'vitest';
import { format } from './i18n.tsx';

describe('format', () => {
  it('fills named placeholders and keeps unknown ones', () => {
    expect(format('加载更多（已显示 {shown} / {total}）', { shown: 5, total: 174 })).toBe('加载更多（已显示 5 / 174）');
    expect(format('{a} {missing}', { a: 'x' })).toBe('x {missing}');
    expect(format('plain')).toBe('plain');
  });
});
