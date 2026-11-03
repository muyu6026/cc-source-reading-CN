// 本文件是选择底座里的「输入型选项」：既能当普通选项显示，也能在聚焦时变成可编辑文本框，并支持粘贴图片、在图片间切换、逐张删除、以及调用外部编辑器。三种渲染形态（标签前置加输入框、聚焦输入框、静态文本）覆盖了同一个选项在不同焦点状态下的样子，是这套选择器里交互最密的一块。
import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode, useEffect, useRef, useState } from 'react';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- UP arrow exit not in Attachments bindings
import { Box, Text, useInput } from '../../ink.js';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import type { PastedContent } from '../../utils/config.js';
import { getImageFromClipboard } from '../../utils/imagePaste.js';
import type { ImageDimensions } from '../../utils/imageResizer.js';
import { ClickableImageRef } from '../ClickableImageRef.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Byline } from '../design-system/Byline.js';
import TextInput from '../TextInput.js';
import type { OptionWithDescription } from './select.js';
import { SelectOption } from './select-option.js';
// Props 分层清晰：几何信息（序号、缩进、上下箭头、版式）、值信息（输入值、选项定义）、回调（改值、提交、退出、开编辑器、图片相关），以及若干可选开关。每个开关的语义都写在注释里，是读这份 Props 的最快方式。
type Props<T> = {
  option: Extract<OptionWithDescription<T>, {
    type: 'input';
  }>;
  isFocused: boolean;
  isSelected: boolean;
  shouldShowDownArrow: boolean;
  shouldShowUpArrow: boolean;
  maxIndexWidth: number;
  index: number;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onExit?: () => void;
  layout: 'compact' | 'expanded';
  children?: ReactNode;
  /**
   * When true, shows the label before the input field.
   * When false (default), uses the label as the placeholder.
   */
  showLabel?: boolean;
  /**
   * Callback to open external editor for editing the input value.
   * When provided, ctrl+g will trigger this callback with the current value
   * and a setter function to update the internal state.
   */
  onOpenEditor?: (currentValue: string, setValue: (value: string) => void) => void;
  /**
   * When true, automatically reset cursor to end of line when:
   * - Option becomes focused
   * - Input value changes
   * This prevents cursor position bugs when the input value updates asynchronously.
   */
  resetCursorOnUpdate?: boolean;
  /**
   * Optional callback when an image is pasted into the input.
   */
  onImagePaste?: (base64Image: string, mediaType?: string, filename?: string, dimensions?: ImageDimensions, sourcePath?: string) => void;
  /**
   * Pasted content to display inline above the input when focused.
   */
  pastedContents?: Record<number, PastedContent>;
  /**
   * Callback to remove a pasted image by its ID.
   */
  onRemoveImage?: (id: number) => void;
  /**
   * Whether image selection mode is active.
   */
  imagesSelected?: boolean;
  /**
   * Currently selected image index within the image attachments array.
   */
  selectedImageIndex?: number;
  /**
   * Callback to set image selection mode on/off.
   */
  onImagesSelectedChange?: (selected: boolean) => void;
  /**
   * Callback to change the selected image index.
   */
  onSelectedImageIndexChange?: (index: number) => void;
};
// 主组件：先把可选 Props 补默认值，再算出图片附件列表，然后注册六组键位（外部编辑器、粘贴图片、删除附件、附件间移动、附件键位表、方向键退出），最后按三态渲染。
export function SelectInputOption(t0) {
  const $ = _c(100);
  const {
    option,
    isFocused,
    isSelected,
    shouldShowDownArrow,
    shouldShowUpArrow,
    maxIndexWidth,
    index,
    inputValue,
    onInputChange,
    onSubmit,
    onExit,
    layout,
    children,
    showLabel: t1,
    onOpenEditor,
    resetCursorOnUpdate: t2,
    onImagePaste,
    pastedContents,
    onRemoveImage,
    imagesSelected,
    selectedImageIndex: t3,
    onImagesSelectedChange,
    onSelectedImageIndexChange
  } = t0;
// 三个默认值：不前置标签、不自动复位光标、选中图片下标为 0。默认都取最保守的一侧。
  const showLabelProp = t1 === undefined ? false : t1;
  const resetCursorOnUpdate = t2 === undefined ? false : t2;
  const selectedImageIndex = t3 === undefined ? 0 : t3;
// 图片附件列表从粘贴内容里筛出来（只留图片类型），供缩略图行与删除操作使用。
  let t4;
  if ($[0] !== pastedContents) {
    t4 = pastedContents ? Object.values(pastedContents).filter(_temp) : [];
    $[0] = pastedContents;
    $[1] = t4;
  } else {
    t4 = $[1];
  }
  const imageAttachments = t4;
// 前置标签开关：外部显式要求、或选项自己声明「带值显示标签」，二者取或。
  const showLabel = showLabelProp || option.showLabelWithValue === true;
// 光标位置初值放在文本末尾——聚焦时用户通常想在末尾继续输入。
  const [cursorOffset, setCursorOffset] = useState(inputValue.length);
// 用户编辑标记：用来区分「值变化是用户敲的」还是「值变化是外部异步更新的」，只有后者才需要把光标复位到末尾。
  const isUserEditing = useRef(false);
// 光标复位效果：仅当开启复位且已聚焦时生效；若是用户自己在编辑就把标记清掉，不打断输入。
  let t5;
  if ($[2] !== inputValue.length || $[3] !== isFocused || $[4] !== resetCursorOnUpdate) {
    t5 = () => {
      if (resetCursorOnUpdate && isFocused) {
        if (isUserEditing.current) {
          isUserEditing.current = false;
        } else {
          setCursorOffset(inputValue.length);
        }
      }
    };
    $[2] = inputValue.length;
    $[3] = isFocused;
    $[4] = resetCursorOnUpdate;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  let t6;
  if ($[6] !== inputValue || $[7] !== isFocused || $[8] !== resetCursorOnUpdate) {
    t6 = [resetCursorOnUpdate, isFocused, inputValue];
    $[6] = inputValue;
    $[7] = isFocused;
    $[8] = resetCursorOnUpdate;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  useEffect(t5, t6);
// 外部编辑器：聚焦且提供了回调时，Ctrl-G 把当前值与一个 setter 交出去，由外部拉起编辑器写回。
  let t7;
  if ($[10] !== inputValue || $[11] !== onInputChange || $[12] !== onOpenEditor) {
    t7 = () => {
      onOpenEditor?.(inputValue, onInputChange);
    };
    $[10] = inputValue;
    $[11] = onInputChange;
    $[12] = onOpenEditor;
    $[13] = t7;
  } else {
    t7 = $[13];
  }
  const t8 = isFocused && !!onOpenEditor;
  let t9;
  if ($[14] !== t8) {
    t9 = {
      context: "Chat",
      isActive: t8
    };
    $[14] = t8;
    $[15] = t9;
  } else {
    t9 = $[15];
  }
  useKeybinding("chat:externalEditor", t7, t9);
// 粘贴图片：从剪贴板取图，取到就带上 base64、媒体类型与尺寸回调上去；取不到静默忽略。
  let t10;
  if ($[16] !== onImagePaste) {
    t10 = () => {
      if (!onImagePaste) {
        return;
      }
      getImageFromClipboard().then(imageData => {
        if (imageData) {
          onImagePaste(imageData.base64, imageData.mediaType, undefined, imageData.dimensions);
        }
      });
    };
    $[16] = onImagePaste;
    $[17] = t10;
  } else {
    t10 = $[17];
  }
  const t11 = isFocused && !!onImagePaste;
  let t12;
  if ($[18] !== t11) {
    t12 = {
      context: "Chat",
      isActive: t11
    };
    $[18] = t11;
    $[19] = t12;
  } else {
    t12 = $[19];
  }
  useKeybinding("chat:imagePaste", t10, t12);
// 删除最后一张：只在输入框为空、有附件且提供了删除回调时可用——输入框有内容时不抢退格键。
  let t13;
  if ($[20] !== imageAttachments || $[21] !== onRemoveImage) {
    t13 = () => {
      if (imageAttachments.length > 0 && onRemoveImage) {
        onRemoveImage(imageAttachments.at(-1).id);
      }
    };
    $[20] = imageAttachments;
    $[21] = onRemoveImage;
    $[22] = t13;
  } else {
    t13 = $[22];
  }
  const t14 = isFocused && !imagesSelected && inputValue === "" && imageAttachments.length > 0 && !!onRemoveImage;
  let t15;
  if ($[23] !== t14) {
    t15 = {
      context: "Attachments",
      isActive: t14
    };
    $[23] = t14;
    $[24] = t15;
  } else {
    t15 = $[24];
  }
  useKeybinding("attachments:remove", t13, t15);
// 附件间移动：多于一张时才启用，下标做环形加减；只有一张时左右键不动。
  let t16;
  let t17;
  if ($[25] !== imageAttachments.length || $[26] !== onSelectedImageIndexChange || $[27] !== selectedImageIndex) {
    t16 = () => {
      if (imageAttachments.length > 1) {
        onSelectedImageIndexChange?.((selectedImageIndex + 1) % imageAttachments.length);
      }
    };
    t17 = () => {
      if (imageAttachments.length > 1) {
        onSelectedImageIndexChange?.((selectedImageIndex - 1 + imageAttachments.length) % imageAttachments.length);
      }
    };
    $[25] = imageAttachments.length;
    $[26] = onSelectedImageIndexChange;
    $[27] = selectedImageIndex;
    $[28] = t16;
    $[29] = t17;
  } else {
    t16 = $[28];
    t17 = $[29];
  }
// 删除选中的那张：删完若只剩零张就退出图片选择模式，否则把下标夹到新的最大下标——避免指向已删除位置。
  let t18;
  if ($[30] !== imageAttachments || $[31] !== onImagesSelectedChange || $[32] !== onRemoveImage || $[33] !== onSelectedImageIndexChange || $[34] !== selectedImageIndex) {
    t18 = () => {
      const img = imageAttachments[selectedImageIndex];
      if (img && onRemoveImage) {
        onRemoveImage(img.id);
        if (imageAttachments.length <= 1) {
          onImagesSelectedChange?.(false);
        } else {
          onSelectedImageIndexChange?.(Math.min(selectedImageIndex, imageAttachments.length - 2));
        }
      }
    };
    $[30] = imageAttachments;
    $[31] = onImagesSelectedChange;
    $[32] = onRemoveImage;
    $[33] = onSelectedImageIndexChange;
    $[34] = selectedImageIndex;
    $[35] = t18;
  } else {
    t18 = $[35];
  }
// 附件键位表：下一张、上一张、删除、退出，四项一起注册在 Attachments 上下文。
  let t19;
  if ($[36] !== onImagesSelectedChange) {
    t19 = () => {
      onImagesSelectedChange?.(false);
    };
    $[36] = onImagesSelectedChange;
    $[37] = t19;
  } else {
    t19 = $[37];
  }
  let t20;
  if ($[38] !== t16 || $[39] !== t17 || $[40] !== t18 || $[41] !== t19) {
    t20 = {
      "attachments:next": t16,
      "attachments:previous": t17,
      "attachments:remove": t18,
      "attachments:exit": t19
    };
    $[38] = t16;
    $[39] = t17;
    $[40] = t18;
    $[41] = t19;
    $[42] = t20;
  } else {
    t20 = $[42];
  }
  const t21 = isFocused && !!imagesSelected;
  let t22;
  if ($[43] !== t21) {
    t22 = {
      context: "Attachments",
      isActive: t21
    };
    $[43] = t21;
    $[44] = t22;
  } else {
    t22 = $[44];
  }
  useKeybindings(t20, t22);
// 方向键退出：图片选择模式下按上箭头直接退出（这条没走 keybindings，因为上箭头在那个上下文里没有绑定）。
  let t23;
  if ($[45] !== onImagesSelectedChange) {
    t23 = (_input, key) => {
      if (key.upArrow) {
        onImagesSelectedChange?.(false);
      }
    };
    $[45] = onImagesSelectedChange;
    $[46] = t23;
  } else {
    t23 = $[46];
  }
  const t24 = isFocused && !!imagesSelected;
  let t25;
  if ($[47] !== t24) {
    t25 = {
      isActive: t24
    };
    $[47] = t24;
    $[48] = t25;
  } else {
    t25 = $[48];
  }
  useInput(t23, t25);
// 失焦即退出图片选择模式：防止焦点移到别的选项后，按键还在操作这个选项的图片。
  let t26;
  let t27;
  if ($[49] !== imagesSelected || $[50] !== isFocused || $[51] !== onImagesSelectedChange) {
    t26 = () => {
      if (!isFocused && imagesSelected) {
        onImagesSelectedChange?.(false);
      }
    };
    t27 = [isFocused, imagesSelected, onImagesSelectedChange];
    $[49] = imagesSelected;
    $[50] = isFocused;
    $[51] = onImagesSelectedChange;
    $[52] = t26;
    $[53] = t27;
  } else {
    t26 = $[52];
    t27 = $[53];
  }
  useEffect(t26, t27);
// 描述行的缩进：展开版留序号宽度加 3，紧凑版加 4（紧凑版序号不缩进，多留一格对齐）。
  const descriptionPaddingLeft = layout === "expanded" ? maxIndexWidth + 3 : maxIndexWidth + 4;
  const t28 = layout === "compact" ? 0 : undefined;
// 序号文本补空格到统一宽度，保证多行选项的左边界对齐。
  const t29 = `${index}.`;
  let t30;
  if ($[54] !== maxIndexWidth || $[55] !== t29) {
    t30 = t29.padEnd(maxIndexWidth + 2);
    $[54] = maxIndexWidth;
    $[55] = t29;
    $[56] = t30;
  } else {
    t30 = $[56];
  }
  let t31;
  if ($[57] !== t30) {
    t31 = <Text dimColor={true}>{t30}</Text>;
    $[57] = t30;
    $[58] = t31;
  } else {
    t31 = $[58];
  }
// 输入区三态：前置标签时标签、分隔符、输入框并列，失焦且有值时只显示值与分隔符；非前置标签时聚焦显示输入框、失焦显示值或占位符。所有输入回调同时写内部状态与选项自己的 onChange，保证受控与非受控两条路一致。
  let t32;
  if ($[59] !== cursorOffset || $[60] !== imagesSelected || $[61] !== inputValue || $[62] !== isFocused || $[63] !== onExit || $[64] !== onImagePaste || $[65] !== onInputChange || $[66] !== onSubmit || $[67] !== option || $[68] !== showLabel) {
    t32 = showLabel ? <><Text color={isFocused ? "suggestion" : undefined}>{option.label}</Text>{isFocused ? <><Text color="suggestion">{option.labelValueSeparator ?? ", "}</Text><TextInput value={inputValue} onChange={value => {
          isUserEditing.current = true;
          onInputChange(value);
          option.onChange(value);
        }} onSubmit={onSubmit} onExit={onExit} placeholder={option.placeholder} focus={!imagesSelected} showCursor={true} multiline={true} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} columns={80} onImagePaste={onImagePaste} onPaste={pastedText => {
          isUserEditing.current = true;
          const before = inputValue.slice(0, cursorOffset);
          const after = inputValue.slice(cursorOffset);
          const newValue = before + pastedText + after;
          onInputChange(newValue);
          option.onChange(newValue);
          setCursorOffset(before.length + pastedText.length);
        }} /></> : inputValue && <Text>{option.labelValueSeparator ?? ", "}{inputValue}</Text>}</> : isFocused ? <TextInput value={inputValue} onChange={value_0 => {
      isUserEditing.current = true;
      onInputChange(value_0);
      option.onChange(value_0);
    }} onSubmit={onSubmit} onExit={onExit} placeholder={option.placeholder || (typeof option.label === "string" ? option.label : undefined)} focus={!imagesSelected} showCursor={true} multiline={true} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} columns={80} onImagePaste={onImagePaste} onPaste={pastedText_0 => {
      isUserEditing.current = true;
      const before_0 = inputValue.slice(0, cursorOffset);
      const after_0 = inputValue.slice(cursorOffset);
      const newValue_0 = before_0 + pastedText_0 + after_0;
      onInputChange(newValue_0);
      option.onChange(newValue_0);
      setCursorOffset(before_0.length + pastedText_0.length);
    }} /> : <Text color={inputValue ? undefined : "inactive"}>{inputValue || option.placeholder || option.label}</Text>;
    $[59] = cursorOffset;
    $[60] = imagesSelected;
    $[61] = inputValue;
    $[62] = isFocused;
    $[63] = onExit;
    $[64] = onImagePaste;
    $[65] = onInputChange;
    $[66] = onSubmit;
    $[67] = option;
    $[68] = showLabel;
    $[69] = t32;
  } else {
    t32 = $[69];
  }
// 行组装：序号、子节点、输入区横向排列；紧凑版不收缩，展开版允许收缩。
  let t33;
  if ($[70] !== children || $[71] !== t28 || $[72] !== t31 || $[73] !== t32) {
    t33 = <Box flexDirection="row" flexShrink={t28}>{t31}{children}{t32}</Box>;
    $[70] = children;
    $[71] = t28;
    $[72] = t31;
    $[73] = t32;
    $[74] = t33;
  } else {
    t33 = $[74];
  }
// 外包一层选项外壳：焦点、选中、上下箭头状态透传，并声明「光标不由外壳提供」——输入型选项自己管光标。
  let t34;
  if ($[75] !== isFocused || $[76] !== isSelected || $[77] !== shouldShowDownArrow || $[78] !== shouldShowUpArrow || $[79] !== t33) {
    t34 = <SelectOption isFocused={isFocused} isSelected={isSelected} shouldShowDownArrow={shouldShowDownArrow} shouldShowUpArrow={shouldShowUpArrow} declareCursor={false}>{t33}</SelectOption>;
    $[75] = isFocused;
    $[76] = isSelected;
    $[77] = shouldShowDownArrow;
    $[78] = shouldShowUpArrow;
    $[79] = t33;
    $[80] = t34;
  } else {
    t34 = $[80];
  }
// 描述行：暗色，选中时绿、聚焦时高亮，缩进与输入区对齐。
  let t35;
  if ($[81] !== descriptionPaddingLeft || $[82] !== isFocused || $[83] !== isSelected || $[84] !== option.description || $[85] !== option.dimDescription) {
    t35 = option.description && <Box paddingLeft={descriptionPaddingLeft}><Text dimColor={option.dimDescription !== false} color={isSelected ? "success" : isFocused ? "suggestion" : undefined}>{option.description}</Text></Box>;
    $[81] = descriptionPaddingLeft;
    $[82] = isFocused;
    $[83] = isSelected;
    $[84] = option.description;
    $[85] = option.dimDescription;
    $[86] = t35;
  } else {
    t35 = $[86];
  }
// 附件缩略图行：每张图一个可点击引用，选中态由图片选择模式与下标共同决定；右侧提示在图片模式下列出方向键、删除、退出三个动作，聚焦时提示按下箭头可进入图片模式。
  let t36;
  if ($[87] !== descriptionPaddingLeft || $[88] !== imageAttachments || $[89] !== imagesSelected || $[90] !== isFocused || $[91] !== selectedImageIndex) {
    t36 = imageAttachments.length > 0 && <Box flexDirection="row" gap={1} paddingLeft={descriptionPaddingLeft}>{imageAttachments.map((img_0, idx) => <ClickableImageRef key={img_0.id} imageId={img_0.id} isSelected={!!imagesSelected && idx === selectedImageIndex} />)}<Box flexGrow={1} justifyContent="flex-start" flexDirection="row"><Text dimColor={true}>{imagesSelected ? <Byline>{imageAttachments.length > 1 && <><ConfigurableShortcutHint action="attachments:next" context="Attachments" fallback={"\u2192"} description="next" /><ConfigurableShortcutHint action="attachments:previous" context="Attachments" fallback={"\u2190"} description="prev" /></>}<ConfigurableShortcutHint action="attachments:remove" context="Attachments" fallback="backspace" description="remove" /><ConfigurableShortcutHint action="attachments:exit" context="Attachments" fallback="esc" description="cancel" /></Byline> : isFocused ? "(\u2193 to select)" : null}</Text></Box></Box>;
    $[87] = descriptionPaddingLeft;
    $[88] = imageAttachments;
    $[89] = imagesSelected;
    $[90] = isFocused;
    $[91] = selectedImageIndex;
    $[92] = t36;
  } else {
    t36 = $[92];
  }
// 展开版尾部补一个空行，让选项之间有呼吸感；紧凑版不加。
  let t37;
  if ($[93] !== layout) {
    t37 = layout === "expanded" && <Text> </Text>;
    $[93] = layout;
    $[94] = t37;
  } else {
    t37 = $[94];
  }
  let t38;
  if ($[95] !== t34 || $[96] !== t35 || $[97] !== t36 || $[98] !== t37) {
    t38 = <Box flexDirection="column" flexShrink={0}>{t34}{t35}{t36}{t37}</Box>;
    $[95] = t34;
    $[96] = t35;
    $[97] = t36;
    $[98] = t37;
    $[99] = t38;
  } else {
    t38 = $[99];
  }
  return t38;
}
// 编译器提升的谓词：只要图片类型的粘贴内容。
function _temp(c) {
  return c.type === "image";
}
// 原文件此处有一行 42108 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。