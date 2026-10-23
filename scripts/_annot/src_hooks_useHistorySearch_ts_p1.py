ANNOTATIONS = [
    (44, 'after', r'''文件级：Ctrl-R 历史搜索（shell 式增量反查）。五个 original* state 是进入搜索时的现场快照——取消时必须完整还原（输入、光标、模式、粘贴内容四件套）。historyReader 是 AsyncGenerator（反向逐行读历史文件），seenPrompts 去重，searchAbortController 取消在途搜索。'''),
    (58, 'after', r'''closeHistoryReader 必须显式调 .return()——注释点明：不调就触发不了 readLinesReverse 的 finally 块，文件句柄泄漏。生成器的卫生销毁不能靠 GC。'''),
    (133, 'after', r'''searchHistory 主循环：空查询 = 还原现场退出；resume 复用已有 reader（接着往下找）；while(true) 逐条读，lastIndexOf 子串匹配 + seenPrompts 去重（同一条历史不重复命中）；命中时同步还原 mode/input/pastedContents 三态，光标按 clean value 定位——display 带模式前缀（! 等），getValueFromInput 剥掉后匹配位置才对。读尽还没中 = historyFailedMatch（保留上一个匹配只标失败）。'''),
    (165, 'after', r'''handleStartSearch：进入搜索前快照四件套现场，开新 reader。'''),
    (192, 'after', r'''handleAccept：接受当前匹配退出（用 value 不用 display——前缀剥掉再提交）；无匹配时至少还原粘贴内容。'''),
    (208, 'after', r'''handleCancel：完整还原现场（输入/光标/粘贴内容）后 reset——Ctrl-R 搜索的「不留痕迹」退出。'''),
    (235, 'after', r'''handleExecute：接受并直接提交。空查询提交原输入（用户什么都没搜就回车）；有匹配提交剥前缀的 value。'''),
    (241, 'after', r'''history:search 键位被 HISTORY_PICKER feature 门控——新版 modal 历史选择器拥有 Ctrl-R 时，这里的增量搜索让位（isActive: false 而不是不注册，键位表保持完整）。'''),
    (268, 'after', r'''handleKeyDown 的遗留路径：空查询时 backspace 取消搜索。注释说明为什么进不了键位模型——「backspace 只在查询为空时取消」是条件行为，键位表描述不了这种状态依赖。'''),
    (294, 'after', r'''query 变化 effect：abort 在途搜索 + 新 controller；searchHistoryRef 避免把 searchHistory 本身列为依赖（它每次渲染都是新引用，会无限重入）。清理函数再 abort 一次——卸载时取消。'''),
]
