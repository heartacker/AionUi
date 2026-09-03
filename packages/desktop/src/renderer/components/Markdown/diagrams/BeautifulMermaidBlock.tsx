/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { vs, vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { renderMermaidASCII, renderMermaidSVG } from 'beautiful-mermaid';

import { Message } from '@arco-design/web-react';
import { Copy, PreviewOpen, Refresh, ZoomIn, ZoomOut } from '@icon-park/react';
import { useOptionalPreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { useDiagramGallery } from './DiagramGalleryContext';
import DiagramZoomOverlay from './DiagramZoomOverlay';
import { useToolbarHover } from './useToolbarHover';
import { getDiagramSummary, withResponsiveSvg } from '../markdownUtils';

type BeautifulMermaidBlockProps = {
  code: string;
  style?: React.CSSProperties;
  showOpenInPanelButton?: boolean;
  enablePanZoom?: boolean;
};

let nextDiagramIndex = 0;

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.25;
const PAN_CLICK_THRESHOLD = 4;

type ViewMode = 'preview' | 'ascii' | 'source';

function BeautifulMermaidBlock({
  code,
  style,
  showOpenInPanelButton = true,
  enablePanZoom = false,
}: BeautifulMermaidBlockProps) {
  const { t } = useTranslation();
  const preview = useOptionalPreviewContext();
  const openPreview = preview?.openPreview;
  const showOpenInPanel = showOpenInPanelButton && typeof openPreview === 'function';
  const preferredViewModeRef = useRef<ViewMode>('preview');
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [debouncedCode, setDebouncedCode] = useState(code);
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(() => {
    return (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light';
  });

  const idRef = useRef<number>(-1);
  if (idRef.current < 0) {
    idRef.current = nextDiagramIndex++;
  }

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

  const svg = useMemo(() => {
    try {
      const raw = renderMermaidSVG(debouncedCode, {
        bg: 'var(--bg-1)',
        fg: 'var(--text-primary)',
        accent: 'var(--color-primary)',
        transparent: true,
      });
      return raw ? withResponsiveSvg(raw) : null;
    } catch {
      return null;
    }
  }, [debouncedCode]);

  const ascii = useMemo(() => {
    try {
      return renderMermaidASCII(debouncedCode, { colorMode: 'none' });
    } catch {
      return null;
    }
  }, [debouncedCode]);

  useEffect(() => {
    if (svg) {
      setViewMode(preferredViewModeRef.current);
    } else {
      setViewMode('source');
    }
    setTransform({ scale: 1, x: 0, y: 0 });
  }, [svg]);

  const codeTheme = currentTheme === 'dark' ? vs2015 : vs;
  const summary = getDiagramSummary(code, 'beautiful-mermaid');
  const previewTitle = useMemo(() => {
    return summary && summary.length > 0
      ? `${t('preview.beautifulMermaidTitle')}: ${summary.slice(0, 48)}${summary.length > 48 ? '...' : ''}`
      : t('preview.beautifulMermaidTitle');
  }, [summary, t]);

  const galleryItem = useMemo(
    () =>
      svg && viewMode === 'preview'
        ? {
            id: String(idRef.current),
            svg,
            code,
            type: 'beautiful-mermaid' as const,
            title:
              summary && summary.length > 0 ? `${summary.slice(0, 48)}${summary.length > 48 ? '...' : ''}` : undefined,
          }
        : null,
    [svg, viewMode, code, summary]
  );
  const gallery = useDiagramGallery(galleryItem);
  const { toolbarStyle, onMouseEnter, onMouseLeave, onClick, blockRef } = useToolbarHover();

  const handleHeaderDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const interactive = target.closest?.('button, [data-testid]');
    if (interactive && interactive !== event.currentTarget) return;
    if (!svg || viewMode !== 'preview') return;
    gallery.openGallery(String(idRef.current));
  };

  const zoomBy = (delta: number) =>
    setTransform((prev) => ({
      ...prev,
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((prev.scale + delta) * 100) / 100)),
    }));
  const resetTransform = () => setTransform({ scale: 1, x: 0, y: 0 });

  const isZoomedIn = transform.scale > 1.05;

  const handlePanPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (isZoomedIn) {
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      setIsPanning(true);
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
      moved: false,
    };
  };

  const handlePanPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!isZoomedIn) return;
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
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* ignore */
    }
    setIsPanning(false);
    if (isClick) setTimeout(() => gallery.openGallery(String(idRef.current)), 0);
  };

  return (
    <div
      ref={blockRef}
      data-diagram-id={String(idRef.current)}
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
        }}
      >
        <div
          data-testid='beautiful-mermaid-header'
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
              {'<beautiful-mermaid>'}
            </span>
            {svg && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div
                  data-testid='beautiful-mermaid-toggle-preview'
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
                {ascii && (
                  <>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '12px', lineHeight: '20px' }}>/</span>
                    <div
                      data-testid='beautiful-mermaid-toggle-ascii'
                      style={{
                        cursor: 'pointer',
                        color: viewMode === 'ascii' ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontSize: '12px',
                        lineHeight: '20px',
                      }}
                      onMouseDown={(event: React.MouseEvent) => {
                        if (event.button === 0) {
                          event.preventDefault();
                          preferredViewModeRef.current = 'ascii';
                          setViewMode('ascii');
                        }
                      }}
                    >
                      {t('preview.ascii')}
                    </div>
                  </>
                )}
                <span style={{ color: 'var(--text-secondary)', fontSize: '12px', lineHeight: '20px' }}>/</span>
                <div
                  data-testid='beautiful-mermaid-toggle-source'
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
            data-testid='beautiful-mermaid-header-actions'
            style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}
          >
            {enablePanZoom && svg && viewMode === 'preview' && (
              <>
                <ZoomOut
                  data-testid='beautiful-mermaid-zoom-out'
                  theme='outline'
                  size='16'
                  style={{ cursor: 'pointer', flexShrink: 0 }}
                  fill='var(--text-secondary)'
                  title={t('preview.zoomOut')}
                  onClick={() => zoomBy(-ZOOM_STEP)}
                />
                <ZoomIn
                  data-testid='beautiful-mermaid-zoom-in'
                  theme='outline'
                  size='16'
                  style={{ cursor: 'pointer', flexShrink: 0 }}
                  fill='var(--text-secondary)'
                  title={t('preview.zoomIn')}
                  onClick={() => zoomBy(ZOOM_STEP)}
                />
                <Refresh
                  data-testid='beautiful-mermaid-zoom-reset'
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
                data-testid='beautiful-mermaid-open-in-panel'
                theme='outline'
                size='18'
                style={{ cursor: 'pointer', flexShrink: 0 }}
                fill='var(--text-secondary)'
                title={t('preview.openInPanelTooltip')}
                onClick={() => {
                  openPreview?.(`\`\`\`beautiful-mermaid\n${code}\n\`\`\``, 'markdown', {
                    title: previewTitle,
                    editable: false,
                  });
                }}
              />
            )}
            <Copy
              data-testid='beautiful-mermaid-copy'
              theme='outline'
              size='18'
              style={{ cursor: 'pointer', flexShrink: 0 }}
              fill='var(--text-secondary)'
              onClick={() => {
                const textToCopy = viewMode === 'ascii' && ascii ? ascii : code;
                void copyText(textToCopy)
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
              data-testid='beautiful-mermaid-diagram'
              style={{
                backgroundColor: 'var(--bg-1)',
                padding: '12px',
                position: 'relative',
                overflow: 'hidden',
                cursor: isPanning ? 'grabbing' : isZoomedIn ? 'grab' : 'zoom-in',
                touchAction: isZoomedIn ? 'none' : 'pan-y',
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
              data-testid='beautiful-mermaid-diagram'
              style={{
                backgroundColor: 'var(--bg-1)',
                padding: '12px',
                overflowX: 'auto',
                display: 'flex',
                justifyContent: 'center',
                cursor: 'zoom-in',
              }}
              onClick={() => gallery.openGallery(String(idRef.current))}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )
        ) : viewMode === 'ascii' && ascii ? (
          <div
            data-testid='beautiful-mermaid-ascii'
            style={{
              padding: '12px 16px',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: '13px',
              lineHeight: '1.4',
              whiteSpace: 'pre',
              overflowX: 'auto',
              color: 'var(--text-primary)',
              backgroundColor: 'var(--bg-1)',
            }}
          >
            {ascii}
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
          ariaLabel={t('preview.beautifulMermaidTitle')}
        />
      )}
    </div>
  );
}

export default React.memo(BeautifulMermaidBlock);
