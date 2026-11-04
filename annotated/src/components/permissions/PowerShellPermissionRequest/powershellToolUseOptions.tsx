import { POWERSHELL_TOOL_NAME } from '../../../tools/PowerShellTool/toolName.js';
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js';
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js';
import type { OptionWithDescription } from '../../CustomSelect/select.js';
import { generateShellSuggestionsLabel } from '../shellPermissionHelpers.js';
// PowerShell 权限弹窗的选项工厂：四个选项值 yes/yes-apply-suggestions/yes-prefix-edited/no
export type PowerShellToolUseOption = 'yes' | 'yes-apply-suggestions' | 'yes-prefix-edited' | 'no';
export function powershellToolUseOptions({
  suggestions = [],
  onRejectFeedbackChange,
  onAcceptFeedbackChange,
  yesInputMode = false,
  noInputMode = false,
  editablePrefix,
  onEditablePrefixChange
}: {
  suggestions?: PermissionUpdate[];
  onRejectFeedbackChange: (value: string) => void;
  onAcceptFeedbackChange: (value: string) => void;
  yesInputMode?: boolean;
  noInputMode?: boolean;
  editablePrefix?: string;
  onEditablePrefixChange?: (value: string) => void;
}): OptionWithDescription<PowerShellToolUseOption>[] {
  const options: OptionWithDescription<PowerShellToolUseOption>[] = [];
// yes 选项支持 input 模式：选 yes 时可附带「接下来告诉 Claude 做什么」的反馈文本
  if (yesInputMode) {
    options.push({
      type: 'input',
      label: 'Yes',
      value: 'yes',
      placeholder: 'and tell Claude what to do next',
      onChange: onAcceptFeedbackChange,
      allowEmptySubmitToCancel: true
// allowEmptySubmitToCancel：input 模式下空提交等于取消——反馈可写可不写
    });
  } else {
    options.push({
      label: 'Yes',
      value: 'yes'
    });
  }

  // Note: No sandbox toggle for PowerShell - sandbox is not supported on Windows
  // Note: No classifier-reviewed option for PowerShell (ANT-ONLY feature for Bash)
// 两条注释说明 PowerShell 没有 sandbox 选项（Windows 不支持）与分类器选项（Bash 专属的内部功能）——选项工厂按工具能力裁剪

// always-allow 组：受 allowManagedPermissionRulesOnly 限制时不显示；可编辑前缀输入优先于静态 suggestions 标签
  // Only show "always allow" options when not restricted by allowManagedPermissionRulesOnly.
  // Prefer the editable prefix input (static extractor + user edits) over the
  // non-editable suggestions label. The editable input can't represent
  // directory permissions or Read-tool rules, so fall back to the label when
  // those are present.
  if (shouldShowAlwaysAllowOptions() && suggestions.length > 0) {
    const hasNonPowerShellSuggestions = suggestions.some(s => s.type === 'addDirectories' || s.type === 'addRules' && s.rules?.some(r => r.toolName !== POWERSHELL_TOOL_NAME));
// hasNonPowerShellSuggestions 检测：含目录权限或非 PowerShell 工具规则时，可编辑前缀无法表达这些权限，必须回退静态标签
    if (editablePrefix !== undefined && onEditablePrefixChange && !hasNonPowerShellSuggestions) {
      options.push({
        type: 'input',
        label: 'Yes, and don\u2019t ask again for',
// 可编辑前缀选项：initialValue 来自静态提取器，用户可改成 Get-Process:* 这类命令前缀；showLabelWithValue 把标签和值合并一行显示（分隔符为冒号加空格）
        value: 'yes-prefix-edited',
        placeholder: 'command prefix (e.g., Get-Process:*)',
        initialValue: editablePrefix,
        onChange: onEditablePrefixChange,
        allowEmptySubmitToCancel: true,
        showLabelWithValue: true,
        labelValueSeparator: ': ',
        resetCursorOnUpdate: true
      });
    } else {
      const label = generateShellSuggestionsLabel(suggestions, POWERSHELL_TOOL_NAME);
// 回退路径：generateShellSuggestionsLabel 生成静态描述标签，生成失败（空串）则整个选项不出现
      if (label) {
        options.push({
          label,
          value: 'yes-apply-suggestions'
        });
      }
    }
  }
// no 选项同样支持 input 模式：拒绝时可告诉 Claude 应该怎么做
  if (noInputMode) {
    options.push({
      type: 'input',
      label: 'No',
      value: 'no',
      placeholder: 'and tell Claude what to do differently',
      onChange: onRejectFeedbackChange,
      allowEmptySubmitToCancel: true
    });
  } else {
    options.push({
      label: 'No',
      value: 'no'
    });
  }
  return options;
// 返回数组而非组件：选项工厂只负责数据，弹窗渲染交给调用方
}
// 原文件此处有一行 8644 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。