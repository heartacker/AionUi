import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MathBlock from '@/renderer/components/Markdown/diagrams/MathBlock';

describe('MathBlock', () => {
  it('renders a valid formula in preview mode with the unified diagram header', async () => {
    render(<MathBlock code='E = mc^2' enablePanZoom />);

    expect(screen.getByText('<math>')).toBeInTheDocument();
    // Preview renders the KaTeX HTML; the preview/source toggle is available.
    await waitFor(() => {
      expect(document.querySelector('.katex')).toBeTruthy();
    });
    expect(screen.getByTestId('math-toggle-preview')).toBeInTheDocument();
    expect(screen.getByTestId('math-toggle-source')).toBeInTheDocument();
    expect(screen.getByTestId('math-copy')).toBeInTheDocument();
    expect(screen.getByTestId('math-zoom-in')).toBeInTheDocument();
  });

  it('falls back to source view for invalid LaTeX', async () => {
    render(<MathBlock code='\\frac{' />);

    await waitFor(() => {
      expect(screen.queryByTestId('math-diagram')).not.toBeInTheDocument();
    });
    expect(document.querySelector('.katex')).toBeFalsy();
    // The source toggle must not exist when there is no preview to switch to.
    expect(screen.queryByTestId('math-toggle-preview')).not.toBeInTheDocument();
  });

  it('switches between preview and source via the header toggle', async () => {
    render(<MathBlock code='E = mc^2' />);

    await waitFor(() => {
      expect(document.querySelector('.katex')).toBeTruthy();
    });

    fireEvent.mouseDown(screen.getByTestId('math-toggle-source'));
    expect(document.querySelector('.katex')).toBeFalsy();

    fireEvent.mouseDown(screen.getByTestId('math-toggle-preview'));
    expect(document.querySelector('.katex')).toBeTruthy();
  });

  it('keeps the formula in source view while streaming an incomplete block', async () => {
    const { rerender } = render(<MathBlock code='\\frac{1' />);

    await waitFor(() => {
      expect(document.querySelector('.katex')).toBeFalsy();
    });

    rerender(<MathBlock code='\\frac{1}{2}' />);
    await waitFor(() => {
      expect(document.querySelector('.katex')).toBeTruthy();
    });
  });
});
