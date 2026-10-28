import { buildPrefix } from '../shell/specPrefix.js'
import { splitCommand_DEPRECATED } from './commands.js'
import { extractCommandArguments, parseCommand } from './parser.js'
import { getCommandSpec } from './registry.js'

const NUMERIC = /^\d+$/
// NUMERIC：判断字符串是否纯数字（用于识别非命令的参数）。
const ENV_VAR = /^[A-Za-z_][A-Za-z0-9_]*=/
// ENV_VAR：识别 KEY=value 形式的环境变量赋值（前缀里要单独处理）。

// Wrapper commands with complex option handling that can't be expressed in specs
const WRAPPER_COMMANDS = new Set([
  'nice', // command position varies based on options
])
// WRAPPER_COMMANDS：选项位置不固定的包装命令集合（目前只有 nice）。

const toArray = <T>(val: T | T[]): T[] => (Array.isArray(val) ? val : [val])
// toArray：把单值或数组统一成数组，便于按 args 配置遍历。

// Check if args[0] matches a known subcommand (disambiguates wrapper commands
// that also have subcommands, e.g. the git spec has isCommand args for aliases).
function isKnownSubcommand(
  arg: string,
  spec: { subcommands?: { name: string | string[] }[] } | null,
): boolean {
// isKnownSubcommand：判断某参数是否为规范里声明的子命令（区分包装命令与其子命令）。
  if (!spec?.subcommands?.length) return false
  return spec.subcommands.some(sub =>
    Array.isArray(sub.name) ? sub.name.includes(arg) : sub.name === arg,
  )
}

export async function getCommandPrefixStatic(
  command: string,
  recursionDepth = 0,
  wrapperCount = 0,
): Promise<{ commandPrefix: string | null } | null> {
// getCommandPrefixStatic：递归解析单条命令的前缀——判断是包装命令还是普通命令，分别走 handleWrapper 或 buildPrefix。
  if (wrapperCount > 2 || recursionDepth > 10) return null
// 递归护栏：包装层数大于 2 或递归深度大于 10 直接返回 null，防止失控。

  const parsed = await parseCommand(command)
  if (!parsed) return null
  if (!parsed.commandNode) {
    return { commandPrefix: null }
  }

  const { envVars, commandNode } = parsed
  const cmdArgs = extractCommandArguments(commandNode)

  const [cmd, ...args] = cmdArgs
  if (!cmd) return { commandPrefix: null }

  // Check if this is a wrapper command by looking at its spec
  const spec = await getCommandSpec(cmd)
  // Check if this is a wrapper command
  let isWrapper =
    WRAPPER_COMMANDS.has(cmd) ||
    (spec?.args && toArray(spec.args).some(arg => arg?.isCommand))

  // Special case: if the command has subcommands and the first arg matches a subcommand,
  // treat it as a regular command, not a wrapper
  if (isWrapper && args[0] && isKnownSubcommand(args[0], spec)) {
    isWrapper = false
  }

  const prefix = isWrapper
    ? await handleWrapper(cmd, args, recursionDepth, wrapperCount)
    : await buildPrefix(cmd, args, spec)

  if (prefix === null && recursionDepth === 0 && isWrapper) {
    return null
  }

  const envPrefix = envVars.length ? `${envVars.join(' ')} ` : ''
  return { commandPrefix: prefix ? envPrefix + prefix : null }
}

