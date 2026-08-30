import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  router,
  type Href,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AdminScreen,
  Pill,
  PrimaryButton,
  SectionTitle,
  sharedStyles,
} from "@/components/admin-ui";
import { ModalSurface } from "@/components/modal-surface";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
import {
  BrandColors,
  ComponentMetrics,
  ControlSize,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useLocalOperator } from "@/context/local-operator-context";
import { parseDecimalToInteger } from "@/database/integer-calculations";
import type { InventoryMovementType, ProductRecord } from "@/database/models";
import {
  listInventoryMovements,
  recordInventoryMovement,
} from "@/database/repositories/inventory-repository";
import { getProductById } from "@/database/repositories/product-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { formatSoles } from "@/lib/money";
import { formatQuantity } from "@/lib/units";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import { useLocalDatabase } from "@/hooks/use-local-database";

type MovementMode = "purchase" | "adjustment";

export default function ProductDetailScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const database = useLocalDatabase();
  const { selectedUser, deviceId } = useLocalOperator();
  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [recentMovements, setRecentMovements] = useState<
    Awaited<ReturnType<typeof listInventoryMovements>>
  >([]);
  const [mode, setMode] = useState<MovementMode | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    if (!productId) {
      setProduct(null);
      setRecentMovements([]);
      setLoadError("No recibimos un identificador de producto válido.");
      setIsLoading(false);
      return;
    }

    try {
      const [nextProduct, movements] = await Promise.all([
        getProductById(database, DEFAULT_STORE_ID, productId),
        listInventoryMovements(database, DEFAULT_STORE_ID, productId),
      ]);
      setProduct(nextProduct);
      setRecentMovements(movements.slice(0, 4));
    } catch (caughtError) {
      setProduct(null);
      setRecentMovements([]);
      setLoadError(
        getOperatorErrorMessage(
          caughtError,
          "No se pudo consultar el producto.",
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

  const saveMovement = async () => {
    if (!product || !mode || !selectedUser) return;
    if (selectedUser.role !== "administrator") {
      Alert.alert(
        "Acceso restringido",
        "Solo un administrador puede ajustar stock.",
      );
      return;
    }
    const parsed = parseDecimalToInteger(quantity, 0);
    if (
      parsed === null ||
      parsed < 0 ||
      (mode === "purchase" && parsed === 0)
    ) {
      Alert.alert(
        "Cantidad inválida",
        "Ingresa una cantidad base entera válida.",
      );
      return;
    }
    const delta = mode === "purchase" ? parsed : parsed - product.stockQuantity;
    if (delta === 0) {
      Alert.alert(
        "Sin cambios",
        "El stock contado coincide con la existencia actual.",
      );
      return;
    }
    setIsSaving(true);
    try {
      await recordInventoryMovement(database, {
        storeId: DEFAULT_STORE_ID,
        productId: product.id,
        type: mode as InventoryMovementType,
        quantityDelta: delta,
        reason:
          reason.trim() ||
          (mode === "purchase" ? "Entrada de mercadería" : "Ajuste por conteo"),
        actorUserId: selectedUser.id,
        deviceId,
      });
      setMode(null);
      setQuantity("");
      setReason("");
      await load();
      Alert.alert(
        "Inventario actualizado",
        "El movimiento quedó auditado y en outbox.",
      );
    } catch (error) {
      Alert.alert(
        "No se pudo guardar",
        getOperatorErrorMessage(error, "No se pudo guardar el movimiento."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <AdminScreen
        back
        eyebrow="INVENTARIO"
        title="Producto"
        subtitle="Consultando existencias y movimientos"
      >
        <View style={[sharedStyles.card, styles.stateCard]}>
          <ActivityIndicator
            accessibilityLabel="Cargando detalle del producto"
            color={BrandColors.green}
            size="small"
          />
          <Text accessibilityLiveRegion="polite" style={styles.stateTitle}>
            Cargando producto…
          </Text>
          <Text style={styles.stateText}>
            Buscando la información más reciente.
          </Text>
        </View>
      </AdminScreen>
    );
  }

  if (loadError) {
    return (
      <AdminScreen
        back
        eyebrow="INVENTARIO"
        title="Producto"
        subtitle="No pudimos abrir el detalle"
      >
        <View style={[sharedStyles.card, styles.stateCard]}>
          <MaterialCommunityIcons
            name="cloud-alert-outline"
            size={32}
            color={BrandColors.danger}
          />
          <Text style={styles.stateTitle}>No se pudo cargar el producto</Text>
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
        eyebrow="INVENTARIO"
        title="Producto no disponible"
        subtitle="El registro ya no está en el catálogo"
      >
        <View style={[sharedStyles.card, styles.stateCard]}>
          <MaterialCommunityIcons
            name="package-variant-remove"
            size={32}
            color={BrandColors.muted}
          />
          <Text accessibilityLiveRegion="polite" style={styles.stateTitle}>
            No encontramos este producto
          </Text>
          <Text style={styles.stateText}>
            Puede haber sido retirado o el enlace ya no ser válido.
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

  const low = product.stockQuantity <= product.minimumStockQuantity;
  return (
    <AdminScreen
      back
      eyebrow="DETALLE DE INVENTARIO"
      title={product.name}
      subtitle={`${product.sku} · ${product.category}`}
    >
      <View style={[sharedStyles.card, styles.heroCard]}>
        <View style={styles.rowBetween}>
          <Pill
            label={
              !product.isActive ? "Inactivo" : low ? "Stock bajo" : "Disponible"
            }
            tone={!product.isActive ? "neutral" : low ? "gold" : "green"}
          />
          <Text style={styles.version}>v{product.version}</Text>
        </View>
        <Text style={styles.stock}>
          {formatQuantity(product.baseUnit, product.stockQuantity)}
        </Text>
        <Text style={styles.muted}>
          Mínimo{" "}
          {formatQuantity(product.baseUnit, product.minimumStockQuantity)} ·
          Precio {formatSoles(product.priceCents)} por{" "}
          {formatQuantity(product.baseUnit, product.pricingQuantity)}
        </Text>
      </View>

      {selectedUser?.role === "administrator" ? (
        <View style={styles.actionGrid}>
          <Action
            icon="truck-delivery-outline"
            label="Entrada"
            onPress={() => setMode("purchase")}
          />
          <Action
            icon="scale-balance"
            label="Ajustar"
            onPress={() => setMode("adjustment")}
          />
          <Action
            icon="pencil-outline"
            label="Editar"
            onPress={() =>
              router.push(`/inventario/${product.id}/editar` as Href)
            }
          />
        </View>
      ) : null}

      <SectionTitle
        action={
          <Pressable
            accessibilityLabel="Ver todos los movimientos"
            accessibilityRole="button"
            onPress={() =>
              router.push(`/inventario/${product.id}/movimientos` as Href)
            }
            style={styles.linkButton}
          >
            <Text style={styles.link}>Ver todos</Text>
          </Pressable>
        }
      >
        Movimientos recientes
      </SectionTitle>
      <View style={[sharedStyles.card, styles.movements]}>
        {recentMovements.length === 0 ? (
          <Text style={styles.muted}>Aún no hay movimientos registrados.</Text>
        ) : (
          recentMovements.map((movement) => (
            <View key={movement.id} style={styles.movementRow}>
              <MaterialCommunityIcons
                name={movement.quantityDelta > 0 ? "arrow-up" : "arrow-down"}
                size={18}
                color={
                  movement.quantityDelta > 0
                    ? BrandColors.green
                    : BrandColors.warning
                }
              />
              <View style={styles.movementCopy}>
                <Text style={styles.movementReason}>{movement.reason}</Text>
                <Text style={styles.movementDate}>
                  {new Date(movement.createdAt).toLocaleString("es-PE")}
                </Text>
              </View>
              <Text style={styles.movementQuantity}>
                {movement.quantityDelta > 0 ? "+" : ""}
                {formatQuantity(product.baseUnit, movement.quantityDelta)}
              </Text>
            </View>
          ))
        )}
      </View>

      <ModalSurface
        animationType="slide"
        dialogStyle={styles.modalCard}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setMode(null);
        }}
        placement="bottom"
        visible={mode !== null}
      >
        <View style={styles.rowBetween}>
          <Text style={styles.modalTitle}>
            {mode === "purchase" ? "Entrada de mercadería" : "Ajuste de stock"}
          </Text>
          <Pressable
            accessibilityLabel="Cerrar movimiento de inventario"
            accessibilityRole="button"
            accessibilityState={{ disabled: isSaving }}
            disabled={isSaving}
            onPress={() => setMode(null)}
            style={({ pressed }) => [
              styles.closeButton,
              isSaving && styles.disabled,
              pressed && !isSaving && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons
              name="close"
              size={24}
              color={BrandColors.text}
            />
          </Pressable>
        </View>
        <Text style={styles.muted}>
          {mode === "purchase"
            ? `Cantidad que ingresa en ${product.baseUnit === "gram" ? "gramos" : "unidades"}.`
            : `Existencia final contada en ${product.baseUnit === "gram" ? "gramos" : "unidades"}.`}
        </Text>
        <View style={styles.modalField}>
          <Text style={styles.fieldLabel}>
            {mode === "purchase"
              ? "Cantidad que ingresa"
              : "Existencia final contada"}
          </Text>
          <TextInput
            accessibilityLabel={
              mode === "purchase"
                ? "Cantidad que ingresa"
                : "Existencia final contada"
            }
            keyboardType="number-pad"
            onChangeText={setQuantity}
            placeholder="0"
            placeholderTextColor={BrandColors.muted}
            style={styles.input}
            value={quantity}
          />
        </View>
        <View style={styles.modalField}>
          <Text style={styles.fieldLabel}>
            {mode === "purchase"
              ? "Proveedor, factura o referencia"
              : "Motivo del ajuste"}
          </Text>
          <TextInput
            accessibilityLabel={
              mode === "purchase"
                ? "Proveedor, factura o referencia"
                : "Motivo del ajuste"
            }
            onChangeText={setReason}
            placeholder={
              mode === "purchase"
                ? "Ej. Factura F001-123"
                : "Describe la diferencia"
            }
            placeholderTextColor={BrandColors.muted}
            style={styles.input}
            value={reason}
          />
        </View>
        <PrimaryButton
          disabled={isSaving}
          label={isSaving ? "Guardando…" : "Confirmar movimiento"}
          loading={isSaving}
          onPress={() => void saveMovement()}
        />
      </ModalSurface>
    </AdminScreen>
  );
}

function Action({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[sharedStyles.card, styles.action]}
    >
      <MaterialCommunityIcons name={icon} size={23} color={BrandColors.green} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
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
  heroCard: { gap: Spacing.xs },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  version: { color: BrandColors.muted, ...Typography.overline },
  stock: { color: BrandColors.text, ...Typography.display },
  muted: { color: BrandColors.muted, ...Typography.caption },
  actionGrid: { flexDirection: "row", gap: Spacing.xs },
  action: {
    flex: 1,
    minHeight: ControlSize.large,
    alignItems: "center",
    gap: Spacing.xs,
    padding: Spacing.sm,
  },
  actionText: { color: BrandColors.text, ...Typography.label },
  linkButton: { minHeight: ControlSize.default, justifyContent: "center" },
  link: { color: BrandColors.green, ...Typography.label },
  movements: { paddingVertical: Spacing.xxs },
  movementRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.line,
  },
  movementCopy: { flex: 1 },
  movementReason: { color: BrandColors.text, ...Typography.label },
  movementDate: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  movementQuantity: { color: BrandColors.text, ...Typography.label },
  modalCard: {
    backgroundColor: BrandColors.cream,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
  },
  modalTitle: { color: BrandColors.text, ...Typography.h2 },
  closeButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
  },
  modalField: { gap: Spacing.xxs },
  fieldLabel: { color: BrandColors.text, ...Typography.label },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  disabled: { opacity: Interaction.disabledOpacity },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
  },
});
