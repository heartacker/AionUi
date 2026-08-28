/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { vs, vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import * as echarts from 'echarts';

import { Message } from '@arco-design/web-react';
import { Copy, PreviewOpen } from '@icon-park/react';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { useDiagramGallery, type DiagramItem } from './DiagramGalleryContext';
import DiagramZoomOverlay from './DiagramZoomOverlay';
import { useToolbarHover } from './useToolbarHover';
import { buildChartSnapshotSvg, parseEChartsOption } from './echartsUtils';

type EchartsBlockProps = {
  code: string;
  isDark?: boolean;
  style?: React.CSSProperties;
  showOpenInPanelButton?: boolean;
  diagramPanZoom?: boolean;
};

const DEFAULT_CHART_HEIGHT = 360;

function EchartsBlock({
  code,
  isDark = false,
  style,
  showOpenInPanelButton = true,
  diagramPanZoom: _diagramPanZoom,
}: EchartsBlockProps) {
  const { t } = useTranslation();
  const { openPreview } = usePreviewContext();

  const preferredViewModeRef = useRef<'preview' | 'source'>('preview');
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(() => {
    return (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || (isDark ? 'dark' : 'light');
  });

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

  const containerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const blockIdRef = useRef(`echarts-${Math.random().toString(36).slice(2, 10)}`);
  // Eager gallery registration: once the chart finishes rendering the canvas
  // is snapshotted and registered as an SVG-wrapped item, so every chart joins
  // the gallery stream (thumbnails included) like the SVG-based diagram types
  // — a gallery full of charts shows all of them, not only the opened one.
  const [snapshotSvg, setSnapshotSvg] = useState<string | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toolbarStyle, onMouseEnter, onMouseLeave, onClick, blockRef } = useToolbarHover();

  const parsedOption = useMemo(() => parseEChartsOption(code), [code]);

  const previewTitle = useMemo(() => {
    const summary = code
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return summary && summary.length > 0
      ? `${t('preview.echartsTitle')}: ${summary.slice(0, 48)}${summary.length > 48 ? '...' : ''}`
      : t('preview.echartsTitle');
  }, [code, t]);

  const previewSummary = useMemo(() => {
    const summary = code
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return summary && summary.length > 0 ? `${summary.slice(0, 48)}${summary.length > 48 ? '...' : ''}` : undefined;
  }, [code]);

  const isDarkTheme = currentTheme === 'dark';
  const themeBackground = isDarkTheme ? '#1d2129' : '#ffffff';

  const galleryItem = useMemo(
    () =>
      snapshotSvg && viewMode === 'preview'
        ? {
            id: blockIdRef.current,
            svg: snapshotSvg,
            code,
            type: 'chart' as const,
            title: previewSummary,
            isDark: isDarkTheme,
            panelBackground: themeBackground,
          }
        : null,
    [snapshotSvg, viewMode, code, previewSummary, isDarkTheme, themeBackground]
  );
  const gallery = useDiagramGallery(galleryItem);

  // Snapshot the canvas into an SVG-wrapped PNG data URL. 'finished' fires for
  // every interaction-frame render (tooltips, dataZoom...), so the snapshot is
  // debounced: one snapshot per settle, not one per frame.
  const scheduleChartSnapshot = useCallback(
    (instance: echarts.ECharts) => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = setTimeout(() => {
        snapshotTimerRef.current = null;
        if (chartInstanceRef.current !== instance) return;
        try {
          const width = Math.round(instance.getWidth() * 2);
          const height = Math.round(instance.getHeight() * 2);
          const dataUrl = instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: themeBackground });
          if (width < 1 || height < 1 || !dataUrl) return;
          setSnapshotSvg(buildChartSnapshotSvg(dataUrl, width, height));
        } catch {
          // A failed snapshot keeps the chart out of the gallery stream; the
          // header double-click retries on demand.
        }
      }, 400);
    },
    [themeBackground]
  );

  // Header double-click opens the gallery. The eager snapshot is normally
  // registered by then; the on-demand branch covers the first paint and
  // failed snapshots.
  const handleHeaderDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const interactive = target.closest?.('button, [data-testid]');
    if (interactive && interactive !== event.currentTarget) return;

    const chart = chartInstanceRef.current;
    if (!chart) return; // source view / render error: the instance is disposed

    if (snapshotSvg && viewMode === 'preview') {
      gallery.openGallery(blockIdRef.current);
      return;
    }

    try {
      const width = Math.round(chart.getWidth() * 2);
      const height = Math.round(chart.getHeight() * 2);
      const dataUrl = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: themeBackground });
      if (width < 1 || height < 1 || !dataUrl) return;
      const item: DiagramItem = {
        id: blockIdRef.current,
        svg: buildChartSnapshotSvg(dataUrl, width, height),
        code,
        type: 'chart',
        title: previewSummary,
        isDark: isDarkTheme,
        panelBackground: themeBackground,
      };
      setSnapshotSvg(item.svg);
      gallery.openGalleryWithItem(item);
    } catch {
      Message.error(t('preview.diagramImageExportFailed'));
    }
  };

  const initOrUpdateChart = useCallback(() => {
    if (!containerRef.current || !parsedOption) {
      return;
    }

    try {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }

      const theme = isDarkTheme ? 'dark' : undefined;
      const instance = echarts.init(containerRef.current, theme, {
        renderer: 'canvas',
      });

      const optionToSet = {
        backgroundColor: 'transparent',
        ...parsedOption,
      };

      // Snapshot after every settled render so the gallery item stays current
      // (debounced inside scheduleChartSnapshot).
      instance.on('finished', () => scheduleChartSnapshot(instance));
      instance.setOption(optionToSet, true);
      chartInstanceRef.current = instance;
      scheduleChartSnapshot(instance);
      setRenderError(null);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : String(err));
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    }
  }, [parsedOption, isDarkTheme, scheduleChartSnapshot]);

  useEffect(() => {
    if (viewMode !== 'preview' || !parsedOption) {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
      return;
    }

    initOrUpdateChart();

    const handleResize = () => {
      chartInstanceRef.current?.resize();
    };

    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, [viewMode, parsedOption, initOrUpdateChart]);

  const isValidChart = parsedOption !== null;
  const codeTheme = isDarkTheme ? vs2015 : vs;

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
          data-testid='echarts-header'
          title={t('preview.diagramGalleryOpenHint')}
          onDoubleClick={handleHeaderDoubleClick}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--bg-2)',
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
              {'<echarts>'}
            </span>
            {isValidChart && !renderError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div
                  data-testid='echarts-toggle-preview'
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
                  data-testid='echarts-toggle-source'
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
            {renderError && (
              <span style={{ color: 'var(--color-danger-6, #f53f3f)', fontSize: '11px' }}>
                ({t('preview.renderError')})
              </span>
            )}
          </div>
          <div
            data-testid='echarts-header-actions'
            style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}
          >
            {showOpenInPanelButton && (
              <PreviewOpen
                data-testid='echarts-open-in-panel'
                theme='outline'
                size='18'
                style={{ cursor: 'pointer', flexShrink: 0 }}
                fill='var(--text-secondary)'
                title={t('preview.openInPanelTooltip')}
                onClick={() => {
                  openPreview(`\`\`\`echarts\n${code}\n\`\`\``, 'markdown', {
                    title: previewTitle,
                    editable: false,
                  });
                }}
              />
            )}
            <Copy
              data-testid='echarts-copy'
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

        {isValidChart && viewMode === 'preview' && !renderError ? (
          <div
            data-testid='echarts-diagram'
            ref={containerRef}
            style={{
              width: '100%',
              height: `${DEFAULT_CHART_HEIGHT}px`,
              backgroundColor: 'var(--bg-1)',
              padding: '12px',
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <SyntaxHighlighter
            children={code}
            language='json'
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
      {gallery.localOpen && gallery.localItem && (
        <DiagramZoomOverlay
          svg={gallery.localItem.svg}
          code={code}
          onClose={() => gallery.setLocalOpenId(null)}
          ariaLabel={t('preview.echartsTitle')}
        />
      )}
    </div>
  );
}

export default React.memo(EchartsBlock);
