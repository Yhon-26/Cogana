import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { QuantityStepper } from "@/components/commerce-ui";
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
import { useCart } from "@/context/cart-context";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  createBusinessQuote,
  saveRecurringBusinessOrder,
} from "@/online/business-api";

function parseDeliveryDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(trimmed);
  if (match) {
    const [, year, month, day, hour, minute] = match;
    const local = new Date(+year, +month - 1, +day, +hour, +minute);
    if (!Number.isNaN(local.getTime())) return local.toISOString();
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  throw new Error("Usa una fecha válida, por ejemplo 2026-08-03 09:00.");
}

function nextDeliveryDate(days: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(9, 0, 0, 0);
  return value.toISOString();
}

function getDeliveryValidation(
  value: string,
  recurrence: "once" | "weekly" | "biweekly" | "monthly",
) {
  if (!value.trim()) {
    return recurrence === "once"
      ? null
      : "Indica la primera fecha para activar la recurrencia.";
  }
  try {
    parseDeliveryDate(value);
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Usa una fecha válida, por ejemplo 2026-08-03 09:00.";
  }
}

export default function BusinessCartScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const { items, setQuantity, removeItem, clear } = useCart();
  const [deliveryAt, setDeliveryAt] = useState("");
  const [recurrence, setRecurrence] = useState<
    "once" | "weekly" | "biweekly" | "monthly"
  >("once");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submissionLocked = useRef(false);
  const deliveryValidation = getDeliveryValidation(deliveryAt, recurrence);
  const routeError = businessId
    ? null
    : "No encontramos el negocio para esta cotización. Vuelve al perfil comercial e intenta nuevamente.";
  const submitDisabled =
    saving ||
    Boolean(routeError) ||
    !items.length ||
    Boolean(deliveryValidation);

  const submit = async () => {
    if (submissionLocked.current || submitDisabled || !businessId) {
      if (deliveryValidation) setSubmitError(deliveryValidation);
      return;
    }
    let requestedDeliveryAt: string | null;
    try {
      requestedDeliveryAt = parseDeliveryDate(deliveryAt);
    } catch (caughtError) {
      setSubmitError(
        getUserFacingErrorMessage(
          caughtError,
          "Usa una fecha válida, por ejemplo 2026-08-03 09:00.",
        ),
      );
      return;
    }
    if (recurrence !== "once" && !requestedDeliveryAt) {
      setSubmitError("Indica la primera fecha para activar la recurrencia.");
      return;
    }
    submissionLocked.current = true;
    setSaving(true);
    setSubmitError(null);
    try {
      const quoteItems = items.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
      }));
      await createBusinessQuote({
        businessAccountId: businessId,
        requestedDeliveryAt,
        recurrence,
        notes,
        items: quoteItems,
      });
      if (recurrence !== "once" && requestedDeliveryAt) {
        try {
          await saveRecurringBusinessOrder({
            businessAccountId: businessId,
            name: `Abastecimiento ${new Date().toLocaleDateString("es-PE")}`,
            frequency: recurrence,
            nextRunAt: requestedDeliveryAt,
            fulfillmentType: "pickup",
            deliveryAddress: null,
            items: quoteItems,
          });
        } catch {
          clear();
          Alert.alert(
            "Cotización enviada",
            "La cotización quedó registrada, pero no pudimos activar la recurrencia. Revísala en Cotizaciones antes de volver a programarla.",
          );
          router.replace(
            `/negocio/cotizaciones?businessId=${businessId}` as Href,
          );
          return;
        }
      }
      clear();
      Alert.alert(
        "Cotización enviada",
        "La tienda responderá con precio y vigencia.",
      );
      router.replace(`/negocio/cotizaciones?businessId=${businessId}` as Href);
    } catch (caughtError) {
      setSubmitError(
        getUserFacingErrorMessage(
          caughtError,
          "No pudimos enviar la cotización. Revisa los datos e intenta nuevamente.",
        ),
      );
    } finally {
      submissionLocked.current = false;
      setSaving(false);
    }
  };

  return (
    <OnlineScreen
      title="Carrito mayorista"
      subtitle={`${items.length} productos`}
      cartHref={null}
    >
      {items.map((item) => {
        const step = item.product.baseUnit === "gram" ? 1000 : 1;
        return (
          <View key={item.product.id} style={styles.card}>
            <View style={styles.itemTop}>
              <View style={styles.fill}>
                <Text style={styles.name}>{item.product.name}</Text>
                <Text style={styles.meta}>
                  {item.quantity}{" "}
                  {item.product.baseUnit === "gram" ? "g" : "unidades"}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={`Quitar ${item.product.name}`}
                accessibilityRole="button"
                onPress={() => removeItem(item.product.id)}
                style={({ pressed }) => [
                  styles.remove,
                  pressed && styles.pressed,
                ]}
              >
                <MaterialCommunityIcons
                  name="trash-can-outline"
                  size={20}
                  color={BrandColors.danger}
                />
              </Pressable>
            </View>
            <View style={styles.quantityRow}>
              <QuantityStepper
                decreaseDisabled={item.quantity <= step}
                increaseDisabled={
                  item.quantity + step > item.product.stockQuantity
                }
                label={`Cantidad de ${item.product.name}`}
                onDecrease={() =>
                  setQuantity(item.product.id, item.quantity - step)
                }
                onIncrease={() =>
                  setQuantity(item.product.id, item.quantity + step)
                }
                value={`${item.quantity} ${item.product.baseUnit === "gram" ? "g" : "un."}`}
              />
              <Text style={styles.stockText}>
                Disponible: {item.product.stockQuantity}{" "}
                {item.product.baseUnit === "gram" ? "g" : "un."}
              </Text>
            </View>
          </View>
        );
      })}
      {items.length ? (
        <View style={styles.form}>
          <Text style={styles.label}>PROGRAMACIÓN DE ABASTECIMIENTO</Text>
          <Text style={styles.helper}>
            Elige una fecha rápida o escribe el momento exacto.
          </Text>
          <View style={styles.quickDates}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDeliveryAt(nextDeliveryDate(1));
                setSubmitError(null);
              }}
              style={({ pressed }) => [
                styles.quickDate,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.quickDateText}>Mañana · 9 am</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDeliveryAt(nextDeliveryDate(7));
                setSubmitError(null);
              }}
              style={({ pressed }) => [
                styles.quickDate,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.quickDateText}>En 7 días</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDeliveryAt(nextDeliveryDate(14));
                setSubmitError(null);
              }}
              style={({ pressed }) => [
                styles.quickDate,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.quickDateText}>En 14 días</Text>
            </Pressable>
          </View>
          {deliveryAt && !Number.isNaN(new Date(deliveryAt).getTime()) ? (
            <View style={styles.selectedDate}>
              <MaterialCommunityIcons
                name="calendar-check"
                size={19}
                color={BrandColors.greenDark}
              />
              <Text style={styles.selectedDateText}>
                {new Date(deliveryAt).toLocaleString("es-PE", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
            </View>
          ) : null}
          <TextInput
            accessibilityLabel="Fecha de abastecimiento"
            placeholder="Fecha exacta, ej. 2026-08-03 09:00"
            placeholderTextColor={BrandColors.muted}
            style={styles.input}
            value={deliveryAt}
            onChangeText={(value) => {
              setDeliveryAt(value);
              setSubmitError(null);
            }}
          />
          <View style={styles.wrap}>
            {(["once", "weekly", "biweekly", "monthly"] as const).map(
              (value) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: recurrence === value }}
                  key={value}
                  onPress={() => {
                    setRecurrence(value);
                    setSubmitError(null);
                  }}
                  style={({ pressed }) => [
                    styles.chip,
                    recurrence === value && styles.chipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      recurrence === value && styles.chipTextActive,
                    ]}
                  >
                    {value === "once"
                      ? "Una vez"
                      : value === "weekly"
                        ? "Semanal"
                        : value === "biweekly"
                          ? "Quincenal"
                          : "Mensual"}
                  </Text>
                </Pressable>
              ),
            )}
          </View>
          <TextInput
            accessibilityLabel="Notas de abastecimiento"
            multiline
            placeholder="Volumen especial, marca o condición requerida"
            placeholderTextColor={BrandColors.muted}
            style={[styles.input, styles.notes]}
            value={notes}
            onChangeText={setNotes}
          />
          {submitError || routeError || deliveryValidation ? (
            <View
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={styles.formError}
            >
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={20}
                color={BrandColors.warning}
              />
              <Text style={styles.formErrorText}>
                {submitError || routeError || deliveryValidation}
              </Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: saving, disabled: submitDisabled }}
            disabled={submitDisabled}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.primary,
              submitDisabled && styles.disabled,
              pressed && !submitDisabled && styles.pressed,
            ]}
          >
            <Text style={styles.primaryText}>
              {saving ? "Enviando…" : "Solicitar cotización"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.name}>El carrito está vacío.</Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.back()}
            style={styles.linkButton}
          >
            <Text style={styles.link}>Volver al catálogo</Text>
          </Pressable>
        </View>
      )}
    </OnlineScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.sm,
    gap: Spacing.sm,
  },
  itemTop: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  fill: { flex: 1 },
  name: { color: BrandColors.text, ...Typography.label },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  quantityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  stockText: { color: BrandColors.muted, ...Typography.caption },
  remove: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.dangerLight,
    alignItems: "center",
    justifyContent: "center",
  },
  form: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  label: { color: BrandColors.muted, ...Typography.overline },
  helper: { color: BrandColors.muted, ...Typography.caption },
  quickDates: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  quickDate: {
    minHeight: ControlSize.default,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    paddingHorizontal: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  quickDateText: { color: BrandColors.greenDark, ...Typography.label },
  selectedDate: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.goldLight,
    paddingHorizontal: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  selectedDateText: { color: BrandColors.warning, ...Typography.label },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    paddingHorizontal: Spacing.sm,
    color: BrandColors.text,
    ...Typography.body,
  },
  notes: { minHeight: 75, paddingTop: Spacing.sm, textAlignVertical: "top" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: {
    minHeight: ControlSize.default,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.surfaceMuted,
    paddingHorizontal: Spacing.sm,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: BrandColors.greenDark },
  chipText: { color: BrandColors.greenDark, ...Typography.label },
  chipTextActive: { color: BrandColors.white },
  formError: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.goldLight,
    padding: Spacing.sm,
  },
  formErrorText: { flex: 1, color: BrandColors.warning, ...Typography.caption },
  primary: {
    minHeight: ControlSize.large,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: BrandColors.white, ...Typography.label },
  empty: { alignItems: "center", padding: Spacing.xxxl, gap: Spacing.sm },
  linkButton: { minHeight: ControlSize.default, justifyContent: "center" },
  link: { color: BrandColors.greenDark, ...Typography.label },
  disabled: { opacity: Interaction.disabledOpacity },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
