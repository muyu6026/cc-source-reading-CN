// ═══════════════════════════════════════════════════════════════
// 第 6 步 · 补完 MCP 上游 · 1/4 —— MCP 配置的分层与策略
//                                  （src/services/mcp/config.ts，1,578 行）
//
// 【这个文件在解决什么问题：一个配置文件，六种来源，三种规矩】
//
// `client.ts` 管「连上之后怎么活下去」，这个文件管「有哪些服务器、允不允许连」。
// 它要同时回答三个问题：
//
//   ① **从哪读** —— 六个来源，各有优先级（下面有表）
//   ② **能不能用** —— 企业策略的白名单 / 黑名单、项目级信任审批、启停开关
//   ③ **重复了怎么办** —— 同一个服务器被插件和手工配置各声明一次
//
// 这三个问题纠缠在一起，所以 1,578 行里真正的「读文件」代码不到 100 行，
// 其余全是**优先级、去重、策略判定**。
//
// 【六个来源与优先级（本文件的核心事实，先记住再看代码）】
//
//   来源            | 存哪                              | 优先级
//   ---------------|----------------------------------|--------
//   enterprise      | managed-mcp.json（系统级路径）      | 独占
//   local           | 项目配置里的 mcpServers             | 最高（非独占时）
//   project         | 目录树的 .mcp.json（逐级向上找）      | 次高
//   user            | 全局配置文件的 mcpServers            | 再次
//   plugin          | 插件自带的 MCP 声明                  | 低
//   claude.ai       | 网页端连接器（要联网拉）              | 最低
//
// 为什么 local 比 project 高？因为 `.mcp.json` 会进版本控制、全组共享，
// 而 local 是「我在这台机器的这个项目里自己的设置」—— 局部覆盖全局，
// 个人覆盖团队，是配置系统的通行约定。
//
// 【两种「企业独占」（很容易混，但差别很大）】
//
//   A. doesEnterpriseMcpConfigExist()  → 只读 enterprise，**连插件都不留**
//   B. isRestrictedToPluginOnly('mcp') → 只读 enterprise + 插件
//
//   差别在「插件算不算企业可控」。见 getClaudeCodeMcpConfigs 里的批注（p3）。
//
// 【读这个文件的建议】
//
// 不要顺着 33 个符号往下读。按这三条线走：
//   ① 数据怎么进来：parseMcpConfigFromFilePath → parseMcpConfig → expandEnvVars
//   ② 数据怎么合并：getMcpConfigsByScope（单源）→ getClaudeCodeMcpConfigs（多源）
//   ③ 数据怎么被拦：isMcpServerDenied / isMcpServerAllowedByPolicy
//
// 去重（dedup）那三个函数是独立的一条支线，可以最后看。
// ═══════════════════════════════════════════════════════════════
import { feature } from 'bun:bundle'
import { chmod, open, rename, stat, unlink } from 'fs/promises'
import mapValues from 'lodash-es/mapValues.js'
import memoize from 'lodash-es/memoize.js'
import { dirname, join, parse } from 'path'
import { getPlatform } from 'src/utils/platform.js'
import type { PluginError } from '../../types/plugin.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import { isClaudeInChromeMCPServer } from '../../utils/claudeInChrome/common.js'
import {
  getCurrentProjectConfig,
  getGlobalConfig,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { getErrnoCode } from '../../utils/errors.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { safeParseJSON } from '../../utils/json.js'
import { logError } from '../../utils/log.js'
import { getPluginMcpServers } from '../../utils/plugins/mcpPluginIntegration.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import { isSettingSourceEnabled } from '../../utils/settings/constants.js'
import { getManagedFilePath } from '../../utils/settings/managedPath.js'
import { isRestrictedToPluginOnly } from '../../utils/settings/pluginOnlyPolicy.js'
import {
  getInitialSettings,
  getSettingsForSource,
} from '../../utils/settings/settings.js'
import {
  isMcpServerCommandEntry,
  isMcpServerNameEntry,
  isMcpServerUrlEntry,
  type SettingsJson,
} from '../../utils/settings/types.js'
import type { ValidationError } from '../../utils/settings/validation.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { fetchClaudeAIMcpConfigsIfEligible } from './claudeai.js'
import { expandEnvVarsInString } from './envExpansion.js'
import {
  type ConfigScope,
  type McpHTTPServerConfig,
  type McpJsonConfig,
  McpJsonConfigSchema,
  type McpServerConfig,
  McpServerConfigSchema,
  type McpSSEServerConfig,
  type McpStdioServerConfig,
  type McpWebSocketServerConfig,
  type ScopedMcpServerConfig,
} from './types.js'
import { getProjectMcpServerStatus } from './utils.js'

// 企业配置走的是 `getManagedFilePath()`，不是用户 HOME 也不是项目目录 ——
// 这是**系统级**路径（macOS/Linux 在 /etc 一类位置，Windows 在 ProgramData）。
//
// 为什么这个细节重要：企业配置之所以能"独占"，前提是**普通用户改不了它**。
// 如果它放在用户可写的位置，整个策略体系就是纸糊的 —— 用户删掉文件即可绕过。
//
// 安全模型和存储位置是绑定的：权限边界在哪里，策略才能管到哪里。
/**
 * Get the path to the managed MCP configuration file
 */
export function getEnterpriseMcpFilePath(): string {
  return join(getManagedFilePath(), 'managed-mcp.json')
}

// 给每个服务器的配置贴一个 `scope` 标签。
//
// 【为什么需要这个标签】
//
// 合并之后，`{ name: config }` 里的 config 已经看不出自己来自哪一层了。
// 但后续很多地方需要知道：
//   · UI 上要显示「这个服务器来自 .mcp.json」还是「来自用户配置」
//   · `removeMcpConfig(name, scope)` 要知道去哪个文件里删
//   · 报错信息要带上 scope 才能定位
//
// 【注意这是浅拷贝（`{ ...config, scope }`）】
// 只加一个字段，不递归复制。在这个场景下够用，因为下游不会改 config 的
// 嵌套对象。但如果将来需要原地修改 env/headers，就得改成深拷贝 ——
// 否则会改到共享的原始对象上。
/**
 * Internal utility: Add scope to server configs
 */
function addScopeToServers(
  servers: Record<string, McpServerConfig> | undefined,
  scope: ConfigScope,
): Record<string, ScopedMcpServerConfig> {
  if (!servers) {
    return {}
  }
  const scopedServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries(servers)) {
    scopedServers[name] = { ...config, scope }
  }
  return scopedServers
}

// 【writeMcpjsonFile：一个 44 行的原子写入，每一步都在防一种具体的坏情况】
//
// 这个函数只在 `addMcpConfig` / `removeMcpConfig` 的 project 分支用到 ——
// 也就是「CLI 要改用户的 .mcp.json」这一个场景。看起来写个文件而已，
// 但这里的严谨程度值得逐条看。
//
// ── ① 先读原文件的权限位（92-102 行）──
//
//   为什么要保留？因为 `.mcp.json` 可能被用户设成 0600（自己看）。
//   如果我们用默认的 0644 重写，就**悄悄放宽了权限**。
//   而且 ENOENT 要显式放行（文件还不存在，没有权限可保留），
//   其他错误照抛 —— 注意它区分了 `code !== 'ENOENT'` 才 throw。
//
// ── ② 写临时文件而不是直接写（105-114 行）──
//
//   直接 `writeFile(.mcp.json)` 的问题：写入过程中文件是**半个**状态。
//   如果这时：
//     · 进程被 kill → 文件损坏
//     · 另一个进程（同项目开了第二个 CC）读 → 读到坏 JSON
//   所以先写 `${path}.tmp.${pid}.${timestamp}`，写完整了再 rename。
//
//   文件名里带 **pid + 时间戳** 是为了并发安全：两个进程同时 add 时，
//   各写各自的临时文件，不会互相覆盖。
//
// ── ③ datasync() 在 rename 之前（111 行）──
//
//   这是最容易漏的一步。`writeFile` 返回只代表数据进了**操作系统的页缓存**，
//   不代表落盘。而 `rename` 改的是目录元数据。
//   如果顺序反了（先 rename 再刷数据），掉电后可能出现：
//   文件存在、大小为零 —— 因为元数据写进去了，数据没有。
//
//   `datasync()` 只刷数据不刷元数据，比 `fsync()` 便宜，这里正合适。
//
// ── ④ chmod 临时文件而不是目标文件（118-120 行）──
//
//   因为 `open(tempPath, 'w', mode)` 的 mode 会被 **umask** 削掉一部分。
//   在 rename 之前显式 chmod，保证权限和原文件完全一致。
//
// ── ⑤ 失败时清理临时文件（122-129 行）──
//
//   `unlink` 失败就 `catch {}` 吞掉 —— 注释写了 "Best-effort cleanup"。
//   因为此时真正的错误在 `throw e` 里，临时文件残留是次要问题，
//   不能让它掩盖原始错误。
//
// ── ⑥ 注释里那句 "does not follow symlinks" ──
//
//   `rename` 如果目标是软链，会**替换软链本身**，而不是它指向的文件。
//   也就是说：如果用户的 `.mcp.json` 是指向别处的软链，
//   一次 `claude mcp add` 会把它变成一个普通文件，软链关系断掉。
//
//   这是刻意的选择（保留路径原样），但属于"用户可能意外"的行为。
//   注释写出来是为了让下一个人知道这不是疏忽。
/**
 * Internal utility: Write MCP config to .mcp.json file.
 * Preserves file permissions and flushes to disk before rename.
 * Uses the original path for rename (does not follow symlinks).
 */
async function writeMcpjsonFile(config: McpJsonConfig): Promise<void> {
  const mcpJsonPath = join(getCwd(), '.mcp.json')

  // Read existing file permissions to preserve them
  let existingMode: number | undefined
  try {
    const stats = await stat(mcpJsonPath)
    existingMode = stats.mode
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      throw e
    }
    // File doesn't exist yet -- no permissions to preserve
  }

  // Write to temp file, flush to disk, then atomic rename
  const tempPath = `${mcpJsonPath}.tmp.${process.pid}.${Date.now()}`
  const handle = await open(tempPath, 'w', existingMode ?? 0o644)
  try {
    await handle.writeFile(jsonStringify(config, null, 2), {
      encoding: 'utf8',
    })
    await handle.datasync()
  } finally {
    await handle.close()
  }

  try {
    // Restore original file permissions on the temp file before rename
    if (existingMode !== undefined) {
      await chmod(tempPath, existingMode)
    }
    await rename(tempPath, mcpJsonPath)
  } catch (e: unknown) {
    // Clean up temp file on failure
    try {
      await unlink(tempPath)
    } catch {
      // Best-effort cleanup
    }
    throw e
  }
}

// 【getServerCommandArray / getServerUrl：两个小工具，但它们定义了什么算"同一个服务器"】
//
// `getServerCommandArray`：`[command, ...args]`。
//   注意 `config.type !== undefined && config.type !== 'stdio'` 这个条件 ——
//   **undefined 也算 stdio**。因为 .mcp.json 里可以省略 type 字段，
//   省略时默认就是 stdio。这是个容易漏的兼容处理。
//
// `getServerUrl`：用 `'url' in config` 而不是 `config.url !== undefined`。
//   两者在类型层面等价，但 `in` 更明确表达"这个类型有这个字段"。
//   返回 null 而不是 undefined，是为了让调用方统一用 `if (url)` 判断。
//
// 这两个函数是 dedup 的基础：签名就是用它们的返回值算的。
/**
 * Extract command array from server config (stdio servers only)
 * Returns null for non-stdio servers
 */
function getServerCommandArray(config: McpServerConfig): string[] | null {
  // Non-stdio servers don't have commands
  if (config.type !== undefined && config.type !== 'stdio') {
    return null
  }
  const stdioConfig = config as McpStdioServerConfig
  return [stdioConfig.command, ...(stdioConfig.args ?? [])]
}

/**
 * Check if two command arrays match exactly
 */
function commandArraysMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  return a.every((val, idx) => val === b[idx])
}

/**
 * Extract URL from server config (remote servers only)
 * Returns null for stdio/sdk servers
 */
function getServerUrl(config: McpServerConfig): string | null {
  return 'url' in config ? config.url : null
}

// 【CCR 代理 URL —— 一个只有远程会话才会遇到的坑】
//
// 场景：在远程会话（CCR = Claude Code Remote）里，claude.ai 的连接器
// 到达 CLI 时，URL 已经被**改写过**了 —— 不再是厂商的原始地址，
// 而是走一个 SHTTP 代理：
//
//     原始： https://mcp.slack.com/api
//     改写： https://<ccr-host>/v2/session_ingress/shttp/mcp/...?mcp_url=<编码后的原始URL>
//
// 为什么改写？因为远程会话里 CLI 跑在容器里，出网要经过会话入口代理。
//
// 【问题出在去重】
//
//   插件声明的服务器用的是**原始** vendor URL；
//   连接器到达时用的是**代理** URL。
//   两者指向同一个服务，但字符串完全不同 → 签名不等 → 去重失效 →
//   同一个 Slack 连接被建两次 → 每轮多浪费约 600 字符的 tool schema。
//
// 所以 `unwrapCcrProxyUrl` 从 `mcp_url` 查询参数里把原始地址取回来，
// 让两边能匹配上。
//
// 【注释里那两个 Go 文件路径值得注意】
//
//   `api-go/ccr/internal/ccrshared/mcp_url_rewriter.go`
//   `api-go/ccr/internal/mcpproxy/proxy.go`
//
// 这是**跨仓库的引用**：改写发生在一个 Go 服务里，解包发生在 TypeScript 里。
// 也就是说，这两个模块有一个**隐式契约**（查询参数必须叫 `mcp_url`），
// 而这个契约在编译器看来完全不存在。改任何一边都不会报错。
//
// 注释里写下路径，就是把这个隐式契约显式记录 —— 这是跨语言边界唯一
// 能做的防护。
/**
 * CCR proxy URL path markers. In remote sessions, claude.ai connectors arrive
 * via --mcp-config with URLs rewritten to route through the CCR/session-ingress
 * SHTTP proxy. The original vendor URL is preserved in the mcp_url query param
 * so the proxy knows where to forward. See api-go/ccr/internal/ccrshared/
 * mcp_url_rewriter.go and api-go/ccr/internal/mcpproxy/proxy.go.
 */
const CCR_PROXY_PATH_MARKERS = [
  '/v2/session_ingress/shttp/mcp/',
  '/v2/ccr-sessions/',
]

/**
 * If the URL is a CCR proxy URL, extract the original vendor URL from the
 * mcp_url query parameter. Otherwise return the URL unchanged. This lets
 * signature-based dedup match a plugin's raw vendor URL against a connector's
 * rewritten proxy URL when both point at the same MCP server.
 */
// 实现只有 10 行，两个细节：
//
//   ① `CCR_PROXY_PATH_MARKERS.some(m => url.includes(m))` 先做**便宜的**判断。
//      绝大多数 URL 不是代理 URL，`includes` 检查两个子串就返回了，
//      不会走到 `new URL()` 解析。
//
//   ② `catch { return url }` —— URL 解析失败就原样返回。
//      因为如果这个 URL 连 `new URL()` 都解不了，它本来也不会被当代理 URL 用，
//      原样返回是最不坏的选择。不能抛 —— 这个函数在去重路径上，
//      抛异常会让整个配置加载失败。
//
//   ③ `original || url` 而不是 `original ?? url`：
//      `searchParams.get()` 返回 `string | null`，空字符串也是 falsy，
//      用 `||` 能同时挡住 null 和空串。
export function unwrapCcrProxyUrl(url: string): string {
  if (!CCR_PROXY_PATH_MARKERS.some(m => url.includes(m))) {
    return url
  }
  try {
    const parsed = new URL(url)
    const original = parsed.searchParams.get('mcp_url')
    return original || url
  } catch {
    return url
  }
}

