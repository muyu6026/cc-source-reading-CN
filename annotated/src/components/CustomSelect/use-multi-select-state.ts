// 多选列表的键盘状态机。这个 hook 是本仓库里「输入契约」最密集的一处：它同时要处理两种模式（有无提交按钮）、三种选项类型（普通 / 输入型 / 提交按钮）、以及全角输入法的归一化。整份文件几乎全是分支，读的时候先抓住「Enter 的语义由 submitButtonText 是否存在决定」这一条主线。
import { useCallback, useState } from 'react'
import { isDeepStrictEqual } from 'util'
// useRegisterOverlay 用于抢占 Escape。终端应用里 Escape 是全局「取消」键，弹窗不做登记就会被上层先吃掉，导致「按一次关两层」。
import { useRegisterOverlay } from '../../context/overlayContext.js'
import type { InputEvent } from '../../ink/events/input-event.js'
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw space/arrow multiselect input
import { useInput } from '../../ink.js'
import {
  normalizeFullWidthDigits,
  normalizeFullWidthSpace,
} from '../../utils/stringUtils.js'
// 全部输入处理都用 useInput 手写，而不是走 useKeybindings，原因就写在上面那行 eslint 禁用注释里：空格开关注与方向键的组合无法用键位绑定声明式表达。这也是这个文件唯一破例的地方。
import type { OptionWithDescription } from './select.js'
import { useSelectNavigation } from './use-select-navigation.js'

// 对外 props 类型，几乎每个字段都带 JSDoc。这类 hook 的契约就写在类型注释里，读接口比读实现更快。
export type UseMultiSelectStateProps<T> = {
  /**
   * When disabled, user input is ignored.
   *
   * @default false
   */
  isDisabled?: boolean

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
   * Initially selected values.
   */
  defaultValue?: T[]

  /**
   * Callback when selection changes.
   */
  onChange?: (values: T[]) => void

  /**
   * Callback for canceling the select.
   */
  onCancel: () => void

  /**
   * Callback for focusing an option.
   */
  onFocus?: (value: T) => void

  /**
   * Value to focus
   */
  focusValue?: T

  /**
   * Text for the submit button. When provided, a submit button is shown and
   * Enter toggles selection (submit only fires when the button is focused).
   * When omitted, Enter submits directly and Space toggles selection.
   */
// submitButtonText 是整份文件的总开关，三态语义必须分清：给了就渲染提交按钮、Enter 只负责移动焦点；不给则 Enter 直接提交、空格负责切换。后面每一个按键分支都在为这两条路径分叉。
  submitButtonText?: string

  /**
   * Callback when user submits. Receives the currently selected values.
   */
  onSubmit?: (values: T[]) => void

  /**
   * Callback when user presses down from the last item (submit button).
   * If provided, navigation will not wrap to the first item.
   */
  onDownFromLastItem?: () => void

  /**
   * Callback when user presses up from the first item.
   * If provided, navigation will not wrap to the last item.
   */
  onUpFromFirstItem?: () => void

  /**
   * Focus the last option initially instead of the first.
   */
  initialFocusLast?: boolean

  /**
   * When true, numeric keys (1-9) do not toggle options by index.
   * Mirrors the rendering layer's hideIndexes: if index labels aren't shown,
   * pressing a number shouldn't silently toggle an invisible mapping.
   */
// hideIndexes 与渲染层联动：界面不显示数字序号，就不接受数字键。反向做（照收但不可见）会造出「看不见的映射」，用户按 3 却勾中了某一行，属于最难排查的一类 bug。
  hideIndexes?: boolean
}

// 返回值类型。注意它把底层导航状态原样展开，再补多选特有的几项——下面的实现里也是这个顺序，接口与实现一致。
export type MultiSelectState<T> = {
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
   * Currently selected values.
   */
  selectedValues: T[]

  /**
   * Current input field values.
   */
  inputValues: Map<T, string>

  /**
   * Whether the submit button is focused.
   */
  isSubmitFocused: boolean

  /**
   * Update an input field value.
   */
  updateInputValue: (value: T, inputValue: string) => void

  /**
   * Callback for canceling the select.
   */
  onCancel: () => void
}

