import uniqBy from 'lodash-es/uniqBy.js'
import { useMemo } from 'react'
import type { Command } from '../commands.js'

export function useMergedCommands(
  initialCommands: Command[],
  mcpCommands: Command[],
): Command[] {
// 合并内置命令与动态 MCP 命令，按 name 去重（initialCommands 优先）。
  return useMemo(() => {
    if (mcpCommands.length > 0) {
// MCP 命令非空时合并去重；否则直接返回内置命令。
      return uniqBy([...initialCommands, ...mcpCommands], 'name')
// uniqBy 以 name 为键，initialCommands 在前所以同名 MCP 命令被覆盖。
    }
    return initialCommands
  }, [initialCommands, mcpCommands])
}
