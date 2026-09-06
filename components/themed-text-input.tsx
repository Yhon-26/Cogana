import { forwardRef, useState } from "react";
import {
  Platform,
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
        style={[styles.base, style, isFocused && styles.focused]}
        underlineColorAndroid={underlineColorAndroid ?? "transparent"}
      />
    );
  },
);

// `base` mantiene siempre presentes las mismas claves de borde (aunque en 0 /
// transparente) para que el único cambio al enfocar sea el VALOR del color,
// nunca la aparición de una propiedad nueva. En Android, agregar borderWidth
// u outline* justo cuando el input recibe foco obliga a recrear la vista
// nativa del TextInput, lo que cierra el teclado y pierde el cursor de
// inmediato (el bug reportado). El aro ("outline") sólo se agrega en web,
// donde no existe ese problema de recreación de vista nativa.
const styles = StyleSheet.create({
  base: {
    borderWidth: 0,
    borderColor: "transparent",
  },
  focused: Platform.select({
    web: {
      borderColor: BrandColors.green,
      outlineColor: FocusRing.color,
      outlineOffset: FocusRing.offset,
      outlineStyle: "solid",
      outlineWidth: FocusRing.width,
    },
    default: {
      borderColor: BrandColors.green,
    },
  }),
});
