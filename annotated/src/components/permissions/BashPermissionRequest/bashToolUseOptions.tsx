import { BASH_TOOL_NAME } from '../../../tools/BashTool/toolName.js';
import { extractOutputRedirections } from '../../../utils/bash/commands.js';
import { isClassifierPermissionsEnabled } from '../../../utils/permissions/bashClassifier.js';
import type { PermissionDecisionReason } from '../../../utils/permissions/PermissionResult.js';
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js';
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js';
import type { OptionWithDescription } from '../../CustomSelect/select.js';
import { generateShellSuggestionsLabel } from '../shellPermissionHelpers.js';
// Bash 工具权限请求的可选项联合类型：yes / 带采纳建议 / 带改写前缀 / 带分类器描述 / no
export type BashToolUseOption = 'yes' | 'yes-apply-suggestions' | 'yes-prefix-edited' | 'yes-classifier-reviewed' | 'no';

/**
 * Check if a description already exists in the allow list.
 * Compares lowercase and trailing-whitespace-trimmed versions.
 */
// 判断某条描述是否已存在于允许列表：先转小写并去掉尾部空白再比较，避免重复添加
function descriptionAlreadyExists(description: string, existingDescriptions: string[]): boolean {
  const normalized = description.toLowerCase().trimEnd();
  return existingDescriptions.some(existing => existing.toLowerCase().trimEnd() === normalized);
}

/**
 * Strip output redirections so filenames don't show as commands in the label.
 */
// 剥离输出重定向：把 `> file` 之类重定向去掉，避免文件名被误当成要展示的命令
function stripBashRedirections(command: string): string {
  const {
    commandWithoutRedirections,
    redirections
  } = extractOutputRedirections(command);
  // Only use stripped version if there were actual redirections
  return redirections.length > 0 ? commandWithoutRedirections : command;
}
// 按当前交互态组装 Bash 权限弹窗的全部选项：是否显示「总是允许」取决于托管规则开关与各类建议
export function bashToolUseOptions({
  suggestions = [],
  decisionReason,
  onRejectFeedbackChange,
  onAcceptFeedbackChange,
  onClassifierDescriptionChange,
  classifierDescription,
  initialClassifierDescriptionEmpty = false,
  existingAllowDescriptions = [],
  yesInputMode = false,
  noInputMode = false,
  editablePrefix,
  onEditablePrefixChange
}: {
  suggestions?: PermissionUpdate[];
  decisionReason?: PermissionDecisionReason;
  onRejectFeedbackChange: (value: string) => void;
  onAcceptFeedbackChange: (value: string) => void;
  onClassifierDescriptionChange?: (value: string) => void;
  classifierDescription?: string;
  /** Whether the initial classifier description was empty. When true, hides the option. */
  initialClassifierDescriptionEmpty?: boolean;
  existingAllowDescriptions?: string[];
  yesInputMode?: boolean;
  noInputMode?: boolean;
  /** Editable prefix rule content (e.g., "npm run:*"). When set, replaces Haiku-based suggestions. */
  editablePrefix?: string;
  /** Callback when the user edits the prefix value. */
  onEditablePrefixChange?: (value: string) => void;
}): OptionWithDescription<BashToolUseOption>[] {
  const options: OptionWithDescription<BashToolUseOption>[] = [];
  if (yesInputMode) {
// 「是」选项：处于输入模式时是带占位符的输入框，否则是普通选项
    options.push({
      type: 'input',
      label: 'Yes',
      value: 'yes',
      placeholder: 'and tell Claude what to do next',
      onChange: onAcceptFeedbackChange,
      allowEmptySubmitToCancel: true
    });
  } else {
    options.push({
      label: 'Yes',
      value: 'yes'
    });
  }

  // Only show "always allow" options when not restricted by allowManagedPermissionRulesOnly
  if (shouldShowAlwaysAllowOptions()) {
// 只有不被 allowManagedPermissionRulesOnly 限制时才展示「总是允许」类选项
    // Show an editable input for the prefix rule instead of the
    // Haiku-generated suggestion label — but only when the suggestions
    // don't contain non-Bash items (addDirectories, Read rules) that
    // the editable prefix can't represent.
    const hasNonBashSuggestions = suggestions.some(s => s.type === 'addDirectories' || s.type === 'addRules' && s.rules?.some(r => r.toolName !== BASH_TOOL_NAME));
// 判断建议里是否混有非 Bash 项（加目录、加规则）：有则不走可编辑前缀，因为前缀表达不了它们
    if (editablePrefix !== undefined && onEditablePrefixChange && !hasNonBashSuggestions && suggestions.length > 0) {
      options.push({
        type: 'input',
        label: 'Yes, and don\u2019t ask again for',
        value: 'yes-prefix-edited',
        placeholder: 'command prefix (e.g., npm run:*)',
        initialValue: editablePrefix,
        onChange: onEditablePrefixChange,
        allowEmptySubmitToCancel: true,
        showLabelWithValue: true,
        labelValueSeparator: ': ',
        resetCursorOnUpdate: true
      });
    } else if (suggestions.length > 0) {
      const label = generateShellSuggestionsLabel(suggestions, BASH_TOOL_NAME, stripBashRedirections);
      if (label) {
        options.push({
          label,
          value: 'yes-apply-suggestions'
        });
      }
    }

    // Add classifier-reviewed option if enabled, the initial description was
    // non-empty, the description doesn't already exist in the allow list,
    // and the decision reason is NOT a server-side classifier block
    // (prompt-based rules don't help when the server-side classifier triggers first).
    // Skip when the editable prefix option is already shown — they serve the
    // same role and having two identical-looking "don't ask again" inputs is confusing.
    const editablePrefixShown = options.some(o => o.value === 'yes-prefix-edited');
    if ("external" === 'ant' && !editablePrefixShown && isClassifierPermissionsEnabled() && onClassifierDescriptionChange && !initialClassifierDescriptionEmpty && !descriptionAlreadyExists(classifierDescription ?? '', existingAllowDescriptions) && decisionReason?.type !== 'classifier') {
// 分类器选项守卫：字符串 external 与 ant 恒不相等，该条件永远为假（属被禁用的实验分支）；其余条件满足时才追加「按分类器描述不再询问」
      options.push({
        type: 'input',
        label: 'Yes, and don\u2019t ask again for',
        value: 'yes-classifier-reviewed',
        placeholder: 'describe what to allow...',
        initialValue: classifierDescription ?? '',
        onChange: onClassifierDescriptionChange,
        allowEmptySubmitToCancel: true,
        showLabelWithValue: true,
        labelValueSeparator: ': ',
        resetCursorOnUpdate: true
      });
    }
  }
  if (noInputMode) {
// 「否」选项：输入模式下是带占位符的输入框，否则是普通选项
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
}
// 原文件此处有一行 15320 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。