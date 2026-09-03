/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ArrowLeft,
  ArrowRight,
  Close,
  Copy,
  Download,
  Help,
  Picture,
  Refresh,
  ZoomIn,
  ZoomOut,
} from '@icon-park/react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Message } from '@arco-design/web-react';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { ensureSvgViewBox, getSvgIntrinsicSize, type DiagramSize } from '../markdownUtils';
import { copySvgImage, prepareDiagramSvgForExport, saveDiagramImage, type DiagramExportFormat } from './diagramExport';
import { prepareMathSvgForExport } from './mathExport';
import type { DiagramItem } from './DiagramGalleryContext';

/**
 * Single-diagram mode keeps the original zoom overlay API (svg + onClose);
 * gallery mode receives the whole registered stream plus the active id and
 * adds prev/next navigation, a position counter and Home/End jump keys.
 */
type DiagramZoomOverlayProps = {
  svg?: string;
  onClose: () => void;
  /** Accessible name for the dialog (e.g. the diagram type title). */
  ariaLabel?: string;
  /**
   * Explicit card backdrop color. Diagram types whose strokes depend on the
   * backdrop (WaveDrom: the dark skin paints pure-white lines) pass a
   * deterministic color here so lines stay visible even when the --bg-1 token
   * resolves to the wrong value; other types keep the token default.
   */
  panelBackground?: string;
  /** Gallery mode: all registered diagrams in stream order. */
  items?: DiagramItem[];
  /** Gallery mode: id of the diagram currently highlighted. */
  activeId?: string;
  /** Gallery mode: switch the highlight to another diagram's id. */
  onNavigate?: (id: string) => void;
  /** Single mode: raw source code for the copy-source toolbar action. */
  code?: string;
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const BUTTON_ZOOM_FACTOR = 1.2;
const WHEEL_ZOOM_FACTOR = 1.1;
// Viewport padding used when auto-fitting the diagram on open.
const FIT_PADDING = 80;
// Overlay viewport caps (percentage of the window) for deeply zoomed diagrams.
const MAX_BOX_WIDTH = '90vw';
const MAX_BOX_HEIGHT = '85vh';
// Touch swipe: horizontal displacement past this threshold with at least 2:1
// horizontal dominance flips to the next/previous diagram (touch pointers only,
// at fit scale — a zoomed-in diagram pans instead, like every photo gallery).
const SWIPE_THRESHOLD = 50;
const SWIPE_UP_THRESHOLD = 60;
const DOUBLE_TAP_DELAY = 280;

const isTestEnv = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
// Small pointer movement below this counts as a tap, not a drag.
const DRAG_THRESHOLD = 4;

/** Evaluate a media query defensively: jsdom and very old browsers lack matchMedia. */
const matchMediaQuery = (query: string): boolean => {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
};

const toolbarButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '6px',
  border: 'none',
  borderRadius: '6px',
  background: 'transparent',
  cursor: 'pointer',
};

