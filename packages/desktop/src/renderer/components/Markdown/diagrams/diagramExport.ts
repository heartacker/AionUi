/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getSvgIntrinsicSize } from '../markdownUtils';

export type DiagramExportFormat = 'svg' | 'png';

// Rasterize at 2x the natural size so exported PNGs stay crisp on HiDPI.
const PNG_SCALE = 2;

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
 * Rasterize a diagram SVG into a PNG blob. Paints a white backdrop first so
 * exports match the light diagram card (Mermaid/WaveDrom SVGs are transparent).
 */
export const svgToPngBlob = (svg: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const sizedSvg = toFixedSizeSvg(svg, PNG_SCALE);
    const url = URL.createObjectURL(buildSvgBlob(sizedSvg));
    const image = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    const handleLoad = () => {
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
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas toBlob failed'))), 'image/png');
    };
    const handleError = () => {
      cleanup();
      reject(new Error('failed to load svg for rasterization'));
    };
    image.addEventListener('load', handleLoad);
    image.addEventListener('error', handleError);
    image.src = url;
  });

/**
 * Copy the diagram image to the clipboard with both representations: SVG first
 * (vector, lossless — the preferred format) plus a PNG fallback so paste
 * targets that only accept raster images still work. Falls back to PNG-only
 * when the clipboard implementation rejects the SVG representation.
 */
export const copySvgImage = async (svg: string): Promise<void> => {
  if (!navigator.clipboard || !window.isSecureContext || typeof ClipboardItem === 'undefined') {
    throw new Error('async clipboard unavailable');
  }
  const representations: Record<string, Blob> = { 'image/svg+xml': buildSvgBlob(svg) };
  try {
    representations['image/png'] = await svgToPngBlob(svg);
  } catch {
    // Rasterization is a nicety; an SVG-only copy still works where supported.
  }
  try {
    await navigator.clipboard.write([new ClipboardItem(representations)]);
  } catch (firstError) {
    const png = representations['image/png'];
    if (png) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } else {
      throw firstError;
    }
  }
};

/**
 * Trigger a browser download for the diagram (Electron shows the native save
 * dialog). SVG is written verbatim (vector); PNG goes through the 2x rasterizer.
 */
export const saveDiagramImage = async (svg: string, filename: string, format: DiagramExportFormat): Promise<void> => {
  const blob = format === 'svg' ? buildSvgBlob(svg) : await svgToPngBlob(svg);
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
