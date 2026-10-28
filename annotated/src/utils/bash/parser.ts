import { feature } from 'bun:bundle'
import { logEvent } from '../../services/analytics/index.js'
import { logForDebugging } from '../debug.js'
import {
  ensureParserInitialized,
  getParserModule,
  type TsNode,
} from './bashParser.js'

export type Node = TsNode

export interface ParsedCommandData {
  rootNode: Node
  envVars: string[]
  commandNode: Node | null
  originalCommand: string
}
// ParsedCommandData 是解析结果：语法树根节点、环境变量列表、命令节点、以及原始命令字符串。

const MAX_COMMAND_LENGTH = 10000
const DECLARATION_COMMANDS = new Set([
  'export',
  'declare',
  'typeset',
  'readonly',
  'local',
  'unset',
  'unsetenv',
])
const ARGUMENT_TYPES = new Set(['word', 'string', 'raw_string', 'number'])
const SUBSTITUTION_TYPES = new Set([
  'command_substitution',
  'process_substitution',
])
const COMMAND_TYPES = new Set(['command', 'declaration_command'])
// 几组类型集合：声明类命令（export、local 等）、参数类型、替换类型、命令类型，用于后面的语法树遍历分类。

let logged = false
function logLoadOnce(success: boolean): void {
  if (logged) return
  logged = true
  logForDebugging(
    success ? 'tree-sitter: native module loaded' : 'tree-sitter: unavailable',
  )
  logEvent('tengu_tree_sitter_load', { success })
}
// 加载只记一次日志并上报埋点，避免每个命令都打一条 tree-sitter 加载信息。

/**
 * Awaits WASM init (Parser.init + Language.load). Must be called before
 * parseCommand/parseCommandRaw for the parser to be available. Idempotent.
 */
export async function ensureInitialized(): Promise<void> {
  if (feature('TREE_SITTER_BASH') || feature('TREE_SITTER_BASH_SHADOW')) {
    await ensureParserInitialized()
  }
}
// 初始化入口：仅在启用 TREE_SITTER_BASH 相关特性时才真正等待 WASM 解析器就绪，可幂等重复调用。

export async function parseCommand(
  command: string,
): Promise<ParsedCommandData | null> {
  if (!command || command.length > MAX_COMMAND_LENGTH) return null

  // Gate: ant-only until pentest. External builds fall back to legacy
  // regex/shell-quote path. Guarding the whole body inside the positive
  // branch lets Bun DCE the NAPI import AND keeps telemetry honest — we
  // only fire tengu_tree_sitter_load when a load was genuinely attempted.
  if (feature('TREE_SITTER_BASH')) {
    await ensureParserInitialized()
    const mod = getParserModule()
    logLoadOnce(mod !== null)
    if (!mod) return null

    try {
      const rootNode = mod.parse(command)
      if (!rootNode) return null

      const commandNode = findCommandNode(rootNode, null)
      const envVars = extractEnvVars(commandNode)

      return { rootNode, envVars, commandNode, originalCommand: command }
    } catch {
      return null
    }
  }
  return null
}
// 带特性开关的解析：命中特性才走 tree-sitter，否则返回 null（走旧版正则路径）。

/**
 * SECURITY: Sentinel for "parser was loaded and attempted, but aborted"
 * (timeout / node budget / Rust panic). Distinct from `null` (module not
 * loaded). Adversarial input can trigger abort under MAX_COMMAND_LENGTH:
 * `(( a[0][0]... ))` with ~2800 subscripts hits PARSE_TIMEOUT_MICROS.
 * Callers MUST treat this as fail-closed (too-complex), NOT route to legacy.
 */
export const PARSE_ABORTED = Symbol('parse-aborted')
// 解析中止哨兵：区分「模块没加载（null）」与「加载了但解析被中止（超时或节点预算爆）」，后者必须按失败封闭处理，不能退回旧路径。

/**
 * Raw parse — skips findCommandNode/extractEnvVars which the security
 * walker in ast.ts doesn't use. Saves one tree walk per bash command.
 *
 * Returns:
 *   - Node: parse succeeded
 *   - null: module not loaded / feature off / empty / over-length
 *   - PARSE_ABORTED: module loaded but parse failed (timeout/panic)
 */
