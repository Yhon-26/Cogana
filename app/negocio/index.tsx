import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { CommerceButton } from "@/components/commerce-ui";
import { OnlineScreen } from "@/components/online-shell";
import {
  BrandColors,
  ControlSize,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { formatSoles } from "@/lib/money";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { getMyBusinessContext } from "@/online/business-api";
import type { BusinessContext } from "@/online/business-contracts";

const emptyContext: BusinessContext = {
  accounts: [],
  prices: [],
  quotes: [],
  recurringOrders: [],
  documents: [],
};

export default function BusinessHomeScreen() {
  const [data, setData] = useState(emptyContext);
  const [selectedId, setSelectedId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setError(null);
      const context = await getMyBusinessContext();
      setData(context);
      setSelectedId((current) =>
        context.accounts.some((account) => account.id === current)
          ? current
          : (context.accounts[0]?.id ?? ""),
      );
    } catch (caughtError) {
      setError(
        getUserFacingErrorMessage(caughtError, "No se pudo cargar el negocio."),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const account = data.accounts.find(
    (candidate) => candidate.id === selectedId,
  );
  const prices = useMemo(
    () => data.prices.filter((price) => price.businessAccountId === selectedId),
    [data.prices, selectedId],
  );
  const quotes = data.quotes.filter(
    (quote) => quote.businessAccountId === selectedId,
  );
  const availableCredit = Math.max(
    0,
    (account?.creditLimitCents ?? 0) - (account?.creditUsedCents ?? 0),
  );

  if (isLoading && !data.accounts.length) {
    return (
      <OnlineScreen
        title="Compra para negocios"
        subtitle="Restaurantes y mayoristas"
        cartHref={null}
      >
        <View accessibilityLiveRegion="polite" style={styles.statusCard}>
          <ActivityIndicator color={BrandColors.green} />
          <Text style={styles.copy}>Cargando tu cuenta comercial…</Text>
        </View>
      </OnlineScreen>
    );
  }

  if (error && !data.accounts.length) {
    return (
      <OnlineScreen
        title="Compra para negocios"
        subtitle="Restaurantes y mayoristas"
        cartHref={null}
      >
        <View accessibilityLiveRegion="assertive" style={styles.statusCard}>
          <MaterialCommunityIcons
            name="cloud-alert-outline"
            size={36}
            color={BrandColors.danger}
          />
          <Text accessibilityRole="alert" style={styles.emptyTitle}>
            No pudimos cargar tu cuenta
          </Text>
          <Text style={styles.copy}>{error}</Text>
          <CommerceButton
            compact
            icon="refresh"
            label="Intentar nuevamente"
            loading={isLoading}
            onPress={() => void load()}
          />
        </View>
      </OnlineScreen>
    );
  }

  if (!data.accounts.length) {
    return (
      <OnlineScreen
        title="Compra para negocios"
        subtitle="Restaurantes y mayoristas"
        cartHref={null}
      >
        <View style={styles.empty}>
          <MaterialCommunityIcons
            name="store-plus-outline"
            size={42}
            color={BrandColors.green}
          />
          <Text style={styles.emptyTitle}>Solicita una cuenta comercial</Text>
          <Text style={styles.copy}>
            Accede a cotizaciones, precios por volumen, programación y
            condiciones de crédito aprobadas por la tienda.
          </Text>
          <CommerceButton
            label="Registrar negocio"
            onPress={() => router.push("/negocio/registro" as Href)}
          />
        </View>
      </OnlineScreen>
    );
  }

  return (
    <OnlineScreen
      title="Mi negocio"
      subtitle={account?.tradeName ?? account?.legalName}
      cartHref={
        selectedId
          ? (`/negocio/carrito?businessId=${selectedId}` as Href)
          : null
      }
    >
      {error ? (
        <View accessibilityLiveRegion="polite" style={styles.errorBanner}>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <CommerceButton
            compact
            icon="refresh"
            label="Reintentar"
            loading={isLoading}
            onPress={() => void load()}
            tone="secondary"
          />
        </View>
      ) : null}
      {data.accounts.length > 1 ? (
        <View
          accessibilityLabel="Cuenta comercial"
          accessibilityRole="radiogroup"
          style={styles.accountRow}
        >
          {data.accounts.map((candidate) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selectedId === candidate.id }}
              key={candidate.id}
              onPress={() => setSelectedId(candidate.id)}
              style={({ pressed }) => [
                styles.accountChip,
                selectedId === candidate.id && styles.accountChipActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.accountChipText}>
                {candidate.tradeName ?? candidate.legalName}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {account ? (
        <>
          <View style={styles.hero}>
            <View>
              <Text style={styles.eyebrow}>ESTADO COMERCIAL</Text>
              <Text style={styles.heroTitle}>
                {account.status === "approved"
                  ? "Cuenta aprobada"
                  : account.status === "pending"
                    ? "Solicitud en revisión"
                    : account.status === "suspended"
                      ? "Cuenta suspendida"
                      : "Solicitud rechazada"}
              </Text>
              <Text style={styles.heroCopy}>RUC {account.taxId}</Text>
            </View>
            <MaterialCommunityIcons
              name={
                account.status === "approved"
                  ? "check-decagram"
                  : "clock-outline"
              }
              size={32}
              color={
                account.status === "approved"
                  ? BrandColors.gold
                  : BrandColors.white
              }
            />
          </View>
          <View style={styles.metrics}>
            <Metric label="Precios acordados" value={String(prices.length)} />
            <Metric label="Cotizaciones" value={String(quotes.length)} />
            <Metric
              label="Crédito disponible"
              value={formatSoles(availableCredit)}
            />
          </View>
          <View style={styles.grid}>
            <Action
              icon="cart-variant"
              label="Catálogo mayorista"
              onPress={() =>
                router.push(
                  `/negocio/catalogo?businessId=${account.id}` as Href,
                )
              }
            />
            <Action
              icon="file-document-outline"
              label="Mis cotizaciones"
              onPress={() =>
                router.push(
                  `/negocio/cotizaciones?businessId=${account.id}` as Href,
                )
              }
            />
            <Action
              icon="account-tie-outline"
              label="Perfil comercial"
              onPress={() =>
                router.push(`/negocio/perfil?businessId=${account.id}` as Href)
              }
            />
            <Action
              icon="repeat"
              label="Abastecimiento"
              onPress={() =>
                router.push(
                  `/negocio/recurrentes?businessId=${account.id}` as Href,
                )
              }
            />
          </View>
          <Text style={styles.sectionTitle}>Precios y escalas vigentes</Text>
          <View style={styles.card}>
            {prices.map((price) => (
              <View key={price.id} style={styles.priceRow}>
                <View style={styles.fill}>
                  <Text style={styles.itemTitle}>{price.productName}</Text>
                  <Text style={styles.copy}>
                    Desde {price.minimumQuantity} unidades base
                  </Text>
                </View>
                <Text style={styles.price}>
                  S/ {(price.priceCents / 100).toFixed(2)}
                </Text>
              </View>
            ))}
            {!prices.length ? (
              <Text style={styles.copy}>
                Aún no hay precios personalizados.
              </Text>
            ) : null}
          </View>
        </>
      ) : null}
    </OnlineScreen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <MaterialCommunityIcons
        name={icon}
        size={24}
        color={BrandColors.greenDark}
      />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: {
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.white,
    padding: Spacing.xl,
    alignItems: "center",
    gap: Spacing.sm,
  },
  statusCard: {
    minHeight: 180,
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  emptyTitle: { color: BrandColors.text, ...Typography.h3 },
  copy: { color: BrandColors.muted, ...Typography.caption },
  error: { color: BrandColors.danger, ...Typography.caption },
  errorBanner: {
    borderRadius: Radius.md,
    backgroundColor: BrandColors.dangerLight,
    padding: Spacing.sm,
    gap: Spacing.sm,
  },
  accountRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  accountChip: {
    minHeight: ControlSize.default,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: BrandColors.line,
    paddingHorizontal: Spacing.sm,
    justifyContent: "center",
    backgroundColor: BrandColors.white,
  },
  accountChipActive: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  accountChipText: { color: BrandColors.greenDark, ...Typography.label },
  hero: {
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.greenDark,
    padding: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: { color: BrandColors.gold, ...Typography.overline },
  heroTitle: {
    color: BrandColors.white,
    ...Typography.h3,
    marginVertical: Spacing.xxs,
  },
  heroCopy: { color: BrandColors.greenMid, ...Typography.caption },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  metric: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    minWidth: 140,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.sm,
  },
  metricValue: { color: BrandColors.text, ...Typography.label },
  metricLabel: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  action: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    minWidth: 190,
    minHeight: 88,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  actionText: { color: BrandColors.text, ...Typography.label, flexShrink: 1 },
  sectionTitle: { color: BrandColors.text, ...Typography.h3 },
  card: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  priceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.line,
    paddingVertical: Spacing.xs,
  },
  fill: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 0 },
  itemTitle: { color: BrandColors.text, ...Typography.label },
  price: { color: BrandColors.greenDark, ...Typography.label },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
