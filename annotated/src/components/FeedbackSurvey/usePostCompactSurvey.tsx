import { c as _c } from "react/compiler-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isFeedbackSurveyDisabled } from 'src/services/analytics/config.js';
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { shouldUseSessionMemoryCompaction } from '../../services/compact/sessionMemoryCompact.js';
import type { Message } from '../../types/message.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { isCompactBoundaryMessage } from '../../utils/messages.js';
import { logOTelEvent } from '../../utils/telemetry/events.js';
import { useSurveyState } from './useSurveyState.js';
import type { FeedbackSurveyResponse } from './utils.js';
const HIDE_THANKS_AFTER_MS = 3000;
const POST_COMPACT_SURVEY_GATE = 'tengu_post_compact_survey';
const SURVEY_PROBABILITY = 0.2; // Show survey 20% of the time after compaction
// 压缩后问卷的触发概率固定为 20%（SURVEY_PROBABILITY）。
// 只有会话发生过压缩（compaction）之后，才按这个概率弹出反馈问卷。

function hasMessageAfterBoundary(messages: Message[], boundaryUuid: string): boolean {
  const boundaryIndex = messages.findIndex(msg => msg.uuid === boundaryUuid);
  if (boundaryIndex === -1) {
    return false;
  }

  // Check if there's a user or assistant message after the boundary
  for (let i = boundaryIndex + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg && (msg.type === 'user' || msg.type === 'assistant')) {
      return true;
    }
  }
  return false;
}
// hasMessageAfterBoundary 判断压缩边界之后是否还存在真实对话消息：
// 有 user/assistant 消息才说明这次压缩产生了新上下文，值得追访问卷。
export function usePostCompactSurvey(messages, isLoading, t0, t1) {
  const $ = _c(23);
  const hasActivePrompt = t0 === undefined ? false : t0;
  let t2;
  if ($[0] !== t1) {
    t2 = t1 === undefined ? {} : t1;
    $[0] = t1;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const {
    enabled: t3
  } = t2;
  const enabled = t3 === undefined ? true : t3;
  const [gateEnabled, setGateEnabled] = useState(null);
  let t4;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = new Set();
    $[2] = t4;
  } else {
    t4 = $[2];
  }
  const seenCompactBoundaries = useRef(t4);
  const pendingCompactBoundaryUuid = useRef(null);
  const onOpen = _temp;
  const onSelect = _temp2;
  let t5;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = {
      hideThanksAfterMs: HIDE_THANKS_AFTER_MS,
      onOpen,
      onSelect
    };
    $[3] = t5;
  } else {
    t5 = $[3];
  }
  const {
    state,
    lastResponse,
    open,
    handleSelect
  } = useSurveyState(t5);
// useSurveyState 提供问卷状态机（state / lastResponse / open / handleSelect），
// 本组件只负责『何时弹出』与『记录事件』，UI 交互交给它。
  let t6;
  let t7;
  if ($[4] !== enabled) {
    t6 = () => {
      if (!enabled) {
        return;
      }
      setGateEnabled(checkStatsigFeatureGate_CACHED_MAY_BE_STALE(POST_COMPACT_SURVEY_GATE));
    };
    t7 = [enabled];
    $[4] = enabled;
    $[5] = t6;
    $[6] = t7;
  } else {
    t6 = $[5];
    t7 = $[6];
  }
  useEffect(t6, t7);
  let t8;
  if ($[7] !== messages) {
    t8 = new Set(messages.filter(_temp3).map(_temp4));
    $[7] = messages;
    $[8] = t8;
  } else {
    t8 = $[8];
  }
  const currentCompactBoundaries = t8;
  let t10;
  let t9;
  if ($[9] !== currentCompactBoundaries || $[10] !== enabled || $[11] !== gateEnabled || $[12] !== hasActivePrompt || $[13] !== isLoading || $[14] !== messages || $[15] !== open || $[16] !== state) {
    t9 = () => {
      if (!enabled) {
        return;
      }
      if (state !== "closed" || isLoading) {
        return;
      }
      if (hasActivePrompt) {
        return;
      }
      if (gateEnabled !== true) {
        return;
      }
      if (isFeedbackSurveyDisabled()) {
        return;
      }
      if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY)) {
        return;
      }
      if (pendingCompactBoundaryUuid.current !== null) {
        if (hasMessageAfterBoundary(messages, pendingCompactBoundaryUuid.current)) {
          pendingCompactBoundaryUuid.current = null;
          if (Math.random() < SURVEY_PROBABILITY) {
            open();
          }
          return;
        }
      }
      const newBoundaries = Array.from(currentCompactBoundaries).filter(uuid => !seenCompactBoundaries.current.has(uuid));
      if (newBoundaries.length > 0) {
        seenCompactBoundaries.current = new Set(currentCompactBoundaries);
        pendingCompactBoundaryUuid.current = newBoundaries[newBoundaries.length - 1];
      }
    };
    t10 = [enabled, currentCompactBoundaries, state, isLoading, hasActivePrompt, gateEnabled, messages, open];
    $[9] = currentCompactBoundaries;
    $[10] = enabled;
    $[11] = gateEnabled;
    $[12] = hasActivePrompt;
    $[13] = isLoading;
    $[14] = messages;
    $[15] = open;
    $[16] = state;
    $[17] = t10;
    $[18] = t9;
  } else {
    t10 = $[17];
    t9 = $[18];
  }
  useEffect(t9, t10);
// 第二个 useEffect 是真正的触发逻辑：
// 满足未禁用、空闲、有 pending 边界等条件后，按 20% 概率调用 open() 弹出问卷。
  let t11;
  if ($[19] !== handleSelect || $[20] !== lastResponse || $[21] !== state) {
    t11 = {
      state,
      lastResponse,
      handleSelect
    };
    $[19] = handleSelect;
    $[20] = lastResponse;
    $[21] = state;
    $[22] = t11;
  } else {
    t11 = $[22];
  }
  return t11;
}
// 主 hook 返回 {state, lastResponse, handleSelect} 给上层渲染，
// 其余内部状态（已见边界集合、gate 开关等）都封在闭包里。
function _temp4(msg_0) {
  return msg_0.uuid;
}
function _temp3(msg) {
  return isCompactBoundaryMessage(msg);
}
// _temp3 判断一条消息是否为压缩边界（isCompactBoundaryMessage）。
function _temp2(appearanceId_0, selected) {
  const smCompactionEnabled_0 = shouldUseSessionMemoryCompaction();
  logEvent("tengu_post_compact_survey_event", {
    event_type: "responded" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    appearance_id: appearanceId_0 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    response: selected as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    session_memory_compaction_enabled: smCompactionEnabled_0 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  logOTelEvent("feedback_survey", {
    event_type: "responded",
    appearance_id: appearanceId_0,
    response: selected,
    survey_type: "post_compact"
  });
}
// _temp2 在用户作答时记录反馈事件：
// 同时打 tengu_post_compact_survey_event（Statsig）与 feedback_survey（OTel）两条。
function _temp(appearanceId) {
  const smCompactionEnabled = shouldUseSessionMemoryCompaction();
  logEvent("tengu_post_compact_survey_event", {
    event_type: "appeared" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    appearance_id: appearanceId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    session_memory_compaction_enabled: smCompactionEnabled as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  logOTelEvent("feedback_survey", {
    event_type: "appeared",
    appearance_id: appearanceId,
    survey_type: "post_compact"
  });
}
// _temp 在问卷『出现』时记录曝光事件，与作答事件分开统计。
// 原文件此处有一行 17572 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。