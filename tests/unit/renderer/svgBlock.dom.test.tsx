import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import SvgBlock from '@/renderer/components/Markdown/diagrams/SvgBlock';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    openPreview: vi.fn(),
  }),
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

describe('SvgBlock', () => {
  const sampleSvg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red" /></svg>';
  const fencedSvg =
    '```svg\n<?xml version="1.0"?>\n<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="blue" /></svg>\n```';

  it('renders preview mode by default with rendered SVG', () => {
    render(<SvgBlock code={sampleSvg} />);
    expect(screen.getByTestId('svg-header')).toBeInTheDocument();
    expect(screen.getByTestId('svg-diagram')).toBeInTheDocument();
    expect(screen.getByTestId('svg-diagram').innerHTML).toContain('<circle');
  });

  it('handles fenced and XML declared SVG code cleanly', () => {
    render(<SvgBlock code={fencedSvg} />);
    expect(screen.getByTestId('svg-diagram')).toBeInTheDocument();
    expect(screen.getByTestId('svg-diagram').innerHTML).toContain('<rect');
  });

  it('switches between preview and source view modes', () => {
    render(<SvgBlock code={sampleSvg} />);
    fireEvent.click(screen.getByTestId('svg-toggle-source'));
    expect(screen.getByText(/circle/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('svg-toggle-preview'));
    expect(screen.getByTestId('svg-diagram')).toBeInTheDocument();
  });
});
