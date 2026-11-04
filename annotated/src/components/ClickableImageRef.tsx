import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { pathToFileURL } from 'url';
import Link from '../ink/components/Link.js';
import { supportsHyperlinks } from '../ink/supports-hyperlinks.js';
import { Text } from '../ink.js';
import { getStoredImagePath } from '../utils/imageStore.js';
import type { Theme } from '../utils/theme.js';
type Props = {
  imageId: number;
  backgroundColor?: keyof Theme;
  isSelected?: boolean;
};

/**
 * Renders an image reference like [Image #1] as a clickable link.
 * When clicked, opens the stored image file in the default viewer.
 *
 * Falls back to styled text if:
 * - Terminal doesn't support hyperlinks
 * - Image file is not found in the store
 */
// 图片引用（Image 井号 N）：终端支持超链接时渲染成可点击链接，否则退回带样式的文本
export function ClickableImageRef(t0) {
  const $ = _c(13);
  const {
    imageId,
    backgroundColor,
    isSelected: t1
  } = t0;
  const isSelected = t1 === undefined ? false : t1;
  const imagePath = getStoredImagePath(imageId);
// 按 id 取已存图片路径：取不到就说明图片不在 store 里
  const displayText = `[Image #${imageId}]`;
  if (imagePath && supportsHyperlinks()) {
// 两个条件同时满足才做链接：有文件且终端支持 OSC 8 超链接
    const fileUrl = pathToFileURL(imagePath).href;
// pathToFileURL：本地路径转成 file URL，交给终端打开
    let t2;
    let t3;
    if ($[0] !== backgroundColor || $[1] !== displayText || $[2] !== isSelected) {
      t2 = <Text backgroundColor={backgroundColor} inverse={isSelected}>{displayText}</Text>;
// fallback 用的无下划线版与链接内版本分别缓存：选中态时链接内版本额外加粗
      t3 = <Text backgroundColor={backgroundColor} inverse={isSelected} bold={isSelected}>{displayText}</Text>;
      $[0] = backgroundColor;
      $[1] = displayText;
      $[2] = isSelected;
      $[3] = t2;
      $[4] = t3;
    } else {
      t2 = $[3];
      t3 = $[4];
    }
    let t4;
    if ($[5] !== fileUrl || $[6] !== t2 || $[7] !== t3) {
      t4 = <Link url={fileUrl} fallback={t2}>{t3}</Link>;
// Link 的 fallback 指向纯文本版：不支持超链接的终端不会看到空内容
      $[5] = fileUrl;
      $[6] = t2;
      $[7] = t3;
      $[8] = t4;
    } else {
      t4 = $[8];
    }
    return t4;
  }
  let t2;
  if ($[9] !== backgroundColor || $[10] !== displayText || $[11] !== isSelected) {
    t2 = <Text backgroundColor={backgroundColor} inverse={isSelected}>{displayText}</Text>;
// 降级路径只给普通 Text：保留背景色与选中反色，但不可点击
    $[9] = backgroundColor;
    $[10] = displayText;
    $[11] = isSelected;
    $[12] = t2;
  } else {
    t2 = $[12];
  }
  return t2;
}
// 原文件此处有一行 5328 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。