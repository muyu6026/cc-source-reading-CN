// ═══════════════════════════════════════════════════════════════════════════
// src/tools/BashTool/commandSemantics.ts —— 「退出码该不该当成错误」的判定表
//
// 【这个文件要解决的问题】
//   模型通过 BashTool 跑 `grep foo file.txt`，如果没匹配到，grep 返回退出码 1。
//   按 Unix 惯例「非 0 = 失败」的粗暴规则，这会被当成工具执行错误，
//   模型就会看到一条「Command failed with exit code 1」，然后开始瞎折腾：换写法、道歉、重试。
//   但其实 grep 返回 1 完全正常 —— 它的意思是「没找到」，不是「出错了」。
//
//   同理还有：rg（同 grep）、find（1 = 部分目录没权限读，但仍算成功）、
//   diff（1 = 两个文件有差异，这恰恰是它工作的正常结果）、test（1 = 条件为假）。
//   这个文件就是把这些命令的退出码语义**硬编码成一张表**，把「非 0」细分成
//   「有意义的结果」和「真错误」两类。
//
// 【它在整条链路里的位置】
//   BashTool.tsx:690
//     interpretationResult = interpretCommandResult(input.command, result.code, ...)
//   BashTool.tsx:714
//     if (interpretationResult.isError && !isInterrupt) throw new ShellError(...)
//   → 也就是说：本文件判定 isError 为 true 时，BashTool 会**抛异常**，
//     这次工具调用就以失败告终；判定为 false 时，输出照常作为结果交给模型。
//   一句话：这里是「一次 bash 执行算成功还是失败」的最终裁决点。
//
// 【和 docs 的对应】
//   04-工具系统.md 讲 Tool 契约（call / isConcurrencySafe / isReadOnly …）；
//   本篇讲的是 Tool 内部的一个细节策略：怎么解读 exit code。
//   另有 PowerShellTool/commandSemantics.ts 是它的 Windows 版孪生兄弟，结构几乎一样。
//
// 【阅读约定】
//   · 英文原文（含原注释）一个字都不删
//   · 紧跟其后的 `// 译：` 是中文直译
//   · `// 注：` 是我补充的解释
//   · `// ── N. xxx ──` 是我加的段落分隔
//
// 原文位置：source/src/tools/BashTool/commandSemantics.ts（141 行）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Command semantics configuration for interpreting exit codes in different contexts.
 *
 * Many commands use exit codes to convey information other than just success/failure.
 * For example, grep returns 1 when no matches are found, which is not an error condition.
 */
// 译：命令语义配置 —— 用于在不同语境下解释退出码。
//     很多命令用退出码传达「成功/失败」以外的信息。
//     例如 grep 在没找到匹配时返回 1，这并不属于错误状态。
// 注：这段注释就是整个文件的论点。注意用词 "in different contexts"（在不同语境下）——
//     同一个退出码 1，对 grep 是「正常工作」，对 gcc 就是「编译失败」。所以必须有张表。

import { splitCommand_DEPRECATED } from '../../utils/bash/commands.js'
// 译：从 ../../utils/bash/commands.js 导入 splitCommand_DEPRECATED
// 注：用于把 `cd /tmp && grep foo bar | head` 这种复合命令拆成几段。
//     名字里带 _DEPRECATED 是个信号：作者认为这套自己手写的 shell 解析器不够可靠
//     （见下面 heuristicallyExtractBaseCommand 的注释「可能错得离谱」），
//     但已经有很多地方（含权限系统）依赖它，所以只能标记废弃、不能删除。
// 注：该函数实现于 utils/bash/commands.ts:265，除了按 && || ; | 拆分，
//     还会顺手剥掉重定向（2>&1、> file.txt、>> log）—— 因为重定向的目标文件
//     不该被当成一条独立命令去弹权限确认。

// ── 1. 语义函数的类型：输入退出码和输出流，输出「算不算错」+ 一句人话 ──────────

