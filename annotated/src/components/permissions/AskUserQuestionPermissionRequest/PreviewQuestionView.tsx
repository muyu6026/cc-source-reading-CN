// 带预览的分题视图。当一道选择题的每个选项都附了「长什么样」的内容（设计稿、文件预览、方案对比）时，走这个视图而不是普通列表视图：左栏选项、右栏预览、下方 Notes 与两条尾部动作。它是整族提问界面里唯一会「同屏呈现两块信息」的一个，所以键盘焦点必须同时管三处（选项 / Notes / 尾部）。
import figures from 'figures';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import type { KeyboardEvent } from '../../../ink/events/keyboard-event.js';
import { Box, Text } from '../../../ink.js';
import { useKeybinding, useKeybindings } from '../../../keybindings/useKeybinding.js';
import { useAppState } from '../../../state/AppState.js';
import type { Question } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import { getExternalEditor } from '../../../utils/editor.js';
import { toIDEDisplayName } from '../../../utils/ide.js';
import { editPromptInEditor } from '../../../utils/promptEditor.js';
import { Divider } from '../../design-system/Divider.js';
import TextInput from '../../TextInput.js';
import { PermissionRequestTitle } from '../PermissionRequestTitle.js';
import { PreviewBox } from './PreviewBox.js';
import { QuestionNavigationBar } from './QuestionNavigationBar.js';
import type { QuestionState } from './use-multiple-choice-state.js';
// Props 把状态**全部外置**：answers、questionStates、当前题索引都由父级持有，本组件不存任何答案，只存「光标在哪、焦点在哪」。原因是提问支持多题翻页（Tab 切换），每题的光标位置若存在自己身上，切回来就丢了。
type Props = {
  question: Question;
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  questionStates: Record<string, QuestionState>;
  hideSubmitTab?: boolean;
  minContentHeight?: number;
  minContentWidth?: number;
  onUpdateQuestionState: (questionText: string, updates: Partial<QuestionState>, isMultiSelect: boolean) => void;
  onAnswer: (questionText: string, label: string | string[], textInput?: string, shouldAdvance?: boolean) => void;
  onTextInputFocus: (isInInput: boolean) => void;
  onCancel: () => void;
  onTabPrev?: () => void;
  onTabNext?: () => void;
  onRespondToClaude: () => void;
  onFinishPlanInterview: () => void;
};

/**
 * A side-by-side question view for questions with preview content.
 * Displays a vertical option list on the left with a preview panel on the right.
 */
