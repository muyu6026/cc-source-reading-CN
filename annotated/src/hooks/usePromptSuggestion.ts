import { useCallback, useRef } from 'react'
import { useTerminalFocus } from '../ink/hooks/use-terminal-focus.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { abortSpeculation } from '../services/PromptSuggestion/speculation.js'
import { useAppState, useSetAppState } from '../state/AppState.js'

type Props = {
  inputValue: string
  isAssistantResponding: boolean
}

export function usePromptSuggestion({
  inputValue,
  isAssistantResponding,
}: Props): {
  suggestion: string | null
  markAccepted: () => void
  markShown: () => void
  logOutcomeAtSubmission: (
    finalInput: string,
    opts?: { skipReset: boolean },
  ) => void
} {
  const promptSuggestion = useAppState(s => s.promptSuggestion)
  const setAppState = useSetAppState()
  const isTerminalFocused = useTerminalFocus()
  const {
    text: suggestionText,
    promptId,
    shownAt,
    acceptedAt,
    generationRequestId,
  } = promptSuggestion

  const suggestion =
    isAssistantResponding || inputValue.length > 0 ? null : suggestionText
// 建议文本仅在「助手未在响应」且「输入框为空」时显示，
// 否则（正在打字或正在回答）一律置 null，避免打断用户输入。

  const isValidSuggestion = suggestionText && shownAt > 0

  // Track engagement depth for telemetry
  const firstKeystrokeAt = useRef<number>(0)
  const wasFocusedWhenShown = useRef<boolean>(true)
  const prevShownAt = useRef<number>(0)

  // Capture focus state when a new suggestion appears (shownAt changes)
  if (shownAt > 0 && shownAt !== prevShownAt.current) {
    prevShownAt.current = shownAt
    wasFocusedWhenShown.current = isTerminalFocused
    firstKeystrokeAt.current = 0
  } else if (shownAt === 0) {
    prevShownAt.current = 0
  }
// 新建议出现时（shownAt 变化）捕获当时的终端聚焦状态，
// 用于遥测「建议展示时用户是否正盯着终端」。

  // Record first keystroke while suggestion is visible
  if (
    inputValue.length > 0 &&
    firstKeystrokeAt.current === 0 &&
    isValidSuggestion
  ) {
    firstKeystrokeAt.current = Date.now()
  }
// 记录建议可见期间的首次按键时间戳，
// 用于衡量用户看到建议后多久才动手（参与/忽略信号）。

  const resetSuggestion = useCallback(() => {
    abortSpeculation(setAppState)

    setAppState(prev => ({
      ...prev,
      promptSuggestion: {
        text: null,
        promptId: null,
        shownAt: 0,
        acceptedAt: 0,
        generationRequestId: null,
      },
    }))
  }, [setAppState])
// 重置建议：先 abort 后台推测生成，再把 promptSuggestion 清零，
// 依赖数组只放 setAppState，abortSpeculation 是稳定导入。

  const markAccepted = useCallback(() => {
    if (!isValidSuggestion) return
    setAppState(prev => ({
      ...prev,
      promptSuggestion: {
        ...prev.promptSuggestion,
        acceptedAt: Date.now(),
      },
    }))
  }, [isValidSuggestion, setAppState])

  const markShown = useCallback(() => {
    // Check shownAt inside setAppState callback to avoid depending on it
    // (depending on shownAt causes infinite loop when this callback is called)
    setAppState(prev => {
      // Only mark shown if not already shown and suggestion exists
      if (prev.promptSuggestion.shownAt !== 0 || !prev.promptSuggestion.text) {
        return prev
      }
      return {
        ...prev,
        promptSuggestion: {
          ...prev.promptSuggestion,
          shownAt: Date.now(),
        },
      }
    })
  }, [setAppState])
// 标记「已显示」刻意放在 setAppState 回调内部判断 shownAt，
// 不把 shownAt 列入依赖——否则回调每次被调用都会因闭包变化触发无限循环。

  const logOutcomeAtSubmission = useCallback(
    (finalInput: string, opts?: { skipReset: boolean }) => {
      if (!isValidSuggestion) return

      // Determine if accepted: either Tab was pressed (acceptedAt set) OR
      // final input matches suggestion (empty Enter case)
      const tabWasPressed = acceptedAt > shownAt
      const wasAccepted = tabWasPressed || finalInput === suggestionText
      const timeMs = wasAccepted ? acceptedAt || Date.now() : Date.now()

      logEvent('tengu_prompt_suggestion', {
        source:
          'cli' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        outcome: (wasAccepted
          ? 'accepted'
          : 'ignored') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        prompt_id:
          promptId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(generationRequestId && {
          generationRequestId:
            generationRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(wasAccepted && {
          acceptMethod: (tabWasPressed
            ? 'tab'
            : 'enter') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(wasAccepted && {
          timeToAcceptMs: timeMs - shownAt,
        }),
        ...(!wasAccepted && {
          timeToIgnoreMs: timeMs - shownAt,
        }),
        ...(firstKeystrokeAt.current > 0 && {
          timeToFirstKeystrokeMs: firstKeystrokeAt.current - shownAt,
        }),
        wasFocusedWhenShown: wasFocusedWhenShown.current,
        similarity:
          Math.round(
            (finalInput.length / (suggestionText?.length || 1)) * 100,
          ) / 100,
        ...(process.env.USER_TYPE === 'ant' && {
          suggestion:
            suggestionText as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          userInput:
            finalInput as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
// 仅 ant 内部环境（USER_TYPE==='ant'）才在遥测里带上
// 完整建议文本与用户输入（PII），外部环境只上报统计字段。
      })
      if (!opts?.skipReset) resetSuggestion()
    },
    [
      isValidSuggestion,
      acceptedAt,
      shownAt,
      suggestionText,
      promptId,
      generationRequestId,
      resetSuggestion,
    ],
  )
// 提交时上报结果：判定接受（Tab 按下 或 输入恰好等于建议）
// 还是忽略，并带接受/忽略耗时、相似度等遥测；skipReset 时不清建议。

  return {
    suggestion,
    markAccepted,
    markShown,
    logOutcomeAtSubmission,
  }
}
