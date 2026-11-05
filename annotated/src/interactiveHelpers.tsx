import { feature } from 'bun:bundle';
import { appendFileSync } from 'fs';
import React from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { gracefulShutdown, gracefulShutdownSync } from 'src/utils/gracefulShutdown.js';
import { type ChannelEntry, getAllowedChannels, setAllowedChannels, setHasDevChannels, setSessionTrustAccepted, setStatsStore } from './bootstrap/state.js';
import type { Command } from './commands.js';
import { createStatsStore, type StatsStore } from './context/stats.js';
import { getSystemContext } from './context.js';
import { initializeTelemetryAfterTrust } from './entrypoints/init.js';
import { isSynchronizedOutputSupported } from './ink/terminal.js';
import type { RenderOptions, Root, TextProps } from './ink.js';
import { KeybindingSetup } from './keybindings/KeybindingProviderSetup.js';
import { startDeferredPrefetches } from './main.js';
import { checkGate_CACHED_OR_BLOCKING, initializeGrowthBook, resetGrowthBook } from './services/analytics/growthbook.js';
import { isQualifiedForGrove } from './services/api/grove.js';
import { handleMcpjsonServerApprovals } from './services/mcpServerApproval.js';
import { AppStateProvider } from './state/AppState.js';
import { onChangeAppState } from './state/onChangeAppState.js';
import { normalizeApiKeyForConfig } from './utils/authPortable.js';
import { getExternalClaudeMdIncludes, getMemoryFiles, shouldShowClaudeMdExternalIncludesWarning } from './utils/claudemd.js';
import { checkHasTrustDialogAccepted, getCustomApiKeyStatus, getGlobalConfig, saveGlobalConfig } from './utils/config.js';
import { updateDeepLinkTerminalPreference } from './utils/deepLink/terminalPreference.js';
import { isEnvTruthy, isRunningOnHomespace } from './utils/envUtils.js';
import { type FpsMetrics, FpsTracker } from './utils/fpsTracker.js';
import { updateGithubRepoPathMapping } from './utils/githubRepoPathMapping.js';
import { applyConfigEnvironmentVariables } from './utils/managedEnv.js';
import type { PermissionMode } from './utils/permissions/PermissionMode.js';
import { getBaseRenderOptions } from './utils/renderOptions.js';
import { getSettingsWithAllErrors } from './utils/settings/allErrors.js';
import { hasAutoModeOptIn, hasSkipDangerousModePermissionPrompt } from './utils/settings/settings.js';
// 新手引导的完成标记只写一个字段：回调式保存，避免整份配置读改写时覆盖并发写入
export function completeOnboarding(): void {
  saveGlobalConfig(current => ({
    ...current,
    hasCompletedOnboarding: true,
    lastOnboardingVersion: MACRO.VERSION
  }));
}
// 把对话框包成 Promise：渲染后由组件自己调 done，调用方 await 就能拿到结果
export function showDialog<T = void>(root: Root, renderer: (done: (result: T) => void) => React.ReactNode): Promise<T> {
  return new Promise<T>(resolve => {
    const done = (result: T): void => void resolve(result);
// 直接替换整个 root 的内容：对话框之间不必显式卸载，后一次渲染顶掉前一次
    root.render(renderer(done));
  });
}

/**
 * Render an error message through Ink, then unmount and exit.
 * Use this for fatal errors after the Ink root has been created —
 * console.error is swallowed by Ink's patchConsole, so we render
 * through the React tree instead.
 */
// 致命错误入口只把颜色定死，真正的收尾逻辑全在下面那个函数
export async function exitWithError(root: Root, message: string, beforeExit?: () => Promise<void>): Promise<never> {
  return exitWithMessage(root, message, {
    color: 'error',
    beforeExit
  });
}

/**
 * Render a message through Ink, then unmount and exit.
 * Use this for messages after the Ink root has been created —
 * console output is swallowed by Ink's patchConsole, so we render
 * through the React tree instead.
 */
