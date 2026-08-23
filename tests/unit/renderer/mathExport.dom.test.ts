import {
  buildMathSvg,
  inlineFontUrls,
  MATH_EXPORT_COLOR,
  prepareMathSvgForExport,
} from '@/renderer/components/Markdown/diagrams/mathExport';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('buildMathSvg', () => {
  it('wraps KaTeX display HTML in an SVG with a sized viewBox', () => {
    const html = '<span class="katex-display"><span class="katex">x</span></span>';
    const svg = buildMathSvg(html, 100, 40, 'rgb(1, 2, 3)');
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40" viewBox="0 0 100 40">');
    expect(svg).toContain('<foreignObject x="0" y="0" width="100" height="40">');
    expect(svg).toContain('color:rgb(1, 2, 3)');
  });

  it('resets the .katex-display margin so the formula fills the viewBox', () => {
    const html = '<span class="katex-display"><span class="katex">x</span></span>';
    const svg = buildMathSvg(html, 10, 10, 'black');
    expect(svg).toContain('<span class="katex-display" style="margin:0">');
  });

  it('clamps degenerate sizes to at least 1px', () => {
    const svg = buildMathSvg('<span class="katex-display"></span>', 0, -5, 'black');
    expect(svg).toContain('width="1" height="1"');
  });
});

describe('inlineFontUrls', () => {
  const fontData = 'fake-font-bytes';
  const base64Font = Buffer.from(fontData).toString('base64');

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(fontData, { status: 200 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('inlines @font-face src urls as data URLs (real KaTeX rule shape)', async () => {
    const css =
      '@font-face { font-family: KaTeX_Main; src: url(https://cdn.example.com/KaTeX_Main.woff2) format("woff2"); }';
    const result = await inlineFontUrls(css, 'https://cdn.example.com/');
    expect(result).toContain(`url(data:text/plain;charset=utf-8;base64,${base64Font})`);
    expect(result).not.toContain('https://cdn.example.com');
  });

  it('resolves relative urls against the base url', async () => {
    const css = '@font-face { font-family: KaTeX_Main; src: url(fonts/KaTeX_Main.woff2); }';
    const result = await inlineFontUrls(css, 'https://cdn.example.com/assets/style.css');
    expect(fetch).toHaveBeenCalledWith('https://cdn.example.com/assets/fonts/KaTeX_Main.woff2');
    expect(result).toContain(`url(data:text/plain;charset=utf-8;base64,${base64Font})`);
  });

  it('keeps the original url when a font fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    const css = '@font-face { font-family: KaTeX_Main; src: url(fonts/missing.woff2); }';
    const result = await inlineFontUrls(css, 'https://cdn.example.com/');
    expect(result).toContain('url(fonts/missing.woff2)');
  });
});

const installTestStyles = () => {
  const style = document.createElement('style');
  style.setAttribute('data-math-export-test', 'true');
  style.textContent = `
    .katex { color: inherit; }
    .katex-mathml { display: none; }
    .katex-rule { background: url(https://cdn.example.com/KaTeX_Main.woff2); }
  `;
  document.head.appendChild(style);
};

describe('prepareMathSvgForExport', () => {
  const fontData = 'fake-font-bytes';

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(fontData, { status: 200 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.head.querySelectorAll('style[data-math-export-test]').forEach((el) => el.remove());
  });

  it('embeds the KaTeX CSS with font urls inlined as data URLs', async () => {
    installTestStyles();
    const svg = buildMathSvg('<span class="katex-display"></span>', 10, 10, 'rgb(255, 255, 255)');
    const exported = await prepareMathSvgForExport(svg);
    expect(exported).toContain('<style>');
    expect(exported).toContain('.katex-mathml');
    expect(exported).toContain(`url(data:text/plain;charset=utf-8;base64,${Buffer.from(fontData).toString('base64')})`);
    expect(exported).not.toContain('https://cdn.example.com');
  });

  it('pins the formula color to the light theme for the white export backdrop', async () => {
    installTestStyles();
    const svg = buildMathSvg('<span class="katex-display"></span>', 10, 10, 'rgb(255, 255, 255)');
    const exported = await prepareMathSvgForExport(svg);
    expect(exported).toContain(`color:${MATH_EXPORT_COLOR}`);
    expect(exported).not.toContain('color:rgb(255, 255, 255)');
  });

  it('rewrites the color even when no KaTeX CSS is available', async () => {
    // Fresh module registry: the previous tests populated the module-level CSS
    // cache, so reload the module to exercise the no-stylesheet path.
    vi.resetModules();
    const fresh = await import('@/renderer/components/Markdown/diagrams/mathExport');
    const svg = fresh.buildMathSvg('<span class="katex-display"></span>', 10, 10, 'rgb(255, 255, 255)');
    const exported = await fresh.prepareMathSvgForExport(svg);
    expect(exported).toContain(`color:${fresh.MATH_EXPORT_COLOR}`);
    expect(exported).not.toContain('<style>');
  });
});