// Diagram blocks inject `max-width: min(100%, <natural width>)` into the SVG root
// so inline diagrams never stretch past their natural size. Drop that cap here:
// the overlay panel already sizes the wrapper from the natural dimensions and
// the SVG must fill it. Roots with a viewBox (Mermaid, WaveDrom, SVG) are also forced
// to fill the panel.
const stripInlineMaxWidth = (svg: string): string => {
  const withViewBox = ensureSvgViewBox(svg);
  return withViewBox.replace(/<svg\b[^>]*>/i, (tag) => {
    const cleaned = tag.replace(/max-width\s*:\s*[^;"']+;?/gi, '');
    const fillRules = 'width: 100%; height: 100%;';
    const styleMatch = /(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/i.exec(cleaned);
    if (styleMatch) {
      return cleaned.replace(
        styleMatch[0],
        `${styleMatch[1]}${styleMatch[2]}${styleMatch[3]}${fillRules}${styleMatch[2]}`
      );
    }
    return cleaned.replace(/\/?\s*>$/, (tail) => ` style="${fillRules}"${tail}`);
  });
};

/**
 * Synchronously calculate diagram natural size and contain-fit scale against viewport.
 */
export const computeDiagramFit = (
  svg: string,
  hasThumbs: boolean,
  isMobileOrTablet: boolean
): { base: DiagramSize; fitScale: number } => {
  const intrinsic = getSvgIntrinsicSize(svg) ?? { width: 800, height: 600 };
  if (typeof window === 'undefined') {
    return { base: intrinsic, fitScale: 1 };
  }
  const horizontalPadding = isMobileOrTablet ? 0 : FIT_PADDING * 2;
  const topChrome = isMobileOrTablet ? 56 : FIT_PADDING;
  const bottomChrome = hasThumbs ? (isMobileOrTablet ? 110 : 170) : isMobileOrTablet ? 56 : FIT_PADDING;
  const availableWidth = Math.max(100, window.innerWidth - horizontalPadding);
  const availableHeight = Math.max(100, window.innerHeight - topChrome - bottomChrome);
  const fitScale = Math.min(availableWidth / intrinsic.width, availableHeight / intrinsic.height);
  const clamped = Math.min(Math.max(fitScale, MIN_SCALE), MAX_SCALE);
  return { base: intrinsic, fitScale: clamped };
};

/**
 * Fullscreen diagram viewer opened by clicking a rendered diagram (shared by the
 * Mermaid and WaveDrom blocks).
 *
 * Interaction follows the classic lightbox pattern: wheel zooms around the fit
 * scale (0.1x-10x), dragging pans, ESC / backdrop click / the close button close
 * it. Visuals stick to AionUi tokens: Arco mask, --bg-* panels and icon-park icons
 * in the same order as the inline block header (zoom out / zoom in / reset), plus
 * a close action.
 *
 * Sizing: the card hugs the diagram's natural aspect ratio and grows with the
 * zoom level. The overlay root is the only clip window, so content is cut off
 * only at the screen edges — never by a smaller panel while free space is still
 * available. Pan moves the card across the screen; deep zooms clip at the
 * viewport and stay draggable. The open scale is a contain-fit against the
 * viewport (padding 80px), so whichever side of the diagram is larger
 * constrains the fit — a tall diagram fits by height instead of stretching
 * across the screen.
 */
function DiagramZoomOverlay({
  svg,
  onClose,
  ariaLabel,
  panelBackground,
  items,
  activeId,
  onNavigate,
  code,
}: DiagramZoomOverlayProps) {
  const { t } = useTranslation();
  const overlayRef = useRef<HTMLDivElement>(null);

  // Gallery mode highlights one item of the registered stream; single mode is
  // the previous behavior with the svg handed in directly.
  const isGallery = items != null && activeId != null;
  const activeIndex = isGallery ? items.findIndex((item) => item.id === activeId) : -1;
  const activeItem = isGallery && activeIndex >= 0 ? items[activeIndex] : null;
  const overlaySvg = useMemo(() => stripInlineMaxWidth(activeItem ? activeItem.svg : (svg ?? '')), [activeItem, svg]);

  // Previous and next items for the sliding carousel track
  const prevIndex = activeIndex > 0 ? activeIndex - 1 : -1;
  const nextIndex = isGallery && items && activeIndex < items.length - 1 ? activeIndex + 1 : -1;
  const prevItem = isGallery && items && prevIndex >= 0 ? items[prevIndex] : null;
  const nextItem = isGallery && items && nextIndex >= 0 ? items[nextIndex] : null;

  // Adaptive layout: mobile & tablet screens get edge-to-edge album view and bigger touch targets
  const [isSmallScreen, setIsSmallScreen] = useState(
    () => matchMediaQuery('(max-width: 640px)') || matchMediaQuery('(max-width: 768px)')
  );
  const [isTouchDevice, setIsTouchDevice] = useState(() => matchMediaQuery('(pointer: coarse)'));
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const small640 = window.matchMedia?.('(max-width: 640px)');
    const small768 = window.matchMedia?.('(max-width: 768px)');
    const coarseQuery = window.matchMedia?.('(pointer: coarse)');
    const update = () => {
      setIsSmallScreen(Boolean(small640?.matches || small768?.matches));
      setIsTouchDevice(Boolean(coarseQuery?.matches));
    };
    small640?.addEventListener?.('change', update);
    small768?.addEventListener?.('change', update);
    coarseQuery?.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    return () => {
      small640?.removeEventListener?.('change', update);
      small768?.removeEventListener?.('change', update);
      coarseQuery?.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const isMobileOrTablet = isSmallScreen || isTouchDevice;
  const hasThumbs = isGallery && (items?.length ?? 0) > 1;

  // Pre-calculate contain-fit dimensions synchronously for active, prev, and next diagrams
  const activeFit = useMemo(
    () => computeDiagramFit(overlaySvg, hasThumbs, isMobileOrTablet),
    [overlaySvg, hasThumbs, isMobileOrTablet]
  );
  const prevFit = useMemo(
    () => (prevItem ? computeDiagramFit(stripInlineMaxWidth(prevItem.svg), hasThumbs, isMobileOrTablet) : null),
    [prevItem, hasThumbs, isMobileOrTablet]
  );
  const nextFit = useMemo(
    () => (nextItem ? computeDiagramFit(stripInlineMaxWidth(nextItem.svg), hasThumbs, isMobileOrTablet) : null),
    [nextItem, hasThumbs, isMobileOrTablet]
  );

  const [base, setBase] = useState<DiagramSize | null>(() => activeFit.base);
  const [scale, setScale] = useState<number>(() => activeFit.fitScale);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [slideOffset, setSlideOffset] = useState(0);
  const [dismissOffsetY, setDismissOffsetY] = useState(0);
  const [isSliding, setIsSliding] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushedHistoryRef = useRef(false);

  // Multi-pointer gesture state: one pointer pans / may swipe-navigate (touch),
  // two pointers pinch-zoom around the moving midpoint.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const swipeRef = useRef<{
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    isBackdrop?: boolean;
  } | null>(null);
  const pinchRef = useRef<{
    startDistance: number;
    startScale: number;
    startX: number;
    startY: number;
    startMidX: number;
    startMidY: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const initialScaleRef = useRef<number>(activeFit.fitScale);

  // Switching diagrams re-runs the sizing pipeline from scratch: immediately apply the
  // pre-computed fit scale so there is no unscaled or jumpy intermediate frame.
  const activeKey = activeItem?.id ?? 'single';
  useLayoutEffect(() => {
    setBase(activeFit.base);
    setScale(activeFit.fitScale);
    initialScaleRef.current = activeFit.fitScale;
    setTranslate({ x: 0, y: 0 });
    setSlideOffset(0);
  }, [activeKey, activeFit]);

  // Fallback DOM measurement for SVGs without intrinsic dimensions / viewBox
  useLayoutEffect(() => {
    if (getSvgIntrinsicSize(overlaySvg)) return;
    const svgElement = overlayRef.current?.querySelector('svg');
    const width = svgElement?.scrollWidth || svgElement?.clientWidth;
    const height = svgElement?.scrollHeight || svgElement?.clientHeight;
    if (width && height && (width !== base?.width || height !== base?.height)) {
      const newBase = { width, height };
      setBase(newBase);
      const horizontalPadding = isMobileOrTablet ? 0 : FIT_PADDING * 2;
      const topChrome = isMobileOrTablet ? 56 : FIT_PADDING;
      const bottomChrome = hasThumbs ? (isMobileOrTablet ? 110 : 170) : isMobileOrTablet ? 56 : FIT_PADDING;
      const fitScale = Math.min(
        (window.innerWidth - horizontalPadding) / width,
        (window.innerHeight - topChrome - bottomChrome) / height
      );
      const clamped = Math.min(Math.max(fitScale, MIN_SCALE), MAX_SCALE);
      initialScaleRef.current = clamped;
      setScale(clamped);
    }
  }, [overlaySvg, base, hasThumbs, isMobileOrTablet]);

  // Prevent background webpage scrolling or zooming when gallery overlay is open on touch devices
  useEffect(() => {
    const element = overlayRef.current;
    if (!element) return;
    const preventTouch = (event: TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-testid="diagram-gallery-thumbs"], [data-testid="diagram-overlay-help-panel"]')) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
    };
    element.addEventListener('touchmove', preventTouch, { passive: false });
    return () => {
      element.removeEventListener('touchmove', preventTouch);
    };
  }, []);

  // Support mobile hardware/browser back button: push history state and close on popstate
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.history.pushState({ aionGalleryOpen: true }, '');
      pushedHistoryRef.current = true;
    } catch {
      /* ignore */
    }

    const handlePopState = () => {
      pushedHistoryRef.current = false;
      onClose();
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (pushedHistoryRef.current && window.history.state?.aionGalleryOpen) {
        pushedHistoryRef.current = false;
        try {
          window.history.back();
        } catch {
          /* ignore */
        }
      }
    };
  }, [onClose]);

  // Wheel zoom needs a native listener: React's root wheel listeners are
  // passive, so preventDefault via the synthetic event cannot stop page scroll.
  useEffect(() => {
    const element = overlayRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setScale((prev) => {
        const factor = event.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
        return Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor));
      });
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  const navigateBy = useCallback(
    (direction: -1 | 1) => {
      if (!isGallery || !items || !onNavigate || isSliding) return;
      const target = activeIndex + direction;
      if (target >= 0 && target < items.length) {
        const targetId = items[target].id;
        // On desktop / non-touch navigation (or in test env), switch immediately without 100vw screen slide
        if (isTestEnv || !isMobileOrTablet) {
          onNavigate(targetId);
          setSlideOffset(0);
          return;
        }
        setIsSliding(true);
        const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 400;
        setSlideOffset(direction === 1 ? -screenWidth : screenWidth);
        setTimeout(() => {
          onNavigate(targetId);
          setIsSliding(false);
          setSlideOffset(0);
        }, 280);
      }
    },
    [isGallery, items, onNavigate, activeIndex, isSliding, isMobileOrTablet]
  );

  // Keyboard: ESC closes; gallery mode also flips diagrams with ←/→ (or A/D)
  // and jumps to the first/last with Home/End.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (!isGallery || !items || !onNavigate || items.length === 0) return;
      const last = items.length - 1;
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        if (activeIndex > 0) navigateBy(-1);
      } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        if (activeIndex < last) navigateBy(1);
      } else if (event.key === 'Home') {
        onNavigate(items[0].id);
      } else if (event.key === 'End') {
        onNavigate(items[last].id);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isGallery, items, activeIndex, onNavigate, navigateBy, onClose]);

  const zoomBy = (factor: number) => setScale((prev) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor)));
  const resetView = () => {
    setScale(initialScaleRef.current);
    setTranslate({ x: 0, y: 0 });
    setSlideOffset(0);
  };

  const handlePanPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    // Don't intercept button clicks, toolbar, nav cluster, thumbnails, or save menu
    if (
      target.closest?.(
        'button, [data-testid="diagram-overlay-topbar"], [data-testid="diagram-gallery-footer"], [data-testid="diagram-overlay-save-menu"], [data-testid="diagram-overlay-help-panel"]'
      )
    ) {
      return;
    }

    event.preventDefault();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    setIsPanning(true);

    const isBackdropClick =
      target === event.currentTarget ||
      target.getAttribute('data-testid') === 'diagram-zoom-overlay' ||
      target.getAttribute('data-testid') === 'diagram-carousel-track' ||
      target.getAttribute('data-testid') === 'diagram-slide-current';

    if (pointersRef.current.size === 1) {
      // Single pointer: pan; a touch pointer is also a swipe-to-navigate / swipe-up candidate.
      swipeRef.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        originX: translate.x,
        originY: translate.y,
        moved: false,
        isBackdrop: isBackdropClick,
      };
    } else if (pointersRef.current.size === 2) {
      // Second finger lands: switch from swipe to pinch, anchored on the current view.
      swipeRef.current = null;
      setSlideOffset(0);
      setDismissOffsetY(0);
      const [first, second] = [...pointersRef.current.values()];
      pinchRef.current = {
        startDistance: Math.hypot(first.x - second.x, first.y - second.y) || 1,
        startScale: scale,
        startX: translate.x,
        startY: translate.y,
        startMidX: (first.x + second.x) / 2,
        startMidY: (first.y + second.y) / 2,
      };
    }
  };

  const handlePanPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const midX = (first.x + second.x) / 2;
      const midY = (first.y + second.y) / 2;
      const ratio = distance / pinch.startDistance;
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinch.startScale * ratio)));
      setTranslate({ x: pinch.startX + (midX - pinch.startMidX), y: pinch.startY + (midY - pinch.startMidY) });
      return;
    }

    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;
    const distance = Math.hypot(deltaX, deltaY);
    if (!swipe.moved && distance < DRAG_THRESHOLD) return;
    swipe.moved = true;

    const atFitScale = scale <= initialScaleRef.current + 0.05;
    const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
    const isVerticalSwipe = Math.abs(deltaY) > Math.abs(deltaX);

    if (atFitScale) {
      if (swipe.pointerType === 'touch' || isMobileOrTablet) {
        // Touch screens at fit scale (not zoomed in): do NOT pan the card around (setTranslate).
        // Gestures are dedicated to vertical dismiss (swipe up/down) and horizontal carousel slide.
        if (isVerticalSwipe) {
          setDismissOffsetY(deltaY);
          setSlideOffset(0);
        } else if (isHorizontal) {
          setDismissOffsetY(0);
          if (isGallery && (items?.length ?? 0) > 1) {
            const isEdgeLeft = deltaX > 0 && activeIndex === 0;
            const isEdgeRight = deltaX < 0 && activeIndex >= (items?.length ?? 1) - 1;
            const damped = isEdgeLeft || isEdgeRight ? deltaX * 0.35 : deltaX;
            setSlideOffset(damped);
          } else {
            // Single diagram: elastic horizontal resistance
            setSlideOffset(deltaX * 0.35);
          }
        }
      } else {
        // Mouse on desktop: pan diagram
        setDismissOffsetY(0);
        setSlideOffset(0);
        setTranslate({ x: swipe.originX + deltaX, y: swipe.originY + deltaY });
      }
    } else {
      // Zoomed in (scale > initialScale): single-pointer drag freely pans/drags the enlarged image around.
      setDismissOffsetY(0);
      setSlideOffset(0);
      setTranslate({ x: swipe.originX + deltaX, y: swipe.originY + deltaY });
    }
  };

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.delete(event.pointerId);
    try {
      if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      }
    } catch {
      /* ignore */
    }

    // One finger lifted off a pinch: keep panning with the remaining finger.
    if (pinchRef.current && pointersRef.current.size < 2) {
      pinchRef.current = null;
      const remaining = [...pointersRef.current.entries()][0];
      if (remaining) {
        const [pointerId, position] = remaining;
        swipeRef.current = {
          pointerId,
          pointerType: 'touch',
          startX: position.x,
          startY: position.y,
          originX: translate.x,
          originY: translate.y,
          moved: false,
          isBackdrop: false,
        };
      }
    }

    const swipe = swipeRef.current;
    if (swipe && swipe.pointerId === event.pointerId) {
      swipeRef.current = null;
      const deltaX = event.clientX - swipe.startX;
      const deltaY = event.clientY - swipe.startY;
      const distance = Math.hypot(deltaX, deltaY);
      const atFitScale = scale <= initialScaleRef.current + 0.05;

      // 1. Check Swipe Up / Down to Exit
      const isVerticalSwipe = Math.abs(deltaY) > Math.abs(deltaX);
      const isVerticalExit =
        atFitScale &&
        Math.abs(deltaY) > SWIPE_UP_THRESHOLD &&
        isVerticalSwipe &&
        (swipe.pointerType === 'touch' || isSmallScreen);

      if (isVerticalExit) {
        if (isTestEnv) {
          setDismissOffsetY(0);
          onClose();
          if (pointersRef.current.size === 0) setIsPanning(false);
          return;
        }
        setIsDismissing(true);
        const exitTargetY = deltaY < 0 ? -window.innerHeight : window.innerHeight;
        setDismissOffsetY(exitTargetY);
        setTimeout(() => {
          onClose();
          if (pointersRef.current.size === 0) setIsPanning(false);
        }, 240);
        return;
      }
      if (dismissOffsetY !== 0) {
        setIsDismissing(true);
        setDismissOffsetY(0);
        setTimeout(() => {
          setIsDismissing(false);
        }, 240);
      }

      // 2. Check Tap / Double Tap
      if (!swipe.moved && distance < DRAG_THRESHOLD) {
        const now = Date.now();
        const prevTap = lastTapRef.current;
        const isDoubleTap =
          prevTap &&
          now - prevTap.time < DOUBLE_TAP_DELAY &&
          Math.hypot(event.clientX - prevTap.x, event.clientY - prevTap.y) < 35;

        if (isDoubleTap) {
          if (singleTapTimerRef.current) {
            clearTimeout(singleTapTimerRef.current);
            singleTapTimerRef.current = null;
          }
          lastTapRef.current = null;
          if (scale > initialScaleRef.current + 0.1) {
            // Already zoomed in -> zoom out to fit scale
            resetView();
          } else {
            // Zoom in to 2.5x centered around tapped point
            const targetScale = Math.min(MAX_SCALE, Math.max(initialScaleRef.current * 2.5, 2.5));
            const originX = (window.innerWidth / 2 - event.clientX) * (targetScale / initialScaleRef.current - 1);
            const originY = (window.innerHeight / 2 - event.clientY) * (targetScale / initialScaleRef.current - 1);
            setScale(targetScale);
            setTranslate({ x: originX, y: originY });
          }
          if (pointersRef.current.size === 0) setIsPanning(false);
          return;
        }

        lastTapRef.current = { time: now, x: event.clientX, y: event.clientY };
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
        }
        singleTapTimerRef.current = setTimeout(() => {
          setUiVisible((v) => !v);
          singleTapTimerRef.current = null;
        }, DOUBLE_TAP_DELAY);

        if (pointersRef.current.size === 0) setIsPanning(false);
        return;
      }

      // 3. Check Horizontal Carousel Switch
      if (isGallery && (items?.length ?? 0) > 1 && atFitScale) {
        const isEdgeLeft = deltaX > 0 && activeIndex === 0;
        const isEdgeRight = deltaX < 0 && activeIndex >= (items?.length ?? 1) - 1;
        const isSwipeGesture = (swipe.pointerType === 'touch' || isSmallScreen) && Math.abs(deltaX) > SWIPE_THRESHOLD;

        if (
          deltaX < -SWIPE_THRESHOLD &&
          !isEdgeRight &&
          activeIndex < (items?.length ?? 0) - 1 &&
          (isSwipeGesture || Math.abs(slideOffset) > 0)
        ) {
          const nextTargetId = items![activeIndex + 1].id;
          if (isTestEnv) {
            onNavigate?.(nextTargetId);
            setSlideOffset(0);
          } else {
            setIsSliding(true);
            const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 400;
            setSlideOffset(-screenWidth);
            setTimeout(() => {
              onNavigate?.(nextTargetId);
              setIsSliding(false);
              setSlideOffset(0);
            }, 280);
          }
        } else if (
          deltaX > SWIPE_THRESHOLD &&
          !isEdgeLeft &&
          activeIndex > 0 &&
          (isSwipeGesture || Math.abs(slideOffset) > 0)
        ) {
          const prevTargetId = items![activeIndex - 1].id;
          if (isTestEnv) {
            onNavigate?.(prevTargetId);
            setSlideOffset(0);
          } else {
            setIsSliding(true);
            const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 400;
            setSlideOffset(screenWidth);
            setTimeout(() => {
              onNavigate?.(prevTargetId);
              setIsSliding(false);
              setSlideOffset(0);
            }, 280);
          }
        } else if (slideOffset !== 0) {
          setIsSliding(true);
          setSlideOffset(0);
          setTimeout(() => {
            setIsSliding(false);
          }, 280);
        }
      }
    }

    if (pointersRef.current.size === 0) setIsPanning(false);
  };

  // With a known natural size the card is an explicit box hugging the diagram at
  // its rendered size — uncapped, so it only stops growing past the screen edges
  // where the overlay root clips it. Without one, fall back to the natural SVG
  // layout with a transform scale.
  const contentStyle: React.CSSProperties = base
    ? {
        width: base.width * scale,
        height: base.height * scale,
        padding: isMobileOrTablet ? '0px' : '12px',
        borderRadius: isMobileOrTablet ? '0px' : '8px',
        boxSizing: 'border-box',
      }
    : {
        maxWidth: isMobileOrTablet ? '100vw' : MAX_BOX_WIDTH,
        maxHeight: isMobileOrTablet ? '100vh' : MAX_BOX_HEIGHT,
        width: isMobileOrTablet ? '100vw' : 'min(85vw, 900px)',
        height: isMobileOrTablet ? '100vh' : 'min(80vh, 650px)',
        padding: isMobileOrTablet ? '0px' : '12px',
        borderRadius: isMobileOrTablet ? '0px' : '8px',
        boxSizing: 'border-box',
      };
  // Pan transforms the card itself: the overlay root is the fixed clip window,
  // so every part of an oversized diagram stays reachable by dragging.
  const diagramTransform = base
    ? `translate(${translate.x}px, ${translate.y}px)`
    : `translate(${translate.x}px, ${translate.y}px) scale(${scale})`;

  // Human-readable type label for the header; keys already exist per diagram type.
  const typeLabel = activeItem
    ? activeItem.type === 'wavedrom'
      ? t('preview.wavedromTitle')
      : activeItem.type === 'beautiful-mermaid'
        ? t('preview.beautifulMermaidTitle')
        : activeItem.type === 'math'
          ? t('preview.mathTitle')
          : activeItem.type === 'chart'
            ? t('preview.echartsTitle')
            : activeItem.type === 'svg'
              ? t('preview.svgTitle')
              : activeItem.type === 'image'
                ? t('preview.imageTitle')
                : t('preview.mermaidTitle')
    : (ariaLabel ?? '');
  const subtitle = activeItem?.title;
  const dialogAriaLabel =
    activeItem && (subtitle || typeLabel)
      ? `${typeLabel}${subtitle ? `: ${subtitle}` : ''}${isGallery && items.length > 1 ? ` ${t('preview.diagramGalleryCounter', { current: activeIndex + 1, total: items.length })}` : ''}`
      : typeLabel;
  const cardBackground = activeItem?.panelBackground ?? panelBackground;
  // The content card is keyed by the active diagram so React also swaps the DOM
  // node cleanly; the viewport reset lives in the effect above (overlay state
  // is not per-card).
  const contentKey = activeKey;

  const itemCount = isGallery && items ? items.length : 0;
  const canPrev = itemCount > 1 && activeIndex > 0;
  const canNext = itemCount > 1 && activeIndex < itemCount - 1;
  const thumbnailsRef = useRef<HTMLDivElement>(null);

  // Keep the active thumbnail visible in the strip when navigating (the strip
  // scrolls horizontally; keyboard flips could otherwise leave it off-screen).
  useEffect(() => {
    const activeThumb = thumbnailsRef.current?.querySelector('[data-active="true"]');
    if (activeThumb && typeof activeThumb.scrollIntoView === 'function') {
      activeThumb.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, [activeIndex]);

  // Prev/next live inside the compact nav pill, so they stay borderless and
  // sized as touch-friendly targets (bigger on small screens).
  const navClusterButtonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: isSmallScreen ? '36px' : '32px',
    height: isSmallScreen ? '36px' : '32px',
    padding: 0,
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    cursor: 'pointer',
    transition: 'opacity 0.15s ease-out',
  };

  // Export actions for the toolbar. The source comes from the gallery item
  // (or the single-mode code prop) and the image from the active diagram SVG.
  const sourceCode = activeItem?.code ?? code;
  const exportSvg = activeItem?.svg ?? svg ?? '';
  const exportIndex = activeIndex >= 0 ? activeIndex + 1 : 1;

  const handleCopySource = () => {
    if (!sourceCode) return;
    void copyText(sourceCode)
      .then(() => {
        Message.success(t('common.copySuccess'));
      })
      .catch(() => {
        Message.error(t('common.copyFailed'));
      });
  };

  const isDarkTheme =
    document.documentElement.getAttribute('data-theme') === 'dark' ||
    cardBackground === '#1d2129' ||
    cardBackground === '#17171a';

  const exportOptions = useMemo(
    () => ({
      themeBackground: cardBackground || (isDarkTheme ? '#1d2129' : '#ffffff'),
      isDark: isDarkTheme,
    }),
    [cardBackground, isDarkTheme]
  );

  const handleCopyImage = () => {
    if (!exportSvg) return;
    const run = (readySvg: string) =>
      copySvgImage(readySvg, exportOptions)
        .then(() => {
          Message.success(t('common.copySuccess'));
        })
        .catch((error: unknown) => {
          // Non-secure contexts (WebUI over plain HTTP) and sandboxed pages
          // lack the clipboard APIs; the detail helps diagnose which gate hit.
          console.error('[DiagramGallery] copy image failed:', error);
          Message.error(t('preview.diagramImageExportFailed'));
        });

    if (activeItem?.type === 'math') {
      void prepareMathSvgForExport(exportSvg, isDarkTheme ? 'dark' : 'light', activeItem?.code)
        .then(run)
        .catch((error: unknown) => {
          console.warn('[DiagramGallery] prepareMathSvgForExport fallback to raw SVG:', error);
          void run(exportSvg);
        });
      return;
    }

    void run(exportSvg);
  };

  const handleSaveImage = (format: DiagramExportFormat) => {
    if (!exportSvg) return;
    const isWavedrom = activeItem?.type === 'wavedrom';
    // WaveDrom only supports light theme (dark strokes).
    // If the user requests dark PNG export, fall back to white background ('png-light')
    // so waveforms stay fully readable, while transparent ('png-transparent') and light are fully supported.
    const effectiveFormat = isWavedrom && format === 'png-dark' ? 'png-light' : format;
    const extension = effectiveFormat === 'svg' ? 'svg' : 'png';
    const effectiveOptions =
      isWavedrom && format === 'png-dark'
        ? { ...exportOptions, background: '#ffffff', themeBackground: '#ffffff', isDark: false, textColor: '#1d2129' }
        : exportOptions;

    const run = (readySvg: string) =>
      saveDiagramImage(readySvg, `diagram-${exportIndex}-${Date.now()}.${extension}`, effectiveFormat, effectiveOptions)
        .then(() => {
          Message.success(t('conversation.history.exportSuccess'));
        })
        .catch((error: unknown) => {
          console.error('[DiagramGallery] save image failed:', error);
          Message.error(t('preview.diagramImageExportFailed'));
        });

    if (activeItem?.type === 'math') {
      void prepareMathSvgForExport(exportSvg, effectiveFormat === 'png-dark' ? 'dark' : 'light', activeItem?.code)
        .then(run)
        .catch((error: unknown) => {
          console.warn('[DiagramGallery] prepareMathSvgForExport fallback to raw SVG:', error);
          void run(exportSvg);
        });
      return;
    }

    void prepareDiagramSvgForExport(exportSvg, activeItem, effectiveFormat)
      .then(run)
      .catch((error: unknown) => {
        console.warn('[DiagramGallery] prepareDiagramSvgForExport fallback to raw SVG:', error);
        void run(exportSvg);
      });
  };

  // The save button pops a small format menu (SVG preferred, PNG as fallback);
  // the help button pops the interaction hints (hover on desktop, tap on touch).
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!saveMenuOpen && !helpOpen) return;
    const closeMenus = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!saveMenuRef.current?.contains(target)) setSaveMenuOpen(false);
      if (!helpRef.current?.contains(target)) setHelpOpen(false);
    };
    document.addEventListener('mousedown', closeMenus);
    return () => document.removeEventListener('mousedown', closeMenus);
  }, [saveMenuOpen, helpOpen]);

  const saveMenuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--text-primary)',
    fontSize: '13px',
    lineHeight: '20px',
    whiteSpace: 'nowrap',
    textAlign: 'left',
  };

  return createPortal(
    <div
      ref={overlayRef}
      data-testid='diagram-zoom-overlay'
      role='dialog'
      aria-modal='true'
      aria-label={dialogAriaLabel}
      onPointerDown={handlePanPointerDown}
      onPointerMove={handlePanPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onClick={(event: React.MouseEvent) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background:
          dismissOffsetY !== 0
            ? `rgba(29, 33, 41, ${Math.max(0.05, 0.6 * (1 - Math.abs(dismissOffsetY) / 400))})`
            : isMobileOrTablet
              ? 'var(--color-bg-mask, rgba(0, 0, 0, 0.95))'
              : 'var(--color-bg-mask, rgba(29, 33, 41, 0.6))',
        transition: isDismissing ? 'background 0.24s ease-out' : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        touchAction: 'none',
        userSelect: 'none',
        cursor: isPanning ? 'grabbing' : 'default',
      }}
    >
      {/* Top bar: the diagram title and the toolbar share one row — title on
          the left (shrinking with ellipsis), actions on the right (fixed).
          Clear of the titlebar / Window Controls Overlay (PWA): env() reports
          the WCO strip height when active and falls back to the app titlebar
          height otherwise, so the bar never hides under the controls. */}
      <div
        data-testid='diagram-overlay-topbar'
        style={{
          position: 'fixed',
          top: isMobileOrTablet ? '8px' : 'calc(env(titlebar-area-height, 38px) + 12px)',
          left: isMobileOrTablet ? '8px' : '16px',
          right: isMobileOrTablet ? '8px' : '16px',
          zIndex: 10001,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: isMobileOrTablet ? '6px' : '12px',
          pointerEvents: 'none',
          opacity: uiVisible ? 1 : 0,
          transform: uiVisible ? 'translateY(0)' : 'translateY(-24px)',
          transition: 'opacity 0.22s ease-in-out, transform 0.22s ease-in-out',
        }}
      >
        <div
          data-testid='diagram-gallery-header'
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: 0,
            flexShrink: 1,
            maxWidth: isSmallScreen ? '42vw' : '50vw',
            padding: '6px 12px',
            background: 'var(--bg-2)',
            border: '1px solid var(--bg-3)',
            borderRadius: '8px',
            color: 'var(--text-secondary)',
            fontSize: '13px',
            lineHeight: '20px',
            pointerEvents: uiVisible ? 'auto' : 'none',
            userSelect: 'none',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <span>{typeLabel}</span>
          {subtitle && (
            <span style={{ color: 'var(--text-primary)' }} data-testid='diagram-gallery-title'>
              {subtitle}
            </span>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px',
            background: 'var(--bg-2)',
            border: '1px solid var(--bg-3)',
            borderRadius: '8px',
            flexShrink: 0,
            pointerEvents: uiVisible ? 'auto' : 'none',
          }}
        >
          <div
            ref={helpRef}
            style={{ position: 'relative', display: 'flex' }}
            onMouseEnter={() => setHelpOpen(true)}
            onMouseLeave={() => setHelpOpen(false)}
          >
            <button
              type='button'
              data-testid='diagram-overlay-help'
              title={t('preview.diagramGalleryHelp')}
              aria-label={t('preview.diagramGalleryHelp')}
              style={toolbarButtonStyle}
              onClick={() => setHelpOpen((open) => !open)}
            >
              <Help theme='outline' size='16' fill='var(--text-secondary)' />
            </button>
            {helpOpen && (
              <div
                data-testid='diagram-overlay-help-panel'
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  zIndex: 10002,
                  // The anchor wrapper is only as wide as the help button, so
                  // shrink-to-fit would collapse the panel; size it from its
                  // content instead and let maxWidth cap long hints.
                  width: 'max-content',
                  maxWidth: 'min(80vw, 320px)',
                  padding: '8px 12px',
                  background: 'var(--bg-2)',
                  border: '1px solid var(--bg-3)',
                  borderRadius: '6px',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                  color: 'var(--text-secondary)',
                  fontSize: '13px',
                  lineHeight: '20px',
                  whiteSpace: 'normal',
                  textAlign: 'left',
                  cursor: 'default',
                }}
              >
                {t(isTouchDevice ? 'preview.diagramGalleryHintTouch' : 'preview.diagramGalleryHint')}
              </div>
            )}
          </div>
          <button
            type='button'
            data-testid='diagram-overlay-zoom-out'
            title={t('preview.zoomOut')}
            style={toolbarButtonStyle}
            onClick={() => zoomBy(1 / BUTTON_ZOOM_FACTOR)}
          >
            <ZoomOut theme='outline' size='16' fill='var(--text-secondary)' />
          </button>
          <button
            type='button'
            data-testid='diagram-overlay-zoom-in'
            title={t('preview.zoomIn')}
            style={toolbarButtonStyle}
            onClick={() => zoomBy(BUTTON_ZOOM_FACTOR)}
          >
            <ZoomIn theme='outline' size='16' fill='var(--text-secondary)' />
          </button>
          <button
            type='button'
            data-testid='diagram-overlay-zoom-reset'
            title={t('preview.zoomReset')}
            style={toolbarButtonStyle}
            onClick={resetView}
          >
            <Refresh theme='outline' size='16' fill='var(--text-secondary)' />
          </button>
          {sourceCode && (
            <button
              type='button'
              data-testid='diagram-overlay-copy-source'
              title={t('preview.diagramCopySource')}
              style={toolbarButtonStyle}
              onClick={handleCopySource}
            >
              <Copy theme='outline' size='16' fill='var(--text-secondary)' />
            </button>
          )}
          <button
            type='button'
            data-testid='diagram-overlay-copy-image'
            title={t('preview.diagramCopyImage')}
            style={toolbarButtonStyle}
            onClick={handleCopyImage}
          >
            <Picture theme='outline' size='16' fill='var(--text-secondary)' />
          </button>
          <div ref={saveMenuRef} style={{ position: 'relative', display: 'flex' }}>
            <button
              type='button'
              data-testid='diagram-overlay-save-image'
              title={t('preview.diagramSaveImage')}
              style={toolbarButtonStyle}
              onClick={() => setSaveMenuOpen((open) => !open)}
            >
              <Download theme='outline' size='16' fill='var(--text-secondary)' />
            </button>
            {saveMenuOpen && (
              <div
                data-testid='diagram-overlay-save-menu'
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  zIndex: 10002,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  padding: '4px',
                  background: 'var(--bg-2)',
                  border: '1px solid var(--bg-3)',
                  borderRadius: '6px',
                  minWidth: '130px',
                  whiteSpace: 'nowrap',
                }}
              >
                <button
                  type='button'
                  data-testid='diagram-overlay-save-png-light'
                  style={saveMenuItemStyle}
                  onClick={() => {
                    setSaveMenuOpen(false);
                    handleSaveImage('png-light');
                  }}
                >
                  {t('preview.diagramFormatPngLight')}
                </button>
                <button
                  type='button'
                  data-testid='diagram-overlay-save-png-dark'
                  data-theme-save='true'
                  style={saveMenuItemStyle}
                  onClick={() => {
                    setSaveMenuOpen(false);
                    handleSaveImage('png-dark');
                  }}
                >
                  {t('preview.diagramFormatPngDark')}
                </button>
                <button
                  type='button'
                  data-testid='diagram-overlay-save-png-transparent'
                  style={saveMenuItemStyle}
                  onClick={() => {
                    setSaveMenuOpen(false);
                    handleSaveImage('png-transparent');
                  }}
                >
                  {t('preview.diagramFormatPngTransparent')}
                </button>
                <button
                  type='button'
                  data-testid='diagram-overlay-save-svg'
                  style={saveMenuItemStyle}
                  onClick={() => {
                    setSaveMenuOpen(false);
                    handleSaveImage('svg');
                  }}
                >
                  {t('preview.diagramFormatSvg')}
                </button>
              </div>
            )}
          </div>
          <button
            type='button'
            data-testid='diagram-overlay-close'
            title={t('common.close')}
            style={toolbarButtonStyle}
            onClick={onClose}
          >
            <Close theme='outline' size='16' fill='var(--text-secondary)' />
          </button>
        </div>
      </div>

      {/* Sliding Carousel Track: enables true mobile photo-album sliding window transition */}
      <div
        data-testid='diagram-carousel-track'
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateX(${slideOffset}px) translateY(${dismissOffsetY}px) scale(${Math.max(0.85, 1 - Math.abs(dismissOffsetY) / 1200)})`,
          opacity: dismissOffsetY !== 0 ? Math.max(0.2, 1 - Math.abs(dismissOffsetY) / 400) : 1,
          transition: isSliding
            ? 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)'
            : isDismissing
              ? 'transform 0.24s ease-out, opacity 0.24s ease-out'
              : dismissOffsetY === 0 && slideOffset === 0
                ? 'transform 0.2s ease-out, opacity 0.2s ease-out'
                : 'none',
          pointerEvents: 'none',
        }}
      >
        {/* Previous Slide (positioned at -100vw) */}
        {prevItem && prevFit && (
          <div
            data-testid='diagram-slide-prev'
            style={{
              position: 'absolute',
              left: '-100vw',
              width: '100vw',
              height: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                background: prevItem.panelBackground ?? cardBackground ?? 'var(--bg-1)',
                padding: isMobileOrTablet ? '0px' : '12px',
                borderRadius: isMobileOrTablet ? '0px' : '8px',
                width: prevFit.base.width * prevFit.fitScale,
                height: prevFit.base.height * prevFit.fitScale,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
              }}
              dangerouslySetInnerHTML={{ __html: stripInlineMaxWidth(prevItem.svg) }}
            />
          </div>
        )}

        {/* Current Active Slide */}
        <div
          data-testid='diagram-slide-current'
          style={{
            position: 'absolute',
            left: 0,
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            key={contentKey}
            data-testid='diagram-zoom-content'
            onPointerDown={handlePanPointerDown}
            onPointerMove={handlePanPointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            style={{
              background: cardBackground ?? 'var(--bg-1)',
              flexShrink: 0,
              cursor: isPanning
                ? 'grabbing'
                : isMobileOrTablet
                  ? 'default'
                  : scale <= initialScaleRef.current + 0.05
                    ? 'zoom-in'
                    : 'grab',
              userSelect: 'none',
              touchAction: 'none',
              transform: diagramTransform,
              transition: isPanning ? 'none' : 'transform 0.12s ease-out',
              pointerEvents: 'auto',
              ...contentStyle,
            }}
            dangerouslySetInnerHTML={{ __html: overlaySvg }}
          />
        </div>

        {/* Next Slide (positioned at +100vw) */}
        {nextItem && nextFit && (
          <div
            data-testid='diagram-slide-next'
            style={{
              position: 'absolute',
              left: '100vw',
              width: '100vw',
              height: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                background: nextItem.panelBackground ?? cardBackground ?? 'var(--bg-1)',
                padding: isMobileOrTablet ? '0px' : '12px',
                borderRadius: isMobileOrTablet ? '0px' : '8px',
                width: nextFit.base.width * nextFit.fitScale,
                height: nextFit.base.height * nextFit.fitScale,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
              }}
              dangerouslySetInnerHTML={{ __html: stripInlineMaxWidth(nextItem.svg) }}
            />
          </div>
        )}
      </div>

      {/* Bottom gallery footer — like a photo album: compact prev/counter/next
          cluster and the clickable thumbnail strip. The title lives in the top
          bar next to the toolbar; the interaction hints live behind the top
          bar's help button. */}
      <div
        data-testid='diagram-gallery-footer'
        style={{
          position: 'fixed',
          bottom: isSmallScreen ? '8px' : '12px',
          left: '50%',
          transform: uiVisible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(24px)',
          opacity: uiVisible ? 1 : 0,
          transition: 'opacity 0.22s ease-in-out, transform 0.22s ease-in-out',
          zIndex: 10001,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px',
          maxWidth: '92vw',
          pointerEvents: 'none',
        }}
      >
        {/* Nav cluster: prev / counter / next grouped in one compact pill, like
            a photo album — the buttons stay adjacent to the counter and never
            drift to the far ends of the screen. */}
        {itemCount > 1 && (
          <div
            data-testid='diagram-gallery-nav'
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px',
              background: 'var(--bg-2)',
              border: '1px solid var(--bg-3)',
              borderRadius: '8px',
              pointerEvents: uiVisible ? 'auto' : 'none',
            }}
          >
            <button
              type='button'
              data-testid='diagram-gallery-prev'
              title={t('preview.diagramGalleryPrev')}
              aria-label={t('preview.diagramGalleryPrev')}
              style={{ ...navClusterButtonStyle, opacity: canPrev ? 1 : 0.35 }}
              onClick={() => navigateBy(-1)}
            >
              <ArrowLeft theme='outline' size='18' fill='var(--text-secondary)' />
            </button>
            <span
              data-testid='diagram-gallery-counter'
              style={{
                minWidth: '52px',
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                lineHeight: '20px',
                userSelect: 'none',
              }}
            >
              {t('preview.diagramGalleryCounter', { current: activeIndex + 1, total: itemCount })}
            </span>
            <button
              type='button'
              data-testid='diagram-gallery-next'
              title={t('preview.diagramGalleryNext')}
              aria-label={t('preview.diagramGalleryNext')}
              style={{ ...navClusterButtonStyle, opacity: canNext ? 1 : 0.35 }}
              onClick={() => navigateBy(1)}
            >
              <ArrowRight theme='outline' size='18' fill='var(--text-secondary)' />
            </button>
          </div>
        )}

        {itemCount > 1 && (
          <div
            ref={thumbnailsRef}
            data-testid='diagram-gallery-thumbs'
            style={{
              display: 'flex',
              gap: '6px',
              maxWidth: 'min(72vw, 880px)',
              overflowX: 'auto',
              padding: '4px',
              pointerEvents: uiVisible ? 'auto' : 'none',
            }}
          >
            {(items ?? []).map((item, index) => {
              const isActive = item.id === activeId;
              return (
                <button
                  key={item.id}
                  type='button'
                  data-testid='diagram-gallery-thumb'
                  data-active={isActive}
                  title={item.title}
                  aria-label={t('preview.diagramGalleryCounter', { current: index + 1, total: itemCount })}
                  onClick={() => onNavigate?.(item.id)}
                  style={{
                    flexShrink: 0,
                    width: isSmallScreen ? '48px' : '56px',
                    height: isSmallScreen ? '38px' : '44px',
                    padding: '2px',
                    border: '2px solid',
                    borderColor: isActive ? 'var(--color-primary-6, #165dff)' : 'var(--bg-3)',
                    borderRadius: '6px',
                    background: item.panelBackground ?? 'var(--bg-1)',
                    cursor: 'pointer',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
                    dangerouslySetInnerHTML={{ __html: stripInlineMaxWidth(item.svg) }}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default React.memo(DiagramZoomOverlay);
