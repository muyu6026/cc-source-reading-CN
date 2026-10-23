import { feature } from 'bun:bundle';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNotifications } from '../context/notifications.js';
import { useIsModalOverlayActive } from '../context/overlayContext.js';
import { useGetVoiceState, useSetVoiceState, useVoiceState } from '../context/voice.js';
import { KeyboardEvent } from '../ink/events/keyboard-event.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- backward-compat bridge until REPL wires handleKeyDown to <Box onKeyDown>
import { useInput } from '../ink.js';
import { useOptionalKeybindingContext } from '../keybindings/KeybindingContext.js';
import { keystrokesEqual } from '../keybindings/resolver.js';
import type { ParsedKeystroke } from '../keybindings/types.js';
import { normalizeFullWidthSpace } from '../utils/stringUtils.js';
import { useVoiceEnabled } from './useVoiceEnabled.js';

// Dead code elimination: conditional import for voice input hook.
/* eslint-disable @typescript-eslint/no-require-imports */
// Capture the module namespace, not the function: spyOn() mutates the module
// object, so `voiceNs.useVoice(...)` resolves to the spy even if this module
// was loaded before the spy was installed (test ordering independence).
// 捕获模块命名空间而不是函数本身：spyOn() 变异的是模块对象，`voiceNs.useVoice(...)` 这样写才能在 spy 装晚于本模块加载时仍然解析到 spy（测试顺序独立性）。整段是 DCE 条件 import——VOICE_MODE 特性关闭时给一个恒 idle 的 stub，useVoice 那 1,100 行根本不进 bundle。
const voiceNs: {
  useVoice: typeof import('./useVoice.js').useVoice;
} = feature('VOICE_MODE') ? require('./useVoice.js') : {
  useVoice: ({
    enabled: _e
  }: {
    onTranscript: (t: string) => void;
    enabled: boolean;
  }) => ({
    state: 'idle' as const,
    handleKeyEvent: (_fallbackMs?: number) => {}
  })
};
/* eslint-enable @typescript-eslint/no-require-imports */

// Maximum gap (ms) between key presses to count as held (auto-repeat).
// Terminal auto-repeat fires every 30-80ms; 120ms covers jitter while
// excluding normal typing speed (100-300ms between keystrokes).
// RAPID_KEY_GAP_MS = 120ms。终端 auto-repeat 每 30-80ms 一发；120ms 盖住抖动，同时把正常打字速度（100-300ms 间隔）排除在外——这是「按住」与「连打」的分界线。
const RAPID_KEY_GAP_MS = 120;

// Fallback (ms) for modifier-combo first-press activation. Must match
// FIRST_PRESS_FALLBACK_MS in useVoice.ts. Covers the max OS initial
// key-repeat delay (~2s on macOS with slider at "Long") so holding a
// modifier combo doesn't fragment into two sessions when the first
// auto-repeat arrives after the default 600ms REPEAT_FALLBACK_MS.
const MODIFIER_FIRST_PRESS_FALLBACK_MS = 2000;
// 组合键首按 fallback 与 useVoice.ts 的 FIRST_PRESS_FALLBACK_MS 必须一致（2s）：等的是 OS 初始重复延迟的上限，不是重复速率，对不齐会让长按组合键碎成两个会话。

// Number of rapid consecutive key events required to activate voice.
// Only applies to bare-char bindings (space, v, etc.) where a single press
// could be normal typing. Modifier combos activate on the first press.
const HOLD_THRESHOLD = 5;
// HOLD_THRESHOLD = 5：裸字符绑定（空格、v）需要 5 次快速连击才激活——单发一个空格可能只是正常打字。组合键无此门槛，首按即激活。

// Number of rapid key events to start showing warmup feedback.
const WARMUP_THRESHOLD = 2;
// WARMUP_THRESHOLD = 2：第 2 次快速击键开始显示预热反馈，用户知道「系统 recognition 到我在按住了」。

// Match a KeyboardEvent against a ParsedKeystroke. Replaces the legacy
// matchesKeystroke(input, Key, ...) path which assumed useInput's raw
// `input` arg — KeyboardEvent.key holds normalized names (e.g. 'space',
// 'f9') that getKeyName() didn't handle, so modifier combos and f-keys
// silently failed to match after the onKeyDown migration (#23524).
// matchesKeyboardEvent 的存在本身是个迁移事故标本：onKeyDown 迁移（#23524）后 input 流变成了 KeyboardEvent，其 key 是归一化名字（space/f9），而 legacy matchesKeystroke 假设的是 useInput 的原始 input——组合键和 f 键在迁移后静默失配。这个函数是新旧两条路的适配层。
function matchesKeyboardEvent(e: KeyboardEvent, target: ParsedKeystroke): boolean {
  // KeyboardEvent stores key names; ParsedKeystroke stores ' ' for space
  // and 'enter' for return (see parser.ts case 'space'/'return').
  const key = e.key === 'space' ? ' ' : e.key === 'return' ? 'enter' : e.key.toLowerCase();
  if (key !== target.key) return false;
  if (e.ctrl !== target.ctrl) return false;
  if (e.shift !== target.shift) return false;
  // KeyboardEvent.meta folds alt|option (terminal limitation — esc-prefix);
  // ParsedKeystroke has both alt and meta as aliases for the same thing.
  if (e.meta !== (target.alt || target.meta)) return false;
  if (e.superKey !== target.super) return false;
  return true;
}
// meta 字段把 alt|option 折叠在一起（终端限制：esc 前缀序列无法区分），ParsedKeystroke 里 alt 和 meta 本就是同一个东西的别名。

