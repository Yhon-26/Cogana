import { useFocusEffect } from "expo-router";
import { type ComponentProps, useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { CommerceButton } from "@/components/commerce-ui";
import { OnlineScreen } from "@/components/online-shell";
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
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  addCustomerSupportMessage,
  createCustomerSupportTicket,
  getMyCustomerSupportTickets,
  type SupportTicket,
} from "@/online/support-api";

const faq = [
  [
    "¿Cómo se calcula el peso final?",
    "El total se actualiza con la cantidad realmente preparada y queda visible en el seguimiento.",
  ],
  ["¿Puedo cancelar?", "Sí, mientras el pedido esté recibido o confirmado."],
  [
    "¿Qué ocurre si falta un producto?",
    "La tienda puede proponer una sustitución que tú aceptas o rechazas.",
  ],
];

const supportCategories: SupportTicket["category"][] = [
  "order",
  "payment",
  "delivery",
  "account",
  "product",
  "other",
];

const categoryLabels: Record<SupportTicket["category"], string> = {
  order: "Pedido",
  payment: "Pago",
  delivery: "Entrega",
  account: "Cuenta",
  product: "Producto",
  other: "Otro",
};

const statusLabels: Record<SupportTicket["status"], string> = {
  open: "Abierta",
  in_progress: "En atención",
  waiting_customer: "Esperando tu respuesta",
  resolved: "Resuelta",
  closed: "Cerrada",
};

