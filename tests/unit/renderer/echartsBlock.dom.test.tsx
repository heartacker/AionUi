import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EchartsBlock, {
  buildChartSnapshotSvg,
  parseEChartsOption,
} from '@/renderer/components/Markdown/diagrams/EchartsBlock';

const mockInit = vi.fn();
const mockSetOption = vi.fn();
const mockDispose = vi.fn();
const mockResize = vi.fn();
const mockGetDataURL = vi.fn();
const mockGetWidth = vi.fn();
const mockGetHeight = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();

vi.mock('echarts', () => ({
  init: (...args: unknown[]) => {
    mockInit(...args);
    return {
      setOption: mockSetOption,
      dispose: mockDispose,
      resize: mockResize,
      getDataURL: mockGetDataURL,
      getWidth: mockGetWidth,
      getHeight: mockGetHeight,
      on: mockOn,
      off: mockOff,
    };
  },
}));

/** Override window.matchMedia for touch/hover behavior tests. */
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

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

const mockOpenPreview = vi.fn();
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    openPreview: mockOpenPreview,
    isPreviewPanel: false,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'preview.echartsTitle': 'ECharts Chart',
        'preview.preview': 'Preview',
        'preview.source': 'Source',
        'preview.openInPanelTooltip': 'Open in panel',
        'preview.renderError': 'Render Error',
        'preview.diagramGalleryOpenHint': 'Double-click to open',
        'preview.diagramImageExportFailed': 'Export failed',
        'common.copySuccess': 'Copied',
        'common.copyFailed': 'Copy failed',
      };
      return translations[key] || key;
    },
  }),
}));

describe('parseEChartsOption', () => {
  it('parses valid JSON option', () => {
    const code =
      '{"xAxis": {"type": "category"}, "yAxis": {"type": "value"}, "series": [{"type": "line", "data": [1, 2, 3]}]}';
    const parsed = parseEChartsOption(code);
    expect(parsed).toBeDefined();
    expect(parsed?.xAxis).toEqual({ type: 'category' });
    expect(parsed?.series).toHaveLength(1);
  });

  it('parses JSON5 with comments, unquoted keys and trailing commas', () => {
    const code = `
      // This is a comment
      {
        xAxis: { type: 'category' },
        yAxis: { type: 'value' },
        series: [{ type: 'bar', data: [10, 20], }],
      }
    `;
    const parsed = parseEChartsOption(code);
    expect(parsed).toBeDefined();
    expect(parsed?.series).toHaveLength(1);
  });

  it('strips option = assignment wrapper', () => {
    const code = `
      const option = {
        series: [{ type: 'pie', data: [{ value: 1048, name: 'Search' }] }]
      };
    `;
    const parsed = parseEChartsOption(code);
    expect(parsed).toBeDefined();
    expect(parsed?.series).toHaveLength(1);
  });

  it('returns null for non-chart json', () => {
    const code = '{"name": "test", "version": "1.0.0"}';
    const parsed = parseEChartsOption(code);
    expect(parsed).toBeNull();
  });
});

describe('buildChartSnapshotSvg', () => {
  it('wraps a data URL in an SVG with pixel dimensions for the gallery', () => {
    const svg = buildChartSnapshotSvg('data:image/png;base64,AAAA', 672, 336);
    expect(svg).toContain('width="672"');
    expect(svg).toContain('height="336"');
    expect(svg).toContain('viewBox="0 0 672 336"');
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg).toContain('width="100%" height="100%"');
  });
});