// 【getMcpServerSignature：两行代码，两个刻意的省略】
//
// 签名只有三种形态：
//   · `stdio:[command, ...args]`  —— stdio 服务器
//   · `url:<规范化后的URL>`        —— 远程服务器
//   · `null`                      —— sdk 类型（既无 command 也无 url）
//
// 【省略 env 的理由（注释原话）】
//
//   "Ignores env (plugins always inject CLAUDE_PLUGIN_ROOT)"
//
//   插件声明的 MCP 服务器，env 里会被注入 `CLAUDE_PLUGIN_ROOT` 指向插件目录。
//   而用户手工配置同一个服务器时不会注入这个变量。
//   如果 env 参与签名，**两边永远不相等，去重完全失效**。
//
//   这个省略不是偷懒，是"如果要比较 env，得先知道哪些 env 是环境注入的、
//   哪些是用户配置的" —— 那个区分做不到，所以干脆不比。
//
// 【省略 headers 的理由】
//
//   "same URL = same server regardless of auth"
//
//   同一个 URL 就是同一个服务，认证方式不同（一个是 OAuth token、
//   一个是 API key）不改变"这是同一个服务器"这个事实。
//   而且 headers 里常含**凭证**，把它算进签名意味着签名里带密钥 ——
//   万一签名进了日志，凭证就泄漏了。
//
// 【这两个省略的共同点：签名要比的是"身份"，不是"配置"】
//   身份 = 你连到哪里（command 或 url）
//   配置 = 你怎么连（env、headers）
//   去重要比身份，比配置会误判。
//
// 【一个值得警惕的后果】
//   同样的 URL、不同的认证方式 → 被判为重复 → 后加载的那个被抑制。
//   如果两个配置其实是**不同租户**（同一个 SaaS 的不同 workspace，
//   靠 header 区分），去重就会错误地干掉一个。
//   作者选择了这个取舍（宁可少连一个也不重复连），但从注释能看出他知道。
/**
 * Compute a dedup signature for an MCP server config.
 * Two configs with the same signature are considered "the same server" for
 * plugin deduplication. Ignores env (plugins always inject CLAUDE_PLUGIN_ROOT)
 * and headers (same URL = same server regardless of auth).
 * Returns null only for configs with neither command nor url (sdk type).
 */
export function getMcpServerSignature(config: McpServerConfig): string | null {
  const cmd = getServerCommandArray(config)
  if (cmd) {
    return `stdio:${jsonStringify(cmd)}`
  }
  const url = getServerUrl(config)
  if (url) {
    return `url:${unwrapCcrProxyUrl(url)}`
  }
  return null
}

// 【dedupPluginMcpServers：两级去重，两个方向】
//
// 输入：插件声明的服务器 + 手工配置的服务器
// 规则：① 手工配置赢（manual wins over plugin）
//       ② 插件之间，先加载的赢
//
// 【为什么"手工赢"？】
//   因为手工配置是用户**明确写下**的意图。用户在 .mcp.json 里写了一个
//   Slack 服务器，然后装了个插件也自带 Slack —— 显然应该用他写的那个，
//   而不是让插件的版本静默顶掉。
//   这和 CSS 里"内联样式 > 外部样式表"是同一种直觉。
//
// 【为什么注释要强调 "namespaced plugin:name:server"】
//
//   因为插件服务器的 key 是 `plugin:xxx:yyy` 这种带前缀的形式，
//   和手工配置的 key **永远不会撞**。
//   所以合并 `Object.assign(plugin, manual)` 时不会有键覆盖 ——
//   也就是说，**光靠键是去不掉重的**。
//
//   必须按"内容"（command / url）判断它们是不是同一个东西。
//   这是"键不同但指向同一实体"的经典问题，只有内容指纹能解。
//
// 【`manualSigs` 用 `if (sig && !manualSigs.has(sig))` 保留第一个】
//   同一个签名可能在手工配置里出现多次（两个不同名字指向同一个命令）。
//   保留第一个只是为了报错信息里能说出一个名字，不影响去重结果。
/**
 * Filter plugin MCP servers, dropping any whose signature matches a
 * manually-configured server or an earlier-loaded plugin server.
 * Manual wins over plugin; between plugins, first-loaded wins.
 *
 * Plugin servers are namespaced `plugin:name:server` so they never key-collide
 * with manual servers in the merge — this content-based check catches the case
 * where both actually launch the same underlying process/connection.
 */
export function dedupPluginMcpServers(
  pluginServers: Record<string, ScopedMcpServerConfig>,
  manualServers: Record<string, ScopedMcpServerConfig>,
): {
  servers: Record<string, ScopedMcpServerConfig>
  suppressed: Array<{ name: string; duplicateOf: string }>
} {
  // Map signature -> server name so we can report which server a dup matches
  const manualSigs = new Map<string, string>()
  for (const [name, config] of Object.entries(manualServers)) {
    const sig = getMcpServerSignature(config)
    if (sig && !manualSigs.has(sig)) manualSigs.set(sig, name)
  }

  const servers: Record<string, ScopedMcpServerConfig> = {}
  const suppressed: Array<{ name: string; duplicateOf: string }> = []
  const seenPluginSigs = new Map<string, string>()
  for (const [name, config] of Object.entries(pluginServers)) {
    const sig = getMcpServerSignature(config)
    if (sig === null) {
      servers[name] = config
      continue
    }
    const manualDup = manualSigs.get(sig)
    if (manualDup !== undefined) {
      logForDebugging(
        `Suppressing plugin MCP server "${name}": duplicates manually-configured "${manualDup}"`,
      )
      suppressed.push({ name, duplicateOf: manualDup })
      continue
    }
    const pluginDup = seenPluginSigs.get(sig)
    if (pluginDup !== undefined) {
      logForDebugging(
        `Suppressing plugin MCP server "${name}": duplicates earlier plugin server "${pluginDup}"`,
      )
      suppressed.push({ name, duplicateOf: pluginDup })
      continue
    }
    seenPluginSigs.set(sig, name)
    servers[name] = config
  }
  return { servers, suppressed }
}

// 【dedupClaudeAiMcpServers：和上一个几乎同构，但有一个关键差异】
//
// 差异在这一行（290 行）：
//
//     if (isMcpServerDisabled(name)) continue
//
// 也就是说：**只有"已启用"的手工服务器才能抑制连接器。**
//
// 【为什么这条判断不能省】
//
// 注释原话：
//   "Only enabled manual servers count as dedup targets — a disabled manual
//    server mustn't suppress its connector twin, or neither runs."
//
// 还原这个故障：
//   ① 用户手工配了 `slack`，但把它禁用了（想改用网页连接器）
//   ② 网页端启用了 Slack 连接器
//   ③ 如果没有这条判断：`slack`（禁用）的签名会抑制掉连接器
//   ④ 结果：手工那个因为被禁用不连，连接器那个因为被去重删掉也不连
//      → **两个都不跑，Slack 完全不可用**
//
// 这是一个"两个抑制规则叠加出了一个空集"的 bug。
// 抑制只能在"被抑制方还有替补"的前提下做，否则就是净损失。
//
// 【这类 bug 的共同形态】
//   每一条规则单独看都对，叠加起来产生空集。
//   防御方式：**在写抑制逻辑时，先问"被抑制的那个没了，还有谁在干活"**。
//   如果答案是"没人"，这条抑制就是错的。
/**
 * Filter claude.ai connectors, dropping any whose signature matches an enabled
 * manually-configured server. Manual wins: a user who wrote .mcp.json or ran
 * `claude mcp add` expressed higher intent than a connector toggled in the web UI.
 *
 * Connector keys are `claude.ai <DisplayName>` so they never key-collide with
 * manual servers in the merge — this content-based check catches the case where
 * both point at the same underlying URL (e.g. `mcp__slack__*` and
 * `mcp__claude_ai_Slack__*` both hitting mcp.slack.com, ~600 chars/turn wasted).
 *
 * Only enabled manual servers count as dedup targets — a disabled manual server
 * mustn't suppress its connector twin, or neither runs.
 */
export function dedupClaudeAiMcpServers(
  claudeAiServers: Record<string, ScopedMcpServerConfig>,
  manualServers: Record<string, ScopedMcpServerConfig>,
): {
  servers: Record<string, ScopedMcpServerConfig>
  suppressed: Array<{ name: string; duplicateOf: string }>
} {
  const manualSigs = new Map<string, string>()
  for (const [name, config] of Object.entries(manualServers)) {
    if (isMcpServerDisabled(name)) continue
    const sig = getMcpServerSignature(config)
    if (sig && !manualSigs.has(sig)) manualSigs.set(sig, name)
  }

  const servers: Record<string, ScopedMcpServerConfig> = {}
  const suppressed: Array<{ name: string; duplicateOf: string }> = []
  for (const [name, config] of Object.entries(claudeAiServers)) {
    const sig = getMcpServerSignature(config)
    const manualDup = sig !== null ? manualSigs.get(sig) : undefined
    if (manualDup !== undefined) {
      logForDebugging(
        `Suppressing claude.ai connector "${name}": duplicates manually-configured "${manualDup}"`,
      )
      suppressed.push({ name, duplicateOf: manualDup })
      continue
    }
    servers[name] = config
  }
  return { servers, suppressed }
}

// 【urlPatternToRegex：白名单里的 URL 通配符】
//
// 两步转换：
//   ① 转义正则元字符：`[.+?^${}()|[\]\\]`
//   ② 把 `*` 换成 `.*`
//
// ── 为什么转义字符集里**不含** `*` ──
//
//   因为 `*` 是要保留的通配符。如果先转义再替换，`*` 会变成 `\*`（字面量星号），
//   然后再替换 `\*` → 就乱了。
//   所以正确顺序是：转义"除 * 以外的一切"，再替换 *。
//   代码用的正是这个顺序，且转义集里刻意没放 `*`。
//
// ── 为什么最后要 `^...$` ──
//
//   不加锚定的话，`https://example.com/*` 会匹配
//   `https://evil.com/?redirect=https://example.com/x` —— 子串匹配。
//   白名单必须全串匹配，否则就是个洞。
//
// ── 但这个实现有个已知的宽松之处 ──
//
//   `.*` 会跨过 `/`。所以 `https://example.com/*` 也匹配
//   `https://example.com/a/b/c/d`，不只是单层路径。
//   注释里写的是 "matching any characters"，说明这是**有意**的。
//
//   在"允许某个域名下的所有路径"这个用法里，这是对的。
//   但如果有人想写"只允许 /api/v1/*"，就会意外放开所有子路径 ——
//   语义上算不算漏洞取决于威胁模型，但值得知道。
//
// ── 每次调用都新建 RegExp ──
//
//   `urlMatchesPattern` 每次都 `new RegExp`，没有缓存。
//   在这个场景下可接受（配置检查是低频操作，服务器数量是个位数到几十）。
//   如果将来要在每轮请求里做 URL 匹配，就得加缓存。
/**
 * Convert a URL pattern with wildcards to a RegExp
 * Supports * as wildcard matching any characters
 * Examples:
 *   "https://example.com/*" matches "https://example.com/api/v1"
 *   "https://*.example.com/*" matches "https://api.example.com/path"
 *   "https://example.com:*\/*" matches any port
 */
function urlPatternToRegex(pattern: string): RegExp {
  // Escape regex special characters except *
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  // Replace * with regex equivalent (match any characters)
  const regexStr = escaped.replace(/\*/g, '.*')
  return new RegExp(`^${regexStr}$`)
}

/**
 * Check if a URL matches a pattern with wildcard support
 */
function urlMatchesPattern(url: string, pattern: string): boolean {
  const regex = urlPatternToRegex(pattern)
  return regex.test(url)
}

// 【allowlist 与 denylist 的**非对称**设计 —— 本文件最重要的策略思想】
//
// 这是两个几乎一样的小函数，但它们的取数范围**故意不同**：
//
//    getMcpAllowlistSettings()  →  可能只读 policySettings
//    getMcpDenylistSettings()   →  永远读 getInitialSettings()（合并所有来源）
//
// ── 白名单为什么可以收紧 ──
//
//   当企业策略里有 `allowManagedMcpServersOnly: true` 时，白名单**只**来自
//   企业管理设置。否则会发生什么？
//   用户在本地配置里写一句 `allowedMcpServers: []`... 不对，空数组是全禁；
//   写一句 `allowedMcpServers: [{serverName: "随便什么"}]` ——
//   如果白名单是合并的，用户就**自己给自己开了一个口子**，
//   企业限制形同虚设。
//
//   所以白名单必须能收紧到"只信 managed"。
//
// ── 黑名单为什么永远合并 ──
//
//   因为**加黑名单不会绕过限制**，只会更严。
//   用户想禁掉自己不想用的服务器，这是他的正当权利，企业也没理由拦。
//   而且企业 + 用户的黑名单合并 = 并集，只会更安全。
//
// 【一条可推广的原则】
//
//   当同一个策略字段既可能被用来**放宽**也可能被用来**收紧**时，
//   要区分"谁能放宽"和"谁只能收紧"。
//   这里是：**收紧永远允许（合并），放宽只在受信来源（独占）**。
//
//   这解释了为什么两个函数长得几乎一样却不能合并成一个 ——
//   合并就丢掉了这个不对称性，而那正是安全性的来源。
/**
 * Get the settings to use for MCP server allowlist policy.
 * When allowManagedMcpServersOnly is set in policySettings, only managed settings
 * control which servers are allowed. Otherwise, returns merged settings.
 */
function getMcpAllowlistSettings(): SettingsJson {
  if (shouldAllowManagedMcpServersOnly()) {
    return getSettingsForSource('policySettings') ?? {}
  }
  return getInitialSettings()
}

/**
 * Get the settings to use for MCP server denylist policy.
 * Denylists always merge from all sources — users can always deny servers
 * for themselves, even when allowManagedMcpServersOnly is set.
 */
function getMcpDenylistSettings(): SettingsJson {
  return getInitialSettings()
}

// 【isMcpServerDenied：三种匹配方式，注意它们是"或"关系】
//
//   ① 按**名字**：`{ serverName: "slack" }`
//   ② 按**命令**：`{ serverCommand: ["npx", "evil-mcp"] }`（仅 stdio）
//   ③ 按**URL**：`{ serverUrl: "https://evil.com/*" }`（仅远程）
//
// 【为什么要三种而不是一种】
//
//   只按名字拦不住"换个名字再来"：企业禁了 `slack`，用户配一个
//   叫 `slack2` 的，命令完全一样 —— 名字白名单没用。
//   所以还需要按命令/URL 拦，这是"按实质内容拦"而不是"按标签拦"。
//
// 【为什么命令是"完全相等"而 URL 是"通配"】
//
//   命令是数组，`commandArraysMatch` 要求长度和每项都相等。
//   这是刻意的严格：`["npx", "evil-mcp"]` 和 `["npx", "evil-mcp", "--debug"]`
//   算不同配置 —— 多一个参数可能完全是另一个东西。
//
//   URL 用通配符，因为一个服务可能有很多路径/子域，逐条列举不现实。
//
// 【`config` 参数是可选的，这个设计有代价】
//
//   不传 config 时只能按名字匹配 —— 也就是说**只按名字拦得住的那部分**。
//   所有内部调用点都传了 config（因为都刚解析完），
//   但如果将来有人写个新调用点忘了传，就静默降级成"只按名字拦"。
//   这是又一处"可选参数默认值指向较弱保护"的地方。
//
// 【返回布尔而不是抛异常】
//
//   因为"被策略拒绝"是**正常业务结果**，不是异常。
//   上层要把 blocked 的名字收集起来告诉用户，而不是崩掉。
/**
 * Check if an MCP server is denied by enterprise policy
 * Checks name-based, command-based, and URL-based restrictions
 * @param serverName The name of the server to check
 * @param config Optional server config for command/URL-based matching
 * @returns true if denied, false if not on denylist
 */
