import chalk from 'chalk'
import { logForDebugging } from 'src/utils/debug.js'
import { fileHistoryEnabled } from 'src/utils/fileHistory.js'
import {
  getInitialSettings,
  getSettings_DEPRECATED,
  getSettingsForSource,
} from 'src/utils/settings/settings.js'
import { shouldOfferTerminalSetup } from '../../commands/terminalSetup/terminalSetup.js'
import { getDesktopUpsellConfig } from '../../components/DesktopUpsell/DesktopUpsellStartup.js'
import { color } from '../../components/design-system/color.js'
import { shouldShowOverageCreditUpsell } from '../../components/LogoV2/OverageCreditUpsell.js'
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js'
import { isKairosCronEnabled } from '../../tools/ScheduleCronTool/prompt.js'
import { is1PApiCustomer } from '../../utils/auth.js'
import { countConcurrentSessions } from '../../utils/concurrentSessions.js'
import { getGlobalConfig } from '../../utils/config.js'
import {
  getEffortEnvOverride,
  modelSupportsEffort,
} from '../../utils/effort.js'
import { env } from '../../utils/env.js'
import { cacheKeys } from '../../utils/fileStateCache.js'
import { getWorktreeCount } from '../../utils/git.js'
import {
  detectRunningIDEsCached,
  getSortedIdeLockfiles,
  isCursorInstalled,
  isSupportedTerminal,
  isSupportedVSCodeTerminal,
  isVSCodeInstalled,
  isWindsurfInstalled,
} from '../../utils/ide.js'
import {
  getMainLoopModel,
  getUserSpecifiedModelSetting,
} from '../../utils/model/model.js'
import { getPlatform } from '../../utils/platform.js'
import { isPluginInstalled } from '../../utils/plugins/installedPluginsManager.js'
import { loadKnownMarketplacesConfigSafe } from '../../utils/plugins/marketplaceManager.js'
import { OFFICIAL_MARKETPLACE_NAME } from '../../utils/plugins/officialMarketplace.js'
import {
  getCurrentSessionAgentColor,
  isCustomTitleEnabled,
} from '../../utils/sessionStorage.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  formatGrantAmount,
  getCachedOverageCreditGrant,
} from '../api/overageCreditGrant.js'
import {
  checkCachedPassesEligibility,
  formatCreditAmount,
  getCachedReferrerReward,
} from '../api/referral.js'
import { getSessionsSinceLastShown } from './tipHistory.js'
import type { Tip, TipContext } from './types.js'

let _isOfficialMarketplaceInstalledCache: boolean | undefined
// 模块级一次性缓存：官方市场是否已装只需要问一次（loadKnownMarketplacesConfigSafe 会读盘），之后所有 tip 的相关性判定都直接命中。注意它没有失效机制——本进程生命周期内装/卸市场不会刷新，这是有意的：tip 只是启动轮播文案，不值得为它做缓存失效。
async function isOfficialMarketplaceInstalled(): Promise<boolean> {
  if (_isOfficialMarketplaceInstalledCache !== undefined) {
    return _isOfficialMarketplaceInstalledCache
  }
  const config = await loadKnownMarketplacesConfigSafe()
  _isOfficialMarketplaceInstalledCache = OFFICIAL_MARKETPLACE_NAME in config
  return _isOfficialMarketplaceInstalledCache
}

async function isMarketplacePluginRelevant(
// 「官方市场里的插件推荐」相关性判定，三个条件全满足才推荐：① 官方市场已装；② 目标插件还没装（装了还推荐就是骚扰）；③ 用户上下文里出现过对应信号——要么 bash 历史里有 cli 命令（如 vercel），要么读过的文件路径匹配正则（如 .html/.css）。文件路径信号从 readFileState 缓存键里取，不重新扫盘。
  pluginName: string,
  context: TipContext | undefined,
  signals: { filePath?: RegExp; cli?: string[] },
): Promise<boolean> {
  if (!(await isOfficialMarketplaceInstalled())) {
    return false
  }
  if (isPluginInstalled(`${pluginName}@${OFFICIAL_MARKETPLACE_NAME}`)) {
    return false
  }
  const { bashTools } = context ?? {}
  if (signals.cli && bashTools?.size) {
    if (signals.cli.some(cmd => bashTools.has(cmd))) {
      return true
    }
  }
  if (signals.filePath && context?.readFileState) {
    const readFiles = cacheKeys(context.readFileState)
    if (readFiles.some(fp => signals.filePath!.test(fp))) {
      return true
    }
  }
  return false
}

