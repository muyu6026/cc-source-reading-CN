// Shell 任务详情弹窗。这个文件把「读文件尾部 → 挂起渲染 → 每秒刷新」串成一条链路，是仓库里 React 19 新特性的集中展示点：use 解包 Promise、Suspense 边界、useDeferredValue 降优先级。同时它复用给监视脚本（kind 为 monitor），所以标题与字段名都带二选一。
import { c as _c } from "react/compiler-runtime";
// 注意 use 与 Suspense 是从 react 直接引入的，不是实验包——说明这套代码运行在支持 React 19 的版本上。useDeferredValue 出现两次依赖（Promise 与列宽），是全文件唯一用来「降优先级」的手段。
import React, { Suspense, use, useDeferredValue, useEffect, useState } from 'react';
import type { DeepImmutable } from 'src/types/utils.js';
import type { CommandResultDisplay } from '../../commands.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import type { LocalShellTaskState } from '../../tasks/LocalShellTask/guards.js';
import { formatDuration, formatFileSize, truncateToWidth } from '../../utils/format.js';
// tailFile 只读文件尾部。任务输出可能是几百 MB 的构建日志，整读会先把内存打爆，用户还没看到界面进程就已经死了。
import { tailFile } from '../../utils/fsOperations.js';
// getTaskOutputPath 与写入端共用同一条路径规则。读端自己拼路径是最常见的错位来源——写入按任务 id 分目录，读端少一层就永远读不到。
import { getTaskOutputPath } from '../../utils/task/diskOutput.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
type Props = {
  shell: DeepImmutable<LocalShellTaskState>;
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  onKillShell?: () => void;
  onBack?: () => void;
};
// 尾读上限 8KB。这个数不是随意取的：按终端每行 80 到 120 列算，8KB 大约对应几十行，正好够看清最后一段报错，又不会让滚动帧率下降。
const SHELL_DETAIL_TAIL_BYTES = 8192;
type TaskOutputResult = {
  content: string;
  bytesTotal: number;
};

/**
 * Read the tail of the task output file. Only reads the last few KB,
 * not the entire file.
 */