function isMcpServerDenied(
  serverName: string,
  config?: McpServerConfig,
): boolean {
  const settings = getMcpDenylistSettings()
  if (!settings.deniedMcpServers) {
    return false // No restrictions
  }

  // Check name-based denial
  for (const entry of settings.deniedMcpServers) {
    if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
      return true
    }
  }

  // Check command-based denial (stdio servers only) and URL-based denial (remote servers only)
  if (config) {
    const serverCommand = getServerCommandArray(config)
    if (serverCommand) {
      for (const entry of settings.deniedMcpServers) {
        if (
          isMcpServerCommandEntry(entry) &&
          commandArraysMatch(entry.serverCommand, serverCommand)
        ) {
          return true
        }
      }
    }

    const serverUrl = getServerUrl(config)
    if (serverUrl) {
      for (const entry of settings.deniedMcpServers) {
        if (
          isMcpServerUrlEntry(entry) &&
          urlMatchesPattern(serverUrl, entry.serverUrl)
        ) {
          return true
        }
      }
    }
  }

  return false
}

/**
 * Check if an MCP server is allowed by enterprise policy
 * Checks name-based, command-based, and URL-based restrictions
 * @param serverName The name of the server to check
 * @param config Optional server config for command/URL-based matching
 * @returns true if allowed, false if blocked by policy
 */
// 【isMcpServerAllowedByPolicy：白名单判定，全文件分支最密的地方】
//
// 先用一句话概括逻辑，再看代码就不容易迷路：
//
//     denied 优先 → 没有白名单 = 全放行 → 空白名单 = 全禁
//     → 有 command 条目则 stdio 必须命中 command 条目（名字不管用）
//     → 有 url 条目则远程必须命中 url 条目（名字不管用）
//     → 都没有则只按名字
//
// ── ① 黑名单绝对优先（421-424 行）──
//
//   `if (isMcpServerDenied(...)) return false` 放在最前面。
//   这不是"两个列表取交集"那么简单 —— 是**黑名单一票否决**。
//   语义上正确：企业明确禁止的东西，不可能因为某个白名单条目而被放行。
//
// ── ② 没有白名单 = 全放行；空白名单 = 全禁（427-434 行）──
//
//   `if (!settings.allowedMcpServers) return true`   // undefined
//   `if (settings.allowedMcpServers.length === 0) return false`  // []
//
//   这两个判断必须分开写，而且**方向相反**。
//   直觉上"没有白名单"和"空白名单"都是"什么都没有"，
//   但语义完全不同：
//     · 字段不存在 → 没配过白名单 → 不限制
//     · 字段是空数组 → 明确配了"一个都不许" → 全禁
//
//   这是 JSON 配置里最常见的语义陷阱之一。
//   如果写成 `if (!settings.allowedMcpServers?.length) return true`，
//   空白名单就等于全放行 —— 企业写了个空数组想禁掉一切，
//   结果什么都没禁。**这种 bug 不会报错，只会静默失效。**
//
// ── ③ "有条目就换判据"（436-498 行）──
//
//   最反直觉的一段：
//
//     hasCommandEntries = 白名单里有没有 command 类型条目
//     hasUrlEntries     = 白名单里有没有 url 类型条目
//
//   只要存在**任意一条** command 条目，所有 stdio 服务器就**必须**命中
//   某条 command 条目 —— 名字条目对它们完全失效。
//
//   为什么？因为 command 条目表达的是"只允许运行这些程序"，
//   这是个比名字更强的约束。如果同时允许名字匹配，
//   用户配一个 `{ serverName: "x" }` 就能跑任意命令 —— 约束被绕过。
//
//   【代价：这是一个"全有或全无"的开关，粒度很粗。】
//   企业如果想"允许 A 命令，另外允许某个 stdio 服务器按名字"，
//   这个实现做不到 —— 一旦有 command 条目，名字就不管用了。
//
// ── ④ 四段几乎重复的代码（446-507）──
//
//   stdio / 远程 / 未知类型 / 没传 config，四段各写一遍"扫名字条目"。
//   可以抽成一个函数，但作者选择展开 —— 因为每段的**前置条件**不同，
//   抽出来会变成一个带 3 个布尔参数的小函数，反而更难读。
//   这是"重复 vs 参数爆炸"的取舍，这里的重复是可接受的。
function isMcpServerAllowedByPolicy(
  serverName: string,
  config?: McpServerConfig,
): boolean {
  // Denylist takes absolute precedence
  if (isMcpServerDenied(serverName, config)) {
    return false
  }

  const settings = getMcpAllowlistSettings()
  if (!settings.allowedMcpServers) {
    return true // No allowlist restrictions (undefined)
  }

  // Empty allowlist means block all servers
  if (settings.allowedMcpServers.length === 0) {
    return false
  }

  // Check if allowlist contains any command-based or URL-based entries
  const hasCommandEntries = settings.allowedMcpServers.some(
    isMcpServerCommandEntry,
  )
  const hasUrlEntries = settings.allowedMcpServers.some(isMcpServerUrlEntry)

  if (config) {
    const serverCommand = getServerCommandArray(config)
    const serverUrl = getServerUrl(config)

    if (serverCommand) {
      // This is a stdio server
      if (hasCommandEntries) {
        // If ANY serverCommand entries exist, stdio servers MUST match one of them
        for (const entry of settings.allowedMcpServers) {
          if (
            isMcpServerCommandEntry(entry) &&
            commandArraysMatch(entry.serverCommand, serverCommand)
          ) {
            return true
          }
        }
        return false // Stdio server doesn't match any command entry
      } else {
        // No command entries, check name-based allowance
        for (const entry of settings.allowedMcpServers) {
          if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
            return true
          }
        }
        return false
      }
    } else if (serverUrl) {
      // This is a remote server (sse, http, ws, etc.)
      if (hasUrlEntries) {
        // If ANY serverUrl entries exist, remote servers MUST match one of them
        for (const entry of settings.allowedMcpServers) {
          if (
            isMcpServerUrlEntry(entry) &&
            urlMatchesPattern(serverUrl, entry.serverUrl)
          ) {
            return true
          }
        }
        return false // Remote server doesn't match any URL entry
      } else {
        // No URL entries, check name-based allowance
        for (const entry of settings.allowedMcpServers) {
          if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
            return true
          }
        }
        return false
      }
    } else {
      // Unknown server type - check name-based allowance only
      for (const entry of settings.allowedMcpServers) {
        if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
          return true
        }
      }
      return false
    }
  }

  // No config provided - check name-based allowance only
  for (const entry of settings.allowedMcpServers) {
    if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
      return true
    }
  }
  return false
}

// 【filterMcpServersByPolicy：为什么需要一个"泛型无约束"的函数】
//
// 上面那段 25 行 JSDoc 是全文件写得最细的一处 —— 因为它要为一个
// **看起来不安全的类型断言**（`config as McpServerConfig`）做辩护。
//
// ── 先看它要解决的问题 ──
//
// `getClaudeCodeMcpConfigs()` 内部已经做了策略过滤。但有两条路径
// **绕过**了它：
//
//   ① `--mcp-config` 命令行参数（main.tsx）
//   ② `mcp_set_servers` 控制消息（print.ts，SDK V2 的 Query.setMcpServers()）
//
// 这两条都是"用户直接给我一批配置，我直接连"，不经过常规的合并流程。
// 所以它们必须**自己**再过一遍策略，否则就是个绕过口子。
//
// 这个函数就是给它们用的。
//
// ── 为什么泛型不加约束（<T> 而不是 <T extends McpServerConfig>）──
//
//   因为两个调用点用的是**不同的类型族**：
//     · main.tsx  → ScopedMcpServerConfig（args: string[] 必填）
//     · print.ts  → McpServerConfigForProcessTransport（args?: string[] 可选）
//
//   这两个类型在结构上兼容，但谁也不是谁的子类型。
//   如果加约束，总有一边编译不过。
//
// ── 为什么 `as McpServerConfig` 这个断言是安全的 ──
//
//   注释给了完整论证，核心两句：
//     "the policy check only reads, never requires any field to be present"
//     "`getServerCommandArray` defaults `args` to `[]` via `?? []`"
//
//   也就是说：策略检查**只读** type / url / command / args 四个字段，
//   而且对缺失字段有兜底。
//   所以传进来一个"结构兼容但没有 args"的对象，不会崩，只是按"没有 args"处理。
//
// 【这段注释的价值不在结论，在方法】
//
//   类型断言（`as`）在 Typescript 里通常是"我知道我在干什么"的免责声明，
//   很少附带理由。这里把**为什么安全**的三层理由都写出来了：
//   ① 这条路径为什么要单独过滤（防绕过）
//   ② 为什么不能加泛型约束（两个不兼容的类型族）
//   ③ 为什么断言是安全的（只读 + 有兜底）
//
//   如果每个 `as` 都这么写，类型系统就不需要被当成敌人了。
/**
 * Filter a record of MCP server configs by managed policy (allowedMcpServers /
 * deniedMcpServers). Servers blocked by policy are dropped and their names
 * returned so callers can warn the user.
 *
 * Intended for user-controlled config entry points that bypass the policy filter
 * in getClaudeCodeMcpConfigs(): --mcp-config (main.tsx) and the mcp_set_servers
 * control message (print.ts, SDK V2 Query.setMcpServers()).
 *
 * SDK-type servers are exempt — they are SDK-managed transport placeholders,
 * not CLI-managed connections. The CLI never spawns a process or opens a
 * network connection for them; tool calls route back to the SDK via
 * mcp_tool_call. URL/command-based allowlist entries are meaningless for them
 * (no url, no command), and gating by name would silently drop them during
 * installPluginsAndApplyMcpInBackground's sdkMcpConfigs carry-forward.
 *
 * The generic has no type constraint because the two callsites use different
 * config type families: main.tsx uses ScopedMcpServerConfig (service type,
 * args: string[] required), print.ts uses McpServerConfigForProcessTransport
 * (SDK wire type, args?: string[] optional). Both are structurally compatible
 * with what isMcpServerAllowedByPolicy actually reads (type/url/command/args)
 * — the policy check only reads, never requires any field to be present.
 * The `as McpServerConfig` widening is safe for that reason; the downstream
 * checks tolerate missing/undefined fields: `config` is optional, and
 * `getServerCommandArray` defaults `args` to `[]` via `?? []`.
 */
// 函数体只有 10 行，但有一个细节必须注意：
//
//     if (c.type === 'sdk' || isMcpServerAllowedByPolicy(name, c))
//
// **sdk 类型直接放行，连策略都不查。**
//
// 【这是全文件唯一一处"豁免策略"的地方，理由值得完整理解】
//
// 注释原话：
//   "SDK-type servers are exempt — they are SDK-managed transport placeholders,
//    not CLI-managed connections. The CLI never spawns a process or opens a
//    network connection for them; tool calls route back to the SDK via
//    mcp_tool_call."
//
// 拆开看：
//   ① sdk 类型的服务器**不是真的连接** —— 它是个传输占位符
//   ② CLI 为它既不 spawn 进程，也不开网络连接
//   ③ 工具调用通过 `mcp_tool_call` **回到 SDK 自己**去执行
//
// 所以：
//   · URL 白名单对它无意义（没有 url）
//   · command 白名单对它无意义（没有 command）
//   · 只按名字拦 → 会**静默丢掉**它
//
// 而丢掉它的后果是什么？注释点出了具体场景：
//   `installPluginsAndApplyMcpInBackground` 里的 `sdkMcpConfigs` carry-forward。
//
// 【安全含义：豁免是否合理？】
//
//   合理，但前提是"SDK 会自己负责安全"。
//   CLI 不执行任何东西，它只是把工具描述转给 SDK —— 真正的执行在宿主进程里，
//   由宿主自己信任的代码完成。企业策略管的是"CLI 不要连乱七八糟的外部服务"，
//   而 sdk 类型压根不是外部服务。
//
//   换句话说：**豁免的不是"这个服务器"，是"这个位置"** ——
//   这里放的是宿主自己的东西，不是配置里来的东西。
export function filterMcpServersByPolicy<T>(configs: Record<string, T>): {
  allowed: Record<string, T>
  blocked: string[]
} {
  const allowed: Record<string, T> = {}
  const blocked: string[] = []
  for (const [name, config] of Object.entries(configs)) {
    const c = config as McpServerConfig
    if (c.type === 'sdk' || isMcpServerAllowedByPolicy(name, c)) {
      allowed[name] = config
    } else {
      blocked.push(name)
    }
  }
  return { allowed, blocked }
}

// 【expandEnvVars：按类型分支，但一半分支是"原样返回"】
//
// 展开范围：
//   stdio           → command / args[] / env{}          （全展开）
//   sse/http/ws     → url / headers{}                   （全展开）
//   sse-ide         → 不展开
//   ws-ide          → 不展开
//   sdk             → 不展开
//   claudeai-proxy  → 不展开
//
// ── 为什么 IDE 类型不展开 ──
//
//   `sse-ide` / `ws-ide` 的 URL 是 **IDE 自己在运行时给的**
//   （通常是 `http://localhost:<随机端口>/sse`）。
//   它不来自配置文件，也没有任何变量可展开。
//   强行扫一遍只是浪费，而且万一 URL 里恰好有 `${...}` 形状的字符
//   （几乎不可能，但）会被误展开。
//
// ── 为什么 claudeai-proxy 不展开 ──
//
//   因为它的 URL 是**服务端下发的**，下发时已经处理完了。
//   在客户端再展开一遍等于对已展开的内容做第二次插值 —— 如果有
//   变量值本身包含 `${...}`，会被二次展开，这是模板注入的经典形态。
//
// 【missingVars 用 Set 去重（614 行）】
//
//   因为同一个变量可能在 command、args、env 里出现多次。
//   不去重的话，报错信息会变成
//   "Missing environment variables: TOKEN, TOKEN, TOKEN" 这种。
//
// 【注意 missingVars 是"累积"的，不是"遇错即停"】
//
//   `expandString` 把每次的缺失变量 push 进同一个数组，然后继续展开下一个。
//   所以用户能一次看到**所有**缺失的变量，而不是修一个报一个。
//   这是配置校验里值得学的处理方式：**收集全部错误再报告**。
/**
 * Internal utility: Expands environment variables in an MCP server config
 */
function expandEnvVars(config: McpServerConfig): {
  expanded: McpServerConfig
  missingVars: string[]
} {
  const missingVars: string[] = []

  function expandString(str: string): string {
    const { expanded, missingVars: vars } = expandEnvVarsInString(str)
    missingVars.push(...vars)
    return expanded
  }

  let expanded: McpServerConfig

  switch (config.type) {
    case undefined:
    case 'stdio': {
      const stdioConfig = config as McpStdioServerConfig
      expanded = {
        ...stdioConfig,
        command: expandString(stdioConfig.command),
        args: stdioConfig.args.map(expandString),
        env: stdioConfig.env
          ? mapValues(stdioConfig.env, expandString)
          : undefined,
      }
      break
    }
    case 'sse':
    case 'http':
    case 'ws': {
      const remoteConfig = config as
        | McpSSEServerConfig
        | McpHTTPServerConfig
        | McpWebSocketServerConfig
      expanded = {
        ...remoteConfig,
        url: expandString(remoteConfig.url),
        headers: remoteConfig.headers
          ? mapValues(remoteConfig.headers, expandString)
          : undefined,
      }
      break
    }
    case 'sse-ide':
    case 'ws-ide':
      expanded = config
      break
    case 'sdk':
      expanded = config
      break
    case 'claudeai-proxy':
      expanded = config
      break
  }

  return {
    expanded,
    missingVars: [...new Set(missingVars)],
  }
}

