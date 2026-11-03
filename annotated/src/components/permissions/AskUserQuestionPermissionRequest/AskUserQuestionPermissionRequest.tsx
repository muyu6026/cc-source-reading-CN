// 本文件是「向用户提问」工具的权限请求界面：把模型发起的多问题访谈渲染成可导航的问答表单。三层结构——外层组件做语法高亮的懒加载分流（Suspense 加 use 挂起），Body 主体管理问题状态机与四种终点动作（提交回答、取消、向 Claude 回话、结束计划访谈），尾部是编译器提升的若干谓词小函数。React Compiler 产物特征：几乎每个分支都包进 memo 缓存 if 块（用 $ 数组下标判等），读时抓语句主干即可。
import { c as _c } from "react/compiler-runtime";
import type { Base64ImageSource, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import React, { Suspense, use, useCallback, useMemo, useRef, useState } from 'react';
import { useSettings } from '../../../hooks/useSettings.js';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { stringWidth } from '../../../ink/stringWidth.js';
import { useTheme } from '../../../ink.js';
import { useKeybindings } from '../../../keybindings/useKeybinding.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../../services/analytics/index.js';
import { useAppState } from '../../../state/AppState.js';
import type { Question } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import { AskUserQuestionTool } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import { type CliHighlight, getCliHighlightPromise } from '../../../utils/cliHighlight.js';
import type { PastedContent } from '../../../utils/config.js';
import type { ImageDimensions } from '../../../utils/imageResizer.js';
import { maybeResizeAndDownsampleImageBlock } from '../../../utils/imageResizer.js';
import { cacheImagePath, storeImage } from '../../../utils/imageStore.js';
import { logError } from '../../../utils/log.js';
import { applyMarkdown } from '../../../utils/markdown.js';
import { isPlanModeInterviewPhaseEnabled } from '../../../utils/planModeV2.js';
import { getPlanFilePath } from '../../../utils/plans.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { QuestionView } from './QuestionView.js';
import { SubmitQuestionsView } from './SubmitQuestionsView.js';
import { useMultipleChoiceState } from './use-multiple-choice-state.js';
// 三个尺寸常量定内容区下限：高度 12 行、宽度 40 列是任何终端都保得住的最小问答面板；CHROME_OVERHEAD 15 行预留给导航条、标题、页脚、帮助文案等外围 chrome，用终端总行数减掉它才是内容区可用高度。
const MIN_CONTENT_HEIGHT = 12;
const MIN_CONTENT_WIDTH = 40;
// Lines used by chrome around the content area (nav bar, title, footer, help text, etc.)
const CONTENT_CHROME_OVERHEAD = 15;
// 入口组件只做一件事：按是否启用语法高亮走两条渲染路径。关高亮直接渲染 Body 且 highlight 传 null；开高亮包 Suspense 挂起等待高亮模块就绪。两条路径各带 memo 缓存守卫，props 不变就复用上次结果。
export function AskUserQuestionPermissionRequest(props) {
  const $ = _c(4);
  const settings = useSettings();
// 关闭语法高亮（settings 显式声明）时跳过懒加载：直接渲染 Body，highlight 为 null，applyMarkdown 会按纯文本处理。
  if (settings.syntaxHighlightingDisabled) {
    let t0;
    if ($[0] !== props) {
      t0 = <AskUserQuestionPermissionRequestBody {...props} highlight={null} />;
      $[0] = props;
      $[1] = t0;
    } else {
      t0 = $[1];
    }
    return t0;
  }
// 开启高亮的路径：用 Suspense 包住带高亮的子组件，fallback 是无高亮版本——高亮模块加载完成前用户就能看到可交互的表单，不白等。
  let t0;
  if ($[2] !== props) {
    t0 = <Suspense fallback={<AskUserQuestionPermissionRequestBody {...props} highlight={null} />}><AskUserQuestionWithHighlight {...props} /></Suspense>;
    $[2] = props;
    $[3] = t0;
  } else {
    t0 = $[3];
  }
  return t0;
}
// 挂起点：React 19 的 use 钩子直接吃 Promise。getCliHighlightPromise 只在首次渲染时创建（sentinel 分支缓存），后续渲染复用同一 Promise；未就绪时组件在此挂起，由上层 Suspense 接管显示 fallback。
function AskUserQuestionWithHighlight(props) {
  const $ = _c(4);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = getCliHighlightPromise();
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const highlight = use(t0);
  let t1;
  if ($[1] !== highlight || $[2] !== props) {
    t1 = <AskUserQuestionPermissionRequestBody {...props} highlight={highlight} />;
    $[1] = highlight;
    $[2] = props;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  return t1;
}
// Body 主体，真正的状态机容器。_c(115) 分配 115 个 memo 缓存槽，是本文件最大的组件——输入解析、尺寸测量、图片粘贴、四种动作回调都在这里。编译器把每段派生计算包成「依赖判等再重算或取缓存」的样板，跳过 $ 判断直接看赋值语句即可。
function AskUserQuestionPermissionRequestBody(t0) {
  const $ = _c(115);
  const {
    toolUseConfirm,
    onDone,
    onReject,
    highlight
  } = t0;
  let t1;
// 输入解析：用工具自带的 zod schema 安全解析 toolUseConfirm 的 input；解析失败时 questions 退化为空数组——模型给的输入格式漂移也不会崩。
  if ($[0] !== toolUseConfirm.input) {
    t1 = AskUserQuestionTool.inputSchema.safeParse(toolUseConfirm.input);
    $[0] = toolUseConfirm.input;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const result = t1;
  let t2;
  if ($[2] !== result.data || $[3] !== result.success) {
    t2 = result.success ? result.data.questions || [] : [];
    $[2] = result.data;
    $[3] = result.success;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const questions = t2;
  const {
    rows: terminalRows
  } = useTerminalSize();
  const [theme] = useTheme();
// 尺寸测量：maxHeight 与 maxWidth 从 0 起跨所有问题取最大值，保证切换问题时面板不跳动；maxAllowedHeight 是终端行数减 chrome 开销的下限保护。
  let maxHeight = 0;
  let maxWidth = 0;
  const maxAllowedHeight = Math.max(MIN_CONTENT_HEIGHT, terminalRows - CONTENT_CHROME_OVERHEAD);
  if ($[5] !== highlight || $[6] !== maxAllowedHeight || $[7] !== maxHeight || $[8] !== maxWidth || $[9] !== questions || $[10] !== theme) {
// 逐问题测量：带预览的选项要渲染 markdown 预览框，走左右分栏高度公式（左列选项数加 2、右列预览框加 2 取大者再加 7 行 chrome）；无预览走简单公式（选项数加 3 加 7）。宽度取所有预览行 stringWidth 的最大值。
    for (const q of questions) {
      const hasPreview = q.options.some(_temp);
      if (hasPreview) {
        const maxPreviewContentLines = Math.max(1, maxAllowedHeight - 11);
        let maxPreviewBoxHeight = 0;
        for (const opt_0 of q.options) {
          if (opt_0.preview) {
            const rendered = applyMarkdown(opt_0.preview, theme, highlight);
            const previewLines = rendered.split("\n");
            const isTruncated = previewLines.length > maxPreviewContentLines;
            const displayedLines = isTruncated ? maxPreviewContentLines : previewLines.length;
            maxPreviewBoxHeight = Math.max(maxPreviewBoxHeight, displayedLines + (isTruncated ? 1 : 0) + 2);
            for (const line of previewLines) {
              maxWidth = Math.max(maxWidth, stringWidth(line));
            }
          }
        }
        const rightPanelHeight = maxPreviewBoxHeight + 2;
        const leftPanelHeight = q.options.length + 2;
        const sideByHeight = Math.max(leftPanelHeight, rightPanelHeight);
        maxHeight = Math.max(maxHeight, sideByHeight + 7);
      } else {
        maxHeight = Math.max(maxHeight, q.options.length + 3 + 7);
      }
    }
    $[5] = highlight;
    $[6] = maxAllowedHeight;
    $[7] = maxHeight;
    $[8] = maxWidth;
    $[9] = questions;
    $[10] = theme;
    $[11] = maxHeight;
  } else {
    maxHeight = $[11];
  }
// 最终 clamp：高度夹在最小值与 maxAllowedHeight 之间，宽度至少 40 列。测出的值作为全局内容区尺寸传给 QuestionView，让所有问题的布局基准一致。
  const t3 = Math.min(Math.max(maxHeight, MIN_CONTENT_HEIGHT), maxAllowedHeight);
  const t4 = Math.max(maxWidth, MIN_CONTENT_WIDTH);
  let t5;
  if ($[12] !== t3 || $[13] !== t4) {
    t5 = {
      globalContentHeight: t3,
      globalContentWidth: t4
    };
    $[12] = t3;
    $[13] = t4;
    $[14] = t5;
  } else {
    t5 = $[14];
  }
  const {
    globalContentHeight,
    globalContentWidth
  } = t5;
// metadataSource 是遥测来源标记（计划访谈、权限流程等）；只有带来源的问题集才上报分析事件，手动触发的提问不打点。
  const metadataSource = result.success ? result.data.metadata?.source : undefined;
  let t6;
  if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = {};
    $[15] = t6;
  } else {
    t6 = $[15];
  }
// 图片粘贴：pastedContentsByQuestion 以问题文本为键，存每个问题下粘贴的图片（id 到内容的映射）；nextPasteIdRef 用 ref 自增生成粘贴 id，避免 setState 竞态。
  const [pastedContentsByQuestion, setPastedContentsByQuestion] = useState(t6);
  const nextPasteIdRef = useRef(0);
  let t7;
  if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
// onImagePaste：构造 PastedContent（默认 png、默认文件名），先 cacheImagePath 加 storeImage 落盘，再按问题键合并进 state。整个函数被编译器缓存为单例（sentinel 分支），不随渲染重建。
    t7 = function onImagePaste(questionText, base64Image, mediaType, filename, dimensions, _sourcePath) {
      nextPasteIdRef.current = nextPasteIdRef.current + 1;
      const pasteId = nextPasteIdRef.current;
      const newContent = {
        id: pasteId,
        type: "image",
        content: base64Image,
        mediaType: mediaType || "image/png",
        filename: filename || "Pasted image",
        dimensions
      };
      cacheImagePath(newContent);
      storeImage(newContent);
      setPastedContentsByQuestion(prev => ({
        ...prev,
        [questionText]: {
          ...(prev[questionText] ?? {}),
          [pasteId]: newContent
        }
      }));
    };
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  const onImagePaste = t7;
  let t8;
  if ($[17] === Symbol.for("react.memo_cache_sentinel")) {
// onRemoveImage：按问题键删指定 id 的图片，其余键保持不动。
    t8 = (questionText_0, id) => {
      setPastedContentsByQuestion(prev_0 => {
        const questionContents = {
          ...(prev_0[questionText_0] ?? {})
        };
        delete questionContents[id];
        return {
          ...prev_0,
          [questionText_0]: questionContents
        };
      });
    };
    $[17] = t8;
  } else {
    t8 = $[17];
  }
  const onRemoveImage = t8;
  let t9;
  if ($[18] !== pastedContentsByQuestion) {
    t9 = Object.values(pastedContentsByQuestion).flatMap(_temp2).filter(_temp3);
    $[18] = pastedContentsByQuestion;
    $[19] = t9;
  } else {
    t9 = $[19];
  }
  const allImageAttachments = t9;
// 计划模式联动：useAppState 的 selector 读当前权限上下文模式；处于 plan 模式时这组问题被视为计划访谈的一环，会带上计划文件路径并启用专属的结束动作。
  const toolPermissionContextMode = useAppState(_temp4);
  const isInPlanMode = toolPermissionContextMode === "plan";
  let t10;
  if ($[20] !== isInPlanMode) {
    t10 = isInPlanMode ? getPlanFilePath() : undefined;
    $[20] = isInPlanMode;
    $[21] = t10;
  } else {
    t10 = $[21];
  }
  const planFilePath = t10;
// 多选状态机来自 useMultipleChoiceState：当前问题下标、答案表、每问题的文本输入状态、是否在文本输入模式，以及导航、更新、提交动作。currentQuestionIndex 等于问题数时进入提交确认视图。
  const state = useMultipleChoiceState();
  const {
    currentQuestionIndex,
    answers,
    questionStates,
    isInTextInput,
    nextQuestion,
    prevQuestion,
    updateQuestionState,
    setAnswer,
    setTextInputMode
  } = state;
  const currentQuestion = currentQuestionIndex < (questions?.length || 0) ? questions?.[currentQuestionIndex] : null;
  const isInSubmitView = currentQuestionIndex === (questions?.length || 0);
  let t11;
  if ($[22] !== answers || $[23] !== questions) {
    t11 = questions?.every(q_0 => q_0?.question && !!answers[q_0.question]) ?? false;
    $[22] = answers;
    $[23] = questions;
    $[24] = t11;
  } else {
    t11 = $[24];
  }
  const allQuestionsAnswered = t11;
  const hideSubmitTab = questions.length === 1 && !questions[0]?.multiSelect;
  let t12;
  if ($[25] !== isInPlanMode || $[26] !== metadataSource || $[27] !== onDone || $[28] !== onReject || $[29] !== questions.length || $[30] !== toolUseConfirm) {
// 终点一（取消）：三连动作——带来源时上报 rejected 事件（含是否计划访谈与访谈阶段开关）、onDone 关权限请求、toolUseConfirm 的 onReject 拒绝工具调用。注意 props 上的 onReject 与 toolUseConfirm.onReject 是两层。
    t12 = () => {
      if (metadataSource) {
        logEvent("tengu_ask_user_question_rejected", {
          source: metadataSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          questionCount: questions.length,
          isInPlanMode,
          interviewPhaseEnabled: isInPlanMode && isPlanModeInterviewPhaseEnabled()
        });
      }
      onDone();
      onReject();
      toolUseConfirm.onReject();
    };
    $[25] = isInPlanMode;
    $[26] = metadataSource;
    $[27] = onDone;
    $[28] = onReject;
    $[29] = questions.length;
    $[30] = toolUseConfirm;
    $[31] = t12;
  } else {
    t12 = $[31];
  }
  const handleCancel = t12;
  let t13;
  if ($[32] !== allImageAttachments || $[33] !== answers || $[34] !== isInPlanMode || $[35] !== metadataSource || $[36] !== onDone || $[37] !== questions || $[38] !== toolUseConfirm) {
// 终点二（向 Claude 回话）：不直接提交，而是把「用户想澄清」拼成反馈文本回传模型——逐问题列出问答对（未答的标注未提供答案），模板开头指示模型先问用户想澄清什么。图片附件转成 image block 一起回传；走 onReject 带反馈文本——拒绝工具调用但把上下文塞回去。
    t13 = async () => {
      const questionsWithAnswers = questions.map(q_1 => {
        const answer = answers[q_1.question];
        if (answer) {
          return `- "${q_1.question}"\n  Answer: ${answer}`;
        }
        return `- "${q_1.question}"\n  (No answer provided)`;
      }).join("\n");
      const feedback = `The user wants to clarify these questions.
    This means they may have additional information, context or questions for you.
    Take their response into account and then reformulate the questions if appropriate.
    Start by asking them what they would like to clarify.

    Questions asked:\n${questionsWithAnswers}`;
      if (metadataSource) {
        logEvent("tengu_ask_user_question_respond_to_claude", {
          source: metadataSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          questionCount: questions.length,
          isInPlanMode,
          interviewPhaseEnabled: isInPlanMode && isPlanModeInterviewPhaseEnabled()
        });
      }
      const imageBlocks = await convertImagesToBlocks(allImageAttachments);
      onDone();
      toolUseConfirm.onReject(feedback, imageBlocks && imageBlocks.length > 0 ? imageBlocks : undefined);
    };
    $[32] = allImageAttachments;
    $[33] = answers;
    $[34] = isInPlanMode;
    $[35] = metadataSource;
    $[36] = onDone;
    $[37] = questions;
    $[38] = toolUseConfirm;
    $[39] = t13;
  } else {
    t13 = $[39];
  }
  const handleRespondToClaude = t13;
  let t14;
  if ($[40] !== allImageAttachments || $[41] !== answers || $[42] !== isInPlanMode || $[43] !== metadataSource || $[44] !== onDone || $[45] !== questions || $[46] !== toolUseConfirm) {
// 终点三（结束计划访谈）：仅计划访谈场景——反馈文本换成「用户已答够，停止追问，用现有信息完成计划」，同样走 onReject 携带问答对回传。
    t14 = async () => {
      const questionsWithAnswers_0 = questions.map(q_2 => {
        const answer_0 = answers[q_2.question];
        if (answer_0) {
          return `- "${q_2.question}"\n  Answer: ${answer_0}`;
        }
        return `- "${q_2.question}"\n  (No answer provided)`;
      }).join("\n");
      const feedback_0 = `The user has indicated they have provided enough answers for the plan interview.
Stop asking clarifying questions and proceed to finish the plan with the information you have.

Questions asked and answers provided:\n${questionsWithAnswers_0}`;
      if (metadataSource) {
        logEvent("tengu_ask_user_question_finish_plan_interview", {
          source: metadataSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          questionCount: questions.length,
          isInPlanMode,
          interviewPhaseEnabled: isInPlanMode && isPlanModeInterviewPhaseEnabled()
        });
      }
      const imageBlocks_0 = await convertImagesToBlocks(allImageAttachments);
      onDone();
      toolUseConfirm.onReject(feedback_0, imageBlocks_0 && imageBlocks_0.length > 0 ? imageBlocks_0 : undefined);
    };
    $[40] = allImageAttachments;
    $[41] = answers;
    $[42] = isInPlanMode;
    $[43] = metadataSource;
    $[44] = onDone;
    $[45] = questions;
    $[46] = toolUseConfirm;
    $[47] = t14;
  } else {
    t14 = $[47];
  }
  const handleFinishPlanInterview = t14;
  let t15;
  if ($[48] !== allImageAttachments || $[49] !== isInPlanMode || $[50] !== metadataSource || $[51] !== onDone || $[52] !== questionStates || $[53] !== questions || $[54] !== toolUseConfirm) {
// 终点四（提交回答）：核心提交路径——答案表塞进 updatedInput 的 answers；带预览或文本备注的问答进 annotations；图片转 contentBlocks；最后 onAllow 提交更新后的输入。
    t15 = async answersToSubmit => {
      if (metadataSource) {
        logEvent("tengu_ask_user_question_accepted", {
          source: metadataSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          questionCount: questions.length,
          answerCount: Object.keys(answersToSubmit).length,
          isInPlanMode,
          interviewPhaseEnabled: isInPlanMode && isPlanModeInterviewPhaseEnabled()
        });
      }
// annotations 只收集有增量信息的问题：选了带预览的选项、或在文本框写了备注——两者都空就不进表，避免给模型发空对象。
      const annotations = {};
      for (const q_3 of questions) {
        const answer_1 = answersToSubmit[q_3.question];
        const notes = questionStates[q_3.question]?.textInputValue;
        const selectedOption = answer_1 ? q_3.options.find(opt_1 => opt_1.label === answer_1) : undefined;
        const preview = selectedOption?.preview;
        if (preview || notes?.trim()) {
          annotations[q_3.question] = {
            ...(preview && {
              preview
            }),
            ...(notes?.trim() && {
              notes: notes.trim()
            })
          };
        }
      }
      const updatedInput = {
        ...toolUseConfirm.input,
        answers: answersToSubmit,
        ...(Object.keys(annotations).length > 0 && {
          annotations
        })
      };
      const contentBlocks = await convertImagesToBlocks(allImageAttachments);
      onDone();
      toolUseConfirm.onAllow(updatedInput, [], undefined, contentBlocks && contentBlocks.length > 0 ? contentBlocks : undefined);
    };
    $[48] = allImageAttachments;
    $[49] = isInPlanMode;
    $[50] = metadataSource;
    $[51] = onDone;
    $[52] = questionStates;
    $[53] = questions;
    $[54] = toolUseConfirm;
    $[55] = t15;
  } else {
    t15 = $[55];
  }
  const submitAnswers = t15;
  let t16;
  if ($[56] !== answers || $[57] !== pastedContentsByQuestion || $[58] !== questions.length || $[59] !== setAnswer || $[60] !== submitAnswers) {
// QuestionView 的 onAnswer 汇聚点：多选时把标签数组 join 成逗号串；文本输入时若有粘贴图片就在答案尾部追加「已附图」标注；哨兵值 __other__ 且只贴了图时答案整个替换为「已附图」。
    t16 = (questionText_1, label, textInput, t17) => {
      const shouldAdvance = t17 === undefined ? true : t17;
      let answer_2;
      const isMultiSelect = Array.isArray(label);
      if (isMultiSelect) {
        answer_2 = label.join(", ");
      } else {
        if (textInput) {
          const questionImages = Object.values(pastedContentsByQuestion[questionText_1] ?? {}).filter(_temp5);
          answer_2 = questionImages.length > 0 ? `${textInput} (Image attached)` : textInput;
        } else {
          if (label === "__other__") {
            const questionImages_0 = Object.values(pastedContentsByQuestion[questionText_1] ?? {}).filter(_temp6);
            answer_2 = questionImages_0.length > 0 ? "(Image attached)" : label;
          } else {
            answer_2 = label;
          }
        }
      }
      const isSingleQuestion = questions.length === 1;
      if (!isMultiSelect && isSingleQuestion && shouldAdvance) {
        const updatedAnswers = {
          ...answers,
          [questionText_1]: answer_2
        };
        submitAnswers(updatedAnswers).catch(logError);
        return;
      }
      setAnswer(questionText_1, answer_2, shouldAdvance);
    };
    $[56] = answers;
    $[57] = pastedContentsByQuestion;
    $[58] = questions.length;
    $[59] = setAnswer;
    $[60] = submitAnswers;
    $[61] = t16;
  } else {
    t16 = $[61];
  }
  const handleQuestionAnswer = t16;
  let t17;
  if ($[62] !== answers || $[63] !== handleCancel || $[64] !== submitAnswers) {
// 提交视图的最终分派：cancel 走 handleCancel，submit 用当前答案表调 submitAnswers——提交视图不再改答案，只做确认。
    t17 = function handleFinalResponse(value) {
      if (value === "cancel") {
        handleCancel();
        return;
      }
      if (value === "submit") {
        submitAnswers(answers).catch(logError);
      }
    };
    $[62] = answers;
    $[63] = handleCancel;
    $[64] = submitAnswers;
    $[65] = t17;
  } else {
    t17 = $[65];
  }
  const handleFinalResponse = t17;
// maxIndex 决定页签导航上界：单问题且非多选时隐藏提交页签，上界是最后一个问题；否则允许走到提交页（下标等于问题数）。
  const maxIndex = hideSubmitTab ? (questions?.length || 1) - 1 : questions?.length || 0;
  let t18;
  if ($[66] !== currentQuestionIndex || $[67] !== prevQuestion) {
    t18 = () => {
      if (currentQuestionIndex > 0) {
        prevQuestion();
      }
    };
    $[66] = currentQuestionIndex;
    $[67] = prevQuestion;
    $[68] = t18;
  } else {
    t18 = $[68];
  }
  const handleTabPrev = t18;
  let t19;
  if ($[69] !== currentQuestionIndex || $[70] !== maxIndex || $[71] !== nextQuestion) {
    t19 = () => {
      if (currentQuestionIndex < maxIndex) {
        nextQuestion();
      }
    };
    $[69] = currentQuestionIndex;
    $[70] = maxIndex;
    $[71] = nextQuestion;
    $[72] = t19;
  } else {
    t19 = $[72];
  }
  const handleTabNext = t19;
  let t20;
// Tab 键位：tabs:previous 与 tabs:next 分派到状态机的 prev 与 next，各自带下标边界检查。
  if ($[73] !== handleTabNext || $[74] !== handleTabPrev) {
    t20 = {
      "tabs:previous": handleTabPrev,
      "tabs:next": handleTabNext
    };
    $[73] = handleTabNext;
    $[74] = handleTabPrev;
    $[75] = t20;
  } else {
    t20 = $[75];
  }
// 文本输入聚焦且不在提交视图时禁用 Tab 导航——否则在文本框里按 Tab 或 Shift-Tab 会跳问题丢焦点。
  const t21 = !(isInTextInput && !isInSubmitView);
  let t22;
  if ($[76] !== t21) {
    t22 = {
      context: "Tabs",
      isActive: t21
    };
    $[76] = t21;
    $[77] = t22;
  } else {
    t22 = $[77];
  }
  useKeybindings(t20, t22);
// 渲染分派一：当前问题存在则渲染 QuestionView，把尺寸预算、答案、状态、四个动作回调和图片粘贴三件套全部下传。onSubmit 传的是 nextQuestion——单问题非多选时 answer 回调里已直接提交，多问题的「下一个」由 Enter 触发。
  if (currentQuestion) {
    let t23;
    if ($[78] !== currentQuestion.question) {
      t23 = (base64, mediaType_0, filename_0, dims, path) => onImagePaste(currentQuestion.question, base64, mediaType_0, filename_0, dims, path);
      $[78] = currentQuestion.question;
      $[79] = t23;
    } else {
      t23 = $[79];
    }
    let t24;
    if ($[80] !== currentQuestion.question || $[81] !== pastedContentsByQuestion) {
      t24 = pastedContentsByQuestion[currentQuestion.question] ?? {};
      $[80] = currentQuestion.question;
      $[81] = pastedContentsByQuestion;
      $[82] = t24;
    } else {
      t24 = $[82];
    }
    let t25;
    if ($[83] !== currentQuestion.question) {
      t25 = id_0 => onRemoveImage(currentQuestion.question, id_0);
      $[83] = currentQuestion.question;
      $[84] = t25;
    } else {
      t25 = $[84];
    }
    let t26;
    if ($[85] !== answers || $[86] !== currentQuestion || $[87] !== currentQuestionIndex || $[88] !== globalContentHeight || $[89] !== globalContentWidth || $[90] !== handleCancel || $[91] !== handleFinishPlanInterview || $[92] !== handleQuestionAnswer || $[93] !== handleRespondToClaude || $[94] !== handleTabNext || $[95] !== handleTabPrev || $[96] !== hideSubmitTab || $[97] !== nextQuestion || $[98] !== planFilePath || $[99] !== questionStates || $[100] !== questions || $[101] !== setTextInputMode || $[102] !== t23 || $[103] !== t24 || $[104] !== t25 || $[105] !== updateQuestionState) {
      t26 = <><QuestionView question={currentQuestion} questions={questions} currentQuestionIndex={currentQuestionIndex} answers={answers} questionStates={questionStates} hideSubmitTab={hideSubmitTab} minContentHeight={globalContentHeight} minContentWidth={globalContentWidth} planFilePath={planFilePath} onUpdateQuestionState={updateQuestionState} onAnswer={handleQuestionAnswer} onTextInputFocus={setTextInputMode} onCancel={handleCancel} onSubmit={nextQuestion} onTabPrev={handleTabPrev} onTabNext={handleTabNext} onRespondToClaude={handleRespondToClaude} onFinishPlanInterview={handleFinishPlanInterview} onImagePaste={t23} pastedContents={t24} onRemoveImage={t25} /></>;
      $[85] = answers;
      $[86] = currentQuestion;
      $[87] = currentQuestionIndex;
      $[88] = globalContentHeight;
      $[89] = globalContentWidth;
      $[90] = handleCancel;
      $[91] = handleFinishPlanInterview;
      $[92] = handleQuestionAnswer;
      $[93] = handleRespondToClaude;
      $[94] = handleTabNext;
      $[95] = handleTabPrev;
      $[96] = hideSubmitTab;
      $[97] = nextQuestion;
      $[98] = planFilePath;
      $[99] = questionStates;
      $[100] = questions;
      $[101] = setTextInputMode;
      $[102] = t23;
      $[103] = t24;
      $[104] = t25;
      $[105] = updateQuestionState;
      $[106] = t26;
    } else {
      t26 = $[106];
    }
    return t26;
  }
// 渲染分派二：全部问题答完进入提交视图，渲染 SubmitQuestionsView 做总览确认；permissionResult 透传用于显示权限信息。
  if (isInSubmitView) {
    let t23;
    if ($[107] !== allQuestionsAnswered || $[108] !== answers || $[109] !== currentQuestionIndex || $[110] !== globalContentHeight || $[111] !== handleFinalResponse || $[112] !== questions || $[113] !== toolUseConfirm.permissionResult) {
      t23 = <><SubmitQuestionsView questions={questions} currentQuestionIndex={currentQuestionIndex} answers={answers} allQuestionsAnswered={allQuestionsAnswered} permissionResult={toolUseConfirm.permissionResult} minContentHeight={globalContentHeight} onFinalResponse={handleFinalResponse} /></>;
      $[107] = allQuestionsAnswered;
      $[108] = answers;
      $[109] = currentQuestionIndex;
      $[110] = globalContentHeight;
      $[111] = handleFinalResponse;
      $[112] = questions;
      $[113] = toolUseConfirm.permissionResult;
      $[114] = t23;
    } else {
      t23 = $[114];
    }
    return t23;
  }
  return null;
}
// 编译器提升的谓词群：六个全是单行判断——三份同构的图片类型过滤、权限模式读取、展平粘贴内容、判定选项有无预览。按语义对应回 Body 里的调用点读。
function _temp6(c_1) {
  return c_1.type === "image";
}
function _temp5(c_0) {
  return c_0.type === "image";
}
function _temp4(s) {
  return s.toolPermissionContext.mode;
}
function _temp3(c) {
  return c.type === "image";
}
function _temp2(contents) {
  return Object.values(contents);
}
function _temp(opt) {
  return opt.preview;
}
// 图片转 block：把 PastedContent 数组逐个构造成 Anthropic API 的 image block（base64 源），每个都过一遍缩放与降采样再返回；空数组直接返回 undefined，让调用方省掉空参数分支。
async function convertImagesToBlocks(images: PastedContent[]): Promise<ImageBlockParam[] | undefined> {
  if (images.length === 0) return undefined;
  return Promise.all(images.map(async img => {
    const block: ImageBlockParam = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: (img.mediaType || 'image/png') as Base64ImageSource['media_type'],
        data: img.content
      }
    };
    const resized = await maybeResizeAndDownsampleImageBlock(block);
    return resized.block;
  }));
}
// 原文件此处有一行 59576 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。