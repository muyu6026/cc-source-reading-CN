// 【斜杠命令在历史里显示成 `/compact` 这样一行】
//
//  注意它显示的是**用户敲的原文**（命令名 + 参数），
//  而不是「命令做了什么」。命令的产出是另一条消息（走 local-command-stdout）。
//
//  这样分开是为了让用户能回看「我什么时候跑过什么」。
//  如果只显示结果，历史会变成一堆无法归因的输出。
import { c as _c } from "react/compiler-runtime";
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import figures from 'figures';
import * as React from 'react';
import { COMMAND_MESSAGE_TAG } from '../../constants/xml.js';
import { Box, Text } from '../../ink.js';
import { extractTag } from '../../utils/messages.js';
type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};
export function UserCommandMessage(t0) {
  const $ = _c(19);
  const {
    addMargin,
    param: t1
  } = t0;
  const {
    text
  } = t1;
  let t2;
  if ($[0] !== text) {
// 【isSkillFormat —— 同一个标签有两套显示方式】
//
//  老命令显示成 `/name args`；
//  Skill 显示成 `Skill(name)`，因为 skill 没有「命令行参数」这个概念，
//  硬套斜杠格式会显得像用户敲了 `/skill-name 一堆东西`。
//
//  注意第 39 行这一句：
//
//      const isSkillFormat = extractTag(text, 'skill-format') === 'true'
//
//  **它没有进缓存。** 而上面两个 extractTag 都进了（$[0] / $[2]）。
//
//  这不是疏漏：Compiler 只给「结果要跨渲染复用」的东西建槽。
//  前两个的结果要拼进 JSX（属于渲染输出），第三个只用来选分支，
//  每次重算一次正则扫描的代价小于维护一个槽。
//
//  所以产物里「有槽 / 没槽」反映的是**这个值怎么被使用**，
//  而不是「这个计算贵不贵」。
    t2 = extractTag(text, COMMAND_MESSAGE_TAG);
    $[0] = text;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const commandMessage = t2;
  let t3;
  if ($[2] !== text) {
    t3 = extractTag(text, "command-args");
    $[2] = text;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const args = t3;
  const isSkillFormat = extractTag(text, "skill-format") === "true";
  if (!commandMessage) {
    return null;
  }
// 【skill 分支独立成一条 return 路径，而不是在最后拼字符串时分支】
//
//  因为两种格式的 JSX 结构不同：
//
//      skill   <Text>{pointer}<Text>Skill(name)</Text></Text>
//      命令    <Text>{pointer}<Text>/name args</Text></Text>
//
//  外层 Box 完全一样（同样的 marginTop / backgroundColor / paddingRight），
//  但内层一个是固定格式、一个是拼字符串。
//
//  重复的外层 Box 没有被抽出来 —— 这是这个目录里常见的小重复，
//  换取的是「每条分支自己看得懂」。抽成公共壳反而要在两个地方传 children。
  if (isSkillFormat) {
    const t4 = addMargin ? 1 : 0;
    let t5;
    if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = <Text color="subtle">{figures.pointer} </Text>;
      $[4] = t5;
    } else {
      t5 = $[4];
    }
    let t6;
    if ($[5] !== commandMessage) {
      t6 = <Text>{t5}<Text color="text">Skill({commandMessage})</Text></Text>;
      $[5] = commandMessage;
      $[6] = t6;
    } else {
      t6 = $[6];
    }
    let t7;
    if ($[7] !== t4 || $[8] !== t6) {
      t7 = <Box flexDirection="column" marginTop={t4} backgroundColor="userMessageBackground" paddingRight={1}>{t6}</Box>;
      $[7] = t4;
      $[8] = t6;
      $[9] = t7;
    } else {
      t7 = $[9];
    }
    return t7;
  }
// 【`[commandMessage, args].filter(Boolean).join(' ')` —— 用 filter 去掉可选参数】
//
//  如果用户只敲了 `/compact` 没带参数，args 是 null，
//  filter(Boolean) 把它滤掉，join 出来就是 "compact"。
//
//  这个写法比 `args ? name + ' ' + args : name` 短，也比模板字符串里的三元好读。
//  代价是**它会把空字符串和 0 也滤掉** —— 在这里安全（args 要么是非空串要么是 null），
//  但如果 args 可能是 "0"，就会静默丢失。
//
//  用 filter(Boolean) 之前要先想清楚数据里会不会有 falsy 但合法的值。
  let t4;
  if ($[10] !== args || $[11] !== commandMessage) {
    t4 = [commandMessage, args].filter(Boolean);
    $[10] = args;
    $[11] = commandMessage;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  const content = `/${t4.join(" ")}`;
  const t5 = addMargin ? 1 : 0;
  let t6;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Text color="subtle">{figures.pointer} </Text>;
    $[13] = t6;
  } else {
    t6 = $[13];
  }
  let t7;
  if ($[14] !== content) {
    t7 = <Text>{t6}<Text color="text">{content}</Text></Text>;
    $[14] = content;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  let t8;
  if ($[16] !== t5 || $[17] !== t7) {
    t8 = <Box flexDirection="column" marginTop={t5} backgroundColor="userMessageBackground" paddingRight={1}>{t7}</Box>;
    $[16] = t5;
    $[17] = t7;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
  return t8;
}
// 原文件此处有一行 6608 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。