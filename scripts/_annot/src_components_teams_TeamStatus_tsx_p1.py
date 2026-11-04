# -*- coding: utf-8 -*-
# annotations for src/components/teams/TeamStatus.tsx (82 lines)
ANNOTATIONS = [
    (14, 'before', '页脚队友计数指示：与后台任务状态条同类，但统计的是 teammate'),
    (20, 'after', '只订阅 teamContext 切片'),
    (23, 'after', 'Object.values 计数并过滤掉 team-lead：队长自己不算「队友」，否则数字永远多 1'),
    (30, 'after', '0 个队友时整个指示不渲染'),
    (35, 'after', '提示只在已选中团队且 showHint 时出现：Enter to view'),
    (43, 'after', '单复数处理：1 用 teammate，多则 teammates'),
    (47, 'after', 'key 随选中态切换（selected 与 normal）：强制重挂载以刷新 inverse 反色渲染'),
    (57, 'after', '提示前补一个空格，与非反色的状态文本分开'),
]
