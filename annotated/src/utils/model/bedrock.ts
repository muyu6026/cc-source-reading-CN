// 注：本文件封装 AWS Bedrock 相关逻辑：列出可用推理配置、构建 Bedrock 客户端、从 ARN 抽取模型名与跨区前缀，并支持给模型 ID 加/换区域前缀。
import memoize from 'lodash-es/memoize.js'
import { refreshAndGetAwsCredentials } from '../auth.js'
import { getAWSRegion, isEnvTruthy } from '../envUtils.js'
import { logError } from '../log.js'
import { getAWSClientProxyConfig } from '../proxy.js'

// 注：getBedrockInferenceProfiles 分页拉取系统定义的推理配置，过滤出 Anthropic 相关的，返回其 ID 列表。
export const getBedrockInferenceProfiles = memoize(async function (): Promise<
  string[]
> {
  const [client, { ListInferenceProfilesCommand }] = await Promise.all([
    createBedrockClient(),
    import('@aws-sdk/client-bedrock'),
  ])
  const allProfiles = []
  let nextToken: string | undefined

  try {
    do {
      const command = new ListInferenceProfilesCommand({
        ...(nextToken && { nextToken }),
        typeEquals: 'SYSTEM_DEFINED',
      })
      const response = await client.send(command)

      if (response.inferenceProfileSummaries) {
        allProfiles.push(...response.inferenceProfileSummaries)
      }

      nextToken = response.nextToken
    } while (nextToken)

    // Filter for Anthropic models (SYSTEM_DEFINED filtering handled in query)
    return allProfiles
      .filter(profile => profile.inferenceProfileId?.includes('anthropic'))
      .map(profile => profile.inferenceProfileId)
      .filter(Boolean) as string[]
  } catch (error) {
    logError(error as Error)
    throw error
  }
})

// 注：findFirstMatch 在配置列表中找第一个包含某子串的 ID，用于按模型名定位配置。
export function findFirstMatch(
  profiles: string[],
  substring: string,
): string | null {
  return profiles.find(p => p.includes(substring)) ?? null
}

// 注：createBedrockClient 按环境变量决定区域与端点，默认从 AWS 区域环境变量读取；可跳过鉴权走 noAuth 方案，否则用刷新后的凭证。
async function createBedrockClient() {
  const { BedrockClient } = await import('@aws-sdk/client-bedrock')
  // Match the Anthropic Bedrock SDK's region behavior exactly:
  // - Reads AWS_REGION or AWS_DEFAULT_REGION env vars (not AWS config files)
  // - Falls back to 'us-east-1' if neither is set
  // This ensures we query profiles from the same region the client will use
  const region = getAWSRegion()

  const skipAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)

  const clientConfig: ConstructorParameters<typeof BedrockClient>[0] = {
    region,
    ...(process.env.ANTHROPIC_BEDROCK_BASE_URL && {
      endpoint: process.env.ANTHROPIC_BEDROCK_BASE_URL,
    }),
    ...(await getAWSClientProxyConfig()),
    ...(skipAuth && {
      requestHandler: new (
        await import('@smithy/node-http-handler')
      ).NodeHttpHandler(),
      httpAuthSchemes: [
        {
          schemeId: 'smithy.api#noAuth',
          identityProvider: () => async () => ({}),
          signer: new (await import('@smithy/core')).NoAuthSigner(),
        },
      ],
      httpAuthSchemeProvider: () => [{ schemeId: 'smithy.api#noAuth' }],
    }),
  }

  if (!skipAuth && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    // Only refresh credentials if not using API key authentication
    const cachedCredentials = await refreshAndGetAwsCredentials()
    if (cachedCredentials) {
      clientConfig.credentials = {
        accessKeyId: cachedCredentials.accessKeyId,
        secretAccessKey: cachedCredentials.secretAccessKey,
        sessionToken: cachedCredentials.sessionToken,
      }
    }
  }

  return new BedrockClient(clientConfig)
}

