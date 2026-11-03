// Diff 查看弹窗。它有两条数据源、两种视图模式，交叉出四种界面，但代码里没有一处是四个分支——靠的是「先把数据源归一成同一个形状，再让视图只认形状」。读它的主线是 turnDiffToDiffData：一轮对话产生的 diff 被转成与 git diff 完全同形的对象，之后所有下游代码都不再关心数据从哪来。
import { c as _c } from "react/compiler-runtime";
import type { StructuredPatchHunk } from 'diff';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
// 两个数据钩子：一份是当前工作区的 git diff，一份是按对话轮次收集的 diff 列表。它们是全文件的两个输入，其余全是派生。
import { type DiffData, useDiffData } from '../../hooks/useDiffData.js';
import { type TurnDiff, useTurnDiffs } from '../../hooks/useTurnDiffs.js';
import { Box, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import type { Message } from '../../types/message.js';
// plural 处理单复数。终端里写 1 file 而不是 1 files，这种细节在英文界面里是可信度的来源。
import { plural } from '../../utils/stringUtils.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { DiffDetailView } from './DiffDetailView.js';
import { DiffFileList } from './DiffFileList.js';
type Props = {
  messages: Message[];
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
type ViewMode = 'list' | 'detail';
// 数据源的可辨识联合：当前工作区，或某一轮对话。用一个 type 字段区分，比用两个可选字段稳——后者允许「都不传」这种非法状态。
type DiffSource = {
  type: 'current';
} | {
  type: 'turn';
  turn: TurnDiff;
};
// 整个文件的枢纽：把一轮对话的 diff 转成 DiffData。注意它必须补齐 git diff 才有的字段（统计、二进制标记、是否截断），因为这些字段对轮次 diff 没有意义，但下游视图会读。
function turnDiffToDiffData(turn: TurnDiff): DiffData {
  const files = Array.from(turn.files.values()).map(f => ({
    path: f.filePath,
    linesAdded: f.linesAdded,
    linesRemoved: f.linesRemoved,
    isBinary: false,
    isLargeFile: false,
    isTruncated: false,
    isNewFile: f.isNewFile
// 文件按路径排序。轮次 diff 的文件顺序取决于文件被修改的顺序，不排序的话同一个文件在两次打开时可能位置不同。
  })).sort((a, b) => a.path.localeCompare(b.path));
  const hunks = new Map<string, StructuredPatchHunk[]>();
  for (const f of turn.files.values()) {
    hunks.set(f.filePath, f.hunks);
  }
  return {
    stats: {
// 字段改名：上游叫 filesChanged，展示模型叫 filesCount。这类改名说明上游 stats 是给别处用的统计对象，这里只是借用它的数值。
      filesCount: turn.stats.filesChanged,
      linesAdded: turn.stats.linesAdded,
      linesRemoved: turn.stats.linesRemoved
    },
    files,
    hunks,
    loading: false
  };
}
// 入口，_c(73)。
export function DiffDialog(t0) {
  const $ = _c(73);
  const {
    messages,
    onDone
  } = t0;
  const gitDiffData = useDiffData();
// 按消息列表收集每轮 diff。也就是说历史轮次的 diff 不是从磁盘读的，而是从对话记录里重算出来的——这解释了为什么切数据源是瞬时完成的。
  const turnDiffs = useTurnDiffs(messages);
  const [viewMode, setViewMode] = useState("list");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sourceIndex, setSourceIndex] = useState(0);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
// 初始数据源是哨兵缓存的常量对象。它会被拼进下面的 sources 数组，所以每次渲染必须是同一个引用，否则数组会每次新建、进而让所有下游记忆槽失效。
    t1 = {
      type: "current"
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== turnDiffs) {
// sources 永远把「当前工作区」排在第一个，后面接历史轮次。这个顺序是固定的——因为切换条上的 Current 必须永远在第一格，用户靠位置记它。
    t2 = [t1, ...turnDiffs.map(_temp)];
    $[1] = turnDiffs;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const sources = t2;
  const currentSource = sources[sourceIndex];
  const currentTurn = currentSource?.type === "turn" ? currentSource.turn : null;
  let t3;
  if ($[3] !== currentTurn || $[4] !== gitDiffData) {
// 两条数据源在这里汇合：当前轮次为空就用 git diff，否则转成同形对象。从这个三目往下，代码里再没出现过「数据从哪来」的判断。
    t3 = currentTurn ? turnDiffToDiffData(currentTurn) : gitDiffData;
    $[3] = currentTurn;
    $[4] = gitDiffData;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const diffData = t3;
  const selectedFile = diffData.files[selectedIndex];
  let t4;
  if ($[6] !== diffData.hunks || $[7] !== selectedFile) {
// 取不到 hunk 就给空数组，而不是 undefined。这样下游视图不必写空判断，代价是「没有改动」与「取不到」在界面上不可区分——对查看器来说这个取舍是合理的。
    t4 = selectedFile ? diffData.hunks.get(selectedFile.path) || [] : [];
    $[6] = diffData.hunks;
    $[7] = selectedFile;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  const selectedHunks = t4;
  let t5;
  let t6;
  if ($[9] !== sourceIndex || $[10] !== sources.length) {
    t5 = () => {
// sourceIndex 越界时钳到最后一个。历史轮次会在对话进行中增减，用户停在某一格时轮次数量可能已经变了，不钳制就会取到 undefined。
      if (sourceIndex >= sources.length) {
        setSourceIndex(Math.max(0, sources.length - 1));
      }
    };
    t6 = [sources.length, sourceIndex];
    $[9] = sourceIndex;
    $[10] = sources.length;
    $[11] = t5;
    $[12] = t6;
  } else {
    t5 = $[11];
    t6 = $[12];
  }
  useEffect(t5, t6);
// 用 ref 记住上一次的数据源下标。ref 而不是 state，因为它只用于比较、不该触发渲染。
  const prevSourceIndex = useRef(sourceIndex);
  let t7;
  let t8;
  if ($[13] !== sourceIndex) {
    t7 = () => {
// 数据源一变就把文件选中下标重置为 0。否则会带着上一个源的选中位置跳到新源里，可能直接越界。
      if (prevSourceIndex.current !== sourceIndex) {
        setSelectedIndex(0);
        prevSourceIndex.current = sourceIndex;
      }
    };
    t8 = [sourceIndex];
    $[13] = sourceIndex;
    $[14] = t7;
    $[15] = t8;
  } else {
    t7 = $[14];
    t8 = $[15];
  }
  useEffect(t7, t8);
  useRegisterOverlay("diff-dialog");
  let t10;
  let t9;
  if ($[16] !== sources.length || $[17] !== viewMode) {
    t9 = () => {
// 左方向键的语义随视图模式改变：详情里是返回列表，列表里是切上一个数据源。同一个键承载两层后退，是「层级式弹窗」的标准做法——用户心里只有「往回退」一个概念。
      if (viewMode === "detail") {
        setViewMode("list");
      } else {
        if (viewMode === "list" && sources.length > 1) {
          setSourceIndex(_temp2);
        }
      }
    };
    t10 = () => {
      if (viewMode === "list" && sources.length > 1) {
        setSourceIndex(prev_0 => Math.min(sources.length - 1, prev_0 + 1));
      }
    };
    $[16] = sources.length;
    $[17] = viewMode;
    $[18] = t10;
    $[19] = t9;
  } else {
    t10 = $[18];
    t9 = $[19];
  }
  let t11;
  if ($[20] !== viewMode) {
    t11 = () => {
      if (viewMode === "detail") {
        setViewMode("list");
      }
    };
    $[20] = viewMode;
    $[21] = t11;
  } else {
    t11 = $[21];
  }
  let t12;
  if ($[22] !== selectedFile || $[23] !== viewMode) {
    t12 = () => {
// 回车只在列表模式且确实选中了文件时才进详情。少一个条件就会出现「空列表按回车进详情然后崩」。
      if (viewMode === "list" && selectedFile) {
        setViewMode("detail");
      }
    };
    $[22] = selectedFile;
    $[23] = viewMode;
    $[24] = t12;
  } else {
    t12 = $[24];
  }
  let t13;
  if ($[25] !== viewMode) {
    t13 = () => {
      if (viewMode === "list") {
        setSelectedIndex(_temp3);
      }
    };
    $[25] = viewMode;
    $[26] = t13;
  } else {
    t13 = $[26];
  }
  let t14;
  if ($[27] !== diffData.files.length || $[28] !== viewMode) {
    t14 = () => {
      if (viewMode === "list") {
        setSelectedIndex(prev_2 => Math.min(diffData.files.length - 1, prev_2 + 1));
      }
    };
    $[27] = diffData.files.length;
    $[28] = viewMode;
    $[29] = t14;
  } else {
    t14 = $[29];
  }
  let t15;
  if ($[30] !== t10 || $[31] !== t11 || $[32] !== t12 || $[33] !== t13 || $[34] !== t14 || $[35] !== t9) {
// 六个动作一次性绑成表，键位字符串与实现分离。这样键位配置可以集中在别处定义，这个文件只负责「这些名字对应哪些行为」。
    t15 = {
      "diff:previousSource": t9,
      "diff:nextSource": t10,
      "diff:back": t11,
      "diff:viewDetails": t12,
      "diff:previousFile": t13,
      "diff:nextFile": t14
    };
    $[30] = t10;
    $[31] = t11;
    $[32] = t12;
    $[33] = t13;
    $[34] = t14;
    $[35] = t9;
    $[36] = t15;
  } else {
    t15 = $[36];
  }
  let t16;
  if ($[37] === Symbol.for("react.memo_cache_sentinel")) {
    t16 = {
      context: "DiffDialog"
    };
    $[37] = t16;
  } else {
    t16 = $[37];
  }
  useKeybindings(t15, t16);
  let t17;
  if ($[38] !== diffData.stats) {
// 统计行：文件数固定显示，增删只有不为 0 时才出现并各自着色。零值不显示彩色 0，是为了让「这次只加不减」这类信息一眼可读。
    t17 = diffData.stats ? <Text dimColor={true}>{diffData.stats.filesCount} {plural(diffData.stats.filesCount, "file")}{" "}changed{diffData.stats.linesAdded > 0 && <Text color="diffAddedWord"> +{diffData.stats.linesAdded}</Text>}{diffData.stats.linesRemoved > 0 && <Text color="diffRemovedWord"> -{diffData.stats.linesRemoved}</Text>}</Text> : null;
    $[38] = diffData.stats;
    $[39] = t17;
  } else {
    t17 = $[39];
  }
  const subtitle = t17;
// 标题随数据源变：轮次显示第几轮，当前工作区显示未提交改动。副标题在轮次有用户提示时把提示原样加引号显示，否则标出这是与 HEAD 的差分。
  const headerTitle = currentTurn ? `Turn ${currentTurn.turnIndex}` : "Uncommitted changes";
  const headerSubtitle = currentTurn ? currentTurn.userPromptPreview ? `"${currentTurn.userPromptPreview}"` : "" : "(git diff HEAD)";
  let t18;
  if ($[40] !== sourceIndex || $[41] !== sources) {
// 数据源切换条：只有一个源时整块不渲染。左右箭头按「有没有更前/更后」分别显隐，而不是只做禁用——终端里没有禁用的暗色箭头这种语义，显隐更直观。
    t18 = sources.length > 1 ? <Box>{sourceIndex > 0 && <Text dimColor={true}>◀ </Text>}{sources.map((source, i) => {
        const isSelected = i === sourceIndex;
        const label = source.type === "current" ? "Current" : `T${source.turn.turnIndex}`;
        return <Text key={i} dimColor={!isSelected} bold={isSelected}>{i > 0 ? " \xB7 " : ""}{label}</Text>;
      })}{sourceIndex < sources.length - 1 && <Text dimColor={true}> ▶</Text>}</Box> : null;
    $[40] = sourceIndex;
    $[41] = sources;
    $[42] = t18;
  } else {
    t18 = $[42];
  }
  const sourceSelector = t18;
  const dismissShortcut = useShortcutDisplay("diff:dismiss", "DiffDialog", "esc");
  let t19;
// 这里是编译器把「多重 if 赋值」重写成带标签的块：bb0 是编译器生成的标签，用 break 代替嵌套 else。不是业务代码里的标签语法，读产物时不要误以为是程序员写的跳转。
  bb0: {
// 空态四种，顺序即优先级：加载中、该轮无改动、文件太多（有统计但明细为空）、工作区干净。最后一条是真正的兜底，前面三条都是「看起来空但原因不同」。
    if (diffData.loading) {
      t19 = "Loading diff\u2026";
      break bb0;
    }
    if (currentTurn) {
      t19 = "No file changes in this turn";
      break bb0;
    }
    if (diffData.stats && diffData.stats.filesCount > 0 && diffData.files.length === 0) {
      t19 = "Too many files to display details";
      break bb0;
    }
    t19 = "Working tree is clean";
  }
  const emptyMessage = t19;
  let t20;
  if ($[43] !== headerSubtitle) {
    t20 = headerSubtitle && <Text dimColor={true}> {headerSubtitle}</Text>;
    $[43] = headerSubtitle;
    $[44] = t20;
  } else {
    t20 = $[44];
  }
  let t21;
  if ($[45] !== headerTitle || $[46] !== t20) {
    t21 = <Text>{headerTitle}{t20}</Text>;
    $[45] = headerTitle;
    $[46] = t20;
    $[47] = t21;
  } else {
    t21 = $[47];
  }
  const title = t21;
  let t22;
  if ($[48] !== onDone || $[49] !== viewMode) {
// handleCancel 用函数声明而不是箭头函数。编译器保留了名字，报错栈里能看到 handleCancel 而不是 t22——这类细节说明源码作者是刻意写的命名函数。
    t22 = function handleCancel() {
// 取消的语义分两层：详情里退回列表，列表里才真正关闭并往对话里回一条 system 消息。和左方向键同一条逻辑，只是入口不同。
      if (viewMode === "detail") {
        setViewMode("list");
      } else {
        onDone("Diff dialog dismissed", {
          display: "system"
        });
      }
    };
    $[48] = onDone;
    $[49] = viewMode;
    $[50] = t22;
  } else {
    t22 = $[50];
  }
  const handleCancel = t22;
  let t23;
  if ($[51] !== dismissShortcut || $[52] !== sources.length || $[53] !== viewMode) {
// 底部按键说明按视图模式给两套：列表里强调切换源与选中，详情里只剩返回与关闭。exitState.pending 时整行替换成再次确认文案——双 Esc 防误触在这里同样存在。
    t23 = exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : viewMode === "list" ? <Byline>{sources.length > 1 && <Text>←/→ source</Text>}<Text>↑/↓ select</Text><Text>Enter view</Text><Text>{dismissShortcut} close</Text></Byline> : <Byline><Text>← back</Text><Text>{dismissShortcut} close</Text></Byline>;
    $[51] = dismissShortcut;
    $[52] = sources.length;
    $[53] = viewMode;
    $[54] = t23;
  } else {
    t23 = $[54];
  }
  let t24;
  if ($[55] !== diffData.files || $[56] !== emptyMessage || $[57] !== selectedFile?.isBinary || $[58] !== selectedFile?.isLargeFile || $[59] !== selectedFile?.isTruncated || $[60] !== selectedFile?.isUntracked || $[61] !== selectedFile?.path || $[62] !== selectedHunks || $[63] !== selectedIndex || $[64] !== viewMode) {
// 三个分支决定主体：没有文件就显示空态文案，列表模式显示文件列表，否则显示详情。注意详情分支传了一串可选标记（二进制、大文件、截断、未跟踪），这些标记全部来自文件对象，视图只负责如实呈现。
    t24 = diffData.files.length === 0 ? <Box marginTop={1}><Text dimColor={true}>{emptyMessage}</Text></Box> : viewMode === "list" ? <Box flexDirection="column" marginTop={1}><DiffFileList files={diffData.files} selectedIndex={selectedIndex} /></Box> : <Box flexDirection="column" marginTop={1}><DiffDetailView filePath={selectedFile?.path || ""} hunks={selectedHunks} isLargeFile={selectedFile?.isLargeFile} isBinary={selectedFile?.isBinary} isTruncated={selectedFile?.isTruncated} isUntracked={selectedFile?.isUntracked} /></Box>;
    $[55] = diffData.files;
    $[56] = emptyMessage;
    $[57] = selectedFile?.isBinary;
    $[58] = selectedFile?.isLargeFile;
    $[59] = selectedFile?.isTruncated;
    $[60] = selectedFile?.isUntracked;
    $[61] = selectedFile?.path;
    $[62] = selectedHunks;
    $[63] = selectedIndex;
    $[64] = viewMode;
    $[65] = t24;
  } else {
    t24 = $[65];
  }
  let t25;
  if ($[66] !== handleCancel || $[67] !== sourceSelector || $[68] !== subtitle || $[69] !== t23 || $[70] !== t24 || $[71] !== title) {
// Dialog 组装：标题、取消、背景色、按键说明，内容依次是切换条、统计、主体。注意切换条与统计都在 Dialog 内、主体之上——它们是「始终可见的上下文」，不随视图模式变。
    t25 = <Dialog title={title} onCancel={handleCancel} color="background" inputGuide={t23}>{sourceSelector}{subtitle}{t24}</Dialog>;
    $[66] = handleCancel;
    $[67] = sourceSelector;
    $[68] = subtitle;
    $[69] = t23;
    $[70] = t24;
    $[71] = title;
    $[72] = t25;
  } else {
    t25 = $[72];
  }
  return t25;
}
function _temp3(prev_1) {
  return Math.max(0, prev_1 - 1);
}
function _temp2(prev) {
  return Math.max(0, prev - 1);
}
function _temp(turn) {
  return {
    type: "turn",
    turn
  };
}
// 原文件此处有一行 31884 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。