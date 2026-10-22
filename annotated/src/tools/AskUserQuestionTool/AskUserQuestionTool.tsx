import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import * as React from 'react';
import { getAllowedChannels, getQuestionPreviewFormat } from 'src/bootstrap/state.js';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { BLACK_CIRCLE } from 'src/constants/figures.js';
import { getModeColor } from 'src/utils/permissions/PermissionMode.js';
import { z } from 'zod/v4';
import { Box, Text } from '../../ink.js';
import type { Tool } from '../../Tool.js';
import { buildTool, type ToolDef } from '../../Tool.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { ASK_USER_QUESTION_TOOL_CHIP_WIDTH, ASK_USER_QUESTION_TOOL_NAME, ASK_USER_QUESTION_TOOL_PROMPT, DESCRIPTION, PREVIEW_FEATURE_PROMPT } from './prompt.js';
const questionOptionSchema = lazySchema(() => z.object({
  label: z.string().describe('The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.'),
  description: z.string().describe('Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.'),
  preview: z.string().optional().describe('Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options. See the tool description for the expected content format.')
}));
// 单个选项的 schema：label 是展示文本（建议 1-5 个词）、description 解释含义与代价、
// preview 是可选的「聚焦预览」内容（mockup / 代码片段），供用户横向对比方案用。
const questionSchema = lazySchema(() => z.object({
  question: z.string().describe('The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"'),
  header: z.string().describe(`Very short label displayed as a chip/tag (max ${ASK_USER_QUESTION_TOOL_CHIP_WIDTH} chars). Examples: "Auth method", "Library", "Approach".`),
  options: z.array(questionOptionSchema()).min(2).max(4).describe(`The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no 'Other' option, that will be provided automatically.`),
  multiSelect: z.boolean().default(false).describe('Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.')
}));
// 单个问题的 schema：question 完整问句、header 是 chip 标签（限 12 字符）、
// options 强制 2-4 个且互斥（multiSelect 除外）、multiSelect 控制是否可多选。
const annotationsSchema = lazySchema(() => {
  const annotationSchema = z.object({
    preview: z.string().optional().describe('The preview content of the selected option, if the question used previews.'),
    notes: z.string().optional().describe('Free-text notes the user added to their selection.')
  });
  return z.record(z.string(), annotationSchema).optional().describe('Optional per-question annotations from the user (e.g., notes on preview selections). Keyed by question text.');
});
// annotations schema：用户在选项之外附加的自由笔记与所选预览内容，
// 按问题文本为键的 record，可选。这些信息会随工具结果回传给模型。
const UNIQUENESS_REFINE = {
  check: (data: {
    questions: {
      question: string;
      options: {
        label: string;
      }[];
    }[];
  }) => {
    const questions = data.questions.map(q => q.question);
    if (questions.length !== new Set(questions).size) {
      return false;
    }
    for (const question of data.questions) {
      const labels = question.options.map(opt => opt.label);
      if (labels.length !== new Set(labels).size) {
        return false;
      }
    }
    return true;
  },
  message: 'Question texts must be unique, option labels must be unique within each question'
} as const;
// UNIQUENESS_REFINE：去重校验器——问题文本不得重复，同一问题内选项 label 不得重复。
// 用 Set 尺寸对比实现 O(n) 判重，配合下面的 .refine() 挂到 inputSchema 上。
const commonFields = lazySchema(() => ({
  answers: z.record(z.string(), z.string()).optional().describe('User answers collected by the permission component'),
  annotations: annotationsSchema(),
  metadata: z.object({
    source: z.string().optional().describe('Optional identifier for the source of this question (e.g., "remember" for /remember command). Used for analytics tracking.')
  }).optional().describe('Optional metadata for tracking and analytics purposes. Not displayed to user.')
}));
// commonFields：输入输出共用字段。answers 是权限组件（交互 UI）收集到的用户答案；
// metadata.source 仅用于埋点（如 /remember 命令来源），不展示给用户。
const inputSchema = lazySchema(() => z.strictObject({
  questions: z.array(questionSchema()).min(1).max(4).describe('Questions to ask the user (1-4 questions)'),
  ...commonFields()
}).refine(UNIQUENESS_REFINE.check, {
  message: UNIQUENESS_REFINE.message
}));
// inputSchema：1-4 个问题 + 共用字段，strictObject 拒绝多余键；
// .refine(UNIQUENESS_REFINE.check) 在 schema 层面强制问题与选项去重。
type InputSchema = ReturnType<typeof inputSchema>;
const outputSchema = lazySchema(() => z.object({
  questions: z.array(questionSchema()).describe('The questions that were asked'),
  answers: z.record(z.string(), z.string()).describe('The answers provided by the user (question text -> answer string; multi-select answers are comma-separated)'),
  annotations: annotationsSchema()
}));
type OutputSchema = ReturnType<typeof outputSchema>;
// outputSchema：回传「问题 + 答案 + 注释」。答案是 question 文本 → answer 字符串的
// record，多选时用逗号拼接。这是模型在后续轮次里读到的数据形状。

