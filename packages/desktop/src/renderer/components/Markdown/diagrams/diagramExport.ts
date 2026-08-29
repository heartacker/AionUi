/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyText } from '@/renderer/utils/ui/clipboard';
import { ensureSvgViewBox, getSvgIntrinsicSize } from '../markdownUtils';

export { ensureSvgViewBox };

export type DiagramExportFormat = 'svg' | 'png' | 'png-light' | 'png-dark' | 'png-transparent' | 'png-theme';

export type SvgToPngOptions = {
  background?: 'transparent' | 'theme' | string;
  themeBackground?: string;
  isDark?: boolean;
  textColor?: string;
};

// Rasterize at 2x the natural size so exported PNGs stay crisp on HiDPI.
const PNG_SCALE = 2;

/**
 * Strips markdown code fence markers (e.g. ```svg ... ```) and XML declaration/DOCTYPE wrappers.
 */
export const stripSvgCodeFence = (raw: string): string => {
  let text = raw.trim();
  text = text
    .replace(/^```(?:svg|xml|html|image)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  text = text.replace(/^<\?xml[\s\S]*?\?>/i, '').trim();
  text = text.replace(/^<!DOCTYPE[\s\S]*?>/i, '').trim();

  // If there is an <svg> tag inside surrounding HTML or comments, extract from the first <svg to </svg>
  const svgStart = text.search(/<svg\b/i);
  const svgEnd = text.toLowerCase().lastIndexOf('</svg>');
  if (svgStart >= 0 && svgEnd > svgStart) {
    text = text.slice(svgStart, svgEnd + 6).trim();
  }

  return text;
};

/**
 * Fully sanitize, namespace, and format an SVG string for safe rendering and gallery viewing.
 */
export const sanitizeAndFormatSvg = (rawSvg: string): string => {
  const stripped = stripSvgCodeFence(rawSvg);
  const namespaced = ensureSvgNamespaces(stripped);
  const withViewBox = ensureSvgViewBox(namespaced);
  return cleanSvgForXml(withViewBox);
};

/**
 * Fix unclosed void HTML tags (e.g. <br>, <hr>, <img>, <input>) and named entities
 * so the SVG complies with strict XML parsers when opened standalone or loaded in Image.
 */
export const cleanSvgForXml = (svg: string): string => {
  if (!svg) return svg;

  return svg
    .replace(/<br(?:\s*|\s+[^>/]*)>/gi, (match) => (match.endsWith('/>') ? match : `${match.slice(0, -1)}/>`))
    .replace(/<hr(?:\s*|\s+[^>/]*)>/gi, (match) => (match.endsWith('/>') ? match : `${match.slice(0, -1)}/>`))
    .replace(/<img(?:\s+[^>/]*)>/gi, (match) => (match.endsWith('/>') ? match : `${match.slice(0, -1)}/>`))
    .replace(/<input(?:\s+[^>/]*)>/gi, (match) => (match.endsWith('/>') ? match : `${match.slice(0, -1)}/>`))
    .replace(/&nbsp;/g, '&#160;')
    .replace(/&bull;/g, '&#8226;')
    .replace(/&hellip;/g, '&#8230;')
    .replace(/&mdash;/g, '&#8212;')
    .replace(/&ndash;/g, '&#8211;')
    .replace(/&copy;/g, '&#169;');
};

/**
 * Ensure the SVG string carries the proper XML namespaces for standalone usage.
 */
export const ensureSvgNamespaces = (svg: string): string => {
  if (!svg || !svg.includes('<svg')) return svg;

  return svg.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    let updated = attrs;
    if (!/\bxmlns\s*=/i.test(updated)) {
      updated = ` xmlns="http://www.w3.org/2000/svg"${updated}`;
    }
    if ((svg.includes('xlink:href') || svg.includes('<image')) && !/\bxmlns:xlink\s*=/i.test(updated)) {
      updated = ` xmlns:xlink="http://www.w3.org/1999/xlink"${updated}`;
    }
    return `<svg${updated}>`;
  });
};

/**
 * Extract embedded raster image (data URL) directly from SVG markup if present (e.g. ECharts snapshot).
 */
export const extractEmbeddedRasterBlob = (svg: string): Blob | null => {
  const match = /<image\b[^>]*?(?:href|xlink:href)=["'](data:image\/[^"']+)["']/i.exec(svg);
  if (!match) return null;
  const dataUrl = match[1];
  try {
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex === -1) return null;
    const header = dataUrl.slice(0, commaIndex);
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const isBase64 = header.includes('base64');
    const data = dataUrl.slice(commaIndex + 1);
    if (isBase64) {
      const binary = atob(data);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: mime });
    }
  } catch (err) {
    console.warn('[diagramExport] Failed to parse embedded raster data URL:', err);
  }
  return null;
};

/**
 * Rewrite the SVG root with explicit pixel width/height (dropping the inline
 * max-width/style the inline diagram carries) so the browser lays it out at a
 * fixed size — the rasterizer needs concrete dimensions.
 */
const toFixedSizeSvg = (svg: string, scale: number): string => {
  const intrinsic = getSvgIntrinsicSize(svg);
  if (!intrinsic) return svg;
  const width = Math.max(1, Math.round(intrinsic.width * scale));
  const height = Math.max(1, Math.round(intrinsic.height * scale));
  return svg.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    const cleaned = attrs
      .replace(/\swidth\s*=\s*["'][^"']*["']/gi, '')
      .replace(/\sheight\s*=\s*["'][^"']*["']/gi, '')
      .replace(/\sstyle\s*=\s*["'][^"']*["']/gi, '');
    return `<svg${cleaned} width="${width}" height="${height}">`;
  });
};

const wrapTextToWidth = (text: string, maxWidth: number): string[] => {
  if (!text || maxWidth <= 0) return [text];

  const measure = (str: string): number => {
    let width = 0;
    for (let i = 0; i < str.length; i++) {
      width += str.charCodeAt(i) > 255 ? 14 : 7.8;
    }
    return width;
  };

  if (measure(text) <= maxWidth) {
    return [text];
  }

  // Tokenize into words and CJK characters
  const tokens: string[] = [];
  let currentToken = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char.charCodeAt(0) > 255 || /\s/.test(char) || /[，。、；：！？（）()[\],.]/.test(char)) {
      if (currentToken) {
        tokens.push(currentToken);
        currentToken = '';
      }
      tokens.push(char);
    } else {
      currentToken += char;
    }
  }
  if (currentToken) tokens.push(currentToken);

  const lines: string[] = [];
  let currentLine = '';
  let currentWidth = 0;

  for (const token of tokens) {
    const tokenWidth = measure(token);
    if (currentWidth + tokenWidth > maxWidth && currentLine.length > 0) {
      lines.push(currentLine.trim());
      currentLine = token.trimStart();
      currentWidth = measure(currentLine);
    } else {
      currentLine += token;
      currentWidth += tokenWidth;
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines;
};

/**
 * Convert HTML inside <foreignObject> into standards-compliant, multi-line SVG <text> with <tspan> lines.
 * This guarantees:
 * 1. Zero canvas tainting in Chromium/WebKit (PNG export and clipboard write succeed 100% of the time).
 * 2. Multi-line typography, bold weight, bullet points, font-size and alignment match onscreen rendering.
 */
export const convertForeignObjectToSvgText = (
  svg: string,
  options?: { isDark?: boolean; textColor?: string }
): string => {
  if (!svg || !svg.includes('foreignObject')) return svg;

  const defaultTextColor = options?.textColor || (options?.isDark ? '#e5e6eb' : '#1d2129');

  return svg.replace(
    /<foreignObject\b([^>]*)>([\s\S]*?)<\/foreignObject>/gi,
    (fullMatch, attrs: string, content: string) => {
      // Do not convert KaTeX formula foreignObjects — they contain rich math layout & inlined fonts
      if (content.includes('katex')) {
        return fullMatch;
      }
      const xMatch = /\bx\s*=\s*["']([-+]?[\d.]+)["']/i.exec(attrs);
      const yMatch = /\by\s*=\s*["']([-+]?[\d.]+)["']/i.exec(attrs);
      const wMatch = /\bwidth\s*=\s*["']([\d.]+)["']/i.exec(attrs);
      const hMatch = /\bheight\s*=\s*["']([\d.]+)["']/i.exec(attrs);

      const x = xMatch ? parseFloat(xMatch[1]) : 0;
      const y = yMatch ? parseFloat(yMatch[1]) : 0;
      const w = wMatch ? parseFloat(wMatch[1]) : 0;
      const h = hMatch ? parseFloat(hMatch[1]) : 0;

      const centerX = x + w / 2;
      const centerY = y + h / 2;
      const maxLineWidth = Math.max(140, w > 0 ? w * 1.08 : 200);

      // Extract explicit color from inline styles if present
      const colorMatch = /\bcolor\s*:\s*([^;"]+)/i.exec(content);
      const fill = colorMatch ? colorMatch[1].trim() : defaultTextColor;

      // Split content into lines by block tags or line breaks
      const normalized = content
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n');

      const rawLines = normalized.split('\n');
      const lines: Array<{ text: string; isBold: boolean }> = [];

      for (const rawLine of rawLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;
        const isBold = /<(b|strong)\b/i.test(trimmed);
        const cleanText = trimmed
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&bull;/g, '•')
          .replace(/&hellip;/g, '…')
          .replace(/&mdash;/g, '—')
          .replace(/&ndash;/g, '–')
          .replace(/&copy;/g, '©')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim();
        if (cleanText) {
          const wrapped = wrapTextToWidth(cleanText, maxLineWidth);
          for (const line of wrapped) {
            lines.push({ text: line, isBold });
          }
        }
      }

      if (lines.length === 0) return '';

      const lineHeight = 1.45;
      const totalHeightEm = (lines.length - 1) * lineHeight;
      const startDy = -(totalHeightEm / 2);

      const tspans = lines
        .map((line, index) => {
          const dy = index === 0 ? `${startDy.toFixed(2)}em` : `${lineHeight}em`;
          const boldAttr = line.isBold ? ' font-weight="600"' : ' font-weight="400"';
          const escaped = line.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `<tspan x="${centerX}" dy="${dy}"${boldAttr}>${escaped}</tspan>`;
        })
        .join('');

      return `<text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="central" stroke="none" fill="${fill}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif" font-size="14">${tspans}</text>`;
    }
  );
};

export const buildSvgBlob = (svg: string, options?: { isDark?: boolean; textColor?: string }): Blob =>
  new Blob([convertForeignObjectToSvgText(cleanSvgForXml(ensureSvgNamespaces(svg)), options)], {
    type: 'image/svg+xml;charset=utf-8',
  });

/**
 * Rasterize a diagram SVG into a PNG blob. Supports transparent background or theme-matched background.
 */
export const svgToPngBlob = (svg: string, options?: SvgToPngOptions): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const embeddedBlob = extractEmbeddedRasterBlob(svg);
    if (embeddedBlob) {
      resolve(embeddedBlob);
      return;
    }

    const cleanSvg = convertForeignObjectToSvgText(cleanSvgForXml(ensureSvgNamespaces(svg)), options);
    const sizedSvg = toFixedSizeSvg(cleanSvg, PNG_SCALE);
    const blob = buildSvgBlob(sizedSvg, options);
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.crossOrigin = 'anonymous';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('image rasterization timed out'));
      }
    }, 2500);

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      URL.revokeObjectURL(url);
    };

    const renderToCanvas = (img: HTMLImageElement): Promise<Blob> => {
      const width = img.naturalWidth || 1;
      const height = img.naturalHeight || 1;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('canvas 2d context unavailable');
      }

      if (options?.background !== 'transparent') {
        const bg =
          (options?.background && options.background !== 'theme' ? options.background : null) ||
          options?.themeBackground ||
          (options?.isDark ? '#1d2129' : '#ffffff');
        context.fillStyle = bg;
        context.fillRect(0, 0, width, height);
      }

      context.drawImage(img, 0, 0, width, height);
      return new Promise<Blob>((res, rej) => {
        canvas.toBlob((result) => {
          if (result) {
            res(result);
          } else {
            rej(new Error('canvas toBlob failed'));
          }
        }, 'image/png');
      });
    };

    const handleLoad = async () => {
      if (settled) return;
      settled = true;
      try {
        const result = await renderToCanvas(image);
        cleanup();
        resolve(result);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    const tryDataUrlFallback = () => {
      try {
        const fallbackImage = new Image();
        fallbackImage.crossOrigin = 'anonymous';
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sizedSvg)}`;
        fallbackImage.addEventListener('load', async () => {
          if (settled) return;
          settled = true;
          try {
            const result = await renderToCanvas(fallbackImage);
            resolve(result);
          } catch (err) {
            reject(err);
          }
        });
        fallbackImage.addEventListener('error', () => {
          if (settled) return;
          settled = true;
          reject(new Error('failed to load svg for rasterization'));
        });
        fallbackImage.src = dataUrl;
      } catch {
        if (!settled) {
          settled = true;
          reject(new Error('failed to load svg for rasterization'));
        }
      }
    };

    const handleError = () => {
      cleanup();
      tryDataUrlFallback();
    };

    image.addEventListener('load', handleLoad);
    image.addEventListener('error', handleError);
    image.src = url;
  });

