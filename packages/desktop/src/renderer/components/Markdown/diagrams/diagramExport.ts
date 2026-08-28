/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyText } from '@/renderer/utils/ui/clipboard';
import { getSvgIntrinsicSize } from '../markdownUtils';

export type DiagramExportFormat = 'svg' | 'png';

// Rasterize at 2x the natural size so exported PNGs stay crisp on HiDPI.
const PNG_SCALE = 2;

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

const buildSvgBlob = (svg: string): Blob => new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });

/**
 * Convert any HTML inside <foreignObject> into pure SVG <text> elements
 * so rasterization never taints the canvas in browser contexts.
 */
export const sanitizeSvgForRasterization = (svg: string): string => {
  if (!svg || !svg.includes('foreignObject')) return svg;

  return svg.replace(
    /<foreignObject\b([^>]*)>([\s\S]*?)<\/foreignObject>/gi,
    (_match, attrs: string, content: string) => {
      const xMatch = /\bx\s*=\s*["']([\d.]+)["']/i.exec(attrs);
      const yMatch = /\by\s*=\s*["']([\d.]+)["']/i.exec(attrs);
      const wMatch = /\bwidth\s*=\s*["']([\d.]+)["']/i.exec(attrs);
      const hMatch = /\bheight\s*=\s*["']([\d.]+)["']/i.exec(attrs);

      const x = xMatch ? parseFloat(xMatch[1]) : 0;
      const y = yMatch ? parseFloat(yMatch[1]) : 0;
      const w = wMatch ? parseFloat(wMatch[1]) : 0;
      const h = hMatch ? parseFloat(hMatch[1]) : 0;

      const centerX = x + w / 2;
      const centerY = y + h / 2;

      const text = content
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) return '';

      return `<text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="central" fill="currentColor" font-family="sans-serif" font-size="14">${text}</text>`;
    }
  );
};

/**
 * Rasterize a diagram SVG into a PNG blob. Paints a white backdrop first so
 * exports match the light diagram card (Mermaid/WaveDrom SVGs are transparent).
 */
export const svgToPngBlob = (svg: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const embeddedBlob = extractEmbeddedRasterBlob(svg);
    if (embeddedBlob) {
      resolve(embeddedBlob);
      return;
    }

    const cleanSvg = sanitizeSvgForRasterization(ensureSvgNamespaces(svg));
    const sizedSvg = toFixedSizeSvg(cleanSvg, PNG_SCALE);
    const blob = buildSvgBlob(sizedSvg);
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
    }, 2000);

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      URL.revokeObjectURL(url);
    };

    const handleLoad = () => {
      if (settled) return;
      settled = true;
      try {
        const width = image.naturalWidth || 1;
        const height = image.naturalHeight || 1;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        cleanup();
        if (!context) {
          reject(new Error('canvas 2d context unavailable'));
          return;
        }
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob((result) => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error('canvas toBlob failed'));
          }
        }, 'image/png');
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    const tryDataUrlFallback = () => {
      try {
        const fallbackImage = new Image();
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sizedSvg)}`;
        fallbackImage.addEventListener('load', () => {
          if (settled) return;
          settled = true;
          try {
            const width = fallbackImage.naturalWidth || 1;
            const height = fallbackImage.naturalHeight || 1;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) {
              reject(new Error('canvas 2d context unavailable'));
              return;
            }
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, height);
            context.drawImage(fallbackImage, 0, 0, width, height);
            canvas.toBlob(
              (result) => (result ? resolve(result) : reject(new Error('canvas toBlob failed'))),
              'image/png'
            );
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
export const copySvgImage = async (svg: string): Promise<void> => {
  const cleanSvg = ensureSvgNamespaces(svg);
  let pngBlob: Blob | null = null;
  try {
    pngBlob = await svgToPngBlob(cleanSvg);
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
 * Trigger a browser download for the diagram. SVG is written verbatim (vector);
 * PNG goes through the rasterizer (or direct raster blob for chart snapshots).
 */
export const saveDiagramImage = async (svg: string, filename: string, format: DiagramExportFormat): Promise<void> => {
  const cleanSvg = ensureSvgNamespaces(svg);
  const blob = format === 'svg' ? buildSvgBlob(cleanSvg) : await svgToPngBlob(cleanSvg);

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
