/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Pins the WebUI git handlers to the desktop main-process contract
// (packages/desktop/src/process/services/git/*). The parsers and lane layout
// below are deliberate copies of that code — when behavior diverges, the two
// surfaces start rendering the same repository differently. Pure-function cases
// mirror tests/unit/gitService.test.ts; the handler cases exercise a real
// throwaway repo end to end so command arguments and porcelain parsing stay
// honest.

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  calculateLanes,
  handleGitGetCommitDiff,
  handleGitGetLog,
  handleGitGetStatus,
  parseRawGitLogLine,
  type RawGitLogEntry,
} from './git-handler.js';

describe('parseRawGitLogLine (mirrors gitGraphParser)', () => {
  it('parses a line carrying ref decorations', () => {
    const sampleLine =
      'a1b2c3d4e5f6|f0e1d2c3|John Doe|john@example.com|1710000000|feat: add new feature (HEAD -> main, origin/main)';
    const parsed = parseRawGitLogLine(sampleLine);

    expect(parsed).not.toBeNull();
    expect(parsed?.hash).toBe('a1b2c3d4e5f6');
    expect(parsed?.parents).toEqual(['f0e1d2c3']);
    expect(parsed?.author).toBe('John Doe');
    expect(parsed?.email).toBe('john@example.com');
    expect(parsed?.timestamp).toBe(1710000000 * 1000);
    expect(parsed?.message).toBe('feat: add new feature');
    expect(parsed?.refStr).toBe('HEAD -> main, origin/main');
  });

  it('parses a decoration-free line', () => {
    const parsed = parseRawGitLogLine('abc123|parent1|Alice|a@example.com|1700000000|plain subject');
    expect(parsed?.refStr).toBe('');
    expect(parsed?.message).toBe('plain subject');
  });

  it('joins message fields back when the subject itself contains a pipe', () => {
    const parsed = parseRawGitLogLine('abc123||Alice|a@example.com|1700000000|fix: a|b pipe');
    expect(parsed?.message).toBe('fix: a|b pipe');
  });

  it('handles a root commit with no parents and no refs', () => {
    const parsed = parseRawGitLogLine('root1||Alice|a@example.com|1700000000|Initial commit');
    expect(parsed?.parents).toEqual([]);
    expect(parsed?.message).toBe('Initial commit');
  });

  it('returns null for malformed lines', () => {
    expect(parseRawGitLogLine('')).toBeNull();
    expect(parseRawGitLogLine('only-three-fields')).toBeNull();
  });
});

describe('calculateLanes (mirrors gitGraphParser)', () => {
  it('lays out a merge: merge keeps lane 0, side branch gets its own lane', () => {
    const rawEntries: RawGitLogEntry[] = [
      {
        hash: 'merge',
        parents: ['main2', 'feat1'],
        author: 'Alice',
        email: 'a@example.com',
        timestamp: 3000,
        message: 'Merge branch feat',
        refStr: 'HEAD -> main',
      },
      {
        hash: 'feat1',
        parents: ['root'],
        author: 'Bob',
        email: 'b@example.com',
        timestamp: 2000,
        message: 'feat work',
        refStr: 'feat',
      },
      {
        hash: 'main2',
        parents: ['root'],
        author: 'Alice',
        email: 'a@example.com',
        timestamp: 1500,
        message: 'main work',
        refStr: '',
      },
      {
        hash: 'root',
        parents: [],
        author: 'Alice',
        email: 'a@example.com',
        timestamp: 1000,
        message: 'Initial commit',
        refStr: '',
      },
    ];

    const result = calculateLanes(rawEntries);
    expect(result).toHaveLength(4);
    expect(result[0].lane).toBe(0);
    expect(result[0].lines.length).toBeGreaterThan(0);
    expect(result[0].refs).toContain('HEAD -> main');
    // The two side branches fork onto distinct lanes while root is still open.
    const lanes = result.slice(1).map((c) => c.lane);
    expect(new Set(lanes).size).toBeGreaterThan(1);
    // A root commit releases its lane back to the pool.
    expect(result.find((c) => c.hash === 'root')?.lane).toBe(0);
  });

  it('reuses a released lane slot for a later independent branch', () => {
    const rawEntries: RawGitLogEntry[] = [
      { hash: 'a2', parents: ['a1'], author: 'A', email: 'a@e', timestamp: 4, message: 'm', refStr: '' },
      { hash: 'a1', parents: ['root'], author: 'A', email: 'a@e', timestamp: 3, message: 'm', refStr: '' },
      { hash: 'root', parents: [], author: 'A', email: 'a@e', timestamp: 2, message: 'm', refStr: '' },
      { hash: 'b1', parents: ['root'], author: 'B', email: 'b@e', timestamp: 1, message: 'm', refStr: '' },
    ];
    const result = calculateLanes(rawEntries);
    // root's lane 0 was freed, so b1 reuses it instead of opening lane 2.
    expect(result.find((c) => c.hash === 'b1')?.lane).toBe(0);
  });

  it('splits the ref string into a refs array', () => {
    const parsed = parseRawGitLogLine('abc|p|A|a@e|1700000000|subject (HEAD -> main, tag: v1.0, feat)');
    const result = calculateLanes(parsed ? [parsed] : []);
    expect(result[0].refs).toEqual(['HEAD -> main', 'tag: v1.0', 'feat']);
  });
});

