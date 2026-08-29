/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { Copy, PreviewOpen, Refresh, ZoomIn, ZoomOut } from '@icon-park/react';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { vs, vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { withResponsiveSvg } from '../markdownUtils';
import { useDiagramGallery } from './DiagramGalleryContext';
import DiagramZoomOverlay from './DiagramZoomOverlay';
import { useToolbarHover } from './useToolbarHover';
import { sanitizeAndFormatSvg, stripSvgCodeFence } from './diagramExport';

type SvgBlockProps = {
  code: string;
  style?: React.CSSProperties;
  showOpenInPanelButton?: boolean;
  enablePanZoom?: boolean;
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.25;
const PAN_CLICK_THRESHOLD = 4;

function SvgBlock({ code, style, showOpenInPanelButton = true, enablePanZoom = false }: SvgBlockProps) {
  const { t } = useTranslation();
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document === 'undefined') return 'light';
    return (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
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

  const { openPreview } = usePreviewContext();
  const rawId = useId();
  const cleanId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');

  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const preferredViewModeRef = useRef<'preview' | 'source'>('preview');

  const [transform, setTransform] = useState<{ scale: number; x: number; y: number }>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const cleanSvg = useMemo(() => sanitizeAndFormatSvg(code), [code]);
  const responsivePreviewSvg = useMemo(() => withResponsiveSvg(cleanSvg), [cleanSvg]);

  const summary = useMemo(() => {
    const stripped = stripSvgCodeFence(code);
    const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(stripped);
    if (titleMatch && titleMatch[1].trim()) {
      return titleMatch[1].trim();
    }
    const lines = stripped
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const nonTag = lines.find((l) => !l.startsWith('<?xml') && !l.startsWith('<!--') && !l.startsWith('<svg'));
    return nonTag ? nonTag.slice(0, 48) : '';
  }, [code]);

  const galleryItem = useMemo(
    () =>
      cleanSvg && viewMode === 'preview'
        ? {
            id: cleanId,
            svg: cleanSvg,
            code: stripSvgCodeFence(code),
            type: 'svg' as const,
            title: summary || t('preview.svgTitle'),
          }
        : null,
    [cleanId, cleanSvg, code, summary, viewMode, t]
  );

  const gallery = useDiagramGallery(galleryItem);
  const { toolbarStyle, onMouseEnter, onMouseLeave, onClick, blockRef } = useToolbarHover();

  const handleCopySource = useCallback(() => {
    void copyText(stripSvgCodeFence(code))
      .then(() => Message.success(t('common.copySuccess')))
      .catch(() => Message.error(t('common.copyFailed')));
  }, [code, t]);

  const zoomBy = (delta: number) =>
    setTransform((prev) => ({
      ...prev,
      scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number((prev.scale + delta).toFixed(2)))),
    }));

  const resetZoom = () => setTransform({ scale: 1, x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enablePanZoom || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setTransform((prev) => ({
      ...prev,
      x: dragStartRef.current!.tx + dx,
      y: dragStartRef.current!.ty + dy,
    }));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setIsDragging(false);

    if (start) {
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (moved < PAN_CLICK_THRESHOLD) {
        setTimeout(() => gallery.openGallery(cleanId), 0);
      }
    }
  };

  const handleHeaderDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const interactive = target.closest?.('button, [data-testid]');
    if (interactive && interactive !== event.currentTarget) return;
    if (viewMode !== 'preview') return;
    gallery.openGallery(cleanId);
  };

  const codeTheme = currentTheme === 'dark' ? vs2015 : vs;

  return (
    <div
      ref={blockRef}
      data-diagram-id={cleanId}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      style={{
        ...style,
        position: 'relative',
        margin: '12px 0',
        borderRadius: '8px',
        border: '1px solid var(--bg-3)',
        background: 'var(--bg-2)',
        overflow: 'hidden',
      }}
    >
      {/* Header toolbar */}
      <div
        data-testid='svg-header'
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: 'var(--bg-3)',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          userSelect: 'none',
          cursor: 'pointer',
        }}
        onDoubleClick={handleHeaderDoubleClick}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ fontWeight: 600 }}>{'<svg>'}</span>
          {/* Preview / Source switch */}
          <div
            style={{
              display: 'inline-flex',
              padding: '2px',
              borderRadius: '4px',
              background: 'var(--bg-1)',
              border: '1px solid var(--bg-3)',
              gap: '2px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type='button'
              data-testid='svg-toggle-preview'
              style={{
                padding: '2px 8px',
                borderRadius: '3px',
                border: 'none',
                background: viewMode === 'preview' ? 'var(--bg-3)' : 'transparent',
                color: viewMode === 'preview' ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: viewMode === 'preview' ? 600 : 400,
              }}
              onClick={() => {
                preferredViewModeRef.current = 'preview';
                setViewMode('preview');
              }}
            >
              {t('preview.preview')}
            </button>
            <button
              type='button'
              data-testid='svg-toggle-source'
              style={{
                padding: '2px 8px',
                borderRadius: '3px',
                border: 'none',
                background: viewMode === 'source' ? 'var(--bg-3)' : 'transparent',
                color: viewMode === 'source' ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: viewMode === 'source' ? 600 : 400,
              }}
              onClick={() => {
                preferredViewModeRef.current = 'source';
                setViewMode('source');
              }}
            >
              {t('preview.source')}
            </button>
          </div>
        </div>

        {/* Action icons */}
        <div
          data-testid='svg-header-actions'
          style={{
            ...toolbarStyle,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {viewMode === 'preview' && enablePanZoom && (
            <>
              <button
                type='button'
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
                onClick={() => zoomBy(-ZOOM_STEP)}
                title={t('preview.zoomOut')}
              >
                <ZoomOut theme='outline' size='14' />
              </button>
              <button
                type='button'
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
                onClick={() => zoomBy(ZOOM_STEP)}
                title={t('preview.zoomIn')}
              >
                <ZoomIn theme='outline' size='14' />
              </button>
              <button
                type='button'
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
                onClick={resetZoom}
                title={t('preview.zoomReset')}
              >
                <Refresh theme='outline' size='14' />
              </button>
            </>
          )}

          {showOpenInPanelButton && (
            <button
              type='button'
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
              onClick={() =>
                openPreview(`\`\`\`svg\n${stripSvgCodeFence(code)}\n\`\`\``, 'markdown', {
                  title: t('preview.svgTitle'),
                })
              }
              title={t('preview.openInPanelTooltip')}
            >
              <PreviewOpen theme='outline' size='14' />
            </button>
          )}

          <button
            type='button'
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
            onClick={handleCopySource}
            title={t('preview.diagramCopySource')}
          >
            <Copy theme='outline' size='14' />
          </button>
        </div>
      </div>

      {/* Main content body */}
      {viewMode === 'preview' ? (
        <div
          data-testid='svg-diagram'
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            padding: '16px',
            background: 'var(--bg-1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            cursor: enablePanZoom ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
            touchAction: enablePanZoom ? 'none' : 'auto',
          }}
          onClick={!enablePanZoom ? () => gallery.openGallery(cleanId) : undefined}
        >
          <div
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.15s ease-out',
              maxWidth: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            dangerouslySetInnerHTML={{ __html: responsivePreviewSvg }}
          />
        </div>
      ) : (
        <SyntaxHighlighter
          language='xml'
          style={codeTheme}
          customStyle={{
            margin: 0,
            padding: '12px 16px',
            fontSize: '13px',
            background: 'var(--bg-1)',
          }}
        >
          {stripSvgCodeFence(code)}
        </SyntaxHighlighter>
      )}

      {gallery.localOpen && galleryItem && (
        <DiagramZoomOverlay
          items={[galleryItem]}
          activeId={galleryItem.id}
          onNavigate={() => {}}
          onClose={() => gallery.openGallery('')}
          ariaLabel={t('preview.svgTitle')}
          panelBackground='var(--bg-1)'
        />
      )}
    </div>
  );
}

export default React.memo(SvgBlock);
