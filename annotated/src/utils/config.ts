import { feature } from 'bun:bundle'
import { randomBytes } from 'crypto'
import { unwatchFile, watchFile } from 'fs'
import memoize from 'lodash-es/memoize.js'
import pickBy from 'lodash-es/pickBy.js'
import { basename, dirname, join, resolve } from 'path'
import { getOriginalCwd, getSessionTrustAccepted } from '../bootstrap/state.js'
import { getAutoMemEntrypoint } from '../memdir/paths.js'
import { logEvent } from '../services/analytics/index.js'
import type { McpServerConfig } from '../services/mcp/types.js'
import type {
  BillingType,
  ReferralEligibilityResponse,
} from '../services/oauth/types.js'
import { getCwd } from '../utils/cwd.js'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { logForDiagnosticsNoPII } from './diagLogs.js'
import { getGlobalClaudeFile } from './env.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import { ConfigParseError, getErrnoCode } from './errors.js'
import { writeFileSyncAndFlush_DEPRECATED } from './file.js'
import { getFsImplementation } from './fsOperations.js'
import { findCanonicalGitRoot } from './git.js'
import { safeParseJSON } from './json.js'
import { stripBOM } from './jsonRead.js'
import * as lockfile from './lockfile.js'
import { logError } from './log.js'
import type { MemoryType } from './memory/types.js'
import { normalizePathForConfigKey } from './path.js'
import { getEssentialTrafficOnlyReason } from './privacyLevel.js'
import { getManagedFilePath } from './settings/managedPath.js'
import type { ThemeSetting } from './theme.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemPaths = feature('TEAMMEM')
  ? (require('../memdir/teamMemPaths.js') as typeof import('../memdir/teamMemPaths.js'))
  : null
const ccrAutoConnect = feature('CCR_AUTO_CONNECT')
  ? (require('../bridge/bridgeEnabled.js') as typeof import('../bridge/bridgeEnabled.js'))
  : null

/* eslint-enable @typescript-eslint/no-require-imports */
import type { ImageDimensions } from './imageResizer.js'
import type { ModelOption } from './model/modelOptions.js'
import { jsonParse, jsonStringify } from './slowOperations.js'

// `config.ts` 是整个 CLI 的持久化状态层：把所有跨会话要记住的东西（主题、安装方式、每个项目的信任状态、几十项「这个提示是否已展示过」的计数器、各种缓存）压在**一个** JSON 文件里（`~/.claude.json`）。本文件要同时解决四件事：多进程并发写（文件锁）、写坏后的自愈（备份 + 默认值回落）、读写性能（内存缓存 + mtime 监视）、以及历史字段迁移。
// Re-entrancy guard: prevents getConfig → logEvent → getGlobalConfig → getConfig
// infinite recursion when the config file is corrupted. logEvent's sampling check
// reads GrowthBook features from the global config, which calls getConfig again.
let insideGetConfig = false
// `insideGetConfig` 是重入守卫，防的是一条真实死循环：配置文件损坏 → `getConfig` 想记一条 analytics → `logEvent` 要判断采样率 → 采样率读 GrowthBook 特性 → 特性存在全局配置里 → 又调 `getGlobalConfig` → 又读损坏文件。四个模块环环相扣，只有最外层才允许记日志，否则栈会一路涨到爆。

// Image dimension info for coordinate mapping (only set when image was resized)
export type PastedContent = {
  id: number // Sequential numeric ID
  type: 'text' | 'image'
  content: string
  mediaType?: string // e.g., 'image/png', 'image/jpeg'
  filename?: string // Display name for images in attachment slot
  dimensions?: ImageDimensions
  sourcePath?: string // Original file path for images dragged onto the terminal
}
// `PastedContent` 记录粘贴进来的文本与图片。`id` 是递增序号，作用是把消息正文里的占位符（形如「粘贴内容 3」）映射回真实内容；`dimensions` 只在图片被缩放后写入，用于把模型看到的坐标换算回用户终端的原始坐标——没有它，点选图片上的位置就会整体偏移。

export interface SerializedStructuredHistoryEntry {
  display: string
  pastedContents?: Record<number, PastedContent>
  pastedText?: string
}
export interface HistoryEntry {
  display: string
  pastedContents: Record<number, PastedContent>
}

export type ReleaseChannel = 'stable' | 'latest'

export type ProjectConfig = {
  allowedTools: string[]
  mcpContextUris: string[]
  mcpServers?: Record<string, McpServerConfig>
  lastAPIDuration?: number
  lastAPIDurationWithoutRetries?: number
  lastToolDuration?: number
  lastCost?: number
  lastDuration?: number
  lastLinesAdded?: number
  lastLinesRemoved?: number
  lastTotalInputTokens?: number
  lastTotalOutputTokens?: number
  lastTotalCacheCreationInputTokens?: number
  lastTotalCacheReadInputTokens?: number
  lastTotalWebSearchRequests?: number
  lastFpsAverage?: number
  lastFpsLow1Pct?: number
  lastSessionId?: string
  lastModelUsage?: Record<
    string,
    {
      inputTokens: number
      outputTokens: number
      cacheReadInputTokens: number
      cacheCreationInputTokens: number
      webSearchRequests: number
      costUSD: number
    }
  >
  lastSessionMetrics?: Record<string, number>
  exampleFiles?: string[]
  exampleFilesGeneratedAt?: number

  // Trust dialog settings
  hasTrustDialogAccepted?: boolean

  hasCompletedProjectOnboarding?: boolean
  projectOnboardingSeenCount: number
  hasClaudeMdExternalIncludesApproved?: boolean
  hasClaudeMdExternalIncludesWarningShown?: boolean
  // MCP server approval fields - migrated to settings but kept for backward compatibility
  enabledMcpjsonServers?: string[]
  disabledMcpjsonServers?: string[]
  enableAllProjectMcpServers?: boolean
  // List of disabled MCP servers (all scopes) - used for enable/disable toggle
  disabledMcpServers?: string[]
  // Opt-in list for built-in MCP servers that default to disabled
  enabledMcpServers?: string[]
  // Worktree session management
  activeWorktreeSession?: {
    originalCwd: string
    worktreePath: string
    worktreeName: string
    originalBranch?: string
    sessionId: string
    hookBased?: boolean
  }
  /** Spawn mode for `claude remote-control` multi-session. Set by first-run dialog or `w` toggle. */
  remoteControlSpawnMode?: 'same-dir' | 'worktree'
}
// `ProjectConfig` 是「按目录存的状态」：允许的工具、MCP 服务器、上次会话的耗时/成本/token 统计、信任对话是否已接受、以及 worktree 会话的归属信息。键是归一化后的绝对路径（git 仓库根优先），所以同一个仓库的不同子目录共享一份配置。

const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  allowedTools: [],
  mcpContextUris: [],
  mcpServers: {},
  enabledMcpjsonServers: [],
  disabledMcpjsonServers: [],
  hasTrustDialogAccepted: false,
  projectOnboardingSeenCount: 0,
  hasClaudeMdExternalIncludesApproved: false,
  hasClaudeMdExternalIncludesWarningShown: false,
}
// `DEFAULT_PROJECT_CONFIG` 是一个**共享可变对象**，多处直接把它当返回值（`?? DEFAULT_PROJECT_CONFIG`）。这意味着任何调用方若就地改它，会把默认值污染给所有项目。下面的 `getCurrentProjectConfig` 里对 `allowedTools` 的修补正是就地写——它安全的前提是「该字段脏了才修，而共享对象里这个字段是空数组」。这种隐式约定是本文件最脆的地方。

export type InstallMethod = 'local' | 'native' | 'global' | 'unknown'

export {
  EDITOR_MODES,
  NOTIFICATION_CHANNELS,
} from './configConstants.js'

import type { EDITOR_MODES, NOTIFICATION_CHANNELS } from './configConstants.js'

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export type AccountInfo = {
  accountUuid: string
  emailAddress: string
  organizationUuid?: string
  organizationName?: string | null // added 4/23/2025, not populated for existing users
  organizationRole?: string | null
  workspaceRole?: string | null
  // Populated by /api/oauth/profile
  displayName?: string
  hasExtraUsageEnabled?: boolean
  billingType?: BillingType | null
  accountCreatedAt?: string
  subscriptionCreatedAt?: string
}

// TODO: 'emacs' is kept for backward compatibility - remove after a few releases
export type EditorMode = 'emacs' | (typeof EDITOR_MODES)[number]

export type DiffTool = 'terminal' | 'auto'

export type OutputStyle = string

