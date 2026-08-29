import { ipcBridge } from '@/common';
import { joinPath } from '@/common/chat/chatLib';
import { LoadingTwo } from '@icon-park/react';
import React, { useEffect, useId, useMemo, useState } from 'react';
import { useConversationContextSafe } from '@renderer/hooks/context/ConversationContext';
import { iconColors } from '@/renderer/styles/colors';
import { useDiagramGallery } from '@/renderer/components/Markdown/diagrams/DiagramGalleryContext';
import DiagramZoomOverlay from '@/renderer/components/Markdown/diagrams/DiagramZoomOverlay';
import { buildImageSnapshotSvg } from '@/renderer/components/Markdown/diagrams/diagramExport';

const LocalImageView: React.FC<{
  src: string;
  alt: string;
  className?: string;
  enableGallery?: boolean;
}> = ({ src, alt, className, enableGallery = true }) => {
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
    <>
      <img
        data-diagram-id={cleanId}
        src={url}
        alt={alt}
        className={className}
        style={{ cursor: enableGallery ? 'pointer' : 'default', maxWidth: '100%' }}
        onClick={enableGallery ? () => gallery.openGallery(cleanId) : undefined}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) {
            setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
          }
        }}
        title={alt || undefined}
      />
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
    </>
  );
};

export default LocalImageView;
