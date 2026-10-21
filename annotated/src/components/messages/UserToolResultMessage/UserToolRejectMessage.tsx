// 【用户拒绝了这次工具调用 —— 但**怎么显示由工具决定**】
//
//  这个文件只做一件事：把 input 校验后交给工具的
//  renderToolUseRejectedMessage，没有就退到通用版本。
//
//  为什么要按工具区分？因为「拒绝」的语义随工具变化：
//      网页抓取被拒  → 「没有访问这个网址」
//      写文件被拒    → 「文件没被修改」
//      命令被拒      → 显示那条命令，划掉
//
//  一个通用文案做不到这些，所以这里只负责转发。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { useTheme } from '../../../ink.js';
import { filterToolProgressMessages, type Tool, type Tools } from '../../../Tool.js';
import type { ProgressMessage } from '../../../types/message.js';
import type { buildMessageLookups } from '../../../utils/messages.js';
import { FallbackToolUseRejectedMessage } from '../../FallbackToolUseRejectedMessage.js';
type Props = {
  input: {
    [key: string]: unknown;
  };
  progressMessagesForMessage: ProgressMessage[];
  style?: 'condensed';
  tool?: Tool;
  tools: Tools;
  lookups: ReturnType<typeof buildMessageLookups>;
  verbose: boolean;
  isTranscriptMode?: boolean;
};
export function UserToolRejectMessage(t0) {
  const $ = _c(13);
  const {
    input,
    progressMessagesForMessage,
    style,
    tool,
    tools,
    verbose,
    isTranscriptMode
  } = t0;
  const {
    columns
  } = useTerminalSize();
  const [theme] = useTheme();
// 【工具不支持就退到 FallbackToolUseRejectedMessage】
//
//  这个 fallback 在 Tool.ts 之外单独定义（components/FallbackToolUseRejectedMessage.tsx），
//  说明「通用拒绝提示」被多处复用。
//
//  注意它是从**模块级**导入的，不是懒加载 —— 因为它足够小、且大概率会用上。
//  对比同目录那些 feature 门控的 require，区别在于「这个分支会不会被删」。
  if (!tool || !tool.renderToolUseRejectedMessage) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <FallbackToolUseRejectedMessage />;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    return t1;
  }
  const t1 = tool.inputSchema;
  let t2;
  let t3;
// 【参数解析失败 → 也退到 fallback，而不是不画】
//
//  这和 UserToolSuccessMessage 的选择不同：那边校验失败是 return null
//  （整条不显示）。为什么这里要画 fallback？
//
//  因为「被拒绝」这件事本身是用户做的动作，**必须给反馈**。
//  用户点了 No，屏幕上什么都没有，他会怀疑自己点没点上。
//
//  而「成功但结果不可解析」不需要反馈 —— 事情已经做完了，
//  没东西显示只是少了个记录。
//
//  这条区别可以推广：**用户主动操作必须有反馈，系统自动结果可以沉默。**
  if ($[1] !== columns || $[2] !== input || $[3] !== isTranscriptMode || $[4] !== progressMessagesForMessage || $[5] !== style || $[6] !== theme || $[7] !== tool || $[8] !== tools || $[9] !== verbose) {
    t3 = Symbol.for("react.early_return_sentinel");
    bb0: {
// 【`messages: []` 是写死的空数组】
//
//  传给工具的上下文里有一个 messages 字段，这里恒为空。
//
//  说明工具在渲染「被拒绝」时拿不到对话历史 —— 只能拿到本次调用的参数。
//  这是一个**刻意的接口限制**：拒绝提示只该描述「这次调用」，
//  不该根据历史上下文做变化（否则同一条拒绝在不同位置会长得不一样）。
//
//  读这种「传空数组」的地方，先判断是「还没来得及实现」还是「故意不给」。
//  这里注释没写，但从参数名和用途推断，更像是后者。
      const parsedInput = t1.safeParse(input);
      if (!parsedInput.success) {
        let t4;
        if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
          t4 = <FallbackToolUseRejectedMessage />;
          $[12] = t4;
        } else {
          t4 = $[12];
        }
        t3 = t4;
        break bb0;
      }
// 【`?? <FallbackToolUseRejectedMessage />` —— 工具返回 null 也算「没实现」】
//
//  所以工具可以返回 null 来主动放弃（比如在某种参数下不想画）。
//  这和「没实现这个方法」在效果上一样，但意图不同：
//      没实现   能力缺失
//      返回 null 这个场景下不适合画
//
//  用 `??` 把两者合并，是这类扩展点的常规做法 ——
//  调用方不关心原因，只关心「有没有画出东西」。
      t2 = tool.renderToolUseRejectedMessage(parsedInput.data, {
        columns,
        messages: [],
        tools,
        verbose,
        progressMessagesForMessage: filterToolProgressMessages(progressMessagesForMessage),
        style,
        theme,
        isTranscriptMode
      }) ?? <FallbackToolUseRejectedMessage />;
    }
    $[1] = columns;
    $[2] = input;
    $[3] = isTranscriptMode;
    $[4] = progressMessagesForMessage;
    $[5] = style;
    $[6] = theme;
    $[7] = tool;
    $[8] = tools;
    $[9] = verbose;
    $[10] = t2;
    $[11] = t3;
  } else {
    t2 = $[10];
    t3 = $[11];
  }
  if (t3 !== Symbol.for("react.early_return_sentinel")) {
    return t3;
  }
  return t2;
}
// 原文件此处有一行 5932 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。