// 注：createBedrockRuntimeClient 与上一个类似，但构建运行时客户端；BedrockRuntimeClient 默认 HTTP/2，代理场景会强制回退 HTTP/1.1。
export async function createBedrockRuntimeClient() {
  const { BedrockRuntimeClient } = await import(
    '@aws-sdk/client-bedrock-runtime'
  )
  const region = getAWSRegion()
  const skipAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)

  const clientConfig: ConstructorParameters<typeof BedrockRuntimeClient>[0] = {
    region,
    ...(process.env.ANTHROPIC_BEDROCK_BASE_URL && {
      endpoint: process.env.ANTHROPIC_BEDROCK_BASE_URL,
    }),
    ...(await getAWSClientProxyConfig()),
    ...(skipAuth && {
      // BedrockRuntimeClient defaults to HTTP/2 without fallback
      // proxy servers may not support this, so we explicitly force HTTP/1.1
      requestHandler: new (
        await import('@smithy/node-http-handler')
      ).NodeHttpHandler(),
      httpAuthSchemes: [
        {
          schemeId: 'smithy.api#noAuth',
          identityProvider: () => async () => ({}),
          signer: new (await import('@smithy/core')).NoAuthSigner(),
        },
      ],
      httpAuthSchemeProvider: () => [{ schemeId: 'smithy.api#noAuth' }],
    }),
  }

  if (!skipAuth && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    // Only refresh credentials if not using API key authentication
    const cachedCredentials = await refreshAndGetAwsCredentials()
    if (cachedCredentials) {
      clientConfig.credentials = {
        accessKeyId: cachedCredentials.accessKeyId,
        secretAccessKey: cachedCredentials.secretAccessKey,
        sessionToken: cachedCredentials.sessionToken,
      }
    }
  }

  return new BedrockRuntimeClient(clientConfig)
}

// 注：getInferenceProfileBackingModel 取某推理配置背后的实际基础模型 ARN，返回其模型名（用于成本核算），出错时返回 null。
export const getInferenceProfileBackingModel = memoize(async function (
  profileId: string,
): Promise<string | null> {
  try {
    const [client, { GetInferenceProfileCommand }] = await Promise.all([
      createBedrockClient(),
      import('@aws-sdk/client-bedrock'),
    ])
    const command = new GetInferenceProfileCommand({
      inferenceProfileIdentifier: profileId,
    })
    const response = await client.send(command)

    if (!response.models || response.models.length === 0) {
      return null
    }

    // Use the first model as the primary backing model for cost calculation
    // In practice, application inference profiles typically load balance between
    // similar models with the same cost structure
    const primaryModel = response.models[0]
    if (!primaryModel?.modelArn) {
      return null
    }

    // Extract model name from ARN
    // ARN format: arn:aws:bedrock:region:account:foundation-model/model-name
    const lastSlashIndex = primaryModel.modelArn.lastIndexOf('/')
    return lastSlashIndex >= 0
      ? primaryModel.modelArn.substring(lastSlashIndex + 1)
      : primaryModel.modelArn
  } catch (error) {
    logError(error as Error)
    return null
  }
})

/**
 * Check if a model ID is a foundation model (e.g., "anthropic.claude-sonnet-4-5-20250929-v1:0")
 */
// 注：isFoundationModel 判断模型 ID 是否为基础模型，约定以 anthropic. 前缀标识。
export function isFoundationModel(modelId: string): boolean {
  return modelId.startsWith('anthropic.')
}

/**
 * Cross-region inference profile prefixes for Bedrock.
 * These prefixes allow routing requests to models in specific regions.
 */
// 注：BEDROCK_REGION_PREFIXES 列出跨区推理的四种前缀：us/eu/apac/global。
const BEDROCK_REGION_PREFIXES = ['us', 'eu', 'apac', 'global'] as const

