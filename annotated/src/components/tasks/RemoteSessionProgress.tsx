// 远程会话（远程代理 / ultrareview）的进度行组件：一行文本，按会话类型和状态分流显示。
import { c as _c } from "react/compiler-runtime";
import React, { useRef } from 'react';
import type { RemoteAgentTaskState } from 'src/tasks/RemoteAgentTask/RemoteAgentTask.js';
import type { DeepImmutable } from 'src/types/utils.js';
import { DIAMOND_FILLED, DIAMOND_OPEN } from '../../constants/figures.js';
import { useSettings } from '../../hooks/useSettings.js';
import { Text, useAnimationFrame } from '../../ink.js';
import { count } from '../../utils/array.js';
import { getRainbowColor } from '../../utils/thinking.js';
// 动画帧间隔 80ms：计数平滑与彩虹渐变共用这一个节拍。
const TICK_MS = 80;
type ReviewStage = NonNullable<NonNullable<RemoteAgentTaskState['reviewProgress']>['stage']>;

/**
 * Stage-appropriate counts line for a running review. Shared between the
 * one-line pill (below) and RemoteSessionDetailDialog's reviewCountsLine so
 * the two can't drift — they have historically disagreed on whether to show
 * refuted counts and what to call the synthesizing stage.
 *
 * Canonical behavior: word labels (not ✓/✗), hide refuted when 0, "deduping"
 * for the synthesizing stage (matches STAGE_LABELS in the detail dialog).
 */
// 审阅计数格式化函数。上方注释说明它存在的原因：一行药丸与详情弹窗各自实现过计数文案，历史上对「是否显示 refuted、synthesizing 阶段叫什么」产生过分歧，所以抽成共享函数防漂移。
export function formatReviewStageCounts(stage: ReviewStage | undefined, found: number, verified: number, refuted: number): string {
  // Pre-stage orchestrator images don't write the stage field.
// stage 字段缺失说明是旧版编排器镜像（未写入 stage），此时只报 found 和 verified 两个数。
  if (!stage) return `${found} found · ${verified} verified`;
// synthesizing（去重综合）阶段：found 计数已冻结不再展示，只报 verified、refuted（有才显示）与 deduping。
  if (stage === 'synthesizing') {
    const parts = [`${verified} verified`];
    if (refuted > 0) parts.push(`${refuted} refuted`);
    parts.push('deduping');
    return parts.join(' · ');
  }
// verifying 阶段：found 继续增长，verified 逐步跟上，refuted 大于零才显示——refuted 为零时隐藏是该函数的既定规范。
  if (stage === 'verifying') {
    const parts = [`${found} found`, `${verified} verified`];
    if (refuted > 0) parts.push(`${refuted} refuted`);
    return parts.join(' · ');
  }
  // stage === 'finding'
  return found > 0 ? `${found} found` : 'finding';
}

// Per-character rainbow gradient, same treatment as the ultraplan keyword.
// The phase offset lets the gradient cycle — so the colors sweep along the
// text on each animation frame instead of being static.
// 彩虹文字：逐字符上色，phase 偏移让渐变沿帧流动而不是静态定格，与 ultraplan 关键字同一套处理。
function RainbowText(t0) {
  const $ = _c(5);
  const {
    text,
    phase: t1
  } = t0;
  const phase = t1 === undefined ? 0 : t1;
  let t2;
  if ($[0] !== text) {
// 先把字符串展开成字符数组再逐个包 Text——扩展运算符按码元切分，对这七个 ASCII 字母没有问题。
    t2 = [...text];
    $[0] = text;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] !== phase || $[3] !== t2) {
// 每帧 phase 变化时所有字符重算颜色，key 用下标使 React 原地更新而不是重建节点。
    t3 = <>{t2.map((ch, i) => <Text key={i} color={getRainbowColor(i + phase)}>{ch}</Text>)}</>;
    $[2] = phase;
    $[3] = t2;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}