export default function HelpScreen() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<SupportTicket["category"]>("order");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [reply, setReply] = useState<Record<string, string>>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [replyErrors, setReplyErrors] = useState<Record<string, string>>({});
  const createDisabled = !subject.trim() || !description.trim();
  const load = useCallback(async () => {
    try {
      setTickets(await getMyCustomerSupportTickets());
    } catch (caughtError) {
      Alert.alert(
        "No se pudo cargar",
        getUserFacingErrorMessage(caughtError, "Intenta nuevamente."),
      );
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const create = async () => {
    setCreateError(null);
    try {
      await createCustomerSupportTicket({ category, subject, description });
      setSubject("");
      setDescription("");
      setShowForm(false);
      await load();
    } catch (caughtError) {
      setCreateError(
        getUserFacingErrorMessage(
          caughtError,
          "No pudimos enviar la solicitud. Revisa los datos e intenta nuevamente.",
        ),
      );
    }
  };
  const sendReply = async (ticketId: string) => {
    const body = reply[ticketId]?.trim();
    if (!body) return;
    setReplyErrors((current) => ({ ...current, [ticketId]: "" }));
    try {
      await addCustomerSupportMessage(ticketId, body);
      setReply((current) => ({ ...current, [ticketId]: "" }));
      await load();
    } catch (caughtError) {
      setReplyErrors((current) => ({
        ...current,
        [ticketId]: getUserFacingErrorMessage(
          caughtError,
          "No pudimos enviar la respuesta. Intenta nuevamente.",
        ),
      }));
    }
  };

  return (
    <OnlineScreen title="Centro de ayuda" subtitle="Respuestas y soporte">
      {faq.map(([question, answer]) => (
        <View key={question} style={styles.faq}>
          <Text style={styles.title}>{question}</Text>
          <Text style={styles.copy}>{answer}</Text>
        </View>
      ))}
      <View style={styles.heading}>
        <Text style={styles.section}>Mis solicitudes</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowForm((current) => !current)}
          style={styles.linkButton}
        >
          <Text style={styles.link}>{showForm ? "Cerrar" : "Nueva"}</Text>
        </Pressable>
      </View>
      {showForm ? (
        <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Motivo de la solicitud</Text>
            <Text style={styles.fieldHelper}>
              Elige la categoría que mejor describe tu consulta.
            </Text>
          </View>
          <View style={styles.wrap}>
            {supportCategories.map((value) => (
              <Pressable
                accessibilityLabel={categoryLabels[value]}
                accessibilityRole="radio"
                accessibilityState={{ checked: category === value }}
                key={value}
                onPress={() => setCategory(value)}
                style={({ pressed }) => [
                  styles.chip,
                  category === value && styles.chipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.chipText}>{categoryLabels[value]}</Text>
              </Pressable>
            ))}
          </View>
          <SupportField
            helper="Resume el problema en una frase."
            label="Asunto"
            onChangeText={(value) => {
              setSubject(value);
              setCreateError(null);
            }}
            placeholder="Ej. Consulta sobre mi pedido"
            value={subject}
          />
          <SupportField
            helper="Incluye el número de pedido y los detalles que nos ayuden a resolverlo."
            label="Descripción del problema"
            multiline
            onChangeText={(value) => {
              setDescription(value);
              setCreateError(null);
            }}
            placeholder="Cuéntanos qué ocurrió"
            value={description}
          />
          {createError ? (
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={styles.formError}
            >
              {createError}
            </Text>
          ) : null}
          <CommerceButton
            disabled={createDisabled}
            label="Enviar solicitud"
            onPress={() => void create()}
          />
        </View>
      ) : null}
      {tickets.map((ticket) => (
        <View key={ticket.id} style={styles.card}>
          <View style={styles.heading}>
            <Text style={styles.title}>{ticket.subject}</Text>
            <Text style={styles.status}>{statusLabels[ticket.status]}</Text>
          </View>
          {ticket.messages.map((message) => (
            <View key={message.id} style={styles.message}>
              <Text style={styles.copy}>{message.body}</Text>
              <Text style={styles.date}>
                {new Date(message.createdAt).toLocaleString("es-PE")}
              </Text>
            </View>
          ))}
          {!["resolved", "closed"].includes(ticket.status) ? (
            <View style={styles.reply}>
              <SupportField
                error={replyErrors[ticket.id]}
                helper="Tu respuesta quedará dentro de esta solicitud."
                label="Tu respuesta"
                multiline
                onChangeText={(value) => {
                  setReply((current) => ({ ...current, [ticket.id]: value }));
                  setReplyErrors((current) => ({
                    ...current,
                    [ticket.id]: "",
                  }));
                }}
                placeholder="Escribe una respuesta"
                value={reply[ticket.id] ?? ""}
              />
              <CommerceButton
                compact
                disabled={!reply[ticket.id]?.trim()}
                label="Enviar respuesta"
                onPress={() => void sendReply(ticket.id)}
                tone="ghost"
              />
            </View>
          ) : null}
        </View>
      ))}
    </OnlineScreen>
  );
}

function SupportField({
  error,
  helper,
  label,
  multiline = false,
  ...props
}: ComponentProps<typeof TextInput> & {
  error?: string;
  helper: string;
  label: string;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldRequirement}>Obligatorio</Text>
      </View>
      <TextInput
        {...props}
        accessibilityHint={error || helper}
        accessibilityLabel={label}
        multiline={multiline}
        placeholderTextColor={BrandColors.muted}
        style={[
          styles.input,
          multiline && styles.notes,
          error && styles.inputError,
        ]}
      />
      <Text
        accessibilityLiveRegion={error ? "polite" : undefined}
        accessibilityRole={error ? "alert" : undefined}
        style={error ? styles.fieldError : styles.fieldHelper}
      >
        {error || helper}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  faq: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  title: { color: BrandColors.text, ...Typography.label },
  copy: { color: BrandColors.muted, ...Typography.caption },
  heading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.xs,
  },
  section: { color: BrandColors.text, ...Typography.h3 },
  linkButton: {
    minWidth: ControlSize.default,
    minHeight: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
  },
  link: { color: BrandColors.greenDark, ...Typography.label },
  card: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  field: { gap: Spacing.xxs },
  fieldHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  fieldLabel: { color: BrandColors.text, ...Typography.label },
  fieldRequirement: { color: BrandColors.muted, ...Typography.caption },
  fieldHelper: { color: BrandColors.muted, ...Typography.caption },
  fieldError: { color: BrandColors.danger, ...Typography.caption },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: {
    minHeight: ControlSize.default,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.surfaceMuted,
    paddingHorizontal: Spacing.sm,
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: BrandColors.greenLight,
    borderWidth: 1,
    borderColor: BrandColors.green,
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
    paddingHorizontal: Spacing.sm,
    color: BrandColors.text,
    ...Typography.body,
  },
  inputError: { borderColor: BrandColors.danger },
  formError: {
    color: BrandColors.danger,
    ...Typography.caption,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.dangerLight,
    padding: Spacing.sm,
  },
  notes: { minHeight: 80, paddingTop: Spacing.sm, textAlignVertical: "top" },
  status: { color: BrandColors.greenDark, ...Typography.label },
  message: {
    backgroundColor: BrandColors.surfaceMuted,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  date: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
    textAlign: "right",
  },
  reply: { gap: Spacing.sm },
  fill: { flex: 1 },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
