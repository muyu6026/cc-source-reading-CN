// ═══════════════════════════════════════════════════════════════
//  UserLocalCommandOutputMessage：`/cost` 这类本地命令的输出
// ═══════════════════════════════════════════════════════════════
//
//  本地命令（不从模型走的那一类）把输出包成
//  <local-command-stdout> / <local-command-stderr>，
//  然后由这个文件渲染成缩进的正文。
//
//  它里面有三个组件：
//      UserLocalCommandOutputMessage   入口：抠标签、决定画几行
//      IndentedContent                 一行内容：缩进 + Markdown
//      CloudLaunchContent              特例：菱形开头的「云端启动」块
//
//  第三个是这一批里唯一的「排版特例」，值得单独看（见第 88 行）。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { DIAMOND_FILLED, DIAMOND_OPEN } from '../../constants/figures.js';
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js';
import { Box, Text } from '../../ink.js';
import { extractTag } from '../../utils/messages.js';
import { Markdown } from '../Markdown.js';
import { MessageResponse } from '../MessageResponse.js';
type Props = {
  content: string;
};
export function UserLocalCommandOutputMessage(t0) {
  const $ = _c(4);
  const {
    content
  } = t0;
  let lines;
  let t1;
  if ($[0] !== content) {
    t1 = Symbol.for("react.early_return_sentinel");
    bb0: {
// 【stdout 和 stderr 都要，但两个都是可选的】
//
//  命令可能只写了 stdout、只写了 stderr，或者两个都没有（比如
//  `/clear` 这类纯副作用命令）。三种情况分别对应：正常输出、错误输出、
// 「没有内容」占位。
//
//  第 24 行的 `if (!stdout && !stderr)` 用的是 falsy 判断而不是 undefined 判断 ——
//  因为 extractTag 拿不到时返回 undefined，但拿到空标签时返回空串，
//  两者都该走「没有内容」分支。
      const stdout = extractTag(content, "local-command-stdout");
      const stderr = extractTag(content, "local-command-stderr");
      if (!stdout && !stderr) {
        let t2;
        if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <MessageResponse><Text dimColor={true}>{NO_CONTENT_MESSAGE}</Text></MessageResponse>;
          $[3] = t2;
        } else {
          t2 = $[3];
        }
        t1 = t2;
        break bb0;
      }
      lines = [];
      if (stdout?.trim()) {
// 【`lines.push(<IndentedContent key="stdout">…)` —— key 是写死的字符串】
//
//  因为最多只有两项（stdout / stderr），key 不需要动态生成。
//  写死 "stdout" / "stderr" 还有一个好处：**内容变了但 key 不变，
//  组件实例被复用**，内部状态（比如 Markdown 的展开状态）不会丢。
//
//  如果 key 用 index，stdout 消失时 stderr 会顶到 index 0 上，
//  组件实例被复用成「另一个东西」，渲染出来的东西会错位。
//  这是 React 里 key 用 index 的典型症状：**删除中间项时状态串位**。
        lines.push(<IndentedContent key="stdout">{stdout.trim()}</IndentedContent>);
      }
      if (stderr?.trim()) {
        lines.push(<IndentedContent key="stderr">{stderr.trim()}</IndentedContent>);
      }
    }
    $[0] = content;
    $[1] = lines;
    $[2] = t1;
  } else {
    lines = $[1];
    t1 = $[2];
  }
  if (t1 !== Symbol.for("react.early_return_sentinel")) {
    return t1;
  }
