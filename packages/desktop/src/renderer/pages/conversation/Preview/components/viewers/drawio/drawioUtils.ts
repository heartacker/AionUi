/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type DrawioPage = {
  id: string;
  name: string;
  rawContent: string;
  decompressedXml?: string;
};

export type DrawioParseResult = {
  isValid: boolean;
  isSvg: boolean;
  pages: DrawioPage[];
  rawXml: string;
  error?: string;
};

/**
 * Checks if a filename or path corresponds to a Draw.io diagram file.
 */
export const isDrawioFile = (fileName: string): boolean => {
  if (!fileName) return false;
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith('.drawio') ||
    lower.endsWith('.dio') ||
    lower.endsWith('.drawio.xml') ||
    lower.endsWith('.dio.xml') ||
    lower.endsWith('.drawio.svg') ||
    lower.endsWith('.dio.svg') ||
    lower.endsWith('.drawio.png') ||
    lower.endsWith('.dio.png')
  );
};

/**
 * Decompresses a raw deflate-compressed Base64 string from a Draw.io diagram.
 */
export const decompressDrawioDiagram = async (encoded: string): Promise<string> => {
  const trimmed = (encoded || '').trim();
  if (!trimmed) return '';

  // If already plain XML, return directly
  if (trimmed.startsWith('<') || trimmed.includes('<mxGraphModel') || trimmed.includes('<root>')) {
    return trimmed;
  }

  try {
    // 1. Decode base64
    let binaryString: string;
    if (typeof atob === 'function') {
      binaryString = atob(trimmed);
    } else if (typeof Buffer !== 'undefined') {
      binaryString = Buffer.from(trimmed, 'base64').toString('binary');
    } else {
      throw new Error('No base64 decoder available');
    }

    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // 2. Decompress using DecompressionStream if available
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      const total = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        total.set(chunk, offset);
        offset += chunk.length;
      }
      const decoded = new TextDecoder('utf-8').decode(total);
      try {
        return decodeURIComponent(decoded);
      } catch {
        return decoded;
      }
    }

    // Fallback for node test environment if DecompressionStream is not available
    if (typeof require !== 'undefined') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const zlib = require('zlib');
        const inflated = zlib.inflateRawSync(Buffer.from(bytes));
        const decoded = inflated.toString('utf-8');
        try {
          return decodeURIComponent(decoded);
        } catch {
          return decoded;
        }
      } catch {
        // ignore
      }
    }

    return trimmed;
  } catch (err) {
    console.warn('[DrawioUtils] Decompression failed:', err);
    return trimmed;
  }
};

/**
 * Extract embedded mxfile XML from an SVG string (if SVG was saved with embedded diagram data).
 */
export const extractDrawioXmlFromSvg = (svgContent: string): string | null => {
  if (!svgContent) return null;
  const contentMatch = svgContent.match(/content="([^"]+)"/i);
  if (contentMatch?.[1]) {
    try {
      const decoded = contentMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      return decoded;
    } catch {
      return null;
    }
  }
  return null;
};

/**
 * Parse Draw.io document content and extract all pages (uncompressed).
 */
export const parseDrawioPages = async (rawContent: string): Promise<DrawioParseResult> => {
  const content = (rawContent || '').trim();
  if (!content) {
    return { isValid: false, isSvg: false, pages: [], rawXml: '' };
  }

  // Check if content is SVG
  const isSvg = content.startsWith('<svg') || content.includes('xmlns="http://www.w3.org/2000/svg"');
  let xmlToParse = content;
  if (isSvg) {
    const embeddedXml = extractDrawioXmlFromSvg(content);
    if (embeddedXml) {
      xmlToParse = embeddedXml;
    }
  }

  const pages: DrawioPage[] = [];

  try {
    // 1. Try browser DOMParser
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlToParse, 'application/xml');
      const parserError = doc.querySelector('parsererror');

      if (!parserError) {
        const diagramElements = doc.querySelectorAll('diagram');
        if (diagramElements.length > 0) {
          for (let i = 0; i < diagramElements.length; i++) {
            const el = diagramElements[i];
            const id = el.getAttribute('id') || `page-${i + 1}`;
            const name = el.getAttribute('name') || `Page ${i + 1}`;
            const innerText = el.textContent || '';
            const decompressed = await decompressDrawioDiagram(innerText);
            pages.push({
              id,
              name,
              rawContent: innerText,
              decompressedXml: decompressed,
            });
          }
          return {
            isValid: true,
            isSvg,
            pages,
            rawXml: xmlToParse,
          };
        }

        // Single mxGraphModel without diagram tag
        const mxGraphModel = doc.querySelector('mxGraphModel');
        if (mxGraphModel) {
          pages.push({
            id: 'page-1',
            name: 'Page 1',
            rawContent: xmlToParse,
            decompressedXml: xmlToParse,
          });
          return {
            isValid: true,
            isSvg,
            pages,
            rawXml: xmlToParse,
          };
        }
      }
    }

    // 2. Regex fallback for non-DOM / test environments or malformed outer XML
    const diagramRegex = /<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/gi;
    let match: RegExpExecArray | null;
    let pageIndex = 0;

    while ((match = diagramRegex.exec(xmlToParse)) !== null) {
      pageIndex++;
      const attrs = match[1] || '';
      const body = match[2] || '';

      const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
      const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);

      const id = idMatch?.[1] || `page-${pageIndex}`;
      const name = nameMatch?.[1] || `Page ${pageIndex}`;
      const decompressed = await decompressDrawioDiagram(body);

      pages.push({
        id,
        name,
        rawContent: body,
        decompressedXml: decompressed,
      });
    }

    if (pages.length > 0) {
      return {
        isValid: true,
        isSvg,
        pages,
        rawXml: xmlToParse,
      };
    }

    if (xmlToParse.includes('<mxGraphModel') || xmlToParse.includes('<mxCell')) {
      pages.push({
        id: 'page-1',
        name: 'Page 1',
        rawContent: xmlToParse,
        decompressedXml: xmlToParse,
      });
      return {
        isValid: true,
        isSvg,
        pages,
        rawXml: xmlToParse,
      };
    }

    return {
      isValid: false,
      isSvg,
      pages: [],
      rawXml: xmlToParse,
      error: 'No valid Draw.io diagram model found',
    };
  } catch (err) {
    return {
      isValid: false,
      isSvg,
      pages: [],
      rawXml: xmlToParse,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

export const DEFAULT_DRAWIO_VIEWER_URL = 'https://viewer.diagrams.net';
export const DEFAULT_DRAWIO_APP_URL = 'https://app.diagrams.net';

/**
 * Build the embed viewer URL for Diagrams.net / Draw.io iframe.
 */
export const buildDrawioViewerUrl = (
  options: { page?: number; theme?: 'light' | 'dark'; baseUrl?: string } = {}
): string => {
  const { page = 0, theme = 'light', baseUrl } = options;
  const rawBase = (baseUrl || '').trim() || DEFAULT_DRAWIO_VIEWER_URL;
  const baseWithoutSlash = rawBase.replace(/\/+$/, '');
  const darkParam = theme === 'dark' ? '&dark=1' : '';
  return `${baseWithoutSlash}/?embed=1&proto=json&spin=1&highlight=0000ff&edit=_blank&nav=1&layers=1&page=${page}${darkParam}`;
};
