/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanSvgForXml,
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
