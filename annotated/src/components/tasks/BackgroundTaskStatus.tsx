// 后台任务状态条。这个文件是整个「多代理可见性」的入口：它把 AppState 里散落的任务状态收敛成一行 pill，再决定点击后进哪个视图。三个层级要分清——顶层是「队友 pill 条」，次层是「汇总 pill + CTA」，最底层是两个即将早退的空态。
import { c as _c } from "react/compiler-runtime";
// figures 提供跨平台终端符号。它内部对 Windows 的旧版符号做了替换，所以这里不直接写 Unicode 箭头。
import figures from 'figures';
import * as React from 'react';
import { useMemo, useState } from 'react';
// 取终端列宽。这个值决定了 pill 条能显示几个、两侧箭头是否出现，是全文件唯一的布局输入。
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import { stringWidth } from 'src/ink/stringWidth.js';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import { enterTeammateView, exitTeammateView } from 'src/state/teammateViewHelpers.js';
// isPanelAgentTask 在本文件里的唯一用途是被常量折叠掉（见后面的 false 短路），import 还留着。这类残留是编译器产物的常见噪声，判断「功能是否启用」不能只看 import。
import { isPanelAgentTask } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import { getPillLabel, pillNeedsCta } from 'src/tasks/pillLabel.js';
import { type BackgroundTaskState, isBackgroundTask, type TaskState } from 'src/tasks/types.js';
import { calculateHorizontalScrollWindow } from 'src/utils/horizontalScroll.js';
import { Box, Text } from '../../ink.js';
import { AGENT_COLOR_TO_THEME_COLOR, AGENT_COLORS, type AgentColorName } from '../../tools/AgentTool/agentColorManager.js';
import type { Theme } from '../../utils/theme.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
// 隐藏判断单独成模块而不是内联。这类纯函数抽出去是为了可测——终端 UI 的分支很难在测试里真跑一遍渲染。
import { shouldHideTasksFooter } from './taskStatusUtils.js';
type Props = {
  tasksSelected: boolean;
  isViewingTeammate?: boolean;
  teammateFooterIndex?: number;
  isLeaderIdle?: boolean;
  onOpenDialog?: (taskId?: string) => void;
};
// 组件入口，_c(48)。注意 props 全是可选的，除了 tasksSelected——这个组件既能在主界面被选中，也能在查看队友时被复用。
export function BackgroundTaskStatus(t0) {
  const $ = _c(48);
  const {
    tasksSelected,
    isViewingTeammate,
    teammateFooterIndex: t1,
    isLeaderIdle: t2,
    onOpenDialog
  } = t0;
// 默认值就地兜底，而不是写在参数默认值里。编译器会把默认参数改写成显式三目，结果一样但更容易看出「未传时用 0 / false」。
  const teammateFooterIndex = t1 === undefined ? 0 : t1;
  const isLeaderIdle = t2 === undefined ? false : t2;
  const setAppState = useSetAppState();
  const {
    columns
  } = useTerminalSize();
// 选择器是提到模块顶层的函数（_temp），不是内联箭头。这一点很关键：内联箭头每次渲染都是新引用，订阅式状态库会认为「选择器变了」而重复求值甚至重渲染。
  const tasks = useAppState(_temp);
  const viewingAgentTaskId = useAppState(_temp2);
  let t3;
  if ($[0] !== tasks) {
// 过滤出真正的后台任务。_temp3 里那个 false 短路把面板类任务排除了，也就是「编译期已关闭但代码未删」的功能。
    t3 = (Object.values(tasks ?? {}) as TaskState[]).filter(_temp3);
    $[0] = tasks;
    $[1] = t3;
  } else {
    t3 = $[1];
  }
  const runningTasks = t3;
// expandedView 为 teammates 时让位给专门的队友树视图。也就是说同一条状态在两个视图间不会同时显示，避免信息重复。
  const expandedView = useAppState(_temp4);
  const showSpinnerTree = expandedView === "teammates";
  const allTeammates = !showSpinnerTree && runningTasks.length > 0 && runningTasks.every(_temp5);
  let t4;
// 队友条目排序用 localeCompare 而不是默认比较。名字顺序必须稳定，否则每帧重排会让 pill 左右跳、用户点不中。
  if ($[2] !== runningTasks) {
    t4 = runningTasks.filter(_temp6).sort(_temp7);
    $[2] = runningTasks;
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  const teammateEntries = t4;
  let t5;
// mainPill 是一个伪条目：代表主代理，没有 taskId。因此它点击后走的是「退出队友视图」而不是「进入某个队友」，后面的三元靠 taskId 是否存在来分流。
  if ($[4] !== isLeaderIdle) {
    t5 = {
      name: "main",
      color: undefined as keyof Theme | undefined,
      isIdle: isLeaderIdle,
      taskId: undefined as string | undefined
    };
    $[4] = isLeaderIdle;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  const mainPill = t5;
  let t6;
  if ($[6] !== mainPill || $[7] !== tasksSelected || $[8] !== teammateEntries) {
    const teammatePills = teammateEntries.map(_temp8);
// 未选中导航时把空闲队友排到后面——视觉上让正在干活的人优先出现。选中时（用户在用方向键浏览）则不重排，否则焦点会跳走。
    if (!tasksSelected) {
      teammatePills.sort(_temp9);
    }
    const pills = [mainPill, ...teammatePills];
    t6 = pills.map(_temp0);
    $[6] = mainPill;
    $[7] = tasksSelected;
    $[8] = teammateEntries;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  const allPills = t6;
  let t7;
// pill 宽度单独预计算。@名字 的宽度用 stringWidth 而不是 length：中文名与 emoji 在终端占两列，用 length 会算少一半，导致滚动窗口裁错。
  if ($[10] !== allPills) {
    t7 = allPills.map(_temp1);
    $[10] = allPills;
    $[11] = t7;
  } else {
    t7 = $[11];
  }
  const pillWidths = t7;
// 进入 pill 条模式的两个条件：全是队友（没有普通后台任务），或者正在查看某个队友。后者保证「我在看谁」这条信息始终有一条路径回到主视图。
  if (allTeammates || !showSpinnerTree && isViewingTeammate) {
    const selectedIdx = tasksSelected ? teammateFooterIndex : -1;
    let t8;
    if ($[12] !== teammateEntries || $[13] !== viewingAgentTaskId) {
// viewedIdx 从 viewingAgentTaskId 查表后加一。这个加一是全文件最容易错的一行：0 号位被 mainPill 占了，所以队友的下标整体右移一格。
      t8 = viewingAgentTaskId ? teammateEntries.findIndex(t_3 => t_3.id === viewingAgentTaskId) + 1 : 0;
      $[12] = teammateEntries;
      $[13] = viewingAgentTaskId;
      $[14] = t8;
    } else {
      t8 = $[14];
    }
    const viewedIdx = t8;
// 可用宽度里减 20 与 4 是给两侧箭头和快捷键提示预留的；下限 20 是防极窄终端算出空窗口后整条 bar 消失。
    const availableWidth = Math.max(20, columns - 20 - 4);
    const t9 = selectedIdx >= 0 ? selectedIdx : 0;
    let t10;
    if ($[15] !== availableWidth || $[16] !== pillWidths || $[17] !== t9) {
// 滚动窗口的计算下沉到通用函数，本文件只负责传参。第三个参数 2 是左右各留的余量，保证边缘 pill 不会贴着箭头。
      t10 = calculateHorizontalScrollWindow(pillWidths, availableWidth, 2, t9);
      $[15] = availableWidth;
      $[16] = pillWidths;
      $[17] = t9;
      $[18] = t10;
    } else {
      t10 = $[18];
    }
    const {
      startIndex,
      endIndex,
      showLeftArrow,
      showRightArrow
    } = t10;
    let t11;
    if ($[19] !== allPills || $[20] !== endIndex || $[21] !== startIndex) {
      t11 = allPills.slice(startIndex, endIndex);
      $[19] = allPills;
      $[20] = endIndex;
      $[21] = startIndex;
      $[22] = t11;
    } else {
      t11 = $[22];
    }
    const visiblePills = t11;
    let t12;
    if ($[23] !== showLeftArrow) {
      t12 = showLeftArrow && <Text dimColor={true}>{figures.arrowLeft} </Text>;
      $[23] = showLeftArrow;
      $[24] = t12;
    } else {
      t12 = $[24];
    }
    let t13;
    if ($[25] !== selectedIdx || $[26] !== setAppState || $[27] !== viewedIdx || $[28] !== visiblePills) {
// 每个 pill 用 Fragment 包并挂 key=名字。key 用名字而不是下标，因为窗口滑动时下标会变、名字不变，这样才能复用节点。
      t13 = visiblePills.map((pill_1, i_1) => {
        const needsSeparator = i_1 > 0;
// 点击语义二合一：有 taskId 就 enterTeammateView，没有（即 mainPill）就 exitTeammateView。分隔空格用前置而不是后置，避免最后一个 pill 后面多一个空格。
        return <React.Fragment key={pill_1.name}>{needsSeparator && <Text> </Text>}<AgentPill name={pill_1.name} color={pill_1.color} isSelected={selectedIdx === pill_1.idx} isViewed={viewedIdx === pill_1.idx} isIdle={pill_1.isIdle} onClick={() => pill_1.taskId ? enterTeammateView(pill_1.taskId, setAppState) : exitTeammateView(setAppState)} /></React.Fragment>;
      });
      $[25] = selectedIdx;
      $[26] = setAppState;
      $[27] = viewedIdx;
      $[28] = visiblePills;
      $[29] = t13;
    } else {
      t13 = $[29];
    }
    let t14;
    if ($[30] !== showRightArrow) {
      t14 = showRightArrow && <Text dimColor={true}> {figures.arrowRight}</Text>;
      $[30] = showRightArrow;
      $[31] = t14;
    } else {
      t14 = $[31];
    }
    let t15;
// 快捷键提示是纯常量，用哨兵缓存。提示文案里写死了 shift+方向下，与真实键位处理在别处——两处不同步是这类提示最常见的失效原因。
    if ($[32] === Symbol.for("react.memo_cache_sentinel")) {
      t15 = <Text dimColor={true}>{" \xB7 "}<KeyboardShortcutHint shortcut={"shift + \u2193"} action="expand" /></Text>;
      $[32] = t15;
    } else {
      t15 = $[32];
    }
    let t16;
    if ($[33] !== t12 || $[34] !== t13 || $[35] !== t14) {
      t16 = <>{t12}{t13}{t14}{t15}</>;
      $[33] = t12;
      $[34] = t13;
      $[35] = t14;
      $[36] = t16;
    } else {
      t16 = $[36];
    }
    return t16;
  }
// 不显示 pill 条时的两条早退：先问「这个场景是否根本不该有 footer」，再问「有没有运行中的任务」。顺序不能反，前者是策略、后者是数据。
  if (shouldHideTasksFooter(tasks ?? {}, showSpinnerTree)) {
    return null;
  }
  if (runningTasks.length === 0) {
    return null;
  }
  let t8;
// 汇总文案只依赖 runningTasks，缓存一次。getPillLabel 负责把多个任务压成一句话，属于典型的「展示层决策下沉到纯函数」。
  if ($[37] !== runningTasks) {
    t8 = getPillLabel(runningTasks);
    $[37] = runningTasks;
    $[38] = t8;
  } else {
    t8 = $[38];
  }
  let t9;
  if ($[39] !== onOpenDialog || $[40] !== t8 || $[41] !== tasksSelected) {
    t9 = <SummaryPill selected={tasksSelected} onClick={onOpenDialog}>{t8}</SummaryPill>;
    $[39] = onOpenDialog;
    $[40] = t8;
    $[41] = tasksSelected;
    $[42] = t9;
  } else {
    t9 = $[42];
  }
  let t10;
  if ($[43] !== runningTasks) {
// 只有 pillNeedsCta 为真才追加「按方向下查看」的提示。常年挂着一条用不上的提示，反而会让用户忽略它。
    t10 = pillNeedsCta(runningTasks) && <Text dimColor={true}> · {figures.arrowDown} to view</Text>;
    $[43] = runningTasks;
    $[44] = t10;
  } else {
    t10 = $[44];
  }
  let t11;
  if ($[45] !== t10 || $[46] !== t9) {
    t11 = <>{t9}{t10}</>;
    $[45] = t10;
    $[46] = t9;
    $[47] = t11;
  } else {
    t11 = $[47];
  }
  return t11;
}
function _temp1(pill_0, i_0) {
  const pillText = `@${pill_0.name}`;
  return stringWidth(pillText) + (i_0 > 0 ? 1 : 0);
}
function _temp0(pill, i) {
  return {
    ...pill,
    idx: i
  };
}
function _temp9(a_0, b_0) {
  if (a_0.isIdle !== b_0.isIdle) {
    return a_0.isIdle ? 1 : -1;
  }
  return 0;
}
function _temp8(t_2) {
  return {
    name: t_2.identity.agentName,
    color: getAgentThemeColor(t_2.identity.color),
    isIdle: t_2.isIdle,
    taskId: t_2.id
  };
}
function _temp7(a, b) {
  return a.identity.agentName.localeCompare(b.identity.agentName);
}
function _temp6(t_1) {
  return t_1.type === "in_process_teammate";
}
function _temp5(t_0) {
  return t_0.type === "in_process_teammate";
}
function _temp4(s_1) {
  return s_1.expandedView;
}
// 这一行是常量折叠的现场证据：false 与 isPanelAgentTask 的短路保住了 import，却永远不会执行。读泄露源码时，这种写法通常意味着功能被开关关掉、代码留着待恢复。
function _temp3(t) {
  return isBackgroundTask(t) && !(false && isPanelAgentTask(t));
}
function _temp2(s_0) {
  return s_0.viewingAgentTaskId;
}
function _temp(s) {
  return s.tasks;
}
type AgentPillProps = {
  name: string;
  color?: keyof Theme;
  isSelected: boolean;
  isViewed: boolean;
  isIdle: boolean;
  onClick?: () => void;
};
// AgentPill：一个 pill 的四层视觉优先级，从高到低是「选中或悬停」「正在查看」「空闲」「普通」。层数这么多，本质是因为终端里可用的表达手段只有颜色、反白、加粗、暗淡四种。
function AgentPill(t0) {
  const $ = _c(19);
  const {
    name,
    color,
    isSelected,
    isViewed,
    isIdle,
    onClick
  } = t0;
  const [hover, setHover] = useState(false);
// highlighted 把键盘选中与鼠标悬停合并成同一视觉。这是有意取舍：终端里鼠标事件本就不可靠，不必为两种输入设计两套样式。
  const highlighted = isSelected || hover;
  let label;
  if (highlighted) {
    let t1;
    if ($[0] !== color || $[1] !== isViewed || $[2] !== name) {
      t1 = color ? <Text backgroundColor={color} color="inverseText" bold={isViewed}>@{name}</Text> : <Text color="background" inverse={true} bold={isViewed}>@{name}</Text>;
      $[0] = color;
      $[1] = isViewed;
      $[2] = name;
      $[3] = t1;
    } else {
      t1 = $[3];
    }
    label = t1;
  } else {
// 未选中且空闲：整体暗淡，只保留粗体表示「我正在看它」。注意这里不看 color——空闲态刻意抹掉身份色，让忙碌的人更显眼。
    if (isIdle) {
      let t1;
      if ($[4] !== isViewed || $[5] !== name) {
        t1 = <Text dimColor={true} bold={isViewed}>@{name}</Text>;
        $[4] = isViewed;
        $[5] = name;
        $[6] = t1;
      } else {
        t1 = $[6];
      }
      label = t1;
    } else {
      if (isViewed) {
        let t1;
        if ($[7] !== color || $[8] !== name) {
          t1 = <Text color={color} bold={true}>@{name}</Text>;
          $[7] = color;
          $[8] = name;
          $[9] = t1;
        } else {
          t1 = $[9];
        }
        label = t1;
      } else {
        const t1 = !color;
        let t2;
        if ($[10] !== color || $[11] !== name || $[12] !== t1) {
          t2 = <Text color={color} dimColor={t1}>@{name}</Text>;
          $[10] = color;
          $[11] = name;
          $[12] = t1;
          $[13] = t2;
        } else {
          t2 = $[13];
        }
        label = t2;
      }
    }
  }
  if (!onClick) {
    return label;
  }
  let t1;
  let t2;
// 悬停回调用哨兵缓存。若每帧新建函数，Box 的 onMouseEnter 引用就变，某些终端实现会因此重挂整棵子树。
  if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => setHover(true);
    t2 = () => setHover(false);
    $[14] = t1;
    $[15] = t2;
  } else {
    t1 = $[14];
    t2 = $[15];
  }
  let t3;
  if ($[16] !== label || $[17] !== onClick) {
    t3 = <Box onClick={onClick} onMouseEnter={t1} onMouseLeave={t2}>{label}</Box>;
    $[16] = label;
    $[17] = onClick;
    $[18] = t3;
  } else {
    t3 = $[18];
  }
  return t3;
}
function SummaryPill(t0) {
  const $ = _c(8);
  const {
    selected,
    onClick,
    children
  } = t0;
  const [hover, setHover] = useState(false);
  const t1 = selected || hover;
  let t2;
  if ($[0] !== children || $[1] !== t1) {
    t2 = <Text color="background" inverse={t1}>{children}</Text>;
    $[0] = children;
    $[1] = t1;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const label = t2;
  if (!onClick) {
    return label;
  }
  let t3;
  let t4;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = () => setHover(true);
    t4 = () => setHover(false);
    $[3] = t3;
    $[4] = t4;
  } else {
    t3 = $[3];
    t4 = $[4];
  }
  let t5;
  if ($[5] !== label || $[6] !== onClick) {
    t5 = <Box onClick={onClick} onMouseEnter={t3} onMouseLeave={t4}>{label}</Box>;
    $[5] = label;
    $[6] = onClick;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  return t5;
}
// 颜色解析：先确认是已知代理色名，再查映射表，未知一律返回 undefined 走默认色。这层 indirection 让组件不必知道主题色名，代理配色表可以独立演进。
function getAgentThemeColor(colorName: string | undefined): keyof Theme | undefined {
  if (!colorName) return undefined;
  if (AGENT_COLORS.includes(colorName as AgentColorName)) {
    return AGENT_COLOR_TO_THEME_COLOR[colorName as AgentColorName];
  }
  return undefined;
}
// 原文件此处有一行 31848 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。