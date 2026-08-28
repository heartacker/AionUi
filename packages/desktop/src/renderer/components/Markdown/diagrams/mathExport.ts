import katex from 'katex';

/**
 * Math (KaTeX) diagram SVG construction and standalone-export preparation.
 */

/**
 * Render KaTeX formula to a standards-compliant, pure SVG with native elements (<text>, <rect>, <path>).
 * Contains ZERO <foreignObject>, so it never taints the HTML canvas and can be exported to PNG / SVG
 * across all browsers, WebUI and Electron without security blocks.
 */
export const renderKatexToPureSvg = (
  formula: string,
  targetTheme: 'light' | 'dark' = 'light',
  fontSize = 20
): string => {
  if (typeof document === 'undefined' || !formula) return '';
  const div = document.createElement('div');
  div.style.position = 'absolute';
  div.style.left = '-99999px';
  div.style.top = '-99999px';
  div.style.fontSize = `${fontSize}px`;
  div.style.lineHeight = '1.2';
  div.style.visibility = 'hidden';
  document.body.appendChild(div);

  try {
    katex.render(formula, div, {
      displayMode: true,
      throwOnError: false,
      output: 'html',
    });

    const katexEl = div.querySelector<HTMLElement>('.katex-html') || div.querySelector<HTMLElement>('.katex') || div;
    const baseRect = katexEl.getBoundingClientRect();
    const isZeroRectEnv = baseRect.width === 0 && baseRect.height === 0;
    const padding = 16;

    const fillColor = targetTheme === 'dark' ? '#e5e6eb' : '#1d2129';
    const svgElements: string[] = [];
    let jsdomCursorX = padding;

    // 1. Process all horizontal rule / fraction lines
    const lineElements = div.querySelectorAll<HTMLElement>('.frac-line, .rule, .hline, .stretchy');
    const processedElements = new Set<Element>();

    for (const el of Array.from(lineElements)) {
      const rect = el.getBoundingClientRect();
      if (!isZeroRectEnv && rect.width > 0 && rect.height > 0) {
        const x = rect.left - (baseRect.left - padding);
        const y = rect.top - (baseRect.top - padding);
        const h = Math.max(1, rect.height);
        svgElements.push(
          `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${rect.width.toFixed(2)}" height="${h.toFixed(2)}" fill="${fillColor}" stroke="none"/>`
        );
        processedElements.add(el);
      }
    }

    // 2. Process all embedded SVG paths (e.g. square roots, large brackets)
    const svgs = div.querySelectorAll<SVGSVGElement>('svg');
    for (const svg of Array.from(svgs)) {
      const rect = svg.getBoundingClientRect();
      const paths = svg.querySelectorAll<SVGPathElement>('path');
      const x = isZeroRectEnv ? jsdomCursorX : rect.left - (baseRect.left - padding);
      const y = isZeroRectEnv ? padding : rect.top - (baseRect.top - padding);
      const viewBox = svg.getAttribute('viewBox') || `0 0 ${rect.width || 20} ${rect.height || 20}`;
      const pathMarkup = Array.from(paths)
        .map((p) => `<path d="${p.getAttribute('d')}" fill="${fillColor}" stroke="none"/>`)
        .join('');
      if (pathMarkup) {
        const w = (rect.width || 20).toFixed(2);
        const h = (rect.height || 20).toFixed(2);
        svgElements.push(
          `<g transform="translate(${x}, ${y})"><svg width="${w}" height="${h}" viewBox="${viewBox}">${pathMarkup}</svg></g>`
        );
        if (isZeroRectEnv) jsdomCursorX += 24;
      }
      processedElements.add(svg);
    }

    // 3. Process all text glyphs
    const walker = document.createTreeWalker(katexEl, NodeFilter.SHOW_TEXT);
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const text = textNode.textContent?.trim();
      if (!text) continue;
      const parent = textNode.parentElement;
      if (!parent || processedElements.has(parent) || parent.closest('svg')) continue;

      // Skip invisible MathML annotations
      if (parent.closest('.katex-mathml')) continue;

      const rect = parent.getBoundingClientRect();
      if (!isZeroRectEnv && (rect.width <= 0 || rect.height <= 0)) continue;

      const style = window.getComputedStyle(parent);
      const parentFontSize = parseFloat(style.fontSize) || fontSize;
      const fontFamily = style.fontFamily || 'KaTeX_Main, Times New Roman, serif';
      const fontStyle = style.fontStyle || 'normal';
      const fontWeight = style.fontWeight || 'normal';

      let x: string;
      let y: string;

      if (isZeroRectEnv) {
        x = jsdomCursorX.toFixed(2);
        y = (padding + parentFontSize).toFixed(2);
        jsdomCursorX += Math.max(8, text.length * parentFontSize * 0.6);
      } else {
        x = (rect.left - (baseRect.left - padding)).toFixed(2);
        y = (rect.top - (baseRect.top - padding) + rect.height * 0.82).toFixed(2);
      }

      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      svgElements.push(
        `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${parentFontSize}px" font-style="${fontStyle}" font-weight="${fontWeight}" fill="${fillColor}" stroke="none">${escaped}</text>`
      );
    }

    const width = isZeroRectEnv
      ? Math.max(100, Math.ceil(jsdomCursorX + padding))
      : Math.max(1, Math.ceil(baseRect.width) + padding * 2);
    const height = isZeroRectEnv
      ? Math.max(40, Math.ceil(fontSize * 2 + padding * 2))
      : Math.max(1, Math.ceil(baseRect.height) + padding * 2);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgElements.join('')}</svg>`;
  } finally {
    div.remove();
  }
};

// Vertical/horizontal padding around the measured formula so italic overhangs
// and tall glyphs never clip at the foreignObject edge. Glyph overhangs scale
// with the font, so this must be generous: the layout box that is measured
// excludes what the glyphs actually paint outside it.
export const MATH_SVG_PADDING = 16;

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
 *
 * `fontSize` pins the base font size the formula was measured at: KaTeX sizes
 * itself with em units (`1.21em`) relative to its parent, so rendering the
 * foreignObject in a context with a different font size (the gallery overlay
 * inherits document.body while the chat uses --chat-font-size) would resize
 * the formula past the measured viewBox and clip it.
 */
export const buildMathSvg = (
  katexHtml: string,
  width: number,
  height: number,
  color: string,
  fontSize?: string
): string => {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const fontRule = fontSize ? `font-size:${fontSize};` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" ` +
    `style="color:${color};${fontRule}width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center">` +
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
 * (fonts inlined as data URLs) and pin the formula color to the target-theme
 * value (light or dark), matching the background of the export pipeline.
 * The CSS aggregation + font inlining runs once per app session.
 */
