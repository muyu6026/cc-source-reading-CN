// useSelectInput：CustomSelect 的键盘与输入核心 hook。它把方向键、数字键、Tab、空格、PageUp/Down 映射成选项导航与选择，并处理「输入框模式」与图片选择模式。
import { useMemo } from 'react'
import { useRegisterOverlay } from '../../context/overlayContext.js'
import type { InputEvent } from '../../ink/events/input-event.js'
import { useInput } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import {
  normalizeFullWidthDigits,
  normalizeFullWidthSpace,
} from '../../utils/stringUtils.js'
import type { OptionWithDescription } from './select.js'
import type { SelectState } from './use-select-state.js'

// UseSelectProps：hook 的全部入参。isDisabled 时忽略一切输入；disableSelection 可禁止选择（仍允许滚动）；state 是受控的 SelectState；其余是各类边界回调与输入态标记。
export type UseSelectProps<T> = {
  /**
   * When disabled, user input is ignored.
   *
   * @default false
   */
  isDisabled?: boolean

  /**
   * When true, prevents selection on Enter or number keys, but allows
   * scrolling.
   * When 'numeric', prevents selection on number keys, but allows Enter (and
   * scrolling).
   *
   * @default false
   */
  readonly disableSelection?: boolean | 'numeric'

  /**
   * Select state.
   */
  state: SelectState<T>

  /**
   * Options.
   */
  options: OptionWithDescription<T>[]

  /**
   * Whether this is a multi-select component.
   *
   * @default false
   */
  isMultiSelect?: boolean

  /**
   * Callback when user presses up from the first item.
   * If provided, navigation will not wrap to the last item.
   */
  onUpFromFirstItem?: () => void

  /**
   * Callback when user presses down from the last item.
   * If provided, navigation will not wrap to the first item.
   */
  onDownFromLastItem?: () => void

  /**
   * Callback when input mode should be toggled for an option.
   * Called when Tab is pressed (to enter or exit input mode).
   */
  onInputModeToggle?: (value: T) => void

  /**
   * Current input values for input-type options.
   * Used to determine if number key should submit an empty input option.
   */
  inputValues?: Map<T, string>

  /**
   * Whether image selection mode is active on the focused input option.
   * When true, arrow key navigation in useInput is suppressed so that
   * Attachments keybindings can handle image navigation instead.
   */
  imagesSelected?: boolean

  /**
   * Callback to attempt entering image selection mode on DOWN arrow.
   * Returns true if image selection was entered (images exist), false otherwise.
   */
  onEnterImageSelection?: () => boolean
}

