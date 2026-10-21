// 【外部频道（Slack 之类）的消息在对话里长什么样】
//
//  一句话：`↳ slack · @alice: 帮我看下这个` —— 带来源、带发言人、正文截断。
//
//  这个文件只有 136 行，但有三个值得看的点：
//    1. 正则写在模块顶层并且**预先编译**（第 15 行）
//    2. 名字显示只取最后一段（第 21 行）
//    3. 截断用的是宽度而不是长度（第 57 行）
//
//  （这个文件属于 feature('KAIROS_CHANNELS')，外部构建里整块不存在。）
import { c as _c } from "react/compiler-runtime";
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { CHANNEL_ARROW } from '../../constants/figures.js';
import { CHANNEL_TAG } from '../../constants/xml.js';
import { Box, Text } from '../../ink.js';
import { truncateToWidth } from '../../utils/format.js';
type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};

// 【注释把协议的措辞固定下来了：`source is always first`】
//
//  这是两条正则都**硬编码了属性顺序**的原因：
//
//      source="([^"]+)"([^>]*)      ← source 必须是第一个属性
//      「词边界 + user="([^"]+)"」  ← user 可以在任意位置（用词边界匹配）
//
//  第一个用了位置假设，第二个没有。为什么不统一？
//  因为 source 是 wrapChannelMessage 写出来的（写入方唯一），
//  而 user 可能来自外部（Slack 的 webhook 载荷），属性顺序不受控。
//
//  **「数据由我写」的部分可以依赖顺序，「数据来自外部」的部分只能用词边界。**
//  这是一条很实用的判断标准。
// <channel source="..." user="..." chat_id="...">content</channel>
// source is always first (wrapChannelMessage writes it), user is optional.
// 【正则放在模块顶层 —— 只编译一次，且带上 g 之外的隐式状态】
//
//  这里用的是 `new RegExp(...)` 而不是字面量，原因是标签名来自常量
//  CHANNEL_TAG（要拼进模板字符串），字面量没法拼。
//
//  注意它**没有 g 标志**：只有一个匹配，用 exec 拿一次结果就够了。
//  带 g 的正则会记住 lastIndex，跨调用残留状态，
//  在多个组件同时渲染时会互相干扰 —— 这是 JS 正则最常见的坑之一。
const CHANNEL_RE = new RegExp(`<${CHANNEL_TAG}\\s+source="([^"]+)"([^>]*)>\\n?([\\s\\S]*?)\\n?</${CHANNEL_TAG}>`);
const USER_ATTR_RE = /\buser="([^"]+)"/;

