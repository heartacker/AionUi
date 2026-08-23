import { relabelMathFences } from '@/renderer/utils/chat/relabelMathFences';
import { describe, expect, it } from 'vitest';

describe('relabelMathFences', () => {
  it('relabels a ```math fence opening line to ```latex', () => {
    const input = '```math\nE = mc^2\n```';
    expect(relabelMathFences(input)).toBe('```latex\nE = mc^2\n```');
  });

  it('relabels math fences with longer backtick runs and trailing spaces', () => {
    expect(relabelMathFences('````math  \nx\n````')).toBe('````latex  \nx\n````');
  });

  it('relabels every math fence in a document', () => {
    const input = '```math\na\n```\n\ntext\n\n```math\nb\n```';
    expect(relabelMathFences(input)).toBe('```latex\na\n```\n\ntext\n\n```latex\nb\n```');
  });

  it('leaves other fence languages untouched', () => {
    const input = '```latex\nx\n```\n\n```tex\ny\n```\n\n```mermaid\ngraph TD\n```';
    expect(relabelMathFences(input)).toBe(input);
  });

  it('does not touch inline code spans mentioning ```math', () => {
    const input = 'Use ` ```math ` literally.\n\n```math\nx\n```';
    expect(relabelMathFences(input)).toBe('Use ` ```math ` literally.\n\n```latex\nx\n```');
  });

  it('does not touch fence-like text that does not start a line', () => {
    const input = 'The fence is ```math\nx\n``` done.';
    expect(relabelMathFences(input)).toBe(input);
  });

  it('handles empty or non-string inputs safely', () => {
    expect(relabelMathFences('')).toBe('');
    expect(relabelMathFences(null as unknown as string)).toBe('');
  });
});