// Hardcoded default for when there's no KeybindingProvider at all (e.g.
// headless/test contexts). NOT used when the provider exists and the
// lookup returns null — that means the user null-unbound or reassigned
// space, and falling back to space would pick a dead or conflicting key.
const DEFAULT_VOICE_KEYSTROKE: ParsedKeystroke = {
  key: ' ',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  super: false
};
// DEFAULT_VOICE_KEYSTROKE 只在完全没有 KeybindingProvider 时用（headless/测试）。provider 存在但查不到 = 用户显式解绑或改绑了，此时 fallback 到空格会挑一个死的或冲突的键——不 second-guess 用户。
type InsertTextHandle = {
  insert: (text: string) => void;
  setInputWithCursor: (value: string, cursor: number) => void;
  cursorOffset: number;
};
type UseVoiceIntegrationArgs = {
  setInputValueRaw: React.Dispatch<React.SetStateAction<string>>;
  inputValueRef: React.RefObject<string>;
  insertTextRef: React.RefObject<InsertTextHandle | null>;
};
type InterimRange = {
  start: number;
  end: number;
};
type StripOpts = {
  // Which char to strip (the configured hold key). Defaults to space.
  char?: string;
  // Capture the voice prefix/suffix anchor at the stripped position.
  anchor?: boolean;
  // Minimum trailing count to leave behind — prevents stripping the
  // intentional warmup chars when defensively cleaning up leaks.
  floor?: number;
};
type UseVoiceIntegrationResult = {
  // Returns the number of trailing chars remaining after stripping.
  stripTrailing: (maxStrip: number, opts?: StripOpts) => number;
  // Undo the gap space and reset anchor refs after a failed voice activation.
  resetAnchor: () => void;
  handleKeyEvent: (fallbackMs?: number) => void;
  interimRange: InterimRange | null;
};
// 对外契约：stripTrailing 返回剥离后剩余的尾部字符数，resetAnchor 撤销锚点，interimRange 给 UI 变暗用。
export function useVoiceIntegration({
  setInputValueRaw,
  inputValueRef,
  insertTextRef
}: UseVoiceIntegrationArgs): UseVoiceIntegrationResult {
  const {
    addNotification
  } = useNotifications();

  // Tracks the input content before/after the cursor when voice starts,
  // so interim transcripts can be inserted at the cursor position without
  // clobbering surrounding user text.
  const voicePrefixRef = useRef<string | null>(null);
  const voiceSuffixRef = useRef<string>('');
  // Tracks the last input value this hook wrote (via anchor, interim effect,
  // or handleVoiceTranscript). If inputValueRef.current diverges, the user
  // submitted or edited — both write paths bail to avoid clobbering. This is
  // the only guard that correctly handles empty-prefix-empty-suffix: a
  // startsWith('')/endsWith('') check vacuously passes, and a length check
  // can't distinguish a cleared input from a never-set one.
  const lastSetInputRef = useRef<string | null>(null);
// lastSetInputRef 是全文件唯一的写入守卫，也是唯一能正确处理「空前缀+空后缀」的方案：startsWith('')/endsWith('') 会真空通过，length 比较分不清「被清空」和「从未设置」。两条写入路径（锚点、interim）都维护它，用户一提交或编辑，两个回调都能发现并 bail。

  // Strip trailing hold-key chars (and optionally capture the voice
  // anchor). Called during warmup (to clean up chars that leaked past
  // stopImmediatePropagation — listener order is not guaranteed) and
  // on activation (with anchor=true to capture the prefix/suffix around
  // the cursor for interim transcript placement). The caller passes the
  // exact count it expects to strip so pre-existing chars at the
  // boundary are preserved (e.g. the "v" in "hav" when hold-key is "v").
  // The floor option sets a minimum trailing count to leave behind
  // (during warmup this is the count we intentionally let through, so
  // defensive cleanup only removes leaks). Returns the number of
  // trailing chars remaining after stripping. When nothing changes, no
  // state update is performed.
// stripTrailing 的两个调用场景：预热期清泄漏（监听器顺序不保证，文本输入可能先跑）+ 激活时剥掉故意放行的字符并捕获锚点。调用方传精确的期望剥离数，边界上用户已有的字符（hav 里的 v）才不会被误剥。
  const stripTrailing = useCallback((maxStrip: number, {
    char = ' ',
    anchor = false,
    floor = 0
  }: StripOpts = {}) => {
    const prev = inputValueRef.current;
    const offset = insertTextRef.current?.cursorOffset ?? prev.length;
    const beforeCursor = prev.slice(0, offset);
    const afterCursor = prev.slice(offset);
    // When the hold key is space, also count full-width spaces (U+3000)
    // that a CJK IME may have inserted for the same physical key.
    // U+3000 is BMP single-code-unit so indices align with beforeCursor.
    const scan = char === ' ' ? normalizeFullWidthSpace(beforeCursor) : beforeCursor;
// 全角空格 U+3000 也要数：CJK 输入法为同一个物理空格键发的是全角空格。U+3000 是 BMP 单代码单元，索引与 beforeCursor 对齐，可以直接扫。
    let trailing = 0;
    while (trailing < scan.length && scan[scan.length - 1 - trailing] === char) {
      trailing++;
    }
    const stripCount = Math.max(0, Math.min(trailing - floor, maxStrip));
    const remaining = trailing - stripCount;
    const stripped = beforeCursor.slice(0, beforeCursor.length - stripCount);
// gap space 的用途：锚定时若后缀非空白，插一个缝空格让波形光标停在缝上而不是盖住后缀首字母。interim effect 维护同样的五段结构（前缀+引导+interim+尾随+后缀），转写文字一到位，缝就无缝长进文本里。
    // When anchoring with a non-space suffix, insert a gap space so the
    // waveform cursor sits on the gap instead of covering the first
    // suffix letter. The interim transcript effect maintains this same
    // structure (prefix + leading + interim + trailing + suffix), so
    // the gap is seamless once transcript text arrives.
    // Always overwrite on anchor — if a prior activation failed to start
    // voice (voiceState stayed 'idle'), the cleanup effect didn't fire and
    // the old anchor is stale. anchor=true is only passed on the single
    // activation call, never during recording, so overwrite is safe.
// anchor=true 时总是覆盖：上次激活失败（voiceState 停在 idle）时 cleanup effect 没触发，旧锚点还在输入里——不覆盖就会把转录插到陈旧位置。
    let gap = '';
    if (anchor) {
      voicePrefixRef.current = stripped;
      voiceSuffixRef.current = afterCursor;
      if (afterCursor.length > 0 && !/^\s/.test(afterCursor)) {
        gap = ' ';
      }
    }
    const newValue = stripped + gap + afterCursor;
    if (anchor) lastSetInputRef.current = newValue;
    if (newValue === prev && stripCount === 0) return remaining;
    if (insertTextRef.current) {
      insertTextRef.current.setInputWithCursor(newValue, stripped.length);
    } else {
      setInputValueRaw(newValue);
    }
    return remaining;
  }, [setInputValueRaw, inputValueRef, insertTextRef]);
// 注意 newValue === prev && stripCount === 0 时直接返回不碰状态：没有变化就不触发 React 更新，录音中的高频防御性剥离因此零渲染。

  // Undo the gap space inserted by stripTrailing(..., {anchor:true}) and
  // reset the voice prefix/suffix refs. Called when voice activation fails
  // (voiceState stays 'idle' after voiceHandleKeyEvent), so the cleanup
  // effect (voiceState useEffect below) — which only fires on voiceState transitions — can't
  // reach the stale anchor. Without this, the gap space and stale refs
  // persist in the input.
// resetAnchor 补的是 cleanup effect 的盲区：那个 effect 只在 voiceState 转换时触发，激活失败（voiceState 原地不动）时到不了——没有这个函数，缝空格和陈旧 ref 会一直留在输入框里。
  const resetAnchor = useCallback(() => {
    const prefix = voicePrefixRef.current;
    if (prefix === null) return;
    const suffix = voiceSuffixRef.current;
    voicePrefixRef.current = null;
    voiceSuffixRef.current = '';
    const restored = prefix + suffix;
    if (insertTextRef.current) {
      insertTextRef.current.setInputWithCursor(restored, prefix.length);
    } else {
      setInputValueRaw(restored);
    }
  }, [setInputValueRaw, insertTextRef]);

  // Voice state selectors. useVoiceEnabled = user intent (settings) +
  // auth + GB kill-switch, with the auth half memoized on authVersion so
  // render loops never hit a cold keychain spawn.
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  const voiceEnabled = feature('VOICE_MODE') ? useVoiceEnabled() : false;
// 三个 voice selector 都用 feature() 编译期常量做条件调用——biome 的 useHookAtTopLevel 会误报，因为常量在编译后只剩一支，hook 顺序稳定。useVoiceEnabled 内部把 auth 半边 memoize 在 authVersion 上，渲染循环不会冷启 keychain 子进程。
  const voiceState = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useVoiceState(s => s.voiceState) : 'idle' as const;
  const voiceInterimTranscript = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useVoiceState(s_0 => s_0.voiceInterimTranscript) : '';

  // Set the voice anchor for focus mode (where recording starts via terminal
  // focus, not key hold). Key-hold sets the anchor in stripTrailing.
  useEffect(() => {
    if (!feature('VOICE_MODE')) return;
    if (voiceState === 'recording' && voicePrefixRef.current === null) {
      const input = inputValueRef.current;
      const offset_0 = insertTextRef.current?.cursorOffset ?? input.length;
      voicePrefixRef.current = input.slice(0, offset_0);
      voiceSuffixRef.current = input.slice(offset_0);
      lastSetInputRef.current = input;
    }
    if (voiceState === 'idle') {
      voicePrefixRef.current = null;
      voiceSuffixRef.current = '';
      lastSetInputRef.current = null;
    }
  }, [voiceState, inputValueRef, insertTextRef]);
// focus 模式的锚点在这里设（录音由终端焦点拉起，没有 stripTrailing 可调）；回 idle 时三个 ref 一起清。

  // Live-update the prompt input with the interim transcript as voice
  // transcribes speech. The prefix (user-typed text before the cursor) is
  // preserved and the transcript is inserted between prefix and suffix.
  useEffect(() => {
    if (!feature('VOICE_MODE')) return;
    if (voicePrefixRef.current === null) return;
    const prefix_0 = voicePrefixRef.current;
    const suffix_0 = voiceSuffixRef.current;
    // Submit race: if the input isn't what this hook last set it to, the
    // user submitted (clearing it) or edited it. voicePrefixRef is only
    // cleared on voiceState→idle, so it's still set during the 'processing'
    // window between CloseStream and WS close — this catches refined
    // TranscriptText arriving then and re-filling a cleared input.
    if (inputValueRef.current !== lastSetInputRef.current) return;
// 提交竞态第一处：voicePrefixRef 要到 voiceState→idle 才清，所以 CloseStream 之后、WS 关闭之前的 processing 窗口里，迟到的 refined TranscriptText 还会尝试重填一个已被用户清空的输入框。
    const needsSpace = prefix_0.length > 0 && !/\s$/.test(prefix_0) && voiceInterimTranscript.length > 0;
    // Don't gate on voiceInterimTranscript.length -- when interim clears to ''
    // after handleVoiceTranscript sets the final text, the trailing space
    // between prefix and suffix must still be preserved.
    const needsTrailingSpace = suffix_0.length > 0 && !/^\s/.test(suffix_0);
    const leadingSpace = needsSpace ? ' ' : '';
    const trailingSpace = needsTrailingSpace ? ' ' : '';
    const newValue_0 = prefix_0 + leadingSpace + voiceInterimTranscript + trailingSpace + suffix_0;
    // Position cursor after the transcribed text (before suffix)
    const cursorPos = prefix_0.length + leadingSpace.length + voiceInterimTranscript.length;
    if (insertTextRef.current) {
      insertTextRef.current.setInputWithCursor(newValue_0, cursorPos);
    } else {
      setInputValueRaw(newValue_0);
    }
    lastSetInputRef.current = newValue_0;
  }, [voiceInterimTranscript, setInputValueRaw, inputValueRef, insertTextRef]);
// interim effect 的间距逻辑：不能 gate on voiceInterimTranscript.length——最终文本就位后 interim 清空，那时前缀和后缀之间的缝空格还必须保持。
  const handleVoiceTranscript = useCallback((text: string) => {
    if (!feature('VOICE_MODE')) return;
    const prefix_1 = voicePrefixRef.current;
    // No voice anchor — voice was reset (or never started). Nothing to do.
    if (prefix_1 === null) return;
    const suffix_1 = voiceSuffixRef.current;
    // Submit race: finishRecording() → user presses Enter (input cleared)
    // → WebSocket close → this callback fires with stale prefix/suffix.
    // If the input isn't what this hook last set (via the interim effect
    // or anchor), the user submitted or edited — don't re-fill. Comparing
    // against `text.length` would false-positive when the final is longer
    // than the interim (ASR routinely adds punctuation/corrections).
    if (inputValueRef.current !== lastSetInputRef.current) return;
// 提交竞速第二处：这里不能改用 text.length 比较——ASR  routinely 给最终稿加标点和修正，最终比 interim 长是常态，长度差会误判。
    const needsSpace_0 = prefix_1.length > 0 && !/\s$/.test(prefix_1) && text.length > 0;
    const needsTrailingSpace_0 = suffix_1.length > 0 && !/^\s/.test(suffix_1) && text.length > 0;
    const leadingSpace_0 = needsSpace_0 ? ' ' : '';
    const trailingSpace_0 = needsTrailingSpace_0 ? ' ' : '';
    const newInput = prefix_1 + leadingSpace_0 + text + trailingSpace_0 + suffix_1;
    // Position cursor after the transcribed text (before suffix)
    const cursorPos_0 = prefix_1.length + leadingSpace_0.length + text.length;
    if (insertTextRef.current) {
      insertTextRef.current.setInputWithCursor(newInput, cursorPos_0);
    } else {
      setInputValueRaw(newInput);
    }
    lastSetInputRef.current = newInput;
    // Update the prefix to include this chunk so focus mode can continue
    // appending subsequent transcripts after it.
    voicePrefixRef.current = prefix_1 + leadingSpace_0 + text;
  }, [setInputValueRaw, inputValueRef, insertTextRef]);
// 最后一步把本次转写并进 prefix：focus 模式连续转写时，下一段接在这段后面追加，而不是互相覆盖。
  const voice = voiceNs.useVoice({
    onTranscript: handleVoiceTranscript,
    onError: (message: string) => {
      addNotification({
        key: 'voice-error',
        text: message,
        color: 'error',
        priority: 'immediate',
        timeoutMs: 10_000
      });
    },
    enabled: voiceEnabled,
    focusMode: false
  });
// focusMode: false——这个 useVoice 实例只管按住说话；焦点驱动录音走另一个挂载点。onError 统一转通知（voice-error key，10s 自动消失）。

  // Compute the character range of interim (not-yet-finalized) transcript
  // text in the input value, so the UI can dim it.
  const interimRange = useMemo((): InterimRange | null => {
    if (!feature('VOICE_MODE')) return null;
    if (voicePrefixRef.current === null) return null;
    if (voiceInterimTranscript.length === 0) return null;
    const prefix_2 = voicePrefixRef.current;
    const needsSpace_1 = prefix_2.length > 0 && !/\s$/.test(prefix_2) && voiceInterimTranscript.length > 0;
    const start = prefix_2.length + (needsSpace_1 ? 1 : 0);
    const end = start + voiceInterimTranscript.length;
    return {
      start,
      end
    };
  }, [voiceInterimTranscript]);
// interimRange 给 UI 把「还没定稿的转写文字」画成暗色：起止点算法与插入逻辑严格同构，差一个字符暗色区域就会漂移。
  return {
    stripTrailing,
    resetAnchor,
    handleKeyEvent: voice.handleKeyEvent,
    interimRange
  };
}

