// ═══════════════════════════════════════════════════════════════
//  PromptInputHelpMenu：按 ? 弹出的那三列快捷键速查表
// ═══════════════════════════════════════════════════════════════
//
//  357 行，其中 330 行是「重复同一个模式十遍」：
//
//      const tX = useShortcutDisplay('动作名', 'Chat', '默认键')
//      if ($[n] !== tX) { tY = formatShortcut(tX); $[n] = tX; $[n+1] = tY }
//      const xxxShortcut = tY
//
//  十次，每次占两个缓存槽（输入一个、输出一个）。这就是 _c(99) 里那 99 个槽的来历：
//  45 个临时值 × 2 左右。
//
//  读这种文件**不要从头读到尾**。正确方法是：
//    1. 先看 useShortcutDisplay 的调用（第 30-129 行），把「有哪些快捷键」列出来
//    2. 再看三个 Box（第 183、247、331 行），把「怎么分三列」看出来
//    3. 剩下全是噪音
//
//  它没有一行业务逻辑 —— 这是一张**声明式的表**，只是被编译器展开成了几十个 tN。
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import * as React from 'react';
import { Box, Text } from 'src/ink.js';
import { getPlatform } from 'src/utils/platform.js';
import { isKeybindingCustomizationEnabled } from '../../keybindings/loadUserBindings.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { isFastModeAvailable, isFastModeEnabled } from '../../utils/fastMode.js';
import { getNewlineInstructions } from './utils.js';