// SDK schemas are identical to internal schemas now that `preview` and
// `annotations` are public (configurable via `toolConfig.askUserQuestion`).
export const _sdkInputSchema = inputSchema;
export const _sdkOutputSchema = outputSchema;
// SDK schema 直接复用内部 schema：preview 与 annotations 已公开
// （可通过 toolConfig.askUserQuestion 配置），内外形状一致，无需镜像维护。
export type Question = z.infer<ReturnType<typeof questionSchema>>;
export type QuestionOption = z.infer<ReturnType<typeof questionOptionSchema>>;
export type Output = z.infer<OutputSchema>;
// 导出类型别名，供权限组件与 UI 复用。
function AskUserQuestionResultMessage(t0) {
  const $ = _c(3);
  const {
    answers
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Box flexDirection="row"><Text color={getModeColor("default")}>{BLACK_CIRCLE} </Text><Text>User answered Claude's questions:</Text></Box>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
// React Compiler 编译产物：$ 是 memo 槽数组，Symbol.for("react.memo_cache_sentinel")
// 是首哨兵。$[0] 只算一次静态 JSX；$[1] 依赖 answers 变化才重算列表。
  let t2;
  if ($[1] !== answers) {
    t2 = <Box flexDirection="column" marginTop={1}>{t1}<MessageResponse><Box flexDirection="column">{Object.entries(answers).map(_temp)}</Box></MessageResponse></Box>;
    $[1] = answers;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  return t2;
}
function _temp(t0) {
  const [questionText, answer] = t0;
  return <Text key={questionText} color="inactive">· {questionText} → {answer}</Text>;
}
// _temp：单条答案渲染「· 问题 → 答案」，用问题文本作 key。
export const AskUserQuestionTool: Tool<InputSchema, Output> = buildTool({
  name: ASK_USER_QUESTION_TOOL_NAME,
  searchHint: 'prompt the user with a multiple-choice question',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
// 工具定义入口。searchHint 供工具搜索排序；maxResultSizeChars 10 万上限；
// shouldDefer: true 表示该工具可被「延迟执行」机制推迟到批次末尾（先跑完非交互工具再问）。
  async description() {
    return DESCRIPTION;
  },
  async prompt() {
    const format = getQuestionPreviewFormat();
    if (format === undefined) {
      // SDK consumer that hasn't opted into a preview format — omit preview
      // guidance (they may not render the field at all).
      return ASK_USER_QUESTION_TOOL_PROMPT;
    }
    return ASK_USER_QUESTION_TOOL_PROMPT + PREVIEW_FEATURE_PROMPT[format];
  },
// prompt() 按预览格式拼接提示词：SDK 消费方没启用 preview（format 为 undefined）
// 时不注入 preview 说明——对方可能根本不渲染这个字段；启用了才追加对应格式的指引。
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName() {
    return '';
  },
  isEnabled() {
    // When --channels is active the user is likely on Telegram/Discord, not
    // watching the TUI. The multiple-choice dialog would hang with nobody at
    // the keyboard. Channel permission relay already skips
    // requiresUserInteraction() tools (interactiveHandler.ts) so there's
    // no alternate approval path.
    if ((feature('KAIROS') || feature('KAIROS_CHANNELS')) && getAllowedChannels().length > 0) {
      return false;
    }
    return true;
// isEnabled：--channels 模式下用户在 Telegram/Discord 上而非终端前，
// 多选对话框会永远挂着没人答，所以直接禁用；频道权限中继也不会给它备用审批路径。
  },
  isConcurrencySafe() {
    return true;
  },
  isReadOnly() {
    return true;
  },
  toAutoClassifierInput(input) {
    return input.questions.map(q => q.question).join(' | ');
  },
  requiresUserInteraction() {
    return true;
  },
// requiresUserInteraction: true——这是「必须有人在场」的工具，
// 交互式审批（权限弹窗）由此标记接管，也用于上文 channels 场景的跳过判断。
  async validateInput({
    questions
  }) {
    if (getQuestionPreviewFormat() !== 'html') {
      return {
        result: true
      };
    }
    for (const q of questions) {
      for (const opt of q.options) {
        const err = validateHtmlPreview(opt.preview);
        if (err) {
          return {
            result: false,
            message: `Option "${opt.label}" in question "${q.question}": ${err}`,
            errorCode: 1
          };
        }
      }
    }
    return {
      result: true
    };
  },
// validateInput：仅当 preview 格式是 html 时逐个校验选项的 preview 片段，
// 违规（错误码 1）直接打回并指明是哪个问题哪个选项。markdown 格式无需校验。
  async checkPermissions(input) {
    return {
      behavior: 'ask' as const,
      message: 'Answer questions?',
      updatedInput: input
    };
  },
// checkPermissions 恒为 ask：这个工具的全部意义就是弹出交互组件让用户作答，
// updatedInput 原样透传，由权限层渲染问题界面并回填 answers。
  renderToolUseMessage() {
    return null;
  },
  renderToolUseProgressMessage() {
    return null;
  },
  renderToolResultMessage({
    answers
  }, _toolUseID) {
    return <AskUserQuestionResultMessage answers={answers} />;
  },
  renderToolUseRejectedMessage() {
    return <Box flexDirection="row" marginTop={1}>
        <Text color={getModeColor('default')}>{BLACK_CIRCLE}&nbsp;</Text>
        <Text>User declined to answer questions</Text>
      </Box>;
  },
// 被拒时渲染「用户拒绝回答」一行；use/error/progress 渲染均为 null——
// 这个工具没有中间态，答案直接出现在结果里。
  renderToolUseErrorMessage() {
    return null;
  },
  async call({
    questions,
    answers = {},
    annotations
  }, _context) {
    return {
      data: {
        questions,
        answers,
        ...(annotations && {
          annotations
        })
      }
    };
  },
// call() 本身不问任何人：answers 在权限交互阶段已被收集进 input，
// 这里只是把 questions/answers/annotations 原样打包成工具结果。
  mapToolResultToToolResultBlockParam({
    answers,
    annotations
  }, toolUseID) {
    const answersText = Object.entries(answers).map(([questionText, answer]) => {
      const annotation = annotations?.[questionText];
      const parts = [`"${questionText}"="${answer}"`];
      if (annotation?.preview) {
        parts.push(`selected preview:\n${annotation.preview}`);
      }
      if (annotation?.notes) {
        parts.push(`user notes: ${annotation.notes}`);
      }
      return parts.join(' ');
    }).join(', ');
    return {
      type: 'tool_result',
      content: `User has answered your questions: ${answersText}. You can now continue with the user's answers in mind.`,
      tool_use_id: toolUseID
    };
  }
// mapToolResultToToolResultBlockParam：把答案压成一行文本回给模型——
// 每条为「"问题"="答案"」，注释了 preview / notes 的追加在后面，整体逗号分隔。
} satisfies ToolDef<InputSchema, Output>);

// Lightweight HTML fragment check. Not a parser — HTML5 parsers are
// error-recovering by spec and accept anything. We're checking model intent
// (did it emit HTML?) and catching the specific things we told it not to do.
// validateHtmlPreview 是轻量正则检查而非 HTML 解析器：HTML5 解析器按规范
// 容错一切输入，这里只验证「模型是否真发了 HTML」以及是否违反了我们明令禁止的事。
function validateHtmlPreview(preview: string | undefined): string | null {
  if (preview === undefined) return null;
  if (/<\s*(html|body|!doctype)\b/i.test(preview)) {
    return 'preview must be an HTML fragment, not a full document (no <html>, <body>, or <!DOCTYPE>)';
  }
  // SDK consumers typically set this via innerHTML — disallow executable/style
  // tags so a preview can't run code or restyle the host page. Inline event
  // handlers (onclick etc.) are still possible; consumers should sanitize.
  if (/<\s*(script|style)\b/i.test(preview)) {
    return 'preview must not contain <script> or <style> tags. Use inline styles via the style attribute if needed.';
  }
  if (!/<[a-z][^>]*>/i.test(preview)) {
    return 'preview must contain HTML (previewFormat is set to "html"). Wrap content in a tag like <div> or <pre>.';
  }
  return null;
}
// 三条硬规则：① 禁止完整文档（<html>/<body>/<!DOCTYPE>）；② 禁止 <script>/<style>
// （SDK 消费方常用 innerHTML 注入，防止执行代码或改样式；内联 onclick 仍可能，需消费方自行消毒）；
// ③ 必须真的包含 HTML 标签（既然声明了 html 格式就要有标签）。
// 原文件此处有一行 29100 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。