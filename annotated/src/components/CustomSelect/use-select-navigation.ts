// 本文件是 CustomSelect 的状态机层：用 useReducer 管理焦点与可视窗口（滚动窗口的 from / to 下标），reducer 里集中处理上下移动、翻页、循环、重置与程序化聚焦五种动作。Select 组件的所有键盘行为最终都落到这里的 dispatch。
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { isDeepStrictEqual } from 'util'
import OptionMap from './option-map.js'
import type { OptionWithDescription } from './select.js'

// State：optionMap 是值到链表节点的映射（OptionMap 内部是双向链表，支撑 O(1) 的前后移动），后四个字段描述当前可视窗口。
type State<T> = {
  /**
   * Map where key is option's value and value is option's index.
   */
  optionMap: OptionMap<T>

  /**
   * Number of visible options.
   */
  visibleOptionCount: number

  /**
   * Value of the currently focused option.
   */
  focusedValue: T | undefined

  /**
   * Index of the first visible option.
   */
  visibleFromIndex: number

  /**
   * Index of the last visible option.
   */
  visibleToIndex: number
}

// Action：六种动作的可辨识联合。focus-next/previous-option 是逐项移动，focus-next/previous-page 是整页翻动，set-focus 是外部程序化聚焦，reset 是选项集变化后整体重建状态。
type Action<T> =
  | FocusNextOptionAction
  | FocusPreviousOptionAction
  | FocusNextPageAction
  | FocusPreviousPageAction
  | SetFocusAction<T>
  | ResetAction<T>

type SetFocusAction<T> = {
  type: 'set-focus'
  value: T
}

type FocusNextOptionAction = {
  type: 'focus-next-option'
}

type FocusPreviousOptionAction = {
  type: 'focus-previous-option'
}

type FocusNextPageAction = {
  type: 'focus-next-page'
}

type FocusPreviousPageAction = {
  type: 'focus-previous-page'
}

type ResetAction<T> = {
  type: 'reset'
  state: State<T>
}