const externalTips: Tip[] = [
// externalTips：面向所有用户的内置 tip 清单（共 43 条）。每条统一四个字段：id（遥测与冷却账本的键）、content（异步取文案——有些要按平台/终端拼字符串，甚至要拿主题色）、cooldownSessions（冷却几个启动周期，数字越大越懒）、isRelevant（异步相关性判定，可 spawn 探测）。文案全部异步是因为部分判定要 fork 子进程（如 IDE 检测），不能阻塞启动。
  {
    id: 'new-user-warmup',
    content: async () =>
      `Start with small features or bug fixes, tell Claude to propose a plan, and verify its suggested edits`,
    cooldownSessions: 3,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups < 10
    },
  },
  {
    id: 'plan-mode-for-complex-tasks',
    content: async () =>
      `Use Plan Mode to prepare for a complex request before making changes. Press ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} twice to enable.`,
    cooldownSessions: 5,
    isRelevant: async () => {
      if (process.env.USER_TYPE === 'ant') return false
      const config = getGlobalConfig()
      // Show to users who haven't used plan mode recently (7+ days)
      const daysSinceLastUse = config.lastPlanModeUse
        ? (Date.now() - config.lastPlanModeUse) / (1000 * 60 * 60 * 24)
        : Infinity
      return daysSinceLastUse > 7
    },
  },
  {
    id: 'default-permission-mode-config',
    content: async () =>
      `Use /config to change your default permission mode (including Plan Mode)`,
    cooldownSessions: 10,
    isRelevant: async () => {
      try {
        const config = getGlobalConfig()
        const settings = getSettings_DEPRECATED()
        // Show if they've used plan mode but haven't set a default
        const hasUsedPlanMode = Boolean(config.lastPlanModeUse)
        const hasDefaultMode = Boolean(settings?.permissions?.defaultMode)
        return hasUsedPlanMode && !hasDefaultMode
      } catch (error) {
        logForDebugging(
          `Failed to check default-permission-mode-config tip relevance: ${error}`,
          { level: 'warn' },
        )
        return false
      }
    },
// ① 新手引导组（L96-141）：按启动次数与功能使用情况逐步解锁——10 次启动内推 warmup、7 天没用 plan mode 才推 plan-mode、用过 plan mode 但没设默认模式才推 /config。isRelevant 失败一律 return false 并 logForDebugging：提示语是锦上添花，判定出错时安静闭嘴比报错强。
  },
  {
    id: 'git-worktrees',
    content: async () =>
      'Use git worktrees to run multiple Claude sessions in parallel.',
    cooldownSessions: 10,
    isRelevant: async () => {
      try {
        const config = getGlobalConfig()
        const worktreeCount = await getWorktreeCount()
        return worktreeCount <= 1 && config.numStartups > 50
      } catch (_) {
        return false
      }
    },
  },
  {
    id: 'color-when-multi-clauding',
    content: async () =>
      'Running multiple Claude sessions? Use /color and /rename to tell them apart at a glance.',
    cooldownSessions: 10,
    isRelevant: async () => {
      if (getCurrentSessionAgentColor()) return false
      const count = await countConcurrentSessions()
      return count >= 2
    },
  },