// 【addMcpConfig：八道检查，顺序有讲究】
//
// 按代码顺序：
//   ① 名字字符集（630）        —— 字母/数字/连字符/下划线
//   ② 保留名 claude-in-chrome（637）
//   ③ 保留名 computer-use（641，条件编译）
//   ④ 企业配置存在则直接拒绝（651）
//   ⑤ schema 校验（658）
//   ⑥ 黑名单（668）
//   ⑦ 白名单（675）
//   ⑧ 目标 scope 里是否已存在（682）
//
// ── 为什么 ④ 在 ⑤ 之前 ──
//
//   `doesEnterpriseMcpConfigExist()` 是 memoize 的、只读本地文件，很便宜。
//   策略拒绝不需要先验证 schema —— 反正无论如何都不让加。
//   先拒后验，能省掉一次 schema 解析，也能让错误信息更直接
//   （"企业配置独占"比"你的 JSON 有个字段错了"更接近根本原因）。
//
// ── 为什么 ⑤ 在 ⑥⑦ 之前 ──
//
//   因为黑名单/白名单要按 **command / url** 匹配，而匹配需要
//   `validatedConfig`（解析后的规范形态）。
//   拿原始 unknown 去匹配，字段名/类型都不可信。
//
//   注释里那句 "(needed for command-based policy checks)" 就是在说这个。
//
// ── ① 名字字符集的严格程度 ──
//
//   `/[^a-zA-Z0-9_-]/` 只允许这四类。为什么这么严？
//   因为这个名字会被拼进 **工具名**：`mcp__<server>__<tool>`。
//   如果允许点号、空格、冒号，工具名就可能出现非法字符，
//   而 MCP 工具名在 API 里是有字符集限制的（以及会被模型当标识符读）。
//
//   同样，这个名字还会进 `plugin:x:y` 那种冒号分隔的命名空间，
//   名字里带冒号会破坏解析。
//
// ── ②③ 两个保留名 ──
//
//   `claude-in-chrome`（637）：浏览器扩展用的服务器名，被占用。
//   `computer-use`（645）：同理，但代码在 `feature('CHICAGO_MCP')` 里 ——
//   这个特性关闭时，连检查带 import 一起被 DCE 删掉。
//
//   注意这里用的是 `await import(...)` 而不是顶层 import：
//   在 async 函数里可以动态加载，同样能达到"特性关闭时不加载"的效果。
//   代价是每次调用 addMcpConfig 都要过一次动态 import（有模块缓存）。
/**
 * Add a new MCP server configuration
 * @param name The name of the server
 * @param config The server configuration
 * @param scope The configuration scope
 * @throws Error if name is invalid or server already exists, or if the config is invalid
 */
export async function addMcpConfig(
  name: string,
  config: unknown,
  scope: ConfigScope,
): Promise<void> {
  if (name.match(/[^a-zA-Z0-9_-]/)) {
    throw new Error(
      `Invalid name ${name}. Names can only contain letters, numbers, hyphens, and underscores.`,
    )
  }

  // Block reserved server name "claude-in-chrome"
  if (isClaudeInChromeMCPServer(name)) {
    throw new Error(`Cannot add MCP server "${name}": this name is reserved.`)
  }

  if (feature('CHICAGO_MCP')) {
    const { isComputerUseMCPServer } = await import(
      '../../utils/computerUse/common.js'
    )
    if (isComputerUseMCPServer(name)) {
      throw new Error(`Cannot add MCP server "${name}": this name is reserved.`)
    }
  }

  // Block adding servers when enterprise MCP config exists (it has exclusive control)
  if (doesEnterpriseMcpConfigExist()) {
    throw new Error(
      `Cannot add MCP server: enterprise MCP configuration is active and has exclusive control over MCP servers`,
    )
  }

  // Validate config first (needed for command-based policy checks)
  const result = McpServerConfigSchema().safeParse(config)
  if (!result.success) {
    const formattedErrors = result.error.issues
      .map(err => `${err.path.join('.')}: ${err.message}`)
      .join(', ')
    throw new Error(`Invalid configuration: ${formattedErrors}`)
  }
  const validatedConfig = result.data

  // Check denylist (with config for command-based checks)
  if (isMcpServerDenied(name, validatedConfig)) {
    throw new Error(
      `Cannot add MCP server "${name}": server is explicitly blocked by enterprise policy`,
    )
  }

  // Check allowlist (with config for command-based checks)
  if (!isMcpServerAllowedByPolicy(name, validatedConfig)) {
    throw new Error(
      `Cannot add MCP server "${name}": not allowed by enterprise policy`,
    )
  }
// 【重复检查：三种 scope 三个"存在性"来源】
//
//   project → getProjectMcpConfigsFromCwd()  （读当前目录的 .mcp.json）
//   user    → getGlobalConfig().mcpServers
//   local   → getCurrentProjectConfig().mcpServers
//
// 注意 project 用的是 `getProjectMcpConfigsFromCwd()` 而不是
// `getMcpConfigsByScope('project')` —— 这两个差别很大：
//
//   getProjectMcpConfigsFromCwd()  → **只看当前目录**，不向上遍历
//   getMcpConfigsByScope('project') → 从根目录一路找到 CWD，逐级合并
//
// 为什么这里必须用"只看当前目录"的版本？
//
//   因为接下来要**写回 .mcp.json**。如果读到的是多级合并的结果，
//   写回去就会把父目录的服务器**复制**进当前目录的文件里 ——
//   一次 add 操作凭空造出一堆重复配置。
//
// 【这是一个"读-改-写"操作里非常容易犯的错】
//
//   读的时候要读"逻辑视图"（合并后），写的时候必须写"物理视图"（单个文件）。
//   两者混用，就会把合并态固化到某一层。
//   注释里那句 "Used by addMcpConfig and removeMcpConfig to modify the
//   local .mcp.json file" 就是在标记这个约束。

  // Check if server already exists in the target scope
  switch (scope) {
    case 'project': {
      const { servers } = getProjectMcpConfigsFromCwd()
      if (servers[name]) {
        throw new Error(`MCP server ${name} already exists in .mcp.json`)
      }
      break
    }
    case 'user': {
      const globalConfig = getGlobalConfig()
      if (globalConfig.mcpServers?.[name]) {
        throw new Error(`MCP server ${name} already exists in user config`)
      }
      break
    }
    case 'local': {
      const projectConfig = getCurrentProjectConfig()
      if (projectConfig.mcpServers?.[name]) {
        throw new Error(`MCP server ${name} already exists in local config`)
      }
      break
    }
// 【dynamic / enterprise / claudeai 三个 scope 直接抛错（704-709）】
//
// 这三个是**只读来源**，不能从 CLI 添加：
//
//   dynamic     → 运行时由 SDK / 控制消息临时塞进来的，没有持久化位置
//   enterprise  → 系统级文件，普通用户没权限也不该改（企业独占的前提）
//   claudeai    → 服务端下发的，要改得去网页端
//
// 这三次 throw 看起来像防御性代码，实际上是在**明确能力边界**：
// 报错比"静默忽略"好，因为用户会立刻知道"这条路不通"。
//
// 后面那个 switch（713-760）里还有一个 `default: throw` ——
// 那是因为 TS 的穷尽性检查会在 `default` 里把 scope 收窄成 `never`，
// 但运行时仍可能传入未预料的值。多一道保险。
    case 'dynamic':
      throw new Error('Cannot add MCP server to scope: dynamic')
    case 'enterprise':
      throw new Error('Cannot add MCP server to scope: enterprise')
    case 'claudeai':
      throw new Error('Cannot add MCP server to scope: claudeai')
  }

// 【写回 .mcp.json 那段有个细节：`const { scope: _, ...configWithoutScope }`】
//
// 为什么要剥掉 scope？
//   因为 `existingServers` 里的每一项都被 `addScopeToServers` 贴过
//   `scope: 'project'` 标签。这个标签是**服务内部的**，
//   不属于文件格式。
//
//   如果不剥，写出来的 .mcp.json 会长这样：
//
//     { "mcpServers": { "foo": { "command": "npx", "scope": "project" } } }
//
//   下次读回来，schema 会把它当未知字段（或者更糟：如果 schema 允许
//   额外字段，会一直带着这个脏数据）。
//
// 【`scope: _` 这个写法】
//
//   解构时用下划线命名，只是为了"我知道这个变量存在但不用它"。
//   它不会有未使用变量的 lint 警告（因为下划线前缀通常被配置为例外），
//   同时明确告诉读者：这里确实有个 scope 字段，我是故意丢掉的。
//
//   比起 `delete config.scope`（会修改原对象）或
//   `JSON.parse(JSON.stringify(...))`（贵且丢类型），
//   解构排除是最干净的做法。
  // Add based on scope
  switch (scope) {
    case 'project': {
      const { servers: existingServers } = getProjectMcpConfigsFromCwd()

      const mcpServers: Record<string, McpServerConfig> = {}
      for (const [serverName, serverConfig] of Object.entries(
        existingServers,
      )) {
        const { scope: _, ...configWithoutScope } = serverConfig
        mcpServers[serverName] = configWithoutScope
      }
      mcpServers[name] = validatedConfig
      const mcpConfig = { mcpServers }

      // Write back to .mcp.json
      try {
        await writeMcpjsonFile(mcpConfig)
      } catch (error) {
        throw new Error(`Failed to write to .mcp.json: ${error}`)
      }
      break
    }

    case 'user': {
      saveGlobalConfig(current => ({
        ...current,
        mcpServers: {
          ...current.mcpServers,
          [name]: validatedConfig,
        },
      }))
      break
    }

    case 'local': {
      saveCurrentProjectConfig(current => ({
        ...current,
        mcpServers: {
          ...current.mcpServers,
          [name]: validatedConfig,
        },
      }))
      break
    }

    default:
      throw new Error(`Cannot add MCP server to scope: ${scope}`)
  }
}

// 【removeMcpConfig：和 add 镜像对称，但少了三道检查】
//
// 有：名字 → 是否存在于目标 scope → 写回
// 没有：schema 校验（不需要，我们是在删东西）
// 没有：策略检查（不需要，删除永远不违反策略）
// 没有：企业独占检查（不需要，删除 .mcp.json 不影响企业配置）
//
// 【这里体现了一条设计原则：**
//   策略检查只拦"增加能力"的操作，不拦"减少能力"的操作。
//   删掉一个服务器不会打开新的攻击面，所以不需要过白名单。
//   如果这里也做策略检查，会出现"企业禁止了 X，导致用户**无法删除** X"
//   这种荒谬情况。
//
// 【注意 project 分支的 `if (!existingServers[name]) throw`（777）】
//   删除一个不存在的服务器为什么要报错？
//   因为静默成功会让用户以为删掉了。报错让他知道"你要删的东西不在这个 scope"——
//   这个反馈在配置混乱时（同名服务器在多个 scope 都存在）特别有用。
/**
 * Remove an MCP server configuration
 * @param name The name of the server to remove
 * @param scope The configuration scope
 * @throws Error if server not found in specified scope
 */
export async function removeMcpConfig(
  name: string,
  scope: ConfigScope,
): Promise<void> {
  switch (scope) {
    case 'project': {
      const { servers: existingServers } = getProjectMcpConfigsFromCwd()

      if (!existingServers[name]) {
        throw new Error(`No MCP server found with name: ${name} in .mcp.json`)
      }

      // Strip scope information when writing back to .mcp.json
      const mcpServers: Record<string, McpServerConfig> = {}
      for (const [serverName, serverConfig] of Object.entries(
        existingServers,
      )) {
        if (serverName !== name) {
          const { scope: _, ...configWithoutScope } = serverConfig
          mcpServers[serverName] = configWithoutScope
        }
      }
      const mcpConfig = { mcpServers }
      try {
        await writeMcpjsonFile(mcpConfig)
      } catch (error) {
        throw new Error(`Failed to remove from .mcp.json: ${error}`)
      }
      break
    }

    case 'user': {
      const config = getGlobalConfig()
      if (!config.mcpServers?.[name]) {
        throw new Error(`No user-scoped MCP server found with name: ${name}`)
      }
      saveGlobalConfig(current => {
        const { [name]: _, ...restMcpServers } = current.mcpServers ?? {}
        return {
          ...current,
          mcpServers: restMcpServers,
        }
      })
      break
    }

    case 'local': {
      // Check if server exists before updating
      const config = getCurrentProjectConfig()
      if (!config.mcpServers?.[name]) {
        throw new Error(`No project-local MCP server found with name: ${name}`)
      }
      saveCurrentProjectConfig(current => {
        const { [name]: _, ...restMcpServers } = current.mcpServers ?? {}
        return {
          ...current,
          mcpServers: restMcpServers,
        }
      })
      break
    }

    default:
      throw new Error(`Cannot remove MCP server from scope: ${scope}`)
  }
}

// 【getProjectMcpConfigsFromCwd：只读当前目录，且缺文件不算错】
//
// 两个"容错"细节：
//
// ── ① 缺文件不是错误（860-873）──
//
//   先看代码逻辑：`parseMcpConfigFromFilePath` 对 ENOENT 会返回一条
//   `MCP config file not found` 的 error。这里把这个 error **过滤掉**，
//   只看剩下的"真错误"。
//
//   为什么要过滤？因为**大多数目录没有 .mcp.json**。
//   向上遍历时会走十几个目录，如果每个缺失都当错误，
//   日志会被刷满，用户也会看到一堆无意义的警告。
//
//   但注意它过滤的方式：`e.message.startsWith('MCP config file not found')`。
//   **用错误消息的字符串前缀判断错误类型** —— 这是脆弱的：
//   改一下那句文案，这个过滤就失效，缺失文件会突然变成错误。
//
//   更好的做法是给 ValidationError 加一个 `code` 字段（像 errno 那样），
//   按 code 判而不是按文案判。这是本项目里反复出现的"
//   用自然语言当结构化数据"的模式（withRetry.ts 里解析 PTL 错误消息
//   也是同一类问题）。
//
// ── ② `isSettingSourceEnabled('projectSettings')` 提前返回（848）──
//
//   如果项目级设置在策略上被禁用（企业只允许 managed 设置），
//   就直接返回空，连文件都不读。
//
//   这是"策略前置"而不是"读完再过滤"：
//   读文件本身可能有副作用（触发 hooks、产生访问日志），
//   在明确不该读的时候就不该读。
/**
 * Get MCP configs from current directory only (no parent traversal).
 * Used by addMcpConfig and removeMcpConfig to modify the local .mcp.json file.
 * Exported for testing purposes.
 *
 * @returns Servers with scope information and any validation errors from current directory's .mcp.json
 */
export function getProjectMcpConfigsFromCwd(): {
  servers: Record<string, ScopedMcpServerConfig>
  errors: ValidationError[]
} {
  // Check if project source is enabled
  if (!isSettingSourceEnabled('projectSettings')) {
    return { servers: {}, errors: [] }
  }

  const mcpJsonPath = join(getCwd(), '.mcp.json')

  const { config, errors } = parseMcpConfigFromFilePath({
    filePath: mcpJsonPath,
    expandVars: true,
    scope: 'project',
  })

  // Missing .mcp.json is expected, but malformed files should report errors
  if (!config) {
    const nonMissingErrors = errors.filter(
      e => !e.message.startsWith('MCP config file not found'),
    )
    if (nonMissingErrors.length > 0) {
      logForDebugging(
        `MCP config errors for ${mcpJsonPath}: ${jsonStringify(nonMissingErrors.map(e => e.message))}`,
        { level: 'error' },
      )
      return { servers: {}, errors: nonMissingErrors }
    }
    return { servers: {}, errors: [] }
  }

  return {
    servers: config.mcpServers
      ? addScopeToServers(config.mcpServers, 'project')
      : {},
    errors: errors || [],
  }
}