// hook 入口，所有参数都有默认值。isDisabled 默认 false，但下面 useInput 的 isActive 取的是它的反值，禁用时完全不接管键盘。
export function useMultiSelectState<T>({
  isDisabled = false,
  visibleOptionCount = 5,
  options,
  defaultValue = [],
  onChange,
  onCancel,
  onFocus,
  focusValue,
  submitButtonText,
  onSubmit,
  onDownFromLastItem,
  onUpFromFirstItem,
  initialFocusLast,
  hideIndexes = false,
}: UseMultiSelectStateProps<T>): MultiSelectState<T> {
// 选中值用数组保存。这意味着它既可以当非受控用（自己维护状态），也可以靠 onChange 把结果抛给外部，但没有实现受控模式——外部无法从上面把选中值压下来。
  const [selectedValues, setSelectedValues] = useState<T[]>(defaultValue)
  const [isSubmitFocused, setIsSubmitFocused] = useState(false)

  // Reset selectedValues when options change (e.g. async-loaded data changes
  // defaultValue after mount). Mirrors the reset pattern in use-select-navigation.ts
  // and the deleted ui/useMultiSelectState.ts — without this, MCPServerDesktopImportDialog
  // keeps colliding servers checked after getAllMcpConfigs() resolves.
  const [lastOptions, setLastOptions] = useState(options)
// 这一行在渲染期直接 setState，属于 React 允许的「渲染期更新」特例：条件是 options 引用变了并且深比较不等。注释里写了真实事故——MCP 导入对话框在配置异步解析完成后仍保留上次的勾选，把已经不存在的服务器勾成残留。
  if (options !== lastOptions && !isDeepStrictEqual(options, lastOptions)) {
    setSelectedValues(defaultValue)
    setLastOptions(options)
  }

  // State for input type options
// 输入型选项的文本单独用 Map 存，key 是选项值本身。为什么不并进选中数组：输入框里写着字不等于「已选中」，两者是不同维度的状态。
  const [inputValues, setInputValues] = useState<Map<T, string>>(() => {
    const initialMap = new Map<T, string>()
    options.forEach(option => {
      if (option.type === 'input' && option.initialValue) {
        initialMap.set(option.value, option.initialValue)
      }
    })
    return initialMap
  })

// 对外唯一的写入口。它同时更新 state 与调用 onChange，杜绝「本地改了但外部不知道」这类不一致。注意它读的是闭包里的 selectedValues 而不是 setState 的函数式写法——因此每次依赖变化都会重建这个回调。
  const updateSelectedValues = useCallback(
    (values: T[] | ((prev: T[]) => T[])) => {
      const newValues =
        typeof values === 'function' ? values(selectedValues) : values
      setSelectedValues(newValues)
      onChange?.(newValues)
    },
    [selectedValues, onChange],
  )

// 导航交给 useSelectNavigation，本 hook 只叠加多选语义。initialFocusLast 是它的逃生口，用于「从下往上」的补全列表。
  const navigation = useSelectNavigation<T>({
    visibleOptionCount,
    options,
    initialFocusValue: initialFocusLast
      ? options[options.length - 1]?.value
      : undefined,
    onFocus,
    focusValue,
  })

  // Automatically register as an overlay.
  // This ensures CancelRequestHandler won't intercept Escape when the multi-select is active.
// 注册为 overlay。名字是固定字符串而不是随机 id，说明同一时刻只允许一个多选激活——这是设计约束，不是实现疏漏。
  useRegisterOverlay('multi-select')

// updateInputValue 三步走的顺序不能换：先写 Map（界面输入框立刻回显），再回调选项自己的 onChange（业务侧收到原文），最后按「有没有文本」决定选中集合。反过来的话，onChange 里读到的选中集合还是旧的。
  const updateInputValue = useCallback(
    (value: T, inputValue: string) => {
      setInputValues(prev => {
        const next = new Map(prev)
        next.set(value, inputValue)
        return next
      })

      // Find the option and call its onChange
      const option = options.find(opt => opt.value === value)
// 只有输入型选项才有 onChange 回调。普通选项的值是天然确定的，不需要业务方再介入。
      if (option && option.type === 'input') {
        option.onChange(inputValue)
      }

      // Update selected values to include/exclude based on input
// 空字符串等价于取消选中。这条规则让「清空输入框」自然等于「不选这一项」，用户不必再额外按一次回车去取消。
      updateSelectedValues(prev => {
        if (inputValue) {
          if (!prev.includes(value)) {
            return [...prev, value]
          }
          return prev
        } else {
          return prev.filter(v => v !== value)
        }
      })
    },
    [options, updateSelectedValues],
  )

  // Handle all keyboard input
// 唯一的键盘入口。第一件事是全角归一化，之后所有判断只面对 ASCII——这是中文输入法环境下能正常工作的前提，否则用户敲的数字键永远是全角字符、正则匹配不上。
  useInput(
    (input, key, event: InputEvent) => {
      const normalizedInput = normalizeFullWidthDigits(input)
      const focusedOption = options.find(
        opt => opt.value === navigation.focusedValue,
      )
      const isInInput = focusedOption?.type === 'input'

      // When in input field, only allow navigation keys
// 处于输入态时走白名单：只放行导航键、Esc、Tab、Enter 与 Ctrl+N/P，其余按键全部交回下层输入框。白名单而不是黑名单，因为输入框要接收任意可打印字符。
      if (isInInput) {
        const isAllowedKey =
          key.upArrow ||
          key.downArrow ||
          key.escape ||
          key.tab ||
          key.return ||
          (key.ctrl && (input === 'n' || input === 'p' || key.return))
        if (!isAllowedKey) return
      }

      const lastOptionValue = options[options.length - 1]?.value

      // Handle Tab to move forward
// Tab 前进。到最后一个选项后 Tab 进入提交按钮，Shift+Tab 再退回来。注意这条路径是单向的、不循环——循环会让用户永远出不去弹窗。
      if (key.tab && !key.shift) {
        if (
          submitButtonText &&
          onSubmit &&
          navigation.focusedValue === lastOptionValue &&
          !isSubmitFocused
        ) {
          setIsSubmitFocused(true)
        } else if (!isSubmitFocused) {
          navigation.focusNextOption()
        }
        return
      }

      // Handle Shift+Tab to move backward
      if (key.tab && key.shift) {
        if (submitButtonText && onSubmit && isSubmitFocused) {
          setIsSubmitFocused(false)
          navigation.focusOption(lastOptionValue)
        } else {
          navigation.focusPreviousOption()
        }
        return
      }

      // Handle arrow down / Ctrl+N / j
      if (
        key.downArrow ||
        (key.ctrl && input === 'n') ||
        (!key.ctrl && !key.shift && input === 'j')
      ) {
// 下方向键的优先级链有四种走向：在按钮上且有外部回调则把控制权交出去；在最后一格且有按钮则聚焦按钮；没有按钮则在最后一格直接交出去（相当于退出列表）；其余情况正常下移。真实终端里用户的期待正好是这个顺序。
        if (isSubmitFocused && onDownFromLastItem) {
          onDownFromLastItem()
        } else if (
          submitButtonText &&
          onSubmit &&
          navigation.focusedValue === lastOptionValue &&
          !isSubmitFocused
        ) {
          setIsSubmitFocused(true)
        } else if (
          !submitButtonText &&
          onDownFromLastItem &&
          navigation.focusedValue === lastOptionValue
        ) {
          // No submit button — exit from the last option
          onDownFromLastItem()
        } else if (!isSubmitFocused) {
          navigation.focusNextOption()
        }
        return
      }

      // Handle arrow up / Ctrl+P / k
      if (
        key.upArrow ||
        (key.ctrl && input === 'p') ||
        (!key.ctrl && !key.shift && input === 'k')
      ) {
// 上方向键对称处理：在按钮上则退回最后一格；在第一格且有 onUpFromFirstItem 则交出去；否则上移。注意它退回去用的是 focusOption 而不是「上一个」，因为按钮不在选项序列里。
        if (submitButtonText && onSubmit && isSubmitFocused) {
          setIsSubmitFocused(false)
          navigation.focusOption(lastOptionValue)
        } else if (
          onUpFromFirstItem &&
          navigation.focusedValue === options[0]?.value
        ) {
          onUpFromFirstItem()
        } else {
          navigation.focusPreviousOption()
        }
        return
      }

      // Handle page navigation
      if (key.pageDown) {
        navigation.focusNextPage()
        return
      }

      if (key.pageUp) {
        navigation.focusPreviousPage()
        return
      }

      // Handle Enter or Space for selection/submit
// Enter 与空格走同一分支，但内部有四处早退，顺序即优先级：输入态 Ctrl+Enter 直接提交、按钮上 Enter 提交、无按钮时 Enter 提交、最后才是切换选中。把最后一个当默认分支是对的——它覆盖了最常用的空格开关注。
      if (key.return || normalizeFullWidthSpace(input) === ' ') {
        // Ctrl+Enter from input field submits
// Ctrl+Enter 只在输入态生效。因为输入框里的普通 Enter 已经被别的语义占了（确认输入），只能用组合键表达「我写完了、整张表提交」。
        if (key.ctrl && key.return && isInInput && onSubmit) {
          onSubmit(selectedValues)
          return
        }

        // Enter on submit button submits
        if (isSubmitFocused && onSubmit) {
          onSubmit(selectedValues)
          return
        }

        // No submit button: Enter submits directly, Space still toggles
// 没有提交按钮时 Enter 也提交。这是「回车即完成」的旧式对话习惯；一旦界面上出现按钮，回车就必须只负责移动焦点，否则用户按回车会跳过还没勾的项。
        if (key.return && !submitButtonText && onSubmit) {
          onSubmit(selectedValues)
          return
        }

        // Enter or Space toggles selection (including for input fields)
        if (navigation.focusedValue !== undefined) {
          const newValues = selectedValues.includes(navigation.focusedValue)
            ? selectedValues.filter(v => v !== navigation.focusedValue)
            : [...selectedValues, navigation.focusedValue]
          updateSelectedValues(newValues)
        }
        return
      }

      // Handle numeric keys (1-9) for direct selection
// 数字键按序号直接切换，受 hideIndexes 门控。正则允许任意多位数字，注释里的 1-9 只是约定——实际 10 以上也能算出来，只是界面上从来没显示过那么多序号。
      if (!hideIndexes && /^[0-9]+$/.test(normalizedInput)) {
        const index = parseInt(normalizedInput) - 1
        if (index >= 0 && index < options.length) {
          const value = options[index]!.value
          const newValues = selectedValues.includes(value)
            ? selectedValues.filter(v => v !== value)
            : [...selectedValues, value]
          updateSelectedValues(newValues)
        }
        return
      }

      // Handle Escape
// Escape 除了回调 onCancel，还要 stopImmediatePropagation。少了这一句，同一次按键会继续被后续处理器消费，表现就是「按一次 Esc 关掉两层弹窗」。
      if (key.escape) {
        onCancel()
        event.stopImmediatePropagation()
      }
    },
// isActive 取反。禁用时彻底不接管键盘，事件继续向下传递——这是「禁用」与「吞掉按键」的区别，很多实现会错在这里。
    { isActive: !isDisabled },
  )

// 返回值把导航状态展开在前、多选字段在后，顺序即「基础能力 + 扩展能力」。调用方通常只用其中几项，但结构保持扁平，不做二次分组。
  return {
    ...navigation,
    selectedValues,
    inputValues,
    isSubmitFocused,
    updateInputValue,
    onCancel,
  }
}
