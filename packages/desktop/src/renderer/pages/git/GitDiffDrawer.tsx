/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Drawer, Tree, Typography, Spin, Space, Tag } from '@arco-design/web-react';
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
            <div className='text-12px text-gray-500 font-normal'>
              {commit.hash.slice(0, 8)} • {commit.author} • {new Date(commit.timestamp).toLocaleString()}
            </div>
          </div>
        ) : (
          'Commit Details'
        )
      }
      visible={visible}
      onOk={onClose}
      onCancel={onClose}
      footer={null}
    >
      <Spin loading={loading} style={{ width: '100%', minHeight: 300 }}>
        <div className='flex h-full gap-4'>
          <div className='w-240px border-r border-gray-100 pr-2 overflow-y-auto'>
            <Typography.Text bold className='mb-2 block text-13px'>
              Changed Files ({diffs.length})
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
          <div className='flex-1 overflow-auto bg-gray-50 p-3 rounded text-12px font-mono whitespace-pre-wrap'>
            {selectedFile ? (
              selectedFile.diff || 'No text changes in this file.'
            ) : (
              <div className='text-gray-400 text-center mt-20'>Select a file to view Diff</div>
            )}
          </div>
        </div>
      </Spin>
    </Drawer>
  );
};
