import React from 'react';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Text } from '../../ink.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import type { Input, Output } from './ConfigTool.js';
export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
// renderToolUseMessage 二分：没带 value 显示 Getting xxx，带了显示 Setting xxx to 值——一眼区分读写意图。
  if (!input.setting) return null;
  if (input.value === undefined) {
    return <Text dimColor>Getting {input.setting}</Text>;
  }
  return <Text dimColor>
      Setting {input.setting} to {jsonStringify(input.value)}
    </Text>;
}
export function renderToolResultMessage(content: Output): React.ReactNode {
// renderToolResultMessage 三分支：失败走 error 色 + MessageResponse 块，get 显示 setting = value，set 显示新旧值。
  if (!content.success) {
    return <MessageResponse>
        <Text color="error">Failed: {content.error}</Text>
      </MessageResponse>;
  }
  if (content.operation === 'get') {
    return <MessageResponse>
        <Text>
          <Text bold>{content.setting}</Text> = {jsonStringify(content.value)}
        </Text>
      </MessageResponse>;
  }
  return <MessageResponse>
      <Text>
        Set <Text bold>{content.setting}</Text> to{' '}
        <Text bold>{jsonStringify(content.newValue)}</Text>
      </Text>
    </MessageResponse>;
}
export function renderToolUseRejectedMessage(): React.ReactNode {
// 被用户拒绝时只给一句 warning 色短文案——配置修改被拒是常见事，不值得大版面。
  return <Text color="warning">Config change rejected</Text>;
}
// 原文件此处有一行 4400 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。