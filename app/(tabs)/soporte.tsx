import { MaterialCommunityIcons } from "@expo/vector-icons";
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
  ControlSize,
  Elevation,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useLocalOperator } from "@/context/local-operator-context";
import {
  addStaffSupportMessage,
  getStaffSupportTickets,
  type SupportTicket,
  updateStaffSupportTicket,
} from "@/online/support-api";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import { formatDateTime } from "@/lib/format";

const supportCategoryLabels: Record<SupportTicket["category"], string> = {
  order: "Pedido",
  payment: "Pago",
  delivery: "Entrega",
  account: "Cuenta",
  product: "Producto",
  other: "Otro",
};
const supportPriorityLabels: Record<SupportTicket["priority"], string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};
const supportStatusLabels: Record<SupportTicket["status"], string> = {
  open: "Abierta",
  in_progress: "En atención",
  waiting_customer: "Esperando al cliente",
  resolved: "Resuelta",
  closed: "Cerrada",
};

export default function StaffSupportScreen() {
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.round(height * 0.88);
  const { selectedUser } = useLocalOperator();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [detail, setDetail] = useState<SupportTicket | null>(null);
  const [reply, setReply] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setTickets(await getStaffSupportTickets());
      setLoadError(null);
    } catch (caughtError) {
      setLoadError(
        getOperatorErrorMessage(
          caughtError,
          "No se pudieron cargar las solicitudes. Intenta nuevamente.",
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const reloadDetail = async (ticketId: string) => {
    const next = tickets.find((ticket) => ticket.id === ticketId) ?? null;
    setDetail(next);
  };

  const respond = async (ticket: SupportTicket) => {
    const body = reply.trim();
    if (!body || isSaving) return;
    setIsSaving(true);
    try {
      await addStaffSupportMessage(ticket.id, body);
      setReply("");
      await load();
      await reloadDetail(ticket.id);
    } catch (caughtError) {
      Alert.alert(
        "No se pudo responder",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const resolve = async (ticket: SupportTicket) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await updateStaffSupportTicket(ticket.id, "resolved", ticket.priority);
      await load();
      await reloadDetail(ticket.id);
    } catch (caughtError) {
      Alert.alert(
        "No se pudo resolver",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const openCount = tickets.filter(
    (ticket) => !["resolved", "closed"].includes(ticket.status),
  ).length;

  return (
    <AdminScreen title="Soporte" subtitle="Solicitudes de clientes y equipo">
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
              Activa tu perfil con PIN en la pestaña Más para atender
              solicitudes.
            </Text>
          </View>
        </View>
      ) : null}

      <SectionTitle action={<Pill label={`${openCount}`} tone="gold" />}>
        Bandeja
      </SectionTitle>

      {isLoading ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text style={styles.muted}>Cargando solicitudes…</Text>
        </View>
      ) : loadError ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {loadError}
          </Text>
          <PrimaryButton label="Reintentar" onPress={() => void load()} />
        </View>
      ) : tickets.length === 0 ? (
        <View style={[sharedStyles.card, styles.empty]}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons
              name="lifebuoy"
              size={28}
              color={BrandColors.green}
            />
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
            Sin solicitudes abiertas
          </Text>
          <Text style={styles.muted}>
            Las consultas de clientes y del equipo aparecerán aquí.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {tickets.map((ticket) => (
            <Pressable
              accessibilityLabel={`Abrir solicitud ${ticket.subject}`}
              accessibilityRole="button"
              key={ticket.id}
              onPress={() => {
                setReply("");
                setDetail(ticket);
              }}
              style={({ pressed }) => [
                sharedStyles.card,
                styles.row,
                pressed && styles.pressed,
              ]}
            >
              <View
                style={[
                  styles.rowIcon,
                  !["resolved", "closed"].includes(ticket.status) &&
                    styles.rowIconActive,
                ]}
              >
                <MaterialCommunityIcons
                  name={
                    ["resolved", "closed"].includes(ticket.status)
                      ? "check"
                      : "email-outline"
                  }
                  size={20}
                  color={
                    ["resolved", "closed"].includes(ticket.status)
                      ? BrandColors.muted
                      : BrandColors.green
                  }
                />
              </View>
              <View style={styles.rowCopy}>
                <View style={styles.rowTop}>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={styles.title}
                  >
                    {ticket.subject}
                  </Text>
                  <Pill
                    label={supportStatusLabels[ticket.status]}
                    tone={ticket.status === "resolved" ? "green" : "neutral"}
                  />
                </View>
                <Text numberOfLines={1} style={styles.meta}>
                  {supportCategoryLabels[ticket.category]} ·{" "}
                  {supportPriorityLabels[ticket.priority]} ·{" "}
                  {ticket.messages.length} mensaje
                  {ticket.messages.length === 1 ? "" : "s"}
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
      )}

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
                  {detail.subject}
                </Text>
                <Text style={styles.sheetMeta}>
                  {supportCategoryLabels[detail.category]} ·{" "}
                  {supportPriorityLabels[detail.priority]}
                </Text>
              </View>
              <Pill
                label={supportStatusLabels[detail.status]}
                tone={detail.status === "resolved" ? "green" : "neutral"}
              />
              <Pressable
                accessibilityLabel="Cerrar solicitud"
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
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.sheetScroll}
            >
              {detail.messages.map((message) => (
                <View key={message.id} style={styles.message}>
                  <Text style={styles.messageBody}>{message.body}</Text>
                  <Text style={styles.messageDate}>
                    {formatDateTime(new Date(message.createdAt))}
                  </Text>
                </View>
              ))}
              {!["resolved", "closed"].includes(detail.status) ? (
                <>
                  <TextInput
                    accessibilityLabel={`Respuesta para ${detail.subject}`}
                    multiline
                    placeholder="Escribe la respuesta"
                    placeholderTextColor={BrandColors.muted}
                    style={[styles.input, styles.multilineInput]}
                    value={reply}
                    onChangeText={setReply}
                  />
                  {!reply.trim() ? (
                    <Text style={styles.muted}>
                      La respuesta se enviará al solicitante.
                    </Text>
                  ) : null}
                </>
              ) : null}
            </ScrollView>

            {!["resolved", "closed"].includes(detail.status) ? (
              <View style={styles.sheetFooter}>
                <ActionButton
                  label="Resolver"
                  icon="check"
                  disabled={isSaving || !reply.trim()}
                  onPress={() => void resolve(detail)}
                  style={styles.footerButton}
                  tone="secondary"
                />
                <ActionButton
                  label="Responder"
                  icon="send-outline"
                  disabled={isSaving || !reply.trim()}
                  loading={isSaving}
                  onPress={() => void respond(detail)}
                  style={styles.saveFooterButton}
                />
              </View>
            ) : null}
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
  feedback: { gap: Spacing.sm },
  errorText: { color: BrandColors.danger, ...Typography.caption },
  muted: {
    color: BrandColors.muted,
    ...Typography.caption,
  },
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
  list: { gap: Spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 64,
    ...Elevation.ambientCard,
  },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
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
  rowCopy: { flex: 1 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  title: { flexShrink: 1, color: BrandColors.text, ...Typography.label },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
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
  message: {
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.surfaceMuted,
    padding: Spacing.sm,
  },
  messageBody: { color: BrandColors.text, ...Typography.body },
  messageDate: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "right",
    marginTop: Spacing.xxs,
  },
  input: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
  },
  multilineInput: {
    minHeight: ControlSize.default + Spacing.xl,
    paddingTop: Spacing.sm,
    textAlignVertical: "top",
  },
  sheetFooter: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  footerButton: { flex: 1 },
  saveFooterButton: { flex: 1.6 },
});
