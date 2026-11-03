// 本文件是 Bash 工具执行前的权限确认弹窗，也是整个权限体系里最复杂的一块门面。结构分三层：最外层是分流器（先判断这条命令能不能交给专门的 sed 编辑弹窗处理，不能才进主体）；中间是 Inner 主体（约 535 行，负责所有状态与选项组装）；最上面被单独提出去的是分类器检查字幕（一个 20fps 的微光动画，必须隔离，理由见下面那段注释）。整份文件最值得读的是「选项集合如何随特性开关与后端建议变形」这一条主线。
import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import figures from 'figures';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useTheme } from '../../../ink.js';
import { useKeybinding } from '../../../keybindings/useKeybinding.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../../services/analytics/growthbook.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../../services/analytics/index.js';
import { sanitizeToolNameForAnalytics } from '../../../services/analytics/metadata.js';
import { useAppState } from '../../../state/AppState.js';
import { BashTool } from '../../../tools/BashTool/BashTool.js';
import { getFirstWordPrefix, getSimpleCommandPrefix } from '../../../tools/BashTool/bashPermissions.js';
import { getDestructiveCommandWarning } from '../../../tools/BashTool/destructiveCommandWarning.js';
import { parseSedEditCommand } from '../../../tools/BashTool/sedEditParser.js';
import { shouldUseSandbox } from '../../../tools/BashTool/shouldUseSandbox.js';
import { getCompoundCommandPrefixesStatic } from '../../../utils/bash/prefix.js';
import { createPromptRuleContent, generateGenericDescription, getBashPromptAllowDescriptions, isClassifierPermissionsEnabled } from '../../../utils/permissions/bashClassifier.js';
import { extractRules } from '../../../utils/permissions/PermissionUpdate.js';
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js';
import { SandboxManager } from '../../../utils/sandbox/sandbox-adapter.js';
import { Select } from '../../CustomSelect/select.js';
import { ShimmerChar } from '../../Spinner/ShimmerChar.js';
import { useShimmerAnimation } from '../../Spinner/useShimmerAnimation.js';
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js';
import { PermissionDecisionDebugInfo } from '../PermissionDecisionDebugInfo.js';
import { PermissionDialog } from '../PermissionDialog.js';
import { PermissionExplainerContent, usePermissionExplainerUI } from '../PermissionExplanation.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
import { SedEditPermissionRequest } from '../SedEditPermissionRequest/SedEditPermissionRequest.js';
import { useShellPermissionFeedback } from '../useShellPermissionFeedback.js';
import { logUnaryPermissionEvent } from '../utils.js';
import { bashToolUseOptions } from './bashToolUseOptions.js';
const CHECKING_TEXT = 'Attempting to auto-approve\u2026';

