// ═══════════════════════════════════════════════════════════════
//  PromptInputModeIndicator：输入框左边那个 ❯（bash 模式是 !）
// ═══════════════════════════════════════════════════════════════
//
//  92 行，职责极小：一个字符 + 一个颜色。但它把「颜色从哪来」这条链
//  完整地展示了三次，而且每次的取法都不一样：
//
//    正在看某个 teammate → 用那个 teammate 的颜色（props 进来）
//    bash 模式          → 固定 bashBorder 色，并把字符换成 !
//    普通情况           → 用自己在团队里被分配的颜色（环境变量）
//
//  顺带一提，这里有一个 `false ? "subtle" : undefined` 的死分支（第 51 行），
//  是功能开关被常量折叠后的残骸 —— 详见那条批注。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { Box, Text } from 'src/ink.js';
import { AGENT_COLOR_TO_THEME_COLOR, AGENT_COLORS, type AgentColorName } from 'src/tools/AgentTool/agentColorManager.js';
import type { PromptInputMode } from 'src/types/textInputTypes.js';
import { getTeammateColor } from 'src/utils/teammate.js';
import type { Theme } from 'src/utils/theme.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
type Props = {
  mode: PromptInputMode;
  isLoading: boolean;
  viewingAgentName?: string;
  viewingAgentColor?: AgentColorName;
};

/**
 * Gets the theme color key for the teammate's assigned color.
 * Returns undefined if not a teammate or if the color is invalid.
 */
// 【先判开关，再读颜色：两重门，顺序不能换】
//
//  `if (!isAgentSwarmsEnabled()) return undefined` 在前面，
//  然后才读 getTeammateColor()。
//
//  为什么顺序重要：getTeammateColor() 读的是环境变量，在没开 swarms 的
//  会话里那个变量可能根本不存在（或者是上一次运行留下的脏值）。
//  先读后判的话，就会把一个不该生效的颜色带进 UI。
//
//  **「功能没开」应该在任何取数之前短路**，这是开关类代码的通用规矩。
function getTeammateThemeColor(): keyof Theme | undefined {
  if (!isAgentSwarmsEnabled()) {
    return undefined;
  }
  const colorName = getTeammateColor();
  if (!colorName) {
    return undefined;
  }
  if (AGENT_COLORS.includes(colorName as AgentColorName)) {
    return AGENT_COLOR_TO_THEME_COLOR[colorName as AgentColorName];
  }
  return undefined;
}
// 【参数名故意不叫 teammateColor，理由写在注释里】
//
//  注释原文：parameter named themeColor to avoid "teammate" string in external builds
//
//  这暴露了打包器的一个实现细节：**功能开关的死代码消除是按标识符/字符串
//  匹配做的**。如果外部构建里出现 "teammate" 这个词，某些处理流程
//  会把它当成需要保护（或需要剔除）的标记，从而影响消除结果。
//
//  于是变量名被迫让位给构建工具。这类「为了打包而改名字」的妥协，
//  在大型前端项目里并不罕见，通常是最后一步才做的优化。
//
//  读代码看到「命名不太自然」时，答案有时不在代码逻辑里，而在构建配置里。
type PromptCharProps = {
  isLoading: boolean;
  // Dead code elimination: parameter named themeColor to avoid "teammate" string in external builds
  themeColor?: keyof Theme;
};

/**
 * Renders the prompt character (❯).
 * Teammate color overrides the default color when set.
 */
function PromptChar(t0) {
  const $ = _c(3);
  const {
    isLoading,
    themeColor
  } = t0;
  const teammateColor = themeColor;
// 【`false ? "subtle" : undefined` —— 常量折叠后的残骸】
//
//  源码大概率是 `teammateColor ?? (feature('…') ? 'subtle' : undefined)`，
//  打包时 feature 被折成 false，三元没被完全化简，就留下了这个形态。
//
//  它的语义简单到无聊：**永远是 undefined**，所以 `color` 就等于 teammateColor。
//  但它在语法上仍然是个三元表达式，仍然会被执行。
//
//  同一份代码库里这种残骸还有几处，统一特征：
//    · `false ?` / `"external" === 'ant' &&` / `"external" !== 'ant'` 开头的条件
//    · `feature('X')` 直接当布尔用
//
//  看到它们，直接当「该分支不存在」处理，不要去猜它在什么情况下为真。
  const color = teammateColor ?? (false ? "subtle" : undefined);
  let t1;
  if ($[0] !== color || $[1] !== isLoading) {
    t1 = <Text color={color} dimColor={isLoading}>{figures.pointer} </Text>;
    $[0] = color;
    $[1] = isLoading;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  return t1;
}
export function PromptInputModeIndicator(t0) {
  const $ = _c(6);
  const {
    mode,
    isLoading,
    viewingAgentName,
    viewingAgentColor
  } = t0;
  let t1;
// 【这个颜色只在挂载时算一次（哨兵缓存）】
//
//  第 72-77 行用的是 memo_cache_sentinel 分支 —— 意思是「永远用第一次算的结果」。
//  于是 getTeammateThemeColor() 里的 isAgentSwarmsEnabled()、getTeammateColor()
//  整个会话只跑一次。
//
//  这在「颜色是身份，进程启动时就定了」的假设下是对的（teammate 进程确实是
//  带着颜色启动的）。但注意它的副作用：**运行期改环境变量不会生效**。
//
//  对比第 82 行 `isAgentSwarmsEnabled() ? teammateColor : undefined` ——
//  这一句在缓存未命中的时候才执行，两个函数的求值时机不同，
//  说明作者对「哪些值稳定、哪些要重读」有自己的判断。
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = getTeammateThemeColor();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const teammateColor = t1;
  const viewedTeammateThemeColor = viewingAgentColor ? AGENT_COLOR_TO_THEME_COLOR[viewingAgentColor] : undefined;
  let t2;
  if ($[1] !== isLoading || $[2] !== mode || $[3] !== viewedTeammateThemeColor || $[4] !== viewingAgentName) {
// 【三种情况挤在一个三元链里，读的顺序是从右往左】
//
//      viewingAgentName ? <PromptChar 用队友色>
//    : mode === "bash"  ? <Text color="bashBorder">! </Text>
//    :                    <PromptChar 用自己的色>
//
//  优先级：正在看某个队友 > bash 模式 > 默认。
//
//  为什么「看队友」压过 bash：看队友时输入框发出去的消息是给那个队友的，
//  此时显示 bash 模式的 ! 会误导用户以为自己在敲 shell 命令。
//  而 PromptChar 里那个 `isLoading` 传下去变成 dimColor（变灰），
//  表示「模型正在回复，你现在打字是排队」。
//
//  `<Box alignItems="flex-start" alignSelf="flex-start" flexWrap="nowrap">`
//  这三个属性都是为了「多行输入时，❯ 钉在第一行顶部」而不是垂直居中。
    t2 = <Box alignItems="flex-start" alignSelf="flex-start" flexWrap="nowrap" justifyContent="flex-start">{viewingAgentName ? <PromptChar isLoading={isLoading} themeColor={viewedTeammateThemeColor} /> : mode === "bash" ? <Text color="bashBorder" dimColor={isLoading}>! </Text> : <PromptChar isLoading={isLoading} themeColor={isAgentSwarmsEnabled() ? teammateColor : undefined} />}</Box>;
    $[1] = isLoading;
    $[2] = mode;
    $[3] = viewedTeammateThemeColor;
    $[4] = viewingAgentName;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  return t2;
}
// 原文件此处有一行 8140 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。