describe('EchartsBlock Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWidth.mockReturnValue(336);
    mockGetHeight.mockReturnValue(336);
    mockGetDataURL.mockReturnValue('data:image/png;base64,AAAA');
  });

  const validChartCode = `
    {
      xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed'] },
      yAxis: { type: 'value' },
      series: [{ data: [150, 230, 224], type: 'line' }]
    }
  `;

  it('renders chart container and initializes echarts', () => {
    render(<EchartsBlock code={validChartCode} isDark={false} />);

    expect(screen.getByTestId('echarts-header')).toBeInTheDocument();
    expect(screen.getByText('<echarts>')).toBeInTheDocument();
    expect(screen.getByTestId('echarts-diagram')).toBeInTheDocument();
    expect(mockInit).toHaveBeenCalled();
    expect(mockSetOption).toHaveBeenCalled();
  });

  it('toggles between diagram and source view', () => {
    render(<EchartsBlock code={validChartCode} isDark={false} />);

    expect(screen.getByTestId('echarts-diagram')).toBeInTheDocument();

    const viewSourceToggle = screen.getByTestId('echarts-toggle-source');
    fireEvent.mouseDown(viewSourceToggle, { button: 0 });

    expect(screen.queryByTestId('echarts-diagram')).not.toBeInTheDocument();

    const viewPreviewToggle = screen.getByTestId('echarts-toggle-preview');
    fireEvent.mouseDown(viewPreviewToggle, { button: 0 });

    expect(screen.getByTestId('echarts-diagram')).toBeInTheDocument();
  });

  it('handles open in panel click', () => {
    render(<EchartsBlock code={validChartCode} isDark={false} />);

    const openPanelBtn = screen.getByTestId('echarts-open-in-panel');
    fireEvent.click(openPanelBtn);

    expect(mockOpenPreview).toHaveBeenCalledWith(
      expect.stringContaining('```echarts'),
      'markdown',
      expect.objectContaining({ title: expect.stringContaining('ECharts Chart') })
    );
  });

  // The block root carries the hover handlers; reach it from the header.
  const getRoot = (): HTMLElement =>
    (screen.getByTestId('echarts-header').parentElement?.parentElement as HTMLElement) ?? document.body;

  it('hides the header actions until the block is hovered', () => {
    stubMatchMedia({});
    render(<EchartsBlock code={validChartCode} isDark={false} />);

    const actions = screen.getByTestId('echarts-header');
    expect(actions.style.opacity).toBe('0');
    expect(actions.style.pointerEvents).toBe('none');

    fireEvent.mouseEnter(getRoot());
    expect(actions.style.opacity).toBe('1');
    expect(actions.style.pointerEvents).toBe('auto');

    fireEvent.mouseLeave(getRoot());
    expect(actions.style.opacity).toBe('0');
  });

  it('reveals the header actions on tap instead of hover on touch devices', () => {
    stubMatchMedia({ '(pointer: coarse)': true });
    render(<EchartsBlock code={validChartCode} isDark={false} />);

    const actions = screen.getByTestId('echarts-header');
    // Hidden by default on touch too — a tap reveals the toolbar.
    expect(actions.style.opacity).toBe('0');

    fireEvent.click(getRoot());
    expect(actions.style.opacity).toBe('1');
    expect(actions.style.pointerEvents).toBe('auto');

    fireEvent.click(getRoot());
    expect(actions.style.opacity).toBe('0');
  });

  it('dismisses the revealed toolbar when tapping outside the block', () => {
    stubMatchMedia({ '(pointer: coarse)': true });
    render(<EchartsBlock code={validChartCode} isDark={false} />);

    fireEvent.click(getRoot());
    expect(screen.getByTestId('echarts-header').style.opacity).toBe('1');

    fireEvent.pointerDown(document.body);
    expect(screen.getByTestId('echarts-header').style.opacity).toBe('0');
  });

  it('does not snapshot when a toggle or action button is double-clicked', () => {
    stubMatchMedia({});
    render(<EchartsBlock code={validChartCode} isDark={false} />);

    fireEvent.doubleClick(screen.getByTestId('echarts-toggle-preview'));
    fireEvent.doubleClick(screen.getByTestId('echarts-copy'));
    expect(mockGetDataURL).not.toHaveBeenCalled();
    expect(screen.queryByTestId('diagram-zoom-overlay')).toBeNull();
  });

  it('does not snapshot in source view (chart instance disposed)', () => {
    stubMatchMedia({});
    render(<EchartsBlock code={validChartCode} isDark={false} />);

    fireEvent.mouseDown(screen.getByTestId('echarts-toggle-source'), { button: 0 });
    fireEvent.doubleClick(screen.getByTestId('echarts-header'));
    expect(mockGetDataURL).not.toHaveBeenCalled();
    expect(screen.queryByTestId('diagram-zoom-overlay')).toBeNull();
  });

  it('snapshots the chart once on header double-click and opens the local overlay', () => {
    stubMatchMedia({});
    render(<EchartsBlock code={validChartCode} isDark={false} />);

    fireEvent.doubleClick(screen.getByTestId('echarts-header'));
    expect(mockGetDataURL).toHaveBeenCalledTimes(1);
    expect(mockGetDataURL).toHaveBeenCalledWith({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });

    expect(screen.getByTestId('diagram-zoom-overlay')).toBeInTheDocument();
    const content = screen.getByTestId('diagram-zoom-content');
    // The snapshot is wrapped as an SVG with 2x pixel dimensions.
    expect(content.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 672 672');
    expect(content.innerHTML).toContain('data:image/png;base64,AAAA');
  });

  it('snapshots the chart eagerly once the render settles', () => {
    vi.useFakeTimers();
    stubMatchMedia({});
    render(<EchartsBlock code={validChartCode} isDark={false} />);

    // The block listens for the 'finished' render event and debounces the
    // snapshot by 400ms.
    expect(mockOn).toHaveBeenCalledWith('finished', expect.any(Function));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(mockGetDataURL).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