// Smooth-tick a count toward target, +1 per frame. Same pattern as the
// token counter in SpinnerAnimationRow — the ref survives re-renders and
// the animation clock drives the tick. Target jumps (2→5) display as
// 2→3→4→5 instead of snapping. When `snap` is set (reduced motion, or
// the clock is frozen), bypass the tick and jump straight to target —
// otherwise a frozen `time` would leave the ref stuck at its init value.
// 平滑计数 hook：目标跳变（2→5）时逐帧 +1 过渡显示而不是瞬间跳到目标值。
function useSmoothCount(target: number, time: number, snap: boolean): number {
  const displayed = useRef(target);
  const lastTick = useRef(time);
// 渲染期直接改 ref（不走 setState）：向下修正或 snap 时直接对齐目标。这在 React Compiler 下是刻意为之——上方注释说明 snap（减少动态偏好或时钟冻结）时必须立即对齐，否则冻结的时钟会让 ref 永远停在初值。
  if (snap || target < displayed.current) {
    displayed.current = target;
  } else if (target > displayed.current && time !== lastTick.current) {
    displayed.current += 1;
    lastTick.current = time;
  }
  return displayed.current;
}
// 审阅行的容器组件：reducedMotion 或会话结束时 snap 直通目标值；只有 running 且未减motion 时才开动画时钟。
function ReviewRainbowLine(t0) {
  const $ = _c(15);
  const {
    session
  } = t0;
  const settings = useSettings();
  const reducedMotion = settings.prefersReducedMotion ?? false;
  const p = session.reviewProgress;
  const running = session.status === "running";
// useAnimationFrame 传 null 表示停表：非运行或用户偏好减少动态时完全不驱动的动画，也不消耗渲染。
  const [, time] = useAnimationFrame(running && !reducedMotion ? TICK_MS : null);
  const targetFound = p?.bugsFound ?? 0;
  const targetVerified = p?.bugsVerified ?? 0;
  const targetRefuted = p?.bugsRefuted ?? 0;
  const snap = reducedMotion || !running;
  const found = useSmoothCount(targetFound, time, snap);
  const verified = useSmoothCount(targetVerified, time, snap);
  const refuted = useSmoothCount(targetRefuted, time, snap);
// 彩虹相位：每 3 个 tick 前进一格，对 7 取模循环。阶段推进比帧慢，视觉上渐变是缓缓流动的。
  const phase = Math.floor(time / (TICK_MS * 3)) % 7;
// 完成/失败态整行 JSX 被哨兵缓存——这些输出永不变化，缓存后连比较都省了。
  if (session.status === "completed") {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <><Text color="background">{DIAMOND_FILLED} </Text><RainbowText text="ultrareview" phase={0} /><Text dimColor={true}> ready · shift+↓ to view</Text></>;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    return t1;
  }
  if (session.status === "failed") {
    let t1;
    if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <><Text color="background">{DIAMOND_FILLED} </Text><RainbowText text="ultrareview" phase={0} /><Text color="error" dimColor={true}>{" \xB7 "}error</Text></>;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    return t1;
  }
  let t1;
  if ($[2] !== found || $[3] !== p || $[4] !== refuted || $[5] !== verified) {
    t1 = !p ? "setting up" : formatReviewStageCounts(p.stage, found, verified, refuted);
    $[2] = found;
    $[3] = p;
    $[4] = refuted;
    $[5] = verified;
    $[6] = t1;
  } else {
    t1 = $[6];
  }
  const tail = t1;
  let t2;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Text color="background">{DIAMOND_OPEN} </Text>;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  const t3 = running ? phase : 0;
  let t4;
  if ($[8] !== t3) {
    t4 = <RainbowText text="ultrareview" phase={t3} />;
    $[8] = t3;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  let t5;
  if ($[10] !== tail) {
    t5 = <Text dimColor={true}> · {tail}</Text>;
    $[10] = tail;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  let t6;
  if ($[12] !== t4 || $[13] !== t5) {
    t6 = <>{t2}{t4}{t5}</>;
    $[12] = t4;
    $[13] = t5;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  return t6;
}
export function RemoteSessionProgress(t0) {
  const $ = _c(11);
  const {
    session
  } = t0;
// 入口分流：远程审阅会话走彩虹行，普通会话按状态显示 done、error、纯状态文案或「完成/总数」计数。
  if (session.isRemoteReview) {
    let t1;
    if ($[0] !== session) {
      t1 = <ReviewRainbowLine session={session} />;
      $[0] = session;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    return t1;
  }
  if (session.status === "completed") {
    let t1;
    if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Text bold={true} color="success" dimColor={true}>done</Text>;
      $[2] = t1;
    } else {
      t1 = $[2];
    }
    return t1;
  }
  if (session.status === "failed") {
    let t1;
    if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Text bold={true} color="error" dimColor={true}>error</Text>;
      $[3] = t1;
    } else {
      t1 = $[3];
    }
    return t1;
  }
// 没有待办清单时退化为显示原始状态串加省略号——宁可信息少也不伪造进度。
  if (!session.todoList.length) {
    let t1;
    if ($[4] !== session.status) {
      t1 = <Text dimColor={true}>{session.status}…</Text>;
      $[4] = session.status;
      $[5] = t1;
    } else {
      t1 = $[5];
    }
    return t1;
  }
  let t1;
  if ($[6] !== session.todoList) {
// 计数只统计 status 为 completed 的待办项，count 是工具函数包了一层 filter。
    t1 = count(session.todoList, _temp);
    $[6] = session.todoList;
    $[7] = t1;
  } else {
    t1 = $[7];
  }
  const completed = t1;
  const total = session.todoList.length;
  let t2;
  if ($[8] !== completed || $[9] !== total) {
    t2 = <Text dimColor={true}>{completed}/{total}</Text>;
    $[8] = completed;
    $[9] = total;
    $[10] = t2;
  } else {
    t2 = $[10];
  }
  return t2;
}
function _temp(_) {
  return _.status === "completed";
}
// 原文件此处有一行 20496 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。