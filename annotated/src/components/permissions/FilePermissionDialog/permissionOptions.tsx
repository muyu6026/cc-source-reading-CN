import { homedir } from 'os';
// 引入系统用户目录与路径处理工具
import { basename, join, sep } from 'path';
import React, { type ReactNode } from 'react';
import { getOriginalCwd } from '../../../bootstrap/state.js';
import { Text } from '../../../ink.js';
import { getShortcutDisplay } from '../../../keybindings/shortcutFormat.js';
import type { ToolPermissionContext } from '../../../Tool.js';
import { expandPath, getDirectoryForPath } from '../../../utils/path.js';
import { normalizeCaseForComparison, pathInAllowedWorkingPath } from '../../../utils/permissions/filesystem.js';
import type { OptionWithDescription } from '../../CustomSelect/select.js';
/**
 * Check if a path is within the project's .claude/ folder.
 * This is used to determine whether to show the special ".claude folder" permission option.
 */
export function isInClaudeFolder(filePath: string): boolean {
// 判断路径是否位于项目 .claude 文件夹内
  const absolutePath = expandPath(filePath);
// 将路径展开为绝对路径
  const claudeFolderPath = expandPath(`${getOriginalCwd()}/.claude`);

  // Check if the path is within the project's .claude folder
  const normalizedAbsolutePath = normalizeCaseForComparison(absolutePath);
  const normalizedClaudeFolderPath = normalizeCaseForComparison(claudeFolderPath);
// 规范化路径大小写以便比较

  // Path must start with the .claude folder path (and be inside it, not just the folder itself)
  return normalizedAbsolutePath.startsWith(normalizedClaudeFolderPath + sep.toLowerCase()) ||
// 路径须以 .claude 前缀开头且位于其内（非文件夹本身）
  // Also match case where sep is / on posix systems
  normalizedAbsolutePath.startsWith(normalizedClaudeFolderPath + '/');
}

/**
 * Check if a path is within the global ~/.claude/ folder.
 * This is used to determine whether to show the special ".claude folder" permission option
 * for files in the user's home directory.
 */
export function isInGlobalClaudeFolder(filePath: string): boolean {
// 判断路径是否位于全局 ~/.claude 文件夹内
  const absolutePath = expandPath(filePath);
  const globalClaudeFolderPath = join(homedir(), '.claude');
  const normalizedAbsolutePath = normalizeCaseForComparison(absolutePath);
  const normalizedGlobalClaudeFolderPath = normalizeCaseForComparison(globalClaudeFolderPath);
  return normalizedAbsolutePath.startsWith(normalizedGlobalClaudeFolderPath + sep.toLowerCase()) || normalizedAbsolutePath.startsWith(normalizedGlobalClaudeFolderPath + '/');
}
export type PermissionOption = {
// 比较规范化后的全局 .claude 路径前缀
  type: 'accept-once';
} | {
  type: 'accept-session';
  scope?: 'claude-folder' | 'global-claude-folder';
} | {
  type: 'reject';
};
export type PermissionOptionWithLabel = OptionWithDescription<string> & {
  option: PermissionOption;
};
export type FileOperationType = 'read' | 'write' | 'create';
export function getFilePermissionOptions({
// 构建文件权限选项列表（接受/会话/拒绝）
  filePath,
  toolPermissionContext,
  operationType = 'write',
  onRejectFeedbackChange,
  onAcceptFeedbackChange,
  yesInputMode = false,
  noInputMode = false
}: {
  filePath: string;
  toolPermissionContext: ToolPermissionContext;
  operationType?: FileOperationType;
  onRejectFeedbackChange?: (value: string) => void;
  onAcceptFeedbackChange?: (value: string) => void;
  yesInputMode?: boolean;
  noInputMode?: boolean;
}): PermissionOptionWithLabel[] {
  const options: PermissionOptionWithLabel[] = [];
// 选项数组，先准备接受一次的选项
  const modeCycleShortcut = getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab');
// 获取模式切换快捷键显示文本

  // When in input mode, show input field
  if (yesInputMode && onAcceptFeedbackChange) {
// 输入模式下显示可填写的接受输入框
    options.push({
      type: 'input',
      label: 'Yes',
      value: 'yes',
      placeholder: 'and tell Claude what to do next',
      onChange: onAcceptFeedbackChange,
      allowEmptySubmitToCancel: true,
      option: {
        type: 'accept-once'
      }
    });
  } else {
    options.push({
      label: 'Yes',
      value: 'yes',
      option: {
        type: 'accept-once'
      }
    });
  }
  const inAllowedPath = pathInAllowedWorkingPath(filePath, toolPermissionContext);
// 判断文件是否在允许的工作路径内

  // Check if this is a .claude/ folder path (project or global)
  const inClaudeFolder = isInClaudeFolder(filePath);
// 是否位于项目或全局 .claude 文件夹
  const inGlobalClaudeFolder = isInGlobalClaudeFolder(filePath);

  // Option 2: For .claude/ folder, show special option instead of generic session option
  // Note: Session-level options are always shown since they only affect in-memory state,
  // not persisted settings. The allowManagedPermissionRulesOnly setting only restricts
  // persisted permission rules.
  if ((inClaudeFolder || inGlobalClaudeFolder) && operationType !== 'read') {
// .claude 路径提供允许编辑自身设置的会话选项
    options.push({
      label: 'Yes, and allow Claude to edit its own settings for this session',
      value: 'yes-claude-folder',
      option: {
        type: 'accept-session',
        scope: inGlobalClaudeFolder ? 'global-claude-folder' : 'claude-folder'
      }
    });
  } else {
// 否则提供通用的本次会话允许选项
    // Option 2: Allow all changes/reads during session
    let sessionLabel: ReactNode;
    if (inAllowedPath) {
// 工作目录内与外的文案不同，外路径带目录名
      // Inside working directory
      if (operationType === 'read') {
        sessionLabel = 'Yes, during this session';
      } else {
        sessionLabel = <Text>
            Yes, allow all edits during this session{' '}
            <Text bold>({modeCycleShortcut})</Text>
          </Text>;
      }
    } else {
      // Outside working directory - include directory name
// 取父目录名用于外路径文案
      const dirPath = getDirectoryForPath(filePath);
      const dirName = basename(dirPath) || 'this directory';
      if (operationType === 'read') {
        sessionLabel = <Text>
            Yes, allow reading from <Text bold>{dirName}/</Text> during this
            session
          </Text>;
      } else {
        sessionLabel = <Text>
            Yes, allow all edits in <Text bold>{dirName}/</Text> during this
            session <Text bold>({modeCycleShortcut})</Text>
          </Text>;
      }
    }
    options.push({
      label: sessionLabel,
      value: 'yes-session',
      option: {
        type: 'accept-session'
      }
    });
  }

  // When in input mode, show input field for reject
// 输入模式下显示可填写的拒绝输入框
  if (noInputMode && onRejectFeedbackChange) {
    options.push({
      type: 'input',
      label: 'No',
      value: 'no',
      placeholder: 'and tell Claude what to do differently',
      onChange: onRejectFeedbackChange,
      allowEmptySubmitToCancel: true,
      option: {
        type: 'reject'
      }
    });
  } else {
    // Not in input mode - simple option
    options.push({
      label: 'No',
      value: 'no',
      option: {
        type: 'reject'
      }
    });
  }
  return options;
}
// 返回完整权限选项列表
// 原文件此处有一行 16028 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。