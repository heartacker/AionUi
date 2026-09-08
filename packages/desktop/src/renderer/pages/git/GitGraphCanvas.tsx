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

    if (commits.length === 0) return;

    const rowCenterY = (row: number): number => row * rowHeight + rowHeight / 2;
    const lastRowY = rowCenterY(commits.length - 1);

    // First parents inherit their child's lane (see calculateLanes in the main
    // process), so the next commit on the same lane is the parent chain link —
    // the parser only reports *merge* edges in `lines`. Bottom-up pass records,
    // per commit, the nearest lower row still occupying its lane; a lane with no
    // successor (history truncation by the limit) runs its trunk to the bottom.
    const nextSameLaneRow = Array.from({ length: commits.length }, () => -1);
    const nextRowOfLane = new Map<number, number>();
    for (let i = commits.length - 1; i >= 0; i--) {
      const lane = commits[i].lane;
      nextSameLaneRow[i] = nextRowOfLane.get(lane) ?? -1;
      nextRowOfLane.set(lane, i);
    }

    // The lower end of a merge edge is the nearest row on the target lane, not
    // necessarily the immediate next row.
    const nearestRowOnLane = (from: number, lane: number): number => {
      for (let j = from + 1; j < commits.length; j++) {
        if (commits[j].lane === lane) return j;
      }
      return -1;
    };

    // 先绘制连线（主干线 + 合并曲线），再绘制节点，保证圆点盖住经过其下方的线
    // Lines first, dots last, so node circles cover anything passing underneath.
    commits.forEach((commit, i) => {
      const y = rowCenterY(i);
      const x = commit.lane * laneWidth + laneWidth / 2;

      // 主干线：向下一个占用同一泳道的提交（父链）
      // Trunk: vertical line down the parent chain on this lane.
      const nextRow = nextSameLaneRow[i];
      const trunkEndY = nextRow === -1 ? lastRowY : rowCenterY(nextRow);
      if (trunkEndY > y) {
        ctx.strokeStyle = LANE_COLORS[commit.lane % LANE_COLORS.length];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, trunkEndY);
        ctx.stroke();
      }

      // 合并边：贝塞尔曲线连到目标泳道上最近的下方提交
      // Merge edges: bezier curves to the nearest lower commit on each target lane.
      commit.lines.forEach((line) => {
        const parentRow = nearestRowOnLane(i, line.toLane);
        const parentY = parentRow === -1 ? lastRowY : rowCenterY(parentRow);
        const parentX = line.toLane * laneWidth + laneWidth / 2;

        ctx.strokeStyle = LANE_COLORS[line.colorIndex % LANE_COLORS.length];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        // 控制点高度取纵向距离的一半：相邻行时退化为原 rowHeight/2 曲线，
        // 父提交相距多行时平滑拉长为 S 形，避免假设单行间距
        const dy = (parentY - y) / 2;
        ctx.bezierCurveTo(x, y + dy, parentX, parentY - dy, parentX, parentY);
        ctx.stroke();
      });
    });

    // 绘制提交节点小圆圈
    commits.forEach((commit, i) => {
      const y = rowCenterY(i);
      const x = commit.lane * laneWidth + laneWidth / 2;
      ctx.fillStyle = LANE_COLORS[commit.lane % LANE_COLORS.length];
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
