// ═══════════════════════════════════════════════════════════════
//  HighlightedThinkingText：用户那句话，可能要逐字上彩虹色
// ═══════════════════════════════════════════════════════════════
//
//  名字里的 Thinking 指的是「触发思考的输入」—— 也就是用户敲的那句话。
//  平时它只是一行普通文字，前缀一个 ❯。
//
//  但如果句子里出现了 ultrathink / ultraplan 这类触发词，
//  那几个词会被**逐字符**染成彩虹色（getRainbowColor 按偏移取色）。
//
//  这个文件是本批讲「early return 编译成什么样」的样板：
//  第 82-142 行那一大段 bb0 + sentinel 结构，是原始代码里一个
//  「要么返回简单版本、要么继续算彩虹片段」的 if。
//
//  这一批之后，再看到这种结构就直接翻这一页。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { useContext } from 'react';
import { useQueuedMessage } from '../../context/QueuedMessageContext.js';
import { Box, Text } from '../../ink.js';
import { formatBriefTimestamp } from '../../utils/formatBriefTimestamp.js';
import { findThinkingTriggerPositions, getRainbowColor, isUltrathinkEnabled } from '../../utils/thinking.js';
import { MessageActionsSelectedContext } from '../messageActions.js';
type Props = {
  text: string;
  useBriefLayout?: boolean;
  timestamp?: string;
};
export function HighlightedThinkingText(t0) {
  const $ = _c(31);
  const {
    text,
    useBriefLayout,
    timestamp
  } = t0;
// 【两个外来的「当前状态」：排队中、被选中】
//
//      useQueuedMessage()?.isQueued     这条消息还在排队没发出去
//      useSelectedMessageBg / useContext(MessageActionsSelectedContext)
//
//  两者都只影响**颜色**：排队中整体变灰（subtle），被选中时指针变高亮色。
//
//  注意 useQueuedMessage 用了 `?.` 加 `?? false`：
//  这个 context 在消息列表之外可能不存在（比如单独渲染一条消息做预览时），
//  所以缺席要兜成 false。
  const isQueued = useQueuedMessage()?.isQueued ?? false;
  const isSelected = useContext(MessageActionsSelectedContext);
  const pointerColor = isSelected ? "suggestion" : "subtle";
// 【brief 布局在**所有逻辑之前**就 return 了】
//
//  brief 模式（聊天样式）和默认模式（终端样式）的两套 UI 几乎没有共同点：
//
//      brief    `You  10:23` 一行标签 + 缩进 2 的正文
//      默认     ❯ 前缀 + 正文，触发词上彩虹
//
//  所以这里不是「同一套 UI 加条件」，是**两个组件被写在一个函数里**。
//
//  为什么不分文件？因为它们共享 props 和上游调用点，
//  分出去要在 UserPromptMessage 里再加一层判断。
//  这是「按变化频率分文件」和「按调用点分文件」的取舍，这里选了后者。
//
//  代价是：读这个文件必须先把两个分支分开看，别试图找它们的共性。
  if (useBriefLayout) {
    let t1;
    if ($[0] !== timestamp) {
      t1 = timestamp ? formatBriefTimestamp(timestamp) : "";
      $[0] = timestamp;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    const ts = t1;
    const t2 = isQueued ? "subtle" : "briefLabelYou";
    let t3;
    if ($[2] !== t2) {
      t3 = <Text color={t2}>You</Text>;
      $[2] = t2;
      $[3] = t3;
    } else {
      t3 = $[3];
    }
    let t4;
    if ($[4] !== ts) {
      t4 = ts ? <Text dimColor={true}> {ts}</Text> : null;
      $[4] = ts;
      $[5] = t4;
    } else {
      t4 = $[5];
    }
    let t5;
    if ($[6] !== t3 || $[7] !== t4) {
      t5 = <Box flexDirection="row">{t3}{t4}</Box>;
      $[6] = t3;
      $[7] = t4;
      $[8] = t5;
    } else {
      t5 = $[8];
    }
    const t6 = isQueued ? "subtle" : "text";
    let t7;
    if ($[9] !== t6 || $[10] !== text) {
      t7 = <Text color={t6}>{text}</Text>;
      $[9] = t6;
      $[10] = text;
      $[11] = t7;
    } else {
      t7 = $[11];
    }
    let t8;
    if ($[12] !== t5 || $[13] !== t7) {
      t8 = <Box flexDirection="column" paddingLeft={2}>{t5}{t7}</Box>;
      $[12] = t5;
      $[13] = t7;
      $[14] = t8;
    } else {
      t8 = $[14];
    }
    return t8;
  }
  let parts;
  let t1;
// ═══ 【这里是本批最重要的一段：early return 的编译形态】 ═══
//
//  原始代码大致是：
//
//      const triggers = isUltrathinkEnabled() ? findThinkingTriggerPositions(text) : []
//      if (triggers.length === 0) {
//        return <Text><Text color={pointerColor}>❯ </Text><Text>{text}</Text></Text>
//      }
//      const parts = []
//      for (const t of triggers) { ... }
//      return <Text><Text color={pointerColor}>❯ </Text>{parts}</Text>
//
//  Compiler 要做两件事，都不能直接改原代码：
//    · 第一次 return 的 JSX 要缓存（triggers.length === 0 时反复返回同一个）
//    · 第二次 return 的 parts 也要缓存（彩虹切片是纯计算但很碎）
//
//  于是它把「提前返回」改写成「往一个哨兵变量里写结果」：
//
//      let t1
//      if ($[15] !== pointerColor || $[16] !== text) {
//        t1 = Symbol.for("react.early_return_sentinel")     ← 先立哨兵
//        bb0: {                                             ← 带标签的块
//          ...
//          t1 = t4                                           ← 写「提前返回」的值
//          break bb0                                         ← 跳出块 = 原来的 return
//        }
//        ...
//      }
//      if (t1 !== sentinel) return t1                        ← 真的提前返回了？
//
//  关键在最后一行：**sentinel 不是布尔，是一个「没写进去」的标记。**
//  如果块里没写 t1，它还是哨兵，说明走了「继续往下」的路径。
//
//  为什么需要这么绕？因为在一个 if 块里 return，会让「块外那些缓存槽的赋值」
//  被跳过 —— 下次渲染时槽是脏的。用哨兵 + 跳出块，
//  **既完成了提前返回的语义，又保证槽一定被写完。**
//
//  读懂这套之后，本批剩下的文件（UserChannelMessage / RateLimitMessage /
//  UserLocalCommandOutputMessage / CollapsedReadSearchContent / UserToolRejectMessage）
//  全都是同一个模式，可以直接跳读。
  if ($[15] !== pointerColor || $[16] !== text) {
    t1 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const triggers = isUltrathinkEnabled() ? findThinkingTriggerPositions(text) : [];
      if (triggers.length === 0) {
        let t2;
        if ($[19] !== pointerColor) {
          t2 = <Text color={pointerColor}>{figures.pointer} </Text>;
          $[19] = pointerColor;
          $[20] = t2;
        } else {
          t2 = $[20];
        }
        let t3;
        if ($[21] !== text) {
          t3 = <Text color="text">{text}</Text>;
          $[21] = text;
          $[22] = t3;
        } else {
          t3 = $[22];
        }
        let t4;
        if ($[23] !== t2 || $[24] !== t3) {
          t4 = <Text>{t2}{t3}</Text>;
          $[23] = t2;
          $[24] = t3;
          $[25] = t4;
        } else {
          t4 = $[25];
        }
        t1 = t4;
        break bb0;
      }
      parts = [];
// 【彩虹是按字符切的：`for (let i = t.start; i < t.end; i++)`】
//
//  每染一个字符推一个 Text 节点，key 是 `rb-${i}`（字符的绝对下标）。
//
//  这意味着一个 8 个字母的触发词会产生 8 个 Text 节点。
//  为什么不用一个 Text 套多段 SGR？因为 Ink 的 Text 只支持一个 color prop，
//  逐字符变色必须在节点层面拆开 —— 和前面「样式跟着节点走」是同一条约束。
//
//  代价很实在：ultrathink 这 10 个字符 → 10 个节点 → 10 次布局测量。
//  所以这段代码**只在 isUltrathinkEnabled() 为真且真的有触发词时**才跑，
//  而且结果被整体缓存（$[17] = parts）。
//
//  key 用字符下标而不是位置序号，是因为同一段文字里可能有多个触发词，
//  用序号会让不同触发词的 key 冲突。
      let cursor = 0;
      for (const t of triggers) {
        if (t.start > cursor) {
          parts.push(<Text key={`plain-${cursor}`} color="text">{text.slice(cursor, t.start)}</Text>);
        }
        for (let i = t.start; i < t.end; i++) {
          parts.push(<Text key={`rb-${i}`} color={getRainbowColor(i - t.start)}>{text[i]}</Text>);
        }
        cursor = t.end;
      }
      if (cursor < text.length) {
        parts.push(<Text key={`plain-${cursor}`} color="text">{text.slice(cursor)}</Text>);
      }
    }
    $[15] = pointerColor;
    $[16] = text;
    $[17] = parts;
    $[18] = t1;
  } else {
    parts = $[17];
    t1 = $[18];
  }
// 【`if (t1 !== sentinel) return t1` —— 提前返回在这里兑现】
//
//  这一行的位置很关键：它必须在缓存块**之后**。
//  因为缓存块里可能写了 t1（提前返回），也可能没写（继续往下）。
//
//  如果这一行放在缓存块之前，那么第一次渲染时 t1 是 undefined，
//  会立刻 return undefined —— 组件白屏。
//
//  顺带说明：`Symbol.for(...)` 每次调用都返回**同一个符号**（全局注册表），
//  所以这里能用相等比较判断。如果用的是 `Symbol(...)`，每次都是新值，
//  这个判据就永远成立或不成立，全盘失效。
//
//  这是 Symbol.for 与 Symbol 最实用的一处区别。
  if (t1 !== Symbol.for("react.early_return_sentinel")) {
    return t1;
  }
  let t2;
  if ($[26] !== pointerColor) {
    t2 = <Text color={pointerColor}>{figures.pointer} </Text>;
    $[26] = pointerColor;
    $[27] = t2;
  } else {
    t2 = $[27];
  }
  let t3;
  if ($[28] !== parts || $[29] !== t2) {
    t3 = <Text>{t2}{parts}</Text>;
    $[28] = parts;
    $[29] = t2;
    $[30] = t3;
  } else {
    t3 = $[30];
  }
  return t3;
}
// 原文件此处有一行 10696 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。