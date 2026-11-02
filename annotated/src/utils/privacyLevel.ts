// 隐私等级的三个档位与判定。等级按限制强度递增：全开、关闭遥测、仅必要流量。最终等级取所有信号里最严格的那个，由两个环境变量驱动；档位越高，关闭的东西越多（遥测、自动更新、发布说明、模型能力查询等）。
/**
 * Privacy level controls how much nonessential network traffic and telemetry
 * Claude Code generates.
 *
 * Levels are ordered by restrictiveness:
 *   default < no-telemetry < essential-traffic
 *
 * - default:            Everything enabled.
 * - no-telemetry:       Analytics/telemetry disabled (Datadog, 1P events, feedback survey).
 * - essential-traffic:  ALL nonessential network traffic disabled
 *                       (telemetry + auto-updates, grove, release notes, model capabilities, etc.).
 *
 * The resolved level is the most restrictive signal from:
 *   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC  →  essential-traffic
 *   DISABLE_TELEMETRY                         →  no-telemetry
 */

type PrivacyLevel = 'default' | 'no-telemetry' | 'essential-traffic'
// 等级类型只在模块内部使用、没有导出，因为外部一律通过下面三个语义化函数提问，而不是自己比较字符串。这样档位增减时不会牵动调用方。

export function getPrivacyLevel(): PrivacyLevel {
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) {
    return 'essential-traffic'
  }
  if (process.env.DISABLE_TELEMETRY) {
    return 'no-telemetry'
  }
  return 'default'
}
// 判定顺序即优先级：更严格的那个环境变量先查，命中就返回最高档，不再看第二个。用真值判断而不是精确比较字符串，所以设为任意非空值都生效，方便用户在脚本里随手写。

/**
 * True when all nonessential network traffic should be suppressed.
 * Equivalent to the old `process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` check.
 */
export function isEssentialTrafficOnly(): boolean {
  return getPrivacyLevel() === 'essential-traffic'
}
// 这个函数等价于「是否处于最高档」，注释点明它替换了原先直接读那个环境变量的写法——把散落在各处的环境变量判断收进一处，改动档位定义时只需改这一个文件。

/**
 * True when telemetry/analytics should be suppressed.
 * True at both `no-telemetry` and `essential-traffic` levels.
 */
export function isTelemetryDisabled(): boolean {
  return getPrivacyLevel() !== 'default'
}
// 注意这里的判据是「不是全开档」而不是「等于关闭遥测档」：因为最高档同样意味着遥测关闭，用否定式写才能一次覆盖两档，也避免了将来新增更严格档位时漏改。

/**
 * Returns the env var name responsible for the current essential-traffic restriction,
 * or null if unrestricted. Used for user-facing "unset X to re-enable" messages.
 */
export function getEssentialTrafficOnlyReason(): string | null {
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) {
    return 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'
  }
  return null
}
// 这个查询只针对最高档，返回导致限制的环境变量名而不是布尔——用途是给用户提示「取消设置某个变量即可恢复」。目前只有两个维护流量限制的变量，所以只需判断一个；第二档的原因不必单独解释，因为它没有副作用性的网络行为要解释。
