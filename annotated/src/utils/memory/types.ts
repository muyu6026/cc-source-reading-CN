// 文件级。集中定义记忆类型（`MemoryType`）的可取值列表，并按编译特性决定是否加入团队记忆类型。
import { feature } from 'bun:bundle'

export const MEMORY_TYPE_VALUES = [
  'User',
  'Project',
  'Local',
  'Managed',
  'AutoMem',
  ...(feature('TEAMMEM') ? (['TeamMem'] as const) : []),
] as const

// 用 `as const` 锁死这个字符串字面量联合，顺序即展示顺序；`feature('TEAMMEM')` 为真时才把 `TeamMem` 追加进去。
export type MemoryType = (typeof MEMORY_TYPE_VALUES)[number]
// 由上面的取值数组派生出 `MemoryType` 类型，新增类型只需改数组一处。
