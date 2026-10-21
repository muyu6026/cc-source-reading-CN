// ═══════════════════════════════════════════════════════════════
//  teamMemCollapsed：折叠行里的「团队记忆」那半句
// ═══════════════════════════════════════════════════════════════
//
//  屏幕上它是这样的：
//
//      ⏺ Read 3 files, recalled 2 memories, searched team memories…
//
//  这一句是由三段代码拼出来的：
//    · 非记忆部分（读文件、搜代码、跑命令）→ CollapsedReadSearchContent 自己拼
//    · 私有记忆部分                        → 也是 CollapsedReadSearchContent 自己拼
//    · 团队记忆部分                        → 就是这个文件
//
//  分成三个文件的原因是团队记忆属于 feature('TEAMMEM')，要能整块删掉。
//  拼装的责任却留在调用方 —— 于是这里必须暴露「我这段要不要逗号」的信息，
//  也就是第 25 行的 hasPrecedingParts。
import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Text } from '../../ink.js';
import type { CollapsedReadSearchGroup } from '../../types/message.js';

// 【和 teamMemSaved.ts 同样的理由：普通函数，不让 Compiler 提升属性访问】
//
//  注意这里一口气读了三个属性：teamMemorySearchCount / teamMemoryReadCount /
//  teamMemoryWriteCount。如果这是一个组件的渲染路径，
//  Compiler 会给每个属性各建一个缓存槽，三个属性名就都活着了。
//
//  于是整个 TEAMMEM 模块删不掉 —— 为了三个属性名的 memo 比较，
//  白留一个功能分支的代码在外部构建里。
/**
 * Plain function (not a React component) so the React Compiler won't
 * hoist the teamMemory* property accesses for memoization. This module
 * is only loaded when feature('TEAMMEM') is true.
 */
// 【这个函数只回答一个问题：这组操作里有没有团队记忆】
//
//  三个计数各自 ?? 0 再比较，是因为老会话里这些字段可能不存在
//  （TEAMMEM 之前产生的消息记录里没有 teamMemory* 字段）。
//
//  `?? 0` 而不是 `|| 0`：后者在 0 上等价，但语义不同 ——
//  ?? 只兜住 null/undefined，不会把「合法地取到 0」误判成缺失。
export function checkHasTeamMemOps(message: CollapsedReadSearchGroup): boolean {
  return (message.teamMemorySearchCount ?? 0) > 0 || (message.teamMemoryReadCount ?? 0) > 0 || (message.teamMemoryWriteCount ?? 0) > 0;
}

/**
 * Renders team memory count parts for the collapsed read/search UI.
 * This module is only loaded when feature('TEAMMEM') is true,
 * so DCE removes it entirely from external builds.
 */
