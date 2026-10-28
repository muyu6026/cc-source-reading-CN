# -*- coding: utf-8 -*-
# 批注：src/utils/background/remote/preconditions.ts
ANNOTATIONS = [
    (23, 'before', '判断是否需用 Claude.ai 登录：非订阅用户直接否，订阅用户再做 OAuth 刷新'),
    (36, 'before', '判断 git 工作树是否干净，忽略未跟踪文件（分支切换不会丢失它们）'),
    (45, 'before', '判断用户是否至少有一个远程环境可用，失败按「无」处理'),
    (59, 'before', '判断当前目录是否位于 git 仓库内（有 .git/），与「是否有远程」不同'),
    (67, 'before', '判断当前仓库是否配置了 GitHub 远程（纯本地仓库为否）'),
    (78, 'before', '查某仓库是否装了 GitHub App：带 OAuth 令牌与组织 UUID 调后端接口，4xx 按「未装」处理'),
    (132, 'before', '命中 200 再细看 status 字段：app_installed 为真才认为装了，status 为 null 视为未装'),
    (164, 'before', '判断用户是否经 /web-setup 同步过 GitHub 凭据，4xx 按「未同步」处理'),
    (192, 'after', '200 且 is_authenticated 为真才算同步成功'),
    (213, 'after', '远程访问方式三选一：GitHub App、令牌同步、皆无'),
    (221, 'before', '分层判定某仓库是否可做远程操作：先试 GitHub App，再试令牌同步（受特性开关控制），都没有则提示去配置'),
]
