import { readFileSync } from 'fs';
import { REMOTE_CONTROL_DISCONNECTED_MSG } from '../bridge/types.js';
import type { Command } from '../commands.js';
import { DIAMOND_OPEN } from '../constants/figures.js';
import { getRemoteSessionUrl } from '../constants/product.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../services/analytics/index.js';
import type { AppState } from '../state/AppStateStore.js';
import { checkRemoteAgentEligibility, formatPreconditionError, RemoteAgentTask, type RemoteAgentTaskState, registerRemoteAgentTask } from '../tasks/RemoteAgentTask/RemoteAgentTask.js';
import type { LocalJSXCommandCall } from '../types/command.js';
import { logForDebugging } from '../utils/debug.js';
import { errorMessage } from '../utils/errors.js';
import { logError } from '../utils/log.js';
import { enqueuePendingNotification } from '../utils/messageQueueManager.js';
import { ALL_MODEL_CONFIGS } from '../utils/model/configs.js';
import { updateTaskState } from '../utils/task/framework.js';
import { archiveRemoteSession, teleportToRemote } from '../utils/teleport.js';
import { pollForApprovedExitPlanMode, UltraplanPollError } from '../utils/ultraplan/ccrSession.js';

// 已知缺口：轮询最长半小时，期间令牌可能过期，这里只留了待办没有实现刷新
// TODO(prod-hardening): OAuth token may go stale over the 30min poll;
// consider refresh.

// Multi-agent exploration is slow; 30min timeout.
// 三十分钟超时：多代理探索本身就是慢的，短了会误判失败
const ULTRAPLAN_TIMEOUT_MS = 30 * 60 * 1000;
export const CCR_TERMS_URL = 'https://code.claude.com/docs/en/claude-code-on-the-web';

// 模型号取第一方标识而不是本机提供方字符串，否则云会话里会带着自定义提供方的标识
// CCR runs against the first-party API — use the canonical ID, not the
// provider-specific string getModelStrings() would return (which may be a
// Bedrock ARN or Vertex ID on the local CLI). Read at call time, not module
// load: the GrowthBook cache is empty at import and `/config` Gates can flip
// it between invocations.
// 调用时才读灰度值：模块加载时缓存还是空的，改配置也不会生效
function getUltraplanModel(): string {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_ultraplan_model', ALL_MODEL_CONFIGS.opus46.firstParty);
}

// prompt.txt is wrapped in <system-reminder> so the CCR browser hides
// scaffolding (CLI_BLOCK_TAGS dropped by stripSystemNotifications)
// while the model still sees full text.
// Phrasing deliberately avoids the feature name because
// the remote CCR CLI runs keyword detection on raw input before
// any tag stripping, and a bare "ultraplan" in the prompt would self-trigger as
// /ultraplan, which is filtered out of headless mode as "Unknown skill"
//
// Bundler inlines .txt as a string; the test runner wraps it as {default}.
// 文本资源被不同构建方式包成字符串或默认导出，两种都兼容
/* eslint-disable @typescript-eslint/no-require-imports */
const _rawPrompt = require('../utils/ultraplan/prompt.txt');
/* eslint-enable @typescript-eslint/no-require-imports */
const DEFAULT_INSTRUCTIONS: string = (typeof _rawPrompt === 'string' ? _rawPrompt : _rawPrompt.default).trimEnd();

// 开发用的提示词覆盖在模块加载时解析：构建期常量保证外部构建里这段被消除
// Dev-only prompt override resolved eagerly at module load.
// Gated to ant builds (USER_TYPE is a build-time define,
// so the override path is DCE'd from external builds).
// Shell-set env only, so top-level process.env read is fine
// — settings.env never injects this.
/* eslint-disable custom-rules/no-process-env-top-level, custom-rules/no-sync-fs -- ant-only dev override; eager top-level read is the point (crash at startup, not silently inside the slash-command try/catch) */
const ULTRAPLAN_INSTRUCTIONS: string = "external" === 'ant' && process.env.ULTRAPLAN_PROMPT_FILE ? readFileSync(process.env.ULTRAPLAN_PROMPT_FILE, 'utf8').trimEnd() : DEFAULT_INSTRUCTIONS;
/* eslint-enable custom-rules/no-process-env-top-level, custom-rules/no-sync-fs */

// 拼装首条消息：种子计划与补充说明放在标签外面，浏览器才能渲染出来
/**
 * Assemble the initial CCR user message. seedPlan and blurb stay outside the
 * system-reminder so the browser renders them; scaffolding is hidden.
 */