// 【23 个缓存槽，是这个文件最像汇编的地方】
//
//  三段（读 / 搜 / 写）各占 6-7 个槽，最后 5 个槽存「整体结果」。
//  读的时候按段跳：第 37-70 行是「读」段，71-94 是「搜」段，95-127 是「写」段。
//
//  每段的结构都一模一样：
//      算出动词 → 也许推一个逗号节点 → 推一个数字节点 → 拼成一行 → count++
//
//  `count` 这个变量的作用不是计数，是**判断自己是不是第一个片段**
//  （count === 0 时首字母大写、不推逗号）。
export function TeamMemCountParts(t0) {
  const $ = _c(23);
  const {
    message,
    isActiveGroup,
    hasPrecedingParts
  } = t0;
  const tmReadCount = message.teamMemoryReadCount ?? 0;
  const tmSearchCount = message.teamMemorySearchCount ?? 0;
  const tmWriteCount = message.teamMemoryWriteCount ?? 0;
// 【三个都是 0 就直接返回 null —— 注意这一步在缓存表之前】
//
//  放在这里不是为了快，是为了**不给一个注定返回 null 的组件建 23 个槽**。
//  折叠行在一次流式响应里会重渲染几十次，空组件的槽表也是要分配的。
//
//  这类「先早退再进缓存」的顺序，在 Message.tsx 里也出现过：
//  early return 一定要放在所有 useHook 之前 —— 但这里没有 hook，
//  所以可以放在缓存块之前。
  if (tmReadCount === 0 && tmSearchCount === 0 && tmWriteCount === 0) {
    return null;
  }
  let t1;
  if ($[0] !== hasPrecedingParts || $[1] !== isActiveGroup || $[2] !== tmReadCount || $[3] !== tmSearchCount || $[4] !== tmWriteCount) {
    const nodes = [];
    let count = hasPrecedingParts ? 1 : 0;
    if (tmReadCount > 0) {
// 【首字母大写的规则：只有「第一个片段」才大写】
//
//      count === 0 ? "Recalling" : "recalling"
//
//  因为整行读起来是「Read 3 files, recalling 2 memories, …」——
//  只有句首那个动词大写。而 hasPrecedingParts（父层传进来的）
//  决定了这里的 count 从 0 还是从 1 开始：
//
//      let count = hasPrecedingParts ? 1 : 0;
//
//  这就是第 12 行那个 `import type { CollapsedReadSearchGroup }` 之外，
//  和父层唯一的耦合点：**父层必须诚实地告诉我「前面有没有东西」。**
//  判断错了，屏幕上是「, recalled 2 memories」这种多一个逗号的句子。
      const verb = isActiveGroup ? count === 0 ? "Recalling" : "recalling" : count === 0 ? "Recalled" : "recalled";
      if (count > 0) {
        let t2;
// 【`$[6] === sentinel` —— 这个逗号节点是永久缓存的】
//
//  因为它不依赖任何输入：永远是一个内容为「, 」的 Text。
//  用 sentinel 判据（而不是「和上次比较」），等于告诉运行时
//  「这个槽永远不会失效，别再来算」。
//
//  仓库里所有纯静态的 JSX 都这么处理。看到 sentinel 就说明：
//  **这一段是常量，读的时候可以直接跳过。**
        if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <Text key="comma-tmr">, </Text>;
          $[6] = t2;
        } else {
          t2 = $[6];
        }
        nodes.push(t2);
      }
      let t2;
      if ($[7] !== tmReadCount) {
        t2 = <Text bold={true}>{tmReadCount}</Text>;
        $[7] = tmReadCount;
        $[8] = t2;
      } else {
        t2 = $[8];
      }
// 【单复数是手写的，而且是「数字在外、名词在内」的结构】
//
//      <Text bold>{tmReadCount}</Text>  ... team {t3}
//
//  数字要加粗，名词不加，所以不能拼成一个字符串。
//  终端里加粗是靠 SGR 转义序列实现的，一个 Text 节点对应一段连续的样式，
//  所以「同一个句子里两种样式」必然拆成多个节点。
//
//  这也是为什么这个目录里到处是 <Text>{a}<Text bold>{b}</Text>{c}</Text> 这种嵌套 ——
//  不是排版偏好，是**样式必须跟文本在同一个节点里**这条底层约束逼出来的。
      const t3 = tmReadCount === 1 ? "memory" : "memories";
      let t4;
      if ($[9] !== t2 || $[10] !== t3 || $[11] !== verb) {
        t4 = <Text key="team-mem-read">{verb} {t2} team{" "}{t3}</Text>;
        $[9] = t2;
        $[10] = t3;
        $[11] = verb;
        $[12] = t4;
      } else {
        t4 = $[12];
      }
      nodes.push(t4);
      count++;
    }
    if (tmSearchCount > 0) {
      const verb_0 = isActiveGroup ? count === 0 ? "Searching" : "searching" : count === 0 ? "Searched" : "searched";
      if (count > 0) {
        let t2;
        if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <Text key="comma-tms">, </Text>;
          $[13] = t2;
        } else {
          t2 = $[13];
        }
        nodes.push(t2);
      }
      const t2 = `${verb_0} team memories`;
      let t3;
      if ($[14] !== t2) {
        t3 = <Text key="team-mem-search">{t2}</Text>;
        $[14] = t2;
        $[15] = t3;
      } else {
        t3 = $[15];
      }
      nodes.push(t3);
      count++;
    }
    if (tmWriteCount > 0) {
      const verb_1 = isActiveGroup ? count === 0 ? "Writing" : "writing" : count === 0 ? "Wrote" : "wrote";
      if (count > 0) {
        let t2;
        if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <Text key="comma-tmw">, </Text>;
          $[16] = t2;
        } else {
          t2 = $[16];
        }
        nodes.push(t2);
      }
      let t2;
      if ($[17] !== tmWriteCount) {
        t2 = <Text bold={true}>{tmWriteCount}</Text>;
        $[17] = tmWriteCount;
        $[18] = t2;
      } else {
        t2 = $[18];
      }
      const t3 = tmWriteCount === 1 ? "memory" : "memories";
      let t4;
      if ($[19] !== t2 || $[20] !== t3 || $[21] !== verb_1) {
        t4 = <Text key="team-mem-write">{verb_1} {t2} team{" "}{t3}</Text>;
        $[19] = t2;
        $[20] = t3;
        $[21] = verb_1;
        $[22] = t4;
      } else {
        t4 = $[22];
      }
      nodes.push(t4);
    }
// 【返回 <>{nodes}</> 而不是 <Text>{nodes}</Text>】
//
//  Fragment 不产生任何布局盒子，nodes 里的每个 Text 直接并进父层的行内布局。
//  如果这里包一层 <Text>，父层那段 `{memParts}` 就会多出一层，
//  逗号与空格的换行行为也跟着变（Ink 的 wrap 是在 Text 边界上发生的）。
//
//  折叠行整句是靠「多个 Text 平铺在一行」拼出来的，
//  任何多余的包裹层都会改变折行位置。
    t1 = <>{nodes}</>;
    $[0] = hasPrecedingParts;
    $[1] = isActiveGroup;
    $[2] = tmReadCount;
    $[3] = tmSearchCount;
    $[4] = tmWriteCount;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  return t1;
}
// 原文件此处有一行 9504 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。