import { useState } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js'
import { useSetAppState } from '../../state/AppState.js'
import type { ToolUseConfirm } from './PermissionRequest.js'
import { logUnaryPermissionEvent } from './utils.js'

/**
 * Shared feedback-mode state + handlers for shell permission dialogs (Bash,
 * PowerShell). Encapsulates the yes/no input-mode toggle, feedback text state,
 * focus tracking, and reject handling.
 */
// Shell 类权限弹窗（Bash / PowerShell）共用的反馈态 hook：封装「是/否」输入模式切换、反馈文本、焦点与拒绝处理
export function useShellPermissionFeedback({
  toolUseConfirm,
  onDone,
  onReject,
  explainerVisible,
}: {
  toolUseConfirm: ToolUseConfirm
  onDone: () => void
  onReject: () => void
  explainerVisible: boolean
}): {
  yesInputMode: boolean
  noInputMode: boolean
  yesFeedbackModeEntered: boolean
  noFeedbackModeEntered: boolean
  acceptFeedback: string
  rejectFeedback: string
  setAcceptFeedback: (v: string) => void
  setRejectFeedback: (v: string) => void
  focusedOption: string
  handleInputModeToggle: (option: string) => void
  handleReject: (feedback?: string) => void
  handleFocus: (value: string) => void
} {
  const setAppState = useSetAppState()
// 从全局应用状态取出 setter，用于记录权限请求的逃逸次数（归因统计）
  const [rejectFeedback, setRejectFeedback] = useState('')
  const [acceptFeedback, setAcceptFeedback] = useState('')
  const [yesInputMode, setYesInputMode] = useState(false)
  const [noInputMode, setNoInputMode] = useState(false)
  const [focusedOption, setFocusedOption] = useState('yes')
  // Track whether user ever entered feedback mode (persists after collapse)
  const [yesFeedbackModeEntered, setYesFeedbackModeEntered] = useState(false)
  const [noFeedbackModeEntered, setNoFeedbackModeEntered] = useState(false)
// 六个状态：两种反馈文本、两种输入模式、当前聚焦项，以及「是否曾进入反馈模式」的持久标记

  // Handle Tab key toggling input mode for Yes/No options
// Tab 键切换「是/否」选项的输入模式：进入模式时上报 entered、收起时上报 collapsed，并记录「曾进入」标记
  function handleInputModeToggle(option: string) {
    // Notify that user is interacting with the dialog
    toolUseConfirm.onUserInteraction()
    const analyticsProps = {
      toolName: sanitizeToolNameForAnalytics(
        toolUseConfirm.tool.name,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      isMcp: toolUseConfirm.tool.isMcp ?? false,
    }

    if (option === 'yes') {
      if (yesInputMode) {
        setYesInputMode(false)
        logEvent('tengu_accept_feedback_mode_collapsed', analyticsProps)
      } else {
        setYesInputMode(true)
        setYesFeedbackModeEntered(true)
        logEvent('tengu_accept_feedback_mode_entered', analyticsProps)
      }
    } else if (option === 'no') {
      if (noInputMode) {
        setNoInputMode(false)
        logEvent('tengu_reject_feedback_mode_collapsed', analyticsProps)
      } else {
        setNoInputMode(true)
        setNoFeedbackModeEntered(true)
        logEvent('tengu_reject_feedback_mode_entered', analyticsProps)
      }
    }
  }

// 拒绝处理：有反馈文本则作为拒绝理由回传，无则直接拒绝；无论哪种都收尾 onReject/onDone
  function handleReject(feedback?: string) {
    const trimmedFeedback = feedback?.trim()
    const hasFeedback = !!trimmedFeedback

    // Log escape if no feedback was provided (user pressed ESC)
    if (!hasFeedback) {
      logEvent('tengu_permission_request_escape', {
// 无反馈直接退出（Esc）时上报 escape 事件，并累加归因计数器的 escapeCount
        explainer_visible: explainerVisible,
      })
      // Increment escape count for attribution tracking
      setAppState(prev => ({
// 用函数式更新累加逃逸计数，避免并发状态下读到旧值
        ...prev,
        attribution: {
          ...prev.attribution,
          escapeCount: prev.attribution.escapeCount + 1,
        },
      }))
    }

    logUnaryPermissionEvent(
      'tool_use_single',
      toolUseConfirm,
      'reject',
      hasFeedback,
    )

    if (trimmedFeedback) {
      toolUseConfirm.onReject(trimmedFeedback)
    } else {
      toolUseConfirm.onReject()
    }

    onReject()
    onDone()
  }

// 焦点切换：仅在焦点真正变化时通知交互，并在离开「是/否」选项且无文本时收起其输入模式
  function handleFocus(value: string) {
    // Notify that user is interacting with the dialog (only if focus changed)
    // This prevents triggering on the initial mount/render
    if (value !== focusedOption) {
      toolUseConfirm.onUserInteraction()
    }
    // Reset input mode when navigating away, but only if no text typed
    if (value !== 'yes' && yesInputMode && !acceptFeedback.trim()) {
// 切换到别的选项且原输入模式无文本时，自动收起该模式，保持界面干净
      setYesInputMode(false)
    }
    if (value !== 'no' && noInputMode && !rejectFeedback.trim()) {
      setNoInputMode(false)
    }
    setFocusedOption(value)
  }

  return {
    yesInputMode,
    noInputMode,
    yesFeedbackModeEntered,
    noFeedbackModeEntered,
    acceptFeedback,
    rejectFeedback,
    setAcceptFeedback,
    setRejectFeedback,
    focusedOption,
    handleInputModeToggle,
    handleReject,
    handleFocus,
  }
}
