import { useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { OnlineScreen } from "@/components/online-shell";
import {
  BrandColors,
  ControlSize,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  acceptMyBusinessQuote,
  getMyBusinessContext,
} from "@/online/business-api";
import type { BusinessQuote } from "@/online/business-contracts";

const statusLabels: Record<BusinessQuote["status"], string> = {
  requested: "En revisión",
  quoted: "Respondida",
  accepted: "Aceptada",
  rejected: "Rechazada",
  expired: "Vencida",
};

export default function BusinessQuotesScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const [quotes, setQuotes] = useState<BusinessQuote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setError(null);
      const context = await getMyBusinessContext();
      setQuotes(
        context.quotes.filter(
          (quote) => quote.businessAccountId === businessId,
        ),
      );
    } catch (caughtError) {
      setError(
        getUserFacingErrorMessage(
          caughtError,
          "No se pudieron cargar las cotizaciones.",
        ),
      );
    }
  }, [businessId]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const accept = async (quote: BusinessQuote) => {
    try {
      await acceptMyBusinessQuote(quote.id);
      await load();
      Alert.alert(
        "Cotización aceptada",
        "La tienda coordinará el abastecimiento.",
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo aceptar",
        getUserFacingErrorMessage(caughtError, "Intenta nuevamente."),
      );
    }
  };

  return (
    <OnlineScreen
      title="Mis cotizaciones"
      subtitle="Solicitudes y propuestas comerciales"
      cartHref={
        businessId
          ? (`/negocio/carrito?businessId=${businessId}` as Href)
          : null
      }
    >
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.error}
        >
          {error}
        </Text>
      ) : null}
      {quotes.map((quote) => (
        <View key={quote.id} style={styles.card}>
          <View style={styles.top}>
            <View>
              <Text style={styles.number}>
                COT-{quote.id.slice(0, 8).toUpperCase()}
              </Text>
              <Text style={styles.date}>
                {new Date(quote.createdAt).toLocaleString("es-PE")}
              </Text>
            </View>
            <View style={styles.status}>
              <Text style={styles.statusText}>
                {statusLabels[quote.status]}
              </Text>
            </View>
          </View>
          {quote.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <Text style={styles.item}>
                {item.productName} · {item.quantity}{" "}
                {item.baseUnit === "gram" ? "g" : "un."}
              </Text>
              {item.quotedLineCents !== null ? (
                <Text style={styles.line}>
                  S/ {(item.quotedLineCents / 100).toFixed(2)}
                </Text>
              ) : null}
            </View>
          ))}
          {quote.adminNotes ? (
            <Text style={styles.notes}>{quote.adminNotes}</Text>
          ) : null}
          {quote.quotedTotalCents !== null ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total propuesto</Text>
              <Text style={styles.total}>
                S/ {(quote.quotedTotalCents / 100).toFixed(2)}
              </Text>
            </View>
          ) : null}
          {quote.validUntil ? (
            <Text style={styles.valid}>
              Válida hasta {new Date(quote.validUntil).toLocaleString("es-PE")}
            </Text>
          ) : null}
          {quote.status === "quoted" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void accept(quote)}
              style={({ pressed }) => [
                styles.primary,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryText}>Aceptar propuesta</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {!quotes.length && !error ? (
        <Text style={styles.empty}>Aún no tienes cotizaciones.</Text>
      ) : null}
    </OnlineScreen>
  );
}

const styles = StyleSheet.create({
  error: { color: BrandColors.danger, ...Typography.caption },
  card: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  number: { color: BrandColors.text, ...Typography.label },
  date: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  status: {
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  statusText: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    fontWeight: "700",
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  item: { flex: 1, color: BrandColors.muted, ...Typography.caption },
  line: { color: BrandColors.text, ...Typography.label },
  notes: {
    color: BrandColors.warning,
    ...Typography.caption,
    backgroundColor: BrandColors.goldLight,
    padding: Spacing.xs,
    borderRadius: Radius.sm,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    paddingTop: Spacing.xs,
  },
  totalLabel: { color: BrandColors.muted, ...Typography.caption },
  total: { color: BrandColors.text, ...Typography.h3 },
  valid: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "right",
  },
  primary: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: BrandColors.white, ...Typography.label },
  empty: {
    color: BrandColors.muted,
    ...Typography.body,
    textAlign: "center",
    padding: Spacing.xxxl,
  },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
