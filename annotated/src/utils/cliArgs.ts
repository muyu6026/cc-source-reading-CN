// 两个命令行参数的小工具。第一个解决「某些开关必须在初始化之前就读到」的问题，因为命令行框架的解析发生在初始化之后；第二个修正框架在透传模式下把双横线分隔符当成普通参数的行为。
/**
 * Parse a CLI flag value early, before Commander.js processes arguments.
 * Supports both space-separated (--flag value) and equals-separated (--flag=value) syntax.
 *
 * This function is intended for flags that must be parsed before init() runs,
 * such as --settings which affects configuration loading. For normal flag parsing,
 * rely on Commander.js which handles this automatically.
 *
 * @param flagName The flag name including dashes (e.g., '--settings')
 * @param argv Optional argv array to parse (defaults to process.argv)
 * @returns The value if found, undefined otherwise
 */
export function eagerParseCliFlag(
  flagName: string,
  argv: string[] = process.argv,
): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    // Handle --flag=value syntax
    if (arg?.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1)
// 等号写法直接按前缀切：以「开关名加等号」开头就取等号之后的部分。这里不做去空格也不做其他校验，因为目的只是尽早拿到原始值，真正的校验留给后续配置加载。
    }
    // Handle --flag value syntax
    if (arg === flagName && i + 1 < argv.length) {
      return argv[i + 1]
    }
  }
  return undefined
}
// 空格写法必须多查一步「下一个位置是否存在」，否则末尾只写开关名不带值时会取到 undefined 并把它当成合法值返回。两种写法在同一个循环里按参数逐个检查，先命中先返回；都找不到才返回 undefined，让调用方区分「没传」与「传了空串」。

/**
 * Handle the standard Unix `--` separator convention in CLI arguments.
 *
 * When using Commander.js with `.passThroughOptions()`, the `--` separator
 * is passed through as a positional argument rather than being consumed.
 * This means when a user runs:
 *   `cmd --opt value name -- subcmd --flag arg`
 *
 * Commander parses it as:
 *   positional1 = "name", positional2 = "--", rest = ["subcmd", "--flag", "arg"]
 *
 * This function corrects the parsing by extracting the actual command from
 * the rest array when the positional is `--`.
 *
 * @param commandOrValue - The parsed positional that may be "--"
 * @param args - The remaining arguments array
 * @returns Object with corrected command and args
 */
// 上面注释描述的是一个具体的解析错位：框架在透传模式下不会吞掉双横线，而是把它当成第一个位置参数，真正的子命令于是落到剩余参数数组的第一位。下面这个函数就是把这个错位纠正回来。
export function extractArgsAfterDoubleDash(
  commandOrValue: string,
  args: string[] = [],
): { command: string; args: string[] } {
  if (commandOrValue === '--' && args.length > 0) {
    return {
      command: args[0]!,
      args: args.slice(1),
    }
  }
  return { command: commandOrValue, args }
}
// 纠正只在「位置参数正好是双横线且剩余参数非空」时发生：把剩余参数的第一项提升为命令，其余作为参数。条件不满足就原样返回，因此对正常调用是完全无副作用的透传。
