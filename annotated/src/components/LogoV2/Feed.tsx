import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import { truncate } from '../../utils/format.js';
// FeedLine：一行文本加可选时间戳。Feed 是通用的事件流面板（后台任务输出、遥测流等共用），时间戳列是否出现由数据决定。
export type FeedLine = {
  text: string;
  timestamp?: string;
};
// FeedConfig：customContent 允许调用方整体替换正文——自带宽度声明，因为 Feed 无法测量任意 ReactNode 的显示宽。
export type FeedConfig = {
  title: string;
  lines: FeedLine[];
  footer?: string;
  emptyMessage?: string;
  customContent?: {
    content: React.ReactNode;
    width: number;
  };
};
type FeedProps = {
  config: FeedConfig;
  actualWidth: number;
};
// calculateFeedWidth：导出的宽度预计算。把「这个 Feed 最宽要多少列」从渲染期提到调用方——父组件先算宽再传 actualWidth，Box 宽度一次到位，杜绝渲染后发现放不下再改版面。宽度来源按内容形态三分支：自定义内容用自己的声明宽、空态用文案宽、列表用标题与各行宽的最大值。
export function calculateFeedWidth(config: FeedConfig): number {
  const {
    title,
    lines,
    footer,
    emptyMessage,
    customContent
  } = config;
  let maxWidth = stringWidth(title);
  if (customContent !== undefined) {
    maxWidth = Math.max(maxWidth, customContent.width);
  } else if (lines.length === 0 && emptyMessage) {
    maxWidth = Math.max(maxWidth, stringWidth(emptyMessage));
  } else {
    const gap = '  ';
// 时间戳列宽一次算好所有行共用：maxTimestampWidth 取全列表最大——列对齐是按列算的，不是每行各自贴右。gap 固定两空格计入行宽。
    const maxTimestampWidth = Math.max(0, ...lines.map(line => line.timestamp ? stringWidth(line.timestamp) : 0));
    for (const line of lines) {
      const timestampWidth = maxTimestampWidth > 0 ? maxTimestampWidth : 0;
      const lineWidth = stringWidth(line.text) + (timestampWidth > 0 ? timestampWidth + gap.length : 0);
      maxWidth = Math.max(maxWidth, lineWidth);
    }
  }
// 页脚最后参与 max 比较：Feed 的总宽必须容得下最宽的任何一层。
  if (footer) {
    maxWidth = Math.max(maxWidth, stringWidth(footer));
  }
  return maxWidth;
}
// Feed 组件：_c(15) 四段缓存。actualWidth 由调用方用上面的预计算得出——计算与渲染分离成两个导出。
export function Feed(t0) {
  const $ = _c(15);
  const {
    config,
    actualWidth
  } = t0;
  const {
    title,
    lines,
    footer,
    emptyMessage,
    customContent
  } = config;
  let t1;
  if ($[0] !== lines) {
// maxTimestampWidth 依赖 lines 单值记忆化，与 calculateFeedWidth 里的同名逻辑保持一致——两处算法必须同步改，否则预计算的宽度和实际渲染对不上。
    t1 = Math.max(0, ...lines.map(_temp));
    $[0] = lines;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const maxTimestampWidth = t1;
  let t2;
  if ($[2] !== title) {
    t2 = <Text bold={true} color="claude">{title}</Text>;
    $[2] = title;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] !== actualWidth || $[5] !== customContent || $[6] !== emptyMessage || $[7] !== footer || $[8] !== lines || $[9] !== maxTimestampWidth) {
// 主体三分支：自定义内容优先（页脚仍可叠加）；无行且有 emptyMessage 显示空态；否则渲染行列表加页脚。
    t3 = customContent ? <>{customContent.content}{footer && <Text dimColor={true} italic={true}>{truncate(footer, actualWidth)}</Text>}</> : lines.length === 0 && emptyMessage ? <Text dimColor={true}>{truncate(emptyMessage, actualWidth)}</Text> : <>{lines.map((line_0, index) => {
// 每行文本宽度：实际宽减去时间戳列（列宽加两格间距），保底 10 列——极端窄终端下也不至于一个字都放不下。
        const textWidth = Math.max(10, actualWidth - (maxTimestampWidth > 0 ? maxTimestampWidth + 2 : 0));
// 时间戳用 padEnd 对齐到列宽（不足补空格），文本 truncate 截断——先对齐再截断，列永远不会因截断而错位。
        return <Text key={index}>{maxTimestampWidth > 0 && <><Text dimColor={true}>{(line_0.timestamp || "").padEnd(maxTimestampWidth)}</Text>{"  "}</>}<Text>{truncate(line_0.text, textWidth)}</Text></Text>;
      })}{footer && <Text dimColor={true} italic={true}>{truncate(footer, actualWidth)}</Text>}</>;
    $[4] = actualWidth;
    $[5] = customContent;
    $[6] = emptyMessage;
    $[7] = footer;
    $[8] = lines;
    $[9] = maxTimestampWidth;
    $[10] = t3;
  } else {
    t3 = $[10];
  }
  let t4;
  if ($[11] !== actualWidth || $[12] !== t2 || $[13] !== t3) {
    t4 = <Box flexDirection="column" width={actualWidth}>{t2}{t3}</Box>;
    $[11] = actualWidth;
    $[12] = t2;
    $[13] = t3;
    $[14] = t4;
  } else {
    t4 = $[14];
  }
  return t4;
}
function _temp(line) {
  return line.timestamp ? stringWidth(line.timestamp) : 0;
}
// 原文件此处有一行 10428 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。