export type GlobalConfig = {
  /**
   * @deprecated Use settings.apiKeyHelper instead.
   */
  apiKeyHelper?: string
  projects?: Record<string, ProjectConfig>
  numStartups: number
  installMethod?: InstallMethod
  autoUpdates?: boolean
  // Flag to distinguish protection-based disabling from user preference
  autoUpdatesProtectedForNative?: boolean
  // Session count when Doctor was last shown
  doctorShownAtSession?: number
  userID?: string
  theme: ThemeSetting
  hasCompletedOnboarding?: boolean
  // Tracks the last version that reset onboarding, used with MIN_VERSION_REQUIRING_ONBOARDING_RESET
  lastOnboardingVersion?: string
  // Tracks the last version for which release notes were seen, used for managing release notes
  lastReleaseNotesSeen?: string
  // Timestamp when changelog was last fetched (content stored in ~/.claude/cache/changelog.md)
  changelogLastFetched?: number
  // @deprecated - Migrated to ~/.claude/cache/changelog.md. Keep for migration support.
  cachedChangelog?: string
  mcpServers?: Record<string, McpServerConfig>
  // claude.ai MCP connectors that have successfully connected at least once.
  // Used to gate "connector unavailable" / "needs auth" startup notifications:
  // a connector the user has actually used is worth flagging when it breaks,
  // but an org-configured connector that's been needs-auth since day one is
  // something the user has demonstrably ignored and shouldn't nag about.
  claudeAiMcpEverConnected?: string[]
  preferredNotifChannel: NotificationChannel
  /**
   * @deprecated. Use the Notification hook instead (docs/hooks.md).
   */
  customNotifyCommand?: string
  verbose: boolean
  customApiKeyResponses?: {
    approved?: string[]
    rejected?: string[]
  }
  primaryApiKey?: string // Primary API key for the user when no environment variable is set, set via oauth (TODO: rename)
  hasAcknowledgedCostThreshold?: boolean
  hasSeenUndercoverAutoNotice?: boolean // ant-only: whether the one-time auto-undercover explainer has been shown
  hasSeenUltraplanTerms?: boolean // ant-only: whether the one-time CCR terms notice has been shown in the ultraplan launch dialog
  hasResetAutoModeOptInForDefaultOffer?: boolean // ant-only: one-shot migration guard, re-prompts churned auto-mode users
  oauthAccount?: AccountInfo
  iterm2KeyBindingInstalled?: boolean // Legacy - keeping for backward compatibility
  editorMode?: EditorMode
  bypassPermissionsModeAccepted?: boolean
  hasUsedBackslashReturn?: boolean
  autoCompactEnabled: boolean // Controls whether auto-compact is enabled
  showTurnDuration: boolean // Controls whether to show turn duration message (e.g., "Cooked for 1m 6s")
  /**
   * @deprecated Use settings.env instead.
   */
  env: { [key: string]: string } // Environment variables to set for the CLI
  hasSeenTasksHint?: boolean // Whether the user has seen the tasks hint
  hasUsedStash?: boolean // Whether the user has used the stash feature (Ctrl+S)
  hasUsedBackgroundTask?: boolean // Whether the user has backgrounded a task (Ctrl+B)
  queuedCommandUpHintCount?: number // Counter for how many times the user has seen the queued command up hint
  diffTool?: DiffTool // Which tool to use for displaying diffs (terminal or vscode)

  // Terminal setup state tracking
  iterm2SetupInProgress?: boolean
  iterm2BackupPath?: string // Path to the backup file for iTerm2 preferences
  appleTerminalBackupPath?: string // Path to the backup file for Terminal.app preferences
  appleTerminalSetupInProgress?: boolean // Whether Terminal.app setup is currently in progress

  // Key binding setup tracking
  shiftEnterKeyBindingInstalled?: boolean // Whether Shift+Enter key binding is installed (for iTerm2 or VSCode)
  optionAsMetaKeyInstalled?: boolean // Whether Option as Meta key is installed (for Terminal.app)

  // IDE configurations
  autoConnectIde?: boolean // Whether to automatically connect to IDE on startup if exactly one valid IDE is available
  autoInstallIdeExtension?: boolean // Whether to automatically install IDE extensions when running from within an IDE

  // IDE dialogs
  hasIdeOnboardingBeenShown?: Record<string, boolean> // Map of terminal name to whether IDE onboarding has been shown
  ideHintShownCount?: number // Number of times the /ide command hint has been shown
  hasIdeAutoConnectDialogBeenShown?: boolean // Whether the auto-connect IDE dialog has been shown

  tipsHistory: {
    [tipId: string]: number // Key is tipId, value is the numStartups when tip was last shown
  }

  // /buddy companion soul — bones regenerated from userId on read. See src/buddy/.
  companion?: import('../buddy/types.js').StoredCompanion
  companionMuted?: boolean

  // Feedback survey tracking
  feedbackSurveyState?: {
    lastShownTime?: number
  }

  // Transcript share prompt tracking ("Don't ask again")
  transcriptShareDismissed?: boolean

  // Memory usage tracking
  memoryUsageCount: number // Number of times user has added to memory

  // Sonnet-1M configs
  hasShownS1MWelcomeV2?: Record<string, boolean> // Whether the Sonnet-1M v2 welcome message has been shown per org
  // Cache of Sonnet-1M subscriber access per org - key is org ID
  // hasAccess means "hasAccessAsDefault" but the old name is kept for backward
  // compatibility.
  s1mAccessCache?: Record<
    string,
    { hasAccess: boolean; hasAccessNotAsDefault?: boolean; timestamp: number }
  >
  // Cache of Sonnet-1M PayG access per org - key is org ID
  // hasAccess means "hasAccessAsDefault" but the old name is kept for backward
  // compatibility.
  s1mNonSubscriberAccessCache?: Record<
    string,
    { hasAccess: boolean; hasAccessNotAsDefault?: boolean; timestamp: number }
  >

  // Guest passes eligibility cache per org - key is org ID
  passesEligibilityCache?: Record<
    string,
    ReferralEligibilityResponse & { timestamp: number }
  >

  // Grove config cache per account - key is account UUID
  groveConfigCache?: Record<
    string,
    { grove_enabled: boolean; timestamp: number }
  >

  // Guest passes upsell tracking
  passesUpsellSeenCount?: number // Number of times the guest passes upsell has been shown
  hasVisitedPasses?: boolean // Whether the user has visited /passes command
  passesLastSeenRemaining?: number // Last seen remaining_passes count — reset upsell when it increases

  // Overage credit grant upsell tracking (keyed by org UUID — multi-org users).
  // Inlined shape (not import()) because config.ts is in the SDK build surface
  // and the SDK bundler can't resolve CLI service modules.
  overageCreditGrantCache?: Record<
    string,
    {
      info: {
        available: boolean
        eligible: boolean
        granted: boolean
        amount_minor_units: number | null
        currency: string | null
      }
      timestamp: number
    }
  >
  overageCreditUpsellSeenCount?: number // Number of times the overage credit upsell has been shown
  hasVisitedExtraUsage?: boolean // Whether the user has visited /extra-usage — hides credit upsells

  // Voice mode notice tracking
  voiceNoticeSeenCount?: number // Number of times the voice-mode-available notice has been shown
  voiceLangHintShownCount?: number // Number of times the /voice dictation-language hint has been shown
  voiceLangHintLastLanguage?: string // Resolved STT language code when the hint was last shown — reset count when it changes
  voiceFooterHintSeenCount?: number // Number of sessions the "hold X to speak" footer hint has been shown

  // Opus 1M merge notice tracking
  opus1mMergeNoticeSeenCount?: number // Number of times the opus-1m-merge notice has been shown

  // Experiment enrollment notice tracking (keyed by experiment id)
  experimentNoticesSeenCount?: Record<string, number>

  // OpusPlan experiment config
  hasShownOpusPlanWelcome?: Record<string, boolean> // Whether the OpusPlan welcome message has been shown per org

  // Queue usage tracking
  promptQueueUseCount: number // Number of times use has used the prompt queue

  // Btw usage tracking
  btwUseCount: number // Number of times user has used /btw

  // Plan mode usage tracking
  lastPlanModeUse?: number // Timestamp of last plan mode usage

  // Subscription notice tracking
  subscriptionNoticeCount?: number // Number of times the subscription notice has been shown
  hasAvailableSubscription?: boolean // Cached result of whether user has a subscription available
  subscriptionUpsellShownCount?: number // Number of times the subscription upsell has been shown (deprecated)
  recommendedSubscription?: string // Cached config value from Statsig (deprecated)

  // Todo feature configuration
  todoFeatureEnabled: boolean // Whether the todo feature is enabled
  showExpandedTodos?: boolean // Whether to show todos expanded, even when empty
  showSpinnerTree?: boolean // Whether to show the teammate spinner tree instead of pills

  // First start time tracking
  firstStartTime?: string // ISO timestamp when Claude Code was first started on this machine

  messageIdleNotifThresholdMs: number // How long the user has to have been idle to get a notification that Claude is done generating

  githubActionSetupCount?: number // Number of times the user has set up the GitHub Action
  slackAppInstallCount?: number // Number of times the user has clicked to install the Slack app

  // File checkpointing configuration
  fileCheckpointingEnabled: boolean

  // Terminal progress bar configuration (OSC 9;4)
  terminalProgressBarEnabled: boolean

  // Terminal tab status indicator (OSC 21337). When on, emits a colored
  // dot + status text to the tab sidebar and drops the spinner prefix
  // from the title (the dot makes it redundant).
  showStatusInTerminalTab?: boolean

  // Push-notification toggles (set via /config). Default off — explicit opt-in required.
  taskCompleteNotifEnabled?: boolean
  inputNeededNotifEnabled?: boolean
  agentPushNotifEnabled?: boolean

  // Claude Code usage tracking
  claudeCodeFirstTokenDate?: string // ISO timestamp of the user's first Claude Code OAuth token

  // Model switch callout tracking (ant-only)
  modelSwitchCalloutDismissed?: boolean // Whether user chose "Don't show again"
  modelSwitchCalloutLastShown?: number // Timestamp of last shown (don't show for 24h)
  modelSwitchCalloutVersion?: string

  // Effort callout tracking - shown once for Opus 4.6 users
  effortCalloutDismissed?: boolean // v1 - legacy, read to suppress v2 for Pro users who already saw it
  effortCalloutV2Dismissed?: boolean

  // Remote callout tracking - shown once before first bridge enable
  remoteDialogSeen?: boolean

  // Cross-process backoff for initReplBridge's oauth_expired_unrefreshable skip.
  // `expiresAt` is the dedup key — content-addressed, self-clears when /login
  // replaces the token. `failCount` caps false positives: transient refresh
  // failures (auth server 5xx, lock errors) get 3 retries before backoff kicks
  // in, mirroring useReplBridge's MAX_CONSECUTIVE_INIT_FAILURES. Dead-token
  // accounts cap at 3 config writes; healthy+transient-blip self-heals in ~210s.
  bridgeOauthDeadExpiresAt?: number
  bridgeOauthDeadFailCount?: number

  // Desktop upsell startup dialog tracking
  desktopUpsellSeenCount?: number // Total showings (max 3)
  desktopUpsellDismissed?: boolean // "Don't ask again" picked

  // Idle-return dialog tracking
  idleReturnDismissed?: boolean // "Don't ask again" picked

  // Opus 4.5 Pro migration tracking
  opusProMigrationComplete?: boolean
  opusProMigrationTimestamp?: number

  // Sonnet 4.5 1m migration tracking
  sonnet1m45MigrationComplete?: boolean

  // Opus 4.0/4.1 → current Opus migration (shows one-time notif)
  legacyOpusMigrationTimestamp?: number

  // Sonnet 4.5 → 4.6 migration (pro/max/team premium)
  sonnet45To46MigrationTimestamp?: number

  // Cached statsig gate values
  cachedStatsigGates: {
    [gateName: string]: boolean
  }

  // Cached statsig dynamic configs
  cachedDynamicConfigs?: { [configName: string]: unknown }

  // Cached GrowthBook feature values
  cachedGrowthBookFeatures?: { [featureName: string]: unknown }

  // Local GrowthBook overrides (ant-only, set via /config Gates tab).
  // Checked after env-var overrides but before the real resolved value.
  growthBookOverrides?: { [featureName: string]: unknown }

  // Emergency tip tracking - stores the last shown tip to prevent re-showing
  lastShownEmergencyTip?: string

  // File picker gitignore behavior
  respectGitignore: boolean // Whether file picker should respect .gitignore files (default: true). Note: .ignore files are always respected

  // Copy command behavior
  copyFullResponse: boolean // Whether /copy always copies the full response instead of showing the picker

  // Fullscreen in-app text selection behavior
  copyOnSelect?: boolean // Auto-copy to clipboard on mouse-up (undefined → true; lets cmd+c "work" via no-op)

  // GitHub repo path mapping for teleport directory switching
  // Key: "owner/repo" (lowercase), Value: array of absolute paths where repo is cloned
  githubRepoPaths?: Record<string, string[]>

  // Terminal emulator to launch for claude-cli:// deep links. Captured from
  // TERM_PROGRAM during interactive sessions since the deep link handler runs
  // headless (LaunchServices/xdg) with no TERM_PROGRAM set.
  deepLinkTerminal?: string

  // iTerm2 it2 CLI setup
  iterm2It2SetupComplete?: boolean // Whether it2 setup has been verified
  preferTmuxOverIterm2?: boolean // User preference to always use tmux over iTerm2 split panes

  // Skill usage tracking for autocomplete ranking
  skillUsage?: Record<string, { usageCount: number; lastUsedAt: number }>
  // Official marketplace auto-install tracking
  officialMarketplaceAutoInstallAttempted?: boolean // Whether auto-install was attempted
  officialMarketplaceAutoInstalled?: boolean // Whether auto-install succeeded
  officialMarketplaceAutoInstallFailReason?:
    | 'policy_blocked'
    | 'git_unavailable'
    | 'gcs_unavailable'
    | 'unknown' // Reason for failure if applicable
  officialMarketplaceAutoInstallRetryCount?: number // Number of retry attempts
  officialMarketplaceAutoInstallLastAttemptTime?: number // Timestamp of last attempt
  officialMarketplaceAutoInstallNextRetryTime?: number // Earliest time to retry again

  // Claude in Chrome settings
  hasCompletedClaudeInChromeOnboarding?: boolean // Whether Claude in Chrome onboarding has been shown
  claudeInChromeDefaultEnabled?: boolean // Whether Claude in Chrome is enabled by default (undefined means platform default)
  cachedChromeExtensionInstalled?: boolean // Cached result of whether Chrome extension is installed

  // Chrome extension pairing state (persisted across sessions)
  chromeExtension?: {
    pairedDeviceId?: string
    pairedDeviceName?: string
  }

  // LSP plugin recommendation preferences
  lspRecommendationDisabled?: boolean // Disable all LSP plugin recommendations
  lspRecommendationNeverPlugins?: string[] // Plugin IDs to never suggest
  lspRecommendationIgnoredCount?: number // Track ignored recommendations (stops after 5)

  // Claude Code hint protocol state (<claude-code-hint /> tags from CLIs/SDKs).
  // Nested by hint type so future types (docs, mcp, ...) slot in without new
  // top-level keys.
  claudeCodeHints?: {
    // Plugin IDs the user has already been prompted for. Show-once semantics:
    // recorded regardless of yes/no response, never re-prompted. Capped at
    // 100 entries to bound config growth — past that, hints stop entirely.
    plugin?: string[]
    // User chose "don't show plugin installation hints again" from the dialog.
    disabled?: boolean
  }

  // Permission explainer configuration
  permissionExplainerEnabled?: boolean // Enable Haiku-generated explanations for permission requests (default: true)

  // Teammate spawn mode: 'auto' | 'tmux' | 'in-process'
  teammateMode?: 'auto' | 'tmux' | 'in-process' // How to spawn teammates (default: 'auto')
  // Model for new teammates when the tool call doesn't pass one.
  // undefined = hardcoded Opus (backward-compat); null = leader's model; string = model alias/ID.
  teammateDefaultModel?: string | null

  // PR status footer configuration (feature-flagged via GrowthBook)
  prStatusFooterEnabled?: boolean // Show PR review status in footer (default: true)

  // Tmux live panel visibility (ant-only, toggled via Enter on tmux pill)
  tungstenPanelVisible?: boolean

  // Cached org-level fast mode status from the API.
  // Used to detect cross-session changes and notify users.
  penguinModeOrgEnabled?: boolean

  // Epoch ms when background refreshes last ran (fast mode, quota, passes, client data).
  // Used with tengu_cicada_nap_ms to throttle API calls
  startupPrefetchedAt?: number

  // Run Remote Control at startup (requires BRIDGE_MODE)
  // undefined = use default (see getRemoteControlAtStartup() for precedence)
  remoteControlAtStartup?: boolean

  // Cached extra usage disabled reason from the last API response
  // undefined = no cache, null = extra usage enabled, string = disabled reason.
  cachedExtraUsageDisabledReason?: string | null

  // Auto permissions notification tracking (ant-only)
  autoPermissionsNotificationCount?: number // Number of times the auto permissions notification has been shown

  // Speculation configuration (ant-only)
  speculationEnabled?: boolean // Whether speculation is enabled (default: true)


  // Client data for server-side experiments (fetched during bootstrap).
  clientDataCache?: Record<string, unknown> | null

  // Additional model options for the model picker (fetched during bootstrap).
  additionalModelOptionsCache?: ModelOption[]

  // Disk cache for /api/claude_code/organizations/metrics_enabled.
  // Org-level settings change rarely; persisting across processes avoids a
  // cold API call on every `claude -p` invocation.
  metricsStatusCache?: {
    enabled: boolean
    timestamp: number
  }

  // Version of the last-applied migration set. When equal to
  // CURRENT_MIGRATION_VERSION, runMigrations() skips all sync migrations
  // (avoiding 11× saveGlobalConfig lock+re-read on every startup).
  migrationVersion?: number
}
// `GlobalConfig` 结束。它是个扁平的大命名空间：正式设置（主题、verbose、通知渠道）、历史迁移用的废弃字段（`apiKeyHelper`、`env`、`cachedChangelog`）、几十个「提示已看过」计数器、以及各种服务端数据缓存（Statsig gate、GrowthBook 特性、org 级资格）全塞在一起。文件里的注释两次提醒：本文件属于 **SDK 构建面**，不能 import CLI 的服务模块，所以连类型都得内联展开而不能用 `import()`。

