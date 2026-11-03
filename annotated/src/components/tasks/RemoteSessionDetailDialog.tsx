// 远程会话详情对话框。一个文件里按会话类型分成三个视图：ultraplan（规划中）、ultrareview（代码审查，带阶段流水线）、以及通用会话（状态、链接、最近消息、传送到本地）。顶层函数只做分派，三个视图各自维护自己的菜单与确认态。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React, { useMemo, useState } from 'react';
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js';
import type { ToolUseContext } from 'src/Tool.js';
import type { DeepImmutable } from 'src/types/utils.js';
import type { CommandResultDisplay } from '../../commands.js';
import { DIAMOND_FILLED, DIAMOND_OPEN } from '../../constants/figures.js';
import { useElapsedTime } from '../../hooks/useElapsedTime.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Link, Text } from '../../ink.js';
import type { RemoteAgentTaskState } from '../../tasks/RemoteAgentTask/RemoteAgentTask.js';
import { getRemoteTaskSessionUrl } from '../../tasks/RemoteAgentTask/RemoteAgentTask.js';
import { AGENT_TOOL_NAME, LEGACY_AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js';
import { ASK_USER_QUESTION_TOOL_NAME } from '../../tools/AskUserQuestionTool/prompt.js';
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../../tools/ExitPlanModeTool/constants.js';
import { openBrowser } from '../../utils/browser.js';
import { errorMessage } from '../../utils/errors.js';
import { formatDuration, truncateToWidth } from '../../utils/format.js';
import { toInternalMessages } from '../../utils/messages/mappers.js';
import { EMPTY_LOOKUPS, normalizeMessages } from '../../utils/messages.js';
import { plural } from '../../utils/stringUtils.js';
import { teleportResumeCodeSession } from '../../utils/teleport.js';
import { Select } from '../CustomSelect/select.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { Message } from '../Message.js';
import { formatReviewStageCounts, RemoteSessionProgress } from './RemoteSessionProgress.js';
// 入参。`onDone` 接收一句回执文本（写进对话记录），`onBack` 是「回到上一级列表」——注意它只出现在从列表进入的路径上，从其他入口打开时没有这一级，于是 `onBack` 为空，菜单里就不出「返回」这一项。
type Props = {
  session: DeepImmutable<RemoteAgentTaskState>;
  toolUseContext: ToolUseContext;
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  onBack?: () => void;
  onKill?: () => void;
};

// 把一次工具调用压成一行摘要，给「最近一次工具调用」那一行用。比走工具注册表再渲染要轻得多（不查表、不解析 schema），代价是只认几种常见形态。
// Compact one-line summary: tool name + first meaningful string arg.
// Lighter than tool.renderToolUseMessage (no registry lookup / schema parse).
// Collapses whitespace so multi-line inputs (e.g. Bash command text)
// render on one line.
// 实现。三个特殊分支依次是：退出规划模式（阶段名本身就是动作，直接给一句人话）、提问工具（把问题正文当行动号召，比那个最多 12 字的标签有用）、其余则取输入里第一个非空字符串参数。空白都折叠成单空格，多行命令也能压成一行。
export function formatToolUseSummary(name: string, input: unknown): string {
  // plan_ready phase is only reached via ExitPlanMode tool
  if (name === EXIT_PLAN_MODE_V2_TOOL_NAME) {
    return 'Review the plan in Claude Code on the web';
  }
  if (!input || typeof input !== 'object') return name;
  // AskUserQuestion: show the question text as a CTA, not the tool name.
  // Input shape is {questions: [{question, header, options}]}.
// 提问工具的分支。取字段的顺序是先正文后标签：标签是必填字段，先判标签会让正文的兜底成为死代码——所以正文优先，标签只在正文缺失时顶上。
  if (name === ASK_USER_QUESTION_TOOL_NAME && 'questions' in input) {
    const qs = input.questions;
    if (Array.isArray(qs) && qs[0] && typeof qs[0] === 'object') {
      // Prefer question (full text) over header (max-12-char tag). header
      // is a required schema field so checking it first would make the
      // question fallback dead code.
      const q = 'question' in qs[0] && typeof qs[0].question === 'string' && qs[0].question ? qs[0].question : 'header' in qs[0] && typeof qs[0].header === 'string' ? qs[0].header : null;
      if (q) {
        const oneLine = q.replace(/\s+/g, ' ').trim();
        return `Answer in browser: ${truncateToWidth(oneLine, 50)}`;
      }
    }
  }
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.trim()) {
      const oneLine = v.replace(/\s+/g, ' ').trim();
      return `${name} ${truncateToWidth(oneLine, 60)}`;
    }
  }
  return name;
}
// 阶段到显示文案的映射。取的是「输入待补」与「规划就绪」两种非终态；真正的运行中与已结束走的是状态字段本身，所以这里只有两项。
const PHASE_LABEL = {
  needs_input: 'input required',
  plan_ready: 'ready'
} as const;
const AGENT_VERB = {
  needs_input: 'waiting',
  plan_ready: 'done'
} as const;
// ultraplan 视图。它读的是会话日志本身：遍历所有助手消息里的工具调用块，边数边记最后一个。这个视图不需要完整的消息归一化，所以顶层干脆跳过了那一步。
function UltraplanSessionDetail(t0) {
  const $ = _c(70);
  const {
    session,
    onDone,
    onBack,
    onKill
  } = t0;
// 运行中判定把 pending 也算进去——从云端角度看排队和启动中是一回事，用户看到的是「还在跑」。阶段只在运行时参与状态文案，结束之后一律显示状态字段。
  const running = session.status === "running" || session.status === "pending";
  const phase = session.ultraplanPhase;
  const statusText = running ? phase ? PHASE_LABEL[phase] : "running" : session.status;
  const elapsedTime = useElapsedTime(session.startTime, running, 1000, 0, session.endTime);
  let spawns = 0;
  let calls = 0;
  let lastBlock = null;
// 日志扫描。只数助手消息里的工具调用块：总数进「工具调用」，名字命中代理工具（含旧名）的进「派生代理数」，最后那个块留着做一行摘要。
  for (const msg of session.log) {
    if (msg.type !== "assistant") {
      continue;
    }
    for (const block of msg.message.content) {
      if (block.type !== "tool_use") {
        continue;
      }
      calls++;
      lastBlock = block;
      if (block.name === AGENT_TOOL_NAME || block.name === LEGACY_AGENT_TOOL_NAME) {
        spawns++;
      }
    }
  }
// 工作代理数是派生数加一——主代理本身也算一个在干活。这个加一容易在重构时丢掉，丢掉之后只派生了一个代理的会话会显示成「1 agent」而不是「2 agents」。
  const t1 = 1 + spawns;
  let t2;
  if ($[0] !== lastBlock) {
    t2 = lastBlock ? formatToolUseSummary(lastBlock.name, lastBlock.input) : null;
    $[0] = lastBlock;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] !== calls || $[3] !== t1 || $[4] !== t2) {
    t3 = {
      agentsWorking: t1,
      toolCalls: calls,
      lastToolCall: t2
    };
    $[2] = calls;
    $[3] = t1;
    $[4] = t2;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const {
    agentsWorking,
    toolCalls,
    lastToolCall
  } = t3;
  let t4;
  if ($[6] !== session.sessionId) {
    t4 = getRemoteTaskSessionUrl(session.sessionId);
    $[6] = session.sessionId;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  const sessionUrl = t4;
  let t5;
  if ($[8] !== onBack || $[9] !== onDone) {
    t5 = onBack ?? (() => onDone("Remote session details dismissed", {
      display: "system"
    }));
    $[8] = onBack;
    $[9] = onDone;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  const goBackOrClose = t5;
// 停止确认与「返回或关闭」。这里的兜底很关键：从列表进来的路径有 `onBack`，从其他入口打开时为空，那就退化成关闭（并写一句回执）。停止确认走的是二次确认弹窗，选终止才真正杀会话，选返回只是收起确认框。
  const [confirmingStop, setConfirmingStop] = useState(false);
  if (confirmingStop) {
    let t6;
    if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
      t6 = () => setConfirmingStop(false);
      $[11] = t6;
    } else {
      t6 = $[11];
    }
    let t7;
    if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
      t7 = <Text dimColor={true}>This will terminate the Claude Code on the web session.</Text>;
      $[12] = t7;
    } else {
      t7 = $[12];
    }
    let t8;
    if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
      t8 = {
        label: "Terminate session",
        value: "stop" as const
      };
      $[13] = t8;
    } else {
      t8 = $[13];
    }
    let t9;
    if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
      t9 = [t8, {
        label: "Back",
        value: "back" as const
      }];
      $[14] = t9;
    } else {
      t9 = $[14];
    }
    let t10;
    if ($[15] !== goBackOrClose || $[16] !== onKill) {
      t10 = <Dialog title="Stop ultraplan?" onCancel={t6} color="background"><Box flexDirection="column" gap={1}>{t7}<Select options={t9} onChange={v => {
            if (v === "stop") {
              onKill?.();
              goBackOrClose();
            } else {
              setConfirmingStop(false);
            }
          }} /></Box></Dialog>;
      $[15] = goBackOrClose;
      $[16] = onKill;
      $[17] = t10;
    } else {
      t10 = $[17];
    }
    return t10;
  }
  const t6 = phase === "plan_ready" ? DIAMOND_FILLED : DIAMOND_OPEN;
  let t7;
  if ($[18] !== t6) {
    t7 = <Text color="background">{t6}{" "}</Text>;
    $[18] = t6;
    $[19] = t7;
  } else {
    t7 = $[19];
  }
  let t8;
  if ($[20] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Text bold={true}>ultraplan</Text>;
    $[20] = t8;
  } else {
    t8 = $[20];
  }
  let t9;
  if ($[21] !== elapsedTime || $[22] !== statusText) {
    t9 = <Text dimColor={true}>{" \xB7 "}{elapsedTime}{" \xB7 "}{statusText}</Text>;
    $[21] = elapsedTime;
    $[22] = statusText;
    $[23] = t9;
  } else {
    t9 = $[23];
  }
  let t10;
  if ($[24] !== t7 || $[25] !== t9) {
    t10 = <Text>{t7}{t8}{t9}</Text>;
    $[24] = t7;
    $[25] = t9;
    $[26] = t10;
  } else {
    t10 = $[26];
  }
  let t11;
  if ($[27] !== phase) {
    t11 = phase === "plan_ready" && <Text color="success">{figures.tick} </Text>;
    $[27] = phase;
    $[28] = t11;
  } else {
    t11 = $[28];
  }
  let t12;
  if ($[29] !== agentsWorking) {
    t12 = plural(agentsWorking, "agent");
    $[29] = agentsWorking;
    $[30] = t12;
  } else {
    t12 = $[30];
  }
  const t13 = phase ? AGENT_VERB[phase] : "working";
  let t14;
  if ($[31] !== toolCalls) {
    t14 = plural(toolCalls, "call");
    $[31] = toolCalls;
    $[32] = t14;
  } else {
    t14 = $[32];
  }
  let t15;
  if ($[33] !== agentsWorking || $[34] !== t11 || $[35] !== t12 || $[36] !== t13 || $[37] !== t14 || $[38] !== toolCalls) {
    t15 = <Text>{t11}{agentsWorking} {t12}{" "}{t13} · {toolCalls} tool{" "}{t14}</Text>;
    $[33] = agentsWorking;
    $[34] = t11;
    $[35] = t12;
    $[36] = t13;
    $[37] = t14;
    $[38] = toolCalls;
    $[39] = t15;
  } else {
    t15 = $[39];
  }
  let t16;
  if ($[40] !== lastToolCall) {
    t16 = lastToolCall && <Text dimColor={true}>{lastToolCall}</Text>;
    $[40] = lastToolCall;
    $[41] = t16;
  } else {
    t16 = $[41];
  }
  let t17;
  if ($[42] !== sessionUrl) {
    t17 = <Text dimColor={true}>{sessionUrl}</Text>;
    $[42] = sessionUrl;
    $[43] = t17;
  } else {
    t17 = $[43];
  }
  let t18;
  if ($[44] !== sessionUrl || $[45] !== t17) {
    t18 = <Link url={sessionUrl}>{t17}</Link>;
    $[44] = sessionUrl;
    $[45] = t17;
    $[46] = t18;
  } else {
    t18 = $[46];
  }
  let t19;
  if ($[47] === Symbol.for("react.memo_cache_sentinel")) {
    t19 = {
      label: "Review in Claude Code on the web",
      value: "open" as const
    };
    $[47] = t19;
  } else {
    t19 = $[47];
  }
  let t20;
  if ($[48] !== onKill || $[49] !== running) {
    t20 = onKill && running ? [{
      label: "Stop ultraplan",
      value: "stop" as const
    }] : [];
    $[48] = onKill;
    $[49] = running;
    $[50] = t20;
  } else {
    t20 = $[50];
  }
  let t21;
  if ($[51] === Symbol.for("react.memo_cache_sentinel")) {
    t21 = {
      label: "Back",
      value: "back" as const
    };
    $[51] = t21;
  } else {
    t21 = $[51];
  }
  let t22;
  if ($[52] !== t20) {
    t22 = [t19, ...t20, t21];
    $[52] = t20;
    $[53] = t22;
  } else {
    t22 = $[53];
  }
  let t23;
  if ($[54] !== goBackOrClose || $[55] !== onDone || $[56] !== sessionUrl) {
    t23 = v_0 => {
      switch (v_0) {
        case "open":
          {
            openBrowser(sessionUrl);
            onDone();
            return;
          }
        case "stop":
          {
            setConfirmingStop(true);
            return;
          }
        case "back":
          {
            goBackOrClose();
            return;
          }
      }
    };
    $[54] = goBackOrClose;
    $[55] = onDone;
    $[56] = sessionUrl;
    $[57] = t23;
  } else {
    t23 = $[57];
  }
  let t24;
  if ($[58] !== t22 || $[59] !== t23) {
    t24 = <Select options={t22} onChange={t23} />;
    $[58] = t22;
    $[59] = t23;
    $[60] = t24;
  } else {
    t24 = $[60];
  }
  let t25;
  if ($[61] !== t15 || $[62] !== t16 || $[63] !== t18 || $[64] !== t24) {
    t25 = <Box flexDirection="column" gap={1}>{t15}{t16}{t18}{t24}</Box>;
    $[61] = t15;
    $[62] = t16;
    $[63] = t18;
    $[64] = t24;
    $[65] = t25;
  } else {
    t25 = $[65];
  }
  let t26;
  if ($[66] !== goBackOrClose || $[67] !== t10 || $[68] !== t25) {
    t26 = <Dialog title={t10} onCancel={goBackOrClose} color="background">{t25}</Dialog>;
    $[66] = goBackOrClose;
    $[67] = t10;
    $[68] = t25;
    $[69] = t26;
  } else {
    t26 = $[69];
  }
  return t26;
}
// 审查流水线的三个阶段。顺序即进度：找、验、去重。
const STAGES = ['finding', 'verifying', 'synthesizing'] as const;
const STAGE_LABELS: Record<(typeof STAGES)[number], string> = {
  finding: 'Find',
  verifying: 'Verify',
  synthesizing: 'Dedupe'
};

