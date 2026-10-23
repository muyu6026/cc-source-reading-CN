import { useCallback, useState } from 'react'
import { KeyboardEvent } from '../ink/events/keyboard-event.js'
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- backward-compat bridge until consumers wire handleKeyDown to <Box onKeyDown>
import { useInput } from '../ink.js'
import {
  Cursor,
  getLastKill,
  pushToKillRing,
  recordYank,
  resetKillAccumulation,
  resetYankState,
  updateYankLength,
  yankPop,
} from '../utils/Cursor.js'
import { useTerminalSize } from './useTerminalSize.js'

type UseSearchInputOptions = {
  isActive: boolean
  onExit: () => void
// 【Esc 的两种人格】提供了 onCancel 时：单按 Esc 直接调用它（没有「先清空再退出」的两段式）。没提供时：Esc 清空非空 query，空 query 时退出；Ctrl+C 静默吞掉（switch 里没有对应 case）。onCancel 的语义是「放弃搜索但保持上下文」（比如从历史里唤起搜索又反悔），onExit 是「确认提交」。
  /** Esc + Ctrl+C abandon (distinct from onExit = Enter commit). When
   *  provided: single-Esc calls this directly (no clear-first-then-exit
   *  two-press). When absent: current behavior — Esc clears non-empty
   *  query, exits on empty; Ctrl+C silently swallowed (no switch case). */
  onCancel?: () => void
  onExitUp?: () => void
  columns?: number
  passthroughCtrlKeys?: string[]
  initialQuery?: string
  /** Backspace (and ctrl+h) on empty query calls onCancel ?? onExit — the
   *  less/vim "delete past the /" convention. Dialogs that want Esc-only
   *  cancel set this false so a held backspace doesn't eject the user. */
// 空 query 上按 Backspace（和 ctrl+h）调用 onCancel ?? onExit——less/vim「删掉 / 之外」的惯例。对话框如果不想要 Esc-only 取消（长按 backspace 会把用户弹出去），设 false。
  backspaceExitsOnEmpty?: boolean
}

type UseSearchInputReturn = {
  query: string
  setQuery: (q: string) => void
  cursorOffset: number
  handleKeyDown: (e: KeyboardEvent) => void
}

function isKillKey(e: KeyboardEvent): boolean {
  if (e.ctrl && (e.key === 'k' || e.key === 'u' || e.key === 'w')) {
    return true
  }
  if (e.meta && e.key === 'backspace') {
    return true
  }
  return false
}

function isYankKey(e: KeyboardEvent): boolean {
  return (e.ctrl || e.meta) && e.key === 'y'
}

// Special key names that fall through the explicit handlers above the
// text-input branch (return/escape/arrows/home/end/tab/backspace/delete
// all early-return). Reject these so e.g. PageUp doesn't leak 'pageup'
// as literal text. The length>=1 check below is intentionally loose —
// batched input like stdin.write('abc') arrives as one multi-char e.key,
// matching the old useInput(input) behavior where cursor.insert(input)
// inserted the full chunk.
// 特殊键名黑名单：上面各显式处理器已提前 return 的键（return/escape/arrows/home/end/tab/backspace/delete）不会走到文本分支，但这个集合里的会——不收它们，PageUp 会把 'pageup' 当字面文本插进去。下面的 length>=1 检查故意放宽：stdin.write('abc') 这种批量输入以一个多字符 e.key 到达，整块插入，与旧 useInput(input) 行为一致。
const UNHANDLED_SPECIAL_KEYS = new Set([
  'pageup',
  'pagedown',
  'insert',
  'wheelup',
  'wheeldown',
  'mouse',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
])

