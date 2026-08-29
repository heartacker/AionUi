import { ipcBridge } from '@/common';
import { joinPath } from '@/common/chat/chatLib';
import { Copy, LoadingTwo, PreviewOpen } from '@icon-park/react';
import React, { useEffect, useId, useMemo, useState } from 'react';
import { useConversationContextSafe } from '@renderer/hooks/context/ConversationContext';
import { iconColors } from '@/renderer/styles/colors';
import { useDiagramGallery } from '@/renderer/components/Markdown/diagrams/DiagramGalleryContext';
import DiagramZoomOverlay from '@/renderer/components/Markdown/diagrams/DiagramZoomOverlay';
import { buildImageSnapshotSvg } from '@/renderer/components/Markdown/diagrams/diagramExport';
import { useToolbarHover } from '@/renderer/components/Markdown/diagrams/useToolbarHover';
import { useTranslation } from 'react-i18next';
import { Message } from '@arco-design/web-react';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';

const LocalImageView: React.FC<{
  src: string;
  alt: string;
  className?: string;
  enableGallery?: boolean;
}> = ({ src, alt, className, enableGallery = true }) => {
  const { t } = useTranslation();
  const { openPreview } = usePreviewContext();
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState(src);
  const rawId = useId();
  const cleanId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');

  // Resolve relative image paths (e.g. ![](./chart.png)) against the conversation
  // workspace = the agent cwd, and pass it as the fs sandbox workspace. Outside a
  // conversation (settings markdown) there is no workspace, so the src is sent
  // through unchanged — matching the previous default root of ''.
  const root = useConversationContextSafe()?.workspace ?? '';

  const absolutePath = useMemo(() => {
    if (!root) return src;
    if (
      src.startsWith('http') ||
      src.startsWith('data:') ||
      src.startsWith('/') ||
      src.startsWith('file:') ||
      src.startsWith('\\') ||
      /^[A-Za-z]:/.test(src)
    ) {
      return src;
    }
    return joinPath(root, src);
  }, [src, root]);

  useEffect(() => {
    if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:')) {
      setUrl(src);
      setLoading(false);
      return;
    }
    setLoading(true);
    ipcBridge.fs.getImageBase64
      .invoke({ path: absolutePath, workspace: root || undefined })
      .then((base64) => {
        if (base64) {
          setUrl(base64);
        }
        setLoading(false);
      })
      .catch((error) => {
        console.error('[LocalImageView] Failed to load image:', {
          path: absolutePath,
          error,
        });
        setLoading(false);
      });
  }, [absolutePath, src, root]);

  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  const snapshotSvg = useMemo(
    () => (!loading && url ? buildImageSnapshotSvg(url, dimensions?.width || 800, dimensions?.height || 600) : ''),
    [loading, url, dimensions]
  );
  const galleryItem = useMemo(
    () =>
      enableGallery && snapshotSvg
        ? {
            id: cleanId,
            svg: snapshotSvg,
            code: url,
            type: 'image' as const,
            title: alt || undefined,
          }
        : null,
    [enableGallery, cleanId, snapshotSvg, url, alt]
  );
  const gallery = useDiagramGallery(galleryItem);
  const { toolbarStyle, onMouseEnter, onMouseLeave, onClick, blockRef } = useToolbarHover();

  const isSvgFile = useMemo(() => {
    const cleanPath = src.split('?')[0].split('#')[0];
    return /\.svg$/i.test(cleanPath);
  }, [src]);

  const label = isSvgFile ? '<svg>' : '<image>';

  const handleCopy = () => {
    void copyText(src)
      .then(() => {
        Message.success(t('common.copySuccess'));
      })
      .catch(() => {
        Message.error(t('common.copyFailed'));
      });
  };

  const handleOpenInPanel = () => {
    openPreview(`![${alt}](${src})`, 'markdown', {
      title: alt || 'Image Preview',
      editable: false,
    });
  };

  if (loading)
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <LoadingTwo
          className='loading'
          style={{ display: 'flex' }}
          theme='outline'
          size='14'
          fill={iconColors.primary}
          strokeWidth={2}
        />
        <span>{alt}</span>
      </span>
    );

  return (
    <div
      ref={blockRef}
      data-diagram-id={cleanId}
      style={{ width: '100%', minWidth: 0, maxWidth: '100%', margin: '8px 0' }}
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
          data-testid='image-header'
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
            {label}
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
            cursor: enableGallery ? 'zoom-in' : 'default',
            overflowX: 'auto',
          }}
          onClick={enableGallery ? () => gallery.openGallery(cleanId) : undefined}
        >
          <img
            src={url}
            alt={alt}
            className={className}
            style={{ maxWidth: '100%', height: 'auto' }}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
              }
            }}
            title={alt || undefined}
          />
        </div>
      </div>
      {gallery.localOpen && galleryItem && (
        <DiagramZoomOverlay
          items={[galleryItem]}
          activeId={galleryItem.id}
          onNavigate={() => {}}
          onClose={() => gallery.openGallery('')}
          ariaLabel={alt || 'Image'}
          panelBackground='var(--bg-1)'
        />
      )}
    </div>
  );
};

export default LocalImageView;
