import { feature } from 'bun:bundle'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getModeFromInput,
  getValueFromInput,
} from '../components/PromptInput/inputModes.js'
import { makeHistoryReader } from '../history.js'
import { KeyboardEvent } from '../ink/events/keyboard-event.js'
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- backward-compat bridge until consumers wire handleKeyDown to <Box onKeyDown>
import { useInput } from '../ink.js'
import { useKeybinding, useKeybindings } from '../keybindings/useKeybinding.js'
import type { PromptInputMode } from '../types/textInputTypes.js'
import type { HistoryEntry } from '../utils/config.js'

export function useHistorySearch(
  onAcceptHistory: (entry: HistoryEntry) => void,
  currentInput: string,
  onInputChange: (input: string) => void,
  onCursorChange: (cursorOffset: number) => void,
  currentCursorOffset: number,
  onModeChange: (mode: PromptInputMode) => void,
  currentMode: PromptInputMode,
  isSearching: boolean,
  setIsSearching: (isSearching: boolean) => void,
  setPastedContents: (pastedContents: HistoryEntry['pastedContents']) => void,
  currentPastedContents: HistoryEntry['pastedContents'],
): {
  historyQuery: string
  setHistoryQuery: (query: string) => void
  historyMatch: HistoryEntry | undefined
  historyFailedMatch: boolean
  handleKeyDown: (e: KeyboardEvent) => void
} {
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyFailedMatch, setHistoryFailedMatch] = useState(false)
  const [originalInput, setOriginalInput] = useState('')
  const [originalCursorOffset, setOriginalCursorOffset] = useState(0)
  const [originalMode, setOriginalMode] = useState<PromptInputMode>('prompt')
  const [originalPastedContents, setOriginalPastedContents] = useState<
    HistoryEntry['pastedContents']
  >({})
  const [historyMatch, setHistoryMatch] = useState<HistoryEntry | undefined>(
    undefined,
  )
// 文件级：Ctrl-R 历史搜索（shell 式增量反查）。五个 original* state 是进入搜索时的现场快照——取消时必须完整还原（输入、光标、模式、粘贴内容四件套）。historyReader 是 AsyncGenerator（反向逐行读历史文件），seenPrompts 去重，searchAbortController 取消在途搜索。
  const historyReader = useRef<AsyncGenerator<HistoryEntry> | undefined>(
    undefined,
  )
  const seenPrompts = useRef<Set<string>>(new Set())
  const searchAbortController = useRef<AbortController | null>(null)

  const closeHistoryReader = useCallback((): void => {
    if (historyReader.current) {
      // Must explicitly call .return() to trigger the finally block in readLinesReverse,
      // which closes the file handle. Without this, file descriptors leak.
      void historyReader.current.return(undefined)
      historyReader.current = undefined
    }
  }, [])
// closeHistoryReader 必须显式调 .return()——注释点明：不调就触发不了 readLinesReverse 的 finally 块，文件句柄泄漏。生成器的卫生销毁不能靠 GC。

  const reset = useCallback((): void => {
    setIsSearching(false)
    setHistoryQuery('')
    setHistoryFailedMatch(false)
    setOriginalInput('')
    setOriginalCursorOffset(0)
    setOriginalMode('prompt')
    setOriginalPastedContents({})
    setHistoryMatch(undefined)
    closeHistoryReader()
    seenPrompts.current.clear()
  }, [setIsSearching, closeHistoryReader])

  const searchHistory = useCallback(
    async (resume: boolean, signal?: AbortSignal): Promise<void> => {
      if (!isSearching) {
        return
      }

      if (historyQuery.length === 0) {
        closeHistoryReader()
        seenPrompts.current.clear()
        setHistoryMatch(undefined)
        setHistoryFailedMatch(false)
        onInputChange(originalInput)
        onCursorChange(originalCursorOffset)
        onModeChange(originalMode)
        setPastedContents(originalPastedContents)
        return
      }

      if (!resume) {
        closeHistoryReader()
        historyReader.current = makeHistoryReader()
        seenPrompts.current.clear()
      }

      if (!historyReader.current) {
        return
      }

      while (true) {
        if (signal?.aborted) {
          return
        }

        const item = await historyReader.current.next()
        if (item.done) {
          // No match found - keep last match but mark as failed
          setHistoryFailedMatch(true)
          return
        }

        const display = item.value.display

        const matchPosition = display.lastIndexOf(historyQuery)
        if (matchPosition !== -1 && !seenPrompts.current.has(display)) {
          seenPrompts.current.add(display)
          setHistoryMatch(item.value)
          setHistoryFailedMatch(false)
          const mode = getModeFromInput(display)
          onModeChange(mode)
          onInputChange(display)
          setPastedContents(item.value.pastedContents)

          // Position cursor relative to the clean value, not the display
          const value = getValueFromInput(display)
          const cleanMatchPosition = value.lastIndexOf(historyQuery)
          onCursorChange(
            cleanMatchPosition !== -1 ? cleanMatchPosition : matchPosition,
          )
          return
        }
      }
// searchHistory 主循环：空查询 = 还原现场退出；resume 复用已有 reader（接着往下找）；while(true) 逐条读，lastIndexOf 子串匹配 + seenPrompts 去重（同一条历史不重复命中）；命中时同步还原 mode/input/pastedContents 三态，光标按 clean value 定位——display 带模式前缀（! 等），getValueFromInput 剥掉后匹配位置才对。读尽还没中 = historyFailedMatch（保留上一个匹配只标失败）。
    },
    [
      isSearching,
      historyQuery,
      closeHistoryReader,
      onInputChange,
      onCursorChange,
      onModeChange,
      setPastedContents,
      originalInput,
      originalCursorOffset,
      originalMode,
      originalPastedContents,
    ],
  )

  // Handler: Start history search (when not searching)
  const handleStartSearch = useCallback(() => {
    setIsSearching(true)
    setOriginalInput(currentInput)
    setOriginalCursorOffset(currentCursorOffset)
    setOriginalMode(currentMode)
    setOriginalPastedContents(currentPastedContents)
    historyReader.current = makeHistoryReader()
    seenPrompts.current.clear()
  }, [
    setIsSearching,
    currentInput,
    currentCursorOffset,
    currentMode,
    currentPastedContents,
  ])
