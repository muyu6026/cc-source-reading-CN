import { useCallback, useState } from 'react'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { verifyApiKey } from '../services/api/claude.js'
import {
  getAnthropicApiKeyWithSource,
  getApiKeyFromApiKeyHelper,
  isAnthropicAuthEnabled,
  isClaudeAISubscriber,
} from '../utils/auth.js'

export type VerificationStatus =
  | 'loading'
  | 'valid'
  | 'invalid'
  | 'missing'
  | 'error'

export type ApiKeyVerificationResult = {
  status: VerificationStatus
  reverify: () => Promise<void>
  error: Error | null
}
// VerificationStatus 五态：loading（待验证，apiKeyHelper 已配置未执行）/ valid / invalid / missing / error；ApiKeyVerificationResult 额外带 reverify 与 error。

export function useApiKeyVerification(): ApiKeyVerificationResult {
  const [status, setStatus] = useState<VerificationStatus>(() => {
    if (!isAnthropicAuthEnabled() || isClaudeAISubscriber()) {
      return 'valid'
    }
    // Use skipRetrievingKeyFromApiKeyHelper to avoid executing apiKeyHelper
    // before trust dialog is shown (security: prevents RCE via settings.json)
    const { key, source } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    // If apiKeyHelper is configured, we have a key source even though we
    // haven't executed it yet - return 'loading' to indicate we'll verify later
    if (key || source === 'apiKeyHelper') {
      return 'loading'
    }
    return 'missing'
  })
  const [error, setError] = useState<Error | null>(null)
// 初始态：auth 关或 ClaudeAI 订阅者直接 valid；apiKeyHelper 配置但未执行（security：防 trust dialog 前经 settings.json 触发 RCE）则 loading；否则 missing。

  const verify = useCallback(async (): Promise<void> => {
    if (!isAnthropicAuthEnabled() || isClaudeAISubscriber()) {
      setStatus('valid')
      return
    }
    // Warm the apiKeyHelper cache (no-op if not configured), then read from
    // all sources. getAnthropicApiKeyWithSource() reads the now-warm cache.
    await getApiKeyFromApiKeyHelper(getIsNonInteractiveSession())
    const { key: apiKey, source } = getAnthropicApiKeyWithSource()
    if (!apiKey) {
      if (source === 'apiKeyHelper') {
        setStatus('error')
        setError(new Error('API key helper did not return a valid key'))
        return
      }
      const newStatus = 'missing'
      setStatus(newStatus)
      return
    }

    try {
      const isValid = await verifyApiKey(apiKey, false)
      const newStatus = isValid ? 'valid' : 'invalid'
      setStatus(newStatus)
      return
    } catch (error) {
      // This happens when there an error response from the API but it's not an invalid API key error
      // In this case, we still mark the API key as invalid - but we also log the error so we can
      // display it to the user to be more helpful
      setError(error as Error)
      const newStatus = 'error'
      setStatus(newStatus)
      return
    }
  }, [])
// verify：先 warm apiKeyHelper 缓存（未配置则 no-op）再读全源；无 key → missing / apiKeyHelper 报错 → error；verifyApiKey → valid / invalid；API 报错仍标 error 但记录 error 供展示（比静默更有帮助）。

  return {
    status,
    reverify: verify,
    error,
  }
}