// 注意这份文件没有 `react/compiler-runtime` 的引入——它与同目录的 QuestionView 不同，没有被 React Compiler 编译（或编译时跳过了）。判断依据是开头没有 `_c(N)`，所有回调都是手写 useCallback。读这一族文件时靠这一点就能立刻分辨哪份是编译器产物。
export function PreviewQuestionView({
  question,
  questions,
  currentQuestionIndex,
  answers,
  questionStates,
  hideSubmitTab = false,
  minContentHeight,
  minContentWidth,
  onUpdateQuestionState,
  onAnswer,
  onTextInputFocus,
  onCancel,
  onTabPrev,
  onTabNext,
  onRespondToClaude,
  onFinishPlanInterview
}: Props): React.ReactNode {
// 是否处于 plan 模式只用来决定尾部**多不多一行**（Skip interview and plan immediately）。注意它读的是工具权限上下文的 mode 而不是某个局部开关，所以用户在弹窗打开期间切模式，这里会立刻跟着变。
  const isInPlanMode = useAppState(s => s.toolPermissionContext.mode) === 'plan';
  const [isFooterFocused, setIsFooterFocused] = useState(false);
  const [footerIndex, setFooterIndex] = useState(0);
  const [isInNotesInput, setIsInNotesInput] = useState(false);
  const [cursorOffset, setCursorOffset] = useState(0);
// 外部编辑器在渲染期直接取（`getExternalEditor()` 无副作用、读的是环境变量与配置）。取不到时 `editorName` 为 null，下面 ctrl+g 的绑定与帮助文案都会自动消失——三处判断全部收敛到这一个变量。
  const editor = getExternalEditor();
  const editorName = editor ? toIDEDisplayName(editor) : null;
  const questionText = question.question;
  const questionState = questionStates[questionText];

  // Only real options — no "Other" for preview questions
// `allOptions = question.options` 上方那句注释很关键：**预览题不提供 Other 输入项**。普通问答题会在末尾拼一个 `__other__` 让用户自由输入，预览题不拼，因为自由输入没有对应的预览内容，右栏会空掉、布局会跳。
  const allOptions = question.options;

  // Track which option is focused (for preview display)
// focusedIndex 是**本组件唯一自持的导航状态**（选中值走 questionStates）。它存在自己的 useState 而不是父级，因为「光标在哪」是纯视觉状态，翻题回来重置到已选项更符合直觉。
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Reset focusedIndex when navigating to a different question
// 这一段在**渲染期间直接改 ref 并 setState**，看起来违反 React 规则，但它是有意的：用 ref 记住上一次的题干，一旦题干变了就同步把光标落到已选项上。放在 useEffect 里会多渲染一帧、用户会看到光标先闪到第一项再跳过去。这是「派生状态用渲染期同步」的标准写法。
  const prevQuestionText = useRef(questionText);
  if (prevQuestionText.current !== questionText) {
    prevQuestionText.current = questionText;
    const selected = questionState?.selectedValue as string | undefined;
    const idx = selected ? allOptions.findIndex(opt => opt.label === selected) : -1;
    setFocusedIndex(idx >= 0 ? idx : 0);
  }
  const focusedOption = allOptions[focusedIndex];
  const selectedValue = questionState?.selectedValue as string | undefined;
  const notesValue = questionState?.textInputValue || '';
// 选中一个选项：先移动光标 → 写回选中值 → 上报答案。三步顺序固定，且 `onUpdateQuestionState` 的第三个参数传 false（表示不是多选）。父级靠这个 false 决定要不要把状态当成数组处理。
  const handleSelectOption = useCallback((index: number) => {
    const option = allOptions[index];
    if (!option) return;
    setFocusedIndex(index);
    onUpdateQuestionState(questionText, {
      selectedValue: option.label
    }, false);
    onAnswer(questionText, option.label);
  }, [allOptions, questionText, onUpdateQuestionState, onAnswer]);
  const handleNavigate = useCallback((direction: 'up' | 'down' | number) => {
    if (isInNotesInput) return;
    let newIndex: number;
    if (typeof direction === 'number') {
      newIndex = direction;
    } else if (direction === 'up') {
      newIndex = focusedIndex > 0 ? focusedIndex - 1 : focusedIndex;
    } else {
      newIndex = focusedIndex < allOptions.length - 1 ? focusedIndex + 1 : focusedIndex;
    }
    if (newIndex >= 0 && newIndex < allOptions.length) {
      setFocusedIndex(newIndex);
    }
  }, [focusedIndex, allOptions.length, isInNotesInput]);

  // Handle ctrl+g to open external editor for notes
// ctrl+g 调外部编辑器，只在 Notes 输入框内激活（`isActive: isInNotesInput && !!editor`）。这是一个很实用的设计：Notes 往往要写长段，终端里打字体验差，交给 $EDITOR 写更舒服；但只在输入框聚焦时才劫持这个键，否则会和全局的 ctrl+g 打架。
  useKeybinding('chat:externalEditor', async () => {
    const currentValue = questionState?.textInputValue || '';
    const result = await editPromptInEditor(currentValue);
    if (result.content !== null && result.content !== currentValue) {
      onUpdateQuestionState(questionText, {
        textInputValue: result.content
      }, false);
    }
  }, {
    context: 'Chat',
    isActive: isInNotesInput && !!editor
  });

// 这段注释解释了本文件里最容易被误删的一段代码：**Tab 左右切题的键绑定为什么写在子组件里**。原因是事件发射器按注册顺序触发，子组件的 useInput 先注册先触发；如果只写在父级，父级的处理器可能被输入框吞掉。这类「看起来重复、其实是监听顺序问题」的代码，删掉之后表现为「有时能切题有时不能」。
  // Handle left/right arrow and tab for question navigation.
  // This must be in the child component (not just the parent) because child useInput
  // handlers register first on the event emitter and fire before parent handlers.
  // Without this, the parent's useKeybindings may not fire reliably depending on
  // listener ordering in the event emitter.
// tabs:previous / tabs:next 的 isActive 条件是「不在 Notes 里且焦点不在尾部」——否则在 Notes 里按 Tab 会被当作切题、把用户写的内容丢掉。
  useKeybindings({
    'tabs:previous': () => onTabPrev?.(),
    'tabs:next': () => onTabNext?.()
  }, {
    context: 'Tabs',
    isActive: !isInNotesInput && !isFooterFocused
  });

  // Re-submit the answer (plain label) when exiting notes input.
  // Notes are stored in questionStates and collected at submit time via annotations.
// 退出 Notes 时**重新提交一次答案**，而且只提交纯标签、不带 Notes 文本。注释说得很清楚：Notes 存在 questionStates 里，提交时统一收口成 annotations。如果在退出时把 Notes 塞进 textInput，就会在答案里出现两份 Notes（一份在 annotation、一份在 text）。
  const handleNotesExit = useCallback(() => {
    setIsInNotesInput(false);
    onTextInputFocus(false);
    if (selectedValue) {
      onAnswer(questionText, selectedValue);
    }
  }, [selectedValue, questionText, onAnswer, onTextInputFocus]);
  const handleDownFromPreview = useCallback(() => {
    setIsFooterFocused(true);
  }, []);
  const handleUpFromFooter = useCallback(() => {
    setIsFooterFocused(false);
  }, []);

  // Handle keyboard input for option/footer/notes navigation.
  // Always active — the handler routes internally based on isFooterFocused/isInNotesInput.
// 整个键盘逻辑收在一个 handleKeyDown 里，内部按 **尾部 > Notes > 选项** 三级路由，而不是注册多个互相竞争的处理器。理由同上面注释：多处理器要靠 stopPropagation 抢，抢的顺序不确定；单入口按状态分支，优先级永远明确。
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isFooterFocused) {
      if (e.key === 'up' || e.ctrl && e.key === 'p') {
        e.preventDefault();
        if (footerIndex === 0) {
          handleUpFromFooter();
        } else {
          setFooterIndex(0);
        }
        return;
      }
      if (e.key === 'down' || e.ctrl && e.key === 'n') {
        e.preventDefault();
// 尾部向下键：只有 plan 模式下才允许从第 0 项移到第 1 项。非 plan 模式时尾部只有一行，按下键什么也不做——而不是回绕到第 0 项，因为回绕会让用户以为还有更多内容。
        if (isInPlanMode && footerIndex === 0) {
          setFooterIndex(1);
        }
        return;
      }
      if (e.key === 'return') {
        e.preventDefault();
        if (footerIndex === 0) {
          onRespondToClaude();
        } else {
          onFinishPlanInterview();
        }
        return;
      }
      if (e.key === 'escape') {
        e.preventDefault();
        onCancel();
      }
      return;
    }
    if (isInNotesInput) {
      // In notes input mode, handle escape to exit back to option navigation
      if (e.key === 'escape') {
        e.preventDefault();
        handleNotesExit();
      }
      return;
    }

    // Handle option navigation (vertical)
    if (e.key === 'up' || e.ctrl && e.key === 'p') {
      e.preventDefault();
      if (focusedIndex > 0) {
        handleNavigate('up');
      }
    } else if (e.key === 'down' || e.ctrl && e.key === 'n') {
      e.preventDefault();
      if (focusedIndex === allOptions.length - 1) {
        // At bottom of options, go to footer
        handleDownFromPreview();
      } else {
        handleNavigate('down');
      }
    } else if (e.key === 'return') {
      e.preventDefault();
      handleSelectOption(focusedIndex);
    } else if (e.key === 'n' && !e.ctrl && !e.meta) {
      // Press 'n' to focus the notes input
      e.preventDefault();
      setIsInNotesInput(true);
      onTextInputFocus(true);
    } else if (e.key === 'escape') {
      e.preventDefault();
      onCancel();
// 数字键 1–9 直选。这里有两个细节：`e.key.length === 1` 先把功能键（ArrowUp 等多字符键名）排除掉；越界时**只移动光标不选中**，因为按错数字比按错回车更容易，移动光标让用户能看清再去确认。
    } else if (e.key.length === 1 && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx_0 = parseInt(e.key, 10) - 1;
      if (idx_0 < allOptions.length) {
        handleNavigate(idx_0);
      }
    }
  }, [isFooterFocused, footerIndex, isInPlanMode, isInNotesInput, focusedIndex, allOptions.length, handleUpFromFooter, handleDownFromPreview, handleNavigate, handleSelectOption, handleNotesExit, onRespondToClaude, onFinishPlanInterview, onCancel, onTextInputFocus]);
