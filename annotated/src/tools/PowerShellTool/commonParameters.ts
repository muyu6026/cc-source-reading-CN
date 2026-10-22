/**
 * PowerShell Common Parameters (available on all cmdlets via [CmdletBinding()]).
 * Source: about_CommonParameters (PowerShell docs) + Get-Command output.
 *
 * Shared between pathValidation.ts (merges into per-cmdlet known-param sets)
 * and readOnlyValidation.ts (merges into safeFlags check). Split out to break
 * what would otherwise be an import cycle between those two files.
 *
 * Stored lowercase with leading dash — callers `.toLowerCase()` their input.
 */
// 通用参数清单（PowerShell 所有 cmdlet 经 CmdletBinding 都自带），pathValidation 与 readOnlyValidation 共用——独立成文件就是为了打破这两个大文件之间的 import 环。存储统一小写带前导横杠，调用方先把输入 toLowerCase。

export const COMMON_SWITCHES = ['-verbose', '-debug']

export const COMMON_VALUE_PARAMS = [
  '-erroraction',
  '-warningaction',
  '-informationaction',
  '-progressaction',
  '-errorvariable',
  '-warningvariable',
  '-informationvariable',
  '-outvariable',
  '-outbuffer',
  '-pipelinevariable',
]
// 十个带值参数（-erroraction、-outvariable 等）——它们只影响错误处理与输出收集，不改变命令语义，校验时可放行。

export const COMMON_PARAMETERS: ReadonlySet<string> = new Set([
  ...COMMON_SWITCHES,
  ...COMMON_VALUE_PARAMS,
])
// 开关与带值参数合并成单一 Set 供快速查询。