// ② 并行工作流组（L143-168）：git-worktrees 推给 50 次启动以上、worktree 数 ≤1 的老用户（真有多个 worktree 的人不需要被提醒）；color-when-multi-clauding 在检测到 ≥2 个并发 session 且当前 session 没设颜色时触发——靠 countConcurrentSessions() 探活，不是猜。
  {
    id: 'terminal-setup',
    content: async () =>
      env.terminal === 'Apple_Terminal'
        ? 'Run /terminal-setup to enable convenient terminal integration like Option + Enter for new line and more'
        : 'Run /terminal-setup to enable convenient terminal integration like Shift + Enter for new line and more',
    cooldownSessions: 10,
    async isRelevant() {
      const config = getGlobalConfig()
      if (env.terminal === 'Apple_Terminal') {
        return !config.optionAsMetaKeyInstalled
      }
      return !config.shiftEnterKeyBindingInstalled
    },
  },
  {
    id: 'shift-enter',
    content: async () =>
      env.terminal === 'Apple_Terminal'
        ? 'Press Option+Enter to send a multi-line message'
        : 'Press Shift+Enter to send a multi-line message',
    cooldownSessions: 10,
    async isRelevant() {
      const config = getGlobalConfig()
      return Boolean(
        (env.terminal === 'Apple_Terminal'
          ? config.optionAsMetaKeyInstalled
          : config.shiftEnterKeyBindingInstalled) && config.numStartups > 3,
      )
    },
  },
  {
    id: 'shift-enter-setup',
    content: async () =>
      env.terminal === 'Apple_Terminal'
        ? 'Run /terminal-setup to enable Option+Enter for new lines'
        : 'Run /terminal-setup to enable Shift+Enter for new lines',
    cooldownSessions: 10,
    async isRelevant() {
      if (!shouldOfferTerminalSetup()) {
        return false
      }
      const config = getGlobalConfig()
      return !(env.terminal === 'Apple_Terminal'
        ? config.optionAsMetaKeyInstalled
        : config.shiftEnterKeyBindingInstalled)
    },
  },
// ③ 终端与快捷键组（L170-216）：这四条是同一功能的不同阶段——没装 shift+enter 绑定就劝装（terminal-setup / shift-enter-setup），装了且启动 >3 次就教怎么用（shift-enter）。Apple_Terminal 是特例：它用 Option+Enter 而非 Shift+Enter，文案跟着 env.terminal 分支。
  {
    id: 'memory-command',
    content: async () => 'Use /memory to view and manage Claude memory',
    cooldownSessions: 15,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.memoryUsageCount <= 0
    },
  },
  {
    id: 'theme-command',
    content: async () => 'Use /theme to change the color theme',
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'colorterm-truecolor',
    content: async () =>
      'Try setting environment variable COLORTERM=truecolor for richer colors',
    cooldownSessions: 30,
    isRelevant: async () => !process.env.COLORTERM && chalk.level < 3,
  },
  {
    id: 'powershell-tool-env',
    content: async () =>
      'Set CLAUDE_CODE_USE_POWERSHELL_TOOL=1 to enable the PowerShell tool (preview)',
    cooldownSessions: 10,
    isRelevant: async () =>
      getPlatform() === 'windows' &&
      process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL === undefined,
  },
  {
    id: 'status-line',
    content: async () =>
      'Use /statusline to set up a custom status line that will display beneath the input box',
    cooldownSessions: 25,
    isRelevant: async () => getSettings_DEPRECATED().statusLine === undefined,
  },