// 先渲染再卸载再退进程：顺序反了用户根本看不到这句话
export async function exitWithMessage(root: Root, message: string, options?: {
  color?: TextProps['color'];
  exitCode?: number;
  beforeExit?: () => Promise<void>;
}): Promise<never> {
// 动态导入 Ink：错误路径多发生在启动早期，静态导入会把整棵渲染树拖进冷启动
  const {
    Text
  } = await import('./ink.js');
  const color = options?.color;
// 不传退出码时一律按失败处理，调用方漏参数也不会退成 0
  const exitCode = options?.exitCode ?? 1;
  root.render(color ? <Text color={color}>{message}</Text> : <Text>{message}</Text>);
// 必须先卸载再跑 beforeExit：回调里可能还要写终端，Ink 占着屏幕会打架
  root.unmount();
// beforeExit 是异步的，await 之后才退出，否则清理逻辑会被 exit 直接截断
  await options?.beforeExit?.();
  // eslint-disable-next-line custom-rules/no-process-exit -- exit after Ink unmount
  process.exit(exitCode);
}

/**
 * Show a setup dialog wrapped in AppStateProvider + KeybindingSetup.
 * Reduces boilerplate in showSetupScreens() where every dialog needs these wrappers.
 */
// 安装类对话框的统一外壳：每次都套同一组 Provider，业务组件不必各自记得包
export function showSetupDialog<T = void>(root: Root, renderer: (done: (result: T) => void) => React.ReactNode, options?: {
  onChangeAppState?: typeof onChangeAppState;
}): Promise<T> {
// state 变更回调可选透传，缺省时 Provider 用内置实现
  return showDialog<T>(root, done => <AppStateProvider onChangeAppState={options?.onChangeAppState}>
      <KeybindingSetup>{renderer(done)}</KeybindingSetup>
    </AppStateProvider>);
}

/**
 * Render the main UI into the root and wait for it to exit.
 * Handles the common epilogue: start deferred prefetches, wait for exit, graceful shutdown.
 */
