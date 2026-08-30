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
import {
  calculateLineTotalCents,
  parseDecimalToInteger,
} from "@/database/integer-calculations";
import {
  listBusinessOperations,
  respondBusinessQuote,
  reviewBusinessAccount,
  setBusinessPrice,
} from "@/online/business-admin-api";
import type {
  BusinessAccount,
  BusinessQuote,
} from "@/online/business-contracts";
import { useLocalProducts } from "@/hooks/use-local-products";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";

const businessTypeLabels: Record<BusinessAccount["businessType"], string> = {
  restaurant: "Restaurante",
  wholesale: "Mayorista",
};
const businessStatusLabels: Record<BusinessAccount["status"], string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  suspended: "Suspendida",
};

export default function BusinessOperationsScreen() {
  const { selectedUser } = useLocalOperator();
  const { products } = useLocalProducts();
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [quotes, setQuotes] = useState<BusinessQuote[]>([]);
  const [credit, setCredit] = useState<Record<string, string>>({});
  const [terms, setTerms] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [validUntil, setValidUntil] = useState<Record<string, string>>({});
  const [priceAccountId, setPriceAccountId] = useState("");
  const [priceProductId, setPriceProductId] = useState("");
  const [minimumQuantity, setMinimumQuantity] = useState("");
  const [agreedPrice, setAgreedPrice] = useState("");
  const [priceValidUntil, setPriceValidUntil] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await listBusinessOperations();
      setAccounts(data.accounts);
      setQuotes(data.quotes);
    } catch (caughtError) {
      setError(
        getOperatorErrorMessage(
          caughtError,
          "No se pudo cargar la información. Intenta nuevamente.",
        ),
      );
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const review = async (
    account: BusinessAccount,
    status: "approved" | "rejected" | "suspended",
  ) => {
    try {
      const creditLimitCents =
        parseDecimalToInteger(credit[account.id] ?? "0", 2) ?? 0;
      const paymentTermsDays = Number.parseInt(terms[account.id] ?? "0", 10);
      await reviewBusinessAccount({
        businessAccountId: account.id,
        status,
        creditLimitCents,
        paymentTermsDays,
      });
      await load();
    } catch (caughtError) {
      Alert.alert(
        "No se pudo revisar",
        getOperatorErrorMessage(
          caughtError,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    }
  };

  const respond = async (quote: BusinessQuote) => {
    try {
      const items = quote.items.map((item) => {
        const priceCents = parseDecimalToInteger(
          prices[item.id] ?? String(item.catalogPriceCents / 100),
          2,
        );
        if (priceCents === null || priceCents < 0) {
          throw new Error(`Revisa el precio de ${item.productName}.`);
        }
        return {
          id: item.id,
          priceCents,
          lineCents: calculateLineTotalCents(
            item.quantity,
            priceCents,
            item.baseUnit === "gram" ? 1000 : 1,
          ),
        };
      });
      await respondBusinessQuote({
        quoteId: quote.id,
        validUntil: new Date(validUntil[quote.id]).toISOString(),
        adminNotes: notes[quote.id] ?? "",
        items,
      });
      await load();
    } catch (caughtError) {
      Alert.alert(
        "No se pudo responder",
        getOperatorErrorMessage(
          caughtError,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    }
  };

  const savePrice = async () => {
    try {
      const product = products.find(
        (candidate) => candidate.id === priceProductId,
      );
      const quantity = parseDecimalToInteger(
        minimumQuantity,
        product?.baseUnit === "gram" ? 3 : 0,
      );
      const priceCents = parseDecimalToInteger(agreedPrice, 2);
      if (!priceAccountId || !product || !quantity || priceCents === null) {
        throw new Error("Completa negocio, producto, mínimo y precio.");
      }
      await setBusinessPrice({
        businessAccountId: priceAccountId,
        productId: product.id,
        minimumQuantity: quantity,
        priceCents,
        validUntil: priceValidUntil.trim()
          ? new Date(priceValidUntil).toISOString()
          : null,
      });
      setMinimumQuantity("");
      setAgreedPrice("");
      setPriceValidUntil("");
      Alert.alert(
        "Precio guardado",
        "La condición ya aparece en la cuenta comercial.",
      );
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
      title="Negocios"
      subtitle="Aprobaciones y cotizaciones mayoristas"
    >
      <OperatorSelector />
      {error ? (
        <Text
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          style={styles.error}
        >
          {error}
        </Text>
      ) : null}
      <SectionTitle
        action={<Pill label={`${accounts.length}`} tone="neutral" />}
      >
        Cuentas comerciales
      </SectionTitle>
      {accounts.map((account) => (
        <View key={account.id} style={[sharedStyles.card, styles.card]}>
          <View style={styles.top}>
            <View style={styles.fill}>
              <Text style={styles.title}>
                {account.tradeName ?? account.legalName}
              </Text>
              <Text style={styles.meta}>
                RUC {account.taxId} · {businessTypeLabels[account.businessType]}
              </Text>
            </View>
            <Pill
              label={businessStatusLabels[account.status]}
              tone={account.status === "approved" ? "green" : "gold"}
            />
          </View>
          {selectedUser?.role === "administrator" ? (
            <>
              <View style={styles.row}>
                <TextInput
                  accessibilityLabel={`Línea de crédito para ${account.tradeName ?? account.legalName}`}
                  keyboardType="decimal-pad"
                  placeholder="Línea S/"
                  placeholderTextColor={BrandColors.muted}
                  style={styles.input}
                  value={credit[account.id] ?? ""}
                  onChangeText={(value) =>
                    setCredit((current) => ({
                      ...current,
                      [account.id]: value,
                    }))
                  }
                />
                <TextInput
                  accessibilityLabel={`Plazo en días para ${account.tradeName ?? account.legalName}`}
                  keyboardType="number-pad"
                  placeholder="Plazo días"
                  placeholderTextColor={BrandColors.muted}
                  style={styles.input}
                  value={terms[account.id] ?? ""}
                  onChangeText={(value) =>
                    setTerms((current) => ({ ...current, [account.id]: value }))
                  }
                />
              </View>
              <View style={styles.row}>
                <Pressable
                  accessibilityLabel={`Rechazar ${account.tradeName ?? account.legalName}`}
                  accessibilityRole="button"
                  onPress={() => void review(account, "rejected")}
                  style={styles.secondary}
                >
                  <Text style={styles.dangerText}>Rechazar</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Aprobar ${account.tradeName ?? account.legalName}`}
                  accessibilityRole="button"
                  onPress={() => void review(account, "approved")}
                  style={styles.primary}
                >
                  <Text style={styles.primaryText}>Aprobar</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      ))}
      {selectedUser?.role === "administrator" ? (
        <>
          <SectionTitle>Nuevo precio acordado</SectionTitle>
          <View style={[sharedStyles.card, styles.card]}>
            <Text style={styles.meta}>NEGOCIO</Text>
            <View style={styles.chips}>
              {accounts
                .filter((account) => account.status === "approved")
                .map((account) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{
                      checked: priceAccountId === account.id,
                    }}
                    key={account.id}
                    onPress={() => setPriceAccountId(account.id)}
                    style={[
                      styles.chip,
                      priceAccountId === account.id && styles.chipActive,
                    ]}
                  >
                    <Text style={styles.chipText}>
                      {account.tradeName ?? account.legalName}
                    </Text>
                  </Pressable>
                ))}
            </View>
            <Text style={styles.meta}>PRODUCTO</Text>
            <View style={styles.chips}>
              {products.map((product) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: priceProductId === product.id,
                  }}
                  key={product.id}
                  onPress={() => setPriceProductId(product.id)}
                  style={[
                    styles.chip,
                    priceProductId === product.id && styles.chipActive,
                  ]}
                >
                  <Text style={styles.chipText}>{product.name}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              <TextInput
                keyboardType="decimal-pad"
                placeholder="Mínimo kg/un."
                accessibilityLabel="Cantidad mínima acordada"
                placeholderTextColor={BrandColors.muted}
                style={styles.input}
                value={minimumQuantity}
                onChangeText={setMinimumQuantity}
              />
              <TextInput
                keyboardType="decimal-pad"
                placeholder="Precio S/"
                accessibilityLabel="Precio acordado"
                placeholderTextColor={BrandColors.muted}
                style={styles.input}
                value={agreedPrice}
                onChangeText={setAgreedPrice}
              />
            </View>
            <TextInput
              placeholder="Vigencia ISO (opcional)"
              accessibilityLabel="Vigencia del precio acordado"
              placeholderTextColor={BrandColors.muted}
              style={styles.fullInput}
              value={priceValidUntil}
              onChangeText={setPriceValidUntil}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => void savePrice()}
              style={styles.primary}
            >
              <Text style={styles.primaryText}>Guardar precio</Text>
            </Pressable>
          </View>
        </>
      ) : null}
      <SectionTitle
        action={
          <Pill
            label={`${quotes.filter((quote) => quote.status === "requested").length}`}
            tone="gold"
          />
        }
      >
        Cotizaciones pendientes
      </SectionTitle>
      {quotes
        .filter((quote) => quote.status === "requested")
        .map((quote) => (
          <View key={quote.id} style={[sharedStyles.card, styles.card]}>
            <Text style={styles.title}>
              COT-{quote.id.slice(0, 8).toUpperCase()}
            </Text>
            {quote.items.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={styles.fill}>
                  <Text style={styles.item}>{item.productName}</Text>
                  <Text style={styles.meta}>
                    {item.quantity} {item.baseUnit === "gram" ? "g" : "un."}
                  </Text>
                </View>
                <TextInput
                  accessibilityLabel={`Precio para ${item.productName}`}
                  keyboardType="decimal-pad"
                  placeholder="S/ precio"
                  placeholderTextColor={BrandColors.muted}
                  style={styles.priceInput}
                  value={prices[item.id] ?? ""}
                  onChangeText={(value) =>
                    setPrices((current) => ({ ...current, [item.id]: value }))
                  }
                />
              </View>
            ))}
            <TextInput
              accessibilityLabel={`Vigencia de la cotización ${quote.id.slice(0, 8)}`}
              placeholder="Vigencia ISO"
              placeholderTextColor={BrandColors.muted}
              style={styles.fullInput}
              value={validUntil[quote.id] ?? ""}
              onChangeText={(value) =>
                setValidUntil((current) => ({ ...current, [quote.id]: value }))
              }
            />
            <TextInput
              accessibilityLabel={`Observaciones de la cotización ${quote.id.slice(0, 8)}`}
              placeholder="Observaciones comerciales"
              placeholderTextColor={BrandColors.muted}
              style={styles.fullInput}
              value={notes[quote.id] ?? ""}
              onChangeText={(value) =>
                setNotes((current) => ({ ...current, [quote.id]: value }))
              }
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !validUntil[quote.id] }}
              disabled={!validUntil[quote.id]}
              onPress={() => void respond(quote)}
              style={[styles.primary, !validUntil[quote.id] && styles.disabled]}
            >
              <Text style={styles.primaryText}>Enviar propuesta</Text>
            </Pressable>
          </View>
        ))}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  error: { color: BrandColors.danger, ...Typography.caption },
  card: { gap: Spacing.sm },
  top: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  fill: { flex: 1 },
  title: { color: BrandColors.text, ...Typography.label },
  item: { color: BrandColors.text, ...Typography.label },
  meta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  row: { flexDirection: "row", gap: Spacing.xs },
  input: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
    color: BrandColors.text,
    ...Typography.body,
  },
  fullInput: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
    color: BrandColors.text,
    ...Typography.body,
  },
  priceInput: {
    width: ControlSize.default * 2 + Spacing.xxs,
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.xs,
    color: BrandColors.text,
    ...Typography.body,
  },
  itemRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: {
    minHeight: ControlSize.default,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
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
  secondary: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.dangerLight,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  dangerText: { color: BrandColors.danger, ...Typography.label },
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
