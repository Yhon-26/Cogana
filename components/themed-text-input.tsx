import { forwardRef, useState } from "react";
import {
  StyleSheet,
  TextInput as NativeTextInput,
  type TextInputProps,
} from "react-native";

import { BrandColors, FocusRing } from "@/constants/theme";

/**
 * Campo base de Cogana. Conserva todas las propiedades nativas y añade el
 * indicador de foco compartido sin modificar el tamaño del control.
 */
export const ThemedTextInput = forwardRef<NativeTextInput, TextInputProps>(
  function ThemedTextInput(
    {
      cursorColor,
      onBlur,
      onFocus,
      placeholderTextColor,
      selectionColor,
      style,
      underlineColorAndroid,
      ...props
    },
    ref,
  ) {
    const [isFocused, setIsFocused] = useState(false);

    return (
      <NativeTextInput
        {...props}
        ref={ref}
        cursorColor={cursorColor ?? BrandColors.greenDark}
        onBlur={(event) => {
          setIsFocused(false);
          onBlur?.(event);
        }}
        onFocus={(event) => {
          setIsFocused(true);
          onFocus?.(event);
        }}
        placeholderTextColor={placeholderTextColor ?? BrandColors.muted}
        selectionColor={selectionColor ?? BrandColors.greenMid}
        style={[style, isFocused && styles.focused]}
        underlineColorAndroid={underlineColorAndroid ?? "transparent"}
      />
    );
  },
);

const styles = StyleSheet.create({
  focused: {
    borderColor: BrandColors.green,
    outlineColor: FocusRing.color,
    outlineOffset: FocusRing.offset,
    outlineStyle: "solid",
    outlineWidth: FocusRing.width,
  },
});
