# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/usePluginInstallationStatus.tsx
# 插件安装失败汇总通知：marketplaces + plugins 两类失败计数

ANNOTATIONS = [
    (17, 'before', '''// bb0 是 React Compiler 生成的标签块：installationStatus 为空时
// 直接给出全零计数（保持下游解构形状不变），否则分别过滤出
// 失败的 marketplace 与 plugin。'''),

    (51, 'after', '''// 合计失败数 = 失败市场 + 失败插件（文案里只说总数）。'''),

    (83, 'before', '''// 第一道零值闸：没有失败就不动作。'''),

    (87, 'before', '''// 第二道零值闸与第一道条件完全相同——源码里连续两次
// if (totalFailed === 0) return，第二处是冗余防御（永假），
// 不影响行为，仅日志会少打一行。'''),

    (108, 'after', '''// effect 依赖数组：四个计数/状态任一变化才重算通知。
// 计数经过 useMemo 化（$[5..8] 缓存），数组引用稳定，
// 避免每次渲染重建触发 effect。'''),

    (119, 'before', '''// 两个过滤器：marketplace 与 plugin 都以 status === failed 判定。'''),
]