/** Format a shortcut for display in the help menu (e.g., "ctrl+o" → "ctrl + o") */
// 【ctrl+o → ctrl + o：给加号两边加空格】
//
//  为什么要改：终端字体里 `ctrl+o` 的加号很窄，紧凑写法和后面的说明文字
//  粘在一起容易看成 `ctrl+ofor terminal`。加空格是为了「视觉分词」。
//
//  为什么不在 useShortcutDisplay 里就返回带空格的版本：因为那个函数的结果
//  还被用在**真的按键提示**里（比如「按 ctrl+o 展开」），那里紧凑写法更省宽度。
//  所以格式化是显示层的事，在这里做一次。
//
//  这是「同一份数据，两种呈现」的常见处理：**不要在数据源头做美化**，
//  否则另一个消费方就拿不到原始形态了。
function formatShortcut(shortcut: string): string {
  return shortcut.replace(/\+/g, ' + ');
}
type Props = {
  dimColor?: boolean;
  fixedWidth?: boolean;
  gap?: number;
  paddingX?: number;
};
// 【props 全是可选的样式开关，一个有语义的都没有】
//
//  dimColor / fixedWidth / gap / paddingX —— 四个全是排版参数。
//  说明这个组件被用在不止一个地方，而且各处想要的密度不同。
//
//  第 136 行 PromptInputFooter 里用的是 `<PromptInputHelpMenu dimColor fixedWidth paddingX={2} />`。
//  fixedWidth 为真时，三列宽度被写死成 24 / 35 / 无（第 140、194 行）。
//
//  为什么需要 fixedWidth：这张表出现在两个场合 —— 平时嵌在 footer 里
//  （宽度受限，必须固定列宽才能对齐），以及帮助面板里（可以自适应）。
//  一个 prop 切换两种排版策略，比写两个组件省事，但代价是组件内部
//  到处是 `fixedWidth ? X : undefined`。
export function PromptInputHelpMenu(props) {
  const $ = _c(99);
  const {
    dimColor,
    fixedWidth,
    gap,
    paddingX
  } = props;
// 【十个 useShortcutDisplay，每个都是一次订阅】
//
//  这个 hook 返回「用户当前配置下这个动作绑定到什么键」——用户可以改键，
//  所以它必须是响应式的（内部订阅 keybinding 配置）。
//
//  十个订阅意味着：改一次键位配置，这个组件会重渲染一次（十次订阅都收到通知，
//  React 会批处理成一次渲染）。可以接受。
//
//  但要注意第 30-129 行那 100 行是**编译产物对同一个模式的十次展开**。
//  源码里大概是十个一行一个的 const，编译器逐个套上缓存判断。
//  这就是为什么这段代码看起来像机器写的 —— 它确实是。
  const t0 = useShortcutDisplay("app:toggleTranscript", "Global", "ctrl+o");
  let t1;
  if ($[0] !== t0) {
    t1 = formatShortcut(t0);
    $[0] = t0;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const transcriptShortcut = t1;
  const t2 = useShortcutDisplay("app:toggleTodos", "Global", "ctrl+t");
  let t3;
  if ($[2] !== t2) {
    t3 = formatShortcut(t2);
    $[2] = t2;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const todosShortcut = t3;
  const t4 = useShortcutDisplay("chat:undo", "Chat", "ctrl+_");
  let t5;
  if ($[4] !== t4) {
    t5 = formatShortcut(t4);
    $[4] = t4;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  const undoShortcut = t5;
  const t6 = useShortcutDisplay("chat:stash", "Chat", "ctrl+s");
  let t7;
  if ($[6] !== t6) {
    t7 = formatShortcut(t6);
    $[6] = t6;
    $[7] = t7;
  } else {
    t7 = $[7];
  }
  const stashShortcut = t7;
  const t8 = useShortcutDisplay("chat:cycleMode", "Chat", "shift+tab");
  let t9;
  if ($[8] !== t8) {
    t9 = formatShortcut(t8);
    $[8] = t8;
    $[9] = t9;
  } else {
    t9 = $[9];
  }
  const cycleModeShortcut = t9;
  const t10 = useShortcutDisplay("chat:modelPicker", "Chat", "alt+p");
  let t11;
  if ($[10] !== t10) {
    t11 = formatShortcut(t10);
    $[10] = t10;
    $[11] = t11;
  } else {
    t11 = $[11];
  }
  const modelPickerShortcut = t11;
  const t12 = useShortcutDisplay("chat:fastMode", "Chat", "alt+o");
  let t13;
  if ($[12] !== t12) {
    t13 = formatShortcut(t12);
    $[12] = t12;
    $[13] = t13;
  } else {
    t13 = $[13];
  }
  const fastModeShortcut = t13;
  const t14 = useShortcutDisplay("chat:externalEditor", "Chat", "ctrl+g");
  let t15;
  if ($[14] !== t14) {
    t15 = formatShortcut(t14);
    $[14] = t14;
    $[15] = t15;
  } else {
    t15 = $[15];
  }
  const externalEditorShortcut = t15;
  const t16 = useShortcutDisplay("app:toggleTerminal", "Global", "meta+j");
  let t17;
  if ($[16] !== t16) {
    t17 = formatShortcut(t16);
    $[16] = t16;
    $[17] = t17;
  } else {
    t17 = $[17];
  }
  const terminalShortcut = t17;
  const t18 = useShortcutDisplay("chat:imagePaste", "Chat", "ctrl+v");
  let t19;
  if ($[18] !== t18) {
    t19 = formatShortcut(t18);
    $[18] = t18;
    $[19] = t19;
  } else {
    t19 = $[19];
  }
  const imagePasteShortcut = t19;
  let t20;
  if ($[20] !== dimColor || $[21] !== terminalShortcut) {
// 【三层嵌套三元，全在一行里：feature → 灰度开关 → 渲染】
//
//      feature("TERMINAL_PANEL")
//        ? getFeatureValue_CACHED_MAY_BE_STALE("tengu_terminal_panel", false)
//            ? <Box>…terminal…</Box>
//            : null
//        : null
//
//  两级门：先是构建期开关（代码在不在包里），再是灰度开关（这个用户开没开）。
//  两者都过才显示一行「meta+j for terminal」。
//
//  `_CACHED_MAY_BE_STALE` 这个后缀是**函数名里的诚实**：它读的是本地缓存的
//  灰度值，可能落后于服务端。用这种命名逼调用方意识到「这个值不保证最新」。
//
//  谁可以接受「可能过时」：一行提示文案。谁不可以：权限判断、扣费。
//  所以这个函数被用在了正确的地方。
    t20 = feature("TERMINAL_PANEL") ? getFeatureValue_CACHED_MAY_BE_STALE("tengu_terminal_panel", false) ? <Box><Text dimColor={dimColor}>{terminalShortcut} for terminal</Text></Box> : null : null;
    $[20] = dimColor;
    $[21] = terminalShortcut;
    $[22] = t20;
  } else {
    t20 = $[22];
  }
  const terminalShortcutElement = t20;
// 【24：第一列的固定宽度】
//
//  这一列装的是「! for bash mode」「/ for commands」「@ for file paths」
//  「& for background」「/btw for side question」—— 最长那句 24 字符左右。
//
//  24 这个数不是算出来的，是**试出来的**：先看最长的一条，再留一点余量。
//  风险很明确：将来加一条更长的命令提示，这一列就会把下一列挤歪，
//  而且不会有任何报错 —— 只会在窄终端上看到文字重叠。
//
//  这就是终端 UI 的脆弱之处：没有 flex 换行兜底（这里 width 是硬约束），
//  布局正确性完全依赖「内容不超长」这个隐含约定。
  const t21 = fixedWidth ? 24 : undefined;
  let t22;
  if ($[23] !== dimColor) {
    t22 = <Box><Text dimColor={dimColor}>! for bash mode</Text></Box>;
    $[23] = dimColor;
    $[24] = t22;
  } else {
    t22 = $[24];
  }
  let t23;
  if ($[25] !== dimColor) {
    t23 = <Box><Text dimColor={dimColor}>/ for commands</Text></Box>;
    $[25] = dimColor;
    $[26] = t23;
  } else {
    t23 = $[26];
  }
  let t24;
  if ($[27] !== dimColor) {
    t24 = <Box><Text dimColor={dimColor}>@ for file paths</Text></Box>;
    $[27] = dimColor;
    $[28] = t24;
  } else {
    t24 = $[28];
  }
  let t25;
  if ($[29] !== dimColor) {
    t25 = <Box><Text dimColor={dimColor}>{"& for background"}</Text></Box>;
    $[29] = dimColor;
    $[30] = t25;
  } else {
    t25 = $[30];
  }
  let t26;
  if ($[31] !== dimColor) {
    t26 = <Box><Text dimColor={dimColor}>/btw for side question</Text></Box>;
    $[31] = dimColor;
    $[32] = t26;
  } else {
    t26 = $[32];
  }
  let t27;
  if ($[33] !== t21 || $[34] !== t22 || $[35] !== t23 || $[36] !== t24 || $[37] !== t25 || $[38] !== t26) {
    t27 = <Box flexDirection="column" width={t21}>{t22}{t23}{t24}{t25}{t26}</Box>;
    $[33] = t21;
    $[34] = t22;
    $[35] = t23;
    $[36] = t24;
    $[37] = t25;
    $[38] = t26;
    $[39] = t27;
  } else {
    t27 = $[39];
  }
// 【35：第二列的固定宽度】
//
//  第二列装的是「double tap esc to clear input」「shift+tab to auto-accept edits」
//  「ctrl+o for verbose output」等，最长那条 35 左右。
//
//  两列 24 + 35 = 59，剩给第三列（撤销/挂起/粘贴/切换模型…）。
//  80 列终端下：paddingX=2 占 4，三列共 59 + 第三列 ~25 = 84 —— **超了**。
//
//  所以第三列实际上会被截断或挤压。这是「按 100 列设计、在 80 列下勉强能用」
//  的典型状态。想验证的话，把终端缩到 80 列按 ? 看第三列右边缘。
//
//  这也是为什么这个组件只需要 fixedWidth 而不用响应式：它本来就没打算在
//  窄终端里完美显示。
  const t28 = fixedWidth ? 35 : undefined;
  let t29;
  if ($[40] !== dimColor) {
    t29 = <Box><Text dimColor={dimColor}>double tap esc to clear input</Text></Box>;
    $[40] = dimColor;
    $[41] = t29;
  } else {
    t29 = $[41];
  }
  let t30;
  if ($[42] !== cycleModeShortcut || $[43] !== dimColor) {
// 【`{false ? "to cycle modes" : "to auto-accept edits"}` —— 又一个折叠残骸】
//
//  源码大概写的是 `feature('SOMETHING') ? 'to cycle modes' : 'to auto-accept edits'`。
//  折叠后恒取后者，于是这句提示固定说「切换到自动接受编辑」。
//
//  值得注意：**这条提示的文字取决于构建**。同一个快捷键（shift+tab），
//  在不同构建里行为不同（一个循环模式，一个切 auto-accept），
//  所以文案必须跟着变 —— 这正是用 feature() 包住文案的原因。
//
//  反过来说，如果你在源码里看到「文案写死了但行为看起来是另一回事」，
//  先找附近有没有这种恒假/恒真的条件，别急着当成 bug。
    t30 = <Box><Text dimColor={dimColor}>{cycleModeShortcut}{" "}{false ? "to cycle modes" : "to auto-accept edits"}</Text></Box>;
    $[42] = cycleModeShortcut;
    $[43] = dimColor;
    $[44] = t30;
  } else {
    t30 = $[44];
  }
  let t31;
  if ($[45] !== dimColor || $[46] !== transcriptShortcut) {
    t31 = <Box><Text dimColor={dimColor}>{transcriptShortcut} for verbose output</Text></Box>;
    $[45] = dimColor;
    $[46] = transcriptShortcut;
    $[47] = t31;
  } else {
    t31 = $[47];
  }
  let t32;
  if ($[48] !== dimColor || $[49] !== todosShortcut) {
    t32 = <Box><Text dimColor={dimColor}>{todosShortcut} to toggle tasks</Text></Box>;
    $[48] = dimColor;
    $[49] = todosShortcut;
    $[50] = t32;
  } else {
    t32 = $[50];
  }
  let t33;
  if ($[51] === Symbol.for("react.memo_cache_sentinel")) {
    t33 = getNewlineInstructions();
    $[51] = t33;
  } else {
    t33 = $[51];
  }
  let t34;
  if ($[52] !== dimColor) {
    t34 = <Box><Text dimColor={dimColor}>{t33}</Text></Box>;
    $[52] = dimColor;
    $[53] = t34;
  } else {
    t34 = $[53];
  }
  let t35;
  if ($[54] !== t28 || $[55] !== t29 || $[56] !== t30 || $[57] !== t31 || $[58] !== t32 || $[59] !== t34 || $[60] !== terminalShortcutElement) {
    t35 = <Box flexDirection="column" width={t28}>{t29}{t30}{t31}{t32}{terminalShortcutElement}{t34}</Box>;
    $[54] = t28;
    $[55] = t29;
    $[56] = t30;
    $[57] = t31;
    $[58] = t32;
    $[59] = t34;
    $[60] = terminalShortcutElement;
    $[61] = t35;
  } else {
    t35 = $[61];
  }
  let t36;
  if ($[62] !== dimColor || $[63] !== undoShortcut) {
    t36 = <Box><Text dimColor={dimColor}>{undoShortcut} to undo</Text></Box>;
    $[62] = dimColor;
    $[63] = undoShortcut;
    $[64] = t36;
  } else {
    t36 = $[64];
  }
  let t37;
  if ($[65] !== dimColor) {
// 【`getPlatform() !== "windows" && <Box>…` —— 用短路当条件渲染】
//
//  ctrl+z 在 Unix 上是「挂起进程」（SIGTSTP），Windows 没有这个信号，
//  所以那行提示在 Windows 上不显示。
//
//  用 `&&` 而不是三元，是因为右侧就是最终结果（要么元素要么 false）。
//  React 会忽略 false，所以不需要 `: null`。
//
//  注意这个函数**在缓存分支里被调用**（第 269 行判断 dimColor）：
//  也就是说 getPlatform() 只在 dimColor 变化时才执行一次。求值时机被
//  缓存机制顺带优化了 —— 这是编译产物的副作用，不是作者的设计。
    t37 = getPlatform() !== "windows" && <Box><Text dimColor={dimColor}>ctrl + z to suspend</Text></Box>;
    $[65] = dimColor;
    $[66] = t37;
  } else {
    t37 = $[66];
  }
  let t38;
  if ($[67] !== dimColor || $[68] !== imagePasteShortcut) {
    t38 = <Box><Text dimColor={dimColor}>{imagePasteShortcut} to paste images</Text></Box>;
    $[67] = dimColor;
    $[68] = imagePasteShortcut;
    $[69] = t38;
  } else {
    t38 = $[69];
  }
  let t39;
  if ($[70] !== dimColor || $[71] !== modelPickerShortcut) {
    t39 = <Box><Text dimColor={dimColor}>{modelPickerShortcut} to switch model</Text></Box>;
    $[70] = dimColor;
    $[71] = modelPickerShortcut;
    $[72] = t39;
  } else {
    t39 = $[72];
  }
  let t40;
  if ($[73] !== dimColor || $[74] !== fastModeShortcut) {
// 【两个函数调用被塞进了「应该返回 JSX」的位置】
//
//      isFastModeEnabled() && isFastModeAvailable() && <Box>…</Box>
//
//  它们是布尔函数，会在渲染时执行。但因为整行处在 `if ($[73] !== dimColor…)`
//  的缓存分支里，实际上只在 dimColor 变化时才重新求值。
//
//  这类「全局开关直接拿来当条件」的写法，在 feature-flag 密集的项目里很常见。
//  它的风险是：**这些函数读的是全局状态，但不在依赖里**。
//  也就是说用户在设置里打开 fast mode，这张帮助表不会更新 —— 除非
//  dimColor 恰好变了（几乎不会）。
//
//  所以这张表的「准确性」是挂载时的快照。对一张静态速查表来说可以接受，
//  对需要实时反映状态的 UI 就是 bug。
    t40 = isFastModeEnabled() && isFastModeAvailable() && <Box><Text dimColor={dimColor}>{fastModeShortcut} to toggle fast mode</Text></Box>;
    $[73] = dimColor;
    $[74] = fastModeShortcut;
    $[75] = t40;
  } else {
    t40 = $[75];
  }
  let t41;
  if ($[76] !== dimColor || $[77] !== stashShortcut) {
    t41 = <Box><Text dimColor={dimColor}>{stashShortcut} to stash prompt</Text></Box>;
    $[76] = dimColor;
    $[77] = stashShortcut;
    $[78] = t41;
  } else {
    t41 = $[78];
  }
  let t42;
  if ($[79] !== dimColor || $[80] !== externalEditorShortcut) {
    t42 = <Box><Text dimColor={dimColor}>{externalEditorShortcut} to edit in $EDITOR</Text></Box>;
    $[79] = dimColor;
    $[80] = externalEditorShortcut;
    $[81] = t42;
  } else {
    t42 = $[81];
  }
  let t43;
  if ($[82] !== dimColor) {
    t43 = isKeybindingCustomizationEnabled() && <Box><Text dimColor={dimColor}>/keybindings to customize</Text></Box>;
    $[82] = dimColor;
    $[83] = t43;
  } else {
    t43 = $[83];
  }
  let t44;
  if ($[84] !== t36 || $[85] !== t37 || $[86] !== t38 || $[87] !== t39 || $[88] !== t40 || $[89] !== t41 || $[90] !== t42 || $[91] !== t43) {
// 【第三列：`<Box flexDirection="column">{t36}{t37}…{t43}</Box>`】
//
//  八个元素平铺，**没有固定宽度**（前两列有 width，这一列没有）。
//  于是三列宽度实际是 24 + 35 + 自适应 —— 前两列对齐，第三列吃掉剩余。
//
//  这也解释了为什么前两列必须写死：如果三列都自适应，每列宽度会随内容
//  变化，而内容（快捷键名）会随用户改键变化 —— 每次改键整张表都会重排。
//  写死前两列，至少保证「列的位置」稳定。
//
//  最后那个 Box（第 346 行）把三列横排，gap 和 paddingX 由 props 决定。
//  整个文件的 DOM 结构就这三层：一排 → 三列 → 每列若干行。
    t44 = <Box flexDirection="column">{t36}{t37}{t38}{t39}{t40}{t41}{t42}{t43}</Box>;
    $[84] = t36;
    $[85] = t37;
    $[86] = t38;
    $[87] = t39;
    $[88] = t40;
    $[89] = t41;
    $[90] = t42;
    $[91] = t43;
    $[92] = t44;
  } else {
    t44 = $[92];
  }
  let t45;
  if ($[93] !== gap || $[94] !== paddingX || $[95] !== t27 || $[96] !== t35 || $[97] !== t44) {
    t45 = <Box paddingX={paddingX} flexDirection="row" gap={gap}>{t27}{t35}{t44}</Box>;
    $[93] = gap;
    $[94] = paddingX;
    $[95] = t27;
    $[96] = t35;
    $[97] = t44;
    $[98] = t45;
  } else {
    t45 = $[98];
  }
  return t45;
}
// 原文件此处有一行 23096 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。