// ═══════════════════════════════════════════════════════════════
//  UserMemoryInputMessage：用户用 `#` 开头写的一条「记住这个」
// ═══════════════════════════════════════════════════════════════
//
//  PromptInput 里以 # 开头的内容会被包装成 <user-memory-input>，
//  然后走到这个渲染器。屏幕上它是一行带底色的 `# 内容`，
//  下面跟一句很短的应答（Got it. / Good to know. / Noted.）。
//
//  这一批里它是**唯一一个把随机数写进渲染结果**的文件，
//  所以也是理解 React Compiler 缓存行为的最好样本（见第 31 行）。
import { c as _c } from "react/compiler-runtime";
import sample from 'lodash-es/sample.js';
import * as React from 'react';
import { useMemo } from 'react';
import { Box, Text } from '../../ink.js';
import { extractTag } from '../../utils/messages.js';
import { MessageResponse } from '../MessageResponse.js';
// 【三个固定选项里随机抽一个 —— 模拟「人随口应一声」】
//
//  用 lodash 的 sample 而不是 Math.random 拼数组，
//  是因为 sample 已经是 tree-shakable 的单函数模块（lodash-es/sample.js），
//  打包时只带这一个函数。
//
//  文案为什么不能太长？因为它在每一轮「记住」后面都出现一次。
//  如果写成「好的，我已经把这条信息保存到长期记忆里了」，
//  用户连说三条就会被这三行废话淹没。**高频出现的文案要短到可以忽略。**
function getSavingMessage(): string {
  return sample(['Got it.', 'Good to know.', 'Noted.']);
}
type Props = {
  addMargin: boolean;
  text: string;
};
export function UserMemoryInputMessage(t0) {
  const $ = _c(10);
  const {
    text,
    addMargin
  } = t0;
  let t1;
  if ($[0] !== text) {
    t1 = extractTag(text, "user-memory-input");
    $[0] = text;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const input = t1;
  let t2;
// 【`useMemo(() => getSavingMessage(), [])` 被编译成了 sentinel ——
//    也就是说：这一句应答在组件整个生命周期里只抽一次】
//
//  这就是「随机数进了缓存」的一个良性版本：
//  用户看到的是「Got it.」，之后每次重渲染（窗口 resize、滚动、
//  父组件状态变化）都还是「Got it.」。
//
//  这恰好是我们想要的：如果每帧重抽，这一行会在 Got it. / Noted. /
//  Good to know. 之间乱跳 —— 屏幕上看就是闪烁。
//
//  对比上一批 Message.tsx 的 `isStreamingThinkingVisible`：
//  那里把 `Date.now()` 塞进 useMemo，结果 30 秒的窗口永不过期，那是**坏的**；
//  这里把随机值塞进 useMemo，结果是稳定，那是**好的**。
//  同一句话（「useMemo 里不要放有副作用的求值」）在两个方向上都有例证。
//
//  判断标准不是「用了 useMemo 对不对」，而是：
//  **这个值变化时，用户该不该看见变化。**
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = getSavingMessage();
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const savingText = t2;
// 【input 为空就返回 null —— 连那句「Got it.」也不显示】
//
//  顺序很重要：savingText 已经抽好了（第 31 行，在早退之前），
//  但真正用它的 JSX 在早退之后。这保证 hook 顺序稳定
//  （useMemo 不会被条件跳过），同时避免「内容为空却出现应答」的怪画面。
//
//  产物里这类「hook 在前、早退在中、JSX 在后」的排列，
//  就是源码里注释写的 `Truncate before the early return so the hook order is stable`
//  那条规则的机械化结果。
  if (!input) {
    return null;
  }
  const t3 = addMargin ? 1 : 0;
  let t4;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
// 【`#` 符号用 remember 色 + memory 背景，内容用 text 色 + 同一背景】
//
//  两个 Text 共用同一个 backgroundColor，视觉上拼成一个连续的色块。
//  Ink 里每个 Text 独立计算背景，所以**相邻节点必须各自声明背景色**，
//  不像 CSS 那样可以从父元素继承。
//
//  这就是为什么这段 JSX 看起来在重复写 backgroundColor ——
//  在终端 UI 里没有「继承」这回事。
    t4 = <Text color="remember" backgroundColor="memoryBackgroundColor">#</Text>;
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  let t5;
  if ($[4] !== input) {
    t5 = <Box>{t4}<Text backgroundColor="memoryBackgroundColor" color="text">{" "}{input}{" "}</Text></Box>;
    $[4] = input;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  let t6;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
// 【`<MessageResponse height={1}>` 的 height 是「至少占一行」】
//
//  MessageResponse 画的是消息左侧那条竖线 + 缩进。
//  height={1} 保证即使里面是空字符串，那一条线也照样画出来 ——
//  否则应答很短时，竖线会缩成 0 高度，视觉上断开。
//
//  读这个目录会反复看到 height={1}，凡是「一行短提示」都带它。
    t6 = <MessageResponse height={1}><Text dimColor={true}>{savingText}</Text></MessageResponse>;
    $[6] = t6;
  } else {
    t6 = $[6];
  }
  let t7;
  if ($[7] !== t3 || $[8] !== t5) {
    t7 = <Box flexDirection="column" marginTop={t3} width="100%">{t5}{t6}</Box>;
    $[7] = t3;
    $[8] = t5;
    $[9] = t7;
  } else {
    t7 = $[9];
  }
  return t7;
}
// 原文件此处有一行 4716 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。