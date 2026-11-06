import { feature } from 'bun:bundle'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import { redownloadUserSettings } from '../../services/settingsSync/index.js'
import type { LocalCommandCall } from '../../types/command.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { refreshActivePlugins } from '../../utils/plugins/refresh.js'
import { settingsChangeDetector } from '../../utils/settings/changeDetector.js'
import { plural } from '../../utils/stringUtils.js'
// 依赖：bun 特性开关、远程模式判断、设置同步、命令类型、环境判断、插件刷新、变更检测、复数工具

export const call: LocalCommandCall = async (_args, context) => {
// /reload-plugins 命令实现：刷新活跃插件并返回统计
  // CCR: re-pull user settings before the cache sweep so enabledPlugins /
  // extraKnownMarketplaces pushed from the user's local CLI (settingsSync)
  // take effect. Non-CCR headless (e.g. vscode SDK subprocess) shares disk
  // with whoever writes settings — the file watcher delivers changes, no
  // re-pull needed there.
  //
  // Managed settings intentionally NOT re-fetched: it already polls hourly
  // (POLLING_INTERVAL_MS), and policy enforcement is eventually-consistent
  // by design (stale-cache fallback on fetch failure). Interactive
  // /reload-plugins has never re-fetched it either.
  //
  // No retries: user-initiated command, one attempt + fail-open. The user
  // can re-run /reload-plugins to retry. Startup path keeps its retries.
// CCR 模式：先重新拉取用户设置，让本地 CLI 推送的启用插件 / 市场生效；托管设置不重拉（按设计最终一致）
  if (
    feature('DOWNLOAD_USER_SETTINGS') &&
    (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) || getIsRemoteMode())
  ) {
// 仅远程模式（且开启下载用户设置特性）才重拉
    const applied = await redownloadUserSettings()
// 重拉用户设置
    // applyRemoteEntriesToLocal uses markInternalWrite to suppress the
    // file watcher (correct for startup, nothing listening yet); fire
    // notifyChange here so mid-session applySettingsChange runs.
    if (applied) {
      settingsChangeDetector.notifyChange('userSettings')
    }
// 拉取成功则通知设置变更以触发 mid-session 应用
  }

  const r = await refreshActivePlugins(context.setAppState)
// 刷新活跃插件（返回各类计数）

  const parts = [
    n(r.enabled_count, 'plugin'),
    n(r.command_count, 'skill'),
    n(r.agent_count, 'agent'),
    n(r.hook_count, 'hook'),
    // "plugin MCP/LSP" disambiguates from user-config/built-in servers,
    // which /reload-plugins doesn't touch. Commands/hooks are plugin-only;
    // agent_count is total agents (incl. built-ins). (gh-31321)
    n(r.mcp_count, 'plugin MCP server'),
    n(r.lsp_count, 'plugin LSP server'),
  ]
// parts 数组收尾（插件 / 技能 / agent / hook / MCP / LSP 各项）
  let msg = `Reloaded: ${parts.join(' · ')}`
// 用「 · 」连接各部分生成摘要

  if (r.error_count > 0) {
// 有错误则追加提示
    msg += `\n${n(r.error_count, 'error')} during load. Run /doctor for details.`
  }

  return { type: 'text', value: msg }
// 返回文本结果
}

function n(count: number, noun: string): string {
// n()：数量与复数名词组合
  return `${count} ${plural(count, noun)}`
}