// ④ 命令速览组（L218-254）：memory / theme / statusline 等斜杠命令的一次性科普。冷却随「重要性反比」——memory 15、theme 20、statusline 25：越可能自己发现的命令推得越少。statusline 判据是 settings.statusLine 尚未配置（DEPRECATED 读取器，历史遗留但仍是真相源）。
  {
    id: 'prompt-queue',
    content: async () =>
      'Hit Enter to queue up additional messages while Claude is working.',
    cooldownSessions: 5,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.promptQueueUseCount <= 3
    },
  },
  {
    id: 'enter-to-steer-in-relatime',
    content: async () =>
      'Send messages to Claude while it works to steer Claude in real-time',
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'todo-list',
    content: async () =>
      'Ask Claude to create a todo list when working on complex tasks to track progress and remain on track',
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
// ⑤ 实时交互组（L256-278）：prompt-queue 与 enter-to-steer 推给用得还不熟的玩家（promptQueueUseCount ≤3）；todo-list 与 steer 是常驻文案（isRelevant 恒 true，只靠 cooldownSessions 20 控频）。
  {
    id: 'vscode-command-install',
    content: async () =>
      `Open the Command Palette (Cmd+Shift+P) and run "Shell Command: Install '${env.terminal === 'vscode' ? 'code' : env.terminal}' command in PATH" to enable IDE integration`,
    cooldownSessions: 0,
    async isRelevant() {
      // Only show this tip if we're in a VS Code-style terminal
      if (!isSupportedVSCodeTerminal()) {
        return false
      }
      if (getPlatform() !== 'macos') {
        return false
      }

      // Check if the relevant command is available
      switch (env.terminal) {
        case 'vscode':
          return !(await isVSCodeInstalled())
        case 'cursor':
          return !(await isCursorInstalled())
        case 'windsurf':
          return !(await isWindsurfInstalled())
        default:
          return false
      }
    },
  },
  {
    id: 'ide-upsell-external-terminal',
    content: async () => 'Connect Claude to your IDE · /ide',
    cooldownSessions: 4,
    async isRelevant() {
      if (isSupportedTerminal()) {
        return false
      }

      // Use lockfiles as a (quicker) signal for running IDEs
      const lockfiles = await getSortedIdeLockfiles()
      if (lockfiles.length !== 0) {
        return false
      }

      const runningIDEs = await detectRunningIDEsCached()
      return runningIDEs.length > 0
    },
  },
// ⑥ IDE 集成组（L280-324）：vscode-command-install 只对 VS Code 系终端的 macOS 用户展示，且按 env.terminal 分别探测 vscode/cursor/windsurf 的 shell command 是否已在 PATH；ide-upsell 反过来——不在受支持终端里、没 lockfile、但探到有 IDE 在跑时才推 /ide。两个方向互补：装了的教命令，没连上的劝连接。
  {
    id: 'install-github-app',
    content: async () =>
      'Run /install-github-app to tag @claude right from your Github issues and PRs',
    cooldownSessions: 10,
    isRelevant: async () => !getGlobalConfig().githubActionSetupCount,
  },
  {
    id: 'install-slack-app',
    content: async () => 'Run /install-slack-app to use Claude in Slack',
    cooldownSessions: 10,
    isRelevant: async () => !getGlobalConfig().slackAppInstallCount,
  },
// ⑦ 第三方集成组（L326-337）：GitHub / Slack 应用各推一次，判据是安装计数为 0（getGlobalConfig 的 githubActionSetupCount / slackAppInstallCount）。
  {
    id: 'permissions',
    content: async () =>
      'Use /permissions to pre-approve and pre-deny bash, edit, and MCP tools',
    cooldownSessions: 10,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups > 10
    },
  },
  {
    id: 'drag-and-drop-images',
    content: async () =>
      'Did you know you can drag and drop image files into your terminal?',
    cooldownSessions: 10,
    isRelevant: async () => !env.isSSH(),
  },
  {
    id: 'paste-images-mac',
    content: async () =>
      'Paste images into Claude Code using control+v (not cmd+v!)',
    cooldownSessions: 10,
    isRelevant: async () => getPlatform() === 'macos',
  },
  {
    id: 'double-esc',
    content: async () =>
      'Double-tap esc to rewind the conversation to a previous point in time',
    cooldownSessions: 10,
    isRelevant: async () => !fileHistoryEnabled(),
  },
  {
    id: 'double-esc-code-restore',
    content: async () =>
      'Double-tap esc to rewind the code and/or conversation to a previous point in time',
    cooldownSessions: 10,
    isRelevant: async () => fileHistoryEnabled(),
  },
// ⑧ 权限与图片组（L339-375）：permissions 推给 10 次启动以上的用户（新手先熟悉默认模式）；图片相关三条按平台分流——拖拽文件排除 SSH（没有本地文件系统可拖），control+v 粘贴只对 macOS（其他平台的键位不同）。double-esc 按 fileHistoryEnabled() 分两条文案：开了代码回档就提「rewind the code」，没开只提对话。
  {
    id: 'continue',
    content: async () =>
      'Run claude --continue or claude --resume to resume a conversation',
    cooldownSessions: 10,
    isRelevant: async () => true,
  },
  {
    id: 'rename-conversation',
    content: async () =>
      'Name your conversations with /rename to find them easily in /resume later',
    cooldownSessions: 15,
    isRelevant: async () =>
      isCustomTitleEnabled() && getGlobalConfig().numStartups > 10,
  },
  {
    id: 'custom-commands',
    content: async () =>
      'Create skills by adding .md files to .claude/skills/ in your project or ~/.claude/skills/ for skills that work in any project',
    cooldownSessions: 15,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups > 10
    },
  },
  {
    id: 'shift-tab',
    content: async () =>
      process.env.USER_TYPE === 'ant'
        ? `Hit ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} to cycle between default mode and auto mode`
        : `Hit ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} to cycle between default mode, auto-accept edit mode, and plan mode`,
    cooldownSessions: 10,
    isRelevant: async () => true,
  },
  {
    id: 'image-paste',
    content: async () =>
      `Use ${getShortcutDisplay('chat:imagePaste', 'Chat', 'ctrl+v')} to paste images from your clipboard`,
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'custom-agents',
    content: async () =>
      'Use /agents to optimize specific tasks. Eg. Software Architect, Code Writer, Code Reviewer',
    cooldownSessions: 15,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups > 5
    },
  },
  {
    id: 'agent-flag',
    content: async () =>
      'Use --agent <agent_name> to directly start a conversation with a subagent',
    cooldownSessions: 15,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups > 5
    },
  },
