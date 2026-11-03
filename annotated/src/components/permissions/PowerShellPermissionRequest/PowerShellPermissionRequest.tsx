// PowerShell 命令的权限确认弹窗：结构上与 Bash 版同源——可编辑前缀、破坏性命令警告、决策调试面板、反馈模式一应俱全。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useTheme } from '../../../ink.js';
import { useKeybinding } from '../../../keybindings/useKeybinding.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../../services/analytics/growthbook.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../../services/analytics/index.js';
import { sanitizeToolNameForAnalytics } from '../../../services/analytics/metadata.js';
import { getDestructiveCommandWarning } from '../../../tools/PowerShellTool/destructiveCommandWarning.js';
import { PowerShellTool } from '../../../tools/PowerShellTool/PowerShellTool.js';
import { isAllowlistedCommand } from '../../../tools/PowerShellTool/readOnlyValidation.js';
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js';
import { getCompoundCommandPrefixesStatic } from '../../../utils/powershell/staticPrefix.js';
import { Select } from '../../CustomSelect/select.js';
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js';
import { PermissionDecisionDebugInfo } from '../PermissionDecisionDebugInfo.js';
import { PermissionDialog } from '../PermissionDialog.js';
import { PermissionExplainerContent, usePermissionExplainerUI } from '../PermissionExplanation.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
import { useShellPermissionFeedback } from '../useShellPermissionFeedback.js';
import { logUnaryPermissionEvent } from '../utils.js';
import { powershellToolUseOptions } from './powershellToolUseOptions.js';
export function PowerShellPermissionRequest(props: PermissionRequestProps): React.ReactNode {
  const {
    toolUseConfirm,
    toolUseContext,
    onDone,
    onReject,
    workerBadge
  } = props;
  const {
    command,
    description
// 入参先过 zod schema 再解构：权限请求的 input 是 unknown，这里完成类型收窄。
  } = PowerShellTool.inputSchema.parse(toolUseConfirm.input);
  const [theme] = useTheme();
// 解释器 UI 状态：ctrl+e 触发的「这段命令为什么需要权限」面板，由共享 hook 管理。
  const explainerState = usePermissionExplainerUI({
    toolName: toolUseConfirm.tool.name,
    toolInput: toolUseConfirm.input,
    toolDescription: toolUseConfirm.description,
    messages: toolUseContext.messages
  });
  const {
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
    handleFocus
// yes/no 的反馈输入模式（Tab 附加说明）也由共享 hook 接管，与 Bash 弹窗行为一致。
  } = useShellPermissionFeedback({
    toolUseConfirm,
    onDone,
    onReject,
    explainerVisible: explainerState.visible
  });
// 破坏性命令警告走特性开关：实验开启时检测 rm -rf 之类的命令并显示警告条，否则为 null 不占位。
  const destructiveWarning = getFeatureValue_CACHED_MAY_BE_STALE('tengu_destructive_command_warning', false) ? getDestructiveCommandWarning(command) : null;
  const [showPermissionDebug, setShowPermissionDebug] = useState(false);

  // Editable prefix — compute static prefix locally (no LLM call).
  // Initialize synchronously to the raw command for single-line commands so
  // the editable input renders immediately, then refine to the extracted prefix
  // once the AST parser resolves. Multiline commands (`# comment\n...`,
  // foreach loops) get undefined → powershellToolUseOptions:64 hides the
  // "don't ask again" option — those literals are one-time-use (settings
  // corpus shows 14 multiline rules, zero match twice). For compound commands,
  // computes a prefix per subcommand, excluding subcommands that are already
  // auto-allowed (read-only).
// 可编辑前缀的初始化策略：单行命令同步初始化为原始命令（输入框立即渲染），多行命令直接 undefined——上方注释统计过设置语料：14 条多行规则零重复命中，这种字面量是一次性的，「不再询问」选项会被 powershellToolUseOptions 隐藏。
  const [editablePrefix, setEditablePrefix] = useState<string | undefined>(command.includes('\n') ? undefined : command);
// hasUserEditedPrefix 防异步覆盖：AST 解析是异步的，用户若已手动改过前缀，解析结果到达时必须放弃写入。
  const hasUserEditedPrefix = useRef(false);
  useEffect(() => {
    let cancelled = false;
    // Filter receives ParsedCommandElement — isAllowlistedCommand works from
    // element.name/nameType/args directly. isReadOnlyCommand(text) would need
    // to reparse (pwsh.exe spawn per subcommand) and returns false without the
    // full parsed AST, making the filter a no-op.
// 复合命令静态前缀提取（不发 LLM 请求）：过滤回调直接吃解析元素，注释解释了为什么不用 isReadOnlyCommand——那会按子命令反复 spawn pwsh，且拿不到完整 AST 时恒返回假，等于过滤器失效。
    getCompoundCommandPrefixesStatic(command, element => isAllowlistedCommand(element, element.text)).then(prefixes => {
// 异步守卫三连：组件卸载（cancelled）或用户已编辑都直接放弃；提取成功则把前缀写成「前缀:*」通配形式。
      if (cancelled || hasUserEditedPrefix.current) return;
      if (prefixes.length > 0) {
        setEditablePrefix(`${prefixes[0]}:*`);
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);
// 用户输入回调置位 ref 并更新状态。
  const onEditablePrefixChange = useCallback((value: string) => {
    hasUserEditedPrefix.current = true;
    setEditablePrefix(value);
  }, []);
  const unaryEvent = useMemo<UnaryEvent>(() => ({
    completion_type: 'tool_use_single',
    language_name: 'none'
  }), []);
  usePermissionRequestLogging(toolUseConfirm, unaryEvent);
// 选项列表按五个依赖重建：反馈模式、前缀、建议变化都会改变「不再询问」等选项的文案与可用性。
  const options = useMemo(() => powershellToolUseOptions({
    suggestions: toolUseConfirm.permissionResult.behavior === 'ask' ? toolUseConfirm.permissionResult.suggestions : undefined,
    onRejectFeedbackChange: setRejectFeedback,
    onAcceptFeedbackChange: setAcceptFeedback,
    yesInputMode,
    noInputMode,
    editablePrefix,
    onEditablePrefixChange
  }), [toolUseConfirm, yesInputMode, noInputMode, editablePrefix, onEditablePrefixChange]);

  // Toggle permission debug info with keybinding
  const handleToggleDebug = useCallback(() => {
    setShowPermissionDebug(prev => !prev);
  }, []);
  useKeybinding('permission:toggleDebug', handleToggleDebug, {
    context: 'Confirmation'
  });
  function onSelect(value: string) {
    // Map options to numeric values for analytics (strings not allowed in logEvent)
// 选项名到数字的映射：打点事件不允许字符串枚举值，所以维护这张对照表。
    const optionIndex: Record<string, number> = {
      yes: 1,
      'yes-apply-suggestions': 2,
      'yes-prefix-edited': 2,
      no: 3
    };
    logEvent('tengu_permission_request_option_selected', {
      option_index: optionIndex[value],
      explainer_visible: explainerState.visible
    });
    const toolNameForAnalytics = sanitizeToolNameForAnalytics(toolUseConfirm.tool.name) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
// 「编辑过前缀的同意」分支：前缀非空时落一条 addRules 到 localSettings（用户手改的规则归会话级本地设置），空前缀退化为一次性同意。
    if (value === 'yes-prefix-edited') {
      const trimmedPrefix = (editablePrefix ?? '').trim();
      logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
      if (!trimmedPrefix) {
        toolUseConfirm.onAllow(toolUseConfirm.input, []);
      } else {
        const prefixUpdates: PermissionUpdate[] = [{
          type: 'addRules',
          rules: [{
            toolName: PowerShellTool.name,
            ruleContent: trimmedPrefix
          }],
          behavior: 'allow',
          destination: 'localSettings'
        }];
        toolUseConfirm.onAllow(toolUseConfirm.input, prefixUpdates);
      }
      onDone();
      return;
    }
    switch (value) {
// 普通同意分支：带反馈时把反馈文本传给 onAllow；打点记录是否处于反馈模式与反馈长度。
      case 'yes':
        {
          const trimmedFeedback = acceptFeedback.trim();
          logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
          // Log accept submission with feedback context
          logEvent('tengu_accept_submitted', {
            toolName: toolNameForAnalytics,
            isMcp: toolUseConfirm.tool.isMcp ?? false,
            has_instructions: !!trimmedFeedback,
            instructions_length: trimmedFeedback.length,
            entered_feedback_mode: yesFeedbackModeEntered
          });
          toolUseConfirm.onAllow(toolUseConfirm.input, [], trimmedFeedback || undefined);
          onDone();
          break;
        }
// 应用建议分支：permissionResult 里带 suggestions 时直接转成权限更新（allow 与 passthrough 行为都可能带）。
      case 'yes-apply-suggestions':
        {
          logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
          // Extract suggestions if present (works for both 'ask' and 'passthrough' behaviors)
          const permissionUpdates = 'suggestions' in toolUseConfirm.permissionResult ? toolUseConfirm.permissionResult.suggestions || [] : [];
          toolUseConfirm.onAllow(toolUseConfirm.input, permissionUpdates);
          onDone();
          break;
        }
// 拒绝分支：反馈为空走无理由拒绝，非空附带理由。
      case 'no':
        {
          const trimmedFeedback = rejectFeedback.trim();

          // Log reject submission with feedback context
          logEvent('tengu_reject_submitted', {
            toolName: toolNameForAnalytics,
            isMcp: toolUseConfirm.tool.isMcp ?? false,
            has_instructions: !!trimmedFeedback,
            instructions_length: trimmedFeedback.length,
            entered_feedback_mode: noFeedbackModeEntered
          });

          // Process rejection (with or without feedback)
          handleReject(trimmedFeedback || undefined);
          break;
        }
    }
  }
  return <PermissionDialog workerBadge={workerBadge} title="PowerShell command">
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text dimColor={explainerState.visible}>
          {PowerShellTool.renderToolUseMessage({
          command,
          description
        }, {
          theme,
          verbose: true
        } // always show the full command
        )}
        </Text>
        {!explainerState.visible && <Text dimColor>{toolUseConfirm.description}</Text>}
        <PermissionExplainerContent visible={explainerState.visible} promise={explainerState.promise} />
      </Box>
// debug 开关切换两套渲染：调试面板替换掉正常的选择区，此时只有 debug 模式才显示隐藏提示。
      {showPermissionDebug ? <>
          <PermissionDecisionDebugInfo permissionResult={toolUseConfirm.permissionResult} toolName="PowerShell" />
          {toolUseContext.options.debug && <Box justifyContent="flex-end" marginTop={1}>
              <Text dimColor>Ctrl-D to hide debug info</Text>
            </Box>}
        </> : <>
          <Box flexDirection="column">
            <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="command" />
            {destructiveWarning && <Box marginBottom={1}>
                <Text color="warning">{destructiveWarning}</Text>
              </Box>}
            <Text>Do you want to proceed?</Text>
            <Select options={options} inlineDescriptions onChange={onSelect} onCancel={() => handleReject()} onFocus={handleFocus} onInputModeToggle={handleInputModeToggle} />
          </Box>
          <Box justifyContent="space-between" marginTop={1}>
            <Text dimColor>
              Esc to cancel
// 底部提示按状态拼接：聚焦在 yes 或 no 且未进入反馈模式时提示 Tab 附加说明；解释器可用时提示 ctrl+e 切换。
              {(focusedOption === 'yes' && !yesInputMode || focusedOption === 'no' && !noInputMode) && ' · Tab to amend'}
              {explainerState.enabled && ` · ctrl+e to ${explainerState.visible ? 'hide' : 'explain'}`}
            </Text>
            {toolUseContext.options.debug && <Text dimColor>Ctrl+d to show debug info</Text>}
          </Box>
        </>}
    </PermissionDialog>;
}
// 原文件此处有一行 28148 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。