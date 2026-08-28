/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import mermaid from 'mermaid';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { vs, vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs';

import { copyText } from '@/renderer/utils/ui/clipboard';
import { Message } from '@arco-design/web-react';
import { Copy, PreviewOpen, Refresh, ZoomIn, ZoomOut } from '@icon-park/react';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDiagramGallery } from './DiagramGalleryContext';
import DiagramZoomOverlay from './DiagramZoomOverlay';
import { useToolbarHover } from './useToolbarHover';
import { getDiagramSummary, withResponsiveSvg } from '../markdownUtils';

type MermaidBlockProps = {
  code: string;
  style?: React.CSSProperties;
  showOpenInPanelButton?: boolean;
  // Enable drag-to-pan + zoom buttons over the rendered diagram. Chat messages and
  // the preview panel opt in via CodeBlock; other callers keep diagrams static by
  // default. Wheel is left to the page so scrolling a long document past a diagram
  // never zooms it (matches the prior Streamdown behaviour the preview shipped with).
  enablePanZoom?: boolean;
};

const MIN_MERMAID_SCALE = 0.25;
const MAX_MERMAID_SCALE = 4;
const MERMAID_ZOOM_STEP = 0.25;
// Pointer movement below this threshold counts as a click (opens the zoom
// overlay) instead of a pan, when drag-to-pan is enabled.
const PAN_CLICK_THRESHOLD = 4;

const MERMAID_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

let initializedTheme: 'light' | 'dark' | null = null;
const ensureMermaidInitialized = (theme: 'light' | 'dark') => {
  if (initializedTheme === theme) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: theme === 'dark' ? 'dark' : 'default',
    fontFamily: MERMAID_FONT_FAMILY,
    fontSize: 14,
  });
  initializedTheme = theme;
};

