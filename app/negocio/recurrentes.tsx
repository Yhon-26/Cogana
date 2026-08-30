import {
  router,
  type Href,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { CommerceButton } from "@/components/commerce-ui";
import { OnlineScreen } from "@/components/online-shell";
import { BrandColors, Radius, Spacing, Typography } from "@/constants/theme";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { getMyBusinessContext } from "@/online/business-api";
import type { RecurringBusinessOrder } from "@/online/business-contracts";

export default function RecurringOrdersScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const [orders, setOrders] = useState<RecurringBusinessOrder[]>([]);
  useFocusEffect(
    useCallback(() => {
      void getMyBusinessContext()
        .then((context) =>
          setOrders(
            context.recurringOrders.filter(
              (order) => order.businessAccountId === businessId,
            ),
          ),
        )
        .catch((error) =>
          Alert.alert(
            "No se pudo cargar",
            getUserFacingErrorMessage(error, "Intenta nuevamente."),
          ),
        );
    }, [businessId]),
  );
  return (
    <OnlineScreen
      title="Abastecimiento"
      subtitle="Pedidos programados y recurrentes"
      cartHref={
        businessId
          ? (`/negocio/carrito?businessId=${businessId}` as Href)
          : null
      }
    >
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text style={styles.heroEyebrow}>COMPRA REPETITIVA</Text>
          <Text style={styles.heroTitle}>
            No vuelvas a armar la misma canasta
          </Text>
          <Text style={styles.heroText}>
            Programa tus insumos por semana, quincena o mes desde el carrito
            mayorista.
          </Text>
        </View>
        <CommerceButton
          compact
          icon="plus"
          label={orders.length ? "Crear otro" : "Crear abastecimiento"}
          onPress={() =>
            router.push(`/negocio/catalogo?businessId=${businessId}` as Href)
          }
          tone="accent"
        />
      </View>
      {orders.map((order) => (
        <View key={order.id} style={styles.card}>
          <View style={styles.top}>
            <Text style={styles.name}>{order.name}</Text>
            <Text style={styles.status}>
              {order.isActive ? "Activo" : "Pausado"}
            </Text>
          </View>
          <Text style={styles.meta}>
            {order.frequency === "weekly"
              ? "Semanal"
              : order.frequency === "biweekly"
                ? "Quincenal"
                : "Mensual"}{" "}
            · {order.items.length} productos
          </Text>
          <Text style={styles.next}>
            Próxima fecha: {new Date(order.nextRunAt).toLocaleString("es-PE")}
          </Text>
        </View>
      ))}
      {!orders.length ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>
            Aún no tienes compras programadas
          </Text>
          <Text style={styles.emptyText}>
            Agrega productos al carrito y elige una frecuencia antes de
            solicitar la cotización.
          </Text>
        </View>
      ) : null}
    </OnlineScreen>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.greenDark,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  heroCopy: { gap: Spacing.xxs },
  heroEyebrow: { color: BrandColors.gold, ...Typography.overline },
  heroTitle: { color: BrandColors.white, ...Typography.h3 },
  heroText: { color: BrandColors.greenMid, ...Typography.caption },
  card: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  name: { color: BrandColors.text, ...Typography.label },
  status: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
    backgroundColor: BrandColors.greenLight,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xxs,
    borderRadius: Radius.round,
  },
  meta: { color: BrandColors.muted, ...Typography.caption },
  next: { color: BrandColors.text, ...Typography.label },
  empty: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.xl,
    alignItems: "center",
    gap: Spacing.xs,
  },
  emptyTitle: {
    color: BrandColors.text,
    ...Typography.h3,
    textAlign: "center",
  },
  emptyText: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
});