/**
 * Factory for a fresh default GlobalConfig. Used instead of deep-cloning a
 * shared constant — the nested containers (arrays, records) are all empty, so
 * a factory gives fresh refs at zero clone cost.
 */
function createDefaultGlobalConfig(): GlobalConfig {
  return {
    numStartups: 0,
    installMethod: undefined,
    autoUpdates: undefined,
    theme: 'dark',
    preferredNotifChannel: 'auto',
    verbose: false,
    editorMode: 'normal',
    autoCompactEnabled: true,
    showTurnDuration: true,
    hasSeenTasksHint: false,
    hasUsedStash: false,
    hasUsedBackgroundTask: false,
    queuedCommandUpHintCount: 0,
    diffTool: 'auto',
    customApiKeyResponses: {
      approved: [],
      rejected: [],
    },
    env: {},
    tipsHistory: {},
    memoryUsageCount: 0,
    promptQueueUseCount: 0,
    btwUseCount: 0,
    todoFeatureEnabled: true,
    showExpandedTodos: false,
    messageIdleNotifThresholdMs: 60000,
    autoConnectIde: false,
    autoInstallIdeExtension: true,
    fileCheckpointingEnabled: true,
    terminalProgressBarEnabled: true,
    cachedStatsigGates: {},
    cachedDynamicConfigs: {},
    cachedGrowthBookFeatures: {},
    respectGitignore: true,
    copyFullResponse: false,
  }
}
// 工厂函数而非共享常量：嵌套容器全是空对象/空数组，每次调用都给新引用，零克隆成本；若改成深拷贝一个共享常量，每次启动都要复制一大坨。

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = createDefaultGlobalConfig()

export const GLOBAL_CONFIG_KEYS = [
  'apiKeyHelper',
  'installMethod',
  'autoUpdates',
  'autoUpdatesProtectedForNative',
  'theme',
  'verbose',
  'preferredNotifChannel',
  'shiftEnterKeyBindingInstalled',
  'editorMode',
  'hasUsedBackslashReturn',
  'autoCompactEnabled',
  'showTurnDuration',
  'diffTool',
  'env',
  'tipsHistory',
  'todoFeatureEnabled',
  'showExpandedTodos',
  'messageIdleNotifThresholdMs',
  'autoConnectIde',
  'autoInstallIdeExtension',
  'fileCheckpointingEnabled',
  'terminalProgressBarEnabled',
  'showStatusInTerminalTab',
  'taskCompleteNotifEnabled',
  'inputNeededNotifEnabled',
  'agentPushNotifEnabled',
  'respectGitignore',
  'claudeInChromeDefaultEnabled',
  'hasCompletedClaudeInChromeOnboarding',
  'lspRecommendationDisabled',
  'lspRecommendationNeverPlugins',
  'lspRecommendationIgnoredCount',
  'copyFullResponse',
  'copyOnSelect',
  'permissionExplainerEnabled',
  'prStatusFooterEnabled',
  'remoteControlAtStartup',
  'remoteDialogSeen',
] as const
// `GLOBAL_CONFIG_KEYS` 是「外部可写键」白名单：只有列在这里的字段允许通过 `/config` 命令或 SDK 修改。它刻意不包含内部记账字段（`numStartups`、各种 `*SeenCount`、服务端缓存），因为那些是程序自己维护的，让外部改会破坏语义（比如把 `migrationVersion` 改成 0 会重跑全部迁移）。新增用户可见设置时必须同时加到这里，否则界面上改不动。

