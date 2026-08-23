/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitExecOptions {
  cwd: string;
  maxBuffer?: number;
  timeout?: number;
}

export interface GitExecResult {
  stdout: string;
  stderr: string;
}

/**
 * 封装安全的 Git CLI 命令调用
 */
export async function execGit(args: string[], options: GitExecOptions): Promise<GitExecResult> {
  const { cwd, maxBuffer = 1024 * 1024 * 10, timeout = 30000 } = options;
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer,
      timeout,
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
