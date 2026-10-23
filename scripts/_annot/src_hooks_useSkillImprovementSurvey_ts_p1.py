# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (25, 'after', '''// 返回三件套：isOpen 弹窗态、suggestion（清 AppState 后仍显示，走 ref）、handleSelect 用户选择回调；suggestion 源自 AppState.skillImprovement.suggestion。'''),
    (35, 'after', '''// 把 suggestion 缓存进 lastSuggestionRef：即使 AppState.skillImprovement 被清空，弹窗仍能展示上次建议（清态后引用不丢）。'''),
    (51, 'after', '''// 新建议到达且未开 → 开弹窗；首现记 tengu_skill_improvement_survey appeared 事件；_PROTO_skill_name 走特权 BQ 列（明文 skill 名不进 additional_metadata 防泄露）。'''),
    (97, 'after', '''// 选择处理：dismissed 仅关弹窗；否则 applySkillImprovement 并追加 system 消息；两种都关 + 重置 loggedAppearanceRef + 清 AppState.skillImprovement.suggestion。'''),
]
