# -*- coding: utf-8 -*-
# src/utils/autoUpdater.ts  L561
ANNOTATIONS = [

(28, 'after', r'''文件总览：自动更新模块。负责版本门槛校验（assertMinVersion）、服务端封顶（getMaxVersion，事故时当开关暂停更新）、从 npm 或 GCS 拉最新版本、以及执行全局安装（installGlobalPackage）。全程从 home 目录跑 npm/bun，刻意避开项目级 .npmrc 以防被恶意重定向到攻击者仓库。'''),

(52, 'after', r'''MaxVersionConfig：服务端下发的版本封顶配置——ant（内部）与外部用户各一档，外加各自的提示文案。'''),

(99, 'after', r'''assertMinVersion：最低版本门槛。读 Statsig 的 tengu_version_config，当前版本低于门槛就打印升级提示并退出。测试环境跳过，读配置失败也不阻断（只记日志）。'''),

(114, 'after', r'''getMaxVersion：按用户类型取封顶版本——ant 取 ant 字段、外部用户取 external 字段；没配就返回 undefined（不设上限）。'''),

(126, 'after', r'''getMaxVersionMessage：取封顶超限时展示给用户的服务端提示文案（同样按用户类型分档）。'''),

(138, 'after', r'''getMaxVersionConfig：读 tengu_max_version_config 的内部函数，失败回退空对象。'''),

(159, 'after', r'''shouldSkipVersion：切到 stable 频道时，若目标版本低于用户在设置里设的 minimumVersion，就跳过更新（防止降级）。'''),

(162, 'after', r'''LOCK_TIMEOUT_MS：锁文件超时 5 分钟——超过此时长的锁视为陈旧可回收。'''),

(170, 'after', r'''getLockFilePath：锁文件路径固定为配置目录下的 .update.lock，做成函数以便测试时延迟求值。'''),

(249, 'after', r'''acquireLock：抢更新锁。先看旧锁是否陈旧（mtime 超阈值），陈旧则「重验后再删」以关掉 TOCTOU 竞态；再用 O_EXCL（flag: wx）原子创建，被抢先则返回 EEXIST 退让，目录不存在就懒建。'''),

(268, 'after', r'''releaseLock：若锁里写的是自己 pid 才删，避免误删别人的锁。'''),

(290, 'after', r'''getInstallationPrefix：查全局安装前缀（bun 走 pm bin -g、npm 走 config get prefix），从 home 跑以避开项目级配置。'''),

(317, 'after', r'''checkGlobalInstallPermissions：判当前用户有没有全局写入权限——对前缀目录试 W_OK，失败报 AutoUpdaterError。'''),

(344, 'after', r'''getLatestVersion：按频道（stable/latest）查 npm 上的最新版本号，5 秒超时，失败返回 null。'''),

(378, 'after', r'''getNpmDistTags：查 npm 的 dist-tags（latest 与 stable），给 doctor 命令展示可用版本。'''),

(397, 'after', r'''getLatestVersionFromGcs：给「没有 npm 的安装方式」（如包管理器装）从 GCS 桶拉某频道的最新版本指针。'''),

(410, 'after', r'''getGcsDistTags：并行拉 GCS 的 latest 与 stable 指针，聚成 NpmDistTags。'''),

(454, 'after', r'''getVersionHistory：ant 专属——拉版本历史并取最近 N 个、反转为最新在前。优先用 native package URL，确保只列有原生二进制构建的版本，避免回滚列表出现没原生包的版本。'''),

(533, 'after', r'''installGlobalPackage：执行全局安装。先抢锁（抢不到记冲突埋点并返回 in_progress）；清理旧 claude 别名、拦截 WSL 里用 Windows npm 的错配、校验权限、按 bun/npm 装全局包；成功写回 installMethod=global。无论成败 finally 都释放锁。'''),

(561, 'after', r'''removeClaudeAliasesFromShellConfigs：装前清理各 shell 配置文件里的 claude 别名（切到原生或 npm 全局时清掉旧安装方式残留）；单个文件出错不阻断整体。'''),

]