/**
 * Copy a PNG blob through the legacy execCommand path — the fallback for
 * non-secure contexts (WebUI served over http://LAN-IP) where the async
 * clipboard API does not exist, and for sandboxed pages whose clipboard
 * permission policy rejects `navigator.clipboard.write`. Chromium copies the
 * selected image; other browsers may copy nothing, in which case the caller
 * surfaces the failure.
 */
export const copyPngViaExecCommand = async (pngBlob: Blob): Promise<void> => {
  const url = URL.createObjectURL(pngBlob);
  const container = document.createElement('div');
  container.contentEditable = 'true';
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  const image = document.createElement('img');
  image.src = url;
  container.appendChild(image);
  document.body.appendChild(container);
  try {
    // Wait for the image to decode so the clipboard carries its pixels.
    await image.decode();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(container);
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (!document.execCommand('copy')) {
      throw new Error('execCommand copy returned false');
    }
  } finally {
    window.getSelection()?.removeAllRanges();
    document.body.removeChild(container);
    URL.revokeObjectURL(url);
  }
};

/**
 * Copy the diagram image to the clipboard. Tries the modern async clipboard API with PNG,
 * falls back to legacy execCommand image copy, and finally falls back to copying the clean SVG
 * source markup via text clipboard (which is 100% reliable across non-secure WebUI over LAN).
 */
