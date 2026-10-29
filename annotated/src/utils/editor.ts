import {
  type SpawnOptions,
  type SpawnSyncOptions,
  spawn,
  spawnSync,
} from 'child_process'
import memoize from 'lodash-es/memoize.js'
import { basename } from 'path'
import instances from '../ink/instances.js'
import { logForDebugging } from './debug.js'
import { whichSync } from './which.js'
// 引入外部编辑器启动所需的依赖：child_process 的 spawn 与 spawnSync、lodash 的 memoize、
// path.basename 取文件名、Ink 实例用于终端接管，以及调试日志与 which 探测命令是否可用。

function isCommandAvailable(command: string): boolean {
  return !!whichSync(command)
}

// GUI editors that open in a separate window and can be spawned detached
// without fighting the TUI for stdin. VS Code forks (cursor, windsurf, codium)
// are listed explicitly since none contain 'code' as a substring.
const GUI_EDITORS = [
  'code',
  'cursor',
  'windsurf',
  'codium',
  'subl',
  'atom',
  'gedit',
  'notepad++',
  'notepad',
]
// GUI_EDITORS 列出可在独立窗口打开、适合 detached 启动的图形编辑器；
// PLUS_N_EDITORS 匹配支持加号行号跳转的终端编辑器；VSCODE_FAMILY 是需用减 g 传文件行号的家族。

// Editors that accept +N as a goto-line argument. The Windows default
// ('start /wait notepad') does not — notepad treats +42 as a filename.
const PLUS_N_EDITORS = /\b(vi|vim|nvim|nano|emacs|pico|micro|helix|hx)\b/
// 用正则匹配 vi、vim、nvim、nano、emacs 等支持加号行号参数的终端编辑器，
// Windows 记事本不在其列，因为它会把加号加数字当成文件名。

// VS Code and forks use -g file:line. subl uses bare file:line (no -g).
const VSCODE_FAMILY = new Set(['code', 'cursor', 'windsurf', 'codium'])
// VSCODE_FAMILY 集合用于决定 GUI 编辑器跳转行号时传参形式：
// VS Code 系列用减 g 加文件冒号行号，subl 直接传文件冒号行号。

/**
 * Classify the editor as GUI or not. Returns the matched GUI family name
 * for goto-line argv selection, or undefined for terminal editors.
 * Note: this is classification only — spawn the user's actual binary, not
 * this return value, so `code-insiders` / absolute paths are preserved.
 *
 * Uses basename so /home/alice/code/bin/nvim doesn't match 'code' via the
 * directory component. code-insiders → still matches 'code', /usr/bin/code →
 * 'code' → matches.
 */
// classifyGuiEditor 仅做分类：根据编辑器名匹配 GUI 家族并返回家族名供后续选参；
// 它不负责真正启动，因此 code-insiders 或绝对路径都能原样保留。
export function classifyGuiEditor(editor: string): string | undefined {
  const base = basename(editor.split(' ')[0] ?? '')
  return GUI_EDITORS.find(g => base.includes(g))
}

/**
 * Build goto-line argv for a GUI editor. VS Code family uses -g file:line;
 * subl uses bare file:line; others don't support goto-line.
 */
function guiGotoArgv(
  guiFamily: string,
  filePath: string,
  line: number | undefined,
): string[] {
  if (!line) return [filePath]
  if (VSCODE_FAMILY.has(guiFamily)) return ['-g', `${filePath}:${line}`]
  if (guiFamily === 'subl') return [`${filePath}:${line}`]
  return [filePath]
}
// guiGotoArgv 为 GUI 编辑器拼装跳转行号参数：无行号只传文件路径，
// VS Code 家族用减 g、subl 用裸文件冒号行号，其余不支持则只给路径。

/**
 * Launch a file in the user's external editor.
 *
 * For GUI editors (code, subl, etc.): spawns detached — the editor opens
 * in a separate window and Claude Code stays interactive.
 *
 * For terminal editors (vim, nvim, nano, etc.): blocks via Ink's alt-screen
 * handoff until the editor exits. This is the same dance as editFileInEditor()
 * in promptEditor.ts, minus the read-back.
 *
 * Returns true if the editor was launched, false if no editor is available.
 */
