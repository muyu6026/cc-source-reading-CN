import { readFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import isEqual from 'lodash-es/isEqual.js'
import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import { z } from 'zod/v4'
import { OAUTH_BETA_HEADER } from '../../constants/oauth.js'
import { getAnthropicClient } from '../../services/api/client.js'
import { isClaudeAISubscriber } from '../auth.js'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { safeParseJSON } from '../json.js'
import { lazySchema } from '../lazySchema.js'
import { isEssentialTrafficOnly } from '../privacyLevel.js'
import { jsonStringify } from '../slowOperations.js'
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from './providers.js'
// 模块说明：负责从 Anthropic API 拉取并缓存模型能力（如上下文窗口），仅内部蚂蚁用户启用。

// .strip() — don't persist internal-only fields (mycro_deployments etc.) to disk
const ModelCapabilitySchema = lazySchema(() =>
  z
    .object({
      id: z.string(),
      max_input_tokens: z.number().optional(),
      max_tokens: z.number().optional(),
    })
    .strip(),
)
// ModelCapabilitySchema：用 strip 去掉仅供内部使用的字段再落盘。

const CacheFileSchema = lazySchema(() =>
  z.object({
    models: z.array(ModelCapabilitySchema()),
    timestamp: z.number(),
  }),
)
// CacheFileSchema：缓存文件结构为模型列表加时间戳。

export type ModelCapability = z.infer<ReturnType<typeof ModelCapabilitySchema>>
// ModelCapability 类型：由 schema 推导出的能力记录形状。

function getCacheDir(): string {
  return join(getClaudeConfigHomeDir(), 'cache')
}

function getCachePath(): string {
  return join(getCacheDir(), 'model-capabilities.json')
}

function isModelCapabilitiesEligible(): boolean {
  if (process.env.USER_TYPE !== 'ant') return false
  if (getAPIProvider() !== 'firstParty') return false
  if (!isFirstPartyAnthropicBaseUrl()) return false
  return true
}
// isModelCapabilitiesEligible 收尾：三重门槛——内部用户、firstParty、首方基地址。

// Longest-id-first so substring match prefers most specific; secondary key for stable isEqual
function sortForMatching(models: ModelCapability[]): ModelCapability[] {
  return [...models].sort(
    (a, b) => b.id.length - a.id.length || a.id.localeCompare(b.id),
  )
}
// sortForMatching 收尾：标识长的优先，便于子串匹配取最具体项。

// Keyed on cache path so tests that set CLAUDE_CONFIG_DIR get a fresh read
const loadCache = memoize(
  (path: string): ModelCapability[] | null => {
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- memoized; called from sync getContextWindowForModel
      const raw = readFileSync(path, 'utf-8')
      const parsed = CacheFileSchema().safeParse(safeParseJSON(raw, false))
      return parsed.success ? parsed.data.models : null
    } catch {
      return null
    }
  },
  path => path,
)
// loadCache 收尾：按缓存路径记忆化同步读取，测试改目录即得新读。

export function getModelCapability(model: string): ModelCapability | undefined {
  if (!isModelCapabilitiesEligible()) return undefined
  const cached = loadCache(getCachePath())
  if (!cached || cached.length === 0) return undefined
  const m = model.toLowerCase()
  const exact = cached.find(c => c.id.toLowerCase() === m)
  if (exact) return exact
  return cached.find(c => m.includes(c.id.toLowerCase()))
}
// getModelCapability 收尾：先精确匹配再子串匹配，非 eligible 直接返回 undefined。

export async function refreshModelCapabilities(): Promise<void> {
  if (!isModelCapabilitiesEligible()) return
  if (isEssentialTrafficOnly()) return

  try {
    const anthropic = await getAnthropicClient({ maxRetries: 1 })
    const betas = isClaudeAISubscriber() ? [OAUTH_BETA_HEADER] : undefined
    const parsed: ModelCapability[] = []
    for await (const entry of anthropic.models.list({ betas })) {
      const result = ModelCapabilitySchema().safeParse(entry)
      if (result.success) parsed.push(result.data)
    }
    if (parsed.length === 0) return

    const path = getCachePath()
    const models = sortForMatching(parsed)
    if (isEqual(loadCache(path), models)) {
      logForDebugging('[modelCapabilities] cache unchanged, skipping write')
      return
    }

    await mkdir(getCacheDir(), { recursive: true })
    await writeFile(path, jsonStringify({ models, timestamp: Date.now() }), {
      encoding: 'utf-8',
      mode: 0o600,
    })
    loadCache.cache.delete(path)
    logForDebugging(`[modelCapabilities] cached ${models.length} models`)
  } catch (error) {
    logForDebugging(
      `[modelCapabilities] fetch failed: ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }
}
// refreshModelCapabilities 收尾：拉取最新能力，与缓存相等则跳写，否则写盘并清记忆化。
