/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Space, Spin, Message, Empty } from '@arco-design/web-react';
import { BranchTwo, FolderCodeOne, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ParsedCommit } from '@process/services/git/gitGraphParser';
import type { GitStatusSummary } from '@process/services/git/gitService';
import { GitCommitList } from './GitCommitList';
import { GitDiffDrawer } from './GitDiffDrawer';

interface GitViewProps {
  initialRepoPath?: string;
}

export const GitView: React.FC<GitViewProps> = ({ initialRepoPath = '.' }) => {
  const { t } = useTranslation();
  const [repoPath, setRepoPath] = useState(initialRepoPath);
  const [loading, setLoading] = useState(false);
  const [commits, setCommits] = useState<ParsedCommit[]>([]);
  const [status, setStatus] = useState<GitStatusSummary | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<ParsedCommit | null>(null);
  const [filterText, setFilterText] = useState('');

  useEffect(() => {
    if (initialRepoPath && initialRepoPath !== repoPath) {
      setRepoPath(initialRepoPath);
    }
  }, [initialRepoPath]);

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
        Message.error(logRes.msg || t('conversation.explorer.git.loadLogFailed'));
      }

      if (statusRes.success && statusRes.data) {
        setStatus(statusRes.data);
      }
    } catch (err: unknown) {
      Message.error(err instanceof Error ? err.message : t('conversation.explorer.git.readRepoFailed'));
    } finally {
      setLoading(false);
    }
  }, [repoPath, t]);

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
    <div className='flex flex-col h-full w-full bg-[var(--color-bg-1)] p-4 overflow-hidden'>
      {/* 顶部工具栏 */}
      <div className='flex items-center justify-between pb-3 mb-3 border-b border-[var(--color-border-1)]'>
        <Space size='medium'>
          <Input
            prefix={<FolderCodeOne theme='outline' size='16' />}
            value={repoPath}
            placeholder={t('conversation.explorer.git.repoPathPlaceholder')}
            onChange={setRepoPath}
            onPressEnter={loadData}
            style={{ width: 280 }}
          />

          {status && (
            <div className='flex items-center gap-2 text-13px text-t-secondary'>
              <BranchTwo theme='outline' size='16' fill='var(--color-primary-6)' />
              <span className='font-semibold'>{status.currentBranch}</span>
              {status.trackingBranch && (
                <span className='text-t-tertiary text-12px'>
                  {t('conversation.explorer.git.aheadBehind', { ahead: status.ahead, behind: status.behind })}
                </span>
              )}
            </div>
          )}
        </Space>

        <Space>
          <Input.Search
            placeholder={t('conversation.explorer.git.filterCommitsPlaceholder')}
            value={filterText}
            onChange={setFilterText}
            style={{ width: 220 }}
            allowClear
          />
          <Button icon={<Refresh theme='outline' size='16' />} loading={loading} onClick={loadData}>
            {t('conversation.explorer.git.refresh')}
          </Button>
        </Space>
      </div>

      {/* 提交图谱与列表 */}
      <div className='flex-1 overflow-y-auto'>
        <Spin loading={loading} style={{ width: '100%', minHeight: 200 }}>
          {filteredCommits.length > 0 ? (
            <GitCommitList commits={filteredCommits} onSelectCommit={setSelectedCommit} />
          ) : (
            !loading && <Empty description={t('conversation.explorer.git.noCommits')} className='mt-20' />
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