export type CommandSemantic = (
  exitCode: number,
  stdout: string,
  stderr: string,
) => {
  isError: boolean
  message?: string
}
// 译：命令语义的类型是一个函数：(退出码, 标准输出, 标准错误) => { isError, message? }
// 注：message 是可选的（`message?:`），因为「成功」时没有话要说。
// 注：三个参数里只有 exitCode 真正被用到 —— 表里每一条都把后两个写成 `_stdout` / `_stderr`
//     （下划线前缀是 TS 的约定：我声明了这个参数，但故意不用它）。
//     既然用不上，为什么还留着？因为它是一处**扩展位**：将来要是有命令得靠输出内容判断
//     （比如某些工具退出码永远是 0，只能 grep 输出里的 "ERROR"），改表就行，
//     不用再动 BashTool 的调用点。可惜至今没有一条用上 —— 属实的「预留接口」。
// 注：BashTool.tsx:690 调用时甚至直接传了空串当 stderr：
//       interpretCommandResult(input.command, result.code, result.stdout || '', '')
//     因为那边把 stderr 合并进了 stdout（注释说 "stderr is interleaved in stdout (merged fd)"）。

// ── 2. 兜底语义：0 成功，其余全算错 ────────────────────────────────────────────

/**
 * Default semantic: treat only 0 as success, everything else as error
 */
// 译：默认语义：只有 0 视为成功，其他一律视为错误
const DEFAULT_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  // 注：整个文件里唯一一次「用到 exitCode 做比较」的朴素版本。
  isError: exitCode !== 0,
  // 译：是否出错 = 退出码不等于 0
  message:
    exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
  // 译：出错时给出「命令失败，退出码 N」，成功时为 undefined
  // 注：`undefined` 而不是空字符串，是为了让调用方能用 `message?` 这种可选链语义区分
  //     「没有话」和「有一句空话」。
})
// 注：注意这是个「表驱动 + 兜底」结构：没登记的命令（ls / cat / npm …）全走这条默认规则。
//     绝大多数命令确实只有 0 和非 0 两种结局，所以这条兜底是合理的，不需要穷举。

// ── 3. 特例表：六个（其实是五条 + 一个别名）需要重新解释退出码的命令 ──────────

/**
 * Command-specific semantics
 */
// 译：各命令专属的语义
const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([
  // 注：用 Map 而不是普通对象 {}，两个理由：
  //     1. 键是用户输入的命令名，用 Map 不会撞上 `constructor`、`toString` 这类原型属性；
  //     2. 查表语义明确（.get 找不到就是 undefined），不用 hasOwnProperty 那套。
  // 注：这份表的每一项都是「同一个形状的内联箭头函数」，读的时候只需关注两件事：
  //     ① isError 的阈值是多少  ② message 在哪个退出码上给出。

  // grep: 0=matches found, 1=no matches, 2+=error
  [
    'grep',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      // 译：退出码 ≥ 2 才算错误（0=找到了，1=没找到，都不算错）
      message: exitCode === 1 ? 'No matches found' : undefined,
      // 译：退出码等于 1 时给一句「没有找到匹配」
      // 注：这句 message 很关键 —— 它会被写进工具结果里，让模型明白
      //     「不是命令坏了，是这个模式真的不存在」，从而不再反复重试。
    }),
  ],

  // ripgrep has same semantics as grep
  [
    'rg',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'No matches found' : undefined,
    }),
  ],
  // 译：ripgrep 的语义和 grep 相同
  // 注：ripgrep（rg）是 Claude Code 生态里高频使用的搜索工具，所以即使是
  //     「和上面一模一样」，也**刻意复制一份**而不做映射复用 —— 表驱动代码里，
  //     重复比间接更好读，也方便将来单独调某一条（比如 rg 的 2 有时只是权限警告）。

  // find: 0=success, 1=partial success (some dirs inaccessible), 2+=error
  [
    'find',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message:
        exitCode === 1 ? 'Some directories were inaccessible' : undefined,
      // 译：退出码 1 时说「部分目录无法访问」
    }),
  ],
  // 译：find：0=成功，1=部分成功（有些目录读不了），2 及以上=错误
  // 注：find 的 1 最容易误判。你 `find / -name x` 时总会撞上几个权限不足的目录，
  //     find 返回 1，但结果其实拿到了大半。按默认规则会被判成失败 —— 那就是噪音。

  // diff: 0=no differences, 1=differences found, 2+=error
  [
    'diff',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'Files differ' : undefined,
      // 译：退出码 1 时说「文件存在差异」
    }),
  ],
  // 译：diff：0=无差异，1=有差异，2 及以上=错误
  // 注：diff 的 1 是「任务成功完成，答案是『不一样』」。把它当错误会非常荒诞：
  //     模型跑 diff 就是为了知道有没有差异，有差异反而报错，逻辑就反了。

  // test/[: 0=condition true, 1=condition false, 2+=error
  [
    'test',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'Condition is false' : undefined,
    }),
  ],
  // 译：test / [：0=条件成立，1=条件不成立，2 及以上=错误
  // 注：`test -f a.txt` 是 shell 里判条件的标准写法：退出码本身就是答案。
  //     模型常用 `test -f x && ...` 这种探测式命令，绝不能把「文件不存在」当执行失败。

  // [ is an alias for test
  [
    '[',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'Condition is false' : undefined,
    }),
  ],
  // 译：[ 是 test 的别名
  // 注：`[ -f a.txt ]` 里的 `[` 在 shell 里是一个**真实的命令**（execve 的就是它，
  //     通常软链到 /usr/bin/test 或内建），所以拆出来的首个 token 就是字符串 "["。
  //     这也是必须单独登记一条的原因：别名在进程层面就是另一个名字。

  // wc, head, tail, cat, etc.: these typically only fail on real errors
  // so we use default semantics
])
// 译：wc、head、tail、cat 等等：它们通常只在真出错时才失败，
//     所以我们用默认语义（不登记，直接走 DEFAULT_SEMANTIC）。
// 注：这句注释说明了「表里为什么只有这么几条」—— 这不是漏写，而是**有意的克制**：
//     只登记那些存在「非 0 但正常」情况的命令，其余的交给兜底。
//     加表是有成本的（多一条规则就多一处可能判断错的地方），所以宁缺勿滥。
// 注：整张表共 6 个键，但语义只有 4 种（grep/rg 同、test/[ 同、find 独、diff 独）。
//     没有做「同义合并」，是为了让改动可以精确到单个命令名。

