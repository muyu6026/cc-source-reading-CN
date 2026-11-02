# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件惰性加载 computer-use-input 原生模块并缓存：包通过编译期注入的节点路径读取预构建产物，并一次性把「是否支持」判别式收窄成裸 API 供调用方使用。'''),
    (6, 'before', '''cached：模块级缓存，requireComputerUseInput 首次成功后缓存结果，避免重复加载原生模块。'''),
    (22, 'before', '''requireComputerUseInput：取缓存；否则动态 require 该包，若 isSupported 为 false 则抛错，否则缓存并返回裸 API。注意其底层在 libuv 环境下主队列不排空会导致 promise 挂起，调用方需包在 drainRunLoop 中。'''),
]
