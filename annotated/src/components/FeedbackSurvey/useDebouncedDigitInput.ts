import { useEffect, useRef } from 'react'
import { normalizeFullWidthDigits } from '../../utils/stringUtils.js'

// Delay before accepting a digit as a response, to prevent accidental
// submissions when users start messages with numbers (e.g., numbered lists).
// Short enough to feel instant for intentional presses, long enough to
// cancel when the user types more characters.
// 默认防抖 400 毫秒：注释把权衡写清——短到按下去感觉即时，长到用户继续打字时能取消
const DEFAULT_DEBOUNCE_MS = 400

/**
 * Detects when the user types a single valid digit into the prompt input,
 * debounces to avoid accidental submissions (e.g., "1. First item"),
 * trims the digit from the input, and fires a callback.
 *
 * Used by survey components that accept numeric responses typed directly
 * into the main prompt input.
 */
// hook：监听主输入框里打出的单个数字键，防抖后从输入里剔掉这个字符并回调——为的是避免编号列表被误当成选项
export function useDebouncedDigitInput<T extends string = string>({
  inputValue,
  setInputValue,
  isValidDigit,
  onDigit,
  enabled = true,
  once = false,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: {
  inputValue: string
  setInputValue: (value: string) => void
  isValidDigit: (char: string) => char is T
  onDigit: (digit: T) => void
  enabled?: boolean
  once?: boolean
  debounceMs?: number
}): void {
  const initialInputValue = useRef(inputValue)
// initialInputValue 用 ref 记住首帧值：只有真正新增字符才算「用户刚输入」，首帧就带着数字不算
  const hasTriggeredRef = useRef(false)
// hasTriggeredRef：once 模式只允许触发一次，问卷里防重复提交
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Latest-ref pattern so callers can pass inline callbacks without causing
  // the effect to re-run (which would reset the debounce timer every render).
  const callbacksRef = useRef({ setInputValue, isValidDigit, onDigit })
// latest-ref 模式：回调存进 ref，调用方传内联箭头也不会让 effect 重跑、不会重置防抖计时器
  callbacksRef.current = { setInputValue, isValidDigit, onDigit }

  useEffect(() => {
    if (!enabled || (once && hasTriggeredRef.current)) {
      return
// 未启用或 once 已触发直接返回：不装计时器
    }

    if (debounceRef.current !== null) {
// 进入 effect 先清掉旧计时器：每次输入变化都重新计时
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    if (inputValue !== initialInputValue.current) {
      const lastChar = normalizeFullWidthDigits(inputValue.slice(-1))
// normalizeFullWidthDigits：全角数字先转半角再校验，中文输入法下打出的 １ 也要认
      if (callbacksRef.current.isValidDigit(lastChar)) {
        const trimmed = inputValue.slice(0, -1)
// trimmed 去掉末尾那个数字，稍后写回输入框
        debounceRef.current = setTimeout(
          (debounceRef, hasTriggeredRef, callbacksRef, trimmed, lastChar) => {
// setTimeout 用可变参数形式把 ref 与值一并传入：回调里拿到的都是触发时刻的快照，不依赖闭包
            debounceRef.current = null
            hasTriggeredRef.current = true
            callbacksRef.current.setInputValue(trimmed)
// 到点才真正改输入并回调：防抖窗口内用户继续打字，计时器会被上面的清理逻辑取消
            callbacksRef.current.onDigit(lastChar)
          },
          debounceMs,
          debounceRef,
          hasTriggeredRef,
          callbacksRef,
          trimmed,
          lastChar,
        )
      }
    }

    return () => {
// 清理函数同样清计时器：卸载或输入变化都不留悬挂回调
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [inputValue, enabled, once, debounceMs])
}