// Plugin-provided servers get names like plugin:slack-channel:slack via
// addPluginScopeToServers — show just the leaf. Matches the suffix-match
// logic in isServerInChannels.
// 【`plugin:slack-channel:slack` 只显示最后一段 `slack`】
//
//  注释解释了完整名字的来源：addPluginScopeToServers 会给插件提供的
//  server 加作用域前缀，避免不同插件重名。但用户不关心作用域，
//  他只想看到「这是 slack」。
//
//  注意注释里那句 `Matches the suffix-match logic in isServerInChannels` ——
//  这说明**同一个命名规则在另一处也实现了一次**。
//  两处各自 lastIndexOf(':')，靠注释互相提醒。
//
//  这是本仓库里「一个约定两处实现」的又一例（前面见过 collapsed 永不静态）。
//  改动时最容易只改一处，症状是「配置里认得、界面上显示得不对」。
function displayServerName(name: string): string {
  const i = name.lastIndexOf(':');
  return i === -1 ? name : name.slice(i + 1);
}
const TRUNCATE_AT = 60;
export function UserChannelMessage(t0) {
  const $ = _c(29);
  const {
    addMargin,
    param: t1
  } = t0;
  const {
    text
  } = t1;
  let T0;
  let T1;
  let T2;
  let t2;
  let t3;
  let t4;
  let t5;
  let t6;
  let t7;
  let truncated;
  let user;
// 【整个组件体在一个 `if ($[0] !== addMargin || $[1] !== text)` 里】
//
//  也就是说：只要 text 和 addMargin 没变，**连正则都不跑**。
//  这是 early return + 缓存组合出的最高效形态 ——
//  一条三小时前的频道消息，滚动经过时零成本。
//
//  但代价是第 55-56 行的 user / body / truncated 也被迫缓存：
//  它们是在块内算出来的，必须在块外声明（`let truncated; let user;`），
//  否则解构赋值的作用域就断了。
//
//  这就是产物里那一排 `let T0; let T1; let T2; let t2; ...` 的来源：
//  **不是作者想声明这么多变量，是缓存块要求中间值在块外可见。**
  if ($[0] !== addMargin || $[1] !== text) {
    t7 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const m = CHANNEL_RE.exec(text);
      if (!m) {
        t7 = null;
        break bb0;
      }
      const [, source, attrs, content] = m;
      user = USER_ATTR_RE.exec(attrs ?? "")?.[1];
      const body = (content ?? "").trim().replace(/\s+/g, " ");
// 【truncateToWidth 而不是 slice —— 因为终端是「列」不是「字符」】
//
//  一个汉字占 2 列，一个 emoji 可能占 2 列，一个组合字符占 1 列但由多个码元组成。
//  slice(0, 60) 切出来的东西在屏幕上可能是 90 列，也可能把一个 emoji 切成半个。
//
//  这个仓库里两套做法并存：
//    · truncateToWidth  按显示宽度切（这里、PromptInput 的 pill 标签）
//    · slice(0, N)      按码元切（UserResourceUpdateMessage 的 URI）
//
//  区别在于**内容是不是给用户精确阅读的**：
//  频道正文要读，所以按宽度；URI 只是给个提示，所以按码元将就。
//
//  第三个做法是 stringWidth() 只测量不裁剪（AssistantToolUseMessage 用它算 minWidth）。
//  读取舍之前先问：这段内容用户要读，还是只要「知道大概」？
      truncated = truncateToWidth(body, TRUNCATE_AT);
      T2 = Box;
      t6 = addMargin ? 1 : 0;
      T1 = Text;
      if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
        t4 = <Text color="suggestion">{CHANNEL_ARROW}</Text>;
        $[13] = t4;
      } else {
        t4 = $[13];
      }
      t5 = " ";
      T0 = Text;
      t2 = true;
      t3 = displayServerName(source ?? "");
    }
    $[0] = addMargin;
    $[1] = text;
    $[2] = T0;
    $[3] = T1;
    $[4] = T2;
    $[5] = t2;
    $[6] = t3;
    $[7] = t4;
    $[8] = t5;
    $[9] = t6;
    $[10] = t7;
    $[11] = truncated;
    $[12] = user;
  } else {
    T0 = $[2];
    T1 = $[3];
    T2 = $[4];
    t2 = $[5];
    t3 = $[6];
    t4 = $[7];
    t5 = $[8];
    t6 = $[9];
    t7 = $[10];
    truncated = $[11];
    user = $[12];
  }
  if (t7 !== Symbol.for("react.early_return_sentinel")) {
    return t7;
  }
// 【`user ? ' · ' + user : ''` 在缓存块外面算】
//
//  对比第 55 行：user 是缓存块算的（因为在块内取的），
//  但 t8 是**每次渲染都算**的（因为它只用于拼 JSX，且开销是字符串拼接）。
//
//  Compiler 的取舍很明确：**字符串拼接便宜到不值得建槽**，
//  而正则匹配值得。所以它给 text 建槽、给 t8 不建。
//
//  这一条又一次印证：槽的分布不是随机的，是「成本 × 复用频率」的结果。
  const t8 = user ? ` \u00b7 ${user}` : "";
  let t9;
  if ($[14] !== T0 || $[15] !== t2 || $[16] !== t3 || $[17] !== t8) {
    t9 = <T0 dimColor={t2}>{t3}{t8}:</T0>;
    $[14] = T0;
    $[15] = t2;
    $[16] = t3;
    $[17] = t8;
    $[18] = t9;
  } else {
    t9 = $[18];
  }
  let t10;
  if ($[19] !== T1 || $[20] !== t4 || $[21] !== t5 || $[22] !== t9 || $[23] !== truncated) {
    t10 = <T1>{t4}{t5}{t9}{" "}{truncated}</T1>;
    $[19] = T1;
    $[20] = t4;
    $[21] = t5;
    $[22] = t9;
    $[23] = truncated;
    $[24] = t10;
  } else {
    t10 = $[24];
  }
  let t11;
  if ($[25] !== T2 || $[26] !== t10 || $[27] !== t6) {
    t11 = <T2 marginTop={t6}>{t10}</T2>;
    $[25] = T2;
    $[26] = t10;
    $[27] = t6;
    $[28] = t11;
  } else {
    t11 = $[28];
  }
  return t11;
}
// 原文件此处有一行 7944 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。