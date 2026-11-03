import { c as _c } from "react/compiler-runtime";
// TeleportResumeWrapper 是从远端恢复会话流程的总装组件：负责会话选择、加载态、错误展示，并把结果回传给上层。
import React, { useEffect } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import type { TeleportRemoteResponse } from 'src/utils/conversationRecovery.js';
import type { CodeSession } from 'src/utils/teleport/api.js';
import { type TeleportSource, useTeleportResume } from '../hooks/useTeleportResume.js';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { ResumeTask } from './ResumeTask.js';
import { Spinner } from './Spinner.js';
interface TeleportResumeWrapperProps {
  onComplete: (result: TeleportRemoteResponse) => void;
  onCancel: () => void;
  onError?: (error: string, formattedMessage?: string) => void;
  isEmbedded?: boolean;
  source: TeleportSource;
}
// Props 暴露 onComplete / onCancel / onError 三个回调，以及是否内嵌、来源 source 两个开关。

/**
 * Wrapper component that manages the full teleport resume flow,
 * including session selection, loading state, and error handling
 */
// 文件头注释说明本组件管理整个 teleport resume 流程，包括会话选择、加载态和错误处理。
export function TeleportResumeWrapper(t0) {
  const $ = _c(25);
  const {
    onComplete,
    onCancel,
    onError,
    isEmbedded: t1,
    source
  } = t0;
  const isEmbedded = t1 === undefined ? false : t1;
// 组件解构 props，并把 isEmbedded 的 undefined 兜底成 false；随后从 useTeleportResume 拿到恢复动作和状态。
  const {
    resumeSession,
    isResuming,
    error,
    selectedSession
  } = useTeleportResume(source);
// useTeleportResume 按 source 提供 resumeSession / isResuming / error / selectedSession。
  let t2;
  let t3;
  if ($[0] !== source) {
    t2 = () => {
      logEvent("tengu_teleport_started", {
        source: source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    };
    t3 = [source];
    $[0] = source;
    $[1] = t2;
    $[2] = t3;
  } else {
    t2 = $[1];
    t3 = $[2];
  }
  useEffect(t2, t3);
// 进入时打一个 tengu_teleport_started 埋点，source 作为事件属性；依赖只在 source 变化时重打。
  let t4;
  if ($[3] !== error || $[4] !== onComplete || $[5] !== onError || $[6] !== resumeSession) {
    t4 = async session => {
      const result = await resumeSession(session);
      if (result) {
        onComplete(result);
      } else {
        if (error) {
          if (onError) {
            onError(error.message, error.formattedMessage);
          }
        }
      }
    };
    $[3] = error;
    $[4] = onComplete;
    $[5] = onError;
    $[6] = resumeSession;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
// handleSelect 调用 resumeSession，成功就 onComplete(result)，失败且存在 error 时通过 onError 把 message 和格式化信息回传。
  const handleSelect = t4;
  let t5;
  if ($[8] !== onCancel) {
    t5 = () => {
      logEvent("tengu_teleport_cancelled", {});
      onCancel();
    };
    $[8] = onCancel;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  const handleCancel = t5;
// handleCancel 先打 tengu_teleport_cancelled 埋点再调用 onCancel。
  const t6 = !!error && !onError;
  let t7;
  if ($[10] !== t6) {
    t7 = {
      context: "Global",
      isActive: t6
    };
    $[10] = t6;
    $[11] = t7;
  } else {
    t7 = $[11];
  }
// 当既有 error 又没有 onError 时，把 app:interrupt 键绑定到 handleCancel，用于让用户能中断。
  useKeybinding("app:interrupt", handleCancel, t7);
  if (isResuming && selectedSession) {
    let t8;
    if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
      t8 = <Box flexDirection="row"><Spinner /><Text bold={true}>Resuming session…</Text></Box>;
      $[12] = t8;
    } else {
      t8 = $[12];
    }
    let t9;
    if ($[13] !== selectedSession.title) {
      t9 = <Box flexDirection="column" padding={1}>{t8}<Text dimColor={true}>Loading "{selectedSession.title}"…</Text></Box>;
      $[13] = selectedSession.title;
      $[14] = t9;
    } else {
      t9 = $[14];
    }
    return t9;
// 正在恢复且有选中会话时，展示 Resuming session 加转圈，并提示正在加载哪个会话标题。
  }
  if (error && !onError) {
    let t8;
    if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
      t8 = <Text bold={true} color="error">Failed to resume session</Text>;
      $[15] = t8;
    } else {
      t8 = $[15];
    }
    let t9;
    if ($[16] !== error.message) {
      t9 = <Text dimColor={true}>{error.message}</Text>;
      $[16] = error.message;
      $[17] = t9;
    } else {
      t9 = $[17];
    }
    let t10;
    if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
      t10 = <Box marginTop={1}><Text dimColor={true}>Press <Text bold={true}>Esc</Text> to cancel</Text></Box>;
      $[18] = t10;
    } else {
      t10 = $[18];
    }
    let t11;
    if ($[19] !== t9) {
      t11 = <Box flexDirection="column" padding={1}>{t8}{t9}{t10}</Box>;
      $[19] = t9;
      $[20] = t11;
    } else {
      t11 = $[20];
    }
    return t11;
// 若恢复出错且没设 onError（自己处理不了），就直接渲染失败文案加具体错误和 Esc 取消提示。
  }
  let t8;
  if ($[21] !== handleCancel || $[22] !== handleSelect || $[23] !== isEmbedded) {
    t8 = <ResumeTask onSelect={handleSelect} onCancel={handleCancel} isEmbedded={isEmbedded} />;
    $[21] = handleCancel;
    $[22] = handleSelect;
    $[23] = isEmbedded;
    $[24] = t8;
  } else {
    t8 = $[24];
  }
  return t8;
// 正常情况把选择 / 取消 / 内嵌三个开关透传给 ResumeTask 组件，由它负责真正的会话列表 UI，组件返回拼装好的 ResumeTask。
}
// 原文件此处有一行 10944 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。