export type GlobalConfigKey = (typeof GLOBAL_CONFIG_KEYS)[number]

export function isGlobalConfigKey(key: string): key is GlobalConfigKey {
  return GLOBAL_CONFIG_KEYS.includes(key as GlobalConfigKey)
}
// 类型守卫 `isGlobalConfigKey` 既是运行时校验也是编译期收窄，配合白名单数组使用——数组是唯一的真相来源，类型由 `typeof ...[number]` 派生，避免两处维护不一致。

export const PROJECT_CONFIG_KEYS = [
  'allowedTools',
  'hasTrustDialogAccepted',
  'hasCompletedProjectOnboarding',
] as const

export type ProjectConfigKey = (typeof PROJECT_CONFIG_KEYS)[number]
// 项目级可写键只有三个：允许的工具、信任对话、引导是否完成。这份克制是安全考虑——项目配置存在仓库路径维度上，能被 `--add-dir` 之类的输入影响，可写面越小越好。

/**
 * Check if the user has already accepted the trust dialog for the cwd.
 *
 * This function traverses parent directories to check if a parent directory
 * had approval. Accepting trust for a directory implies trust for child
 * directories.
 *
 * @returns Whether the trust dialog has been accepted (i.e. "should not be shown")
 */
let _trustAccepted = false

export function resetTrustDialogAcceptedCacheForTesting(): void {
  _trustAccepted = false
}

export function checkHasTrustDialogAccepted(): boolean {
  // Trust only transitions false→true during a session (never the reverse),
  // so once true we can latch it. false is not cached — it gets re-checked
  // on every call so that trust dialog acceptance is picked up mid-session.
  // (lodash memoize doesn't fit here because it would also cache false.)
  return (_trustAccepted ||= computeTrustDialogAccepted())
}
// 信任状态的缓存只锁「true」不锁「false」：一次会话里信任只会从否变是，不会反向，所以 true 可以永久记住；而 false 必须每次重算，否则用户中途点了「信任」之后，整个进程还认为没信任。这也是为什么这里不用 `memoize`——lodash 的 memoize 会把 false 一起缓存。

function computeTrustDialogAccepted(): boolean {
  // Check session-level trust (for home directory case where trust is not persisted)
  // When running from home dir, trust dialog is shown but acceptance is stored
  // in memory only. This allows hooks and other features to work during the session.
  if (getSessionTrustAccepted()) {
    return true
  }

  const config = getGlobalConfig()

  // Always check where trust would be saved (git root or original cwd)
  // This is the primary location where trust is persisted by saveCurrentProjectConfig
  const projectPath = getProjectPathForConfig()
  const projectConfig = config.projects?.[projectPath]
  if (projectConfig?.hasTrustDialogAccepted) {
    return true
  }

  // Now check from current working directory and its parents
  // Normalize paths for consistent JSON key lookup
  let currentPath = normalizePathForConfigKey(getCwd())

  // Traverse all parent directories
  while (true) {
    const pathConfig = config.projects?.[currentPath]
    if (pathConfig?.hasTrustDialogAccepted) {
      return true
    }

    const parentPath = normalizePathForConfigKey(resolve(currentPath, '..'))
    // Stop if we've reached the root (when parent is same as current)
    if (parentPath === currentPath) {
      break
    }
    currentPath = parentPath
  }

  return false
}
// `computeTrustDialogAccepted` 三层判定：① 会话级信任（在家目录启动时只存内存，不落盘，但会话内要生效，否则 hooks 之类会立刻失效）；② 保存路径上的信任（git 根或原始 cwd，是 `saveCurrentProjectConfig` 真正写入的位置）；③ 从当前目录逐级向上找到根，任一祖先被信任即视为信任——「信任一个目录即信任其子目录」这条语义就靠这一层实现。

/**
 * Check trust for an arbitrary directory (not the session cwd).
 * Walks up from `dir`, returning true if any ancestor has trust persisted.
 * Unlike checkHasTrustDialogAccepted, this does NOT consult session trust or
 * the memoized project path — use when the target dir differs from cwd (e.g.
 * /assistant installing into a user-typed path).
 */
export function isPathTrusted(dir: string): boolean {
  const config = getGlobalConfig()
  let currentPath = normalizePathForConfigKey(resolve(dir))
  while (true) {
    if (config.projects?.[currentPath]?.hasTrustDialogAccepted) return true
    const parentPath = normalizePathForConfigKey(resolve(currentPath, '..'))
    if (parentPath === currentPath) return false
    currentPath = parentPath
  }
}
// `isPathTrusted(dir)` 与上面的区别有三处：不接受会话级信任、不查 memoize 的项目路径、显式接收目录参数。使用场景是「目标目录不是当前 cwd」（例如助手要往用户手输的路径里装东西），这时按 cwd 判信任是完全错的——会把信任错误地外推到任意路径。

// We have to put this test code here because Jest doesn't support mocking ES modules :O
const TEST_GLOBAL_CONFIG_FOR_TESTING: GlobalConfig = {
  ...DEFAULT_GLOBAL_CONFIG,
  autoUpdates: false,
}
const TEST_PROJECT_CONFIG_FOR_TESTING: ProjectConfig = {
  ...DEFAULT_PROJECT_CONFIG,
}

export function isProjectConfigKey(key: string): key is ProjectConfigKey {
  return PROJECT_CONFIG_KEYS.includes(key as ProjectConfigKey)
}

/**
 * Detect whether writing `fresh` would lose auth/onboarding state that the
 * in-memory cache still has. This happens when `getConfig` hits a corrupted
 * or truncated file mid-write (from another process or a non-atomic fallback)
 * and returns DEFAULT_GLOBAL_CONFIG. Writing that back would permanently
 * wipe auth. See GH #3117.
 */
function wouldLoseAuthState(fresh: {
  oauthAccount?: unknown
  hasCompletedOnboarding?: boolean
}): boolean {
  const cached = globalConfigCache.config
  if (!cached) return false
  const lostOauth =
    cached.oauthAccount !== undefined && fresh.oauthAccount === undefined
  const lostOnboarding =
    cached.hasCompletedOnboarding === true &&
    fresh.hasCompletedOnboarding !== true
  return lostOauth || lostOnboarding
}
// `wouldLoseAuthState` 是 GH #3117 的产物，防的是**永久掉登录**：另一个进程正在写文件、或非原子写被 kill，本进程读到截断内容 → 解析失败 → 返回默认配置 → 若把这个默认配置写回，`oauthAccount` 与 `hasCompletedOnboarding` 就永久没了，用户下次启动要重新登录并重看引导。判据只有两条：内存缓存里有 oauth 而新读的没有；缓存里引导已完成而新读的不是 true。

export function saveGlobalConfig(
  updater: (currentConfig: GlobalConfig) => GlobalConfig,
): void {
  if (process.env.NODE_ENV === 'test') {
    const config = updater(TEST_GLOBAL_CONFIG_FOR_TESTING)
    // Skip if no changes (same reference returned)
    if (config === TEST_GLOBAL_CONFIG_FOR_TESTING) {
      return
    }
    Object.assign(TEST_GLOBAL_CONFIG_FOR_TESTING, config)
    return
  }

  let written: GlobalConfig | null = null
  try {
    const didWrite = saveConfigWithLock(
      getGlobalClaudeFile(),
      createDefaultGlobalConfig,
      current => {
        const config = updater(current)
        // Skip if no changes (same reference returned)
        if (config === current) {
          return current
        }
        written = {
          ...config,
          projects: removeProjectHistory(current.projects),
        }
        return written
      },
    )
    // Only write-through if we actually wrote. If the auth-loss guard
    // tripped (or the updater made no changes), the file is untouched and
    // the cache is still valid -- touching it would corrupt the guard.
    if (didWrite && written) {
      writeThroughGlobalConfigCache(written)
    }
  } catch (error) {
    logForDebugging(`Failed to save config with lock: ${error}`, {
      level: 'error',
    })
    // Fall back to non-locked version on error. This fallback is a race
    // window: if another process is mid-write (or the file got truncated),
    // getConfig returns defaults. Refuse to write those over a good cached
    // config to avoid wiping auth. See GH #3117.
    const currentConfig = getConfig(
      getGlobalClaudeFile(),
      createDefaultGlobalConfig,
    )
    if (wouldLoseAuthState(currentConfig)) {
      logForDebugging(
        'saveGlobalConfig fallback: re-read config is missing auth that cache has; refusing to write. See GH #3117.',
        { level: 'error' },
      )
      logEvent('tengu_config_auth_loss_prevented', {})
      return
    }
    const config = updater(currentConfig)
    // Skip if no changes (same reference returned)
    if (config === currentConfig) {
      return
    }
    written = {
      ...config,
      projects: removeProjectHistory(currentConfig.projects),
    }
    saveConfig(getGlobalClaudeFile(), written, DEFAULT_GLOBAL_CONFIG)
    writeThroughGlobalConfigCache(written)
  }
}
// `saveGlobalConfig` 的三段式：① 正常路径走带锁的 `saveConfigWithLock`；② 只有**真写了**（`didWrite`）才刷新内存缓存——被 auth 守卫拦下时文件没动，此时刷缓存会把守卫依赖的「好状态」毁掉；③ 加锁失败时退回无锁写，但**同样**先过 `wouldLoseAuthState`，因为这段兜底正是竞态窗口最大的地方。守卫在最坏路径上也不能省。

