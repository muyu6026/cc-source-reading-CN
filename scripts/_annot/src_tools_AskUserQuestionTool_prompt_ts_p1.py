# -*- coding: utf-8 -*-
"""AskUserQuestionTool/prompt.ts 第 1 部分"""

ANNOTATIONS = [
    (5, 'after', '''chip 标签的最大宽度：header 字段的字符上限（UI 里渲染为问题上方的小标签）。'''),
    (8, 'after', '''DESCRIPTION：一句话说明工具用途——多选题收集信息、消歧、确认偏好、给用户选择。'''),
    (30, 'after', '''PREVIEW_FEATURE_PROMPT：preview 功能的提示词补丁，按格式分两版。
markdown 版渲染为等宽文本框并切换左右分栏；html 版要求自包含片段、禁 <script>/<style>。
两种格式都强调：简单偏好题别用 preview，且仅限单选题。'''),
    (32, 'before', '''主提示词（模板字符串）：交代使用时机、四类用途与三条使用注意事项
（总有 Other 自由输入；multiSelect 用法；推荐项放第一个并标注 (Recommended)）。'''),
]