// reducer：纯函数，不碰 React 状态之外的东西。三个核心不变量——focusedValue 必须存在于 optionMap；visibleToIndex 不超过总数；可视窗口随焦点最小滚动（只滚到刚好可见，不跳到居中）。
const reducer = <T>(state: State<T>, action: Action<T>): State<T> => {
  switch (action.type) {
    case 'focus-next-option': {
      if (state.focusedValue === undefined) {
        return state
      }

      const item = state.optionMap.get(state.focusedValue)

      if (!item) {
        return state
      }

      // Wrap to first item if at the end
      const next = item.next || state.optionMap.first

      if (!next) {
        return state
      }

      // When wrapping to first, reset viewport to start
      if (!item.next && next === state.optionMap.first) {
        return {
          ...state,
          focusedValue: next.value,
          visibleFromIndex: 0,
          visibleToIndex: state.visibleOptionCount,
        }
      }

      const needsToScroll = next.index >= state.visibleToIndex

      if (!needsToScroll) {
        return {
          ...state,
          focusedValue: next.value,
        }
      }

      const nextVisibleToIndex = Math.min(
        state.optionMap.size,
        state.visibleToIndex + 1,
      )

      const nextVisibleFromIndex = nextVisibleToIndex - state.visibleOptionCount

      return {
        ...state,
        focusedValue: next.value,
        visibleFromIndex: nextVisibleFromIndex,
        visibleToIndex: nextVisibleToIndex,
      }
    }

    case 'focus-previous-option': {
      if (state.focusedValue === undefined) {
        return state
      }

      const item = state.optionMap.get(state.focusedValue)

      if (!item) {
        return state
      }

      // Wrap to last item if at the beginning
      const previous = item.previous || state.optionMap.last

      if (!previous) {
        return state
      }

      // When wrapping to last, reset viewport to end
      if (!item.previous && previous === state.optionMap.last) {
        const nextVisibleToIndex = state.optionMap.size
        const nextVisibleFromIndex = Math.max(
          0,
          nextVisibleToIndex - state.visibleOptionCount,
        )
        return {
          ...state,
          focusedValue: previous.value,
          visibleFromIndex: nextVisibleFromIndex,
          visibleToIndex: nextVisibleToIndex,
        }
      }

      const needsToScroll = previous.index <= state.visibleFromIndex

      if (!needsToScroll) {
        return {
          ...state,
          focusedValue: previous.value,
        }
      }

      const nextVisibleFromIndex = Math.max(0, state.visibleFromIndex - 1)

      const nextVisibleToIndex = nextVisibleFromIndex + state.visibleOptionCount

      return {
        ...state,
        focusedValue: previous.value,
        visibleFromIndex: nextVisibleFromIndex,
        visibleToIndex: nextVisibleToIndex,
      }
    }

// focus-next-page：向下翻一整页（visibleOptionCount 项）。因为 OptionMap 是链表不是数组，定位目标项要从头遍历，这里用 while 循环走到目标下标。
    case 'focus-next-page': {
      if (state.focusedValue === undefined) {
        return state
      }

      const item = state.optionMap.get(state.focusedValue)

      if (!item) {
        return state
      }

      // Move by a full page (visibleOptionCount items)
      const targetIndex = Math.min(
        state.optionMap.size - 1,
        item.index + state.visibleOptionCount,
      )

      // Find the item at the target index
      let targetItem = state.optionMap.first
      while (targetItem && targetItem.index < targetIndex) {
        if (targetItem.next) {
          targetItem = targetItem.next
        } else {
          break
        }
      }

      if (!targetItem) {
        return state
      }

      // Update the visible range to include the new focused item
      const nextVisibleToIndex = Math.min(
        state.optionMap.size,
        targetItem.index + 1,
      )
      const nextVisibleFromIndex = Math.max(
        0,
        nextVisibleToIndex - state.visibleOptionCount,
      )

      return {
        ...state,
        focusedValue: targetItem.value,
        visibleFromIndex: nextVisibleFromIndex,
        visibleToIndex: nextVisibleToIndex,
      }
    }

// focus-previous-page：向上翻一整页，与 next-page 对称，目标下标取 max(0, 当前下标 - 页大小)。
    case 'focus-previous-page': {
      if (state.focusedValue === undefined) {
        return state
      }

      const item = state.optionMap.get(state.focusedValue)

      if (!item) {
        return state
      }

      // Move by a full page (visibleOptionCount items)
      const targetIndex = Math.max(0, item.index - state.visibleOptionCount)

      // Find the item at the target index
      let targetItem = state.optionMap.first
      while (targetItem && targetItem.index < targetIndex) {
        if (targetItem.next) {
          targetItem = targetItem.next
        } else {
          break
        }
      }

      if (!targetItem) {
        return state
      }

      // Update the visible range to include the new focused item
      const nextVisibleFromIndex = Math.max(0, targetItem.index)
      const nextVisibleToIndex = Math.min(
        state.optionMap.size,
        nextVisibleFromIndex + state.visibleOptionCount,
      )

      return {
        ...state,
        focusedValue: targetItem.value,
        visibleFromIndex: nextVisibleFromIndex,
        visibleToIndex: nextVisibleToIndex,
      }
    }

// reset：直接整体替换状态。选项数组变化时由外层构造好新状态后 dispatch 过来。
    case 'reset': {
      return action.state
    }

// set-focus：程序化聚焦。已在视口内就只改焦点；在视口上方则把窗口滚到它位于顶端，在下方则滚到位于底端——即「最小滚动」策略，绝不居中。
    case 'set-focus': {
      // Early return if already focused on this value
      if (state.focusedValue === action.value) {
        return state
      }

      const item = state.optionMap.get(action.value)
      if (!item) {
        return state
      }

      // Check if the item is already in view
      if (
        item.index >= state.visibleFromIndex &&
        item.index < state.visibleToIndex
      ) {
        // Already visible, just update focus
        return {
          ...state,
          focusedValue: action.value,
        }
      }

      // Need to scroll to make the item visible
      // Scroll as little as possible - put item at edge of viewport
      let nextVisibleFromIndex: number
      let nextVisibleToIndex: number

      if (item.index < state.visibleFromIndex) {
        // Item is above viewport - scroll up to put it at the top
        nextVisibleFromIndex = item.index
        nextVisibleToIndex = Math.min(
          state.optionMap.size,
          nextVisibleFromIndex + state.visibleOptionCount,
        )
      } else {
        // Item is below viewport - scroll down to put it at the bottom
        nextVisibleToIndex = Math.min(state.optionMap.size, item.index + 1)
        nextVisibleFromIndex = Math.max(
          0,
          nextVisibleToIndex - state.visibleOptionCount,
        )
      }

      return {
        ...state,
        focusedValue: action.value,
        visibleFromIndex: nextVisibleFromIndex,
        visibleToIndex: nextVisibleToIndex,
      }
    }
  }
}

