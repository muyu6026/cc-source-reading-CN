# -*- coding: utf-8 -*-
SOURCE_PATH = 'src/utils/localInstaller.ts'
ANNOTATIONS = [
    (12, 'after', '''本地安装器：把 Claude CLI 装进用户目录的受管 local 环境，独立 node_modules 与 wrapper 脚本，避免污染全局。'''),
    (24, 'after', '''getLocalClaudePath 返回受管安装目录下的 claude 可执行入口路径。'''),
    (32, 'after', '''isRunningFromLocalInstallation 通过 argv[1] 是否含 /.claude/local/node_modules/ 判断当前是否正处于受管本地安装里运行。'''),
    (50, 'after', '''writeIfMissing 用 O_EXCL 原子地「不存在才写入」，已存在则静默返回 false，避免覆盖用户已改的配置。'''),
    (90, 'after', '''ensureLocalPackageEnvironment 幂等地建目录、写 package.json、写可执行 wrapper 脚本（模式位被 umask 屏蔽，故再 chmod 一次确保执行位）。'''),
    (138, 'after', '''installOrUpdateClaudePackage 调用 npm 安装指定版本或通道；失败码 190 表示安装进行中，其余返回 install_failed，并把 installMethod 置为 local 免 npm 权限告警。'''),
    (151, 'after', '''localInstallationExists 仅做存在性探测，调用方据此选择「更新」还是「UI 提示」。'''),
    (162, 'after', '''getShellType 按 SHELL 环境变量推断用户 shell 类型（zsh/bash/fish），用于决定 PATH 拼接方式。'''),
]
