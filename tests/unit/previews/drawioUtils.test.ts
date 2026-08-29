/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildDrawioViewerUrl,
  decompressDrawioDiagram,
  extractDrawioXmlFromPdf,
  extractDrawioXmlFromPng,
  extractDrawioXmlFromSvg,
  isDrawioFile,
  parseDrawioPages,
} from '@/renderer/pages/conversation/Preview/components/viewers/drawio/drawioUtils';

describe('drawioUtils', () => {
  describe('isDrawioFile', () => {
    it('recognizes standard and compound drawio extensions', () => {
      expect(isDrawioFile('architecture.drawio')).toBe(true);
      expect(isDrawioFile('flow.dio')).toBe(true);
      expect(isDrawioFile('system.drawio.xml')).toBe(true);
      expect(isDrawioFile('pipeline.dio.xml')).toBe(true);
      expect(isDrawioFile('diagram.drawio.svg')).toBe(true);
      expect(isDrawioFile('export.drawio.png')).toBe(true);
      expect(isDrawioFile('report.drawio.pdf')).toBe(true);
      expect(isDrawioFile('slide.dio.pdf')).toBe(true);
      expect(isDrawioFile('UPPERCASE.DRAWIO')).toBe(true);
    });

    it('rejects non-drawio files', () => {
      expect(isDrawioFile('document.pdf')).toBe(false);
      expect(isDrawioFile('script.ts')).toBe(false);
      expect(isDrawioFile('image.png')).toBe(false);
      expect(isDrawioFile('')).toBe(false);
    });
  });

  describe('extractDrawioXmlFromSvg', () => {
    it('extracts content attribute from svg', () => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" content="&lt;mxfile&gt;&lt;diagram&gt;test&lt;/diagram&gt;&lt;/mxfile&gt;"></svg>';
      const extracted = extractDrawioXmlFromSvg(svg);
      expect(extracted).toBe('<mxfile><diagram>test</diagram></mxfile>');
    });

    it('returns null for svg without content attribute', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>';
      expect(extractDrawioXmlFromSvg(svg)).toBeNull();
    });
  });

  describe('extractDrawioXmlFromPng', () => {
    it('extracts embedded mxfile from PNG tEXt chunk', () => {
      const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const chunkText = Buffer.concat([
        Buffer.from('mxfile\0'),
        Buffer.from(encodeURIComponent('<mxfile><diagram name="PNG Diagram">test</diagram></mxfile>')),
      ]);
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(chunkText.length);
      const typeBuf = Buffer.from('tEXt');
      const crcBuf = Buffer.alloc(4);
      const png = Buffer.concat([header, lenBuf, typeBuf, chunkText, crcBuf]);

      const extracted = extractDrawioXmlFromPng(png);
      expect(extracted).toBe('<mxfile><diagram name="PNG Diagram">test</diagram></mxfile>');
    });

    it('returns null for regular PNG without mxfile chunk', () => {
      const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(extractDrawioXmlFromPng(header)).toBeNull();
    });
  });

  describe('extractDrawioXmlFromPdf', () => {
    it('extracts embedded mxfile from PDF Subject info', () => {
      const pdf =
        '%PDF-1.4\n1 0 obj\n<< /Title (Diagram) /Subject (%3Cmxfile%3E%3Cdiagram%20name=%22PDF%20Page%22%3Etest%3C/diagram%3E%3C/mxfile%3E) >>\nendobj\n%%EOF';
      const extracted = extractDrawioXmlFromPdf(pdf);
      expect(extracted).toBe('<mxfile><diagram name="PDF Page">test</diagram></mxfile>');
    });

    it('returns null for PDF without mxfile info', () => {
      const pdf = '%PDF-1.4\n1 0 obj\n<< /Title (Doc) >>\nendobj\n%%EOF';
      expect(extractDrawioXmlFromPdf(pdf)).toBeNull();
    });
  });

  describe('decompressDrawioDiagram', () => {
    it('returns plain XML uncompressed', async () => {
      const xml = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
      const result = await decompressDrawioDiagram(xml);
      expect(result).toBe(xml);
    });

    it('handles empty input gracefully', async () => {
      expect(await decompressDrawioDiagram('')).toBe('');
    });
  });

  describe('parseDrawioPages', () => {
    it('parses multi-page uncompressed drawio XML', async () => {
      const xml = `
        <mxfile host="65bd71144e">
          <diagram id="p1" name="Architecture">
            <mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>
          </diagram>
          <diagram id="p2" name="Database Flow">
            <mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>
          </diagram>
        </mxfile>
      `;

      const result = await parseDrawioPages(xml);
      expect(result.isValid).toBe(true);
      expect(result.pages).toHaveLength(2);
      expect(result.pages[0].id).toBe('p1');
      expect(result.pages[0].name).toBe('Architecture');
      expect(result.pages[1].id).toBe('p2');
      expect(result.pages[1].name).toBe('Database Flow');
    });

    it('parses single mxGraphModel root without diagram wrapper', async () => {
      const xml =
        '<mxGraphModel dx="1000" dy="800"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
      const result = await parseDrawioPages(xml);
      expect(result.isValid).toBe(true);
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].name).toBe('Page 1');
    });

    it('handles invalid or empty XML gracefully', async () => {
      const result = await parseDrawioPages('');
      expect(result.isValid).toBe(false);
      expect(result.pages).toHaveLength(0);
    });
  });

  describe('buildDrawioViewerUrl', () => {
    it('builds viewer URL with default edit mode', () => {
      const url = buildDrawioViewerUrl();
      expect(url).toContain('https://embed.diagrams.net/');
      expect(url).toContain('page=0');
      expect(url).toContain('saveAndExit=0');
      expect(url).not.toContain('&dark=1');
    });

    it('builds viewer URL with view mode', () => {
      const url = buildDrawioViewerUrl({ mode: 'view', page: 0 });
      expect(url).toContain('https://viewer.diagrams.net/');
      expect(url).toContain('page=0');
      expect(url).toContain('highlight=0000ff');
    });

    it('builds viewer URL with dark theme and specific page', () => {
      const url = buildDrawioViewerUrl({ mode: 'view', page: 2, theme: 'dark' });
      expect(url).toContain('page=2');
      expect(url).toContain('&dark=1');
    });

    it('builds viewer URL with custom self-hosted baseUrl', () => {
      const url = buildDrawioViewerUrl({
        mode: 'edit',
        page: 1,
        theme: 'light',
        baseUrl: 'https://drawio.internal.mycompany.com/',
      });
      expect(url).toContain('https://drawio.internal.mycompany.com/?embed=1');
      expect(url).toContain('page=1');
    });
  });
});