async function handleWrapper(
  command: string,
  args: string[],
  recursionDepth: number,
  wrapperCount: number,
): Promise<string | null> {
// handleWrapper：处理 nice 这类包装命令——定位其中的真命令参数，递归取它的前缀再拼回。
  const spec = await getCommandSpec(command)

  if (spec?.args) {
    const commandArgIndex = toArray(spec.args).findIndex(arg => arg?.isCommand)

    if (commandArgIndex !== -1) {
      const parts = [command]

      for (let i = 0; i < args.length && i <= commandArgIndex; i++) {
        if (i === commandArgIndex) {
          const result = await getCommandPrefixStatic(
            args.slice(i).join(' '),
            recursionDepth + 1,
            wrapperCount + 1,
          )
          if (result?.commandPrefix) {
            parts.push(...result.commandPrefix.split(' '))
            return parts.join(' ')
          }
          break
        } else if (
          args[i] &&
          !args[i]!.startsWith('-') &&
          !ENV_VAR.test(args[i]!)
        ) {
          parts.push(args[i]!)
        }
      }
    }
  }

  const wrapped = args.find(
    arg => !arg.startsWith('-') && !NUMERIC.test(arg) && !ENV_VAR.test(arg),
  )
  if (!wrapped) return command

  const result = await getCommandPrefixStatic(
    args.slice(args.indexOf(wrapped)).join(' '),
    recursionDepth + 1,
    wrapperCount + 1,
  )

  return !result?.commandPrefix ? null : `${command} ${result.commandPrefix}`
}

/**
 * Computes prefixes for a compound command (with && / || / ;).
 * For single commands, returns a single-element array with the prefix.
 *
 * For compound commands, computes per-subcommand prefixes and collapses
 * them: subcommands sharing a root (first word) are collapsed via
 * word-aligned longest common prefix.
 *
 * @param excludeSubcommand — optional filter; return true for subcommands
 *   that should be excluded from the prefix suggestion (e.g. read-only
 *   commands that are already auto-allowed).
 */
export async function getCompoundCommandPrefixesStatic(
  command: string,
  excludeSubcommand?: (subcommand: string) => boolean,
): Promise<string[]> {
// getCompoundCommandPrefixesStatic：对 &&/||/; 复合命令逐段取前缀，再按首词分组做词对齐最长公共前缀折叠。
  const subcommands = splitCommand_DEPRECATED(command)
  if (subcommands.length <= 1) {
    const result = await getCommandPrefixStatic(command)
    return result?.commandPrefix ? [result.commandPrefix] : []
  }

  const prefixes: string[] = []
  for (const subcmd of subcommands) {
    const trimmed = subcmd.trim()
    if (excludeSubcommand?.(trimmed)) continue
    const result = await getCommandPrefixStatic(trimmed)
    if (result?.commandPrefix) {
      prefixes.push(result.commandPrefix)
    }
  }

  if (prefixes.length === 0) return []

  // Group prefixes by their first word (root command)
  const groups = new Map<string, string[]>()
  for (const prefix of prefixes) {
    const root = prefix.split(' ')[0]!
// 按前缀的首词（根命令）分组，同根的前缀归到一组再做折叠。
    const group = groups.get(root)
    if (group) {
      group.push(prefix)
    } else {
      groups.set(root, [prefix])
    }
  }

  // Collapse each group via word-aligned LCP
  const collapsed: string[] = []
  for (const [, group] of groups) {
    collapsed.push(longestCommonPrefix(group))
  }
  return collapsed
}

/**
 * Compute the longest common prefix of strings, aligned to word boundaries.
 * e.g. ["git fetch", "git worktree"] → "git"
 *      ["npm run test", "npm run lint"] → "npm run"
 */
function longestCommonPrefix(strings: string[]): string {
// longestCommonPrefix：按空格分词后逐词比对，取所有字符串共享的最长词前缀（单条直接返回）。
  if (strings.length === 0) return ''
  if (strings.length === 1) return strings[0]!

  const first = strings[0]!
  const words = first.split(' ')
  let commonWords = words.length

  for (let i = 1; i < strings.length; i++) {
    const otherWords = strings[i]!.split(' ')
    let shared = 0
    while (
      shared < commonWords &&
      shared < otherWords.length &&
      words[shared] === otherWords[shared]
    ) {
      shared++
    }
    commonWords = shared
  }

  return words.slice(0, Math.max(1, commonWords)).join(' ')
}
