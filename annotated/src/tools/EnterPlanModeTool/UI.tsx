import * as React from 'react';
import { BLACK_CIRCLE } from 'src/constants/figures.js';
import { getModeColor } from 'src/utils/permissions/PermissionMode.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import type { ThemeName } from '../../utils/theme.js';
import type { Output } from './EnterPlanModeTool.js';
// renderToolUseMessage 返回 null——「正在进入计划模式」不需要任何进行态 UI，这个过程瞬间完成。
export function renderToolUseMessage(): React.ReactNode {
  return null;
}
// 结果消息：模式色圆点 + 「Entered plan mode」+ 一行灰色说明。三个 render 函数都是纯 ink 组件树，无状态无副作用。
export function renderToolResultMessage(_output: Output, _progressMessagesForMessage: ProgressMessage<ToolProgressData>[], _options: {
  theme: ThemeName;
}): React.ReactNode {
// 圆点颜色走 getModeColor(plan)——模式色是全 UI 统一的视觉语言（权限模式栏、对话框、此处同一套色板）。
  return <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Text color={getModeColor('plan')}>{BLACK_CIRCLE}</Text>
        <Text> Entered plan mode</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor>
          Claude is now exploring and designing an implementation approach.
        </Text>
      </Box>
    </Box>;
}
// 拒绝消息用 default 色而非 plan 色——视觉上明确「没进成」，并用词 User declined 把责任方写明。
export function renderToolUseRejectedMessage(): React.ReactNode {
  return <Box flexDirection="row" marginTop={1}>
      <Text color={getModeColor('default')}>{BLACK_CIRCLE}</Text>
      <Text> User declined to enter plan mode</Text>
    </Box>;
}
// 原文件此处有一行 4012 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。