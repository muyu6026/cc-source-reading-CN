import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React from 'react';
import { Markdown } from '../../components/Markdown.js';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, Text } from '../../ink.js';
import type { ProgressMessage } from '../../types/message.js';
import { getDisplayPath } from '../../utils/file.js';
import { formatFileSize } from '../../utils/format.js';
import { formatBriefTimestamp } from '../../utils/formatBriefTimestamp.js';
import type { Output } from './BriefTool.js';
export function renderToolUseMessage(): React.ReactNode {
  return '';
}
// renderToolUseMessage 返回空串：工具调用本身不留痕迹，
// 消息正文才是全部输出（userFacingName 也是空串，双保险去工具外壳）。
export function renderToolResultMessage(output: Output, _progressMessages: ProgressMessage[], options?: {
  isTranscriptMode?: boolean;
  isBriefOnly?: boolean;
}): React.ReactNode {
  const hasAttachments = (output.attachments?.length ?? 0) > 0;
  if (!output.message && !hasAttachments) {
    return null;
  }
// 三种渲染模式按 options 分流；空消息且无附件直接不渲染。

  // In transcript mode (ctrl+o), model text is NOT filtered — keep the ⏺ so
  // SendUserMessage is visually distinct from the surrounding text blocks.
  if (options?.isTranscriptMode) {
    return <Box flexDirection="row" marginTop={1}>
        <Box minWidth={2}>
          <Text color="text">{BLACK_CIRCLE}</Text>
        </Box>
        <Box flexDirection="column">
          {output.message ? <Markdown>{output.message}</Markdown> : null}
          <AttachmentList attachments={output.attachments} />
        </Box>
      </Box>;
  }
// transcript 模式（ctrl+o）：模型文本不做过滤，保留 ⏺ 圆点
// 让 SendUserMessage 与周围文本块在视觉上可区分。

  // Brief-only (chat) view: "Claude" label + 2-col indent, matching the "You"
  // label UserPromptMessage applies to user input (#20889). The "N in background"
  // spinner status lives in BriefSpinner (Spinner.tsx) — stateless label here.
  if (options?.isBriefOnly) {
    const ts = output.sentAt ? formatBriefTimestamp(output.sentAt) : '';
    return <Box flexDirection="column" marginTop={1} paddingLeft={2}>
        <Box flexDirection="row">
          <Text color="briefLabelClaude">Claude</Text>
          {ts ? <Text dimColor> {ts}</Text> : null}
        </Box>
        <Box flexDirection="column">
          {output.message ? <Markdown>{output.message}</Markdown> : null}
          <AttachmentList attachments={output.attachments} />
        </Box>
      </Box>;
  }
// brief-only（chat）视图：Claude 标签 + 两列缩进，与用户消息的 You 标签对称
// （#20889）。「N in background」的转圈状态在 BriefSpinner（Spinner.tsx）里，
// 这里是无状态的静态标签 + 时间戳。

  // Default view: dropTextInBriefTurns (Messages.tsx) hides the redundant
  // assistant text that would otherwise precede this — SendUserMessage is the
  // only text-like content in its turn. No gutter mark; read as plain text.
  // userFacingName() returns '' so UserToolSuccessMessage drops its columns-5
  // width constraint and AssistantToolUseMessage renders null (no tool chrome).
  // Empty minWidth={2} box mirrors AssistantTextMessage's ⏺ gutter spacing.
  return <Box flexDirection="row" marginTop={1}>
      <Box minWidth={2} />
      <Box flexDirection="column">
        {output.message ? <Markdown>{output.message}</Markdown> : null}
        <AttachmentList attachments={output.attachments} />
      </Box>
    </Box>;
// 默认视图：dropTextInBriefTurns（Messages.tsx）会隐藏本轮冗余的助手文本——
// SendUserMessage 是本轮唯一的文本类内容。无侧栏记号，读作纯文本；
// 空 minWidth=2 盒子对齐 AssistantTextMessage 的 ⏺ 槽位。
}
type AttachmentListProps = {
  attachments: Output['attachments'];
};
export function AttachmentList(t0) {
  const $ = _c(4);
  const {
    attachments
  } = t0;
  if (!attachments || attachments.length === 0) {
    return null;
  }
  let t1;
  if ($[0] !== attachments) {
    t1 = attachments.map(_temp);
    $[0] = attachments;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== t1) {
    t2 = <Box flexDirection="column" marginTop={1}>{t1}</Box>;
    $[2] = t1;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  return t2;
}
function _temp(att) {
  return <Box key={att.path} flexDirection="row"><Text dimColor={true}>{figures.pointerSmall} {att.isImage ? "[image]" : "[file]"}{" "}</Text><Text>{getDisplayPath(att.path)}</Text><Text dimColor={true}> ({formatFileSize(att.size)})</Text></Box>;
}
// AttachmentList：memo 化的附件列表，每条「· [image]/[file] 路径 (大小)」。
// 原文件此处有一行 10476 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。