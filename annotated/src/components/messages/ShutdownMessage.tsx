// ═══════════════════════════════════════════════════════════════
//  ShutdownMessage：「让我退出吧」这条团队消息的三种阶段
// ═══════════════════════════════════════════════════════════════
//
//  一个 agent 想退出时，要发请求、等批复。所以有三个阶段：
//
//      request    黄色的圆角框 + "Shutdown request from X" + 原因
//      approved   （不在这里渲染，由调用方内联处理）
//      rejected   灰色圆角框 + 原因 + 一句「他还在干活」
//
//  这个文件提供了五个导出：两个渲染器、一个 try 分发、一个摘要、以及
//  藏在注释里的那条「approved 不归我管」。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { isShutdownApproved, isShutdownRejected, isShutdownRequest, type ShutdownRejectedMessage, type ShutdownRequestMessage } from '../../utils/teammateMailbox.js';
type ShutdownRequestProps = {
  request: ShutdownRequestMessage;
};

/**
 * Renders a shutdown request with a warning-colored border.
 */
// 【边框颜色承载严重性：warning / success / error / subtle】
//
//  这四种颜色在全局是固定的语义：
//
//      success   绿，事情成了
//      error     红，出错了
//      warning   黄，需要你注意但还没坏
//      subtle    灰，信息性的、不影响你
//
//  所以「请求退出」用黄（需要决策），「被拒绝」用灰（事情过去了，
//  但你要知道对方还活着）。**颜色不是装饰，是分级。**
export function ShutdownRequestDisplay(t0) {
  const $ = _c(7);
  const {
    request
  } = t0;
  let t1;
  if ($[0] !== request.from) {
    t1 = <Box marginBottom={1}><Text color="warning" bold={true}>Shutdown request from {request.from}</Text></Box>;
    $[0] = request.from;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== request.reason) {
// 【`request.reason && <Box>…</Box>` —— 原因可选，整块 Box 一起省】
//
//  注意省掉的是**整个 Box**（含它的 margin），不是只省文字。
//  如果只省文字，那段空白还在，屏幕上会多一行空行。
//
//  这个细节在折叠行里尤其重要 —— 有一条规则：**可选内容的 margin 要和内容一起省**。
    t2 = request.reason && <Box><Text>Reason: {request.reason}</Text></Box>;
    $[2] = request.reason;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] !== t1 || $[5] !== t2) {
    t3 = <Box flexDirection="column" marginY={1}><Box borderStyle="round" borderColor="warning" flexDirection="column" paddingX={1} paddingY={1}>{t1}{t2}</Box></Box>;
    $[4] = t1;
    $[5] = t2;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  return t3;
}
type ShutdownRejectedProps = {
  response: ShutdownRejectedMessage;
};

/**
 * Renders a shutdown rejected message with a subtle (grey) border.
 */
export function ShutdownRejectedDisplay(t0) {
  const $ = _c(8);
  const {
    response
  } = t0;
  let t1;
  if ($[0] !== response.from) {
    t1 = <Text color="subtle" bold={true}>Shutdown rejected by {response.from}</Text>;
    $[0] = response.from;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== response.reason) {
    t2 = <Box marginTop={1} borderStyle="dashed" borderColor="subtle" borderLeft={false} borderRight={false} paddingX={1}><Text>Reason: {response.reason}</Text></Box>;
    $[2] = response.reason;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box marginTop={1}><Text dimColor={true}>Teammate is continuing to work. You may request shutdown again later.</Text></Box>;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== t1 || $[6] !== t2) {
    t4 = <Box flexDirection="column" marginY={1}><Box borderStyle="round" borderColor="subtle" flexDirection="column" paddingX={1} paddingY={1}>{t1}{t2}{t3}</Box></Box>;
    $[5] = t1;
    $[6] = t2;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  return t4;
}

/**
 * Try to parse and render a shutdown message from raw content.
 * Returns the rendered component if it's a shutdown message, null otherwise.
 */
// 【try 函数对 approved 返回 null，但摘要函数对 approved 有文案 —— 这是故意的】
//
//  第 101-104 行：
//
//      // Shutdown approved is handled inline by the caller — skip it here
//      if (isShutdownApproved(content)) return null
//
//  为什么？因为「已批准」这件事在屏幕上应该表现成一个**状态变化**，
//  而不是一张新卡片。调用方会在原来的请求卡片上把它标成已处理。
//
//  但摘要函数（第 122 行）必须覆盖 approved，因为收件箱列表里
//  需要一行「[Shutdown Approved] X is now exiting」——
//  那里没有「原卡片」这个概念，只有一行文字。
//
//  一句话：**渲染器可以省略，摘要不能省略。**
//  两者的消费者不同，覆盖范围也就不同。这一族三个文件都遵循这条。
export function tryRenderShutdownMessage(content: string): React.ReactNode | null {
  const request = isShutdownRequest(content);
  if (request) {
    return <ShutdownRequestDisplay request={request} />;
  }

  // Shutdown approved is handled inline by the caller — skip it here
  if (isShutdownApproved(content)) {
    return null;
  }
  const rejected = isShutdownRejected(content);
  if (rejected) {
    return <ShutdownRejectedDisplay response={rejected} />;
  }
  return null;
}

/**
 * Get a brief summary text for a shutdown message.
 * Used in places like the inbox queue where we want a short description.
 * Returns null if the content is not a shutdown message.
 */
// 【摘要用方括号前缀分类，参数用空格分隔】
//
//      [Shutdown Request from alice] 内存不够了
//      [Shutdown Approved] alice is now exiting
//      [Shutdown Rejected] alice: 还有一半没跑完
//
//  第三种（拒绝）没有空格分隔原因，而是用冒号 —— 因为 reason 可能是长句，
//  用空格会变得分不清哪部分是原因。
//
//  这类「一行摘要」没有统一格式规范，是逐个手写的。
//  好处是每种消息都能挑最合适的写法；坏处是新增时没有模板可抄。
export function getShutdownMessageSummary(content: string): string | null {
  const request = isShutdownRequest(content);
  if (request) {
    return `[Shutdown Request from ${request.from}]${request.reason ? ` ${request.reason}` : ''}`;
  }
  const approved = isShutdownApproved(content);
  if (approved) {
    return `[Shutdown Approved] ${approved.from} is now exiting`;
  }
  const rejected = isShutdownRejected(content);
  if (rejected) {
// 【三个 is* 判断串行调用，每个都要把 content 重新解析一遍】
//
//  isShutdownRequest / isShutdownApproved / isShutdownRejected
//  各自去 content 里找 JSON 或匹配标签。三次解析的代价是可见的，
//  但收件箱列表通常只有几条消息，可以接受。
//
//  如果要优化，做法是「解析一次，返回带 kind 的对象」——
//  但这个文件选择了「每个判断自包含」，因为它同时服务于
//  渲染（只想问「是不是请求」）和摘要（想按顺序试三种）。
//
//  自包含的接口在任何调用顺序下都成立，这是它值钱的地方。
    return `[Shutdown Rejected] ${rejected.from}: ${rejected.reason}`;
  }
  return null;
}
// 原文件此处有一行 10596 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。