// 【getMcpConfigsByScope：单来源读取，但 project 分支要向上遍历】
//
// 四个 scope 的处理方式：
//
//   project    → **从根目录找到 CWD**，逐级读 .mcp.json 并合并（909-961）
//   user       → 读全局配置的 mcpServers（962-978）
//   local      → 读当前项目配置的 mcpServers（979-995）
//   enterprise → 读 managed-mcp.json（996-1024）
//
// ── project 分支那 50 行值得细看 ──
//
//   ① 先收集路径（913-920）：
//        while (currentDir !== parse(currentDir).root) {
//          dirs.push(currentDir)
//          currentDir = dirname(currentDir)
//        }
//      从 CWD 一路往上到根，但**不含根目录本身**。
//      不含根是有意的：盘符根（C:/ 或 /）下放 .mcp.json 不是正常用法，
//      而且 Windows 上根目录常常不可读，硬读会产生权限错误。
//
//   ② 然后是 `dirs.reverse()`（923）：
//      收集时是从 CWD 往根，处理时要**从根往 CWD**。
//      因为后面用 `Object.assign(allServers, ...)` 合并，
//      后赋值的赢 —— 所以处理顺序必须是"远的先、近的后"。
//
//      【这是"收集顺序"和"处理顺序"必须相反」的典型场景。
//       如果忘了 reverse，就近的配置会被父目录的覆盖 ——
//       方向反了，而且没有任何报错。】
//
// ── user / local 分支都走 parseMcpConfig，不读文件 ──
//
//   因为这两处的配置已经在内存里了（`getGlobalConfig()` /
//   `getCurrentProjectConfig()` 是内存对象）。
//   所以它们用 `parseMcpConfig({ configObject: { mcpServers } })`
//   而不是 `parseMcpConfigFromFilePath`。
//
//   注意它传的是 `{ mcpServers }` —— 包了一层，
//   因为 schema 校验的是整个 `McpJsonConfig`（`{ mcpServers: {...} }`），
//   不是单纯的服务器字典。
//
// ── enterprise 分支和 project 一样处理"缺文件" ──
//
//   逻辑完全同构（1005-1018），只是日志文案不同。
//   这种重复在四个分支里出现了两次，可以抽函数，但作者没抽 ——
//   因为抽出来要传 filePath、scope、日志前缀三个参数，
//   收益不明显。
/**
 * Get all MCP configurations from a specific scope
 * @param scope The configuration scope
 * @returns Servers with scope information and any validation errors
 */
export function getMcpConfigsByScope(
  scope: 'project' | 'user' | 'local' | 'enterprise',
): {
  servers: Record<string, ScopedMcpServerConfig>
  errors: ValidationError[]
} {
  // Check if this source is enabled
  const sourceMap: Record<
    string,
    'projectSettings' | 'userSettings' | 'localSettings'
  > = {
    project: 'projectSettings',
    user: 'userSettings',
    local: 'localSettings',
  }

  if (scope in sourceMap && !isSettingSourceEnabled(sourceMap[scope]!)) {
    return { servers: {}, errors: [] }
  }

  switch (scope) {
    case 'project': {
      const allServers: Record<string, ScopedMcpServerConfig> = {}
      const allErrors: ValidationError[] = []

      // Build list of directories to check
      const dirs: string[] = []
      let currentDir = getCwd()

      while (currentDir !== parse(currentDir).root) {
        dirs.push(currentDir)
        currentDir = dirname(currentDir)
      }

      // Process from root downward to CWD (so closer files have higher priority)
      for (const dir of dirs.reverse()) {
        const mcpJsonPath = join(dir, '.mcp.json')

        const { config, errors } = parseMcpConfigFromFilePath({
          filePath: mcpJsonPath,
          expandVars: true,
          scope: 'project',
        })

        // Missing .mcp.json in parent directories is expected, but malformed files should report errors
        if (!config) {
          const nonMissingErrors = errors.filter(
            e => !e.message.startsWith('MCP config file not found'),
          )
          if (nonMissingErrors.length > 0) {
            logForDebugging(
              `MCP config errors for ${mcpJsonPath}: ${jsonStringify(nonMissingErrors.map(e => e.message))}`,
              { level: 'error' },
            )
            allErrors.push(...nonMissingErrors)
          }
          continue
        }

        if (config.mcpServers) {
          // Merge servers, with files closer to CWD overriding parent configs
          Object.assign(allServers, addScopeToServers(config.mcpServers, scope))
        }

        if (errors.length > 0) {
          allErrors.push(...errors)
        }
      }

      return {
        servers: allServers,
        errors: allErrors,
      }
    }
    case 'user': {
      const mcpServers = getGlobalConfig().mcpServers
      if (!mcpServers) {
        return { servers: {}, errors: [] }
      }

      const { config, errors } = parseMcpConfig({
        configObject: { mcpServers },
        expandVars: true,
        scope: 'user',
      })

      return {
        servers: addScopeToServers(config?.mcpServers, scope),
        errors,
      }
    }
    case 'local': {
      const mcpServers = getCurrentProjectConfig().mcpServers
      if (!mcpServers) {
        return { servers: {}, errors: [] }
      }

      const { config, errors } = parseMcpConfig({
        configObject: { mcpServers },
        expandVars: true,
        scope: 'local',
      })

      return {
        servers: addScopeToServers(config?.mcpServers, scope),
        errors,
      }
    }
    case 'enterprise': {
      const enterpriseMcpPath = getEnterpriseMcpFilePath()

      const { config, errors } = parseMcpConfigFromFilePath({
        filePath: enterpriseMcpPath,
        expandVars: true,
        scope: 'enterprise',
      })

      // Missing enterprise config file is expected, but malformed files should report errors
      if (!config) {
        const nonMissingErrors = errors.filter(
          e => !e.message.startsWith('MCP config file not found'),
        )
        if (nonMissingErrors.length > 0) {
          logForDebugging(
            `Enterprise MCP config errors for ${enterpriseMcpPath}: ${jsonStringify(nonMissingErrors.map(e => e.message))}`,
            { level: 'error' },
          )
          return { servers: {}, errors: nonMissingErrors }
        }
        return { servers: {}, errors: [] }
      }

      return {
        servers: addScopeToServers(config.mcpServers, scope),
        errors,
      }
    }
  }
}

// 【getMcpConfigByName：优先级在这里第一次以"显式 if 序列"现身】
//
// 顺序：enterprise → local → project → user
//
// 注意这个顺序**和合并时不同**（合并是 plugin < user < project < local，
// 即 local 最高）。这里 enterprise 排第一，是因为它一旦存在就独占，
// 同时 `getMcpConfigByName` 在 plugin-only 模式下只返回 enterprise。
//
// ── 为什么不用循环 / map 查找 ──
//
//   因为每一层都要**单独取一次**（`getMcpConfigsByScope` 每次调用都有开销：
//   读文件、解析、展开变量）。写成 map 也得先全部取一遍。
//
//   而这个函数是"按名查一个"的场景，理论上可以早期退出 ——
//   但代码没有这么做：它先把四层全取了，再按优先级找。
//
//   这是个**可以优化但没优化**的点：如果 enterprise 里就有，
//   local/project/user 三次读取是白读的。
//   不过在配置量级（几十个服务器、4 个文件）下无所谓，
//   而且早期退出会让 `isRestrictedToPluginOnly` 那段逻辑变复杂。
//
// ── plugin-only 模式的特殊处理（1038-1040）──
//
//   `if (isRestrictedToPluginOnly('mcp')) return enterpriseServers[name] ?? null`
//
//   直接返回，连 user/project/local 都不读。
//   注释说 "same as getClaudeCodeMcpConfigs()" —— 两处必须一致，
//   否则会出现"能按名查到但连接时不加载"或者反过来的不一致。
//
//   【这类"两个入口必须保持相同规则"的地方，最安全的做法是抽成一个
//     判定函数。这里没有抽，只靠注释标记一致性 —— 是个潜在漂移点。】
/**
 * Get an MCP server configuration by name
 * @param name The name of the server
 * @returns The server configuration with scope, or undefined if not found
 */
export function getMcpConfigByName(name: string): ScopedMcpServerConfig | null {
  const { servers: enterpriseServers } = getMcpConfigsByScope('enterprise')

  // When MCP is locked to plugin-only, only enterprise servers are reachable
  // by name. User/project/local servers are blocked — same as getClaudeCodeMcpConfigs().
  if (isRestrictedToPluginOnly('mcp')) {
    return enterpriseServers[name] ?? null
  }

  const { servers: userServers } = getMcpConfigsByScope('user')
  const { servers: projectServers } = getMcpConfigsByScope('project')
  const { servers: localServers } = getMcpConfigsByScope('local')

  if (enterpriseServers[name]) {
    return enterpriseServers[name]
  }
  if (localServers[name]) {
    return localServers[name]
  }
  if (projectServers[name]) {
    return projectServers[name]
  }
  if (userServers[name]) {
    return userServers[name]
  }

  return null
}

// 【getClaudeCodeMcpConfigs：全文件的主函数，170 行】
//
// 它做的事，按顺序：
//
//   ① enterprise 存在 → 只返回 enterprise（独占）
//   ② 否则读 user / project / local（plugin-only 模式下跳过）
//   ③ 加载插件的 MCP 服务器（异步，可能含下载）
//   ④ 过滤 project 服务器：只留"已审批"的
//   ⑤ 收集"会真正连接的"手工服务器，作为去重靶子
//   ⑥ 插件服务器拆成 enabled / disabled 两堆，只对 enabled 做去重
//   ⑦ 合并（plugin < user < project < local）
//   ⑧ 策略过滤
//
// 【JSDoc 里那句 "This is fast" 是设计承诺，不是描述】
//
//   "only local file reads; no awaited network calls on the critical path"
//
//   这个函数在**启动路径**上（每次 `claude` 启动都要调）。
//   所以它不能等网络。claude.ai 连接器要联网拉，那部分被拆出去了
//   （`getAllMcpConfigs` 才做）。
//
//   但 `loadAllPluginsCacheOnly()` 也可能慢（读插件目录）。
//   所以有 `extraDedupTargets` 这个参数 —— 把"可能要等的东西"
//   以 **Promise 的形式**传进来，让本函数在合适的时机才 await 它。
//
//   【把 Promise 当参数传，是这个文件里最漂亮的一处并发设计，见
//     getAllMcpConfigs 的批注（p4）。】
/**
 * Get Claude Code MCP configurations (excludes claude.ai servers from the
 * returned set — they're fetched separately and merged by callers).
 * This is fast: only local file reads; no awaited network calls on the
 * critical path. The optional extraDedupTargets promise (e.g. the in-flight
 * claude.ai connector fetch) is awaited only after loadAllPluginsCacheOnly() completes,
 * so the two overlap rather than serialize.
 * @returns Claude Code server configurations with appropriate scopes
 */
