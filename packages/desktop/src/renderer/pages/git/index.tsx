/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Select, Space, Spin, Message, Empty } from '@arco-design/web-react';
import { IconRefresh, IconBranch, IconFolder } from '@arco-design/web-react/icon';
import { ipcBridge } from '@/common';
import type { ParsedCommit } from '@process/services/git/gitGraphParser';
import type { GitStatusSummary } from '@process/services/git/gitService';
import { GitCommitList } from './GitCommitList';
import { GitDiffDrawer } from './GitDiffDrawer';

interface GitViewProps {
  initialRepoPath?: string;
}

export const GitView: React.FC<GitViewProps> = ({ initialRepoPath = '.' }) => {
  const [repoPath, setRepoPath] = useState(initialRepoPath);
  const [loading, setLoading] = useState(false);
  const [commits, setCommits] = useState<ParsedCommit[]>([]);
  const [status, setStatus] = useState<GitStatusSummary | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<ParsedCommit | null>(null);
  const [filterText, setFilterText] = useState('');

  const loadData = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    try {
      const [logRes, statusRes] = await Promise.all([
        ipcBridge.git.getLog.invoke({ repoPath, limit: 150 }),
        ipcBridge.git.getStatus.invoke({ repoPath }),
      ]);

      if (logRes.success && logRes.data) {
        setCommits(logRes.data);
      } else {
        Message.error(logRes.msg || 'Failed to load git log');
      }

      if (statusRes.success && statusRes.data) {
        setStatus(statusRes.data);
      }
    } catch (err: unknown) {
      Message.error(err instanceof Error ? err.message : 'Error reading git repository');
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredCommits = commits.filter(
    (c) =>
      c.message.toLowerCase().includes(filterText.toLowerCase()) ||
      c.author.toLowerCase().includes(filterText.toLowerCase()) ||
      c.hash.startsWith(filterText.toLowerCase())
  );

  return (
    <div className='flex flex-col h-full w-full bg-white dark:bg-[#1e1e20] p-4 overflow-hidden'>
      {/* 顶部工具栏 */}
      <div className='flex items-center justify-between pb-3 mb-3 border-b border-gray-100 dark:border-gray-800'>
        <Space size='medium'>
          <Input
            prefix={<IconFolder />}
            value={repoPath}
            placeholder='Repository Path'
            onChange={setRepoPath}
            onPressEnter={loadData}
            style={{ width: 280 }}
          />

          {status && (
            <div className='flex items-center gap-2 text-13px text-gray-600 dark:text-gray-300'>
              <IconBranch className='text-blue-500' />
              <span className='font-semibold'>{status.currentBranch}</span>
              {status.trackingBranch && (
                <span className='text-gray-400 text-12px'>
                  (ahead {status.ahead}, behind {status.behind})
                </span>
              )}
            </div>
          )}
        </Space>

        <Space>
          <Input.Search
            placeholder='Filter commits...'
            value={filterText}
            onChange={setFilterText}
            style={{ width: 220 }}
            allowClear
          />
          <Button icon={<IconRefresh />} loading={loading} onClick={loadData}>
            Refresh
          </Button>
        </Space>
      </div>

      {/* 提交图谱与列表 */}
      <div className='flex-1 overflow-y-auto'>
        <Spin loading={loading} style={{ width: '100%', minHeight: 200 }}>
          {filteredCommits.length > 0 ? (
            <GitCommitList commits={filteredCommits} onSelectCommit={setSelectedCommit} />
          ) : (
            !loading && <Empty description='No commits found' className='mt-20' />
          )}
        </Spin>
      </div>

      {/* 提交差异抽屉 */}
      <GitDiffDrawer
        visible={Boolean(selectedCommit)}
        repoPath={repoPath}
        commit={selectedCommit}
        onClose={() => setSelectedCommit(null)}
      />
    </div>
  );
};

export default GitView;