// 这段注释是本次阅读最有价值的一处工程记录：微光时钟原本住在 Inner 主体内部，而 Inner 里有一个 Compiler 的 bailout（编译器放弃自动记忆化），于是每 50 毫秒的一次时钟跳动都会把整棵 JSX 树（Dialog 加 Select 加全部子节点）重建一遍，分类器检查平均要 1 到 3 秒，换算下来就是几十次全量重建。修法不是优化时钟，而是把时钟搬到一个极小的独立组件里——让高频更新的边界收缩到一个只渲染一行文字的盒子里。
// Isolates the 20fps shimmer clock from BashPermissionRequestInner. Before this
// extraction, useShimmerAnimation lived inside the 535-line Inner body, so every
// 50ms clock tick re-rendered the entire dialog (PermissionDialog + Select +
// all children) for the ~1-3 seconds the classifier typically takes. Inner also
// has a Compiler bailout (see below), so nothing was auto-memoized — the full
// JSX tree was reconstructed 20-60 times per classifier check.
// 隔离出来的字幕组件：只做一件事——把待检查文本逐字符包上微光字符，按当前光带位置上色。它自身重渲染不会波及父级，因为父级传给它的只有静态文本。
function ClassifierCheckingSubtitle() {
  const $ = _c(6);
  const [ref, glimmerIndex] = useShimmerAnimation("requesting", CHECKING_TEXT, false);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = [...CHECKING_TEXT];
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  let t1;
  if ($[1] !== glimmerIndex) {
// 逐字符渲染：先把字符串拆成字符数组并缓存起来（这句展开只在首次执行），之后每次光带移动只重建渲染节点、不重建数据。这是本文件里唯一的高频路径，所以每一步缓存都值得。
    t1 = <Text>{t0.map((char, i) => <ShimmerChar key={i} char={char} index={i} glimmerIndex={glimmerIndex} messageColor="inactive" shimmerColor="subtle" />)}</Text>;
    $[1] = glimmerIndex;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  let t2;
  if ($[3] !== ref || $[4] !== t1) {
    t2 = <Box ref={ref}>{t1}</Box>;
    $[3] = ref;
    $[4] = t1;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  return t2;
}
// 分流器：把工具输入按 Bash 的输入结构解析出命令与描述，再看这条命令是不是 sed 编辑命令。是就整单交给 SedEditPermissionRequest（那边有专门的编辑预览与差异界面），不是才进主体。分流放在最外层而不是 Inner 内部，是为了让两条路径各自拥有独立的状态与钩子，互不牵连。
export function BashPermissionRequest(props) {
  const $ = _c(21);
  const {
    toolUseConfirm,
    toolUseContext,
    onDone,
    onReject,
    verbose,
    workerBadge
  } = props;
  let command;
  let description;
  let t0;
// 解析结果与 sed 判定一起放进同一个缓存槽：只要工具输入引用不变，就不再重复解析。这里缓存的是「命令文本、描述、sed 信息」三元组，后面的早退判断与主体初始化都直接读它们。
  if ($[0] !== toolUseConfirm.input) {
    ({
      command,
      description
    } = BashTool.inputSchema.parse(toolUseConfirm.input));
// sed 判定只需要一次：把命令文本交给解析器，返回非空就说明这是一条可以按行编辑语义来展示的命令。注意判定在缓存槽内完成，意味着弹窗存活期间不会重算。
    t0 = parseSedEditCommand(command);
    $[0] = toolUseConfirm.input;
    $[1] = command;
    $[2] = description;
    $[3] = t0;
  } else {
    command = $[1];
    description = $[2];
    t0 = $[3];
  }
  const sedInfo = t0;
  if (sedInfo) {
    let t1;
    if ($[4] !== onDone || $[5] !== onReject || $[6] !== sedInfo || $[7] !== toolUseConfirm || $[8] !== toolUseContext || $[9] !== verbose || $[10] !== workerBadge) {
      t1 = <SedEditPermissionRequest toolUseConfirm={toolUseConfirm} toolUseContext={toolUseContext} onDone={onDone} onReject={onReject} verbose={verbose} workerBadge={workerBadge} sedInfo={sedInfo} />;
      $[4] = onDone;
      $[5] = onReject;
      $[6] = sedInfo;
      $[7] = toolUseConfirm;
      $[8] = toolUseContext;
      $[9] = verbose;
      $[10] = workerBadge;
      $[11] = t1;
    } else {
      t1 = $[11];
    }
    return t1;
  }
  let t1;
  if ($[12] !== command || $[13] !== description || $[14] !== onDone || $[15] !== onReject || $[16] !== toolUseConfirm || $[17] !== toolUseContext || $[18] !== verbose || $[19] !== workerBadge) {
    t1 = <BashPermissionRequestInner toolUseConfirm={toolUseConfirm} toolUseContext={toolUseContext} onDone={onDone} onReject={onReject} verbose={verbose} workerBadge={workerBadge} command={command} description={description} />;
    $[12] = command;
    $[13] = description;
    $[14] = onDone;
    $[15] = onReject;
    $[16] = toolUseConfirm;
    $[17] = toolUseContext;
    $[18] = verbose;
    $[19] = workerBadge;
    $[20] = t1;
  } else {
    t1 = $[20];
  }
  return t1;
}

// 主体只在非 MCP 的普通命令上被调用——因为 MCP 工具走的是另一套确认界面，那套没有命令文本、没有沙箱、也没有分类器。这条注释解释了为什么下面这么长的组件敢直接假定「命令一定存在」。
// Inner component that uses hooks - only called for non-MCP CLI commands
// 主体签名：先继承通用的权限请求属性（确认句柄、上下文、完成与拒绝回调、详细模式、协作徽章），再补上分流器已经解析好的命令与描述。命令是必填、描述可选，因为描述可能由分类器异步补出来。
function BashPermissionRequestInner({
  toolUseConfirm,
  toolUseContext,
  onDone,
  onReject,
  verbose: _verbose,
  workerBadge,
  command,
  description
}: PermissionRequestProps & {
  command: string;
  description?: string;
}): React.ReactNode {
  const [theme] = useTheme();
  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
// 解释器状态：把工具名、工具输入、工具描述、对话消息一起交出去，换来一个可见性开关、一份解释内容的异步承诺、以及一个是否可用的标志。这套状态由 hooks 统一维护，主体只负责在界面上给它让出位置。
  const explainerState = usePermissionExplainerUI({
    toolName: toolUseConfirm.tool.name,
    toolInput: toolUseConfirm.input,
    toolDescription: toolUseConfirm.description,
    messages: toolUseContext.messages
  });
  const {
    yesInputMode,
    noInputMode,
    yesFeedbackModeEntered,
    noFeedbackModeEntered,
    acceptFeedback,
    rejectFeedback,
    setAcceptFeedback,
    setRejectFeedback,
    focusedOption,
    handleInputModeToggle,
    handleReject,
    handleFocus
// 反馈模式钩子一次性交回十个成员，分成四组：两种输入模式（同意时带指令、拒绝时带指令）、两个「曾进入过反馈模式」的标记（用于埋点区分纯点击与真的输入过）、两份反馈正文与其写入口、当前聚焦的选项、以及三个事件处理（切换输入模式、执行拒绝、聚焦变化）。把这些从主体里抽走，是因为它们要同时被选项组装、键盘接管、埋点三处使用。
  } = useShellPermissionFeedback({
    toolUseConfirm,
    onDone,
    onReject,
    explainerVisible: explainerState.visible
  });
// 调试面板开关：默认关闭，由键绑定翻转。打开后弹窗下半部分整个换成权限决策的调试信息，是排查「为什么这条命令被允许或拒绝」的主要入口。
  const [showPermissionDebug, setShowPermissionDebug] = useState(false);
  const [classifierDescription, setClassifierDescription] = useState(description || '');
  // Track whether the initial description (from prop or async generation) was empty.
  // Once we receive a non-empty description, this stays false.
// 这个布尔量记录的是「挂载时描述是否为空」这一事实，并且一旦收到非空描述就永久置假。它存在的意义是让选项文案能区分「本来就有描述」与「描述是刚补出来的」两种情况——后者需要给用户一个提示，告诉他马上会自动填入一条规则。
  const [initialClassifierDescriptionEmpty, setInitialClassifierDescriptionEmpty] = useState(!description?.trim());

  // Asynchronously generate a generic description for the classifier
// 异步补描述：仅当分类器权限开启时才发请求。用 AbortController 做取消，组件卸载即中止；请求失败被静默吞掉并保留原描述，因为补描述只是锦上添花，失败不该弹错误。注意成功分支里还顺手把「初始为空」标记清掉。
  useEffect(() => {
    if (!isClassifierPermissionsEnabled()) return;
    const abortController = new AbortController();
    generateGenericDescription(command, description, abortController.signal).then(generic => {
      if (generic && !abortController.signal.aborted) {
        setClassifierDescription(generic);
        setInitialClassifierDescriptionEmpty(false);
      }
    }).catch(() => {}); // Keep original on error
    return () => abortController.abort();
  }, [command, description]);

// 这段是本文件第二个高价值注释，讲的是一个真实的产品事故：对于复合命令（先切目录、再查状态、再跑测试这种用与号串起来的写法），后端已经用语法树切开、逐个做了权限检查、给出了正确的按子命令建议；但界面下方的同步前缀启发式只认整串命令的前两个词，于是会造出永远匹配不上的死规则，用户配置里越积越多。所以这里按「决策原因是否为子命令结果」来识别复合命令，一旦识别出来就绕开同步启发式。
  // GH#11380: For compound commands (cd src && git status && npm test), the
  // backend already computed correct per-subcommand suggestions via tree-sitter
  // split + per-subcommand permission checks. decisionReason.type ===
  // 'subcommandResults' marks this path. The sync prefix heuristics below
  // (getSimpleCommandPrefix/getFirstWordPrefix) operate on the FULL compound
  // string and pick the first two words — producing dead rules like
  // `Bash(cd src:*)` or `Bash(./script.sh && npm test)` that never match again.
  // Users accumulate 150+ of these in settings.local.json.
  //
  // When compound with exactly one Bash rule (e.g. `cd src && npm test` where
  // cd is read-only → only npm test needs approval), seed the editable input
  // from the backend rule. When compound with 2+ rules, editablePrefix stays
  // undefined so bashToolUseOptions falls through to yes-apply-suggestions,
  // which saves all per-subcommand rules atomically.
// 复合命令判定：决策原因是子命令结果即视为复合。这个布尔量后面有三处用途——决定是否跳过异步精化、决定可编辑前缀的初值来源、以及决定选项集合走哪条分支。
  const isCompound = toolUseConfirm.permissionResult.decisionReason?.type === 'subcommandResults';

  // Editable prefix — initialize synchronously with the best prefix we can
  // extract without tree-sitter, then refine via tree-sitter for compound
  // commands. The sync path matters because TREE_SITTER_BASH is gated
  // ant-only: in external builds the async refinement below always resolves
  // to [] and this initial value is what the user sees.
  //
  // Lazy initializer: this runs regex + split on every render if left in
  // the render body; it's only needed for initial state.
// 可编辑前缀的状态用惰性初始化器，而不是在渲染体里直接算：前缀提取要做正则与切分，如果写在渲染体里，每次重渲染都会重跑一遍，而它其实只在首次需要。注释还说明了另一层原因——语法树支持在外部构建里是被编译期开关关掉的，异步精化路径会恒返回空数组，所以这个同步初值才是普通用户真正看到的东西，必须足够好。
  const [editablePrefix, setEditablePrefix] = useState<string | undefined>(() => {
    if (isCompound) {
      // Backend suggestion is the source of truth for compound commands.
      // Single rule → seed the editable input so the user can refine it.
      // Multiple/zero rules → undefined → yes-apply-suggestions handles it.
      const backendBashRules = extractRules('suggestions' in toolUseConfirm.permissionResult ? toolUseConfirm.permissionResult.suggestions : undefined).filter(r => r.toolName === BashTool.name && r.ruleContent);
      return backendBashRules.length === 1 ? backendBashRules[0]!.ruleContent : undefined;
    }
    const two = getSimpleCommandPrefix(command);
    if (two) return `${two}:*`;
    const one = getFirstWordPrefix(command);
    if (one) return `${one}:*`;
    return command;
  });
// 用户是否手动改过前缀。这个引用存在的唯一目的是防止竞态：异步精化的结果回来时，如果用户已经自己敲过字，就不能覆盖他的输入。用引用而不是状态，是因为它只在回调里被读，不需要触发重渲染。
  const hasUserEditedPrefix = useRef(false);
  const onEditablePrefixChange = useCallback((value: string) => {
    hasUserEditedPrefix.current = true;
    setEditablePrefix(value);
  }, []);
// 异步精化：复合命令直接跳过（后端建议已经是权威）。其余情况把命令交给静态前缀提取器，并把「这段子命令是否只读」作为判断依据传进去，得到前缀链后只取第一段拼成规则内容。三重放弃条件：已取消、用户已编辑、提取结果为空——任一成立就保持同步初值不动。
  useEffect(() => {
    // Skip async refinement for compound commands — the backend already ran
    // the full per-subcommand analysis and its suggestion is correct.
    if (isCompound) return;
    let cancelled = false;
    getCompoundCommandPrefixesStatic(command, subcmd => BashTool.isReadOnly({
      command: subcmd
    })).then(prefixes => {
      if (cancelled || hasUserEditedPrefix.current) return;
      if (prefixes.length > 0) {
        setEditablePrefix(`${prefixes[0]}:*`);
      }
    }).catch(() => {}); // Keep sync prefix on tree-sitter failure
    return () => {
      cancelled = true;
    };
  }, [command, isCompound]);

  // Track whether classifier check was ever in progress (persists after completion).
  // classifierCheckInProgress is set once at queue-push time (interactiveHandler)
  // and only ever transitions true→false, so capturing the mount-time value is
  // sufficient — no latch/ref needed. The feature() ternary keeps the property
  // read out of external builds (forbidden-string check).
// 「分类器是否曾经在检查中」只取挂载时的快照，不随后续变化。注释解释了为什么不需要闩锁：这个标志在入队时被置真，之后只会由真转假一次，所以拿到初值就够了。另外注意条件表达式的写法——特性开关在这里的作用是让属性读取本身在外部构建里被消除，而不是单纯地短路求值。
  const [classifierWasChecking] = useState(feature('BASH_CLASSIFIER') ? !!toolUseConfirm.classifierCheckInProgress : false);

  // These derive solely from the tool input (fixed for the dialog lifetime).
  // The shimmer clock used to live in this component and re-render it at 20fps
  // while the classifier ran (see ClassifierCheckingSubtitle above for the
  // extraction). React Compiler can't auto-memoize imported functions (can't
  // prove side-effect freedom), so this useMemo still guards against any
  // re-render source (e.g. Inner state updates). Same pattern as PR#20730.
// 这一组派生值全部只依赖工具输入（弹窗存活期间不变）。注释再次提到微光时钟曾经住在这里、并且编译器无法为导入函数做记忆化，所以这里的记忆化是人工兜底：即便别处有重渲染源，这三个判断也不会重算。三者分别是破坏性命令警告、沙箱是否启用、本次是否真的会被沙箱包裹。
  const {
    destructiveWarning: destructiveWarning_0,
    sandboxingEnabled: sandboxingEnabled_0,
    isSandboxed: isSandboxed_0
  } = useMemo(() => {
    const destructiveWarning = getFeatureValue_CACHED_MAY_BE_STALE('tengu_destructive_command_warning', false) ? getDestructiveCommandWarning(command) : null;
    const sandboxingEnabled = SandboxManager.isSandboxingEnabled();
    const isSandboxed = sandboxingEnabled && shouldUseSandbox(toolUseConfirm.input);
    return {
      destructiveWarning,
      sandboxingEnabled,
      isSandboxed
    };
  }, [command, toolUseConfirm.input]);
  const unaryEvent = useMemo<UnaryEvent>(() => ({
    completion_type: 'tool_use_single',
    language_name: 'none'
  }), []);
  usePermissionRequestLogging(toolUseConfirm, unaryEvent);
  const existingAllowDescriptions = useMemo(() => getBashPromptAllowDescriptions(toolPermissionContext), [toolPermissionContext]);
// 选项集合的组装是这个文件的枢纽：它把后端建议、决策原因、两份反馈写入口、分类器描述与其初值、已有的允许描述、两种输入模式、可编辑前缀与其写入口，一共十二个输入交给选项工厂，产出的数组直接喂给下拉框。所有会变的输入都列在依赖里，所以选项文案能随用户输入实时变形（比如把前缀嵌进选项标题）。
  const options = useMemo(() => bashToolUseOptions({
    suggestions: toolUseConfirm.permissionResult.behavior === 'ask' ? toolUseConfirm.permissionResult.suggestions : undefined,
    decisionReason: toolUseConfirm.permissionResult.decisionReason,
    onRejectFeedbackChange: setRejectFeedback,
    onAcceptFeedbackChange: setAcceptFeedback,
    onClassifierDescriptionChange: setClassifierDescription,
    classifierDescription,
    initialClassifierDescriptionEmpty,
    existingAllowDescriptions,
    yesInputMode,
    noInputMode,
    editablePrefix,
    onEditablePrefixChange
  }), [toolUseConfirm, classifierDescription, initialClassifierDescriptionEmpty, existingAllowDescriptions, yesInputMode, noInputMode, editablePrefix, onEditablePrefixChange]);

  // Toggle permission debug info with keybinding
  const handleToggleDebug = useCallback(() => {
    setShowPermissionDebug(prev => !prev);
  }, []);
// 调试面板的键绑定：只在确认这类上下文里生效。处理函数用函数式更新翻转，避免把当前值放进依赖导致回调频繁重建。
  useKeybinding('permission:toggleDebug', handleToggleDebug, {
    context: 'Confirmation'
  });

  // Allow Esc to dismiss the checkmark after auto-approval
  const handleDismissCheckmark = useCallback(() => {
    toolUseConfirm.onDismissCheckmark?.();
  }, [toolUseConfirm]);
  useKeybinding('confirm:no', handleDismissCheckmark, {
    context: 'Confirmation',
    isActive: feature('BASH_CLASSIFIER') ? !!toolUseConfirm.classifierAutoApproved : false
  });
// 选项选中处理是这个文件最长的一段，分四段：先做埋点用的序号映射，再处理两个特殊选项（编辑前缀、分类器复核），最后落到常规三选项的开关。读的时候要盯住一件事——每个分支都自己调一次记录函数再自己调完成回调，没有统一的收尾，所以漏调就是漏埋点。
  function onSelect(value_0: string) {
    // Map options to numeric values for analytics (strings not allowed in logEvent)
// 序号映射：埋点只接受数字不接受字符串，所以要把选项值翻成序号。注意这里有两套映射，默认四档，分类器开启时多一档（分类器复核插在拒绝前面，于是拒绝从第三档挪到第四档）。这种「同一份语义两套编号」的写法会让历史数据在同一指标下不可比，属于典型的埋点债。
    let optionIndex: Record<string, number> = {
      yes: 1,
      'yes-apply-suggestions': 2,
      'yes-prefix-edited': 2,
      no: 3
    };
    if (feature('BASH_CLASSIFIER')) {
      optionIndex = {
        yes: 1,
        'yes-apply-suggestions': 2,
        'yes-prefix-edited': 2,
        'yes-classifier-reviewed': 3,
        no: 4
      };
    }
    logEvent('tengu_permission_request_option_selected', {
      option_index: optionIndex[value_0],
      explainer_visible: explainerState.visible
    });
    const toolNameForAnalytics = sanitizeToolNameForAnalytics(toolUseConfirm.tool.name) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
// 编辑前缀分支：取用户改过的前缀，去空白后为空就当作纯同意、不带任何规则更新；非空则造一条允许规则，规则内容是前缀本身，落盘目标是本地设置——这一步就是「以后这类命令别再问我」的实现。完成后立即返回，不落进下面的常规开关。
    if (value_0 === 'yes-prefix-edited') {
      const trimmedPrefix = (editablePrefix ?? '').trim();
      logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
      if (!trimmedPrefix) {
        toolUseConfirm.onAllow(toolUseConfirm.input, []);
      } else {
        const prefixUpdates: PermissionUpdate[] = [{
          type: 'addRules',
          rules: [{
            toolName: BashTool.name,
            ruleContent: trimmedPrefix
          }],
          behavior: 'allow',
          destination: 'localSettings'
        }];
        toolUseConfirm.onAllow(toolUseConfirm.input, prefixUpdates);
      }
      onDone();
      return;
    }
// 分类器复核分支：这里落的是分类器生成的描述，规则内容要经过一次转换（把自然语言描述转成规则内容的形式），落盘目标是会话级而不是本地设置——因为这条规则是由模型描述推导出来的，可信度低于用户亲手编辑的前缀，所以只在本次会话有效。这个差异是本文件最容易被忽略的设计细节。
    if (feature('BASH_CLASSIFIER') && value_0 === 'yes-classifier-reviewed') {
      const trimmedDescription = classifierDescription.trim();
      logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
      if (!trimmedDescription) {
        toolUseConfirm.onAllow(toolUseConfirm.input, []);
      } else {
        const permissionUpdates: PermissionUpdate[] = [{
          type: 'addRules',
          rules: [{
            toolName: BashTool.name,
            ruleContent: createPromptRuleContent(trimmedDescription)
          }],
          behavior: 'allow',
          destination: 'session'
        }];
        toolUseConfirm.onAllow(toolUseConfirm.input, permissionUpdates);
      }
      onDone();
      return;
    }
    switch (value_0) {
      case 'yes':
        {
          const trimmedFeedback_0 = acceptFeedback.trim();
          logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
          // Log accept submission with feedback context
          logEvent('tengu_accept_submitted', {
            toolName: toolNameForAnalytics,
            isMcp: toolUseConfirm.tool.isMcp ?? false,
            has_instructions: !!trimmedFeedback_0,
            instructions_length: trimmedFeedback_0.length,
            entered_feedback_mode: yesFeedbackModeEntered
          });
          toolUseConfirm.onAllow(toolUseConfirm.input, [], trimmedFeedback_0 || undefined);
          onDone();
          break;
        }
      case 'yes-apply-suggestions':
        {
          logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
          // Extract suggestions if present (works for both 'ask' and 'passthrough' behaviors)
          const permissionUpdates_0 = 'suggestions' in toolUseConfirm.permissionResult ? toolUseConfirm.permissionResult.suggestions || [] : [];
          toolUseConfirm.onAllow(toolUseConfirm.input, permissionUpdates_0);
          onDone();
          break;
        }
      case 'no':
        {
          const trimmedFeedback = rejectFeedback.trim();

          // Log reject submission with feedback context
          logEvent('tengu_reject_submitted', {
            toolName: toolNameForAnalytics,
            isMcp: toolUseConfirm.tool.isMcp ?? false,
            has_instructions: !!trimmedFeedback,
            instructions_length: trimmedFeedback.length,
            entered_feedback_mode: noFeedbackModeEntered
          });

          // Process rejection (with or without feedback)
          handleReject(trimmedFeedback || undefined);
          break;
        }
    }
  }
// 字幕的嵌套三元是整个状态机的摘要，按优先级从高到低：已自动批准就显示带对勾的成功字幕（若命中规则再附规则名）；正在检查就显示微光字幕；曾经检查过但当前不在检查，说明检查已完成却没自动批准，显示需要人工批准；从未检查过就什么都不显示。四层都套在特性开关里，外部构建恒为空。
  const classifierSubtitle = feature('BASH_CLASSIFIER') ? toolUseConfirm.classifierAutoApproved ? <Text>
        <Text color="success">{figures.tick} Auto-approved</Text>
        {toolUseConfirm.classifierMatchedRule && <Text dimColor>
            {' \u00b7 matched "'}
            {toolUseConfirm.classifierMatchedRule}
            {'"'}
          </Text>}
      </Text> : toolUseConfirm.classifierCheckInProgress ? <ClassifierCheckingSubtitle /> : classifierWasChecking ? <Text dimColor>Requires manual approval</Text> : undefined : undefined;
// 弹窗标题会随沙箱状态变化：沙箱启用但本次命令不会被沙箱包裹时，标题加上未沙箱化的后缀——这是给用户的一个明确警示，因为接下来的命令会直接作用于真实文件系统。
  return <PermissionDialog workerBadge={workerBadge} title={sandboxingEnabled_0 && !isSandboxed_0 ? 'Bash command (unsandboxed)' : 'Bash command'} subtitle={classifierSubtitle}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text dimColor={explainerState.visible}>
          {BashTool.renderToolUseMessage({
          command,
          description
        }, {
          theme,
          verbose: true
        } // always show the full command
        )}
        </Text>
        {!explainerState.visible && <Text dimColor>{toolUseConfirm.description}</Text>}
        <PermissionExplainerContent visible={explainerState.visible} promise={explainerState.promise} />
      </Box>
// 调试分支：上半部分换成权限决策调试信息，工具名写死为 Bash，所以不可达规则的过滤范围也被限定在 Bash 上。只有在详细调试模式下才额外提示如何关闭这个面板，否则用户会以为界面卡住了。
      {showPermissionDebug ? <>
          <PermissionDecisionDebugInfo permissionResult={toolUseConfirm.permissionResult} toolName="Bash" />
          {toolUseContext.options.debug && <Box justifyContent="flex-end" marginTop={1}>
              <Text dimColor>Ctrl-D to hide debug info</Text>
            </Box>}
        </> : <>
// 常规分支：先是权限规则解释（把决策原因翻成人话），再是破坏性命令警告（自动批准时压暗，因为此时已经不需要用户做决定），然后才是询问句与下拉框。
          <Box flexDirection="column">
            <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="command" />
            {destructiveWarning_0 && <Box marginBottom={1}>
                <Text color="warning" dimColor={feature('BASH_CLASSIFIER') ? toolUseConfirm.classifierAutoApproved : false}>
                  {destructiveWarning_0}
                </Text>
              </Box>}
            <Text dimColor={feature('BASH_CLASSIFIER') ? toolUseConfirm.classifierAutoApproved : false}>
              Do you want to proceed?
            </Text>
// 自动批准时把每个选项都标成禁用并把整个下拉框置为禁用，而不是换一套静态文案——这样布局高度不变，界面不会因为状态切换而跳动。注意这里对选项做的是浅拷贝加禁用标记，原始选项数组仍然被缓存。
            <Select options={feature('BASH_CLASSIFIER') ? toolUseConfirm.classifierAutoApproved ? options.map(o => ({
          ...o,
          disabled: true
        })) : options : options} isDisabled={feature('BASH_CLASSIFIER') ? toolUseConfirm.classifierAutoApproved : false} inlineDescriptions onChange={onSelect} onCancel={() => handleReject()} onFocus={handleFocus} onInputModeToggle={handleInputModeToggle} />
          </Box>
          <Box justifyContent="space-between" marginTop={1}>
            <Text dimColor>
              Esc to cancel
              {(focusedOption === 'yes' && !yesInputMode || focusedOption === 'no' && !noInputMode) && ' · Tab to amend'}
              {explainerState.enabled && ` · ctrl+e to ${explainerState.visible ? 'hide' : 'explain'}`}
            </Text>
            {toolUseContext.options.debug && <Text dimColor>Ctrl+d to show debug info</Text>}
          </Box>
        </>}
    </PermissionDialog>;
}
// 原文件此处有一行 54296 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。