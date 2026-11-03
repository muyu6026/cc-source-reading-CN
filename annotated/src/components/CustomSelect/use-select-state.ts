import { useCallback, useState } from 'react'
// use-select-state 是 CustomSelect 的状态钩子：把当前焦点/选中值、可见窗口、滚动与选聚焦动作封装成一个 SelectState，供选择器组件消费。
import type { OptionWithDescription } from './select.js'
import { useSelectNavigation } from './use-select-navigation.js'

export type UseSelectStateProps<T> = {
  /**
   * Number of items to display.
   *
   * @default 5
   */
  visibleOptionCount?: number
// visibleOptionCount 默认 5，控制一次渲染几条选项。

  /**
   * Options.
   */
  options: OptionWithDescription<T>[]

// options 是带描述的候选列表。
  /**
   * Initially selected option's value.
   */
  defaultValue?: T
// defaultValue 指定初始选中项的值。

  /**
   * Callback for selecting an option.
   */
  onChange?: (value: T) => void

  /**
   * Callback for canceling the select.
   */
  onCancel?: () => void

  /**
   * Callback for focusing an option.
   */
  onFocus?: (value: T) => void

  /**
   * Value to focus
   */
  focusValue?: T
// onChange / onCancel / onFocus 是选中、取消、聚焦回调；focusValue 指定初始聚焦项。
}
// UseSelectStateProps 汇总所有入参为泛型 Props。

export type SelectState<T> = {
  /**
   * Value of the currently focused option.
   */
  focusedValue: T | undefined
// focusedValue 是当前高亮项的值。

  /**
   * 1-based index of the focused option in the full list.
   * Returns 0 if no option is focused.
   */
  focusedIndex: number
// focusedIndex 是焦点项在完整列表中的 1-based 下标（无焦点为 0）。

  /**
   * Index of the first visible option.
   */
  visibleFromIndex: number
// visibleFromIndex / visibleToIndex 圈出当前可见窗口首尾下标。

  /**
   * Index of the last visible option.
   */
  visibleToIndex: number

  /**
   * Value of the selected option.
   */
  value: T | undefined
// value 是已选中项；options 是所有选项；visibleOptions 是带 index 的可见切片。

  /**
   * All options.
   */
  options: OptionWithDescription<T>[]

  /**
   * Visible options.
   */
  visibleOptions: Array<OptionWithDescription<T> & { index: number }>
// visibleOptions 记录可见窗口内的选项及其下标。

  /**
   * Whether the focused option is an input type.
   */
  isInInput: boolean
// isInInput 表示当前焦点项是否为输入型选项。

  /**
   * Focus next option and scroll the list down, if needed.
   */
  focusNextOption: () => void
// focusNextOption / focusPreviousOption 聚焦上下一项并按需滚动。

  /**
   * Focus previous option and scroll the list up, if needed.
   */
  focusPreviousOption: () => void

  /**
   * Focus next page and scroll the list down by a page.
   */
  focusNextPage: () => void
// focusNextPage / focusPreviousPage 按页上下翻。

  /**
   * Focus previous page and scroll the list up by a page.
   */
  focusPreviousPage: () => void

  /**
   * Focus a specific option by value.
   */
  focusOption: (value: T | undefined) => void
// focusOption 按值跳转焦点。

  /**
   * Select currently focused option.
   */
  selectFocusedOption: () => void
// selectFocusedOption 把当前焦点项提交为选中值。

  /**
   * Callback for selecting an option.
   */
  onChange?: (value: T) => void

  /**
   * Callback for canceling the select.
   */
  onCancel?: () => void
// onChange / onCancel 在 SelectState 里也作为回调字段透传。
}
// SelectState 把所有字段与动作汇总成返回值类型。

export function useSelectState<T>({
  visibleOptionCount = 5,
  options,
  defaultValue,
  onChange,
  onCancel,
  onFocus,
  focusValue,
}: UseSelectStateProps<T>): SelectState<T> {
// useSelectState 用 useState 存 value，焦点与滚动交给 useSelectNavigation，selectFocusedOption 把焦点值写入 value，最后把导航状态、value 与回调一起返回。
  const [value, setValue] = useState<T | undefined>(defaultValue)

  const navigation = useSelectNavigation<T>({
    visibleOptionCount,
    options,
    initialFocusValue: undefined,
    onFocus,
    focusValue,
  })

  const selectFocusedOption = useCallback(() => {
    setValue(navigation.focusedValue)
  }, [navigation.focusedValue])

  return {
    ...navigation,
    value,
    selectFocusedOption,
    onChange,
    onCancel,
  }
}
// 函数返回拼装好的 SelectState。
