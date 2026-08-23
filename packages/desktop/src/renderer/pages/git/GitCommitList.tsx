/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tag, Typography } from '@arco-design/web-react';
import type { ParsedCommit } from '@process/services/git/gitGraphParser';
import { GitGraphCanvas } from './GitGraphCanvas';

interface GitCommitListProps {
  commits: ParsedCommit[];
  onSelectCommit: (commit: ParsedCommit) => void;
  rowHeight?: number;
}

export const GitCommitList: React.FC<GitCommitListProps> = ({ commits, onSelectCommit, rowHeight = 36 }) => {
  return (
    <div className='flex w-full overflow-x-auto relative'>
      {/* 左侧拓扑连线 */}
      <div className='shrink-0 bg-transparent z-10 pointer-events-none'>
        <GitGraphCanvas commits={commits} rowHeight={rowHeight} />
      </div>

      {/* 右侧提交信息列表 */}
      <div className='flex-1 min-w-500px flex flex-col'>
        {commits.map((commit) => (
          <div
            key={commit.hash}
            onClick={() => onSelectCommit(commit)}
            style={{ height: `${rowHeight}px` }}
            className='flex items-center gap-3 px-3 hover:bg-gray-100/70 cursor-pointer border-b border-gray-50 text-13px transition-colors select-none'
          >
            {/* 分支与标签 Tag */}
            {commit.refs.length > 0 && (
              <div className='flex gap-1 shrink-0'>
                {commit.refs.map((ref) => (
                  <Tag
                    key={ref}
                    size='small'
                    color={ref.includes('HEAD') ? 'arcoblue' : ref.startsWith('tag:') ? 'purple' : 'green'}
                  >
                    {ref}
                  </Tag>
                ))}
              </div>
            )}

            {/* 提交信息 */}
            <Typography.Text ellipsis className='flex-1 font-medium text-gray-800'>
              {commit.message}
            </Typography.Text>

            {/* 作者 */}
            <span className='text-12px text-gray-400 shrink-0 w-80px truncate text-right'>{commit.author}</span>

            {/* 日期 */}
            <span className='text-12px text-gray-400 shrink-0 w-110px text-right'>
              {new Date(commit.timestamp).toLocaleDateString()}
            </span>

            {/* Commit Hash */}
            <span className='text-12px font-mono text-gray-400 shrink-0 w-65px text-right'>
              {commit.hash.slice(0, 7)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
