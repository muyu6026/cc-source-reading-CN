// 本文件是「退出计划模式」的权限请求对话框组件。用户在这里选择如何退出计划模式——清上下文并接受编辑、保留上下文、切到自动模式、改用 Ultraplan，或拒绝并继续规划。第 43 行用 feature 开关做条件 require，仅在启用转录分类器时才加载 autoModeState 模块（bun:bundle 的摇树约束要求 feature 直接写在 if 或三元里）。
import { feature } from 'bun:bundle';
import type { UUID } from 'crypto';
import figures from 'figures';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { useAppState, useAppStateStore, useSetAppState } from 'src/state/AppState.js';
import { getSdkBetas, getSessionId, isSessionPersistenceDisabled, setHasExitedPlanMode, setNeedsAutoModeExitAttachment, setNeedsPlanModeExitAttachment } from '../../../bootstrap/state.js';
import { generateSessionName } from '../../../commands/rename/generateSessionName.js';
import { launchUltraplan } from '../../../commands/ultraplan.js';
import type { KeyboardEvent } from '../../../ink/events/keyboard-event.js';
import { Box, Text } from '../../../ink.js';
import type { AppState } from '../../../state/AppStateStore.js';
import { AGENT_TOOL_NAME } from '../../../tools/AgentTool/constants.js';
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../../../tools/ExitPlanModeTool/constants.js';
import type { AllowedPrompt } from '../../../tools/ExitPlanModeTool/ExitPlanModeV2Tool.js';
import { TEAM_CREATE_TOOL_NAME } from '../../../tools/TeamCreateTool/constants.js';
import { isAgentSwarmsEnabled } from '../../../utils/agentSwarmsEnabled.js';
import { calculateContextPercentages, getContextWindowForModel } from '../../../utils/context.js';
import { getExternalEditor } from '../../../utils/editor.js';
import { getDisplayPath } from '../../../utils/file.js';
import { toIDEDisplayName } from '../../../utils/ide.js';
import { logError } from '../../../utils/log.js';
import { enqueuePendingNotification } from '../../../utils/messageQueueManager.js';
import { createUserMessage } from '../../../utils/messages.js';
import { getMainLoopModel, getRuntimeMainLoopModel } from '../../../utils/model/model.js';
import { createPromptRuleContent, isClassifierPermissionsEnabled, PROMPT_PREFIX } from '../../../utils/permissions/bashClassifier.js';
import { type PermissionMode, toExternalPermissionMode } from '../../../utils/permissions/PermissionMode.js';
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js';
import { isAutoModeGateEnabled, restoreDangerousPermissions, stripDangerousPermissionsForAutoMode } from '../../../utils/permissions/permissionSetup.js';
import { getPewterLedgerVariant, isPlanModeInterviewPhaseEnabled } from '../../../utils/planModeV2.js';
import { getPlan, getPlanFilePath } from '../../../utils/plans.js';
import { editFileInEditor, editPromptInEditor } from '../../../utils/promptEditor.js';
import { getCurrentSessionTitle, getTranscriptPath, saveAgentName, saveCustomTitle } from '../../../utils/sessionStorage.js';
import { getSettings_DEPRECATED } from '../../../utils/settings/settings.js';
import { type OptionWithDescription, Select } from '../../CustomSelect/index.js';
import { Markdown } from '../../Markdown.js';
import { PermissionDialog } from '../PermissionDialog.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';