// ── 4. 查表：从一整条命令行里找出「哪个命令决定退出码」 ────────────────────────

/**
 * Get the semantic interpretation for a command
 */
// 译：取得某个命令的语义解释
function getCommandSemantic(command: string): CommandSemantic {
  // Extract the base command (first word, handling pipes)
  // 译：提取基础命令（第一个词，并处理管道）
  // 注：注释说 "handling pipes"，但真正的管道处理发生在
  //     heuristicallyExtractBaseCommand 里 —— 它先把命令拆段，再在这里取首词。
  const baseCommand = heuristicallyExtractBaseCommand(command)
  const semantic = COMMAND_SEMANTICS.get(baseCommand)
  // 注：.get 查不到就是 undefined，所以下一行必须显式判 undefined，
  //     不能写 `semantic || DEFAULT_SEMANTIC` 那样把「falsy」混为一谈
  //     （虽然函数永远 truthy，但显式写出来意图更清楚）。
  return semantic !== undefined ? semantic : DEFAULT_SEMANTIC
  // 译：查到就用查到的，查不到就用默认语义
}

/**
 * Extract just the command name (first word) from a single command string.
 */
// 译：从**单条**命令字符串里只提取命令名（第一个词）
function extractBaseCommand(command: string): string {
  return command.trim().split(/\s+/)[0] || ''
  // 译：去掉首尾空白 → 按任意空白切成数组 → 取第 0 个 → 空则给空串
  // 注：`|| ''` 是必要的兜底：空字符串 split 后得到 ['']，其实有值；
  //     但 `command` 全是空白时 trim 后是 ''，split 仍是 ['']，第 0 项是 '' —— 
  //     这里的 || '' 主要是让类型上明确「一定返回 string，不会 undefined」。
  // 注：这是纯字符串切分，**完全不理解 shell 语法**：
  //     `FOO=1 grep x` 会取到 "FOO=1"；`/usr/bin/grep x` 会取到 "/usr/bin/grep"（查不到表）；
  //     `sudo grep x` 会取到 "sudo"。下面那个「启发式」函数负责缓解一部分。
}

/**
 * Extract the primary command from a complex command line;
 * May get it super wrong - don't depend on this for security
 */
