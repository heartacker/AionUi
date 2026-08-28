/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/renderer/components/Markdown/diagrams/diagramExport', () => ({
  copySvgImage: vi.fn().mockResolvedValue(undefined),
  saveDiagramImage: vi.fn().mockResolvedValue(undefined),
  prepareDiagramSvgForExport: vi.fn((svg: string) => Promise.resolve(svg)),
}));

vi.mock('@/renderer/components/Markdown/diagrams/mathExport', () => ({
  prepareMathSvgForExport: vi.fn((svg: string) => Promise.resolve(`${svg}-prepared`)),
}));

const makeIcon = vi.hoisted(() => (name: string) => () => <span data-icon={name} />);

vi.mock('@icon-park/react', () => ({
  Close: makeIcon('close'),
  ZoomIn: makeIcon('zoom-in'),
  ZoomOut: makeIcon('zoom-out'),
  Refresh: makeIcon('refresh'),
  ArrowLeft: makeIcon('arrow-left'),
  ArrowRight: makeIcon('arrow-right'),
  Copy: makeIcon('copy'),
  Picture: makeIcon('picture'),
  Download: makeIcon('download'),
  Help: makeIcon('help'),
}));

import DiagramZoomOverlay from '@/renderer/components/Markdown/diagrams/DiagramZoomOverlay';
import type { DiagramItem } from '@/renderer/components/Markdown/diagrams/DiagramGalleryContext';
import {
  DiagramGalleryProvider,
  useDiagramGallery,
} from '@/renderer/components/Markdown/diagrams/DiagramGalleryContext';
import { copySvgImage, saveDiagramImage } from '@/renderer/components/Markdown/diagrams/diagramExport';
import { copyText } from '@/renderer/utils/ui/clipboard';

// jsdom lacks the pointer capture API used by the drag handlers.
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(Element.prototype, 'hasPointerCapture', {
    value: vi.fn(() => false),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
});

const SVG_SQUARE =
  '<svg style="max-width: 100%; height: auto; display: block;" viewBox="0 0 100 100" width="100%"></svg>';
const SVG_WIDE =
  '<svg style="max-width: 100%; height: auto; display: block;" viewBox="0 0 200 100" width="100%"></svg>';

const makeItems = (): DiagramItem[] => [
  { id: 'one', svg: SVG_SQUARE, type: 'mermaid', title: 'First' },
  { id: 'two', svg: SVG_WIDE, type: 'wavedrom', title: 'Second', panelBackground: '#1a1a1a' },
  { id: 'three', svg: SVG_SQUARE, type: 'mermaid', title: 'Third' },
];

const getContent = (): HTMLElement => screen.getByTestId('diagram-zoom-content');
const getBoxPixels = (value: string): number => {
  const match = /^([\d.]+)px$/.exec(value);
  if (!match) throw new Error(`no box size in: ${value}`);
  return parseFloat(match[1]);
};

/** Gallery-mode harness: renders the overlay and owns the active id like the provider does. */
function GalleryHarness({ activeId }: { activeId: string }) {
  const [active, setActive] = useState(activeId);
  return <DiagramZoomOverlay items={makeItems()} activeId={active} onNavigate={setActive} onClose={vi.fn()} />;
}

/** Override window.matchMedia for responsive/touch behavior tests. */
const stubMatchMedia = (queries: Record<string, boolean>) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: queries[query] ?? false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
};

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

