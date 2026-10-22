# -*- coding: utf-8 -*-
"""BriefTool/upload.ts 第 1 部分"""

ANNOTATIONS = [
    (15, 'before', '''upload.ts：把 Brief 附件上传到 private_api，让 web 端查看器能预览。
本地路径对 web 查看器无意义（文件在 Claude 的机器上），上传后把 file_uuid
与 path 并存——web 用 uuid、桌面/本地优先用 path。全流程 best-effort：
任何失败（无令牌/桥未开/网络错/4xx）记 debug 日志返回 undefined，
附件仍带 {path, size, isImage}，本地渲染不受影响。'''),
    (32, 'after', '''30MB 上限，与 private_api 后端限制一致。'''),
    (34, 'after', '''上传超时 30 秒。'''),
    (49, 'after', '''MIME 白名单只留光栅图格式：后端按 mime 分流——image/* 走转码器产 PREVIEW/THUMBNAIL，
其他走通用文件（仅 ORIGINAL）。svg/bmp/ico 有 400 风险，pdf 另走不产 ORIGINAL 的通道；
查看器图片用 /preview、其余用 /contents，所以非图片一律 octet-stream。'''),
    (54, 'after', '''不在白名单的扩展名统一 application/octet-stream（走通用文件通道）。'''),
    (75, 'after', '''Base URL 三级回退：显式覆盖 > ANTHROPIC_BASE_URL 环境变量 > OAuth 配置默认值。
后者必须与令牌同源——子进程宿主（cowork）会同时传 ANTHROPIC_BASE_URL 与
CLAUDE_CODE_OAUTH_TOKEN，而 getOauthConfig 只有设了 USE_STAGING_OAUTH 才返回 staging；
漏掉环境变量这级，staging 令牌打到 api.anthropic.com 会 401 → 静默跳过 →
web 查看器看到没有 file_uuid 的死卡片。'''),
    (81, 'after', '''响应 schema 只取 file_uuid——三个响应形状（Image/Blob/Document）都带它，
这是唯一需要的字段。'''),
    (100, 'after', '''feature('BRIDGE_MODE') 正向包裹（负向 if-return 无法被 DCE 从非桥构建里剔除整段函数体）；
桥未开（replBridgeEnabled 为 false）直接放弃。'''),
    (111, 'after', '''无 OAuth 令牌 → 放弃（debug 记录）。'''),
    (124, 'after', '''读文件、取文件名、按扩展名猜 mime、生成 multipart 边界。'''),
    (137, 'after', '''手工拼 multipart 体（与 filesApi.ts 同款）：oauth 端点只收单个 file part，
没有公共 Files API 的 purpose 字段。'''),
    (149, 'after', '''axios POST：Bearer 令牌、显式 Content-Length、30 秒超时、可中止信号；
validateStatus 恒真——状态码自己判，不让 axios 抛异常。'''),
    (156, 'after', '''201 才算成功；其他状态记前 200 字符响应体后放弃。'''),
    (167, 'after', '''schema 校验通过即返回 file_uuid；异常也走 catch 返回 undefined——
所有失败路径都归约到「无 uuid，本地照常渲染」。'''),
]
