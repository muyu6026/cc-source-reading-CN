import { feature } from 'bun:bundle';
import React, { useCallback, useEffect, useRef } from 'react';
import { setMainLoopModelOverride } from '../bootstrap/state.js';
import { type BridgePermissionCallbacks, type BridgePermissionResponse, isBridgePermissionResponse } from '../bridge/bridgePermissionCallbacks.js';
import { buildBridgeConnectUrl } from '../bridge/bridgeStatusUtil.js';
import { extractInboundMessageFields } from '../bridge/inboundMessages.js';
import type { BridgeState, ReplBridgeHandle } from '../bridge/replBridge.js';
import { setReplBridgeHandle } from '../bridge/replBridgeHandle.js';
import type { Command } from '../commands.js';
import { getSlashCommandToolSkills, isBridgeSafeCommand } from '../commands.js';
import { getRemoteSessionUrl } from '../constants/product.js';
import { useNotifications } from '../context/notifications.js';
import type { PermissionMode, SDKMessage } from '../entrypoints/agentSdkTypes.js';
import type { SDKControlResponse } from '../entrypoints/sdk/controlTypes.js';
import { Text } from '../ink.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { useAppState, useAppStateStore, useSetAppState } from '../state/AppState.js';
import type { Message } from '../types/message.js';
import { getCwd } from '../utils/cwd.js';
import { logForDebugging } from '../utils/debug.js';
import { errorMessage } from '../utils/errors.js';
import { enqueue } from '../utils/messageQueueManager.js';
import { buildSystemInitMessage } from '../utils/messages/systemInit.js';
import { createBridgeStatusMessage, createSystemMessage } from '../utils/messages.js';
import { getAutoModeUnavailableNotification, getAutoModeUnavailableReason, isAutoModeGateEnabled, isBypassPermissionsModeDisabled, transitionPermissionMode } from '../utils/permissions/permissionSetup.js';
import { getLeaderToolUseConfirmQueue } from '../utils/swarm/leaderPermissionBridge.js';

/** How long after a failure before replBridgeEnabled is auto-cleared (stops retries). */
export const BRIDGE_FAILURE_DISMISS_MS = 10_000;
// BRIDGE_FAILURE_DISMISS_MS = 10s：失败通知展示 10 秒后自动清掉 replBridgeEnabled，让 hook 停止重试——不自动停的话用户每次重启都在后台撞同一面墙。

/**
 * Max consecutive initReplBridge failures before the hook stops re-attempting
 * for the session lifetime. Guards against paths that flip replBridgeEnabled
 * back on after auto-disable (settings sync, /remote-control, config tool)
 * when the underlying OAuth is unrecoverable — each re-attempt is another
 * guaranteed 401 against POST /v1/environments/bridge. Datadog 2026-03-08:
 * top stuck client generated 2,879 × 401/day alone (17% of all 401s on the
 * route).
 */
const MAX_CONSECUTIVE_INIT_FAILURES = 3;
// 保险丝：连续 3 次 init 失败后本会话不再尝试。防的是那些会把 replBridgeEnabled 又翻回去的路径（设置同步、/remote-control、config tool）在 OAuth 已不可恢复时每次都白送一次 401。Datadog 2026-03-08：最卡的那个客户端一天打了 2,879 个 401，占该路由全部 401 的 17%。

/**
 * Hook that initializes an always-on bridge connection in the background
 * and writes new user/assistant messages to the bridge session.
 *
 * Silently skips if bridge is not enabled or user is not OAuth-authenticated.
 *
 * Watches AppState.replBridgeEnabled — when toggled off (via /config or footer),
 * the bridge is torn down. When toggled back on, it re-initializes.
 *
 * Inbound messages from claude.ai are injected into the REPL via queuedCommands.
 */