// UseSelectNavigationProps：钩子入参。initialFocusValue 是挂载时的初焦点，focusValue 是父组件后续程序化改焦点的通道（受控用法）。
export type UseSelectNavigationProps<T> = {
  /**
   * Number of items to display.
   *
   * @default 5
   */
  visibleOptionCount?: number

  /**
   * Options.
   */
  options: OptionWithDescription<T>[]

  /**
   * Initially focused option's value.
   */
  initialFocusValue?: T

  /**
   * Callback for focusing an option.
   */
  onFocus?: (value: T) => void

  /**
   * Value to focus
   */
  focusValue?: T
}

// SelectNavigation：钩子出参。focusedIndex 是 1 起始的全列表下标（供「3/17」这类滚动位置显示用），isInInput 告诉外层当前焦点是否是输入型选项（输入模式下 Enter 归输入框、不触发选中）。
export type SelectNavigation<T> = {
  /**
   * Value of the currently focused option.
   */
  focusedValue: T | undefined

  /**
   * 1-based index of the focused option in the full list.
   * Returns 0 if no option is focused.
   */
  focusedIndex: number

  /**
   * Index of the first visible option.
   */
  visibleFromIndex: number

  /**
   * Index of the last visible option.
   */
  visibleToIndex: number

  /**
   * All options.
   */
  options: OptionWithDescription<T>[]

  /**
   * Visible options.
   */
  visibleOptions: Array<OptionWithDescription<T> & { index: number }>

  /**
   * Whether the focused option is an input type.
   */
  isInInput: boolean

  /**
   * Focus next option and scroll the list down, if needed.
   */
  focusNextOption: () => void

  /**
   * Focus previous option and scroll the list up, if needed.
   */
  focusPreviousOption: () => void

  /**
   * Focus next page and scroll the list down by a page.
   */
  focusNextPage: () => void

  /**
   * Focus previous page and scroll the list up by a page.
   */
  focusPreviousPage: () => void

  /**
   * Focus a specific option by value.
   */
  focusOption: (value: T | undefined) => void
}

