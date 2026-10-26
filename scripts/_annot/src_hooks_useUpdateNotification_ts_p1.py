# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (4, 'after', '''// 把版本号压成 major.minor.patch 三段，忽略预发布/构建号，用于「是否该弹更新提示」的去重比较。'''),
    (22, 'after', '''// 用惰性初始化把已通知版本记成初始版本的 semver，避免首屏误弹。'''),
    (29, 'after', '''// 版本 semver 变了就更新已通知记录并 return 新版本；否则返回 null 不弹。'''),
]
