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
import {
  addStaffSupportMessage,
  getStaffSupportTickets,
  type SupportTicket,
  updateStaffSupportTicket,
} from "@/online/support-api";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";

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
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [reply, setReply] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      setTickets(await getStaffSupportTickets());
    } catch (caughtError) {
      Alert.alert(
        "No se pudo cargar",
        getOperatorErrorMessage(
          caughtError,
          "No se pudieron cargar las solicitudes. Intenta nuevamente.",
        ),
      );
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));
  const respond = async (ticket: SupportTicket) => {
    const body = reply[ticket.id]?.trim();
    if (!body) return;
    try {
      await addStaffSupportMessage(ticket.id, body);
      setReply((current) => ({ ...current, [ticket.id]: "" }));
      await load();
    } catch (caughtError) {
      Alert.alert(
        "No se pudo responder",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    }
  };
  const resolve = async (ticket: SupportTicket) => {
    try {
      await updateStaffSupportTicket(ticket.id, "resolved", ticket.priority);
      await load();
    } catch (caughtError) {
      Alert.alert(
        "No se pudo resolver",
        getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
      );
    }
  };
  return (
    <AdminScreen title="Soporte" subtitle="Solicitudes de clientes y equipo">
      <OperatorSelector />
      <SectionTitle
        action={
          <Pill
            label={`${tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length}`}
            tone="gold"
          />
        }
      >
        Bandeja
      </SectionTitle>
      {tickets.map((ticket) => (
        <View key={ticket.id} style={[sharedStyles.card, styles.card]}>
          <View style={styles.top}>
            <View style={styles.fill}>
              <Text style={styles.title}>{ticket.subject}</Text>
              <Text style={styles.meta}>
                {supportCategoryLabels[ticket.category]} ·{" "}
                {supportPriorityLabels[ticket.priority]}
              </Text>
            </View>
            <Pill
              label={supportStatusLabels[ticket.status]}
              tone={ticket.status === "resolved" ? "green" : "neutral"}
            />
          </View>
          {ticket.messages.map((message) => (
            <View key={message.id} style={styles.message}>
              <Text style={styles.body}>{message.body}</Text>
              <Text style={styles.date}>
                {new Date(message.createdAt).toLocaleString("es-PE")}
              </Text>
            </View>
          ))}
          {!["resolved", "closed"].includes(ticket.status) ? (
            <>
              <TextInput
                accessibilityLabel={`Respuesta para ${ticket.subject}`}
                placeholder="Respuesta"
                placeholderTextColor={BrandColors.muted}
                style={styles.input}
                value={reply[ticket.id] ?? ""}
                onChangeText={(value) =>
                  setReply((current) => ({ ...current, [ticket.id]: value }))
                }
              />
              <View style={styles.actions}>
                <Pressable
                  accessibilityLabel={`Resolver solicitud ${ticket.subject}`}
                  accessibilityRole="button"
                  onPress={() => void resolve(ticket)}
                  style={styles.secondary}
                >
                  <Text style={styles.secondaryText}>Resolver</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Responder solicitud ${ticket.subject}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !reply[ticket.id]?.trim() }}
                  disabled={!reply[ticket.id]?.trim()}
                  onPress={() => void respond(ticket)}
                  style={[
                    styles.primary,
                    !reply[ticket.id]?.trim() && styles.disabled,
                  ]}
                >
                  <Text style={styles.primaryText}>Responder</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      ))}
    </AdminScreen>
  );
}
const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  top: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  fill: { flex: 1 },
  title: { color: BrandColors.text, ...Typography.label },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  message: {
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.surfaceMuted,
    padding: Spacing.sm,
  },
  body: { color: BrandColors.text, ...Typography.body },
  date: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "right",
    marginTop: Spacing.xxs,
  },
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
  actions: { flexDirection: "row", gap: Spacing.xs },
  secondary: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  secondaryText: { color: BrandColors.greenDark, ...Typography.label },
  primary: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  primaryText: { color: BrandColors.white, ...Typography.label },
  disabled: { opacity: Interaction.disabledOpacity },
});
