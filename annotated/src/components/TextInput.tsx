import { feature } from 'bun:bundle';
import chalk from 'chalk';
import React, { useMemo, useRef } from 'react';
import { useVoiceState } from '../context/voice.js';
import { useClipboardImageHint } from '../hooks/useClipboardImageHint.js';
import { useSettings } from '../hooks/useSettings.js';
import { useTextInput } from '../hooks/useTextInput.js';
import { Box, color, useAnimationFrame, useTerminalFocus, useTheme } from '../ink.js';
import type { BaseTextInputProps } from '../types/textInputTypes.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import type { TextHighlight } from '../utils/textHighlighting.js';
import { BaseTextInput } from './BaseTextInput.js';
import { hueToRgb } from './Spinner/utils.js';

// Block characters for waveform bars: space (silent) + 8 rising block elements.
// 波形方块字符集：空格表示静音，后接八级从低到高的填充方块。光标只占一格（见 CURSOR_WAVEFORM_WIDTH 等于 1），所以实际用到的只有其中一个字符。
const BARS = ' \u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';

// Mini waveform cursor width
const CURSOR_WAVEFORM_WIDTH = 1;

// Smoothing factor (0 = instant, 1 = frozen). Applied as EMA to
// smooth both rises and falls for a steady, non-jittery bar.
// EMA 平滑系数 0.7：新值等于旧值乘 0.7 加目标乘 0.3。上升与下降同用这一系数，波形既不抖也不拖沓。
const SMOOTH = 0.7;

// Boost factor for audio levels — computeLevel normalizes with a
// conservative divisor (rms/2000), so normal speech sits around
// 0.3-0.5. This multiplier lets the bar use the full range.
// 电平增益 1.8：底层 computeLevel 用保守的除数做归一化，正常说话的电平只在 0.3 到 0.5 之间；乘上去才能让波形用满八级量程。
const LEVEL_BOOST = 1.8;

// Raw audio level threshold (pre-boost) below which the cursor is
// grey. computeLevel returns sqrt(rms/2000), so ambient mic noise
// typically sits at 0.05-0.15. Speech starts around 0.2+.
// 静音阈值 0.15（增益前）：环境麦克风噪声通常在 0.05 到 0.15，低于它光标显示灰色而不是随噪声乱跳的彩色。
const SILENCE_THRESHOLD = 0.15;
export type Props = BaseTextInputProps & {
  highlights?: TextHighlight[];
};
export default function TextInput(props: Props): React.ReactNode {
  const [theme] = useTheme();
  const isTerminalFocused = useTerminalFocus();
  // Hoisted to mount-time — this component re-renders on every keystroke.
// 无障碍开关提升到挂载时求一次值：这个组件每次按键都重渲染，而环境变量在进程生命周期内不会变。useMemo 依赖数组为空即一次性。
  const accessibilityEnabled = useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_ACCESSIBILITY), []);
  const settings = useSettings();
  const reducedMotion = settings.prefersReducedMotion ?? false;
// feature 是编译期常量：条件调用 hook 在运行时分支是固定的，不会违反 hooks 规则，但 linter 不理解，需要 biome-ignore 注释豁免。语音模式关闭时 voiceState 恒为 idle。
  const voiceState = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useVoiceState(s => s.voiceState) : 'idle' as const;
  const isVoiceRecording = voiceState === 'recording';
  const audioLevels = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useVoiceState(s_0 => s_0.voiceAudioLevels) : [];
// 平滑值存在 ref 里而不是 state：波形每 50ms 更新一次，走 state 会触发额外的渲染调度；ref 突变加上 useAnimationFrame 驱动的重渲染刚好够用。数组长度等于光标宽度，目前是 1。
  const smoothedRef = useRef<number[]>(new Array(CURSOR_WAVEFORM_WIDTH).fill(0));
  const needsAnimation = isVoiceRecording && !reducedMotion;
// 动画帧 hook：录音且未开启减少动效时以 50ms 周期运行，返回 Box 的 ref 与当前帧时间；不需要时返回空操作与 0。同样靠 feature 常量豁免 linter。
  const [animRef, animTime] = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useAnimationFrame(needsAnimation ? 50 : null) : [() => {}, 0];

  // Show hint when terminal regains focus and clipboard has an image
// 粘贴图片提示：终端重新获得焦点且组件支持图片粘贴时，显示「剪贴板里有图」的提示。这是输入框与系统剪贴板的联动点。
  useClipboardImageHint(isTerminalFocused, !!props.onImagePaste);

