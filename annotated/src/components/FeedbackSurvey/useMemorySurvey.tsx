import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isFeedbackSurveyDisabled } from 'src/services/analytics/config.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { isAutoMemoryEnabled } from '../../memdir/paths.js';
import { isPolicyAllowed } from '../../services/policyLimits/index.js';
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js';
import type { Message } from '../../types/message.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { isAutoManagedMemoryFile } from '../../utils/memoryFileDetection.js';
import { extractTextContent, getLastAssistantMessage } from '../../utils/messages.js';
import { logOTelEvent } from '../../utils/telemetry/events.js';
import { submitTranscriptShare } from './submitTranscriptShare.js';
import type { TranscriptShareResponse } from './TranscriptSharePrompt.js';
import { useSurveyState } from './useSurveyState.js';
import type { FeedbackSurveyResponse } from './utils.js';
// 常量：感谢语隐藏延迟、记忆调查开关名、触发概率等。
const HIDE_THANKS_AFTER_MS = 3000;
const MEMORY_SURVEY_GATE = 'tengu_dunwich_bell';
const MEMORY_SURVEY_EVENT = 'tengu_memory_survey_event';
const SURVEY_PROBABILITY = 0.2;
const TRANSCRIPT_SHARE_TRIGGER = 'memory_survey';
const MEMORY_WORD_RE = /\bmemor(?:y|ies)\b/i;
// hasMemoryFileRead：扫描消息，判断是否曾读取过自动管理的记忆文件。
function hasMemoryFileRead(messages: Message[]): boolean {
  for (const message of messages) {
    if (message.type !== 'assistant') {
      continue;
    }
    const content = message.message.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (block.type !== 'tool_use' || block.name !== FILE_READ_TOOL_NAME) {
        continue;
      }
      const input = block.input as {
        file_path?: unknown;
      };
      if (typeof input.file_path === 'string' && isAutoManagedMemoryFile(input.file_path)) {
        return true;
      }
    }
  }
  return false;
}
// useMemorySurvey：控制「记忆反馈调查」是否弹出的核心钩子。
export function useMemorySurvey(messages: Message[], isLoading: boolean, hasActivePrompt = false, {
  enabled = true
}: {
  enabled?: boolean;
} = {}): {
  state: 'closed' | 'open' | 'thanks' | 'transcript_prompt' | 'submitting' | 'submitted';
  lastResponse: FeedbackSurveyResponse | null;
  handleSelect: (selected: FeedbackSurveyResponse) => void;
  handleTranscriptSelect: (selected: TranscriptShareResponse) => void;
} {
  // Track assistant message UUIDs that were already evaluated so we don't
  // re-roll probability on re-renders or re-scan messages for the same turn.
// 注释：用 ref 记录已评估过的助手消息，避免重复概率判定。
  const seenAssistantUuids = useRef<Set<string>>(new Set());
  // Once a memory file read is observed it stays true for the session —
  // skip the O(n) scan on subsequent turns.
  const memoryReadSeen = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
// onOpen：调查出现时上报 appeared 事件（分析 + OTel）。
  const onOpen = useCallback((appearanceId: string) => {
    logEvent(MEMORY_SURVEY_EVENT, {
      event_type: 'appeared' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'appeared',
      appearance_id: appearanceId,
      survey_type: 'memory'
    });
  }, []);
// onSelect：用户作答时上报 responded 事件。
  const onSelect = useCallback((appearanceId_0: string, selected: FeedbackSurveyResponse) => {
    logEvent(MEMORY_SURVEY_EVENT, {
      event_type: 'responded' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId_0 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      response: selected as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'responded',
      appearance_id: appearanceId_0,
      response: selected,
      survey_type: 'memory'
    });
  }, []);
// shouldShowTranscriptPrompt：仅在内部环境且作答为 bad/good 时考虑弹出转录分享。
  const shouldShowTranscriptPrompt = useCallback((selected_0: FeedbackSurveyResponse) => {
    if ("external" !== 'ant') {
      return false;
    }
    if (selected_0 !== 'bad' && selected_0 !== 'good') {
      return false;
    }
    if (getGlobalConfig().transcriptShareDismissed) {
      return false;
    }
    if (!isPolicyAllowed('allow_product_feedback')) {
      return false;
    }
    return true;
  }, []);
  const onTranscriptPromptShown = useCallback((appearanceId_1: string) => {
    logEvent(MEMORY_SURVEY_EVENT, {
      event_type: 'transcript_prompt_appeared' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId_1 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger: TRANSCRIPT_SHARE_TRIGGER as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    void logOTelEvent('feedback_survey', {
      event_type: 'transcript_prompt_appeared',
      appearance_id: appearanceId_1,
      survey_type: 'memory'
    });
  }, []);
// onTranscriptSelect：处理转录分享选择，记录结果或标记「不再询问」。
  const onTranscriptSelect = useCallback(async (appearanceId_2: string, selected_1: TranscriptShareResponse): Promise<boolean> => {
    logEvent(MEMORY_SURVEY_EVENT, {
      event_type: `transcript_share_${selected_1}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      appearance_id: appearanceId_2 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger: TRANSCRIPT_SHARE_TRIGGER as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    if (selected_1 === 'dont_ask_again') {
      saveGlobalConfig(current => ({
        ...current,
        transcriptShareDismissed: true
      }));
    }
    if (selected_1 === 'yes') {
      const result = await submitTranscriptShare(messagesRef.current, TRANSCRIPT_SHARE_TRIGGER, appearanceId_2);
      logEvent(MEMORY_SURVEY_EVENT, {
        event_type: (result.success ? 'transcript_share_submitted' : 'transcript_share_failed') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        appearance_id: appearanceId_2 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        trigger: TRANSCRIPT_SHARE_TRIGGER as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      return result.success;
    }
    return false;
  }, []);
// 接入共享调查状态机（useSurveyState），注入各回调。
  const {
    state,
    lastResponse,
    open,
    handleSelect,
    handleTranscriptSelect
  } = useSurveyState({
    hideThanksAfterMs: HIDE_THANKS_AFTER_MS,
    onOpen,
    onSelect,
    shouldShowTranscriptPrompt,
    onTranscriptPromptShown,
    onTranscriptSelect
  });
// 取最近一条助手消息作为触发判定的依据。
  const lastAssistant = useMemo(() => getLastAssistantMessage(messages), [messages]);
// 主副作用：满足多重条件（特性开启、自动记忆、策略允许、命中记忆词）后按概率弹出调查。
  useEffect(() => {
    if (!enabled) return;

    // /clear resets messages but REPL stays mounted — reset refs so a memory
    // read from the previous conversation doesn't leak into the new one.
    if (messages.length === 0) {
      memoryReadSeen.current = false;
      seenAssistantUuids.current.clear();
      return;
    }
    if (state !== 'closed' || isLoading || hasActivePrompt) {
      return;
    }

    // 3P default: survey off (no GrowthBook on Bedrock/Vertex/Foundry).
    if (!getFeatureValue_CACHED_MAY_BE_STALE(MEMORY_SURVEY_GATE, false)) {
      return;
    }
    if (!isAutoMemoryEnabled()) {
      return;
    }
    if (isFeedbackSurveyDisabled()) {
      return;
    }
    if (!isPolicyAllowed('allow_product_feedback')) {
      return;
    }
    if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY)) {
      return;
    }
    if (!lastAssistant || seenAssistantUuids.current.has(lastAssistant.uuid)) {
      return;
    }
    const text = extractTextContent(lastAssistant.message.content, ' ');
    if (!MEMORY_WORD_RE.test(text)) {
      return;
    }

    // Mark as evaluated before the memory-read scan so a turn that mentions
    // "memory" but has no memory read doesn't trigger repeated O(n) scans
    // on subsequent renders with the same last assistant message.
    seenAssistantUuids.current.add(lastAssistant.uuid);
    if (!memoryReadSeen.current) {
      memoryReadSeen.current = hasMemoryFileRead(messages);
    }
    if (!memoryReadSeen.current) {
      return;
    }
    if (Math.random() < SURVEY_PROBABILITY) {
      open();
    }
  }, [enabled, state, isLoading, hasActivePrompt, lastAssistant, messages, open]);
// 返回调查状态与两个选择回调供组件消费。
  return {
    state,
    lastResponse,
    handleSelect,
    handleTranscriptSelect
  };
}
// 原文件此处有一行 21952 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。