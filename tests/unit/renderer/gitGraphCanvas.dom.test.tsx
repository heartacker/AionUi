/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Locks in GitGraphCanvas' line drawing. jsdom has no real 2D canvas, so the
 * test stubs HTMLCanvasElement#getContext with a recording context and asserts
 * on the emitted path operations.
 *
 * The parser (calculateLanes in the main process) only reports *merge* edges in
 * `commit.lines` — first-parent chains are expressed by lane ownership. The
 * canvas therefore must draw per-lane vertical trunks down to the next row that
 * still occupies the lane, otherwise every linear-history commit renders as an
 * isolated dot. Topology rows below mirror what the parser emits for a
 * `main --merge feat` history (commit timestamps: merge > main work > feat work
 * > first):
 *
 *   row0 merge     lane 0, lines -> feat lane 1
 *   row1 main work lane 0
 *   row2 feat work lane 1
 *   row3 first     lane 0
 */

import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { GitGraphCanvas } from '@/renderer/pages/git/GitGraphCanvas';
import type { ParsedCommit } from '@process/services/git/gitGraphParser';

type CtxCall = { name: string; args: unknown[] };

const rowHeight = 36;
const laneWidth = 16;
const rowCenterY = (row: number): number => row * rowHeight + rowHeight / 2;
const laneX = (lane: number): number => lane * laneWidth + laneWidth / 2;

// Split the call log into the ops of each stroked path (every stroke() seals one).
const collectPaths = (log: CtxCall[]): CtxCall[][] => {
  const paths: CtxCall[][] = [];
  let current: CtxCall[] = [];
  for (const call of log) {
    if (call.name === 'stroke') {
      paths.push(current);
      current = [];
    } else {
      current.push(call);
    }
  }
  return paths;
};

const hasVertical = (path: CtxCall[], fromRow: number, toRow: number, lane: number): boolean => {
  const x = laneX(lane);
  return (
    path.some((c) => c.name === 'moveTo' && c.args[0] === x && c.args[1] === rowCenterY(fromRow)) &&
    path.some((c) => c.name === 'lineTo' && c.args[0] === x && c.args[1] === rowCenterY(toRow))
  );
};

// bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) — the endpoint is the last pair.
const hasBezierTo = (path: CtxCall[], lane: number, row: number): boolean =>
  path.some((c) => c.name === 'bezierCurveTo' && c.args[4] === laneX(lane) && c.args[5] === rowCenterY(row));

// Literal commits shaped like parser output; the canvas only consumes lane/lines.
const commit = (lane: number, lines: ParsedCommit['lines'] = []): ParsedCommit => ({
  hash: Math.random().toString(36).slice(2),
  parents: [],
  author: 'A',
  email: 'a@e',
  timestamp: 0,
  message: 'm',
  refs: [],
  lane,
  lines,
});

let ctxLog: CtxCall[];

beforeEach(() => {
  ctxLog = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    beginPath: vi.fn(() => ctxLog.push({ name: 'beginPath', args: [] })),
    moveTo: vi.fn((x: number, y: number) => ctxLog.push({ name: 'moveTo', args: [x, y] })),
    lineTo: vi.fn((x: number, y: number) => ctxLog.push({ name: 'lineTo', args: [x, y] })),
    bezierCurveTo: vi.fn((...args: number[]) => ctxLog.push({ name: 'bezierCurveTo', args })),
    arc: vi.fn((...args: number[]) => ctxLog.push({ name: 'arc', args })),
    fill: vi.fn(() => ctxLog.push({ name: 'fill', args: [] })),
    stroke: vi.fn(() => ctxLog.push({ name: 'stroke', args: [] })),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('connects linear-history commits with vertical trunk lines', () => {
  const commits = [commit(0), commit(0), commit(0)]; // tip -> parent -> root, all lane 0
  render(<GitGraphCanvas commits={commits} rowHeight={rowHeight} laneWidth={laneWidth} />);

  const paths = collectPaths(ctxLog);
  // Rows 0->1 and 1->2 each carry a vertical trunk; the root (row 2, lane ends)
  // draws nothing because its trunk would be zero-length.
  const verticals = paths.filter((p) => p.some((c) => c.name === 'lineTo'));
  expect(verticals).toHaveLength(2);
  expect(verticals.some((p) => hasVertical(p, 0, 1, 0))).toBe(true);
  expect(verticals.some((p) => hasVertical(p, 1, 2, 0))).toBe(true);
  // A pure linear history has no merge edge, hence no curve.
  expect(paths.some((p) => p.some((c) => c.name === 'bezierCurveTo'))).toBe(false);
});

it('draws trunk segments spanning rows that other lanes interrupt', () => {
  // The parser keeps a lane until the parent chain ends, so main's lane 0 is
  // occupied by rows 0, 1 and 3 while feat work (row 2) sits on lane 1.
  const commits = [commit(0, [{ fromLane: 0, toLane: 1, colorIndex: 1 }]), commit(0), commit(1), commit(0)];
  render(<GitGraphCanvas commits={commits} rowHeight={rowHeight} laneWidth={laneWidth} />);

  const verticals = collectPaths(ctxLog).filter((p) => p.some((c) => c.name === 'lineTo'));
  // Row 1's trunk must run down to row 3, skipping the intermediate lane-1 row.
  expect(verticals.some((p) => hasVertical(p, 1, 3, 0))).toBe(true);
  // The lane-1 commit (row 2) has no successor on its lane, so it ends at the bottom.
  expect(verticals.some((p) => hasVertical(p, 2, 3, 1))).toBe(true);
});

it('ends merge curves on the parent row instead of the row right below', () => {
  const commits = [
    commit(0, [{ fromLane: 0, toLane: 1, colorIndex: 1 }]),
    commit(0),
    commit(1), // feat work: the merged parent, two rows below the merge
    commit(0),
  ];
  render(<GitGraphCanvas commits={commits} rowHeight={rowHeight} laneWidth={laneWidth} />);

  const paths = collectPaths(ctxLog);
  const bezier = paths.find((p) => p.some((c) => c.name === 'bezierCurveTo'));
  expect(bezier).toBeDefined();
  expect(bezier!.some((c) => c.name === 'moveTo' && c.args[0] === laneX(0) && c.args[1] === rowCenterY(0))).toBe(true);
  expect(hasBezierTo(bezier!, 1, 2)).toBe(true);
});

it('renders a node dot for every commit', () => {
  const commits = [commit(0), commit(0)];
  render(<GitGraphCanvas commits={commits} rowHeight={rowHeight} laneWidth={laneWidth} />);

  const dots = collectPaths(ctxLog).filter((p) => p.some((c) => c.name === 'arc'));
  expect(dots).toHaveLength(2);
});

it('renders nothing for an empty commit list', () => {
  const { container } = render(<GitGraphCanvas commits={[]} rowHeight={rowHeight} laneWidth={laneWidth} />);
  expect(container.querySelector('canvas')).not.toBeNull();
  expect(ctxLog.filter((c) => c.name === 'stroke')).toHaveLength(0);
});
