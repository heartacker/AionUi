/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const renderMermaidSVGMock = vi.hoisted(() => vi.fn());
const renderMermaidASCIIMock = vi.hoisted(() => vi.fn());
const openPreviewMock = vi.hoisted(() => vi.fn());

vi.mock('beautiful-mermaid', () => ({
  renderMermaidSVG: renderMermaidSVGMock,
  renderMermaidASCII: renderMermaidASCIIMock,
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ openPreview: openPreviewMock }),
  useOptionalPreviewContext: () => ({ openPreview: openPreviewMock }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'preview.preview': '预览',
        'preview.source': '源码',
        'preview.ascii': '字符',
        'preview.beautifulMermaidTitle': 'Beautiful Mermaid 图表',
      };
      return map[key] || key;
    },
  }),
}));

vi.mock('react-syntax-highlighter', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <pre data-testid='beautiful-mermaid-source'>{children}</pre>
  ),
}));
vi.mock('react-syntax-highlighter/dist/esm/styles/hljs', () => ({ vs: {}, vs2015: {} }));

vi.mock('@arco-design/web-react', () => ({
  Message: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

// icon-park mock
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
}));

import BeautifulMermaidBlock from '@/renderer/components/Markdown/diagrams/BeautifulMermaidBlock';

const VALID_MERMAID = 'graph LR\n  A --> B';

describe('BeautifulMermaidBlock', () => {
  beforeEach(() => {
    renderMermaidSVGMock.mockReset().mockReturnValue('<svg viewBox="0 0 200 100" width="200" height="100"></svg>');
    renderMermaidASCIIMock.mockReset().mockReturnValue('┌───┐     ┌───┐\n│ A ├────►│ B │\n└───┘     └───┘');
    openPreviewMock.mockReset();
    document.documentElement.setAttribute('data-theme', 'light');
  });

  it('renders valid mermaid code to SVG', async () => {
    render(<BeautifulMermaidBlock code={VALID_MERMAID} />);
    const diagram = await screen.findByTestId('beautiful-mermaid-diagram');
    expect(diagram.querySelector('svg')).not.toBeNull();
    expect(renderMermaidSVGMock).toHaveBeenCalledWith(
      VALID_MERMAID,
      expect.objectContaining({
        transparent: true,
      })
    );
  });

  it('toggles between preview, source, and ascii text views', async () => {
    render(<BeautifulMermaidBlock code={VALID_MERMAID} />);
    await screen.findByTestId('beautiful-mermaid-diagram');

    // Switch to ASCII view
    fireEvent.mouseDown(screen.getByText('字符'), { button: 0 });
    const asciiBlock = await screen.findByTestId('beautiful-mermaid-ascii');
    expect(asciiBlock).toHaveTextContent('┌───┐');
    expect(renderMermaidASCIIMock).toHaveBeenCalledWith(VALID_MERMAID, { colorMode: 'none' });

    // Switch to Source view
    fireEvent.mouseDown(screen.getByText('源码'), { button: 0 });
    expect(await screen.findByTestId('beautiful-mermaid-source')).toContainHTML('graph LR');

    // Switch back to Diagram Preview
    fireEvent.mouseDown(screen.getByText('预览'), { button: 0 });
    expect(await screen.findByTestId('beautiful-mermaid-diagram')).toBeInTheDocument();
  });

  it('copies code to clipboard', async () => {
    const { copyText } = await import('@/renderer/utils/ui/clipboard');
    render(<BeautifulMermaidBlock code={VALID_MERMAID} />);
    await screen.findByTestId('beautiful-mermaid-diagram');
    fireEvent.click(screen.getByTestId('beautiful-mermaid-copy'));
    expect(copyText).toHaveBeenCalledWith(VALID_MERMAID);
  });

  it('opens in preview panel', async () => {
    render(<BeautifulMermaidBlock code={VALID_MERMAID} />);
    await screen.findByTestId('beautiful-mermaid-diagram');
    fireEvent.click(screen.getByTestId('beautiful-mermaid-open-in-panel'));
    expect(openPreviewMock).toHaveBeenCalledWith(
      `\`\`\`beautiful-mermaid\n${VALID_MERMAID}\n\`\`\``,
      'markdown',
      expect.objectContaining({ editable: false })
    );
  });
});
