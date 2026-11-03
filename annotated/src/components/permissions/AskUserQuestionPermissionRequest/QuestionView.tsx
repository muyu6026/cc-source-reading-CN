// 本文件是「向用户提问」这个工具的单题视图。它要在一屏里同时容纳四件事：题目与选项（单选或多选）、一个可自由输入的自定义选项、一个多题之间的导航条、以及两条固定在底部的动作行（就这个题目聊一聊、跳过访谈直接进计划模式）。最值得读的是底部两行如何从选项列表手里接管上下键——这是整个文件里唯一一处「两个不同组件竞争同一个键」的地方。记忆槽开到 114 个，说明编译器为这个组件切出了极多的缓存点，读的时候不要被缓存分支淹没，直接看每个分支里被赋值的表达式即可。
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React, { useCallback, useState } from 'react';
import type { KeyboardEvent } from '../../../ink/events/keyboard-event.js';
import { Box, Text } from '../../../ink.js';
import { useAppState } from '../../../state/AppState.js';
import type { Question, QuestionOption } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import type { PastedContent } from '../../../utils/config.js';
import { getExternalEditor } from '../../../utils/editor.js';
import { toIDEDisplayName } from '../../../utils/ide.js';
import type { ImageDimensions } from '../../../utils/imageResizer.js';
import { editPromptInEditor } from '../../../utils/promptEditor.js';
import { type OptionWithDescription, Select, SelectMulti } from '../../CustomSelect/index.js';
import { Divider } from '../../design-system/Divider.js';
import { FilePathLink } from '../../FilePathLink.js';
import { PermissionRequestTitle } from '../PermissionRequestTitle.js';
import { PreviewQuestionView } from './PreviewQuestionView.js';
import { QuestionNavigationBar } from './QuestionNavigationBar.js';
import type { QuestionState } from './use-multiple-choice-state.js';
// Props 把「这一题」「全部题目」「当前第几题」「已答内容」「每题状态」分开传入，而不是塞一个复合对象——因为导航条、预览视图、下拉框各自只关心其中一部分，分开传能让每个子组件的记忆化粒度更细。三个可选属性值得注意：是否隐藏提交页、计划文件路径、粘贴内容；两个尺寸下限是给外层布局做对齐用的，本组件只负责把它透传到底部容器。
type Props = {
  question: Question;
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  questionStates: Record<string, QuestionState>;
  hideSubmitTab?: boolean;
  planFilePath?: string;
  pastedContents?: Record<number, PastedContent>;
  minContentHeight?: number;
  minContentWidth?: number;
  onUpdateQuestionState: (questionText: string, updates: Partial<QuestionState>, isMultiSelect: boolean) => void;
  onAnswer: (questionText: string, label: string | string[], textInput?: string, shouldAdvance?: boolean) => void;
  onTextInputFocus: (isInInput: boolean) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onTabPrev?: () => void;
  onTabNext?: () => void;
  onRespondToClaude: () => void;
  onFinishPlanInterview: () => void;
  onImagePaste?: (base64Image: string, mediaType?: string, filename?: string, dimensions?: ImageDimensions, sourcePath?: string) => void;
  onRemoveImage?: (id: number) => void;
};
// 组件本体：先取缓存槽句柄，再把属性解构出来。注意「是否隐藏提交页」被重命名成局部变量再补默认值，这是编译器处理带默认值的可选属性的固定套路。
export function QuestionView(t0) {
  const $ = _c(114);
  const {
    question,
    questions,
    currentQuestionIndex,
    answers,
    questionStates,
    hideSubmitTab: t1,
    planFilePath,
    minContentHeight,
    minContentWidth,
    onUpdateQuestionState,
    onAnswer,
    onTextInputFocus,
    onCancel,
    onSubmit,
    onTabPrev,
    onTabNext,
    onRespondToClaude,
    onFinishPlanInterview,
    onImagePaste,
    pastedContents,
    onRemoveImage
  } = t0;
  const hideSubmitTab = t1 === undefined ? false : t1;
// 是否处于计划模式。这个判断只读全局状态里的权限模式，但它决定了底部第二行动作是否存在、以及上下键能不能下移到第二行——一处状态、两处分支，读代码时要把这两处对上。
  const isInPlanMode = useAppState(_temp) === "plan";
  const [isFooterFocused, setIsFooterFocused] = useState(false);
  const [footerIndex, setFooterIndex] = useState(0);
  const [isOtherFocused, setIsOtherFocused] = useState(false);
  let t2;
// 编辑器名只在首次渲染时算一次：先取外部编辑器环境变量，再翻成给人看的名字。这个值不变，所以整个生命周期只读一次环境。
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    const editor = getExternalEditor();
    t2 = editor ? toIDEDisplayName(editor) : null;
    $[0] = t2;
  } else {
    t2 = $[0];
  }
  const editorName = t2;
  let t3;
