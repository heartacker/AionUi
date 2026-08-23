/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import type { ParsedCommit } from '@process/services/git/gitGraphParser';

interface GitGraphCanvasProps {
  commits: ParsedCommit[];
  rowHeight?: number;
  laneWidth?: number;
}

const LANE_COLORS = [
  '#165DFF', // Blue
  '#00B42A', // Green
  '#F77234', // Orange
  '#F53F3F', // Red
  '#722ED1', // Purple
  '#D91AD9', // Magenta
  '#0FC6C2', // Cyan
  '#FF7D00', // Amber
];

export const GitGraphCanvas: React.FC<GitGraphCanvasProps> = ({ commits, rowHeight = 36, laneWidth = 16 }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const maxLane = Math.max(...commits.map((c) => Math.max(c.lane, ...c.lines.map((l) => l.toLane))), 0);
  const width = Math.max((maxLane + 2) * laneWidth, 48);
  const height = commits.length * rowHeight;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 清空画布
    ctx.clearRect(0, 0, width, height);

    // 绘制连线
    commits.forEach((commit, index) => {
      const y = index * rowHeight + rowHeight / 2;
      const x = commit.lane * laneWidth + laneWidth / 2;
      const color = LANE_COLORS[commit.lane % LANE_COLORS.length];

      // 绘制到父节点的连线
      commit.lines.forEach((line) => {
        const parentX = line.toLane * laneWidth + laneWidth / 2;
        const parentY = y + rowHeight;
        const lineColor = LANE_COLORS[line.colorIndex % LANE_COLORS.length];

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);

        if (x === parentX) {
          ctx.lineTo(parentX, parentY);
        } else {
          // 贝塞尔曲线平滑连接分支
          ctx.bezierCurveTo(x, y + rowHeight / 2, parentX, parentY - rowHeight / 2, parentX, parentY);
        }
        ctx.stroke();
      });

      // 绘制提交节点小圆圈
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();

      // 外描边
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }, [commits, rowHeight, laneWidth, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: 'block',
      }}
    />
  );
};
