/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Relabel fenced ```math code blocks to ```latex.
 *
 * rehype-katex treats any `<pre><code class="language-math">` — the exact
 * markup a ```math fence produces — as KaTeX input and renders it itself,
 * before react-markdown ever reaches the code component. CodeBlock therefore
 * never sees ```math fences. Renaming the fence to a language rehype-katex
 * does not recognize (```latex) lets the fence flow through to CodeBlock,
 * which routes math/latex/tex all to MathBlock anyway.
 */
export function relabelMathFences(text: string): string {
  if (!text || typeof text !== 'string') return text || '';
  return text.replace(/^(```+)math([ \t]*)$/gm, '$1latex$2');
}
