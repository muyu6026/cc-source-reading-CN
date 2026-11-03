// 主题选择器。它是 onboarding 与 /theme 命令共用的同一份界面：选主题时立刻**预览**（整屏配色实时变），确认才落盘，取消则回滚。整份文件没有一行真正的业务逻辑改动，全是「让预览这件事看起来不像副作用」的配套。
import { c as _c } from "react/compiler-runtime";
// `feature` 来自 `bun:bundle`，是编译期常量折叠的特性开关；打包时若不启用 AUTO_THEME，下面那条三目会被摇树掉，运行时零成本。终端界面里所有「可能不发布的功能」都走这条路，而不是读环境变量。
import { feature } from 'bun:bundle';
import * as React from 'react';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Text, usePreviewTheme, useTheme, useThemeSetting } from '../ink.js';
import { useRegisterKeybindingContext } from '../keybindings/KeybindingContext.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import { gracefulShutdown } from '../utils/gracefulShutdown.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import type { ThemeSetting } from '../utils/theme.js';
import { Select } from './CustomSelect/index.js';
import { Byline } from './design-system/Byline.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { getColorModuleUnavailableReason, getSyntaxTheme } from './StructuredDiff/colorDiff.js';
import { StructuredDiff } from './StructuredDiff.js';
// Props 六个字段全是**可选的壳开关**，因为同一个组件要在三种宿主里长得不一样：onboarding（有开场白、无 Esc 退出）、`/theme` 命令（标准）、以及已在别处处理退出的上下文（skipExitHandling）。把差异做成布尔而不是拆三个组件，是因为主体那 300 行完全一样。
export type ThemePickerProps = {
  onThemeSelect: (setting: ThemeSetting) => void;
  showIntroText?: boolean;
  helpText?: string;
  showHelpTextBelow?: boolean;
  hideEscToCancel?: boolean;
  /** Skip exit handling when running in a context that already has it (e.g., onboarding) */
  skipExitHandling?: boolean;
  /** Called when the user cancels (presses Escape). If skipExitHandling is true and this is provided, it will be called instead of just saving the preview. */
  onCancel?: () => void;
// 函数体的第一件事是把所有 `t1 === undefined ? false : t1` 逐个写出来。这不是手写的——源码里原本是解构默认值 `showIntroText = false`，React Compiler 为了能把「参数解构」当成可缓存的一步，把默认值下沉成了显式三目。读的时候直接当 `showIntroText = false` 看即可。
};
export function ThemePicker(t0) {
  const $ = _c(59);
  const {
    onThemeSelect,
    showIntroText: t1,
    helpText: t2,
    showHelpTextBelow: t3,
    hideEscToCancel: t4,
    skipExitHandling: t5,
    onCancel: onCancelProp
  } = t0;
  const showIntroText = t1 === undefined ? false : t1;
  const helpText = t2 === undefined ? "" : t2;
  const showHelpTextBelow = t3 === undefined ? false : t3;
  const hideEscToCancel = t4 === undefined ? false : t4;
  const skipExitHandling = t5 === undefined ? false : t5;
  const [theme] = useTheme();
  const themeSetting = useThemeSetting();
  const {
    columns
  } = useTerminalSize();
  let t6;
// `Symbol.for(「react.memo_cache_sentinel」)` 是编译器的哨兵值：命中即表示「这个槽位从未被填过」。注意下面这一格只算一次就永久缓存 `getColorModuleUnavailableReason()`——它是模块加载探测（原生着色模块能否 require），每次渲染都问一遍等于每次渲染都做一次 require 尝试。
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = getColorModuleUnavailableReason();
    $[0] = t6;
  } else {
    t6 = $[0];
  }
  const colorModuleUnavailableReason = t6;
  let t7;
// 语法配色只在「配色模块可用」时才算：不可用时直接给 null，后面整块演示区与状态文案都靠这个 null 分支走降级路径。把「能不能用」与「用什么主题」拆成两个变量，是为了让降级判断只在一处。
  if ($[1] !== theme) {
    t7 = colorModuleUnavailableReason === null ? getSyntaxTheme(theme) : null;
    $[1] = theme;
    $[2] = t7;
  } else {
    t7 = $[2];
  }
  const syntaxTheme = t7;
// `usePreviewTheme` 返回三件套而不是一个 setter，这是本组件最关键的设计：**setPreviewTheme** 只改显示、**savePreview** 把当前预览写进设置、**cancelPreview** 丢弃预览回到已存值。主题这种「一改就整屏变」的设置，如果直接写设置，用户每按一次上下键都会产生一次磁盘写入；分成三段之后，键盘导航只是改内存。
  const {
    setPreviewTheme,
    savePreview,
    cancelPreview
  } = usePreviewTheme();
  const syntaxHighlightingDisabled = useAppState(_temp) ?? false;
  const setAppState = useSetAppState();
  useRegisterKeybindingContext("ThemePicker");
  const syntaxToggleShortcut = useShortcutDisplay("theme:toggleSyntaxHighlighting", "ThemePicker", "ctrl+t");
  let t8;
