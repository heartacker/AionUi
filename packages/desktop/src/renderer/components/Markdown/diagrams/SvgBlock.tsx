/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { vs, vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { Copy, PreviewOpen } from '@icon-park/react';
import { Message } from '@arco-design/web-react';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useDiagramGallery } from './DiagramGalleryContext';
import DiagramZoomOverlay from './DiagramZoomOverlay';
import { useToolbarHover } from './useToolbarHover';
import { stripSvgCodeFence } from './diagramExport';

type SvgBlockProps = React.SVGProps<SVGSVGElement> & {
  code?: string;
  enablePanZoom?: boolean;
  children?: React.ReactNode;
};

export const SvgBlock: React.FC<SvgBlockProps> = ({ children, code, style, enablePanZoom: _epz, ...rest }) => {
  const { t } = useTranslation();
  const { openPreview } = usePreviewContext();
  const blockIdRef = useRef(`svg-${Math.random().toString(36).slice(2, 10)}`);
  const svgRef = useRef<SVGSVGElement>(null);
  const preferredViewModeRef = useRef<'preview' | 'source'>('preview');
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(() => {
    return (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light';
      setCurrentTheme(theme);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const rawSource = code || '';
  const cleanSvg = useMemo(() => {
    if (code) return stripSvgCodeFence(code);
    return '';
  }, [code]);

  const [svgString, setSvgString] = useState<string>(cleanSvg || rawSource);

  useEffect(() => {
    if (cleanSvg) {
      setSvgString(cleanSvg);
    } else if (svgRef.current) {
      setSvgString(svgRef.current.outerHTML);
    }
  }, [cleanSvg, children, rest]);

  const galleryItem = useMemo(() => {
    if (!svgString) return null;
    return {
      id: blockIdRef.current,
      svg: svgString,
      code: rawSource || svgString,
      type: 'svg' as const,
      title: 'SVG',
    };
  }, [svgString, rawSource]);

  const gallery = useDiagramGallery(galleryItem);
  const { toolbarStyle, onMouseEnter, onMouseLeave, onClick, blockRef } = useToolbarHover();

  const handleCopy = () => {
    void copyText(rawSource || svgString)
      .then(() => {
        Message.success(t('common.copySuccess'));
      })
      .catch(() => {
        Message.error(t('common.copyFailed'));
      });
  };

  const handleOpenInPanel = () => {
    openPreview(`\`\`\`xml\n${rawSource || svgString}\n\`\`\``, 'markdown', {
      title: 'SVG Preview',
      editable: false,
    });
  };

  const handleHeaderDoubleClick = () => {
    gallery.openGallery(blockIdRef.current);
  };

  const svgRestProps = rest as React.SVGProps<SVGSVGElement>;

  return (
    <div
      ref={blockRef}
      data-diagram-id={blockIdRef.current}
      style={{ width: '100%', minWidth: 0, maxWidth: '100%', margin: '8px 0', ...style }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <div
        style={{
          border: '1px solid var(--bg-3)',
          borderRadius: '0.3rem',
          overflow: 'hidden',
          backgroundColor: 'var(--bg-1)',
        }}
      >
        <div
          data-testid='svg-header'
          title={t('preview.diagramGalleryOpenHint')}
          onDoubleClick={handleHeaderDoubleClick}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: 'var(--bg-2)',
            padding: '6px 10px',
            borderBottom: '1px solid var(--bg-3)',
            ...toolbarStyle,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                color: 'var(--text-secondary)',
                fontSize: '12px',
                lineHeight: '20px',
              }}
            >
              {'<svg>'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div
                data-testid='svg-toggle-preview'
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
                onClick={(event: React.MouseEvent) => {
                  event.preventDefault();
                  preferredViewModeRef.current = 'preview';
                  setViewMode('preview');
                }}
              >
                {t('preview.preview')}
              </div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '12px', lineHeight: '20px' }}>/</span>
              <div
                data-testid='svg-toggle-source'
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
                onClick={(event: React.MouseEvent) => {
                  event.preventDefault();
                  preferredViewModeRef.current = 'source';
                  setViewMode('source');
                }}
              >
                {t('preview.source')}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PreviewOpen
              theme='outline'
              size='18'
              style={{ cursor: 'pointer', flexShrink: 0 }}
              fill='var(--text-secondary)'
              title={t('preview.openInPanelTooltip')}
              onClick={(e) => {
                e.stopPropagation();
                handleOpenInPanel();
              }}
            />
            <Copy
              theme='outline'
              size='18'
              style={{ cursor: 'pointer', flexShrink: 0 }}
              fill='var(--text-secondary)'
              onClick={(e) => {
                e.stopPropagation();
                handleCopy();
              }}
            />
          </div>
        </div>

        {viewMode === 'source' ? (
          <div data-testid='svg-source' style={{ backgroundColor: 'var(--bg-1)' }}>
            <SyntaxHighlighter
              language='xml'
              style={currentTheme === 'dark' ? vs2015 : vs}
              customStyle={{
                margin: 0,
                padding: '12px',
                backgroundColor: 'transparent',
                fontSize: '13px',
                lineHeight: '1.5',
              }}
              codeTagProps={{
                style: {
                  fontFamily: 'var(--font-mono, monospace)',
                },
              }}
            >
              {rawSource || svgString}
            </SyntaxHighlighter>
          </div>
        ) : (
          <div
            data-testid='svg-diagram'
            style={{
              padding: '12px',
              display: 'flex',
              justifyContent: 'center',
              cursor: 'zoom-in',
              overflowX: 'auto',
            }}
            onClick={() => gallery.openGallery(blockIdRef.current)}
          >
            {cleanSvg ? (
              <div
                style={{ display: 'flex', justifyContent: 'center', width: '100%' }}
                dangerouslySetInnerHTML={{ __html: cleanSvg }}
              />
            ) : code ? (
              <div
                style={{ display: 'flex', justifyContent: 'center', width: '100%' }}
                dangerouslySetInnerHTML={{ __html: code }}
              />
            ) : (
              <svg ref={svgRef} {...svgRestProps} style={{ maxWidth: '100%', height: 'auto', ...svgRestProps.style }}>
                {children}
              </svg>
            )}
          </div>
        )}
      </div>
      {gallery.localOpen && svgString && (
        <DiagramZoomOverlay
          svg={svgString}
          code={rawSource || svgString}
          onClose={() => gallery.setLocalOpenId(null)}
          ariaLabel='SVG Image'
        />
      )}
    </div>
  );
};

export default SvgBlock;