// 异常一律吞成空内容。详情弹窗是排障工具，文件不存在或被删掉时应该显示「无输出」，而不是让整个界面崩在一个读文件的 promise 上。
async function getTaskOutput(shell: DeepImmutable<LocalShellTaskState>): Promise<TaskOutputResult> {
  const path = getTaskOutputPath(shell.id);
  try {
    const result = await tailFile(path, SHELL_DETAIL_TAIL_BYTES);
    return {
      content: result.content,
      bytesTotal: result.bytesTotal
    };
  } catch {
    return {
      content: '',
      bytesTotal: 0
    };
  }
}
// 组件入口，_c(57)——接近编译器槽数上限的一档，因为这里既要记 20 多个 JSX，又要记若干回调。
export function ShellDetailDialog(t0) {
  const $ = _c(57);
  const {
    shell,
    onDone,
    onKillShell,
    onBack
  } = t0;
  const {
    columns
  } = useTerminalSize();
  let t1;
  if ($[0] !== shell) {
    t1 = () => getTaskOutput(shell);
    $[0] = shell;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
// 输出内容的 Promise 放进 state，而不是直接 use。原因是要能「换一个新的 Promise」来触发重新读取：React 的 use 只认引用，同一引用不会重跑。
  const [outputPromise, setOutputPromise] = useState(t1);
// useDeferredValue 让刷新不阻塞按键。弹窗在持续刷新输出时仍然要能立刻响应 Esc——否则用户会觉得界面卡死，这是「更新很频繁的详情页」必须做的一层。
  const deferredOutputPromise = useDeferredValue(outputPromise);
  let t2;
  if ($[2] !== shell) {
// 只在运行中才起定时器。任务结束后再刷就是纯粹的空转，而这个弹窗常常被留着不关。
    t2 = () => {
      if (shell.status !== "running") {
        return;
      }
// setInterval 的第三参把 shell 塞进回调。这样回调的引用保持稳定，不需要因为 shell 变化而重建定时器——否则每秒都会 clear 再 set 一次，抖动非常明显。
      const timer = setInterval(_temp, 1000, setOutputPromise, shell);
      return () => clearInterval(timer);
    };
    $[2] = shell;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] !== shell.id || $[5] !== shell.status) {
    t3 = [shell.id, shell.status];
    $[4] = shell.id;
    $[5] = shell.status;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
// 依赖数组只有任务 id 与状态。shell 对象本身每帧都可能换引用，但只有这两个字段变了才需要重置定时器；依赖写 shell 会导致每秒重建。
  useEffect(t2, t3);
  let t4;
  if ($[7] !== onDone) {
// 关闭时往对话里回一条 system 消息。别小看这一句：它让「打开过、又关掉了」在记录里留下痕迹，事后回看能分清是没打开还是打开了没看。display 为 system 表示不当作助手发言。
    t4 = () => onDone("Shell details dismissed", {
      display: "system"
    });
    $[7] = onDone;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  const handleClose = t4;
  let t5;
  if ($[9] !== handleClose) {
    t5 = {
// 把 confirm:yes（也就是 Enter）绑定到关闭，context 指定 Confirmation。上下文限定很关键——否则弹窗开着时，其他场景的回车也会被这里截走。
      "confirm:yes": handleClose
    };
    $[9] = handleClose;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = {
      context: "Confirmation"
    };
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  useKeybindings(t5, t6);
  let t7;
  if ($[12] !== onBack || $[13] !== onDone || $[14] !== onKillShell || $[15] !== shell.status) {
// 这个 onKeyDown 处理的是 Dialog 自己不管的三件事：空格关闭、左方向键返回、x 杀进程。也就是说 Dialog 只负责 Esc 与回车，剩下的是业务键，必须在最外层接。
    t7 = e => {
      if (e.key === " ") {
        e.preventDefault();
        onDone("Shell details dismissed", {
          display: "system"
        });
      } else {
        if (e.key === "left" && onBack) {
          e.preventDefault();
          onBack();
        } else {
// x 只在 running 时才有效。对已结束的任务发 kill 既无意义，还可能命中已被复用的 id，属于典型的防御性判断。
          if (e.key === "x" && shell.status === "running" && onKillShell) {
            e.preventDefault();
            onKillShell();
          }
        }
      }
    };
    $[12] = onBack;
    $[13] = onDone;
    $[14] = onKillShell;
    $[15] = shell.status;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  const handleKeyDown = t7;
// kind 为 monitor 时同一个弹窗承担「监视脚本详情」。这是复用而不是分叉：字段几乎相同，只有标题和命令标签换词，分两个组件反而会让样式走偏。
  const isMonitor = shell.kind === "monitor";
  let t8;
  if ($[17] !== shell.command) {
// 命令截到 280 宽。超长单行命令在这里被硬截断而不是折行，因为同一行下面还要放状态与时长，撑开会让整个弹窗跳高。
    t8 = truncateToWidth(shell.command, 280);
    $[17] = shell.command;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
  const displayCommand = t8;
  const t9 = isMonitor ? "Monitor details" : "Shell details";
  let t10;
  if ($[19] !== onBack || $[20] !== onKillShell || $[21] !== shell.status) {
// inputGuide 是底部那行按键说明。exitState.pending 时整行替换成「再按一次退出」——这是双 Esc 防误触机制在上层的约定：第一次按只提示，第二次才真退。
    t10 = exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline>{onBack && <KeyboardShortcutHint shortcut={"\u2190"} action="go back" />}<KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />{shell.status === "running" && onKillShell && <KeyboardShortcutHint shortcut="x" action="stop" />}</Byline>;
    $[19] = onBack;
    $[20] = onKillShell;
    $[21] = shell.status;
    $[22] = t10;
  } else {
    t10 = $[22];
  }
  let t11;
  if ($[23] === Symbol.for("react.memo_cache_sentinel")) {
    t11 = <Text bold={true}>Status:</Text>;
    $[23] = t11;
  } else {
    t11 = $[23];
  }
  let t12;
  if ($[24] !== shell.result || $[25] !== shell.status) {
// 状态三色：运行中用 background 色（与正文反白）、完成用 success、其余一律 error。退出码只在有值时追加，避免运行中的任务显示成 exit code 未定义。
    t12 = <Text>{t11}{" "}{shell.status === "running" ? <Text color="background">{shell.status}{shell.result?.code !== undefined && ` (exit code: ${shell.result.code})`}</Text> : shell.status === "completed" ? <Text color="success">{shell.status}{shell.result?.code !== undefined && ` (exit code: ${shell.result.code})`}</Text> : <Text color="error">{shell.status}{shell.result?.code !== undefined && ` (exit code: ${shell.result.code})`}</Text>}</Text>;
    $[24] = shell.result;
    $[25] = shell.status;
    $[26] = t12;
  } else {
    t12 = $[26];
  }
  let t13;
  if ($[27] === Symbol.for("react.memo_cache_sentinel")) {
    t13 = <Text bold={true}>Runtime:</Text>;
    $[27] = t13;
  } else {
    t13 = $[27];
  }
  let t14;
// endTime 缺失时用 Date.now() 顶替，算出「已经跑了多久」。代价是这个值每秒都在变，因此这一格的缓存依赖是 endTime 而不是整个 shell——运行中每帧重算，结束后才稳定。
  if ($[28] !== shell.endTime) {
    t14 = shell.endTime ?? Date.now();
    $[28] = shell.endTime;
    $[29] = t14;
  } else {
    t14 = $[29];
  }
  const t15 = t14 - shell.startTime;
  let t16;
  if ($[30] !== t15) {
    t16 = formatDuration(t15);
    $[30] = t15;
    $[31] = t16;
  } else {
    t16 = $[31];
  }
  let t17;
  if ($[32] !== t16) {
    t17 = <Text>{t13}{" "}{t16}</Text>;
    $[32] = t16;
    $[33] = t17;
  } else {
    t17 = $[33];
  }
// Command 与 Script 二选一。同一个字段在两种任务语义下叫法不同，这是复用组件时最容易被忽略的细节：用户看到的词必须匹配他心里那个概念。
  const t18 = isMonitor ? "Script:" : "Command:";
  let t19;
  if ($[34] !== t18) {
    t19 = <Text bold={true}>{t18}</Text>;
    $[34] = t18;
    $[35] = t19;
  } else {
    t19 = $[35];
  }
  let t20;
  if ($[36] !== displayCommand || $[37] !== t19) {
    t20 = <Text wrap="wrap">{t19}{" "}{displayCommand}</Text>;
    $[36] = displayCommand;
    $[37] = t19;
    $[38] = t20;
  } else {
    t20 = $[38];
  }
  let t21;
  if ($[39] !== t12 || $[40] !== t17 || $[41] !== t20) {
    t21 = <Box flexDirection="column">{t12}{t17}{t20}</Box>;
    $[39] = t12;
    $[40] = t17;
    $[41] = t20;
    $[42] = t21;
  } else {
    t21 = $[42];
  }
  let t22;
  if ($[43] === Symbol.for("react.memo_cache_sentinel")) {
    t22 = <Text bold={true}>Output:</Text>;
    $[43] = t22;
  } else {
    t22 = $[43];
  }
  let t23;
  if ($[44] === Symbol.for("react.memo_cache_sentinel")) {
    t23 = <Text dimColor={true}>Loading output…</Text>;
    $[44] = t23;
  } else {
    t23 = $[44];
  }
  let t24;
  if ($[45] !== columns || $[46] !== deferredOutputPromise) {
// ShellOutputContent 必须是独立组件。原因是它在 use(promise) 处会挂起，挂起必须有自己的 Suspense 边界——写在父组件里会把整个详情弹窗一起挂掉，连标题都看不见。
    t24 = <Box flexDirection="column">{t22}<Suspense fallback={t23}><ShellOutputContent outputPromise={deferredOutputPromise} columns={columns} /></Suspense></Box>;
    $[45] = columns;
    $[46] = deferredOutputPromise;
    $[47] = t24;
  } else {
    t24 = $[47];
  }
  let t25;
  if ($[48] !== handleClose || $[49] !== t10 || $[50] !== t21 || $[51] !== t24 || $[52] !== t9) {
// Dialog 的 onCancel 与 handleClose 是同一个函数。Esc、回车确认、空格三条路径最终都落到「回一条 system 消息并关闭」，只有一个实现才好维护。
    t25 = <Dialog title={t9} onCancel={handleClose} color="background" inputGuide={t10}>{t21}{t24}</Dialog>;
    $[48] = handleClose;
    $[49] = t10;
    $[50] = t21;
    $[51] = t24;
    $[52] = t9;
    $[53] = t25;
  } else {
    t25 = $[53];
  }
  let t26;
  if ($[54] !== handleKeyDown || $[55] !== t25) {
// 最外层 Box 要 tabIndex 加 autoFocus 才能收到键盘事件。终端 UI 里焦点不是自动分配的，谁想接键盘谁就得主动抢——这一行漏了，弹窗就会「显示正常但按键全无反应」。
    t26 = <Box flexDirection="column" tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>{t25}</Box>;
    $[54] = handleKeyDown;
    $[55] = t25;
    $[56] = t26;
  } else {
    t26 = $[56];
  }
  return t26;
}
function _temp(setOutputPromise_0, shell_0) {
  return setOutputPromise_0(getTaskOutput(shell_0));
}
type ShellOutputContentProps = {
  outputPromise: Promise<TaskOutputResult>;
  columns: number;
};
function ShellOutputContent(t0) {
  const $ = _c(19);
  const {
    outputPromise,
    columns
  } = t0;
  const {
    content,
    bytesTotal
  } = use(outputPromise);
// 没读到内容时给一句话而不是空白。空白会让人以为是渲染失败，而这句话明确区分了「文件里就是空的」。
  if (!content) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Text dimColor={true}>No output available</Text>;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    return t1;
  }
  let isIncomplete;
  let rendered;
// 取最后 10 行的算法：从尾部往前找换行符，记录 10 个起点再反转顺序。为什么不直接 split 换行——大字符串切分会整份复制，8KB 还好，但这个函数的设计假设是「内容可能比预期长」。
  if ($[1] !== bytesTotal || $[2] !== content) {
    const starts = [];
    let pos = content.length;
    for (let i = 0; i < 10 && pos > 0; i++) {
      const prev = content.lastIndexOf("\n", pos - 1);
      starts.push(prev + 1);
      pos = prev;
    }
    starts.reverse();
// bytesTotal 大于已读字符数，说明文件比尾部窗口更长、显示的内容是被截断的。这个布尔值唯一的作用就是决定要不要在下面提「共多大」，所以它必须来自读取层而不是猜。
    isIncomplete = bytesTotal > content.length;
    rendered = [];
    for (let i_0 = 0; i_0 < starts.length; i_0++) {
      const start = starts[i_0];
      const end = i_0 < starts.length - 1 ? starts[i_0 + 1] - 1 : content.length;
      const line = content.slice(start, end);
      if (line) {
        rendered.push(line);
      }
    }
    $[1] = bytesTotal;
    $[2] = content;
    $[3] = isIncomplete;
    $[4] = rendered;
  } else {
    isIncomplete = $[3];
    rendered = $[4];
  }
  const t1 = columns - 6;
  let t2;
  if ($[5] !== rendered) {
    t2 = rendered.map(_temp2);
    $[5] = rendered;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  let t3;
  if ($[7] !== t1 || $[8] !== t2) {
// 输出区固定 height 12。高度不随内容跳动，弹窗整体才不会抖；配合 truncate-end，长行从右侧截断，保留命令输出最有效的左侧信息。
    t3 = <Box borderStyle="round" paddingX={1} flexDirection="column" height={12} maxWidth={t1}>{t2}</Box>;
    $[7] = t1;
    $[8] = t2;
    $[9] = t3;
  } else {
    t3 = $[9];
  }
  const t4 = `Showing ${rendered.length} lines`;
  let t5;
  if ($[10] !== bytesTotal || $[11] !== isIncomplete) {
    t5 = isIncomplete ? ` of ${formatFileSize(bytesTotal)}` : "";
    $[10] = bytesTotal;
    $[11] = isIncomplete;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  let t6;
  if ($[13] !== t4 || $[14] !== t5) {
    t6 = <Text dimColor={true} italic={true}>{t4}{t5}</Text>;
    $[13] = t4;
    $[14] = t5;
    $[15] = t6;
  } else {
    t6 = $[15];
  }
  let t7;
  if ($[16] !== t3 || $[17] !== t6) {
    t7 = <>{t3}{t6}</>;
    $[16] = t3;
    $[17] = t6;
    $[18] = t7;
  } else {
    t7 = $[18];
  }
  return t7;
}
// 每行单独一个 Text 并挂 index 作 key。行内容会整体滚动替换，用 index 作 key 反而比用内容更稳——内容作 key 会导致每帧全部重建。
function _temp2(line_0, i_1) {
  return <Text key={i_1} wrap="truncate-end">{line_0}</Text>;
}
// 原文件此处有一行 28404 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。