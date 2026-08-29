/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { Copy, PreviewOpen, Refresh, ZoomIn, ZoomOut } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const blockIdRef = useRef(`svg-${Math.random().toString(36).slice(2, 10)}`);

  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const preferredViewModeRef = useRef<'preview' | 'source'>('preview');

  const [transform, setTransform] = useState<{ scale: number; x: number; y: number }>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

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
            id: blockIdRef.current,
            svg: cleanSvg,
            code: stripSvgCodeFence(code),
            type: 'svg' as const,
            title: summary || t('preview.svgTitle'),
          }
        : null,
    [cleanSvg, code, summary, viewMode, t]
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

  const handlePanPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const handlePanPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStartRef.current;
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
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const isClick = !drag.moved && event.type === 'pointerup';
    dragStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
    if (isClick) setTimeout(() => gallery.openGallery(blockIdRef.current), 0);
  };

  const handleHeaderDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const interactive = target.closest?.('button, [data-testid]');
    if (interactive && interactive !== event.currentTarget) return;
    if (viewMode !== 'preview') return;
    gallery.openGallery(blockIdRef.current);
  };

  const codeTheme = currentTheme === 'dark' ? vs2015 : vs;

  return (
    <div
      ref={blockRef}
      data-diagram-id={blockIdRef.current}
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
          onPointerDown={enablePanZoom ? handlePanPointerDown : undefined}
          onPointerMove={enablePanZoom ? handlePanPointerMove : undefined}
          onPointerUp={enablePanZoom ? endPan : undefined}
          onPointerCancel={enablePanZoom ? endPan : undefined}
          onClick={!enablePanZoom ? () => gallery.openGallery(blockIdRef.current) : undefined}
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
