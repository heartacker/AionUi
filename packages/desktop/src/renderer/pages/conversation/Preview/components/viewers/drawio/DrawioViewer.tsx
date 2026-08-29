/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ChatFileRef } from '@/common/types/chatFile';
import { Button, Dropdown, Menu, Message, Spin, Tooltip } from '@arco-design/web-react';
import { Down, EditOne, FullScreenOne, LinkOne, PreviewOpen, Refresh, ZoomIn, ZoomOut } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePreviewToolbarExtras } from '../../../context/PreviewToolbarExtrasContext';
import { useThemeDetection } from '../../../hooks';
import { getClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import {
  buildDrawioViewerUrl,
  DEFAULT_DRAWIO_APP_URL,
  type DrawioMode,
  type DrawioPage,
  parseDrawioPages,
  resolveDrawioBaseUrl,
} from './drawioUtils';

export interface DrawioViewerProps {
  content: string;
  file_path?: string;
  fileRef?: ChatFileRef;
  workspace?: string;
  tabId?: string;
  isDirty?: boolean;
  onContentChange?: (content: string) => void;
  hideToolbar?: boolean;
}

const LOAD_TIMEOUT_MS = 10000;

export const DrawioViewer: React.FC<DrawioViewerProps> = ({
  content,
  file_path,
  fileRef,
  onContentChange,
  hideToolbar = false,
}) => {
  const { t } = useTranslation();
  const currentTheme = useThemeDetection();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pages, setPages] = useState<DrawioPage[]>([]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [drawioMode, setDrawioMode] = useState<DrawioMode>('edit');
  const [customDrawioUrl, setCustomDrawioUrl] = useState<string | undefined>();
  const [iframeKey, setIframeKey] = useState(0);
  const [messageApi, messageContextHolder] = Message.useMessage();

  const toolbarExtrasContext = usePreviewToolbarExtras();

  // Load custom Draw.io server URL setting
  useEffect(() => {
    let active = true;
    void getClientBusinessSetting('preview.drawioUrl')
      .then((val) => {
        if (active && val) setCustomDrawioUrl(val);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Parse pages on content change
  useEffect(() => {
    let active = true;
    void parseDrawioPages(content).then((result) => {
      if (!active) return;
      if (result.pages.length > 0) {
        setPages(result.pages);
        if (activePageIndex >= result.pages.length) {
          setActivePageIndex(0);
        }
      } else {
        setPages([]);
      }
    });
    return () => {
      active = false;
    };
  }, [content, activePageIndex]);

  // Handle postMessage communication with Diagrams.net / Draw.io iframe
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    setLoading(true);
    setLoadError(null);

    timeoutId = setTimeout(() => {
      setLoading(false);
      setLoadError(t('preview.drawio.timeout', { defaultValue: 'Viewer loading timed out' }));
    }, LOAD_TIMEOUT_MS);

    const handleMessage = (event: MessageEvent) => {
      if (!event.data) return;

      let data = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }

      if (data.event === 'configure') {
        const iframeWin = iframeRef.current?.contentWindow;
        if (iframeWin) {
          iframeWin.postMessage(
            JSON.stringify({
              action: 'configure',
              config: {
                defaultFonts: ['Helvetica', 'Arial', 'sans-serif'],
                compressXml: false,
              },
            }),
            '*'
          );
        }
      } else if (data.event === 'init') {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        setLoading(false);
        setLoadError(null);

        // Send diagram XML payload to iframe
        const iframeWin = iframeRef.current?.contentWindow;
        if (iframeWin) {
          iframeWin.postMessage(
            JSON.stringify({
              action: 'load',
              xml: content,
              page: activePageIndex,
              autosave: drawioMode === 'edit' ? 1 : 0,
            }),
            '*'
          );
        }
      } else if (data.event === 'load') {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        setLoading(false);
        setLoadError(null);
      } else if (data.event === 'save') {
        if (data.xml && typeof data.xml === 'string' && onContentChange) {
          onContentChange(data.xml);
          messageApi.success(t('preview.drawio.saveSuccess', { defaultValue: 'Diagram saved' }));
        }
      } else if (data.event === 'autosave') {
        if (data.xml && typeof data.xml === 'string' && onContentChange) {
          onContentChange(data.xml);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      window.removeEventListener('message', handleMessage);
    };
  }, [content, activePageIndex, iframeKey, drawioMode, onContentChange, messageApi, t]);

  // Page switcher
  const handlePageSelect = useCallback(
    (index: number) => {
      setActivePageIndex(index);
      const iframeWin = iframeRef.current?.contentWindow;
      if (iframeWin) {
        iframeWin.postMessage(
          JSON.stringify({
            action: 'load',
            xml: content,
            page: index,
            autosave: 0,
          }),
          '*'
        );
      }
    },
    [content]
  );

  // Zoom and fit controls
  const handleZoom = useCallback((direction: 'in' | 'out' | 'fit') => {
    const iframeWin = iframeRef.current?.contentWindow;
    if (!iframeWin) return;
    if (direction === 'fit') {
      iframeWin.postMessage(JSON.stringify({ action: 'fit' }), '*');
    } else {
      iframeWin.postMessage(JSON.stringify({ action: 'zoom', zoom: direction }), '*');
    }
  }, []);

  // Reload iframe
  const handleRetry = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    setIframeKey((prev) => prev + 1);
  }, []);

  // Open in system app
  const handleOpenInSystem = useCallback(async () => {
    if (fileRef) {
      try {
        await ipcBridge.fs.openSystem.invoke({ file: fileRef });
      } catch (err) {
        console.error('Failed to open Draw.io in system:', err);
      }
    } else if (file_path) {
      try {
        await ipcBridge.shell.openFile.invoke(file_path);
      } catch (err) {
        console.error('Failed to open Draw.io in system:', err);
      }
    }
  }, [fileRef, file_path]);

  // Open in Diagrams.net online or custom Draw.io web app
  const handleOpenDiagramsNet = useCallback(() => {
    const customResolved = customDrawioUrl ? resolveDrawioBaseUrl(customDrawioUrl) : '';
    const targetUrl = customResolved || DEFAULT_DRAWIO_APP_URL;
    window.open(targetUrl, '_blank');
  }, [customDrawioUrl]);

  // Viewer iframe URL
  const viewerUrl = useMemo(() => {
    return buildDrawioViewerUrl({
      mode: drawioMode,
      page: activePageIndex,
      theme: currentTheme === 'dark' ? 'dark' : 'light',
      baseUrl: customDrawioUrl,
    });
  }, [drawioMode, activePageIndex, currentTheme, customDrawioUrl]);

  // Inject toolbar extras
  useEffect(() => {
    if (!toolbarExtrasContext || hideToolbar) return;

    const pageMenu = (
      <Menu
        onClickMenuItem={(key) => {
          const index = parseInt(key, 10);
          if (!isNaN(index)) {
            handlePageSelect(index);
          }
        }}
      >
        {pages.map((p, idx) => (
          <Menu.Item key={String(idx)} className={idx === activePageIndex ? 'text-brand font-medium' : ''}>
            {p.name || t('preview.drawio.page', { page: idx + 1, defaultValue: `Page ${idx + 1}` })}
          </Menu.Item>
        ))}
      </Menu>
    );

    const activePageTitle =
      pages[activePageIndex]?.name ||
      t('preview.drawio.page', { page: activePageIndex + 1, defaultValue: `Page ${activePageIndex + 1}` });

    toolbarExtrasContext.setExtras({
      left: (
        <div className='flex items-center gap-6px text-12px'>
          {pages.length > 1 && (
            <Dropdown droplist={pageMenu} trigger='click' position='bl'>
              <Button size='mini' type='secondary' className='flex items-center gap-4px px-8px h-24px text-12px'>
                <span className='max-w-120px truncate'>{activePageTitle}</span>
                <Down size={12} />
              </Button>
            </Dropdown>
          )}
          <Tooltip
            content={
              drawioMode === 'edit'
                ? t('preview.drawio.switchToView', { defaultValue: 'Switch to View Mode' })
                : t('preview.drawio.switchToEdit', { defaultValue: 'Switch to Visual Edit Mode' })
            }
            mini
          >
            <Button
              size='mini'
              type={drawioMode === 'edit' ? 'primary' : 'secondary'}
              className='flex items-center gap-4px px-8px h-24px text-12px'
              onClick={() => setDrawioMode((prev) => (prev === 'edit' ? 'view' : 'edit'))}
            >
              {drawioMode === 'edit' ? <EditOne size={12} /> : <PreviewOpen size={12} />}
              <span>
                {drawioMode === 'edit'
                  ? t('preview.drawio.editMode', { defaultValue: 'Visual Edit' })
                  : t('preview.drawio.viewMode', { defaultValue: 'View' })}
              </span>
            </Button>
          </Tooltip>
        </div>
      ),
      right: (
        <div className='flex items-center gap-4px'>
          {drawioMode === 'view' && (
            <>
              <Tooltip content={t('preview.drawio.zoomIn', { defaultValue: 'Zoom In' })} mini>
                <Button
                  size='mini'
                  type='text'
                  className='h-24px px-6px text-t-secondary hover:text-t-primary'
                  icon={<ZoomIn size={14} />}
                  onClick={() => handleZoom('in')}
                />
              </Tooltip>
              <Tooltip content={t('preview.drawio.zoomOut', { defaultValue: 'Zoom Out' })} mini>
                <Button
                  size='mini'
                  type='text'
                  className='h-24px px-6px text-t-secondary hover:text-t-primary'
                  icon={<ZoomOut size={14} />}
                  onClick={() => handleZoom('out')}
                />
              </Tooltip>
              <Tooltip content={t('preview.drawio.fitView', { defaultValue: 'Fit to View' })} mini>
                <Button
                  size='mini'
                  type='text'
                  className='h-24px px-6px text-t-secondary hover:text-t-primary'
                  icon={<FullScreenOne size={14} />}
                  onClick={() => handleZoom('fit')}
                />
              </Tooltip>
            </>
          )}
          <Tooltip content={t('preview.drawio.openInApp', { defaultValue: 'Open in Diagrams.net' })} mini>
            <Button
              size='mini'
              type='text'
              className='h-24px px-6px text-t-secondary hover:text-t-primary'
              icon={<LinkOne size={14} />}
              onClick={handleOpenDiagramsNet}
            />
          </Tooltip>
        </div>
      ),
    });

    return () => {
      toolbarExtrasContext.setExtras(null);
    };
  }, [
    toolbarExtrasContext,
    hideToolbar,
    pages,
    activePageIndex,
    drawioMode,
    handlePageSelect,
    handleZoom,
    handleOpenDiagramsNet,
    t,
  ]);

  return (
    <div className='relative w-full h-full flex flex-col flex-1 bg-bg-1 overflow-hidden'>
      {messageContextHolder}

      {loading && (
        <div className='absolute inset-0 z-10 flex flex-col items-center justify-center bg-bg-1/80 backdrop-blur-xs gap-12px'>
          <Spin size={28} />
          <span className='text-13px text-t-secondary'>
            {t('preview.drawio.loading', { defaultValue: 'Loading Draw.io diagram...' })}
          </span>
        </div>
      )}

      {loadError && !loading && (
        <div className='absolute inset-0 z-10 flex flex-col items-center justify-center bg-bg-1 p-24px gap-14px text-center'>
          <div className='text-15px font-medium text-t-primary'>
            {t('preview.drawio.loadFailed', { defaultValue: 'Failed to load Draw.io diagram' })}
          </div>
          <div className='text-12px text-t-secondary max-w-480px'>{loadError}</div>
          <div className='flex items-center gap-8px'>
            <Button type='primary' size='small' icon={<Refresh size={14} />} onClick={handleRetry}>
              {t('common.retry', { defaultValue: 'Retry' })}
            </Button>
            <Button size='small' onClick={handleOpenInSystem}>
              {t('preview.openInSystemApp', { defaultValue: 'Open in system app' })}
            </Button>
          </div>
        </div>
      )}

      <iframe
        key={iframeKey}
        ref={iframeRef}
        src={viewerUrl}
        title='Draw.io Viewer'
        className='w-full h-full border-none flex-1 bg-transparent'
        sandbox='allow-scripts allow-same-origin allow-popups allow-forms allow-downloads'
      />
    </div>
  );
};

export default DrawioViewer;