// 聚焦回调：判断当前聚焦的是不是那个自定义输入项，是就把「输入中」状态同步给父级。之所以要往上报，是因为父级要据此决定底部提示里是否追加一段「按某键在编辑器里编辑」。
  if ($[1] !== onTextInputFocus) {
    t3 = value => {
      const isOther = value === "__other__";
      setIsOtherFocused(isOther);
      onTextInputFocus(isOther);
    };
    $[1] = onTextInputFocus;
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  const handleFocus = t3;
  let t4;
// 这两个回调是底部接管键的入口：从最后一个选项再按向下，就进入底部行；从底部第一行再按向上，就退回选项列表。命名里带 FromLastItem 与 FromFooter，正好说明它们是由下拉框主动调用的，而不是组件自己在键盘处理里判断。
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = () => {
      setIsFooterFocused(true);
    };
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  const handleDownFromLastItem = t4;
  let t5;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = () => {
      setIsFooterFocused(false);
    };
    $[4] = t5;
  } else {
    t5 = $[4];
  }
  const handleUpFromFooter = t5;
  let t6;
  if ($[5] !== footerIndex || $[6] !== isFooterFocused || $[7] !== isInPlanMode || $[8] !== onCancel || $[9] !== onFinishPlanInterview || $[10] !== onRespondToClaude) {
// 底部行的键盘处理，四个分支按优先级排列，且每个分支都先拦掉事件再处理：向上（或上翻页键）在第一行就退出底部、否则回到第一行；向下只在计划模式下才允许走到第二行；回车按行号触发对应动作；退出键取消整个提问。注意所有分支开头都有「未聚焦底部就直接返回」的守卫，这就是选项列表与底部行共享键盘而不打架的关键——底部只在被显式聚焦后才消费按键。
    t6 = e => {
      if (!isFooterFocused) {
        return;
      }
// 向上分支：同时接方向键与控制键组合（终端里后者更可靠，方向键在部分终端会被应用层截走）。先拦事件，再分「已在第一行就退出底部」「不在第一行就回第一行」两种。
      if (e.key === "up" || e.ctrl && e.key === "p") {
        e.preventDefault();
        if (footerIndex === 0) {
          handleUpFromFooter();
        } else {
          setFooterIndex(0);
        }
        return;
      }
// 向下分支：只有在计划模式下、且当前在第一行时才移到第二行。非计划模式下底部只有一行，向下什么都不做但仍拦掉事件——避免按键漏到下层组件造成语义混乱。
      if (e.key === "down" || e.ctrl && e.key === "n") {
        e.preventDefault();
        if (isInPlanMode && footerIndex === 0) {
          setFooterIndex(1);
        }
        return;
      }
// 回车分支：按当前行号分派到两个不同的父级回调。第一行是「就这个题目聊一聊」，第二行是「跳过访谈立即制定计划」。两个动作的语义差别很大，但在这里只差一个行号。
      if (e.key === "return") {
        e.preventDefault();
        if (footerIndex === 0) {
          onRespondToClaude();
        } else {
          onFinishPlanInterview();
        }
        return;
      }
// 退出分支放在最后但仍拦事件：无论底部聚焦在哪一行，退出键都是取消整个提问，与选项列表里的退出键语义一致。
      if (e.key === "escape") {
        e.preventDefault();
        onCancel();
      }
    };
    $[5] = footerIndex;
    $[6] = isFooterFocused;
    $[7] = isInPlanMode;
    $[8] = onCancel;
    $[9] = onFinishPlanInterview;
    $[10] = onRespondToClaude;
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  const handleKeyDown = t6;
  let handleOpenEditor;
  let questionText;
  let t7;
// 这一段是全文件的组装核心，一口气做了四件事：把题目的文本选项映射成下拉框认识的结构、取出本题的状态、造一个把内容写回编辑器的异步函数、造一个把输入值写回状态的函数，最后拼成「文本选项加一个自定义输入项」。整段被一个大缓存槽包住，只要题目、题目状态、写回函数三者不变就整段复用。
  if ($[12] !== onUpdateQuestionState || $[13] !== question || $[14] !== questionStates) {
    const textOptions = question.options.map(_temp2);
    questionText = question.question;
    const questionState = questionStates[questionText];
    let t8;
    if ($[18] !== onUpdateQuestionState || $[19] !== question.multiSelect || $[20] !== questionText) {
// 在编辑器里编辑：把当前值交给外部编辑器，只有在返回内容既非空又与原来不同时才写回状态——这个「不相同才写」的判断很关键，否则用户打开编辑器又原样保存会触发一次无意义的状态更新与重渲染。
      t8 = async (currentValue, setValue) => {
        const result = await editPromptInEditor(currentValue);
        if (result.content !== null && result.content !== currentValue) {
          setValue(result.content);
          onUpdateQuestionState(questionText, {
            textInputValue: result.content
          }, question.multiSelect ?? false);
        }
      };
      $[18] = onUpdateQuestionState;
      $[19] = question.multiSelect;
      $[20] = questionText;
      $[21] = t8;
    } else {
      t8 = $[21];
    }
    handleOpenEditor = t8;
// 占位文案按单选与多选分开：多选时没有句号、单选时带句号。这种细节看起来随意，实际是文案统一性检查的结果——多选后面还有别的输入框接着，加句号会割裂。同段还取出本题已输入的值，作为自定义输入项的初始值。
    const t9 = question.multiSelect ? "Type something" : "Type something.";
    const t10 = questionState?.textInputValue ?? "";
    let t11;
    if ($[22] !== onUpdateQuestionState || $[23] !== question.multiSelect || $[24] !== questionText) {
      t11 = value_0 => {
        onUpdateQuestionState(questionText, {
          textInputValue: value_0
        }, question.multiSelect ?? false);
      };
      $[22] = onUpdateQuestionState;
      $[23] = question.multiSelect;
      $[24] = questionText;
      $[25] = t11;
    } else {
      t11 = $[25];
    }
    let t12;
    if ($[26] !== t10 || $[27] !== t11 || $[28] !== t9) {
// 自定义输入项的构造：类型是输入型、值是固定标记、标签是「其他」、占位与初值都来自上面、写回函数指向状态更新。这个固定标记是后面所有分支用来识别「用户选了自定义输入」的唯一依据，全文件出现多次，改动它等于改动全部分支。
      t12 = {
        type: "input" as const,
        value: "__other__",
        label: "Other",
        placeholder: t9,
        initialValue: t10,
        onChange: t11
      };
      $[26] = t10;
      $[27] = t11;
      $[28] = t9;
      $[29] = t12;
    } else {
      t12 = $[29];
    }
    const otherOption = t12;
// 文本选项与自定义输入项拼成最终选项数组。顺序很要紧——自定义输入永远在最后，底部两行的编号直接接在它后面，所以「其他」永远是第一个可输入但非预设的选项。
    t7 = [...textOptions, otherOption];
    $[12] = onUpdateQuestionState;
    $[13] = question;
    $[14] = questionStates;
    $[15] = handleOpenEditor;
    $[16] = questionText;
    $[17] = t7;
  } else {
    handleOpenEditor = $[15];
    questionText = $[16];
    t7 = $[17];
  }
  const options = t7;
// 是否走预览视图：多选条件下不支持预览，单选条件下只要有一个选项带预览内容就走预览视图。这个判断做在选项组装之后、主界面之前，一旦成立就整屏交给另一个组件，本文件剩下的布局全部跳过。
  const hasAnyPreview = !question.multiSelect && question.options.some(_temp3);
  if (hasAnyPreview) {
    let t8;
    if ($[30] !== answers || $[31] !== currentQuestionIndex || $[32] !== hideSubmitTab || $[33] !== minContentHeight || $[34] !== minContentWidth || $[35] !== onAnswer || $[36] !== onCancel || $[37] !== onFinishPlanInterview || $[38] !== onRespondToClaude || $[39] !== onTabNext || $[40] !== onTabPrev || $[41] !== onTextInputFocus || $[42] !== onUpdateQuestionState || $[43] !== question || $[44] !== questionStates || $[45] !== questions) {
      t8 = <PreviewQuestionView question={question} questions={questions} currentQuestionIndex={currentQuestionIndex} answers={answers} questionStates={questionStates} hideSubmitTab={hideSubmitTab} minContentHeight={minContentHeight} minContentWidth={minContentWidth} onUpdateQuestionState={onUpdateQuestionState} onAnswer={onAnswer} onTextInputFocus={onTextInputFocus} onCancel={onCancel} onTabPrev={onTabPrev} onTabNext={onTabNext} onRespondToClaude={onRespondToClaude} onFinishPlanInterview={onFinishPlanInterview} />;
      $[30] = answers;
      $[31] = currentQuestionIndex;
      $[32] = hideSubmitTab;
      $[33] = minContentHeight;
      $[34] = minContentWidth;
      $[35] = onAnswer;
      $[36] = onCancel;
      $[37] = onFinishPlanInterview;
      $[38] = onRespondToClaude;
      $[39] = onTabNext;
      $[40] = onTabPrev;
      $[41] = onTextInputFocus;
      $[42] = onUpdateQuestionState;
      $[43] = question;
      $[44] = questionStates;
      $[45] = questions;
      $[46] = t8;
    } else {
      t8 = $[46];
    }
    return t8;
  }
  let t8;
// 计划模式下的顶部条：一条分隔线加一行「正在制定计划：某个文件」。只有在计划模式且拿到计划文件路径时才有；文件路径用专门的链接组件渲染，这样在支持的终端里可以直接点开。
  if ($[47] !== isInPlanMode || $[48] !== planFilePath) {
    t8 = isInPlanMode && planFilePath && <Box flexDirection="column" gap={0}><Divider color="inactive" /><Text color="inactive">Planning: <FilePathLink filePath={planFilePath} /></Text></Box>;
    $[47] = isInPlanMode;
    $[48] = planFilePath;
    $[49] = t8;
  } else {
    t8 = $[49];
  }
  let t9;
  if ($[50] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = <Box marginTop={-1}><Divider color="inactive" /></Box>;
    $[50] = t9;
  } else {
    t9 = $[50];
  }
  let t10;
  if ($[51] !== answers || $[52] !== currentQuestionIndex || $[53] !== hideSubmitTab || $[54] !== questions) {
    t10 = <QuestionNavigationBar questions={questions} currentQuestionIndex={currentQuestionIndex} answers={answers} hideSubmitTab={hideSubmitTab} />;
    $[51] = answers;
    $[52] = currentQuestionIndex;
    $[53] = hideSubmitTab;
    $[54] = questions;
    $[55] = t10;
  } else {
    t10 = $[55];
  }
  let t11;
  if ($[56] !== question.question) {
    t11 = <PermissionRequestTitle title={question.question} color="text" />;
    $[56] = question.question;
    $[57] = t11;
  } else {
    t11 = $[57];
  }
  let t12;
  if ($[58] !== currentQuestionIndex || $[59] !== handleFocus || $[60] !== handleOpenEditor || $[61] !== isFooterFocused || $[62] !== onAnswer || $[63] !== onCancel || $[64] !== onImagePaste || $[65] !== onRemoveImage || $[66] !== onSubmit || $[67] !== onUpdateQuestionState || $[68] !== options || $[69] !== pastedContents || $[70] !== question.multiSelect || $[71] !== question.question || $[72] !== questionStates || $[73] !== questionText || $[74] !== questions.length) {
// 选项区按单选与多选分派到两个不同组件。多选版的提交按钮文案随位置变化——最后一题是「提交」，其余是「下一题」；两个版本都被传入同一个「从最后一项向下」的回调，于是底部接管对两种模式都成立。注意两个组件都用题目文本作为键，题目一变就整块重建，避免上一题的选择残留。
    t12 = <Box marginTop={1}>{question.multiSelect ? <SelectMulti key={question.question} options={options} defaultValue={questionStates[question.question]?.selectedValue as string[] | undefined} onChange={values => {
        onUpdateQuestionState(questionText, {
          selectedValue: values
        }, true);
        const textInput = values.includes("__other__") ? questionStates[questionText]?.textInputValue : undefined;
// 多选的回写逻辑是这里最容易读错的一行：先把固定标记从选中值里滤掉，再把自定义输入的实际文本作为一项追加进去。也就是说「其他」这个标记只用于界面识别，最终提交的答案里不会出现它，出现的永远是用户真正打的字。这个转换只发生一次，且发生在提交前，所以上层拿到的永远是干净的答案数组。
        const finalValues = values.filter(_temp4).concat(textInput ? [textInput] : []);
        onAnswer(questionText, finalValues, undefined, false);
      }} onFocus={handleFocus} onCancel={onCancel} submitButtonText={currentQuestionIndex === questions.length - 1 ? "Submit" : "Next"} onSubmit={onSubmit} onDownFromLastItem={handleDownFromLastItem} isDisabled={isFooterFocused} onOpenEditor={handleOpenEditor} onImagePaste={onImagePaste} pastedContents={pastedContents} onRemoveImage={onRemoveImage} /> : <Select key={question.question} options={options} defaultValue={questionStates[question.question]?.selectedValue as string | undefined} onChange={value_1 => {
        onUpdateQuestionState(questionText, {
          selectedValue: value_1
        }, false);
        const textInput_0 = value_1 === "__other__" ? questionStates[questionText]?.textInputValue : undefined;
        onAnswer(questionText, value_1, textInput_0);
      }} onFocus={handleFocus} onCancel={onCancel} onDownFromLastItem={handleDownFromLastItem} isDisabled={isFooterFocused} layout="compact-vertical" onOpenEditor={handleOpenEditor} onImagePaste={onImagePaste} pastedContents={pastedContents} onRemoveImage={onRemoveImage} />}</Box>;
    $[58] = currentQuestionIndex;
    $[59] = handleFocus;
    $[60] = handleOpenEditor;
    $[61] = isFooterFocused;
    $[62] = onAnswer;
    $[63] = onCancel;
    $[64] = onImagePaste;
    $[65] = onRemoveImage;
    $[66] = onSubmit;
    $[67] = onUpdateQuestionState;
    $[68] = options;
    $[69] = pastedContents;
    $[70] = question.multiSelect;
    $[71] = question.question;
    $[72] = questionStates;
    $[73] = questionText;
    $[74] = questions.length;
    $[75] = t12;
  } else {
    t12 = $[75];
  }
  let t13;
  if ($[76] === Symbol.for("react.memo_cache_sentinel")) {
    t13 = <Divider color="inactive" />;
    $[76] = t13;
  } else {
    t13 = $[76];
  }
  let t14;
// 底部第一行的指针：只有底部被聚焦且停在第一行时才显示箭头，否则渲染一个空格占位——用一个空格而不是条件渲染，是为了让两行的高度与缩进在任何状态下都不变。
  if ($[77] !== footerIndex || $[78] !== isFooterFocused) {
    t14 = isFooterFocused && footerIndex === 0 ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>;
    $[77] = footerIndex;
    $[78] = isFooterFocused;
    $[79] = t14;
  } else {
    t14 = $[79];
  }
  const t15 = isFooterFocused && footerIndex === 0 ? "suggestion" : undefined;
// 编号技巧：底部第一行的序号等于选项数量加一。这样用户在选项区看到的编号与底部行的编号是同一套连续序号，不必维护两张表；第二行同理是选项数加二。这种「编号即位置」的写法让新增选项时无需改任何地方。
  const t16 = options.length + 1;
  let t17;
  if ($[80] !== t15 || $[81] !== t16) {
    t17 = <Text color={t15}>{t16}. Chat about this</Text>;
    $[80] = t15;
    $[81] = t16;
    $[82] = t17;
  } else {
    t17 = $[82];
  }
  let t18;
  if ($[83] !== t14 || $[84] !== t17) {
    t18 = <Box flexDirection="row" gap={1}>{t14}{t17}</Box>;
    $[83] = t14;
    $[84] = t17;
    $[85] = t18;
  } else {
    t18 = $[85];
  }
  let t19;
// 底部第二行只在计划模式下存在。它的箭头与高亮条件比第一行多一个行号判断，且同样用空格占位保持对齐。
  if ($[86] !== footerIndex || $[87] !== isFooterFocused || $[88] !== isInPlanMode || $[89] !== options.length) {
    t19 = isInPlanMode && <Box flexDirection="row" gap={1}>{isFooterFocused && footerIndex === 1 ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}<Text color={isFooterFocused && footerIndex === 1 ? "suggestion" : undefined}>{options.length + 2}. Skip interview and plan immediately</Text></Box>;
    $[86] = footerIndex;
    $[87] = isFooterFocused;
    $[88] = isInPlanMode;
    $[89] = options.length;
    $[90] = t19;
  } else {
    t19 = $[90];
  }
  let t20;
  if ($[91] !== t18 || $[92] !== t19) {
    t20 = <Box flexDirection="column">{t13}{t18}{t19}</Box>;
    $[91] = t18;
    $[92] = t19;
    $[93] = t20;
  } else {
    t20 = $[93];
  }
  let t21;
  if ($[94] !== questions.length) {
// 导航提示分两种：只有一题时提示上下键，多题时提示切页键或方向键。这里把两个箭头字符直接插进文案，靠图形常量而不是手写字符，是终端界面里保证跨平台字形一致的常规做法。
    t21 = questions.length === 1 ? <>{figures.arrowUp}/{figures.arrowDown} to navigate</> : "Tab/Arrow keys to navigate";
    $[94] = questions.length;
    $[95] = t21;
  } else {
    t21 = $[95];
  }
  let t22;
// 编辑器提示只在「当前聚焦自定义输入项」且「确实探测到外部编辑器」时追加。三个条件缺一不可，否则会出现提示了却按不出反应的死路。
  if ($[96] !== isOtherFocused) {
    t22 = isOtherFocused && editorName && <> · ctrl+g to edit in {editorName}</>;
    $[96] = isOtherFocused;
    $[97] = t22;
  } else {
    t22 = $[97];
  }
  let t23;
// 最底部一行提示把三段可变内容拼在固定文案里：导航方式、编辑器提示、退出提示。三段各自可能为空，所以用字符串拼接而不是条件渲染节点，保证整行永远是一段连续文本、不会因为某段缺失而多出空格。
  if ($[98] !== t21 || $[99] !== t22) {
    t23 = <Box marginTop={1}><Text color="inactive" dimColor={true}>Enter to select ·{" "}{t21}{t22}{" "}· Esc to cancel</Text></Box>;
    $[98] = t21;
    $[99] = t22;
    $[100] = t23;
  } else {
    t23 = $[100];
  }
  let t24;
  if ($[101] !== minContentHeight || $[102] !== t12 || $[103] !== t20 || $[104] !== t23) {
    t24 = <Box flexDirection="column" minHeight={minContentHeight}>{t12}{t20}{t23}</Box>;
    $[101] = minContentHeight;
    $[102] = t12;
    $[103] = t20;
    $[104] = t23;
    $[105] = t24;
  } else {
    t24 = $[105];
  }
  let t25;
  if ($[106] !== t10 || $[107] !== t11 || $[108] !== t24) {
    t25 = <Box flexDirection="column" paddingTop={0}>{t10}{t11}{t24}</Box>;
    $[106] = t10;
    $[107] = t11;
    $[108] = t24;
    $[109] = t25;
  } else {
    t25 = $[109];
  }
  let t26;
  if ($[110] !== handleKeyDown || $[111] !== t25 || $[112] !== t8) {
// 根容器是键盘接管的落点：可聚焦、自动聚焦、并挂上底部行的键盘处理。它同时把三块内容按固定顺序装进来——计划条、偏移一格的分隔线、以及主体区块。那个负偏移的分隔线是为了抵消上一块的底部间距，属于纯视觉微调。
    t26 = <Box flexDirection="column" marginTop={0} tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>{t8}{t9}{t25}</Box>;
    $[110] = handleKeyDown;
    $[111] = t25;
    $[112] = t8;
    $[113] = t26;
  } else {
    t26 = $[113];
  }
  return t26;
}
// 这个过滤器只做一件事：把自定义输入的固定标记从多选结果里去掉。它被作为引用传给数组过滤，写成独立函数是为了让编译器能识别它是纯函数从而安全记忆化。
function _temp4(v) {
  return v !== "__other__";
}
function _temp3(opt_0) {
  return opt_0.preview;
}
// 文本选项映射：把题目的选项结构转成下拉框认识的文本项，标签与值都用选项标签本身。描述原样透传，因为下拉框会在行内展示它。
function _temp2(opt) {
  return {
    type: "text" as const,
    value: opt.label,
    label: opt.label,
    description: opt.description
  };
}
function _temp(s) {
  return s.toolPermissionContext.mode;
}
// 原文件此处有一行 42120 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。