// ⑨ 会话管理与扩展组（L377-436）：--continue/--resume、/rename、.claude/skills 自定义命令、/agents 子代理、--agent flag。共同点是 cooldownSessions 15 + 启动次数门槛 5-10——都是「用了一段时间后才会想看」的功能。shift-tab 的文案按 USER_TYPE 分支：内部员工只说 default/auto 两态，外部用户说完整三态。
  {
    id: 'desktop-app',
    content: async () =>
      'Run Claude Code locally or remotely using the Claude desktop app: clau.de/desktop',
    cooldownSessions: 15,
    isRelevant: async () => getPlatform() !== 'linux',
  },
  {
    id: 'desktop-shortcut',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      return `Continue your session in Claude Code Desktop with ${blue('/desktop')}`
    },
    cooldownSessions: 15,
    isRelevant: async () => {
      if (!getDesktopUpsellConfig().enable_shortcut_tip) return false
      return (
        process.platform === 'darwin' ||
        (process.platform === 'win32' && process.arch === 'x64')
      )
    },
  },
  {
    id: 'web-app',
    content: async () =>
      'Run tasks in the cloud while you keep coding locally · clau.de/web',
    cooldownSessions: 15,
    isRelevant: async () => true,
  },
  {
    id: 'mobile-app',
    content: async () =>
      '/mobile to use Claude Code from the Claude app on your phone',
    cooldownSessions: 15,
    isRelevant: async () => true,
  },
// ⑩ 多端应用组（L438-472）：桌面 / 网页 / 手机端的拉新。desktop-shortcut 最讲究——要同时满足 GrowthBook 开关 enable_shortcut_tip 开着、平台是 mac 或 x64 Windows，且文案用 color('suggestion', ctx.theme) 着色后内嵌 /desktop 命令（唯一拿到 TipContext 的 tip，因为要按当前主题取色）。
  {
    id: 'opusplan-mode-reminder',
    content: async () =>
      `Your default model setting is Opus Plan Mode. Press ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} twice to activate Plan Mode and plan with Claude Opus.`,
    cooldownSessions: 2,
    async isRelevant() {
      if (process.env.USER_TYPE === 'ant') return false
      const config = getGlobalConfig()
      const modelSetting = getUserSpecifiedModelSetting()
      const hasOpusPlanMode = modelSetting === 'opusplan'
      // Show reminder if they have Opus Plan Mode and haven't used plan mode recently (3+ days)
      const daysSinceLastUse = config.lastPlanModeUse
        ? (Date.now() - config.lastPlanModeUse) / (1000 * 60 * 60 * 24)
        : Infinity
      return hasOpusPlanMode && daysSinceLastUse > 3
    },
  },
  {
    id: 'frontend-design-plugin',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      return `Working with HTML/CSS? Install the frontend-design plugin:\n${blue(`/plugin install frontend-design@${OFFICIAL_MARKETPLACE_NAME}`)}`
    },
    cooldownSessions: 3,
    isRelevant: async context =>
      isMarketplacePluginRelevant('frontend-design', context, {
        filePath: /\.(html|css|htm)$/i,
      }),
  },
  {
    id: 'vercel-plugin',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      return `Working with Vercel? Install the vercel plugin:\n${blue(`/plugin install vercel@${OFFICIAL_MARKETPLACE_NAME}`)}`
    },
    cooldownSessions: 3,
    isRelevant: async context =>
      isMarketplacePluginRelevant('vercel', context, {
        filePath: /(?:^|[/\\])vercel\.json$/i,
        cli: ['vercel'],
      }),
  },