// Cache for global config
let globalConfigCache: { config: GlobalConfig | null; mtime: number } = {
  config: null,
  mtime: 0,
}

// Tracking for config file operations (telemetry)
let lastReadFileStats: { mtime: number; size: number } | null = null
let configCacheHits = 0
let configCacheMisses = 0
// Session-total count of actual disk writes to the global config file.
// Exposed for ant-only dev diagnostics (see inc-4552) so anomalous write
// rates surface in the UI before they corrupt ~/.claude.json.
let globalConfigWriteCount = 0

export function getGlobalConfigWriteCount(): number {
  return globalConfigWriteCount
}
// 写次数计数器（inc-4552）：`~/.claude.json` 被写坏过一次，根因是某条路径在启动阶段反复写。计数器暴露给内部诊断 UI，让异常写入速率在损坏发生**之前**就可见——这类「先加观测再加修复」的做法比事后加日志有效得多。

export const CONFIG_WRITE_DISPLAY_THRESHOLD = 20

function reportConfigCacheStats(): void {
  const total = configCacheHits + configCacheMisses
  if (total > 0) {
    logEvent('tengu_config_cache_stats', {
      cache_hits: configCacheHits,
      cache_misses: configCacheMisses,
      hit_rate: configCacheHits / total,
    })
  }
  configCacheHits = 0
  configCacheMisses = 0
}

// Register cleanup to report cache stats at session end
// eslint-disable-next-line custom-rules/no-top-level-side-effects
registerCleanup(async () => {
  reportConfigCacheStats()
})
// 注册退出清理回调，在会话结束时上报缓存命中率。命中率是这份缓存设计是否有效的唯一客观指标：设计目标是启动后命中率接近 100%，若明显偏低说明有代码路径在绕过写穿、频繁触发重读。

/**
 * Migrates old autoUpdaterStatus to new installMethod and autoUpdates fields
 * @internal
 */
function migrateConfigFields(config: GlobalConfig): GlobalConfig {
  // Already migrated
  if (config.installMethod !== undefined) {
    return config
  }

  // autoUpdaterStatus is removed from the type but may exist in old configs
  const legacy = config as GlobalConfig & {
    autoUpdaterStatus?:
      | 'migrated'
      | 'installed'
      | 'disabled'
      | 'enabled'
      | 'no_permissions'
      | 'not_configured'
  }

  // Determine install method and auto-update preference from old field
  let installMethod: InstallMethod = 'unknown'
  let autoUpdates = config.autoUpdates ?? true // Default to enabled unless explicitly disabled

  switch (legacy.autoUpdaterStatus) {
    case 'migrated':
      installMethod = 'local'
      break
    case 'installed':
      installMethod = 'native'
      break
    case 'disabled':
      // When disabled, we don't know the install method
      autoUpdates = false
      break
    case 'enabled':
    case 'no_permissions':
    case 'not_configured':
      // These imply global installation
      installMethod = 'global'
      break
    case undefined:
      // No old status, keep defaults
      break
  }

  return {
    ...config,
    installMethod,
    autoUpdates,
  }
}
// `migrateConfigFields` 把已删除的 `autoUpdaterStatus` 六种旧值翻译成新的两个字段：`migrated`→本地安装、`installed`→原生安装、`disabled`→关闭自动更新、其余三种视为全局安装。幂等靠「`installMethod` 已有值就跳过」——迁移函数每次读配置都会跑，不能重复改写。

/**
 * Removes history field from projects (migrated to history.jsonl)
 * @internal
 */
function removeProjectHistory(
  projects: Record<string, ProjectConfig> | undefined,
): Record<string, ProjectConfig> | undefined {
  if (!projects) {
    return projects
  }

  const cleanedProjects: Record<string, ProjectConfig> = {}
  let needsCleaning = false

  for (const [path, projectConfig] of Object.entries(projects)) {
    // history is removed from the type but may exist in old configs
    const legacy = projectConfig as ProjectConfig & { history?: unknown }
    if (legacy.history !== undefined) {
      needsCleaning = true
      const { history, ...cleanedConfig } = legacy
      cleanedProjects[path] = cleanedConfig
    } else {
      cleanedProjects[path] = projectConfig
    }
  }

  return needsCleaning ? cleanedProjects : projects
}
// `removeProjectHistory` 有三态返回：入参为空则原样返回；没有任何项目带 `history` 则**返回同一个引用**；有脏字段才构造新对象。第二态至关重要——`saveConfigWithLock` 用「返回同一引用」判断「无变更、不必写盘」，若这里无条件新建对象，每次启动都会白写一次配置。

// fs.watchFile poll interval for detecting writes from other instances (ms)
const CONFIG_FRESHNESS_POLL_MS = 1000
let freshnessWatcherStarted = false

// fs.watchFile polls stat on the libuv threadpool and only calls us when mtime
// changed — a stalled stat never blocks the main thread.
function startGlobalConfigFreshnessWatcher(): void {
  if (freshnessWatcherStarted || process.env.NODE_ENV === 'test') return
  freshnessWatcherStarted = true
  const file = getGlobalClaudeFile()
  watchFile(
    file,
    { interval: CONFIG_FRESHNESS_POLL_MS, persistent: false },
    curr => {
      // Our own writes fire this too — the write-through's Date.now()
      // overshoot makes cache.mtime > file mtime, so we skip the re-read.
      // Bun/Node also fire with curr.mtimeMs=0 when the file doesn't exist
      // (initial callback or deletion) — the <= handles that too.
      if (curr.mtimeMs <= globalConfigCache.mtime) return
      void getFsImplementation()
        .readFile(file, { encoding: 'utf-8' })
        .then(content => {
          // A write-through may have advanced the cache while we were reading;
          // don't regress to the stale snapshot watchFile stat'd.
          if (curr.mtimeMs <= globalConfigCache.mtime) return
          const parsed = safeParseJSON(stripBOM(content))
          if (parsed === null || typeof parsed !== 'object') return
          globalConfigCache = {
            config: migrateConfigFields({
              ...createDefaultGlobalConfig(),
              ...(parsed as Partial<GlobalConfig>),
            }),
            mtime: curr.mtimeMs,
          }
          lastReadFileStats = { mtime: curr.mtimeMs, size: curr.size }
        })
        .catch(() => {})
    },
  )
  registerCleanup(async () => {
    unwatchFile(file)
    freshnessWatcherStarted = false
  })
}
// `fs.watchFile` 轮询而非 `fs.watch`：轮询的 stat 跑在 libuv 线程池，卡住的 stat 不会阻塞主线程，而 `fs.watch` 的事件回调在主线程上，跨平台行为还不一致。1 秒间隔是「别人改了配置我能尽快看到」与「不浪费 CPU」的折中。回调里两处 `mtimeMs <= cache.mtime` 判断分别挡住：自己刚写完的回声、以及读文件期间又发生的写入。

// Write-through: what we just wrote IS the new config. cache.mtime overshoots
// the file's real mtime (Date.now() is recorded after the write) so the
// freshness watcher skips re-reading our own write on its next tick.
function writeThroughGlobalConfigCache(config: GlobalConfig): void {
  globalConfigCache = { config, mtime: Date.now() }
  lastReadFileStats = null
}
// `writeThroughGlobalConfigCache` 里 `mtime` 记的是 `Date.now()` 而不是文件的真实 mtime。这是个有意的「超调」：写完立刻取当前时间，必然大于（或等于）文件系统记录的写入时间，于是上面的监视器下次 tick 时会认为「缓存比文件新」，跳过重读自己的写。用一个假的更新时间换掉一次多余的磁盘读。

export function getGlobalConfig(): GlobalConfig {
  if (process.env.NODE_ENV === 'test') {
    return TEST_GLOBAL_CONFIG_FOR_TESTING
  }

  // Fast path: pure memory read. After startup, this always hits — our own
  // writes go write-through and other instances' writes are picked up by the
  // background freshness watcher (never blocks this path).
  if (globalConfigCache.config) {
    configCacheHits++
    return globalConfigCache.config
  }

  // Slow path: startup load. Sync I/O here is acceptable because it runs
  // exactly once, before any UI is rendered. Stat before read so any race
  // self-corrects (old mtime + new content → watcher re-reads next tick).
  configCacheMisses++
  try {
    let stats: { mtimeMs: number; size: number } | null = null
    try {
      stats = getFsImplementation().statSync(getGlobalClaudeFile())
    } catch {
      // File doesn't exist
    }
    const config = migrateConfigFields(
      getConfig(getGlobalClaudeFile(), createDefaultGlobalConfig),
    )
    globalConfigCache = {
      config,
      mtime: stats?.mtimeMs ?? Date.now(),
    }
    lastReadFileStats = stats
      ? { mtime: stats.mtimeMs, size: stats.size }
      : null
    startGlobalConfigFreshnessWatcher()
    return config
  } catch {
    // If anything goes wrong, fall back to uncached behavior
    return migrateConfigFields(
      getConfig(getGlobalClaudeFile(), createDefaultGlobalConfig),
    )
  }
}
// `getGlobalConfig` 的快慢双路径：启动后永远走内存（命中就返回），启动时走一次同步 I/O（此时还没渲染 UI，阻塞无感）。慢路径刻意「先 stat 再读」——若两次之间有别人写入，拿到的是旧 mtime 配新内容，监视器下一个 tick 会自愈。任何异常都退回「不进缓存」的直读，宁可慢也不能让一次失败把进程永久钉在坏状态上。

/**
 * Returns the effective value of remoteControlAtStartup. Precedence:
 *   1. User's explicit config value (always wins — honors opt-out)
 *   2. CCR auto-connect default (ant-only build, GrowthBook-gated)
 *   3. false (Remote Control must be explicitly opted into)
 */
