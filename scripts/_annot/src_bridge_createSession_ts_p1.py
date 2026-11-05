# -*- coding: utf-8 -*-
"""bridge/createSession.ts 批注数据（桥接会话的创建 / 获取 / 归档 / 改名）。"""

ANNOTATIONS = [
    (1, 'before', '桥接会话的四条会话 API 封装：创建、获取、归档、改标题，全部走 org 作用域的 v1 Sessions 接口，与 bridgeApi 的环境层接口区分开'),
    (7, 'before', 'GitSource：创建会话时携带的仓库来源（类型、URL、修订号）'),
    (13, 'before', 'GitOutcome：会话建立后回填的仓库产出信息'),
    (20, 'before', 'SessionEvent：POST /v1/sessions 要求事件包在判别联合格式里'),
    (34, 'before', 'createBridgeSession：建会话的主函数，被远程控制命令与斜杠命令共用，失败返回 null（非致命）'),
    (64, 'before', '先取访问令牌与会话组织 UUID，任一缺失就返回 null'),
    (78, 'before', '根据 git 仓库 URL 构造来源与产出，先试通用远程解析，失败再退回 owner/repo 格式解析'),
    (81, 'before', '只有给了 git 仓库 URL 才去构造来源与产出'),
    (125, 'before', '组装请求体：标题、事件、会话上下文（来源 / 产出 / 模型）、环境 ID、来源标记'),
    (138, 'before', '请求头：oauth 头 + beta 开关 + 组织 UUID 三件套'),
    (144, 'before', 'URL 优先用调用方给的覆盖值，否则取配置里的基址'),
    (160, 'before', '发创建请求，校验状态小于 500 即视为可拿到响应'),
    (168, 'before', '校验返回体确实是带字符串 id 的对象'),
    (179, 'before', '成功则把会话 ID 交回去'),
    (190, 'before', 'getBridgeSession：按 ID 拉会话，取出环境 ID 与标题用于恢复'),
    (222, 'before', '发 GET 请求，超时 10 秒、状态小于 500 视为可处理'),
    (235, 'before', '非 200 视为失败，提取服务端明细后返回 null'),
    (243, 'before', '成功则把整份响应交回去'),
    (263, 'before', 'archiveBridgeSession：归档会话，CCR 服务端从不自动归档，必须客户端显式调用；本函数不吞异常，由调用方兜底'),
    (299, 'before', '发 POST 归档请求，超时沿用 10 秒'),
    (309, 'before', '200 视为归档成功，其余提取明细记日志'),
    (327, 'before', 'updateBridgeSessionTitle：改名时把标题同步到 claude.ai，标题同步是尽力而为'),
    (358, 'before', '兼容网关只认 session_* 形式，v2 调用方传的是原始 cse_*，这里统一改写以便两种调用方都能直接用'),
    (364, 'before', '发 PATCH 改标题，异常吞掉并记日志，标题同步不阻断主流程'),
]
