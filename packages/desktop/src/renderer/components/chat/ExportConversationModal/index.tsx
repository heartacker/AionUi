/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import AionModal from '@/renderer/components/base/AionModal';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import {
  type ExportFormat,
  type ExportScope,
  buildDefaultExportFileName,
  buildFormattedExport,
  filterExportMessages,
  formatDisplayDateTime,
  getMessageRoleKey,
  isDialogueMessage,
  joinFilePath,
  normalizeExportFileName,
  readMessageContent,
  resolveExportBaseDirectory,
} from '@/renderer/utils/chat/conversationExport';
import { loadAllConversationMessagesPaged } from '@/renderer/utils/chat/messagePagination';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { Button, Checkbox, Input, Message, Radio, Spin, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { CheckOne, Copy, DownloadOne, FileText } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ExportConversationModalProps {
  visible: boolean;
  conversation_id?: string;
  conversation?: TChatConversation | null;
  assistantName?: string;
  workspace?: string;
  onCancel: () => void;
}

const STORAGE_KEY_USER_NICKNAME = 'aionui_export_user_nickname';
const STORAGE_KEY_AI_NICKNAME = 'aionui_export_ai_nickname';

const ExportConversationModal: React.FC<ExportConversationModalProps> = ({
  visible,
  conversation_id,
  conversation: propConversation,
  assistantName,
  workspace,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [conversation, setConversation] = useState<TChatConversation | null>(propConversation ?? null);
  const [messages, setMessages] = useState<TMessage[]>([]);
  const [scope, setScope] = useState<ExportScope>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [userNickname, setUserNickname] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_USER_NICKNAME) || '';
  });
  const [aiNickname, setAiNickname] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_AI_NICKNAME) || assistantName || '';
  });
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [includeTimestamp, setIncludeTimestamp] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);

  // Sync assistant name if aiNickname is empty
  useEffect(() => {
    if (!aiNickname && assistantName) {
      setAiNickname(assistantName);
    }
  }, [assistantName, aiNickname]);

  // Load conversation & messages when visible
  useEffect(() => {
    if (!visible) return;

    setScope('all');
    let isMounted = true;
    const targetId = conversation_id || propConversation?.id;
    if (!targetId) return;

    setLoading(true);
    Promise.all([
      propConversation ? Promise.resolve(propConversation) : getConversationOrNull(targetId),
      loadAllConversationMessagesPaged(targetId),
    ])
      .then(([conv, allMsgs]) => {
        if (!isMounted) return;
        setConversation(conv);
        const dialogueMsgs = allMsgs.filter(isDialogueMessage);
        setMessages(dialogueMsgs);
        setSelectedIds(dialogueMsgs.map((m) => m.id));
      })
      .catch((error) => {
        console.error('[ExportConversationModal] Failed to load messages:', error);
        Message.error(t('messages.export.prepareFailed'));
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [visible, conversation_id, propConversation, t]);

  // Save nickname preferences
  const handleUserNicknameChange = useCallback((value: string) => {
    setUserNickname(value);
    localStorage.setItem(STORAGE_KEY_USER_NICKNAME, value);
  }, []);

  const handleAiNicknameChange = useCallback((value: string) => {
    setAiNickname(value);
    localStorage.setItem(STORAGE_KEY_AI_NICKNAME, value);
  }, []);

  // Filtered messages based on current scope
  const exportableMessages = useMemo(() => {
    return filterExportMessages(messages, scope, selectedIds);
  }, [messages, scope, selectedIds]);

  // Build real-time export preview text
  const previewContent = useMemo(() => {
    if (!conversation) return '';
    return buildFormattedExport(conversation, messages, {
      scope,
      selectedMessageIds: selectedIds,
      userNickname: userNickname || t('messages.export.userLabel'),
      aiNickname: aiNickname || assistantName || t('messages.export.assistantLabel'),
      includeTimestamp,
      format,
    });
  }, [
    conversation,
    messages,
    scope,
    selectedIds,
    userNickname,
    aiNickname,
    assistantName,
    includeTimestamp,
    format,
    t,
  ]);

  // Custom selection helpers
  const handleToggleSelectAll = useCallback(() => {
    if (selectedIds.length === messages.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(messages.map((m) => m.id));
    }
  }, [selectedIds.length, messages]);

  const handleToggleSelectMessage = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  // Copy to clipboard
  const handleCopy = useCallback(async () => {
    if (!previewContent) {
      Message.warning(t('messages.exportModal.noContentWarning'));
      return;
    }
    try {
      setExporting(true);
      await copyText(previewContent);
      Message.success(t('messages.exportModal.copySuccess'));
      onCancel();
    } catch (error) {
      console.error('Failed to copy export content:', error);
      Message.error(t('messages.export.copyFailed'));
    } finally {
      setExporting(false);
    }
  }, [previewContent, t, onCancel]);

  // Save to file
  const handleDownload = useCallback(async () => {
    if (!previewContent || !conversation) {
      Message.warning(t('messages.exportModal.noContentWarning'));
      return;
    }
    try {
      setExporting(true);
      let desktopPath = '';
      if (!workspace?.trim()) {
        try {
          desktopPath = await ipcBridge.application.getPath.invoke({ name: 'desktop' });
        } catch {
          desktopPath = '';
        }
      }

      const baseDir = resolveExportBaseDirectory(workspace, desktopPath);
      const ext = format === 'markdown' ? 'md' : format === 'json' ? 'json' : 'txt';
      const defaultFileName = buildDefaultExportFileName(conversation.id, conversation.name || 'conversation', ext);
      const normalizedFileName = normalizeExportFileName(defaultFileName, ext);
      const targetPath = joinFilePath(baseDir, normalizedFileName);

      const success = await ipcBridge.fs.writeFile.invoke({
        path: targetPath,
        data: previewContent,
        workspace: baseDir,
      });

      if (!success) {
        Message.error(t('messages.exportModal.saveFailed'));
        return;
      }

      Message.success({
        content: (
          <div className='flex flex-col gap-6px'>
            <div>{t('messages.exportModal.saveSuccess', { path: targetPath })}</div>
            <div className='flex justify-end'>
              <Button
                size='mini'
                type='text'
                onClick={() => {
                  void copyText(targetPath).then(() => {
                    Message.success(t('common.copySuccess'));
                  });
                }}
              >
                {t('messages.copy')}
              </Button>
            </div>
          </div>
        ),
        duration: 5000,
      });
      onCancel();
    } catch (error) {
      console.error('Failed to save export file:', error);
      Message.error(t('messages.exportModal.saveFailed'));
    } finally {
      setExporting(false);
    }
  }, [previewContent, conversation, workspace, format, t, onCancel]);

  if (!visible) {
    return null;
  }

  return (
    <AionModal
      visible={visible}
      onCancel={onCancel}
      variant='standard'
      size='large'
      header={{
        title: (
          <div className='flex items-center gap-8px'>
            <FileText theme='outline' size='20' fill='var(--primary)' />
            <span>{t('messages.exportModal.title')}</span>
          </div>
        ),
        subtitle: t('messages.exportModal.subtitle'),
      }}
      footer={{
        render: () => (
          <div className='flex items-center justify-between w-full'>
            <div className='text-12px text-t-secondary'>
              {t('messages.exportModal.customSelectionCount', {
                selected: exportableMessages.length,
                total: messages.length,
              })}
            </div>
            <div className='flex items-center gap-12px'>
              <Button onClick={onCancel}>{t('common.cancel')}</Button>
              <Button
                type='outline'
                icon={<Copy size={14} />}
                onClick={handleCopy}
                loading={exporting}
                disabled={loading || exportableMessages.length === 0}
              >
                {t('messages.exportModal.copyButton')}
              </Button>
              <Button
                type='primary'
                icon={<DownloadOne size={14} />}
                onClick={handleDownload}
                loading={exporting}
                disabled={loading || exportableMessages.length === 0}
              >
                {t('messages.exportModal.downloadButton')}
              </Button>
            </div>
          </div>
        ),
      }}
    >
      <Spin loading={loading} className='w-full'>
        <div className='flex flex-col gap-20px'>
          {/* Section 1: 导出范围 */}
          <div className='flex flex-col gap-10px'>
            <div className='text-14px font-600 text-t-primary'>{t('messages.exportModal.scopeTitle')}</div>
            <Radio.Group
              type='button'
              value={scope}
              onChange={(val) => setScope(val as ExportScope)}
              className='grid grid-cols-2 md:grid-cols-4 gap-8px'
            >
              <Radio value='all'>{t('messages.exportModal.scopeAll')}</Radio>
              <Radio value='user'>{t('messages.exportModal.scopeUser')}</Radio>
              <Radio value='assistant'>{t('messages.exportModal.scopeAssistant')}</Radio>
              <Radio value='custom'>{t('messages.exportModal.scopeCustom')}</Radio>
            </Radio.Group>

            {/* 自定义勾选列表 */}
            {scope === 'custom' && (
              <div className='border border-solid border-[var(--bg-3)] rounded-8px p-12px bg-[var(--bg-1)] flex flex-col gap-10px'>
                <div className='flex items-center justify-between pb-8px border-b border-solid border-[var(--bg-3)]'>
                  <span className='text-12px text-t-secondary'>
                    {t('messages.exportModal.customSelectionCount', {
                      selected: selectedIds.length,
                      total: messages.length,
                    })}
                  </span>
                  <Button size='mini' type='text' onClick={handleToggleSelectAll}>
                    {selectedIds.length === messages.length
                      ? t('messages.exportModal.deselectAll')
                      : t('messages.exportModal.selectAll')}
                  </Button>
                </div>
                <div className='max-h-180px overflow-y-auto flex flex-col gap-8px pr-4px'>
                  {messages.map((msg, index) => {
                    const isUser = getMessageRoleKey(msg) === 'user';
                    const isChecked = selectedIds.includes(msg.id);
                    const rawContent = readMessageContent(msg, true);
                    return (
                      <div
                        key={msg.id}
                        onClick={() => handleToggleSelectMessage(msg.id)}
                        className={`flex items-start gap-10px p-8px rounded-6px cursor-pointer transition-colors ${
                          isChecked ? 'bg-[var(--primary-light)]' : 'hover:bg-[var(--bg-2)]'
                        }`}
                      >
                        <Checkbox checked={isChecked} className='mt-2px' />
                        <div className='flex-1 min-w-0'>
                          <div className='flex items-center justify-between gap-8px mb-2px'>
                            <Tag size='small' color={isUser ? 'arcoblue' : 'green'} className='font-600'>
                              {isUser ? userNickname || 'User' : aiNickname || assistantName || 'AI'}
                            </Tag>
                            {msg.created_at && (
                              <span className='text-10px text-t-tertiary'>{formatDisplayDateTime(msg.created_at)}</span>
                            )}
                          </div>
                          <Typography.Paragraph
                            ellipsis={{ rows: 2 }}
                            className='text-12px text-t-secondary m-0 leading-18px break-words'
                          >
                            {rawContent}
                          </Typography.Paragraph>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Section 2: 角色昵称自定义 */}
          <div className='flex flex-col gap-10px'>
            <div className='text-14px font-600 text-t-primary'>{t('messages.exportModal.rolesTitle')}</div>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-12px'>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>{t('messages.exportModal.userNickname')}</span>
                <Input
                  value={userNickname}
                  placeholder={t('messages.exportModal.userNicknamePlaceholder')}
                  onChange={handleUserNicknameChange}
                  allowClear
                />
              </div>
              <div className='flex flex-col gap-4px'>
                <span className='text-12px text-t-secondary'>{t('messages.exportModal.aiNickname')}</span>
                <Input
                  value={aiNickname}
                  placeholder={t('messages.exportModal.aiNicknamePlaceholder')}
                  onChange={handleAiNicknameChange}
                  allowClear
                />
              </div>
            </div>
          </div>

          {/* Section 3: 导出格式与选项 */}
          <div className='grid grid-cols-1 md:grid-cols-2 gap-16px items-center'>
            <div className='flex items-center gap-12px'>
              <span className='text-13px font-600 text-t-primary shrink-0'>{t('messages.exportModal.format')}:</span>
              <Radio.Group type='button' size='small' value={format} onChange={(val) => setFormat(val as ExportFormat)}>
                <Radio value='markdown'>Markdown (.md)</Radio>
                <Radio value='txt'>Text (.txt)</Radio>
                <Radio value='json'>JSON (.json)</Radio>
              </Radio.Group>
            </div>
            <div className='flex items-center'>
              <Checkbox checked={includeTimestamp} onChange={setIncludeTimestamp}>
                <span className='text-13px text-t-primary'>{t('messages.exportModal.includeTimestamp')}</span>
              </Checkbox>
            </div>
          </div>

          {/* Section 4: 实时预览 */}
          <div className='flex flex-col gap-8px'>
            <div className='text-14px font-600 text-t-primary flex items-center gap-6px'>
              <span>{t('messages.exportModal.previewTitle')}</span>
              <span className='text-12px font-normal text-t-tertiary'>({format})</span>
            </div>
            <div className='relative max-h-220px min-h-120px overflow-y-auto rounded-8px p-14px bg-[var(--bg-2)] border border-solid border-[var(--bg-3)] font-mono text-12px text-t-primary whitespace-pre-wrap break-words leading-20px select-text'>
              {previewContent || (
                <span className='text-t-tertiary italic'>{t('messages.exportModal.previewEmpty')}</span>
              )}
            </div>
          </div>
        </div>
      </Spin>
    </AionModal>
  );
};

export default ExportConversationModal;