describe('DiagramZoomOverlay gallery mode', () => {
  it('shows the type label and position counter for the active diagram', () => {
    render(<GalleryHarness activeId='two' />);
    expect(screen.getByTestId('diagram-gallery-header')).toHaveTextContent('preview.wavedromTitle');
    expect(screen.getByTestId('diagram-gallery-title')).toHaveTextContent('Second');
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('2');
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('3');
    // Gallery card carries the active item's backdrop (WaveDrom dark skin).
    expect(getContent().style.background).toBe('rgb(26, 26, 26)');
  });

  it('navigates with the flanking arrow buttons and clamps at both ends', () => {
    render(<GalleryHarness activeId='one' />);

    fireEvent.click(screen.getByTestId('diagram-gallery-next'));
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('2');

    fireEvent.click(screen.getByTestId('diagram-gallery-next'));
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('3');
    // Clamped: there is no 4th diagram.
    fireEvent.click(screen.getByTestId('diagram-gallery-next'));
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('3');

    fireEvent.click(screen.getByTestId('diagram-gallery-prev'));
    fireEvent.click(screen.getByTestId('diagram-gallery-prev'));
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('diagram-gallery-prev'));
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('1');
  });

  it('navigates with ←/→ and A/D keys and jumps to the ends with Home/End', () => {
    render(<GalleryHarness activeId='one' />);

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('2');

    fireEvent.keyDown(document, { key: 'd' });
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('3');

    fireEvent.keyDown(document, { key: 'a' });
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('2');

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('1');

    fireEvent.keyDown(document, { key: 'End' });
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('3');

    fireEvent.keyDown(document, { key: 'Home' });
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('1');
  });

  it('re-fits the viewport when switching to a diagram with a different aspect ratio', () => {
    render(<GalleryHarness activeId='one' />);
    // 100x100 square. Gallery mode reserves 170px at the bottom for the footer:
    // fit = min(864/100, (768-80-170)/100 = 5.18) -> 518x518.
    expect(getBoxPixels(getContent().style.width)).toBeCloseTo(518);

    fireEvent.click(screen.getByTestId('diagram-gallery-next'));
    // 200x100 wide diagram: fit = min(864/200, 518/100) = 4.32 -> 864x432.
    expect(getBoxPixels(getContent().style.width)).toBeCloseTo(864);
    expect(getBoxPixels(getContent().style.height)).toBeCloseTo(432);
  });

  it('hides the navigation arrows and counter when only one diagram is registered', () => {
    render(
      <DiagramZoomOverlay
        items={[{ id: 'solo', svg: SVG_SQUARE, type: 'mermaid' }]}
        activeId='solo'
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByTestId('diagram-gallery-prev')).toBeNull();
    expect(screen.queryByTestId('diagram-gallery-next')).toBeNull();
    expect(screen.queryByTestId('diagram-gallery-counter')).toBeNull();
    expect(screen.queryByTestId('diagram-gallery-thumbs')).toBeNull();
    expect(screen.getByTestId('diagram-gallery-header')).toHaveTextContent('preview.mermaidTitle');
  });

  it('renders one clickable thumbnail per diagram and highlights the active one', () => {
    render(<GalleryHarness activeId='two' />);

    const thumbs = screen.getAllByTestId('diagram-gallery-thumb');
    expect(thumbs).toHaveLength(3);
    expect(thumbs[1]).toHaveAttribute('data-active', 'true');
    expect(thumbs[0]).toHaveAttribute('data-active', 'false');
    // The WaveDrom thumb keeps its dark backdrop so the mini strokes stay visible.
    expect(thumbs[1].style.background).toBe('rgb(26, 26, 26)');
  });

  it('jumps to a diagram when its thumbnail is clicked', () => {
    render(<GalleryHarness activeId='one' />);

    fireEvent.click(screen.getAllByTestId('diagram-gallery-thumb')[2]);
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('3');
    expect(screen.getAllByTestId('diagram-gallery-thumb')[2]).toHaveAttribute('data-active', 'true');
  });

  it('renders copy-image and save-image toolbar buttons and hides copy-source without source code', () => {
    render(<GalleryHarness activeId='one' />);
    expect(screen.getByTestId('diagram-overlay-copy-image')).toBeInTheDocument();
    expect(screen.getByTestId('diagram-overlay-save-image')).toBeInTheDocument();
    expect(screen.queryByTestId('diagram-overlay-copy-source')).toBeNull();
  });

  it('copies the active diagram image (SVG+PNG) via the toolbar', () => {
    render(<GalleryHarness activeId='two' />);
    fireEvent.click(screen.getByTestId('diagram-overlay-copy-image'));
    expect(copySvgImage).toHaveBeenCalledWith(SVG_WIDE, expect.anything());
  });

  it('saves the diagram as SVG, PNG (light), PNG (dark) or PNG (transparent) through the format menu', async () => {
    render(<GalleryHarness activeId='one' />);

    fireEvent.click(screen.getByTestId('diagram-overlay-save-image'));
    const svgItem = screen.getByTestId('diagram-overlay-save-svg');
    expect(svgItem).toHaveTextContent('preview.diagramFormatSvg');
    await act(async () => {
      fireEvent.click(svgItem);
    });
    expect(saveDiagramImage).toHaveBeenLastCalledWith(
      SVG_SQUARE,
      expect.stringMatching(/\.svg$/),
      'svg',
      expect.anything()
    );

    fireEvent.click(screen.getByTestId('diagram-overlay-save-image'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('diagram-overlay-save-png-light'));
    });
    expect(saveDiagramImage).toHaveBeenLastCalledWith(
      SVG_SQUARE,
      expect.stringMatching(/\.png$/),
      'png-light',
      expect.anything()
    );

    fireEvent.click(screen.getByTestId('diagram-overlay-save-image'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('diagram-overlay-save-png-dark'));
    });
    expect(saveDiagramImage).toHaveBeenLastCalledWith(
      SVG_SQUARE,
      expect.stringMatching(/\.png$/),
      'png-dark',
      expect.anything()
    );

    fireEvent.click(screen.getByTestId('diagram-overlay-save-image'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('diagram-overlay-save-png-transparent'));
    });
    expect(saveDiagramImage).toHaveBeenLastCalledWith(
      SVG_SQUARE,
      expect.stringMatching(/\.png$/),
      'png-transparent',
      expect.anything()
    );
  });

  it('falls back to white background for wavedrom when dark PNG export is requested', async () => {
    render(
      <DiagramZoomOverlay
        items={[{ id: 'wave', svg: SVG_SQUARE, type: 'wavedrom', code: '{ signal: [] }' }]}
        activeId='wave'
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('diagram-overlay-save-image'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('diagram-overlay-save-png-dark'));
    });
    expect(saveDiagramImage).toHaveBeenLastCalledWith(
      SVG_SQUARE,
      expect.stringMatching(/\.png$/),
      'png-light',
      expect.objectContaining({ background: '#ffffff' })
    );
  });

  it('copies the source code from the toolbar when the gallery item carries it', () => {
    render(
      <DiagramZoomOverlay
        items={[{ id: 'one', svg: SVG_SQUARE, type: 'mermaid', code: 'flowchart TD' }]}
        activeId='one'
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('diagram-overlay-copy-source'));
    expect(copyText).toHaveBeenCalledWith('flowchart TD');
  });

  it('prepares math diagrams (standalone KaTeX CSS) before copying the image', async () => {
    render(
      <DiagramZoomOverlay
        items={[{ id: 'formula', svg: '<svg viewBox="0 0 10 10"></svg>', type: 'math', code: 'E = mc^2' }]}
        activeId='formula'
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('diagram-gallery-header')).toHaveTextContent('preview.mathTitle');
    fireEvent.click(screen.getByTestId('diagram-overlay-copy-image'));
    await waitFor(() => {
      expect(copySvgImage).toHaveBeenCalledWith('<svg viewBox="0 0 10 10"></svg>-prepared', expect.anything());
    });
  });

  it('swipes left/right with a touch pointer to flip diagrams', () => {
    stubMatchMedia({});
    render(<GalleryHarness activeId='one' />);
    const content = getContent();

    // Horizontal flick to the left -> next diagram.
    fireEvent.pointerDown(content, { pointerId: 11, pointerType: 'touch', button: 0, clientX: 350, clientY: 200 });
    fireEvent.pointerMove(content, { pointerId: 11, pointerType: 'touch', clientX: 220, clientY: 205 });
    fireEvent.pointerUp(content, { pointerId: 11, pointerType: 'touch', clientX: 220, clientY: 205 });
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('2');

    // Flick to the right -> previous diagram. The content card is remounted on
    // switch (keyed by the active diagram), so re-query it.
    const contentAfter = getContent();
    fireEvent.pointerDown(contentAfter, { pointerId: 12, pointerType: 'touch', button: 0, clientX: 220, clientY: 200 });
    fireEvent.pointerMove(contentAfter, { pointerId: 12, pointerType: 'touch', clientX: 350, clientY: 203 });
    fireEvent.pointerUp(contentAfter, { pointerId: 12, pointerType: 'touch', clientX: 350, clientY: 203 });
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('1');
  });

  it('keeps pan semantics for mouse drags and vertical touch drags', () => {
    stubMatchMedia({});
    render(<GalleryHarness activeId='one' />);
    const content = getContent();

    // Mouse drags pan — never navigate, however horizontal.
    fireEvent.pointerDown(content, { pointerId: 21, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(content, { pointerId: 21, pointerType: 'mouse', clientX: 320, clientY: 105 });
    fireEvent.pointerUp(content, { pointerId: 21, pointerType: 'mouse', clientX: 320, clientY: 105 });
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('1');

    // Vertical touch drags pan instead of flipping.
    fireEvent.pointerDown(content, { pointerId: 22, pointerType: 'touch', button: 0, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(content, { pointerId: 22, pointerType: 'touch', clientX: 305, clientY: 320 });
    fireEvent.pointerUp(content, { pointerId: 22, pointerType: 'touch', clientX: 305, clientY: 320 });
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('1');
  });

  it('does not flip on a touch swipe while zoomed in', () => {
    stubMatchMedia({});
    render(<GalleryHarness activeId='one' />);
    const overlay = screen.getByTestId('diagram-zoom-overlay');
    const content = getContent();

    // Zoom past the fit scale with the wheel.
    fireEvent.wheel(overlay, { deltaY: -100 });
    fireEvent.pointerDown(content, { pointerId: 23, pointerType: 'touch', button: 0, clientX: 350, clientY: 200 });
    fireEvent.pointerMove(content, { pointerId: 23, pointerType: 'touch', clientX: 220, clientY: 205 });
    fireEvent.pointerUp(content, { pointerId: 23, pointerType: 'touch', clientX: 220, clientY: 205 });
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('1');
  });

  it('pinches with two touch pointers to zoom around the midpoint', () => {
    stubMatchMedia({});
    render(<GalleryHarness activeId='one' />);
    const content = getContent();
    // Square at fit: 518px wide.
    expect(getBoxPixels(content.style.width)).toBeCloseTo(518);

    fireEvent.pointerDown(content, { pointerId: 31, pointerType: 'touch', button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerDown(content, { pointerId: 32, pointerType: 'touch', button: 0, clientX: 340, clientY: 300 });
    // Distance 40 -> 80: scale doubles (5.18*2 = 10.36 -> clamped to 10) = 1000px.
    fireEvent.pointerMove(content, { pointerId: 32, pointerType: 'touch', clientX: 380, clientY: 300 });
    expect(getBoxPixels(content.style.width)).toBeCloseTo(1000);

    fireEvent.pointerUp(content, { pointerId: 31, pointerType: 'touch' });
    fireEvent.pointerUp(content, { pointerId: 32, pointerType: 'touch' });
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('1');
  });

  it('adapts the footer and help hints for small touch screens', () => {
    stubMatchMedia({ '(max-width: 640px)': true, '(pointer: coarse)': true });
    render(<GalleryHarness activeId='one' />);

    // Touch targets grow on small screens; the title row widens while the nav
    // cluster stays compact.
    expect(screen.getByTestId('diagram-gallery-prev').style.width).toBe('36px');
    expect(screen.getByTestId('diagram-gallery-header').style.maxWidth).toBe('42vw');
    expect(screen.getByTestId('diagram-gallery-nav').style.width).toBe('');
    // Touch devices get the touch-oriented hints from the help button.
    fireEvent.click(screen.getByTestId('diagram-overlay-help'));
    expect(screen.getByTestId('diagram-overlay-help-panel')).toHaveTextContent('preview.diagramGalleryHintTouch');
  });

  it('shows the interaction hints from the help button, first in the toolbar', () => {
    stubMatchMedia({});
    render(<GalleryHarness activeId='one' />);

    // The help button leads the toolbar.
    const toolbar = screen.getByTestId('diagram-overlay-help').parentElement?.parentElement as HTMLElement;
    expect(toolbar.firstElementChild?.firstElementChild).toHaveAttribute('data-testid', 'diagram-overlay-help');
    // Hover opens the desktop hint panel.
    fireEvent.mouseEnter(screen.getByTestId('diagram-overlay-help').parentElement as HTMLElement);
    expect(screen.getByTestId('diagram-overlay-help-panel')).toHaveTextContent('preview.diagramGalleryHint');
    // Click toggles it closed.
    fireEvent.click(screen.getByTestId('diagram-overlay-help'));
    expect(screen.queryByTestId('diagram-overlay-help-panel')).toBeNull();
  });

  it('keeps the gallery controls at the bottom without a hint line', () => {
    render(<GalleryHarness activeId='one' />);
    const footer = screen.getByTestId('diagram-gallery-footer');
    // Footer is bottom-anchored and stacks nav cluster -> thumbnails.
    expect(footer.style.position).toBe('fixed');
    expect(footer.style.bottom).toBe('12px');
    expect(footer.querySelector('[data-testid="diagram-gallery-nav"]')).not.toBeNull();
    expect(footer.querySelector('[data-testid="diagram-gallery-thumbs"]')).not.toBeNull();
    // The hint line is gone; hints moved to the help button in the top bar.
    expect(screen.queryByTestId('diagram-zoom-hint')).toBeNull();
  });

  it('shares the top bar between the title and the toolbar', () => {
    render(<GalleryHarness activeId='two' />);
    const topbar = screen.getByTestId('diagram-overlay-topbar');
    // Title on the left, toolbar on the right, one row.
    expect(topbar).toContainElement(screen.getByTestId('diagram-gallery-header'));
    expect(topbar).toContainElement(screen.getByTestId('diagram-overlay-zoom-in').parentElement as HTMLElement);
    expect(topbar.querySelector('[data-testid="diagram-gallery-title"]')).toHaveTextContent('Second');
    expect(topbar.style.justifyContent).toBe('space-between');
  });

  it('groups prev/next around the counter in one compact nav pill', () => {
    render(<GalleryHarness activeId='one' />);
    const nav = screen.getByTestId('diagram-gallery-nav');
    // The nav cluster is one pill: prev button, counter, next button sit next
    // to each other (children 0/1/2) instead of at the far ends of a wide row.
    const children = [...nav.children];
    expect(children).toHaveLength(3);
    expect(children[0]).toHaveAttribute('data-testid', 'diagram-gallery-prev');
    expect(children[1]).toHaveAttribute('data-testid', 'diagram-gallery-counter');
    expect(children[2]).toHaveAttribute('data-testid', 'diagram-gallery-next');
    // The cluster hugs its content — no fixed wide row for the buttons to drift on.
    expect(nav.style.width).toBe('');
    // The title lives in the top bar, capped and ellipsized, so it can never
    // push the toolbar or the nav buttons around.
    const pill = screen.getByTestId('diagram-gallery-header');
    expect(pill.style.maxWidth).toBe('50vw');
    expect(pill.style.textOverflow).toBe('ellipsis');
  });

  it('keeps the zoom toolbar below the window controls overlay (WCO)', () => {
    render(<GalleryHarness activeId='one' />);
    const topbar = screen.getByTestId('diagram-overlay-topbar');
    // jsdom normalizes calc()/env() oddly, so assert on the meaningful parts:
    // the offset is computed from the titlebar area instead of a fixed 16px.
    expect(topbar.style.top).toContain('calc(');
    expect(topbar.style.top).toContain('titlebar-area-height');
  });
});

/** Registers a diagram and opens the gallery through the context, like a real block does. */
function RegisteringBlock({ item }: { item: DiagramItem }) {
  const gallery = useDiagramGallery(item);
  return (
    <>
      <button type='button' data-testid='open-gallery' onClick={() => gallery.openGallery(item.id)}>
        open
      </button>
      {/* No-provider fallback: the block itself hosts a local single-diagram overlay. */}
      {gallery.localOpen && (
        <DiagramZoomOverlay svg={item.svg} onClose={() => gallery.setLocalOpenId(null)} ariaLabel='Diagram' />
      )}
    </>
  );
}

describe('DiagramGalleryContext', () => {
  it('registers diagrams in stream order and opens the gallery through the provider', () => {
    render(
      <DiagramGalleryProvider>
        <RegisteringBlock item={makeItems()[0]} />
        <RegisteringBlock item={makeItems()[2]} />
      </DiagramGalleryProvider>
    );

    fireEvent.click(screen.getAllByTestId('open-gallery')[0]);
    expect(screen.getByTestId('diagram-zoom-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('1');
    expect(screen.getByTestId('diagram-gallery-counter')).toHaveTextContent('2');
  });

  it('closes the gallery when the active diagram unregisters', () => {
    function TogglingTree() {
      const [show, setShow] = useState(true);
      return (
        <DiagramGalleryProvider>
          {show && <RegisteringBlock item={makeItems()[0]} />}
          <button type='button' data-testid='toggle' onClick={() => setShow(false)}>
            toggle
          </button>
        </DiagramGalleryProvider>
      );
    }

    render(<TogglingTree />);
    fireEvent.click(screen.getByTestId('open-gallery'));
    expect(screen.getByTestId('diagram-zoom-overlay')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.queryByTestId('diagram-zoom-overlay')).toBeNull();
  });

  it('falls back to a local single-diagram overlay outside a provider', () => {
    render(<RegisteringBlock item={makeItems()[0]} />);
    fireEvent.click(screen.getByTestId('open-gallery'));
    expect(screen.getByTestId('diagram-zoom-overlay')).toBeInTheDocument();
    // No gallery: the local overlay has nothing to page through.
    expect(screen.queryByTestId('diagram-gallery-prev')).toBeNull();
    expect(screen.queryByTestId('diagram-gallery-counter')).toBeNull();
  });
});
