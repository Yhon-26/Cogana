import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import { BrandColors, Typography } from "@/constants/theme";

import logoAsset from "../assets/images/Logo01.png";

type LogoMode = "full" | "icon" | "wordmark";

type Props = {
  mode?: LogoMode;
  size?: number;
};

export function BrandLogo({ mode = "full", size = 48 }: Props) {
  if (mode === "icon") {
    return (
      <Image
        source={logoAsset}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="contain"
      />
    );
  }

  if (mode === "wordmark") {
    return <Text style={styles.wordmark}>COGUANA</Text>;
  }

  return (
    <View style={styles.row}>
      <Image
        source={logoAsset}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="contain"
      />
      <View style={styles.text}>
        <Text style={styles.name}>COGUANA</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  text: {
    flexShrink: 1,
  },
  name: {
    color: BrandColors.text,
    ...Typography.h3,
  },
  wordmark: {
    color: BrandColors.text,
    ...Typography.h3,
  },
});
