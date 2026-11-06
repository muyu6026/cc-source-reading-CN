import { join } from 'path';
// 依赖：path.join、React、导出对话框组件、命令与消息类型、cwd 与纯文本渲染、废弃的同步写文件。
import React from 'react';
import { ExportDialog } from '../../components/ExportDialog.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import type { Message } from '../../types/message.js';
import { getCwd } from '../../utils/cwd.js';
import { renderMessagesToPlainText } from '../../utils/exportRenderer.js';
import { writeFileSync_DEPRECATED } from '../../utils/slowOperations.js';
// 最后一条 import；下面都是辅助函数与命令入口。
function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}
// formatTimestamp：把 Date 拼成年月日时分秒的文件名安全串。
export function extractFirstPrompt(messages: Message[]): string {
  const firstUserMessage = messages.find(msg => msg.type === 'user');
  if (!firstUserMessage || firstUserMessage.type !== 'user') {
    return '';
  }
  const content = firstUserMessage.message?.content;
  let result = '';
  if (typeof content === 'string') {
    result = content.trim();
  } else if (Array.isArray(content)) {
    const textContent = content.find(item => item.type === 'text');
    if (textContent && 'text' in textContent) {
      result = textContent.text.trim();
    }
  }

  // Take first line only and limit length
  result = result.split('\n')[0] || '';
  if (result.length > 50) {
    result = result.substring(0, 49) + '…';
  }
  return result;
}
// extractFirstPrompt：取第一条用户消息的首行、截到五十字，作为默认文件名。
export function sanitizeFilename(text: string): string {
  // Replace special characters with hyphens
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '') // Remove special chars
  .replace(/\s+/g, '-') // Replace spaces with hyphens
  .replace(/-+/g, '-') // Replace multiple hyphens with single
  .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}
// sanitizeFilename：小写化、去特殊字符、空格与多余连字符归一，做文件名清洗。
async function exportWithReactRenderer(context: ToolUseContext): Promise<string> {
  const tools = context.options.tools || [];
  return renderMessagesToPlainText(context.messages, tools);
}
// exportWithReactRenderer：用 React 渲染器把消息转成纯文本。
export async function call(onDone: LocalJSXCommandOnDone, context: ToolUseContext, args: string): Promise<React.ReactNode> {
// call 命令入口：先渲染对话内容，再决定写文件还是弹对话框。
  // Render the conversation content
  const content = await exportWithReactRenderer(context);

  // If args are provided, write directly to file and skip dialog
  const filename = args.trim();
  if (filename) {
    const finalFilename = filename.endsWith('.txt') ? filename : filename.replace(/\.[^.]+$/, '') + '.txt';
    const filepath = join(getCwd(), finalFilename);
    try {
      writeFileSync_DEPRECATED(filepath, content, {
        encoding: 'utf-8',
        flush: true
      });
      onDone(`Conversation exported to: ${filepath}`);
      return null;
// 直接写盘分支：带了参数就同步写出点 txt，成功或失败都回显给用户。
    } catch (error) {
      onDone(`Failed to export conversation: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  // Generate default filename from first prompt or timestamp
  const firstPrompt = extractFirstPrompt(context.messages);
  const timestamp = formatTimestamp(new Date());
  let defaultFilename: string;
  if (firstPrompt) {
    const sanitized = sanitizeFilename(firstPrompt);
    defaultFilename = sanitized ? `${timestamp}-${sanitized}.txt` : `conversation-${timestamp}.txt`;
  } else {
    defaultFilename = `conversation-${timestamp}.txt`;
  }
// 默认文件名：有首提示就清洗后拼接时间戳，否则用 conversation-时间戳。

  // Return the dialog component when no args provided
  return <ExportDialog content={content} defaultFilename={defaultFilename} onDone={result => {
    onDone(result.message);
  }} />;
}
// 无参数时返回导出对话框组件，让用户决定文件名与落盘位置。
// 原文件此处有一行 11380 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。