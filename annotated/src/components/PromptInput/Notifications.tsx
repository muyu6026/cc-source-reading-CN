// ═══════════════════════════════════════════════════════════════
//  Notifications：输入框右下角那一行，九个人抢一个位置
// ═══════════════════════════════════════════════════════════════
//
//  这是 PromptInput 目录里「信息密度最高」的一个组件。它自己不做任何样式，
//  职责是**把九个互相独立的指示器按固定顺序竖着摞起来**：
//
//    IdeStatusIndicator / 当前通知 / 超额用量 / apiKeyHelper 慢 /
//    未登录 / Debug 模式 / token 数 / TokenWarning / 自动更新 /
//    语音错误 / 内存占用 / 沙箱拦截提示
//
//  每个都有自己的显示条件，其中绝大多数平时是 null。所以「这一行」在
//  真实使用中通常只有 0-1 个元素，但代码必须为所有组合负责。
//
//  两个组件：Notifications（收集 + 计算条件）和 NotificationContent（纯渲染），
//  拆开的原因在第 178 行那个 15 项的缓存键里 —— 计算和渲染的代价差太多。
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import * as React from 'react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { type Notification, useNotifications } from 'src/context/notifications.js';
import { logEvent } from 'src/services/analytics/index.js';
import { useAppState } from 'src/state/AppState.js';
import { useVoiceState } from '../../context/voice.js';
import type { VerificationStatus } from '../../hooks/useApiKeyVerification.js';
import { useIdeConnectionStatus } from '../../hooks/useIdeConnectionStatus.js';
import type { IDESelection } from '../../hooks/useIdeSelection.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useVoiceEnabled } from '../../hooks/useVoiceEnabled.js';
import { Box, Text } from '../../ink.js';
import { useClaudeAiLimits } from '../../services/claudeAiLimitsHook.js';
import { calculateTokenWarningState } from '../../services/compact/autoCompact.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';
import type { Message } from '../../types/message.js';
import { getApiKeyHelperElapsedMs, getConfiguredApiKeyHelper, getSubscriptionType } from '../../utils/auth.js';
import type { AutoUpdaterResult } from '../../utils/autoUpdater.js';
import { getExternalEditor } from '../../utils/editor.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { formatDuration } from '../../utils/format.js';
import { setEnvHookNotifier } from '../../utils/hooks/fileChangedWatcher.js';
import { toIDEDisplayName } from '../../utils/ide.js';
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js';
import { tokenCountFromLastAPIResponse } from '../../utils/tokens.js';
import { AutoUpdaterWrapper } from '../AutoUpdaterWrapper.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { IdeStatusIndicator } from '../IdeStatusIndicator.js';
import { MemoryUsageIndicator } from '../MemoryUsageIndicator.js';
import { SentryErrorBoundary } from '../SentryErrorBoundary.js';
import { TokenWarning } from '../TokenWarning.js';
import { SandboxPromptFooterHint } from './SandboxPromptFooterHint.js';

// 【又一个条件 require：语音功能编译期剔除】
//
//  写法是 `const VoiceIndicator: typeof import(...).VoiceIndicator = feature(...) ? require(...).X : () => null`。
//
//  两个细节：
//    · 类型标注用的是 `typeof import('./VoiceIndicator.js').X` —— 即使这个模块
//      最终没被打进包，类型还在（类型是编译期的，运行期擦除）。所以这里
//      既保住了类型安全，又不产生运行时依赖。
//    · 假分支给的是 `() => null`，一个**合法组件**而不是 null。
//      这样下面就能无脑 `<VoiceIndicator …/>`，不需要到处都是条件渲染。
//
//  「用一个空组件代替 null」是条件渲染里最常见的降噪手法：
//  把判断从 N 个调用点收敛到 1 个定义点。
/* eslint-disable @typescript-eslint/no-require-imports */
const VoiceIndicator: typeof import('./VoiceIndicator.js').VoiceIndicator = feature('VOICE_MODE') ? require('./VoiceIndicator.js').VoiceIndicator : () => null;
/* eslint-enable @typescript-eslint/no-require-imports */

