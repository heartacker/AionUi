/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { GitService } from '@process/services/git/gitService';

export function initGitBridge(): void {
  ipcBridge.git.getLog.provider(async ({ repoPath, limit }) => {
    try {
      const commits = await GitService.getLog(repoPath, limit);
      return { success: true, data: commits };
    } catch (e: unknown) {
      return { success: false, msg: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcBridge.git.getStatus.provider(async ({ repoPath }) => {
    try {
      const status = await GitService.getStatus(repoPath);
      return { success: true, data: status };
    } catch (e: unknown) {
      return { success: false, msg: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcBridge.git.getCommitDiff.provider(async ({ repoPath, hash }) => {
    try {
      const diffs = await GitService.getCommitDiff(repoPath, hash);
      return { success: true, data: diffs };
    } catch (e: unknown) {
      return { success: false, msg: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcBridge.git.checkout.provider(async ({ repoPath, branchName }) => {
    try {
      const res = await GitService.checkout(repoPath, branchName);
      return { success: true, data: res };
    } catch (e: unknown) {
      return { success: false, msg: e instanceof Error ? e.message : String(e) };
    }
  });
}