export const copySvgImage = async (svg: string, options?: SvgToPngOptions): Promise<void> => {
  const cleanSvg = cleanSvgForXml(ensureSvgNamespaces(svg));
  let pngBlob: Blob | null = null;
  try {
    pngBlob = await svgToPngBlob(cleanSvg, options);
  } catch (err) {
    console.warn('[copySvgImage] svgToPngBlob failed:', err);
  }

  // 1. Try modern Async Clipboard API in secure contexts (localhost, https, Electron)
  if (pngBlob && navigator.clipboard && window.isSecureContext && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': pngBlob,
        }),
      ]);
      return;
    } catch (err) {
      console.warn('[copySvgImage] Async clipboard write failed, trying fallback:', err);
    }
  }

  // 2. Try legacy execCommand copy with PNG blob
  if (pngBlob) {
    try {
      await copyPngViaExecCommand(pngBlob);
      return;
    } catch (err) {
      console.warn('[copySvgImage] copyPngViaExecCommand failed, trying text fallback:', err);
    }
  }

  // 3. Robust fallback: Copy SVG source code to clipboard via copyText
  // Guarantees user can always copy the diagram even in non-secure LAN WebUI!
  await copyText(cleanSvg);
};

/**
 * Wrap an image URL (data URL or web/local URL) in an SVG container
 * so it can seamlessly enter the diagram gallery stream with measurement & zoom.
 */
