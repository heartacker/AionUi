/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

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
 * 解析 git log 原始行输出
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
 * 计算 Commit DAG 分支泳道 (Lane Layout) 算法
 */
export function calculateLanes(rawEntries: RawGitLogEntry[]): ParsedCommit[] {
  const activeLanes: (string | null)[] = [];
  const results: ParsedCommit[] = [];

  for (const entry of rawEntries) {
    // 找到分配给当前 commit 的泳道索引，或者新建泳道
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
      // 根提交，释放泳道
      activeLanes[laneIndex] = null;
    } else {
      // 第一个父节点继承当前泳道
      const firstParent = entry.parents[0];
      activeLanes[laneIndex] = firstParent;

      // 如果有合并提交 (Merge commits)，为其余父节点分配泳道
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
