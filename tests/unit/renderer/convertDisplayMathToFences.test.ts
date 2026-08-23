import { convertDisplayMathToFences } from '@/renderer/utils/chat/convertDisplayMathToFences';
import { describe, expect, it } from 'vitest';

describe('convertDisplayMathToFences', () => {
  it('converts a standalone $$...$$ paragraph into a latex fence', () => {
    const input = 'Before.\n\n$$E = mc^2$$\n\nAfter.';
    const output = convertDisplayMathToFences(input);
    expect(output).toBe('Before.\n\n```latex\nE = mc^2\n```\n\nAfter.');
  });

  it('converts multiline block math, preserving the content', () => {
    const input = '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$';
    const output = convertDisplayMathToFences(input);
    expect(output).toBe('```latex\n\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n\n```');
  });

  it('converts math at the very start of the text', () => {
    expect(convertDisplayMathToFences('$$x$$')).toBe('```latex\nx\n```');
    expect(convertDisplayMathToFences('$$x + y$$\n\nTail.')).toBe('```latex\nx + y\n```\n\nTail.');
  });

  it('converts math at the very end of the text (with and without trailing newline)', () => {
    expect(convertDisplayMathToFences('Head.\n\n$$x$$')).toBe('Head.\n\n```latex\nx\n```');
    expect(convertDisplayMathToFences('Head.\n\n$$x$$\n')).toBe('Head.\n\n```latex\nx\n```\n');
  });

  it('leaves inline display math (inside a paragraph) untouched', () => {
    const input = 'Some text $$x + y$$ and more text.';
    expect(convertDisplayMathToFences(input)).toBe(input);
  });

  it('leaves math untouched without a blank-line boundary', () => {
    const input = '# Heading\n$$x$$';
    expect(convertDisplayMathToFences(input)).toBe(input);
  });

  it('keeps the indentation of blocks inside list items', () => {
    const input = '- item\n\n  $$x$$';
    const output = convertDisplayMathToFences(input);
    expect(output).toBe('- item\n\n  ```latex\nx\n```');
  });

  it('preserves fenced code blocks unchanged', () => {
    const input = '```\n$$E = mc^2$$\n```\n\n$$a + b$$';
    const output = convertDisplayMathToFences(input);
    expect(output).toBe('```\n$$E = mc^2$$\n```\n\n```latex\na + b\n```');
  });

  it('preserves inline code unchanged', () => {
    const input = 'Use `$$E = mc^2$$` in text.\n\n$$a = b$$';
    const output = convertDisplayMathToFences(input);
    expect(output).toBe('Use `$$E = mc^2$$` in text.\n\n```latex\na = b\n```');
  });

  it('handles empty or non-string inputs safely', () => {
    expect(convertDisplayMathToFences('')).toBe('');
    expect(convertDisplayMathToFences(null as unknown as string)).toBe('');
  });
});
