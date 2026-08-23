/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import katex from 'katex';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { vs, vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs';

import { copyText } from '@/renderer/utils/ui/clipboard';
import { Message } from '@arco-design/web-react';
import { Copy, PreviewOpen, Refresh, ZoomIn, ZoomOut } from '@icon-park/react';
import { useOptionalPreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDiagramGallery } from './DiagramGalleryContext';
import DiagramZoomOverlay from './DiagramZoomOverlay';
import { buildMathSvg, MATH_SVG_PADDING } from './mathExport';

type MathBlockProps = {
  code: string;
  style?: React.CSSProperties;
  showOpenInPanelButton?: boolean;
  // Same opt-in contract as MermaidBlock: chat messages and the preview panel
  // enable drag-to-pan + zoom via CodeBlock; other callers stay static.
  enablePanZoom?: boolean;
};

const MIN_MATH_SCALE = 0.25;
const MAX_MATH_SCALE = 4;
const MATH_ZOOM_STEP = 0.25;
// Pointer movement below this threshold counts as a click (opens the zoom
// overlay) instead of a pan, when drag-to-pan is enabled.
const PAN_CLICK_THRESHOLD = 4;
// Re-render debounce for streaming answers, matching MermaidBlock.
const RENDER_DEBOUNCE_MS = 300;

type MathRenderResult = { html: string } | { error: string };

const renderMath = (source: string): MathRenderResult => {
  try {
    const html = katex.renderToString(source, {
      displayMode: true,
      throwOnError: true,
      strict: 'ignore',
      output: 'html',
    });
    return { html };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

function MathBlock({ code, style, showOpenInPanelButton = true, enablePanZoom = false }: MathBlockProps) {
  const { t } = useTranslation();
  const preview = useOptionalPreviewContext();
  const openPreview = preview?.openPreview;
  const showOpenInPanel = showOpenInPanelButton && typeof openPreview === 'function';
  const blockIdRef = useRef(`math-${Math.random().toString(36).slice(2, 10)}`);
  const preferredViewModeRef = useRef<'preview' | 'source'>('preview');
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const [debouncedCode, setDebouncedCode] = useState(code);
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(() => {
    return (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light';
  });
  // SVG string built from the rendered HTML, for the gallery overlay + export.
  const [svg, setSvg] = useState<string | null>(null);
  // Pan/zoom transform for the rendered formula (only used when enablePanZoom).
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Reset the view whenever a fresh formula renders so a re-render never leaves
  // the user staring at an off-screen, zoomed-in fragment of the previous one.
  const renderResult = useMemo(() => {
    const source = debouncedCode.trim();
    if (!source) return { error: '' } as const;
    return renderMath(source);
  }, [debouncedCode]);
  const html = 'html' in renderResult ? renderResult.html : null;

  useEffect(() => {
    setTransform({ scale: 1, x: 0, y: 0 });
    setViewMode(html ? (preferredViewModeRef.current === 'source' ? 'source' : 'preview') : 'source');
  }, [html]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCode(code), RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [code]);

  useEffect(() => {
    const updateTheme = () => {
      const theme = (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light';
      setCurrentTheme(theme);
    };
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  // Build the exportable SVG from the live formula: KaTeX is HTML, so measure
  // the rendered .katex span and wrap it in an SVG foreignObject with a viewBox
  // sized to the formula. Re-measures on theme change (color is inlined from
  // the live computed style), window resize, and after webfonts finish loading
  // (font metrics can change the formula box).
  useLayoutEffect(() => {
    if (!html) {
      setSvg(null);
      return;
    }
    const measureAndBuild = () => {
      const katexEl = contentRef.current?.querySelector<HTMLElement>('.katex');
      if (!katexEl) return;
      const rect = katexEl.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const color = getComputedStyle(katexEl).color || 'rgb(29, 33, 41)';
      setSvg(buildMathSvg(html, rect.width + MATH_SVG_PADDING * 2, rect.height + MATH_SVG_PADDING * 2, color));
    };
    measureAndBuild();
    let cancelled = false;
    const onResize = () => measureAndBuild();
    window.addEventListener('resize', onResize);
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!cancelled) measureAndBuild();
      });
    }
    return () => {
      window.removeEventListener('resize', onResize);
      cancelled = true;
    };
  }, [html, currentTheme]);

  const zoomBy = (delta: number) =>
    setTransform((prev) => ({
      ...prev,
      scale: Math.min(MAX_MATH_SCALE, Math.max(MIN_MATH_SCALE, Math.round((prev.scale + delta) * 100) / 100)),
    }));
  const resetTransform = () => setTransform({ scale: 1, x: 0, y: 0 });

  const handlePanPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  };

  const handlePanPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (
      !drag.moved &&
      Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) < PAN_CLICK_THRESHOLD
    ) {
      return;
    }
    drag.moved = true;
    setTransform((prev) => ({
      ...prev,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    }));
  };

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const isClick = !drag.moved && event.type === 'pointerup';
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
    // Deferred one tick so the tap's click event cannot land on the freshly
    // mounted overlay backdrop and close it instantly (same as MermaidBlock).
    if (isClick) setTimeout(() => gallery.openGallery(blockIdRef.current), 0);
  };

  const codeTheme = currentTheme === 'dark' ? vs2015 : vs;
  const summary = useMemo(
    () =>
      code
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean),
    [code]
  );
  // Session gallery entry: only registered while a rendered formula is on
  // screen (preview mode), so source-only blocks never clutter the stream.
  const galleryItem = useMemo(
    () =>
      svg && html && viewMode === 'preview'
        ? {
            id: blockIdRef.current,
            svg,
            code,
            type: 'math' as const,
            title:
              summary && summary.length > 0 ? `${summary.slice(0, 48)}${summary.length > 48 ? '...' : ''}` : undefined,
          }
        : null,
    [svg, html, viewMode, code, summary]
  );
  const gallery = useDiagramGallery(galleryItem);
  const previewTitle =
    summary && summary.length > 0
      ? `${t('preview.mathTitle')}: ${summary.slice(0, 48)}${summary.length > 48 ? '...' : ''}`
      : t('preview.mathTitle');

  return (
    <div style={{ width: '100%', minWidth: 0, maxWidth: '100%', ...style }}>
      <div
        style={{
          border: '1px solid var(--bg-3)',
          borderRadius: '0.3rem',
          overflow: 'hidden',
          overflowX: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: 'var(--bg-2)',
            borderTopLeftRadius: '0.3rem',
            borderTopRightRadius: '0.3rem',
            padding: '6px 10px',
            borderBottom: '1px solid var(--bg-3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                textDecoration: 'none',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                lineHeight: '20px',
              }}
            >
              {'<math>'}
            </span>
            {html && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div
                  data-testid='math-toggle-preview'
                  style={{
                    cursor: 'pointer',
                    color: viewMode === 'preview' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: '12px',
                    lineHeight: '20px',
                  }}
                  onMouseDown={(event: React.MouseEvent) => {
                    if (event.button === 0) {
                      event.preventDefault();
                      preferredViewModeRef.current = 'preview';
                      setViewMode('preview');
                    }
                  }}
                >
                  {t('preview.preview')}
                </div>
                <span style={{ color: 'var(--text-secondary)', fontSize: '12px', lineHeight: '20px' }}>/</span>
                <div
                  data-testid='math-toggle-source'
                  style={{
                    cursor: 'pointer',
                    color: viewMode === 'source' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: '12px',
                    lineHeight: '20px',
                  }}
                  onMouseDown={(event: React.MouseEvent) => {
                    if (event.button === 0) {
                      event.preventDefault();
                      preferredViewModeRef.current = 'source';
                      setViewMode('source');
                    }
                  }}
                >
                  {t('preview.source')}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {enablePanZoom && html && viewMode === 'preview' && (
              <>
                <ZoomOut
                  data-testid='math-zoom-out'
                  theme='outline'
                  size='16'
                  style={{ cursor: 'pointer', flexShrink: 0 }}
                  fill='var(--text-secondary)'
                  title={t('preview.zoomOut')}
                  onClick={() => zoomBy(-MATH_ZOOM_STEP)}
                />
                <ZoomIn
                  data-testid='math-zoom-in'
                  theme='outline'
                  size='16'
                  style={{ cursor: 'pointer', flexShrink: 0 }}
                  fill='var(--text-secondary)'
                  title={t('preview.zoomIn')}
                  onClick={() => zoomBy(MATH_ZOOM_STEP)}
                />
                <Refresh
                  data-testid='math-zoom-reset'
                  theme='outline'
                  size='16'
                  style={{ cursor: 'pointer', flexShrink: 0 }}
                  fill='var(--text-secondary)'
                  title={t('preview.zoomReset')}
                  onClick={resetTransform}
                />
              </>
            )}
            {showOpenInPanel && (
              <PreviewOpen
                data-testid='math-open-in-panel'
                theme='outline'
                size='18'
                style={{ cursor: 'pointer', flexShrink: 0 }}
                fill='var(--text-secondary)'
                title={t('preview.openInPanelTooltip')}
                onClick={() => {
                  // The preview panel renders display math natively via
                  // remark-math/rehype-katex, so hand it the $$...$$ form.
                  openPreview(`$$\n${code}\n$$`, 'markdown', {
                    title: previewTitle,
                    editable: false,
                  });
                }}
              />
            )}
            <Copy
              data-testid='math-copy'
              theme='outline'
              size='18'
              style={{ cursor: 'pointer', flexShrink: 0 }}
              fill='var(--text-secondary)'
              onClick={() => {
                void copyText(code)
                  .then(() => {
                    Message.success(t('common.copySuccess'));
                  })
                  .catch(() => {
                    Message.error(t('common.copyFailed'));
                  });
              }}
            />
          </div>
        </div>

        {html && viewMode === 'preview' ? (
          enablePanZoom ? (
            <div
              data-testid='math-diagram'
              style={{
                backgroundColor: 'var(--bg-1)',
                padding: '12px',
                position: 'relative',
                overflow: 'hidden',
                cursor: isPanning ? 'grabbing' : 'grab',
                touchAction: 'none',
              }}
              onPointerDown={handlePanPointerDown}
              onPointerMove={handlePanPointerMove}
              onPointerUp={endPan}
              onPointerCancel={endPan}
            >
              <div
                ref={contentRef}
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                  transformOrigin: 'center center',
                  transition: isPanning ? 'none' : 'transform 0.1s ease-out',
                }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          ) : (
            <div
              ref={contentRef}
              data-testid='math-diagram'
              style={{
                backgroundColor: 'var(--bg-1)',
                padding: '12px',
                overflowX: 'auto',
                display: 'flex',
                justifyContent: 'center',
                cursor: 'zoom-in',
              }}
              onClick={() => gallery.openGallery(blockIdRef.current)}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )
        ) : (
          <SyntaxHighlighter
            children={code}
            language='latex'
            style={codeTheme}
            PreTag='div'
            customStyle={{
              margin: 0,
              borderRadius: 0,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              overflowX: 'auto',
              maxWidth: '100%',
            }}
            codeTagProps={{ style: { color: 'var(--text-primary)' } }}
          />
        )}
      </div>
      {gallery.localOpen && svg && (
        <DiagramZoomOverlay
          svg={svg}
          code={code}
          onClose={() => gallery.setLocalOpenId(null)}
          ariaLabel={t('preview.mathTitle')}
        />
      )}
    </div>
  );
}

export default React.memo(MathBlock);