export async function getClaudeCodeMcpConfigs(
  dynamicServers: Record<string, ScopedMcpServerConfig> = {},
  extraDedupTargets: Promise<
    Record<string, ScopedMcpServerConfig>
  > = Promise.resolve({}),
): Promise<{
  servers: Record<string, ScopedMcpServerConfig>
  errors: PluginError[]
}> {
  const { servers: enterpriseServers } = getMcpConfigsByScope('enterprise')

// 【第一道分叉：enterprise 独占，连插件都不留】
//
//    if (doesEnterpriseMcpConfigExist()) {
//      // 只过滤 enterprise 自己的服务器，然后直接 return
//    }
//
// 注释原话：
//   "If an enterprise mcp config exists, do not use any others; this has
//    exclusive control over all MCP servers (enterprise customers often do
//    not want their users to be able to add their own MCP servers)."
//
// 【注意这里有一个"多余的"策略过滤（1086-1093）】
//
//   既然已经独占 enterprise 了，为什么还要 `isMcpServerAllowedByPolicy`？
//
//   因为企业配置里也可能有**该被自己的白名单排除**的条目
//   （配置写错了、或者白名单后来收紧了）。
//   不加这一步，企业自己的配置就能绕过企业自己的白名单。
//
//   【原则：策略检查要在**每一个**出口做，不能假设"来源可信就不检查"。】
//   这里的来源是企业的，但检查依然要做 —— 因为策略和配置是两份文件，
//   它们可能不同步。
  // If an enterprise mcp config exists, do not use any others; this has exclusive control over all MCP servers
  // (enterprise customers often do not want their users to be able to add their own MCP servers).
  if (doesEnterpriseMcpConfigExist()) {
    // Apply policy filtering to enterprise servers
    const filtered: Record<string, ScopedMcpServerConfig> = {}

    for (const [name, serverConfig] of Object.entries(enterpriseServers)) {
      if (!isMcpServerAllowedByPolicy(name, serverConfig)) {
        continue
      }
      filtered[name] = serverConfig
    }

    return { servers: filtered, errors: [] }
  }

// 【第二道分叉：plugin-only 锁定 —— 和上面那个独占**不一样**】
//
//   const mcpLocked = isRestrictedToPluginOnly('mcp')
//   const noServers = { servers: {} }
//   const { servers: userServers } = mcpLocked ? noServers : getMcpConfigsByScope('user')
//   ... project、local 同理
//
// 注释原话：
//   "Unlike the enterprise-exclusive block above, this keeps plugin servers."
//
// ── 两者对比 ──
//
//   条件                                   | 保留插件？| 保留 user/project/local？
//   --------------------------------------|---------|-----------------------
//   doesEnterpriseMcpConfigExist()         | 否       | 否
//   isRestrictedToPluginOnly('mcp')        | 是       | 否
//
// ── 为什么 plugin-only 要保留插件 ──
//
//   因为它的**语义是"只信任插件"**，不是"只信任企业"。
//   插件是经过审核、可审计的分发渠道；用户自己写的 .mcp.json
//   和命令行加的服务器是不可控的。
//
//   所以 plugin-only 的意思是：企业配置 + 插件 = 允许，
//   用户临时加的 = 不允许。
//
//   「两个都"锁定"，但锁的对象不同」—— 这是配置系统里很典型的
//   命名陷阱：`isRestrictedToPluginOnly` 这个名字说的是
//   "restricted to plugin (only)"，不是 "restricted, to plugin only"。
//
// ── 为什么用 `noServers` 这个共享常量而不是字面量 `{ servers: {} }` 三次 ──
//
//   只是省字节。注意它是**同一个对象**被赋给三个变量 ——
//   如果下游有人改 `userServers.foo = ...`，会同时影响另外两个。
//   这里安全，因为解构后只读。但这是一个"共享空对象"的隐患，
//   换成 `{}` 字面量更安全（多写 20 个字符）。
  // Load other scopes — unless the managed policy locks MCP to plugin-only.
  // Unlike the enterprise-exclusive block above, this keeps plugin servers.
  const mcpLocked = isRestrictedToPluginOnly('mcp')
  const noServers: { servers: Record<string, ScopedMcpServerConfig> } = {
    servers: {},
  }
  const { servers: userServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('user')
  const { servers: projectServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('project')
  const { servers: localServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('local')

// 【加载插件服务器：一个"错误分级"的示范】
//
//    const pluginResult = await loadAllPluginsCacheOnly()
//
// 注意函数名里的 **CacheOnly** —— 它只读已有的插件缓存，不触发下载。
// 因为有下载就会慢，而这是启动路径。
//
// ── 错误处理分两类（1123-1144）──
//
//   第一类（**真的错误**，走 logError）：
//     mcp-config-invalid / mcpb-download-failed /
//     mcpb-extract-failed / mcpb-invalid-manifest
//   → 这四个都表示"插件里声称有 MCP 服务器，但拿不到/解析不了"。
//     这是配置问题，用户该知道。
//
//   第二类（**正常情况**，走 logForDebugging）：
//     其他所有错误类型
//   → 注释原话："Plugin doesn't exist or isn't available - this is common
//     and not necessarily an error. The plugin system will handle installing
//     it if possible."
//
// 【这个分级的意义】
//
//   插件系统有"声明了但没装"的常态。如果这也当错误报，
//   用户每次启动都会看到一堆"插件不存在"的红字 —— 噪音掩盖真问题。
//
//   而 mcpb（MCP Bundle）相关的四种失败是**具体的、可行动的**错误，
//   应该显式说出来。
//
//   这一段体现了日志分级的原则：**按"用户能否行动"分级，不按"技术上是否异常"分级。**
//   一个"正常但需要用户处理"的情况（插件没装）比"异常但无害"的情况更该报。
//
// ── 并行加载（1147-1154）──
//
//     const pluginServerResults = await Promise.all(
//       pluginResult.enabled.map(plugin => getPluginMcpServers(plugin, mcpErrors)),
//     )
//
//   所有启用插件**并行**取 MCP 服务器。
//   注意 `mcpErrors` 这个数组被**所有** promise 共享并 push ——
//   依赖 JS 单线程（事件循环）保证不会有数据竞争。
//   在别的语言里这种写法需要加锁，在 JS 里是安全的，但要注意
//   push 的顺序不确定（取决于哪个插件先完成）。
  // Load plugin MCP servers
  const pluginMcpServers: Record<string, ScopedMcpServerConfig> = {}

  const pluginResult = await loadAllPluginsCacheOnly()

  // Collect MCP-specific errors during server loading
  const mcpErrors: PluginError[] = []

  // Log any plugin loading errors - NEVER silently fail in production
  if (pluginResult.errors.length > 0) {
    for (const error of pluginResult.errors) {
      // Only log as MCP error if it's actually MCP-related
      // Otherwise just log as debug since the plugin might not have MCP servers
      if (
        error.type === 'mcp-config-invalid' ||
        error.type === 'mcpb-download-failed' ||
        error.type === 'mcpb-extract-failed' ||
        error.type === 'mcpb-invalid-manifest'
      ) {
        const errorMessage = `Plugin MCP loading error - ${error.type}: ${getPluginErrorMessage(error)}`
        logError(new Error(errorMessage))
      } else {
        // Plugin doesn't exist or isn't available - this is common and not necessarily an error
        // The plugin system will handle installing it if possible
        const errorType = error.type
        logForDebugging(
          `Plugin not available for MCP: ${error.source} - error type: ${errorType}`,
        )
      }
    }
  }

  // Process enabled plugins for MCP servers in parallel
  const pluginServerResults = await Promise.all(
    pluginResult.enabled.map(plugin => getPluginMcpServers(plugin, mcpErrors)),
  )
  for (const servers of pluginServerResults) {
    if (servers) {
      Object.assign(pluginMcpServers, servers)
    }
  }

  // Add any MCP-specific errors from server loading to plugin errors
  if (mcpErrors.length > 0) {
    for (const error of mcpErrors) {
      const errorMessage = `Plugin MCP server error - ${error.type}: ${getPluginErrorMessage(error)}`
      logError(new Error(errorMessage))
    }
  }

// 【project 服务器必须"已审批"才纳入（1164-1170）】
//
//     if (getProjectMcpServerStatus(name) === 'approved') { ... }
//
// ── 这是整个 MCP 体系里最重要的安全机制，值得单独讲 ──
//
//   `.mcp.json` 是**进版本控制**的 —— clone 一个仓库，就拿到了它的 .mcp.json。
//   而 .mcp.json 里可以写 `command: "node", args: ["evil.js"]`。
//
//   也就是说：**git clone 一个仓库 + 信任它 = 在自己的机器上执行
//   仓库作者指定的命令。**
//
//   这就是典型的"配置即代码执行"风险。
//
// ── 缓解方式是"每个服务器单独审批" ──
//
//   首次遇到 .mcp.json 里的某个服务器，状态是 `pending`（或
//   `rejected`/`changed`，如果内容变了），CLI 会问用户"要允许吗"。
//   只有 `approved` 的才会被真正加载。
//
//   状态存在 `getCurrentProjectMcpServerStatus()` 之类的本地记录里，
//   **不进版本控制** —— 所以别人批准过的服务器，在你这里还是 pending。
//
// ── 注意审批的粒度是"服务器名"，不是"文件" ──
//
//   这也是为什么内容变化要重置状态：如果审批按名字记，
//   攻击者可以保持名字不变、只改 command，就绕过了审批。
//   所以状态里必须包含内容指纹（通常就是 `getMcpServerSignature` 那一套）。
//
// ── 为什么 user / local 不需要审批 ──
//
//   因为它们不在版本控制里。用户自己写 `claude mcp add`，
//   或者在自己机器上的配置里写，那本来就是他的意图 ——
//   没有人能通过 clone 仓库来影响这两处。
//
//   【安全边界跟着"信任边界"走：能随仓库分发的东西要审批，
//     只能本机产生的东西不用。】
  // Filter project servers to only include approved ones
  const approvedProjectServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries(projectServers)) {
    if (getProjectMcpServerStatus(name) === 'approved') {
      approvedProjectServers[name] = config
    }
  }

  // Dedup plugin servers against manually-configured ones (and each other).
  // Plugin server keys are namespaced `plugin:x:y` so they never collide with
  // manual keys in the merge below — this content-based filter catches the case
  // where both would launch the same underlying process/connection.
  // Only servers that will actually connect are valid dedup targets — a
  // disabled manual server mustn't suppress a plugin server, or neither runs
  // (manual is skipped by name at connection time; plugin was removed here).
// 【`await extraDedupTargets` 的位置很讲究（1179）】
//
// 这个 await 在**插件全部加载完之后**：
//
//     const pluginResult = await loadAllPluginsCacheOnly()   // ← 磁盘 IO
//     ... 并行取各插件的 MCP 服务器 ...                        // ← 可能下载
//     const extraTargets = await extraDedupTargets            // ← 现在才等
//
// ── 为什么要放在这里，不放在函数开头 ──
//
//   `extraDedupTargets` 通常是"正在联网拉 claude.ai 连接器"的 promise
//   （见 getAllMcpConfigs）。它慢，且结果只用于**去重靶子**。
//
//   如果一开始就 await 它，整个函数就串行化了：
//       等网络（2s）→ 再读插件（0.5s）= 2.5s
//
//   放在插件加载之后，两者**重叠**：
//       开始读插件的同时，网络也在跑 → 总耗时 = max(2s, 0.5s) = 2s
//
//   这就是 JSDoc 里那句 "so the two overlap rather than serialize"。
//
// ── 这个模式的通用形态 ──
//
//   把"可能很慢的异步操作"以 **Promise（尚未 await）** 的形式传进来，
//   让被调方在"真正需要它的前一刻"才 await。
//
//   调用方负责**启动**，被调方负责**等待时机**。
//   这是把并发控制权和业务控制权分开的典型手法。
//
//   代价：函数签名变复杂（多一个 Promise 参数），
//   且依赖"被调方知道该在哪等"这个隐式知识。
//   所以必须写注释说明，否则后来的人会把它挪到函数开头 ——
//   功能完全不变，性能悄悄退化。
  const extraTargets = await extraDedupTargets
  const enabledManualServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries({
    ...userServers,
    ...approvedProjectServers,
    ...localServers,
    ...dynamicServers,
    ...extraTargets,
  })) {
    if (
      !isMcpServerDisabled(name) &&
      isMcpServerAllowedByPolicy(name, config)
    ) {
      enabledManualServers[name] = config
    }
  }
// 【把插件服务器拆成 enabled / disabled 两堆，是为了不破坏"先加载赢"】
//
// 注释原话（1195-1198）：
//   "Split off disabled/policy-blocked plugin servers so they don't win the
//    first-plugin-wins race against an enabled duplicate — same invariant as
//    above. They're merged back after dedup so they still appear in /mcp
//    (policy filtering at the end of this function drops blocked ones)."
//
// ── 还原这个故障 ──
//
//   假设插件 A 和插件 B 都声明了同一个 Slack 服务器（签名相同），
//   而 A 那个被用户禁用了：
//
//   ① 如果**不拆**：遍历时先遇到 A（禁用），`seenPluginSigs` 记下 A 的签名
//      → 后遇到 B（启用）时被判为"重复 A" → **B 被抑制**
//      → 结果：A 因为禁用不连，B 因为被抑制不连 → 两个都不跑
//
//   ② 拆开之后：A 进 disabled 堆，B 进 enabled 堆
//      → 只对 enabled 堆做去重 → B 存活
//      → 最后把 A 合并回来（它仍然出现在 /mcp 里，只是禁用状态）
//
// ── 这和第 290 行那条 `isMcpServerDisabled(name)) continue` 是同一个 bug 的两个位置 ──
//
//   一个是"手工服务器不能用自己的禁用身份去抑制连接器"，
//   一个是"插件服务器不能用自己的禁用身份赢下先加载比赛"。
//   形态完全一样：**禁用状态的东西不该参与"谁赢"的竞争**。
//
//   【这类规则应该抽成一个函数 —— 现在它在两个地方各写了一遍，
//     将来加第三种来源（比如另一种插件类型）时，很容易漏掉第三次。】
  // Split off disabled/policy-blocked plugin servers so they don't win the
  // first-plugin-wins race against an enabled duplicate — same invariant as
  // above. They're merged back after dedup so they still appear in /mcp
  // (policy filtering at the end of this function drops blocked ones).
  const enabledPluginServers: Record<string, ScopedMcpServerConfig> = {}
  const disabledPluginServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries(pluginMcpServers)) {
    if (
      isMcpServerDisabled(name) ||
      !isMcpServerAllowedByPolicy(name, config)
    ) {
      disabledPluginServers[name] = config
    } else {
      enabledPluginServers[name] = config
    }
  }
  const { servers: dedupedPluginServers, suppressed } = dedupPluginMcpServers(
    enabledPluginServers,
    enabledManualServers,
  )
  Object.assign(dedupedPluginServers, disabledPluginServers)
// 【把去重结果报给 UI 的那段，有个细节：注释强调"在 logError 循环之后"】
//
//   "Pushed AFTER the logError loop above so these don't go to the error log
//    — they're informational, not errors."
//
// 这看起来是个顺序问题，实际上是**消息通道复用**的处理：
// `mcpErrors` 这个数组同时承载两种东西 ——
//   · 真正的错误（会被 `logError` 逐条上报）
//   · 信息性提示（"某插件服务器和手工配置重复，已抑制"）
//
// 如果 push 在 logError 循环之前，这条提示就会被当成错误上报纸质日志。
//
// 【这是个"共享通道 + 时序控制"的脆弱设计】
//
//   用同一个数组装两种语义不同的东西，靠**push 的先后顺序**来区分处理方式。
//   将来任何人往这个数组里加东西，都必须知道"我加在循环前还是后，
//   决定了它是错误还是提示"。
//
//   更稳的做法是分成两个数组（`errors` 和 `notices`），
//   在返回时合流给 UI，但上报时分开处理。
//   这里的写法能工作，但需要注释来兜住 —— 而注释是会被忽略的。
//
// ── `name.split(':')` 那几行的脆弱之处 ──
//
//   `name` 形如 `plugin:插件名:服务器名`，代码用 split 拆出插件名和服务器名，
//   并校验 `parts[0] !== 'plugin' || parts.length < 3` 就跳过。
//
//   但 `parts.slice(2).join(':')` 又把后面几段合回去 ——
//   说明服务器名本身**可以含冒号**。而 `addMcpConfig` 里名字
//   是不许含冒号的（`/[^a-zA-Z0-9_-]/`），但插件里的服务器名
//   可能没走那个校验。
//
//   【这是"用分隔符拼标识符"的经典后果：拼的时候随意，拆的时候要猜。】
//   更稳的做法是用不可打印字符做分隔，或者干脆存成结构化对象。
  // Surface suppressions in /plugin UI. Pushed AFTER the logError loop above
  // so these don't go to the error log — they're informational, not errors.
  for (const { name, duplicateOf } of suppressed) {
    // name is "plugin:${pluginName}:${serverName}" from addPluginScopeToServers
    const parts = name.split(':')
    if (parts[0] !== 'plugin' || parts.length < 3) continue
    mcpErrors.push({
      type: 'mcp-server-suppressed-duplicate',
      source: name,
      plugin: parts[1]!,
      serverName: parts.slice(2).join(':'),
      duplicateOf,
    })
  }
// 【合并顺序：这一行注释是整个文件的优先级总表】
//
//     // Merge in order of precedence: plugin < user < project < local
//     const configs = Object.assign(
//       {},
//       dedupedPluginServers,
//       userServers,
//       approvedProjectServers,
//       localServers,
//     )
//
// `Object.assign` 是**后者覆盖前者**，所以从左到右优先级递增：
//   插件 < 用户 < 项目 < 本地
//
// ── 为什么项目（.mcp.json，团队共享）比用户（全局）高 ──
//
//   因为项目是"当前工作的具体上下文"。一个团队约定用某个版本的
//   MCP 服务器，就该项目内应该生效，哪怕用户的全局配置里有个同名但
//   不同参数的服务器。
//
//   这和 git 配置的层次直觉一致：仓库配置 > 全局配置。
//
// ── 为什么本地（local）最高 ──
//
//   local 是"我这个人在这个项目里的私有设置"，比 .mcp.json 更具体。
//   典型场景：团队共享的服务器需要额外加 `--verbose` 调试，
//   我就在 local 里覆盖，不影响别人。
//
// ── 注意 claude.ai 不在这条链里 ──
//
//   它在 `getAllMcpConfigs` 里以**最低**优先级合并
//   （`Object.assign({}, dedupedClaudeAi, claudeCodeServers)`）。
//   因为 claude.ai 连接器是"网页端点了一下启用"，意图强度最低。
//
// ── 一个重要的隐含事实 ──
//
//   覆盖是**按 key（服务器名）** 的，不是按签名。
//   所以如果项目里有个叫 `slack` 的、用户全局也有个叫 `slack` 的，
//   项目的会完全替换用户的 —— 即使它们连的是不同服务。
//   这是配置系统的常规行为，但值得知道：**名字冲突就是覆盖，没有合并**。

  // Merge in order of precedence: plugin < user < project < local
  const configs = Object.assign(
    {},
    dedupedPluginServers,
    userServers,
    approvedProjectServers,
    localServers,
  )

  // Apply policy filtering to merged configs
  const filtered: Record<string, ScopedMcpServerConfig> = {}

  for (const [name, serverConfig] of Object.entries(configs)) {
    if (!isMcpServerAllowedByPolicy(name, serverConfig as McpServerConfig)) {
      continue
    }
    filtered[name] = serverConfig as ScopedMcpServerConfig
  }

  return { servers: filtered, errors: mcpErrors }
}

