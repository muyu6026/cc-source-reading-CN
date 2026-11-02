// 计算机操控（代号 Chicago）的能力门控与子开关：决定功能是否启用、用像素还是归一化坐标，并把细粒度子开关暴露给工具描述。
import type { CoordinateMode, CuSubGates } from '@ant/computer-use-mcp/types'

import { getDynamicConfig_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getSubscriptionType } from '../auth.js'
import { isEnvTruthy } from '../envUtils.js'

// `ChicagoConfig` 在子开关类型之上补了启用标志与坐标模式两个字段，整体作为一份完整配置。
type ChicagoConfig = CuSubGates & {
  enabled: boolean
  coordinateMode: CoordinateMode
}

const DEFAULTS: ChicagoConfig = {
  enabled: false,
  pixelValidation: false,
  clipboardPasteMultiline: true,
  mouseAnimation: true,
  hideBeforeAction: true,
  autoTargetDisplay: true,
  clipboardGuard: true,
  coordinateMode: 'pixels',
}
// `DEFAULTS` 是功能关闭、像素坐标、各子开关开启的保守默认；部分 JSON 也能靠展开默认值继承其余字段。

// Spread over defaults so a partial JSON ({"enabled": true} alone) inherits the
// rest. The generic on getDynamicConfig is a type assertion, not a validator —
// GB returning a partial object would otherwise surface undefined fields.
// `readConfig` 把默认值与远程配置（特性开关）展开合并，后者缺失的字段由默认补全，避免暴露未定义。
function readConfig(): ChicagoConfig {
  return {
    ...DEFAULTS,
    ...getDynamicConfig_CACHED_MAY_BE_STALE<Partial<ChicagoConfig>>(
      'tengu_malort_pedway',
      DEFAULTS,
    ),
  }
}

// Max/Pro only for external rollout. Ant bypass so dogfooding continues
// regardless of subscription tier — not all ants are max/pro, and per
// CLAUDE.md:281, USER_TYPE !== 'ant' branches get zero antfooding.
// `hasRequiredSubscription` 决定是否具备使用资格：内部用户绕过档位直接放行，外部仅 Max 与 Pro 档可用。
function hasRequiredSubscription(): boolean {
  if (process.env.USER_TYPE === 'ant') return true
  const tier = getSubscriptionType()
  return tier === 'max' || tier === 'pro'
}

// `getChicagoEnabled` 综合订阅资格与远程开关判定启用与否；并特判「继承了单体仓库开发配置的蚂蚁用户」默认关闭，除非显式放行。
export function getChicagoEnabled(): boolean {
  // Disable for ants whose shell inherited monorepo dev config.
  // MONOREPO_ROOT_DIR is exported by config/local/zsh/zshrc, which
  // laptop-setup.sh wires into ~/.zshrc — its presence is the cheap
  // proxy for "has monorepo access". Override: ALLOW_ANT_COMPUTER_USE_MCP=1.
  if (
    process.env.USER_TYPE === 'ant' &&
    process.env.MONOREPO_ROOT_DIR &&
    !isEnvTruthy(process.env.ALLOW_ANT_COMPUTER_USE_MCP)
  ) {
    return false
  }
  return hasRequiredSubscription() && readConfig().enabled
}

export function getChicagoSubGates(): CuSubGates {
  const { enabled: _e, coordinateMode: _c, ...subGates } = readConfig()
  return subGates
}

// Frozen at first read — setup.ts builds tool descriptions and executor.ts
// scales coordinates off the same value. A live read here lets a mid-session
// GB flip tell the model "pixels" while transforming clicks as normalized.
let frozenCoordinateMode: CoordinateMode | undefined
// `getChicagoCoordinateMode` 在首次读取后冻结坐标模式，避免会话中途远程翻转导致模型收到的坐标语义与点击换算不一致。
export function getChicagoCoordinateMode(): CoordinateMode {
  frozenCoordinateMode ??= readConfig().coordinateMode
  return frozenCoordinateMode
}
