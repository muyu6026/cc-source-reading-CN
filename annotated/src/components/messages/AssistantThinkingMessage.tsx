// ═══════════════════════════════════════════════════════════════
//  AssistantThinkingMessage：思考块（折叠态一行、展开态整段）
// ═══════════════════════════════════════════════════════════════
//
//  模型的 thinking 内容默认是不显示的，只留一行「∴ Thinking (ctrl+o to expand)」。
//  两种情况下展开：isTranscriptMode（用户按了 Ctrl+O 看全历史）或者 verbose。
//
//  这个文件几乎是 AssistantRedactedThinkingMessage 的完整版：
//  同样的结构、同样的 addMargin 默认值写法，只是多了一条展开分支。
//  两个文件放一起看，能看出「同一族组件的公共骨架」。
import { c as _c } from "react/compiler-runtime";
import type { ThinkingBlock, ThinkingBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React from 'react';
import { Box, Text } from '../../ink.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { Markdown } from '../Markdown.js';
type Props = {
// 【param 的类型是一个三选一联合，注释还专门解释了为什么】
//
//      ThinkingBlock | ThinkingBlockParam | { type: 'thinking'; thinking: string }
//
//  第三个是「最小形状」：只有两个字段。因为组件实际只读 `thinking` 一个属性，
//  而上游有若干处能提供这个字段、却拿不到完整的 SDK 类型
//  （比如从旧会话反序列化出来的对象）。
//
//  做法上这叫**结构化类型 + 最小依赖**：需要什么就声明什么，
//  而不是要求调用方提供完整的 SDK 类型。
//
//  好处是：反序列化路径不必为了让类型通过而构造假的 signature。
//  代价是：签名变宽，读者要看注释才知道第三种形状从哪来。
  // Accept either full ThinkingBlock/ThinkingBlockParam or a minimal shape with just type and thinking
  param: ThinkingBlock | ThinkingBlockParam | {
    type: 'thinking';
    thinking: string;
  };
  addMargin: boolean;
  isTranscriptMode: boolean;
  verbose: boolean;
  /** When true, hide this thinking block entirely (used for past thinking in transcript mode) */
  hideInTranscript?: boolean;
};
export function AssistantThinkingMessage(t0) {
  const $ = _c(9);
  const {
    param: t1,
    addMargin: t2,
    isTranscriptMode,
    verbose,
    hideInTranscript: t3
  } = t0;
  const {
    thinking
  } = t1;
  const addMargin = t2 === undefined ? false : t2;
  const hideInTranscript = t3 === undefined ? false : t3;
// 【两个早退，条件不同，含义不同】
//
//      !thinking          这条消息没有内容 → 我不管（数据层面的空缺）
//      hideInTranscript   有内容，但当前视图明确要求隐藏 → 主动隐藏
//
//  第二个是 transcript 模式专用的：用户按 Ctrl+O 看全历史时，
//  **过去的** thinking 块会被藏掉，只留最新的。
//  因为完整 thinking 又长又碎，全history 里全都展开根本没法读。
//
//  两个早退都写在 useHook 之后（这里没有 hook，所以无所谓），
//  但顺序上「数据缺失」在前、「策略隐藏」在后，是更好的阅读顺序。
  if (!thinking) {
    return null;
  }
  if (hideInTranscript) {
    return null;
  }
// 【折叠态：一行，带一个「怎么展开」的提示】
//
//      ∴ Thinking  <CtrlOToExpand />
//
//  注意 `{"∴ Thinking"}` 里的 ∴ 是「所以」符号，和另一个文件里
//  「✻ Thinking…」不是一个字符 —— 两个文件在视觉上刻意做了区分：
//  redacted（被抹掉）用花，完整思考用数学符号，再加省略号表示「下面还有」。
//
//  这类细节在终端里是唯一可用的「图标语言」，因为不能画图。
  const shouldShowFullThinking = isTranscriptMode || verbose;
  if (!shouldShowFullThinking) {
    const t4 = addMargin ? 1 : 0;
    let t5;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = <Text dimColor={true} italic={true}>{"\u2234 Thinking"} <CtrlOToExpand /></Text>;
      $[0] = t5;
    } else {
      t5 = $[0];
    }
    let t6;
    if ($[1] !== t4) {
      t6 = <Box marginTop={t4}>{t5}</Box>;
      $[1] = t4;
      $[2] = t6;
    } else {
      t6 = $[2];
    }
    return t6;
  }
// 【展开态：还有一层 Box paddingLeft={2} 把正文缩进】
//
//  缩进 2 格是因为标题行有一个 ∴ 加空格（视觉宽度 2），
//  正文要对齐在标题文字下面，而不是顶到最左边。
//
//  终端里没有 margin collapse、没有 baseline，所有对齐都是**手算格数**。
//  这个目录里反复出现的 `{'  ⏿  '}`、`paddingLeft={5}`、`width={5} flexShrink={0}`
//  都是同一件事：手动对齐。
  const t4 = addMargin ? 1 : 0;
  let t5;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text dimColor={true} italic={true}>{"\u2234 Thinking"}…</Text>;
    $[3] = t5;
  } else {
    t5 = $[3];
  }
  let t6;
  if ($[4] !== thinking) {
// 【Markdown 只在展开态才渲染 —— 这是性能与正确性的双重选择】
//
//  折叠态那一行是纯文本常量，走 sentinel 永久缓存，零成本。
//  只有真的要看正文时才去 parse Markdown（贵）。
//
//  如果反过来（先 parse 再决定显示不显示），
//  每次滚动都要为所有折叠的 thinking 块跑一遍 tokenizer ——
//  这就是 UserPromptMessage 注释里说的那种「每帧都在为看不见的东西付钱」。
    t6 = <Box paddingLeft={2}><Markdown dimColor={true}>{thinking}</Markdown></Box>;
    $[4] = thinking;
    $[5] = t6;
  } else {
    t6 = $[5];
  }
  let t7;
  if ($[6] !== t4 || $[7] !== t6) {
    t7 = <Box flexDirection="column" gap={1} marginTop={t4} width="100%">{t5}{t6}</Box>;
    $[6] = t4;
    $[7] = t6;
    $[8] = t7;
  } else {
    t7 = $[8];
  }
  return t7;
}
// 原文件此处有一行 5796 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。