// 【getAllMcpConfigs：慢版本，把 claude.ai 连接器也拉进来】
//
// 这个函数和 `getClaudeCodeMcpConfigs` 的关系：
//   后者 = 本地能算出来的（快，启动路径用）
//   前者 = 后者 + 网页端连接器（慢，需要完整列表时用）
//
// 【这里有一处非常漂亮的并发设计，值得逐行看】
//
//   ① 先"点火"，不 await（1269）：
//        const claudeaiPromise = fetchClaudeAIMcpConfigsIfEligible()
//
//   ② 把它**作为参数**传给快函数（1270-1273）：
//        const { servers } = await getClaudeCodeMcpConfigs({}, claudeaiPromise)
//
//   ③ 快函数内部在插件加载完之后才 await 它（p3 的 1179 行）
//
//   ④ 这里再 await 一次（1274-1276）：
//        const { allowed } = filterMcpServersByPolicy(await claudeaiPromise)
//
//   注释说："Memoized — the awaited call below is a cache hit."
//   也就是第 ④ 步的 await 不会真的再等一次，promise 已经 resolve 了。
//
// ── 时间线 ──
//
//     t=0    点火 claude.ai 请求
//     t=0    开始 loadAllPluginsCacheOnly()
//     t=0.5s 插件加载完 → await claudeaiPromise → 还在跑，继续等
//     t=2s   claude.ai 回来 → 继续
//     t=2s   完成
//
//   串行写法会是 2.5s。这里省掉了 0.5s。
//
// ── 为什么第 ④ 步还要"再 await 一次同一个 promise" ──
//
//   因为第 ② 步只是在函数内部等待它，**返回值里没有它**。
//   外层要拿连接器列表做去重和合并，所以必须自己再取一次。
//   promise 的"多次 await"是合法的（同一个结果），这里正是靠这个特性。
//
// ── 一个隐含的依赖 ──
//
//   `fetchClaudeAIMcpConfigsIfEligible` 必须是**幂等且 memoize** 的，
//   否则"点火一次、await 两次"会发两次网络请求。
//   注释里明确写了 "Memoized"，说明这是个必须满足的契约 ——
//   但这个契约由被调函数保证，调用方只在注释里记着。
/**
 * Get all MCP configurations across all scopes, including claude.ai servers.
 * This may be slow due to network calls - use getClaudeCodeMcpConfigs() for fast startup.
 * @returns All server configurations with appropriate scopes
 */
export async function getAllMcpConfigs(): Promise<{
  servers: Record<string, ScopedMcpServerConfig>
  errors: PluginError[]
}> {
// 【enterprise 独占时，连 claude.ai 都不拉（1263-1265）】
//
//     if (doesEnterpriseMcpConfigExist()) {
//       return getClaudeCodeMcpConfigs()
//     }
//
// 这里有个"早退时直接复用快函数"的写法 ——
// 因为快函数自己会处理 enterprise 独占逻辑（只返回 enterprise，
// 连插件都不读）。所以这里不需要重复那段逻辑，直接委托。
//
// 【但注意：这条早退还有一个性能目的 —— 不发网络请求】
//
//   如果企业锁定了 MCP，claude.ai 连接器本来就会被完全忽略。
//   此时点火那个 promise 纯粹浪费（一次网络往返 + 服务端负载）。
//   所以判断必须在**点火之前**。
//
//   这就是为什么 `if` 在 `fetchClaudeAIMcpConfigsIfEligible()` 的上面 ——
//   如果写在下面，功能相同，但白白发了一个请求。
  // In enterprise mode, don't load claude.ai servers (enterprise has exclusive control)
  if (doesEnterpriseMcpConfigExist()) {
    return getClaudeCodeMcpConfigs()
  }

  // Kick off the claude.ai fetch before getClaudeCodeMcpConfigs so it overlaps
  // with loadAllPluginsCacheOnly() inside. Memoized — the awaited call below is a cache hit.
  const claudeaiPromise = fetchClaudeAIMcpConfigsIfEligible()
  const { servers: claudeCodeServers, errors } = await getClaudeCodeMcpConfigs(
    {},
    claudeaiPromise,
  )
  const { allowed: claudeaiMcpServers } = filterMcpServersByPolicy(
    await claudeaiPromise,
  )

  // Suppress claude.ai connectors that duplicate an enabled manual server.
  // Keys never collide (`slack` vs `claude.ai Slack`) so the merge below
  // won't catch this — need content-based dedup by URL signature.
  const { servers: dedupedClaudeAi } = dedupClaudeAiMcpServers(
    claudeaiMcpServers,
    claudeCodeServers,
  )

  // Merge with claude.ai having lowest precedence
  const servers = Object.assign({}, dedupedClaudeAi, claudeCodeServers)

  return { servers, errors }
}

// 【parseMcpConfig：两层校验 + 两类警告】
//
//   ① 整个对象过 `McpJsonConfigSchema()`（1307）
//   ② 逐个子服务器做变量展开，收集缺失变量（1327-1372）
//   ③ Windows 上 npx 缺 cmd 包装 → 警告（1350-1369）
//
// ── 第一层失败是"致命"，第二层是"警告" ──
//
//   看 `severity` 字段：
//     · schema 不通过 → `severity: 'fatal'`，直接返回 `config: null`
//     · 缺环境变量   → `severity: 'warning'`，**服务器仍然保留**（1347 行
//                      `configToCheck = expanded` 之后继续）
//
//   为什么缺变量还能保留？
//   因为变量可能在**运行时**才有（比如由登录后的某个流程设置）。
//   现在报个警告，等真的用的时候如果还没有，连接会失败并给出明确原因。
//
//   如果这里直接判死，用户会陷入"配置加载不上 → 看不到那个服务器 →
//   不知道该设什么变量"的死循环。**警告 + 保留** 让问题可见且可修。
//
// ── Windows npx 检查那三个条件（1354-1356）──
//
//     configToCheck.command === 'npx' ||
//     configToCheck.command.endsWith('\\npx') ||
//     configToCheck.command.endsWith('/npx')
//
//   第一个是裸命令，后两个覆盖 `C:\Program Files\nodejs\npx`
//   这种绝对路径（正反斜杠各一种）。
//
//   【为什么一定要警告】因为在 Windows 上，`npx` 是个 `.cmd` 批处理文件，
//   不是可执行文件。Node 的 spawn 不经过 shell 时**找不到 .cmd**，
//   报的错是 `ENOENT` —— 看起来像"命令不存在"，实际是"需要 cmd /c 包装"。
//   这个错误信息对用户几乎没有指向性，所以要在解析期就提示。
//
// ── `validatedServers[name] = configToCheck`（1371）──
//
//   注意它存的是**展开后**的 config（`configToCheck`，可能是 `expanded`），
//   不是原始的 `config`。
//   所以返回值里的配置是"已展开"的形态 —— 下游拿到的 URL/command
//   都是真实值，不需要再展开一次。
//
//   【这意味着 `expandVars: false` 时返回的是原始形态，
//     调用方必须知道这个差异。】四个调用点里，project/user/local/enterprise
//   全都传了 `expandVars: true`，所以实际上总是展开的。
/**
 * Parse and validate an MCP configuration object
 * @param params Parsing parameters
 * @returns Validated configuration with any errors
 */
export function parseMcpConfig(params: {
  configObject: unknown
  expandVars: boolean
  scope: ConfigScope
  filePath?: string
}): {
  config: McpJsonConfig | null
  errors: ValidationError[]
} {
  const { configObject, expandVars, scope, filePath } = params
  const schemaResult = McpJsonConfigSchema().safeParse(configObject)
  if (!schemaResult.success) {
    return {
      config: null,
      errors: schemaResult.error.issues.map(issue => ({
        ...(filePath && { file: filePath }),
        path: issue.path.join('.'),
        message: 'Does not adhere to MCP server configuration schema',
        mcpErrorMetadata: {
          scope,
          severity: 'fatal',
        },
      })),
    }
  }

  // Validate each server and expand variables if requested
  const errors: ValidationError[] = []
  const validatedServers: Record<string, McpServerConfig> = {}

  for (const [name, config] of Object.entries(schemaResult.data.mcpServers)) {
    let configToCheck = config

    if (expandVars) {
      const { expanded, missingVars } = expandEnvVars(config)

      if (missingVars.length > 0) {
        errors.push({
          ...(filePath && { file: filePath }),
          path: `mcpServers.${name}`,
          message: `Missing environment variables: ${missingVars.join(', ')}`,
          suggestion: `Set the following environment variables: ${missingVars.join(', ')}`,
          mcpErrorMetadata: {
            scope,
            serverName: name,
            severity: 'warning',
          },
        })
      }

      configToCheck = expanded
    }

    // Check for Windows-specific npx usage without cmd wrapper
    if (
      getPlatform() === 'windows' &&
      (!configToCheck.type || configToCheck.type === 'stdio') &&
      (configToCheck.command === 'npx' ||
        configToCheck.command.endsWith('\\npx') ||
        configToCheck.command.endsWith('/npx'))
    ) {
      errors.push({
        ...(filePath && { file: filePath }),
        path: `mcpServers.${name}`,
        message: `Windows requires 'cmd /c' wrapper to execute npx`,
        suggestion: `Change command to "cmd" with args ["/c", "npx", ...]. See: https://code.claude.com/docs/en/mcp#configure-mcp-servers`,
        mcpErrorMetadata: {
          scope,
          serverName: name,
          severity: 'warning',
        },
      })
    }

    validatedServers[name] = configToCheck
  }
  return {
    config: { mcpServers: validatedServers },
    errors,
  }
}

// 【parseMcpConfigFromFilePath：三种失败，三种处理方式】
//
//   ① ENOENT（文件不存在）       → 返回 `config: null` + 一条"not found"错误
//   ② 其他读错误（权限等）        → 返回 `config: null` + 一条"Failed to read"
//   ③ 不是合法 JSON              → 返回 `config: null` + 一条"not a valid JSON"
//
// 【关键设计：ENOENT 也算"错误"，但调用方会把它过滤掉】
//
//   这是一个**刻意的分层**：
//     · 这一层：如实报告"文件不存在"（它确实是个错误事件）
//     · 调用层：根据自己的场景决定这个错误要不要报给用户
//
//   因为"文件不存在"在不同场景下语义不同：
//     · 当前目录读 .mcp.json → 太正常了，忽略
//     · 企业配置文件 → 不存在意味着"企业没锁定"，更要忽略
//     · 命令行指定的文件 → 不存在是用户的错，必须报
//
//   如果在这一层就把 ENOENT 静默掉，第三种场景就没法报错了。
//   **越底层越该如实，越上层越该有判断。**
//
// ── ③ 那条日志里的 `first100` 是个实用的调试技巧（1442）──
//
//     `first100=${jsonStringify(configContent.slice(0, 100))}`
//
//   解析失败时打印前 100 个字符。为什么不用全部？
//   因为 .mcp.json 里可能有 API key（在 env 或 headers 里）。
//   只打前 100 字符，通常足够看出格式问题（比如开头少了个 `{`），
//   又不太可能把密钥打出来。
//
//   【但这仍然不是安全的 —— 如果文件开头就是 headers 里的 key，
//     前 100 字符也会泄漏。】更稳的做法是只打结构信息（长度、
//     第一个非空白字符、是否以 `{` 开头），不打原始内容。
//
//   `length=${configContent.length}` 也在同一行 —— 长度能帮助判断
//   "文件是空的"还是"读到一半断了"。
/**
 * Parse and validate an MCP configuration from a file path
 * @param params Parsing parameters
 * @returns Validated configuration with any errors
 */
export function parseMcpConfigFromFilePath(params: {
  filePath: string
  expandVars: boolean
  scope: ConfigScope
}): {
  config: McpJsonConfig | null
  errors: ValidationError[]
} {
  const { filePath, expandVars, scope } = params
  const fs = getFsImplementation()

  let configContent: string
  try {
    configContent = fs.readFileSync(filePath, { encoding: 'utf8' })
  } catch (error: unknown) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {
      return {
        config: null,
        errors: [
          {
            file: filePath,
            path: '',
            message: `MCP config file not found: ${filePath}`,
            suggestion: 'Check that the file path is correct',
            mcpErrorMetadata: {
              scope,
              severity: 'fatal',
            },
          },
        ],
      }
    }
    logForDebugging(
      `MCP config read error for ${filePath} (scope=${scope}): ${error}`,
      { level: 'error' },
    )
    return {
      config: null,
      errors: [
        {
          file: filePath,
          path: '',
          message: `Failed to read file: ${error}`,
          suggestion: 'Check file permissions and ensure the file exists',
          mcpErrorMetadata: {
            scope,
            severity: 'fatal',
          },
        },
      ],
    }
  }

  const parsedJson = safeParseJSON(configContent)

  if (!parsedJson) {
    logForDebugging(
      `MCP config is not valid JSON: ${filePath} (scope=${scope}, length=${configContent.length}, first100=${jsonStringify(configContent.slice(0, 100))})`,
      { level: 'error' },
    )
    return {
      config: null,
      errors: [
        {
          file: filePath,
          path: '',
          message: `MCP config is not a valid JSON`,
          suggestion: 'Fix the JSON syntax errors in the file',
          mcpErrorMetadata: {
            scope,
            severity: 'fatal',
          },
        },
      ],
    }
  }

  return parseMcpConfig({
    configObject: parsedJson,
    expandVars,
    scope,
    filePath,
  })
}
// 【doesEnterpriseMcpConfigExist：一个 memoize，一个重要的隐含假设】
//
//     export const doesEnterpriseMcpConfigExist = memoize((): boolean => {
//       const { config } = parseMcpConfigFromFilePath({ ... })
//       return config !== null
//     })
//
// 这是全文件唯一被 memoize 的函数，而它的返回值决定了整个 MCP 体系
// 走"独占"还是"分层"两条完全不同的路。
//
// ── 为什么必须 memoize ──
//
//   它被调用的次数非常多：`addMcpConfig`、`removeMcpConfig`、
//   `getClaudeCodeMcpConfigs`、`getAllMcpConfigs`、
//   `filterMcpServersByPolicy` 的调用链……
//   每次都是一次文件读取 + JSON 解析。在启动路径上这是不可接受的。
//
// ── memoize 带来的隐含假设 ──
//
//   **企业配置文件在进程生命周期内不会变。**
//
//   这个假设在企业环境里基本成立（文件由 IT 部署，改它要重启应用）。
//   但如果：
//     · 用户在一个长会话里让 IT 部署了新配置 → 本进程看不到
//     · 测试环境里动态创建这个文件 → 测试之间会互相污染
//
//   而且它**没有 cache key**（无参数函数），所以也没有办法手动失效。
//   唯一的办法是重启进程。
//
// ── `config !== null` 这个判据值得注意 ──
//
//   它判断的是"能否成功解析"，不只是"文件是否存在"。
//   所以：
//     · 文件存在但 JSON 格式错了 → `config: null` → 判定为"不存在"
//     · 文件存在但 schema 不通过 → `config: null` → 判定为"不存在"
//
//   【这意味着一个写坏的企业配置文件会让整个企业锁定**静默失效**。】
//   用户会退回"分层模式"，可以自由添加 MCP 服务器 ——
//   而预期的行为应该是"配置坏了 → 更严格，不是更宽松"。
//
//   这是 fail-open（失效即放开）而不是 fail-closed（失效即收紧）。
//   对安全相关的开关，通常应该反过来：解析失败时**假定锁定生效**，
//   并报一个显眼的错误。

export const doesEnterpriseMcpConfigExist = memoize((): boolean => {
  const { config } = parseMcpConfigFromFilePath({
    filePath: getEnterpriseMcpFilePath(),
    expandVars: true,
    scope: 'enterprise',
  })
  return config !== null
})

