/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import DiagramZoomOverlay from './DiagramZoomOverlay';

/** One renderable diagram in the gallery stream. */
export type DiagramItem = {
  /** Unique id — the code block's generated id. */
  id: string;
  /** Rendered SVG markup. */
  svg: string;
  /** Raw source code of the block, for the copy-source toolbar action. */
  code?: string;
  /** Diagram kind; drives the gallery header label. 'chart' is reserved for future canvas-based types. */
  type: 'mermaid' | 'wavedrom' | 'math' | 'chart';
  /** Optional display title (first non-empty source line, truncated). */
  title?: string;
  /** Card backdrop for diagrams whose strokes depend on it (WaveDrom dark skin). */
  panelBackground?: string;
};

export type DiagramGalleryContextValue = {
  /** Diagrams registered by blocks in this gallery, in first-registration order. */
  items: DiagramItem[];
  /** Registers or replaces a diagram without changing its position. */
  registerDiagram: (item: DiagramItem) => void;
  /** Removes a diagram from the gallery (block unmount / no longer renderable). */
  unregisterDiagram: (id: string) => void;
  /** Opens the gallery overlay positioned on the given diagram. */
  openGallery: (id: string) => void;
  /** Id of the diagram the gallery overlay is showing, or null when closed. */
  activeId: string | null;
};

const DiagramGalleryContext = React.createContext<DiagramGalleryContextValue | null>(null);

/** Build a fresh context value around a state pair; extracted for reuse in tests. */
export const createDiagramGalleryValue = (
  items: DiagramItem[],
  activeId: string | null,
  setters: {
    registerDiagram: (item: DiagramItem) => void;
    unregisterDiagram: (id: string) => void;
    openGallery: (id: string) => void;
  }
): DiagramGalleryContextValue => ({
  items,
  activeId,
  ...setters,
});

/**
 * Session-scoped registry + overlay host for rendered diagrams (Mermaid,
 * WaveDrom, and future chart types). Mounted once around the conversation so
 * every diagram block in the message stream registers into the same gallery;
 * opening one diagram lets the user flip through all of them like a photo
 * album. Switching conversations remounts the provider and starts a fresh
 * registry, so diagrams never leak across sessions.
 *
 * The overlay is rendered here — not by the blocks — so only one instance
 * exists at a time even when dozens of messages are mounted.
 */
export function DiagramGalleryProvider({ children }: { children: React.ReactNode }) {
  // Order = insertion order. Re-registration (streaming re-render) overwrites
  // in place, so a re-rendered diagram keeps its position in the stream.
  const [items, setItems] = useState<DiagramItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const registerDiagram = useCallback((item: DiagramItem) => {
    setItems((prev) => {
      const index = prev.findIndex((existing) => existing.id === item.id);
      if (index < 0) return [...prev, item];
      const next = [...prev];
      next[index] = item;
      return next;
    });
  }, []);

  const unregisterDiagram = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    // A diagram can unregister mid-gallery (message streamed a new diagram);
    // close the overlay instead of showing a stale highlight.
    setActiveId((prev) => (prev === id ? null : prev));
  }, []);

  const openGallery = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const value = useMemo(
    () => createDiagramGalleryValue(items, activeId, { registerDiagram, unregisterDiagram, openGallery }),
    [items, activeId, registerDiagram, unregisterDiagram, openGallery]
  );

  const activeItem = activeId ? (items.find((item) => item.id === activeId) ?? null) : null;

  return (
    <DiagramGalleryContext.Provider value={value}>
      {children}
      {activeItem && (
        <DiagramZoomOverlay
          items={items}
          activeId={activeItem.id}
          onNavigate={openGallery}
          onClose={() => setActiveId(null)}
        />
      )}
    </DiagramGalleryContext.Provider>
  );
}

/**
 * Gallery access for diagram blocks.
 *
 * Inside a provider the hook registers the item and `openGallery` opens the
 * shared session gallery. Outside a provider (settings pages, standalone
 * previews) registration is a no-op and `openGallery` opens a local
 * single-diagram overlay — the pre-gallery behavior — so every surface keeps
 * working without wiring the provider everywhere.
 */
export function useDiagramGallery(item: DiagramItem | null) {
  const context = useContext(DiagramGalleryContext);
  const [localOpenId, setLocalOpenId] = useState<string | null>(null);
  const registerDiagram = context?.registerDiagram;
  const unregisterDiagram = context?.unregisterDiagram;

  // Register the current item and refresh it in place when it changes (e.g. a
  // streamed message re-renders the diagram). Unregister only on unmount —
  // unregistering during the change would close an open gallery overlay.
  // Deps are the stable callbacks (never the context object): the provider
  // recreates its value whenever an item is registered, so depending on the
  // object would re-run this effect for every registration and loop forever.
  const registeredIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!registerDiagram || !item) return;
    registerDiagram(item);
    registeredIdRef.current = item.id;
  }, [registerDiagram, item]);
  useEffect(
    () => () => {
      if (registeredIdRef.current) unregisterDiagram?.(registeredIdRef.current);
    },
    [unregisterDiagram]
  );

  return useMemo(() => {
    const openGallery = context
      ? context.openGallery
      : (id: string) => {
          setLocalOpenId(id);
        };
    return {
      /** True when this block's local fallback overlay is open (no provider). */
      localOpen: localOpenId != null && localOpenId === (item?.id ?? ''),
      openGallery,
      /** Direct setter for the local fallback overlay. */
      setLocalOpenId,
    };
  }, [context, item, localOpenId]);
}