/* eslint-disable @typescript-eslint/no-require-imports */
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER') ? require('../../../utils/permissions/autoModeState.js') as typeof import('../../../utils/permissions/autoModeState.js') : null;
import type { Base64ImageSource, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
/* eslint-enable @typescript-eslint/no-require-imports */
import type { PastedContent } from '../../../utils/config.js';
import type { ImageDimensions } from '../../../utils/imageResizer.js';
import { maybeResizeAndDownsampleImageBlock } from '../../../utils/imageResizer.js';
import { cacheImagePath, storeImage } from '../../../utils/imageStore.js';
type ResponseValue = 'yes-bypass-permissions' | 'yes-accept-edits' | 'yes-accept-edits-keep-context' | 'yes-default-keep-context' | 'yes-resume-auto-mode' | 'yes-auto-clear-context' | 'ultraplan' | 'no';
// ResponseValue 是退出计划时可选项的值集合：绕过权限、接受编辑、接受编辑并保留上下文、默认保留上下文、恢复自动模式、自动清上下文、改用 Ultraplan、以及否。

/**
 * Build permission updates for plan approval, including prompt-based rules if provided.
 * Prompt-based rules are only added when classifier permissions are enabled (Ant-only).
 */
// buildPermissionUpdates 根据所选权限模式构造权限更新数组：先写一条 setMode，若分类器权限开启且提供了允许提示则追加 addRules 规则（仅 Ant 可用）。
export function buildPermissionUpdates(mode: PermissionMode, allowedPrompts?: AllowedPrompt[]): PermissionUpdate[] {
  const updates: PermissionUpdate[] = [{
    type: 'setMode',
    mode: toExternalPermissionMode(mode),
    destination: 'session'
  }];

  // Add prompt-based permission rules if provided (Ant-only feature)
  if (isClassifierPermissionsEnabled() && allowedPrompts && allowedPrompts.length > 0) {
    updates.push({
      type: 'addRules',
      rules: allowedPrompts.map(p => ({
        toolName: p.tool,
        ruleContent: createPromptRuleContent(p.prompt)
      })),
      behavior: 'allow',
      destination: 'session'
    });
  }
  return updates;
}
// buildPermissionUpdates 收尾，返回由 setMode 与可选 addRules 组成的更新列表。

/**
 * Auto-name the session from the plan content when the user accepts a plan,
 * if they haven't already named it via /rename or --name. Fire-and-forget.
 * Mirrors /rename: kebab-case name, updates the prompt-border badge.
 */
// autoNameSessionFromPlan 在用户接受计划时按计划内容自动给会话命名，属于 fire-and-forget；命名前先检查会话持久化是否被禁用、以及用户是否已手动命名，避免覆盖。
export function autoNameSessionFromPlan(plan: string, setAppState: (updater: (prev: AppState) => AppState) => void, isClearContext: boolean): void {
  if (isSessionPersistenceDisabled() || getSettings_DEPRECATED()?.cleanupPeriodDays === 0) {
    return;
  }
  // On clear-context, the current session is about to be abandoned — its
  // title (which may have been set by a PRIOR auto-name) is irrelevant.
  // Checking it would make the feature self-defeating after first use.
  if (!isClearContext && getCurrentSessionTitle(getSessionId())) return;
  void generateSessionName(
  // generateSessionName tail-slices to the last 1000 chars (correct for
  // conversations, where recency matters). Plans front-load the goal and
  // end with testing steps — head-slice so Haiku sees the summary.
  [createUserMessage({
    content: plan.slice(0, 1000)
  })], new AbortController().signal).then(async name => {
    // On clear-context acceptance, regenerateSessionId() has run by now —
    // this intentionally names the NEW execution session. Do not "fix" by
    // capturing sessionId once; that would name the abandoned planning session.
    if (!name || getCurrentSessionTitle(getSessionId())) return;
    const sessionId = getSessionId() as UUID;
    const fullPath = getTranscriptPath();
    await saveCustomTitle(sessionId, name, fullPath, 'auto');
    await saveAgentName(sessionId, name, fullPath, 'auto');
    setAppState(prev => {
      if (prev.standaloneAgentContext?.name === name) return prev;
      return {
        ...prev,
        standaloneAgentContext: {
          ...prev.standaloneAgentContext,
          name
        }
      };
    });
  }).catch(logError);
}
// autoNameSessionFromPlan 收尾：生成名字后写入自定义标题与智能体名，并在 AppState 里更新 standaloneAgentContext，失败仅记日志不阻塞。
// ExitPlanModePermissionRequest 主组件入口。它从全局状态取出工具权限上下文、通知与编辑器信息，并初始化计划文本、反馈输入、粘贴图片等状态。
export function ExitPlanModePermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  workerBadge,
  setStickyFooter
}: PermissionRequestProps): React.ReactNode {
  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
  const setAppState = useSetAppState();
  const store = useAppStateStore();
  const {
    addNotification
  } = useNotifications();
  // Feedback text from the 'No' option's input. Threaded through onAllow as
  // acceptFeedback when the user approves — lets users annotate the plan
  // ("also update the README") without a reject+re-plan round-trip.
  const [planFeedback, setPlanFeedback] = useState('');
// planFeedback 收集「否」选项输入框里的反馈文本，会随批准回调以 acceptFeedback 透传，让用户无需先拒绝再重规划就能给计划加注「顺手更新 README」之类的要求。
  const [pastedContents, setPastedContents] = useState<Record<number, PastedContent>>({});
  const nextPasteIdRef = useRef(0);
  const showClearContext = useAppState(s => s.settings.showClearContextOnPlanAccept) ?? false;
  const ultraplanSessionUrl = useAppState(s => s.ultraplanSessionUrl);
  const ultraplanLaunching = useAppState(s => s.ultraplanLaunching);
  // Hide the Ultraplan button while a session is active or launching —
  // selecting it would dismiss the dialog and reject locally before
  // launchUltraplan can notice the session exists and return "already polling".
  // feature() must sit directly in an if/ternary (bun:bundle DCE constraint).
  const showUltraplan = feature('ULTRAPLAN') ? !ultraplanSessionUrl && !ultraplanLaunching : false;
  const usage = toolUseConfirm.assistantMessage.message.usage;
  const {
    mode,
    isAutoModeAvailable,
    isBypassPermissionsModeAvailable
  } = toolPermissionContext;
  const options = useMemo(() => buildPlanApprovalOptions({
    showClearContext,
    showUltraplan,
    usedPercent: showClearContext ? getContextUsedPercent(usage, mode) : null,
    isAutoModeAvailable,
    isBypassPermissionsModeAvailable,
    onFeedbackChange: setPlanFeedback
  }), [showClearContext, showUltraplan, usage, mode, isAutoModeAvailable, isBypassPermissionsModeAvailable]);
// options 用 useMemo 记忆化，调 buildPlanApprovalOptions 按是否清上下文、是否显示 Ultraplan、模式可用性等组装批准选项。
  function onImagePaste(base64Image: string, mediaType?: string, filename?: string, dimensions?: ImageDimensions, _sourcePath?: string) {
    const pasteId = nextPasteIdRef.current++;
    const newContent: PastedContent = {
      id: pasteId,
      type: 'image',
      content: base64Image,
      mediaType: mediaType || 'image/png',
      filename: filename || 'Pasted image',
      dimensions
    };
    cacheImagePath(newContent);
    void storeImage(newContent);
    setPastedContents(prev => ({
      ...prev,
      [pasteId]: newContent
    }));
  }
// onImagePaste 处理图片粘贴：分配自增粘贴 id，写缓存与图片存储，再并入 pastedContents，供拒绝时把截图作为附件回传。
  const onRemoveImage = useCallback((id: number) => {
    setPastedContents(prev => {
      const next = {
        ...prev
      };
      delete next[id];
      return next;
    });
  }, []);
// onRemoveImage 是删除某张已粘贴图片的回调，从 pastedContents 里删掉对应 id。
  const imageAttachments = Object.values(pastedContents).filter(c => c.type === 'image');
  const hasImages = imageAttachments.length > 0;

  // TODO: Delete the branch after moving to V2
  // Use tool name to detect V2 instead of checking input.plan, because PR #10394
  // injects plan content into input.plan for hooks/SDK, which broke the old detection
  // (see issue #10878)
  const isV2 = toolUseConfirm.tool.name === EXIT_PLAN_MODE_V2_TOOL_NAME;
  const inputPlan = isV2 ? undefined : toolUseConfirm.input.plan as string | undefined;
  const planFilePath = isV2 ? getPlanFilePath() : undefined;

  // Extract allowed prompts requested by the plan (Ant-only feature)
  const allowedPrompts = toolUseConfirm.input.allowedPrompts as AllowedPrompt[] | undefined;

  // Get the raw plan to check if it's empty
  const rawPlan = inputPlan ?? getPlan();
  const isEmpty = !rawPlan || rawPlan.trim() === '';
// rawPlan 取计划原文（V2 走磁盘文件，V1 走 input.plan），isEmpty 标记计划是否为空，空计划走简化界面。

  // Capture the variant once on mount. GrowthBook reads from a disk cache
  // so the value is stable across a single planning session. undefined =
  // control arm. The variant is a fixed 3-value enum of short literals,
  // not user input.
  const [planStructureVariant] = useState(() => (getPewterLedgerVariant() ?? undefined) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS);
  const [currentPlan, setCurrentPlan] = useState(() => {
    if (inputPlan) return inputPlan;
    const plan = getPlan();
    return plan ?? 'No plan found. Please write your plan to the plan file first.';
  });
  const [showSaveMessage, setShowSaveMessage] = useState(false);
  // Track Ctrl+G local edits so updatedInput can include the plan (the tool
  // only echoes the plan in tool_result when input.plan is set — otherwise
  // the model already has it in context from writing the plan file).
  const [planEditedLocally, setPlanEditedLocally] = useState(false);
// planEditedLocally 标记用户是否用 Ctrl+G 在外部编辑器改过计划；只有本地改过时才把计划回写进工具输入，否则模型已在上下文里拥有最新计划。

  // Auto-hide save message after 5 seconds
  useEffect(() => {
    if (showSaveMessage) {
      const timer = setTimeout(setShowSaveMessage, 5000, false);
      return () => clearTimeout(timer);
    }
  }, [showSaveMessage]);
// 该 useEffect 在 showSaveMessage 为真时启动五秒定时器自动隐藏「计划已保存」提示。

  // Handle Ctrl+G to edit plan in $EDITOR, Shift+Tab for auto-accept edits
  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrl && e.key === 'g') {
      e.preventDefault();
      logEvent('tengu_plan_external_editor_used', {});
      void (async () => {
        if (isV2 && planFilePath) {
          const result = await editFileInEditor(planFilePath);
          if (result.error) {
            addNotification({
              key: 'external-editor-error',
              text: result.error,
              color: 'warning',
              priority: 'high'
            });
          }
          if (result.content !== null) {
            if (result.content !== currentPlan) setPlanEditedLocally(true);
            setCurrentPlan(result.content);
            setShowSaveMessage(true);
          }
        } else {
          const result = await editPromptInEditor(currentPlan);
          if (result.error) {
            addNotification({
              key: 'external-editor-error',
              text: result.error,
              color: 'warning',
              priority: 'high'
            });
          }
          if (result.content !== null && result.content !== currentPlan) {
            setCurrentPlan(result.content);
            setShowSaveMessage(true);
          }
        }
      })();
      return;
    }

    // Shift+Tab immediately selects "auto-accept edits"
    if (e.shift && e.key === 'tab') {
      e.preventDefault();
      void handleResponse(showClearContext ? 'yes-accept-edits' : 'yes-accept-edits-keep-context');
      return;
    }
  };
