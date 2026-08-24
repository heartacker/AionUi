/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import {
  buildConversationMarkdownExport,
  buildConversationPlainTextExport,
  buildConversationJsonExport,
  buildFormattedExport,
  filterExportMessages,
  isDialogueMessage,
  normalizeExportFileName,
  sanitizeExportContent,
} from '@/renderer/utils/chat/conversationExport';

const createTestConversation = (name = 'Test Session'): TChatConversation =>
  ({
    id: 'conv-12345678-abcd',
    name,
    type: 'acp',
    created_at: 1700000000000,
    modified_at: 1700000000000,
    extra: {},
  }) as TChatConversation;

const userMsg = (id: string, text: string, createdAt = 1700000010000): TMessage => ({
  id,
  type: 'text',
  position: 'right',
  content: { content: text },
  created_at: createdAt,
});

const aiMsg = (id: string, text: string, createdAt = 1700000020000): TMessage => ({
  id,
  type: 'text',
  position: 'left',
  content: { content: text },
  created_at: createdAt,
});

const toolMsg = (id: string): TMessage => ({
  id,
  type: 'tool_call' as any,
  position: 'left',
  content: { tool: 'bash', command: 'ls' },
});

const errorMsg = (id: string): TMessage => ({
  id,
  type: 'text',
  position: 'left',
  status: 'error',
  content: { content: 'Request failed with 500' },
});

describe('conversationExport utilities', () => {
  describe('isDialogueMessage', () => {
    it('returns true for normal user and AI text messages', () => {
      expect(isDialogueMessage(userMsg('u1', 'Hello'))).toBe(true);
      expect(isDialogueMessage(aiMsg('a1', 'Hi there!'))).toBe(true);
    });

    it('returns false for tool calls, logs and errors', () => {
      expect(isDialogueMessage(toolMsg('t1'))).toBe(false);
      expect(isDialogueMessage(errorMsg('e1'))).toBe(false);
      expect(isDialogueMessage(userMsg('empty', '   '))).toBe(false);
      expect(isDialogueMessage(aiMsg('think-only', '<think>reasoning process</think>'))).toBe(false);
    });
  });

  describe('sanitizeExportContent & think tag stripping', () => {
    it('strips think tags from message content during export', () => {
      const raw = '<think>some private thought</think>Here is the answer.';
      expect(sanitizeExportContent(raw)).toBe('Here is the answer.');
    });
  });
  describe('filterExportMessages', () => {
    const messages = [
      userMsg('u1', 'Question 1'),
      toolMsg('t1'),
      aiMsg('a1', 'Answer 1'),
      userMsg('u2', 'Question 2'),
      errorMsg('e1'),
      aiMsg('a2', 'Answer 2'),
    ];

    it('filters all valid dialogue messages when scope is "all"', () => {
      const result = filterExportMessages(messages, 'all');
      expect(result.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    });

    it('filters user only messages when scope is "user"', () => {
      const result = filterExportMessages(messages, 'user');
      expect(result.map((m) => m.id)).toEqual(['u1', 'u2']);
    });

    it('filters assistant only messages when scope is "assistant"', () => {
      const result = filterExportMessages(messages, 'assistant');
      expect(result.map((m) => m.id)).toEqual(['a1', 'a2']);
    });

    it('filters custom selected messages when scope is "custom"', () => {
      const result = filterExportMessages(messages, 'custom', ['u1', 'a2', 'non-existent']);
      expect(result.map((m) => m.id)).toEqual(['u1', 'a2']);
    });
  });

  describe('buildConversationMarkdownExport', () => {
    it('generates markdown with custom nicknames and timestamps', () => {
      const conversation = createTestConversation('React Optimization');
      const messages = [userMsg('u1', 'How to optimize?'), aiMsg('a1', 'Use useMemo and useCallback.')];

      const markdown = buildConversationMarkdownExport(conversation, messages, {
        scope: 'all',
        userNickname: '小白',
        aiNickname: '我的助手',
        includeTimestamp: false,
      });

      expect(markdown).toContain('# React Optimization');
      expect(markdown).toContain('## 小白');
      expect(markdown).toContain('How to optimize?');
      expect(markdown).toContain('## 我的助手');
      expect(markdown).toContain('Use useMemo and useCallback.');
    });
  });

  describe('buildConversationPlainTextExport', () => {
    it('generates formatted plain text with custom nicknames', () => {
      const conversation = createTestConversation('Plain Text Test');
      const messages = [userMsg('u1', 'Hello text'), aiMsg('a1', 'Hi text reply')];

      const text = buildConversationPlainTextExport(conversation, messages, {
        scope: 'all',
        userNickname: 'UserA',
        aiNickname: 'AssistantB',
        includeTimestamp: false,
      });

      expect(text).toContain('=== Plain Text Test ===');
      expect(text).toContain('UserA:');
      expect(text).toContain('Hello text');
      expect(text).toContain('AssistantB:');
      expect(text).toContain('Hi text reply');
    });
  });

  describe('buildConversationJsonExport', () => {
    it('generates valid JSON with filtered dialogue and custom senderName', () => {
      const conversation = createTestConversation('JSON Test');
      const messages = [userMsg('u1', 'JSON Question'), toolMsg('t1'), aiMsg('a1', 'JSON Answer')];

      const jsonStr = buildConversationJsonExport(conversation, messages, {
        scope: 'all',
        userNickname: '小明',
        aiNickname: 'AI小助手',
      });

      const parsed = JSON.parse(jsonStr);
      expect(parsed.title).toBe('JSON Test');
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0].senderName).toBe('小明');
      expect(parsed.messages[0].content).toBe('JSON Question');
      expect(parsed.messages[1].senderName).toBe('AI小助手');
      expect(parsed.messages[1].content).toBe('JSON Answer');
    });
  });

  describe('buildFormattedExport', () => {
    it('dispatches to markdown, txt, and json correctly', () => {
      const conversation = createTestConversation('Dispatcher Test');
      const messages = [userMsg('u1', 'Test')];

      const md = buildFormattedExport(conversation, messages, { scope: 'all', format: 'markdown' });
      const txt = buildFormattedExport(conversation, messages, { scope: 'all', format: 'txt' });
      const json = buildFormattedExport(conversation, messages, { scope: 'all', format: 'json' });

      expect(md).toContain('# Dispatcher Test');
      expect(txt).toContain('=== Dispatcher Test ===');
      expect(JSON.parse(json).title).toBe('Dispatcher Test');
    });
  });

  describe('normalizeExportFileName', () => {
    it('formats file name with desired extension', () => {
      expect(normalizeExportFileName('test-file', 'md')).toBe('test-file.md');
      expect(normalizeExportFileName('test-file.txt', 'md')).toBe('test-file.md');
      expect(normalizeExportFileName('test-file.json', 'json')).toBe('test-file.json');
    });
  });
});
