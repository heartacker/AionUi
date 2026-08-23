/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';

const INVALID_FILENAME_CHARS_RE = /[<>:"/\\|?*]/g;
const padTimestampPart = (value: number): string => String(value).padStart(2, '0');

export const sanitizeFileName = (name: string): string => {
  const cleaned = name.replace(INVALID_FILENAME_CHARS_RE, '_').trim();
  return (cleaned || 'conversation').slice(0, 80);
};

const normalizeDefaultExportSegment = (name: string): string => {
  const normalized = sanitizeFileName(name)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'conversation';
};

const getShortConversationId = (conversation_id?: string): string => {
  const normalized = (conversation_id || '').trim();
  return normalized.slice(0, 8) || 'conversation';
};

export const joinFilePath = (dir: string, file_name: string): string => {
  const separator = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${file_name}` : `${dir}${separator}${file_name}`;
};

export const formatTimestamp = (time = Date.now()): string => {
  const date = new Date(time);
  return `${date.getFullYear()}${padTimestampPart(date.getMonth() + 1)}${padTimestampPart(date.getDate())}-${padTimestampPart(date.getHours())}${padTimestampPart(date.getMinutes())}${padTimestampPart(date.getSeconds())}`;
};

export const formatDisplayDateTime = (time = Date.now()): string => {
  const date = new Date(time);
  const year = date.getFullYear();
  const month = padTimestampPart(date.getMonth() + 1);
  const day = padTimestampPart(date.getDate());
  const hours = padTimestampPart(date.getHours());
  const minutes = padTimestampPart(date.getMinutes());
  const seconds = padTimestampPart(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const formatDefaultExportFileDate = (time = Date.now()): string => {
  const date = new Date(time);
  return `${date.getFullYear()}-${padTimestampPart(date.getMonth() + 1)}-${padTimestampPart(date.getDate())}`;
};

export const readMessageContent = (message: TMessage): string => {
  const content = message.content as Record<string, unknown> | string | undefined;

  if (typeof content === 'string') {
    return content;
  }

  if (content && typeof content === 'object' && typeof content.content === 'string') {
    return content.content;
  }

  try {
    return JSON.stringify(content ?? {}, null, 2);
  } catch {
    return String(content ?? '');
  }
};

export type MessageRole = 'user' | 'assistant' | 'system';

export type ExportTranscriptLabels = {
  conversation: string;
  conversation_id: string;
  exportedAt: string;
  type: string;
  noMessages: string;
} & Record<MessageRole, string>;

export const getMessageRoleKey = (message: TMessage): MessageRole => {
  if (message.position === 'right') return 'user';
  if (message.position === 'left') return 'assistant';
  return 'system';
};

/**
 * Validates whether a message is an eligible dialogue message (excluding tool calls, logs, permissions, and error states).
 */
export const isDialogueMessage = (message: TMessage): boolean => {
  if (message.type !== 'text') {
    return false;
  }

  if (message.status === 'error') {
    return false;
  }

  const text = readMessageContent(message).trim();
  return text.length > 0;
};

export type ExportScope = 'all' | 'user' | 'assistant' | 'custom';
export type ExportFormat = 'markdown' | 'txt' | 'json';

export interface ExportOptions {
  scope: ExportScope;
  selectedMessageIds?: string[];
  userNickname?: string;
  aiNickname?: string;
  includeTimestamp?: boolean;
  format?: ExportFormat;
}

/**
 * Filter messages according to the export scope and clean up tool logs and errors.
 */
export const filterExportMessages = (
  messages: TMessage[],
  scope: ExportScope = 'all',
  selectedMessageIds?: string[]
): TMessage[] => {
  const cleaned = messages.filter(isDialogueMessage);

  if (scope === 'user') {
    return cleaned.filter((msg) => getMessageRoleKey(msg) === 'user');
  }

  if (scope === 'assistant') {
    return cleaned.filter((msg) => getMessageRoleKey(msg) === 'assistant');
  }

  if (scope === 'custom') {
    if (!selectedMessageIds || selectedMessageIds.length === 0) {
      return [];
    }
    const idSet = new Set(selectedMessageIds);
    return cleaned.filter((msg) => idSet.has(msg.id));
  }

  return cleaned;
};

const getRoleDisplayName = (
  message: TMessage,
  userNickname?: string,
  aiNickname?: string,
  fallbackLabels?: Partial<Record<MessageRole, string>>
): string => {
  const role = getMessageRoleKey(message);
  if (role === 'user') {
    return userNickname?.trim() || fallbackLabels?.user || 'User';
  }
  if (role === 'assistant') {
    return aiNickname?.trim() || fallbackLabels?.assistant || 'AI';
  }
  return fallbackLabels?.system || 'System';
};

/**
 * Builds a clean Markdown document from the selected messages and nicknames.
 */
export const buildConversationMarkdownExport = (
  conversation: TChatConversation,
  messages: TMessage[],
  options: ExportOptions = { scope: 'all' }
): string => {
  const { userNickname, aiNickname, includeTimestamp = true } = options;
  const filteredMessages = filterExportMessages(messages, options.scope, options.selectedMessageIds);

  const lines: string[] = [];
  lines.push(`# ${conversation.name || 'Conversation'}`);
  lines.push('');
  lines.push(`> Exported at: ${formatDisplayDateTime()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  filteredMessages.forEach((msg) => {
    const roleName = getRoleDisplayName(msg, userNickname, aiNickname);
    const timeInfo = includeTimestamp && msg.created_at ? ` (${formatDisplayDateTime(msg.created_at)})` : '';
    lines.push(`## ${roleName}${timeInfo}`);
    lines.push('');
    lines.push(readMessageContent(msg).trim());
    lines.push('');
  });

  if (filteredMessages.length === 0) {
    lines.push('*No messages to export.*');
    lines.push('');
  }

  return lines.join('\n').trimEnd();
};

