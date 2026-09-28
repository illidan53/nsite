import { describe, expect, it } from 'vitest';
import { format } from './i18n.tsx';

describe('format', () => {
  it('fills named placeholders and keeps unknown ones', () => {
    expect(format('再显示 {n} 个（共 {total}）', { n: 12, total: 307 })).toBe('再显示 12 个（共 307）');
    expect(format('{a} {missing}', { a: 'x' })).toBe('x {missing}');
    expect(format('plain')).toBe('plain');
  });
});
