/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const renderMock = vi.hoisted(() => vi.fn());

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: renderMock },
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ openPreview: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-syntax-highlighter', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <pre data-testid='mermaid-source'>{children}</pre>,
}));
vi.mock('react-syntax-highlighter/dist/esm/styles/hljs', () => ({ vs: {}, vs2015: {} }));

vi.mock('@arco-design/web-react', () => ({
  Message: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

// icon-park icons render as clickable spans that forward data-testid/title/onClick.
const makeIcon = vi.hoisted(
  () =>
    (name: string) =>
    ({
      ['data-testid']: testId,
      title,
      onClick,
    }: {
      ['data-testid']?: string;
      title?: string;
      onClick?: () => void;
    }) => <span data-icon={name} data-testid={testId} title={title} onClick={onClick} />
);

vi.mock('@icon-park/react', () => ({
  Copy: makeIcon('copy'),
  PreviewOpen: makeIcon('preview-open'),
  ZoomIn: makeIcon('zoom-in'),
  ZoomOut: makeIcon('zoom-out'),
  Refresh: makeIcon('refresh'),
  Close: makeIcon('close'),
  Picture: makeIcon('picture'),
  Download: makeIcon('download'),
  Help: makeIcon('help'),
  ArrowLeft: makeIcon('arrow-left'),
  ArrowRight: makeIcon('arrow-right'),
}));

import MermaidBlock from '@/renderer/components/Markdown/diagrams/MermaidBlock';

const stubMatchMedia = (queries: Record<string, boolean>) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query) => ({
      matches: queries[query] ?? false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
};
const originalMatchMedia = window.matchMedia;
afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

// jsdom lacks the pointer capture API used by the drag handlers.
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(Element.prototype, 'hasPointerCapture', {
    value: vi.fn(() => false),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
});

describe('MermaidBlock pan/zoom', () => {
  beforeEach(() => {
    renderMock.mockReset().mockResolvedValue({ svg: '<svg width="120" height="80"></svg>' });
    document.documentElement.setAttribute('data-theme', 'light');
  });

  it('renders a static diagram without zoom controls by default', async () => {
    render(<MermaidBlock code={'graph TD; A-->B'} />);
    const diagram = await screen.findByTestId('mermaid-diagram');
    // Default path scrolls natively and exposes no zoom controls.
    expect(diagram.style.overflowX).toBe('auto');
    expect(screen.queryByTestId('mermaid-zoom-in')).toBeNull();
    expect(screen.queryByTestId('mermaid-zoom-reset')).toBeNull();
  });

  it('shows zoom controls and applies/resets scale when enablePanZoom is set', async () => {
    render(<MermaidBlock code={'graph TD; A-->B'} enablePanZoom />);
    const diagram = await screen.findByTestId('mermaid-diagram');
    // Pan viewport clips (hidden overflow) instead of native scroll.
    expect(diagram.style.overflow).toBe('hidden');

    const inner = diagram.firstElementChild as HTMLElement;
    expect(inner.style.transform).toContain('scale(1)');

    fireEvent.click(screen.getByTestId('mermaid-zoom-in'));
    expect(inner.style.transform).toContain('scale(1.25)');

    fireEvent.click(screen.getByTestId('mermaid-zoom-out'));
    expect(inner.style.transform).toContain('scale(1)');

    fireEvent.click(screen.getByTestId('mermaid-zoom-in'));
    fireEvent.click(screen.getByTestId('mermaid-zoom-reset'));
    expect(inner.style.transform).toContain('translate(0px, 0px) scale(1)');
  });

  it('caps narrow diagrams at their natural width so they render 1:1', async () => {
    renderMock.mockResolvedValue({ svg: '<svg viewBox="0 0 100 200" width="100%"></svg>' });
    render(<MermaidBlock code={'graph TD; A-->B'} />);
    const diagram = await screen.findByTestId('mermaid-diagram');
    expect(diagram.querySelector('svg')?.getAttribute('style')).toContain('max-width: min(100%, 100px)');
  });

  it('caps wide diagrams at the container width', async () => {
    renderMock.mockResolvedValue({ svg: '<svg viewBox="0 0 2000 100" width="100%"></svg>' });
    render(<MermaidBlock code={'graph TD; A-->B'} />);
    const diagram = await screen.findByTestId('mermaid-diagram');
    expect(diagram.querySelector('svg')?.getAttribute('style')).toContain('max-width: min(100%, 2000px)');
  });

  it('opens the zoom overlay when the static diagram is clicked', async () => {
    render(<MermaidBlock code={'graph TD; A-->B'} />);
    const diagram = await screen.findByTestId('mermaid-diagram');
    fireEvent.click(diagram);
    expect(screen.getByTestId('diagram-zoom-overlay')).toBeInTheDocument();
  });

  it('opens the zoom overlay on click without panning when drag-to-pan is enabled', async () => {
    render(<MermaidBlock code={'graph TD; A-->B'} enablePanZoom />);
    const diagram = await screen.findByTestId('mermaid-diagram');

    fireEvent.pointerDown(diagram, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(diagram, { pointerId: 1, clientX: 12, clientY: 11 });
    fireEvent.pointerUp(diagram, { pointerId: 1 });

    const inner = diagram.firstElementChild as HTMLElement;
    expect(inner.style.transform).toContain('translate(0px, 0px) scale(1)');
    // The overlay opens one tick after pointerup so the tap's trailing click
    // lands on the block instead of the overlay backdrop.
    await vi.waitFor(() => expect(screen.getByTestId('diagram-zoom-overlay')).toBeInTheDocument());
  });

  it('does not pan when at default scale, but pans when zoomed in past 1x', async () => {
    render(<MermaidBlock code={'graph TD; A-->B'} enablePanZoom />);
    const diagram = await screen.findByTestId('mermaid-diagram');
    const inner = diagram.firstElementChild as HTMLElement;

    // At default 1x scale: dragging does not pan
    fireEvent.pointerDown(diagram, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(diagram, { pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(diagram, { pointerId: 1 });
    expect(inner.style.transform).toContain('translate(0px, 0px) scale(1)');

    // Zoom in with zoom button
    fireEvent.click(screen.getByTestId('mermaid-zoom-in'));
    expect(inner.style.transform).toContain('scale(1.25)');

    // Now zoomed in: dragging pans the diagram
    fireEvent.pointerDown(diagram, { pointerId: 2, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(diagram, { pointerId: 2, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(diagram, { pointerId: 2 });
    expect(inner.style.transform).toContain('translate(50px, 30px)');
  });
  it('hides the header actions until the block is hovered', async () => {
    stubMatchMedia({});
    render(<MermaidBlock code={'graph TD; A-->B'} enablePanZoom />);
    await screen.findByTestId('mermaid-diagram');
    const actions = screen.getByTestId('mermaid-header');
    expect(actions.style.opacity).toBe('0');
    const root = screen.getByTestId('mermaid-header').parentElement?.parentElement as HTMLElement;
    fireEvent.mouseEnter(root);
    expect(actions.style.opacity).toBe('1');
    fireEvent.mouseLeave(root);
    expect(actions.style.opacity).toBe('0');
  });

  it('opens the gallery when the header is double-clicked', async () => {
    stubMatchMedia({});
    render(<MermaidBlock code={'graph TD; A-->B'} enablePanZoom />);
    await screen.findByTestId('mermaid-diagram');
    fireEvent.doubleClick(screen.getByTestId('mermaid-header'));
    await vi.waitFor(() => expect(screen.getByTestId('diagram-zoom-overlay')).toBeInTheDocument());
  });

  it('does not open the gallery when a toggle or button is double-clicked', async () => {
    stubMatchMedia({});
    render(<MermaidBlock code={'graph TD; A-->B'} enablePanZoom />);
    await screen.findByTestId('mermaid-diagram');
    fireEvent.doubleClick(screen.getByTestId('mermaid-toggle-preview'));
    fireEvent.doubleClick(screen.getByTestId('mermaid-copy'));
    expect(screen.queryByTestId('diagram-zoom-overlay')).toBeNull();
  });
});
