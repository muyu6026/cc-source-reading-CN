// 【用户贴的图，在历史里显示成一行可点的链接】
//
//  终端画不了图，所以只能退一步：显示 `[Image #3]`，
//  如果终端支持超链接（OSC 8）就把它变成 file:// URL，点一下用系统看图器打开。
//
//  这个文件把「能不能点」这件事完全交给 supportsHyperlinks() 判断，
//  自己不做任何平台判断 —— 那个函数在 ink/ 层，读过目录的话应该记得它
//  检查的是 TERM_PROGRAM / VTE_VERSION 这类环境变量。
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { pathToFileURL } from 'url';
import Link from '../../ink/components/Link.js';
import { supportsHyperlinks } from '../../ink/supports-hyperlinks.js';
import { Box, Text } from '../../ink.js';
import { getStoredImagePath } from '../../utils/imageStore.js';
import { MessageResponse } from '../MessageResponse.js';
type Props = {
  imageId?: number;
  addMargin?: boolean;
};

/**
 * Renders an image attachment in user messages.
 * Shows as a clickable link if the image is stored and terminal supports hyperlinks.
 * Uses MessageResponse styling to appear connected to the message above,
 * unless addMargin is true (image starts a new user turn without text).
 */
export function UserImageMessage(t0) {
  const $ = _c(7);
  const {
    imageId,
    addMargin
  } = t0;
// 【标签文本和「能不能点」分开算：label 永远有，链接是附加的】
//
//      label     = imageId ? '[Image #3]' : '[Image]'
//      content   = imagePath && supportsHyperlinks() ? <Link>{label}</Link> : <Text>{label}</Text>
//
//  两种情况的**文本完全相同**，只有包不包 Link 的区别。
//  这样终端不支持超链接时，用户看到的还是一个能读懂的标记，只是点不动。
//
//  「降级只改变交互，不改变信息」是这里的原则。
//  如果降级时改成显示路径，屏幕就会被一长串 /tmp/xxx.png 塞满。
  const label = imageId ? `[Image #${imageId}]` : "[Image]";
  let t1;
// 【缓存键里同时放了 imageId 和 label —— 多余的，但无害】
//
//  label 是 imageId 的纯函数（第 26 行），所以 `$[0] !== imageId`
//  已经足够。Compiler 把 label 也放进条件，是因为它在同一次渲染里
//  既被当作条件又被当作渲染内容，产物按「用到的变量」机械地收集依赖。
//
//  读产物时的经验：**依赖通常只会多、不会少**。
//  多一个依赖的后果只是「本来可以复用却重算了」，
//  少一个依赖才会出 bug（画面不更新）。所以 Compiler 宁可保守。
  if ($[0] !== imageId || $[1] !== label) {
    const imagePath = imageId ? getStoredImagePath(imageId) : null;
    t1 = imagePath && supportsHyperlinks() ? <Link url={pathToFileURL(imagePath).href}><Text>{label}</Text></Link> : <Text>{label}</Text>;
    $[0] = imageId;
    $[1] = label;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const content = t1;
// 【addMargin 走一条完全不同的分支：包 Box marginTop，不包 MessageResponse】
//
//  注释（第 17-18 行）解释了两个分支的语义：
//
//    addMargin === true   这张图是**一整轮用户输入的开头**（只有图没有文字），
//                         所以自己带上边距，和上一轮分开
//    addMargin 为假       这张图跟在文字后面（同一轮），
//                         用 MessageResponse 的左边框画成「同一条消息的延续」
//
//  MessageResponse 在上一批读过：它画的是那条竖线 / 缩进，
//  让「同一条消息的多个块」看起来连在一起。
//
//  这就是为什么这个组件有两条 return 路径，而不是一个 Box 里面套一个三元 ——
//  两种情况的**外层结构**根本不同。
  if (addMargin) {
    let t2;
    if ($[3] !== content) {
      t2 = <Box marginTop={1}>{content}</Box>;
      $[3] = content;
      $[4] = t2;
    } else {
      t2 = $[4];
    }
    return t2;
  }
  let t2;
  if ($[5] !== content) {
// 【pathToFileURL 而不是手拼 'file://' + path】
//
//  Windows 的路径形如「盘符 + 冒号 + 反斜杠分隔」，直接拼成 file:// 加原路径
//  不是合法 URL —— 盘符前要补斜杠、路径分隔符要换成正斜杠、
//  空格和中文要百分号编码，三件事都得做。
//
//  用 node:url 的 pathToFileURL 一次解决三个问题。
//  这是「不要手拼 URL」这条通用规则在终端场景里的具体落点。
    t2 = <MessageResponse>{content}</MessageResponse>;
    $[5] = content;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  return t2;
}
// 原文件此处有一行 4240 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。