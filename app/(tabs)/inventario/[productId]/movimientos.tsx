import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  router,
  type Href,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import {
  AdminScreen,
  Pill,
  PrimaryButton,
  sharedStyles,
} from "@/components/admin-ui";
import {
  BrandColors,
  ControlSize,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import type { InventoryMovementRecord, ProductRecord } from "@/database/models";
import { listInventoryMovements } from "@/database/repositories/inventory-repository";
import { getProductById } from "@/database/repositories/product-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { useLocalDatabase } from "@/hooks/use-local-database";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import { formatDateTime } from "@/lib/format";

const labels: Record<InventoryMovementRecord["type"], string> = {
  opening: "Apertura",
  purchase: "Entrada",
  sale: "Venta",
  adjustment: "Ajuste",
  waste: "Merma",
  return: "Devolución",
};

export default function InventoryMovementsScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const database = useLocalDatabase();
  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [movements, setMovements] = useState<InventoryMovementRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    if (!productId) {
      setProduct(null);
      setMovements([]);
      setLoadError("No recibimos un identificador de producto válido.");
      setIsLoading(false);
      return;
    }

    try {
      const [nextProduct, nextMovements] = await Promise.all([
        getProductById(database, DEFAULT_STORE_ID, productId),
        listInventoryMovements(database, DEFAULT_STORE_ID, productId),
      ]);
      setProduct(nextProduct);
      setMovements(nextMovements);
    } catch (caughtError) {
      setProduct(null);
      setMovements([]);
      setLoadError(
        getOperatorErrorMessage(
          caughtError,
          "No se pudieron consultar los movimientos.",
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }, [database, productId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (isLoading) {
    return (
      <AdminScreen
        back
        eyebrow="KARDEX"
        title="Movimientos"
        subtitle="Consultando el historial del producto"
      >
        <View style={[sharedStyles.card, styles.stateCard]}>
          <ActivityIndicator
            accessibilityLabel="Cargando movimientos de inventario"
            color={BrandColors.green}
            size="small"
          />
          <Text accessibilityLiveRegion="polite" style={styles.stateTitle}>
            Cargando movimientos…
          </Text>
          <Text style={styles.stateText}>
            Reuniendo entradas, ventas y ajustes.
          </Text>
        </View>
      </AdminScreen>
    );
  }

  if (loadError) {
    return (
      <AdminScreen
        back
        eyebrow="KARDEX"
        title="Movimientos"
        subtitle="No pudimos abrir el historial"
      >
        <View style={[sharedStyles.card, styles.stateCard]}>
          <MaterialCommunityIcons
            name="cloud-alert-outline"
            size={32}
            color={BrandColors.danger}
          />
          <Text style={styles.stateTitle}>
            No se pudieron cargar los movimientos
          </Text>
          <Text
            accessibilityLiveRegion="assertive"
            accessibilityRole="alert"
            style={styles.stateText}
          >
            {loadError}
          </Text>
          <PrimaryButton
            icon="refresh"
            label="Intentar nuevamente"
            onPress={() => void load()}
            style={styles.stateAction}
          />
        </View>
      </AdminScreen>
    );
  }

  if (!product) {
    return (
      <AdminScreen
        back
        eyebrow="KARDEX"
        title="Producto no disponible"
        subtitle="No encontramos el registro solicitado"
      >
        <View style={[sharedStyles.card, styles.stateCard]}>
          <MaterialCommunityIcons
            name="package-variant-remove"
            size={32}
            color={BrandColors.muted}
          />
          <Text accessibilityLiveRegion="polite" style={styles.stateTitle}>
            Este historial ya no está disponible
          </Text>
          <Text style={styles.stateText}>
            Vuelve al inventario para elegir otro producto.
          </Text>
          <PrimaryButton
            icon="warehouse"
            label="Volver al inventario"
            onPress={() => router.replace("/inventario" as Href)}
            style={styles.stateAction}
          />
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen
      back
      eyebrow="KARDEX"
      title="Movimientos"
      subtitle={product.name}
    >
      <View style={styles.list}>
        {movements.map((movement) => (
          <View key={movement.id} style={[sharedStyles.card, styles.card]}>
            <View style={styles.top}>
              <Pill
                label={labels[movement.type]}
                tone={movement.quantityDelta >= 0 ? "green" : "gold"}
              />
              <Text style={styles.quantity}>
                {movement.quantityDelta > 0 ? "+" : ""}
                {movement.quantityDelta}{" "}
                {product?.baseUnit === "gram" ? "g" : "un."}
              </Text>
            </View>
            <Text style={styles.reason}>{movement.reason}</Text>
            <Text style={styles.meta}>
              {formatDateTime(new Date(movement.createdAt))} · v
              {movement.version}
            </Text>
          </View>
        ))}
        {movements.length === 0 ? (
          <View style={[sharedStyles.card, styles.emptyCard]}>
            <View style={styles.emptyIcon}>
              <MaterialCommunityIcons
                name="swap-vertical"
                size={28}
                color={BrandColors.greenDark}
              />
            </View>
            <Text accessibilityLiveRegion="polite" style={styles.stateTitle}>
              Aún no hay movimientos
            </Text>
            <Text style={styles.stateText}>
              Las entradas, ventas y ajustes aparecerán aquí cuando se
              registren.
            </Text>
          </View>
        ) : null}
      </View>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  stateCard: { alignItems: "center", gap: Spacing.sm, padding: Spacing.xl },
  stateTitle: {
    color: BrandColors.text,
    ...Typography.h3,
    textAlign: "center",
  },
  stateText: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
  stateAction: { alignSelf: "stretch", marginTop: Spacing.xs },
  list: { gap: Spacing.sm },
  emptyCard: { alignItems: "center", gap: Spacing.xs, padding: Spacing.xl },
  emptyIcon: {
    width: ControlSize.large,
    height: ControlSize.large,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  card: { gap: Spacing.xs },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  quantity: { color: BrandColors.text, ...Typography.h3 },
  reason: { color: BrandColors.text, ...Typography.label },
  meta: { color: BrandColors.muted, ...Typography.caption },
});
