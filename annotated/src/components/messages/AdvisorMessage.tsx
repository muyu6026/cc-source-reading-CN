// 【Advisor：模型在回答前先请一个「顾问」复核这段对话】
//
//  这是两种很不一样的块：
//      server_tool_use      顾问正在被调用（有个转圈）
//      advisor_result       顾问回话了（一行确认，或 verbose 下展开全文）
//      advisor_redacted     回话内容不可见（只留一行「已复核」）
//
//  顺带解决一个常见误解：**Compiler 的缓存跟「有没有 hook」无关。**
//  这个组件一个 hook 都没有（状态全来自 props），照样生成了 30 个槽。
//
//  反例是同目录的 GroupedToolUseContent：它也没有 hook，但**没有 _c**。
//  区别在于它最后一行是 `return tool.renderGroupedToolUse(...)` ——
//  整个函数里没有一句 JSX 字面量，Compiler 没有可缓存的东西。
//
//  但这条规律**不完整**：UserToolSuccessMessage 有 JSX、也没有 _c。
//  所以只能说「没有 JSX 一定没有 _c」，反方向不成立。
//  剩下的差异（Compiler 版本？这个文件走了不同的编译路径？）
//  从产物里看不出来 —— 这种情况就记成「已知现象」，不要硬编规律。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React from 'react';
import { Box, Text } from '../../ink.js';
import type { AdvisorBlock } from '../../utils/advisor.js';
import { renderModelName } from '../../utils/model/model.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { MessageResponse } from '../MessageResponse.js';
import { ToolUseLoader } from '../ToolUseLoader.js';
type Props = {
  block: AdvisorBlock;
  addMargin: boolean;
  resolvedToolUseIDs: Set<string>;
  erroredToolUseIDs: Set<string>;
  shouldAnimate: boolean;
  verbose: boolean;
  advisorModel?: string;
};
export function AdvisorMessage(t0) {
  const $ = _c(30);
  const {
    block,
    addMargin,
    resolvedToolUseIDs,
    erroredToolUseIDs,
    shouldAnimate,
    verbose,
    advisorModel
  } = t0;
// 【第一分支是 server_tool_use，剩下的走 switch】
//
//  为什么不全用 switch？因为 block 的类型是一个可辨识联合，
//  但 `server_tool_use` 需要读 block.id / block.input，
//  而其它分支读 block.content.*。
//
//  写成 if + switch 的混合形态，是为了让 TypeScript 在每个分支里
//  自动收窄到正确的成员 —— 一旦写进同一个 switch，就得到同一个层级，
//  拿不到 content 上的字段。
//
//  这类「按数据形状分层」的判断，比「按类型名字平铺」更容易被编译器理解。
  if (block.type === "server_tool_use") {
    let t1;
    if ($[0] !== block.input) {
// 【`Object.keys(input).length > 0` 才显示参数】
//
//  顾问调用经常没有参数（纯「看看这段对话」），
//  这时候冒号后面跟一个 `{}` 只是噪音。
//
//  用 jsonStringify 而不是 JSON.stringify：这个仓库把「可能很慢的序列化」
//  统一收进 utils/slowOperations，调用点显式暴露成本。
//  读代码时看到 slowOperations，就知道这里可能有性能代价。
      t1 = block.input && Object.keys(block.input).length > 0 ? jsonStringify(block.input) : null;
      $[0] = block.input;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    const input = t1;
    const t2 = addMargin ? 1 : 0;
    let t3;
    if ($[2] !== block.id || $[3] !== resolvedToolUseIDs) {
      t3 = resolvedToolUseIDs.has(block.id);
      $[2] = block.id;
      $[3] = resolvedToolUseIDs;
      $[4] = t3;
    } else {
      t3 = $[4];
    }
    const t4 = !t3;
    let t5;
    if ($[5] !== block.id || $[6] !== erroredToolUseIDs) {
      t5 = erroredToolUseIDs.has(block.id);
      $[5] = block.id;
      $[6] = erroredToolUseIDs;
      $[7] = t5;
    } else {
      t5 = $[7];
    }
    let t6;
    if ($[8] !== shouldAnimate || $[9] !== t4 || $[10] !== t5) {
      t6 = <ToolUseLoader shouldAnimate={shouldAnimate} isUnresolved={t4} isError={t5} />;
      $[8] = shouldAnimate;
      $[9] = t4;
      $[10] = t5;
      $[11] = t6;
    } else {
      t6 = $[11];
    }
    let t7;
    if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
      t7 = <Text bold={true}>Advising</Text>;
      $[12] = t7;
    } else {
      t7 = $[12];
    }
    let t8;
    if ($[13] !== advisorModel) {
      t8 = advisorModel ? <Text dimColor={true}> using {renderModelName(advisorModel)}</Text> : null;
      $[13] = advisorModel;
      $[14] = t8;
    } else {
      t8 = $[14];
    }
    let t9;
    if ($[15] !== input) {
      t9 = input ? <Text dimColor={true}> · {input}</Text> : null;
      $[15] = input;
      $[16] = t9;
    } else {
      t9 = $[16];
    }
    let t10;
    if ($[17] !== t2 || $[18] !== t6 || $[19] !== t8 || $[20] !== t9) {
      t10 = <Box marginTop={t2} paddingRight={2} flexDirection="row">{t6}{t7}{t8}{t9}</Box>;
      $[17] = t2;
      $[18] = t6;
      $[19] = t8;
      $[20] = t9;
      $[21] = t10;
    } else {
      t10 = $[21];
    }
    return t10;
  }
  let body;
// 【`let body; bb0: switch (...)` —— switch 也被包进带标签的块】
//
//  因为三个 case 里有两个用到了提前计算的值（t1），
//  而 Compiler 要把「body 的最终值」提升到 switch 外面存进缓存。
//  带标签的块让它可以在每个 case 里直接 break bb0。
//
//  注意最后一个 case（advisor_redacted_result）**没有 break**，
//  因为它就是最后一个分支，落下去也出不了块。
//  这类细节在产物里到处都是，不构成 bug，但会让 diff 显得凌乱。
//
//  另一个细节：**没有 default**。这是故意的 ——
//  可辨识联合被穷尽后，编译器会要求所有成员都被处理；
//  如果哪天 SDK 加了新类型，这里会 typecheck 失败，而不是静默不渲染。
//  这正是 Message.tsx 外层 switch 的做法（见上一批）。
  bb0: switch (block.content.type) {
    case "advisor_tool_result_error":
      {
        let t1;
        if ($[22] !== block.content.error_code) {
          t1 = <Text color="error">Advisor unavailable ({block.content.error_code})</Text>;
          $[22] = block.content.error_code;
          $[23] = t1;
        } else {
          t1 = $[23];
        }
        body = t1;
        break bb0;
      }
    case "advisor_result":
      {
        let t1;
        if ($[24] !== block.content.text || $[25] !== verbose) {
// 【verbose 决定「给你看全文」还是「告诉你已经复核过了」】
//
//  非 verbose 是：`✓ Advisor has reviewed the conversation and will apply the feedback  ctrl+o`
//  verbose 是：整段顾问意见（dim 色）
//
//  这个模式在本目录反复出现（thinking 块、hook 进度、错误详情）：
//  **默认只给一句「发生了什么」，细节留在 verbose / Ctrl+O 后面。**
//
//  理由很实际：终端屏幕一次只显示四五十行，
//  一个顾问意见可能就占掉全部。默认展开等于把对话挤没了。
          t1 = verbose ? <Text dimColor={true}>{block.content.text}</Text> : <Text dimColor={true}>{figures.tick} Advisor has reviewed the conversation and will apply the feedback <CtrlOToExpand /></Text>;
          $[24] = block.content.text;
          $[25] = verbose;
          $[26] = t1;
        } else {
          t1 = $[26];
        }
        body = t1;
        break bb0;
      }
    case "advisor_redacted_result":
      {
        let t1;
        if ($[27] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Text dimColor={true}>{figures.tick} Advisor has reviewed the conversation and will apply the feedback</Text>;
          $[27] = t1;
        } else {
          t1 = $[27];
        }
        body = t1;
      }
  }
  let t1;
// 【最后统一包 Box paddingRight={2} + MessageResponse】
//
//  注意前面三个分支各自算 body（不带外壳），最后才统一加外壳。
//  这样做的好处是：外壳只算一次，且缓存键只有一个 body。
//
//  如果每个分支各自包外壳，就会有三个几乎相同的 JSX 块，
//  Compiler 要为每个建一套槽 —— 产物会从 30 个槽涨到 45 个。
//
//  **「先算内容、后统一包装」是减少缓存槽的常用手段。**
  if ($[28] !== body) {
    t1 = <Box paddingRight={2}><MessageResponse>{body}</MessageResponse></Box>;
    $[28] = body;
    $[29] = t1;
  } else {
    t1 = $[29];
  }
  return t1;
}
// 原文件此处有一行 10124 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。