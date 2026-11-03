# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (8, 'before', '''WizardContext：向导的 React 上下文，携带步骤索引、数据与各导航方法。'''),
    (9, 'before', '''WizardProvider：管理多步向导的状态（当前步、数据、导航历史）并提供上下文。'''),
    (30, 'before', '''本地状态：当前步索引、向导数据、完成标志、导航历史。'''),
    (62, 'before', '''完成副作用：进入完成态时清空历史并回调 onComplete 传出数据。'''),
    (81, 'before', '''goNext：推进到下一步，已是最后一步则标记完成。'''),
    (108, 'before', '''goBack：回退到上一访问步，历史为空则触发取消。'''),
    (123, 'before', '''goToStep：跳转到指定步骤并记录导航历史。'''),
    (137, 'before', '''cancel：清空历史并触发 onCancel 取消向导。'''),
    (151, 'before', '''updateWizardData：用局部更新合并新的向导数据。'''),
    (180, 'before', '''取当前步对应组件；已完成或无组件时不渲染任何内容。'''),
    (195, 'before', '''用 Provider 包裹当前步或子元素，注入上下文后返回。'''),
]