/**
 * Component that handles hold-to-talk voice activation.
 *
 * The activation key is configurable via keybindings (voice:pushToTalk,
 * default: space). Hold detection depends on OS auto-repeat delivering a
 * stream of events at 30-80ms intervals. Two binding types work:
 *
 * **Modifier + letter (meta+k, ctrl+x, alt+v):** Cleanest. Activates on
 * the first press — a modifier combo is unambiguous intent (can't be
 * typed accidentally), so no hold threshold applies. The letter part
 * auto-repeats while held, feeding release detection in useVoice.ts.
 * No flow-through, no stripping.
 *
 * **Bare chars (space, v, x):** Require HOLD_THRESHOLD rapid presses to
 * activate (a single space could be normal typing). The first
 * WARMUP_THRESHOLD presses flow into the input so a single press types
 * normally. Past that, rapid presses are swallowed; on activation the
 * flow-through chars are stripped. Binding "v" doesn't make "v"
 * untypable — normal typing (>120ms between keystrokes) flows through;
 * only rapid auto-repeat from a held key triggers activation.
 *
 * Known broken: modifier+space (NUL → parsed as ctrl+backtick), chords
 * (discrete sequences, no hold). Validation warns on these.
 */
// 按住说话激活器。设计分两种绑定类型：组合键（meta+k/ctrl+x/alt+v）首按即激活、无流透无剥离——组合键不可能被误打；裸字符（空格/v）要 5 连击，前 2 发放行进去当正常打字。已知坏例：modifier+space（NUL 被解析成 ctrl+backtick）和 chord（离散序列，没有按住概念），绑定校验时警告。
export function useVoiceKeybindingHandler({
  voiceHandleKeyEvent,
  stripTrailing,
  resetAnchor,
  isActive
}: {
  voiceHandleKeyEvent: (fallbackMs?: number) => void;
  stripTrailing: (maxStrip: number, opts?: StripOpts) => number;
  resetAnchor: () => void;
  isActive: boolean;
}): {
  handleKeyDown: (e: KeyboardEvent) => void;
} {
  const getVoiceState = useGetVoiceState();
  const setVoiceState = useSetVoiceState();
  const keybindingContext = useOptionalKeybindingContext();
  const isModalOverlayActive = useIsModalOverlayActive();
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  const voiceEnabled = feature('VOICE_MODE') ? useVoiceEnabled() : false;
  const voiceState = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useVoiceState(s => s.voiceState) : 'idle';

  // Find the configured key for voice:pushToTalk from keybinding context.
  // Forward iteration with last-wins (matching the resolver): if a later
  // Chat binding overrides the same chord with null or a different
  // action, the voice binding is discarded and null is returned — the
  // user explicitly disabled hold-to-talk via binding override, so
  // don't second-guess them with a fallback. The DEFAULT is only used
  // when there's no provider at all. Context filter is required — space
  // is also bound in Settings/Confirmation/Plugin (select:accept etc.);
  // without the filter those would null out the default.
// 查找 voice:pushToTalk 绑定：正序迭代 last-wins（与 resolver 一致）——后一条 Chat 绑定把同一个 chord 改成 null 或别的动作，语音绑定作废返回 null，用户显式关掉就不救。context 过滤是必须的：空格在 Settings/Confirmation/Plugin 里也绑着（select:accept），不过滤会把默认值误杀。
  const voiceKeystroke = useMemo((): ParsedKeystroke | null => {
    if (!keybindingContext) return DEFAULT_VOICE_KEYSTROKE;
    let result: ParsedKeystroke | null = null;
    for (const binding of keybindingContext.bindings) {
      if (binding.context !== 'Chat') continue;
      if (binding.chord.length !== 1) continue;
      const ks = binding.chord[0];
      if (!ks) continue;
      if (binding.action === 'voice:pushToTalk') {
        result = ks;
      } else if (result !== null && keystrokesEqual(ks, result)) {
        // A later binding overrides this chord (null unbind or reassignment)
        result = null;
      }
    }
    return result;
  }, [keybindingContext]);

  // If the binding is a bare (unmodified) single printable char, terminal
  // auto-repeat may batch N keystrokes into one input event (e.g. "vvv"),
  // and the char flows into the text input — we need flow-through + strip.
  // Modifier combos (meta+k, ctrl+x) also auto-repeat (the letter part
  // repeats) but don't insert text, so they're swallowed from the first
  // press with no stripping needed. matchesKeyboardEvent handles those.
  const bareChar = voiceKeystroke !== null && voiceKeystroke.key.length === 1 && !voiceKeystroke.ctrl && !voiceKeystroke.alt && !voiceKeystroke.shift && !voiceKeystroke.meta && !voiceKeystroke.super ? voiceKeystroke.key : null;
// bareChar 判定：单字符 + 无任何修饰键。这类绑定要处理「终端把 N 次 auto-repeat 合并成一个输入事件」（vvv），组合键则每次重复一个事件、不插文字。
  const rapidCountRef = useRef(0);
  // How many rapid chars we intentionally let through to the text
  // input (the first WARMUP_THRESHOLD). The activation strip removes
  // up to this many + the activation event's potential leak. For the
  // default (space) this is precise — pre-existing trailing spaces are
  // rare. For letter bindings (validation warns) this may over-strip
  // one pre-existing char if the input already ended in the bound
  // letter (e.g. "hav" + hold "v" → "ha"). We don't track that
  // boundary — it's best-effort and the warning says so.
  const charsInInputRef = useRef(0);
  // Trailing-char count remaining after the activation strip — these
  // belong to the user's anchored prefix and must be preserved during
  // recording's defensive leak cleanup.
  const recordingFloorRef = useRef(0);
  // True when the current recording was started by key-hold (not focus).
  // Used to avoid swallowing keypresses during focus-mode recording.
  const isHoldActiveRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
// 四个 ref 分工：rapidCount 连击计数、charsInInput 故意放行数、recordingFloor 录音期防御剥离的地板、isHoldActive 区分按住录音与焦点录音。

  // Reset hold state as soon as we leave 'recording'. The physical hold
  // ends when key-repeat stops (state → 'processing'); keeping the ref
  // set through 'processing' swallows new space presses the user types
  // while the transcript finalizes.
// 离开 recording 立刻重置全部 hold 状态：物理按住结束在 auto-repeat 停止（状态进 processing），若把 ref 留到 processing 之后，用户边等转写边打的字会被全吞掉。
  useEffect(() => {
    if (voiceState !== 'recording') {
      isHoldActiveRef.current = false;
      rapidCountRef.current = 0;
      charsInInputRef.current = 0;
      recordingFloorRef.current = 0;
      setVoiceState(prev => {
        if (!prev.voiceWarmingUp) return prev;
        return {
          ...prev,
          voiceWarmingUp: false
        };
      });
    }
  }, [voiceState, setVoiceState]);
  const handleKeyDown = (e: KeyboardEvent): void => {
    if (!voiceEnabled) return;

    // PromptInput is not a valid transcript target — let the hold key
    // flow through instead of swallowing it into stale refs (#33556).
    // Two distinct unmount/unfocus paths (both needed):
    //   - !isActive: local-jsx command hid PromptInput (shouldHidePromptInput)
    //     without registering an overlay — e.g. /install-github-app,
    //     /plugin. Mirrors CommandKeybindingHandlers' isActive gate.
    //   - isModalOverlayActive: overlay (permission dialog, Select with
    //     onCancel) has focus; PromptInput is mounted but focus=false.
    if (!isActive || isModalOverlayActive) return;
// PromptInput 不是合法转录目标时的两条路径（#33556）：!isActive 是本地 jsx 命令藏了输入框但没注册 overlay（/install-github-app、/plugin）；isModalOverlayActive 是 overlay 拿了焦点。两条都要放行，否则按键被吞进陈旧 ref。

    // null means the user overrode the default (null-unbind/reassign) —
    // hold-to-talk is disabled via binding. To toggle the feature
    // itself, use /voice.
    if (voiceKeystroke === null) return;
// null = 用户用绑定覆盖显式关掉了按住说话。要开关功能本身用 /voice，不要在这里 fallback。

    // Match the configured key. Bare chars match by content (handles
    // batched auto-repeat like "vvv") with a modifier reject so e.g.
    // ctrl+v doesn't trip a "v" binding. Modifier combos go through
    // matchesKeyboardEvent (one event per repeat, no batching).
    let repeatCount: number;
    if (bareChar !== null) {
      if (e.ctrl || e.meta || e.shift) return;
      // When bound to space, also accept U+3000 (full-width space) —
      // CJK IMEs emit it for the same physical key.
      const normalized = bareChar === ' ' ? normalizeFullWidthSpace(e.key) : e.key;
      // Fast-path: normal typing (any char that isn't the bound one)
      // bails here without allocating. The repeat() check only matters
      // for batched auto-repeat (input.length > 1) which is rare.
      if (normalized[0] !== bareChar) return;
      if (normalized.length > 1 && normalized !== bareChar.repeat(normalized.length)) return;
// 合并 auto-repeat 的处理：vvv 这种一次事件多个字符，除了首字符匹配还要验证整体是同一字符的重复——否则 vvvX 会被当成 v 的连击。快速路径上任何非绑定字符零分配直接 bail。
      repeatCount = normalized.length;
    } else {
      if (!matchesKeyboardEvent(e, voiceKeystroke)) return;
      repeatCount = 1;
    }

    // Guard: only swallow keypresses when recording was triggered by
    // key-hold. Focus-mode recording also sets voiceState to 'recording',
    // but keypresses should flow through normally (voiceHandleKeyEvent
    // returns early for focus-triggered sessions). We also check voiceState
    // from the store so that if voiceHandleKeyEvent() fails to transition
    // state (module not loaded, stream unavailable) we don't permanently
    // swallow keypresses.
    const currentVoiceState = getVoiceState().voiceState;
// 吞键双保险：isHoldActive 说明这次录音是按键拉起的，currentVoiceState 从 store 同步读——voiceHandleKeyEvent 没能切换状态（模块没加载、流不可用）时不会永久吞键。焦点录音中按键正常放行。
    if (isHoldActiveRef.current && currentVoiceState !== 'idle') {
      // Already recording — swallow continued keypresses and forward
      // to voice for release detection. For bare chars, defensively
      // strip in case the text input handler fired before this one
      // (listener order is not guaranteed). Modifier combos don't
      // insert text, so nothing to strip.
      e.stopImmediatePropagation();
      if (bareChar !== null) {
        stripTrailing(repeatCount, {
          char: bareChar,
          floor: recordingFloorRef.current
        });
      }
      voiceHandleKeyEvent();
      return;
    }

    // Non-hold recording (focus-mode) or processing is active.
    // Modifier combos must not re-activate: stripTrailing(0,{anchor:true})
    // would overwrite voicePrefixRef with interim text and duplicate the
    // transcript on the next interim update. Pre-#22144, a single tap
    // hit the warmup else-branch (swallow only). Bare chars flow through
    // unconditionally — user may be typing during focus-recording.
    if (currentVoiceState !== 'idle') {
      if (bareChar === null) e.stopImmediatePropagation();
      return;
    }
// 非按住录音（焦点模式）进行中：组合键吞掉但不重激活——stripTrailing(0,{anchor:true}) 会用 interim 文本覆盖 voicePrefixRef，下次 interim 更新就把转写插两遍（#22144 之前轻点一下就中招）。裸字符无条件放行：焦点录音时用户可能在打字。
    const countBefore = rapidCountRef.current;
    rapidCountRef.current += repeatCount;

    // ── Activation ────────────────────────────────────────────
    // Handled first so the warmup branch below does NOT also run
    // on this event — two strip calls in the same tick would both
    // read the stale inputValueRef and the second would under-strip.
    // Modifier combos activate on the first press — they can't be
    // typed accidentally, so the hold threshold (which exists to
    // distinguish typing a space from holding space) doesn't apply.
// 激活分支刻意排在预热分支之前：同一 tick 里两个 strip 调用都会读到陈旧的 inputValueRef，第二个会少剥。组合键首按即激活，没有阈值问题。
    if (bareChar === null || rapidCountRef.current >= HOLD_THRESHOLD) {
      e.stopImmediatePropagation();
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      rapidCountRef.current = 0;
      isHoldActiveRef.current = true;
      setVoiceState(prev_0 => {
        if (!prev_0.voiceWarmingUp) return prev_0;
        return {
          ...prev_0,
          voiceWarmingUp: false
        };
      });
      if (bareChar !== null) {
        // Strip the intentional warmup chars plus this event's leak
        // (if text input fired first). Cap covers both; min(trailing)
        // handles the no-leak case. Anchor the voice prefix here.
        // The return value (remaining) becomes the floor for
        // recording-time leak cleanup.
        recordingFloorRef.current = stripTrailing(charsInInputRef.current + repeatCount, {
          char: bareChar,
          anchor: true
        });
        charsInInputRef.current = 0;
        voiceHandleKeyEvent();
      } else {
        // Modifier combo: nothing inserted, nothing to strip. Just
        // anchor the voice prefix at the current cursor position.
        // Longer fallback: this call is at t=0 (before auto-repeat),
        // so the gap to the next keypress is the OS initial repeat
        // *delay* (up to ~2s), not the repeat *rate* (~30-80ms).
        stripTrailing(0, {
          anchor: true
        });
        voiceHandleKeyEvent(MODIFIER_FIRST_PRESS_FALLBACK_MS);
      }
      // If voice failed to transition (module not loaded, stream
      // unavailable, stale enabled), clear the ref so a later
      // focus-mode recording doesn't inherit stale hold state
      // and swallow keypresses. Store is synchronous — the check is
      // immediate. The anchor set by stripTrailing above will
      // be overwritten on retry (anchor always overwrites now).
      if (getVoiceState().voiceState === 'idle') {
        isHoldActiveRef.current = false;
        resetAnchor();
      }
      return;
    }
// 激活后同步回检 store：voice 没能离开 idle（模块没加载/流不可用/enabled 陈旧）就清 isHoldActive + resetAnchor——不清的话后续焦点录音会继承陈旧的按住状态乱吞键。锚点反正总会被覆盖，这里撤销的是 gap 空格。

    // ── Warmup (bare-char only; modifier combos activated above) ──
    // First WARMUP_THRESHOLD chars flow to the text input so normal
    // typing has zero latency (a single press types normally).
    // Subsequent rapid chars are swallowed so the input stays aligned
    // with the warmup UI. Strip defensively (listener order is not
    // guaranteed — text input may have already added the char). The
    // floor preserves the intentional warmup chars; the strip is a
    // no-op when nothing leaked. Check countBefore so the event that
    // crosses the threshold still flows through (terminal batching).
    if (countBefore >= WARMUP_THRESHOLD) {
      e.stopImmediatePropagation();
      stripTrailing(repeatCount, {
        char: bareChar,
        floor: charsInInputRef.current
      });
    } else {
      charsInInputRef.current += repeatCount;
    }
// 预热分支：countBefore 让跨过阈值的那一发仍然放行（终端批量合并时一个事件带多个字符）。floor 保护故意放行的字符，防御性剥离只清泄漏。

    // Show warmup feedback once we detect a hold pattern
    if (rapidCountRef.current >= WARMUP_THRESHOLD) {
      setVoiceState(prev_1 => {
        if (prev_1.voiceWarmingUp) return prev_1;
        return {
          ...prev_1,
          voiceWarmingUp: true
        };
      });
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout((resetTimerRef_0, rapidCountRef_0, charsInInputRef_0, setVoiceState_0) => {
      resetTimerRef_0.current = null;
      rapidCountRef_0.current = 0;
      charsInInputRef_0.current = 0;
      setVoiceState_0(prev_2 => {
        if (!prev_2.voiceWarmingUp) return prev_2;
        return {
          ...prev_2,
          voiceWarmingUp: false
        };
      });
    }, RAPID_KEY_GAP_MS, resetTimerRef, rapidCountRef, charsInInputRef, setVoiceState);
// 120ms 无后续快速击键就整体复位（连击计数、放行计数、预热 UI）。setTimeout 额外参数把三个 ref 和 setVoiceState 全传进去——不靠闭包捕获，避免陈旧值。
  };

  // Backward-compat bridge: REPL.tsx doesn't yet wire handleKeyDown to
  // <Box onKeyDown>. Subscribe via useInput and adapt InputEvent →
  // KeyboardEvent until the consumer is migrated (separate PR).
  // TODO(onKeyDown-migration): remove once REPL passes handleKeyDown.
// 向后兼容桥：REPL.tsx 还没把 handleKeyDown 接到 Box onKeyDown 上，暂时用 useInput 订阅，把 InputEvent 适配成 KeyboardEvent。TODO 标记了迁移后删除。
  useInput((_input, _key, event) => {
    const kbEvent = new KeyboardEvent(event.keypress);
    handleKeyDown(kbEvent);
    // handleKeyDown stopped the adapter event, not the InputEvent the
    // emitter actually checks — forward it so the text input's useInput
    // listener is skipped and held spaces don't leak into the prompt.
// 这里必须再转发一次 stopImmediatePropagation：handleKeyDown 停掉的是适配出来的 KeyboardEvent，而 emitter 检查的是原始 InputEvent——不转发，文本输入的 useInput 监听器照样收到，按住空格就漏进提示框了。
    if (kbEvent.didStopImmediatePropagation()) {
      event.stopImmediatePropagation();
    }
  }, {
    isActive
  });
  return {
    handleKeyDown
  };
}

// TODO(onKeyDown-migration): temporary shim so existing JSX callers
// (<VoiceKeybindingHandler .../>) keep compiling. Remove once REPL.tsx
// wires handleKeyDown directly.
export function VoiceKeybindingHandler(props) {
  useVoiceKeybindingHandler(props);
  return null;
}
// 临时 shim：让现有 JSX 调用方（VoiceKeybindingHandler 组件）继续编译，本体已经迁到 hook 形态。
// 原文件此处有一行 67836 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。