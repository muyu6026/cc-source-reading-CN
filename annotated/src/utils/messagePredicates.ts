// 本文件导出类型守卫 `isHumanTurn`，用于从消息流中区分「真人发言」与「工具结果等系统消息」。
import type { Message, UserMessage } from '../types/message.js'

// tool_result messages share type:'user' with human turns; the discriminant
// is the optional toolUseResult field. Four PRs (#23977, #24016, #24022,
// #24025) independently fixed miscounts from checking type==='user' alone.
export function isHumanTurn(m: Message): m is UserMessage {
  return m.type === 'user' && !m.isMeta && m.toolUseResult === undefined
// 判别式说明：`tool_result` 与真人消息都带 `type:'user'`，真正的区分在于可选字段 `toolUseResult`；历史上四个 PR 都曾因只看 `type==='user'` 而误判，故此处用 `isMeta` 与 `toolUseResult` 双重排除。
}
