import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import {
  ActionButton,
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
  Elevation,
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
  PaymentMethod,
  ProductRecord,
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
import { formatDateShort, formatDateTime } from "@/lib/format";
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

const sourceMeta: Record<OrderSource, { label: string; icon: string }> = {
  whatsapp: { label: "WhatsApp", icon: "whatsapp" },
  phone: { label: "Teléfono", icon: "phone-in-talk-outline" },
  online: { label: "Online", icon: "web" },
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

function paymentTone(status: OrderPaymentStatus) {
  if (status === "paid") return "green" as const;
  if (status === "failed") return "danger" as const;
  if (status === "refunded") return "neutral" as const;
  return "gold" as const;
}

function Choice<T extends string>({
  value,
  selected,
  label,
  icon,
  onPress,
}: {
  value: T;
  selected: T;
  label: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
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
      {icon ? (
        <MaterialCommunityIcons
          name={icon}
          size={17}
          color={active ? BrandColors.greenDark : BrandColors.muted}
        />
      ) : null}
      <Text style={[styles.choiceText, active && styles.choiceTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function FormDialogHeader({
  icon,
  title,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
}) {
  return (
    <View style={styles.dialogHeader}>
      <MaterialCommunityIcons
        name={icon}
        size={24}
        color={BrandColors.greenDark}
      />
      <Text maxFontSizeMultiplier={1.3} style={styles.dialogTitle}>
        {title}
      </Text>
    </View>
  );
}

export default function OrdersScreen() {
  const { preferences } = useAppPreferences();
  const { users, selectedUser, deviceId } = useLocalOperator();
  const { products } = useLocalProducts();
  const { zones } = useDeliveryZones();
  const { database, orders, isLoading, error, refresh } = useOrders();
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.round(height * 0.88);
  const [filter, setFilter] = useState<"active" | "history">("active");
  const [createVisible, setCreateVisible] = useState(false);
  const [draft, setDraft] = useState<OrderDraft>(emptyDraft);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [policies, setPolicies] = useState<Record<string, SubstitutionPolicy>>(
    {},
  );
  const [productQuery, setProductQuery] = useState("");
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

  const filteredProducts = useMemo(() => {
    const query = productQuery.trim().toLowerCase();
    if (!query) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(query) ||
        product.sku.toLowerCase().includes(query),
    );
  }, [productQuery, products]);

  const draftEstimatedCents = useMemo(() => {
    let total = 0;
    for (const product of products) {
      const raw = quantities[product.id]?.trim();
      if (!raw) continue;
      const quantity = parseDecimalToInteger(
        raw,
        product.baseUnit === "gram" ? 3 : 0,
      );
      if (quantity === null || quantity <= 0) continue;
      total += Math.round((product.priceCents * quantity) / product.pricingQuantity);
    }
    return total;
  }, [products, quantities]);

  const closeCreate = () => {
    setCreateVisible(false);
    setDraft(emptyDraft);
    setQuantities({});
    setPolicies({});
    setProductQuery("");
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

  const nextStatus = expanded ? nextOperationalStatus(expanded.order) : null;
  const paymentTransitionOptions: OrderPaymentStatus[] = expanded
    ? expanded.order.paymentStatus === "pending"
      ? ["paid", "failed"]
      : expanded.order.paymentStatus === "failed"
        ? ["pending", "paid"]
        : ["refunded"]
    : [];
  const paymentSaveDisabled =
    !expanded ||
    !paymentReason.trim() ||
    isSaving ||
    (paymentTarget === "paid" &&
      expanded?.order.paymentMethod !== "cash" &&
      !paymentReference.trim());
  const substitutionSaveDisabled =
    !substitutionItemId || !replacementProductId || isSaving;

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
      {!selectedUser ? (
        <View style={[sharedStyles.card, styles.operatorNotice]}>
          <MaterialCommunityIcons
            name="account-key-outline"
            size={22}
            color={BrandColors.warning}
          />
          <View style={styles.operatorNoticeCopy}>
            <Text style={styles.operatorNoticeTitle}>Falta tu operador</Text>
            <Text style={styles.operatorNoticeText}>
              Activa tu perfil con PIN en la pestaña Más para registrar o mover
              pedidos.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.filterRow}>
        <Choice
          value="active"
          selected={filter}
          label="En curso"
          icon="clipboard-list-outline"
          onPress={setFilter}
        />
        <Choice
          value="history"
          selected={filter}
          label="Historial"
          icon="history"
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
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons
              name="clipboard-text-clock-outline"
              size={30}
              color={BrandColors.green}
            />
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
            Sin pedidos en esta vista
          </Text>
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
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={styles.orderNumber}
                  adjustsFontSizeToFit
                  numberOfLines={1}
                >
                  {order.orderNumber}
                </Text>
                <Pill
                  label={statusLabels[order.status]}
                  tone={statusTone(order.status)}
                />
              </View>
              <Text
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                style={styles.customer}
              >
                {order.customerName}
              </Text>
              <View style={styles.metaRow}>
                <MaterialCommunityIcons
                  name={
                    sourceMeta[order.source].icon as keyof typeof MaterialCommunityIcons.glyphMap
                  }
                  size={14}
                  color={BrandColors.muted}
                />
                <Text numberOfLines={1} style={styles.meta}>
                  {sourceMeta[order.source].label} · {order.itemCount}{" "}
                  producto{order.itemCount === 1 ? "" : "s"} ·{" "}
                  {order.fulfillmentType === "delivery"
                    ? (order.deliveryZoneName ?? "Delivery")
                    : "Recojo"}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.date}>
                  {formatDateShort(new Date(order.createdAt))}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.4}
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  style={styles.total}
                >
                  {formatMoney(
                    order.finalTotalCents ?? order.estimatedTotalCents,
                  )}
                </Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={18}
                  color={BrandColors.muted}
                />
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
          <View style={styles.searchWrap}>
            <MaterialCommunityIcons
              name="magnify"
              size={21}
              color={BrandColors.muted}
            />
            <TextInput
              accessibilityLabel="Buscar producto"
              onChangeText={setProductQuery}
              placeholder="Buscar producto o código"
              placeholderTextColor={BrandColors.muted}
              style={styles.searchInput}
              value={productQuery}
            />
            {productQuery ? (
              <Pressable
                accessibilityLabel="Limpiar búsqueda"
                accessibilityRole="button"
                onPress={() => setProductQuery("")}
                style={styles.clearButton}
              >
                <MaterialCommunityIcons
                  name="close-circle"
                  size={19}
                  color={BrandColors.muted}
                />
              </Pressable>
            ) : null}
          </View>
          <View style={[sharedStyles.card, styles.productsCard]}>
            {filteredProducts.length ? (
              filteredProducts.map((product, index) => (
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
              ))
            ) : (
              <Text style={styles.muted}>
                No hay productos que coincidan con la búsqueda.
              </Text>
            )}
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
          {draftEstimatedCents > 0 ? (
            <View style={styles.estimateRow}>
              <Text style={styles.estimateLabel}>TOTAL ESTIMADO</Text>
              <Text
                maxFontSizeMultiplier={1.4}
                adjustsFontSizeToFit
                numberOfLines={1}
                style={styles.estimateValue}
              >
                {formatMoney(draftEstimatedCents)}
              </Text>
            </View>
          ) : null}
          <PrimaryButton
            label={isSaving ? "Guardando…" : "Registrar pedido"}
            icon="content-save-outline"
            loading={isSaving}
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

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        onClose={() => setExpanded(null)}
        placement="bottom"
        visible={expanded !== null}
      >
        {expanded ? (
          <>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
                  {expanded.order.orderNumber}
                </Text>
                <Text style={styles.sheetDate}>
                  {formatDateShort(new Date(expanded.order.createdAt))}
                </Text>
              </View>
              <Pill
                label={statusLabels[expanded.order.status]}
                tone={statusTone(expanded.order.status)}
              />
              <Pressable
                accessibilityLabel="Cerrar detalle del pedido"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setExpanded(null)}
                style={styles.sheetClose}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={BrandColors.muted}
                />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetBody}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.sheetScroll}
            >
              <View style={[sharedStyles.card, styles.summaryCard]}>
                <View style={styles.summaryRow}>
                  <MaterialCommunityIcons
                    name="account-outline"
                    size={16}
                    color={BrandColors.muted}
                  />
                  <Text style={styles.summaryText}>
                    {expanded.customer.name} · {expanded.customer.phone}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <MaterialCommunityIcons
                    name={
                      expanded.order.fulfillmentType === "delivery"
                        ? "moped-outline"
                        : "store-marker-outline"
                    }
                    size={16}
                    color={BrandColors.muted}
                  />
                  <Text style={styles.summaryText}>
                    {expanded.order.fulfillmentType === "delivery"
                      ? `Delivery · ${expanded.address?.address}, ${expanded.address?.district}`
                      : "Recojo en tienda"}
                  </Text>
                </View>
                {expanded.order.scheduledFor ? (
                  <View style={styles.summaryRow}>
                    <MaterialCommunityIcons
                      name="clock-outline"
                      size={16}
                      color={BrandColors.muted}
                    />
                    <Text style={styles.summaryText}>
                      Programado:{" "}
                      {formatDateTime(new Date(expanded.order.scheduledFor))}
                    </Text>
                  </View>
                ) : null}
                {expanded.order.assignedUserId ? (
                  <View style={styles.summaryRow}>
                    <MaterialCommunityIcons
                      name="account-check-outline"
                      size={16}
                      color={BrandColors.muted}
                    />
                    <Text style={styles.summaryText}>
                      Responsable:{" "}
                      {users.find(
                        (user) => user.id === expanded.order.assignedUserId,
                      )?.displayName ?? "Usuario sincronizado"}
                    </Text>
                  </View>
                ) : null}
                {expanded.order.notes ? (
                  <View style={styles.summaryRow}>
                    <MaterialCommunityIcons
                      name="text-box-outline"
                      size={16}
                      color={BrandColors.muted}
                    />
                    <Text style={styles.summaryText}>
                      Nota: {expanded.order.notes}
                    </Text>
                  </View>
                ) : null}
                <View style={[styles.summaryRow, styles.paymentDivider]}>
                  <MaterialCommunityIcons
                    name="cash-multiple"
                    size={16}
                    color={BrandColors.muted}
                  />
                  <Text style={styles.summaryText}>
                    {paymentMethodLabels[expanded.order.paymentMethod]}
                    {expanded.order.paymentReference
                      ? ` · Ref. ${expanded.order.paymentReference}`
                      : ""}
                  </Text>
                  <Pill
                    label={paymentStatusLabels[expanded.order.paymentStatus]}
                    tone={paymentTone(expanded.order.paymentStatus)}
                  />
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.estimateLabel}>TOTAL</Text>
                  <Text
                    maxFontSizeMultiplier={1.4}
                    adjustsFontSizeToFit
                    numberOfLines={1}
                    style={styles.sheetTotal}
                  >
                    {formatMoney(
                      expanded.order.finalTotalCents ??
                        expanded.order.estimatedTotalCents,
                    )}
                  </Text>
                </View>
                {selectedUser?.role === "administrator" &&
                expanded.order.paymentStatus !== "refunded" &&
                (expanded.order.status !== "cancelled" ||
                  expanded.order.paymentStatus === "paid") ? (
                  <Pressable
                    accessibilityLabel="Gestionar pago"
                    accessibilityRole="button"
                    onPress={openPaymentForm}
                    style={styles.linkButton}
                  >
                    <MaterialCommunityIcons
                      name="cash-check"
                      size={17}
                      color={BrandColors.greenDark}
                    />
                    <Text style={styles.linkButtonText}>Gestionar pago</Text>
                  </Pressable>
                ) : null}
              </View>

              {!["delivered", "cancelled"].includes(expanded.order.status) ? (
                <View style={styles.operationActions}>
                  {selectedUser?.role === "administrator" ? (
                    <Pressable
                      accessibilityLabel="Planificar pedido"
                      accessibilityRole="button"
                      onPress={() => openOperationForm("planning")}
                      style={({ pressed }) => [
                        styles.operationButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="calendar-clock"
                        size={17}
                        color={BrandColors.greenDark}
                      />
                      <Text style={styles.operationButtonText}>
                        Planificar
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityLabel="Registrar incidencia"
                    accessibilityRole="button"
                    onPress={() => openOperationForm("incident")}
                    style={({ pressed }) => [
                      styles.operationButton,
                      pressed && styles.pressed,
                    ]}
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
                      style={({ pressed }) => [
                        styles.operationButton,
                        pressed && styles.pressed,
                      ]}
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
              ) : null}

              <Text style={styles.sheetSectionLabel}>
                PRODUCTOS ({expanded.items.length})
              </Text>
              <View style={[sharedStyles.card, styles.productsCard]}>
                {expanded.items.map((item, index) => (
                  <View
                    key={item.id}
                    style={[styles.detailItem, index > 0 && styles.borderTop]}
                  >
                    <View style={styles.itemDot} />
                    <View style={styles.orderCopy}>
                      <Text numberOfLines={2} style={styles.productName}>
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
                    <Text style={styles.lineTotal}>
                      {formatMoney(item.finalCents ?? item.estimatedCents)}
                    </Text>
                  </View>
                ))}
              </View>

              {expanded.substitutions.length ? (
                <>
                  <Text style={styles.sheetSectionLabel}>SUSTITUCIONES</Text>
                  <View style={[sharedStyles.card, styles.historyCard]}>
                    {expanded.substitutions.map((substitution, index) => (
                      <View
                        key={substitution.id}
                        style={[
                          styles.historyRow,
                          index > 0 && styles.borderTop,
                        ]}
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
                            <Text style={styles.meta}>
                              {substitution.notes}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              {expanded.incidents.length ? (
                <>
                  <Text style={styles.sheetSectionLabel}>INCIDENCIAS</Text>
                  <View style={[sharedStyles.card, styles.historyCard]}>
                    {expanded.incidents.map((incident, index) => (
                      <View
                        key={incident.id}
                        style={[
                          styles.historyRow,
                          index > 0 && styles.borderTop,
                        ]}
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
                          <Text style={styles.meta}>
                            {incident.description}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              <Text style={styles.sheetSectionLabel}>HISTORIAL</Text>
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
                  <Text style={styles.sheetSectionLabel}>
                    HISTORIAL DE PAGO
                  </Text>
                  <View style={[sharedStyles.card, styles.historyCard]}>
                    {expanded.paymentHistory.map((entry, index) => (
                      <View
                        key={entry.id}
                        style={[
                          styles.historyRow,
                          index > 0 && styles.borderTop,
                        ]}
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
            </ScrollView>

            <View style={styles.sheetFooter}>
              {expanded.order.status === "preparing" ? (
                <PrimaryButton
                  label="Confirmar cantidades reales"
                  icon="scale-balance"
                  loading={isSaving}
                  onPress={() => void finishPreparation()}
                  disabled={isSaving}
                />
              ) : nextStatus ? (
                <PrimaryButton
                  label={
                    actionLabels[nextStatus as OrderStatus] ?? "Siguiente estado"
                  }
                  icon="arrow-right"
                  loading={isSaving}
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
                  style={styles.cancelLink}
                >
                  <MaterialCommunityIcons
                    name="close-circle-outline"
                    size={18}
                    color={BrandColors.danger}
                  />
                  <Text style={styles.cancelLinkText}>Cancelar pedido</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}
      </ModalSurface>

      <ModalSurface
        dialogStyle={styles.dialog}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setOperationForm(null);
        }}
        visible={operationForm === "payment" && expanded !== null}
      >
        {expanded ? (
          <>
            <FormDialogHeader icon="cash-check" title="Actualizar pago" />
            <Text style={styles.dialogHint}>
              {paymentMethodLabels[expanded.order.paymentMethod]} · Estado
              actual: {paymentStatusLabels[expanded.order.paymentStatus]}
            </Text>
            <View style={styles.chipWrap}>
              {paymentTransitionOptions.map((status) => (
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
            <View style={styles.dialogActions}>
              <ActionButton
                compact
                disabled={isSaving}
                label="Cancelar"
                onPress={() => setOperationForm(null)}
                style={styles.dialogButton}
                tone="ghost"
              />
              <ActionButton
                compact
                disabled={paymentSaveDisabled}
                label="Guardar"
                loading={isSaving}
                onPress={() => void savePayment()}
                style={styles.dialogButton}
              />
            </View>
          </>
        ) : null}
      </ModalSurface>

      <ModalSurface
        dialogStyle={styles.dialog}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setOperationForm(null);
        }}
        visible={operationForm === "planning" && expanded !== null}
      >
        <FormDialogHeader icon="calendar-clock" title="Planificar pedido" />
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
            <Text style={styles.selectionChipText}>Sin asignar</Text>
          </Pressable>
          {users.map((user) => (
            <Pressable
              accessibilityLabel={user.displayName}
              accessibilityRole="radio"
              accessibilityState={{ selected: assignedUserId === user.id }}
              key={user.id}
              onPress={() => setAssignedUserId(user.id)}
              style={[
                styles.selectionChip,
                assignedUserId === user.id && styles.selectionChipActive,
              ]}
            >
              <Text style={styles.selectionChipText}>{user.displayName}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.dialogActions}>
          <ActionButton
            compact
            disabled={isSaving}
            label="Cancelar"
            onPress={() => setOperationForm(null)}
            style={styles.dialogButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={isSaving}
            label="Guardar"
            loading={isSaving}
            onPress={() => void savePlanning()}
            style={styles.dialogButton}
          />
        </View>
      </ModalSurface>

      <ModalSurface
        dialogStyle={styles.dialog}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setOperationForm(null);
        }}
        visible={operationForm === "incident" && expanded !== null}
      >
        <FormDialogHeader icon="alert-circle-outline" title="Nueva incidencia" />
        <View style={styles.chipWrap}>
          {(Object.keys(incidentLabels) as OrderIncidentType[]).map((type) => (
            <Pressable
              accessibilityLabel={incidentLabels[type]}
              accessibilityRole="radio"
              accessibilityState={{ selected: incidentType === type }}
              key={type}
              onPress={() => setIncidentType(type)}
              style={[
                styles.selectionChip,
                incidentType === type && styles.selectionChipActive,
              ]}
            >
              <Text style={styles.selectionChipText}>
                {incidentLabels[type]}
              </Text>
            </Pressable>
          ))}
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
        <View style={styles.dialogActions}>
          <ActionButton
            compact
            disabled={isSaving}
            label="Cancelar"
            onPress={() => setOperationForm(null)}
            style={styles.dialogButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={!incidentDescription.trim() || isSaving}
            label="Registrar"
            loading={isSaving}
            onPress={() => void saveIncident()}
            style={styles.dialogButton}
          />
        </View>
      </ModalSurface>

      <ModalSurface
        dialogStyle={styles.dialog}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setOperationForm(null);
        }}
        visible={operationForm === "substitution" && expanded !== null}
      >
        <FormDialogHeader
          icon="swap-horizontal"
          title="Proponer sustitución"
        />
        <Text style={styles.fieldLabel}>PRODUCTO DEL PEDIDO</Text>
        <View style={styles.chipWrap}>
          {expanded?.items
            .filter((item) => item.substitutionPolicy !== "remove")
            .map((item) => (
              <Pressable
                accessibilityLabel={item.productNameSnapshot}
                accessibilityRole="radio"
                accessibilityState={{ selected: substitutionItemId === item.id }}
                key={item.id}
                onPress={() => setSubstitutionItemId(item.id)}
                style={[
                  styles.selectionChip,
                  substitutionItemId === item.id && styles.selectionChipActive,
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
                  expanded?.items.find((item) => item.id === substitutionItemId)
                    ?.productId,
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
                <Text style={styles.selectionChipText}>{product.name}</Text>
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
        <View style={styles.dialogActions}>
          <ActionButton
            compact
            disabled={isSaving}
            label="Cancelar"
            onPress={() => setOperationForm(null)}
            style={styles.dialogButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={substitutionSaveDisabled}
            label="Proponer"
            loading={isSaving}
            onPress={() => void saveSubstitution()}
            style={styles.dialogButton}
          />
        </View>
      </ModalSurface>

      <ModalSurface
        dialogStyle={styles.dialog}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setCancelVisible(false);
        }}
        visible={cancelVisible && expanded !== null}
      >
        <FormDialogHeader
          icon="close-circle-outline"
          title={`Cancelar ${expanded?.order.orderNumber ?? ""}`}
        />
        <Text style={styles.dialogHint}>
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
        <View style={styles.dialogActions}>
          <ActionButton
            compact
            disabled={isSaving}
            label="Volver"
            onPress={() => {
              setCancelVisible(false);
              setCancelReason("");
            }}
            style={styles.dialogButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={!cancelReason.trim() || isSaving}
            label="Confirmar cancelación"
            loading={isSaving}
            onPress={() => {
              if (expanded) {
                void applyTransition(expanded, "cancelled", cancelReason);
              }
              setCancelVisible(false);
            }}
            style={styles.dialogButton}
            tone="danger"
          />
        </View>
      </ModalSurface>
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
      <View style={styles.productDraftMain}>
        <View style={styles.orderCopy}>
          <Text numberOfLines={2} style={styles.productName}>
            {product.name}
          </Text>
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
  operatorNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  operatorNoticeCopy: { flex: 1 },
  operatorNoticeTitle: { color: BrandColors.text, ...Typography.label },
  operatorNoticeText: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
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
    flexDirection: "row",
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.xs,
    gap: Spacing.xxs,
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
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { color: BrandColors.text, ...Typography.h3 },
  muted: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
  error: { color: BrandColors.danger, ...Typography.caption },
  orderList: { gap: Spacing.sm },
  orderCard: {
    gap: Spacing.xxs,
    ...Elevation.ambientCard,
  },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  orderTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  orderCopy: { flex: 1 },
  orderNumber: {
    flexShrink: 1,
    color: BrandColors.greenDark,
    ...Typography.label,
  },
  customer: {
    color: BrandColors.text,
    ...Typography.h3,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xxs,
  },
  meta: {
    flexShrink: 1,
    color: BrandColors.muted,
    ...Typography.caption,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
    marginTop: Spacing.xxs,
  },
  date: { color: BrandColors.muted, ...Typography.caption },
  total: { color: BrandColors.text, ...Typography.h3, flexShrink: 1 },
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
  searchWrap: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: Spacing.md,
    gap: Spacing.xs,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: BrandColors.text,
    ...Typography.body,
    paddingVertical: 13,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  clearButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
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
  productDraftMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  borderTop: { borderTopWidth: 1, borderTopColor: BrandColors.line },
  productName: { color: BrandColors.text, ...Typography.label },
  quantityWrap: {
    width: 105,
    minHeight: ControlSize.compact,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: Radius.sm,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xxs,
  },
  quantityInput: {
    flex: 1,
    minWidth: 0,
    color: BrandColors.text,
    ...Typography.label,
    paddingVertical: 0,
    textAlign: "right",
  },
  unitLabel: { color: BrandColors.muted, ...Typography.label },
  policyRow: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  policyChoice: {
    minHeight: ControlSize.compact,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.surfaceMuted,
    paddingHorizontal: Spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  policyChoiceSelected: { backgroundColor: BrandColors.goldLight },
  policyText: { color: BrandColors.muted, ...Typography.label },
  policyTextSelected: { color: BrandColors.warning, ...Typography.label },
  estimateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: BrandColors.greenLight,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  estimateLabel: {
    color: BrandColors.greenDark,
    ...Typography.overline,
  },
  estimateValue: {
    color: BrandColors.greenDark,
    ...Typography.h3,
    flexShrink: 1,
  },
  sheet: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  sheetScroll: { flexShrink: 1 },
  sheetBody: { gap: Spacing.sm, paddingBottom: Spacing.xs },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  sheetHeaderCopy: { flex: 1 },
  sheetTitle: { color: BrandColors.text, ...Typography.h3 },
  sheetDate: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  sheetClose: {
    width: ControlSize.compact,
    height: ControlSize.compact,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetSectionLabel: {
    color: BrandColors.muted,
    ...Typography.overline,
    marginTop: Spacing.xxs,
  },
  sheetTotal: { color: BrandColors.greenDark, ...Typography.h2, flexShrink: 1 },
  sheetFooter: { gap: Spacing.xxs },
  summaryCard: { gap: Spacing.xs },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  summaryText: {
    flex: 1,
    color: BrandColors.muted,
    ...Typography.caption,
  },
  paymentDivider: {
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    paddingTop: Spacing.xs,
    marginTop: Spacing.xxs,
  },
  linkButton: {
    minHeight: ControlSize.compact,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  linkButtonText: { color: BrandColors.greenDark, ...Typography.label },
  detailLine: { color: BrandColors.muted, ...Typography.caption },
  operationActions: { flexDirection: "row", gap: Spacing.xs },
  operationButton: {
    flex: 1,
    minHeight: ControlSize.compact,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.xs,
  },
  operationButtonText: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
  },
  detailItem: {
    paddingVertical: Spacing.sm,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
  },
  itemDot: {
    width: 5,
    height: 5,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.green,
    marginTop: Spacing.xs + 1,
  },
  lineTotal: { color: BrandColors.text, ...Typography.label },
  preparedField: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  preparedInput: {
    width: 100,
    minHeight: ControlSize.compact,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: Radius.sm,
    color: BrandColors.text,
    ...Typography.label,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    textAlignVertical: "center",
  },
  preparedLabel: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  cancelLink: {
    minHeight: ControlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  cancelLinkText: { color: BrandColors.danger, ...Typography.label },
  dialog: {
    backgroundColor: BrandColors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  dialogHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  dialogTitle: { color: BrandColors.text, ...Typography.h3, flex: 1 },
  dialogHint: { color: BrandColors.muted, ...Typography.caption },
  dialogActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  dialogButton: { flex: 1 },
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
  historyCard: { paddingVertical: Spacing.xxs },
  historyRow: {
    flexDirection: "row",
    gap: Spacing.xxs,
    alignItems: "flex-start",
    paddingVertical: Spacing.sm,
  },
  historyStatus: { color: BrandColors.text, ...Typography.label },
  disabled: { opacity: Interaction.disabledOpacity },
});
