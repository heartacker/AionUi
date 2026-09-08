/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Drawer, Tree, Typography, Spin, Space, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ParsedCommit } from '@process/services/git/gitGraphParser';
import type { GitFileDiff } from '@process/services/git/gitService';

interface GitDiffDrawerProps {
  visible: boolean;
  repoPath: string;
  commit: ParsedCommit | null;
  onClose: () => void;
}

export const GitDiffDrawer: React.FC<GitDiffDrawerProps> = ({ visible, repoPath, commit, onClose }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [diffs, setDiffs] = useState<GitFileDiff[]>([]);
  const [selectedFile, setSelectedFile] = useState<GitFileDiff | null>(null);

  useEffect(() => {
    if (!visible || !commit) {
      setDiffs([]);
      setSelectedFile(null);
      return;
    }

    setLoading(true);
    ipcBridge.git.getCommitDiff
      .invoke({ repoPath, hash: commit.hash })
      .then((res) => {
        if (res.success && res.data) {
          setDiffs(res.data);
          if (res.data.length > 0) {
            setSelectedFile(res.data[0]);
          }
        }
      })
      .catch(() => {
        // Keep the drawer in its empty state; errors here are already reported
        // by the shared git log load above.
      })
      .finally(() => {
        setLoading(false);
      });
  }, [visible, repoPath, commit]);

  const treeData = diffs.map((d) => ({
    title: (
      <Space>
        <Tag size='small' color={d.status === 'A' ? 'green' : d.status === 'D' ? 'red' : 'gold'}>
          {d.status}
        </Tag>
        <span className='text-13px'>{d.path}</span>
      </Space>
    ),
    key: d.path,
  }));

  return (
    <Drawer
      width={720}
      title={
        commit ? (
          <div>
            <div className='font-semibold text-15px'>{commit.message}</div>
            <div className='text-12px text-t-tertiary font-normal'>
              {commit.hash.slice(0, 8)} • {commit.author} • {new Date(commit.timestamp).toLocaleString()}
            </div>
          </div>
        ) : (
          t('conversation.explorer.git.commitDetails')
        )
      }
      visible={visible}
      onOk={onClose}
      onCancel={onClose}
      footer={null}
    >
      <Spin loading={loading} style={{ width: '100%', minHeight: 300 }}>
        <div className='flex h-full gap-4'>
          <div className='w-240px border-r border-[var(--color-border-1)] pr-2 overflow-y-auto'>
            <Typography.Text bold className='mb-2 block text-13px'>
              {t('conversation.explorer.git.changedFiles', { count: diffs.length })}
            </Typography.Text>
            <Tree
              treeData={treeData}
              selectedKeys={selectedFile ? [selectedFile.path] : []}
              onSelect={([key]) => {
                const found = diffs.find((d) => d.path === key);
                if (found) setSelectedFile(found);
              }}
            />
          </div>
          <div className='flex-1 overflow-auto bg-[var(--color-fill-1)] p-3 rounded text-12px font-mono whitespace-pre-wrap'>
            {selectedFile ? (
              selectedFile.diff || t('conversation.explorer.git.noTextChanges')
            ) : (
              <div className='text-t-tertiary text-center mt-20'>
                {t('conversation.explorer.git.selectFileToViewDiff')}
              </div>
            )}
          </div>
        </div>
      </Spin>
    </Drawer>
  );
};
