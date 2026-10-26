# 数据文件：source/src/utils/teleport.tsx
# slug = src_utils_teleport_tsx
# 约束：中文用三引号；正文禁英文双引号与反斜杠。
# 注意：本文件含 JSX 块（约 519-531 行）与 base64 sourceMappingURL（末行），
# 锚点一律避开 JSX 内部，模板字面量开头行也不落锚（落在结束行之后）。

ANNOTATIONS = [
    (50, 'after', '''createTeleportResumeSystemMessage 构造一段系统消息，告诉模型「本会话是从另一台机器续接的」。分支检出成功就给 suggestion 级提示，失败则带 warning 说明没切到分支。'''),
    (66, 'after', '''createTeleportResumeUserMessage 构造一条用户消息，明确告知模型当前会话从别的机器继续、应用状态可能已变、工作目录已更新到启动目录。isMeta 标记它是元消息。'''),
    (92, 'after', '''SESSION_TITLE_AND_BRANCH_PROMPT 是喂给 Haiku 的标题与分支名生成提示。硬性约束：标题不超 6 个词、句首大写；分支名以 claude/ 开头、全小写、词间用短横，不超 4 个词。返回 JSON 含 title 和 branch 两个字段。'''),
    (102, 'after', '''generateTitleAndBranch 用 Haiku 生成会话标题和分支名，并强制走 JSON schema 输出。任何解析失败或异常都降级到「描述截断到 75 字」的标题和 claude/task 的默认分支，绝不抛错中断续接流程。'''),
    (172, 'after', '''validateGitState 是 teleport 的前置闸门：要求工作目录干净（忽略未跟踪文件，因为切分支不会丢它们）。不干净就抛 TeleportOperationError 让用户先提交或暂存。'''),
    (187, 'after', '''fetchFromOrigin 从 origin 拉取指定分支；若指定分支拉取失败且报错含 refspec，再退一步只拉 ref 不映射到本地分支——应对分支还不在本地的情况。'''),
    (215, 'after', '''ensureUpstreamIsSet 确保当前分支设了上游。先查是否已有 upstream，没有再确认 origin/分支 是否存在，存在就用 --set-upstream-to 设上；设不上也不抛错（非关键）。'''),
    (251, 'after', '''checkoutBranch 是一套「逐级降级」的检出逻辑：先原地检出，失败就带 --track 从 origin 新建跟踪分支，还失败就去掉 -b 再试一次。三层都失败才抛错。'''),
    (287, 'after', '''getCurrentBranch 用 git branch --show-current 取当前分支名。'''),
    (301, 'after', '''processMessagesForTeleportResume 处理续接消息：先反序列化（和断点续跑共用逻辑，清理被截断的 tool_use 块），再追加一条「从别的机器续接」的用户消息和系统消息。'''),
    (315, 'after', '''checkOutTeleportedSessionBranch 是切分支的总控：记下切之前的分支，按需要拉取并检出目标分支，最后再取一次当前分支名返回。即便中间抛错也尽量返回「当前分支名 + 错误」，让上层决定怎么提示用户。'''),
    (349, 'after', '''RepoValidationResult 定义仓库校验的五种结果：match（匹配）、mismatch（不匹配）、not_in_repo（需仓库却不在仓库里）、no_repo_required（会话不要求仓库）、error（校验出错）。host 字段仅用于展示。'''),
    (367, 'after', '''validateSessionRepository 把「当前仓库」和「会话要求的仓库」做比对，返回结果对象而不是抛错，让调用方灵活处理。会话没有 git 源要求时直接放行（no_repo_required）。'''),
    (430, 'after', '''teleportResumeCodeSession 是「从代码会话 ID 续接」的主入口：先查组织策略是否允许远程会话，再取 OAuth token 和组织 UUID，然后拉会话、校验仓库，按校验结果分流（匹配/无需仓库→续接；不在仓库/不匹配/出错→各抛不同错）。'''),
    (457, 'after', '''对仓库校验结果分流：match 与 no_repo_required 直接续接；not_in_repo 和 mismatch 抛 TeleportOperationError 并指出该从哪个仓库的 checkout 启动；mismatch 只在 host 真不同时才加 host 前缀，避免同 host 下的噪声；error 用校验错误信息；default 分支用穷尽检查兜底。'''),
    (509, 'after', '''handleTeleportPrerequisites 处理 teleport 的前置错误（认证、git 状态等）：若检测到错误，渲染 TeleportError 对话框让用户交互解决，解决后才 resolve 继续。'''),
    (544, 'after', '''teleportToRemoteWithErrorHandling 是对外创建远程会话的包装：预先忽略 needsGitStash 类错误，先跑前置检查对话框，再调用真正的 teleportToRemote，bundle 失败时把消息写进 stderr。'''),
    (565, 'after', '''teleportFromSessionsAPI 从会话 ingress 接口拉取会话日志：优先试 CCR v2 端点（GetTeleportEvents，服务端分发 Spanner/threadstore），返回 null 再退回 session-ingress；过滤出 transcript 消息、排除 sidechain；并抽出会话分支信息。'''),
    (577, 'after', '''CCR v2 优先、session-ingress 兜底的分流：一旦 session-ingress 下线，兜底会变成空操作（getSessionLogsViaOAuth 也返回 null），届时直接失败「无法拉取会话日志」。这里 404 被单独识别成「会话不存在」。'''),
    (621, 'after', '''PollRemoteSessionResponse 定义轮询远程会话事件的返回：新增事件列表、游标 lastEventId、分支、会话状态（idle/running/requires_action/archived）。'''),
    (633, 'after', '''pollRemoteSessionEvents 用游标分页轮询远程事件：带上一次响应的 lastEventId 只取增量。跳过 env_manager_log 和 control_response 两类事件，只收带 session_id 的 SDK 事件。'''),
    (657, 'after', '''MAX_EVENT_PAGES = 50 是游标卡死时的安全阀——稳态下通常只翻 0 到 1 页，设上限防止异常游标导致无限翻页。'''),
    (717, 'after', '''teleportToRemote 是创建远程 Claude.ai 会话的核心，文档里点明两种源模式：GitHub 克隆（默认，后端从 origin URL 克隆，需 GitHub remote + CCR 侧 GitHub 连接，约 43% 的 CLI 会话有 origin remote）和 Bundle 模式（CCR_FORCE_BUNDLE=1，CLI 打 git bundle 上传，覆盖约 54% 的有 .git 的会话，不依赖 GitHub）。'''),
    (821, 'after', '''显式传 environmentId 时短路掉 Haiku 标题生成和环境选择，但仍跑仓库探测，让容器拿到可用工作目录（code_review 编排器读 --repo-dir $(pwd) 而非自己克隆）。Bundle 模式上传本地工作树，否则用 github.com 源。'''),
    (914, 'after_block', '''源选择阶梯是整个远程创建的关键决策：GitHub 克隆（若 CCR 真能拉到）→ Bundle 兜底（若有 .git）→ 空沙箱。前置检查复用容器侧 git 代理克隆会走的同一代码路径；约一半走到「安装 GitHub App」的用户从未完成，没有这步预检他们每人都会拿到一个克隆时 401 的容器，有了就静默退回 Bundle。CCR_FORCE_BUNDLE=1 直接跳过预检，便于测试或 GitHub 认证已坏的情况。'''),
    (916, 'after', '''这里生成会话标题和分支名：标题和结果分支都显式提供时跳过 Haiku 调用，否则调用 generateTitleAndBranch（用 description 或首条消息作种子）。'''),
    (931, 'after', '''GitHub 预检只针对 github.com：GHES 缺 ghe_configuration_id 只能乐观放行（GHES 用户多半已完成配置）；预检失败但 Bundle 关闭时，也乐观放行沿用旧行为，由后端报真正的认证错误。'''),
    (996, 'after', '''Bundle 兜底：只有当 GitHub 不可用、开关打开、且确有 .git 可打时才试。走到这里 ghViable 为假且仓库信息非空，说明预检失败、但 .git 一定存在（detectCurrentRepositoryWithHost 就是从它读 remote 的）。按失败原因（空仓库/过大/git 错误）给用户不同的引导文案。'''),
    (1054, 'after', '''拉取可用环境列表，列表为空直接失败返回。'''),
    (1062, 'after', '''环境选择优先级：配置默认环境 > anthropic_cloud 环境 > 非 bridge 环境 > 第一个。优先 anthropic_cloud（标准算力、完整仓库访问）而非 byoc（用户自有算力，可能不支持当前仓库）。当用户主动退出配置默认时，绝不一脚踢进可能不支持当前仓库或权限模式的 byoc 环境，而是重试一次，再失败就快速报错而不是静默落入死环境。'''),
    (1117, 'after', '''权限模式不能放在请求体顶层——CreateCCRSessionPayload 没有该字段，proto 解析器会静默丢弃它。改用 prepend 一条 set_permission_mode 的 control_request 事件；初始事件在容器连接前就写入 threadstore，所以 CLI 能在第一轮用户对话前应用模式，没有就绪竞态。'''),
    (1163, 'after', '''真正发起创建会话的 API 调用：成功状态码 200 或 201，否则记录错误返回 null。解析出 SessionResource 后取其中的会话 id。'''),
    (1192, 'after', '''archiveRemoteSession 是最佳努力的会话归档：POST archive 接口没有运行态检查（不像 DELETE 在 RUNNING 时会 409），所以实现中途也能用；归档后远程在下次写入时停止。409（已归档）算成功。发后不理，失败只会让可见会话泄漏到回收器收走为止。'''),
]
