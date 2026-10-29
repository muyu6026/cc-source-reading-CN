# -*- coding: utf-8 -*-
SOURCE_PATH = 'src/utils/permissions/bypassPermissionsKillswitch.ts'
ANNOTATIONS = [
    (16, 'after', '''bypass 权限与 auto 模式的开关守卫：按 Statsig 灰度门在首次查询前关掉 bypass 权限或 auto 模式，并在 /login 后重置一次性标志以重新评估。'''),
    (17, 'after', '''bypassPermissionsCheckRan 是 bypass 检查的一次性标志。'''),
    (22, 'before', '''checkAndDisableBypassPermissionsIfNeeded：仅首次、且仅当 bypass 模式可用时，按灰度门结果把 toolPermissionContext 替换成禁用态。'''),
    (47, 'after', '''checkAndDisableBypassPermissionsIfNeeded 结束。'''),
    (55, 'after', '''resetBypassPermissionsCheck 在 /login 后把一次性标志复位，让灰度门按新组织重新评估。'''),
    (70, 'after', '''useKickOffCheckAndDisableBypassPermissionsIfNeeded 是 React 钩子，组件挂载时触发一次上述检查（远程模式跳过）。'''),
    (78, 'before', '''checkAndDisableAutoModeIfNeeded：在 TRANSCRIPT_CLASSIFIER 特性开启时，按灰度门禁用 auto 模式，并把通知并入应用状态（用当前 context 而非陈旧快照，防中途切模式被回退）。'''),
    (117, 'after', '''checkAndDisableAutoModeIfNeeded 结束。'''),
    (125, 'after', '''resetAutoModeGateCheck 复位 auto 模式检查的一次性标志。'''),
    (155, 'after', '''useKickOffCheckAndDisableAutoModeIfNeeded 在挂载及模型/快速模式变化时重跑 auto 模式门检查，覆盖 /model、Cmd+P、/config、bridge 等多条入口。'''),
]
