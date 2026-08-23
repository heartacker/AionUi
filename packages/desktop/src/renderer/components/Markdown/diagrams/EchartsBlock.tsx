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

  const containerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const blockIdRef = useRef(`echarts-${Math.random().toString(36).slice(2, 10)}`);
  // Lazy gallery snapshot: built on the first header double-click and reused
  // afterwards (re-snapshotted when the source changes). ECharts renders to a
  // canvas whose own interactions swallow clicks, so the header double-click
  // is the entry point into the gallery for charts.
  const [chartSnapshot, setChartSnapshot] = useState<DiagramItem | null>(null);
  const gallery = useDiagramGallery(null);
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

  // Snapshot the canvas into an SVG-wrapped PNG data URL and open it in the
  // gallery. The wrapper reuses the gallery's viewBox-based measurement, so
  // the chart behaves exactly like the SVG-based diagram types.
  const handleHeaderDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const interactive = target.closest?.('button, [data-testid]');
    if (interactive && interactive !== event.currentTarget) return;

    const chart = chartInstanceRef.current;
    if (!chart) return; // source view / render error: the instance is disposed

    if (chartSnapshot && chartSnapshot.code === code) {
      gallery.openGallery(chartSnapshot.id);
      return;
    }

    try {
      const width = Math.round(chart.getWidth() * 2);
      const height = Math.round(chart.getHeight() * 2);
      const dataUrl = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
      if (width < 1 || height < 1 || !dataUrl) return;
      const item: DiagramItem = {
        id: blockIdRef.current,
        svg: buildChartSnapshotSvg(dataUrl, width, height),
        code,
        type: 'chart',
        title: previewSummary,
      };
      setChartSnapshot(item);
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

      const theme = isDark ? 'dark' : undefined;
      const instance = echarts.init(containerRef.current, theme, {
        renderer: 'canvas',
      });

      const optionToSet = {
        backgroundColor: 'transparent',
        ...parsedOption,
      };

      instance.setOption(optionToSet, true);
      chartInstanceRef.current = instance;
      setRenderError(null);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : String(err));
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    }
  }, [parsedOption, isDark]);

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
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, [viewMode, parsedOption, initOrUpdateChart]);

  const isValidChart = parsedOption !== null;
  const isDarkTheme = isDark;
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
