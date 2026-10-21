// ═══════════════════════════════════════════════════════════════
//  AttachmentMessage：附件（读过的文件、加载的记忆、hook 的结果…）
// ═══════════════════════════════════════════════════════════════
//
//  这是本批最长的一个 switch（四十多个 case），也是「一个文件解释清楚
//  为什么 case 不能写在 switch 里」的那一个。
//
//  结构上它分三段：
//
//      第 48-103 行   teammate_mailbox —— 在 switch 之前用 if 处理
//      第 108-123 行  skill_discovery —— 也在 switch 之前（有特殊理由）
//      第 126-356 行  switch，四十多个 case，default 里有穷尽检查
//
//  第二段的理由值得单独记（见第 105 行）：
//  **case 标签不能被条件消除，if 块可以。**
//
//  这意味着「受 feature 门控的渲染分支」只能写成 if，不能写成 case ——
//  否则那个字符串字面量会永远留在包里，连带着整个类型的定义也删不掉。
import { c as _c } from "react/compiler-runtime";
// 【`biome-ignore-all assist/source/organizeImports` —— 禁止自动整理 import 顺序】
//
//  理由写在行尾：`ANT-ONLY import markers must not be reordered`。
//
//  内部构建里有些 import 带着标记（用来在被 DCE 时保留/删除整块），
//  整理顺序会破坏这些标记的位置。
//
//  这类「禁止重构」的注释在这个仓库里反复出现（另外常见的是
//  biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant）。
//  它们共同的模式是：**规则本身没错，但这里有一个规则不知道的约束。**
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import React, { useMemo } from 'react';
import { Ansi, Box, Text } from '../../ink.js';
import type { Attachment } from 'src/utils/attachments.js';
import type { NullRenderingAttachmentType } from './nullRenderingAttachments.js';
import { useAppState } from '../../state/AppState.js';
import { getDisplayPath } from 'src/utils/file.js';
import { formatFileSize } from 'src/utils/format.js';
import { MessageResponse } from '../MessageResponse.js';
import { basename, sep } from 'path';
import { UserTextMessage } from './UserTextMessage.js';
import { DiagnosticsDisplay } from '../DiagnosticsDisplay.js';
import { getContentText } from 'src/utils/messages.js';
import type { Theme } from 'src/utils/theme.js';
import { UserImageMessage } from './UserImageMessage.js';
import { toInkColor } from '../../utils/ink.js';
import { jsonParse } from '../../utils/slowOperations.js';
import { plural } from '../../utils/stringUtils.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { tryRenderPlanApprovalMessage, formatTeammateMessageContent } from './PlanApprovalMessage.js';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { TeammateMessageContent } from './UserTeammateMessage.js';
import { isShutdownApproved } from '../../utils/teammateMailbox.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { FilePathLink } from '../FilePathLink.js';
import { feature } from 'bun:bundle';
import { useSelectedMessageBg } from '../messageActions.js';
type Props = {
  addMargin: boolean;
  attachment: Attachment;
  verbose: boolean;
  isTranscriptMode?: boolean;
};
export function AttachmentMessage({
  attachment,
  addMargin,
  verbose,
  isTranscriptMode
}: Props): React.ReactNode {
  const bg = useSelectedMessageBg();
  // Hoisted to mount-time — per-message component, re-renders on every scroll.
// 【isDemoEnv 用 useMemo(…, []) —— 挂载时读一次环境变量】
//
//  注释：`Hoisted to mount-time — per-message component, re-renders on every scroll.`
//
//  这句话是理解整个目录性能设计的关键：
//  **消息组件是「每个滚动帧都会重渲染」的东西。**
//  任何在渲染期做的 IO（读环境变量、读文件、读配置）都会被放大成每帧一次。
//
//  所以这里宁可让 isDemoEnv 永远不更新（进程环境变量本来也不会变），
//  也要把它挪到挂载时算一次。
//
//  同一手法在 UserPromptMessage（briefEnvEnabled）、UserToolSuccessMessage 里都有。
//  这已经算是这个目录的一条约定：**渲染期不读环境。**
  const isDemoEnv = feature('EXPERIMENTAL_SKILL_SEARCH') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useMemo(() => isEnvTruthy(process.env.IS_DEMO), []) : false;
  // Handle teammate_mailbox BEFORE switch
// 【teammate_mailbox 必须在 switch 之前处理，并且自带一遍过滤】
//
//  两个原因：
//
//  一、它的渲染需要遍历 attachment.messages（一个数组），
//      并且**每条都要再分发一次**（task_assignment / plan approval / 纯文本）。
//      switch 的一个 case 装不下这套逻辑。
//
//  二、它要先过滤掉不可见的条目再计数 —— 注释写得很清楚：
//      `showing them in the count would be confusing
//      ("2 messages in mailbox:" with nothing shown)`
//
//  第二条是本批反复出现的主题：**计数必须建立在「看得见的东西」上**。
//  空 Box 在终端里会占行，所以看不见的东西不能在数据层参与统计。
  if (isAgentSwarmsEnabled() && attachment.type === 'teammate_mailbox') {
    // Filter out idle notifications BEFORE counting - they are hidden in the UI
    // so showing them in the count would be confusing ("2 messages in mailbox:" with nothing shown)
    const visibleMessages = attachment.messages.filter(msg => {
      if (isShutdownApproved(msg.text)) {
        return false;
      }
      try {
        const parsed = jsonParse(msg.text);
        return parsed?.type !== 'idle_notification' && parsed?.type !== 'teammate_terminated';
      } catch {
        return true; // Non-JSON messages are visible
      }
    });
    if (visibleMessages.length === 0) {
      return null;
    }
    return <Box flexDirection="column">
        {visibleMessages.map((msg_0, idx) => {
        // Try to parse as JSON for task_assignment messages
        let parsedMsg: {
          type?: string;
          taskId?: string;
          subject?: string;
          assignedBy?: string;
        } | null = null;
        try {
          parsedMsg = jsonParse(msg_0.text);
        } catch {
          // Not JSON, treat as plain text
        }
        if (parsedMsg?.type === 'task_assignment') {
          return <Box key={idx} paddingLeft={2}>
                <Text>{BLACK_CIRCLE} </Text>
                <Text>Task assigned: </Text>
                <Text bold>#{parsedMsg.taskId}</Text>
                <Text> - {parsedMsg.subject}</Text>
                <Text dimColor> (from {parsedMsg.assignedBy || msg_0.from})</Text>
              </Box>;
        }

        // Note: idle_notification messages already filtered out above

        // Try to render as plan approval message (request or response)
        const planApprovalElement = tryRenderPlanApprovalMessage(msg_0.text, msg_0.from);
        if (planApprovalElement) {
          return <React.Fragment key={idx}>{planApprovalElement}</React.Fragment>;
        }

        // Plain text message - sender header with chevron, truncated content
        const inkColor = toInkColor(msg_0.color);
        const formattedContent = formatTeammateMessageContent(msg_0.text) ?? msg_0.text;
        return <TeammateMessageContent key={idx} displayName={msg_0.from} inkColor={inkColor} content={formattedContent} summary={msg_0.summary} isTranscriptMode={isTranscriptMode} />;
      })}
      </Box>;
  }

// ═══ 【这两行注释解释了本文件最重要的一个技术约束】 ═══
//
//  原注释：
//      `skill_discovery rendered here (not in the switch) so the 'skill_discovery'
//       string literal stays inside a feature()-guarded block.
//       A case label can't be conditionally eliminated; an if-body can.`
//
//  拆开说：
//
//  · 这个分支属于实验功能 EXPERIMENTAL_SKILL_SEARCH。外部构建里，
//    feature() 折叠成 false，整块代码该被删掉。
//
//  · 如果写成 `case 'skill_discovery':`，那么打包器看到的是一个
//    **switch 标签**，它不认为这是一个可以被条件删除的代码块 ——
//    即使整个 case 体都在 `if (feature(…))` 里，标签本身也会留下。
//
//  · 而写成 `if (feature(…)) { if (attachment.type === 'skill_discovery') {…} }`，
//    整块都在 if 的 body 里，可以整体删除。
//
//  这是一条**违反直觉但很硬**的规则：同样的逻辑，换一种语法结构，
//  打包结果就不一样。凡是「受构建期开关控制的类型」，都不能出现在
//  switch 的 case 标签里。
  // skill_discovery rendered here (not in the switch) so the 'skill_discovery'
  // string literal stays inside a feature()-guarded block. A case label can't
  // be conditionally eliminated; an if-body can.
  if (feature('EXPERIMENTAL_SKILL_SEARCH')) {
    if (attachment.type === 'skill_discovery') {
      if (attachment.skills.length === 0) return null;
      // Ant users get shortIds inline so they can /skill-feedback while the
      // turn is still fresh. External users (when this un-gates) just see
      // names — shortId is undefined outside ant builds anyway.
      const names = attachment.skills.map(s => s.shortId ? `${s.name} [${s.shortId}]` : s.name).join(', ');
      const firstId = attachment.skills[0]?.shortId;
// ⚠️ 【又一处构建期残留：`"external" === 'ant'`】
//
//      const hint = "external" === 'ant' && !isDemoEnv && firstId
//                ? ' · /skill-feedback …' : ''
//
//  `"external" === 'ant'` 恒假，所以 hint 永远是空串。
//  这段代码是**内部构建专用**的：内部用户在技能被选中后可以直接打反馈。
//
//  注意它同时说明了另一件事：`firstId`（shortId）在外部构建里是 undefined，
//  注释里也这么说（`shortId is undefined outside ant builds anyway`）。
//
//  所以这里其实是**两道保险**：
//      编译期  USER_TYPE 折叠成 'external'，条件恒假
//      运行期  shortId 不存在，firstId 也是假
//
//  读这种代码的正确姿势是把它当成「文档」：它告诉你内部版本有这么一个功能。
      const hint = "external" === 'ant' && !isDemoEnv && firstId ? ` · /skill-feedback ${firstId} 1=wrong 2=noisy 3=good [comment]` : '';
      return <Line>
          <Text bold>{attachment.skills.length}</Text> relevant{' '}
          {plural(attachment.skills.length, 'skill')}: {names}
          {hint && <Text dimColor>{hint}</Text>}
        </Line>;
    }
  }

  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- teammate_mailbox/skill_discovery handled before switch
// 【switch 开头那行 eslint-disable 是在解释「为什么穷尽检查会失败」】
//
//      // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
//      //   -- teammate_mailbox/skill_discovery handled before switch
//
//  因为那两个类型已经被前面的 if 处理掉了，但 switch 里没有对应的 case，
//  类型系统看不出「前面已经处理过」，于是报「没有穷尽」。
//
//  这类 disable 通常意味着「类型系统看不到的那部分逻辑」——
//  值得顺着读一遍，确认被跳过的那两个类型真的在前面处理了。
//  这里确实处理了（第 48、109 行）。
  switch (attachment.type) {
    case 'directory':
      return <Line>
          Listed directory <Text bold>{attachment.displayPath + sep}</Text>
        </Line>;
    case 'file':
    case 'already_read_file':
// 【file / already_read_file 共用一个 case，然后按 content.type 三分】
//
//      notebook          → 「Read X (12 cells)」
//      file_unchanged    → 「Read X (unchanged)」
//      其它（text）      → 「Read X (120 lines)」或「(1.2 MB)」
//
//  第三个分支里那个 `attachment.truncated ? '+' : ''` 是「120+ lines」——
//  加号表示「只读了 120 行，但文件更长」。
//
//  这三条信息对应三种完全不同的用户关切：
//      笔记本      有多少个单元
//      未变        为什么又要读一遍（因为没变，所以没读）
//      普通文件    读了多少（截断了吗）
//
//  一个 case 里塞三种形态，是因为数据模型把它们归成了一类
//  （都是「读文件」），但**显示的信息维度不同**。
      if (attachment.content.type === 'notebook') {
        return <Line>
            Read <Text bold>{attachment.displayPath}</Text> (
            {attachment.content.file.cells.length} cells)
          </Line>;
      }
      if (attachment.content.type === 'file_unchanged') {
        return <Line>
            Read <Text bold>{attachment.displayPath}</Text> (unchanged)
          </Line>;
      }
      return <Line>
          Read <Text bold>{attachment.displayPath}</Text> (
          {attachment.content.type === 'text' ? `${attachment.content.file.numLines}${attachment.truncated ? '+' : ''} lines` : formatFileSize(attachment.content.file.originalSize)}
          )
        </Line>;
    case 'compact_file_reference':
      return <Line>
          Referenced file <Text bold>{attachment.displayPath}</Text>
        </Line>;
    case 'pdf_reference':
      return <Line>
          Referenced PDF <Text bold>{attachment.displayPath}</Text> (
          {attachment.pageCount} pages)
        </Line>;
    case 'selected_lines_in_ide':
      return <Line>
          ⧉ Selected{' '}
          <Text bold>{attachment.lineEnd - attachment.lineStart + 1}</Text>{' '}
          lines from <Text bold>{attachment.displayPath}</Text> in{' '}
          {attachment.ideName}
        </Line>;
    case 'nested_memory':
      return <Line>
          Loaded <Text bold>{attachment.displayPath}</Text>
        </Line>;
// 【relevant_memories 这一段是本文件里注释最长的，因为它的出现条件很绕】
//
//  注释：`Usually absorbed into a CollapsedReadSearchGroup (collapseReadSearch.ts)
//  so this only renders when the preceding tool was non-collapsible (Edit, Write)
//  and no group was open.`
//
//  翻译：大多数情况下，记忆召回会被折叠进「Read 3 files, recalled 2 memories」
//  那一行。**只有当它前面那个工具是 Edit / Write 这类不可折叠的工具、
//  而且没有开着的折叠组时**，它才会单独出现。
//
//  所以这个 case 是为了覆盖一个「折叠机制接不上」的缝隙。
//
//  这也解释了为什么它的样式要和 CollapsedReadSearchContent 对齐
//  （注释里明确说 `Match CollapsedReadSearchContent's style: 2-space gutter,
//  dim text, count only`）—— **同一类信息在不同容器里要长得一样。**
//
//  实现上它和折叠行用的是同一套：`<Box minWidth={2}/>` 占位 + dim 文本 + 数字加粗。
    case 'relevant_memories':
      // Usually absorbed into a CollapsedReadSearchGroup (collapseReadSearch.ts)
      // so this only renders when the preceding tool was non-collapsible (Edit,
      // Write) and no group was open. Match CollapsedReadSearchContent's style:
      // 2-space gutter, dim text, count only — filenames/content in ctrl+o.
      return <Box flexDirection="column" marginTop={addMargin ? 1 : 0} backgroundColor={bg}>
          <Box flexDirection="row">
            <Box minWidth={2} />
            <Text dimColor>
              Recalled <Text bold>{attachment.memories.length}</Text>{' '}
              {attachment.memories.length === 1 ? 'memory' : 'memories'}
              {!isTranscriptMode && <>
                  {' '}
                  <CtrlOToExpand />
                </>}
            </Text>
          </Box>
          {(verbose || isTranscriptMode) && attachment.memories.map(m => <Box key={m.path} flexDirection="column">
                <MessageResponse>
                  <Text dimColor>
                    <FilePathLink filePath={m.path}>
                      {basename(m.path)}
                    </FilePathLink>
                  </Text>
                </MessageResponse>
                {isTranscriptMode && <Box paddingLeft={5}>
                    <Text>
                      <Ansi>{m.content}</Ansi>
                    </Text>
                  </Box>}
              </Box>)}
        </Box>;
    case 'dynamic_skill':
      {
        const skillCount = attachment.skillNames.length;
        return <Line>
          Loaded{' '}
          <Text bold>
            {skillCount} {plural(skillCount, 'skill')}
          </Text>{' '}
          from <Text bold>{attachment.displayPath}</Text>
        </Line>;
      }
    case 'skill_listing':
      {
        if (attachment.isInitial) {
          return null;
        }
        return <Line>
          <Text bold>{attachment.skillCount}</Text>{' '}
          {plural(attachment.skillCount, 'skill')} available
        </Line>;
      }
    case 'agent_listing_delta':
      {
        if (attachment.isInitial || attachment.addedTypes.length === 0) {
          return null;
        }
        const count = attachment.addedTypes.length;
        return <Line>
          <Text bold>{count}</Text> agent {plural(count, 'type')} available
        </Line>;
      }
    case 'queued_command':
      {
        const text = typeof attachment.prompt === 'string' ? attachment.prompt : getContentText(attachment.prompt) || '';
        const hasImages = attachment.imagePasteIds && attachment.imagePasteIds.length > 0;
        return <Box flexDirection="column">
          <UserTextMessage addMargin={addMargin} param={{
            text,
            type: 'text'
          }} verbose={verbose} isTranscriptMode={isTranscriptMode} />
          {hasImages && attachment.imagePasteIds?.map(id => <UserImageMessage key={id} imageId={id} />)}
        </Box>;
      }
    case 'plan_file_reference':
      return <Line>
          Plan file referenced ({getDisplayPath(attachment.planFilePath)})
        </Line>;
    case 'invoked_skills':
      {
        if (attachment.skills.length === 0) {
          return null;
        }
        const skillNames = attachment.skills.map(s_0 => s_0.name).join(', ');
        return <Line>Skills restored ({skillNames})</Line>;
      }
// 【diagnostics / task_status 两个 case 转交给独立组件】
//
//  判断标准很简单：这段渲染有**自己的 hook 或自己的状态**，就抽成组件。
//  DiagnosticsDisplay 和 TaskStatusMessage 都满足 ——
//  后者甚至内部又分了两支（TeammateTaskStatus / GenericTaskStatus）。
//
//  不想抽的理由也很充分：一个 case 里写三十行 JSX 会把这个 535 行的
//  switch 变成 800 行。
//
//  这个文件的整体策略是：**简单的画成一行（用 Line 组件），
//  复杂的转交出去。** 四十多个 case 里有三十个是 `<Line>…</Line>`。
    case 'diagnostics':
      return <DiagnosticsDisplay attachment={attachment} verbose={verbose} />;
    case 'mcp_resource':
      return <Line>
          Read MCP resource <Text bold>{attachment.name}</Text> from{' '}
          {attachment.server}
        </Line>;
// 【command_permissions 返回 null，注释解释了「因为别人会渲染」】
//
//      // The skill success message is rendered by SkillTool's renderToolResultMessage,
//      // so we don't render anything here to avoid duplicate messages.
//
//  这是一个「主动放弃渲染」的例子 —— 而且必须在注释里写清楚，
//  否则后来人会以为漏了。
//
//  同一文件里还有三处类似：hook_success（verbose 下也不显示）、
//  async_hook_response（非 verbose 不显示）、hook_error_during_execution。
//
//  共同点：**这些信息有别的展示渠道，在这里再画一次就是重复。**
//  把它们登记为「明确不画」，比让它们落到 default 里更清楚 ——
//  default 是「我没想到的类型」，而这里是「我想过了，决定不画」。
    case 'command_permissions':
      // The skill success message is rendered by SkillTool's renderToolResultMessage,
      // so we don't render anything here to avoid duplicate messages.
      return null;
    case 'async_hook_response':
      {
        // SessionStart hook completions are only shown in verbose mode
        if (attachment.hookEvent === 'SessionStart' && !verbose) {
          return null;
        }
        // Generally hide async hook completion messages unless in verbose mode
        if (!verbose && !isTranscriptMode) {
          return null;
        }
        return <Line>
          Async hook <Text bold>{attachment.hookEvent}</Text> completed
        </Line>;
      }
// 【hook_blocking_error 会显示 stderr，而且用 error 色】
//
//      const stderr = attachment.blockingError.blockingError.trim()
//      <Line color="error">{attachment.hookName} hook returned blocking error</Line>
//      {stderr ? <Line color="error">{stderr}</Line> : null}
//
//  两行都是红色。第一行说「哪个 hook 拦住了」，第二行说「为什么」。
//
//  为什么要给用户看 stderr？注释：`Show stderr to the user so they can
//  understand why the hook blocked.`
//
//  hook 是用户自己配置的，它拦住了操作却不给理由，用户完全无法调试。
//  所以这里宁可把原始的 stderr 直接抛到屏幕上。
//
//  对比 hook_non_blocking_error（第 296 行）：只显示一行「X hook error」，
//  完整输出写进 debug 日志。**因为不阻塞的错误不影响你继续做事，
//  没必要占屏幕。**
    case 'hook_blocking_error':
      {
        // Stop hooks are rendered as a summary in SystemStopHookSummaryMessage
        if (attachment.hookEvent === 'Stop' || attachment.hookEvent === 'SubagentStop') {
          return null;
        }
        // Show stderr to the user so they can understand why the hook blocked
        const stderr = attachment.blockingError.blockingError.trim();
        return <>
          <Line color="error">
            {attachment.hookName} hook returned blocking error
          </Line>
          {stderr ? <Line color="error">{stderr}</Line> : null}
        </>;
      }
    case 'hook_non_blocking_error':
      {
        // Stop hooks are rendered as a summary in SystemStopHookSummaryMessage
        if (attachment.hookEvent === 'Stop' || attachment.hookEvent === 'SubagentStop') {
          return null;
        }
        // Full hook output is logged to debug log via hookEvents.ts
        return <Line color="error">{attachment.hookName} hook error</Line>;
      }
    case 'hook_error_during_execution':
      // Stop hooks are rendered as a summary in SystemStopHookSummaryMessage
      if (attachment.hookEvent === 'Stop' || attachment.hookEvent === 'SubagentStop') {
        return null;
      }
      // Full hook output is logged to debug log via hookEvents.ts
      return <Line>{attachment.hookName} hook warning</Line>;
    case 'hook_success':
      // Full hook output is logged to debug log via hookEvents.ts
      return null;
    case 'hook_stopped_continuation':
      // Stop hooks are rendered as a summary in SystemStopHookSummaryMessage
      if (attachment.hookEvent === 'Stop' || attachment.hookEvent === 'SubagentStop') {
        return null;
      }
      return <Line color="warning">
          {attachment.hookName} hook stopped continuation: {attachment.message}
        </Line>;
    case 'hook_system_message':
      return <Line>
          {attachment.hookName} says: {attachment.content}
        </Line>;
    case 'hook_permission_decision':
      {
        const action = attachment.decision === 'allow' ? 'Allowed' : 'Denied';
        return <Line>
          {action} by <Text bold>{attachment.hookEvent}</Text> hook
        </Line>;
      }
    case 'task_status':
      return <TaskStatusMessage attachment={attachment} />;
    case 'teammate_shutdown_batch':
      return <Box flexDirection="row" width="100%" marginTop={1} backgroundColor={bg}>
          <Text dimColor>{BLACK_CIRCLE} </Text>
          <Text dimColor>
            {attachment.count} {plural(attachment.count, 'teammate')} shut down
            gracefully
          </Text>
        </Box>;
// ═══ 【default 分支：一行 satisfies 完成「双向同步」的另一半】 ═══
//
//      attachment.type satisfies NullRenderingAttachmentType
//                       | 'skill_discovery' | 'teammate_mailbox'
//
//  这一行**不在运行期执行任何东西**（satisfies 是纯类型操作，编译后消失）。
//  它的唯一作用是：如果 attachment.type 里出现了一个既没有 case、
//  也不在 nullRenderingAttachments 清单里的类型，**这里 typecheck 失败**。
//
//  三个类型被显式排除，因为它们在前面的 if 里处理过了 ——
//  类型系统收窄不到那里，所以要手工告诉它。
//
//  这是本仓库里最优雅的一处类型技巧：
//  **用 satisfies 把「一个不变量」表达成编译错误**，
//  而不是靠注释提醒后来的人。
//
//  上一批读 nullRenderingAttachments.ts 时看到的那句
//  `Sync is enforced by TypeScript`，兑现的就是这一行。
    default:
      // Exhaustiveness: every type reaching here must be in NULL_RENDERING_TYPES.
      // If TS errors, a new Attachment type was added without a case above AND
      // without an entry in NULL_RENDERING_TYPES — decide: render something (add
      // a case) or render nothing (add to the array). Messages.tsx pre-filters
      // these so this branch is defense-in-depth for other render paths.
      //
      // skill_discovery and teammate_mailbox are handled BEFORE the switch in
      // runtime-gated blocks (feature() / isAgentSwarmsEnabled()) that TS can't
      // narrow through — excluded here via type union (compile-time only, no emit).
      attachment.type satisfies NullRenderingAttachmentType | 'skill_discovery' | 'teammate_mailbox';
      return null;
  }
}
// 【`Extract<Attachment, { type: 'task_status' }>` —— 从大联合里取出一个成员】
//
//  这是 TypeScript 的标准库类型，作用是「筛出联合类型中满足条件的那些」。
//
//  为什么要这么做，而不是直接写 `Attachment & { type: 'task_status' }`？
//  因为 Extract 保留了**其他字段的具体类型**（status 是有限的几个字面量），
//  而交叉类型会把它们拓宽。
//
//  这种写法在本仓库的工具类型里到处都是（Tool.ts 里大量用 Extract 和
//  条件类型来从工具定义推导出渲染函数的参数类型）。
type TaskStatusAttachment = Extract<Attachment, {
  type: 'task_status';
}>;
function TaskStatusMessage(t0) {
  const $ = _c(4);
  const {
    attachment
  } = t0;
// ⚠️ 【`if (false && attachment.status === "killed")` 又一处构建期残留】
//
//  恒假，所以「已杀死」的任务状态**仍然会显示**（而不是被隐藏）。
//
//  原意大概是：某个构建里不想让 killed 状态出现在屏幕上。
//  打包后条件折叠成 false，但 if 块还在。
//
//  对比第 396 行的 statusText 映射：
//      completed  → "completed in background"
//      killed     → "stopped"          ← 用了「已停止」而不是「被杀」
//      running    → "still running in background"
//
//  这个措辞选择本身也是一种「对用户友好」的体现 ——
//  killed 是内部术语，stopped 是用户能理解的词。
  if (false && attachment.status === "killed") {
    return null;
  }
  if (isAgentSwarmsEnabled() && attachment.taskType === "in_process_teammate") {
    let t1;
    if ($[0] !== attachment) {
      t1 = <TeammateTaskStatus attachment={attachment} />;
      $[0] = attachment;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    return t1;
  }
  let t1;
  if ($[2] !== attachment) {
    t1 = <GenericTaskStatus attachment={attachment} />;
    $[2] = attachment;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  return t1;
}
function GenericTaskStatus(t0) {
  const $ = _c(9);
  const {
    attachment
  } = t0;
  const bg = useSelectedMessageBg();
  const statusText = attachment.status === "completed" ? "completed in background" : attachment.status === "killed" ? "stopped" : attachment.status === "running" ? "still running in background" : attachment.status;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text dimColor={true}>{BLACK_CIRCLE} </Text>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== attachment.description) {
    t2 = <Text bold={true}>{attachment.description}</Text>;
    $[1] = attachment.description;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== statusText || $[4] !== t2) {
    t3 = <Text dimColor={true}>Task "{t2}" {statusText}</Text>;
    $[3] = statusText;
    $[4] = t2;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] !== bg || $[7] !== t3) {
    t4 = <Box flexDirection="row" width="100%" marginTop={1} backgroundColor={bg}>{t1}{t3}</Box>;
    $[6] = bg;
    $[7] = t3;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  return t4;
}
function TeammateTaskStatus(t0) {
  const $ = _c(16);
  const {
    attachment
  } = t0;
  const bg = useSelectedMessageBg();
  let t1;
  if ($[0] !== attachment.taskId) {
// 【`t1 = s => s.tasks[attachment.taskId]` —— selector 也要缓存】
//
//  这是本批唯一一处「用 Compiler 的槽缓存一个 selector」的例子。
//
//  为什么必须缓存？因为 useAppState 的实现是 useSyncExternalStore，
//  它把 selector 存在内部 ref 里并比较引用。selector 每次新建
//  → 每次渲染都判定「订阅参数变了」→ 重新订阅。
//
//  重订阅的代价不是内存，是**时序**：resubscribe 发生在 effect 阶段，
//  在那之前 store 的变化可能被漏掉一帧。
//
//  所以这里 `if ($[0] !== attachment.taskId) { t1 = s => s.tasks[…]; $[0] = … }`
//  —— 用一个槽换来「引用稳定」。
//
//  如果 selector 不需要参数（比如 `s => s.isBriefOnly`），
//  就该像 AttachmentMessage 第 44 行那样提到模块顶层，连槽都省了。
    t1 = s => s.tasks[attachment.taskId];
    $[0] = attachment.taskId;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const task = useAppState(t1);
  if (task?.type !== "in_process_teammate") {
    let t2;
    if ($[2] !== attachment) {
      t2 = <GenericTaskStatus attachment={attachment} />;
      $[2] = attachment;
      $[3] = t2;
    } else {
      t2 = $[3];
    }
    return t2;
  }
  let t2;
  if ($[4] !== task.identity.color) {
    t2 = toInkColor(task.identity.color);
    $[4] = task.identity.color;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const agentColor = t2;
  const statusText = attachment.status === "completed" ? "shut down gracefully" : attachment.status;
  let t3;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text dimColor={true}>{BLACK_CIRCLE} </Text>;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] !== agentColor || $[8] !== task.identity.agentName) {
    t4 = <Text color={agentColor} bold={true} dimColor={false}>@{task.identity.agentName}</Text>;
    $[7] = agentColor;
    $[8] = task.identity.agentName;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  let t5;
  if ($[10] !== statusText || $[11] !== t4) {
    t5 = <Text dimColor={true}>Teammate{" "}{t4}{" "}{statusText}</Text>;
    $[10] = statusText;
    $[11] = t4;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  let t6;
  if ($[13] !== bg || $[14] !== t5) {
    t6 = <Box flexDirection="row" width="100%" marginTop={1} backgroundColor={bg}>{t3}{t5}</Box>;
    $[13] = bg;
    $[14] = t5;
    $[15] = t6;
  } else {
    t6 = $[15];
  }
  return t6;
}
// ═══ 【Line 组件：整个文件里四十多个 case 的公共外壳】 ═══
//
//  它是「一行附件说明」的标准形态：MessageResponse 包一层 + dim 文本 + 背景色。
//
//  注释：`We allow setting dimColor to false here to help work around the dim-bold bug.
//  https://github.com/chalk/chalk/issues/290`
//
//  这是一个真实的上游 bug：chalk 在同时应用 dim 和 bold 时，
//  某些终端会把 dim 的关闭序列丢掉，导致后面的文字一直是灰的。
//
//  所以 Line 接受 `dimColor={false}` 让调用方**显式关掉 dim**，
//  而不是靠嵌套 Text 覆盖 —— 因为覆盖不生效（SGR 是状态机，不是继承）。
//
//  这是本批第二个「上游 bug 导致本仓库写怪代码」的例子
//  （第一个是 Terminal 相关的 bidi / DA1 那些，在 ink/ 目录里）。
//
//  注意 dimColor 的默认值是 true（第 513 行 `t1 === undefined ? true : t1`），
//  所以绝大多数调用点不传它 —— 只有需要加粗 + 正常色的那几处才传 false。
// We allow setting dimColor to false here to help work around the dim-bold bug.
// https://github.com/chalk/chalk/issues/290
function Line(t0) {
  const $ = _c(7);
  const {
    dimColor: t1,
    children,
    color
  } = t0;
  const dimColor = t1 === undefined ? true : t1;
  const bg = useSelectedMessageBg();
  let t2;
  if ($[0] !== children || $[1] !== color || $[2] !== dimColor) {
    t2 = <MessageResponse><Text color={color} dimColor={dimColor} wrap="wrap">{children}</Text></MessageResponse>;
    $[0] = children;
    $[1] = color;
    $[2] = dimColor;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] !== bg || $[5] !== t2) {
    t3 = <Box backgroundColor={bg}>{t2}</Box>;
    $[4] = bg;
    $[5] = t2;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  return t3;
}
// 原文件此处有一行 51780 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。