export const buildImageSnapshotSvg = (url: string, width = 800, height = 600): string => {
  const w = Math.max(10, Math.ceil(width));
  const h = Math.max(10, Math.ceil(height));
  const escapedUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<image href="${escapedUrl}" xlink:href="${escapedUrl}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>` +
    `</svg>`
  );
};

/**
 * Trigger a browser download for the diagram. SVG is written verbatim (vector);
 * PNG goes through the rasterizer (or direct raster blob for chart snapshots).
 */
export const saveDiagramImage = async (
  svg: string,
  filename: string,
  format: DiagramExportFormat,
  options?: SvgToPngOptions
): Promise<void> => {
  const cleanSvg = cleanSvgForXml(ensureSvgNamespaces(svg));
  let blob: Blob;

  if (format === 'svg') {
    blob = buildSvgBlob(cleanSvg, options);
  } else if (format === 'png-light') {
    blob = await svgToPngBlob(cleanSvg, {
      ...options,
      background: '#ffffff',
      themeBackground: '#ffffff',
      isDark: false,
      textColor: '#1d2129',
    });
  } else if (format === 'png-dark') {
    blob = await svgToPngBlob(cleanSvg, {
      ...options,
      background: '#1d2129',
      themeBackground: '#1d2129',
      isDark: true,
      textColor: '#e5e6eb',
    });
  } else if (format === 'png-transparent') {
    // Transparent PNG defaults to high-contrast dark text (#1d2129) so it is clearly
    // readable when embedded into common light/white documents (Word, PPT, Notion, Web).
    blob = await svgToPngBlob(cleanSvg, {
      ...options,
      background: 'transparent',
      isDark: false,
      textColor: '#1d2129',
    });
  } else {
    // format is 'png-theme' or legacy 'png'
    blob = await svgToPngBlob(cleanSvg, options);
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Keep the URL alive until the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/**
 * Re-renders the diagram for the requested export format/theme if source code is available.
 * Ensures dark exports produce genuine dark-themed diagrams and light exports produce genuine light-themed diagrams.
 */
export const prepareDiagramSvgForExport = async (
  svg: string,
  item?: { code?: string; type?: string } | null,
  format?: DiagramExportFormat
): Promise<string> => {
  if (!item || !item.code || !item.type) {
    return svg;
  }

  const targetTheme: 'light' | 'dark' = format === 'png-dark' ? 'dark' : 'light';

  if (item.type === 'mermaid') {
    try {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: targetTheme === 'dark' ? 'dark' : 'default',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        fontSize: 14,
      });
      const id = `export-m-${targetTheme}-${Math.random().toString(36).slice(2, 10)}`;
      const { svg: renderedSvg } = await mermaid.render(id, item.code);
      return renderedSvg;
    } catch (e) {
      console.warn('[prepareDiagramSvgForExport] mermaid re-render failed:', e);
      return svg;
    }
  }

  if (item.type === 'chart') {
    try {
      const echarts = await import('echarts');
      const { parseEChartsOption, buildChartSnapshotSvg } = await import('./EchartsBlock');
      const option = parseEChartsOption(item.code);
      if (option && typeof document !== 'undefined') {
        const div = document.createElement('div');
        div.style.width = '700px';
        div.style.height = '450px';
        div.style.position = 'absolute';
        div.style.left = '-99999px';
        div.style.top = '-99999px';
        document.body.appendChild(div);
        try {
          const chart = echarts.init(div, targetTheme === 'dark' ? 'dark' : undefined, { renderer: 'canvas' });
          // animation: false ensures all series data, lines, bars, and legends render synchronously at frame 0
          chart.setOption({ backgroundColor: 'transparent', animation: false, ...option });
          const chartBg = format === 'png-transparent' ? 'transparent' : targetTheme === 'dark' ? '#1d2129' : '#ffffff';
          const dataUrl = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: chartBg });
          chart.dispose();
          if (dataUrl) {
            return buildChartSnapshotSvg(dataUrl, 1400, 900);
          }
        } finally {
          div.remove();
        }
      }
    } catch (e) {
      console.warn('[prepareDiagramSvgForExport] echarts re-render failed:', e);
      return svg;
    }
  }

  if (item.type === 'math') {
    try {
      const { prepareMathSvgForExport } = await import('./mathExport');
      return await prepareMathSvgForExport(svg, targetTheme, item.code);
    } catch (e) {
      console.warn('[prepareDiagramSvgForExport] math re-render failed:', e);
      return svg;
    }
  }

  return svg;
};