// 【shouldAllowManagedMcpServersOnly：一个字段，三重含义】
//
//   `getSettingsForSource('policySettings')?.allowManagedMcpServersOnly === true`
//
// 三个细节：
//
//   ① 只查 `policySettings`，不查合并后的设置。
//      因为"要不要只信 managed"这件事本身，只能由 managed 决定。
//      如果用户能通过自己的配置开启这个开关，那它就没有意义了
//      （虽然开启它反而更严，但逻辑上说不通）。
//
//   ② `=== true` 而不是 truthy 判断。
//      因为配置来自 JSON，可能是 `"true"`（字符串）或 `1`。
//      严格相等避免"字符串 true 被当成真"这类隐蔽的类型问题。
//
//   ③ 影响范围**只有白名单**（见 `getMcpAllowlistSettings`）。
//      黑名单永远合并 —— 这个非对称在前面 p1 的 336 行批注里详细讲过。
//
// 【这个函数的 JSDoc 最后一句是完整的策略总结】
//
//   "When enabled, allowedMcpServers is read exclusively from managed settings.
//    Users can still add their own MCP servers and deny servers via
//    deniedMcpServers."
//
//   注意"Users can still add their own MCP servers" ——
//   这句话听起来和"只信 managed 白名单"矛盾。
//
//   实际上不矛盾：如果 managed 白名单里**没有** command/url 条目，
//   只看名字条目的情况下，用户新加的服务器如果名字不在白名单里就会被拦。
//   但如果 managed 白名单是**空的或未设置**，就是全放行。
//
//   所以"用户仍能加"成立的条件是"企业没设白名单"。这句话有歧义，
//   但代码逻辑是对的。
/**
 * Check if MCP allowlist policy should only come from managed settings.
 * This is true when policySettings has allowManagedMcpServersOnly: true.
 * When enabled, allowedMcpServers is read exclusively from managed settings.
 * Users can still add their own MCP servers and deny servers via deniedMcpServers.
 */
export function shouldAllowManagedMcpServersOnly(): boolean {
  return (
    getSettingsForSource('policySettings')?.allowManagedMcpServersOnly === true
  )
}

// 【areMcpConfigsAllowedWithEnterpriseMcpConfig：一段写在代码里的临时妥协】
//
//     return Object.values(configs).every(
//       c => c.type === 'sdk' && c.name === 'claude-vscode',
//     )
//
// 函数名叫"在 enterprise 配置下所有这些配置是否被允许"，
// 实现是"每一个都必须是 type=sdk 且 name=claude-vscode"。
//
// ── 上面那段注释就是在解释为什么这么窄 ──
//
//   "While all SDK MCP servers should be safe from a security perspective,
//    we are still discussing what the best way to do this is. In the
//    meantime, we are limiting this to claude-vscode for now to unbreak the
//    VSCode extension for certain enterprise customers who have enterprise
//    MCP config enabled."
//
//   拆开看：
//     · 从安全角度，**所有** SDK 服务器都是安全的（它们不 spawn 进程、
//       不开网络连接，见 `filterMcpServersByPolicy` 的批注）
//     · 但"怎么放行"的设计还在讨论
//     · 所以先只放行 `claude-vscode` 这一个，为了让特定企业客户能用 VSCode 扩展
//
// ── 这段注释的信息量很大 ──
//
//   ① 它承认当前实现是**临时方案**，不是最终设计
//   ② 它说明了触发这个临时方案的**具体客户场景**
//   ③ 它给了一个 Slack 链接（`anthropic.slack.com/archives/...`）——
//      这是内部沟通记录，外部读者打不开，但能看出"决策发生在聊天里"
//
// 【这是生产代码里很常见的一种形态：把一个正确的通用判断，
//   临时收窄成特例，以解决某个紧急的具体问题。】
//
//   风险在于：如果没人回来收拾，这个特例会永久存在，
//   然后每个遇到问题的人都在这里加一个 `||`。
//   注释里写清"还在讨论"是唯一的防腐手段 ——
//   但更好的做法是挂一个带 deadline 的 issue 编号。
/**
 * Check if all MCP servers in a config are allowed with enterprise MCP config.
 */
export function areMcpConfigsAllowedWithEnterpriseMcpConfig(
  configs: Record<string, ScopedMcpServerConfig>,
): boolean {
  // NOTE: While all SDK MCP servers should be safe from a security perspective, we are still discussing
  // what the best way to do this is. In the meantime, we are limiting this to claude-vscode for now to
  // unbreak the VSCode extension for certain enterprise customers who have enterprise MCP config enabled.
  // https://anthropic.slack.com/archives/C093UA0KLD7/p1764975463670109
  return Object.values(configs).every(
    c => c.type === 'sdk' && c.name === 'claude-vscode',
  )
}

// 【DEFAULT_DISABLED_BUILTIN：一个"极性反转"的服务器】
//
//     const DEFAULT_DISABLED_BUILTIN = feature('CHICAGO_MCP')
//       ? require('../../utils/computerUse/common.js').COMPUTER_USE_MCP_SERVER_NAME
//       : null
//
// 注释说明了它的特殊之处：
//   "Unlike user-configured servers (opt-out via disabledMcpServers),
//    this requires explicit opt-in via enabledMcpServers."
//
// ── 两种极性 ──
//
//   普通服务器（opt-out，默认开）：出现在 disabledMcpServers 里 → 禁用
//   内置服务器（opt-in，默认关）：出现在 enabledMcpServers 里 → 启用
//
// **两个列表的语义完全相反。** 这是全文件最容易搞错的地方。
//
// ── 为什么要给内置服务器反过来的默认值 ──
//
//   因为它是**能操作你的电脑**的那个服务器（computer use，
//   截图 / 点击 / 输入）。这种东西绝不能默认开着 ——
//   用户装了 CC 就自动获得"AI 可以控制我的鼠标"，这是不可接受的。
//
//   所以它默认关闭，必须在 /mcp 里显式打开。
//
// 【这是一个"能力的危险程度决定默认值"的例子】
//   同一个系统里，不同的服务器用不同的默认极性 ——
//   不是因为技术原因，是因为风险的期望值不同。
//
// ── 又一次 `feature()` 条件 require ──
//
//   特性关闭时，`DEFAULT_DISABLED_BUILTIN` 是 `null`，
//   于是 `isDefaultDisabledBuiltin()` 永远返回 false，
//   整套 opt-in 逻辑自然失效 —— 不需要额外的开关判断。
//
//   【这是"用数据的存在与否代替条件分支"的手法：
//     把"是否启用这个特性"编码进了一个常量是 null 还是字符串。】
/**
 * Built-in MCP server that defaults to disabled. Unlike user-configured servers
 * (opt-out via disabledMcpServers), this requires explicit opt-in via
 * enabledMcpServers. Shows up in /mcp as disabled until the user enables it.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const DEFAULT_DISABLED_BUILTIN = feature('CHICAGO_MCP')
  ? (
      require('../../utils/computerUse/common.js') as typeof import('../../utils/computerUse/common.js')
    ).COMPUTER_USE_MCP_SERVER_NAME
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

function isDefaultDisabledBuiltin(name: string): boolean {
  return DEFAULT_DISABLED_BUILTIN !== null && name === DEFAULT_DISABLED_BUILTIN
}

// 【isMcpServerDisabled：八行代码，两个方向相反的列表】
//
//     if (isDefaultDisabledBuiltin(name)) {
//       const enabledServers = projectConfig.enabledMcpServers || []
//       return !enabledServers.includes(name)     // 不在"已启用"里 = 禁用
//     }
//     const disabledServers = projectConfig.disabledMcpServers || []
//     return disabledServers.includes(name)        // 在"已禁用"里 = 禁用
//
// ── 两个 `return` 的方向正好相反 ──
//
//   内置：`!includes(enabled)` —— 默认不在列表里 → 返回 true（禁用）
//   普通：`includes(disabled)`  —— 默认不在列表里 → 返回 false（启用）
//
// 【这种"同一个函数，两条分支语义相反"的写法极易出错】
//
//   读代码时很容易只看一条分支，然后推理到另一条上。
//   更清晰的写法是让函数的返回值语义一致（都是"是否禁用"），
//   但内部用两个具名的小函数：
//
//       const isBuiltinOptedIn = (n) => (cfg.enabledMcpServers ?? []).includes(n)
//       const isNormalOptedOut = (n) => (cfg.disabledMcpServers ?? []).includes(n)
//       return isDefaultDisabledBuiltin(n) ? !isBuiltinOptedIn(n) : isNormalOptedOut(n)
//
//   语义完全一样，但读的人不会看错方向。
//
// ── `|| []` 而不是 `?? []` ──
//
//   这两个字段在类型上可能是 `string[] | undefined`，
//   用 `??` 更精确（只在 null/undefined 时兜底）。
//   用 `||` 会把**空字符串**也兜成 `[]` ——
//   但这两个字段是数组，不可能是字符串，所以实际无害。
//   属于"能用但不精确"的写法，全文件多处出现。
/**
 * Check if an MCP server is disabled
 * @param name The name of the server
 * @returns true if the server is disabled
 */
export function isMcpServerDisabled(name: string): boolean {
  const projectConfig = getCurrentProjectConfig()
  if (isDefaultDisabledBuiltin(name)) {
    const enabledServers = projectConfig.enabledMcpServers || []
    return !enabledServers.includes(name)
  }
  const disabledServers = projectConfig.disabledMcpServers || []
  return disabledServers.includes(name)
}

// 【toggleMembership：一个小函数，解决"不要产生重复项"】
//
//     if (contains === shouldContain) return list   // 已经是目标状态，原样返回
//     return shouldContain ? [...list, name] : list.filter(s => s !== name)
//
// ── 第一行是最重要的：`contains === shouldContain` 时返回**原引用** ──
//
//   不是返回一个内容相同的新数组，是返回**同一个对象**。
//   这个细节在 `setMcpServerEnabled` 里被用来判断"有没有真的变"：
//
//       const next = toggleMembership(prev, name, enabled)
//       if (next === prev) return current        // 没变就不写盘
//
//   通过**引用相等**来判断"无变化"，从而跳过写盘。
//   这是个很省事的手法，但要求 toggleMembership 必须遵守
//   "无变化时返回原引用"的契约 —— 而这个契约只存在于这两处的配合里。
//
//   【如果将来有人把 toggleMembership 改成总是返回新数组
//     （比如为了"纯函数不可变"的洁癖），这个跳过写盘的优化就
//     静默失效 —— 功能不变，只是每次重复点击都写一次盘。】
//
// ── 为什么不用 Set ──
//
//   因为这两个列表会被**持久化成 JSON 数组**，顺序对用户可能可见
//   （/mcp 里的显示顺序）。用 Set 会丢顺序。
//   `filter` 保留原顺序，`[...list, name]` 追加到末尾 —— 都可预测。
function toggleMembership(
  list: string[],
  name: string,
  shouldContain: boolean,
): string[] {
  const contains = list.includes(name)
  if (contains === shouldContain) return list
  return shouldContain ? [...list, name] : list.filter(s => s !== name)
}

// 【setMcpServerEnabled：最后那个 `isBuiltinStateChange` 值得推敲】
//
//     const isBuiltinStateChange =
//       isDefaultDisabledBuiltin(name) && isMcpServerDisabled(name) === enabled
//
// 这个表达式在判断什么？
//
//   展开：**是内置服务器** 且 **当前禁用状态 == 目标启用状态**
//
//   设当前 `isMcpServerDisabled(name) = D`（true 表示禁用），
//   目标 `enabled = E`（true 表示想启用）。
//
//   `D === E` 意味着「当前禁用状态 == 期望启用状态」
//   → 等价于「想要的状态 != 当前状态」
//   → 也就是**确实要发生改变**。
//
// 所以变量名 `isBuiltinStateChange` 是准确的：真的要变。
//
// ── 但这个写法很难读 ──
//
//   直觉上的写法是 `isMcpServerDisabled(name) !== !enabled`，
//   或者更清楚：
//
//       const currentlyEnabled = !isMcpServerDisabled(name)
//       const isBuiltinStateChange =
//         isDefaultDisabledBuiltin(name) && currentlyEnabled !== enabled
//
//   两者逻辑等价，后者一眼能懂。这里用了 `D === E` 这种
//   "通过两次取反等于原值"的捷径，读的人要停下来想一下。
//
// ── 它只用于遥测（1571-1577）──
//
//   `if (isBuiltinStateChange) logEvent('tengu_builtin_mcp_toggle', ...)`
//
//   所以它不影响功能，只影响埋点是否准确。
//   但埋点的准确性直接影响"这个内置功能有多少人开了"这个结论 ——
//   如果每次点击都上报（不判断是否真的变），会把数据虚高
//   （用户点两下开、再点两下关，上报 4 次）。
//
// 【所以这个难读的判断是必要的：它保证了埋点只记真实的状态迁移。】
//
// ── 另一处值得注意：`saveCurrentProjectConfig` 的回调（1557-1569）──
//
//   回调里 `if (next === prev) return current` —— 没变化就返回原对象，
//   让上层知道"不用写盘"。
//   这和 toggleMembership 的引用相等契约是配套的（见上一条批注）。
//
//   但注意：内置服务器写 `enabledMcpServers`，普通服务器写
//   `disabledMcpServers`，而且普通那个传的是 `!enabled`（取反）。
//   两个极性在这里第三次出现 —— 前面 `isMcpServerDisabled` 是第一次，
//   `setMcpServerEnabled` 的分支是第二次。
/**
 * Enable or disable an MCP server
 * @param name The name of the server
 * @param enabled Whether the server should be enabled
 */
export function setMcpServerEnabled(name: string, enabled: boolean): void {
  const isBuiltinStateChange =
    isDefaultDisabledBuiltin(name) && isMcpServerDisabled(name) === enabled

  saveCurrentProjectConfig(current => {
    if (isDefaultDisabledBuiltin(name)) {
      const prev = current.enabledMcpServers || []
      const next = toggleMembership(prev, name, enabled)
      if (next === prev) return current
      return { ...current, enabledMcpServers: next }
    }

    const prev = current.disabledMcpServers || []
    const next = toggleMembership(prev, name, !enabled)
    if (next === prev) return current
    return { ...current, disabledMcpServers: next }
  })

  if (isBuiltinStateChange) {
// 文件结束（1,578 行）。
//
// 【回头看这个文件的结构，其实只有四块】
//
//   ① 写入（writeMcpjsonFile）       —— 44 行，原子写
//   ② 去重（三个 dedup/signature）   —— 约 120 行，签名 + 优先级
//   ③ 读取（getMcpConfigsByScope 等）—— 约 300 行，六种来源
//   ④ 策略（deny / allow / disabled）—— 约 250 行，白黑名单 + 启停
//
// 剩下的是解析、增删、以及大量注释。
//
// 【如果要记住三件事，就是这三件】
//
//   1. **优先级**：plugin < claude.ai < user < project < local，enterprise 独占
//   2. **白黑名单非对称**：白名单能收紧到"只信 managed"，黑名单永远合并
//   3. **启停有两种极性**：普通服务器 opt-out（默认开），
//      内置高风险的 opt-in（默认关）
//
// 【这个文件最值得学的不是具体规则，是它处理"多来源配置"的方法】
//
//   · 每条配置都带 scope 标签（否则合并后就失忆了）
//   · 去重用**内容签名**而不是键（因为键天然不会撞）
//   · 抑制类规则必须保证"被抑制方有替补"（否则两个都不跑）
//   · 读-改-写操作要区分"逻辑视图"和"物理视图"
//   · 策略检查在每个出口都做，不假设来源可信
//
// 这五条和 MCP 协议无关，是做任何"多层配置系统"都用得上的。
    logEvent('tengu_builtin_mcp_toggle', {
      serverName:
        name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      enabled,
    })
  }
}