// hook 主体：解构入参，先注册为 overlay（避免更上层的 CancelRequestHandler 抢走 Esc），再判断是否落在某个「输入型」选项上。
export const useSelectInput = <T>({
  isDisabled = false,
  disableSelection = false,
  state,
  options,
  isMultiSelect = false,
  onUpFromFirstItem,
  onDownFromLastItem,
  onInputModeToggle,
  inputValues,
  imagesSelected = false,
  onEnterImageSelection,
}: UseSelectProps<T>) => {
// 自动注册为 overlay：只要提供了 onCancel，就让本选择器占住 Esc，阻止更上层的取消处理器中途拦截。
  // Automatically register as an overlay when onCancel is provided.
  // This ensures CancelRequestHandler won't intercept Escape when the select is active.
  useRegisterOverlay('select', !!state.onCancel)

  // Determine if the focused option is an input type
// 判断当前聚焦项是否是「输入型」选项（type === input），输入型选项里按键要穿透给文本框。
  const isInInput = useMemo(() => {
    const focusedOption = options.find(opt => opt.value === state.focusedValue)
    return focusedOption?.type === 'input'
  }, [options, state.focusedValue])

  // Core navigation via keybindings (up/down/enter/escape)
  // When in input mode, exclude navigation/accept keybindings so that
  // j/k/enter pass through to the TextInput instead of being intercepted.
// 核心导航键绑定：方向键上下、Enter 接受、Esc 取消。当聚焦在输入框时不注册这些键，让 j/k/Enter 穿透到 TextInput。
  const keybindingHandlers = useMemo(() => {
    const handlers: Record<string, () => void> = {}

    if (!isInInput) {
// 向下：若在最后一项再按且提供了 onDownFromLastItem，则把焦点交还上层（如回到页签栏），否则正常下移。
      handlers['select:next'] = () => {
        if (onDownFromLastItem) {
          const lastOption = options[options.length - 1]
          if (lastOption && state.focusedValue === lastOption.value) {
            onDownFromLastItem()
            return
          }
        }
        state.focusNextOption()
      }
      handlers['select:previous'] = () => {
        if (onUpFromFirstItem && state.visibleFromIndex === 0) {
          const firstOption = options[0]
          if (firstOption && state.focusedValue === firstOption.value) {
            onUpFromFirstItem()
            return
          }
        }
        state.focusPreviousOption()
      }
// 接受（Enter 或数字键）：禁用选择时直接返回；聚焦项未定义或禁用时返回；否则提交选中值并回调 onChange。
      handlers['select:accept'] = () => {
        if (disableSelection === true) return
        if (state.focusedValue === undefined) return

        const focusedOption = options.find(
          opt => opt.value === state.focusedValue,
        )
        if (focusedOption?.disabled === true) return

        state.selectFocusedOption?.()
        state.onChange?.(state.focusedValue)
      }
    }

// 有 onCancel 时注册 Esc 为取消键，映射到 state.onCancel。
    if (state.onCancel) {
      handlers['select:cancel'] = () => {
        state.onCancel!()
      }
    }

    return handlers
  }, [
    options,
    state,
    onDownFromLastItem,
    onUpFromFirstItem,
    isInInput,
    disableSelection,
  ])

  useKeybindings(keybindingHandlers, {
    context: 'Select',
    isActive: !isDisabled,
  })

  // Remaining keys that stay as useInput: number keys, pageUp/pageDown, tab, space,
  // and arrow key navigation when in input mode
// 其余按键走 useInput：数字键、翻页、Tab、空格，以及输入型选项里的方向键穿透。
  useInput(
    (input, key, event: InputEvent) => {
      const normalizedInput = normalizeFullWidthDigits(input)
      const focusedOption = options.find(
        opt => opt.value === state.focusedValue,
      )
      const currentIsInInput = focusedOption?.type === 'input'

      // Handle Tab key for input mode toggling
// Tab 切换输入模式：聚焦输入型选项时按 Tab 进入或退出文本输入，由 onInputModeToggle 处理。
      if (key.tab && onInputModeToggle && state.focusedValue !== undefined) {
        onInputModeToggle(state.focusedValue)
        return
      }

// 聚焦在输入型选项时的处理分支：图片选择模式下吞掉所有按键；向下箭头可进入图片选择；方向键仍可在选项间移动。
      if (currentIsInInput) {
        // When in image selection mode, suppress all input handling so
        // Attachments keybindings can handle navigation/deletion instead
        if (imagesSelected) return

        // DOWN arrow enters image selection mode if images exist
        if (key.downArrow && onEnterImageSelection?.()) {
          event.stopImmediatePropagation()
          return
        }

        // Arrow keys still navigate the select even while in input mode
        if (key.downArrow || (key.ctrl && input === 'n')) {
          if (onDownFromLastItem) {
            const lastOption = options[options.length - 1]
            if (lastOption && state.focusedValue === lastOption.value) {
              onDownFromLastItem()
              event.stopImmediatePropagation()
              return
            }
          }
          state.focusNextOption()
          event.stopImmediatePropagation()
          return
        }
        if (key.upArrow || (key.ctrl && input === 'p')) {
          if (onUpFromFirstItem && state.visibleFromIndex === 0) {
            const firstOption = options[0]
            if (firstOption && state.focusedValue === firstOption.value) {
              onUpFromFirstItem()
              event.stopImmediatePropagation()
              return
            }
          }
          state.focusPreviousOption()
          event.stopImmediatePropagation()
          return
        }

        // All other keys (including digits) pass through to TextInput.
        // Digits should type literally into the input rather than select
        // options — the user has focused a text field and expects typing
        // to insert characters, not jump to a different option.
        return
      }

// 翻页：PageDown / PageUp 调用 state 的整页聚焦移动。
      if (key.pageDown) {
        state.focusNextPage()
      }

      if (key.pageUp) {
        state.focusPreviousPage()
      }

// 数字键选择：非 numeric 禁用时，正则匹配纯数字后按 1-based 索引选中对应选项；输入型选项若已预填内容则直接提交，空提交且允许时聚焦而非选择。
      if (disableSelection !== true) {
        // Space for multi-select toggle
// 空格多选切换：多选模式下、聚焦项非禁用时，空格切换该选项的选中态并回调 onChange。
        if (
          isMultiSelect &&
          normalizeFullWidthSpace(input) === ' ' &&
          state.focusedValue !== undefined
        ) {
          const isFocusedOptionDisabled = focusedOption?.disabled === true
          if (!isFocusedOptionDisabled) {
            state.selectFocusedOption?.()
            state.onChange?.(state.focusedValue)
          }
        }

        if (
          disableSelection !== 'numeric' &&
          /^[0-9]+$/.test(normalizedInput)
        ) {
          const index = parseInt(normalizedInput) - 1
          if (index >= 0 && index < state.options.length) {
            const selectedOption = state.options[index]!
            if (selectedOption.disabled === true) {
              return
            }
            if (selectedOption.type === 'input') {
              const currentValue = inputValues?.get(selectedOption.value) ?? ''
              if (currentValue.trim()) {
                // Pre-filled input: auto-submit (user can Tab to edit instead)
                state.onChange?.(selectedOption.value)
                return
              }
              if (selectedOption.allowEmptySubmitToCancel) {
                state.onChange?.(selectedOption.value)
                return
              }
              state.focusOption(selectedOption.value)
              return
            }
            state.onChange?.(selectedOption.value)
            return
          }
        }
      }
    },
    { isActive: !isDisabled },
  )
}