// 切换语法高亮的回调。第三个守卫 `colorModuleUnavailableReason === null` 说明：配色模块都加载不了的时候，这个开关没有意义，按了也不写盘——避免在配置文件里留下一条「设置了但永远不生效」的项。
  if ($[3] !== setAppState || $[4] !== syntaxHighlightingDisabled) {
    t8 = () => {
      if (colorModuleUnavailableReason === null) {
        const newValue = !syntaxHighlightingDisabled;
// 一次切换要写两处：`updateSettingsForSource` 落 userSettings（持久化），`setAppState` 同步内存（立即生效）。只做前者要等下一次设置重载才变色；只做后者重启就丢。两处都写是这类「用户可见开关」的标准姿势。
        updateSettingsForSource("userSettings", {
          syntaxHighlightingDisabled: newValue
        });
        setAppState(prev => ({
          ...prev,
          settings: {
            ...prev.settings,
            syntaxHighlightingDisabled: newValue
          }
        }));
      }
    };
    $[3] = setAppState;
    $[4] = syntaxHighlightingDisabled;
    $[5] = t8;
  } else {
    t8 = $[5];
  }
  let t9;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = {
      context: "ThemePicker"
    };
    $[6] = t9;
  } else {
    t9 = $[6];
  }
// 键位绑定把 ctrl+t 挂到上面那个回调上，context 为 ThemePicker——键位系统按 context 分层，同一个键在不同界面可以做不同事，靠的就是这个字符串。
  useKeybinding("theme:toggleSyntaxHighlighting", t8, t9);
// Esc 行为分两种：宿主已处理退出时（skipExitHandling）走组件自己的 onCancel；否则意味着这是独立命令，Esc 应该**退出整个进程**（gracefulShutdown(0)），而不是只关掉这个面板。onCancel 传 undefined 时也能跑，因为可选链。
  const exitState = useExitOnCtrlCDWithKeybindings(skipExitHandling ? _temp2 : undefined);
  let t10;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