// 阶段流水线的渲染规则：当前阶段用高亮色，其余暗色；全部完成时所有阶段转暗并追加一个绿色对勾；「准备中」在协调器写下第一份进度快照之前显示（容器启动加仓库克隆那段时间），否则界面上的「0 个发现」会让人以为找问题的环节卡死了。
// Setup → Find → Verify → Dedupe pipeline. Current stage in cloud teal,
// rest dim. When completed, all stages dim with a trailing green ✓. The
// "Setup" label shows before the orchestrator writes its first progress
// snapshot (container boot + repo clone), so the 0-found display doesn't
// look like a hung finder.
// 流水线组件。它只依赖三个值：当前阶段、是否完成、是否有进度数据。
function StagePipeline(t0) {
  const $ = _c(15);
  const {
    stage,
    completed,
    hasProgress
  } = t0;
  let t1;
  if ($[0] !== stage) {
    t1 = stage ? STAGES.indexOf(stage) : -1;
    $[0] = stage;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const currentIdx = t1;
// 「准备中」的判定：既没完成也没有任何进度数据。注意它不能只判「阶段为空」——阶段为空也可能是已完成（协调器没写阶段字段），那样会把已完成的会话显示成启动中。
  const inSetup = !completed && !hasProgress;
  let t2;
  if ($[2] !== inSetup) {
    t2 = inSetup ? <Text color="background">Setup</Text> : <Text dimColor={true}>Setup</Text>;
    $[2] = inSetup;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text dimColor={true}> → </Text>;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== completed || $[6] !== currentIdx || $[7] !== inSetup) {
    t4 = STAGES.map((s, i) => {
      const isCurrent = !completed && !inSetup && i === currentIdx;
      return <React.Fragment key={s}>{i > 0 && <Text dimColor={true}> → </Text>}{isCurrent ? <Text color="background">{STAGE_LABELS[s]}</Text> : <Text dimColor={true}>{STAGE_LABELS[s]}</Text>}</React.Fragment>;
    });
    $[5] = completed;
    $[6] = currentIdx;
    $[7] = inSetup;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let t5;
  if ($[9] !== completed) {
    t5 = completed && <Text color="success"> ✓</Text>;
    $[9] = completed;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== t2 || $[12] !== t4 || $[13] !== t5) {
    t6 = <Text>{t2}{t3}{t4}{t5}</Text>;
    $[11] = t2;
    $[12] = t4;
    $[13] = t5;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  return t6;
}

// 阶段相关的计数行。运行中交给共享的格式化函数（与外面那个进度条用同一份），避免两个视图各写一套而漂移；已完成状态是这个对话框独有的，改成发现总数汇总。
// Stage-appropriate counts line. Running-state formatting delegates to
// formatReviewStageCounts (shared with the pill) so the two views can't
// drift; completed state is dialog-specific (findings summary).
// 实现。没有进度数据时不能声称「0 个发现」——协调器根本没写过快照，那是「不知道」而不是「零」，所以只回一句完成的通用文案。有数据时已完成显示「N 个发现（可能还有 M 个被否证）」，运行中按阶段交给共享函数。
function reviewCountsLine(session: DeepImmutable<RemoteAgentTaskState>): string {
  const p = session.reviewProgress;
  // No progress data — the orchestrator never wrote a snapshot. Don't
  // claim "0 findings" when completed; we just don't know.
  if (!p) return session.status === 'completed' ? 'done' : 'setting up';
  const verified = p.bugsVerified;
  const refuted = p.bugsRefuted ?? 0;
  if (session.status === 'completed') {
    const parts = [`${verified} ${plural(verified, 'finding')}`];
    if (refuted > 0) parts.push(`${refuted} refuted`);
    return parts.join(' · ');
  }
  return formatReviewStageCounts(p.stage, p.bugsFound, verified, refuted);
}
// 菜单动作的取值集合。四个动作覆盖三种结局：打开浏览器、终止会话、返回上级、关闭对话框。
type MenuAction = 'open' | 'stop' | 'back' | 'dismiss';
// ultrareview 视图。骨架与 ultraplan 同构：状态行、阶段流水线、计数行、会话链接、菜单。差别在菜单随完成态变化——完成后只剩打开与关闭，运行中才有终止。
function ReviewSessionDetail(t0) {
  const $ = _c(56);
  const {
    session,
    onDone,
    onBack,
    onKill
  } = t0;
// 状态派生的三个布尔量。完成与运行中互斥（pending 归到运行中），用于选择菱形图标的实心与否、菜单项集合、以及计时器是否继续走。
  const completed = session.status === "completed";
  const running = session.status === "running" || session.status === "pending";
  const [confirmingStop, setConfirmingStop] = useState(false);
  const elapsedTime = useElapsedTime(session.startTime, running, 1000, 0, session.endTime);
  let t1;
  if ($[0] !== onDone) {
    t1 = () => onDone("Remote session details dismissed", {
      display: "system"
    });
    $[0] = onDone;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const handleClose = t1;
  const goBackOrClose = onBack ?? handleClose;
  let t2;
  if ($[2] !== session.sessionId) {
    t2 = getRemoteTaskSessionUrl(session.sessionId);
    $[2] = session.sessionId;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const sessionUrl = t2;
  const statusLabel = completed ? "ready" : running ? "running" : session.status;
  if (confirmingStop) {
    let t3;
    if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = () => setConfirmingStop(false);
      $[4] = t3;
    } else {
      t3 = $[4];
    }
    let t4;
    if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Text dimColor={true}>This archives the remote session and stops local tracking. The review will not complete and any findings so far are discarded.</Text>;
      $[5] = t4;
    } else {
      t4 = $[5];
    }
    let t5;
    if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = {
        label: "Stop ultrareview",
        value: "stop" as const
      };
      $[6] = t5;
    } else {
      t5 = $[6];
    }
    let t6;
    if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
      t6 = [t5, {
        label: "Back",
        value: "back" as const
      }];
      $[7] = t6;
    } else {
      t6 = $[7];
    }
    let t7;
    if ($[8] !== goBackOrClose || $[9] !== onKill) {
      t7 = <Dialog title="Stop ultrareview?" onCancel={t3} color="background"><Box flexDirection="column" gap={1}>{t4}<Select options={t6} onChange={v => {
            if (v === "stop") {
              onKill?.();
              goBackOrClose();
            } else {
              setConfirmingStop(false);
            }
          }} /></Box></Dialog>;
      $[8] = goBackOrClose;
      $[9] = onKill;
      $[10] = t7;
    } else {
      t7 = $[10];
    }
    return t7;
  }
  let t3;
  if ($[11] !== completed || $[12] !== onKill || $[13] !== running) {
    t3 = completed ? [{
      label: "Open in Claude Code on the web",
      value: "open"
    }, {
      label: "Dismiss",
      value: "dismiss"
    }] : [{
      label: "Open in Claude Code on the web",
      value: "open"
    }, ...(onKill && running ? [{
      label: "Stop ultrareview",
      value: "stop" as const
    }] : []), {
      label: "Back",
      value: "back"
    }];
    $[11] = completed;
    $[12] = onKill;
    $[13] = running;
    $[14] = t3;
  } else {
    t3 = $[14];
  }
  const options = t3;
  let t4;
  if ($[15] !== goBackOrClose || $[16] !== handleClose || $[17] !== onDone || $[18] !== sessionUrl) {
    t4 = action => {
      bb45: switch (action) {
        case "open":
          {
            openBrowser(sessionUrl);
            onDone();
            break bb45;
          }
        case "stop":
          {
            setConfirmingStop(true);
            break bb45;
          }
        case "back":
          {
            goBackOrClose();
            break bb45;
          }
        case "dismiss":
          {
            handleClose();
          }
      }
    };
    $[15] = goBackOrClose;
    $[16] = handleClose;
    $[17] = onDone;
    $[18] = sessionUrl;
    $[19] = t4;
  } else {
    t4 = $[19];
  }
  const handleSelect = t4;
  const t5 = completed ? DIAMOND_FILLED : DIAMOND_OPEN;
  let t6;
  if ($[20] !== t5) {
    t6 = <Text color="background">{t5}{" "}</Text>;
    $[20] = t5;
    $[21] = t6;
  } else {
    t6 = $[21];
  }
  let t7;
  if ($[22] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Text bold={true}>ultrareview</Text>;
    $[22] = t7;
  } else {
    t7 = $[22];
  }
  let t8;
  if ($[23] !== elapsedTime || $[24] !== statusLabel) {
    t8 = <Text dimColor={true}>{" \xB7 "}{elapsedTime}{" \xB7 "}{statusLabel}</Text>;
    $[23] = elapsedTime;
    $[24] = statusLabel;
    $[25] = t8;
  } else {
    t8 = $[25];
  }
  let t9;
  if ($[26] !== t6 || $[27] !== t8) {
    t9 = <Text>{t6}{t7}{t8}</Text>;
    $[26] = t6;
    $[27] = t8;
    $[28] = t9;
  } else {
    t9 = $[28];
  }
// 从会话里取阶段与「是否有进度」，直接透传给流水线。注意这里是取值而不是判断真假：`undefined` 与某个真实阶段对流水线的含义不同，前者是「还没开始」，后者是高亮位置。
  const t10 = session.reviewProgress?.stage;
  const t11 = !!session.reviewProgress;
  let t12;
  if ($[29] !== completed || $[30] !== t10 || $[31] !== t11) {
    t12 = <StagePipeline stage={t10} completed={completed} hasProgress={t11} />;
    $[29] = completed;
    $[30] = t10;
    $[31] = t11;
    $[32] = t12;
  } else {
    t12 = $[32];
  }
  let t13;
  if ($[33] !== session) {
    t13 = reviewCountsLine(session);
    $[33] = session;
    $[34] = t13;
  } else {
    t13 = $[34];
  }
  let t14;
  if ($[35] !== t13) {
    t14 = <Text>{t13}</Text>;
    $[35] = t13;
    $[36] = t14;
  } else {
    t14 = $[36];
  }
  let t15;
  if ($[37] !== sessionUrl) {
    t15 = <Text dimColor={true}>{sessionUrl}</Text>;
    $[37] = sessionUrl;
    $[38] = t15;
  } else {
    t15 = $[38];
  }
  let t16;
  if ($[39] !== sessionUrl || $[40] !== t15) {
    t16 = <Link url={sessionUrl}>{t15}</Link>;
    $[39] = sessionUrl;
    $[40] = t15;
    $[41] = t16;
  } else {
    t16 = $[41];
  }
  let t17;
  if ($[42] !== t14 || $[43] !== t16) {
    t17 = <Box flexDirection="column">{t14}{t16}</Box>;
    $[42] = t14;
    $[43] = t16;
    $[44] = t17;
  } else {
    t17 = $[44];
  }
  let t18;
  if ($[45] !== handleSelect || $[46] !== options) {
    t18 = <Select options={options} onChange={handleSelect} />;
    $[45] = handleSelect;
    $[46] = options;
    $[47] = t18;
  } else {
    t18 = $[47];
  }
  let t19;
  if ($[48] !== t12 || $[49] !== t17 || $[50] !== t18) {
    t19 = <Box flexDirection="column" gap={1}>{t12}{t17}{t18}</Box>;
    $[48] = t12;
    $[49] = t17;
    $[50] = t18;
    $[51] = t19;
  } else {
    t19 = $[51];
  }
  let t20;
  if ($[52] !== goBackOrClose || $[53] !== t19 || $[54] !== t9) {
    t20 = <Dialog title={t9} onCancel={goBackOrClose} color="background" inputGuide={_temp}>{t19}</Dialog>;
    $[52] = goBackOrClose;
    $[53] = t19;
    $[54] = t9;
    $[55] = t20;
  } else {
    t20 = $[55];
  }
  return t20;
}
// 输入提示行的两种形态：有待确认的退出时显示「再按一次退出」，否则显示键位提示（回车选择、Esc 返回）。这是对话框组件的通用入参约定。
function _temp(exitState) {
  return exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline><KeyboardShortcutHint shortcut="Enter" action="select" /><KeyboardShortcutHint shortcut="Esc" action="go back" /></Byline>;
}
// 顶层导出。它先按会话类型分派，剩下的才是通用视图。
export function RemoteSessionDetailDialog({
  session,
  toolUseContext,
  onDone,
  onBack,
  onKill
}: Props): React.ReactNode {
  const [isTeleporting, setIsTeleporting] = useState(false);
  const [teleportError, setTeleportError] = useState<string | null>(null);

// 取最近几条消息。这里有三个约束：必须扫全部消息再取尾部，而不是直接切日志最后三条——日志尾部常常只有思考块，归一化之后会被打成进度类型，切出来的三条可能一条都不显示；这段必须放在提前返回之前，否则 hook 调用顺序会随会话类型变化，违反 hooks 规则；ultraplan 与审查会话根本不读这块，所以先跳过归一化，不做无用功。
  // Get last few messages from remote session for display.
  // Scan all messages (not just the last 3 raw entries) because the tail of
  // the log is often thinking-only blocks that normalise to 'progress' type.
  // Placed before the early returns so hook call order is stable (Rules of Hooks).
  // Ultraplan/review sessions never read this — skip the normalize work for them.
// 实现：转内部消息、归一化、滤掉进度类型、取末尾三条。依赖只有 `session`。
  const lastMessages = useMemo(() => {
    if (session.isUltraplan || session.isRemoteReview) return [];
    return normalizeMessages(toInternalMessages(session.log as SDKMessage[])).filter(_ => _.type !== 'progress').slice(-3);
  }, [session]);
// 第一处分派：ultraplan。它自己整屏接管，连外层对话框都不复用。
  if (session.isUltraplan) {
    return <UltraplanSessionDetail session={session} onDone={onDone} onBack={onBack} onKill={onKill} />;
  }

  // Review sessions get the stage-pipeline view; everything else keeps the
  // generic label/value + recent-messages dialog below.
// 第二处分派：审查会话。它需要阶段流水线，通用视图放不下，所以也整屏接管；其余会话继续走下面的通用标签值视图。
  if (session.isRemoteReview) {
    return <ReviewSessionDetail session={session} onDone={onDone} onBack={onBack} onKill={onKill} />;
  }
// 通用视图的三个本地状态与处理器。快捷键是状态相关的动作而不是标准对话框键位，所以在这里单独处理：空格关闭、左箭头返回、t 传送到本地、回车关闭。
  const handleClose = () => onDone('Remote session details dismissed', {
    display: 'system'
  });

  // Component-specific shortcuts shown in UI hints (t=teleport, space=dismiss,
  // left=back). These are state-dependent actions, not standard dialog keybindings.
// 快捷键处理。空格与回车都做关闭（一个符合「翻页器空格往下」的习惯，一个是对话框的通用确认），左箭头只在有上级时返回，t 在传送进行中不重复触发——否则会并行发两次传送请求。
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault();
      onDone('Remote session details dismissed', {
        display: 'system'
      });
    } else if (e.key === 'left' && onBack) {
      e.preventDefault();
      onBack();
    } else if (e.key === 't' && !isTeleporting) {
      e.preventDefault();
      void handleTeleport();
    } else if (e.key === 'return') {
      e.preventDefault();
      handleClose();
    }
  };

  // Handle teleporting to remote session
