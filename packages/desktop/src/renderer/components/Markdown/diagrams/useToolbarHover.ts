/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

/** Evaluate a media query defensively: jsdom and very old browsers lack matchMedia. */
const matchMediaQuery = (query: string): boolean => {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
};

/**
 * Hover/tap-reveal state for the inline diagram block header toolbars.
 *
 * Implemented with React state + inline styles on purpose: chat markdown
 * renders inside a Shadow DOM (ShadowView), where stylesheet classes from the
 * document head never apply — a CSS hover rule would need two injection
 * points. React synthetic events and inline styles work in both shadow and
 * light DOM, so one mechanism covers the chat and the preview panel.
 *
 * Pointer devices reveal the toolbar on hover; touch devices have no hover,
 * so tapping the block toggles it. Hidden by default on both. While hidden
 * the toolbar also stops receiving pointer events so invisible buttons cannot
 * be clicked by accident.
 */
export const useToolbarHover = () => {
  const [isTouchDevice, setIsTouchDevice] = useState(() => matchMediaQuery('(pointer: coarse)'));
  const [hovered, setHovered] = useState(false);
  const [tapped, setTapped] = useState(false);
  // Attach to the block root so a tap outside it can dismiss the toolbar.
  const blockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setIsTouchDevice(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  // Tapping outside the block counts as losing focus: dismiss the toolbar.
  useEffect(() => {
    if (!tapped) return;
    const hideOnOutsidePointer = (event: PointerEvent) => {
      if (blockRef.current && !blockRef.current.contains(event.target as Node)) setTapped(false);
    };
    document.addEventListener('pointerdown', hideOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', hideOnOutsidePointer);
  }, [tapped]);

  const onMouseEnter = useCallback(() => setHovered(true), []);
  const onMouseLeave = useCallback(() => setHovered(false), []);
  // Tap-to-toggle for touch devices only; mouse clicks keep hover semantics.
  const onClick = useCallback(() => {
    if (isTouchDevice) setTapped((prev) => !prev);
  }, [isTouchDevice]);

  const visible = hovered || (isTouchDevice && tapped);
  const toolbarStyle: React.CSSProperties = {
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? 'auto' : 'none',
    transition: 'opacity 0.15s ease-out',
  };

  return { toolbarStyle, onMouseEnter, onMouseLeave, onClick, blockRef };
};
