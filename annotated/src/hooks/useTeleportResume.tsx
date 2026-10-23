import { c as _c } from "react/compiler-runtime";
import { useCallback, useState } from 'react';
import { setTeleportedSessionInfo } from 'src/bootstrap/state.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import type { TeleportRemoteResponse } from 'src/utils/conversationRecovery.js';
import type { CodeSession } from 'src/utils/teleport/api.js';
import { errorMessage, TeleportOperationError } from '../utils/errors.js';
import { teleportResumeCodeSession } from '../utils/teleport.js';
export type TeleportResumeError = {
  message: string;
  formattedMessage?: string;
  isOperationError: boolean;
};
export type TeleportSource = 'cliArg' | 'localCommand';
export function useTeleportResume(source) {
// React Compiler 产物：source 参数（cliArg | localCommand）未被类型化；返回 {resumeSession, isResuming, error, selectedSession, clearError} 五元组。
  const $ = _c(8);
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  let t0;
  if ($[0] !== source) {
    t0 = async session => {
      setIsResuming(true);
      setError(null);
      setSelectedSession(session);
      logEvent("tengu_teleport_resume_session", {
        source: source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        session_id: session.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      ;
      try {
        const result = await teleportResumeCodeSession(session.id);
        setTeleportedSessionInfo({
          sessionId: session.id
        });
        setIsResuming(false);
        return result;
      } catch (t1) {
        const err = t1;
        const teleportError = {
          message: err instanceof TeleportOperationError ? err.message : errorMessage(err),
          formattedMessage: err instanceof TeleportOperationError ? err.formattedMessage : undefined,
          isOperationError: err instanceof TeleportOperationError
        };
        setError(teleportError);
        setIsResuming(false);
        return null;
      }
    };
// resumeSession 闭包：$[0] 缓存（随 source 变）；logEvent 记 tengu_teleport_resume_session → teleportResumeCodeSession → setTeleportedSessionInfo + 重置 isResuming；catch 把 TeleportOperationError 归一化（isOperationError 区分操作错误与普通错误）。
    $[0] = source;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  const resumeSession = t0;
  let t1;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => {
      setError(null);
    };
    $[2] = t1;
  } else {
// $[2] 缓存 clearError（sentinel 首次初始化），恒返回 setError(null)，用于清除 resume 失败信息。
    t1 = $[2];
  }
  const clearError = t1;
  let t2;
  if ($[3] !== error || $[4] !== isResuming || $[5] !== resumeSession || $[6] !== selectedSession) {
    t2 = {
      resumeSession,
      isResuming,
      error,
      selectedSession,
      clearError
    };
    $[3] = error;
    $[4] = isResuming;
    $[5] = resumeSession;
    $[6] = selectedSession;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  return t2;
// 返回值 memo：依赖 error / isResuming / resumeSession / selectedSession（$[3..6]），任一变则重建对象返回。
}
// 原文件此处有一行 7164 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。