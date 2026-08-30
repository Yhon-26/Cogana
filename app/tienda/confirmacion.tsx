import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { CommerceButton, TrustItem } from "@/components/commerce-ui";
import { OnlineScreen } from "@/components/online-shell";
import { BrandColors, Radius, Spacing, Typography } from "@/constants/theme";

export default function OrderConfirmationScreen() {
  const { numero, total } = useLocalSearchParams<{
    numero: string;
    total: string;
  }>();
  return (
    <OnlineScreen
      title="Pedido recibido"
      subtitle="Ya estamos coordinando tu compra"
    >
      <View style={styles.card}>
        <View style={styles.confettiRow}>
          <View style={[styles.confetti, styles.confettiGold]} />
          <View style={[styles.confetti, styles.confettiGreen]} />
          <View style={[styles.confetti, styles.confettiSand]} />
        </View>
        <View style={styles.icon}>
          <MaterialCommunityIcons
            name="check-bold"
            size={40}
            color={BrandColors.white}
          />
        </View>
        <Text style={styles.eyebrow}>¡LISTO!</Text>
        <Text style={styles.title}>Tu pedido ya está en marcha</Text>
        <Text style={styles.text}>
          Te avisaremos en cada avance. Si compraste productos por peso, verás
          el total final antes de completar la entrega.
        </Text>
        <View style={styles.receipt}>
          <View>
            <Text style={styles.receiptLabel}>NÚMERO DE PEDIDO</Text>
            <Text style={styles.number}>{numero}</Text>
          </View>
          <View style={styles.receiptAmount}>
            <Text style={styles.receiptLabel}>ESTIMADO</Text>
            <Text style={styles.total}>
              S/ {(Number(total || 0) / 100).toFixed(2)}
            </Text>
          </View>
        </View>
        <CommerceButton
          icon="map-marker-path"
          label="Seguir mi pedido"
          onPress={() => router.replace("/tienda/pedidos" as Href)}
          style={styles.button}
        />
        <CommerceButton
          label="Seguir comprando"
          onPress={() => router.replace("/tienda" as Href)}
          style={styles.button}
          tone="ghost"
        />
      </View>
      <View style={styles.trust}>
        <TrustItem icon="bell-check-outline">
          Recibirás actualizaciones del pedido
        </TrustItem>
        <TrustItem icon="shield-check-outline">
          Tu compra queda registrada y protegida
        </TrustItem>
      </View>
    </OnlineScreen>
  );
}
const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.xl,
    alignItems: "center",
    gap: Spacing.sm,
    overflow: "hidden",
  },
  confettiRow: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    top: Spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  confetti: { width: 12, height: 30, borderRadius: Radius.round },
  confettiGold: {
    backgroundColor: BrandColors.gold,
    transform: [{ rotate: "-24deg" }],
  },
  confettiGreen: {
    backgroundColor: BrandColors.greenMid,
    transform: [{ rotate: "18deg" }],
  },
  confettiSand: {
    backgroundColor: BrandColors.sand,
    transform: [{ rotate: "36deg" }],
  },
  icon: {
    width: 82,
    height: 82,
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.xs,
  },
  eyebrow: {
    color: BrandColors.green,
    ...Typography.overline,
    marginTop: Spacing.xxs,
  },
  title: { color: BrandColors.text, ...Typography.h2, textAlign: "center" },
  text: { color: BrandColors.muted, ...Typography.body, textAlign: "center" },
  receipt: {
    alignSelf: "stretch",
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.cream,
    padding: Spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: Spacing.xs,
  },
  receiptLabel: { color: BrandColors.muted, ...Typography.overline },
  number: {
    color: BrandColors.greenDark,
    ...Typography.h3,
    marginTop: Spacing.xxs,
  },
  receiptAmount: { alignItems: "flex-end" },
  total: { color: BrandColors.text, ...Typography.h3, marginTop: Spacing.xxs },
  button: { alignSelf: "stretch" },
  trust: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.greenLight,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
});
