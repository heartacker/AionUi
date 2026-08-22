/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getDiagramSummary } from '@/renderer/components/Markdown/markdownUtils';

describe('getDiagramSummary', () => {
  it('skips mermaid %%{init...} directive lines and returns the first content line', () => {
    const source =
      '%%{init: {"theme": "dark", "themeVariables": {"fontSize": "16px"}}}\n%% a comment\nflowchart TD\n  A --> B';
    expect(getDiagramSummary(source, 'mermaid')).toBe('flowchart TD');
  });

  it('returns undefined for directive-only mermaid source', () => {
    expect(getDiagramSummary('%%{init: {}}', 'mermaid')).toBeUndefined();
  });

  it('skips JSON punctuation-only lines and comments for wavedrom', () => {
    const source = '{\n// timing diagram\nsignal: [\n  { name: "clk", wave: "p..." }\n]';
    expect(getDiagramSummary(source, 'wavedrom')).toBe('signal: [');
  });

  it('returns the first plain line when wavedrom has no leading punctuation', () => {
    expect(getDiagramSummary('{ signal: [] }', 'wavedrom')).toBe('{ signal: [] }');
  });
});
