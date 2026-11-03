import { basename, sep } from 'path';
// shellPermissionHelpers 专门给 Bash / PowerShell 的权限对话框生成「Yes, and apply suggestions」那一行建议文案，把规则、目录、命令三类信息拼成可读的句子。
import React, { type ReactNode } from 'react';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { Text } from '../../ink.js';
import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js';
import { permissionRuleExtractPrefix } from '../../utils/permissions/shellRuleMatching.js';
function commandListDisplay(commands: string[]): ReactNode {
  switch (commands.length) {
    case 0:
      return '';
    case 1:
      return <Text bold>{commands[0]}</Text>;
    case 2:
      return <Text>
          <Text bold>{commands[0]}</Text> and <Text bold>{commands[1]}</Text>
        </Text>;
    default:
      return <Text>
          <Text bold>{commands.slice(0, -1).join(', ')}</Text>, and{' '}
          <Text bold>{commands.slice(-1)[0]}</Text>
        </Text>;
  }
}
// commandListDisplay 把命令数组渲染成文本：0 个为空、1 个加粗、2 个用 and 连接、3 个以上用「a, b, and N more」省略。
function commandListDisplayTruncated(commands: string[]): ReactNode {
  // Check if the plain text representation would be too long
  const plainText = commands.join(', ');
  if (plainText.length > 50) {
    return 'similar';
  }
  return commandListDisplay(commands);
}
// commandListDisplayTruncated 先判断纯文本是否过长（大于 50），超长就返回 similar 做兜底，否则走正常列表渲染。
function formatPathList(paths: string[]): ReactNode {
  if (paths.length === 0) return '';

  // Extract directory names from paths
  const names = paths.map(p => basename(p) || p);
  if (names.length === 1) {
    return <Text>
        <Text bold>{names[0]}</Text>
        {sep}
      </Text>;
  }
  if (names.length === 2) {
    return <Text>
        <Text bold>{names[0]}</Text>
        {sep} and <Text bold>{names[1]}</Text>
        {sep}
      </Text>;
  }

  // For 3+, show first two with "and N more"
  return <Text>
      <Text bold>{names[0]}</Text>
      {sep}, <Text bold>{names[1]}</Text>
      {sep} and {paths.length - 2} more
    </Text>;
}
// formatPathList 把路径数组取 basename 后拼成「name<sep>」形式，多路径同样用 and N more 省略。

/**
 * Generate the label for the "Yes, and apply suggestions" option in shell
 * permission dialogs (Bash, PowerShell). Parametrized by the shell tool name
 * and an optional command transform (e.g., Bash strips output redirections so
 * filenames don't show as commands).
 */
// generateShellSuggestionsLabel 的注释说明：它生成 shell 权限对话框里允许并应用建议选项的标签，按 shell 工具名和可选的命令变换函数参数化（比如 Bash 会剥掉输出重定向，使文件名不被当成命令）。
export function generateShellSuggestionsLabel(suggestions: PermissionUpdate[], shellToolName: string, commandTransform?: (command: string) => string): ReactNode | null {
// generateShellSuggestionsLabel 先收集所有 addRules 规则，再拆成 Read 规则和 shell 规则两套；目录来自 addDirectories，路径从 Read 规则里抽出。
  // Collect all rules for display
  const allRules = suggestions.filter(s => s.type === 'addRules').flatMap(s => s.rules || []);

  // Separate Read rules from shell rules
  const readRules = allRules.filter(r => r.toolName === 'Read');
  const shellRules = allRules.filter(r => r.toolName === shellToolName);

  // Get directory info
  const directories = suggestions.filter(s => s.type === 'addDirectories').flatMap(s => s.directories || []);

  // Extract paths from Read rules (keep separate from directories)
  const readPaths = readRules.map(r => r.ruleContent?.replace('/**', '') || '').filter(p => p);

  // Extract shell command prefixes, optionally transforming for display
  const shellCommands = [...new Set(shellRules.flatMap(rule => {
    if (!rule.ruleContent) return [];
    const command = permissionRuleExtractPrefix(rule.ruleContent) ?? rule.ruleContent;
    return commandTransform ? commandTransform(command) : command;
  }))];
// shellCommands 用 permissionRuleExtractPrefix 抽出命令前缀（可选经 commandTransform 变换去重），形成最终要展示的命令清单。

  // Check what we have
  const hasDirectories = directories.length > 0;
  const hasReadPaths = readPaths.length > 0;
  const hasCommands = shellCommands.length > 0;

  // Handle single type cases
  if (hasReadPaths && !hasDirectories && !hasCommands) {
    // Only Read rules - use "reading from" language
    if (readPaths.length === 1) {
      const firstPath = readPaths[0]!;
      const dirName = basename(firstPath) || firstPath;
      return <Text>
          Yes, allow reading from <Text bold>{dirName}</Text>
          {sep} from this project
        </Text>;
    }

    // Multiple read paths
    return <Text>
        Yes, allow reading from {formatPathList(readPaths)} from this project
      </Text>;
  }
  if (hasDirectories && !hasReadPaths && !hasCommands) {
    // Only directory permissions - use "access to" language
    if (directories.length === 1) {
      const firstDir = directories[0]!;
      const dirName = basename(firstDir) || firstDir;
      return <Text>
          Yes, and always allow access to <Text bold>{dirName}</Text>
          {sep} from this project
        </Text>;
    }

    // Multiple directories
    return <Text>
        Yes, and always allow access to {formatPathList(directories)} from this
        project
      </Text>;
  }
  if (hasCommands && !hasDirectories && !hasReadPaths) {
    // Only shell command permissions
    return <Text>
        {"Yes, and don't ask again for "}
        {commandListDisplayTruncated(shellCommands)} commands in{' '}
        <Text bold>{getOriginalCwd()}</Text>
      </Text>;
  }
// 单一类型分支：只有 Read 规则时用 reading from、只有目录时用 access to、只有 shell 命令时用 don't ask again for <命令> commands；并分别处理单条与多条。

  // Handle mixed cases
  if ((hasDirectories || hasReadPaths) && !hasCommands) {
    // Combine directories and read paths since they're both path access
    const allPaths = [...directories, ...readPaths];
    if (hasDirectories && hasReadPaths) {
      // Mixed - use generic "access to"
      return <Text>
          Yes, and always allow access to {formatPathList(allPaths)} from this
          project
        </Text>;
    }
  }
  if ((hasDirectories || hasReadPaths) && hasCommands) {
    // Build descriptive message for both types
    const allPaths = [...directories, ...readPaths];

    // Keep it concise but informative
    if (allPaths.length === 1 && shellCommands.length === 1) {
      return <Text>
          Yes, and allow access to {formatPathList(allPaths)} and{' '}
          {commandListDisplayTruncated(shellCommands)} commands
        </Text>;
    }
    return <Text>
        Yes, and allow {formatPathList(allPaths)} access and{' '}
        {commandListDisplayTruncated(shellCommands)} commands
      </Text>;
  }
// 混合类型分支：目录与读路径合并后用 access to，再视是否含命令拼出 access ... and <命令> commands；都不匹配才返回 null（不显示建议）。
  return null;
}
// 函数最终在没有可展示的建议时返回 null。
// 原文件此处有一行 16720 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。