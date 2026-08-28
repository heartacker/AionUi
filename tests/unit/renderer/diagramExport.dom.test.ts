/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanSvgForXml,
  convertForeignObjectToSvgText,
  copyPngViaExecCommand,
  copySvgImage,
  ensureSvgNamespaces,
  extractEmbeddedRasterBlob,
  saveDiagramImage,
} from '@/renderer/components/Markdown/diagrams/diagramExport';

// jsdom implements neither Image.decode nor document.execCommand; stub both so
// the WebUI fallback path (non-secure contexts over plain HTTP) can be tested.
const originalDecode = HTMLImageElement.prototype.decode;
const originalExecCommand = document.execCommand;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const stubDecode = () => {
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
};

const stubExecCommand = (result: boolean) => {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    writable: true,
    value: vi.fn(() => result),
  });
};

afterEach(() => {
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value: originalDecode,
  });
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    writable: true,
    value: originalExecCommand,
  });
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe('ensureSvgNamespaces', () => {
  it('adds xmlns="http://www.w3.org/2000/svg" when missing', () => {
    const raw = '<svg width="100" height="100"><circle r="10"/></svg>';
    const result = ensureSvgNamespaces(raw);
    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('preserves existing xmlns attribute', () => {
    const raw = '<svg xmlns="http://www.w3.org/2000/svg" width="100"><circle r="10"/></svg>';
    const result = ensureSvgNamespaces(raw);
    expect(result).toBe(raw);
  });

  it('adds xmlns:xlink when svg contains <image or xlink:href', () => {
    const raw = '<svg width="100"><image href="data:image/png;base64,abc"/></svg>';
    const result = ensureSvgNamespaces(raw);
    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(result).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
  });
});

describe('convertForeignObjectToSvgText', () => {
  it('converts multi-line HTML into multi-line SVG text with tspans and bold styles', () => {
    const raw =
      '<svg><foreignObject x="-90" y="-45" width="180" height="90"><div xmlns="http://www.w3.org/1999/xhtml"><span><b>1. ATOM-Die</b><br/>• 容量: 64MB<br/>• 算力: 32 TOPS (INT8)</span></div></foreignObject></svg>';
    const result = convertForeignObjectToSvgText(raw);
    expect(result).not.toContain('foreignObject');
    expect(result).toContain('<text x="0" y="0" text-anchor="middle"');
    expect(result).toContain('<tspan x="0"');
    expect(result).toContain('font-weight="600">1. ATOM-Die</tspan>');
    expect(result).toContain('• 容量: 64MB</tspan>');
    expect(result).toContain('• 算力: 32 TOPS (INT8)</tspan>');
  });

  it('preserves KaTeX foreignObject without converting to plain text', () => {
    const raw =
      '<svg><foreignObject x="0" y="0" width="100" height="50"><div xmlns="http://www.w3.org/1999/xhtml" style="color:rgb(29, 33, 41)"><span class="katex"><span class="katex-html">E = mc^2</span></span></div></foreignObject></svg>';
    const result = convertForeignObjectToSvgText(raw);
    expect(result).toContain('foreignObject');
    expect(result).toContain('class="katex"');
  });
});

describe('extractEmbeddedRasterBlob', () => {
  it('extracts base64 data URL into Blob directly', () => {
    // 1x1 transparent PNG in base64
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const svg = `<svg viewBox="0 0 10 10"><image href="data:image/png;base64,${pngBase64}" width="10" height="10"/></svg>`;
    const blob = extractEmbeddedRasterBlob(svg);
    expect(blob).not.toBeNull();
    expect(blob?.type).toBe('image/png');
    expect(blob?.size).toBeGreaterThan(0);
  });

  it('returns null if no data URL image is in svg', () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg>';
    expect(extractEmbeddedRasterBlob(svg)).toBeNull();
  });
});

describe('copyPngViaExecCommand', () => {
  it('copies the decoded image through the legacy execCommand path', async () => {
    stubDecode();
    stubExecCommand(true);
    const revoke = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:fake') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revoke;

    await expect(copyPngViaExecCommand(new Blob(['x'], { type: 'image/png' }))).resolves.toBeUndefined();
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });

  it('rejects when execCommand copy returns false', async () => {
    stubDecode();
    stubExecCommand(false);
    URL.createObjectURL = vi.fn(() => 'blob:fake') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();

    await expect(copyPngViaExecCommand(new Blob(['x'], { type: 'image/png' }))).rejects.toThrow('execCommand');
  });
});

describe('copySvgImage', () => {
  it('copies embedded chart snapshot directly in non-secure context via legacy fallback', async () => {
    stubDecode();
    stubExecCommand(true);
    URL.createObjectURL = vi.fn(() => 'blob:fake') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();

    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const svg = `<svg viewBox="0 0 10 10"><image href="data:image/png;base64,${pngBase64}" width="10" height="10"/></svg>`;
    await expect(copySvgImage(svg)).resolves.toBeUndefined();
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
});

describe('cleanSvgForXml', () => {
  it('closes unclosed <br>, <hr>, <img> tags into valid XML', () => {
    const raw = '<svg><p>Line1<br>Line2<hr><img src="test.png"></p></svg>';
    const result = cleanSvgForXml(raw);
    expect(result).toContain('<br/>');
    expect(result).toContain('<hr/>');
    expect(result).toContain('<img src="test.png"/>');
  });

  it('replaces &nbsp; with &#160;', () => {
    const raw = '<svg><text>A&nbsp;B</text></svg>';
    const result = cleanSvgForXml(raw);
    expect(result).toContain('A&#160;B');
  });
});

describe('saveDiagramImage', () => {
  it('triggers browser download with an anchor element for svg format', async () => {
    const revoke = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:fake-download') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revoke;

    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const svg = '<svg viewBox="0 0 10 10"><circle r="5"/></svg>';

    await saveDiagramImage(svg, 'test.svg', 'svg');

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(appendSpy).toHaveBeenCalled();
  });
});

describe('prepareDiagramSvgForExport', () => {
  it('returns fallback svg if item has no code', async () => {
    const { prepareDiagramSvgForExport } = await import('@/renderer/components/Markdown/diagrams/diagramExport');
    const result = await prepareDiagramSvgForExport('<svg>fallback</svg>', null, 'png-dark');
    expect(result).toBe('<svg>fallback</svg>');
  });

  it('renders KaTeX math formula into pure native SVG with no foreignObject', async () => {
    const { prepareDiagramSvgForExport } = await import('@/renderer/components/Markdown/diagrams/diagramExport');
    const result = await prepareDiagramSvgForExport('<svg>old</svg>', { type: 'math', code: 'E = mc^2' }, 'png-dark');
    expect(result).toContain('<svg');
    expect(result).not.toContain('foreignObject');
    expect(result).toContain('#e5e6eb');
  });
});
