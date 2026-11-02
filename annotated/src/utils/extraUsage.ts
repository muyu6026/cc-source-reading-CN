// 文件级批注：`extraUsage.ts` 判断某次调用是否按「额外用量」计费，综合订阅状态、快模式与具体模型版本来决策。
import { isClaudeAISubscriber } from './auth.js'
import { has1mContext } from './context.js'

// 入口签名：接收模型名、是否快模式、opus 1m 是否已合并三个入参，返回布尔判定。
export function isBilledAsExtraUsage(
  model: string | null,
  isFastMode: boolean,
  isOpus1mMerged: boolean,
): boolean {
  if (!isClaudeAISubscriber()) return false
  if (isFastMode) return true
  if (model === null || !has1mContext(model)) return false

  const m = model
    .toLowerCase()
    .replace(/\[1m\]$/, '')
    .trim()
  const isOpus46 = m === 'opus' || m.includes('opus-4-6')
// 收尾：归一化模型名后识别 opus-4-6 与 sonnet-4-6 两种目标版本，供下方判定使用。
  const isSonnet46 = m === 'sonnet' || m.includes('sonnet-4-6')

  if (isOpus46 && isOpus1mMerged) return false

  return isOpus46 || isSonnet46
}
// 收尾：综合早退规则后，命中 opus 或 sonnet 4-6 即按额外用量计费。