export function getRemoteControlAtStartup(): boolean {
  const explicit = getGlobalConfig().remoteControlAtStartup
  if (explicit !== undefined) return explicit
  if (feature('CCR_AUTO_CONNECT')) {
    if (ccrAutoConnect?.getCcrAutoConnectDefault()) return true
  }
  return false
}
// 远程控制的启动优先级：用户显式设置永远最高（尊重退出选择），其次是内部构建里 GrowthBook 控制的自动连接默认值，最后是 false——远程控制必须显式开启，不能因为某个实验分组就默认打开。

export function getCustomApiKeyStatus(
  truncatedApiKey: string,
): 'approved' | 'rejected' | 'new' {
  const config = getGlobalConfig()
  if (config.customApiKeyResponses?.approved?.includes(truncatedApiKey)) {
    return 'approved'
  }
  if (config.customApiKeyResponses?.rejected?.includes(truncatedApiKey)) {
    return 'rejected'
  }
  return 'new'
}
// 自定义 API key 的三种状态（已批准、已拒绝、新的）。注意比较的是**截断后**的 key：完整 key 不落配置，这样即使配置文件泄露也拿不到可用凭据。

function saveConfig<A extends object>(
  file: string,
  config: A,
  defaultConfig: A,
): void {
  // Ensure the directory exists before writing the config file
  const dir = dirname(file)
  const fs = getFsImplementation()
  // mkdirSync is already recursive in FsOperations implementation
  fs.mkdirSync(dir)

  // Filter out any values that match the defaults
  const filteredConfig = pickBy(
    config,
    (value, key) =>
      jsonStringify(value) !== jsonStringify(defaultConfig[key as keyof A]),
  )
  // Write config file with secure permissions - mode only applies to new files
  writeFileSyncAndFlush_DEPRECATED(
    file,
    jsonStringify(filteredConfig, null, 2),
    {
      encoding: 'utf-8',
      mode: 0o600,
    },
  )
  if (file === getGlobalClaudeFile()) {
    globalConfigWriteCount++
  }
}
// `saveConfig` 两步：先用 `jsonStringify` 逐字段与默认值比较，把等于默认值的键全部剔除（配置文件只存非默认，减小体积也便于人工阅读）；再以 `0o600` 权限写盘。注意「mode 只对新文件生效」——已存在的文件权限不会被改动，这是 Node 的既有行为，不能指望它修复过宽的旧权限。

/**
 * Returns true if a write was performed; false if the write was skipped
 * (no changes, or auth-loss guard tripped). Callers use this to decide
 * whether to invalidate the cache -- invalidating after a skipped write
 * destroys the good cached state the auth-loss guard depends on.
 */