// openFileInExternalEditor 是启动外部编辑器的主函数：优先从环境或默认列表拿到编辑器，
// GUI 类用 detached 子进程不抢终端，终端类则用 Ink 的 alt-screen 接管直到退出。
export function openFileInExternalEditor(
  filePath: string,
  line?: number,
): boolean {
  const editor = getExternalEditor()
  if (!editor) return false

  // Spawn the user's actual binary (preserves code-insiders, abs paths, etc.).
  // Split into binary + extra args so multi-word values like 'start /wait
  // notepad' or 'code --wait' propagate all tokens to spawn.
  const parts = editor.split(' ')
  const base = parts[0] ?? editor
  const editorArgs = parts.slice(1)
  const guiFamily = classifyGuiEditor(editor)

  if (guiFamily) {
    const gotoArgv = guiGotoArgv(guiFamily, filePath, line)
    const detachedOpts: SpawnOptions = { detached: true, stdio: 'ignore' }
    let child
    if (process.platform === 'win32') {
      // shell: true on win32 so code.cmd / cursor.cmd / windsurf.cmd resolve —
      // CreateProcess can't execute .cmd/.bat directly. Assemble quoted command
      // string; cmd.exe doesn't expand $() or backticks inside double quotes.
      // Quote each arg so paths with spaces survive the shell join.
      const gotoStr = gotoArgv.map(a => `"${a}"`).join(' ')
      child = spawn(`${editor} ${gotoStr}`, { ...detachedOpts, shell: true })
    } else {
      // POSIX: argv array with no shell — injection-safe. shell: true would
      // expand $() / backticks inside double quotes, and filePath is
      // filesystem-sourced (possible RCE from a malicious repo filename).
      child = spawn(base, [...editorArgs, ...gotoArgv], detachedOpts)
    }
    // spawn() emits ENOENT asynchronously. ENOENT on $VISUAL/$EDITOR is a
    // user-config error, not an internal bug — don't pollute error telemetry.
    child.on('error', e =>
      logForDebugging(`editor spawn failed: ${e}`, { level: 'error' }),
    )
    child.unref()
    return true
  }
// GUI 分支在此闭合：Windows 上用 shell 拼命令让点 cmd 解析，POSIX 上直接传 argv 数组避免命令注入。

  // Terminal editor — needs alt-screen handoff since it takes over the
  // terminal. Blocks until the editor exits.
  const inkInstance = instances.get(process.stdout)
  if (!inkInstance) return false
  // Only prepend +N for editors known to support it — notepad treats +42 as a
  // filename to open. Test basename so /home/vim/bin/kak doesn't match 'vim'
  // via the directory segment.
  const useGotoLine = line && PLUS_N_EDITORS.test(basename(base))
  inkInstance.enterAlternateScreen()
  try {
    const syncOpts: SpawnSyncOptions = { stdio: 'inherit' }
    let result
    if (process.platform === 'win32') {
      // On Windows use shell: true so cmd.exe builtins like `start` resolve.
      // shell: true joins args unquoted, so assemble the command string with
      // explicit quoting ourselves (matching promptEditor.ts:74). spawnSync
      // returns errors in .error rather than throwing.
      const lineArg = useGotoLine ? `+${line} ` : ''
      result = spawnSync(`${editor} ${lineArg}"${filePath}"`, {
        ...syncOpts,
        shell: true,
      })
    } else {
      // POSIX: spawn directly (no shell), argv array is quote-safe.
      const args = [
        ...editorArgs,
        ...(useGotoLine ? [`+${line}`, filePath] : [filePath]),
      ]
      result = spawnSync(base, args, syncOpts)
    }
    if (result.error) {
      logForDebugging(`editor spawn failed: ${result.error}`, {
        level: 'error',
      })
      return false
    }
    return true
  } finally {
    inkInstance.exitAlternateScreen()
  }
}
// openFileInExternalEditor 收尾：终端编辑器通过 Ink 进入与退出 alt-screen，
// spawnSync 的错误统一记录到调试日志而不抛异常，保证主流程不被打断。

// getExternalEditor 用 memoize 缓存结果：优先读 VISUAL 与 EDITOR 环境变量，
// Windows 上跳过可用性探测直接回退到 start 等待记事本，其余平台按优先级查找可用编辑器。
export const getExternalEditor = memoize((): string | undefined => {
  // Prioritize environment variables
  if (process.env.VISUAL?.trim()) {
    return process.env.VISUAL.trim()
  }

  if (process.env.EDITOR?.trim()) {
    return process.env.EDITOR.trim()
  }

  // `isCommandAvailable` breaks the claude process' stdin on Windows
  // as a bandaid, we skip it
  if (process.platform === 'win32') {
    return 'start /wait notepad'
  }

  // Search for available editors in order of preference
  const editors = ['code', 'vi', 'nano']
  return editors.find(command => isCommandAvailable(command))
})
// 本文件只解决「把文件交给用户编辑器打开」这一件事，GUI 与终端两条路径分别处理，
// 所有实际启动都调用用户配置的二进制，避免把 code-insiders 或绝对路径这类信息丢失。