// useReplBridge：后台常驻的远程控制桥。把 REPL 的新用户/助手消息写给 claude.ai 会话，把 claude.ai 来的用户消息注入 REPL。桥没开或没 OAuth 就静默跳过；AppState.replBridgeEnabled 是唯一开关（/config 或页脚可切）。
export function useReplBridge(messages: Message[], setMessages: (action: React.SetStateAction<Message[]>) => void, abortControllerRef: React.RefObject<AbortController | null>, commands: readonly Command[], mainLoopModel: string): {
  sendBridgeResult: () => void;
} {
  const handleRef = useRef<ReplBridgeHandle | null>(null);
  const teardownPromiseRef = useRef<Promise<void> | undefined>(undefined);
  const lastWrittenIndexRef = useRef(0);
  // Tracks UUIDs already flushed as initial messages. Persists across
  // bridge reconnections so Bridge #2+ only sends new messages — sending
  // duplicate UUIDs causes the server to kill the WebSocket.
  const flushedUUIDsRef = useRef(new Set<string>());
// flushedUUIDs 跨重连存活：Bridge #2 起只发新消息。重复发同一个 UUID，服务端会直接杀 WebSocket。
  const failureTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Persists across effect re-runs (unlike the effect's local state). Reset
  // only on successful init. Hits MAX_CONSECUTIVE_INIT_FAILURES → fuse blown
  // for the session, regardless of replBridgeEnabled re-toggling.
  const consecutiveFailuresRef = useRef(0);
// consecutiveFailures 与 effect 局部状态的区别：它跨 effect 重跑持久，只在 init 成功后清零。到顶即会话级保险丝烧断，replBridgeEnabled 再怎么翻回去都没用。
  const setAppState = useSetAppState();
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const mainLoopModelRef = useRef(mainLoopModel);
  mainLoopModelRef.current = mainLoopModel;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const store = useAppStateStore();
  const {
    addNotification
  } = useNotifications();
  const replBridgeEnabled = feature('BRIDGE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useAppState(s => s.replBridgeEnabled) : false;
  const replBridgeConnected = feature('BRIDGE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useAppState(s_0 => s_0.replBridgeConnected) : false;
  const replBridgeOutboundOnly = feature('BRIDGE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useAppState(s_1 => s_1.replBridgeOutboundOnly) : false;
  const replBridgeInitialName = feature('BRIDGE_MODE') ?
  // biome-ignore lint/correctness/useHookAtTopLevel: feature() is a compile-time constant
  useAppState(s_2 => s_2.replBridgeInitialName) : undefined;
// 四个 selector 全是 feature('BRIDGE_MODE') 条件调用——编译后只剩一支，非桥构建里这些订阅整条消失。

  // Initialize/teardown bridge when enabled state changes.
  // Passes current messages as initialMessages so the remote session
  // starts with the existing conversation context (e.g. from /bridge).
  useEffect(() => {
    // feature() check must use positive pattern for dead code elimination —
    // negative pattern (if (!feature(...)) return) does NOT eliminate
    // dynamic imports below.
    if (feature('BRIDGE_MODE')) {
// feature() 检查必须写成正向模式：负向的 if (!feature(...)) return 不会消除下面的动态 import（bundler 看不出动态 import 在死分支里），external 构建会把整座 bridge 拖进去。
      if (!replBridgeEnabled) return;
      const outboundOnly = replBridgeOutboundOnly;
      function notifyBridgeFailed(detail?: string): void {
        if (outboundOnly) return;
        addNotification({
          key: 'bridge-failed',
          jsx: <>
              <Text color="error">Remote Control failed</Text>
              {detail && <Text dimColor> · {detail}</Text>}
            </>,
          priority: 'immediate'
        });
      }
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_INIT_FAILURES) {
        logForDebugging(`[bridge:repl] Hook: ${consecutiveFailuresRef.current} consecutive init failures, not retrying this session`);
        // Clear replBridgeEnabled so /remote-control doesn't mistakenly show
        // BridgeDisconnectDialog for a bridge that never connected.
        const fuseHint = 'disabled after repeated failures · restart to retry';
        notifyBridgeFailed(fuseHint);
        setAppState(prev => {
          if (prev.replBridgeError === fuseHint && !prev.replBridgeEnabled) return prev;
          return {
            ...prev,
            replBridgeError: fuseHint,
            replBridgeEnabled: false
          };
        });
        return;
      }
// 保险丝已烧断：清 replBridgeEnabled（否则 /remote-control 会误显示 BridgeDisconnectDialog——为一个从未连上的桥），带 hint 通知一次，然后本会话不再尝试。
      let cancelled = false;
      // Capture messages.length now so we don't re-send initial messages
      // through writeMessages after the bridge connects.
      const initialMessageCount = messages.length;
// 此刻抓 messages.length：这些初始消息会作为 initialMessages 进 initReplBridge，转发 effect 要从这个索引之后才开始写，否则同一批消息发两遍。
      void (async () => {
        try {
          // Wait for any in-progress teardown to complete before registering
          // a new environment. Without this, the deregister HTTP call from
          // the previous teardown races with the new register call, and the
          // server may tear down the freshly-created environment.
          if (teardownPromiseRef.current) {
            logForDebugging('[bridge:repl] Hook: waiting for previous teardown to complete before re-init');
            await teardownPromiseRef.current;
            teardownPromiseRef.current = undefined;
            logForDebugging('[bridge:repl] Hook: previous teardown complete, proceeding with re-init');
          }
// 重新初始化前必须等上一个 teardown 走完：上次的 deregister HTTP 和新一次的 register 是竞态，服务端可能把刚创建的新环境连带拆掉。teardownPromiseRef 就是给这里 await 的。
          if (cancelled) return;

          // Dynamic import so the module is tree-shaken in external builds
          const {
            initReplBridge
          } = await import('../bridge/initReplBridge.js');
// 动态 import 让 bridge 模块树在非桥构建里被整体摇掉。
          const {
            shouldShowAppUpgradeMessage
          } = await import('../bridge/envLessBridgeConfig.js');

          // Assistant mode: perpetual bridge session — claude.ai shows one
          // continuous conversation across CLI restarts instead of a new
          // session per invocation. initBridgeCore reads bridge-pointer.json
          // (the same crash-recovery file #20735 added) and reuses its
          // {environmentId, sessionId} via reuseEnvironmentId +
          // api.reconnectSession(). Teardown skips archive/deregister/
          // pointer-clear so the session survives clean exits, not just
          // crashes. Non-assistant bridges clear the pointer on teardown
          // (crash-recovery only).
          let perpetual = false;
          if (feature('KAIROS')) {
            const {
              isAssistantMode
            } = await import('../assistant/index.js');
            perpetual = isAssistantMode();
          }
// perpetual（KAIROS assistant 模式）：读 bridge-pointer.json——就是 #20735 为崩溃恢复加的那个文件——复用里面的 {environmentId, sessionId} 走 api.reconnectSession()，claude.ai 上呈现为跨 CLI 重启的一段连续会话。teardown 相应跳过 archive/deregister/清指针，让会话干净退出后也活着；非 assistant 桥拆指针（只保崩溃恢复）。

          // When a user message arrives from claude.ai, inject it into the REPL.
          // Preserves the original UUID so that when the message is forwarded
          // back to CCR, it matches the original — avoiding duplicate messages.
          //
          // Async because file_attachments (if present) need a network fetch +
          // disk write before we enqueue with the @path prefix. Caller doesn't
          // await — messages with attachments just land in the queue slightly
          // later, which is fine (web messages aren't rapid-fire).
// handleInboundMessage：claude.ai 来的用户消息进 REPL。两个设计：保留原始 UUID——消息转发回 CCR 时能和原消息对上，不产生重复；异步是因为附件要先网络拉取+落盘，才能带 @path 前缀入队。调用方不 await，带附件的消息晚一点进队无妨（网页消息不是高频流）。
          async function handleInboundMessage(msg: SDKMessage): Promise<void> {
            try {
              const fields = extractInboundMessageFields(msg);
              if (!fields) return;
              const {
                uuid
              } = fields;

              // Dynamic import keeps the bridge code out of non-BRIDGE_MODE builds.
              const {
                resolveAndPrepend
              } = await import('../bridge/inboundAttachments.js');
              let sanitized = fields.content;
              if (feature('KAIROS_GITHUB_WEBHOOKS')) {
                /* eslint-disable @typescript-eslint/no-require-imports */
                const {
                  sanitizeInboundWebhookContent
                } = require('../bridge/webhookSanitizer.js') as typeof import('../bridge/webhookSanitizer.js');
                /* eslint-enable @typescript-eslint/no-require-imports */
                sanitized = sanitizeInboundWebhookContent(fields.content);
              }
// webhook 内容消毒只对 KAIROS_GITHUB_WEBHOOKS 构建生效——条件 require 保证这段也不进别的构建。
              const content = await resolveAndPrepend(msg, sanitized);
              const preview = typeof content === 'string' ? content.slice(0, 80) : `[${content.length} content blocks]`;
              logForDebugging(`[bridge:repl] Injecting inbound user message: ${preview}${uuid ? ` uuid=${uuid}` : ''}`);
              enqueue({
                value: content,
                mode: 'prompt' as const,
                uuid,
                // skipSlashCommands stays true as defense-in-depth —
                // processUserInputBase overrides it internally when bridgeOrigin
                // is set AND the resolved command passes isBridgeSafeCommand.
                // This keeps exit-word suppression and immediate-command blocks
                // intact for any code path that checks skipSlashCommands directly.
                skipSlashCommands: true,
                bridgeOrigin: true
              });
// skipSlashCommands + bridgeOrigin 双层防御：processUserInputBase 在 bridgeOrigin 为真且命令通过 isBridgeSafeCommand 时会在内部覆盖 skipSlashCommands；显式传 true 保住那些直接查这个标志的代码路径的退出词抑制和即时命令拦截。
            } catch (e) {
              logForDebugging(`[bridge:repl] handleInboundMessage failed: ${e}`, {
                level: 'error'
              });
            }
          }

          // State change callback — maps bridge lifecycle events to AppState.
          function handleStateChange(state: BridgeState, detail_0?: string): void {
            if (cancelled) return;
            if (outboundOnly) {
              logForDebugging(`[bridge:repl] Mirror state=${state}${detail_0 ? ` detail=${detail_0}` : ''}`);
              // Sync replBridgeConnected so the forwarding effect starts/stops
              // writing as the transport comes up or dies.
              if (state === 'failed') {
                setAppState(prev_3 => {
                  if (!prev_3.replBridgeConnected) return prev_3;
                  return {
                    ...prev_3,
                    replBridgeConnected: false
                  };
                });
              } else if (state === 'ready' || state === 'connected') {
                setAppState(prev_4 => {
                  if (prev_4.replBridgeConnected) return prev_4;
                  return {
                    ...prev_4,
                    replBridgeConnected: true
                  };
                });
              }
              return;
            }
// outboundOnly 镜像模式只同步 replBridgeConnected 一个标志——转发 effect 靠它起停，传输建立/死亡时跟着翻，不走完整的状态机。
            const handle = handleRef.current;
            switch (state) {
              case 'ready':
                setAppState(prev_9 => {
                  const connectUrl = handle && handle.environmentId !== '' ? buildBridgeConnectUrl(handle.environmentId, handle.sessionIngressUrl) : prev_9.replBridgeConnectUrl;
                  const sessionUrl = handle ? getRemoteSessionUrl(handle.bridgeSessionId, handle.sessionIngressUrl) : prev_9.replBridgeSessionUrl;
                  const envId = handle?.environmentId;
                  const sessionId = handle?.bridgeSessionId;
                  if (prev_9.replBridgeConnected && !prev_9.replBridgeSessionActive && !prev_9.replBridgeReconnecting && prev_9.replBridgeConnectUrl === connectUrl && prev_9.replBridgeSessionUrl === sessionUrl && prev_9.replBridgeEnvironmentId === envId && prev_9.replBridgeSessionId === sessionId) {
                    return prev_9;
                  }
                  return {
                    ...prev_9,
                    replBridgeConnected: true,
                    replBridgeSessionActive: false,
                    replBridgeReconnecting: false,
                    replBridgeConnectUrl: connectUrl,
                    replBridgeSessionUrl: sessionUrl,
                    replBridgeEnvironmentId: envId,
                    replBridgeSessionId: sessionId,
                    replBridgeError: undefined
                  };
                });
                break;
// ready 状态：组装连接 URL 和会话 URL，六个字段逐个比对，全相同就返回原 state——重连风暴里这个短路省掉大量无意义重渲染。
              case 'connected':
                {
                  setAppState(prev_8 => {
                    if (prev_8.replBridgeSessionActive) return prev_8;
                    return {
                      ...prev_8,
                      replBridgeConnected: true,
                      replBridgeSessionActive: true,
                      replBridgeReconnecting: false,
                      replBridgeError: undefined
                    };
                  });
                  // Send system/init so remote clients (web/iOS/Android) get
                  // session metadata. REPL uses query() directly — never hits
                  // QueryEngine's SDKMessage layer — so this is the only path
                  // to put system/init on the REPL-bridge wire. Skills load is
                  // async (memoized, cheap after REPL startup); fire-and-forget
                  // so the connected-state transition isn't blocked.
// system/init 为什么只有这里发：REPL 用 query() 直连主循环，永远不经过 QueryEngine 的 SDKMessage 层，所以这是唯一能把 system/init 放上 REPL-桥线的路径。技能加载是异步的（memoize 过，REPL 启动后很便宜），fire-and-forget 不阻塞状态跳转。GB 开关 tengu_bridge_system_init 控量。
                  if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_bridge_system_init', false)) {
                    void (async () => {
                      try {
                        const skills = await getSlashCommandToolSkills(getCwd());
                        if (cancelled) return;
                        const state_0 = store.getState();
                        handleRef.current?.writeSdkMessages([buildSystemInitMessage({
                          // tools/mcpClients/plugins redacted for REPL-bridge:
                          // MCP-prefixed tool names and server names leak which
                          // integrations the user has wired up; plugin paths leak
                          // raw filesystem paths (username, project structure).
                          // CCR v2 persists SDK messages to Spanner — users who
                          // tap "Connect from phone" may not expect these on
                          // Anthropic's servers. QueryEngine (SDK) still emits
                          // full lists — SDK consumers expect full telemetry.
// 三个字段打码不是洁癖是泄漏防护：MCP 前缀工具名和服务器名暴露用户接了哪些集成；插件路径暴露原始文件系统路径（用户名、项目结构）；CCR v2 会把 SDK 消息持久化进 Spanner——点「从手机连接」的用户未必料到这些上了 Anthropic 的服务器。QueryEngine（SDK）仍发全量，SDK 消费者本就期待全量遥测。
                          tools: [],
                          mcpClients: [],
                          model: mainLoopModelRef.current,
                          permissionMode: state_0.toolPermissionContext.mode as PermissionMode,
                          // TODO: avoid the cast
                          // Remote clients can only invoke bridge-safe commands —
                          // advertising unsafe ones (local-jsx, unallowed local)
                          // would let mobile/web attempt them and hit errors.
                          commands: commandsRef.current.filter(isBridgeSafeCommand),
// 只广告桥安全命令：把 local-jsx、未授权本地命令广告出去，移动端/网页端会去调然后撞一脸错误。
                          agents: state_0.agentDefinitions.activeAgents,
                          skills,
                          plugins: [],
                          fastMode: state_0.fastMode
                        })]);
                      } catch (err_0) {
                        logForDebugging(`[bridge:repl] Failed to send system/init: ${errorMessage(err_0)}`, {
                          level: 'error'
                        });
                      }
                    })();
                  }
                  break;
                }
              case 'reconnecting':
                setAppState(prev_7 => {
                  if (prev_7.replBridgeReconnecting) return prev_7;
                  return {
                    ...prev_7,
                    replBridgeReconnecting: true,
                    replBridgeSessionActive: false
                  };
                });
                break;
              case 'failed':
                // Clear any previous failure dismiss timer
                clearTimeout(failureTimeoutRef.current);
                notifyBridgeFailed(detail_0);
                setAppState(prev_5 => ({
                  ...prev_5,
                  replBridgeError: detail_0,
                  replBridgeReconnecting: false,
                  replBridgeSessionActive: false,
                  replBridgeConnected: false
                }));
                // Auto-disable after timeout so the hook stops retrying.
                failureTimeoutRef.current = setTimeout(() => {
                  if (cancelled) return;
                  failureTimeoutRef.current = undefined;
                  setAppState(prev_6 => {
                    if (!prev_6.replBridgeError) return prev_6;
                    return {
                      ...prev_6,
                      replBridgeEnabled: false,
                      replBridgeError: undefined
                    };
                  });
                }, BRIDGE_FAILURE_DISMISS_MS);
                break;
// failed：清旧 dismiss 计时器、通知、落错误态，10 秒后自动摘掉 replBridgeEnabled——自动停重试，不等用户干预。
            }
          }

          // Map of pending bridge permission response handlers, keyed by request_id.
          // Each entry is an onResponse handler waiting for CCR to reply.
          const pendingPermissionHandlers = new Map<string, (response: BridgePermissionResponse) => void>();

          // Dispatch incoming control_response messages to registered handlers
          function handlePermissionResponse(msg_0: SDKControlResponse): void {
            const requestId = msg_0.response?.request_id;
            if (!requestId) return;
            const handler = pendingPermissionHandlers.get(requestId);
            if (!handler) {
              logForDebugging(`[bridge:repl] No handler for control_response request_id=${requestId}`);
              return;
            }
            pendingPermissionHandlers.delete(requestId);
            // Extract the permission decision from the control_response payload
            const inner = msg_0.response;
            if (inner.subtype === 'success' && inner.response && isBridgePermissionResponse(inner.response)) {
              handler(inner.response);
            }
          }
// control_response 按 request_id 找到挂起的处理器，用完即删——同一个 request 的第二条响应（服务端重发）不会二次触发。
          const handle_0 = await initReplBridge({
            outboundOnly,
            tags: outboundOnly ? ['ccr-mirror'] : undefined,
            onInboundMessage: handleInboundMessage,
            onPermissionResponse: handlePermissionResponse,
            onInterrupt() {
              abortControllerRef.current?.abort();
            },
            onSetModel(model) {
              const resolved = model === 'default' ? null : model ?? null;
              setMainLoopModelOverride(resolved);
              setAppState(prev_10 => {
                if (prev_10.mainLoopModelForSession === resolved) return prev_10;
                return {
                  ...prev_10,
                  mainLoopModelForSession: resolved
                };
              });
            },
// onSetModel 的 'default' 是协议里的哨兵值，落到本地就是 null（无覆盖），与 AppState.mainLoopModelForSession 对齐。
            onSetMaxThinkingTokens(maxTokens) {
              const enabled = maxTokens !== null;
              setAppState(prev_11 => {
                if (prev_11.thinkingEnabled === enabled) return prev_11;
                return {
                  ...prev_11,
                  thinkingEnabled: enabled
                };
              });
            },
            onSetPermissionMode(mode) {
              // Policy guards MUST fire before transitionPermissionMode —
              // its internal auto-gate check is a defensive throw (with a
              // setAutoModeActive(true) side-effect BEFORE the throw) rather
              // than a graceful reject. Letting that throw escape would:
              // (1) leave STATE.autoModeActive=true while the mode is
              //     unchanged (3-way invariant violation per src/CLAUDE.md)
              // (2) fail to send a control_response → server kills WS
              // These mirror print.ts handleSetPermissionMode; the bridge
              // can't import the checks directly (bootstrap-isolation), so
              // it relies on this verdict to emit the error response.
// 权限模式设置的 policy guards 必须排在 transitionPermissionMode 之前：后者内部的 auto-gate 检查是带副作用的防御性 throw——setAutoModeActive(true) 先执行再抛。让这个 throw 逃逸的后果：(1) STATE.autoModeActive 停在 true 而模式没变（3-way invariant 违反）；(2) control_response 发不出去，服务端杀 WS。这里的判决与 print.ts 的 handleSetPermissionMode 镜像；bridge 不能直接 import 那些检查（bootstrap 隔离），只能靠返回值拿判决。
              if (mode === 'bypassPermissions') {
                if (isBypassPermissionsModeDisabled()) {
                  return {
                    ok: false,
                    error: 'Cannot set permission mode to bypassPermissions because it is disabled by settings or configuration'
                  };
                }
                if (!store.getState().toolPermissionContext.isBypassPermissionsModeAvailable) {
                  return {
                    ok: false,
                    error: 'Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions'
                  };
                }
              }
              if (feature('TRANSCRIPT_CLASSIFIER') && mode === 'auto' && !isAutoModeGateEnabled()) {
                const reason = getAutoModeUnavailableReason();
                return {
                  ok: false,
                  error: reason ? `Cannot set permission mode to auto: ${getAutoModeUnavailableNotification(reason)}` : 'Cannot set permission mode to auto'
                };
              }
              // Guards passed — apply via the centralized transition so
              // prePlanMode stashing and auto-mode state sync all fire.
              setAppState(prev_12 => {
                const current = prev_12.toolPermissionContext.mode;
                if (current === mode) return prev_12;
                const next = transitionPermissionMode(current, mode, prev_12.toolPermissionContext);
                return {
                  ...prev_12,
                  toolPermissionContext: {
                    ...next,
                    mode
                  }
                };
              });
              // Recheck queued permission prompts now that mode changed.
              setImmediate(() => {
                getLeaderToolUseConfirmQueue()?.(currentQueue => {
                  currentQueue.forEach(item => {
                    void item.recheckPermission();
                  });
                  return currentQueue;
                });
              });
// 模式变了要重新评估队列里待决的权限提示（原来按 plan 拦的，现在放行了）。setImmediate 让 setAppState 先落地再扫队列。
              return {
                ok: true
              };
            },
            onStateChange: handleStateChange,
            initialMessages: messages.length > 0 ? messages : undefined,
            getMessages: () => messagesRef.current,
            previouslyFlushedUUIDs: flushedUUIDsRef.current,
            initialName: replBridgeInitialName,
            perpetual
          });
// initReplBridge 的完整回调面：入站消息、权限响应、中断、模型、思考预算、权限模式、状态机；initialMessages 带当前会话上下文，getMessages 供后续增量拉取，previouslyFlushedUUIDs 接住跨重连去重。
          if (cancelled) {
            // Effect was cancelled while initReplBridge was in flight.
            // Tear down the handle to avoid leaking resources (poll loop,
            // WebSocket, registered environment, cleanup callback).
            logForDebugging(`[bridge:repl] Hook: init cancelled during flight, tearing down${handle_0 ? ` env=${handle_0.environmentId}` : ''}`);
            if (handle_0) {
              void handle_0.teardown();
            }
            return;
          }
// init 飞行中 effect 被取消（用户又关了桥）：拿到 handle 也要 teardown——否则泄漏轮询、WebSocket、注册的环境和清理回调。
          if (!handle_0) {
            // initReplBridge returned null — a precondition failed. For most
            // cases (no_oauth, policy_denied, etc.) onStateChange('failed')
            // already fired with a specific hint. The GrowthBook-gate-off case
            // is intentionally silent — not a failure, just not rolled out.
            consecutiveFailuresRef.current++;
            logForDebugging(`[bridge:repl] Init returned null (precondition or session creation failed); consecutive failures: ${consecutiveFailuresRef.current}`);
            clearTimeout(failureTimeoutRef.current);
            setAppState(prev_13 => ({
              ...prev_13,
              replBridgeError: prev_13.replBridgeError ?? 'check debug logs for details'
            }));
            failureTimeoutRef.current = setTimeout(() => {
              if (cancelled) return;
              failureTimeoutRef.current = undefined;
              setAppState(prev_14 => {
                if (!prev_14.replBridgeError) return prev_14;
                return {
                  ...prev_14,
                  replBridgeEnabled: false,
                  replBridgeError: undefined
                };
              });
            }, BRIDGE_FAILURE_DISMISS_MS);
            return;
          }
// 返回 null = 前置条件失败（no_oauth、policy_denied 等），onStateChange('failed') 多数已经带着具体 hint 通知过了。GrowthBook 没放量那种情况故意静默——不是失败，只是没 rollout。
          handleRef.current = handle_0;
          setReplBridgeHandle(handle_0);
          consecutiveFailuresRef.current = 0;
          // Skip initial messages in the forwarding effect — they were
          // already loaded as session events during creation.
          lastWrittenIndexRef.current = initialMessageCount;
// 转发起点设为 initialMessageCount：那批消息在建会话时已经作为 session 事件加载进去了，不能再写一遍。
          if (outboundOnly) {
            setAppState(prev_15 => {
              if (prev_15.replBridgeConnected && prev_15.replBridgeSessionId === handle_0.bridgeSessionId) return prev_15;
              return {
                ...prev_15,
                replBridgeConnected: true,
                replBridgeSessionId: handle_0.bridgeSessionId,
                replBridgeSessionUrl: undefined,
                replBridgeConnectUrl: undefined,
                replBridgeError: undefined
              };
            });
            logForDebugging(`[bridge:repl] Mirror initialized, session=${handle_0.bridgeSessionId}`);
          } else {
            // Build bridge permission callbacks so the interactive permission
            // handler can race bridge responses against local user interaction.
            const permissionCallbacks: BridgePermissionCallbacks = {
              sendRequest(requestId_0, toolName, input, toolUseId, description, permissionSuggestions, blockedPath) {
                handle_0.sendControlRequest({
                  type: 'control_request',
                  request_id: requestId_0,
                  request: {
                    subtype: 'can_use_tool',
                    tool_name: toolName,
                    input,
                    tool_use_id: toolUseId,
                    description,
                    ...(permissionSuggestions ? {
                      permission_suggestions: permissionSuggestions
                    } : {}),
                    ...(blockedPath ? {
                      blocked_path: blockedPath
                    } : {})
                  }
                });
              },
              sendResponse(requestId_1, response) {
                const payload: Record<string, unknown> = {
                  ...response
                };
                handle_0.sendControlResponse({
                  type: 'control_response',
                  response: {
                    subtype: 'success',
                    request_id: requestId_1,
                    response: payload
                  }
                });
              },
              cancelRequest(requestId_2) {
                handle_0.sendControlCancelRequest(requestId_2);
              },
              onResponse(requestId_3, handler_0) {
                pendingPermissionHandlers.set(requestId_3, handler_0);
                return () => {
                  pendingPermissionHandlers.delete(requestId_3);
                };
              }
            };
// 权限回调四件套交给交互式权限处理器，让桥响应和本地用户操作同场竞速（interactiveHandler 的五方竞速里，bridge 就是其中一方）。onResponse 返回注销函数，取消时从 Map 摘掉。
            setAppState(prev_16 => ({
              ...prev_16,
              replBridgePermissionCallbacks: permissionCallbacks
            }));
            const url = getRemoteSessionUrl(handle_0.bridgeSessionId, handle_0.sessionIngressUrl);
            // environmentId === '' signals the v2 env-less path. buildBridgeConnectUrl
            // builds an env-specific connect URL, which doesn't exist without an env.
            const hasEnv = handle_0.environmentId !== '';
            const connectUrl_0 = hasEnv ? buildBridgeConnectUrl(handle_0.environmentId, handle_0.sessionIngressUrl) : undefined;
            setAppState(prev_17 => {
              if (prev_17.replBridgeConnected && prev_17.replBridgeSessionUrl === url) {
                return prev_17;
              }
              return {
                ...prev_17,
                replBridgeConnected: true,
                replBridgeSessionUrl: url,
                replBridgeConnectUrl: connectUrl_0 ?? prev_17.replBridgeConnectUrl,
                replBridgeEnvironmentId: handle_0.environmentId,
                replBridgeSessionId: handle_0.bridgeSessionId,
                replBridgeError: undefined
              };
            });

            // Show bridge status with URL in the transcript. perpetual (KAIROS
            // assistant mode) falls back to v1 at initReplBridge.ts — skip the
            // v2-only upgrade nudge for them. Own try/catch so a cosmetic
            // GrowthBook hiccup doesn't hit the outer init-failure handler.
            const upgradeNudge = !perpetual ? await shouldShowAppUpgradeMessage().catch(() => false) : false;
            if (cancelled) return;
            setMessages(prev_18 => [...prev_18, createBridgeStatusMessage(url, upgradeNudge ? 'Please upgrade to the latest version of the Claude mobile app to see your Remote Control sessions.' : undefined)]);
// env-less v2 路径（environmentId === ''）没有环境专属连接 URL；升级提示只对非 perpetual 弹（perpetual 在 initReplBridge 里回退 v1 了，v2 的 nudge 对它们无意义），且独立 try/catch—— GrowthBook 小颠簸不该进外层 init 失败处理器。
            logForDebugging(`[bridge:repl] Hook initialized, session=${handle_0.bridgeSessionId}`);
          }
        } catch (err) {
          // Never crash the REPL — surface the error in the UI.
          // Check cancelled first (symmetry with the !handle path at line ~386):
          // if initReplBridge threw during rapid toggle-off (in-flight network
          // error), don't count that toward the fuse or spam a stale error
          // into the UI. Also fixes pre-existing spurious setAppState/
          // setMessages on cancelled throws.
          if (cancelled) return;
          consecutiveFailuresRef.current++;
          const errMsg = errorMessage(err);
          logForDebugging(`[bridge:repl] Init failed: ${errMsg}; consecutive failures: ${consecutiveFailuresRef.current}`);
          clearTimeout(failureTimeoutRef.current);
          notifyBridgeFailed(errMsg);
          setAppState(prev_0 => ({
            ...prev_0,
            replBridgeError: errMsg
          }));
          failureTimeoutRef.current = setTimeout(() => {
            if (cancelled) return;
            failureTimeoutRef.current = undefined;
            setAppState(prev_1 => {
              if (!prev_1.replBridgeError) return prev_1;
              return {
                ...prev_1,
                replBridgeEnabled: false,
                replBridgeError: undefined
              };
            });
          }, BRIDGE_FAILURE_DISMISS_MS);
          if (!outboundOnly) {
            setMessages(prev_2 => [...prev_2, createSystemMessage(`Remote Control failed to connect: ${errMsg}`, 'warning')]);
          }
        }
// catch 里第一件事是检查 cancelled：快速 toggle off 造成的在途网络错误不计入保险丝、不往 UI 里刷一条陈旧错误（对称于 !handle 路径）。
      })();
      return () => {
        cancelled = true;
        clearTimeout(failureTimeoutRef.current);
        failureTimeoutRef.current = undefined;
        if (handleRef.current) {
          logForDebugging(`[bridge:repl] Hook cleanup: starting teardown for env=${handleRef.current.environmentId} session=${handleRef.current.bridgeSessionId}`);
          teardownPromiseRef.current = handleRef.current.teardown();
          handleRef.current = null;
          setReplBridgeHandle(null);
        }
        setAppState(prev_19 => {
          if (!prev_19.replBridgeConnected && !prev_19.replBridgeSessionActive && !prev_19.replBridgeError) {
            return prev_19;
          }
          return {
            ...prev_19,
            replBridgeConnected: false,
            replBridgeSessionActive: false,
            replBridgeReconnecting: false,
            replBridgeConnectUrl: undefined,
            replBridgeSessionUrl: undefined,
            replBridgeEnvironmentId: undefined,
            replBridgeSessionId: undefined,
            replBridgeError: undefined,
            replBridgePermissionCallbacks: undefined
          };
        });
        lastWrittenIndexRef.current = 0;
      };
// cleanup 把 teardownPromise 存下来而不是 await：下次 init 的开头会等它——这就是上面「等上一个 teardown」的存储侧。
    }
  }, [replBridgeEnabled, replBridgeOutboundOnly, setAppState, setMessages, addNotification]);

  // Write new messages as they appear.
  // Also re-runs when replBridgeConnected changes (bridge finishes init),
  // so any messages that arrived before the bridge was ready get written.
  useEffect(() => {
    // Positive feature() guard — see first useEffect comment
    if (feature('BRIDGE_MODE')) {
      if (!replBridgeConnected) return;
      const handle_1 = handleRef.current;
      if (!handle_1) return;

      // Clamp the index in case messages were compacted (array shortened).
      // After compaction the ref could exceed messages.length, and without
      // clamping no new messages would be forwarded.
      if (lastWrittenIndexRef.current > messages.length) {
        logForDebugging(`[bridge:repl] Compaction detected: lastWrittenIndex=${lastWrittenIndexRef.current} > messages.length=${messages.length}, clamping`);
      }
      const startIndex = Math.min(lastWrittenIndexRef.current, messages.length);

      // Collect new messages since last write
      const newMessages: Message[] = [];
      for (let i = startIndex; i < messages.length; i++) {
        const msg_1 = messages[i];
        if (msg_1 && (msg_1.type === 'user' || msg_1.type === 'assistant' || msg_1.type === 'system' && msg_1.subtype === 'local_command')) {
          newMessages.push(msg_1);
        }
      }
      lastWrittenIndexRef.current = messages.length;
      if (newMessages.length > 0) {
        handle_1.writeMessages(newMessages);
      }
    }
  }, [messages, replBridgeConnected]);
// 转发 effect：compaction 之后数组变短，lastWrittenIndex 可能超过 messages.length——不 clamp 的话此后永远没有新消息会被转发。过滤条件只放 user/assistant 和 local_command 系统消息。
  const sendBridgeResult = useCallback(() => {
    if (feature('BRIDGE_MODE')) {
      handleRef.current?.sendResult();
    }
  }, []);
// sendBridgeResult：把「这轮结束了」信号推给远端（远程 UI 靠它收起转圈）。
  return {
    sendBridgeResult
  };
}
// 原文件此处有一行 79944 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。