function MermaidBlock({ code, style, showOpenInPanelButton = true, enablePanZoom = false }: MermaidBlockProps) {
  const { t } = useTranslation();
  const { openPreview } = usePreviewContext();
  const blockIdRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 10)}`);
  const preferredViewModeRef = useRef<'preview' | 'source' | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('source');
  const [debouncedCode, setDebouncedCode] = useState(code);
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(() => {
    return (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light';
  });

  // Pan/zoom transform for the rendered diagram (only used when enablePanZoom).
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

  // NOTE: the fresh-diagram reset (transform) happens inline in the
  // render effect below, batched together with setSvg. Keeping it in a separate
  // [svg] effect left a window where the post-commit reset could land after a
  // user's first zoom click and silently swallow it (flaky on slow CI runners).

  const zoomBy = (delta: number) =>
    setTransform((prev) => ({
      ...prev,
      scale: Math.min(MAX_MERMAID_SCALE, Math.max(MIN_MERMAID_SCALE, Math.round((prev.scale + delta) * 100) / 100)),
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
    // Stay in "click" territory until the pointer travels past the threshold so
    // a plain click opens the zoom overlay instead of nudging the diagram.
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
    // Open one tick after pointerup: the browser dispatches the tap's click
    // event right after pointerup, and if the overlay mounted before it the
    // click would land on the overlay backdrop and close it instantly
    // (the "flashes then closes" bug on touch). Deferring lets the click hit
    // the original block, which is a no-op.
    if (isClick) setTimeout(() => gallery.openGallery(blockIdRef.current), 0);
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCode(code), 300);
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

  useEffect(() => {
    let cancelled = false;
    const source = debouncedCode.trim();

    if (!source) {
      setSvg(null);
      setIsRendering(false);
      setViewMode('source');
      return () => {
        cancelled = true;
      };
    }

    setSvg(null);
    setIsRendering(true);

    const renderDiagram = async () => {
      try {
        ensureMermaidInitialized(currentTheme);

        const { svg: renderedSvg } = await mermaid.render(`${blockIdRef.current}-${Date.now()}`, source);

        if (!cancelled) {
          const withVisibleOverflow = renderedSvg.replace(/<foreignObject\b([^>]*)>/gi, (match, attrs) => {
            if (/style\s*=/i.test(attrs)) {
              return match.replace(
                /style\s*=\s*(["'])(.*?)\1/i,
                (_m, q, val) => `style=${q}${val}; overflow: visible;${q}`
              );
            }
            return `<foreignObject${attrs} style="overflow: visible;">`;
          });
          setSvg(withResponsiveSvg(withVisibleOverflow));
          // Reset the view whenever a fresh diagram renders so a re-render never leaves the
          // user staring at an off-screen, zoomed-in fragment of the previous diagram.
          // Batched with setSvg on purpose (see the NOTE above the pan/zoom state).
          setTransform({ scale: 1, x: 0, y: 0 });
          setIsRendering(false);
          setViewMode(preferredViewModeRef.current === 'source' ? 'source' : 'preview');
        }
      } catch {
        if (!cancelled) {
          setSvg(null);
          setIsRendering(false);
          setViewMode('source');
        }
      }
    };

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [debouncedCode, currentTheme]);

  const codeTheme = currentTheme === 'dark' ? vs2015 : vs;
  const shouldShowLoading = isRendering && preferredViewModeRef.current !== 'source';
  const summary = getDiagramSummary(code, 'mermaid');
  // Session gallery entry: only registered while a rendered diagram is actually
  // on screen (preview mode), so source-only blocks never clutter the stream.
  const galleryItem = useMemo(
    () =>
      svg && viewMode === 'preview'
        ? {
            id: blockIdRef.current,
            svg,
            code,
            type: 'mermaid' as const,
            title:
              summary && summary.length > 0 ? `${summary.slice(0, 48)}${summary.length > 48 ? '...' : ''}` : undefined,
          }
        : null,
    [svg, viewMode, code, summary]
  );
  const gallery = useDiagramGallery(galleryItem);
  const { toolbarStyle, onMouseEnter, onMouseLeave, onClick, blockRef } = useToolbarHover();
  const previewTitle =
    summary && summary.length > 0
      ? `${t('preview.mermaidTitle')}: ${summary.slice(0, 48)}${summary.length > 48 ? '...' : ''}`
      : t('preview.mermaidTitle');

  // Double-clicking the header bar opens the gallery — the unified entry
  // point (ECharts needs it because its canvas swallows pointer events).
  // Double-clicks on the preview/source toggles or the action buttons are
  // excluded: a toggle dblclick would fire two mousedowns (a net-zero view
  // switch) yet still open the overlay.
  const handleHeaderDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const interactive = target.closest?.('button, [data-testid]');
    if (interactive && interactive !== event.currentTarget) return;
    if (!svg || viewMode !== 'preview') return;
    gallery.openGallery(blockIdRef.current);
  };

  return (
    <div
      ref={blockRef}
      style={{ width: '100%', minWidth: 0, maxWidth: '100%', ...style }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <div
        style={{
          border: '1px solid var(--bg-3)',
          borderRadius: '0.3rem',
          overflow: 'hidden',
          overflowX: 'auto',
        }}
      >
        <div
          data-testid='mermaid-header'
          title={t('preview.diagramGalleryOpenHint')}
          onDoubleClick={handleHeaderDoubleClick}
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
            ...toolbarStyle,
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
              {'<mermaid>'}
            </span>
            {svg && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div
                  data-testid='mermaid-toggle-preview'
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
                  data-testid='mermaid-toggle-source'
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
          <div
            data-testid='mermaid-header-actions'
            style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}
          >
            {enablePanZoom && svg && viewMode === 'preview' && (
              <>
                <ZoomOut
                  data-testid='mermaid-zoom-out'
                  theme='outline'
                  size='16'
                  style={{ cursor: 'pointer', flexShrink: 0 }}
                  fill='var(--text-secondary)'
                  title={t('preview.zoomOut')}
                  onClick={() => zoomBy(-MERMAID_ZOOM_STEP)}
                />
                <ZoomIn
                  data-testid='mermaid-zoom-in'
                  theme='outline'
                  size='16'
                  style={{ cursor: 'pointer', flexShrink: 0 }}
                  fill='var(--text-secondary)'
                  title={t('preview.zoomIn')}
                  onClick={() => zoomBy(MERMAID_ZOOM_STEP)}
                />
                <Refresh
                  data-testid='mermaid-zoom-reset'
                  theme='outline'
                  size='16'
                  style={{ cursor: 'pointer', flexShrink: 0 }}
                  fill='var(--text-secondary)'
                  title={t('preview.zoomReset')}
                  onClick={resetTransform}
                />
              </>
            )}
            {showOpenInPanelButton && (
              <PreviewOpen
                data-testid='mermaid-open-in-panel'
                theme='outline'
                size='18'
                style={{ cursor: 'pointer', flexShrink: 0 }}
                fill='var(--text-secondary)'
                title={t('preview.openInPanelTooltip')}
                onClick={() => {
                  openPreview(`\`\`\`mermaid\n${code}\n\`\`\``, 'markdown', {
                    title: previewTitle,
                    editable: false,
                  });
                }}
              />
            )}
            <Copy
              data-testid='mermaid-copy'
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

        {svg && viewMode === 'preview' ? (
          enablePanZoom ? (
            <div
              data-testid='mermaid-diagram'
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
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                  transformOrigin: 'center center',
                  transition: isPanning ? 'none' : 'transform 0.1s ease-out',
                }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          ) : (
            <div
              data-testid='mermaid-diagram'
              style={{
                backgroundColor: 'var(--bg-1)',
                padding: '12px',
                overflowX: 'auto',
                display: 'flex',
                justifyContent: 'center',
                cursor: 'zoom-in',
              }}
              onClick={() => gallery.openGallery(blockIdRef.current)}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )
        ) : shouldShowLoading ? (
          <div
            data-testid='mermaid-loading'
            style={{
              backgroundColor: 'var(--bg-1)',
              padding: '16px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              color: 'var(--text-secondary)',
              fontSize: '13px',
              lineHeight: '20px',
            }}
          >
            <div
              aria-hidden='true'
              className='loading'
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '999px',
                border: '2px solid var(--bg-3)',
                borderTopColor: 'var(--text-secondary)',
                flexShrink: 0,
              }}
            />
            <span>{t('preview.loading')}</span>
          </div>
        ) : (
          <SyntaxHighlighter
            children={code}
            language='mermaid'
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
          ariaLabel={t('preview.mermaidTitle')}
        />
      )}
    </div>
  );
}

export default React.memo(MermaidBlock);
