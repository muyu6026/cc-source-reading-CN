import { useCallback, useReducer } from 'react'
// 引入 useCallback 与 useReducer 两个 hooks

export type AnswerValue = string
// 单题答案类型，可为单选字符串或多选数组

export type QuestionState = {
// 每题的 UI 状态：选中值与文本输入值
  selectedValue?: string | string[]
  textInputValue: string
}

type State = {
// reducer 全局状态：当前题号、答案表、各题状态、是否文本输入
  currentQuestionIndex: number
  answers: Record<string, AnswerValue>
  questionStates: Record<string, QuestionState>
  isInTextInput: boolean
}

type Action =
  | { type: 'next-question' }
  | { type: 'prev-question' }
  | {
      type: 'update-question-state'
      questionText: string
      updates: Partial<QuestionState>
      isMultiSelect: boolean
    }
  | {
      type: 'set-answer'
      questionText: string
      answer: string
      shouldAdvance: boolean
    }
  | { type: 'set-text-input-mode'; isInInput: boolean }

// 所有可派发的动作联合类型
function reducer(state: State, action: Action): State {
// 纯函数 reducer，按动作类型更新状态
  switch (action.type) {
    case 'next-question':
// 下一题：题号加一并退出文本输入
      return {
        ...state,
        currentQuestionIndex: state.currentQuestionIndex + 1,
        isInTextInput: false,
      }

    case 'prev-question':
// 上一题：题号不小于 0
      return {
        ...state,
        currentQuestionIndex: Math.max(0, state.currentQuestionIndex - 1),
        isInTextInput: false,
      }

    case 'update-question-state': {
// 局部更新某题的选中值或文本输入
      const existing = state.questionStates[action.questionText]
      const newState: QuestionState = {
        selectedValue:
          action.updates.selectedValue ??
          existing?.selectedValue ??
          (action.isMultiSelect ? [] : undefined),
        textInputValue:
          action.updates.textInputValue ?? existing?.textInputValue ?? '',
      }

      return {
        ...state,
        questionStates: {
          ...state.questionStates,
          [action.questionText]: newState,
        },
      }
    }

    case 'set-answer': {
// 记录答案，按需自动跳到下一题
      const newState = {
        ...state,
        answers: {
          ...state.answers,
          [action.questionText]: action.answer,
        },
      }

      if (action.shouldAdvance) {
        return {
          ...newState,
          currentQuestionIndex: newState.currentQuestionIndex + 1,
          isInTextInput: false,
        }
      }

      return newState
    }

    case 'set-text-input-mode':
// 切换是否处于文本输入模式
      return {
        ...state,
        isInTextInput: action.isInInput,
      }
  }
}

const INITIAL_STATE: State = {
// 初始状态，从第一题开始
  currentQuestionIndex: 0,
  answers: {},
  questionStates: {},
  isInTextInput: false,
}

export type MultipleChoiceState = {
// 对外暴露的 hook 状态与操作方法类型
  currentQuestionIndex: number
  answers: Record<string, AnswerValue>
  questionStates: Record<string, QuestionState>
  isInTextInput: boolean
  nextQuestion: () => void
  prevQuestion: () => void
  updateQuestionState: (
    questionText: string,
    updates: Partial<QuestionState>,
    isMultiSelect: boolean,
  ) => void
  setAnswer: (
    questionText: string,
    answer: string,
    shouldAdvance?: boolean,
  ) => void
  setTextInputMode: (isInInput: boolean) => void
}

export function useMultipleChoiceState(): MultipleChoiceState {
// 多选问答状态管理 hook
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
// 用 useReducer 管理问答状态

  const nextQuestion = useCallback(() => {
// 封装 dispatch 为 nextQuestion 回调
    dispatch({ type: 'next-question' })
  }, [])

  const prevQuestion = useCallback(() => {
    dispatch({ type: 'prev-question' })
  }, [])

  const updateQuestionState = useCallback(
// 封装 updateQuestionState 回调，更新单题状态
    (
      questionText: string,
      updates: Partial<QuestionState>,
      isMultiSelect: boolean,
    ) => {
      dispatch({
        type: 'update-question-state',
        questionText,
        updates,
        isMultiSelect,
      })
    },
    [],
  )

  const setAnswer = useCallback(
// 封装 setAnswer，默认在作答后前进
    (questionText: string, answer: string, shouldAdvance: boolean = true) => {
      dispatch({
        type: 'set-answer',
        questionText,
        answer,
        shouldAdvance,
      })
    },
    [],
  )

  const setTextInputMode = useCallback((isInInput: boolean) => {
// 封装 setTextInputMode 回调
    dispatch({ type: 'set-text-input-mode', isInInput })
  }, [])

  return {
// 返回全部状态与操作方法
    currentQuestionIndex: state.currentQuestionIndex,
    answers: state.answers,
    questionStates: state.questionStates,
    isInTextInput: state.isInTextInput,
    nextQuestion,
    prevQuestion,
    updateQuestionState,
    setAnswer,
    setTextInputMode,
  }
}
