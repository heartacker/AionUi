/**
 * End-to-end guard for the math fence pipeline through the real MarkdownView
 * (ShadowView included): rehype-katex intercepts `<pre><code
 * class="language-math">` — the markup a ```math fence produces — and would
 * render the fence itself before CodeBlock ever sees it. The relabel
 * preprocessing must make the fence reach MathBlock.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const themeMocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(null),
  on: vi.fn(() => () => {}),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    theme: {
      requestCurrent: { invoke: themeMocks.invoke },
      changed: { on: themeMocks.on },
    },
  },
}));

import MarkdownView from '@/renderer/components/Markdown';

// MarkdownView portals into a real shadow root; testing-library queries cannot
// pierce it, so query the host element's shadowRoot directly.
const getShadow = (container: HTMLElement): ShadowRoot | null | undefined =>
  (container.querySelector('.markdown-shadow') as HTMLElement | null)?.shadowRoot;

describe('MarkdownView math fence pipeline', () => {
  it('renders a ```math fence through MathBlock instead of rehype-katex', async () => {
    const { container } = render(<MarkdownView>{'```math\nE = mc^2\n```'}</MarkdownView>);
    const shadow = getShadow(container);
    await waitFor(() => {
      expect(shadow?.querySelector('[data-testid="math-diagram"]')).toBeTruthy();
    });
    // The unified header and the rendered KaTeX formula are both present.
    expect(shadow?.textContent).toContain('<math>');
    expect(shadow?.querySelector('.katex')).toBeTruthy();
  });

  it('converts a paragraph-level $$...$$ block into MathBlock too', async () => {
    const { container } = render(<MarkdownView>{'Before.\n\n$$E = mc^2$$'}</MarkdownView>);
    const shadow = getShadow(container);
    await waitFor(() => {
      expect(shadow?.querySelector('[data-testid="math-diagram"]')).toBeTruthy();
    });
  });

  it('keeps inline math on the rehype-katex path', async () => {
    const { container } = render(<MarkdownView>{'inline $x^2$ math'}</MarkdownView>);
    const shadow = getShadow(container);
    await waitFor(() => {
      expect(shadow?.querySelector('.katex')).toBeTruthy();
    });
    expect(shadow?.querySelector('[data-testid="math-diagram"]')).toBeFalsy();
  });
});