// 有种子计划就先放草稿，再放主指令，最后才是用户的补充说明
export function buildUltraplanPrompt(blurb: string, seedPlan?: string): string {
  const parts: string[] = [];
  if (seedPlan) {
    parts.push('Here is a draft plan to refine:', '', seedPlan, '');
  }
  parts.push(ULTRAPLAN_INSTRUCTIONS);
  if (blurb) {
    parts.push('', blurb);
  }
  return parts.join('\n');
}
// 轮询在独立流程里跑：命令本身要立刻返回，不能让界面等半小时
function startDetachedPoll(taskId: string, sessionId: string, url: string, getAppState: () => AppState, setAppState: (f: (prev: AppState) => AppState) => void): void {
// 记开始时间与失败标志：前者进上报，后者决定收尾时要不要改终态
  const started = Date.now();
  let failed = false;
  void (async () => {
    try {
      const {
        plan,
        rejectCount,
        executionTarget
      } = await pollForApprovedExitPlanMode(sessionId, ULTRAPLAN_TIMEOUT_MS, phase => {
// 轮询回调把阶段写进任务状态，运行中对应空值，其余阶段直接映射
        if (phase === 'needs_input') logEvent('tengu_ultraplan_awaiting_input', {});
        updateTaskState<RemoteAgentTaskState>(taskId, setAppState, t => {
          if (t.status !== 'running') return t;
          const next = phase === 'running' ? undefined : phase;
// 阶段没变就不写，避免每轮都触发一次状态更新
          return t.ultraplanPhase === next ? t : {
            ...t,
            ultraplanPhase: next
          };
        });
      }, () => getAppState().tasks?.[taskId]?.status !== 'running');
// 轮询返回后先上报批准，再按执行目标分流：云端执行与回传本地是两条完全不同的收尾路径
      logEvent('tengu_ultraplan_approved', {
        duration_ms: Date.now() - started,
        plan_length: plan.length,
        reject_count: rejectCount,
        execution_target: executionTarget as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
// 用户选了在云端执行：不再归档，因为归档没有运行中检查，会把正在跑的执行杀掉
      if (executionTarget === 'remote') {
        // User chose "execute in CCR" in the browser PlanModal — the remote
        // session is now coding. Skip archive (ARCHIVE has no running-check,
        // would kill mid-execution) and skip the choice dialog (already chose).
        // Guard on task status so a poll that resolves after stopUltraplan
        // doesn't notify for a killed session.
// 这里再查一次任务状态：轮询可能在停止之后才返回，不能给已杀会话发通知
        const task = getAppState().tasks?.[taskId];
        if (task?.status !== 'running') return;
        updateTaskState<RemoteAgentTaskState>(taskId, setAppState, t => t.status !== 'running' ? t : {
          ...t,
          status: 'completed',
          endTime: Date.now()
        });
// 清地址时比对本次轮询的地址，避免把后来新起会话的地址清掉
        setAppState(prev => prev.ultraplanSessionUrl === url ? {
          ...prev,
          ultraplanSessionUrl: undefined
        } : prev);
        enqueuePendingNotification({
          value: [`Ultraplan approved — executing in Claude Code on the web. Follow along at: ${url}`, '', 'Results will land as a pull request when the remote session finishes. There is nothing to do here.'].join('\n'),
          mode: 'task-notification'
        });
      } else {
// before
        // Teleport: set pendingChoice so REPL mounts UltraplanChoiceDialog.
        // The dialog owns archive + URL clear on choice. Guard on task status
        // so a poll that resolves after stopUltraplan doesn't resurrect the
        // dialog for a killed session.
// 写入待选项前也要查任务状态，防止已杀会话把对话框又拉回来
        setAppState(prev => {
          const task = prev.tasks?.[taskId];
          if (!task || task.status !== 'running') return prev;
          return {
            ...prev,
            ultraplanPendingChoice: {
              plan,
              sessionId,
              taskId
            }
          };
        });
      }
    } catch (e) {
// before
      // If the task was stopped (stopUltraplan sets status=killed), the poll
      // erroring is expected — skip the failure notification and cleanup
      // (kill() already archived; stopUltraplan cleared the URL).
// 任务已不在运行就直接返回：停止流程已经做过归档与清理
      const task = getAppState().tasks?.[taskId];
      if (task?.status !== 'running') return;
      failed = true;
      logEvent('tengu_ultraplan_failed', {
        duration_ms: Date.now() - started,
        reason: (e instanceof UltraplanPollError ? e.reason : 'network_or_unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        reject_count: e instanceof UltraplanPollError ? e.rejectCount : undefined
      });
// 真失败才通知用户，并带上会话地址方便回看
      enqueuePendingNotification({
        value: `Ultraplan failed: ${errorMessage(e)}\n\nSession: ${url}`,
        mode: 'task-notification'
      });
      // Error path owns cleanup; teleport path defers to the dialog; remote
      // path handled its own cleanup above.
// 错误路径自己负责归档：这一步不做，云端会话会空转半小时
      void archiveRemoteSession(sessionId).catch(e => logForDebugging(`ultraplan archive failed: ${String(e)}`));
      setAppState(prev =>
      // Compare against this poll's URL so a newer relaunched session's
      // URL isn't cleared by a stale poll erroring out.
      prev.ultraplanSessionUrl === url ? {
        ...prev,
        ultraplanSessionUrl: undefined
      } : prev);
    } finally {
// before
      // Remote path already set status=completed above; teleport path
      // leaves status=running so the pill shows the ultraplanPhase state
      // until UltraplanChoiceDialog completes the task after the user's
      // choice. Setting completed here would filter the task out of
      // isBackgroundTask before the pill can render the phase state.
      // Failure path has no dialog, so it owns the status transition here.
// 失败路径没有对话框接手，所以终态转换只能在这里做
      if (failed) {
        updateTaskState<RemoteAgentTaskState>(taskId, setAppState, t => t.status !== 'running' ? t : {
          ...t,
          status: 'failed',
          endTime: Date.now()
        });
      }
    }
  })();
}

// 先返回一句正在启动，避免多秒的往返期间终端看起来像卡死
// Renders immediately so the terminal doesn't appear hung during the
// multi-second teleportToRemote round-trip.
function buildLaunchMessage(disconnectedBridge?: boolean): string {
  const prefix = disconnectedBridge ? `${REMOTE_CONTROL_DISCONNECTED_MSG} ` : '';
  return `${DIAMOND_OPEN} ultraplan\n${prefix}Starting Claude Code on the web…`;
}
function buildSessionReadyMessage(url: string): string {
  return `${DIAMOND_OPEN} ultraplan · Monitor progress in Claude Code on the web ${url}\nYou can continue working — when the ${DIAMOND_OPEN} fills, press ↓ to view results`;
}
function buildAlreadyActiveMessage(url: string | undefined): string {
  return url ? `ultraplan: already polling. Open ${url} to check status, or wait for the plan to land here.` : 'ultraplan: already launching. Please wait for the session to start.';
}

// 停止：先杀任务（内部会归档），再一次性清地址、待选项、启动中三个字段
/**
 * Stop a running ultraplan: archive the remote session (halts it but keeps the
 * URL viewable), kill the local task entry (clears the pill), and clear
 * ultraplanSessionUrl (re-arms the keyword trigger). startDetachedPoll's
 * shouldStop callback sees the killed status on its next tick and throws;
 * the catch block early-returns when status !== 'running'.
 */
export async function stopUltraplan(taskId: string, sessionId: string, setAppState: (f: (prev: AppState) => AppState) => void): Promise<void> {
  // RemoteAgentTask.kill archives the session (with .catch) — no separate
  // archive call needed here.
  await RemoteAgentTask.kill(taskId, setAppState);
  setAppState(prev => prev.ultraplanSessionUrl || prev.ultraplanPendingChoice || prev.ultraplanLaunching ? {
    ...prev,
    ultraplanSessionUrl: undefined,
    ultraplanPendingChoice: undefined,
    ultraplanLaunching: undefined
  } : prev);
// 停止后发两条通知：一条给用户看，一条给模型看且标记为元信息
  const url = getRemoteSessionUrl(sessionId, process.env.SESSION_INGRESS_URL);
  enqueuePendingNotification({
    value: `Ultraplan stopped.\n\nSession: ${url}`,
    mode: 'task-notification'
  });
  enqueuePendingNotification({
    value: 'The user stopped the ultraplan session above. Do not respond to the stop notification — wait for their next message.',
    mode: 'task-notification',
    isMeta: true
  });
}

// 共享入口：斜杠命令、关键词触发、计划审批对话框的按钮都走这里
/**
 * Shared entry for the slash command, keyword trigger, and the plan-approval
 * dialog's "Ultraplan" button. When seedPlan is present (dialog path), it is
 * prepended as a draft to refine; blurb may be empty in that case.
 *
 * Resolves immediately with the user-facing message. Eligibility check,
 * session creation, and task registration run detached and failures surface via
 * enqueuePendingNotification.
 */
export async function launchUltraplan(opts: {
  blurb: string;
  seedPlan?: string;
  getAppState: () => AppState;
  setAppState: (f: (prev: AppState) => AppState) => void;
  signal: AbortSignal;
  /** True if the caller disconnected Remote Control before launching. */
  disconnectedBridge?: boolean;
  /**
   * Called once teleportToRemote resolves with a session URL. Callers that
   * have setMessages (REPL) append this as a second transcript message so the
   * URL is visible without opening the ↓ detail view. Callers without
   * transcript access (ExitPlanModePermissionRequest) omit this — the pill
   * still shows live status.
   */
  onSessionReady?: (msg: string) => void;
}): Promise<string> {
  const {
    blurb,
    seedPlan,
    getAppState,
    setAppState,
    signal,
    disconnectedBridge,
    onSessionReady
  } = opts;
  const {
    ultraplanSessionUrl: active,
    ultraplanLaunching
  } = getAppState();
// 已有会话或正在启动都直接拒绝，并区分两种原因上报
  if (active || ultraplanLaunching) {
    logEvent('tengu_ultraplan_create_failed', {
      reason: (active ? 'already_polling' : 'already_launching') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    return buildAlreadyActiveMessage(active);
  }
// 既没有补充说明也没有种子计划：这是用法查询，不是启动尝试
  if (!blurb && !seedPlan) {
    // No event — bare /ultraplan is a usage query, not an attempt.
    return [
    // Rendered via <Markdown>; raw <message> is tokenized as HTML
    // and dropped. Backslash-escape the brackets.
    'Usage: /ultraplan \\<prompt\\>, or include "ultraplan" anywhere', 'in your prompt', '', 'Advanced multi-agent plan mode with our most powerful model', '(Opus). Runs in Claude Code on the web. When the plan is ready,', 'you can execute it in the web session or send it back here.', 'Terminal stays free while the remote plans.', 'Requires /login.', '', `Terms: ${CCR_TERMS_URL}`].join('\n');
  }

  // Set synchronously before the detached flow to prevent duplicate launches
  // during the teleportToRemote window.
// 启动标志同步置位，挡住往返窗口内的重复启动
  setAppState(prev => prev.ultraplanLaunching ? prev : {
    ...prev,
    ultraplanLaunching: true
  });
  void launchDetached({
    blurb,
    seedPlan,
    getAppState,
    setAppState,
    signal,
    onSessionReady
  });
  return buildLaunchMessage(disconnectedBridge);
}
// 真正的启动流程：资格检查、建会话、注册任务、开始轮询
async function launchDetached(opts: {
  blurb: string;
  seedPlan?: string;
  getAppState: () => AppState;
  setAppState: (f: (prev: AppState) => AppState) => void;
  signal: AbortSignal;
  onSessionReady?: (msg: string) => void;
}): Promise<void> {
  const {
    blurb,
    seedPlan,
    getAppState,
    setAppState,
    signal,
    onSessionReady
  } = opts;
  // Hoisted so the catch block can archive the remote session if an error
  // occurs after teleportToRemote succeeds (avoids 30min orphan).
// 会话号提到外层：抓取块要用它来归档，避免云端会话无人轮询
  let sessionId: string | undefined;
  try {
    const model = getUltraplanModel();
// 资格检查不通过就把每条原因翻译成用户能读懂的话
    const eligibility = await checkRemoteAgentEligibility();
    if (!eligibility.eligible) {
      logEvent('tengu_ultraplan_create_failed', {
        reason: 'precondition' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        precondition_errors: eligibility.errors.map(e => e.type).join(',') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      const reasons = eligibility.errors.map(formatPreconditionError).join('\n');
      enqueuePendingNotification({
        value: `ultraplan: cannot launch remote session —\n${reasons}`,
        mode: 'task-notification'
      });
      return;
    }
    const prompt = buildUltraplanPrompt(blurb, seedPlan);
    let bundleFailMsg: string | undefined;
// 建会话时把打包失败的提示通过回调带出来，用于区分两类失败
    const session = await teleportToRemote({
      initialMessage: prompt,
      description: blurb || 'Refine local plan',
      model,
      permissionMode: 'plan',
      ultraplan: true,
      signal,
      useDefaultEnvironment: true,
      onBundleFail: msg => {
        bundleFailMsg = msg;
      }
    });
// 建会话返回空值要区分是打包失败还是服务端没给会话
    if (!session) {
      logEvent('tengu_ultraplan_create_failed', {
        reason: (bundleFailMsg ? 'bundle_fail' : 'teleport_null') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      enqueuePendingNotification({
        value: `ultraplan: session creation failed${bundleFailMsg ? ` — ${bundleFailMsg}` : ''}. See --debug for details.`,
        mode: 'task-notification'
      });
      return;
    }
// 会话号拿到就记下来，后面任何异常都能据此归档
    sessionId = session.id;
    const url = getRemoteSessionUrl(session.id, process.env.SESSION_INGRESS_URL);
    setAppState(prev => ({
      ...prev,
      ultraplanSessionUrl: url,
      ultraplanLaunching: undefined
    }));
// 会话就绪后回调给调用方，有对话区的调用方会把它追加成第二条消息
    onSessionReady?.(buildSessionReadyMessage(url));
    logEvent('tengu_ultraplan_launched', {
      has_seed_plan: Boolean(seedPlan),
      model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    // TODO(#23985): replace registerRemoteAgentTask + startDetachedPoll with
    // ExitPlanModeScanner inside startRemoteSessionPolling.
// 注册远端任务后立刻开始轮询，这一步之后才真正进入长等待
    const {
      taskId
    } = registerRemoteAgentTask({
      remoteTaskType: 'ultraplan',
      session: {
        id: session.id,
        title: blurb || 'Ultraplan'
      },
      command: blurb,
      context: {
        abortController: new AbortController(),
        getAppState,
        setAppState
      },
      isUltraplan: true
    });
    startDetachedPoll(taskId, session.id, url, getAppState, setAppState);
  } catch (e) {
// before
    logError(e);
    logEvent('tengu_ultraplan_create_failed', {
      reason: 'unexpected_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    enqueuePendingNotification({
      value: `ultraplan: unexpected error — ${errorMessage(e)}`,
      mode: 'task-notification'
    });
// 只有建会话成功过才需要归档，否则没什么可清
    if (sessionId) {
      // Error after teleport succeeded — archive so the remote doesn't sit
      // running for 30min with nobody polling it.
      void archiveRemoteSession(sessionId).catch(err => logForDebugging('ultraplan: failed to archive orphaned session', err));
      // ultraplanSessionUrl may have been set before the throw; clear it so
      // the "already polling" guard doesn't block future launches.
      setAppState(prev => prev.ultraplanSessionUrl ? {
        ...prev,
        ultraplanSessionUrl: undefined
      } : prev);
    }
  } finally {
// before
    // No-op on success: the url-setting setAppState already cleared this.
    setAppState(prev => prev.ultraplanLaunching ? {
      ...prev,
      ultraplanLaunching: undefined
    } : prev);
  }
}
// 命令入口：有参数就弹预启动对话框，无参数只回用法
const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const blurb = args.trim();

  // Bare /ultraplan (no args, no seed plan) just shows usage — no dialog.
  if (!blurb) {
    const msg = await launchUltraplan({
      blurb,
      getAppState: context.getAppState,
      setAppState: context.setAppState,
      signal: context.abortController.signal
    });
    onDone(msg, {
      display: 'system'
    });
    return null;
  }

  // Guard matches launchUltraplan's own check — showing the dialog when a
  // session is already active or launching would waste the user's click and set
  // hasSeenUltraplanTerms before the launch fails.
// 弹对话框前也要做一次同样的守卫：否则用户点了按钮才发现启动不了
  const {
    ultraplanSessionUrl: active,
    ultraplanLaunching
  } = context.getAppState();
  if (active || ultraplanLaunching) {
    logEvent('tengu_ultraplan_create_failed', {
      reason: (active ? 'already_polling' : 'already_launching') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    onDone(buildAlreadyActiveMessage(active), {
      display: 'system'
    });
    return null;
  }

// 对话框挂在底部输入区而不是返回界面节点，返回界面节点会锚在滚动区顶部
  // Mount the pre-launch dialog via focusedInputDialog (bottom region, like
  // permission dialogs) rather than returning JSX (transcript area, anchors
  // at top of scrollback). REPL.tsx handles launch/clear/cancel on choice.
  context.setAppState(prev => ({
    ...prev,
    ultraplanLaunchPending: {
      blurb
    }
  }));
  // 'skip' suppresses the (no content) echo — the dialog's choice handler
  // adds the real /ultraplan echo + launch confirmation.
// 用跳过表示不回显：真正的回显与启动确认由对话框的选择处理追加
  onDone(undefined, {
    display: 'skip'
  });
  return null;
};
// 命令声明：仅内部构建启用，描述里直接给出耗时区间与条款地址
export default {
  type: 'local-jsx',
  name: 'ultraplan',
  description: `~10–30 min · Claude Code on the web drafts an advanced plan you can edit and approve. See ${CCR_TERMS_URL}`,
  argumentHint: '<prompt>',
  isEnabled: () => "external" === 'ant',
  load: () => Promise.resolve({
    call
  })
} satisfies Command;
// 原文件此处有一行 46592 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。