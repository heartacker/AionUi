/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GitView } from '@/renderer/pages/git';

interface GitGraphViewerProps {
  repoPath?: string;
}

export const GitGraphViewer: React.FC<GitGraphViewerProps> = ({ repoPath = '.' }) => {
  return (
    <div className='w-full h-full flex flex-col min-h-0 bg-[var(--color-bg-1)]'>
      <GitView initialRepoPath={repoPath} />
    </div>
  );
};

export default GitGraphViewer;
