# -*- coding: utf-8 -*-
# 第 165 批：src/commands/login/login.tsx 批注数据
ANNOTATIONS = [
    (1, 'before', '''/login 命令的 React 组件与各类刷新依赖。'''),
    (19, 'before', '''call：/login 入口，渲染登录弹窗并在成功后刷新状态。'''),
    (24, 'after', '''换 key 后剥离旧签名块，避免新 key 拒收过期签名。'''),
    (28, 'after', '''登录成功后重置费用统计状态。'''),
    (30, 'after', '''非阻塞刷新远端托管设置。'''),
    (34, 'after', '''先清用户缓存再刷 GrowthBook，让凭据及时生效。'''),
    (40, 'after', '''清除上一账号遗留的可信设备令牌再重新注册。'''),
    (43, 'after', '''重置权限绕过熔断闸门并按新组织重算。'''),
    (52, 'after', '''递增 authVersion 触发依赖鉴权的数据（如 MCP）重新拉取。'''),
    (60, 'before', '''Login：登录对话框组件，封装 OAuth 与确认流程。'''),
    (101, 'before', '''_temp：退出确认快捷键的提示文案。'''),
]
