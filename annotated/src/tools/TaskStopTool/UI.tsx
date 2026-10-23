import React from 'react';
import { MessageResponse } from '../../components/MessageResponse.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Text } from '../../ink.js';
import { truncateToWidthNoEllipsis } from '../../utils/format.js';
import type { Output } from './TaskStopTool.js';
// Output 类型从 TaskStopTool.js 导入——渲染层与工具层靠类型契约连接，不靠运行时。
export function renderToolUseMessage(): React.ReactNode {
  return '';
}
// renderToolUseMessage 返回空串：调用气泡（正在停止…）不显示任何正文。
const MAX_COMMAND_DISPLAY_LINES = 2;
const MAX_COMMAND_DISPLAY_CHARS = 160;
// 两个截断常量：最多 2 行、最多 160 字符宽——停掉的后台命令可能是一整段脚本，全显示会撑爆对话流。
function truncateCommand(command: string): string {
  const lines = command.split('\n');
  let truncated = command;
  if (lines.length > MAX_COMMAND_DISPLAY_LINES) {
    truncated = lines.slice(0, MAX_COMMAND_DISPLAY_LINES).join('\n');
  }
  if (stringWidth(truncated) > MAX_COMMAND_DISPLAY_CHARS) {
    truncated = truncateToWidthNoEllipsis(truncated, MAX_COMMAND_DISPLAY_CHARS);
  }
  return truncated.trim();
}
// truncateCommand 双重截断：先砍行数再砍显示宽度，最后 trim。verbose 模式下调用方绕过它看全文。
export function renderToolResultMessage(output: Output, _progressMessagesForMessage: unknown[], {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
// renderToolResultMessage(output, progressMessages, {verbose})：verbose 由 UI 层传人，决定截断还是全显。
  if ("external" === 'ant') {
    return null;
  }
// 恒假条件 "external" === 'ant'：疑似泄漏构建把 process.env.USER_TYPE 替换成了字面量 "external"，与 'ant' 比永远为 false——这个「ant 用户不渲染」的分支被砌死了，等价于所有人都不走该分支。
  const rawCommand = output.command ?? '';
  const command = verbose ? rawCommand : truncateCommand(rawCommand);
  const suffix = command !== rawCommand ? '… · stopped' : ' · stopped';
// suffix 逻辑：命令被截断时才加省略号，结尾统一缀 ' · stopped'。
  return <MessageResponse>
      <Text>
        {command}
        {suffix}
      </Text>
    </MessageResponse>;
// MessageResponse 包 Text——走统一 markdown 渲染通道，命令里的特殊字符不会冲破 UI。
}
// 原文件此处有一行 4292 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。