// `auto` 选项被塞在数组最前面而不是最后：它是「跟随终端」，语义上属于最省心的一档，放在 Dark/Light 之前符合从粗到细的排列习惯。特性开关关掉时这个展开结果是空数组，其余六项原样。
    t10 = [...(feature("AUTO_THEME") ? [{
      label: "Auto (match terminal)",
      value: "auto" as const
    }] : []), {
      label: "Dark mode",
      value: "dark"
    }, {
      label: "Light mode",
      value: "light"
    }, {
      label: "Dark mode (colorblind-friendly)",
      value: "dark-daltonized"
    }, {
      label: "Light mode (colorblind-friendly)",
      value: "light-daltonized"
    }, {
      label: "Dark mode (ANSI colors only)",
      value: "dark-ansi"
    }, {
      label: "Light mode (ANSI colors only)",
      value: "light-ansi"
    }];
    $[7] = t10;
  } else {
    t10 = $[7];
  }
  const themeOptions = t10;
  let t11;
  if ($[8] !== showIntroText) {
// 同一个组件两种标题：onboarding 里显示「Let's get started.」（这时用户还不知道自己在配主题），`/theme` 里显示「Theme」。showIntroText 一个布尔同时决定了标题文案与下方是否出帮助行。
    t11 = showIntroText ? <Text>Let's get started.</Text> : <Text bold={true} color="permission">Theme</Text>;
    $[8] = showIntroText;
    $[9] = t11;
  } else {
    t11 = $[9];
  }
  let t12;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t12 = <Text bold={true}>Choose the text style that looks best with your terminal</Text>;
    $[10] = t12;
  } else {
    t12 = $[10];
  }
  let t13;
  if ($[11] !== helpText || $[12] !== showHelpTextBelow) {
// 帮助文本有两种位置：showHelpTextBelow 为假时贴在副标题下面（onboarding 用法），为真时挪到底部操作区旁边（命令用法）。原因是 onboarding 首屏要一次讲清，命令用法希望正文紧凑。
    t13 = helpText && !showHelpTextBelow && <Text dimColor={true}>{helpText}</Text>;
    $[11] = helpText;
    $[12] = showHelpTextBelow;
    $[13] = t13;
  } else {
    t13 = $[13];
  }
  let t14;
  if ($[14] !== t13) {
    t14 = <Box flexDirection="column">{t12}{t13}</Box>;
    $[14] = t13;
    $[15] = t14;
  } else {
    t14 = $[15];
  }
  let t15;
  if ($[16] !== setPreviewTheme) {
// 选中项一变就预览。注意 onFocus 里没有任何判断——**预览是有状态的全局副作用**，所以真正的清理责任交给了 cancelPreview 与 savePreview，而不是在这里做差量比较。
    t15 = setting => {
      setPreviewTheme(setting as ThemeSetting);
    };
    $[16] = setPreviewTheme;
    $[17] = t15;
  } else {
    t15 = $[17];
  }
  let t16;
  if ($[18] !== onThemeSelect || $[19] !== savePreview) {
// 确认时先 savePreview（把预览固化），再 onThemeSelect 通知宿主。顺序不能反：宿主可能立刻卸载本组件，卸载后 savePreview 就取不到当前预览值了。
    t16 = setting_0 => {
      savePreview();
      onThemeSelect(setting_0 as ThemeSetting);
    };
    $[18] = onThemeSelect;
    $[19] = savePreview;
    $[20] = t16;
  } else {
    t16 = $[20];
  }
  let t17;
  if ($[21] !== cancelPreview || $[22] !== onCancelProp || $[23] !== skipExitHandling) {
// 取消同样是两条路：宿主托管时先 cancelPreview 再回调；独立命令时 cancelPreview 后关进程。两条路都**必须** cancelPreview，否则退出时会带着未确认的预览写进设置——这是主题预览最容易出的 bug。
    t17 = skipExitHandling ? () => {
      cancelPreview();
      onCancelProp?.();
    } : async () => {
      cancelPreview();
      await gracefulShutdown(0);
    };
    $[21] = cancelPreview;
    $[22] = onCancelProp;
    $[23] = skipExitHandling;
    $[24] = t17;
  } else {
    t17 = $[24];
  }
  let t18;
  if ($[25] !== t15 || $[26] !== t16 || $[27] !== t17 || $[28] !== themeSetting) {
// Select 同时给了 `defaultValue` 与 `defaultFocusValue`，且都取当前已存值：前者决定「哪个是已选项」，后者决定「光标落在哪」。两个都指向同一个值，保证用户在列表里看到的选中态与光标起始位置不打架。`visibleOptionCount` 直接等于选项数，让列表全部展开、不出现滚动。
    t18 = <Select options={themeOptions} onFocus={t15} onChange={t16} onCancel={t17} visibleOptionCount={themeOptions.length} defaultValue={themeSetting} defaultFocusValue={themeSetting} />;
    $[25] = t15;
    $[26] = t16;
    $[27] = t17;
    $[28] = themeSetting;
    $[29] = t18;
  } else {
    t18 = $[29];
  }
  let t19;
  if ($[30] !== t11 || $[31] !== t14 || $[32] !== t18) {
    t19 = <Box flexDirection="column" gap={1}>{t11}{t14}{t18}</Box>;
    $[30] = t11;
    $[31] = t14;
    $[32] = t18;
    $[33] = t19;
  } else {
    t19 = $[33];
  }
  let t20;
  if ($[34] === Symbol.for("react.memo_cache_sentinel")) {
// 硬编码的一段三行 diff，纯粹用来当语法配色的**色卡**：它包含函数名、注释、删行、增行四类 token，正好把主题里最关键的四种颜色一次演示完。这份数据永远不变，所以被编译器提到缓存槽里（哨兵命中后不再重建对象）。
    t20 = {
      oldStart: 1,
      newStart: 1,
      oldLines: 3,
      newLines: 3,
      lines: [" function greet() {", "-  console.log(\"Hello, World!\");", "+  console.log(\"Hello, Claude!\");", " }"]
    };
    $[34] = t20;
  } else {
    t20 = $[34];
  }
  let t21;
  if ($[35] !== columns) {
// 用虚线上下边框包住演示区，是为了让「这是预览、不是真内容」在视觉上与真实 diff 区分开。宽度取 `columns` 而不是固定值，这样窄终端下演示区也跟着缩，不会撑破布局。
    t21 = <Box flexDirection="column" borderTop={true} borderBottom={true} borderLeft={false} borderRight={false} borderStyle="dashed" borderColor="subtle"><StructuredDiff patch={t20} dim={false} filePath="demo.js" firstLine={null} width={columns} /></Box>;
    $[35] = columns;
    $[36] = t21;
  } else {
    t21 = $[36];
  }
