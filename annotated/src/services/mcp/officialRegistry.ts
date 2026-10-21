import axios from 'axios'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'

type RegistryServer = {
  server: {
    remotes?: Array<{ url: string }>
  }
}

type RegistryResponse = {
  servers: RegistryServer[]
}

// URLs stripped of query string and trailing slash — matches the normalization
// done by getLoggingSafeMcpBaseUrl so direct Set.has() lookup works.
let officialUrls: Set<string> | undefined = undefined
// 一个模块级可变缓存，生命周期是整个进程：main.tsx 启动时 fire-and-forget 拉一次，
// 之后埋点每次打点都同步查表。
//
// 所以这个值**可能永远是 undefined** —— 网络慢、被墙、开关关掉，都停在初始状态。
// 下面 isOfficialMcpUrl 的 fail-closed 就是为这个状态写的。

function normalizeUrl(url: string): string | undefined {
  try {
    const u = new URL(url)
    u.search = ''
    return u.toString().replace(/\/$/, '')
// 与 utils.ts 里 getLoggingSafeMcpBaseUrl 是同一套归一化：去 query、去尾斜杠。
// 两处必须逐字一致，否则「写进表里的键」和「查表时给的键」对不上，命中率变 0。
//
// 这不是共享函数，是**靠约定耦合**：改一处必须记得改另一处。
// 之所以没合并：本文件要能在埋点那条极轻的链路上被 import，不想拖 utils.ts 的依赖。
  } catch {
    return undefined
  }
}

/**
 * Fire-and-forget fetch of the official MCP registry.
 * Populates officialUrls for isOfficialMcpUrl lookups.
 */
export async function prefetchOfficialMcpUrls(): Promise<void> {
// 三个「绝不能影响主流程」的写法，缺一个都会变成启动故障：
//   · 非必要流量开关打开时直接返回（企业环境会关掉所有非必要出站）
//   · 5 秒超时（默认 axios 无限等，会把启动挂住）
//   · 失败只写 debug 日志，不抛、不重试
// 因为它服务的只是埋点里的一个布尔标签，不是任何功能。
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) {
    return
  }

  try {
    const response = await axios.get<RegistryResponse>(
      'https://api.anthropic.com/mcp-registry/v0/servers?version=latest&visibility=commercial',
      { timeout: 5000 },
    )

    const urls = new Set<string>()
    for (const entry of response.data.servers) {
      for (const remote of entry.server.remotes ?? []) {
        const normalized = normalizeUrl(remote.url)
        if (normalized) {
          urls.add(normalized)
        }
      }
    }
    officialUrls = urls
    logForDebugging(`[mcp-registry] Loaded ${urls.size} official MCP URLs`)
  } catch (error) {
    logForDebugging(`Failed to fetch MCP registry: ${errorMessage(error)}`, {
      level: 'error',
    })
  }
}

/**
 * Returns true iff the given (already-normalized via getLoggingSafeMcpBaseUrl)
 * URL is in the official MCP registry. Undefined registry → false (fail-closed).
 */
export function isOfficialMcpUrl(normalizedUrl: string): boolean {
// fail-closed：表没拉到就当「不是官方」。
//
// 方向选得对：这个布尔只用于给埋点打标签，误判成「非官方」只是统计少一点；
// 反过来若 fail-open（默认认为都是官方），一次网络失败就会把成千上万个
// 第三方 server 全记成官方，那批数据就废了，而且没人会发现。
  return officialUrls?.has(normalizedUrl) ?? false
}

export function resetOfficialMcpUrlsForTesting(): void {
  officialUrls = undefined
}