// 主界面跑完的固定收尾：渲染、起预取、等退出、优雅关闭，四步顺序不能换
export async function renderAndRun(root: Root, element: React.ReactNode): Promise<void> {
  root.render(element);
// 预取放在渲染之后：此时首帧已进队列，后台请求不会拖慢首次绘制
  startDeferredPrefetches();
  await root.waitUntilExit();
  await gracefulShutdown(0);
}
// 交互式启动的检查清单：引导、信任、策略、密钥、模式授权、开发频道、浏览器插件
export async function showSetupScreens(root: Root, permissionMode: PermissionMode, allowDangerouslySkipPermissions: boolean, commands?: Command[], claudeInChrome?: boolean, devChannels?: ChannelEntry[]): Promise<boolean> {
// 演示模式与测试环境整段跳过，否则自动化会卡在需要人操作的弹窗上
  if ("production" === 'test' || isEnvTruthy(false) || process.env.IS_DEMO // Skip onboarding in demo mode
  ) {
    return false;
  }
  const config = getGlobalConfig();
  let onboardingShown = false;
// 主题为空或引导未完成都算首次运行：老版本升级上来可能有主题却没走过新引导
  if (!config.theme || !config.hasCompletedOnboarding // always show onboarding at least once
  ) {
    onboardingShown = true;
    const {
      Onboarding
    } = await import('./components/Onboarding.js');
// 引导弹窗自带完成回调，用户按完先把标记写盘再放行
    await showSetupDialog(root, done => <Onboarding onDone={() => {
      completeOnboarding();
      void done();
    }} />, {
      onChangeAppState
    });
  }

  // Always show the trust dialog in interactive sessions, regardless of permission mode.
  // The trust dialog is the workspace trust boundary — it warns about untrusted repos
  // and checks CLAUDE.md external includes. bypassPermissions mode
  // only affects tool execution permissions, not workspace trust.
  // Note: non-interactive sessions (CI/CD with -p) never reach showSetupScreens at all.
  // Skip permission checks in claubbit
// 内部构建跳过整套信任检查：这不是安全开关，只是给自家环境省掉弹窗
  if (!isEnvTruthy(process.env.CLAUBBIT)) {
    // Fast-path: skip TrustDialog import+render when CWD is already trusted.
    // If it returns true, the TrustDialog would auto-resolve regardless of
    // security features, so we can skip the dynamic import and render cycle.
// 快速路径：当前目录已信任就整段跳过动态导入，省一次组件加载与一次渲染
    if (!checkHasTrustDialogAccepted()) {
      const {
        TrustDialog
      } = await import('./components/TrustDialog/TrustDialog.js');
      await showSetupDialog(root, done => <TrustDialog commands={commands} onDone={done} />);
    }

    // Signal that trust has been verified for this session.
    // GrowthBook checks this to decide whether to include auth headers.
// 信任确认后置位会话级标志：灰度配置要读它决定是否带认证头
    setSessionTrustAccepted(true);

    // Reset and reinitialize GrowthBook after trust is established.
    // Defense for login/logout: clears any prior client so the next init
    // picks up fresh auth headers.
// 先重置再初始化：登录与登出都会走到这里，残留旧客户端会带着上一份凭据
    resetGrowthBook();
    void initializeGrowthBook();

    // Now that trust is established, prefetch system context if it wasn't already
    void getSystemContext();

    // If settings are valid, check for any mcp.json servers that need approval
// 配置项有错误时整段跳过 MCP 审批：坏配置下弹审批只会让用户更困惑
    const {
      errors: allErrors
    } = getSettingsWithAllErrors();
    if (allErrors.length === 0) {
      await handleMcpjsonServerApprovals(root);
    }

    // Check for claude.md includes that need approval
// 外部引用提醒单独一次确认：它读磁盘上的记忆文件，可能指向仓库外的路径
    if (await shouldShowClaudeMdExternalIncludesWarning()) {
      const externalIncludes = getExternalClaudeMdIncludes(await getMemoryFiles(true));
      const {
        ClaudeMdExternalIncludesDialog
      } = await import('./components/ClaudeMdExternalIncludesDialog.js');
      await showSetupDialog(root, done => <ClaudeMdExternalIncludesDialog onDone={done} isStandaloneDialog externalIncludes={externalIncludes} />);
    }
  }

  // Track current repo path for teleport directory switching (fire-and-forget)
  // This must happen AFTER trust to prevent untrusted directories from poisoning the mapping
// 仓库路径映射必须放在信任之后：未信任目录写进去会污染传送的目录切换
  void updateGithubRepoPathMapping();
  if (feature('LODESTONE')) {
    updateDeepLinkTerminalPreference();
  }

  // Apply full environment variables after trust dialog is accepted OR in bypass mode
  // In bypass mode (CI/CD, automation), we trust the environment so apply all variables
  // In normal mode, this happens after the trust dialog is accepted
  // This includes potentially dangerous environment variables from untrusted sources
// 环境变量在信任之后整批应用：其中带副作用的那几个提前应用等于给未信任仓库开门
  applyConfigEnvironmentVariables();

  // Initialize telemetry after env vars are applied so OTEL endpoint env vars and
  // otelHeadersHelper (which requires trust to execute) are available.
  // Defer to next tick so the OTel dynamic import resolves after first render
  // instead of during the pre-render microtask queue.
// 遥测推迟一个事件循环：让 OTEL 动态导入落在首帧之后，而不是塞进渲染前的微任务
  setImmediate(() => initializeTelemetryAfterTrust());
  if (await isQualifiedForGrove()) {
    const {
      GroveDialog
    } = await import('src/components/grove/Grove.js');
    const decision = await showSetupDialog<string>(root, done => <GroveDialog showIfAlreadyViewed={false} location={onboardingShown ? 'onboarding' : 'policy_update_modal'} onDone={done} />);
// 策略弹窗返回 escape 就当作拒绝：先记事件再同步关闭，不走常规的优雅退出
    if (decision === 'escape') {
      logEvent('tengu_grove_policy_exited', {});
      gracefulShutdownSync(0);
      return false;
    }
  }

  // Check for custom API key
  // On homespace, ANTHROPIC_API_KEY is preserved in process.env for child
  // processes but ignored by Claude Code itself (see auth.ts).
// 宿主环境里的同名变量会被本体忽略，所以这里也要排除，否则会误弹审批
  if (process.env.ANTHROPIC_API_KEY && !isRunningOnHomespace()) {
    const customApiKeyTruncated = normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY);
    const keyStatus = getCustomApiKeyStatus(customApiKeyTruncated);
    if (keyStatus === 'new') {
      const {
        ApproveApiKey
      } = await import('./components/ApproveApiKey.js');
      await showSetupDialog<boolean>(root, done => <ApproveApiKey customApiKeyTruncated={customApiKeyTruncated} onDone={done} />, {
        onChangeAppState
      });
    }
  }
