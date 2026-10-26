# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (15, 'before', '''// 从 AppState 取当前 settings 的 React hook：磁盘变更经 settingsChangeDetector 自动更新，组件可响应式拿到。'''),
    (16, 'after', '''// 优先用这个而非 getSettings_DEPRECATED()，才能在 React 组件里拿到响应式更新。'''),
]
