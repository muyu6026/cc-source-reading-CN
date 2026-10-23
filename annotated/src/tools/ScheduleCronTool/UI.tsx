import React from 'react';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Text } from '../../ink.js';
import { truncate } from '../../utils/format.js';
import type { CreateOutput } from './CronCreateTool.js';
import type { DeleteOutput } from './CronDeleteTool.js';
import type { ListOutput } from './CronListTool.js';

// --- CronCreate -------------------------------------------------------------

// renderCreateToolUseMessage：cron 表达式原样 + prompt 截断 60 字符。表达式是人类可读的调度语言（对比 cronToHuman 的「每周五 9 点」），原样显示让用户能核对自己写的表达式。
export function renderCreateToolUseMessage(input: Partial<{
  cron: string;
  prompt: string;
}>): React.ReactNode {
  return `${input.cron ?? ''}${input.prompt ? `: ${truncate(input.prompt, 60, true)}` : ''}`;
}
// renderCreateResultMessage：任务 ID 加粗 + 括号内人类可读周期。ID 是后续 CronDelete 的唯一凭据，结果位必须显眼。
export function renderCreateResultMessage(output: CreateOutput): React.ReactNode {
  return <MessageResponse>
      <Text>
        Scheduled <Text bold>{output.id}</Text>{' '}
        <Text dimColor>({output.humanSchedule})</Text>
      </Text>
    </MessageResponse>;
}

// --- CronDelete -------------------------------------------------------------

// renderDeleteToolUseMessage：只显示 ID——删除的「使用中」状态就是一行 ID，没有更多信息可展示。
export function renderDeleteToolUseMessage(input: Partial<{
  id: string;
}>): React.ReactNode {
  return input.id ?? '';
}
export function renderDeleteResultMessage(output: DeleteOutput): React.ReactNode {
  return <MessageResponse>
      <Text>
        Cancelled <Text bold>{output.id}</Text>
      </Text>
    </MessageResponse>;
}

// --- CronList ---------------------------------------------------------------

// renderListToolUseMessage 返回空串——列任务的进行态无内容（瞬时操作），只在结果位出现。
export function renderListToolUseMessage(): React.ReactNode {
  return '';
}
// renderListResultMessage：空列表灰字「No scheduled jobs」；非空每个任务一行（ID 加粗 + 人类周期）。与 mapToolResult 的纯文本版同构——ink 组件版给 TUI，文本版给 tool_result。
export function renderListResultMessage(output: ListOutput): React.ReactNode {
  if (output.jobs.length === 0) {
    return <MessageResponse>
        <Text dimColor>No scheduled jobs</Text>
      </MessageResponse>;
  }
  return <MessageResponse>
      {output.jobs.map(j => <Text key={j.id}>
          <Text bold>{j.id}</Text> <Text dimColor>{j.humanSchedule}</Text>
        </Text>)}
    </MessageResponse>;
}

// --- Shared -----------------------------------------------------------------
// 原文件此处有一行 6088 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。