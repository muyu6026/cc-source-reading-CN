// 【后台任务结束时的通知：一个圆点 + 一句话】
//
//  它是 <task-notification> 标签的渲染器（UserTextMessage 第 166 行分发过来）。
//  状态通过颜色表达：completed 绿、failed 红、killed 黄、其他灰。
//
//  这里值得看的是第 46 行：**status 的提取没有进缓存，
//  而它的结果（color）进了缓存**。这个小差异说明了一件事（见下）。
import { c as _c } from "react/compiler-runtime";
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, Text, type TextProps } from '../../ink.js';
import { extractTag } from '../../utils/messages.js';
type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};
// 【颜色映射用 switch + default，而不是一张表】
//
//  default 返回 'text'（正常前景色）而不是抛错：
//  上游新增一个状态时（比如 'timeout'），界面上会显示成普通颜色的一句话，
//  而不是崩溃或者空白。
//
//  这与本仓库里另一类选择形成对照：Message.tsx 的两次 switch 里，
//  外层靠 TypeScript 穷尽**不留 default**，内层留了 default + logError。
//  判断依据是「这个值是代码里枚举的，还是从外部数据里读出来的」：
//    · 代码里枚举的 → 不留 default，让编译期把关
//    · 外部数据来的 → 留 default，让运行期兜底
//  status 是从 XML 文本里抠出来的，属于后者。
function getStatusColor(status: string | null): TextProps['color'] {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    case 'killed':
      return 'warning';
    default:
      return 'text';
  }
}
export function UserAgentNotificationMessage(t0) {
  const $ = _c(12);
  const {
    addMargin,
    param: t1
  } = t0;
  const {
    text
  } = t1;
  let t2;
  if ($[0] !== text) {
    t2 = extractTag(text, "summary");
    $[0] = text;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const summary = t2;
  if (!summary) {
    return null;
  }
  let t3;
  if ($[2] !== text) {
// 【extractTag 被包进缓存，但 getStatusColor 在外面 —— 这是产物里常见的断层】
//
//      if ($[2] !== text) {  const status = extractTag(text, 'status')
//                            t3 = getStatusColor(status)          }
//
//  整段都被 `$[2] !== text` 包住了，所以 status 其实也是被缓存的，
//  只是它的中间变量在 if 块内部声明，没有单独占槽。
//
//  读产物时别被「只在 if 里声明」误导成「每次渲染都会算」——
//  槽是给**跨渲染保留的值**用的，块内的局部变量天然每次重算，
//  但如果整个块被 `$[n] !== x` 包住，那这个块根本不会执行。
//
//  一句话：**缓存的作用域是「块」，不是「变量」。**
    const status = extractTag(text, "status");
    t3 = getStatusColor(status);
    $[2] = text;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const color = t3;
  const t4 = addMargin ? 1 : 0;
  let t5;
  if ($[4] !== color) {
// 【BLACK_CIRCLE 单独一个 Text，只为了单独上色】
//
//  和 UserMemoryInputMessage 那个 `#` 一样，这是终端 UI 的固定手法：
//  样式跟着 Text 节点走，所以「一个句子里有一处要变色」必然拆节点。
//
//  也正因为拆了，颜色变化时只会重算这个小节点（$[4] 只依赖 color），
//  而不是整行重排 —— 顺手拿到了更细的缓存粒度。
    t5 = <Text color={color}>{BLACK_CIRCLE}</Text>;
    $[4] = color;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  let t6;
  if ($[6] !== summary || $[7] !== t5) {
    t6 = <Text>{t5} {summary}</Text>;
    $[6] = summary;
    $[7] = t5;
    $[8] = t6;
  } else {
    t6 = $[8];
  }
  let t7;
  if ($[9] !== t4 || $[10] !== t6) {
    t7 = <Box marginTop={t4}>{t6}</Box>;
    $[9] = t4;
    $[10] = t6;
    $[11] = t7;
  } else {
    t7 = $[11];
  }
  return t7;
}
// 原文件此处有一行 4428 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。