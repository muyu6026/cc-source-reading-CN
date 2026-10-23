/**
 * If the first line of a bash command is a `# comment` (not a `#!` shebang),
 * return the comment text stripped of the `#` prefix. Otherwise undefined.
 *
 * Under fullscreen mode this is the non-verbose tool-use label AND the
 * collapse-group ⎿ hint — it's what Claude wrote for the human to read.
 */
// 命令首行若是 # 注释（不是 #! shebang），摘出来当 UI 标签——全屏模式下这是非 verbose 的工具调用标签和折叠组提示。**是 Claude 写给人看的**，比截断的命令文本友好得多。
export function extractBashCommentLabel(command: string): string | undefined {
// extractBashCommentLabel 只取第一行：注释必须写在命令最前面才有效。
  const nl = command.indexOf('\n')
  const firstLine = (nl === -1 ? command : command.slice(0, nl)).trim()
  if (!firstLine.startsWith('#') || firstLine.startsWith('#!')) return undefined
// 排除 #!：shebang 不是给人看的标签。
  return firstLine.replace(/^#+\s*/, '') || undefined
// 摘掉开头连续的 # 和空白；只剩 # 号时返回 undefined（空标签不如没有）。
}
