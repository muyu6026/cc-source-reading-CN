import { memoizeWithLRU } from '../memoize.js'
import specs from './specs/index.js'

export type CommandSpec = {
  name: string
  description?: string
  subcommands?: CommandSpec[]
  args?: Argument | Argument[]
  options?: Option[]
}
// 命令规格的顶层形状：名字必填，描述、子命令、参数、选项都可选。子命令递归同构，所以 `git remote add` 这类多层结构能自然表达。

export type Argument = {
  name?: string
  description?: string
  isDangerous?: boolean
  isVariadic?: boolean // repeats infinitely e.g. echo hello world
  isOptional?: boolean
  isCommand?: boolean // wrapper commands e.g. timeout, sudo
  isModule?: string | boolean // for python -m and similar module args
  isScript?: boolean // script files e.g. node script.js
}
// 参数节点上的语义标记决定了权限判定怎么做：
// `isDangerous` 标危险位置，`isVariadic` 标可无限重复，`isCommand` 标包装器（timeout、sudo 后面跟的是待执行命令），
// `isScript` 标脚本文件，`isModule` 标 `python -m` 这类模块参数。

export type Option = {
  name: string | string[]
  description?: string
  args?: Argument | Argument[]
  isRequired?: boolean
}
// 选项节点的名字可以是单个字符串或别名数组（例如 `-h` 与 `--help` 同一项）。

export async function loadFigSpec(
  command: string,
): Promise<CommandSpec | null> {
  if (!command || command.includes('/') || command.includes('\\')) return null
  if (command.includes('..')) return null
  if (command.startsWith('-') && command !== '-') return null

  try {
    const module = await import(`@withfig/autocomplete/build/${command}.js`)
    return module.default || module
  } catch {
    return null
  }
}
// 图规格兜底加载。三道拦截都是为了不把用户输入当模块路径：
// 含路径分隔符、含 `..`、以 `-` 开头（纯 `-` 除外，那是标准输入约定）。
// 动态 import 失败返回 null，让上层继续走「无规格」的保守路径。
export const getCommandSpec = memoizeWithLRU(
  async (command: string): Promise<CommandSpec | null> => {
    const spec =
      specs.find(s => s.name === command) ||
      (await loadFigSpec(command)) ||
      null
    return spec
  },
  (command: string) => command,
)
// 带 LRU 的记忆化包装：内置规格表先查，查不到再试图规格，两者都无则 null。键就是命令名本身。