// 【`return lines` —— 直接返回一个数组】
//
//  React 允许组件返回数组（等价于一个没有 key 要求的 Fragment），
//  但数组里的元素**必须有 key**（第 37、40 行都给了）。
//
//  这里没有包 <Box>，是因为外层调用点（Message.tsx）已经提供了布局容器。
//  多包一层会让你在屏幕上看不出差别，但会让 Ink 多一次布局测量。
//
//  注意这个 return 在早期返回之后：如果走到「没有内容」分支，
//  早就 return 了那个 MessageResponse，不会到这里。
  return lines;
}
function IndentedContent(t0) {
  const $ = _c(5);
  const {
    children
  } = t0;
// 【按前两个字符判断是不是「云端启动」块】
//
//      children.startsWith(`${DIAMOND_OPEN} `) || children.startsWith(`${DIAMOND_FILLED} `)
//
//  也就是「◇ 」或「◆ 」开头的内容，会被当成另一套排版处理。
//
//  用**内容前缀**来分发渲染方式，是一件有风险的事：
//  如果哪天某个普通命令的输出恰好以菱形开头，它会被误判。
//  当前之所以成立，是因为那个菱形是上游生成器自己加的（不是用户内容）。
//
//  读到这里应该记一笔：**这是一个隐式协议，没有任何类型或校验保护它。**
//  改动上游的生成器时要记得同步这里。
  if (children.startsWith(`${DIAMOND_OPEN} `) || children.startsWith(`${DIAMOND_FILLED} `)) {
    let t1;
    if ($[0] !== children) {
      t1 = <CloudLaunchContent>{children}</CloudLaunchContent>;
      $[0] = children;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    return t1;
  }
  let t1;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text dimColor={true}>{"  \u23BF  "}</Text>;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  let t2;
  if ($[3] !== children) {
    t2 = <Box flexDirection="row">{t1}<Box flexDirection="column" flexGrow={1}><Markdown>{children}</Markdown></Box></Box>;
    $[3] = children;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  return t2;
}
// 【CloudLaunchContent：把「◇ 标题 · 副标题」和下面的正文分开排】
//
//  输入长这样：
//
//      ◇ 启动云端环境 · sandbox-1
//      正文第一行
//      正文第二行
//
//  解析步骤（第 98-103 行）：
//      nl     第一个换行的位置
//      header 第一行（去掉前两个字符）
//      rest   剩下的正文
//      sep    header 里「 · 」的位置 → 拆成 label 和 suffix
//
//  于是标题行可以「菱形上色 + 加粗标题 + 灰色副标题」，正文另起一段。
//
//  ⚠️ 这里有一处**按码元切**的脆弱假设：
//  第 93 行 `children[0]` 取菱形、第 99 行 `children.slice(2)` 跳过「菱形 + 空格」。
//  两个都假设「菱形恰好占 1 个码元、后面恰好 1 个空格」。
//  这个假设对 ◇ (U+25C7) 成立，但**只要换成 emoji 或带变体选择符的字符就会错位**。
//
//  更稳的写法是 stringWidth(children[0]) 或者直接用 indexOf(' ') 找分隔位置。
//  这里没这么做，说明上游的菱形是硬编码常量、不会变 —— 属于「已知边界内的简化」。
function CloudLaunchContent(t0) {
  const $ = _c(19);
  const {
    children
  } = t0;
  const diamond = children[0];
  let label;
  let rest;
  let t1;
  if ($[0] !== children) {
    const nl = children.indexOf("\n");
    const header = nl === -1 ? children.slice(2) : children.slice(2, nl);
    rest = nl === -1 ? "" : children.slice(nl + 1).trim();
// 【`header.indexOf(' · ')` 用「空格 中点 空格」当分隔符】
//
//  中点（U+00B7）在这个仓库里是「副信息分隔符」的固定角色：
//  右上角的 token 计数、turn duration 后面的背景任务数、这里的副标题，
//  全都用它。
//
//  用三字符序列而不是单个中点，是为了避免标题里本身含有中点时被误切
//  （比如「claude.ai · api」这种名字）。
//
//  这算是一种「约定弱于协议」的做法：靠惯例而不是靠转义。
//  只要上游不会在标题里写「空格中点空格」，它就是安全的。
    const sep = header.indexOf(" \xB7 ");
    label = sep === -1 ? header : header.slice(0, sep);
    t1 = sep === -1 ? "" : header.slice(sep);
    $[0] = children;
    $[1] = label;
    $[2] = rest;
    $[3] = t1;
  } else {
    label = $[1];
    rest = $[2];
    t1 = $[3];
  }
  const suffix = t1;
  let t2;
  if ($[4] !== diamond) {
    t2 = <Text color="background">{diamond} </Text>;
    $[4] = diamond;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] !== label) {
    t3 = <Text bold={true}>{label}</Text>;
    $[6] = label;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  let t4;
  if ($[8] !== suffix) {
    t4 = suffix && <Text dimColor={true}>{suffix}</Text>;
    $[8] = suffix;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  let t5;
  if ($[10] !== t2 || $[11] !== t3 || $[12] !== t4) {
    t5 = <Text>{t2}{t3}{t4}</Text>;
    $[10] = t2;
    $[11] = t3;
    $[12] = t4;
    $[13] = t5;
  } else {
    t5 = $[13];
  }
  let t6;
  if ($[14] !== rest) {
    t6 = rest && <Box flexDirection="row"><Text dimColor={true}>{"  \u23BF  "}</Text><Text dimColor={true}>{rest}</Text></Box>;
    $[14] = rest;
    $[15] = t6;
  } else {
    t6 = $[15];
  }
  let t7;
  if ($[16] !== t5 || $[17] !== t6) {
    t7 = <Box flexDirection="column">{t5}{t6}</Box>;
    $[16] = t5;
    $[17] = t6;
    $[18] = t7;
  } else {
    t7 = $[18];
  }
  return t7;
}
// 原文件此处有一行 10468 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。