// 光标渲染函数 invert 的三分支选择：不显示光标返回原文；录音中渲染迷你波形；平时用 chalk 反色。注意这个函数在渲染期被重新创建——它是传给 useTextInput 的普通参数，身份变化只会让输入状态重建光标段。
// 注释解释了为什么不做「预热脉冲」：预热窗口只有约 120 毫秒，一秒周期的脉冲根本来不及被看见；而预热期间以 50 毫秒驱动重渲染、同时用户空格以 30 到 80 毫秒间隔到达，两者叠加会肉眼可见地卡顿。这是「动画也要看时间窗口」的好例子。
  // Cursor invert function: mini waveform during voice recording,
  // standard chalk.inverse otherwise. No warmup pulse — the ~120ms
  // warmup window is too short for a 1s-period pulse to register, and
  // driving TextInput re-renders at 50ms during warmup (while spaces
  // are simultaneously arriving every 30-80ms) causes visible stutter.
  const canShowCursor = isTerminalFocused && !accessibilityEnabled;
  let invert: (text: string) => string;
  if (!canShowCursor) {
    invert = (text: string) => text;
  } else if (isVoiceRecording && !reducedMotion) {
    // Single-bar waveform from the latest audio level
// 录音波形分支：取音频电平数组的最后一项作为目标值，乘增益后钳到 1，再做 EMA 平滑写入 ref。渲染期突变 ref 在这里是刻意为之——动画每帧都要写。
    const smoothed = smoothedRef.current;
    const raw = audioLevels.length > 0 ? audioLevels[audioLevels.length - 1] ?? 0 : 0;
    const target = Math.min(raw * LEVEL_BOOST, 1);
    smoothed[0] = (smoothed[0] ?? 0) * SMOOTH + target * (1 - SMOOTH);
    const displayLevel = smoothed[0] ?? 0;
// 电平映射到方块下标：乘 8 后四舍五入，再钳在 1 到 8 之间——最低用 1 而不是 0，保证有声时光标不会缩成空格而消失。
    const barIndex = Math.max(1, Math.min(Math.round(displayLevel * (BARS.length - 1)), BARS.length - 1));
    const isSilent = raw < SILENCE_THRESHOLD;
// 色相循环：帧时间换算成秒后每秒转 90 度、对 360 取模，有声时光标按彩虹渐变流动；静音时固定灰色三元组。hueToRgb 来自 Spinner 工具，全仓共用一个色相换算实现。
    const hue = animTime / 1000 * 90 % 360;
    const {
      r,
      g,
      b
    } = isSilent ? {
      r: 128,
      g: 128,
      b: 128
    } : hueToRgb(hue);
    invert = () => chalk.rgb(r, g, b)(BARS[barIndex]!);
  } else {
    invert = chalk.inverse;
  }
// 装配 useTextInput：把 props 原样透传之外，注入四个本组件特有参数——invert（光标渲染）、themeText（正文色）、dim（暗色函数）与 cursorChar。光标字符给空格，靠 invert 反色显示。
  const textInputState = useTextInput({
    value: props.value,
    onChange: props.onChange,
    onSubmit: props.onSubmit,
    onExit: props.onExit,
    onExitMessage: props.onExitMessage,
    onHistoryReset: props.onHistoryReset,
    onHistoryUp: props.onHistoryUp,
    onHistoryDown: props.onHistoryDown,
    onClearInput: props.onClearInput,
    focus: props.focus,
    mask: props.mask,
    multiline: props.multiline,
// cursorChar 的条件：showCursor 为真时给空格（靠 invert 上色显示），为假给空串（不渲染光标）。占位文本在录音中隐藏（见第 121 行 hidePlaceholderText），避免波形和占位符打架。
    cursorChar: props.showCursor ? ' ' : '',
    highlightPastedText: props.highlightPastedText,
    invert,
    themeText: color('text', theme),
    columns: props.columns,
    maxVisibleLines: props.maxVisibleLines,
    onImagePaste: props.onImagePaste,
    disableCursorMovementForUpDownKeys: props.disableCursorMovementForUpDownKeys,
    disableEscapeDoublePress: props.disableEscapeDoublePress,
    externalOffset: props.cursorOffset,
    onOffsetChange: props.onChangeCursorOffset,
    inputFilter: props.inputFilter,
    inlineGhostText: props.inlineGhostText,
    dim: chalk.dim
  });
// 返回结构：Box 挂动画 ref，内部是 BaseTextInput。动画通过 ref 对应元素的重渲染驱动——每帧 animTime 变化触发组件重渲染，波形随之刷新。
  return <Box ref={animRef}>
      <BaseTextInput inputState={textInputState} terminalFocus={isTerminalFocused} highlights={props.highlights} invert={invert} hidePlaceholderText={isVoiceRecording} {...props} />
    </Box>;
}
// 原文件此处有一行 15460 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。