// handleKeyDown 绑定 Ctrl+G 在外部编辑器改计划、Shift+Tab 直接选「自动接受编辑」；改动后更新当前计划并触发保存提示，异常时弹通知。
  async function handleResponse(value: ResponseValue): Promise<void> {
    const trimmedFeedback = planFeedback.trim();
    const acceptFeedback = trimmedFeedback || undefined;

    // Ultraplan: reject locally, teleport the plan to CCR as a seed draft.
    // Dialog dismisses immediately so the query loop unblocks; the teleport
    // runs detached and its launch message lands via the command queue.
    if (value === 'ultraplan') {
      logEvent('tengu_plan_exit', {
        planLengthChars: currentPlan.length,
        outcome: 'ultraplan' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        planStructureVariant
      });
      onDone();
      onReject();
      toolUseConfirm.onReject('Plan being refined via Ultraplan — please wait for the result.');
      void launchUltraplan({
        blurb: '',
        seedPlan: currentPlan,
        getAppState: store.getState,
        setAppState: store.setState,
        signal: new AbortController().signal
      }).then(msg => enqueuePendingNotification({
        value: msg,
        mode: 'task-notification'
      })).catch(logError);
      return;
    }

    // V1: pass plan in input. V2: plan is on disk, but if the user edited it
    // via Ctrl+G we pass it through so the tool echoes the edit in tool_result
    // (otherwise the model never sees the user's changes).
    const updatedInput = isV2 && !planEditedLocally ? {} : {
      plan: currentPlan
    };

    // If auto was active during plan (from auto mode or opt-in) and NOT going
    // to auto, deactivate auto + restore permissions + fire exit attachment.
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      const goingToAuto = (value === 'yes-resume-auto-mode' || value === 'yes-auto-clear-context') && isAutoModeGateEnabled();
      // isAutoModeActive() is the authoritative signal — prePlanMode/
      // strippedDangerousRules are stale after transitionPlanAutoMode
      // deactivates mid-plan (would cause duplicate exit attachment).
      const autoWasUsedDuringPlan = autoModeStateModule?.isAutoModeActive() ?? false;
      if (value !== 'no' && !goingToAuto && autoWasUsedDuringPlan) {
        autoModeStateModule?.setAutoModeActive(false);
        setNeedsAutoModeExitAttachment(true);
        setAppState(prev => ({
          ...prev,
          toolPermissionContext: {
            ...restoreDangerousPermissions(prev.toolPermissionContext),
            prePlanMode: undefined
          }
        }));
      }
    }

    // Clear-context options: set pending plan implementation and reject the dialog
    // The REPL will handle context clear and trigger a fresh query
    // Keep-context options skip this block and go through the normal flow below
    const isResumeAutoOption = feature('TRANSCRIPT_CLASSIFIER') ? value === 'yes-resume-auto-mode' : false;
    const isKeepContextOption = value === 'yes-accept-edits-keep-context' || value === 'yes-default-keep-context' || isResumeAutoOption;
    if (value !== 'no') {
      autoNameSessionFromPlan(currentPlan, setAppState, !isKeepContextOption);
    }
    if (value !== 'no' && !isKeepContextOption) {
      // Determine the permission mode based on the selected option
      let mode: PermissionMode = 'default';
      if (value === 'yes-bypass-permissions') {
        mode = 'bypassPermissions';
      } else if (value === 'yes-accept-edits') {
        mode = 'acceptEdits';
      } else if (feature('TRANSCRIPT_CLASSIFIER') && value === 'yes-auto-clear-context' && isAutoModeGateEnabled()) {
        // REPL's processInitialMessage handles stripDangerousPermissions + mode,
        // but does NOT set autoModeActive. Gate-off falls through to 'default'.
        mode = 'auto';
        autoModeStateModule?.setAutoModeActive(true);
      }

      // Log plan exit event
      logEvent('tengu_plan_exit', {
        planLengthChars: currentPlan.length,
        outcome: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        clearContext: true,
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        planStructureVariant,
        hasFeedback: !!acceptFeedback
      });

      // Set initial message - REPL will handle context clear and fresh query
      // Add verification instruction if the feature is enabled
      // Dead code elimination: CLAUDE_CODE_VERIFY_PLAN='false' in external builds, so === 'true' check allows Bun to eliminate the string
      const verificationInstruction = undefined === 'true' ? `\n\nIMPORTANT: When you have finished implementing the plan, you MUST call the "VerifyPlanExecution" tool directly (NOT the ${AGENT_TOOL_NAME} tool or an agent) to trigger background verification.` : '';

      // Capture the transcript path before context is cleared (session ID will be regenerated)
      const transcriptPath = getTranscriptPath();
      const transcriptHint = `\n\nIf you need specific details from before exiting plan mode (like exact code snippets, error messages, or content you generated), read the full transcript at: ${transcriptPath}`;
      const teamHint = isAgentSwarmsEnabled() ? `\n\nIf this plan can be broken down into multiple independent tasks, consider using the ${TEAM_CREATE_TOOL_NAME} tool to create a team and parallelize the work.` : '';
      const feedbackSuffix = acceptFeedback ? `\n\nUser feedback on this plan: ${acceptFeedback}` : '';
      setAppState(prev => ({
        ...prev,
        initialMessage: {
          message: {
            ...createUserMessage({
              content: `Implement the following plan:\n\n${currentPlan}${verificationInstruction}${transcriptHint}${teamHint}${feedbackSuffix}`
            }),
            planContent: currentPlan
          },
          clearContext: true,
          mode,
          allowedPrompts
        }
      }));
      setHasExitedPlanMode(true);
      onDone();
      onReject();
      // Reject the tool use to unblock the query loop
      // The REPL will see pendingInitialQuery and trigger fresh query
      toolUseConfirm.onReject();
      return;
    }

    // Handle auto keep-context option — needs special handling because
    // buildPermissionUpdates maps auto to 'default' via toExternalPermissionMode.
    // We set the mode directly via setAppState and sync the bootstrap state.
    if (feature('TRANSCRIPT_CLASSIFIER') && value === 'yes-resume-auto-mode' && isAutoModeGateEnabled()) {
      logEvent('tengu_plan_exit', {
        planLengthChars: currentPlan.length,
        outcome: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        clearContext: false,
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        planStructureVariant,
        hasFeedback: !!acceptFeedback
      });
      setHasExitedPlanMode(true);
      setNeedsPlanModeExitAttachment(true);
      autoModeStateModule?.setAutoModeActive(true);
      setAppState(prev => ({
        ...prev,
        toolPermissionContext: stripDangerousPermissionsForAutoMode({
          ...prev.toolPermissionContext,
          mode: 'auto',
          prePlanMode: undefined
        })
      }));
      onDone();
      toolUseConfirm.onAllow(updatedInput, [], acceptFeedback);
      return;
    }

    // Handle keep-context options (goes through normal onAllow flow)
    // yes-resume-auto-mode falls through here when the auto mode gate is
    // disabled (e.g. circuit breaker fired after the dialog rendered).
    // Without this fallback the function would return without resolving the
    // dialog, leaving the query loop blocked and safety state corrupted.
    const keepContextModes: Record<string, PermissionMode> = {
      'yes-accept-edits-keep-context': toolPermissionContext.isBypassPermissionsModeAvailable ? 'bypassPermissions' : 'acceptEdits',
      'yes-default-keep-context': 'default',
      ...(feature('TRANSCRIPT_CLASSIFIER') ? {
        'yes-resume-auto-mode': 'default' as const
      } : {})
    };
    const keepContextMode = keepContextModes[value];
    if (keepContextMode) {
      logEvent('tengu_plan_exit', {
        planLengthChars: currentPlan.length,
        outcome: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        clearContext: false,
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        planStructureVariant,
        hasFeedback: !!acceptFeedback
      });
      setHasExitedPlanMode(true);
      setNeedsPlanModeExitAttachment(true);
      onDone();
      toolUseConfirm.onAllow(updatedInput, buildPermissionUpdates(keepContextMode, allowedPrompts), acceptFeedback);
      return;
    }

    // Handle standard approval options
    const standardModes: Record<string, PermissionMode> = {
      'yes-bypass-permissions': 'bypassPermissions',
      'yes-accept-edits': 'acceptEdits'
    };
    const standardMode = standardModes[value];
    if (standardMode) {
      logEvent('tengu_plan_exit', {
        planLengthChars: currentPlan.length,
        outcome: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        planStructureVariant,
        hasFeedback: !!acceptFeedback
      });
      setHasExitedPlanMode(true);
      setNeedsPlanModeExitAttachment(true);
      onDone();
      toolUseConfirm.onAllow(updatedInput, buildPermissionUpdates(standardMode, allowedPrompts), acceptFeedback);
      return;
    }

    // Handle 'no' - stay in plan mode
    if (value === 'no') {
      if (!trimmedFeedback && !hasImages) {
        // No feedback yet - user is still on the input field
        return;
      }
      logEvent('tengu_plan_exit', {
        planLengthChars: currentPlan.length,
        outcome: 'no' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        planStructureVariant
      });

      // Convert pasted images to ImageBlockParam[] with resizing
      let imageBlocks: ImageBlockParam[] | undefined;
      if (hasImages) {
        imageBlocks = await Promise.all(imageAttachments.map(async img => {
          const block: ImageBlockParam = {
            type: 'image',
            source: {
              type: 'base64',
              media_type: (img.mediaType || 'image/png') as Base64ImageSource['media_type'],
              data: img.content
            }
          };
          const resized = await maybeResizeAndDownsampleImageBlock(block);
          return resized.block;
        }));
      }
      onDone();
      onReject();
      toolUseConfirm.onReject(trimmedFeedback || (hasImages ? '(See attached image)' : undefined), imageBlocks && imageBlocks.length > 0 ? imageBlocks : undefined);
    }
  }