describe('git handlers against a real repository', () => {
  let repo: string;

  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

  beforeAll(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'git-handler-'));
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');

    const commit = (msg: string): string => {
      git('add', '-A');
      return git('commit', '-m', msg);
    };

    await fs.writeFile(path.join(repo, 'a.txt'), 'one\n');
    commit('first commit');
    git('checkout', '-b', 'feat');
    await fs.writeFile(path.join(repo, 'b.txt'), 'feat\n');
    commit('feat work');
    git('checkout', 'main');
    await fs.appendFile(path.join(repo, 'a.txt'), 'two\n');
    commit('main work');
    git('merge', 'feat', '--no-ff', '-m', 'Merge branch feat');

    // A dirty working tree for the status assertions.
    await fs.appendFile(path.join(repo, 'a.txt'), 'dirty\n');
    await fs.writeFile(path.join(repo, 'new.txt'), 'staged\n');
    git('add', 'new.txt');
  });

  afterAll(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it('handleGitGetLog returns the whole topology across branches', async () => {
    const commits = await handleGitGetLog(repo);
    const hashes = commits.map((c) => c.hash);
    expect(hashes).toHaveLength(4); // first, feat work, main work, merge
    const merge = commits.find((c) => c.message === 'Merge branch feat');
    expect(merge?.parents).toHaveLength(2);
    expect(merge?.lines.length).toBeGreaterThan(0);
    // HEAD ref decorations survived the porcelain round trip.
    expect(commits.some((c) => c.refs.some((r) => r.includes('HEAD -> main')))).toBe(true);
    expect(commits.some((c) => c.refs.some((r) => r.includes('feat')))).toBe(true);
  });

  it('handleGitGetLog honors the limit', async () => {
    const commits = await handleGitGetLog(repo, 2);
    expect(commits).toHaveLength(2);
  });

  it('handleGitGetStatus reports branch, staged and unstaged files', async () => {
    const status = await handleGitGetStatus(repo);
    expect(status.currentBranch).toBe('main');
    expect(status.modifiedFiles.some((f) => f.path === 'new.txt' && f.staged && f.status === 'A')).toBe(true);
    expect(status.modifiedFiles.some((f) => f.path === 'a.txt' && !f.staged && f.status === 'M')).toBe(true);
  });

  it('handleGitGetCommitDiff resolves the per-file diff of a normal commit', async () => {
    // HEAD~1 is the merge's first parent, "main work" — a single-parent commit.
    const diffs = await handleGitGetCommitDiff(repo, git('rev-parse', 'HEAD~1'));
    const modified = diffs.find((d) => d.path === 'a.txt');
    expect(modified?.status).toBe('M');
    expect(modified?.diff).toContain('+two');
  });

  it('handleGitGetCommitDiff never throws on a merge head (matches desktop)', async () => {
    // Desktop's gitService.getCommitDiff runs the same `git show` sequence; on a
    // merge commit that yields no file list without -m. Keep the WebUI surface
    // behaving identically: empty list, not an error.
    const diffs = await handleGitGetCommitDiff(repo, git('rev-parse', 'HEAD'));
    expect(Array.isArray(diffs)).toBe(true);
  });
});
