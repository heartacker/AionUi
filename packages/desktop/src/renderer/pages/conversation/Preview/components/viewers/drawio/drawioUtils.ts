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
    lower.endsWith('.dio.png') ||
    lower.endsWith('.drawio.pdf') ||
    lower.endsWith('.dio.pdf')
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
 * Extract embedded mxfile XML from a PNG data URL or binary byte array (tEXt chunk).
 */
export const extractDrawioXmlFromPng = (input: string | Uint8Array): string | null => {
  if (!input) return null;
  let bytes: Uint8Array;

  if (typeof input === 'string') {
    let b64 = input.trim();
    if (b64.startsWith('data:')) {
      const idx = b64.indexOf('base64,');
      if (idx === -1) return null;
      b64 = b64.substring(idx + 7);
    }
    try {
      if (typeof atob === 'function') {
        const binStr = atob(b64);
        bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
      } else if (typeof Buffer !== 'undefined') {
        bytes = new Uint8Array(Buffer.from(b64, 'base64'));
      } else {
        return null;
      }
    } catch {
      return null;
    }
  } else {
    bytes = input;
  }

  // Verify PNG header signature: 137 80 78 71 13 10 26 10
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    return null;
  }

  let offset = 8;
  const textDecoder = new TextDecoder('utf-8');

  while (offset + 8 <= bytes.length) {
    const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd > bytes.length || length < 0) break;

    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const chunkData = bytes.subarray(dataStart, dataEnd);
      let nullIndex = -1;
      for (let i = 0; i < chunkData.length; i++) {
        if (chunkData[i] === 0) {
          nullIndex = i;
          break;
        }
      }

      if (nullIndex > 0) {
        const keyword = textDecoder.decode(chunkData.subarray(0, nullIndex)).trim();
        if (keyword === 'mxfile' || keyword === 'mxGraphModel' || keyword === 'diagram') {
          if (type === 'tEXt') {
            const rawText = textDecoder.decode(chunkData.subarray(nullIndex + 1));
            try {
              return decodeURIComponent(rawText);
            } catch {
              return rawText;
            }
          }
        }
      }
    }

    offset = dataEnd + 4;
  }

  return null;
};

/**
 * Extract embedded mxfile XML from a PDF document string or data URL (/Subject metadata).
 */
export const extractDrawioXmlFromPdf = (input: string): string | null => {
  if (!input) return null;
  let text = input.trim();
  if (text.startsWith('data:')) {
    const idx = text.indexOf('base64,');
    if (idx !== -1) {
      try {
        if (typeof atob === 'function') {
          text = atob(text.substring(idx + 7));
        } else if (typeof Buffer !== 'undefined') {
          text = Buffer.from(text.substring(idx + 7), 'base64').toString('utf-8');
        }
      } catch {
        // keep text as is
      }
    }
  }

  // Search for /Subject (...) in PDF header
  const subjectMatch = text.match(/\/Subject\s*\(([^)]+)\)/);
  if (subjectMatch && subjectMatch[1]) {
    const raw = subjectMatch[1];
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded.includes('<mxfile') || decoded.includes('<mxGraphModel')) {
        return decoded;
      }
    } catch {
      if (raw.includes('<mxfile') || raw.includes('<mxGraphModel')) {
        return raw;
      }
    }
  }

  // Search for raw <mxfile> XML tag embedded in PDF text stream
  const mxfileIndex = text.indexOf('<mxfile');
  if (mxfileIndex !== -1) {
    const mxfileEnd = text.indexOf('</mxfile>', mxfileIndex);
    if (mxfileEnd !== -1) {
      return text.substring(mxfileIndex, mxfileEnd + 9);
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

  // Check if content is SVG, PNG, or PDF with embedded diagram
  const isSvg = content.startsWith('<svg') || content.includes('xmlns="http://www.w3.org/2000/svg"');
  const isPng = content.startsWith('data:image/png') || content.startsWith('iVBORw0KGgo');
  const isPdf = content.startsWith('data:application/pdf') || content.startsWith('%PDF');

  let xmlToParse = content;
  if (isSvg) {
    const embeddedXml = extractDrawioXmlFromSvg(content);
    if (embeddedXml) {
      xmlToParse = embeddedXml;
    }
  } else if (isPng) {
    const embeddedXml = extractDrawioXmlFromPng(content);
    if (embeddedXml) {
      xmlToParse = embeddedXml;
    }
  } else if (isPdf) {
    const embeddedXml = extractDrawioXmlFromPdf(content);
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
export const DEFAULT_DRAWIO_EMBED_URL = 'https://embed.diagrams.net';
export const DEFAULT_DRAWIO_APP_URL = 'https://app.diagrams.net';

export type DrawioMode = 'view' | 'edit';

/**
 * Resolve Draw.io base URL supporting absolute, relative (/drawio), or default fallback.
 */
export const resolveDrawioBaseUrl = (customUrl?: string, defaultUrl: string = DEFAULT_DRAWIO_VIEWER_URL): string => {
  const trimmed = (customUrl || '').trim();
  if (trimmed) {
    if (trimmed.startsWith('/') && typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}${trimmed.replace(/\/+$/, '')}`;
    }
    return trimmed.replace(/\/+$/, '');
  }
  return defaultUrl;
};

/**
 * Build the embed iframe URL for Draw.io (supporting both 'edit' and 'view' modes).
 */
export const buildDrawioViewerUrl = (
  options: {
    mode?: DrawioMode;
    page?: number;
    theme?: 'light' | 'dark';
    baseUrl?: string;
  } = {}
): string => {
  const { mode = 'edit', page = 0, theme = 'light', baseUrl } = options;
  const darkParam = theme === 'dark' ? '&dark=1' : '';

  if (mode === 'edit') {
    const resolvedBase = resolveDrawioBaseUrl(baseUrl, DEFAULT_DRAWIO_EMBED_URL);
    return `${resolvedBase}/?embed=1&proto=json&spin=1&configure=1&noSaveBtn=0&saveAndExit=0&noExitBtn=1&page=${page}${darkParam}`;
  }

  const resolvedBase = resolveDrawioBaseUrl(baseUrl, DEFAULT_DRAWIO_VIEWER_URL);
  return `${resolvedBase}/?embed=1&proto=json&spin=1&highlight=0000ff&edit=_blank&nav=1&layers=1&page=${page}${darkParam}`;
};