// ⑪ 上下文感知的插件推荐（L474-514）：opusplan-mode-reminder 推给模型设为 opusplan 且 3 天没用 plan mode 的用户；frontend-design / vercel 两条走 isMarketplacePluginRelevant——用户读过 .html/.css 文件或 bash 里有 vercel 命令时才出现，文案里的安装命令同样按主题着色。
  {
    id: 'effort-high-nudge',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      const cmd = blue('/effort high')
      const variant = getFeatureValue_CACHED_MAY_BE_STALE<
        'off' | 'copy_a' | 'copy_b'
      >('tengu_tide_elm', 'off')
      return variant === 'copy_b'
        ? `Use ${cmd} for better one-shot answers. Claude thinks it through first.`
        : `Working on something tricky? ${cmd} gives better first answers`
    },
    cooldownSessions: 3,
    isRelevant: async () => {
      if (!is1PApiCustomer()) return false
      if (!modelSupportsEffort(getMainLoopModel())) return false
      if (getSettingsForSource('policySettings')?.effortLevel !== undefined) {
        return false
      }
      if (getEffortEnvOverride() !== undefined) return false
      const persisted = getInitialSettings().effortLevel
      if (persisted === 'high' || persisted === 'max') return false
      return (
        getFeatureValue_CACHED_MAY_BE_STALE<'off' | 'copy_a' | 'copy_b'>(
          'tengu_tide_elm',
          'off',
        ) !== 'off'
      )
    },
  },
  {
    id: 'subagent-fanout-nudge',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      const variant = getFeatureValue_CACHED_MAY_BE_STALE<
        'off' | 'copy_a' | 'copy_b'
      >('tengu_tern_alloy', 'off')
      return variant === 'copy_b'
        ? `For big tasks, tell Claude to ${blue('use subagents')}. They work in parallel and keep your main thread clean.`
        : `Say ${blue('"fan out subagents"')} and Claude sends a team. Each one digs deep so nothing gets missed.`
    },
    cooldownSessions: 3,
    isRelevant: async () => {
      if (!is1PApiCustomer()) return false
      return (
        getFeatureValue_CACHED_MAY_BE_STALE<'off' | 'copy_a' | 'copy_b'>(
          'tengu_tern_alloy',
          'off',
        ) !== 'off'
      )
    },
  },
  {
    id: 'loop-command-nudge',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      const variant = getFeatureValue_CACHED_MAY_BE_STALE<
        'off' | 'copy_a' | 'copy_b'
      >('tengu_timber_lark', 'off')
      return variant === 'copy_b'
        ? `Use ${blue('/loop 5m check the deploy')} to run any prompt on a schedule. Set it and forget it.`
        : `${blue('/loop')} runs any prompt on a recurring schedule. Great for monitoring deploys, babysitting PRs, or polling status.`
    },
    cooldownSessions: 3,
    isRelevant: async () => {
      if (!is1PApiCustomer()) return false
      if (!isKairosCronEnabled()) return false
      return (
        getFeatureValue_CACHED_MAY_BE_STALE<'off' | 'copy_a' | 'copy_b'>(
          'tengu_timber_lark',
          'off',
        ) !== 'off'
      )
    },
  },
// ⑫ GrowthBook 实验组（L516-589）：effort-high-nudge / subagent-fanout-nudge / loop-command-nudge 三条结构完全一致——先两道硬闸（is1PApiCustomer 只给 1P API 客户；model/设置/env 决定功能是否可用），最后 getFeatureValue_CACHED_MAY_BE_STALE 取 off/copy_a/copy_b 三档：off 不显示，copy_b 用另一版文案（B 组实验）。文案是异步取的，实验开关切换后下次启动即生效，不需要重启缓存。
  {
    id: 'guest-passes',
    content: async ctx => {
      const claude = color('claude', ctx.theme)
      const reward = getCachedReferrerReward()
      return reward
        ? `Share Claude Code and earn ${claude(formatCreditAmount(reward))} of extra usage · ${claude('/passes')}`
        : `You have free guest passes to share · ${claude('/passes')}`
    },
    cooldownSessions: 3,
    isRelevant: async () => {
      const config = getGlobalConfig()
      if (config.hasVisitedPasses) {
        return false
      }
      const { eligible } = checkCachedPassesEligibility()
      return eligible
    },
  },
  {
    id: 'overage-credit',
    content: async ctx => {
      const claude = color('claude', ctx.theme)
      const info = getCachedOverageCreditGrant()
      const amount = info ? formatGrantAmount(info) : null
      if (!amount) return ''
      // Copy from "OC & Bulk Overages copy" doc (#5 — CLI Rotating tip)
      return `${claude(`${amount} in extra usage, on us`)} · third-party apps · ${claude('/extra-usage')}`
    },
    cooldownSessions: 3,
    isRelevant: async () => shouldShowOverageCreditUpsell(),
  },