// 危险模式每次启动都要再确认，除非设置里显式关掉了这个提示
  if ((permissionMode === 'bypassPermissions' || allowDangerouslySkipPermissions) && !hasSkipDangerousModePermissionPrompt()) {
    const {
      BypassPermissionsModeDialog
    } = await import('./components/BypassPermissionsModeDialog.js');
    await showSetupDialog(root, done => <BypassPermissionsModeDialog onAccept={done} />);
  }
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    // Only show the opt-in dialog if auto mode actually resolved — if the
    // gate denied it (org not allowlisted, settings disabled), showing
    // consent for an unavailable feature is pointless. The
    // verifyAutoModeGateAccess notification will explain why instead.
// 自动模式只在门禁放行后征求同意：功能压根不可用时问用户要不要开启毫无意义
    if (permissionMode === 'auto' && !hasAutoModeOptIn()) {
      const {
        AutoModeOptInDialog
      } = await import('./components/AutoModeOptInDialog.js');
      await showSetupDialog(root, done => <AutoModeOptInDialog onAccept={done} onDecline={() => gracefulShutdownSync(1)} declineExits />);
    }
  }

  // --dangerously-load-development-channels confirmation. On accept, append
  // dev channels to any --channels list already set in main.tsx. Org policy
  // is NOT bypassed — gateChannelServer() still runs; this flag only exists
  // to sidestep the --channels approved-server allowlist.
  if (feature('KAIROS') || feature('KAIROS_CHANNELS')) {
    // gateChannelServer and ChannelsNotice read tengu_harbor after this
    // function returns. A cold disk cache (fresh install, or first run after
    // the flag was added server-side) defaults to false and silently drops
    // channel notifications for the whole session — gh#37026.
    // checkGate_CACHED_OR_BLOCKING returns immediately if disk already says
    // true; only blocks on a cold/stale-false cache (awaits the same memoized
    // initializeGrowthBook promise fired earlier). Also warms the
    // isChannelsEnabled() check in the dev-channels dialog below.
// 有频道要加载时先把门禁读热：冷缓存默认假，会让整场会话静默丢掉频道通知
    if (getAllowedChannels().length > 0 || (devChannels?.length ?? 0) > 0) {
      await checkGate_CACHED_OR_BLOCKING('tengu_harbor');
    }
// 开发频道走单独确认：它绕过的是已批准服务器白名单，不是组织策略
    if (devChannels && devChannels.length > 0) {
      const [{
        isChannelsEnabled
      }, {
        getClaudeAIOAuthTokens
      }] = await Promise.all([import('./services/mcp/channelAllowlist.js'), import('./utils/auth.js')]);
      // Skip the dialog when channels are blocked (tengu_harbor off or no
      // OAuth) — accepting then immediately seeing "not available" in
      // ChannelsNotice is worse than no dialog. Append entries anyway so
      // ChannelsNotice renders the blocked branch with the dev entries
      // named. dev:true here is for the flag label in ChannelsNotice
      // (hasNonDev check); the allowlist bypass it also grants is moot
      // since the gate blocks upstream.
// 频道不可用时干脆不弹窗，只把条目塞进去让通知区显示被拦的原因
      if (!isChannelsEnabled() || !getClaudeAIOAuthTokens()?.accessToken) {
        setAllowedChannels([...getAllowedChannels(), ...devChannels.map(c => ({
          ...c,
          dev: true
        }))]);
        setHasDevChannels(true);
      } else {
        const {
          DevChannelsDialog
        } = await import('./components/DevChannelsDialog.js');
        await showSetupDialog(root, done => <DevChannelsDialog channels={devChannels} onAccept={() => {
          // Mark dev entries per-entry so the allowlist bypass doesn't leak
          // to --channels entries when both flags are passed.
          setAllowedChannels([...getAllowedChannels(), ...devChannels.map(c => ({
            ...c,
            dev: true
          }))]);
          setHasDevChannels(true);
          void done();
        }} />);
      }
    }
  }

  // Show Chrome onboarding for first-time Claude in Chrome users
