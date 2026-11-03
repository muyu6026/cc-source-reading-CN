import { c as _c } from "react/compiler-runtime";
// 导入 React 编译期运行时 _c，由 React Compiler 注入用于记忆化缓存
import * as React from 'react';
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js';
import { useShortcutDisplay } from 'src/keybindings/useShortcutDisplay.js';
import { builtInCommandNames, type Command, type CommandResultDisplay, INTERNAL_ONLY_COMMANDS } from '../../commands.js';
import { useIsInsideModal } from '../../context/modalContext.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Link, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { Pane } from '../design-system/Pane.js';
import { Tab, Tabs } from '../design-system/Tabs.js';
import { Commands } from './Commands.js';
import { General } from './General.js';
type Props = {
// 定义组件属性：onClose 关闭回调、commands 当前可用命令列表
  onClose: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  commands: Command[];
};
export function HelpV2(t0) {
// 帮助对话框主组件，参数 t0 为聚合后的 props
  const $ = _c(44);
// $ 是 React Compiler 生成的 memo 缓存数组，长度 44 对应可缓存值数量
  const {
    onClose,
    commands
  } = t0;
  const {
    rows,
    columns
  } = useTerminalSize();
  const maxHeight = Math.floor(rows / 2);
// 最大高度取终端行数的一半，避免帮助框过长
  const insideModal = useIsInsideModal();
// 判断当前是否处于模态框内，决定高度限制
  let t1;
  if ($[0] !== onClose) {
    t1 = () => onClose("Help dialog dismissed", {
      display: "system"
    });
    $[0] = onClose;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const close = t1;
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = {
      context: "Help"
    };
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  useKeybinding("help:dismiss", close, t2);
// 绑定 help:dismiss 快捷键（默认 Esc）关闭帮助
  const exitState = useExitOnCtrlCDWithKeybindings(close);
// 引入 Ctrl/Cmd+D 退出逻辑，pending 表示已按一次等待确认
  const dismissShortcut = useShortcutDisplay("help:dismiss", "Help", "esc");
  let antOnlyCommands;
  let builtinCommands;
  let t3;
  if ($[3] !== commands) {
    const builtinNames = builtInCommandNames();
    builtinCommands = commands.filter(cmd => builtinNames.has(cmd.name) && !cmd.isHidden);
// 从 commands 中过滤出内建命令并排除隐藏项
    let t4;
    if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = [];
      $[7] = t4;
    } else {
      t4 = $[7];
    }
    antOnlyCommands = t4;
    t3 = commands.filter(cmd_2 => !builtinNames.has(cmd_2.name) && !cmd_2.isHidden);
// 其余命令归为自定义命令
    $[3] = commands;
    $[4] = antOnlyCommands;
    $[5] = builtinCommands;
    $[6] = t3;
  } else {
    antOnlyCommands = $[4];
    builtinCommands = $[5];
    t3 = $[6];
  }
  const customCommands = t3;
  let t4;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Tab key="general" title="general"><General /></Tab>;
// 通用 tab 展示基础帮助信息
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let tabs;
  if ($[9] !== antOnlyCommands || $[10] !== builtinCommands || $[11] !== close || $[12] !== columns || $[13] !== customCommands || $[14] !== maxHeight) {
    tabs = [t4];
    let t5;
    if ($[16] !== builtinCommands || $[17] !== close || $[18] !== columns || $[19] !== maxHeight) {
      t5 = <Tab key="commands" title="commands"><Commands commands={builtinCommands} maxHeight={maxHeight} columns={columns} title="Browse default commands:" onCancel={close} /></Tab>;
// 内建命令 tab，列出默认命令并可浏览
      $[16] = builtinCommands;
      $[17] = close;
      $[18] = columns;
      $[19] = maxHeight;
      $[20] = t5;
    } else {
      t5 = $[20];
    }
    tabs.push(t5);
    let t6;
    if ($[21] !== close || $[22] !== columns || $[23] !== customCommands || $[24] !== maxHeight) {
      t6 = <Tab key="custom" title="custom-commands"><Commands commands={customCommands} maxHeight={maxHeight} columns={columns} title="Browse custom commands:" emptyMessage="No custom commands found" onCancel={close} /></Tab>;
// 自定义命令 tab，无命令时给出空提示
      $[21] = close;
      $[22] = columns;
      $[23] = customCommands;
      $[24] = maxHeight;
      $[25] = t6;
    } else {
      t6 = $[25];
    }
    tabs.push(t6);
    if (false && antOnlyCommands.length > 0) {
      let t7;
      if ($[26] !== antOnlyCommands || $[27] !== close || $[28] !== columns || $[29] !== maxHeight) {
        t7 = <Tab key="ant-only" title="[ant-only]"><Commands commands={antOnlyCommands} maxHeight={maxHeight} columns={columns} title="Browse ant-only commands:" onCancel={close} /></Tab>;
        $[26] = antOnlyCommands;
        $[27] = close;
        $[28] = columns;
        $[29] = maxHeight;
        $[30] = t7;
      } else {
        t7 = $[30];
      }
      tabs.push(t7);
    }
    $[9] = antOnlyCommands;
    $[10] = builtinCommands;
    $[11] = close;
    $[12] = columns;
    $[13] = customCommands;
    $[14] = maxHeight;
    $[15] = tabs;
  } else {
    tabs = $[15];
  }
  const t5 = insideModal ? undefined : maxHeight;
// 模态框内不限制最大高度
  let t6;
  if ($[31] !== tabs) {
    t6 = <Tabs title={false ? "/help" : `Claude Code v${MACRO.VERSION}`} color="professionalBlue" defaultTab="general">{tabs}</Tabs>;
// Tabs 容器，标题显示 Claude Code 版本号
    $[31] = tabs;
    $[32] = t6;
  } else {
    t6 = $[32];
  }
  let t7;
  if ($[33] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Box marginTop={1}><Text>For more help:{" "}<Link url="https://code.claude.com/docs/en/overview" /></Text></Box>;
// 提供在线文档链接
    $[33] = t7;
  } else {
    t7 = $[33];
  }
  let t8;
  if ($[34] !== dismissShortcut || $[35] !== exitState.keyName || $[36] !== exitState.pending) {
    t8 = <Box marginTop={1}><Text dimColor={true}>{exitState.pending ? <>Press {exitState.keyName} again to exit</> : <Text italic={true}>{dismissShortcut} to cancel</Text>}</Text></Box>;
    $[34] = dismissShortcut;
    $[35] = exitState.keyName;
    $[36] = exitState.pending;
    $[37] = t8;
  } else {
    t8 = $[37];
  }
  let t9;
  if ($[38] !== t6 || $[39] !== t8) {
    t9 = <Pane color="professionalBlue">{t6}{t7}{t8}</Pane>;
// 用 Pane 包裹标题、tab 与提示三块内容
    $[38] = t6;
    $[39] = t8;
    $[40] = t9;
  } else {
    t9 = $[40];
  }
  let t10;
  if ($[41] !== t5 || $[42] !== t9) {
    t10 = <Box flexDirection="column" height={t5}>{t9}</Box>;
    $[41] = t5;
    $[42] = t9;
    $[43] = t10;
  } else {
    t10 = $[43];
  }
  return t10;
// 返回最终渲染树
}
// 原文件此处有一行 15152 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。