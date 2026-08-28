/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/renderer/components/Markdown/diagrams/diagramExport', () => ({
  copySvgImage: vi.fn().mockResolvedValue(undefined),
  saveDiagramImage: vi.fn().mockResolvedValue(undefined),
  prepareDiagramSvgForExport: vi.fn((svg: string) => Promise.resolve(svg)),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ openPreview: vi.fn() }),
}));

vi.mock('react-syntax-highlighter', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <pre data-testid='echarts-source'>{children}</pre>,
}));
vi.mock('react-syntax-highlighter/dist/esm/styles/hljs', () => ({ vs: {}, vs2015: {} }));

const mockGetDataURL = vi.fn();
const mockGetWidth = vi.fn();
const mockGetHeight = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();

vi.mock('echarts', () => ({
  init: () => ({
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    getDataURL: mockGetDataURL,
    getWidth: mockGetWidth,
    getHeight: mockGetHeight,
    on: mockOn,
    off: mockOff,
  }),
}));

const makeIcon = vi.hoisted(() => (name: string) => () => <span data-icon={name} />);

vi.mock('@icon-park/react', () => ({
  Close: makeIcon('close'),
  ZoomIn: makeIcon('zoom-in'),
  ZoomOut: makeIcon('zoom-out'),
  Refresh: makeIcon('refresh'),
  ArrowLeft: makeIcon('arrow-left'),
  ArrowRight: makeIcon('arrow-right'),
  Copy: makeIcon('copy'),
  Picture: makeIcon('picture'),
  Download: makeIcon('download'),
  Help: makeIcon('help'),
  PreviewOpen: makeIcon('preview-open'),
}));

import EchartsBlock from '@/renderer/components/Markdown/diagrams/EchartsBlock';
import {
  DiagramGalleryProvider,
  useDiagramGallery,
  type DiagramItem,
} from '@/renderer/components/Markdown/diagrams/DiagramGalleryContext';
import { copySvgImage } from '@/renderer/components/Markdown/diagrams/diagramExport';

// jsdom lacks the pointer capture API used by the overlay drag handlers.
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

/** Override window.matchMedia for responsive/touch behavior tests. */
const stubMatchMedia = (queries: Record<string, boolean>) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
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
  vi.useRealTimers();
});

const VALID_CHART_CODE = `
  {
    xAxis: { type: 'category', data: ['Mon', 'Tue'] },
    yAxis: { type: 'value' },
    series: [{ data: [150, 230], type: 'line' }]
  }
`;

/** A second gallery member so the thumbnail strip renders next to the chart. */
function RegisteringBlock({ item }: { item: DiagramItem }) {
  useDiagramGallery(item);
  return <div data-testid='mermaid-registered' />;
}

describe('ECharts gallery integration', () => {
  let finishedCallbacks: Array<() => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stubMatchMedia({});
    finishedCallbacks = [];
    mockOn.mockImplementation((_event: string, callback: () => void) => {
      finishedCallbacks.push(callback);
    });
    mockGetWidth.mockReturnValue(336);
    mockGetHeight.mockReturnValue(336);
    mockGetDataURL.mockReturnValue('data:image/png;base64,AAAA');
  });

  /** Fire every chart's 'finished' event and run the 400ms snapshot debounce. */
  const settleCharts = () => {
    act(() => {
      for (const callback of finishedCallbacks) callback();
      vi.advanceTimersByTime(400);
    });
  };

  it('registers every chart eagerly and opens the gallery on header double-click', () => {
    render(
      <DiagramGalleryProvider>
        <RegisteringBlock item={{ id: 'mermaid-one', svg: '<svg viewBox="0 0 100 100"></svg>', type: 'mermaid' }} />
        <EchartsBlock code={VALID_CHART_CODE} />
      </DiagramGalleryProvider>
    );
    settleCharts();

    expect(mockGetDataURL).toHaveBeenCalledTimes(1);
    expect(mockGetDataURL).toHaveBeenCalledWith({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });

    fireEvent.doubleClick(screen.getByTestId('echarts-header'));
    expect(screen.getByTestId('diagram-zoom-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('diagram-gallery-header')).toHaveTextContent('preview.echartsTitle');
    // Both the mermaid item and the eagerly registered chart are in the strip.
    expect(screen.getAllByTestId('diagram-gallery-thumb')).toHaveLength(2);
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('2');
  });

  it('snapshots with dark background when isDark is true', () => {
    render(
      <DiagramGalleryProvider>
        <EchartsBlock code={VALID_CHART_CODE} isDark={true} />
      </DiagramGalleryProvider>
    );
    settleCharts();

    expect(mockGetDataURL).toHaveBeenCalledTimes(1);
    expect(mockGetDataURL).toHaveBeenCalledWith({ type: 'png', pixelRatio: 2, backgroundColor: '#1d2129' });
  });

  it('includes ALL charts in the gallery stream, not only the opened one', () => {
    render(
      <DiagramGalleryProvider>
        <EchartsBlock code={VALID_CHART_CODE} />
        <EchartsBlock code={`${VALID_CHART_CODE}\n// second chart`} />
        <EchartsBlock code={`${VALID_CHART_CODE}\n// third chart`} />
      </DiagramGalleryProvider>
    );
    settleCharts();
    expect(mockGetDataURL).toHaveBeenCalledTimes(3);

    fireEvent.doubleClick(screen.getAllByTestId('echarts-header')[0]);
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('1');
    expect(screen.getAllByTestId('diagram-gallery-thumb')).toHaveLength(3);
  });

  it('re-snapshots when the source changed', () => {
    const { rerender } = render(
      <DiagramGalleryProvider>
        <EchartsBlock code={VALID_CHART_CODE} />
      </DiagramGalleryProvider>
    );
    settleCharts();
    expect(mockGetDataURL).toHaveBeenCalledTimes(1);

    rerender(
      <DiagramGalleryProvider>
        <EchartsBlock code={`${VALID_CHART_CODE}\n// changed`} />
      </DiagramGalleryProvider>
    );
    settleCharts();
    expect(mockGetDataURL).toHaveBeenCalledTimes(2);
  });

  it('flows the chart snapshot through the overlay copy-image action', () => {
    render(
      <DiagramGalleryProvider>
        <EchartsBlock code={VALID_CHART_CODE} />
      </DiagramGalleryProvider>
    );
    settleCharts();

    fireEvent.doubleClick(screen.getByTestId('echarts-header'));
    fireEvent.click(screen.getByTestId('diagram-overlay-copy-image'));

    expect(copySvgImage).toHaveBeenCalledTimes(1);
    const copiedSvg = (copySvgImage as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(copiedSvg).toContain('viewBox="0 0 672 672"');
    expect(copiedSvg).toContain('<image');
  });

  it('opens a local single-diagram overlay without a provider (on-demand fallback)', () => {
    render(<EchartsBlock code={VALID_CHART_CODE} />);

    // No settle: the first double-click snapshots on demand.
    fireEvent.doubleClick(screen.getByTestId('echarts-header'));
    expect(mockGetDataURL).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('diagram-zoom-overlay')).toBeInTheDocument();
    // No gallery chrome: single diagram, no nav/counter/thumbs.
    expect(screen.queryByTestId('diagram-gallery-prev')).toBeNull();
    expect(screen.queryByTestId('diagram-gallery-counter')).toBeNull();
    expect(screen.getByTestId('diagram-zoom-content').innerHTML).toContain('data:image/png;base64,AAAA');
  });
});