// createDefaultState：构造初始状态，核心是「让初焦点可见」。支持传入 currentViewport（选项变化重建时保留旧视口位置），分支顺序：焦点在旧视口内 → 保留视口；在上方 → 滚到顶端；在下方 → 滚到底端；最后统一做边界钳制。
const createDefaultState = <T>({
  visibleOptionCount: customVisibleOptionCount,
  options,
  initialFocusValue,
  currentViewport,
}: Pick<UseSelectNavigationProps<T>, 'visibleOptionCount' | 'options'> & {
  initialFocusValue?: T
  currentViewport?: { visibleFromIndex: number; visibleToIndex: number }
}): State<T> => {
  const visibleOptionCount =
    typeof customVisibleOptionCount === 'number'
      ? Math.min(customVisibleOptionCount, options.length)
      : options.length

  const optionMap = new OptionMap<T>(options)
  const focusedItem =
    initialFocusValue !== undefined && optionMap.get(initialFocusValue)
  const focusedValue = focusedItem ? initialFocusValue : optionMap.first?.value

  let visibleFromIndex = 0
  let visibleToIndex = visibleOptionCount

  // When there's a valid focused item, adjust viewport to show it
  if (focusedItem) {
    const focusedIndex = focusedItem.index

    if (currentViewport) {
      // If focused item is already in the current viewport range, try to preserve it
      if (
        focusedIndex >= currentViewport.visibleFromIndex &&
        focusedIndex < currentViewport.visibleToIndex
      ) {
        // Keep the same viewport if it's valid
        visibleFromIndex = currentViewport.visibleFromIndex
        visibleToIndex = Math.min(
          optionMap.size,
          currentViewport.visibleToIndex,
        )
      } else {
        // Need to adjust viewport to show focused item
        // Use minimal scrolling - put item at edge of viewport
        if (focusedIndex < currentViewport.visibleFromIndex) {
          // Item is above current viewport - scroll up to put it at the top
          visibleFromIndex = focusedIndex
          visibleToIndex = Math.min(
            optionMap.size,
            visibleFromIndex + visibleOptionCount,
          )
        } else {
          // Item is below current viewport - scroll down to put it at the bottom
          visibleToIndex = Math.min(optionMap.size, focusedIndex + 1)
          visibleFromIndex = Math.max(0, visibleToIndex - visibleOptionCount)
        }
      }
    } else if (focusedIndex >= visibleOptionCount) {
      // No current viewport but focused item is outside default viewport
      // Scroll to show the focused item at the bottom of the viewport
      visibleToIndex = Math.min(optionMap.size, focusedIndex + 1)
      visibleFromIndex = Math.max(0, visibleToIndex - visibleOptionCount)
    }

    // Ensure viewport bounds are valid
    visibleFromIndex = Math.max(
      0,
      Math.min(visibleFromIndex, optionMap.size - 1),
    )
    visibleToIndex = Math.min(
      optionMap.size,
      Math.max(visibleOptionCount, visibleToIndex),
    )
  }

  return {
    optionMap,
    visibleOptionCount,
    focusedValue,
    visibleFromIndex,
    visibleToIndex,
  }
}

