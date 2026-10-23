import * as React from 'react';
import { Markdown } from 'src/components/Markdown.js';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { RejectedPlanMessage } from 'src/components/messages/UserToolResultMessage/RejectedPlanMessage.js';
import { BLACK_CIRCLE } from 'src/constants/figures.js';
import { getModeColor } from 'src/utils/permissions/PermissionMode.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import { getDisplayPath } from '../../utils/file.js';
import { getPlan } from '../../utils/plans.js';
import type { ThemeName } from '../../utils/theme.js';
import type { Output } from './ExitPlanModeV2Tool.js';
// renderToolUseMessage 返回 null——与 EnterPlanModeTool 对称：审批对话框本身就是 UI，不需要额外的进行态。
export function renderToolUseMessage(): React.ReactNode {
  return null;
}
// 结果消息三态分流：空计划（一行「Exited plan mode」）/ 等队长审批（显示计划文件路径 + 等待语）/ 正常（用户批准语 + Markdown 渲染计划全文）。
export function renderToolResultMessage(output: Output, _progressMessagesForMessage: ProgressMessage<ToolProgressData>[], {
  theme: _theme
}: {
  theme: ThemeName;
}): React.ReactNode {
  const {
    plan,
    filePath
  } = output;
  const isEmpty = !plan || plan.trim() === '';
  const displayPath = filePath ? getDisplayPath(filePath) : '';
  const awaitingLeaderApproval = output.awaitingLeaderApproval;

  // Simplified message for empty plans
// 空计划态刻意简化：没有计划可展示时连 MessageResponse 容器都不挂——空计划的批准是「放你走了」而非「按此执行」，UI 不能制造不存在的仪式感。
  if (isEmpty) {
    return <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Text color={getModeColor('plan')}>{BLACK_CIRCLE}</Text>
          <Text> Exited plan mode</Text>
        </Box>
      </Box>;
  }

  // When awaiting leader approval, show a different message
// 等待队长态：文案主语是队友视角（Plan submitted for team lead approval），与本地批准态区分——同一个工具在团队协作里是异步消息，不是同步对话框。
  if (awaitingLeaderApproval) {
    return <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Text color={getModeColor('plan')}>{BLACK_CIRCLE}</Text>
          <Text> Plan submitted for team lead approval</Text>
        </Box>
        <MessageResponse>
          <Box flexDirection="column">
            {filePath && <Text dimColor>Plan file: {displayPath}</Text>}
            <Text dimColor>Waiting for team lead to review and approve...</Text>
          </Box>
        </MessageResponse>
      </Box>;
  }
// 正常态：Markdown 渲染计划全文 + 「/plan to edit」提示——计划文件是会话内可持续编辑的一等公民，不是一次性快照。
  return <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Text color={getModeColor('plan')}>{BLACK_CIRCLE}</Text>
        <Text> User approved Claude&apos;s plan</Text>
      </Box>
      <MessageResponse>
        <Box flexDirection="column">
          {filePath && <Text dimColor>Plan saved to: {displayPath} · /plan to edit</Text>}
          <Markdown>{plan}</Markdown>
        </Box>
      </MessageResponse>
    </Box>;
}
// 拒绝态复用 RejectedPlanMessage 组件（用户工具结果消息体系），计划内容从 getPlan() 现取——被拒时用户看到的正是他刚刚否掉的那份计划，便于直接在旁边改。
export function renderToolUseRejectedMessage({
  plan
}: {
  plan?: string;
}, {
  theme: _theme
}: {
  theme: ThemeName;
}): React.ReactNode {
  const planContent = plan ?? getPlan() ?? 'No plan found';
  return <Box flexDirection="column">
      <RejectedPlanMessage plan={planContent} />
    </Box>;
}
// 原文件此处有一行 8508 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。