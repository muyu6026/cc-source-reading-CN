import { c as _c } from "react/compiler-runtime";
// 导入 React 编译期缓存运行时
import React from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
// 导入分析元数据类型与事件上报函数
import { Box, Text } from '../../ink.js';
import { FeedbackSurveyView, isValidResponseInput } from './FeedbackSurveyView.js';
import type { TranscriptShareResponse } from './TranscriptSharePrompt.js';
import { TranscriptSharePrompt } from './TranscriptSharePrompt.js';
import { useDebouncedDigitInput } from './useDebouncedDigitInput.js';
import type { FeedbackSurveyResponse } from './utils.js';
type Props = {
// 组件属性：状态机状态、上次回复、选择回调等
  state: 'closed' | 'open' | 'thanks' | 'transcript_prompt' | 'submitting' | 'submitted';
  lastResponse: FeedbackSurveyResponse | null;
  handleSelect: (selected: FeedbackSurveyResponse) => void;
  handleTranscriptSelect?: (selected: TranscriptShareResponse) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
  onRequestFeedback?: () => void;
  message?: string;
};
export function FeedbackSurvey(t0) {
// 反馈调查主组件，按状态渲染不同界面
  const $ = _c(16);
// $ 为 React Compiler 注入的 memo 缓存数组
  const {
    state,
    lastResponse,
    handleSelect,
    handleTranscriptSelect,
    inputValue,
    setInputValue,
    onRequestFeedback,
    message
  } = t0;
  if (state === "closed") {
// 关闭状态不渲染任何内容
    return null;
  }
  if (state === "thanks") {
// 感谢态展示可继续反馈的提示
    let t1;
    if ($[0] !== inputValue || $[1] !== lastResponse || $[2] !== onRequestFeedback || $[3] !== setInputValue) {
      t1 = <FeedbackSurveyThanks lastResponse={lastResponse} inputValue={inputValue} setInputValue={setInputValue} onRequestFeedback={onRequestFeedback} />;
      $[0] = inputValue;
      $[1] = lastResponse;
      $[2] = onRequestFeedback;
      $[3] = setInputValue;
      $[4] = t1;
    } else {
      t1 = $[4];
    }
    return t1;
  }
  if (state === "submitted") {
// 已提交态显示分享成功
    let t1;
    if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Box marginTop={1}><Text color="success">{"\u2713"} Thanks for sharing your transcript!</Text></Box>;
      $[5] = t1;
    } else {
      t1 = $[5];
    }
    return t1;
  }
  if (state === "submitting") {
// 提交中态显示加载提示
    let t1;
    if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Box marginTop={1}><Text dimColor={true}>Sharing transcript{"\u2026"}</Text></Box>;
      $[6] = t1;
    } else {
      t1 = $[6];
    }
    return t1;
  }
  if (state === "transcript_prompt") {
// 转写分享提示态，校验输入合法性
    if (!handleTranscriptSelect) {
      return null;
    }
    if (inputValue && !["1", "2", "3"].includes(inputValue)) {
      return null;
    }
    let t1;
    if ($[7] !== handleTranscriptSelect || $[8] !== inputValue || $[9] !== setInputValue) {
      t1 = <TranscriptSharePrompt onSelect={handleTranscriptSelect} inputValue={inputValue} setInputValue={setInputValue} />;
      $[7] = handleTranscriptSelect;
      $[8] = inputValue;
      $[9] = setInputValue;
      $[10] = t1;
    } else {
      t1 = $[10];
    }
    return t1;
  }
  if (inputValue && !isValidResponseInput(inputValue)) {
// 非法数字输入不渲染
    return null;
  }
  let t1;
  if ($[11] !== handleSelect || $[12] !== inputValue || $[13] !== message || $[14] !== setInputValue) {
// 默认态渲染反馈问卷视图
    t1 = <FeedbackSurveyView onSelect={handleSelect} inputValue={inputValue} setInputValue={setInputValue} message={message} />;
    $[11] = handleSelect;
    $[12] = inputValue;
    $[13] = message;
    $[14] = setInputValue;
    $[15] = t1;
  } else {
    t1 = $[15];
  }
  return t1;
}
type ThanksProps = {
  lastResponse: FeedbackSurveyResponse | null;
  inputValue: string;
  setInputValue: (value: string) => void;
  onRequestFeedback?: () => void;
};
const isFollowUpDigit = (char: string): char is '1' => char === '1';
// 判断是否为关注跟进的数字 1
function FeedbackSurveyThanks(t0) {
// 感谢子组件，含可选的跟进追问
  const $ = _c(12);
  const {
    lastResponse,
    inputValue,
    setInputValue,
    onRequestFeedback
  } = t0;
  const showFollowUp = onRequestFeedback && lastResponse === "good";
// 仅当回复为 good 且提供回调时显示跟进
  const t1 = Boolean(showFollowUp);
  let t2;
  if ($[0] !== lastResponse || $[1] !== onRequestFeedback) {
    t2 = () => {
      logEvent("tengu_feedback_survey_event", {
// 上报跟进被接受的分析事件
        event_type: "followup_accepted" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        response: lastResponse as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      onRequestFeedback?.();
    };
    $[0] = lastResponse;
    $[1] = onRequestFeedback;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== inputValue || $[4] !== setInputValue || $[5] !== t1 || $[6] !== t2) {
    t3 = {
      inputValue,
      setInputValue,
      isValidDigit: isFollowUpDigit,
      enabled: t1,
      once: true,
      onDigit: t2
    };
    $[3] = inputValue;
    $[4] = setInputValue;
    $[5] = t1;
    $[6] = t2;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  useDebouncedDigitInput(t3);
// 注册数字输入监听用于跟进追问
  const feedbackCommand = false ? "/issue" : "/feedback";
  let t4;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Text color="success">Thanks for the feedback!</Text>;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let t5;
  if ($[9] !== lastResponse || $[10] !== showFollowUp) {
    t5 = <Box marginTop={1} flexDirection="column">{t4}{showFollowUp ? <Text dimColor={true}>(Optional) Press [<Text color="ansi:cyan">1</Text>] to tell us what went well {" \xB7 "}{feedbackCommand}</Text> : lastResponse === "bad" ? <Text dimColor={true}>Use /issue to report model behavior issues.</Text> : <Text dimColor={true}>Use {feedbackCommand} to share detailed feedback anytime.</Text>}</Box>;
// 反馈命令，恒为 /feedback
    $[9] = lastResponse;
    $[10] = showFollowUp;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  return t5;
}
// 原文件此处有一行 13816 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。