// 预览内容直接取 `focusedOption?.preview`，没有做 memo——因为它就是一个属性读取，且 focusedOption 本身由 focusedIndex 索引得出，开销可以忽略。右栏在拿不到内容时显示 No preview available，而不是折叠掉整栏，否则左右布局会突然变成单栏、光标也跟着跳。
  const previewContent = focusedOption?.preview || null;

  // The right panel's available width is terminal minus the left panel and gap.
  const LEFT_PANEL_WIDTH = 30;
  const GAP = 4;
  const {
    columns
  } = useTerminalSize();
  const previewMaxWidth = columns - LEFT_PANEL_WIDTH - GAP;

  // Lines used within the content area that aren't preview content:
  // 1: marginTop on side-by-side box
  // 2: PreviewBox borders (top + bottom)
  // 2: notes section (marginTop=1 + text)
  // 2: footer section (marginTop=1 + divider)
  // 1: "Chat about this" line
  // 1: plan mode line (may or may not show)
  // 2: help text (marginTop=1 + text)
// `PREVIEW_OVERHEAD = 11` 是这份文件里最值得看的一段：它把右栏之外所有占行的东西**逐项列出并累加**（外边距 1、预览框上下边框 2、Notes 区 2、尾部分隔 2、尾项 1–2、帮助行 2）。终端布局没有 CSS 的 flex 自动收缩，这类「预算常量」必须手算并且写清明细，否则改一处边距就会在某个终端高度下溢出。
  const PREVIEW_OVERHEAD = 11;

  // Compute the max lines available for preview content from the parent's
  // height budget to prevent terminal overflow. We do NOT pad shorter options
  // to match the tallest — the outer box's minHeight handles cross-question
  // layout consistency, and within-question shifts are acceptable.
  const previewMaxLines = useMemo(() => {
    return minContentHeight ? Math.max(1, minContentHeight - PREVIEW_OVERHEAD) : undefined;
  }, [minContentHeight]);
  return <Box flexDirection="column" marginTop={1} tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Divider color="inactive" />
      <Box flexDirection="column" paddingTop={0}>
        <QuestionNavigationBar questions={questions} currentQuestionIndex={currentQuestionIndex} answers={answers} hideSubmitTab={hideSubmitTab} />
        <PermissionRequestTitle title={question.question} color={'text'} />

        <Box flexDirection="column" minHeight={minContentHeight}>
          {/* Side-by-side layout: options on left, preview on right */}
