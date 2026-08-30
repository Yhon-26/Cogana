import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AdminScreen,
  Pill,
  PrimaryButton,
  SectionTitle,
  sharedStyles,
} from "@/components/admin-ui";
import { OperatorSelector } from "@/components/operator-selector";
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
import { useAppPreferences } from "@/context/app-preferences-context";
import { useLocalOperator } from "@/context/local-operator-context";
import { parseDecimalToInteger } from "@/database/integer-calculations";
import type {
  FulfillmentType,
  OrderDetailRecord,
  OrderIncidentType,
  OrderPaymentStatus,
  OrderSource,
  OrderStatus,
  OrderSummaryRecord,
  ProductRecord,
  PaymentMethod,
  SubstitutionPolicy,
} from "@/database/models";
import {
  createOrderIncident,
  proposeOrderSubstitution,
  updateOrderPlanning,
} from "@/database/repositories/order-operations-repository";
import {
  createOrder,
  getOrderDetail,
  nextOperationalStatus,
  prepareOrder,
  transitionOrder,
  updateOrderPaymentStatus,
} from "@/database/repositories/order-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { formatSoles as formatMoney } from "@/lib/money";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import { useDeliveryZones } from "@/hooks/use-delivery-zones";
import { useLocalProducts } from "@/hooks/use-local-products";
import { useOrders } from "@/hooks/use-orders";

type OrderDraft = {
  customerName: string;
  phone: string;
  source: OrderSource;
  fulfillmentType: FulfillmentType;
  zoneId: string;
  address: string;
  district: string;
  instructions: string;
  paymentMethod: PaymentMethod;
  paymentReference: string;
  notes: string;
};

const emptyDraft: OrderDraft = {
  customerName: "",
  phone: "",
  source: "whatsapp",
  fulfillmentType: "pickup",
  zoneId: "",
  address: "",
  district: "",
  instructions: "",
  paymentMethod: "cash",
  paymentReference: "",
  notes: "",
};

const statusLabels: Record<OrderStatus, string> = {
  received: "Recibido",
  confirmed: "Confirmado",
  preparing: "Preparando",
  weight_review: "Revisar peso",
  ready: "Listo",
  out_for_delivery: "En reparto",
  ready_for_pickup: "Listo para recojo",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

const actionLabels: Partial<Record<OrderStatus, string>> = {
  confirmed: "Confirmar pedido",
  preparing: "Iniciar preparación",
  ready: "Aprobar diferencia",
  out_for_delivery: "Enviar a reparto",
  ready_for_pickup: "Listo para recojo",
  delivered: "Marcar entregado",
};

const substitutionLabels: Record<SubstitutionPolicy, string> = {
  allow: "Permite reemplazo",
  contact: "Consultar",
  remove: "Retirar si falta",
};

const incidentLabels: Record<OrderIncidentType, string> = {
  missing_item: "Producto faltante",
  address: "Dirección",
  payment: "Pago",
  quality: "Calidad",
  delivery: "Delivery",
  other: "Otro",
};

const substitutionStatusLabels: Record<
  OrderDetailRecord["substitutions"][number]["status"],
  string
> = {
  proposed: "Propuesta",
  accepted: "Aceptada",
  rejected: "Rechazada",
};

const incidentStatusLabels: Record<
  OrderDetailRecord["incidents"][number]["status"],
  string
> = {
  open: "Abierta",
  resolved: "Resuelta",
};

const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  yape: "Yape",
  plin: "Plin",
  card: "Tarjeta",
};

const paymentStatusLabels: Record<OrderPaymentStatus, string> = {
  pending: "Pendiente",
  paid: "Pagado",
  failed: "Fallido",
  refunded: "Reembolsado",
};

function quantityText(quantity: number, baseUnit: "gram" | "unit") {
  return baseUnit === "gram"
    ? `${(quantity / 1000).toLocaleString("es-PE", {
        maximumFractionDigits: 3,
      })} kg`
    : `${quantity} un.`;
}

function statusTone(
  status: OrderStatus,
): "green" | "gold" | "danger" | "neutral" {
  if (status === "cancelled") return "danger";
  if (status === "weight_review") return "gold";
  if (status === "delivered") return "neutral";
  return "green";
}

