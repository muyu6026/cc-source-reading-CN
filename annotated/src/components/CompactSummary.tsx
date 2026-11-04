import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { BLACK_CIRCLE } from '../constants/figures.js';
import { Box, Text } from '../ink.js';
import type { Screen } from '../screens/REPL.js';
import type { NormalizedUserMessage } from '../types/message.js';
import { getUserMessageText } from '../utils/messages.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { MessageResponse } from './MessageResponse.js';
// Props：message 是承载摘要的用户消息（summarizeMetadata 挂在其上），screen 决定渲染形态——transcript 表示用户按 ctrl+o 展开的完整历史视图。
type Props = {
  message: NormalizedUserMessage;
  screen: Screen;
};
// CompactSummary：上下文压缩后的占位消息。压缩有两种——旧式整体压缩（无 metadata）与带方向的从某处开始压缩（有 metadata），渲染分支按 metadata 有无二分。
export function CompactSummary(t0) {
  const $ = _c(24);
  const {
    message,
    screen
  } = t0;
// isTranscriptMode 决定信息详略：聊天流里只显示标题行加展开提示，完整原文只在 transcript 视图显示——聊天流要省行数，历史视图要可回读。
  const isTranscriptMode = screen === "transcript";
  let t1;
  if ($[0] !== message) {
// getUserMessageText 取消息文本，空则回退空串。textContent 依赖 message 单值缓存，transcript 切换时复用。
    t1 = getUserMessageText(message) || "";
    $[0] = message;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const textContent = t1;
// metadata 分支：summarizeMetadata 存在说明这是带上下文的局部压缩（Summarize from here 功能），比旧式压缩多显示消息数、方向与用户上下文。
  const metadata = message.summarizeMetadata;
  if (metadata) {
    let t2;
    if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
// 黑圆点图标：minWidth 为 2 给缩进对齐留位，与普通用户消息的箭头图标同宽度——两种消息在左边线上对齐。
      t2 = <Box minWidth={2}><Text color="text">{BLACK_CIRCLE}</Text></Box>;
      $[2] = t2;
    } else {
      t2 = $[2];
    }
    let t3;
    if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = <Text bold={true}>Summarized conversation</Text>;
      $[3] = t3;
    } else {
      t3 = $[3];
    }
    let t4;
    if ($[4] !== isTranscriptMode || $[5] !== metadata) {
// 摘要说明段：共压缩了多少条消息；direction 为 up_to 时表示压到此点为止，否则表示从此点开始；userContext 是用户压缩时附注的上下文，用弯引号包裹显示；末尾附 ctrl+o 展开提示。这一段两依赖（isTranscriptMode、metadata）整体缓存。
      t4 = !isTranscriptMode && <MessageResponse><Box flexDirection="column"><Text dimColor={true}>Summarized {metadata.messagesSummarized} messages{" "}{metadata.direction === "up_to" ? "up to this point" : "from this point"}</Text>{metadata.userContext && <Text dimColor={true}>Context: {"\u201C"}{metadata.userContext}{"\u201D"}</Text>}<Text dimColor={true}><ConfigurableShortcutHint action="app:toggleTranscript" context="Global" fallback="ctrl+o" description="expand history" parens={true} /></Text></Box></MessageResponse>;
      $[4] = isTranscriptMode;
      $[5] = metadata;
      $[6] = t4;
    } else {
      t4 = $[6];
    }
    let t5;
    if ($[7] !== isTranscriptMode || $[8] !== textContent) {
// transcript 视图下渲染完整原文——原文存在消息本体里，聊天流不显示它。与第 48 行互斥：同一时刻只会渲染一个。
      t5 = isTranscriptMode && <MessageResponse><Text>{textContent}</Text></MessageResponse>;
      $[7] = isTranscriptMode;
      $[8] = textContent;
      $[9] = t5;
    } else {
      t5 = $[9];
    }
    let t6;
    if ($[10] !== t4 || $[11] !== t5) {
      t6 = <Box flexDirection="column" marginTop={1}><Box flexDirection="row">{t2}<Box flexDirection="column">{t3}{t4}{t5}</Box></Box></Box>;
      $[10] = t4;
      $[11] = t5;
      $[12] = t6;
    } else {
      t6 = $[12];
    }
    return t6;
  }
  let t2;
// 无 metadata 的旧式分支：结构与上面平行但更简单。注意编译器没有复用上面的黑圆点槽——第 34 与 77 行是两个独立常量槽，相同的 JSX 在两分支里各存一份，因为两分支不同时渲染，复用反而引入跨分支依赖。
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box minWidth={2}><Text color="text">{BLACK_CIRCLE}</Text></Box>;
    $[13] = t2;
  } else {
    t2 = $[13];
  }
  let t3;
  if ($[14] !== isTranscriptMode) {
// 旧式标题行的展开提示：依赖 isTranscriptMode 单值缓存。标题是 Compact summary 加粗。
    t3 = !isTranscriptMode && <Text dimColor={true}>{" "}<ConfigurableShortcutHint action="app:toggleTranscript" context="Global" fallback="ctrl+o" description="expand" parens={true} /></Text>;
    $[14] = isTranscriptMode;
    $[15] = t3;
  } else {
    t3 = $[15];
  }
  let t4;
  if ($[16] !== t3) {
    t4 = <Box flexDirection="row">{t2}<Box flexDirection="column"><Text bold={true}>Compact summary{t3}</Text></Box></Box>;
    $[16] = t3;
    $[17] = t4;
  } else {
    t4 = $[17];
  }
  let t5;
  if ($[18] !== isTranscriptMode || $[19] !== textContent) {
// transcript 模式渲染原文，与第 57 行同构——两个分支的 transcript 段也是各自独立的槽。整个组件没有跨分支共享的缓存，读时按分支各看各的。
    t5 = isTranscriptMode && <MessageResponse><Text>{textContent}</Text></MessageResponse>;
    $[18] = isTranscriptMode;
    $[19] = textContent;
    $[20] = t5;
  } else {
    t5 = $[20];
  }
  let t6;
  if ($[21] !== t4 || $[22] !== t5) {
    t6 = <Box flexDirection="column" marginTop={1}>{t4}{t5}</Box>;
    $[21] = t4;
    $[22] = t5;
    $[23] = t6;
  } else {
    t6 = $[23];
  }
  return t6;
}
// 原文件此处有一行 10620 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。