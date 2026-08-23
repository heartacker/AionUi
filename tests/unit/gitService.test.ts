import { describe, it, expect } from 'vitest';
import type { RawGitLogEntry } from '@process/services/git/gitGraphParser';
import { parseRawGitLogLine, calculateLanes } from '@process/services/git/gitGraphParser';

describe('gitGraphParser', () => {
  it('should correctly parse formatted git log line', () => {
    const sampleLine =
      'a1b2c3d4e5f6|f0e1d2c3|John Doe|john@example.com|1710000000|feat: add new feature (HEAD -> main, origin/main)';
    const parsed = parseRawGitLogLine(sampleLine);

    expect(parsed).not.toBeNull();
    expect(parsed?.hash).toBe('a1b2c3d4e5f6');
    expect(parsed?.parents).toEqual(['f0e1d2c3']);
    expect(parsed?.author).toBe('John Doe');
    expect(parsed?.email).toBe('john@example.com');
    expect(parsed?.message).toBe('feat: add new feature');
    expect(parsed?.refStr).toBe('HEAD -> main, origin/main');
  });

  it('should calculate branch lanes accurately', () => {
    const rawEntries: RawGitLogEntry[] = [
      {
        hash: 'commit-3',
        parents: ['commit-2', 'commit-1b'],
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 1710000002000,
        message: 'Merge branch feat',
        refStr: 'HEAD -> main',
      },
      {
        hash: 'commit-1b',
        parents: ['commit-1'],
        author: 'Bob',
        email: 'bob@example.com',
        timestamp: 1710000001500,
        message: 'feat work',
        refStr: 'feat',
      },
      {
        hash: 'commit-2',
        parents: ['commit-1'],
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 1710000001000,
        message: 'main work',
        refStr: '',
      },
      {
        hash: 'commit-1',
        parents: [],
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 1710000000000,
        message: 'Initial commit',
        refStr: '',
      },
    ];

    const result = calculateLanes(rawEntries);
    expect(result).toHaveLength(4);
    expect(result[0].lane).toBe(0);
    expect(result[0].lines.length).toBeGreaterThan(0);
    expect(result[0].refs).toContain('HEAD -> main');
  });
});