/**
 * Extract the model/inference profile ID from a Bedrock ARN.
 * If the input is not an ARN, returns it unchanged.
 *
 * ARN format: arn:aws:bedrock:<region>:<account>:inference-profile/<profile-id>
 * Also handles: arn:aws:bedrock:<region>:<account>:application-inference-profile/<profile-id>
 * And foundation model ARNs: arn:aws:bedrock:<region>::foundation-model/<model-id>
 */
// 注：extractModelIdFromArn 从完整 ARN 里抠出末尾的模型或推理配置 ID；若输入本就不是 ARN 则原样返回。
export function extractModelIdFromArn(modelId: string): string {
  if (!modelId.startsWith('arn:')) {
    return modelId
  }
  const lastSlashIndex = modelId.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    return modelId
  }
  return modelId.substring(lastSlashIndex + 1)
}

export type BedrockRegionPrefix = (typeof BEDROCK_REGION_PREFIXES)[number]

/**
 * Extract the region prefix from a Bedrock cross-region inference model ID.
 * Handles both plain model IDs and full ARN format.
 * For example:
 * - "eu.anthropic.claude-sonnet-4-5-20250929-v1:0" → "eu"
 * - "us.anthropic.claude-3-7-sonnet-20250219-v1:0" → "us"
 * - "arn:aws:bedrock:ap-northeast-2:123:inference-profile/global.anthropic.claude-opus-4-6-v1" → "global"
 * - "anthropic.claude-3-5-sonnet-20241022-v2:0" → undefined (foundation model)
 * - "claude-sonnet-4-5-20250929" → undefined (first-party format)
 */
// 注：getBedrockRegionPrefix 在 ARN 或纯 ID 上识别跨区前缀；基础模型或第一方格式无此前缀时返回 undefined。
export function getBedrockRegionPrefix(
  modelId: string,
): BedrockRegionPrefix | undefined {
  // Extract the inference profile ID from ARN format if present
  // ARN format: arn:aws:bedrock:<region>:<account>:inference-profile/<profile-id>
  const effectiveModelId = extractModelIdFromArn(modelId)

  for (const prefix of BEDROCK_REGION_PREFIXES) {
    if (effectiveModelId.startsWith(`${prefix}.anthropic.`)) {
      return prefix
    }
  }
  return undefined
}

/**
 * Apply a region prefix to a Bedrock model ID.
 * If the model already has a different region prefix, it will be replaced.
 * If the model is a foundation model (anthropic.*), the prefix will be added.
 * If the model is not a Bedrock model, it will be returned as-is.
 *
 * For example:
 * - applyBedrockRegionPrefix("us.anthropic.claude-sonnet-4-5-v1:0", "eu") → "eu.anthropic.claude-sonnet-4-5-v1:0"
 * - applyBedrockRegionPrefix("anthropic.claude-sonnet-4-5-v1:0", "eu") → "eu.anthropic.claude-sonnet-4-5-v1:0"
 * - applyBedrockRegionPrefix("claude-sonnet-4-5-20250929", "eu") → "claude-sonnet-4-5-20250929" (not a Bedrock model)
 */
// 注：applyBedrockRegionPrefix 给模型 ID 加或换区域前缀：已有不同前缀则替换，是基础模型则补前缀，非 Bedrock 格式则原样返回。
export function applyBedrockRegionPrefix(
  modelId: string,
  prefix: BedrockRegionPrefix,
): string {
  // Check if it already has a region prefix and replace it
  const existingPrefix = getBedrockRegionPrefix(modelId)
  if (existingPrefix) {
    return modelId.replace(`${existingPrefix}.`, `${prefix}.`)
  }

  // Check if it's a foundation model (anthropic.*) and add the prefix
  if (isFoundationModel(modelId)) {
    return `${prefix}.${modelId}`
  }

  // Not a Bedrock model format, return as-is
  return modelId
}
