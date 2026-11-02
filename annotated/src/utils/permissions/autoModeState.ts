// Auto mode state functions — lives in its own module so callers can
// conditionally require() it on feature('TRANSCRIPT_CLASSIFIER').
// 模块总述：自动模式（auto mode）的模块级状态与一组读写器，独立成模块以便调用方在被 `feature` 门控（如 `TRANSCRIPT_CLASSIFIER`）时条件式 require，避免无条件加载。

// 三个模块级开关变量：当前是否处于自动模式、CLI 是否传入了自动模式标志、以及被踢出后的熔断状态。
let autoModeActive = false
let autoModeFlagCli = false
// Set by the async verifyAutoModeGateAccess check when it
// reads a fresh tengu_auto_mode_config.enabled === 'disabled' from GrowthBook.
// Used by isAutoModeGateEnabled() to block SDK/explicit re-entry after kick-out.
let autoModeCircuitBroken = false

// setAutoModeActive / isAutoModeActive：自动模式激活态的读写器。
export function setAutoModeActive(active: boolean): void {
  autoModeActive = active
}

export function isAutoModeActive(): boolean {
  return autoModeActive
}

// setAutoModeFlagCli / getAutoModeFlagCli：来自 CLI 标志的自动模式开关读写器。
export function setAutoModeFlagCli(passed: boolean): void {
  autoModeFlagCli = passed
}

export function getAutoModeFlagCli(): boolean {
  return autoModeFlagCli
}

// setAutoModeCircuitBroken / isAutoModeCircuitBroken：熔断状态读写器，被踢出后用于阻断 SDK 与显式重入。
export function setAutoModeCircuitBroken(broken: boolean): void {
  autoModeCircuitBroken = broken
}

export function isAutoModeCircuitBroken(): boolean {
  return autoModeCircuitBroken
}

// _resetForTesting：测试用重置，把三个开关全部清回初始的关闭态。
export function _resetForTesting(): void {
  autoModeActive = false
  autoModeFlagCli = false
  autoModeCircuitBroken = false
}