// 左右分栏用 `flexDirection=「row」 gap={4}`，左栏写死 `width={30}`，右栏 `flexGrow={1}`。左栏固定宽是因为选项卡最长也就那个宽度，浮动宽会让每次切题都抖动；右栏吃掉剩余空间，这样预览区能随终端变宽而变宽。
          <Box marginTop={1} flexDirection="row" gap={4}>
            {/* Left panel: vertical option list */}
            <Box flexDirection="column" width={30}>
              {allOptions.map((option_0, index_0) => {
              const isFocused = focusedIndex === index_0;
              const isSelected = selectedValue === option_0.label;
              return <Box key={option_0.label} flexDirection="row">
                    {isFocused ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
                    <Text dimColor> {index_0 + 1}.</Text>
                    <Text color={isSelected ? 'success' : isFocused ? 'suggestion' : undefined} bold={isFocused}>
                      {' '}
                      {option_0.label}
                    </Text>
                    {isSelected && <Text color="success"> {figures.tick}</Text>}
                  </Box>;
            })}
            </Box>

            {/* Right panel: preview + notes */}
            <Box flexDirection="column" flexGrow={1}>
              <PreviewBox content={previewContent || 'No preview available'} maxLines={previewMaxLines} minWidth={minContentWidth} maxWidth={previewMaxWidth} />
              <Box marginTop={1} flexDirection="row" gap={1}>
                <Text color="suggestion">Notes:</Text>
// Notes 区有两个形态：聚焦时是真的 TextInput（带光标、可编辑），未聚焦时是一行 dim 提示。`columns={60}` 是写死的输入宽度而不是取终端宽——因为 Notes 只是附注，不需要占满整行；写死还能避免终端 resize 时光标错位。
                {isInNotesInput ? <TextInput value={notesValue} placeholder="Add notes on this design…" onChange={value => {
                onUpdateQuestionState(questionText, {
                  textInputValue: value
                }, false);
              }} onSubmit={handleNotesExit} onExit={handleNotesExit} focus={true} showCursor={true} columns={60} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} /> : <Text dimColor italic>
                    {notesValue || 'press n to add notes'}
                  </Text>}
              </Box>
            </Box>
          </Box>

          {/* Footer section */}
          <Box flexDirection="column" marginTop={1}>
            <Divider color="inactive" />
            <Box flexDirection="row" gap={1}>
              {isFooterFocused && footerIndex === 0 ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
              <Text color={isFooterFocused && footerIndex === 0 ? 'suggestion' : undefined}>
                Chat about this
              </Text>
            </Box>
// 尾部第二项**只在 plan 模式下渲染**，并且用 `isFooterFocused && footerIndex === 1` 判断指针。注意 footerIndex 在非 plan 模式下永远进不到 1（上面向下键有守卫），所以这里不需要额外判断越界——两个组件各自守一半，没有重复守卫。
            {isInPlanMode && <Box flexDirection="row" gap={1}>
                {isFooterFocused && footerIndex === 1 ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
                <Text color={isFooterFocused && footerIndex === 1 ? 'suggestion' : undefined}>
                  Skip interview and plan immediately
                </Text>
              </Box>}
          </Box>
          <Box marginTop={1}>
            <Text color="inactive" dimColor>
              Enter to select · {figures.arrowUp}/{figures.arrowDown} to
              navigate · n to add notes
              {questions.length > 1 && <> · Tab to switch questions</>}
              {isInNotesInput && editorName && <> · ctrl+g to edit in {editorName}</>}{' '}
              · Esc to cancel
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>;
}
// 原文件此处有一行 39408 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。