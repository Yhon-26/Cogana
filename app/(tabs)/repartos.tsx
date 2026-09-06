import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  Alert,
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
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.round(height * 0.88);
  const [assignments, setAssignments] = useState<DeliveryAssignmentRecord[]>(
    [],
  );
  const [selectedDriver, setSelectedDriver] = useState("");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState<DeliveryAssignmentRecord | null>(
    null,
  );
  const [detail, setDetail] = useState<DeliveryAssignmentRecord | null>(null);
  const [incidentTarget, setIncidentTarget] =
    useState<DeliveryAssignmentRecord | null>(null);
  const [incident, setIncident] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [evidenceUri, setEvidenceUri] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [operators, setOperators] = useState<DeliveryOperator[]>([]);
  const [operatorSheetVisible, setOperatorSheetVisible] = useState(false);
  const [operatorName, setOperatorName] = useState("");
  const [trackingBaseUrl, setTrackingBaseUrl] = useState("");
  const [supportPhone, setSupportPhone] = useState("");

  const load = useCallback(async () => {
    try {
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
    } catch (caughtError) {
      Alert.alert(
        "No se pudieron cargar los repartos",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    }
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
  const canManage = selectedUser?.role === "administrator";

  const assign = async (orderId: string) => {
    if (!selectedUser || !selectedDriver || isSaving) return;
    setIsSaving(true);
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
    } finally {
      setIsSaving(false);
    }
  };

  const start = async (assignmentId: string) => {
    if (!selectedUser || isSaving) return;
    setIsSaving(true);
    try {
      await startDelivery(database, {
        storeId: DEFAULT_STORE_ID,
        assignmentId,
        actorUserId: selectedUser.id,
        deviceId,
      });
      setDetail(null);
      await load();
    } catch (caughtError) {
      Alert.alert(
        "No se pudo iniciar",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const confirm = async () => {
    if (!selectedUser || !confirming || isSaving) return;
    setIsSaving(true);
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
      setDetail(null);
      await load();
    } catch (caughtError) {
      Alert.alert(
        "No se pudo confirmar",
        getOperatorErrorMessage(
          caughtError,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    } finally {
      setIsSaving(false);
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

  const report = async () => {
    if (!selectedUser || !incidentTarget || !incident.trim() || isSaving) return;
    setIsSaving(true);
    try {
      await createOrderIncident(database, {
        storeId: DEFAULT_STORE_ID,
        orderId: incidentTarget.orderId,
        type: "delivery",
        description: incident,
        actorUserId: selectedUser.id,
        deviceId,
      });
      setIncident("");
      setIncidentTarget(null);
      Alert.alert(
        "Incidencia registrada",
        "Quedó pendiente de sincronización.",
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo registrar",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const saveOperator = async () => {
    if (!operatorName.trim() || isSaving) return;
    setIsSaving(true);
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
    } finally {
      setIsSaving(false);
    }
  };

  const statusTone = (status: DeliveryAssignmentRecord["status"]) =>
    status === "delivered" ? "green" : status === "failed" ? "danger" : "gold";

  return (
    <AdminScreen
      title="Repartos"
      subtitle="Despacho, ruta y confirmación de entrega"
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
              Activa tu perfil con PIN en la pestaña Más para despachar
              entregas.
            </Text>
          </View>
        </View>
      ) : null}

      {canManage ? (
        <>
          <SectionTitle
            action={<Pill label={`${availableOrders.length}`} tone="gold" />}
          >
            Listos para despacho
          </SectionTitle>
          <View style={styles.chips}>
            {users.map((user) => (
              <Pressable
                accessibilityLabel={`Repartidor ${user.displayName}`}
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
          {!selectedDriver ? (
            <Text style={styles.muted}>
              Elige el repartidor antes de asignar pedidos.
            </Text>
          ) : null}
          {availableOrders.length ? (
            <View style={styles.list}>
              {availableOrders.map((order) => (
                <View
                  key={order.id}
                  style={[sharedStyles.card, styles.orderRow, styles.rowShadow]}
                >
                  <View style={styles.orderCopy}>
                    <Text
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                      style={styles.orderNumber}
                    >
                      {order.orderNumber}
                    </Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      {order.customerName} · {order.deliveryZoneName ?? "Delivery"}
                    </Text>
                  </View>
                  <PrimaryButton
                    compact
                    label="Asignar"
                    disabled={!selectedDriver || isSaving}
                    onPress={() => void assign(order.id)}
                    style={styles.assignButton}
                  />
                </View>
              ))}
            </View>
          ) : (
            <View style={[sharedStyles.card, styles.sectionEmpty]}>
              <MaterialCommunityIcons
                name="moped-outline"
                size={24}
                color={BrandColors.muted}
              />
              <Text style={styles.muted}>
                No hay pedidos listos para despacho.
              </Text>
            </View>
          )}

          <SectionTitle
            action={<Pill label={`${operators.length}`} tone="neutral" />}
          >
            Operadores externos
          </SectionTitle>
          <Pressable
            accessibilityLabel="Gestionar operadores externos"
            accessibilityRole="button"
            onPress={() => setOperatorSheetVisible(true)}
            style={({ pressed }) => [
              sharedStyles.card,
              styles.operatorLink,
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons
              name="truck-fast-outline"
              size={20}
              color={BrandColors.green}
            />
            <View style={styles.operatorNoticeCopy}>
              <Text style={styles.operatorNoticeTitle}>
                {operators.length
                  ? `${operators.length} operador${operators.length === 1 ? "" : "es"} registrado${operators.length === 1 ? "" : "s"}`
                  : "Registrar operador externo"}
              </Text>
              <Text style={styles.operatorNoticeText}>
                Empresas de delivery con tracking manual o API.
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={18}
              color={BrandColors.muted}
            />
          </Pressable>
        </>
      ) : null}

      <SectionTitle
        action={<Pill label={`${assignments.length}`} tone="neutral" />}
      >
        Entregas asignadas
      </SectionTitle>
      {assignments.length ? (
        <View style={styles.list}>
          {assignments.map((assignment) => (
            <Pressable
              accessibilityLabel={`Abrir entrega ${assignment.orderNumber}`}
              accessibilityRole="button"
              key={assignment.id}
              onPress={() => setDetail(assignment)}
              style={({ pressed }) => [
                sharedStyles.card,
                styles.deliveryRow,
                pressed && styles.pressed,
              ]}
            >
              <View
                style={[
                  styles.rowIcon,
                  assignment.status !== "delivered" &&
                    styles.rowIconActive,
                ]}
              >
                <MaterialCommunityIcons
                  name={
                    assignment.status === "delivered"
                      ? "check-all"
                      : assignment.status === "en_route"
                        ? "moped"
                        : "package-variant-closed"
                  }
                  size={20}
                  color={
                    assignment.status === "delivered"
                      ? BrandColors.muted
                      : BrandColors.green
                  }
                />
              </View>
              <View style={styles.orderCopy}>
                <View style={styles.rowTop}>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={styles.orderNumber}
                  >
                    {assignment.orderNumber}
                  </Text>
                  <Pill
                    label={deliveryStatusLabels[assignment.status]}
                    tone={statusTone(assignment.status)}
                  />
                </View>
                <Text numberOfLines={1} style={styles.meta}>
                  {assignment.customerName} · {assignment.address},{" "}
                  {assignment.district}
                </Text>
                <Text numberOfLines={1} style={styles.meta}>
                  Repartidor: {assignment.driverName}
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={18}
                color={BrandColors.muted}
              />
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={[sharedStyles.card, styles.sectionEmpty]}>
          <MaterialCommunityIcons
            name="map-marker-path"
            size={24}
            color={BrandColors.muted}
          />
          <Text style={styles.muted}>
            {canManage
              ? "Asigna pedidos para ver las entregas en ruta."
              : "Aún no tienes entregas asignadas."}
          </Text>
        </View>
      )}

      <ModalSurface
        dialogStyle={styles.dialog}
        onClose={() => setOperatorSheetVisible(false)}
        visible={operatorSheetVisible}
      >
        <View style={styles.dialogHeader}>
          <MaterialCommunityIcons
            name="truck-fast-outline"
            size={24}
            color={BrandColors.greenDark}
          />
          <Text maxFontSizeMultiplier={1.3} style={styles.dialogTitle}>
            Operadores externos
          </Text>
        </View>
        {operators.map((operator) => (
          <View key={operator.id} style={styles.operatorRow}>
            <View style={styles.operatorCopy}>
              <Text style={styles.operatorName}>{operator.name}</Text>
              <Text style={styles.operatorMeta}>
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
        {!operators.length ? (
          <Text style={styles.operatorMeta}>
            Aún no hay operadores externos registrados.
          </Text>
        ) : null}
        <View style={styles.operatorFormDivider} />
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
        <View style={styles.dialogActions}>
          <ActionButton
            compact
            label="Cerrar"
            onPress={() => setOperatorSheetVisible(false)}
            style={styles.dialogButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={!operatorName.trim() || isSaving}
            label="Guardar operador"
            loading={isSaving}
            onPress={() => void saveOperator()}
            style={styles.dialogButton}
          />
        </View>
      </ModalSurface>

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        onClose={() => setDetail(null)}
        placement="bottom"
        visible={detail !== null}
      >
        {detail ? (
          <>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
                  {detail.orderNumber}
                </Text>
                <Text style={styles.sheetMeta}>
                  {detail.customerName} · {detail.customerPhone}
                </Text>
              </View>
              <Pill
                label={deliveryStatusLabels[detail.status]}
                tone={statusTone(detail.status)}
              />
              <Pressable
                accessibilityLabel="Cerrar detalle de la entrega"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setDetail(null)}
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
                    name="map-marker-outline"
                    size={16}
                    color={BrandColors.muted}
                  />
                  <Text style={styles.summaryText}>
                    {detail.address}, {detail.district}
                  </Text>
                </View>
                {detail.instructions ? (
                  <View style={styles.summaryRow}>
                    <MaterialCommunityIcons
                      name="text-box-outline"
                      size={16}
                      color={BrandColors.muted}
                    />
                    <Text style={styles.summaryText}>
                      {detail.instructions}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.summaryRow}>
                  <MaterialCommunityIcons
                    name="account-outline"
                    size={16}
                    color={BrandColors.muted}
                  />
                  <Text style={styles.summaryText}>
                    Repartidor: {detail.driverName}
                  </Text>
                </View>
              </View>
            </ScrollView>

            {["assigned", "en_route"].includes(detail.status) ? (
              <View style={styles.sheetFooter}>
                <ActionButton
                  label="Mapa"
                  icon="map-marker-path"
                  onPress={() =>
                    void Linking.openURL(
                      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${detail.address}, ${detail.district}, Lima`)}`,
                    )
                  }
                  style={styles.footerButton}
                  tone="secondary"
                />
                {detail.status === "assigned" ? (
                  <ActionButton
                    label="Iniciar ruta"
                    icon="play"
                    loading={isSaving}
                    disabled={isSaving}
                    onPress={() => void start(detail.id)}
                    style={styles.footerButton}
                  />
                ) : (
                  <ActionButton
                    label="Entregar"
                    icon="package-variant-closed-check"
                    disabled={isSaving}
                    onPress={() => {
                      setRecipientName("");
                      setConfirmationCode("");
                      setEvidenceUri("");
                      setConfirming(detail);
                    }}
                    style={styles.footerButton}
                  />
                )}
              </View>
            ) : null}
            {detail.status === "en_route" ? (
              <Pressable
                accessibilityLabel={`Registrar incidencia de ${detail.orderNumber}`}
                accessibilityRole="button"
                onPress={() => {
                  setIncident("");
                  setIncidentTarget(detail);
                }}
                style={styles.cancelLink}
              >
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={18}
                  color={BrandColors.danger}
                />
                <Text style={styles.cancelLinkText}>Reportar incidencia</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ModalSurface>

      <ModalSurface
        dialogStyle={styles.dialog}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setIncidentTarget(null);
        }}
        visible={incidentTarget !== null}
      >
        <View style={styles.dialogHeader}>
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={24}
            color={BrandColors.danger}
          />
          <Text maxFontSizeMultiplier={1.3} style={styles.dialogTitle}>
            Incidencia de {incidentTarget?.orderNumber ?? ""}
          </Text>
        </View>
        <Text style={styles.dialogHint}>
          Describe qué ocurrió: cliente ausente, dirección errada, paquete
          dañado.
        </Text>
        <TextInput
          accessibilityLabel="Descripción de la incidencia"
          autoFocus
          multiline
          placeholder="Ej. cliente ausente en el domicilio"
          placeholderTextColor={BrandColors.muted}
          style={[styles.input, styles.multilineInput]}
          value={incident}
          onChangeText={setIncident}
        />
        <View style={styles.dialogActions}>
          <ActionButton
            compact
            disabled={isSaving}
            label="Cancelar"
            onPress={() => setIncidentTarget(null)}
            style={styles.dialogButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={!incident.trim() || isSaving}
            label="Registrar"
            loading={isSaving}
            onPress={() => void report()}
            style={styles.dialogButton}
          />
        </View>
      </ModalSurface>

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setConfirming(null);
        }}
        placement="bottom"
        visible={confirming !== null}
      >
        {confirming ? (
          <>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
                  Confirmar entrega {confirming.orderNumber}
                </Text>
                <Text style={styles.sheetMeta}>
                  Acredita la entrega con código o foto.
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Cerrar confirmación de entrega"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setConfirming(null)}
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
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.sheetScroll}
            >
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
                style={styles.cameraButton}
              >
                <MaterialCommunityIcons
                  name="camera-outline"
                  size={19}
                  color={BrandColors.greenDark}
                />
                <Text style={styles.cameraText}>
                  {evidenceUri
                    ? "Foto adjuntada · reemplazar"
                    : "Tomar foto de evidencia"}
                </Text>
              </Pressable>
              {!confirmationCode.trim() && !evidenceUri ? (
                <Text style={styles.muted}>
                  Registra un código o toma una foto para acreditar la entrega.
                </Text>
              ) : null}
            </ScrollView>

            <View style={styles.sheetFooter}>
              <ActionButton
                compact
                disabled={isSaving}
                label="Cancelar"
                onPress={() => setConfirming(null)}
                style={styles.footerButton}
                tone="ghost"
              />
              <ActionButton
                compact
                disabled={
                  !recipientName.trim() ||
                  (!confirmationCode.trim() && !evidenceUri) ||
                  isSaving
                }
                label="Confirmar entrega"
                loading={isSaving}
                onPress={() => void confirm()}
                style={styles.saveFooterButton}
              />
            </View>
          </>
        ) : null}
      </ModalSurface>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
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
  muted: {
    color: BrandColors.muted,
    ...Typography.caption,
  },
  list: { gap: Spacing.sm },
  sectionEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  rowShadow: { ...Elevation.ambientCard },
  orderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 64,
  },
  orderCopy: { flex: 1 },
  orderNumber: {
    flexShrink: 1,
    color: BrandColors.greenDark,
    ...Typography.label,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  assignButton: { minWidth: 108 },
  deliveryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 72,
    ...Elevation.ambientCard,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  rowIconActive: { backgroundColor: BrandColors.greenLight },
  operatorLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 64,
    ...Elevation.ambientCard,
  },
  operatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  operatorCopy: { flex: 1 },
  operatorName: { color: BrandColors.text, ...Typography.label },
  operatorMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  operatorFormDivider: {
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    paddingTop: Spacing.xs,
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
  multilineInput: {
    minHeight: ControlSize.default + Spacing.xl,
    paddingTop: Spacing.sm,
    textAlignVertical: "top",
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
  sheetMeta: {
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
  sheetFooter: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  footerButton: { flex: 1 },
  saveFooterButton: { flex: 1.6 },
  cameraButton: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  cameraText: { color: BrandColors.greenDark, ...Typography.label },
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
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
