// 【第 1-6 行】这一个文件是「遥测总开关」的**唯一事实来源**。
//     注释开头那句「Shared analytics configuration」看着平平无奇，但它决定了
//     Datadog 和 1P（第一方）两套后端**共用同一套禁用判定**。把判定集中在这里，
//     而不是让两个后端各自写一遍，是为了避免「一处改了禁用条件、另一处忘了改」
//     导致遥测在某种环境下悄悄回传。
/**
 * Shared analytics configuration
 *
 * Common logic for determining when analytics should be disabled
 * across all analytics systems (Datadog, 1P)
 */

import { isEnvTruthy } from '../../utils/envUtils.js'
import { isTelemetryDisabled } from '../../utils/privacyLevel.js'

/**
 * Check if analytics operations should be disabled
 *
 * Analytics is disabled in the following cases:
 * - Test environment (NODE_ENV === 'test')
 * - Third-party cloud providers (Bedrock/Vertex)
 * - Privacy level is no-telemetry or essential-traffic
 */
// 【第 11-18 行】注释把「什么时候禁用」列成了四条规则，值得逐条对应到代码：
//     - 测试环境（NODE_ENV === 'test'）—— 测试跑出来的事件不能污染真实指标
//     - 第三方云（Bedrock / Vertex）—— 这些环境不是 Anthropic 直连，回传会被路由错
//     - 隐私级别 no-telemetry 或 essential-traffic —— 用户侧的全局开关
//     注意：下面函数体其实是**五**个条件（多了 FOUNDRY），注释和代码对不齐是常见现象，
//     读的时候以代码为准。
// 【第 19-27 行】`isAnalyticsDisabled()`：五个 OR 条件，**任意一个命中就整体关闭**。
//     关键点是它同时挡掉了 Datadog 和 1P—— 因为两者都「可能携带用户数据」，
//     所以禁用必须是一刀切。后面 `isFeedbackSurveyDisabled()` 故意**不**挡 3P 云，
//     形成了同一套判定里两种口径的对比（见第 36 行）。
export function isAnalyticsDisabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY) ||
    isTelemetryDisabled()
  )
}

/**
 * Check if the feedback survey should be suppressed.
 *
 * Unlike isAnalyticsDisabled(), this does NOT block on 3P providers
 * (Bedrock/Vertex/Foundry). The survey is a local UI prompt with no
 * transcript data — enterprise customers capture responses via OTEL.
 */
// 【第 36-38 行】`isFeedbackSurveyDisabled()` 和上面的函数只差一条：
//     **不**挡 Bedrock / Vertex / Foundry。
//     为什么？注释说得很直白—— 反馈调查是本地 UI 弹窗，不带 transcript（对话正文）数据，
//     企业客户走 OTEL 自己采集。所以「第三方云不回传遥测」这条约束对它就不再成立。
//     → 同一个「要不要禁用」的问题，因为数据敏感度不同，答案天然分叉；
//     不要写一个放之四海皆准的 `isDisabled()` 然后到处复用，该分叉时就分叉。
export function isFeedbackSurveyDisabled(): boolean {
  return process.env.NODE_ENV === 'test' || isTelemetryDisabled()
}