// handleStartSearch：进入搜索前快照四件套现场，开新 reader。

  // Handler: Find next match (when searching)
  const handleNextMatch = useCallback(() => {
    void searchHistory(true)
  }, [searchHistory])

  // Handler: Accept current match and exit search
  const handleAccept = useCallback(() => {
    if (historyMatch) {
      const mode = getModeFromInput(historyMatch.display)
      const value = getValueFromInput(historyMatch.display)
      onInputChange(value)
      onModeChange(mode)
      setPastedContents(historyMatch.pastedContents)
    } else {
      // No match - restore original pasted contents
      setPastedContents(originalPastedContents)
    }
    reset()
  }, [
    historyMatch,
    onInputChange,
    onModeChange,
    setPastedContents,
    originalPastedContents,
    reset,
  ])
// handleAccept：接受当前匹配退出（用 value 不用 display——前缀剥掉再提交）；无匹配时至少还原粘贴内容。

  // Handler: Cancel search and restore original input
  const handleCancel = useCallback(() => {
    onInputChange(originalInput)
    onCursorChange(originalCursorOffset)
    setPastedContents(originalPastedContents)
    reset()
  }, [
    onInputChange,
    onCursorChange,
    setPastedContents,
    originalInput,
    originalCursorOffset,
    originalPastedContents,
    reset,
  ])
// handleCancel：完整还原现场（输入/光标/粘贴内容）后 reset——Ctrl-R 搜索的「不留痕迹」退出。

  // Handler: Execute (accept and submit)
  const handleExecute = useCallback(() => {
    if (historyQuery.length === 0) {
      onAcceptHistory({
        display: originalInput,
        pastedContents: originalPastedContents,
      })
    } else if (historyMatch) {
      const mode = getModeFromInput(historyMatch.display)
      const value = getValueFromInput(historyMatch.display)
      onModeChange(mode)
      onAcceptHistory({
        display: value,
        pastedContents: historyMatch.pastedContents,
      })
    }
    reset()
  }, [
    historyQuery,
    historyMatch,
    onAcceptHistory,
    onModeChange,
    originalInput,
    originalPastedContents,
    reset,
  ])
// handleExecute：接受并直接提交。空查询提交原输入（用户什么都没搜就回车）；有匹配提交剥前缀的 value。

  // Gated off under HISTORY_PICKER — the modal dialog owns ctrl+r there.
  useKeybinding('history:search', handleStartSearch, {
    context: 'Global',
    isActive: feature('HISTORY_PICKER') ? false : !isSearching,
  })
// history:search 键位被 HISTORY_PICKER feature 门控——新版 modal 历史选择器拥有 Ctrl-R 时，这里的增量搜索让位（isActive: false 而不是不注册，键位表保持完整）。

  // History search context keybindings (only active when searching)
  const historySearchHandlers = useMemo(
    () => ({
      'historySearch:next': handleNextMatch,
      'historySearch:accept': handleAccept,
      'historySearch:cancel': handleCancel,
      'historySearch:execute': handleExecute,
    }),
    [handleNextMatch, handleAccept, handleCancel, handleExecute],
  )

  useKeybindings(historySearchHandlers, {
    context: 'HistorySearch',
    isActive: isSearching,
  })

  // Handle backspace when query is empty (cancels search)
  // This is a conditional behavior that doesn't fit the keybinding model
  // well (backspace only cancels when query is empty)
  const handleKeyDown = (e: KeyboardEvent): void => {
    if (!isSearching) return
    if (e.key === 'backspace' && historyQuery === '') {
      e.preventDefault()
      handleCancel()
    }
  }
// handleKeyDown 的遗留路径：空查询时 backspace 取消搜索。注释说明为什么进不了键位模型——「backspace 只在查询为空时取消」是条件行为，键位表描述不了这种状态依赖。

  // Backward-compat bridge: PromptInput doesn't yet wire handleKeyDown to
  // <Box onKeyDown>. Subscribe via useInput and adapt InputEvent →
  // KeyboardEvent until the consumer is migrated (separate PR).
  // TODO(onKeyDown-migration): remove once PromptInput passes handleKeyDown.
  useInput(
    (_input, _key, event) => {
      handleKeyDown(new KeyboardEvent(event.keypress))
    },
    { isActive: isSearching },
  )

  // Keep a ref to searchHistory to avoid it being a dependency of useEffect
  const searchHistoryRef = useRef(searchHistory)
  searchHistoryRef.current = searchHistory

  // Reset history search when query changes
  useEffect(() => {
    searchAbortController.current?.abort()
    const controller = new AbortController()
    searchAbortController.current = controller
    void searchHistoryRef.current(false, controller.signal)
    return () => {
      controller.abort()
    }
  }, [historyQuery])
// query 变化 effect：abort 在途搜索 + 新 controller；searchHistoryRef 避免把 searchHistory 本身列为依赖（它每次渲染都是新引用，会无限重入）。清理函数再 abort 一次——卸载时取消。

  return {
    historyQuery,
    setHistoryQuery,
    historyMatch,
    historyFailedMatch,
    handleKeyDown,
  }
}
