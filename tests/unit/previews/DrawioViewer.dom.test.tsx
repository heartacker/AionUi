/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      openSystem: { invoke: vi.fn(() => Promise.resolve()) },
    },
    shell: {
      openFile: { invoke: vi.fn(() => Promise.resolve()) },
    },
  },
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Dropdown: ({ children }: any) => <div>{children}</div>,
  Menu: {
    Item: ({ children }: any) => <div>{children}</div>,
  },
  Message: {
    useMessage: () => [{ info: vi.fn(), success: vi.fn(), error: vi.fn() }, null],
  },
  Spin: () => <div data-testid='spin'>Loading...</div>,
  Tooltip: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => opts?.defaultValue || key,
  }),
}));

import DrawioViewer from '@/renderer/pages/conversation/Preview/components/viewers/drawio/DrawioViewer';

describe('DrawioViewer', () => {
  const sampleXml =
    '<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>';

  it('renders iframe with diagrams.net viewer URL', async () => {
    await act(async () => {
      render(<DrawioViewer content={sampleXml} file_path='/path/to/test.drawio' />);
    });
    const iframe = screen.getByTitle('Draw.io Viewer') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.src).toContain('https://viewer.diagrams.net/');
  });

  it('posts load message to iframe when receiving init event', async () => {
    const postMessageSpy = vi.fn();

    let container: HTMLElement;
    await act(async () => {
      const res = render(<DrawioViewer content={sampleXml} file_path='/path/to/test.drawio' />);
      container = res.container;
    });

    const iframe = container!.querySelector('iframe');
    if (iframe) {
      Object.defineProperty(iframe, 'contentWindow', {
        value: { postMessage: postMessageSpy },
        writable: true,
      });
    }

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ event: 'init' }),
        })
      );
    });

    expect(postMessageSpy).toHaveBeenCalledWith(expect.stringContaining('"action":"load"'), '*');
  });
});
