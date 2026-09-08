/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WebUI-mode git execution, invoked by the static server's /api/git/* endpoints.
 *
 * IMPORTANT — keep this module in sync with the desktop main-process
 * implementation in packages/desktop/src/process/services/git/ (gitExecutor.ts,
 * gitGraphParser.ts, gitService.ts). WebUI requests must behave exactly like the
 * native IPC path, so the parsers, lane layout, command arguments and status
 * semantics below are deliberate copies of that code. When changing behavior on
 * one side, change the other side too and extend git-handler.unit.test.ts.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitExecResult {
  stdout: string;
  stderr: string;
}

/**
 * 封装安全的 Git CLI 命令调用(与主进程 gitExecutor.ts 一致)
 * Safe Git CLI invocation (mirrors the main-process gitExecutor.ts)
 */
async function execGit(args: string[], cwd: string): Promise<GitExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
      encoding: 'utf8',
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
      },
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error: unknown) {
    const execErr = error as { message?: string; stderr?: string; code?: number };
    const errorMsg = execErr.stderr || execErr.message || 'Unknown Git error';
    throw new Error(`Git command failed (git ${args.join(' ')}): ${errorMsg}`, { cause: error });
  }
}

export interface ParsedCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number;
  message: string;
  refs: string[];
  lane: number;
  lines: Array<{
    fromLane: number;
    toLane: number;
    colorIndex: number;
  }>;
}

export interface RawGitLogEntry {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number;
  message: string;
  refStr: string;
}

/**
 * 解析 git log 原始行输出(与主进程 gitGraphParser.ts 一致)
 * 格式格式化串: "%H|%P|%an|%ae|%at|%s%d"
 */
export function parseRawGitLogLine(line: string): RawGitLogEntry | null {
  const parts = line.split('|');
  if (parts.length < 6) return null;

  const [hash, parentsStr, author, email, timestampStr, ...rest] = parts;
  const messageAndRefs = rest.join('|');

  let message = messageAndRefs;
  let refStr = '';

  const refMatch = messageAndRefs.match(/ \((.*?)\)$/);
  if (refMatch) {
    refStr = refMatch[1];
    message = messageAndRefs.slice(0, refMatch.index);
  }

  const parents = parentsStr.trim() ? parentsStr.trim().split(' ') : [];
  const timestamp = parseInt(timestampStr, 10) * 1000;

  return {
    hash: hash.trim(),
    parents,
    author: author.trim(),
    email: email.trim(),
    timestamp: isNaN(timestamp) ? Date.now() : timestamp,
    message: message.trim(),
    refStr: refStr.trim(),
  };
}

/**
 * 计算 Commit DAG 分支泳道(Lane Layout)算法(与主进程 gitGraphParser.ts 一致)
 */
export function calculateLanes(rawEntries: RawGitLogEntry[]): ParsedCommit[] {
  const activeLanes: (string | null)[] = [];
  const results: ParsedCommit[] = [];

  for (const entry of rawEntries) {
    // 找到分配给当前 commit 的泳道索引,或者新建泳道
    let laneIndex = activeLanes.indexOf(entry.hash);
    if (laneIndex === -1) {
      laneIndex = activeLanes.indexOf(null);
      if (laneIndex === -1) {
        laneIndex = activeLanes.length;
        activeLanes.push(entry.hash);
      } else {
        activeLanes[laneIndex] = entry.hash;
      }
    }

    const lines: ParsedCommit['lines'] = [];

    // 处理当前 commit 的各个父节点
    if (entry.parents.length === 0) {
      // 根提交,释放泳道
      activeLanes[laneIndex] = null;
    } else {
      // 第一个父节点继承当前泳道
      const firstParent = entry.parents[0];
      activeLanes[laneIndex] = firstParent;

      // 如果有合并提交(Merge commits),为其余父节点分配泳道
      for (let i = 1; i < entry.parents.length; i++) {
        const parent = entry.parents[i];
        let parentLane = activeLanes.indexOf(parent);
        if (parentLane === -1) {
          parentLane = activeLanes.indexOf(null);
          if (parentLane === -1) {
            parentLane = activeLanes.length;
            activeLanes.push(parent);
          } else {
            activeLanes[parentLane] = parent;
          }
        }
        lines.push({
          fromLane: laneIndex,
          toLane: parentLane,
          colorIndex: parentLane % 8,
        });
      }
    }

    // 解析引用的 Branch / Tag
    const refs: string[] = [];
    if (entry.refStr) {
      entry.refStr.split(',').forEach((r) => {
        const cleanRef = r.trim();
        if (cleanRef) refs.push(cleanRef);
      });
    }

    results.push({
      hash: entry.hash,
      parents: entry.parents,
      author: entry.author,
      email: entry.email,
      timestamp: entry.timestamp,
      message: entry.message,
      refs,
      lane: laneIndex,
      lines,
    });
  }

  return results;
}

export interface GitStatusSummary {
  currentBranch: string;
  trackingBranch?: string;
  ahead: number;
  behind: number;
  modifiedFiles: Array<{
    path: string;
    status: string;
    staged: boolean;
  }>;
}

export interface GitFileDiff {
  path: string;
  oldPath?: string;
  status: string;
  diff: string;
}

export async function handleGitGetLog(repoPath: string, limit = 200): Promise<ParsedCommit[]> {
  // 与主进程 GitService.getLog 相同的命令与格式
  const format = '%H|%P|%an|%ae|%at|%s%d';
  const args = ['log', '--all', '--date-order', `--format=${format}`, '-n', String(limit)];
  const { stdout } = await execGit(args, repoPath);

  const lines = stdout.split('\n');
  const rawEntries = lines.map((l) => parseRawGitLogLine(l)).filter((e): e is NonNullable<typeof e> => e !== null);

  return calculateLanes(rawEntries);
}

export async function handleGitGetStatus(repoPath: string): Promise<GitStatusSummary> {
  const { stdout: branchOut } = await execGit(['branch', '--show-current'], repoPath);
  const currentBranch = branchOut.trim() || 'HEAD (detached)';

  const { stdout: statusOut } = await execGit(['status', '--porcelain=v1', '-b'], repoPath);
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
        status: indexStatus,
        staged: true,
      });
    }
    if (workTreeStatus !== ' ') {
      modifiedFiles.push({
        path: filePath,
        status: workTreeStatus === '?' ? '?' : workTreeStatus,
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

export async function handleGitGetCommitDiff(repoPath: string, hash: string): Promise<GitFileDiff[]> {
  // 与主进程 GitService.getCommitDiff 相同的命令序列与并行化策略;hash 已由路由层做 hex 校验
  const { stdout: nameStatusOut } = await execGit(['show', '--name-status', '--oneline', hash], repoPath);
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
      const { stdout: diffContent } = await execGit(['show', `${hash}`, '--', finalPath], repoPath);
      return { path: finalPath, oldPath, status, diff: diffContent };
    })
  );
}
