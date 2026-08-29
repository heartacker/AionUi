/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  getFileExtension,
  getContentTypeByExtension,
  isImageFile,
  isTextFile,
  isOfficeFile,
  FILE_EXTENSION_MAP,
} from '@/renderer/pages/conversation/Preview/fileUtils';

describe('fileUtils', () => {
  describe('getFileExtension', () => {
    it('extracts extension in lowercase', () => {
      expect(getFileExtension('document.PDF')).toBe('pdf');
      expect(getFileExtension('script.TS')).toBe('ts');
    });

    it('returns empty string for no extension', () => {
      expect(getFileExtension('noextension')).toBe('');
      expect(getFileExtension('')).toBe('');
    });

    it('returns empty string for dot at end', () => {
      expect(getFileExtension('file.')).toBe('');
    });

    it('extracts last extension for multi-dot names', () => {
      expect(getFileExtension('archive.tar.gz')).toBe('gz');
    });

    it('handles null-ish input gracefully', () => {
      expect(getFileExtension('')).toBe('');
    });
  });

  describe('getContentTypeByExtension', () => {
    it('returns markdown for .md', () => {
      expect(getContentTypeByExtension('README.md')).toBe('markdown');
    });

    it('returns html for .html', () => {
      expect(getContentTypeByExtension('index.html')).toBe('html');
    });

    it('returns pdf for .pdf', () => {
      expect(getContentTypeByExtension('report.pdf')).toBe('pdf');
    });

    it('returns word for .docx', () => {
      expect(getContentTypeByExtension('document.docx')).toBe('word');
    });

    it('returns ppt for .pptx', () => {
      expect(getContentTypeByExtension('slides.pptx')).toBe('ppt');
    });

    it('returns excel for .xlsx', () => {
      expect(getContentTypeByExtension('spreadsheet.xlsx')).toBe('excel');
    });

    it('returns image for .png', () => {
      expect(getContentTypeByExtension('photo.png')).toBe('image');
    });

    it('returns diff for .diff', () => {
      expect(getContentTypeByExtension('changes.diff')).toBe('diff');
    });

    it('returns drawio for .drawio, .dio and compound .drawio.* / .dio.* files', () => {
      expect(getContentTypeByExtension('diagram.drawio')).toBe('drawio');
      expect(getContentTypeByExtension('workflow.dio')).toBe('drawio');
      expect(getContentTypeByExtension('system.drawio.xml')).toBe('drawio');
      expect(getContentTypeByExtension('pipeline.dio.xml')).toBe('drawio');
      expect(getContentTypeByExtension('chart.drawio.png')).toBe('drawio');
      expect(getContentTypeByExtension('chart.dio.png')).toBe('drawio');
      expect(getContentTypeByExtension('doc.drawio.pdf')).toBe('drawio');
      expect(getContentTypeByExtension('vector.drawio.svg')).toBe('drawio');
    });

    it('returns regular types for regular png, pdf, svg without drawio prefix', () => {
      expect(getContentTypeByExtension('photo.png')).toBe('image');
      expect(getContentTypeByExtension('document.pdf')).toBe('pdf');
      expect(getContentTypeByExtension('icon.svg')).toBe('image');
    });

    it('returns code as default for unknown extension', () => {
      expect(getContentTypeByExtension('script.ts')).toBe('code');
      expect(getContentTypeByExtension('app.jsx')).toBe('code');
    });

    it('returns code for files without extension', () => {
      expect(getContentTypeByExtension('Makefile')).toBe('code');
    });
  });

  describe('isImageFile', () => {
    it('returns true for image extensions', () => {
      expect(isImageFile('photo.png')).toBe(true);
      expect(isImageFile('icon.svg')).toBe(true);
      expect(isImageFile('image.JPEG')).toBe(true);
    });

    it('returns false for non-image files', () => {
      expect(isImageFile('document.pdf')).toBe(false);
      expect(isImageFile('script.ts')).toBe(false);
      expect(isImageFile('diagram.drawio')).toBe(false);
    });
  });

  describe('isTextFile', () => {
    it('returns true for text types', () => {
      expect(isTextFile('README.md')).toBe(true);
      expect(isTextFile('index.html')).toBe(true);
      expect(isTextFile('script.ts')).toBe(true);
      expect(isTextFile('diagram.drawio')).toBe(true);
      expect(isTextFile('flow.dio')).toBe(true);
    });

    it('returns false for binary types', () => {
      expect(isTextFile('document.docx')).toBe(false);
      expect(isTextFile('photo.png')).toBe(false);
      expect(isTextFile('report.pdf')).toBe(false);
    });
  });

  describe('isOfficeFile', () => {
    it('returns true for Office types', () => {
      expect(isOfficeFile('document.docx')).toBe(true);
      expect(isOfficeFile('slides.pptx')).toBe(true);
      expect(isOfficeFile('data.xlsx')).toBe(true);
    });

    it('returns false for non-Office types', () => {
      expect(isOfficeFile('photo.png')).toBe(false);
      expect(isOfficeFile('script.ts')).toBe(false);
      expect(isOfficeFile('diagram.drawio')).toBe(false);
    });
  });

  describe('FILE_EXTENSION_MAP', () => {
    it('contains markdown extensions', () => {
      expect(FILE_EXTENSION_MAP.markdown).toContain('md');
      expect(FILE_EXTENSION_MAP.markdown).toContain('markdown');
    });

    it('contains image extensions', () => {
      expect(FILE_EXTENSION_MAP.image).toContain('png');
      expect(FILE_EXTENSION_MAP.image).toContain('svg');
    });

    it('contains drawio extensions', () => {
      expect(FILE_EXTENSION_MAP.drawio).toContain('drawio');
      expect(FILE_EXTENSION_MAP.drawio).toContain('dio');
    });
  });
});

// buildPdfSrc's stream-URL contract is covered in previewUrls.dom.test.ts
// (it now builds a backend /api/fs/stream URL from a ChatFileRef, replacing the
// old file:// path behaviour).