export const FOOTER_TEMPORARY_STATUS_TIMEOUT = 5000;
type Props = {
  apiKeyStatus: VerificationStatus;
  autoUpdaterResult: AutoUpdaterResult | null;
  isAutoUpdating: boolean;
  debug: boolean;
  verbose: boolean;
  messages: Message[];
  onAutoUpdaterResult: (result: AutoUpdaterResult) => void;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  ideSelection: IDESelection | undefined;
  mcpClients?: MCPServerConnection[];
  isInputWrapped?: boolean;
  isNarrow?: boolean;
};
// 【两个 optional prop 在函数体里被补了默认值】
//
//  isInputWrapped / isNarrow 在 Props 里是可选的，但参数解构时改名成 t1/t2，
//  下一行再 `t1 === undefined ? false : t1`。
//
//  为什么不直接在解构里写默认值？因为在编译产物里，默认值会被展开成
//  这种三元 —— 编译器需要显式看到「未定义时用 false」这件事，
//  才能正确地把它纳入缓存判断。源码里多半写的是 `isInputWrapped = false`。
//
//  读产物时看到 `t1 === undefined ? false : t1`，等价于源码里的默认参数。
export function Notifications(t0) {
  const $ = _c(34);
  const {
    apiKeyStatus,
    autoUpdaterResult,
    debug,
    isAutoUpdating,
    verbose,
    messages,
    onAutoUpdaterResult,
    onChangeIsUpdating,
    ideSelection,
    mcpClients,
    isInputWrapped: t1,
    isNarrow: t2
  } = t0;
  const isInputWrapped = t1 === undefined ? false : t1;
  const isNarrow = t2 === undefined ? false : t2;
  let t3;
  if ($[0] !== messages) {
// 【token 数只算「最近一次压缩之后」的消息】
//
//  getMessagesAfterCompactBoundary → tokenCountFromLastAPIResponse。
//
//  为什么必须先切边界：上下文压缩（compact）之后，之前的消息对当前窗口
//  不再计入。如果从头累加，进度条会永远显示「快满了」，而实际上刚压缩过、
//  窗口是空的。
//
//  这是「统计口径必须和显示对象一致」的例子：这个数字的用途是
//  「告诉用户还剩多少上下文」，所以它的口径必须是「当前上下文窗口里有多少」。
//
//  第 85-92 行把结果缓存到 $[1]，键是 messages —— 也就是说除非消息数组换了，
//  否则不重算这个扫描（它要遍历全部消息找最后一次 usage）。
    const messagesForTokenCount = getMessagesAfterCompactBoundary(messages);
    t3 = tokenCountFromLastAPIResponse(messagesForTokenCount);
    $[0] = messages;
    $[1] = t3;
  } else {
    t3 = $[1];
  }
  const tokenUsage = t3;
  const mainLoopModel = useMainLoopModel();
  let t4;
  if ($[2] !== mainLoopModel || $[3] !== tokenUsage) {
    t4 = calculateTokenWarningState(tokenUsage, mainLoopModel);
    $[2] = mainLoopModel;
    $[3] = tokenUsage;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  const isShowingCompactMessage = t4.isAboveWarningThreshold;
  const {
    status: ideStatus
  } = useIdeConnectionStatus(mcpClients);
  const notifications = useAppState(_temp);
  const {
    addNotification,
    removeNotification
  } = useNotifications();
  const claudeAiLimits = useClaudeAiLimits();
  let t5;
  let t6;
// 【把一个 React 组件注册成全局单例回调，卸载时必须手动注销】
//
//      setEnvHookNotifier((text, isError) => { addNotification(...) })
//      return () => setEnvHookNotifier(null)     ← cleanup
//
//  这是「外部世界 → React 世界」的桥：文件变更监听器不知道 React 存在，
//  只能通过一个模块级的 setter 把事件交进来，由组件转成通知。
//
//  三个隐含约束：
//    1. 只能有一个订阅者（单例 setter），所以这个组件必须全局只有一个
//    2. cleanup 必须置 null，否则回调会一直往一个已卸载组件的 addNotification
//       里塞东西 —— 那个函数来自 context，卸载后调用是悬空引用
//    3. 依赖是 [addNotification]：addNotification 一旦换引用（context 重建），
//       就要重新注册。编译器把 deps 一起缓存成了 t6
//
//  这类桥的通用判据：**凡是 setXxxHandler(fn) 形式的 API，都要配一个 setXxxHandler(null)**。
  if ($[5] !== addNotification) {
    t5 = () => {
      setEnvHookNotifier((text, isError) => {
        addNotification({
          key: "env-hook",
          text,
          color: isError ? "error" : undefined,
          priority: isError ? "medium" : "low",
          timeoutMs: isError ? 8000 : 5000
        });
      });
      return _temp2;
    };
    t6 = [addNotification];
    $[5] = addNotification;
    $[6] = t5;
    $[7] = t6;
  } else {
    t5 = $[6];
    t6 = $[7];
  }
  useEffect(t5, t6);
// 【两条条件的优先级：IDE 选中内容 压过 自动更新结果】
//
//  shouldShowIdeSelection：连着 IDE 且有选中的文件或非空选区。
//  shouldShowAutoUpdater：`!shouldShowIdeSelection || isAutoUpdating || status !== 'success'`
//
//  第二行读起来别扭，拆开是：
//    · 没有 IDE 选中要显示 → 显示自动更新（即使成功也显示，作为「已是最新」的反馈）
//    · 有 IDE 选中，但正在更新 或 上次更新失败 → 也让自动更新占位（异常优先于常态）
//
//  也就是说：**异常状态可以抢位，正常状态不能。** 这是提示类 UI 的通用优先级——
//  「一切正常」的信息可以等，出问题的信息不能等。
//
//  注意 `status !== "success"` 覆盖了 failed 和 null（还没检查过）。
  const shouldShowIdeSelection = ideStatus === "connected" && (ideSelection?.filePath || ideSelection?.text && ideSelection.lineCount > 0);
  const shouldShowAutoUpdater = !shouldShowIdeSelection || isAutoUpdating || autoUpdaterResult?.status !== "success";
  const isInOverageMode = claudeAiLimits.isUsingOverage;
  let t7;
// 【getSubscriptionType() / getExternalEditor() 用哨兵 → 永久缓存】
//
//  第 139-146 行同理。这两次缓存意味着：**订阅类型和外部编辑器在整个
//  组件生命周期里只读一次**。
//
//  对 subscriptionType 是对的（登录状态不会在会话中途变）。
//  对 editor 就有点悬：用户在设置里改了 $EDITOR，这里不会更新 ——
//  但因为组件可能因为别的原因重挂（切换视图），重挂时又会读一次，
//  所以实际表现是「有时生效、有时不生效」。这种不确定性最难排查。
//
//  判断这类缓存的正确性问题，要问：**这个值在什么情况下会变，谁会通知我？**
//  如果答案是「没人通知」，那缓存在第一次读就是对的；
//  如果答案是「配置文件会变，但没人通知」，那就应该每次读、或者显式订阅。
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = getSubscriptionType();
    $[8] = t7;
  } else {
    t7 = $[8];
  }
  const subscriptionType = t7;
  const isTeamOrEnterprise = subscriptionType === "team" || subscriptionType === "enterprise";
  let t8;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = getExternalEditor();
    $[9] = t8;
  } else {
    t8 = $[9];
  }
  const editor = t8;
