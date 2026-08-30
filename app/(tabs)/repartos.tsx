import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AdminScreen,
  Pill,
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
import { useLocalOperator } from "@/context/local-operator-context";
import type { DeliveryAssignmentRecord } from "@/database/models";
import {
  assignDelivery,
  confirmDelivery,
  listDeliveryAssignments,
  startDelivery,
} from "@/database/repositories/delivery-assignment-repository";
import { createOrderIncident } from "@/database/repositories/order-operations-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { useOrders } from "@/hooks/use-orders";
import {
  listDeliveryOperators,
  saveDeliveryOperator,
  type DeliveryOperator,
} from "@/online/delivery-admin-api";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";

const deliveryStatusLabels: Record<DeliveryAssignmentRecord["status"], string> =
  {
    assigned: "Asignado",
    en_route: "En ruta",
    delivered: "Entregado",
    failed: "Fallido",
    cancelled: "Cancelado",
  };

export default function DeliveriesScreen() {
  const { users, selectedUser, deviceId } = useLocalOperator();
  const { database, orders, refresh: refreshOrders } = useOrders();
  const [assignments, setAssignments] = useState<DeliveryAssignmentRecord[]>(
    [],
  );
  const [selectedDriver, setSelectedDriver] = useState("");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState<DeliveryAssignmentRecord | null>(
    null,
  );
  const [recipientName, setRecipientName] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [evidenceUri, setEvidenceUri] = useState("");
  const [incident, setIncident] = useState("");
  const [operators, setOperators] = useState<DeliveryOperator[]>([]);
  const [operatorName, setOperatorName] = useState("");
  const [trackingBaseUrl, setTrackingBaseUrl] = useState("");
  const [supportPhone, setSupportPhone] = useState("");

  const load = useCallback(async () => {
    const driverFilter =
      selectedUser?.role === "administrator" ? undefined : selectedUser?.id;
    setAssignments(
      await listDeliveryAssignments(database, DEFAULT_STORE_ID, driverFilter),
    );
    if (selectedUser?.role === "administrator") {
      try {
        setOperators(await listDeliveryOperators());
      } catch {
        setOperators([]);
      }
    }
    await refreshOrders(false);
  }, [database, refreshOrders, selectedUser?.id, selectedUser?.role]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const availableOrders = orders.filter(
    (order) =>
      order.fulfillmentType === "delivery" &&
      ["ready", "out_for_delivery"].includes(order.status) &&
      !assignments.some(
        (assignment) =>
          assignment.orderId === order.id &&
          !["failed", "cancelled"].includes(assignment.status),
      ),
  );

  const assign = async (orderId: string) => {
    if (!selectedUser || !selectedDriver) return;
    try {
      await assignDelivery(database, {
        storeId: DEFAULT_STORE_ID,
        orderId,
        driverUserId: selectedDriver,
        notes,
        actorUserId: selectedUser.id,
        deviceId,
      });
      setNotes("");
      await load();
    } catch (caughtError) {
      Alert.alert(
        "No se pudo asignar",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    }
  };

  const start = async (assignmentId: string) => {
    if (!selectedUser) return;
    try {
      await startDelivery(database, {
        storeId: DEFAULT_STORE_ID,
        assignmentId,
        actorUserId: selectedUser.id,
        deviceId,
      });
      await load();
    } catch (caughtError) {
      Alert.alert(
        "No se pudo iniciar",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    }
  };

  const confirm = async () => {
    if (!selectedUser || !confirming) return;
    try {
      await confirmDelivery(database, {
        storeId: DEFAULT_STORE_ID,
        assignmentId: confirming.id,
        recipientName,
        confirmationCode,
        evidenceUri,
        notes,
        actorUserId: selectedUser.id,
        deviceId,
      });
      setConfirming(null);
      setRecipientName("");
      setConfirmationCode("");
      setEvidenceUri("");
      setNotes("");
      await load();
    } catch (caughtError) {
      Alert.alert(
        "No se pudo confirmar",
        getOperatorErrorMessage(
          caughtError,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    }
  };

  const captureEvidence = async () => {
    if (!confirming) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Permiso requerido",
        "Habilita la cámara para adjuntar evidencia.",
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.72,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;
    try {
      const evidenceDirectory = new Directory(
        Paths.document,
        "delivery-evidence",
      );
      evidenceDirectory.create({ idempotent: true, intermediates: true });
      const source = new File(result.assets[0].uri);
      const extension = source.extension || ".jpg";
      const destination = new File(
        evidenceDirectory,
        `${confirming.id}-${Date.now()}${extension}`,
      );
      source.copy(destination);
      setEvidenceUri(destination.uri);
    } catch (caughtError) {
      Alert.alert(
        "No se pudo guardar la foto",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    }
  };

  const report = async (assignment: DeliveryAssignmentRecord) => {
    if (!selectedUser || !incident.trim()) return;
    try {
      await createOrderIncident(database, {
        storeId: DEFAULT_STORE_ID,
        orderId: assignment.orderId,
        type: "delivery",
        description: incident,
        actorUserId: selectedUser.id,
        deviceId,
      });
      setIncident("");
      Alert.alert(
        "Incidencia registrada",
        "Quedó pendiente de sincronización.",
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo registrar",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    }
  };

  const saveOperator = async () => {
    try {
      await saveDeliveryOperator({
        name: operatorName,
        operatorType: "external",
        integrationMode: "manual",
        trackingBaseUrl,
        supportPhone,
        priority: operators.length + 1,
      });
      setOperatorName("");
      setTrackingBaseUrl("");
      setSupportPhone("");
      setOperators(await listDeliveryOperators());
    } catch (caughtError) {
      Alert.alert(
        "No se pudo guardar",
        getOperatorErrorMessage(
          caughtError,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    }
  };

  return (
    <AdminScreen
      title="Repartos"
      subtitle="Despacho, ruta y confirmación de entrega"
    >
      <OperatorSelector />
      {selectedUser?.role === "administrator" ? (
        <>
          <SectionTitle
            action={<Pill label={`${availableOrders.length}`} tone="gold" />}
          >
            Pedidos listos para despacho
          </SectionTitle>
          <View style={styles.chips}>
            {users.map((user) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedDriver === user.id }}
                key={user.id}
                onPress={() => setSelectedDriver(user.id)}
                style={[
                  styles.chip,
                  selectedDriver === user.id && styles.chipActive,
                ]}
              >
                <Text style={styles.chipText}>{user.displayName}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="Nota de ruta"
            placeholder="Nota de ruta (opcional)"
            placeholderTextColor={BrandColors.muted}
            style={styles.input}
            value={notes}
            onChangeText={setNotes}
          />
          {availableOrders.map((order) => (
            <View key={order.id} style={[sharedStyles.card, styles.card]}>
              <View style={styles.fill}>
                <Text style={styles.title}>{order.orderNumber}</Text>
                <Text style={styles.meta}>
                  {order.customerName} · {order.deliveryZoneName}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={`Asignar pedido ${order.orderNumber}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: !selectedDriver }}
                disabled={!selectedDriver}
                onPress={() => void assign(order.id)}
                style={[styles.primary, !selectedDriver && styles.disabled]}
              >
                <Text style={styles.primaryText}>Asignar</Text>
              </Pressable>
            </View>
          ))}
          <SectionTitle>Operadores externos</SectionTitle>
          <View style={[sharedStyles.card, styles.confirm]}>
            {operators.map((operator) => (
              <View key={operator.id} style={styles.top}>
                <View style={styles.fill}>
                  <Text style={styles.title}>{operator.name}</Text>
                  <Text style={styles.meta}>
                    {operator.integrationMode === "manual"
                      ? "Asignación manual"
                      : "API configurada en backend"}
                  </Text>
                </View>
                <Pill
                  label={operator.isActive ? "Activo" : "Inactivo"}
                  tone="neutral"
                />
              </View>
            ))}
            <TextInput
              accessibilityLabel="Nombre del operador"
              placeholder="Nombre del operador"
              placeholderTextColor={BrandColors.muted}
              style={styles.input}
              value={operatorName}
              onChangeText={setOperatorName}
            />
            <TextInput
              accessibilityLabel="URL base de tracking"
              autoCapitalize="none"
              placeholder="URL base de tracking (sin secretos)"
              placeholderTextColor={BrandColors.muted}
              style={styles.input}
              value={trackingBaseUrl}
              onChangeText={setTrackingBaseUrl}
            />
            <TextInput
              accessibilityLabel="Teléfono de soporte"
              keyboardType="phone-pad"
              placeholder="Teléfono de soporte"
              placeholderTextColor={BrandColors.muted}
              style={styles.input}
              value={supportPhone}
              onChangeText={setSupportPhone}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !operatorName.trim() }}
              disabled={!operatorName.trim()}
              onPress={() => void saveOperator()}
              style={[styles.primary, !operatorName.trim() && styles.disabled]}
            >
              <Text style={styles.primaryText}>Guardar operador manual</Text>
            </Pressable>
          </View>
        </>
      ) : null}
      <SectionTitle
        action={<Pill label={`${assignments.length}`} tone="neutral" />}
      >
        Entregas asignadas
      </SectionTitle>
      {assignments.map((assignment) => (
        <View
          key={assignment.id}
          style={[sharedStyles.card, styles.deliveryCard]}
        >
          <View style={styles.top}>
            <View style={styles.fill}>
              <Text style={styles.title}>{assignment.orderNumber}</Text>
              <Text style={styles.meta}>
                {assignment.customerName} · {assignment.customerPhone}
              </Text>
            </View>
            <Pill
              label={deliveryStatusLabels[assignment.status]}
              tone={assignment.status === "delivered" ? "green" : "gold"}
            />
          </View>
          <Text style={styles.address}>
            {assignment.address}, {assignment.district}
          </Text>
          {assignment.instructions ? (
            <Text style={styles.meta}>{assignment.instructions}</Text>
          ) : null}
          <Text style={styles.meta}>Repartidor: {assignment.driverName}</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel={`Abrir mapa para ${assignment.orderNumber}`}
              accessibilityRole="link"
              onPress={() =>
                void Linking.openURL(
                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${assignment.address}, ${assignment.district}, Lima`)}`,
                )
              }
              style={styles.secondary}
            >
              <MaterialCommunityIcons
                name="map-marker-path"
                size={Typography.h3.fontSize}
                color={BrandColors.greenDark}
              />
              <Text style={styles.secondaryText}>Mapa</Text>
            </Pressable>
            {assignment.status === "assigned" ? (
              <Pressable
                accessibilityLabel={`Iniciar ruta de ${assignment.orderNumber}`}
                accessibilityRole="button"
                onPress={() => void start(assignment.id)}
                style={styles.primary}
              >
                <Text style={styles.primaryText}>Iniciar ruta</Text>
              </Pressable>
            ) : null}
            {assignment.status === "en_route" ? (
              <Pressable
                accessibilityLabel={`Confirmar entrega de ${assignment.orderNumber}`}
                accessibilityRole="button"
                onPress={() => setConfirming(assignment)}
                style={styles.primary}
              >
                <Text style={styles.primaryText}>Entregar</Text>
              </Pressable>
            ) : null}
          </View>
          {assignment.status === "en_route" ? (
            <View style={styles.incidentRow}>
              <TextInput
                accessibilityLabel={`Incidencia para ${assignment.orderNumber}`}
                placeholder="Incidencia: ausencia, dirección…"
                placeholderTextColor={BrandColors.muted}
                style={[styles.input, styles.fill]}
                value={incident}
                onChangeText={setIncident}
              />
              <Pressable
                accessibilityLabel={`Registrar incidencia de ${assignment.orderNumber}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: !incident.trim() }}
                disabled={!incident.trim()}
                onPress={() => void report(assignment)}
                style={[styles.iconButton, !incident.trim() && styles.disabled]}
              >
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={Spacing.xl}
                  color={BrandColors.danger}
                />
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}
      {confirming ? (
        <View style={[sharedStyles.card, styles.confirm]}>
          <Text style={styles.title}>Confirmar {confirming.orderNumber}</Text>
          <TextInput
            accessibilityLabel="Nombre de quien recibe"
            placeholder="Nombre de quien recibe"
            placeholderTextColor={BrandColors.muted}
            style={styles.input}
            value={recipientName}
            onChangeText={setRecipientName}
          />
          <TextInput
            accessibilityLabel="Código de recepción"
            placeholder="Código de recepción (opcional)"
            placeholderTextColor={BrandColors.muted}
            style={styles.input}
            value={confirmationCode}
            onChangeText={setConfirmationCode}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => void captureEvidence()}
            style={styles.secondary}
          >
            <MaterialCommunityIcons
              name="camera-outline"
              size={Typography.h3.fontSize}
              color={BrandColors.greenDark}
            />
            <Text style={styles.secondaryText}>
              {evidenceUri
                ? "Foto adjuntada · reemplazar"
                : "Tomar foto de evidencia"}
            </Text>
          </Pressable>
          {!confirmationCode.trim() && !evidenceUri ? (
            <Text style={styles.meta}>
              Registra un código o toma una foto para acreditar la entrega.
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirming(null)}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled:
                  !recipientName.trim() ||
                  (!confirmationCode.trim() && !evidenceUri),
              }}
              disabled={
                !recipientName.trim() ||
                (!confirmationCode.trim() && !evidenceUri)
              }
              onPress={() => void confirm()}
              style={[
                styles.primary,
                (!recipientName.trim() ||
                  (!confirmationCode.trim() && !evidenceUri)) &&
                  styles.disabled,
              ]}
            >
              <Text style={styles.primaryText}>Confirmar entrega</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: {
    minHeight: ControlSize.default,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: BrandColors.line,
    paddingHorizontal: Spacing.sm,
    backgroundColor: BrandColors.white,
    justifyContent: "center",
  },
  chipActive: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  chipText: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
  },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
    color: BrandColors.text,
    ...Typography.body,
  },
  card: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  deliveryCard: { gap: Spacing.sm },
  top: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  fill: { flex: 1 },
  title: { color: BrandColors.text, ...Typography.label },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  address: { color: BrandColors.text, ...Typography.label },
  actions: { flexDirection: "row", gap: Spacing.xs },
  primary: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.sm,
  },
  primaryText: { color: BrandColors.white, ...Typography.label },
  secondary: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  secondaryText: { color: BrandColors.greenDark, ...Typography.label },
  iconButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  incidentRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  confirm: { gap: Spacing.sm },
  disabled: { opacity: Interaction.disabledOpacity },
});
