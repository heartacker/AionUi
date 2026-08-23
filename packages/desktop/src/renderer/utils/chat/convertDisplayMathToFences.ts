/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Convert paragraph-level display math ($ ... $$) into fenced `latex` code blocks.
 *
 * Display math gets the same unified "diagram-as-image" treatment as
 * Mermaid/WaveDrom (MathBlock: pan/zoom, gallery, export) in every markdown
 * surface — chat and the file preview. Inline `$...$` still renders via
 * rehype-katex.
 *
 * The fence language is `latex` rather than `math` on purpose: rehype-katex
 * intercepts `language-math` code elements (the ```math fence markup) and
 * renders them itself, bypassing CodeBlock. `latex` flows through to
 * CodeBlock, which routes math/latex/tex all to MathBlock.
 *
 * Only blocks sitting at paragraph boundaries are converted — a `$$...$$`
 * pair inside a line of text is inline display math and is left for
 * rehype-katex, exactly as before.
 *
 * Content inside fenced code blocks (``` or ~~~) and inline code spans (`)
 * is preserved unchanged (same masking strategy as convertLatexDelimiters).
 */
export function convertDisplayMathToFences(text: string): string {
  if (!text || typeof text !== 'string') return text || '';

  const segments: string[] = [];
  let pos = 0;

  // Match fenced code blocks (``` or ~~~) and inline code spans
  const codeRegex = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g;

  let match: RegExpExecArray | null;
  while ((match = codeRegex.exec(text)) !== null) {
    // Process text before this code segment
    if (match.index > pos) {
      segments.push(replaceBlockMath(text.slice(pos, match.index)));
    }
    // Keep code segment unchanged
    segments.push(match[0]);
    pos = match.index + match[0].length;
  }

  // Process remaining text after last code segment
  if (pos < text.length) {
    segments.push(replaceBlockMath(text.slice(pos)));
  }

  return segments.join('');
}

// Block math must sit at a paragraph boundary: preceded by the text start or a
// blank line, and followed by a blank line or the text end. The opening line's
// indentation is kept so blocks inside list items stay attached to their item.
const BLOCK_MATH_REGEX = /(^|\n[ \t]*\n)([ \t]*)\$\$([\s\S]*?)\$\$[ \t]*(?=\n[ \t]*\n|\n*$)/g;

const replaceBlockMath = (text: string): string =>
  text.replace(BLOCK_MATH_REGEX, (_all, boundary: string, indent: string, content: string) => {
    return `${boundary}${indent}\`\`\`latex\n${content}\n\`\`\``;
  });