export async function parseCommandRaw(
  command: string,
): Promise<Node | null | typeof PARSE_ABORTED> {
  if (!command || command.length > MAX_COMMAND_LENGTH) return null
  if (feature('TREE_SITTER_BASH') || feature('TREE_SITTER_BASH_SHADOW')) {
    await ensureParserInitialized()
    const mod = getParserModule()
    logLoadOnce(mod !== null)
    if (!mod) return null
    try {
      const result = mod.parse(command)
      // SECURITY: Module loaded; null here = timeout/node-budget abort in
      // bashParser.ts (PARSE_TIMEOUT_MS=50, MAX_NODES=50_000).
      // Previously collapsed into `return null` → parse-unavailable → legacy
      // path, which lacks EVAL_LIKE_BUILTINS — `trap`, `enable`, `hash` leaked.
      if (result === null) {
        logEvent('tengu_tree_sitter_parse_abort', {
          cmdLength: command.length,
          panic: false,
        })
        return PARSE_ABORTED
      }
      return result
    } catch {
      logEvent('tengu_tree_sitter_parse_abort', {
        cmdLength: command.length,
        panic: true,
      })
      return PARSE_ABORTED
    }
  }
  return null
}
// 原始解析：跳过 findCommandNode 与 extractEnvVars（安全遍历不需要），并在解析中止时返回哨兵而非 null。

function findCommandNode(node: Node, parent: Node | null): Node | null {
  const { type, children } = node

  if (COMMAND_TYPES.has(type)) return node

  // Variable assignment followed by command
  if (type === 'variable_assignment' && parent) {
    return (
      parent.children.find(
        c => COMMAND_TYPES.has(c.type) && c.startIndex > node.startIndex,
      ) ?? null
    )
  }

  // Pipeline: recurse into first child (which may be a redirected_statement)
  if (type === 'pipeline') {
    for (const child of children) {
      const result = findCommandNode(child, node)
      if (result) return result
    }
    return null
  }

  // Redirected statement: find the command inside
  if (type === 'redirected_statement') {
    return children.find(c => COMMAND_TYPES.has(c.type)) ?? null
  }

  // Recursive search
  for (const child of children) {
    const result = findCommandNode(child, node)
    if (result) return result
  }

  return null
}
// 在语法树里定位「真正的命令节点」：处理变量赋值、管道、重定向语句等嵌套结构。

function extractEnvVars(commandNode: Node | null): string[] {
  if (!commandNode || commandNode.type !== 'command') return []

  const envVars: string[] = []
  for (const child of commandNode.children) {
    if (child.type === 'variable_assignment') {
      envVars.push(child.text)
    } else if (child.type === 'command_name' || child.type === 'word') {
      break
    }
  }
  return envVars
}
// 从命令节点抽取前置的环境变量赋值（遇到命令名或单词即停止）。

export function extractCommandArguments(commandNode: Node): string[] {
  // Declaration commands
  if (commandNode.type === 'declaration_command') {
    const firstChild = commandNode.children[0]
    return firstChild && DECLARATION_COMMANDS.has(firstChild.text)
      ? [firstChild.text]
      : []
  }

  const args: string[] = []
  let foundCommandName = false

  for (const child of commandNode.children) {
    if (child.type === 'variable_assignment') continue

    // Command name
    if (
      child.type === 'command_name' ||
      (!foundCommandName && child.type === 'word')
    ) {
      foundCommandName = true
      args.push(child.text)
      continue
    }

    // Arguments
    if (ARGUMENT_TYPES.has(child.type)) {
      args.push(stripQuotes(child.text))
    } else if (SUBSTITUTION_TYPES.has(child.type)) {
      break
    }
  }
  return args
}
// 抽取命令参数：声明命令只取首词，普通命令收集参数并去引号，遇到替换类节点即停止。

function stripQuotes(text: string): string {
  return text.length >= 2 &&
    ((text[0] === '"' && text.at(-1) === '"') ||
      (text[0] === "'" && text.at(-1) === "'"))
    ? text.slice(1, -1)
    : text
}
// 去掉字符串两端的成对非转义引号，其余原样返回。