// useSelectNavigation 主钩子。reducer 初始化用惰性初始化（createDefaultState 作第三参），只在挂载时执行一次。
export function useSelectNavigation<T>({
  visibleOptionCount = 5,
  options,
  initialFocusValue,
  onFocus,
  focusValue,
}: UseSelectNavigationProps<T>): SelectNavigation<T> {
  const [state, dispatch] = useReducer(
    reducer<T>,
    {
      visibleOptionCount,
      options,
      initialFocusValue: focusValue || initialFocusValue,
    } as Parameters<typeof createDefaultState<T>>[0],
    createDefaultState<T>,
  )
// 初始焦点取值优先级：focusValue（受控）优先于 initialFocusValue。

  // Store onFocus in a ref to avoid re-running useEffect when callback changes
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
// onFocus 存进 ref：回调引用每渲染都变（父组件多写成内联箭头函数），放 ref 里让下面的 useEffect 只依赖焦点值本身，不随回调引用变化重跑。

  const [lastOptions, setLastOptions] = useState(options)

  if (options !== lastOptions && !isDeepStrictEqual(options, lastOptions)) {
    dispatch({
      type: 'reset',
      state: createDefaultState({
        visibleOptionCount,
        options,
        initialFocusValue:
          focusValue ?? state.focusedValue ?? initialFocusValue,
        currentViewport: {
          visibleFromIndex: state.visibleFromIndex,
          visibleToIndex: state.visibleToIndex,
        },
      }),
    })

    setLastOptions(options)
  }
// 选项集变化检测：引用不同且深比较也不同才 reset。reset 时带上旧视口（currentViewport）与新焦点优先级（focusValue > 现焦点 > initialFocusValue），让「列表内容刷新但光标尽量留在原地」。注意这是渲染期 dispatch（条件满足时同步执行），React 允许同组件渲染期 setState，效果是本次渲染即用新状态。

  const focusNextOption = useCallback(() => {
    dispatch({
      type: 'focus-next-option',
    })
  }, [])

  const focusPreviousOption = useCallback(() => {
    dispatch({
      type: 'focus-previous-option',
    })
  }, [])

  const focusNextPage = useCallback(() => {
    dispatch({
      type: 'focus-next-page',
    })
  }, [])

  const focusPreviousPage = useCallback(() => {
    dispatch({
      type: 'focus-previous-page',
    })
  }, [])

  const focusOption = useCallback((value: T | undefined) => {
    if (value !== undefined) {
      dispatch({
        type: 'set-focus',
        value,
      })
    }
  }, [])

  const visibleOptions = useMemo(() => {
    return options
      .map((option, index) => ({
        ...option,
        index,
      }))
      .slice(state.visibleFromIndex, state.visibleToIndex)
  }, [options, state.visibleFromIndex, state.visibleToIndex])
// visibleOptions：全列表切出当前窗口并附上全局下标。渲染层只看这个切片，窗口外的选项根本不进 DOM（终端 Ink 里即不渲染行）。

  // Validate that focusedValue exists in current options.
  // This handles the case where options change during render but the reset
  // action hasn't been processed yet - without this, the cursor would disappear
  // because focusedValue points to an option that no longer exists.
// validatedFocusedValue：校验焦点值在当前选项里真实存在。注释讲得很清楚：选项在渲染期变了但 reset 尚未被处理时，内部 state.focusedValue 可能指向已不存在的选项，不校验光标会凭空消失。失效时回退到第一项。
  const validatedFocusedValue = useMemo(() => {
    if (state.focusedValue === undefined) {
      return undefined
    }
    const exists = options.some(opt => opt.value === state.focusedValue)
    if (exists) {
      return state.focusedValue
    }
    // Fall back to first option if focused value doesn't exist
    return options[0]?.value
  }, [state.focusedValue, options])

  const isInInput = useMemo(() => {
    const focusedOption = options.find(
      opt => opt.value === validatedFocusedValue,
    )
    return focusedOption?.type === 'input'
  }, [validatedFocusedValue, options])
// isInInput：焦点选项是否输入型。外层据此决定 Enter 的归属。

  // Call onFocus with the validated value (what's actually displayed),
  // not the internal state value which may be stale if options changed.
  // Use ref to avoid re-running when callback reference changes.
  useEffect(() => {
    if (validatedFocusedValue !== undefined) {
      onFocusRef.current?.(validatedFocusedValue)
    }
  }, [validatedFocusedValue])
// 通知 onFocus 用的是校验后的值（实际显示的焦点），不是内部 state 值——后者在选项刚变化的一帧里可能是悬空引用。

  // Allow parent to programmatically set focus via focusValue prop
  useEffect(() => {
    if (focusValue !== undefined) {
      dispatch({
        type: 'set-focus',
        value: focusValue,
      })
    }
  }, [focusValue])
// 受控聚焦通道：父组件改 focusValue 就 dispatch set-focus。Select 的 props 注释警告过：别把它与 onFocus 组成双向同步环。

  // Compute 1-based focused index for scroll position display
// focusedIndex：1 起始下标，给滚动位置指示（如 3/17）用。找不到返回 0。
  const focusedIndex = useMemo(() => {
    if (validatedFocusedValue === undefined) {
      return 0
    }
    const index = options.findIndex(opt => opt.value === validatedFocusedValue)
    return index >= 0 ? index + 1 : 0
  }, [validatedFocusedValue, options])

  return {
    focusedValue: validatedFocusedValue,
    focusedIndex,
    visibleFromIndex: state.visibleFromIndex,
    visibleToIndex: state.visibleToIndex,
    visibleOptions,
    isInInput: isInInput ?? false,
    focusNextOption,
    focusPreviousOption,
    focusNextPage,
    focusPreviousPage,
    focusOption,
    options,
  }
}