function saveConfigWithLock<A extends object>(
  file: string,
  createDefault: () => A,
  mergeFn: (current: A) => A,
): boolean {
  const defaultConfig = createDefault()
  const dir = dirname(file)
  const fs = getFsImplementation()

  // Ensure directory exists (mkdirSync is already recursive in FsOperations)
  fs.mkdirSync(dir)

  let release
  try {
    const lockFilePath = `${file}.lock`
    const startTime = Date.now()
    release = lockfile.lockSync(file, {
      lockfilePath: lockFilePath,
      onCompromised: err => {
        // Default onCompromised throws from a setTimeout callback, which
        // becomes an unhandled exception. Log instead -- the lock being
        // stolen (e.g. after a 10s event-loop stall) is recoverable.
        logForDebugging(`Config lock compromised: ${err}`, { level: 'error' })
      },
    })
    const lockTime = Date.now() - startTime
    if (lockTime > 100) {
      logForDebugging(
        'Lock acquisition took longer than expected - another Claude instance may be running',
      )
      logEvent('tengu_config_lock_contention', {
        lock_time_ms: lockTime,
      })
    }

    // Check for stale write - file changed since we last read it
    // Only check for global config file since lastReadFileStats tracks that specific file
    if (lastReadFileStats && file === getGlobalClaudeFile()) {
      try {
        const currentStats = fs.statSync(file)
        if (
          currentStats.mtimeMs !== lastReadFileStats.mtime ||
          currentStats.size !== lastReadFileStats.size
        ) {
          logEvent('tengu_config_stale_write', {
            read_mtime: lastReadFileStats.mtime,
            write_mtime: currentStats.mtimeMs,
            read_size: lastReadFileStats.size,
            write_size: currentStats.size,
          })
        }
      } catch (e) {
        const code = getErrnoCode(e)
        if (code !== 'ENOENT') {
          throw e
        }
        // File doesn't exist yet, no stale check needed
      }
    }

    // Re-read the current config to get latest state. If the file is
    // momentarily corrupted (concurrent writes, kill-during-write), this
    // returns defaults -- we must not write those back over good config.
    const currentConfig = getConfig(file, createDefault)
    if (file === getGlobalClaudeFile() && wouldLoseAuthState(currentConfig)) {
      logForDebugging(
        'saveConfigWithLock: re-read config is missing auth that cache has; refusing to write to avoid wiping ~/.claude.json. See GH #3117.',
        { level: 'error' },
      )
      logEvent('tengu_config_auth_loss_prevented', {})
      return false
    }
// `saveConfigWithLock` 里的 auth 守卫与外面那层是同一判据，但位置更关键：这里是**已持锁、已重读**之后、真正写盘之前。返回 false 表示「没写」，而不是「写失败」——调用方据这个返回值决定是否刷新内存缓存。这里若误当成功而刷缓存，缓存里就会存进一份缺 auth 的配置，下一轮守卫反而失效。

    // Apply the merge function to get the updated config
    const mergedConfig = mergeFn(currentConfig)

    // Skip write if no changes (same reference returned)
    if (mergedConfig === currentConfig) {
      return false
    }
// `mergedConfig === currentConfig` 就返回 false，是「无变更不写盘」的唯一实现点。上游的 updater 函数必须遵守这个引用相等约定（无改动就返回入参），否则每次启动那几十个 `saveGlobalConfig` 调用都会触发一次真实的锁 + 读 + 备份 + 写。

    // Filter out any values that match the defaults
    const filteredConfig = pickBy(
      mergedConfig,
      (value, key) =>
        jsonStringify(value) !== jsonStringify(defaultConfig[key as keyof A]),
    )

    // Create timestamped backup of existing config before writing
    // We keep multiple backups to prevent data loss if a reset/corrupted config
    // overwrites a good backup. Backups are stored in ~/.claude/backups/ to
    // keep the home directory clean.
    try {
      const fileBase = basename(file)
      const backupDir = getConfigBackupDir()

      // Ensure backup directory exists
      try {
        fs.mkdirSync(backupDir)
      } catch (mkdirErr) {
        const mkdirCode = getErrnoCode(mkdirErr)
        if (mkdirCode !== 'EEXIST') {
          throw mkdirErr
        }
      }

      // Check existing backups first -- skip creating a new one if a recent
      // backup already exists. During startup, many saveGlobalConfig calls fire
      // within milliseconds of each other; without this check, each call
      // creates a new backup file that accumulates on disk.
      const MIN_BACKUP_INTERVAL_MS = 60_000
      const existingBackups = fs
        .readdirStringSync(backupDir)
        .filter(f => f.startsWith(`${fileBase}.backup.`))
        .sort()
        .reverse() // Most recent first (timestamps sort lexicographically)

      const mostRecentBackup = existingBackups[0]
      const mostRecentTimestamp = mostRecentBackup
        ? Number(mostRecentBackup.split('.backup.').pop())
        : 0
      const shouldCreateBackup =
        Number.isNaN(mostRecentTimestamp) ||
        Date.now() - mostRecentTimestamp >= MIN_BACKUP_INTERVAL_MS

      if (shouldCreateBackup) {
        const backupPath = join(backupDir, `${fileBase}.backup.${Date.now()}`)
        fs.copyFileSync(file, backupPath)
      }

      // Clean up old backups, keeping only the 5 most recent
      const MAX_BACKUPS = 5
      // Re-read if we just created one; otherwise reuse the list
      const backupsForCleanup = shouldCreateBackup
        ? fs
            .readdirStringSync(backupDir)
            .filter(f => f.startsWith(`${fileBase}.backup.`))
            .sort()
            .reverse()
        : existingBackups

      for (const oldBackup of backupsForCleanup.slice(MAX_BACKUPS)) {
        try {
          fs.unlinkSync(join(backupDir, oldBackup))
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (e) {
      const code = getErrnoCode(e)
      if (code !== 'ENOENT') {
        logForDebugging(`Failed to backup config: ${e}`, {
          level: 'error',
        })
      }
      // No file to backup or backup failed, continue with write
    }
// 备份策略两条例：① 同一分钟内只备一次（启动阶段几十次保存会在毫秒内接连发生，不节流就会堆出几十个备份文件）；② 只留最近 5 份。第二条例的意义是「即使某次重置把好备份覆盖了，往前最多退 5 个版本还能捞回来」。备份目录固定在配置主目录下，避免污染家目录。

    // Write config file with secure permissions - mode only applies to new files
    writeFileSyncAndFlush_DEPRECATED(
      file,
      jsonStringify(filteredConfig, null, 2),
      {
        encoding: 'utf-8',
        mode: 0o600,
      },
    )
    if (file === getGlobalClaudeFile()) {
      globalConfigWriteCount++
    }
    return true
  } finally {
    if (release) {
      release()
    }
  }
}
// 锁释放放在 `finally`，且用「release 是否存在」判断——拿锁本身可能抛错（另一个进程持有超时），此时 release 未赋值，直接调会二次抛错并掩盖原始错误。

// Flag to track if config reading is allowed
let configReadingAllowed = false

export function enableConfigs(): void {
  if (configReadingAllowed) {
    // Ensure this is idempotent
    return
  }

  const startTime = Date.now()
  logForDiagnosticsNoPII('info', 'enable_configs_started')

  // Any reads to configuration before this flag is set show an console warning
  // to prevent us from adding config reading during module initialization
  configReadingAllowed = true
  // We only check the global config because currently all the configs share a file
  getConfig(
    getGlobalClaudeFile(),
    createDefaultGlobalConfig,
    true /* throw on invalid */,
  )

  logForDiagnosticsNoPII('info', 'enable_configs_completed', {
    duration_ms: Date.now() - startTime,
  })
}
// `enableConfigs` 是配置读取的总开关：在此之前任何 `getConfig` 都会抛错（测试除外），目的是禁止模块初始化阶段读配置——那时目录探测、环境变量、遥测都还没就绪，读到的值可能来自错误的位置。这里用 `throwOnInvalid=true` 做一次「启动自检」：配置若损坏，宁可启动即失败并给出明确报错，也不要带着默认值跑一整个会话。

/**
 * Returns the directory where config backup files are stored.
 * Uses ~/.claude/backups/ to keep the home directory clean.
 */
function getConfigBackupDir(): string {
  return join(getClaudeConfigHomeDir(), 'backups')
}
// 备份目录从「配置文件名旁边」搬到 `~/.claude/backups/`：家目录里堆一堆 `xxx.backup.1699...` 既难看又容易被误删。`findMostRecentBackup` 里仍保留旧位置与无时间戳的 `xxx.backup` 两条回退路径，纯为兼容升级前的用户。

/**
 * Find the most recent backup file for a given config file.
 * Checks ~/.claude/backups/ first, then falls back to the legacy location
 * (next to the config file) for backwards compatibility.
 * Returns the full path to the most recent backup, or null if none exist.
 */
function findMostRecentBackup(file: string): string | null {
  const fs = getFsImplementation()
  const fileBase = basename(file)
  const backupDir = getConfigBackupDir()

  // Check the new backup directory first
  try {
    const backups = fs
      .readdirStringSync(backupDir)
      .filter(f => f.startsWith(`${fileBase}.backup.`))
      .sort()

    const mostRecent = backups.at(-1) // Timestamps sort lexicographically
    if (mostRecent) {
      return join(backupDir, mostRecent)
    }
  } catch {
    // Backup dir doesn't exist yet
  }

  // Fall back to legacy location (next to the config file)
  const fileDir = dirname(file)

  try {
    const backups = fs
      .readdirStringSync(fileDir)
      .filter(f => f.startsWith(`${fileBase}.backup.`))
      .sort()

    const mostRecent = backups.at(-1) // Timestamps sort lexicographically
    if (mostRecent) {
      return join(fileDir, mostRecent)
    }

    // Check for legacy backup file (no timestamp)
    const legacyBackup = `${file}.backup`
    try {
      fs.statSync(legacyBackup)
      return legacyBackup
    } catch {
      // Legacy backup doesn't exist
    }
  } catch {
    // Ignore errors reading directory
  }

  return null
}
// `findMostRecentBackup` 的三级查找：新备份目录（按文件名排序取最后一个——时间戳是等宽的，字典序即时间序）、旧位置（配置同目录）、以及更老的无时间戳备份。它只用于「文件不存在」与「解析失败」两种场景下的**提示**，不自动恢复——恢复要用户手动执行提示里给出的 cp 命令，因为自动挑选备份可能在多份之间选错。

function getConfig<A>(
  file: string,
  createDefault: () => A,
  throwOnInvalid?: boolean,
): A {
  // Log a warning if config is accessed before it's allowed
  if (!configReadingAllowed && process.env.NODE_ENV !== 'test') {
    throw new Error('Config accessed before allowed.')
  }
// 读取前的门禁：`configReadingAllowed` 未打开且非测试环境就抛错。这是一条开发期约束，把「模块顶层读配置」这类代码在第一次运行时就打回，而不是等它在上千个用户机器上读到空配置。

  const fs = getFsImplementation()

  try {
    const fileContent = fs.readFileSync(file, {
      encoding: 'utf-8',
    })
    try {
      // Strip BOM before parsing - PowerShell 5.x adds BOM to UTF-8 files
      const parsedConfig = jsonParse(stripBOM(fileContent))
      return {
        ...createDefault(),
        ...parsedConfig,
      }
// 解析成功后用「默认值打底 + 文件内容覆盖」合并，这是**向前兼容**的关键：旧版本读到新版本写的文件时，不认识的字段被忽略；新版本读到旧文件时，缺失字段用默认值补齐。`stripBOM` 是必需的——PowerShell 5.x 写 UTF-8 会带 BOM，JSON 解析器见到 BOM 直接报错，Windows 用户会看到「配置总是损坏」。
    } catch (error) {
      // Throw a ConfigParseError with the file path and default config
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new ConfigParseError(errorMessage, file, createDefault())
    }
// 解析失败包成 `ConfigParseError`，并把**文件路径**与**默认配置**一起带上。调用方（上层 UI）因此能展示「哪个文件坏了、回退成什么」，而不是一句笼统的解析失败——配置文件损坏是用户能自己修的问题，前提是告诉他文件在哪。
  } catch (error) {
    // Handle file not found - check for backup and return default
    const errCode = getErrnoCode(error)
    if (errCode === 'ENOENT') {
      const backupPath = findMostRecentBackup(file)
      if (backupPath) {
        process.stderr.write(
          `\nClaude configuration file not found at: ${file}\n` +
            `A backup file exists at: ${backupPath}\n` +
            `You can manually restore it by running: cp "${backupPath}" "${file}"\n\n`,
        )
      }
      return createDefault()
    }
// 文件不存在（ENOENT）时不算错误，但要主动提示最近的备份在哪、以及恢复用的完整命令。这是「配置被误删」最常见的救援路径：用户不需要知道备份命名规则，复制粘贴即可。

    // Re-throw ConfigParseError if throwOnInvalid is true
    if (error instanceof ConfigParseError && throwOnInvalid) {
      throw error
    }

    // Log config parse errors so users know what happened
    if (error instanceof ConfigParseError) {
      logForDebugging(
        `Config file corrupted, resetting to defaults: ${error.message}`,
        { level: 'error' },
      )

      // Guard: logEvent → shouldSampleEvent → getGlobalConfig → getConfig
      // causes infinite recursion when the config file is corrupted, because
      // the sampling check reads a GrowthBook feature from global config.
      // Only log analytics on the outermost call.
      if (!insideGetConfig) {
        insideGetConfig = true
        try {
          // Log the error for monitoring
          logError(error)

          // Log analytics event for config corruption
          let hasBackup = false
          try {
            fs.statSync(`${file}.backup`)
            hasBackup = true
          } catch {
            // No backup
          }
          logEvent('tengu_config_parse_error', {
            has_backup: hasBackup,
          })
        } finally {
          insideGetConfig = false
        }
      }
// 只有最外层调用才记 analytics，且用 try/finally 复位标志。里面还额外查一次旧式 `.backup` 是否存在（`has_backup` 字段），用来判断「损坏用户里有多少是有救的」——这是个产品指标，不是功能逻辑。

      process.stderr.write(
        `\nClaude configuration file at ${file} is corrupted: ${error.message}\n`,
      )

      // Try to backup the corrupted config file (only if not already backed up)
      const fileBase = basename(file)
      const corruptedBackupDir = getConfigBackupDir()

      // Ensure backup directory exists
      try {
        fs.mkdirSync(corruptedBackupDir)
      } catch (mkdirErr) {
        const mkdirCode = getErrnoCode(mkdirErr)
        if (mkdirCode !== 'EEXIST') {
          throw mkdirErr
        }
      }

      const existingCorruptedBackups = fs
        .readdirStringSync(corruptedBackupDir)
        .filter(f => f.startsWith(`${fileBase}.corrupted.`))

      let corruptedBackupPath: string | undefined
      let alreadyBackedUp = false

      // Check if current corrupted content matches any existing backup
      const currentContent = fs.readFileSync(file, { encoding: 'utf-8' })
      for (const backup of existingCorruptedBackups) {
        try {
          const backupContent = fs.readFileSync(
            join(corruptedBackupDir, backup),
            { encoding: 'utf-8' },
          )
          if (currentContent === backupContent) {
            alreadyBackedUp = true
            break
          }
        } catch {
          // Ignore read errors on backups
        }
      }

      if (!alreadyBackedUp) {
        corruptedBackupPath = join(
          corruptedBackupDir,
          `${fileBase}.corrupted.${Date.now()}`,
        )
        try {
          fs.copyFileSync(file, corruptedBackupPath)
          logForDebugging(
            `Corrupted config backed up to: ${corruptedBackupPath}`,
            {
              level: 'error',
            },
          )
        } catch {
          // Ignore backup errors
        }
      }

      // Notify user about corrupted config and available backup
      const backupPath = findMostRecentBackup(file)
      if (corruptedBackupPath) {
        process.stderr.write(
          `The corrupted file has been backed up to: ${corruptedBackupPath}\n`,
        )
      } else if (alreadyBackedUp) {
        process.stderr.write(`The corrupted file has already been backed up.\n`)
      }

      if (backupPath) {
        process.stderr.write(
          `A backup file exists at: ${backupPath}\n` +
            `You can manually restore it by running: cp "${backupPath}" "${file}"\n\n`,
        )
      } else {
        process.stderr.write(`\n`)
      }
    }

    return createDefault()
  }
}
// `getConfig` 收尾：除 `throwOnInvalid` 场景外，任何异常都以默认配置返回，绝不把错误抛给调用方。这样一条坏配置不会让整个应用起不来；代价是「静默降级」——所以上面配套了 stderr 提示、损坏文件备份、 analytics 三件套，让降级可被用户与团队看见。

// Memoized function to get the project path for config lookup
export const getProjectPathForConfig = memoize((): string => {
  const originalCwd = getOriginalCwd()
  const gitRoot = findCanonicalGitRoot(originalCwd)

  if (gitRoot) {
    // Normalize for consistent JSON keys (forward slashes on all platforms)
    // This ensures paths like C:\Users\... and C:/Users/... map to the same key
    return normalizePathForConfigKey(gitRoot)
  }

  // Not in a git repo
  return normalizePathForConfigKey(resolve(originalCwd))
})
// `getProjectPathForConfig` 被 memoize：它要探测 git 根（会走文件系统），而项目配置的读取频率很高，每次探测都是浪费。归一化把两种路径分隔符统一成正斜杠，否则同一个目录在 Windows 上会因写法不同被存成两个键，表现为「信任状态时有时无」。memoize 也意味着会话中切换 cwd 不会改变项目路径——这正是想要的行为，配置归属应在启动时确定。

export function getCurrentProjectConfig(): ProjectConfig {
  if (process.env.NODE_ENV === 'test') {
    return TEST_PROJECT_CONFIG_FOR_TESTING
  }

  const absolutePath = getProjectPathForConfig()
  const config = getGlobalConfig()

  if (!config.projects) {
    return DEFAULT_PROJECT_CONFIG
  }

  const projectConfig = config.projects[absolutePath] ?? DEFAULT_PROJECT_CONFIG
  // Not sure how this became a string
  // TODO: Fix upstream
  if (typeof projectConfig.allowedTools === 'string') {
    projectConfig.allowedTools =
      (safeParseJSON(projectConfig.allowedTools) as string[]) ?? []
  }

  return projectConfig
}
// 这里修一段历史脏数据：`allowedTools` 曾经被误写成字符串（JSON 序列化后的数组），读到就就地解析回数组。`?? DEFAULT_PROJECT_CONFIG` 的兜底会让未知项目共享同一个默认对象，见文件开头那条注释——调用方若改它就会污染全局。

export function saveCurrentProjectConfig(
  updater: (currentConfig: ProjectConfig) => ProjectConfig,
): void {
  if (process.env.NODE_ENV === 'test') {
    const config = updater(TEST_PROJECT_CONFIG_FOR_TESTING)
    // Skip if no changes (same reference returned)
    if (config === TEST_PROJECT_CONFIG_FOR_TESTING) {
      return
    }
    Object.assign(TEST_PROJECT_CONFIG_FOR_TESTING, config)
    return
  }
  const absolutePath = getProjectPathForConfig()

  let written: GlobalConfig | null = null
  try {
    const didWrite = saveConfigWithLock(
      getGlobalClaudeFile(),
      createDefaultGlobalConfig,
      current => {
        const currentProjectConfig =
          current.projects?.[absolutePath] ?? DEFAULT_PROJECT_CONFIG
        const newProjectConfig = updater(currentProjectConfig)
        // Skip if no changes (same reference returned)
        if (newProjectConfig === currentProjectConfig) {
          return current
        }
        written = {
          ...current,
          projects: {
            ...current.projects,
            [absolutePath]: newProjectConfig,
          },
        }
        return written
      },
    )
    if (didWrite && written) {
      writeThroughGlobalConfigCache(written)
    }
  } catch (error) {
    logForDebugging(`Failed to save config with lock: ${error}`, {
      level: 'error',
    })

    // Same race window as saveGlobalConfig's fallback -- refuse to write
    // defaults over good cached config. See GH #3117.
    const config = getConfig(getGlobalClaudeFile(), createDefaultGlobalConfig)
    if (wouldLoseAuthState(config)) {
      logForDebugging(
        'saveCurrentProjectConfig fallback: re-read config is missing auth that cache has; refusing to write. See GH #3117.',
        { level: 'error' },
      )
      logEvent('tengu_config_auth_loss_prevented', {})
      return
    }
    const currentProjectConfig =
      config.projects?.[absolutePath] ?? DEFAULT_PROJECT_CONFIG
    const newProjectConfig = updater(currentProjectConfig)
    // Skip if no changes (same reference returned)
    if (newProjectConfig === currentProjectConfig) {
      return
    }
    written = {
      ...config,
      projects: {
        ...config.projects,
        [absolutePath]: newProjectConfig,
      },
    }
    saveConfig(getGlobalClaudeFile(), written, DEFAULT_GLOBAL_CONFIG)
    writeThroughGlobalConfigCache(written)
  }
}
// `saveCurrentProjectConfig` 与 `saveGlobalConfig` 结构完全同构：带锁合并、只在真写时刷缓存、兜底路径重复 auth 守卫。差别只在 updater 作用于 `projects[路径]` 这一层。两处守卫必须同时存在——任何一处省略，用户都可能在「另一个终端正在写配置」的窗口里掉登录。

export function isAutoUpdaterDisabled(): boolean {
  return getAutoUpdaterDisabledReason() !== null
}

/**
 * Returns true if plugin autoupdate should be skipped.
 * This checks if the auto-updater is disabled AND the FORCE_AUTOUPDATE_PLUGINS
 * env var is not set to 'true'. The env var allows forcing plugin autoupdate
 * even when the auto-updater is otherwise disabled.
 */
export function shouldSkipPluginAutoupdate(): boolean {
  return (
    isAutoUpdaterDisabled() &&
    !isEnvTruthy(process.env.FORCE_AUTOUPDATE_PLUGINS)
  )
}
// 跳过插件自动更新的条件是两个「与」：自动更新被禁用，且没有用环境变量强制打开。环境变量这条例外的用途是 CI 或企业镜像里「CLI 本体不自动更新，但插件要跟最新」的组合。

export type AutoUpdaterDisabledReason =
  | { type: 'development' }
  | { type: 'env'; envVar: string }
  | { type: 'config' }

export function formatAutoUpdaterDisabledReason(
  reason: AutoUpdaterDisabledReason,
): string {
  switch (reason.type) {
    case 'development':
      return 'development build'
    case 'env':
      return `${reason.envVar} set`
    case 'config':
      return 'config'
  }
}
// 原因对象转人话：开发构建、环境变量（带变量名）、用户配置。带变量名很实用——用户看到「DISABLE_AUTOUPDATER set」就知道该去查哪个环境。

export function getAutoUpdaterDisabledReason(): AutoUpdaterDisabledReason | null {
  if (process.env.NODE_ENV === 'development') {
    return { type: 'development' }
  }
  if (isEnvTruthy(process.env.DISABLE_AUTOUPDATER)) {
    return { type: 'env', envVar: 'DISABLE_AUTOUPDATER' }
  }
  const essentialTrafficEnvVar = getEssentialTrafficOnlyReason()
  if (essentialTrafficEnvVar) {
    return { type: 'env', envVar: essentialTrafficEnvVar }
  }
  const config = getGlobalConfig()
  if (
    config.autoUpdates === false &&
    (config.installMethod !== 'native' ||
      config.autoUpdatesProtectedForNative !== true)
  ) {
    return { type: 'config' }
  }
  return null
}
// 四级判定顺序即优先级：开发构建 → `DISABLE_AUTOUPDATER` → 隐私级别要求只走必要流量（企业策略可能禁止更新检查）→ 用户配置关闭。最后一档有个例外：原生安装且显式标记「已为原生保护」时不视为禁用，因为原生安装的自动更新由系统安装器负责，关掉 CLI 内的更新器并不等于不要更新。

export function getOrCreateUserID(): string {
  const config = getGlobalConfig()
  if (config.userID) {
    return config.userID
  }

  const userID = randomBytes(32).toString('hex')
  saveGlobalConfig(current => ({ ...current, userID }))
  return userID
}
// 用户 ID 用 32 字节随机数的十六进制串，首次使用时生成并落盘。32 字节远超一般需要，取的是「永不需要考虑碰撞」。生成后立即持久化——每次启动都换 ID 会让所有以 ID 为键的本地缓存与遥测连续性断掉。

export function recordFirstStartTime(): void {
  const config = getGlobalConfig()
  if (!config.firstStartTime) {
    const firstStartTime = new Date().toISOString()
    saveGlobalConfig(current => ({
      ...current,
      firstStartTime: current.firstStartTime ?? firstStartTime,
    }))
  }
}
// 记录首次启动时间，用「取现有值否则取当前」的写法保证并发下也只写一次：两个进程同时首次启动时，后写的那次会因为 `current.firstStartTime` 已有值而不覆盖。

export function getMemoryPath(memoryType: MemoryType): string {
  const cwd = getOriginalCwd()

  switch (memoryType) {
    case 'User':
      return join(getClaudeConfigHomeDir(), 'CLAUDE.md')
    case 'Local':
      return join(cwd, 'CLAUDE.local.md')
    case 'Project':
      return join(cwd, 'CLAUDE.md')
    case 'Managed':
      return join(getManagedFilePath(), 'CLAUDE.md')
    case 'AutoMem':
      return getAutoMemEntrypoint()
  }
  // TeamMem is only a valid MemoryType when feature('TEAMMEM') is true
  if (feature('TEAMMEM')) {
    return teamMemPaths!.getTeamMemEntrypoint()
  }
  return '' // unreachable in external builds where TeamMem is not in MemoryType
}
// 记忆文件路径按类型分派：用户级在配置主目录、项目级在工作目录、本地级（不入版本控制）也在工作目录但用 `.local` 后缀、托管级在企业管理的固定路径。`AutoMem` 走单独的入口点，`TeamMem` 只在特性开关打开时才存在——所以类型联合里它是有条件的成员，这里的 `!` 断言与末尾的空串返回就是那层条件的代价。

export function getManagedClaudeRulesDir(): string {
  return join(getManagedFilePath(), '.claude', 'rules')
}

export function getUserClaudeRulesDir(): string {
  return join(getClaudeConfigHomeDir(), 'rules')
}
// 规则目录两处：企业托管路径下的 `rules`（管理员下发，用户不可改）、用户配置主目录下的 `rules`（用户自建）。两者在加载时都会读，冲突时托管优先——这是企业策略的基本方向。

// Exported for testing only
export const _getConfigForTesting = getConfig
export const _wouldLoseAuthStateForTesting = wouldLoseAuthState
export function _setGlobalConfigCacheForTesting(
  config: GlobalConfig | null,
): void {
  globalConfigCache.config = config
  globalConfigCache.mtime = config ? Date.now() : 0
}
// 测试专用导出的三个口子：直接拿 `getConfig`、直接调 auth 丢失判据、直接注入全局缓存。生产代码不得引用（名字前缀 `_` 是约定）；它们存在的原因是 Jest 无法 mock ES 模块副作用，只能把内部函数暴露出来给测试注入状态。