// 译：从复杂的命令行里提取「主要的那个命令」；
//     可能错得离谱 —— 不要依赖它做安全判断。
// 注：这句警告非常诚实，也是读这份源码时最该记住的一句话。它的意思是：
//     本文件的输出只影响「错误提示好不好看」，绝不能被用来决定「这条命令许不许跑」。
//     权限判断走的是另一套（src/utils/permissions/，那里有真正的 tokenizer 和路径约束检查）。
//     把「显示用」和「安全用」的解析分开，是很重要的架构纪律。
function heuristicallyExtractBaseCommand(command: string): string {
  const segments = splitCommand_DEPRECATED(command)
  // 注：把 `a && b | c` 拆成 ['a', 'b', 'c']（同时剥掉重定向）。
  //     "heuristic"（启发式）这个词就是在承认：这是猜，不是解析。

  // Take the last command as that's what determines the exit code
  const lastCommand = segments[segments.length - 1] || command
  // 译：取最后一条命令，因为退出码由它决定
  // 注：为什么是最后一条？因为 shell 的退出码规则是「整条命令列表的退出码 = 最后执行的那条」。
  //     比如 `grep foo x && echo ok`：如果 grep 没匹配到，&& 短路，echo 不执行，
  //     退出码是 grep 的 1。而 `echo hi; grep foo x` 的退出码才是 grep 的 1。
  //     取最后一段是这个规则的粗略近似（严格来说 `||` 分支会让它算错，但那属于「启发式」允许的误差）。
  // 注：`|| command` 的兜底处理「拆出来是空数组」的极端情况（比如命令串只有空白或只有重定向），
  //     此时退回原始整串去 extractBaseCommand。

  return extractBaseCommand(lastCommand)
  // 注：拆完再取首词。所以 `cd /tmp && grep -r foo .` → 最后一段 `grep -r foo .` → "grep" → 命中表。
}

// ── 5. 对外唯一入口 ────────────────────────────────────────────────────────────

/**
 * Interpret command result based on semantic rules
 */
// 译：依据语义规则解释命令执行结果
export function interpretCommandResult(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): {
  isError: boolean
  message?: string
} {
  // 注：参数顺序是「先命令后结果」，因为得先知道跑的是什么命令，才知道怎么读退出码。
  const semantic = getCommandSemantic(command)
  const result = semantic(exitCode, stdout, stderr)
  // 注：这里是「先查规则、再套用」的两步。分开写而不是一行链式调用，
  //     是为了调试时能分别在两行下断点 —— 这在排查「为什么这条命令被判成失败」时很有用。

  return {
    isError: result.isError,
    message: result.message,
  }
  // 注：逐字段重建对象，而不是直接 `return result`。看起来多余，作用是
  //     **把返回结构钉死在这个函数里**：将来语义函数多返回个字段，也不会偷偷漏给上层，
  //     上层的类型契约保持稳定。
}

// ── 6. 三个容易看漏的事实（读完上面的代码再回看） ──────────────────────────────

// 事实一：BashTool **从来不用** message。
//   对比一下两个调用方：
//     PowerShellTool.tsx:649  `returnCodeInterpretation: interpretation.message,`  ← 用上了
//     BashTool.tsx:696/714    只读 `interpretationResult.isError`                   ← 丢掉了
//   也就是说在 Bash 这边，'No matches found' / 'Files differ' 这些精心写的提示语，
//   实际并没有出现在模型看到的输出里，只影响了「抛不抛 ShellError」这一个决定。
//   （一个可以顺手改进的点，也是读源码时才看得出来的不一致。）

// 事实二：判为 isError 后会发生什么，是「抛异常」，不是「返回失败字符串」。
//   BashTool.tsx:714-718 `throw new ShellError('', outputWithSbFailures, result.code, result.interrupted)`。
//   所以把某条命令从表里删掉，不只是提示文案变化 —— 模型会从「拿到一段正常输出」
//   变成「看到一次工具调用失败」。影响比字面大。

// 事实三：Windows 上跑的是另一份表。
//   src/tools/PowerShellTool/commandSemantics.ts 是同样的结构，但登记的是
//   findstr / Select-String 这类 PowerShell 世界的命令，退出码约定也不同。
//   两份文件不共享代码，改的时候要记得**两边都改**，否则跨平台行为会不一致。
