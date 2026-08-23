/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Math (KaTeX) diagram SVG construction and standalone-export preparation.
 *
 * KaTeX renders to HTML, so MathBlock measures the rendered formula in the DOM
 * and wraps it in an SVG `<foreignObject>` — that SVG string is what joins the
 * unified diagram pipeline (gallery overlay, copy-image, save-image).
 *
 * The inline SVG relies on the page's KaTeX stylesheet. For standalone export
 * (clipboard / file) the KaTeX CSS — including its fonts, inlined as data URLs
 * — is injected into the SVG so it renders without the host page.
 */

// Vertical/horizontal padding around the measured formula so italic overhangs
// and tall glyphs never clip at the foreignObject edge.
export const MATH_SVG_PADDING = 8;

/** Match the opening tag of KaTeX's display-mode wrapper span. */
const KATEX_DISPLAY_OPENING = '<span class="katex-display"';

// KaTeX's document stylesheet gives .katex-display a 1em vertical margin; the
// inline chat block wants it, the exported SVG does not (it would shift the
// formula inside the measured viewBox).
const resetDisplayMargin = (html: string): string => {
  if (!html.includes(KATEX_DISPLAY_OPENING)) return html;
  return html.replace(KATEX_DISPLAY_OPENING, '<span class="katex-display" style="margin:0"');
};

/**
 * Wrap a KaTeX display-mode HTML string into an SVG with an explicit viewBox
 * so the gallery overlay and the export pipeline can size it by its own
 * natural dimensions, exactly like Mermaid/WaveDrom SVGs.
 */
export const buildMathSvg = (katexHtml: string, width: number, height: number, color: string): string => {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" ` +
    `style="color:${color};width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center">` +
    resetDisplayMargin(katexHtml) +
    `</div></foreignObject></svg>`
  );
};

// KaTeX renders .katex-mathml (the accessible MathML annotation) next to the
// formula and hides it with CSS. A standalone SVG without that rule would show
// the formula twice. Mirrors the aggregation logic in ShadowView so every
// sheet that contributes KaTeX rules is included.
const collectKatexCss = (styleSheets: Iterable<CSSStyleSheet>): string => {
  const chunks: string[] = [];
  for (const sheet of styleSheets) {
    let rules: CSSRule[];
    try {
      rules = [...sheet.cssRules];
    } catch {
      // CORS may block access to cssRules for cross-origin stylesheets
      continue;
    }
    for (const rule of rules) {
      if (rule.cssText.toLowerCase().includes('katex')) chunks.push(rule.cssText);
    }
  }
  return chunks.join('\n');
};

const RENDERER_FONT_FETCHES = new Map<string, Promise<string>>();

const blobToDataUrl = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Chunked latin-1 conversion keeps the call stack shallow for large fonts.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
};

const cssUrlToDataUrl = (urlText: string, baseUrl: string): Promise<string> => {
  const url = urlText.slice(1, -1);
  if (url.startsWith('data:')) return Promise.resolve(url);
  const absolute = new URL(url, baseUrl).href;
  const cached = RENDERER_FONT_FETCHES.get(absolute);
  if (cached) return cached;
  const pending = fetch(absolute)
    .then((response) => {
      if (!response.ok) throw new Error(`failed to fetch font ${absolute}: ${response.status}`);
      return response.blob();
    })
    .then((blob) => blobToDataUrl(blob));
  RENDERER_FONT_FETCHES.set(absolute, pending);
  return pending;
};

/**
 * Inline every KaTeX font url() into a data URL so the exported SVG renders
 * standalone. Failed fetches keep the original url (export still succeeds,
 * rasterization falls back to system fonts for that glyph run).
 */
export const inlineFontUrls = async (css: string, baseUrl: string): Promise<string> => {
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  const replacements: Array<{ from: string; to: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(css)) !== null) {
    replacements.push({ from: match[0], to: match[2] });
  }
  const withDataUrls = await Promise.all(
    replacements.map(async ({ from, to }) => {
      try {
        const dataUrl = await cssUrlToDataUrl(`"${to}"`, baseUrl);
        return { from, to: `url(${dataUrl})` };
      } catch {
        return { from, to: from };
      }
    })
  );
  let result = css;
  for (const { from, to } of withDataUrls) result = result.replace(from, to);
  return result;
};

// Light-theme primary text: exports rasterize onto a white backdrop (shared
// diagram pipeline), so a dark-theme formula would otherwise be white-on-white.
export const MATH_EXPORT_COLOR = 'rgb(29, 33, 41)';

const COLOR_STYLE_PATTERN = /(<div xmlns="http:\/\/www\.w3\.org\/1999\/xhtml" style="color:)([^;"]+)(;)/;

let exportCssPromise: Promise<string> | null = null;

/**
 * Prepare a MathBlock SVG for standalone export: embed the page's KaTeX CSS
 * (fonts inlined as data URLs) and pin the formula color to the light-theme
 * value, matching the white-backdrop rasterization of the shared pipeline.
 * The CSS aggregation + font inlining runs once per app session.
 */
export const prepareMathSvgForExport = async (svg: string): Promise<string> => {
  if (!exportCssPromise) {
    exportCssPromise = (async () => {
      const css = collectKatexCss(document.styleSheets);
      const baseUrl = document.baseURI || window.location.href;
      return inlineFontUrls(css, baseUrl);
    })();
  }
  const css = await exportCssPromise;
  const withColor = svg.replace(COLOR_STYLE_PATTERN, `$1${MATH_EXPORT_COLOR}$3`);
  if (!css) return withColor;
  return withColor.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => `<svg${attrs}><style>${css}</style>`);
};