// 【外部编辑器提示：一个「教用户快捷键」的通知】
//
//  条件是四个与：输入换行了 且 没在显示压缩警告 且 key 有效 且 配了编辑器。
//
//  「输入换行了」这个条件很有意思：isInputWrapped 来自 PromptInput
//  （input.includes(换行)）。也就是说，**只有当用户真的开始写多行时**，
//  才提示「你可以用 ctrl+g 在编辑器里写」。单行短句不需要编辑器。
//
//  这是「按需教学」的典型：不去配置里找一个「是否显示提示」的开关，
//  而是找一个**用户行为上的信号**来推断他此刻需不需要知道这件事。
//
//  第 160-162 行的 else 分支同样重要：条件不满足时主动 removeNotification。
//  提示类代码最容易漏的就是这个 —— 条件消失后提示还挂在那儿。
  const shouldShowExternalEditorHint = isInputWrapped && !isShowingCompactMessage && apiKeyStatus !== "invalid" && apiKeyStatus !== "missing" && editor !== undefined;
  let t10;
  let t9;
  if ($[10] !== addNotification || $[11] !== removeNotification || $[12] !== shouldShowExternalEditorHint) {
    t9 = () => {
      if (shouldShowExternalEditorHint && editor) {
        logEvent("tengu_external_editor_hint_shown", {});
        addNotification({
          key: "external-editor-hint",
          jsx: <Text dimColor={true}><ConfigurableShortcutHint action="chat:externalEditor" context="Chat" fallback="ctrl+g" description={`edit in ${toIDEDisplayName(editor)}`} /></Text>,
          priority: "immediate",
          timeoutMs: 5000
        });
      } else {
        removeNotification("external-editor-hint");
      }
    };
    t10 = [shouldShowExternalEditorHint, editor, addNotification, removeNotification];
    $[10] = addNotification;
    $[11] = removeNotification;
    $[12] = shouldShowExternalEditorHint;
    $[13] = t10;
    $[14] = t9;
  } else {
    t10 = $[13];
    t9 = $[14];
  }
  useEffect(t9, t10);
  const t11 = isNarrow ? "flex-start" : "flex-end";
  const t12 = isInOverageMode ?? false;
  let t13;
  if ($[15] !== apiKeyStatus || $[16] !== autoUpdaterResult || $[17] !== debug || $[18] !== ideSelection || $[19] !== isAutoUpdating || $[20] !== isShowingCompactMessage || $[21] !== mainLoopModel || $[22] !== mcpClients || $[23] !== notifications || $[24] !== onAutoUpdaterResult || $[25] !== onChangeIsUpdating || $[26] !== shouldShowAutoUpdater || $[27] !== t12 || $[28] !== tokenUsage || $[29] !== verbose) {
    t13 = <NotificationContent ideSelection={ideSelection} mcpClients={mcpClients} notifications={notifications} isInOverageMode={t12} isTeamOrEnterprise={isTeamOrEnterprise} apiKeyStatus={apiKeyStatus} debug={debug} verbose={verbose} tokenUsage={tokenUsage} mainLoopModel={mainLoopModel} shouldShowAutoUpdater={shouldShowAutoUpdater} autoUpdaterResult={autoUpdaterResult} isAutoUpdating={isAutoUpdating} isShowingCompactMessage={isShowingCompactMessage} onAutoUpdaterResult={onAutoUpdaterResult} onChangeIsUpdating={onChangeIsUpdating} />;
    $[15] = apiKeyStatus;
    $[16] = autoUpdaterResult;
    $[17] = debug;
    $[18] = ideSelection;
    $[19] = isAutoUpdating;
    $[20] = isShowingCompactMessage;
    $[21] = mainLoopModel;
    $[22] = mcpClients;
    $[23] = notifications;
    $[24] = onAutoUpdaterResult;
    $[25] = onChangeIsUpdating;
    $[26] = shouldShowAutoUpdater;
    $[27] = t12;
    $[28] = tokenUsage;
    $[29] = verbose;
    $[30] = t13;
  } else {
    t13 = $[30];
  }
  let t14;
  if ($[31] !== t11 || $[32] !== t13) {
    t14 = <SentryErrorBoundary><Box flexDirection="column" alignItems={t11} flexShrink={0} overflowX="hidden">{t13}</Box></SentryErrorBoundary>;
    $[31] = t11;
    $[32] = t13;
    $[33] = t14;
  } else {
    t14 = $[33];
  }
  return t14;
}
// 【_temp2 和 _temp：两个被提升到模块作用域的小函数】
//
//  _temp2 是 setEnvHookNotifier(null) 的包装（cleanup 函数）；
//  _temp 是 `s => s.notifications`（第 213 行，useAppState 的 selector）。
//
//  selector 被提升成模块常量，这一点很关键：**如果 selector 每次渲染都是新函数，
//  有些状态库（含 zustand 的某些版本）会认为订阅变化，重新订阅**，
//  严重时会导致每帧一次 subscribe/unsubscribe。
//
//  所以「selector 写成模块级常量」不只是微优化，是正确性要求。
//  （本仓其它地方大量使用内联 `s => s.x`，看起来矛盾 —— 那是因为
//  那套 useAppState 实现按引用稳定性做了处理，或者接受这个代价。）
function _temp2() {
  return setEnvHookNotifier(null);
}
function _temp(s) {
  return s.notifications;
}
// 【NotificationContent 是纯渲染组件，但它自己就有两个状态源】
//
//  它有 useState（apiKeyHelperSlow）和四个 useEffect。之所以拆成独立组件
//  而不是就地展开，是为了让这些 hook **只在真正要显示时才挂载**？
//  不对 —— 它在第 179 行是无条件渲染的。
//
//  真正的理由是缓存粒度：Notifications 里那段 15 项缓存键（第 178 行）
//  只负责「拼出 props」，一旦某个 prop 变了才重建这个元素；
//  而 NotificationContent 内部的状态变化（比如 apiKeyHelperSlow 每秒更新）
//  不会反过来让那 15 项重算。
//
//  换句话说：**拆组件是为了把「频繁变化的小状态」关在一个小盒子里**，
//  不让它的变化扩散到上层。这也是 React 里最有效的性能手段之一 ——
//  比 memo 更根本，因为它缩小了「谁会重渲染」的范围。
function NotificationContent({
  ideSelection,
  mcpClients,
  notifications,
  isInOverageMode,
  isTeamOrEnterprise,
  apiKeyStatus,
  debug,
  verbose,
  tokenUsage,
  mainLoopModel,
  shouldShowAutoUpdater,
  autoUpdaterResult,
  isAutoUpdating,
  isShowingCompactMessage,
  onAutoUpdaterResult,
  onChangeIsUpdating
}: {
  ideSelection: IDESelection | undefined;
  mcpClients?: MCPServerConnection[];
  notifications: {
    current: Notification | null;
    queue: Notification[];
  };
  isInOverageMode: boolean;
  isTeamOrEnterprise: boolean;
  apiKeyStatus: VerificationStatus;
  debug: boolean;
  verbose: boolean;
  tokenUsage: number;
  mainLoopModel: string;
  shouldShowAutoUpdater: boolean;
  autoUpdaterResult: AutoUpdaterResult | null;
  isAutoUpdating: boolean;
  isShowingCompactMessage: boolean;
  onAutoUpdaterResult: (result: AutoUpdaterResult) => void;
  onChangeIsUpdating: (isUpdating: boolean) => void;
}): ReactNode {
  // Poll apiKeyHelper inflight state to show slow-helper notice.
  // Gated on configuration — most users never set apiKeyHelper, so the
  // effect is a no-op for them (no interval allocated).
  const [apiKeyHelperSlow, setApiKeyHelperSlow] = useState<string | null>(null);
// 【1 秒一次的轮询，但只在配置了 apiKeyHelper 时才建】
//
//  第 259 行 `if (!getConfiguredApiKeyHelper()) return` —— 注释说得对：
//  绝大多数用户没配 helper，这个 effect 对他们**不分配定时器**，成本为零。
//
//  「先判断再创建资源」比「创建了再在回调里判断」好：后者每秒醒一次、
//  每秒做一次无效判断，还要考虑 clearInterval 的时机。
//
//  第 260-264 行有三个值得看的写法：
//    · setInterval(fn, 1000, setApiKeyHelperSlow) —— 第三个参数传 setter，
//      于是回调不捕获任何渲染期变量，effect 的 deps 可以是 []
//    · `ms >= 10_000 ? formatDuration(ms) : null` —— 10 秒以内不提示
//    · `setSlow(prev => next === prev ? prev : next)` —— **同值不更新**
//
//  第三条是这里的核心：如果不写，每秒都会 setState（哪怕是同样的值），
//  React 虽然会因 Object.is 相等而跳过重渲染，但每次 setState 仍要走一遍
//  「调度 + 比较」的流程。这个小三元让「没事发生的一秒」完全静默。
  useEffect(() => {
    if (!getConfiguredApiKeyHelper()) return;
    const interval = setInterval((setSlow: React.Dispatch<React.SetStateAction<string | null>>) => {
      const ms = getApiKeyHelperElapsedMs();
      const next = ms >= 10_000 ? formatDuration(ms) : null;
      setSlow(prev => next === prev ? prev : next);
    }, 1000, setApiKeyHelperSlow);
    return () => clearInterval(interval);
  }, []);

  // Voice state (VOICE_MODE builds only, runtime-gated by GrowthBook)
// 【四个 feature 三元包住的 hook，全都带 biome-ignore】
//
//  `feature('VOICE_MODE') ? useVoiceState(...) : 'idle'`
//
//  这违反了 hook 规则的字面（条件调用），但它安全 —— 因为 feature()
//  是**编译期常量**：在同一个构建里它永远是同一个值，两次渲染之间不可能变。
//  所以 hook 的调用顺序在这份产物里是恒定的。
//
//  注释里那句 `biome-ignore lint/correctness/useHookAtTopLevel` 就是在向
//  工具解释这件事。工具没法知道 feature() 是常量，人知道。
//
//  这是一种「用构建期常量换取零运行时开销」的技巧，代价是：
//  代码在静态分析眼里永远有 lint 违规，读者必须逐处理解为什么安全。
//  如果 feature() 将来变成运行时读配置，这里会立刻炸（hook 顺序错乱）。
  const voiceState = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useVoiceState(s => s.voiceState) : 'idle' as const;
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  const voiceEnabled = feature('VOICE_MODE') ? useVoiceEnabled() : false;
  const voiceError = feature('VOICE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useVoiceState(s_0 => s_0.voiceError) : null;
  const isBriefOnly = feature('KAIROS') || feature('KAIROS_BRIEF') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useAppState(s_1 => s_1.isBriefOnly) : false;

  // When voice is actively recording or processing, replace all
  // notifications with just the voice indicator.
// 【录音/处理时，整行通知被一个语音指示器**替换**掉】
//
//  注意是 replace 而不是 push：这里是 `return <VoiceIndicator/>`，
//  直接跳过了下面整块 fragment。于是：
//
//    平时：IDE 状态 + 通知 + token 数 + 自动更新 + …
//    语音中：只有「listening…」
//
//  为什么这么激进：语音录音时用户的注意力在说话上，屏幕上任何其他信息都是
//  干扰；而且那些指示器（比如自动更新的进度）在这个时刻也没有行动价值。
//
//  这是一个「模式覆盖一切」的设计决定。它的风险是**信息黑洞**：
//  如果语音状态卡在 recording（比如麦克风占用），用户就看不到任何其他提示了。
//  所以这一行的条件写得比较严：必须 voiceEnabled 且状态确实是那两个之一。
  if (feature('VOICE_MODE') && voiceEnabled && (voiceState === 'recording' || voiceState === 'processing')) {
    return <VoiceIndicator voiceState={voiceState} />;
  }
// 【九个指示器竖排，顺序就是优先级 —— 从上往下读】
//
//    IdeStatusIndicator      IDE 里选了什么（最贴近用户当下动作）
//    当前通知                一次只显示一条（队列在别处管）
//    超额用量                钱的提醒
//    apiKeyHelper 慢         卡顿解释
//    未登录                  阻断性问题（红字）
//    Debug 模式              开发者信息
//    token 数                仅 verbose
//    TokenWarning            上下文快满
//    自动更新                后台动作
//    语音错误
//    内存占用
//    沙箱拦截
//
//  这个顺序不是按重要性排的，而是按「谁应该离输入框更近」：
//  越靠上越贴近输入区。因为它们整体是从下往上长的（父级 alignItems
//  flex-end），所以这个数组的顺序 = 视觉上的从上到下。
//
//  第 293 行 `isInOverageMode && !isTeamOrEnterprise` 那一对条件值得注意：
//  团队/企业版没有「超额」概念（走的是别的计费），所以这个提示必须排除它们。
  return <>
      <IdeStatusIndicator ideSelection={ideSelection} mcpClients={mcpClients} />
      {notifications.current && ('jsx' in notifications.current ? <Text wrap="truncate" key={notifications.current.key}>
            {notifications.current.jsx}
          </Text> : <Text color={notifications.current.color} dimColor={!notifications.current.color} wrap="truncate">
            {notifications.current.text}
          </Text>)}
      {isInOverageMode && !isTeamOrEnterprise && <Box>
          <Text dimColor wrap="truncate">
            Now using extra usage
          </Text>
        </Box>}
      {apiKeyHelperSlow && <Box>
          <Text color="warning" wrap="truncate">
            apiKeyHelper is taking a while{' '}
          </Text>
          <Text dimColor wrap="truncate">
            ({apiKeyHelperSlow})
          </Text>
        </Box>}
      {(apiKeyStatus === 'invalid' || apiKeyStatus === 'missing') && <Box>
          <Text color="error" wrap="truncate">
            {isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ? 'Authentication error · Try again' : 'Not logged in · Run /login'}
          </Text>
        </Box>}
      {debug && <Box>
          <Text color="warning" wrap="truncate">
            Debug mode
          </Text>
        </Box>}
      {apiKeyStatus !== 'invalid' && apiKeyStatus !== 'missing' && verbose && <Box>
          <Text dimColor wrap="truncate">
            {tokenUsage} tokens
          </Text>
        </Box>}
// 【brief 模式下不显示 TokenWarning】
//
//  brief 模式（KAIROS）是「极简界面」：只留对话，其余全砍。
//  TokenWarning 是一条会突然出现的警告行，在极简界面里会破坏整个布局节奏，
//  所以整块跳过。
//
//  注意它跳过的是「警告」，不是「统计」—— 也就是说 brief 模式下用户
//  确实可能没意识到上下文快满了。这是个取舍：**极简模式接受功能损失，
//  换取视觉稳定性。**
//
//  读到这里可以回头看一眼第 269-279 行：brief 模式相关的判断分散在
//  三个地方（TokenWarning、voiceState 之类），而不是统一一个 isBriefOnly
//  分支。这种「同一概念多点判断」的代码，改需求时最容易漏掉一处。
      {!isBriefOnly && <TokenWarning tokenUsage={tokenUsage} model={mainLoopModel} />}
      {shouldShowAutoUpdater && <AutoUpdaterWrapper verbose={verbose} onAutoUpdaterResult={onAutoUpdaterResult} autoUpdaterResult={autoUpdaterResult} isUpdating={isAutoUpdating} onChangeIsUpdating={onChangeIsUpdating} showSuccessMessage={!isShowingCompactMessage} />}
      {feature('VOICE_MODE') ? voiceEnabled && voiceError && <Box>
              <Text color="error" wrap="truncate">
                {voiceError}
              </Text>
            </Box> : null}
      <MemoryUsageIndicator />
      <SandboxPromptFooterHint />
    </>;
}
// 原文件此处有一行 34740 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。