export function useSearchInput({
  isActive,
  onExit,
  onCancel,
  onExitUp,
  columns,
  passthroughCtrlKeys = [],
  initialQuery = '',
  backspaceExitsOnEmpty = true,
}: UseSearchInputOptions): UseSearchInputReturn {
  const { columns: terminalColumns } = useTerminalSize()
  const effectiveColumns = columns ?? terminalColumns
  const [query, setQueryState] = useState(initialQuery)
  const [cursorOffset, setCursorOffset] = useState(initialQuery.length)

  const setQuery = useCallback((q: string) => {
    setQueryState(q)
    setCursorOffset(q.length)
  }, [])

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (!isActive) return

    const cursor = Cursor.fromText(query, effectiveColumns, cursorOffset)
// 每次击键从「当前 query + cursorOffset」重建 Cursor 对象——无状态光标模型，所有编辑操作（left/backspace/insert…）返回新 Cursor，setQueryState/setCursorOffset 两个 state 跟随。没有隐藏的文档状态可腐坏。

    // Check passthrough ctrl keys
    if (e.ctrl && passthroughCtrlKeys.includes(e.key.toLowerCase())) {
      return
    }

    // Reset kill accumulation for non-kill keys
    if (!isKillKey(e)) {
      resetKillAccumulation()
    }

    // Reset yank state for non-yank keys
    if (!isYankKey(e)) {
      resetYankState()
    }

    // Exit conditions
    if (e.key === 'return' || e.key === 'down') {
// 退出键：return 和 down 都触发 onExit（搜索框在列表上方时，向下键 = 确认当前匹配）。up 是可选的 onExitUp——调用方可以借它实现「向上跳到上一条历史」。
      e.preventDefault()
      onExit()
      return
    }
    if (e.key === 'up') {
      e.preventDefault()
      if (onExitUp) {
        onExitUp()
      }
      return
    }
    if (e.key === 'escape') {
      e.preventDefault()
      if (onCancel) {
        onCancel()
      } else if (query.length > 0) {
// Esc 三段式（无 onCancel 时）：先清空 query，再按才退出。第一按防止误触丢搜索词，第二按确认退出。
        setQueryState('')
        setCursorOffset(0)
      } else {
        onExit()
      }
      return
    }

    // Backspace/Delete
    if (e.key === 'backspace') {
      e.preventDefault()
      if (e.meta) {
        // Meta+Backspace: kill word before
        const { cursor: newCursor, killed } = cursor.deleteWordBefore()
        pushToKillRing(killed, 'prepend')
        setQueryState(newCursor.text)
        setCursorOffset(newCursor.offset)
        return
      }
      if (query.length === 0) {
        // Backspace past the / — cancel (clear + snap back), not commit.
        // less: same. vim: deletes the / and exits command mode.
// 空 query 上的 Backspace = less/vim 惯例：不是「删字符」而是「删掉 / 本身」→ 取消搜索。注释点明了两个编辑器的不同：less 同样表现，vim 是删掉 / 并退出命令模式。
        if (backspaceExitsOnEmpty) (onCancel ?? onExit)()
        return
      }
      const newCursor = cursor.backspace()
      setQueryState(newCursor.text)
      setCursorOffset(newCursor.offset)
      return
    }

    if (e.key === 'delete') {
      e.preventDefault()
      const newCursor = cursor.del()
      setQueryState(newCursor.text)
      setCursorOffset(newCursor.offset)
      return
    }

    // Arrow keys with modifiers (word jump)
    if (e.key === 'left' && (e.ctrl || e.meta || e.fn)) {
// Ctrl/Meta/Fn + 左右 = 按词跳转（prevWord/nextWord）。fn 修饰符是 macOS 终端左右箭头的原生编码，不带它 Mac 用户按不了词跳转。
      e.preventDefault()
      const newCursor = cursor.prevWord()
      setCursorOffset(newCursor.offset)
      return
    }
    if (e.key === 'right' && (e.ctrl || e.meta || e.fn)) {
      e.preventDefault()
      const newCursor = cursor.nextWord()
      setCursorOffset(newCursor.offset)
      return
    }

    // Plain arrow keys
    if (e.key === 'left') {
      e.preventDefault()
      const newCursor = cursor.left()
      setCursorOffset(newCursor.offset)
      return
    }
    if (e.key === 'right') {
      e.preventDefault()
      const newCursor = cursor.right()
      setCursorOffset(newCursor.offset)
      return
    }

    // Home/End
    if (e.key === 'home') {
      e.preventDefault()
      setCursorOffset(0)
      return
    }
    if (e.key === 'end') {
      e.preventDefault()
      setCursorOffset(query.length)
      return
    }

    // Ctrl key bindings
    if (e.ctrl) {
      e.preventDefault()
      switch (e.key.toLowerCase()) {
        case 'a':
          setCursorOffset(0)
          return
        case 'e':
          setCursorOffset(query.length)
          return
        case 'b':
          setCursorOffset(cursor.left().offset)
          return
        case 'f':
          setCursorOffset(cursor.right().offset)
          return
        case 'd': {
// ctrl+d 在空 query 上等于 EOF 惯例——less 里是「删到行尾」，这里借来表达「放弃」。
          if (query.length === 0) {
            ;(onCancel ?? onExit)()
            return
          }
          const newCursor = cursor.del()
          setQueryState(newCursor.text)
          setCursorOffset(newCursor.offset)
          return
        }
        case 'h': {
// ctrl+h 是传统 backspace 别名（ASCII BS），空 query 行为与 backspace 对齐。
          if (query.length === 0) {
            if (backspaceExitsOnEmpty) (onCancel ?? onExit)()
            return
          }
          const newCursor = cursor.backspace()
          setQueryState(newCursor.text)
          setCursorOffset(newCursor.offset)
          return
        }
        case 'k': {
// kill ring 三兄弟：ctrl+k 删到行尾（append 到 kill ring）、ctrl+u 删到行首（prepend）、ctrl+w 删前一个词（prepend）。append/prepend 的区分让连续 ctrl+k 能拼回整行。
          const { cursor: newCursor, killed } = cursor.deleteToLineEnd()
          pushToKillRing(killed, 'append')
          setQueryState(newCursor.text)
          setCursorOffset(newCursor.offset)
          return
        }
        case 'u': {
          const { cursor: newCursor, killed } = cursor.deleteToLineStart()
          pushToKillRing(killed, 'prepend')
          setQueryState(newCursor.text)
          setCursorOffset(newCursor.offset)
          return
        }
        case 'w': {
          const { cursor: newCursor, killed } = cursor.deleteWordBefore()
          pushToKillRing(killed, 'prepend')
          setQueryState(newCursor.text)
          setCursorOffset(newCursor.offset)
          return
        }
        case 'y': {
// ctrl+y = yank（粘贴 kill ring 最后一条）。recordYank 记住插入起点和长度，给后续 meta+y 的 yank-pop 做定位。
          const text = getLastKill()
          if (text.length > 0) {
            const startOffset = cursor.offset
            const newCursor = cursor.insert(text)
            recordYank(startOffset, text.length)
            setQueryState(newCursor.text)
            setCursorOffset(newCursor.offset)
          }
          return
        }
        case 'g':
// ctrl+g 是 less 的取消键。注释交代了一个产品事实：11 个调用方里大多数期望 ctrl+c 是 no-op，所以 g/c 分支只在提供了 onCancel 时激活，否则静默 fall through。
        case 'c':
          // Cancel (abandon search). ctrl+g is less's cancel key. Only
          // fires if onCancel provided — otherwise falls through and
          // returns silently (11 call sites, most expect ctrl+c to no-op).
          if (onCancel) {
            onCancel()
            return
          }
      }
      return
    }

    // Meta key bindings
    if (e.meta) {
      e.preventDefault()
      switch (e.key.toLowerCase()) {
        case 'b':
          setCursorOffset(cursor.prevWord().offset)
          return
        case 'f':
          setCursorOffset(cursor.nextWord().offset)
          return
        case 'd': {
// meta+d 删后一个词（与 ctrl+w 的前删对称）。
          const newCursor = cursor.deleteWordAfter()
          setQueryState(newCursor.text)
          setCursorOffset(newCursor.offset)
          return
        }
        case 'y': {
// meta+y = yank-pop：用 kill ring 里更早的一条替换刚 yank 的内容。按起点和长度精确切除上次插入的文本再插新的——这是 emacs yank-pop 的标准实现。
          const popResult = yankPop()
          if (popResult) {
            const { text, start, length } = popResult
            const before = query.slice(0, start)
            const after = query.slice(start + length)
            const newText = before + text + after
            const newOffset = start + text.length
            updateYankLength(text.length)
            setQueryState(newText)
            setCursorOffset(newOffset)
          }
          return
        }
      }
      return
    }

    // Tab: ignore
    if (e.key === 'tab') {
// Tab 被刻意忽略——搜索框不消费补全，让上层（比如 slash 命令补全）有机会处理。
      return
    }

    // Regular character input. Accepts multi-char e.key so batched writes
    // (stdin.write('abc') in tests, or paste outside bracketed-paste mode)
    // insert the full chunk — matching the old useInput behavior.
    if (e.key.length >= 1 && !UNHANDLED_SPECIAL_KEYS.has(e.key)) {
// 常规字符输入分支。接受多字符 e.key：测试里 stdin.write('abc') 或 bracketed-paste 之外的粘贴整块插入。UNHANDLED_SPECIAL_KEYS 之外的 length>=1 键都当文本。
      e.preventDefault()
      const newCursor = cursor.insert(e.key)
      setQueryState(newCursor.text)
      setCursorOffset(newCursor.offset)
    }
  }

  // Backward-compat bridge: existing consumers don't yet wire handleKeyDown
  // to <Box onKeyDown>. Subscribe via useInput and adapt InputEvent →
  // KeyboardEvent until all 11 call sites are migrated (separate PRs).
  // TODO(onKeyDown-migration): remove once all consumers pass handleKeyDown.
// 【向后兼容桥】现有调用方还没把 handleKeyDown 接到 <Box onKeyDown> 上，这里用 useInput 订阅并做 InputEvent → KeyboardEvent 适配，直到 11 个调用点全部迁移（分开的 PR）。文件头的 eslint-disable 注释同一个理由。这是过渡架构：hook 同时暴露「新式」handleKeyDown 和「旧式」useInput 订阅两条入口。
  useInput(
    (_input, _key, event) => {
      handleKeyDown(new KeyboardEvent(event.keypress))
    },
    { isActive },
  )

  return { query, setQuery, cursorOffset, handleKeyDown }
}