export const prepareMathSvgForExport = async (
  svg: string,
  targetTheme: 'light' | 'dark' = 'light',
  code?: string
): Promise<string> => {
  if (code) {
    try {
      const pureSvg = renderKatexToPureSvg(code, targetTheme);
      if (pureSvg) return pureSvg;
    } catch (err) {
      console.warn('[MathExport] renderKatexToPureSvg failed, falling back:', err);
    }
  }
  if (!exportCssPromise) {
    exportCssPromise = (async () => {
      try {
        const css = collectKatexCss(document.styleSheets);
        const baseUrl = document.baseURI || window.location.href;
        return await inlineFontUrls(css, baseUrl);
      } catch (err) {
        console.warn('[MathExport] Failed to collect KaTeX CSS/fonts:', err);
        return '';
      }
    })();
  }
  try {
    const css = await exportCssPromise;
    const formulaColor = targetTheme === 'dark' ? '#e5e6eb' : MATH_EXPORT_COLOR;
    const withColor = svg.replace(/(style="[^"]*color:\s*)([^;"]+)/i, `$1${formulaColor}`);
    const themedCss = css
      ? `${css}\n.katex { color: ${formulaColor} !important; }`
      : `.katex { color: ${formulaColor} !important; }`;
    return withColor.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => `<svg${attrs}><style>${themedCss}</style>`);
  } catch (err) {
    console.warn('[MathExport] prepareMathSvgForExport failed, returning raw SVG:', err);
    return svg;
  }
};