/**
 * Builds a plain text format export.
 */
export const buildConversationPlainTextExport = (
  conversation: TChatConversation,
  messages: TMessage[],
  options: ExportOptions = { scope: 'all' }
): string => {
  const { userNickname, aiNickname, includeTimestamp = true } = options;
  const filteredMessages = filterExportMessages(messages, options.scope, options.selectedMessageIds);

  const lines: string[] = [];
  lines.push(`=== ${conversation.name || 'Conversation'} ===`);
  lines.push(`Exported at: ${formatDisplayDateTime()}`);
  lines.push('----------------------------------------');
  lines.push('');

  filteredMessages.forEach((msg) => {
    const roleName = getRoleDisplayName(msg, userNickname, aiNickname);
    const timeInfo = includeTimestamp && msg.created_at ? ` [${formatDisplayDateTime(msg.created_at)}]` : '';
    lines.push(`${roleName}${timeInfo}:`);
    lines.push(readMessageContent(msg).trim());
    lines.push('');
    lines.push('----------------------------------------');
    lines.push('');
  });

  if (filteredMessages.length === 0) {
    lines.push('No messages to export.');
    lines.push('');
  }

  return lines.join('\n').trimEnd();
};

/**
 * Builds a clean JSON export.
 */
export const buildConversationJsonExport = (
  conversation: TChatConversation,
  messages: TMessage[],
  options: ExportOptions = { scope: 'all' }
): string => {
  const { userNickname, aiNickname } = options;
  const filteredMessages = filterExportMessages(messages, options.scope, options.selectedMessageIds);

  return JSON.stringify(
    {
      title: conversation.name || 'Conversation',
      conversation_id: conversation.id,
      exportedAt: new Date().toISOString(),
      messages: filteredMessages.map((msg) => ({
        id: msg.id,
        role: getMessageRoleKey(msg),
        senderName: getRoleDisplayName(msg, userNickname, aiNickname),
        content: readMessageContent(msg),
        createdAt: msg.created_at ? new Date(msg.created_at).toISOString() : undefined,
      })),
    },
    null,
    2
  );
};

/**
 * Unified export builder according to chosen format.
 */
export const buildFormattedExport = (
  conversation: TChatConversation,
  messages: TMessage[],
  options: ExportOptions
): string => {
  const format = options.format || 'markdown';
  switch (format) {
    case 'markdown':
      return buildConversationMarkdownExport(conversation, messages, options);
    case 'txt':
      return buildConversationPlainTextExport(conversation, messages, options);
    case 'json':
      return buildConversationJsonExport(conversation, messages, options);
    default:
      return buildConversationMarkdownExport(conversation, messages, options);
  }
};

const isShareableMessage = (message: TMessage): boolean => {
  return message.type === 'text' || message.type === 'tips';
};

const isUserTextMessage = (message: TMessage): boolean => {
  return message.type === 'text' && message.position === 'right';
};

export const buildConversationExportText = (
  conversation: TChatConversation,
  messages: TMessage[],
  labels: ExportTranscriptLabels
): string => {
  const lines: string[] = [];
  lines.push(`${labels.conversation}: ${conversation.name || labels.conversation}`);
  lines.push(`${labels.conversation_id}: ${conversation.id}`);
  lines.push(`${labels.exportedAt}: ${new Date().toISOString()}`);
  lines.push(`${labels.type}: ${conversation.type}`);
  lines.push('');

  const exportableMessages = messages.filter(isShareableMessage);
  exportableMessages.forEach((message) => {
    lines.push(`${labels[getMessageRoleKey(message)]}:`);
    lines.push(readMessageContent(message));
    lines.push('');
  });

  if (exportableMessages.length === 0) {
    lines.push(labels.noMessages);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
};

export const buildDefaultExportFileName = (
  conversation_id: string,
  conversationName: string,
  extension: 'md' | 'txt' | 'json' = 'md'
): string => {
  const safeName = normalizeDefaultExportSegment(conversationName).slice(0, 48).replace(/-+$/g, '') || 'conversation';
  return `${formatDefaultExportFileDate()}-${getShortConversationId(conversation_id)}-${safeName}.${extension}`;
};

export const getDefaultExportFileNameSource = (conversation: TChatConversation, messages: TMessage[]): string => {
  const firstUserMessage = messages.find(isUserTextMessage);
  const firstUserMessageContent = firstUserMessage ? readMessageContent(firstUserMessage).trim() : '';

  return firstUserMessageContent || conversation.name || 'conversation';
};

export const normalizeExportFileName = (input: string, extension: 'md' | 'txt' | 'json' = 'md'): string => {
  const trimmed = input.trim();
  const withoutExtension = trimmed.replace(/\.(md|txt|json)$/i, '');
  return `${sanitizeFileName(withoutExtension || 'conversation')}.${extension}`;
};

export const resolveExportBaseDirectory = (workspace?: string, desktopPath?: string): string => {
  return workspace?.trim() || desktopPath?.trim() || '';
};
