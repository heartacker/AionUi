/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execGit } from './gitExecutor';
import type { ParsedCommit } from './gitGraphParser';
import { calculateLanes, parseRawGitLogLine } from './gitGraphParser';

export type GitStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | 'T' | '?';

export interface GitStatusSummary {
  currentBranch: string;
  trackingBranch?: string;
  ahead: number;
  behind: number;
  modifiedFiles: Array<{
    path: string;
    status: GitStatusCode;
    staged: boolean;
  }>;
}

// Porcelain v1 single-letter codes (incl. 'T' typechange); anything unexpected
// collapses to '?' so the typed union never lies about runtime data.
const SCM_STATUS_CODES = new Set<string>(['M', 'A', 'D', 'R', 'C', 'U', 'T']);
const scmStatusCode = (code: string): GitStatusCode => (SCM_STATUS_CODES.has(code) ? (code as GitStatusCode) : '?');

export interface GitFileDiff {
  path: string;
  oldPath?: string;
  status: string;
  diff: string;
}

export class GitService {
  /**
   * 获取仓库的提交拓扑图数据
   */
  public static async getLog(repoPath: string, limit = 200): Promise<ParsedCommit[]> {
    const format = '%H|%P|%an|%ae|%at|%s%d';
    const args = ['log', '--all', '--date-order', `--format=${format}`, `-n`, String(limit)];
    const { stdout } = await execGit(args, { cwd: repoPath });
    if (!stdout) return [];

    const lines = stdout.split('\n');
    const rawEntries = lines.map((l) => parseRawGitLogLine(l)).filter((e): e is NonNullable<typeof e> => e !== null);

    return calculateLanes(rawEntries);
  }

  /**
   * 获取工作区与分支状态
   */
  public static async getStatus(repoPath: string): Promise<GitStatusSummary> {
    const { stdout: branchOut } = await execGit(['branch', '--show-current'], { cwd: repoPath });
    const currentBranch = branchOut.trim() || 'HEAD (detached)';

    const { stdout: statusOut } = await execGit(['status', '--porcelain=v1', '-b'], { cwd: repoPath });
    const lines = statusOut.split('\n').filter(Boolean);

    let trackingBranch: string | undefined;
    let ahead = 0;
    let behind = 0;
    const modifiedFiles: GitStatusSummary['modifiedFiles'] = [];

    for (const line of lines) {
      if (line.startsWith('## ')) {
        const branchHeader = line.slice(3);
        const match = branchHeader.match(/.*?\.{3}(.+?)(?:\s+\[(?:ahead\s+(\d+))?(?:,\s*)?(?:behind\s+(\d+))?\])?$/);
        if (match) {
          trackingBranch = match[1];
          ahead = match[2] ? parseInt(match[2], 10) : 0;
          behind = match[3] ? parseInt(match[3], 10) : 0;
        }
        continue;
      }

      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filePath = line.slice(3).trim();

      if (indexStatus !== ' ' && indexStatus !== '?') {
        modifiedFiles.push({
          path: filePath,
          status: scmStatusCode(indexStatus),
          staged: true,
        });
      }
      if (workTreeStatus !== ' ') {
        modifiedFiles.push({
          path: filePath,
          status: scmStatusCode(workTreeStatus === '?' ? '?' : workTreeStatus),
          staged: false,
        });
      }
    }

    return {
      currentBranch,
      trackingBranch,
      ahead,
      behind,
      modifiedFiles,
    };
  }

  /**
   * 获取指定 Commit 的修改详情与差异
   */
  public static async getCommitDiff(repoPath: string, hash: string): Promise<GitFileDiff[]> {
    const { stdout: nameStatusOut } = await execGit(['show', '--name-status', '--oneline', hash], { cwd: repoPath });
    const lines = nameStatusOut.split('\n').slice(1).filter(Boolean);
    if (lines.length === 0) return [];

    // Per-file diffs are independent, so they run in parallel — a wide commit
    // used to pay N sequential git process startups. Promise.all preserves the
    // name-status order in the result.
    const entries = lines.map((line) => {
      const parts = line.split('\t');
      const status = parts[0];
      const oldPath = parts.length > 2 ? parts[1] : undefined;
      const finalPath = parts.length > 2 ? parts[2] : parts[1];
      return { status, path: finalPath, oldPath };
    });

    return Promise.all(
      entries.map(async ({ status, path: finalPath, oldPath }) => {
        const { stdout: diffContent } = await execGit(['show', `${hash}`, '--', finalPath], { cwd: repoPath });
        return { path: finalPath, oldPath, status, diff: diffContent };
      })
    );
  }

  /**
   * 切换分支
   */
  public static async checkout(repoPath: string, branchName: string): Promise<{ success: boolean; message: string }> {
    const { stdout, stderr } = await execGit(['checkout', branchName], { cwd: repoPath });
    return {
      success: true,
      message: stdout || stderr,
    };
  }
}
