// ═══════════════════════════════════════════════════════════════
//  AssistantToolUseMessage：屏幕上那行「⏺ Read(src/foo.ts)」
// ═══════════════════════════════════════════════════════════════
//
//  这是消息流里出现频率最高的一行，也是整批文件里参数最多的一个（十二个 prop）。
//  它要在同一行里塞下：
//
//      状态图标（转圈 / 圆点 / 勾 / 叉）  工具名  (参数摘要)  附加标签
//      下一行：进度消息（工具自己渲染的）
//      再下面：PreToolUse hook 的进度
//
//  四种状态的判定是本文件的核心：
//
//      isResolved            结果已到
//      isQueued              **既不在进行中、也没有结果** —— 排队等执行
//      isWaitingForPermission 有 worker 正在等这个工具的权限决定
//      isClassifierChecking   分类器正在判断这次调用是否安全
//
//  注意 isQueued 的定义是「两个否定」（见第 112 行），不是一个正面字段。
//
//  另外这个文件有三处「渲染工具消息」的函数，全都包着 try/catch ——
//  因为它们的实现来自各个工具（第三方扩展点），不能让一个工具的渲染 bug
//  炸掉整个对话。
import { c as _c } from "react/compiler-runtime";
import type { ToolUseBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React, { useMemo } from 'react';
import { useTerminalSize } from 'src/hooks/useTerminalSize.js';
import type { ThemeName } from 'src/utils/theme.js';
import type { Command } from '../../commands.js';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text, useTheme } from '../../ink.js';
import { useAppStateMaybeOutsideOfProvider } from '../../state/AppState.js';
import { findToolByName, type Tool, type ToolProgressData, type Tools } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import { useIsClassifierChecking } from '../../utils/classifierApprovalsHook.js';
import { logError } from '../../utils/log.js';
import type { buildMessageLookups } from '../../utils/messages.js';
import { MessageResponse } from '../MessageResponse.js';
import { useSelectedMessageBg } from '../messageActions.js';
import { SentryErrorBoundary } from '../SentryErrorBoundary.js';
import { ToolUseLoader } from '../ToolUseLoader.js';
import { HookProgressMessage } from './HookProgressMessage.js';
type Props = {
  param: ToolUseBlockParam;
  addMargin: boolean;
  tools: Tools;
  commands: Command[];
  verbose: boolean;
  inProgressToolUseIDs: Set<string>;
  progressMessagesForMessage: ProgressMessage[];
  shouldAnimate: boolean;
  shouldShowDot: boolean;
  inProgressToolCallCount?: number;
  lookups: ReturnType<typeof buildMessageLookups>;
  isTranscriptMode?: boolean;
};
export function AssistantToolUseMessage(t0) {
  const $ = _c(81);
  const {
    param,
    addMargin,
    tools,
    commands,
    verbose,
    inProgressToolUseIDs,
    progressMessagesForMessage,
    shouldAnimate,
    shouldShowDot,
    inProgressToolCallCount,
    lookups,
    isTranscriptMode
  } = t0;
// 【四个 hook，其中三个是"读全局状态"的同一个函数的三种用法】
//
//      useTerminalSize()                      终端尺寸（宽度影响截断）
//      useTheme()                             当前主题（配色）
//      useSelectedMessageBg()                 这条消息是否被选中
//      useAppStateMaybeOutsideOfProvider(…)   ← 注意这个 _MaybeOutsideOfProvider
//
//  最后那个是**宽松版**的 useAppState：没有 Provider 时返回 undefined 而不是抛错。
//  为什么需要宽松版？因为工具消息可能在「没有完整 AppState」的场景里被渲染
//  （比如导出转录、或者在测试里单独挂一个组件）。
//
//  宽松版的代价是：调用方必须处理 undefined。所以下面三行都用了 `?.`。
  const terminalSize = useTerminalSize();
  const [theme] = useTheme();
  const bg = useSelectedMessageBg();
// 【三个 selector 被提到模块顶层，就是文件末尾那三个 _temp】
//
//      useAppStateMaybeOutsideOfProvider(_temp)      state => state.pendingWorkerRequest
//      useAppStateMaybeOutsideOfProvider(_temp2)     state => state.toolPermissionContext.mode
//      useAppStateMaybeOutsideOfProvider(_temp3)     state => !!state.toolPermissionContext.strippedDangerousRules
//
//  selector 必须是**稳定引用**，否则每次渲染都是一个新函数，
//  订阅会不断重建（相当于每帧重新订阅一次 store）。
//
//  内联箭头函数会在每次渲染时创建新函数 → 触发 resubscribe。
//  所以这里用 `_c` 把箭头函数缓存进槽（$[0] 之类），
//  但更彻底的做法是提到模块顶层 —— 产物显示 Compiler 两条都做了：
//  提到顶层（_temp）+ 在槽里再缓存一次引用。
//
//  顺带一句：_temp3 的 `!!` 是为了把可能为 undefined 的字段折成布尔，
//  否则 `strippedDangerousRules` 是对象时，这里会返回对象而不是 true。
  const pendingWorkerRequest = useAppStateMaybeOutsideOfProvider(_temp);
  const isClassifierCheckingRaw = useIsClassifierChecking(param.id);
  const permissionMode = useAppStateMaybeOutsideOfProvider(_temp2);
  const hasStrippedRules = useAppStateMaybeOutsideOfProvider(_temp3);
// 【isAutoClassifier：两个条件，第二个带 and】
//
//      permissionMode === 'auto'
//      || (permissionMode === 'plan' && hasStrippedRules)
//
//  读作：自动模式下算「自动分类器」；计划模式下，**只有规则被剥离过**才算。
//
//  为什么计划模式要加这个条件？因为计划模式的默认行为是「什么都要问」，
//  只有当某些危险规则被剥离（用户预先授权了一批）时，
//  才有「分类器替我判断」的空间。
//
//  括号的缺失让这一行很容易读错（`a || b && c` 等价于 `a || (b && c)`），
//  这也是产物里常见的可读性损伤。
  const isAutoClassifier = permissionMode === "auto" || permissionMode === "plan" && hasStrippedRules;
// ⚠️ 【`false && …` —— 又一处构建期折叠的残留】
//
//      const isClassifierChecking = false && isClassifierCheckingRaw && permissionMode !== "auto"
//
//  整条恒为 false。也就是说这个构建里**永远不显示「classifier checking…」**，
//  但第 240 行那段 JSX 还在（`isClassifierChecking ? <MessageResponse>…</MessageResponse> : …`），
//  只是那个分支永远走不到。
//
//  同款残留本批已经见过四处（SystemAPIErrorMessage 的 `true &&`、
//  AttachmentMessage 的 `"external" === 'ant'`、SystemTextMessage 的 `false &&`）。
//
//  规律：**打包器把 USER_TYPE 这类变量替换成字面量之后，
//  只做了「常量折叠」，没做「死代码消除」。**
//  所以 `false && x` 会留下，而 `if (false) {...}` 通常会被干掉。
//
//  读代码时把它当成「这个功能在当前构建里关着」，而不是 bug。
  const isClassifierChecking = false && isClassifierCheckingRaw && permissionMode !== "auto";
  let t1;
// 【parsed 是一个四字段对象，整块被一个槽缓存】
//
//  它把「找工具 + 解析参数 + 算显示名」三件事的产物打包：
//
//      tool                              工具定义（含各个 render 方法）
//      input                             safeParse 的结果（success 判别联合）
//      userFacingToolName                「Read」这样给人看的名字
//      userFacingToolNameBackgroundColor 名字背后的底色（可选）
//      isTransparentWrapper              这个工具是不是「透明包装」
//
//  缓存键是 `param.input / param.name / tools` 三个 —— 只要工具表或输入变了就重算。
//
//  把五样东西打进一个对象、占一个槽，比各占一个槽省事，
//  代价是「任何一项变化都要整体重算」。这里可以接受，因为这五项都只依赖同样的输入。
  if ($[0] !== param.input || $[1] !== param.name || $[2] !== tools) {
    bb0: {
      if (!tools) {
        t1 = null;
        break bb0;
      }
      const tool = findToolByName(tools, param.name);
      if (!tool) {
        t1 = null;
        break bb0;
      }
// 【`tool.inputSchema.safeParse(param.input)` —— 每个工具都有自己的 zod schema】
//
//  这是本仓库「工具即插件」的核心机制：工具不仅提供执行逻辑，
//  还提供**输入的类型定义**。渲染层拿这个 schema 去校验模型的输入。
//
//  `input.success ? input.data : undefined` —— 校验失败不报错，
//  只是拿不到 data。后果是：
//    · 名字显示会退化成「不带参数的版本」（userFacingName(undefined)）
//    · 参数摘要那一行不显示（第 163 行 `input_0.success ? … : null`）
//
//  **对渲染层来说，输入不合法不是错误，是「信息缺失」。**
//  这与执行层的态度相反：执行层会拒绝不合法的输入。
//  同一个 schema，两种消费方式。
      const input = tool.inputSchema.safeParse(param.input);
      const data = input.success ? input.data : undefined;
      t1 = {
        tool,
        input,
        userFacingToolName: tool.userFacingName(data),
        userFacingToolNameBackgroundColor: tool.userFacingNameBackgroundColor?.(data),
        isTransparentWrapper: tool.isTransparentWrapper?.() ?? false
      };
    }
    $[0] = param.input;
    $[1] = param.name;
    $[2] = tools;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  const parsed = t1;
// 【找不到工具时先 logError 再返回 null —— 而且错误信息分两种情况】
//
//      tools 存在但找不到这个 tool   → `Tool ${name} not found`
//      tools 整个是 undefined        → `Tools array is undefined for tool ${name}`
//
//  区分这两种，是因为它们的根因完全不同：
//  前者是「模型调用了一个不存在的工具」（可能是幻觉，也可能是旧会话里的老工具），
//  后者是「渲染管线本身出了问题」（该传的东西没传）。
//
//  把它们合成一条错误信息会丢掉最关键的那一半信息。
  if (!parsed) {
    logError(new Error(tools ? `Tool ${param.name} not found` : `Tools array is undefined for tool ${param.name}`));
    return null;
  }
  const {
    tool: tool_0,
    input: input_0,
    userFacingToolName,
    userFacingToolNameBackgroundColor,
    isTransparentWrapper
  } = parsed;
  let t2;
  if ($[4] !== lookups.resolvedToolUseIDs || $[5] !== param.id) {
    t2 = lookups.resolvedToolUseIDs.has(param.id);
    $[4] = lookups.resolvedToolUseIDs;
    $[5] = param.id;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  const isResolved = t2;
  let t3;
// 【isQueued 是两个否定的与 ——「既没在跑，也没有结果」】
//
//      !inProgressToolUseIDs.has(param.id) && !isResolved
//
//  这个定义意味着：一个工具调用从「模型发出」到「进入执行队列」之间，
//  会短暂地处于 isQueued 状态。而如果它一直停在这个状态，
//  说明它卡在队列里没被调度。
//
//  用两个否定来描述一个正面状态，是因为**数据源只有这两个集合**：
//  inProgressToolUseIDs（正在跑的）和 lookups.resolvedToolUseIDs（有结果的）。
//  「剩下的」就是排队中的。
//
//  这也是为什么它必须缓存（$[7]-$[10]）：两个 Set 的引用不变时，
//  这个布尔值不该重算 —— 而 Set 每次构建都是新对象，所以键里要放引用本身。
  if ($[7] !== inProgressToolUseIDs || $[8] !== isResolved || $[9] !== param.id) {
    t3 = !inProgressToolUseIDs.has(param.id) && !isResolved;
    $[7] = inProgressToolUseIDs;
    $[8] = isResolved;
    $[9] = param.id;
    $[10] = t3;
  } else {
    t3 = $[10];
  }
  const isQueued = t3;
  const isWaitingForPermission = pendingWorkerRequest?.toolUseId === param.id;
// 【isTransparentWrapper：这类工具「借用」另一个工具的界面】
//
//  什么叫透明包装？比如某个工具在执行时其实是要调另一个工具，
//  它不想让用户看到自己，只想**按被包装者的样子**显示进度。
//
//  所以这里：
//      · 已出结果 → return null（结果由被包装者自己渲染）
//      · 排队中   → return null（还没到露脸的时候）
//      · 进行中   → **只画进度消息**，不画名字和参数
//
//  第 158 行还有一句配套的：`if (userFacingToolName === "") return null` ——
//  名字是空串的工具同样是「不露脸」，和 isTransparentWrapper 是两种表达方式。
//
//  一句话：**有些工具在 UI 上不存在。**
  if (isTransparentWrapper) {
    if (isQueued || isResolved) {
      return null;
    }
    let t4;
    if ($[11] !== inProgressToolCallCount || $[12] !== isTranscriptMode || $[13] !== lookups || $[14] !== param.id || $[15] !== progressMessagesForMessage || $[16] !== terminalSize || $[17] !== tool_0 || $[18] !== tools || $[19] !== verbose) {
      t4 = renderToolUseProgressMessage(tool_0, tools, lookups, param.id, progressMessagesForMessage, {
        verbose,
        inProgressToolCallCount,
        isTranscriptMode
      }, terminalSize);
      $[11] = inProgressToolCallCount;
      $[12] = isTranscriptMode;
      $[13] = lookups;
      $[14] = param.id;
      $[15] = progressMessagesForMessage;
      $[16] = terminalSize;
      $[17] = tool_0;
      $[18] = tools;
      $[19] = verbose;
      $[20] = t4;
    } else {
      t4 = $[20];
    }
    let t5;
    if ($[21] !== bg || $[22] !== t4) {
      t5 = <Box flexDirection="column" width="100%" backgroundColor={bg}>{t4}</Box>;
      $[21] = bg;
      $[22] = t4;
      $[23] = t5;
    } else {
      t5 = $[23];
    }
    return t5;
  }
  if (userFacingToolName === "") {
    return null;
  }
  let t4;
  if ($[24] !== commands || $[25] !== input_0.data || $[26] !== input_0.success || $[27] !== theme || $[28] !== tool_0 || $[29] !== verbose) {
    t4 = input_0.success ? renderToolUseMessage(tool_0, input_0.data, {
      theme,
      verbose,
      commands
    }) : null;
    $[24] = commands;
    $[25] = input_0.data;
    $[26] = input_0.success;
    $[27] = theme;
    $[28] = tool_0;
    $[29] = verbose;
    $[30] = t4;
  } else {
    t4 = $[30];
  }
  const renderedToolUseMessage = t4;
  if (renderedToolUseMessage === null) {
    return null;
  }
  const t5 = addMargin ? 1 : 0;
// 【minWidth 的算法：名字宽度 + 圆点占位】
//
//      const t6 = stringWidth(userFacingToolName) + (shouldShowDot ? 2 : 0)
//      <Box ... minWidth={t6}>
//
//  为什么要预留这个宽度？因为这一行后面还要放参数摘要和附加标签，
//  如果终端太窄，Ink 会把**工具名**折行 —— 变成
//  「Rea」换行「d(...)」，非常难看。
//
//  minWidth 的作用是：宁可让后面的内容折行，也不要拆工具名。
//
//  stringWidth 而不是 .length：因为中文工具名/emoji 占两列
//  （这个仓库里工具名基本是 ASCII，但函数选对了就不需要论证「这次不会中文」）。
  const t6 = stringWidth(userFacingToolName) + (shouldShowDot ? 2 : 0);
  let t7;
  if ($[31] !== isQueued || $[32] !== isResolved || $[33] !== lookups.erroredToolUseIDs || $[34] !== param.id || $[35] !== shouldAnimate || $[36] !== shouldShowDot) {
// 【三态图标：排队是灰圆点、进行中是转圈、已完成是勾或叉】
//
//      isQueued ? <Text dimColor>●</Text>
//               : <ToolUseLoader isUnresolved={!isResolved} isError={…} />
//
//  注意排队用的是**静态**圆点而不是转圈 —— 因为「排队」和「进行中」
//  在语义上不同，不该给同一个动画。用户在等的时候，
//  「还在队列里」和「已经在跑」是两个不同的心理预期。
//
//  这个细节体现了一条通用原则：
//  **动画只用于「正在推进」的状态**，静止的状态用静止的符号。
    t7 = shouldShowDot && (isQueued ? <Box minWidth={2}><Text dimColor={isQueued}>{BLACK_CIRCLE}</Text></Box> : <ToolUseLoader shouldAnimate={shouldAnimate} isUnresolved={!isResolved} isError={lookups.erroredToolUseIDs.has(param.id)} />);
    $[31] = isQueued;
    $[32] = isResolved;
    $[33] = lookups.erroredToolUseIDs;
    $[34] = param.id;
    $[35] = shouldAnimate;
    $[36] = shouldShowDot;
    $[37] = t7;
  } else {
    t7 = $[37];
  }
  const t8 = userFacingToolNameBackgroundColor ? "inverseText" : undefined;
  let t9;
  if ($[38] !== t8 || $[39] !== userFacingToolName || $[40] !== userFacingToolNameBackgroundColor) {
    t9 = <Box flexShrink={0}><Text bold={true} wrap="truncate-end" backgroundColor={userFacingToolNameBackgroundColor} color={t8}>{userFacingToolName}</Text></Box>;
    $[38] = t8;
    $[39] = userFacingToolName;
    $[40] = userFacingToolNameBackgroundColor;
    $[41] = t9;
  } else {
    t9 = $[41];
  }
  let t10;
  if ($[42] !== renderedToolUseMessage) {
    t10 = renderedToolUseMessage !== "" && <Box flexWrap="nowrap"><Text>({renderedToolUseMessage})</Text></Box>;
    $[42] = renderedToolUseMessage;
    $[43] = t10;
  } else {
    t10 = $[43];
  }
  let t11;
  if ($[44] !== input_0.data || $[45] !== input_0.success || $[46] !== tool_0) {
    t11 = input_0.success && tool_0.renderToolUseTag && tool_0.renderToolUseTag(input_0.data);
    $[44] = input_0.data;
    $[45] = input_0.success;
    $[46] = tool_0;
    $[47] = t11;
  } else {
    t11 = $[47];
  }
  let t12;
  if ($[48] !== t10 || $[49] !== t11 || $[50] !== t6 || $[51] !== t7 || $[52] !== t9) {
    t12 = <Box flexDirection="row" flexWrap="nowrap" minWidth={t6}>{t7}{t9}{t10}{t11}</Box>;
    $[48] = t10;
    $[49] = t11;
    $[50] = t6;
    $[51] = t7;
    $[52] = t9;
    $[53] = t12;
  } else {
    t12 = $[53];
  }
  let t13;
  if ($[54] !== inProgressToolCallCount || $[55] !== isAutoClassifier || $[56] !== isClassifierChecking || $[57] !== isQueued || $[58] !== isResolved || $[59] !== isTranscriptMode || $[60] !== isWaitingForPermission || $[61] !== lookups || $[62] !== param.id || $[63] !== progressMessagesForMessage || $[64] !== terminalSize || $[65] !== tool_0 || $[66] !== tools || $[67] !== verbose) {
// 【进度区是三选一：分类器检查 / 等权限 / 工具自己的进度】
//
//      isClassifierChecking        → 「Auto classifier checking…」
//      isWaitingForPermission      → 「Waiting for permission…」
//      renderToolUseProgressMessage → 工具自己画
//
//  三个都是「还没出结果」时显示的东西，优先级按「谁在阻塞」排序：
//  分类器在判断 → 权限在等 → 工具在跑。
//
//  这和外层状态机是同一套思路：**同一个时刻只显示一个最主要的原因。**
//  如果同时说「等权限」和「正在跑」，用户会困惑到底卡在哪。
    t13 = !isResolved && !isQueued && (isClassifierChecking ? <MessageResponse height={1}><Text dimColor={true}>{isAutoClassifier ? "Auto classifier checking\u2026" : "Bash classifier checking\u2026"}</Text></MessageResponse> : isWaitingForPermission ? <MessageResponse height={1}><Text dimColor={true}>Waiting for permission…</Text></MessageResponse> : renderToolUseProgressMessage(tool_0, tools, lookups, param.id, progressMessagesForMessage, {
      verbose,
      inProgressToolCallCount,
      isTranscriptMode
    }, terminalSize));
    $[54] = inProgressToolCallCount;
    $[55] = isAutoClassifier;
    $[56] = isClassifierChecking;
    $[57] = isQueued;
    $[58] = isResolved;
    $[59] = isTranscriptMode;
    $[60] = isWaitingForPermission;
    $[61] = lookups;
    $[62] = param.id;
    $[63] = progressMessagesForMessage;
    $[64] = terminalSize;
    $[65] = tool_0;
    $[66] = tools;
    $[67] = verbose;
    $[68] = t13;
  } else {
    t13 = $[68];
  }
  let t14;
  if ($[69] !== isQueued || $[70] !== isResolved || $[71] !== tool_0) {
// 【排队态还要再显示一次工具自己的「排队消息」】
//
//      !isResolved && isQueued && renderToolUseQueuedMessage(tool_0)
//
//  这是第三层：图标说「排队」、进度区说「在等权限」、
//  这里让工具补充一句「我排在什么位置」（比如 MCP 工具的队列深度）。
//
//  注意它只在 isQueued 时出现，和上面的进度区是**互斥**的
//  （进度区的条件是 !isResolved && !isQueued && …）。
//
//  三层结构：图标 / 主进度 / 排队补充。每层都有自己明确的条件，
//  读的时候按层检查，不要试图合并成一个状态机 —— 作者也没有合并。
    t14 = !isResolved && isQueued && renderToolUseQueuedMessage(tool_0);
    $[69] = isQueued;
    $[70] = isResolved;
    $[71] = tool_0;
    $[72] = t14;
  } else {
    t14 = $[72];
  }
  let t15;
  if ($[73] !== t12 || $[74] !== t13 || $[75] !== t14) {
    t15 = <Box flexDirection="column">{t12}{t13}{t14}</Box>;
    $[73] = t12;
    $[74] = t13;
    $[75] = t14;
    $[76] = t15;
  } else {
    t15 = $[76];
  }
  let t16;
  if ($[77] !== bg || $[78] !== t15 || $[79] !== t5) {
    t16 = <Box flexDirection="row" justifyContent="space-between" marginTop={t5} width="100%" backgroundColor={bg}>{t15}</Box>;
    $[77] = bg;
    $[78] = t15;
    $[79] = t5;
    $[80] = t16;
  } else {
    t16 = $[80];
  }
  return t16;
}
function _temp3(state_1) {
  return !!state_1.toolPermissionContext.strippedDangerousRules;
}
function _temp2(state_0) {
  return state_0.toolPermissionContext.mode;
}
function _temp(state) {
  return state.pendingWorkerRequest;
}
// 【renderToolUseMessage：包 try/catch，失败返回空串而不是 null】
//
//  注意失败返回的是 `''` 而不是 null。差别在于下游：
//
//      renderedToolUseMessage === null  → 整条消息 return null（第 180 行）
//      renderedToolUseMessage === ''    → 只是不显示参数摘要（第 210 行）
//
//  也就是说：**「参数渲染失败」不该让整行消失**。
//  工具名、图标、进度都还有意义，只有括号里那段摘要没了。
//
//  这是一个很实用的降级粒度判断：
//  **局部失败只降级局部，不要因为一个附加信息挂了就丢掉主体。**
function renderToolUseMessage(tool: Tool, input: unknown, {
  theme,
  verbose,
  commands
}: {
  theme: ThemeName;
  verbose: boolean;
  commands: Command[];
}): React.ReactNode {
  try {
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      return '';
    }
    return tool.renderToolUseMessage(parsed.data, {
      theme,
      verbose,
      commands
    });
  } catch (error) {
    logError(new Error(`Error rendering tool use message for ${tool.name}: ${error}`));
    return '';
  }
}
// 【renderToolUseProgressMessage 里做了两件事，顺序有讲究】
//
//  1. 先 filter 掉 hook_progress（第 340 行）
//  2. 再把过滤后的进度交给工具渲染
//
//  为什么要先滤？因为 hook_progress 是「hook 在跑」，不是「工具在跑」，
//  显示方式完全不同（要显示 hook 的名字和耗时）。
//  所以它被从进度数组里摘出来，改由第 350 行的 HookProgressMessage 单独渲染。
//
//  这就是 AssistantToolUseMessage 里会同时出现「工具自己画的进度」
//  和「HookProgressMessage」两个东西的原因 ——
//  它们在数据层是混在一起的，在渲染层被劈成两路。
//
//  过滤函数来自 Tool.js（filterToolProgressMessages），两处都用它，
//  保证「哪些算工具进度」这个判断只有一份。
function renderToolUseProgressMessage(tool: Tool, tools: Tools, lookups: ReturnType<typeof buildMessageLookups>, toolUseID: string, progressMessagesForMessage: ProgressMessage[], {
  verbose,
  inProgressToolCallCount,
  isTranscriptMode
}: {
  verbose: boolean;
  inProgressToolCallCount?: number;
  isTranscriptMode?: boolean;
}, terminalSize: {
  columns: number;
  rows: number;
}): React.ReactNode {
  const toolProgressMessages = progressMessagesForMessage.filter((msg): msg is ProgressMessage<ToolProgressData> => msg.data.type !== 'hook_progress');
// 【try/catch 把「钩子进度」和「工具进度」包在一起，但 SentryErrorBoundary 只包前者】
//
//  这是一个精确的分层：
//
//      try/catch            兜住「渲染函数本身抛错」（同步异常）
//      SentryErrorBoundary  兜住「子组件在渲染中抛错」（React 树内的异常）
//
//  前者能兜住后者吗？不能 —— React 的渲染异常会被调度器捕获，
//  在开发模式下甚至会让整棵树卸载。所以必须用 ErrorBoundary。
//
//  那为什么只包 HookProgressMessage 不包 toolMessages？
//  因为 toolMessages 是工具的返回值（一个 ReactNode），
//  出问题也是工具自己负责；而 HookProgressMessage 是**本仓库的组件**，
//  包一层边界能保证「hook 显示坏了不影响工具结果」。
//
//  这三行代码说明了错误边界该划在哪：**划在「你不太信任的那个组件」外面。**
  try {
    const toolMessages = tool.renderToolUseProgressMessage?.(toolProgressMessages, {
      tools,
      verbose,
      terminalSize,
      inProgressToolCallCount: inProgressToolCallCount ?? 1,
      isTranscriptMode
    }) ?? null;
    return <>
        <SentryErrorBoundary>
          <HookProgressMessage hookEvent="PreToolUse" lookups={lookups} toolUseID={toolUseID} verbose={verbose} isTranscriptMode={isTranscriptMode} />
        </SentryErrorBoundary>
        {toolMessages}
      </>;
  } catch (error) {
    logError(new Error(`Error rendering tool use progress message for ${tool.name}: ${error}`));
    return null;
  }
}
function renderToolUseQueuedMessage(tool: Tool): React.ReactNode {
  try {
    return tool.renderToolUseQueuedMessage?.();
  } catch (error) {
    logError(new Error(`Error rendering tool use queued message for ${tool.name}: ${error}`));
    return null;
  }
}
// 原文件此处有一行 32808 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。