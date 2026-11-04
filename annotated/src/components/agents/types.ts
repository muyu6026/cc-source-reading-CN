import type { SettingSource } from 'src/utils/settings/constants.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'

// 路径常量集中在这里：.claude 目录与 agents 子目录是唯一约定，散落到各处必然漂移
export const AGENT_PATHS = {
  FOLDER_NAME: '.claude',
  AGENTS_DIR: 'agents',
} as const

// Base types for common patterns
type WithPreviousMode = { previousMode: ModeState }
// 两个混入型别名：几乎所有子状态都要带「当前 agent」与「从哪个模式来」这两项
type WithAgent = { agent: AgentDefinition }

// Simplified state type using intersection types
// 判别联合而非布尔开关：七个模式互斥，靠 mode 字段收窄后编译器会替你查漏每个分支
export type ModeState =
  | { mode: 'main-menu' }
  | { mode: 'list-agents'; source: SettingSource | 'all' | 'built-in' }
  | ({ mode: 'agent-menu' } & WithAgent & WithPreviousMode)
// previousMode 直接嵌在状态里而不是另存一个栈：只需要回退一层，Esc 返回上一屏就够
  | ({ mode: 'view-agent' } & WithAgent & WithPreviousMode)
  | { mode: 'create-agent' }
  | ({ mode: 'edit-agent' } & WithAgent & WithPreviousMode)
  | ({ mode: 'delete-confirm' } & WithAgent & WithPreviousMode)

// 校验结果把 errors 与 warnings 分开：前者拦、后者劝，界面据此决定是否允许保存
export type AgentValidationResult = {
  isValid: boolean
  warnings: string[]
  errors: string[]
}
