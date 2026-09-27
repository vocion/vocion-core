import { describe, expect, it } from 'vitest';
import { listedShots } from './requiredToolPass';

describe('listedShots', () => {
  it('reads the screenshots a refusal hands over, and nothing else', () => {
    const refusal = 'Not recorded: task #177 has 2 screenshots and this review opened none of them. Open them:\n- Empty state · desktop · after: https://agents.example/dashboard/artifacts/949\n- Chips · phone · after: https://agents.example/dashboard/artifacts/950\nsee https://example.com/other';

    expect(listedShots(refusal)).toEqual([
      { title: 'Empty state · desktop · after', link: 'https://agents.example/dashboard/artifacts/949' },
      { title: 'Chips · phone · after', link: 'https://agents.example/dashboard/artifacts/950' },
    ]);
    expect(listedShots('Not recorded: an approve cannot carry 1 criteria')).toEqual([]);
  });
});
