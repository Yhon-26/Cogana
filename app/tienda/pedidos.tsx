import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href, useFocusEffect } from "expo-router";
import * as Linking from "expo-linking";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { CommerceButton } from "@/components/commerce-ui";
import { ModalSurface } from "@/components/modal-surface";
import { OnlineScreen } from "@/components/online-shell";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
import {
  BrandColors,
  ComponentMetrics,
  ControlSize,
  Elevation,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useCart } from "@/context/cart-context";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import type { OnlineOrder } from "@/online/contracts";
import {
  cancelMyOnlineOrder,
  decideMyOrderSubstitution,
  getMyOnlineOrders,
  getOnlineCatalog,
} from "@/online/store-api";

const labels: Record<string, string> = {
  received: "Recibido",
  confirmed: "Confirmado",
  preparing: "En preparación",
  weight_review: "Revisión de peso",
  ready: "Listo",
  out_for_delivery: "En reparto",
  ready_for_pickup: "Listo para recojo",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

const activeStatuses = new Set([
  "received",
  "confirmed",
  "preparing",
  "weight_review",
  "ready",
  "out_for_delivery",
  "ready_for_pickup",
]);

export default function MyOrdersScreen() {
  const { addItem } = useCart();
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cancelOrder, setCancelOrder] = useState<OnlineOrder | null>(null);
  const [detailOrder, setDetailOrder] = useState<OnlineOrder | null>(null);
  const [reason, setReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setOrders(await getMyOnlineOrders());
    } catch (caughtError) {
      setError(
        getUserFacingErrorMessage(
          caughtError,
          "No se pudieron cargar tus pedidos.",
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const confirmCancel = async () => {
    if (!cancelOrder || !reason.trim() || isCancelling) return;
    setIsCancelling(true);
    try {
      await cancelMyOnlineOrder(cancelOrder.id, reason);
      setCancelOrder(null);
      setReason("");
      await load();
    } catch (caughtError) {
      Alert.alert(
        "No se pudo cancelar",
        getUserFacingErrorMessage(caughtError, "Intenta nuevamente."),
      );
    } finally {
      setIsCancelling(false);
    }
  };

  const repeatOrder = async (order: OnlineOrder) => {
    try {
      const catalog = await getOnlineCatalog();
      let added = 0;
      for (const item of order.items) {
        const product = catalog.products.find(
          (candidate) => candidate.id === item.productId,
        );
        if (!product || product.stockQuantity <= 0) continue;
        try {
          addItem(
            product,
            Math.min(item.requestedQuantity, product.stockQuantity),
          );
          added += 1;
        } catch {
          // Continúa con los productos que sí caben en el carrito actual.
        }
      }
      if (!added)
        throw new Error("Ningún producto del pedido está disponible.");
      router.push("/tienda/carrito" as Href);
    } catch (error) {
      Alert.alert(
        "No se pudo repetir",
        getUserFacingErrorMessage(error, "Intenta nuevamente."),
      );
    }
  };

  const decideSubstitution = async (
    substitutionId: string,
    accept: boolean,
  ) => {
    try {
      await decideMyOrderSubstitution(substitutionId, accept);
      await load();
    } catch (caughtError) {
      Alert.alert(
        "No se pudo responder",
        getUserFacingErrorMessage(caughtError, "Intenta nuevamente."),
      );
    }
  };

  const sortedOrders = useMemo(
    () =>
      [...orders].sort((left, right) => {
        const activeDifference =
          Number(activeStatuses.has(right.status)) -
          Number(activeStatuses.has(left.status));
        return (
          activeDifference || right.createdAt.localeCompare(left.createdAt)
        );
      }),
    [orders],
  );
  const activeCount = orders.filter((order) =>
    activeStatuses.has(order.status),
  ).length;

  return (
    <OnlineScreen
      title="Mis pedidos"
      subtitle={
        activeCount
          ? `${activeCount} en curso`
          : "Historial y compras frecuentes"
      }
      showBottomNav
    >
      <View style={styles.intro}>
        <View style={styles.introIcon}>
          <MaterialCommunityIcons
            name={activeCount ? "package-variant" : "history"}
            size={24}
            color={BrandColors.greenDark}
          />
        </View>
        <View style={styles.introCopy}>
          <Text style={styles.introTitle}>
            {activeCount
              ? "Estamos trabajando en tu compra"
              : "Tu historial, listo para repetir"}
          </Text>
          <Text style={styles.introText}>
            {activeCount
              ? "Aquí verás cada avance y cualquier decisión pendiente."
              : "Vuelve a llenar tu carrito desde cualquier pedido anterior."}
          </Text>
        </View>
      </View>

      {error ? (
        <Pressable
          accessibilityLabel={`${error}. Toca para intentar nuevamente`}
          accessibilityLiveRegion="polite"
          accessibilityRole="button"
          onPress={() => void load()}
          style={({ pressed }) => [styles.errorCard, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={20}
            color={BrandColors.danger}
          />
          <View style={styles.introCopy}>
            <Text style={styles.error}>{error}</Text>
            <Text style={styles.retry}>Toca para intentar nuevamente</Text>
          </View>
        </Pressable>
      ) : null}

      {isLoading ? (
        <View style={styles.loadingCard}>
          <MaterialCommunityIcons
            name="package-variant"
            size={26}
            color={BrandColors.green}
          />
          <Text style={styles.loadingText}>Cargando tus pedidos…</Text>
        </View>
      ) : null}

      {sortedOrders.map((order) => {
        const active = activeStatuses.has(order.status);
        const visibleItems = order.items.slice(0, 3);
        const latestEvents = order.history.slice(-2);
        return (
          <Pressable
            accessibilityLabel={`Ver detalle del pedido ${order.orderNumber}`}
            accessibilityRole="button"
            key={order.id}
            onPress={() => setDetailOrder(order)}
            style={({ pressed }) => [
              styles.card,
              pressed && styles.cardPressed,
            ]}
          >
            <View style={styles.top}>
              <View style={styles.orderIdentity}>
                <View
                  style={[styles.orderIcon, active && styles.orderIconActive]}
                >
                  <MaterialCommunityIcons
                    name={
                      active
                        ? "package-variant-closed-check"
                        : "receipt-text-outline"
                    }
                    size={21}
                    color={active ? BrandColors.greenDark : BrandColors.muted}
                  />
                </View>
                <View>
                  <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.number}>
                    {order.orderNumber}
                  </Text>
                  <Text style={styles.date}>
                    {new Date(order.createdAt).toLocaleDateString("es-PE", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </Text>
                </View>
              </View>
              <View style={[styles.status, !active && styles.statusNeutral]}>
                <Text
                  style={[
                    styles.statusText,
                    !active && styles.statusTextNeutral,
                  ]}
                >
                  {labels[order.status] ?? order.status}
                </Text>
              </View>
            </View>

            <View style={styles.items}>
              {visibleItems.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <View style={styles.itemDot} />
                  <Text numberOfLines={1} style={styles.itemName}>
                    {item.productName}
                  </Text>
                  <Text style={styles.itemQuantity}>
                    {item.requestedQuantity}{" "}
                    {item.baseUnit === "gram" ? "g" : "un."}
                  </Text>
                </View>
              ))}
              {order.items.length > visibleItems.length ? (
                <Text style={styles.moreItems}>
                  + {order.items.length - visibleItems.length} productos más ·
                  toca para ver todo
                </Text>
              ) : null}
            </View>

            <View style={styles.totalRow}>
              <View style={styles.fulfillment}>
                <MaterialCommunityIcons
                  name={
                    order.fulfillmentType === "delivery"
                      ? "moped-outline"
                      : "store-marker-outline"
                  }
                  size={17}
                  color={BrandColors.muted}
                />
                <Text style={styles.meta}>
                  {order.fulfillmentType === "delivery" ? "Delivery" : "Recojo"}{" "}
                  · {order.paymentMethod.toUpperCase()}
                </Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={styles.total}>
                S/{" "}
                {(
                  (order.finalTotalCents ?? order.estimatedTotalCents) / 100
                ).toFixed(2)}
              </Text>
            </View>

            {active ? (
              <View style={styles.timeline}>
                {latestEvents.map((event, index) => (
                  <View
                    key={`${event.status}-${event.createdAt}`}
                    style={styles.event}
                  >
                    <View
                      style={[
                        styles.dot,
                        index === latestEvents.length - 1 && styles.dotActive,
                      ]}
                    />
                    <Text style={styles.eventText}>
                      {labels[event.status] ?? event.status}
                      {event.reason ? ` · ${event.reason}` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {order.substitutions.map((substitution) => (
              <View key={substitution.id} style={styles.substitution}>
                <Text style={styles.substitutionTitle}>
                  Reemplazo: {substitution.replacementProductName}
                </Text>
                {substitution.notes ? (
                  <Text style={styles.item}>{substitution.notes}</Text>
                ) : null}
                {substitution.status === "proposed" ? (
                  <View style={styles.substitutionActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        void decideSubstitution(substitution.id, false)
                      }
                      style={({ pressed }) => [
                        styles.rejectButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.rejectText}>Rechazar</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        void decideSubstitution(substitution.id, true)
                      }
                      style={({ pressed }) => [
                        styles.acceptButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.acceptText}>Aceptar</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.substitutionStatus}>
                    {substitution.status === "accepted"
                      ? "Aceptado"
                      : "Rechazado"}
                  </Text>
                )}
              </View>
            ))}
            {order.deliveryTracking ? (
              <View style={styles.tracking}>
                <Text style={styles.substitutionTitle}>
                  Delivery:{" "}
                  {order.deliveryTracking.status === "en_route"
                    ? "En ruta"
                    : order.deliveryTracking.status}
                </Text>
                {order.deliveryTracking.startedAt ? (
                  <Text style={styles.item}>
                    Salió{" "}
                    {new Date(order.deliveryTracking.startedAt).toLocaleString(
                      "es-PE",
                    )}
                  </Text>
                ) : null}
                {order.deliveryTracking.recipientName ? (
                  <Text style={styles.item}>
                    Recibido por {order.deliveryTracking.recipientName}
                  </Text>
                ) : null}
                {order.deliveryTracking.trackingUrl ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() =>
                      void Linking.openURL(
                        order.deliveryTracking?.trackingUrl as string,
                      )
                    }
                    style={styles.trackingLinkButton}
                  >
                    <Text style={styles.trackingLink}>
                      Abrir seguimiento en vivo
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={styles.actions}>
              <CommerceButton
                compact
                icon="repeat"
                label="Repetir compra"
                onPress={() => void repeatOrder(order)}
                style={styles.repeatButton}
                tone={active ? "ghost" : "primary"}
              />
              {["received", "confirmed"].includes(order.status) ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setCancelOrder(order)}
                  style={({ pressed }) => [
                    styles.cancelButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.cancel}>Cancelar</Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      {!isLoading && !orders.length && !error ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons
              name="receipt-text-outline"
              size={34}
              color={BrandColors.green}
            />
          </View>
          <Text style={styles.emptyTitle}>Tu primer pedido empieza aquí</Text>
          <Text style={styles.emptyText}>
            Cuando compres, podrás seguir el pedido y repetirlo desde esta
            pantalla.
          </Text>
          <CommerceButton
            label="Ir a la tienda"
            onPress={() => router.replace("/tienda" as Href)}
            style={styles.emptyButton}
          />
        </View>
      ) : null}

      <ModalSurface
        dialogStyle={styles.modal}
        dismissOnBackdrop={!isCancelling}
        onClose={() => {
          if (!isCancelling) setCancelOrder(null);
        }}
        visible={cancelOrder !== null}
      >
        <Text style={styles.modalTitle}>
          Cancelar {cancelOrder?.orderNumber}
        </Text>
        <View style={styles.modalField}>
          <Text style={styles.fieldLabel}>Motivo de cancelación</Text>
          <TextInput
            accessibilityLabel="Motivo de cancelación"
            onChangeText={setReason}
            placeholder="Ej. Ya no necesito el pedido"
            placeholderTextColor={BrandColors.muted}
            style={styles.input}
            value={reason}
          />
          <Text style={styles.fieldHelper}>
            Esta explicación quedará registrada en el pedido.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            busy: isCancelling,
            disabled: !reason.trim() || isCancelling,
          }}
          disabled={!reason.trim() || isCancelling}
          onPress={() => void confirmCancel()}
          style={({ pressed }) => [
            styles.dangerButton,
            (!reason.trim() || isCancelling) && styles.disabled,
            pressed &&
              Boolean(reason.trim()) &&
              !isCancelling &&
              styles.pressed,
          ]}
        >
          <Text style={styles.dangerText}>
            {isCancelling ? "Cancelando…" : "Confirmar cancelación"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isCancelling }}
          disabled={isCancelling}
          onPress={() => setCancelOrder(null)}
          style={[styles.backButton, isCancelling && styles.disabled]}
        >
          <Text style={styles.back}>Volver</Text>
        </Pressable>
      </ModalSurface>

      <ModalSurface
        animationType="slide"
        onClose={() => setDetailOrder(null)}
        placement="bottom"
        visible={detailOrder !== null}
      >
        {detailOrder ? (
          <>
            <View style={styles.detailHeader}>
              <View style={styles.detailHeaderCopy}>
                <Text maxFontSizeMultiplier={1.3} style={styles.detailTitle}>
                  {detailOrder.orderNumber}
                </Text>
                <Text style={styles.detailDate}>
                  {new Date(detailOrder.createdAt).toLocaleDateString("es-PE", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </Text>
              </View>
              <View
                style={[
                  styles.status,
                  !activeStatuses.has(detailOrder.status) &&
                    styles.statusNeutral,
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    !activeStatuses.has(detailOrder.status) &&
                      styles.statusTextNeutral,
                  ]}
                >
                  {labels[detailOrder.status] ?? detailOrder.status}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Cerrar detalle del pedido"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setDetailOrder(null)}
                style={styles.detailClose}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={BrandColors.muted}
                />
              </Pressable>
            </View>

            <Text style={styles.detailSectionLabel}>
              PRODUCTOS ({detailOrder.items.length})
            </Text>
            <FlatList
              data={detailOrder.items}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.detailItemRow}>
                  <View style={styles.itemDot} />
                  <View style={styles.detailItemCopy}>
                    <Text numberOfLines={2} style={styles.detailItemName}>
                      {item.productName}
                    </Text>
                    <Text style={styles.detailItemQuantity}>
                      {item.preparedQuantity ?? item.requestedQuantity}{" "}
                      {item.baseUnit === "gram" ? "g" : "un."}
                      {item.preparedQuantity !== null &&
                      item.preparedQuantity !== item.requestedQuantity
                        ? ` (pediste ${item.requestedQuantity} ${item.baseUnit === "gram" ? "g" : "un."})`
                        : ""}
                    </Text>
                  </View>
                  <Text style={styles.detailItemAmount}>
                    S/{" "}
                    {((item.finalCents ?? item.estimatedCents) / 100).toFixed(
                      2,
                    )}
                  </Text>
                </View>
              )}
              style={styles.detailList}
            />

            <View style={styles.detailTotalRow}>
              <View style={styles.fulfillment}>
                <MaterialCommunityIcons
                  name={
                    detailOrder.fulfillmentType === "delivery"
                      ? "moped-outline"
                      : "store-marker-outline"
                  }
                  size={17}
                  color={BrandColors.muted}
                />
                <Text style={styles.meta}>
                  {detailOrder.fulfillmentType === "delivery"
                    ? "Delivery"
                    : "Recojo"}{" "}
                  · {detailOrder.paymentMethod.toUpperCase()}
                </Text>
              </View>
              <Text maxFontSizeMultiplier={1.4} style={styles.total}>
                S/{" "}
                {(
                  (detailOrder.finalTotalCents ??
                    detailOrder.estimatedTotalCents) / 100
                ).toFixed(2)}
              </Text>
            </View>
          </>
        ) : null}
      </ModalSurface>
    </OnlineScreen>
  );
}

const styles = StyleSheet.create({
  intro: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.greenLight,
    padding: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  introIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  introCopy: { flex: 1 },
  introTitle: { color: BrandColors.greenDark, ...Typography.label },
  introText: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  errorCard: {
    borderRadius: Radius.md,
    backgroundColor: BrandColors.dangerLight,
    padding: Spacing.sm,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
  },
  loadingCard: {
    minHeight: 110,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  loadingText: { color: BrandColors.muted, ...Typography.body },
  card: {
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Elevation.ambientCard,
  },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  orderIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    flexShrink: 1,
  },
  orderIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  orderIconActive: { backgroundColor: BrandColors.greenLight },
  number: { color: BrandColors.text, ...Typography.label, flexShrink: 1 },
  date: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  status: {
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
  },
  statusNeutral: { backgroundColor: BrandColors.surfaceMuted },
  statusText: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
  },
  statusTextNeutral: { color: BrandColors.muted },
  items: {
    gap: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    paddingTop: Spacing.sm,
  },
  itemRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  itemDot: {
    width: 5,
    height: 5,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.green,
  },
  itemName: { flex: 1, color: BrandColors.text, ...Typography.caption },
  itemQuantity: { color: BrandColors.muted, ...Typography.caption },
  moreItems: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
    marginTop: Spacing.xxs,
  },
  item: { color: BrandColors.muted, ...Typography.caption },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    paddingTop: Spacing.sm,
  },
  fulfillment: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  meta: { color: BrandColors.muted, ...Typography.caption },
  total: { color: BrandColors.text, ...Typography.h3, fontWeight: "800" },
  timeline: { gap: Spacing.xs },
  event: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.lineStrong,
  },
  dotActive: { backgroundColor: BrandColors.green },
  eventText: { flex: 1, color: BrandColors.muted, ...Typography.caption },
  substitution: {
    borderRadius: Radius.md,
    backgroundColor: BrandColors.goldLight,
    padding: Spacing.sm,
    gap: Spacing.xs,
  },
  substitutionTitle: {
    color: BrandColors.text,
    ...Typography.label,
  },
  substitutionActions: { flexDirection: "row", gap: Spacing.xs },
  rejectButton: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.white,
  },
  rejectText: {
    color: BrandColors.danger,
    ...Typography.caption,
    fontWeight: "800",
  },
  acceptButton: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.green,
  },
  acceptText: {
    color: BrandColors.white,
    ...Typography.caption,
    fontWeight: "800",
  },
  substitutionStatus: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "800",
    textAlign: "right",
  },
  tracking: {
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    padding: Spacing.sm,
    gap: Spacing.xs,
  },
  trackingLink: {
    color: BrandColors.greenDark,
    ...Typography.label,
    textAlign: "right",
  },
  trackingLinkButton: {
    minWidth: ControlSize.default,
    minHeight: ControlSize.default,
    alignSelf: "flex-end",
    justifyContent: "center",
  },
  actions: { flexDirection: "row", gap: Spacing.xs },
  repeatButton: { flex: 1 },
  cancelButton: {
    minWidth: 86,
    minHeight: 48,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.dangerLight,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.sm,
  },
  cancel: { color: BrandColors.danger, ...Typography.label },
  empty: {
    alignItems: "center",
    gap: Spacing.sm,
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.xl,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: BrandColors.text,
    ...Typography.h2,
    textAlign: "center",
  },
  emptyText: {
    color: BrandColors.muted,
    ...Typography.body,
    textAlign: "center",
  },
  emptyButton: { alignSelf: "stretch" },
  error: { color: BrandColors.danger, ...Typography.caption },
  retry: {
    color: BrandColors.danger,
    ...Typography.label,
    marginTop: Spacing.xxs,
  },
  modal: {
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.cream,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  modalTitle: { color: BrandColors.text, ...Typography.h3 },
  modalField: { gap: Spacing.xxs },
  fieldLabel: { color: BrandColors.text, ...Typography.label },
  fieldHelper: { color: BrandColors.muted, ...Typography.caption },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.lineStrong,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 13,
    includeFontPadding: false,
    textAlignVertical: "center",
    color: BrandColors.text,
    ...Typography.body,
  },
  dangerButton: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerText: { color: BrandColors.white, ...Typography.label },
  backButton: {
    minWidth: ControlSize.default,
    minHeight: ControlSize.default,
    alignSelf: "center",
    justifyContent: "center",
  },
  back: { color: BrandColors.muted, textAlign: "center", ...Typography.label },
  disabled: { opacity: Interaction.disabledOpacity },
  cardPressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  detailHeaderCopy: { flex: 1 },
  detailTitle: { color: BrandColors.text, ...Typography.h3 },
  detailDate: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  detailClose: {
    width: ControlSize.compact,
    height: ControlSize.compact,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  detailSectionLabel: { color: BrandColors.muted, ...Typography.overline },
  detailList: { maxHeight: 340 },
  detailItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.line,
    paddingVertical: Spacing.xs,
  },
  detailItemCopy: { flex: 1 },
  detailItemName: { color: BrandColors.text, ...Typography.body },
  detailItemQuantity: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: 2,
  },
  detailItemAmount: {
    color: BrandColors.greenDark,
    ...Typography.label,
  },
  detailTotalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    paddingTop: Spacing.sm,
  },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
