import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CodeBlock from '@/renderer/components/Markdown/CodeBlock';

describe('CodeBlock math routing', () => {
  it('routes math fences to MathBlock (unified diagram view)', async () => {
    render(<CodeBlock className='language-math'>{'E = mc^2'}</CodeBlock>);

    expect(screen.getByText('<math>')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('math-diagram')).toBeInTheDocument();
    });
  });

  it('routes latex and tex fences to MathBlock too', () => {
    render(<CodeBlock className='language-latex'>{'a + b'}</CodeBlock>);
    expect(screen.getByText('<math>')).toBeInTheDocument();
    expect(screen.getByTestId('math-diagram')).toBeInTheDocument();
  });

  it('renders full LaTeX documents as plain code', () => {
    const source = '\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}';
    const { container } = render(<CodeBlock className='language-latex'>{source}</CodeBlock>);
    expect(container.querySelector('.katex')).toBeFalsy();
    expect(screen.queryByTestId('math-diagram')).not.toBeInTheDocument();
    // Falls through to the highlighted code path with the language header.
    expect(screen.getByText('latex')).toBeInTheDocument();
  });
});