// 传送到本地：调远程会话的恢复流程，把错误留在本地状态里显示而不是抛出去。开始置忙、结束无条件复位（成功失败都要复位，所以放 finally）。
  async function handleTeleport(): Promise<void> {
    setIsTeleporting(true);
    setTeleportError(null);
    try {
      await teleportResumeCodeSession(session.sessionId);
    } catch (err) {
      setTeleportError(errorMessage(err));
    } finally {
      setIsTeleporting(false);
    }
  }

  // Truncate title if too long (for display purposes)
// 标题按宽度截断到 50 列，避免长标题把布局挤变形。
  const displayTitle = truncateToWidth(session.title, 50);

  // Map TaskStatus to display status (handle 'pending')
// 状态文案的映射：pending 对用户来说就是「正在启动」，直接显示内部状态名会让人以为卡在队列里。
  const displayStatus = session.status === 'pending' ? 'starting' : session.status;
// 渲染。外层 `Box` 拿焦点并挂键盘处理，里面是对话框骨架：标题「远程会话详情」、按 Esc 关闭、输入提示按状态切换。主体是五行标签值（状态、运行时长、标题、进度、会话链接），下面按需追加最近消息区、传送错误、传送中提示。
  return <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog title="Remote session details" onCancel={handleClose} color="background" inputGuide={exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline>
              {onBack && <KeyboardShortcutHint shortcut="←" action="go back" />}
              <KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />
              {!isTeleporting && <KeyboardShortcutHint shortcut="t" action="teleport" />}
            </Byline>}>
        <Box flexDirection="column">
          <Text>
            <Text bold>Status</Text>:{' '}
            {displayStatus === 'running' || displayStatus === 'starting' ? <Text color="background">{displayStatus}</Text> : displayStatus === 'completed' ? <Text color="success">{displayStatus}</Text> : <Text color="error">{displayStatus}</Text>}
          </Text>
          <Text>
            <Text bold>Runtime</Text>:{' '}
            {formatDuration((session.endTime ?? Date.now()) - session.startTime)}
          </Text>
          <Text wrap="truncate-end">
            <Text bold>Title</Text>: {displayTitle}
          </Text>
          <Text>
            <Text bold>Progress</Text>:{' '}
            <RemoteSessionProgress session={session} />
          </Text>
          <Text>
            <Text bold>Session URL</Text>:{' '}
            <Link url={getRemoteTaskSessionUrl(session.sessionId)}>
              <Text dimColor>{getRemoteTaskSessionUrl(session.sessionId)}</Text>
            </Link>
          </Text>
        </Box>

        {/* Remote session messages section */}
        {session.log.length > 0 && <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text bold>Recent messages</Text>:
            </Text>
            <Box flexDirection="column" height={10} overflowY="hidden">
              {lastMessages.map((msg, i) => <Message key={i} message={msg} lookups={EMPTY_LOOKUPS} addMargin={i > 0} tools={toolUseContext.options.tools} commands={toolUseContext.options.commands} verbose={toolUseContext.options.verbose} inProgressToolUseIDs={new Set()} progressMessagesForMessage={[]} shouldAnimate={false} shouldShowDot={false} style="condensed" isTranscriptMode={false} isStatic={true} />)}
            </Box>
            <Box marginTop={1}>
              <Text dimColor italic>
                Showing last {lastMessages.length} of {session.log.length}{' '}
                messages
              </Text>
            </Box>
          </Box>}

        {/* Teleport error message */}
        {teleportError && <Box marginTop={1}>
            <Text color="error">Teleport failed: {teleportError}</Text>
          </Box>}

        {/* Teleporting status */}
        {isTeleporting && <Text color="background">Teleporting to session…</Text>}
      </Dialog>
    </Box>;
}
// 原文件此处有一行 69280 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。