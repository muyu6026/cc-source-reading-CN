# -*- coding: utf-8 -*-
"""BriefTool/attachments.ts 第 1 部分"""

ANNOTATIONS = [
    (8, 'before', '''attachments.ts：SendUserMessage 与 SendUserFile 共用的附件校验+解析。
放在 BriefTool/ 目录是为了让 feature('BRIDGE_MODE') 守卫里的动态 import('./upload.js')
保持相对路径——upload.ts（axios、crypto、认证工具）得以从非桥构建中 tree-shake 掉。'''),
    (24, 'after', '''ResolvedAttachment：本地渲染所需的四元组；file_uuid 仅桥接上传成功时存在。'''),
    (61, 'after', '''validateAttachmentPaths：逐个 stat 校验——非常规文件（目录等）、不存在（附当前 cwd
提示）、无权限（EACCES/EPERM）各给明确文案；其他 errno 原样上抛。'''),
    (82, 'after', '''stat 串行执行（本地快）保证顺序确定；这里 stat 是主操作不是守卫——要取 size。
validateInput 刚跑过但文件可能已被移走（TOCTOU），错了就让错误传播给模型看。'''),
    (96, 'after', '''动态 import 放在 feature() 守卫内：upload.ts（axios/crypto/zod/auth/MIME 表）
在非 BRIDGE_MODE 构建里被整体剔除。静态 import 会强制模块级求值，
守卫内的 feature 检查救不了它（CLAUDE.md：守卫外定义的 helper 即使不被调用也留在构建产物里）。'''),
    (95, 'after', '''无头/SDK 调用方不会设 replBridgeEnabled（只有 TTY REPL 在 main.tsx 初始化时设）；
CLAUDE_CODE_BRIEF_UPLOAD 让把 CLI 当子进程跑的宿主显式开启上传——
比如 cowork 桌面桥（它已传 CLAUDE_CODE_OAUTH_TOKEN 做认证）。'''),
    (107, 'after', '''上传并行（网络慢）；失败的槽位 uuid 为 undefined，原样保留 {path, size, isImage}。'''),
    (109, 'after', '''非桥构建：直接返回 stat 结果，无上传环节。'''),
]