// ⑬ 增长激励组（L591-621）：guest-passes 推给没去过 /passes 页面且缓存判定有资格的用户，有推荐奖励时把 formatCreditAmount 后的金额写进文案；overage-credit 只在 shouldShowOverageCreditUpsell() 为真且缓存里有发放记录时展示，且没有可展示金额时返回空串——空串 tip 会被上层当不相关处理，这比返回 null 安全（Tip.content 的契约是 string）。
  {
    id: 'feedback-command',
    content: async () => 'Use /feedback to help us improve!',
    cooldownSessions: 15,
    async isRelevant() {
      if (process.env.USER_TYPE === 'ant') {
        return false
      }
      const config = getGlobalConfig()
      return config.numStartups > 5
    },
  },
// ⑭ feedback 收尾（L623-633）：/feedback 排除内部员工（他们走内部渠道），只推给 5 次启动以上的外部用户。至此 externalTips 43 条结束。
]
const internalOnlyTips: Tip[] =
  process.env.USER_TYPE === 'ant'
    ? [
        {
          id: 'important-claudemd',
          content: async () =>
            '[ANT-ONLY] Use "IMPORTANT:" prefix for must-follow CLAUDE.md rules',
          cooldownSessions: 30,
          isRelevant: async () => true,
        },
        {
          id: 'skillify',
          content: async () =>
            '[ANT-ONLY] Use /skillify at the end of a workflow to turn it into a reusable skill',
          cooldownSessions: 15,
          isRelevant: async () => true,
        },
      ]
    : []
// internalOnlyTips：只有 USER_TYPE === 'ant' 才存在的两条内部 tip（IMPORTANT 前缀约定、/skillify 技能化）。非 ant 用户拿到的是空数组——与 mockRateLimits 的 [ANT-ONLY] 恰好相反：那边是「只给内部员工」，这里是「不给内部员工」。整个数组在模块加载时按 env 定型，不做运行时切换。

function getCustomTips(): Tip[] {
  const settings = getInitialSettings()
  const override = settings.spinnerTipsOverride
  if (!override?.tips?.length) return []

  return override.tips.map((content, i) => ({
    id: `custom-tip-${i}`,
    content: async () => content,
    cooldownSessions: 0,
    isRelevant: async () => true,
  }))
}
// getCustomTips：读取 settings.spinnerTipsOverride.tips 用户自定义清单。自定义 tip 的冷却是 0、相关性恒 true——用户显式写进来的东西就应该每次都参与轮播。id 按数组下标生成（custom-tip-N），保证冷却账本有稳定键。

export async function getRelevantTips(context?: TipContext): Promise<Tip[]> {
  const settings = getInitialSettings()
  const override = settings.spinnerTipsOverride
  const customTips = getCustomTips()

  // If excludeDefault is true and there are custom tips, skip built-in tips entirely
  if (override?.excludeDefault && customTips.length > 0) {
    return customTips
  }

  // Otherwise, filter built-in tips as before and combine with custom
  const tips = [...externalTips, ...internalOnlyTips]
  const isRelevant = await Promise.all(tips.map(_ => _.isRelevant(context)))
  const filtered = tips
    .filter((_, index) => isRelevant[index])
    .filter(_ => getSessionsSinceLastShown(_.id) >= _.cooldownSessions)

  return [...filtered, ...customTips]
}
// getRelevantTips：总入口。三级优先——① excludeDefault 且有自定义 tip 时完全替换内置（连 isRelevant 都不跑，省钱）；② 否则 Promise.all 并发跑所有内置 tip 的 isRelevant，再按冷却账本过滤（getSessionsSinceLastShown >= cooldownSessions）；③ 自定义 tip 无条件追加在末尾（先内置后自定义，自定义永远有机会露脸）。并发跑 isRelevant 而不是短路——43 条判定加起来也就几毫秒，且 IDE 探测等是异步的，串行会把启动拖慢。
