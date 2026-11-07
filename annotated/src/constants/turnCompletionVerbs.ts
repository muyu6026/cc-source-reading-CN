// 本文件导出一轮对话结束时要使用的「过去式动词」列表，
// 用于拼接类似「Worked for 5s」这样的回合完成提示语。
// Past tense verbs for turn completion messages
// These verbs work naturally with "for [duration]" (e.g., "Worked for 5s")
export const TURN_COMPLETION_VERBS = [
// `TURN_COMPLETION_VERBS` 是导出的字符串数组常量，
// 供状态栏或日志在回合结束时随机挑选一个动词，让提示更生动。
  'Baked',
  'Brewed',
  'Churned',
  'Cogitated',
  'Cooked',
  'Crunched',
  'Sautéed',
  'Worked',
]
// 数组以 `]` 收尾，这些动词都被设计成能自然搭配「for [时长]」，
// 例如「Baked for 3s」「Crunched for 2s」。