function Choice<T extends string>({
  value,
  selected,
  label,
  onPress,
}: {
  value: T;
  selected: T;
  label: string;
  onPress: (value: T) => void;
}) {
  const active = value === selected;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={() => onPress(value)}
      style={[styles.choice, active && styles.choiceSelected]}
    >
      <Text style={[styles.choiceText, active && styles.choiceTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function OrdersScreen() {
  const { preferences } = useAppPreferences();
  const { users, selectedUser, deviceId } = useLocalOperator();
  const { products } = useLocalProducts();
  const { zones } = useDeliveryZones();
  const { database, orders, isLoading, error, refresh } = useOrders();
  const [filter, setFilter] = useState<"active" | "history">("active");
  const [createVisible, setCreateVisible] = useState(false);
  const [draft, setDraft] = useState<OrderDraft>(emptyDraft);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [policies, setPolicies] = useState<Record<string, SubstitutionPolicy>>(
    {},
  );
  const [expanded, setExpanded] = useState<OrderDetailRecord | null>(null);
  const [prepared, setPrepared] = useState<Record<string, string>>({});
  const [cancelVisible, setCancelVisible] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [operationForm, setOperationForm] = useState<
    "planning" | "incident" | "substitution" | "payment" | null
  >(null);
  const [scheduledFor, setScheduledFor] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [incidentType, setIncidentType] =
    useState<OrderIncidentType>("missing_item");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [substitutionItemId, setSubstitutionItemId] = useState("");
  const [replacementProductId, setReplacementProductId] = useState("");
  const [substitutionNotes, setSubstitutionNotes] = useState("");
  const [paymentTarget, setPaymentTarget] =
    useState<OrderPaymentStatus>("paid");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentReason, setPaymentReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const activeZones = zones.filter((zone) => zone.isActive);
  const visibleOrders = useMemo(
    () =>
      orders.filter((order) =>
        filter === "active"
          ? order.status !== "delivered" && order.status !== "cancelled"
          : order.status === "delivered" || order.status === "cancelled",
      ),
    [filter, orders],
  );

  const closeCreate = () => {
    setCreateVisible(false);
    setDraft(emptyDraft);
    setQuantities({});
    setPolicies({});
  };

  const openDetail = async (order: OrderSummaryRecord) => {
    try {
      const detail = await getOrderDetail(database, DEFAULT_STORE_ID, order.id);
      setExpanded(detail);
      setPrepared(
        Object.fromEntries(
          (detail?.items ?? []).map((item) => [
            item.id,
            item.baseUnitSnapshot === "gram"
              ? String((item.preparedQuantity ?? item.requestedQuantity) / 1000)
              : String(item.preparedQuantity ?? item.requestedQuantity),
          ]),
        ),
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo abrir",
        getOperatorErrorMessage(caughtError, "No se pudo abrir el pedido."),
      );
    }
  };

  const reloadExpanded = async (orderId: string) => {
    const detail = await getOrderDetail(database, DEFAULT_STORE_ID, orderId);
    setExpanded(detail);
    return detail;
  };

  const openOperationForm = (
    form: "planning" | "incident" | "substitution",
  ) => {
    setOperationForm(form);
    if (form === "planning" && expanded) {
      setScheduledFor(expanded.order.scheduledFor ?? "");
      setAssignedUserId(expanded.order.assignedUserId ?? "");
    }
    if (form === "incident") {
      setIncidentType("missing_item");
      setIncidentDescription("");
    }
    if (form === "substitution") {
      const eligibleItem = expanded?.items.find(
        (item) => item.substitutionPolicy !== "remove",
      );
      setSubstitutionItemId(eligibleItem?.id ?? "");
      setReplacementProductId("");
      setSubstitutionNotes("");
    }
  };

  const openPaymentForm = () => {
    if (!expanded) return;
    setPaymentTarget(
      expanded.order.paymentStatus === "paid"
        ? "refunded"
        : expanded.order.paymentStatus === "failed"
          ? "pending"
          : "paid",
    );
    setPaymentReference(expanded.order.paymentReference ?? "");
    setPaymentReason("");
    setOperationForm("payment");
  };

  const savePayment = async () => {
    if (!expanded || !selectedUser || isSaving) return;
    setIsSaving(true);
    try {
      const result = await updateOrderPaymentStatus(database, {
        storeId: DEFAULT_STORE_ID,
        orderId: expanded.order.id,
        expectedVersion: expanded.order.version,
        toStatus: paymentTarget,
        paymentReference,
        reason: paymentReason,
        actorUserId: selectedUser.id,
        deviceId,
      });
      setExpanded(result);
      setOperationForm(null);
      await refresh(false);
    } catch (caughtError) {
      Alert.alert(
        "No se pudo actualizar el pago",
        getOperatorErrorMessage(caughtError, "No se pudo actualizar el pago."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const savePlanning = async () => {
    if (!expanded || !selectedUser || isSaving) return;
    setIsSaving(true);
    try {
      const parsedSchedule = scheduledFor.trim()
        ? new Date(scheduledFor.trim()).toISOString()
        : null;
      const result = await updateOrderPlanning(database, {
        storeId: DEFAULT_STORE_ID,
        orderId: expanded.order.id,
        expectedVersion: expanded.order.version,
        scheduledFor: parsedSchedule,
        assignedUserId: assignedUserId || null,
        actorUserId: selectedUser.id,
        deviceId,
      });
      setExpanded(result);
      setOperationForm(null);
      await refresh(false);
    } catch (caughtError) {
      Alert.alert(
        "No se pudo planificar",
        getOperatorErrorMessage(
          caughtError,
          "No se pudo planificar el pedido.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const saveIncident = async () => {
    if (!expanded || !selectedUser || isSaving) return;
    setIsSaving(true);
    try {
      await createOrderIncident(database, {
        storeId: DEFAULT_STORE_ID,
        orderId: expanded.order.id,
        type: incidentType,
        description: incidentDescription,
        actorUserId: selectedUser.id,
        deviceId,
      });
      await reloadExpanded(expanded.order.id);
      setOperationForm(null);
    } catch (caughtError) {
      Alert.alert(
        "No se pudo registrar",
        getOperatorErrorMessage(
          caughtError,
          "No se pudo registrar la incidencia.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const saveSubstitution = async () => {
    if (!expanded || !selectedUser || isSaving) return;
    setIsSaving(true);
    try {
      await proposeOrderSubstitution(database, {
        storeId: DEFAULT_STORE_ID,
        orderId: expanded.order.id,
        orderItemId: substitutionItemId,
        replacementProductId,
        notes: substitutionNotes,
        actorUserId: selectedUser.id,
        deviceId,
      });
      await reloadExpanded(expanded.order.id);
      setOperationForm(null);
    } catch (caughtError) {
      Alert.alert(
        "No se pudo proponer",
        getOperatorErrorMessage(
          caughtError,
          "No se pudo proponer la sustitución.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const saveOrder = async () => {
    if (!selectedUser || isSaving) return;
    setIsSaving(true);
    try {
      const items = products.flatMap((product) => {
        const raw = quantities[product.id]?.trim();
        if (!raw) return [];
        const quantity = parseDecimalToInteger(
          raw,
          product.baseUnit === "gram" ? 3 : 0,
        );
        if (quantity === null || quantity <= 0) {
          throw new Error(`Revisa la cantidad de ${product.name}.`);
        }
        return [
          {
            productId: product.id,
            quantity,
            substitutionPolicy: policies[product.id] ?? "contact",
          },
        ];
      });
      await createOrder(database, {
        storeId: DEFAULT_STORE_ID,
        deviceId,
        actorUserId: selectedUser.id,
        source: draft.source,
        fulfillmentType: draft.fulfillmentType,
        customer: {
          name: draft.customerName,
          phone: draft.phone,
        },
        paymentMethod: draft.paymentMethod,
        paymentReference: draft.paymentReference,
        delivery:
          draft.fulfillmentType === "delivery"
            ? {
                zoneId: draft.zoneId,
                address: draft.address,
                district: draft.district,
                instructions: draft.instructions,
              }
            : undefined,
        notes: draft.notes,
        items,
      });
      await refresh(false);
      closeCreate();
      Alert.alert(
        "Pedido registrado",
        "El cambio quedó registrado y pendiente de confirmación central.",
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo registrar",
        getOperatorErrorMessage(caughtError, "No se pudo registrar el pedido."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const applyTransition = async (
    detail: OrderDetailRecord,
    toStatus: OrderStatus,
    reason: string,
  ) => {
    if (!selectedUser || isSaving) return;
    setIsSaving(true);
    try {
      await transitionOrder(database, {
        storeId: DEFAULT_STORE_ID,
        orderId: detail.order.id,
        expectedVersion: detail.order.version,
        toStatus,
        reason,
        actorUserId: selectedUser.id,
        deviceId,
      });
      await refresh(false);
      setExpanded(null);
    } catch (caughtError) {
      Alert.alert(
        "No se pudo actualizar",
        getOperatorErrorMessage(
          caughtError,
          "No se pudo actualizar el pedido.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleNext = (detail: OrderDetailRecord) => {
    const next = nextOperationalStatus(detail.order);
    if (!next) return;
    if (detail.order.status === "weight_review") {
      Alert.alert(
        "Aprobar diferencia",
        `El total final es ${formatMoney(
          detail.order.finalTotalCents ?? detail.order.estimatedTotalCents,
        )}. Confirma que la diferencia fue revisada.`,
        [
          { text: "Volver", style: "cancel" },
          {
            text: "Aprobar",
            onPress: () =>
              void applyTransition(detail, next, "Diferencia de peso aprobada"),
          },
        ],
      );
      return;
    }
    void applyTransition(
      detail,
      next,
      `${statusLabels[detail.order.status]} → ${statusLabels[next]}`,
    );
  };

  const finishPreparation = async () => {
    if (!expanded || !selectedUser || isSaving) return;
    setIsSaving(true);
    try {
      const items = expanded.items.map((item) => {
        const quantity = parseDecimalToInteger(
          prepared[item.id] ?? "",
          item.baseUnitSnapshot === "gram" ? 3 : 0,
        );
        if (quantity === null || quantity < 0) {
          throw new Error(
            `Revisa la cantidad preparada de ${item.productNameSnapshot}.`,
          );
        }
        return { itemId: item.id, preparedQuantity: quantity };
      });
      const result = await prepareOrder(database, {
        storeId: DEFAULT_STORE_ID,
        orderId: expanded.order.id,
        expectedVersion: expanded.order.version,
        actorUserId: selectedUser.id,
        deviceId,
        items,
      });
      await refresh(false);
      setExpanded(null);
      Alert.alert(
        result.order.status === "weight_review"
          ? "Revisión requerida"
          : "Pedido preparado",
        result.order.status === "weight_review"
          ? "El peso real cambió. Un administrador debe aprobar la diferencia."
          : "Las cantidades reales y el total final quedaron confirmados.",
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo finalizar",
        getOperatorErrorMessage(
          caughtError,
          "No se pudo finalizar la preparación.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminScreen
      title="Pedidos"
      subtitle="Bandeja operativa para WhatsApp, teléfono y canal online"
      right={
        <Pressable
          accessibilityLabel="Crear pedido"
          accessibilityRole="button"
          style={styles.addHeader}
          onPress={() => setCreateVisible(true)}
        >
          <MaterialCommunityIcons
            name="plus"
            size={23}
            color={BrandColors.white}
          />
        </Pressable>
      }
    >
      <OperatorSelector />

      <View style={styles.filterRow}>
        <Choice
          value="active"
          selected={filter}
          label="En curso"
          onPress={setFilter}
        />
        <Choice
          value="history"
          selected={filter}
          label="Historial"
          onPress={setFilter}
        />
      </View>

      <SectionTitle
        action={<Pill label={`${visibleOrders.length}`} tone="neutral" />}
      >
        {filter === "active" ? "Bandeja activa" : "Pedidos cerrados"}
      </SectionTitle>

      {isLoading ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text style={styles.muted}>Cargando pedidos locales…</Text>
        </View>
      ) : error ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text accessibilityRole="alert" style={styles.error}>
            {getOperatorErrorMessage(
              error,
              "No se pudieron cargar los pedidos.",
            )}
          </Text>
          <PrimaryButton label="Reintentar" onPress={() => void refresh()} />
        </View>
      ) : visibleOrders.length === 0 ? (
        <View style={[sharedStyles.card, styles.empty]}>
          <MaterialCommunityIcons
            name="clipboard-text-clock-outline"
            size={38}
            color={BrandColors.green}
          />
          <Text style={styles.emptyTitle}>Sin pedidos en esta vista</Text>
          <Text style={styles.muted}>
            Registra el primer pedido recibido por teléfono o WhatsApp.
          </Text>
          {filter === "active" ? (
            <PrimaryButton
              label="Nuevo pedido"
              icon="plus"
              onPress={() => setCreateVisible(true)}
              disabled={!selectedUser}
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.orderList}>
          {visibleOrders.map((order) => (
            <Pressable
              accessibilityLabel={`Abrir pedido ${order.orderNumber} de ${order.customerName}`}
              accessibilityRole="button"
              key={order.id}
              onPress={() => void openDetail(order)}
              style={({ pressed }) => [
                sharedStyles.card,
                styles.orderCard,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.orderTop}>
                <View style={styles.orderCopy}>
                  <Text style={styles.orderNumber}>{order.orderNumber}</Text>
                  <Text style={styles.customer}>{order.customerName}</Text>
                </View>
                <Pill
                  label={statusLabels[order.status]}
                  tone={statusTone(order.status)}
                />
              </View>
              <Text style={styles.meta}>
                {order.source === "whatsapp"
                  ? "WhatsApp"
                  : order.source === "phone"
                    ? "Teléfono"
                    : "Online"}{" "}
                · {order.itemCount} producto{order.itemCount === 1 ? "" : "s"} ·{" "}
                {order.fulfillmentType === "delivery"
                  ? (order.deliveryZoneName ?? "Delivery")
                  : "Recojo"}
              </Text>
              <View style={styles.totalRow}>
                <Text style={styles.date}>
                  {new Date(order.createdAt).toLocaleString("es-PE", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
                <Text style={styles.total}>
                  {formatMoney(
                    order.finalTotalCents ?? order.estimatedTotalCents,
                  )}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <Modal
        animationType={preferences.reduceMotion ? "none" : "slide"}
        visible={createVisible}
        onRequestClose={closeCreate}
      >
        <AdminScreen
          title="Nuevo pedido"
          subtitle="Registro interno con total estimado"
          right={
            <Pressable
              accessibilityLabel="Cerrar nuevo pedido"
              accessibilityRole="button"
              onPress={closeCreate}
              style={styles.closeHeader}
            >
              <MaterialCommunityIcons
                name="close"
                size={22}
                color={BrandColors.white}
              />
            </Pressable>
          }
        >
          <SectionTitle>Cliente y canal</SectionTitle>
          <View style={[sharedStyles.card, styles.formCard]}>
            <TextInput
              accessibilityLabel="Nombre del cliente"
              placeholder="Nombre del cliente"
              placeholderTextColor={BrandColors.muted}
              style={styles.input}
              value={draft.customerName}
              onChangeText={(value) =>
                setDraft((current) => ({ ...current, customerName: value }))
              }
            />
            <TextInput
              accessibilityLabel="Teléfono del cliente"
              keyboardType="phone-pad"
              placeholder="Teléfono"
              placeholderTextColor={BrandColors.muted}
              style={styles.input}
              value={draft.phone}
              onChangeText={(value) =>
                setDraft((current) => ({ ...current, phone: value }))
              }
            />
            <View style={styles.filterRow}>
              <Choice
                value="whatsapp"
                selected={draft.source}
                label="WhatsApp"
                onPress={(value) =>
                  setDraft((current) => ({ ...current, source: value }))
                }
              />
              <Choice
                value="phone"
                selected={draft.source}
                label="Teléfono"
                onPress={(value) =>
                  setDraft((current) => ({ ...current, source: value }))
                }
              />
            </View>
          </View>

          <SectionTitle>Modalidad</SectionTitle>
          <View style={[sharedStyles.card, styles.formCard]}>
            <View style={styles.filterRow}>
              <Choice
                value="pickup"
                selected={draft.fulfillmentType}
                label="Recojo"
                onPress={(value) =>
                  setDraft((current) => ({
                    ...current,
                    fulfillmentType: value,
                  }))
                }
              />
              <Choice
                value="delivery"
                selected={draft.fulfillmentType}
                label="Delivery"
                onPress={(value) =>
                  setDraft((current) => ({
                    ...current,
                    fulfillmentType: value,
                  }))
                }
              />
            </View>
            {draft.fulfillmentType === "delivery" ? (
              <>
                <Text style={styles.fieldLabel}>ZONA DE DELIVERY</Text>
                <View style={styles.zoneWrap}>
                  {activeZones.map((zone) => (
                    <Pressable
                      accessibilityLabel={`Zona ${zone.name}, tarifa ${formatMoney(
                        zone.feeCents,
                      )}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: draft.zoneId === zone.id }}
                      key={zone.id}
                      onPress={() =>
                        setDraft((current) => ({
                          ...current,
                          zoneId: zone.id,
                          district: zone.district,
                        }))
                      }
                      style={[
                        styles.zoneChoice,
                        draft.zoneId === zone.id && styles.zoneChoiceSelected,
                      ]}
                    >
                      <Text style={styles.zoneName}>{zone.name}</Text>
                      <Text style={styles.zoneFee}>
                        {formatMoney(zone.feeCents)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {activeZones.length === 0 ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    Primero configura una zona de delivery activa.
                  </Text>
                ) : null}
                <TextInput
                  accessibilityLabel="Dirección de entrega"
                  placeholder="Dirección"
                  placeholderTextColor={BrandColors.muted}
                  style={styles.input}
                  value={draft.address}
                  onChangeText={(value) =>
                    setDraft((current) => ({ ...current, address: value }))
                  }
                />
                <TextInput
                  accessibilityLabel="Distrito de entrega"
                  placeholder="Distrito"
                  placeholderTextColor={BrandColors.muted}
                  style={styles.input}
                  value={draft.district}
                  onChangeText={(value) =>
                    setDraft((current) => ({ ...current, district: value }))
                  }
                />
                <TextInput
                  accessibilityLabel="Referencia o instrucciones de entrega"
                  placeholder="Referencia o instrucciones"
                  placeholderTextColor={BrandColors.muted}
                  style={styles.input}
                  value={draft.instructions}
                  onChangeText={(value) =>
                    setDraft((current) => ({ ...current, instructions: value }))
                  }
                />
              </>
            ) : null}
          </View>

          <SectionTitle>Pago</SectionTitle>
          <View style={[sharedStyles.card, styles.formCard]}>
            <View style={styles.chipWrap}>
              {(["cash", "yape", "plin", "card"] as PaymentMethod[]).map(
                (method) => (
                  <Pressable
                    accessibilityLabel={paymentMethodLabels[method]}
                    accessibilityRole="radio"
                    accessibilityState={{
                      checked: draft.paymentMethod === method,
                    }}
                    key={method}
                    onPress={() =>
                      setDraft((current) => ({
                        ...current,
                        paymentMethod: method,
                        paymentReference:
                          method === "cash" ? "" : current.paymentReference,
                      }))
                    }
                    style={[
                      styles.selectionChip,
                      draft.paymentMethod === method &&
                        styles.selectionChipActive,
                    ]}
                  >
                    <Text style={styles.selectionChipText}>
                      {paymentMethodLabels[method]}
                    </Text>
                  </Pressable>
                ),
              )}
            </View>
            {draft.paymentMethod !== "cash" ? (
              <TextInput
                accessibilityLabel="Referencia de pago"
                placeholder={
                  draft.paymentMethod === "yape" ||
                  draft.paymentMethod === "plin"
                    ? "Referencia obligatoria"
                    : "Referencia de pago"
                }
                placeholderTextColor={BrandColors.muted}
                style={styles.input}
                value={draft.paymentReference}
                onChangeText={(value) =>
                  setDraft((current) => ({
                    ...current,
                    paymentReference: value,
                  }))
                }
              />
            ) : null}
            <Text style={styles.detailLine}>
              Yape y Plin requieren referencia. Todo pedido inicia pendiente
              hasta que un administrador confirme el pago.
            </Text>
          </View>

          <SectionTitle>Productos</SectionTitle>
          <View style={[sharedStyles.card, styles.productsCard]}>
            {products.map((product, index) => (
              <ProductDraftRow
                key={product.id}
                product={product}
                value={quantities[product.id] ?? ""}
                policy={policies[product.id] ?? "contact"}
                bordered={index > 0}
                onChangeQuantity={(value) =>
                  setQuantities((current) => ({
                    ...current,
                    [product.id]: value,
                  }))
                }
                onChangePolicy={(value) =>
                  setPolicies((current) => ({
                    ...current,
                    [product.id]: value,
                  }))
                }
              />
            ))}
          </View>
          <TextInput
            accessibilityLabel="Notas del pedido"
            multiline
            placeholder="Notas del pedido (opcional)"
            placeholderTextColor={BrandColors.muted}
            style={[styles.input, styles.notesInput]}
            value={draft.notes}
            onChangeText={(value) =>
              setDraft((current) => ({ ...current, notes: value }))
            }
          />
          <PrimaryButton
            label={isSaving ? "Guardando…" : "Registrar pedido"}
            icon="content-save-outline"
            onPress={() => void saveOrder()}
            disabled={
              !selectedUser ||
              !deviceId ||
              isSaving ||
              ((draft.paymentMethod === "yape" ||
                draft.paymentMethod === "plin") &&
                !draft.paymentReference.trim())
            }
          />
        </AdminScreen>
      </Modal>

      <Modal
        animationType={preferences.reduceMotion ? "none" : "slide"}
        visible={Boolean(expanded)}
        onRequestClose={() => setExpanded(null)}
      >
        {expanded ? (
          <AdminScreen
            title={expanded.order.orderNumber}
            subtitle={`${expanded.customer.name} · ${expanded.customer.phone}`}
            right={
              <Pressable
                accessibilityLabel="Cerrar detalle del pedido"
                accessibilityRole="button"
                onPress={() => setExpanded(null)}
                style={styles.closeHeader}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={BrandColors.white}
                />
              </Pressable>
            }
          >
            <View style={[sharedStyles.card, styles.detailCard]}>
              <View style={styles.orderTop}>
                <Pill
                  label={statusLabels[expanded.order.status]}
                  tone={statusTone(expanded.order.status)}
                />
                <Text style={styles.total}>
                  {formatMoney(
                    expanded.order.finalTotalCents ??
                      expanded.order.estimatedTotalCents,
                  )}
                </Text>
              </View>
              <Text style={styles.detailLine}>
                {expanded.order.fulfillmentType === "delivery"
                  ? `Delivery · ${expanded.address?.address}, ${expanded.address?.district}`
                  : "Recojo en tienda"}
              </Text>
              {expanded.order.notes ? (
                <Text style={styles.detailLine}>
                  Nota: {expanded.order.notes}
                </Text>
              ) : null}
              {expanded.order.scheduledFor ? (
                <Text style={styles.detailLine}>
                  Programado:{" "}
                  {new Date(expanded.order.scheduledFor).toLocaleString(
                    "es-PE",
                  )}
                </Text>
              ) : null}
              {expanded.order.assignedUserId ? (
                <Text style={styles.detailLine}>
                  Responsable:{" "}
                  {users.find(
                    (user) => user.id === expanded.order.assignedUserId,
                  )?.displayName ?? "Usuario sincronizado"}
                </Text>
              ) : null}
            </View>

            <SectionTitle>Pago</SectionTitle>
            <View style={[sharedStyles.card, styles.detailCard]}>
              <View style={styles.orderTop}>
                <View style={styles.orderCopy}>
                  <Text style={styles.productName}>
                    {paymentMethodLabels[expanded.order.paymentMethod]}
                  </Text>
                  <Text style={styles.detailLine}>
                    Estado: {paymentStatusLabels[expanded.order.paymentStatus]}
                  </Text>
                  {expanded.order.paymentReference ? (
                    <Text style={styles.detailLine}>
                      Referencia: {expanded.order.paymentReference}
                    </Text>
                  ) : null}
                </View>
                <Pill
                  label={paymentStatusLabels[expanded.order.paymentStatus]}
                  tone={
                    expanded.order.paymentStatus === "paid"
                      ? "green"
                      : expanded.order.paymentStatus === "failed"
                        ? "danger"
                        : expanded.order.paymentStatus === "refunded"
                          ? "neutral"
                          : "gold"
                  }
                />
              </View>
              {selectedUser?.role === "administrator" &&
              expanded.order.paymentStatus !== "refunded" &&
              (expanded.order.status !== "cancelled" ||
                expanded.order.paymentStatus === "paid") ? (
                <Pressable
                  accessibilityLabel="Gestionar pago"
                  accessibilityRole="button"
                  onPress={openPaymentForm}
                  style={styles.operationButton}
                >
                  <MaterialCommunityIcons
                    name="cash-check"
                    size={17}
                    color={BrandColors.greenDark}
                  />
                  <Text style={styles.operationButtonText}>Gestionar pago</Text>
                </Pressable>
              ) : null}
            </View>

            {operationForm === "payment" ? (
              <View style={[sharedStyles.card, styles.operationForm]}>
                <Text style={styles.productName}>Actualizar pago</Text>
                <View style={styles.chipWrap}>
                  {(expanded.order.paymentStatus === "pending"
                    ? (["paid", "failed"] as OrderPaymentStatus[])
                    : expanded.order.paymentStatus === "failed"
                      ? (["pending", "paid"] as OrderPaymentStatus[])
                      : (["refunded"] as OrderPaymentStatus[])
                  ).map((status) => (
                    <Pressable
                      accessibilityLabel={paymentStatusLabels[status]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: paymentTarget === status }}
                      key={status}
                      onPress={() => setPaymentTarget(status)}
                      style={[
                        styles.selectionChip,
                        paymentTarget === status && styles.selectionChipActive,
                      ]}
                    >
                      <Text style={styles.selectionChipText}>
                        {paymentStatusLabels[status]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {paymentTarget === "paid" &&
                expanded.order.paymentMethod !== "cash" ? (
                  <TextInput
                    accessibilityLabel="Referencia verificada"
                    placeholder="Referencia verificada"
                    placeholderTextColor={BrandColors.muted}
                    style={styles.input}
                    value={paymentReference}
                    onChangeText={setPaymentReference}
                  />
                ) : null}
                <TextInput
                  accessibilityLabel="Motivo del cambio de pago"
                  placeholder="Motivo o evidencia de la validación"
                  placeholderTextColor={BrandColors.muted}
                  style={styles.input}
                  value={paymentReason}
                  onChangeText={setPaymentReason}
                />
                <View style={styles.formActions}>
                  <Pressable
                    accessibilityLabel="Cancelar cambio de pago"
                    accessibilityRole="button"
                    onPress={() => setOperationForm(null)}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryText}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Guardar cambio de pago"
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled:
                        !paymentReason.trim() ||
                        isSaving ||
                        (paymentTarget === "paid" &&
                          expanded.order.paymentMethod !== "cash" &&
                          !paymentReference.trim()),
                    }}
                    disabled={
                      !paymentReason.trim() ||
                      isSaving ||
                      (paymentTarget === "paid" &&
                        expanded.order.paymentMethod !== "cash" &&
                        !paymentReference.trim())
                    }
                    onPress={() => void savePayment()}
                    style={[
                      styles.formPrimary,
                      (!paymentReason.trim() ||
                        isSaving ||
                        (paymentTarget === "paid" &&
                          expanded.order.paymentMethod !== "cash" &&
                          !paymentReference.trim())) &&
                        styles.disabled,
                    ]}
                  >
                    <Text style={styles.formPrimaryText}>Guardar</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {!["delivered", "cancelled"].includes(expanded.order.status) ? (
              <>
                <View style={styles.operationActions}>
                  {selectedUser?.role === "administrator" ? (
                    <Pressable
                      accessibilityLabel="Planificar pedido"
                      accessibilityRole="button"
                      onPress={() => openOperationForm("planning")}
                      style={styles.operationButton}
                    >
                      <MaterialCommunityIcons
                        name="calendar-clock"
                        size={17}
                        color={BrandColors.greenDark}
                      />
                      <Text style={styles.operationButtonText}>Planificar</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityLabel="Registrar incidencia"
                    accessibilityRole="button"
                    onPress={() => openOperationForm("incident")}
                    style={styles.operationButton}
                  >
                    <MaterialCommunityIcons
                      name="alert-circle-outline"
                      size={17}
                      color={BrandColors.greenDark}
                    />
                    <Text style={styles.operationButtonText}>Incidencia</Text>
                  </Pressable>
                  {["confirmed", "preparing"].includes(
                    expanded.order.status,
                  ) ? (
                    <Pressable
                      accessibilityLabel="Proponer sustitución"
                      accessibilityRole="button"
                      onPress={() => openOperationForm("substitution")}
                      style={styles.operationButton}
                    >
                      <MaterialCommunityIcons
                        name="swap-horizontal"
                        size={17}
                        color={BrandColors.greenDark}
                      />
                      <Text style={styles.operationButtonText}>Sustituir</Text>
                    </Pressable>
                  ) : null}
                </View>

                {operationForm === "planning" ? (
                  <View style={[sharedStyles.card, styles.operationForm]}>
                    <Text style={styles.productName}>Planificación</Text>
                    <TextInput
                      accessibilityLabel="Fecha programada del pedido"
                      placeholder="Fecha ISO, ej. 2026-07-28T15:00:00-05:00"
                      placeholderTextColor={BrandColors.muted}
                      style={styles.input}
                      value={scheduledFor}
                      onChangeText={setScheduledFor}
                    />
                    <Text style={styles.fieldLabel}>RESPONSABLE</Text>
                    <View style={styles.chipWrap}>
                      <Pressable
                        accessibilityLabel="Sin asignar"
                        accessibilityRole="radio"
                        accessibilityState={{ selected: !assignedUserId }}
                        onPress={() => setAssignedUserId("")}
                        style={[
                          styles.selectionChip,
                          !assignedUserId && styles.selectionChipActive,
                        ]}
                      >
                        <Text style={styles.selectionChipText}>
                          Sin asignar
                        </Text>
                      </Pressable>
                      {users.map((user) => (
                        <Pressable
                          accessibilityLabel={user.displayName}
                          accessibilityRole="radio"
                          accessibilityState={{
                            selected: assignedUserId === user.id,
                          }}
                          key={user.id}
                          onPress={() => setAssignedUserId(user.id)}
                          style={[
                            styles.selectionChip,
                            assignedUserId === user.id &&
                              styles.selectionChipActive,
                          ]}
                        >
                          <Text style={styles.selectionChipText}>
                            {user.displayName}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.formActions}>
                      <Pressable
                        accessibilityLabel="Cancelar planificación"
                        accessibilityRole="button"
                        onPress={() => setOperationForm(null)}
                        style={styles.secondaryButton}
                      >
                        <Text style={styles.secondaryText}>Cancelar</Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel="Guardar planificación"
                        accessibilityRole="button"
                        accessibilityState={{
                          disabled: isSaving,
                          busy: isSaving,
                        }}
                        disabled={isSaving}
                        onPress={() => void savePlanning()}
                        style={[
                          styles.formPrimary,
                          isSaving && styles.disabled,
                        ]}
                      >
                        <Text style={styles.formPrimaryText}>Guardar</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : operationForm === "incident" ? (
                  <View style={[sharedStyles.card, styles.operationForm]}>
                    <Text style={styles.productName}>Nueva incidencia</Text>
                    <View style={styles.chipWrap}>
                      {(Object.keys(incidentLabels) as OrderIncidentType[]).map(
                        (type) => (
                          <Pressable
                            accessibilityLabel={incidentLabels[type]}
                            accessibilityRole="radio"
                            accessibilityState={{
                              selected: incidentType === type,
                            }}
                            key={type}
                            onPress={() => setIncidentType(type)}
                            style={[
                              styles.selectionChip,
                              incidentType === type &&
                                styles.selectionChipActive,
                            ]}
                          >
                            <Text style={styles.selectionChipText}>
                              {incidentLabels[type]}
                            </Text>
                          </Pressable>
                        ),
                      )}
                    </View>
                    <TextInput
                      accessibilityLabel="Descripción de la incidencia"
                      multiline
                      placeholder="Describe qué ocurrió"
                      placeholderTextColor={BrandColors.muted}
                      style={[styles.input, styles.notesInput]}
                      value={incidentDescription}
                      onChangeText={setIncidentDescription}
                    />
                    <View style={styles.formActions}>
                      <Pressable
                        accessibilityLabel="Cancelar incidencia"
                        accessibilityRole="button"
                        onPress={() => setOperationForm(null)}
                        style={styles.secondaryButton}
                      >
                        <Text style={styles.secondaryText}>Cancelar</Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel="Registrar incidencia"
                        accessibilityRole="button"
                        accessibilityState={{
                          disabled: !incidentDescription.trim() || isSaving,
                          busy: isSaving,
                        }}
                        disabled={!incidentDescription.trim() || isSaving}
                        onPress={() => void saveIncident()}
                        style={[
                          styles.formPrimary,
                          (!incidentDescription.trim() || isSaving) &&
                            styles.disabled,
                        ]}
                      >
                        <Text style={styles.formPrimaryText}>Registrar</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : operationForm === "substitution" ? (
                  <View style={[sharedStyles.card, styles.operationForm]}>
                    <Text style={styles.productName}>Proponer sustitución</Text>
                    <Text style={styles.fieldLabel}>PRODUCTO DEL PEDIDO</Text>
                    <View style={styles.chipWrap}>
                      {expanded.items
                        .filter((item) => item.substitutionPolicy !== "remove")
                        .map((item) => (
                          <Pressable
                            accessibilityLabel={item.productNameSnapshot}
                            accessibilityRole="radio"
                            accessibilityState={{
                              selected: substitutionItemId === item.id,
                            }}
                            key={item.id}
                            onPress={() => setSubstitutionItemId(item.id)}
                            style={[
                              styles.selectionChip,
                              substitutionItemId === item.id &&
                                styles.selectionChipActive,
                            ]}
                          >
                            <Text style={styles.selectionChipText}>
                              {item.productNameSnapshot}
                            </Text>
                          </Pressable>
                        ))}
                    </View>
                    <Text style={styles.fieldLabel}>REEMPLAZO DISPONIBLE</Text>
                    <View style={styles.chipWrap}>
                      {products
                        .filter(
                          (product) =>
                            product.isActive &&
                            product.id !==
                              expanded.items.find(
                                (item) => item.id === substitutionItemId,
                              )?.productId,
                        )
                        .map((product) => (
                          <Pressable
                            accessibilityLabel={product.name}
                            accessibilityRole="radio"
                            accessibilityState={{
                              selected: replacementProductId === product.id,
                            }}
                            key={product.id}
                            onPress={() => setReplacementProductId(product.id)}
                            style={[
                              styles.selectionChip,
                              replacementProductId === product.id &&
                                styles.selectionChipActive,
                            ]}
                          >
                            <Text style={styles.selectionChipText}>
                              {product.name}
                            </Text>
                          </Pressable>
                        ))}
                    </View>
                    <TextInput
                      accessibilityLabel="Nota de la sustitución"
                      placeholder="Nota para el cliente (opcional)"
                      placeholderTextColor={BrandColors.muted}
                      style={styles.input}
                      value={substitutionNotes}
                      onChangeText={setSubstitutionNotes}
                    />
                    <View style={styles.formActions}>
                      <Pressable
                        accessibilityLabel="Cancelar sustitución"
                        accessibilityRole="button"
                        onPress={() => setOperationForm(null)}
                        style={styles.secondaryButton}
                      >
                        <Text style={styles.secondaryText}>Cancelar</Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel="Proponer sustitución"
                        accessibilityRole="button"
                        accessibilityState={{
                          disabled:
                            !substitutionItemId ||
                            !replacementProductId ||
                            isSaving,
                          busy: isSaving,
                        }}
                        disabled={
                          !substitutionItemId ||
                          !replacementProductId ||
                          isSaving
                        }
                        onPress={() => void saveSubstitution()}
                        style={[
                          styles.formPrimary,
                          (!substitutionItemId ||
                            !replacementProductId ||
                            isSaving) &&
                            styles.disabled,
                        ]}
                      >
                        <Text style={styles.formPrimaryText}>Proponer</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}

            <SectionTitle>Productos</SectionTitle>
            <View style={[sharedStyles.card, styles.productsCard]}>
              {expanded.items.map((item, index) => (
                <View
                  key={item.id}
                  style={[styles.detailItem, index > 0 && styles.borderTop]}
                >
                  <View style={styles.orderCopy}>
                    <Text style={styles.productName}>
                      {item.productNameSnapshot}
                    </Text>
                    <Text style={styles.meta}>
                      Pedido:{" "}
                      {quantityText(
                        item.requestedQuantity,
                        item.baseUnitSnapshot,
                      )}
                      {" · "}
                      {substitutionLabels[item.substitutionPolicy]}
                    </Text>
                  </View>
                  <Text style={styles.lineTotal}>
                    {formatMoney(item.finalCents ?? item.estimatedCents)}
                  </Text>
                  {expanded.order.status === "preparing" ? (
                    <View style={styles.preparedField}>
                      <TextInput
                        accessibilityLabel={`Cantidad preparada de ${item.productNameSnapshot}`}
                        keyboardType="decimal-pad"
                        style={styles.preparedInput}
                        value={prepared[item.id] ?? ""}
                        onChangeText={(value) =>
                          setPrepared((current) => ({
                            ...current,
                            [item.id]: value,
                          }))
                        }
                      />
                      <Text style={styles.unitLabel}>
                        {item.baseUnitSnapshot === "gram"
                          ? "kg reales"
                          : "unidades"}
                      </Text>
                    </View>
                  ) : item.preparedQuantity !== null ? (
                    <Text style={styles.preparedLabel}>
                      Preparado:{" "}
                      {quantityText(
                        item.preparedQuantity,
                        item.baseUnitSnapshot,
                      )}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>

            {expanded.substitutions.length ? (
              <>
                <SectionTitle>Sustituciones</SectionTitle>
                <View style={[sharedStyles.card, styles.historyCard]}>
                  {expanded.substitutions.map((substitution, index) => (
                    <View
                      key={substitution.id}
                      style={[styles.historyRow, index > 0 && styles.borderTop]}
                    >
                      <MaterialCommunityIcons
                        name="swap-horizontal"
                        size={18}
                        color={BrandColors.warning}
                      />
                      <View style={styles.orderCopy}>
                        <Text style={styles.historyStatus}>
                          {substitution.replacementProductName} ·{" "}
                          {substitutionStatusLabels[substitution.status]}
                        </Text>
                        {substitution.notes ? (
                          <Text style={styles.meta}>{substitution.notes}</Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {expanded.incidents.length ? (
              <>
                <SectionTitle>Incidencias</SectionTitle>
                <View style={[sharedStyles.card, styles.historyCard]}>
                  {expanded.incidents.map((incident, index) => (
                    <View
                      key={incident.id}
                      style={[styles.historyRow, index > 0 && styles.borderTop]}
                    >
                      <MaterialCommunityIcons
                        name="alert-circle-outline"
                        size={18}
                        color={BrandColors.danger}
                      />
                      <View style={styles.orderCopy}>
                        <Text style={styles.historyStatus}>
                          {incidentLabels[incident.type]} ·{" "}
                          {incidentStatusLabels[incident.status]}
                        </Text>
                        <Text style={styles.meta}>{incident.description}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {expanded.order.status === "preparing" ? (
              <PrimaryButton
                label={
                  isSaving ? "Finalizando…" : "Confirmar cantidades reales"
                }
                icon="scale-balance"
                onPress={() => void finishPreparation()}
                disabled={isSaving}
              />
            ) : nextOperationalStatus(expanded.order) ? (
              <PrimaryButton
                label={
                  isSaving
                    ? "Actualizando…"
                    : (actionLabels[
                        nextOperationalStatus(expanded.order) as OrderStatus
                      ] ?? "Siguiente estado")
                }
                icon="arrow-right"
                onPress={() => handleNext(expanded)}
                disabled={
                  isSaving ||
                  (expanded.order.status === "weight_review" &&
                    selectedUser?.role !== "administrator")
                }
              />
            ) : null}

            {selectedUser?.role === "administrator" &&
            ["received", "confirmed", "preparing"].includes(
              expanded.order.status,
            ) ? (
              <Pressable
                accessibilityLabel={`Cancelar pedido ${expanded.order.orderNumber}`}
                accessibilityRole="button"
                onPress={() => {
                  setCancelReason("");
                  setCancelVisible(true);
                }}
                style={styles.cancelButton}
              >
                <MaterialCommunityIcons
                  name="close-circle-outline"
                  size={18}
                  color={BrandColors.danger}
                />
                <Text style={styles.cancelText}>Cancelar pedido</Text>
              </Pressable>
            ) : null}

            {cancelVisible ? (
              <View style={[sharedStyles.card, styles.cancelForm]}>
                <Text style={styles.productName}>Motivo de cancelación</Text>
                <Text style={styles.detailLine}>
                  El cambio es definitivo y quedará registrado en el historial.
                </Text>
                <TextInput
                  accessibilityLabel="Motivo de la cancelación"
                  autoFocus
                  placeholder="Ej. cliente desistió del pedido"
                  placeholderTextColor={BrandColors.muted}
                  style={styles.input}
                  value={cancelReason}
                  onChangeText={setCancelReason}
                />
                <View style={styles.filterRow}>
                  <Pressable
                    accessibilityLabel="Volver sin cancelar"
                    accessibilityRole="button"
                    onPress={() => {
                      setCancelVisible(false);
                      setCancelReason("");
                    }}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryText}>Volver</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Confirmar cancelación del pedido"
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: !cancelReason.trim() || isSaving,
                      busy: isSaving,
                    }}
                    disabled={!cancelReason.trim() || isSaving}
                    onPress={() =>
                      void applyTransition(expanded, "cancelled", cancelReason)
                    }
                    style={[
                      styles.cancelConfirm,
                      (!cancelReason.trim() || isSaving) && styles.disabled,
                    ]}
                  >
                    <Text style={styles.cancelConfirmText}>
                      Confirmar cancelación
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <SectionTitle>Historial</SectionTitle>
            <View style={[sharedStyles.card, styles.historyCard]}>
              {expanded.history.map((entry, index) => (
                <View
                  key={entry.id}
                  style={[styles.historyRow, index > 0 && styles.borderTop]}
                >
                  <MaterialCommunityIcons
                    name="circle-medium"
                    size={20}
                    color={BrandColors.green}
                  />
                  <View style={styles.orderCopy}>
                    <Text style={styles.historyStatus}>
                      {entry.fromStatus
                        ? `${statusLabels[entry.fromStatus]} → `
                        : ""}
                      {statusLabels[entry.toStatus]}
                    </Text>
                    <Text style={styles.meta}>{entry.reason}</Text>
                  </View>
                </View>
              ))}
            </View>
            {expanded.paymentHistory.length ? (
              <>
                <SectionTitle>Historial de pago</SectionTitle>
                <View style={[sharedStyles.card, styles.historyCard]}>
                  {expanded.paymentHistory.map((entry, index) => (
                    <View
                      key={entry.id}
                      style={[styles.historyRow, index > 0 && styles.borderTop]}
                    >
                      <MaterialCommunityIcons
                        name="cash-sync"
                        size={18}
                        color={BrandColors.green}
                      />
                      <View style={styles.orderCopy}>
                        <Text style={styles.historyStatus}>
                          {paymentStatusLabels[entry.fromStatus]} →{" "}
                          {paymentStatusLabels[entry.toStatus]}
                        </Text>
                        <Text style={styles.meta}>{entry.reason}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </AdminScreen>
        ) : null}
      </Modal>
    </AdminScreen>
  );
}

function ProductDraftRow({
  product,
  value,
  policy,
  bordered,
  onChangeQuantity,
  onChangePolicy,
}: {
  product: ProductRecord;
  value: string;
  policy: SubstitutionPolicy;
  bordered: boolean;
  onChangeQuantity: (value: string) => void;
  onChangePolicy: (value: SubstitutionPolicy) => void;
}) {
  return (
    <View style={[styles.productDraft, bordered && styles.borderTop]}>
      <View style={styles.orderCopy}>
        <Text style={styles.productName}>{product.name}</Text>
        <Text style={styles.meta}>
          {formatMoney(product.priceCents)} /{" "}
          {product.baseUnit === "gram"
            ? `${product.pricingQuantity / 1000} kg`
            : `${product.pricingQuantity} un.`}
        </Text>
      </View>
      <View style={styles.quantityWrap}>
        <TextInput
          accessibilityLabel={`Cantidad de ${product.name}`}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={BrandColors.muted}
          style={styles.quantityInput}
          value={value}
          onChangeText={onChangeQuantity}
        />
        <Text style={styles.unitLabel}>
          {product.baseUnit === "gram" ? "kg" : "un."}
        </Text>
      </View>
      {value ? (
        <View style={styles.policyRow}>
          {(["allow", "contact", "remove"] as const).map((candidate) => (
            <Pressable
              accessibilityLabel={
                candidate === "allow"
                  ? "Permitir reemplazo"
                  : candidate === "contact"
                    ? "Consultar reemplazo"
                    : "Retirar si falta"
              }
              accessibilityRole="radio"
              accessibilityState={{ checked: policy === candidate }}
              key={candidate}
              onPress={() => onChangePolicy(candidate)}
              style={[
                styles.policyChoice,
                policy === candidate && styles.policyChoiceSelected,
              ]}
            >
              <Text
                style={[
                  styles.policyText,
                  policy === candidate && styles.policyTextSelected,
                ]}
              >
                {candidate === "allow"
                  ? "Reemplazar"
                  : candidate === "contact"
                    ? "Consultar"
                    : "Retirar"}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  addHeader: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.green,
  },
  closeHeader: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.inkSoft,
  },
  filterRow: { flexDirection: "row", gap: Spacing.xs },
  choice: {
    flex: 1,
    minHeight: ControlSize.default,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.xs,
  },
  choiceSelected: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  choiceText: { color: BrandColors.muted, ...Typography.label },
  choiceTextSelected: { color: BrandColors.greenDark },
  feedback: { gap: Spacing.sm },
  empty: {
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xxl,
  },
  emptyTitle: { color: BrandColors.text, ...Typography.h3 },
  muted: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
  error: { color: BrandColors.danger, ...Typography.caption },
  orderList: { gap: Spacing.sm },
  orderCard: { gap: Spacing.xs },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  orderTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  orderCopy: { flex: 1 },
  orderNumber: {
    color: BrandColors.greenDark,
    ...Typography.label,
  },
  customer: {
    color: BrandColors.text,
    ...Typography.h3,
    marginTop: Spacing.xxs,
  },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  date: { color: BrandColors.muted, ...Typography.caption },
  total: { color: BrandColors.text, ...Typography.h3 },
  formCard: { gap: Spacing.sm },
  input: {
    minHeight: ControlSize.default,
    borderWidth: 1.5,
    borderColor: BrandColors.line,
    borderRadius: ComponentMetrics.inputRadius,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
  },
  notesInput: {
    minHeight: 76,
    paddingTop: Spacing.sm,
    textAlignVertical: "top",
  },
  fieldLabel: {
    color: BrandColors.muted,
    ...Typography.overline,
  },
  zoneWrap: { gap: Spacing.xs },
  zoneChoice: {
    minHeight: ControlSize.default,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  zoneChoiceSelected: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  zoneName: { color: BrandColors.text, ...Typography.label },
  zoneFee: { color: BrandColors.greenDark, ...Typography.label },
  productsCard: { paddingVertical: Spacing.xxs },
  productDraft: { paddingVertical: Spacing.sm, gap: Spacing.xs },
  borderTop: { borderTopWidth: 1, borderTopColor: BrandColors.line },
  productName: { color: BrandColors.text, ...Typography.label },
  quantityWrap: {
    width: 105,
    minHeight: ControlSize.default,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: Radius.sm,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    position: "absolute",
    right: 0,
    top: Spacing.sm,
  },
  quantityInput: {
    flex: 1,
    color: BrandColors.text,
    ...Typography.label,
    paddingVertical: 0,
  },
  unitLabel: { color: BrandColors.muted, ...Typography.label },
  policyRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    paddingRight: ControlSize.large * 2,
  },
  policyChoice: {
    minHeight: ControlSize.default,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.surfaceMuted,
    paddingHorizontal: Spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  policyChoiceSelected: { backgroundColor: BrandColors.goldLight },
  policyText: { color: BrandColors.muted, ...Typography.label },
  policyTextSelected: { color: BrandColors.warning, ...Typography.label },
  detailCard: { gap: Spacing.xs },
  detailLine: { color: BrandColors.muted, ...Typography.caption },
  operationActions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  operationButton: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  operationButtonText: {
    color: BrandColors.greenDark,
    ...Typography.label,
  },
  operationForm: { gap: Spacing.sm },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  selectionChip: {
    minHeight: ControlSize.default,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.surfaceMuted,
    paddingHorizontal: Spacing.sm,
    justifyContent: "center",
  },
  selectionChipActive: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  selectionChipText: {
    color: BrandColors.greenDark,
    ...Typography.label,
  },
  formActions: { flexDirection: "row", gap: Spacing.xs },
  formPrimary: {
    flex: 1.5,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.green,
  },
  formPrimaryText: {
    color: BrandColors.white,
    ...Typography.label,
  },
  detailItem: {
    minHeight: 62,
    paddingVertical: Spacing.sm,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    flexWrap: "wrap",
  },
  lineTotal: { color: BrandColors.text, ...Typography.label },
  preparedField: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  preparedInput: {
    width: 100,
    minHeight: ControlSize.default,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: Radius.sm,
    color: BrandColors.text,
    ...Typography.label,
    paddingHorizontal: Spacing.sm,
  },
  preparedLabel: {
    width: "100%",
    color: BrandColors.greenDark,
    ...Typography.caption,
  },
  cancelButton: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    backgroundColor: BrandColors.dangerLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  cancelText: { color: BrandColors.danger, ...Typography.label },
  cancelForm: { gap: Spacing.sm },
  secondaryButton: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.surfaceMuted,
  },
  secondaryText: { color: BrandColors.muted, ...Typography.label },
  cancelConfirm: {
    flex: 1.5,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BrandColors.danger,
  },
  cancelConfirmText: { color: BrandColors.white, ...Typography.label },
  disabled: { opacity: Interaction.disabledOpacity },
  historyCard: { paddingVertical: Spacing.xxs },
  historyRow: {
    flexDirection: "row",
    gap: Spacing.xxs,
    alignItems: "flex-start",
    paddingVertical: Spacing.sm,
  },
  historyStatus: { color: BrandColors.text, ...Typography.label },
});
