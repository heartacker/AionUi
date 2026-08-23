/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

vi.mock('echarts', () => ({
  init: () => ({
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    getDataURL: mockGetDataURL,
    getWidth: mockGetWidth,
    getHeight: mockGetHeight,
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWidth.mockReturnValue(336);
    mockGetHeight.mockReturnValue(336);
    mockGetDataURL.mockReturnValue('data:image/png;base64,AAAA');
    stubMatchMedia({});
  });

  it('snapshots the chart once on header double-click and opens it in the gallery', () => {
    render(
      <DiagramGalleryProvider>
        <RegisteringBlock item={{ id: 'mermaid-one', svg: '<svg viewBox="0 0 100 100"></svg>', type: 'mermaid' }} />
        <EchartsBlock code={VALID_CHART_CODE} />
      </DiagramGalleryProvider>
    );

    fireEvent.doubleClick(screen.getByTestId('echarts-header'));

    expect(mockGetDataURL).toHaveBeenCalledTimes(1);
    expect(mockGetDataURL).toHaveBeenCalledWith({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
    expect(screen.getByTestId('diagram-zoom-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('diagram-gallery-header')).toHaveTextContent('preview.echartsTitle');
    // Both the mermaid item and the chart are in the thumbnail strip.
    expect(screen.getAllByTestId('diagram-gallery-thumb')).toHaveLength(2);
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('2');
  });

  it('reuses the snapshot when reopened and re-snapshots when the source changed', () => {
    const { rerender } = render(
      <DiagramGalleryProvider>
        <EchartsBlock code={VALID_CHART_CODE} />
      </DiagramGalleryProvider>
    );

    fireEvent.doubleClick(screen.getByTestId('echarts-header'));
    expect(screen.getByTestId('diagram-zoom-overlay')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('diagram-overlay-close'));
    expect(screen.queryByTestId('diagram-zoom-overlay')).toBeNull();

    // Second open reuses the snapshot — no new getDataURL call.
    fireEvent.doubleClick(screen.getByTestId('echarts-header'));
    expect(mockGetDataURL).toHaveBeenCalledTimes(1);

    // A changed source re-snapshots.
    rerender(
      <DiagramGalleryProvider>
        <EchartsBlock code={`${VALID_CHART_CODE}\n// changed`} />
      </DiagramGalleryProvider>
    );
    fireEvent.doubleClick(screen.getByTestId('echarts-header'));
    expect(mockGetDataURL).toHaveBeenCalledTimes(2);
  });

  it('flows the chart snapshot through the overlay copy-image action', () => {
    render(
      <DiagramGalleryProvider>
        <EchartsBlock code={VALID_CHART_CODE} />
      </DiagramGalleryProvider>
    );

    fireEvent.doubleClick(screen.getByTestId('echarts-header'));
    fireEvent.click(screen.getByTestId('diagram-overlay-copy-image'));

    expect(copySvgImage).toHaveBeenCalledTimes(1);
    const copiedSvg = (copySvgImage as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(copiedSvg).toContain('viewBox="0 0 672 672"');
    expect(copiedSvg).toContain('<image');
  });

  it('opens a local single-diagram overlay without a provider', () => {
    render(<EchartsBlock code={VALID_CHART_CODE} />);

    fireEvent.doubleClick(screen.getByTestId('echarts-header'));
    expect(screen.getByTestId('diagram-zoom-overlay')).toBeInTheDocument();
    // No gallery chrome: single diagram, no nav/counter/thumbs.
    expect(screen.queryByTestId('diagram-gallery-prev')).toBeNull();
    expect(screen.queryByTestId('diagram-gallery-counter')).toBeNull();
    expect(screen.getByTestId('diagram-zoom-content').innerHTML).toContain('data:image/png;base64,AAAA');
  });
});
