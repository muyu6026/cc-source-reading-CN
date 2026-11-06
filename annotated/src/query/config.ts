import { getSessionId } from '../bootstrap/state.js'
// 引入会话 ID、带缓存可能过期的 Statsig 特性门、SessionId 类型与环境变量布尔判定。
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import type { SessionId } from '../types/ids.js'
import { isEnvTruthy } from '../utils/envUtils.js'

// -- config
// 注释分段标记：配置段。

// Immutable values snapshotted once at query() entry. Separating these from
// the per-iteration State struct and the mutable ToolUseContext makes future
// step() extraction tractable — a pure reducer can take (state, event, config)
// where config is plain data.
//
// Intentionally excludes feature() gates — those are tree-shaking boundaries
// and must stay inline at the guarded blocks for dead-code elimination.
// 注释：本段为在 query() 入口一次性快照的不可变值。
// 注释：刻意排除 feature() 门——它们是摇树边界，必须内联在受保护代码块以维持死代码消除。
export type QueryConfig = {
// QueryConfig 类型：含会话 ID 与一组运行时门。
  sessionId: SessionId

  // Runtime gates (env/statsig). NOT feature() gates — see above.
// 注释：运行时门（env/statsig）而非 feature() 门。
  gates: {
    // Statsig — CACHED_MAY_BE_STALE already admits staleness, so snapshotting
    // once per query() call stays within the existing contract.
    streamingToolExecution: boolean
    emitToolUseSummaries: boolean
    isAnt: boolean
    fastModeEnabled: boolean
  }
}

export function buildQueryConfig(): QueryConfig {
// 构造 QueryConfig：快照会话 ID 与各运行时门。
  return {
    sessionId: getSessionId(),
    gates: {
// 注释：streamingToolExecution 门使用带缓存可能过期的 Statsig 判定，单次快照仍在契约内。
      streamingToolExecution: checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
        'tengu_streaming_tool_execution2',
      ),
      emitToolUseSummaries: isEnvTruthy(
// emitToolUseSummaries 门：由环境变量控制。
        process.env.CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES,
      ),
      isAnt: process.env.USER_TYPE === 'ant',
// isAnt 门：由 USER_TYPE 是否为 ant 判定。
      // Inlined from fastMode.ts to avoid pulling its heavy module graph
      // (axios, settings, auth, model, oauth, config) into test shards that
      // didn't previously load it — changes init order and breaks unrelated tests.
// 注释：fastModeEnabled 从 fastMode.ts 内联而来，避免拖入其重型模块图影响测试分片初始化顺序。
      fastModeEnabled: !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_FAST_MODE),
// 快速模式默认开启，仅当禁用环境变量为真时关闭。
    },
  }
}