// 底部状态行要做四选一的三目链，优先级从高到低：**环境变量强制关** > **用户手动关** > **有语法主题（带来源）** > 默认开启。顺序很重要——环境变量压制用户设置，所以必须排在最前，否则用户会看到「已关闭」却不知道是 env 关的还是自己关的。有主题时把 `source` 也拼进去（如 from .tmTheme 文件），这是排查配色不对时最有用的一条信息。
  const t22 = colorModuleUnavailableReason === "env" ? `Syntax highlighting disabled (via CLAUDE_CODE_SYNTAX_HIGHLIGHT=${process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT})` : syntaxHighlightingDisabled ? `Syntax highlighting disabled (${syntaxToggleShortcut} to enable)` : syntaxTheme ? `Syntax theme: ${syntaxTheme.theme}${syntaxTheme.source ? ` (from ${syntaxTheme.source})` : ""} (${syntaxToggleShortcut} to disable)` : `Syntax highlighting enabled (${syntaxToggleShortcut} to disable)`;
  let t23;
  if ($[37] !== t22) {
    t23 = <Text dimColor={true}>{" "}{t22}</Text>;
    $[37] = t22;
    $[38] = t23;
  } else {
    t23 = $[38];
  }
  let t24;
  if ($[39] !== t21 || $[40] !== t23) {
    t24 = <Box flexDirection="column" width="100%">{t21}{t23}</Box>;
    $[39] = t21;
    $[40] = t23;
    $[41] = t24;
  } else {
    t24 = $[41];
  }
  let t25;
  if ($[42] !== t19 || $[43] !== t24) {
    t25 = <Box flexDirection="column" gap={1}>{t19}{t24}</Box>;
    $[42] = t19;
    $[43] = t24;
    $[44] = t25;
  } else {
    t25 = $[44];
  }
  const content = t25;
// showIntroText 为真时走另一条返回路径：内容不额外包一层 Box、不渲染帮助提示行、也不显示 Esc/Enter 提示——因为 onboarding 的宿主会在外面统一画出导航。这个分支整个提到 return 之前，而不是在 JSX 里加条件，好处是两条路径的 Box 嵌套层数不同也不会互相影响。
  if (!showIntroText) {
    let t26;
    if ($[45] !== content) {
      t26 = <Box flexDirection="column">{content}</Box>;
      $[45] = content;
      $[46] = t26;
    } else {
      t26 = $[46];
    }
    let t27;
    if ($[47] !== helpText || $[48] !== showHelpTextBelow) {
      t27 = showHelpTextBelow && helpText && <Box marginLeft={3}><Text dimColor={true}>{helpText}</Text></Box>;
      $[47] = helpText;
      $[48] = showHelpTextBelow;
      $[49] = t27;
    } else {
      t27 = $[49];
    }
    let t28;
    if ($[50] !== exitState || $[51] !== hideEscToCancel) {
// 退出提示本身有两种态：exitState.pending 为真时说明用户已经按过一次退出键，此时文案变成「再按一次 XX 退出」；否则正常显示 Enter/Esc 两个提示。这是终端里防误触的标准做法，不是本组件特有。
      t28 = !hideEscToCancel && <Box><Text dimColor={true} italic={true}>{exitState.pending ? <>Press {exitState.keyName} again to exit</> : <Byline><KeyboardShortcutHint shortcut="Enter" action="select" /><KeyboardShortcutHint shortcut="Esc" action="cancel" /></Byline>}</Text></Box>;
      $[50] = exitState;
      $[51] = hideEscToCancel;
      $[52] = t28;
    } else {
      t28 = $[52];
    }
    let t29;
    if ($[53] !== t27 || $[54] !== t28) {
      t29 = <Box marginTop={1}>{t27}{t28}</Box>;
      $[53] = t27;
      $[54] = t28;
      $[55] = t29;
    } else {
      t29 = $[55];
    }
    let t30;
    if ($[56] !== t26 || $[57] !== t29) {
      t30 = <>{t26}{t29}</>;
      $[56] = t26;
      $[57] = t29;
      $[58] = t30;
    } else {
      t30 = $[58];
    }
// 两个 return 并存：下面那个 `return t30` 在 showIntroText 为假的分支里，末尾 327 行的 `return content` 是 intro 分支。编译器把两者的公共部分（content）提到前面只算一次，所以读源码时容易误以为 325 行是死代码——它不是，它是 if 块内的返回。
    return t30;
  }
  return content;
}
function _temp2() {}
// `_temp` 是编译器外提的选择器函数（`s => s.settings.syntaxHighlightingDisabled`）。被提到模块顶层而不是内联，是因为 useAppState 依赖选择器的**引用稳定性**：每次渲染新建箭头函数会让它每次都认为「选择器变了」。读源码时看到 `useAppState(_temp)` 就知道这是编译器帮你做的一次稳定性优化。
function _temp(s) {
  return s.settings.syntaxHighlightingDisabled;
}
// 原文件此处有一行 25340 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。