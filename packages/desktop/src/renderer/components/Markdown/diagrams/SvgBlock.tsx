/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, PreviewOpen } from '@icon-park/react';
import { Message } from '@arco-design/web-react';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useDiagramGallery } from './DiagramGalleryContext';
import DiagramZoomOverlay from './DiagramZoomOverlay';
import { useToolbarHover } from './useToolbarHover';

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
  const [svgString, setSvgString] = useState<string>(code || '');

  useEffect(() => {
    if (code) {
      setSvgString(code);
    } else if (svgRef.current) {
      setSvgString(svgRef.current.outerHTML);
    }
  }, [code, children, rest]);

  const galleryItem = useMemo(() => {
    if (!svgString) return null;
    return {
      id: blockIdRef.current,
      svg: svgString,
      code: svgString,
      type: 'svg' as const,
      title: 'SVG',
    };
  }, [svgString]);

  const gallery = useDiagramGallery(galleryItem);
  const { toolbarStyle, onMouseEnter, onMouseLeave, onClick, blockRef } = useToolbarHover();

  const handleCopy = () => {
    void copyText(svgString)
      .then(() => {
        Message.success(t('common.copySuccess'));
      })
      .catch(() => {
        Message.error(t('common.copyFailed'));
      });
  };

  const handleOpenInPanel = () => {
    openPreview(`\`\`\`xml\n${svgString}\n\`\`\``, 'markdown', {
      title: 'SVG Preview',
      editable: false,
    });
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
          <span
            style={{
              color: 'var(--text-secondary)',
              fontSize: '12px',
              lineHeight: '20px',
            }}
          >
            {'<svg>'}
          </span>
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

        <div
          style={{
            padding: '12px',
            display: 'flex',
            justifyContent: 'center',
            cursor: 'zoom-in',
            overflowX: 'auto',
          }}
          onClick={() => gallery.openGallery(blockIdRef.current)}
        >
          {code ? (
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
      </div>
      {gallery.localOpen && svgString && (
        <DiagramZoomOverlay
          svg={svgString}
          code={svgString}
          onClose={() => gallery.setLocalOpenId(null)}
          ariaLabel='SVG Image'
        />
      )}
    </div>
  );
};

export default SvgBlock;
