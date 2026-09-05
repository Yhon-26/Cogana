import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CommerceButton } from "@/components/commerce-ui";
import { BrandColors, Radius, Spacing, Typography } from "@/constants/theme";

export default function TermsScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.title}>Términos y privacidad</Text>
        <Text style={styles.text}>
          Cogana usa tus datos de contacto y dirección exclusivamente para
          gestionar tu cuenta, preparar pedidos, coordinar entregas y atender
          incidencias. Los importes de productos por peso son estimados hasta
          confirmar la cantidad preparada. Puedes solicitar actualización o
          eliminación de tus datos mediante el canal de soporte configurado por
          la tienda.
        </Text>
        <CommerceButton label="Entendido" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BrandColors.ink,
    padding: Spacing.lg,
    justifyContent: "center",
  },
  card: {
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.cream,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  title: { color: BrandColors.text, ...Typography.h2 },
  text: { color: BrandColors.muted, ...Typography.body },
});