// 浏览器插件引导只对没走过的人显示，判断读的是全局配置
  if (claudeInChrome && !getGlobalConfig().hasCompletedClaudeInChromeOnboarding) {
    const {
      ClaudeInChromeOnboarding
    } = await import('./components/ClaudeInChromeOnboarding.js');
    await showSetupDialog(root, done => <ClaudeInChromeOnboarding onDone={done} />);
  }
  return onboardingShown;
}
// 渲染参数装配：把帧率追踪、统计存储与帧回调捆成一份返回
export function getRenderContext(exitOnCtrlC: boolean): {
  renderOptions: RenderOptions;
  getFpsMetrics: () => FpsMetrics | undefined;
  stats: StatsStore;
} {
  let lastFlickerTime = 0;
  const baseOptions = getBaseRenderOptions(exitOnCtrlC);

  // Log analytics event when stdin override is active
  if (baseOptions.stdin) {
    logEvent('tengu_stdin_interactive', {});
  }
  const fpsTracker = new FpsTracker();
  const stats = createStatsStore();
  setStatsStore(stats);

  // Bench mode: when set, append per-frame phase timings as JSONL for
  // offline analysis by bench/repl-scroll.ts. Captures the full TUI
  // render pipeline (yoga → screen buffer → diff → optimize → stdout)
  // so perf work on any phase can be validated against real user flows.
// 帧耗时日志由环境变量开关控制，默认关闭，只在压测时打开
  const frameTimingLogPath = process.env.CLAUDE_CODE_FRAME_TIMING_LOG;
  return {
    getFpsMetrics: () => fpsTracker.getMetrics(),
    stats,
    renderOptions: {
      ...baseOptions,
// 帧回调是热路径：只做记录与转储，任何分配都要能说清理由
      onFrame: event => {
        fpsTracker.record(event.durationMs);
        stats.observe('frame_duration_ms', event.durationMs);
// 开启后才拼这行 JSON，且写盘用同步版本：拼装有成本、异步写在强杀时会丢最后几帧
        if (frameTimingLogPath && event.phases) {
          // Bench-only env-var-gated path: sync write so no frames dropped
          // on abrupt exit. ~100 bytes at ≤60fps is negligible. rss/cpu are
          // single syscalls; cpu is cumulative — bench side computes delta.
          const line =
          // eslint-disable-next-line custom-rules/no-direct-json-operations -- tiny object, hot bench path
          JSON.stringify({
            total: event.durationMs,
            ...event.phases,
            rss: process.memoryUsage.rss(),
            cpu: process.cpuUsage()
          }) + '\n';
          // eslint-disable-next-line custom-rules/no-sync-fs -- bench-only, sync so no frames dropped on exit
          appendFileSync(frameTimingLogPath, line);
        }
        // Skip flicker reporting for terminals with synchronized output —
        // DEC 2026 buffers between BSU/ESU so clear+redraw is atomic.
// 支持同步输出的终端整段跳过闪烁上报：清屏与重绘被终端缓冲成原子操作，报了也是假信号
        if (isSynchronizedOutputSupported()) {
          return;
        }
        for (const flicker of event.flickers) {
// 窗口尺寸变化不算闪烁：那是用户操作导致的必然重排
          if (flicker.reason === 'resize') {
            continue;
          }
          const now = Date.now();
// 只在一秒的静默之后才上报：拖窗口会连续触发，全报会把真正的问题埋掉
          if (now - lastFlickerTime < 1000) {
            logEvent('tengu_flicker', {
              desiredHeight: flicker.desiredHeight,
              actualHeight: flicker.availableHeight,
              reason: flicker.reason
            } as unknown as Record<string, boolean | number | undefined>);
          }
          lastFlickerTime = now;
        }
      }
    }
  };
}
// 原文件此处有一行 40760 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。