// handleResponse 是核心分派：按所选退出值分别处理 Ultraplan 转交、清上下文（含自动模式去激活与权限恢复）、恢复自动模式、保留上下文、标准批准与拒绝，最后调用 onAllow 或 onReject 解挂查询循环。
  const editor = getExternalEditor();
  const editorName = editor ? toIDEDisplayName(editor) : null;

  // Sticky footer: when setStickyFooter is provided (fullscreen mode), the
  // Select options render in FullscreenLayout's `bottom` slot so they stay
  // visible while the user scrolls through a long plan. handleResponse is
  // wrapped in a ref so the JSX (set once per options/images change) can call
  // the latest closure without re-registering on every keystroke. React
  // reconciles the sticky-footer Select by type, preserving focus/input state.
  const handleResponseRef = useRef(handleResponse);
  handleResponseRef.current = handleResponse;
// handleResponseRef 把 handleResponse 包进 ref，使 JSX（仅随选项或图片变化注册一次）能调用最新闭包而不在每次按键时重注册。
  const handleCancelRef = useRef<() => void>(undefined);
  handleCancelRef.current = () => {
    logEvent('tengu_plan_exit', {
      planLengthChars: currentPlan.length,
      outcome: 'no' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
      planStructureVariant
    });
    onDone();
    onReject();
    toolUseConfirm.onReject();
  };
  const useStickyFooter = !isEmpty && !!setStickyFooter;
  useLayoutEffect(() => {
    if (!useStickyFooter) return;
    setStickyFooter(<Box flexDirection="column" borderStyle="round" borderColor="planMode" borderLeft={false} borderRight={false} borderBottom={false} paddingX={1}>
        <Text dimColor>Would you like to proceed?</Text>
        <Box marginTop={1}>
          <Select options={options} onChange={v => void handleResponseRef.current(v)} onCancel={() => handleCancelRef.current?.()} onImagePaste={onImagePaste} pastedContents={pastedContents} onRemoveImage={onRemoveImage} />
        </Box>
        {editorName && <Box flexDirection="row" gap={1} marginTop={1}>
            <Text dimColor>ctrl-g to edit in </Text>
            <Text bold dimColor>
              {editorName}
            </Text>
            {isV2 && planFilePath && <Text dimColor> · {getDisplayPath(planFilePath)}</Text>}
            {showSaveMessage && <>
                <Text dimColor>{' · '}</Text>
                <Text color="success">{figures.tick}Plan saved!</Text>
              </>}
          </Box>}
      </Box>);
    return () => setStickyFooter(null);
    // onImagePaste/onRemoveImage are stable (useCallback/useRef-backed above)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useStickyFooter, setStickyFooter, options, pastedContents, editorName, isV2, planFilePath, showSaveMessage]);
// useLayoutEffect 在 fullscreen 模式（提供 setStickyFooter）下把批准选项渲染进底部固定区，长计划滚动时仍可见，卸载时清空。

  // Simplified UI for empty plans
  if (isEmpty) {
    function handleEmptyPlanResponse(value: 'yes' | 'no'): void {
      if (value === 'yes') {
        logEvent('tengu_plan_exit', {
          planLengthChars: 0,
          outcome: 'yes-default' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
          planStructureVariant
        });
        if (feature('TRANSCRIPT_CLASSIFIER')) {
          const autoWasUsedDuringPlan = autoModeStateModule?.isAutoModeActive() ?? false;
          if (autoWasUsedDuringPlan) {
            autoModeStateModule?.setAutoModeActive(false);
            setNeedsAutoModeExitAttachment(true);
            setAppState(prev => ({
              ...prev,
              toolPermissionContext: {
                ...restoreDangerousPermissions(prev.toolPermissionContext),
                prePlanMode: undefined
              }
            }));
          }
        }
        setHasExitedPlanMode(true);
        setNeedsPlanModeExitAttachment(true);
        onDone();
        toolUseConfirm.onAllow({}, [{
          type: 'setMode',
          mode: 'default',
          destination: 'session'
        }]);
      } else {
        logEvent('tengu_plan_exit', {
          planLengthChars: 0,
          outcome: 'no' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
          planStructureVariant
        });
        onDone();
        onReject();
        toolUseConfirm.onReject();
      }
    }
// handleEmptyPlanResponse 处理空计划的「是 / 否」：是则退出计划并设默认模式，否则仅解挂查询循环，二者都记 plan_exit 事件。
    return <PermissionDialog color="planMode" title="Exit plan mode?" workerBadge={workerBadge}>
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text>Claude wants to exit plan mode</Text>
          <Box marginTop={1}>
            <Select options={[{
            label: 'Yes',
            value: 'yes' as const
          }, {
            label: 'No',
            value: 'no' as const
          }]} onChange={handleEmptyPlanResponse} onCancel={() => {
            logEvent('tengu_plan_exit', {
              planLengthChars: 0,
              outcome: 'no' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
              planStructureVariant
            });
            onDone();
            onReject();
            toolUseConfirm.onReject();
          }} />
          </Box>
        </Box>
      </PermissionDialog>;
  }
  return <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <PermissionDialog color="planMode" title="Ready to code?" innerPaddingX={0} workerBadge={workerBadge}>
        <Box flexDirection="column" marginTop={1}>
          <Box paddingX={1} flexDirection="column">
            <Text>Here is Claude&apos;s plan:</Text>
          </Box>
          <Box borderColor="subtle" borderStyle="dashed" flexDirection="column" borderLeft={false} borderRight={false} paddingX={1} marginBottom={1}
        // Necessary for Windows Terminal to render properly
        overflow="hidden">
            <Markdown>{currentPlan}</Markdown>
          </Box>
          <Box flexDirection="column" paddingX={1}>
            <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />
            {isClassifierPermissionsEnabled() && allowedPrompts && allowedPrompts.length > 0 && <Box flexDirection="column" marginBottom={1}>
                  <Text bold>Requested permissions:</Text>
                  {allowedPrompts.map((p, i) => <Text key={i} dimColor>
                      {'  '}· {p.tool}({PROMPT_PREFIX} {p.prompt})
                    </Text>)}
                </Box>}
            {!useStickyFooter && <>
                <Text dimColor>
                  Claude has written up a plan and is ready to execute. Would
                  you like to proceed?
                </Text>
                <Box marginTop={1}>
                  <Select options={options} onChange={handleResponse} onCancel={() => handleCancelRef.current?.()} onImagePaste={onImagePaste} pastedContents={pastedContents} onRemoveImage={onRemoveImage} />
                </Box>
              </>}
          </Box>
        </Box>
      </PermissionDialog>
      {!useStickyFooter && editorName && <Box flexDirection="row" gap={1} paddingX={1} marginTop={1}>
          <Box>
            <Text dimColor>ctrl-g to edit in </Text>
            <Text bold dimColor>
              {editorName}
            </Text>
            {isV2 && planFilePath && <Text dimColor> · {getDisplayPath(planFilePath)}</Text>}
          </Box>
          {showSaveMessage && <Box>
              <Text dimColor>{' · '}</Text>
              <Text color="success">{figures.tick}Plan saved!</Text>
            </Box>}
        </Box>}
    </Box>;
}
// ExitPlanModePermissionRequest 主组件收尾：非空计划渲染计划预览、权限说明、可选请求权限列表与批准 Select（JSX 在 626 行至 670 行）。

/** @internal Exported for testing. */
// buildPlanApprovalOptions 按优先级（自动模式 > 绕过权限 > 接受编辑）组装批准选项列表，并视情况追加 Ultraplan 与带反馈输入的「否」选项（上方文档块在 673 行，锚签名行以免插入块内）。
export function buildPlanApprovalOptions({
  showClearContext,
  showUltraplan,
  usedPercent,
  isAutoModeAvailable,
  isBypassPermissionsModeAvailable,
  onFeedbackChange
}: {
  showClearContext: boolean;
  showUltraplan: boolean;
  usedPercent: number | null;
  isAutoModeAvailable: boolean | undefined;
  isBypassPermissionsModeAvailable: boolean | undefined;
  onFeedbackChange: (v: string) => void;
}): OptionWithDescription<ResponseValue>[] {
  const options: OptionWithDescription<ResponseValue>[] = [];
  const usedLabel = usedPercent !== null ? ` (${usedPercent}% used)` : '';
  if (showClearContext) {
    if (feature('TRANSCRIPT_CLASSIFIER') && isAutoModeAvailable) {
      options.push({
        label: `Yes, clear context${usedLabel} and use auto mode`,
        value: 'yes-auto-clear-context'
      });
    } else if (isBypassPermissionsModeAvailable) {
      options.push({
        label: `Yes, clear context${usedLabel} and bypass permissions`,
        value: 'yes-bypass-permissions'
      });
    } else {
      options.push({
        label: `Yes, clear context${usedLabel} and auto-accept edits`,
        value: 'yes-accept-edits'
      });
    }
  }

  // Slot 2: keep-context with elevated mode (same priority: auto > bypass > edits).
  if (feature('TRANSCRIPT_CLASSIFIER') && isAutoModeAvailable) {
    options.push({
      label: 'Yes, and use auto mode',
      value: 'yes-resume-auto-mode'
    });
  } else if (isBypassPermissionsModeAvailable) {
    options.push({
      label: 'Yes, and bypass permissions',
      value: 'yes-accept-edits-keep-context'
    });
  } else {
    options.push({
      label: 'Yes, auto-accept edits',
      value: 'yes-accept-edits-keep-context'
    });
  }
  options.push({
    label: 'Yes, manually approve edits',
    value: 'yes-default-keep-context'
  });
  if (showUltraplan) {
    options.push({
      label: 'No, refine with Ultraplan on Claude Code on the web',
      value: 'ultraplan'
    });
  }
  options.push({
    type: 'input',
    label: 'No, keep planning',
    value: 'no',
    placeholder: 'Tell Claude what to change',
    description: 'shift+tab to approve with this feedback',
    onChange: onFeedbackChange
  });
  return options;
// buildPlanApprovalOptions 收尾，返回组装完成的选项数组。
}
// getContextUsedPercent 估算当前上下文已用百分比，供「清上下文」选项显示「已用 X%」提示，便于用户判断要不要清上下文。
function getContextUsedPercent(usage: {
  input_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
} | undefined, permissionMode: PermissionMode): number | null {
  if (!usage) return null;
  const runtimeModel = getRuntimeMainLoopModel({
    permissionMode,
    mainLoopModel: getMainLoopModel(),
    exceeds200kTokens: false
  });
  const contextWindowSize = getContextWindowForModel(runtimeModel, getSdkBetas());
  const {
    used
  } = calculateContextPercentages({
    input_tokens: usage.input_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0
  }, contextWindowSize);
  return used;
}
// getContextUsedPercent 收尾，返回 used 百分比（无 usage 时返回 null）。
// 原文件此处有一行 87160 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。