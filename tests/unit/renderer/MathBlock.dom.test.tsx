import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MathBlock from '@/renderer/components/Markdown/diagrams/MathBlock';

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
  vi.restoreAllMocks();
});

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

  it('hides the header actions until the block is hovered', async () => {
    stubMatchMedia({});
    render(<MathBlock code='E = mc^2' />);
    await waitFor(() => expect(document.querySelector('.katex')).toBeTruthy());

    const actions = screen.getByTestId('math-header');
    expect(actions.style.opacity).toBe('0');
    const root = screen.getByTestId('math-header').parentElement?.parentElement as HTMLElement;
    fireEvent.mouseEnter(root);
    expect(actions.style.opacity).toBe('1');
    fireEvent.mouseLeave(root);
    expect(actions.style.opacity).toBe('0');
  });

  it('reveals the header actions on tap instead of hover on touch devices', async () => {
    stubMatchMedia({ '(pointer: coarse)': true });
    render(<MathBlock code='E = mc^2' />);
    await waitFor(() => expect(document.querySelector('.katex')).toBeTruthy());

    const actions = screen.getByTestId('math-header');
    expect(actions.style.opacity).toBe('0');

    const root = screen.getByTestId('math-header').parentElement?.parentElement as HTMLElement;
    fireEvent.click(root);
    expect(actions.style.opacity).toBe('1');
    fireEvent.click(root);
    expect(actions.style.opacity).toBe('0');

    // Tapping outside the block also dismisses the revealed toolbar.
    fireEvent.click(root);
    expect(actions.style.opacity).toBe('1');
    fireEvent.pointerDown(document.body);
    expect(actions.style.opacity).toBe('0');
  });

  it('opens the gallery when the header is double-clicked', async () => {
    stubMatchMedia({});
    // jsdom measures every element as 0x0; MathBlock only builds its gallery
    // SVG once the formula has measurable bounds.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 100,
      height: 40,
      top: 0,
      left: 0,
      right: 100,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    render(<MathBlock code='E = mc^2' />);
    await waitFor(() => expect(document.querySelector('.katex')).toBeTruthy());

    fireEvent.doubleClick(screen.getByTestId('math-header'));
    await vi.waitFor(() => expect(screen.getByTestId('diagram-zoom-overlay')).toBeInTheDocument());
  });

  it('does not open the gallery when a toggle or button is double-clicked', async () => {
    stubMatchMedia({});
    render(<MathBlock code='E = mc^2' />);
    await waitFor(() => expect(document.querySelector('.katex')).toBeTruthy());

    fireEvent.doubleClick(screen.getByTestId('math-toggle-preview'));
    fireEvent.doubleClick(screen.getByTestId('math-copy'));
    expect(screen.queryByTestId('diagram-zoom-overlay')).toBeNull();
  });
});
