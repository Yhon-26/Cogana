import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
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
  calculateLineTotalCents,
  parseDecimalToInteger,
} from "@/database/integer-calculations";
import type { ProductRecord } from "@/database/models";
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

function ProductPicker({
  products,
  selectedId,
  onSelect,
}: {
  products: ProductRecord[];
  selectedId: string;
  onSelect: (productId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-PE");
    if (!normalized) return products;
    return products.filter((product) =>
      `${product.name} ${product.sku}`
        .toLocaleLowerCase("es-PE")
        .includes(normalized),
    );
  }, [products, query]);

  return (
    <View style={styles.picker}>
      <View style={styles.searchWrap}>
        <MaterialCommunityIcons
          name="magnify"
          size={19}
          color={BrandColors.muted}
        />
        <TextInput
          accessibilityLabel="Buscar producto"
          placeholder="Buscar producto o código"
          placeholderTextColor={BrandColors.muted}
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
        />
      </View>
      <ScrollView
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={styles.pickerList}
      >
        {filtered.length === 0 ? (
          <Text style={styles.pickerEmpty}>Sin productos para la búsqueda.</Text>
        ) : (
          filtered.map((product, index) => {
            const selected = product.id === selectedId;
            return (
              <Pressable
                accessibilityLabel={`Seleccionar ${product.name}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={product.id}
                onPress={() => onSelect(product.id)}
                style={[
                  styles.pickerRow,
                  index > 0 && styles.borderTop,
                  selected && styles.pickerRowSelected,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.pickerName,
                    selected && styles.pickerNameSelected,
                  ]}
                >
                  {product.name}
                </Text>
                <Text style={styles.pickerMeta}>
                  {product.baseUnit === "gram" ? "pesable" : "unidad"}
                </Text>
                {selected ? (
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={18}
                    color={BrandColors.greenDark}
                  />
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

export default function BusinessOperationsScreen() {
  const { selectedUser } = useLocalOperator();
  const { products } = useLocalProducts();
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.round(height * 0.88);
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
  const [isLoading, setIsLoading] = useState(true);
  const [detail, setDetail] = useState<BusinessAccount | null>(null);
  const [quoteDetail, setQuoteDetail] = useState<BusinessQuote | null>(null);
  const [priceVisible, setPriceVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const canManage = selectedUser?.role === "administrator";

  const load = useCallback(async () => {
    setIsLoading(true);
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
    } finally {
      setIsLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const pendingQuotes = quotes.filter((quote) => quote.status === "requested");

  const review = async (
    account: BusinessAccount,
    status: "approved" | "rejected" | "suspended",
  ) => {
    if (isSaving) return;
    setIsSaving(true);
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
      setDetail(null);
      await load();
    } catch (caughtError) {
      Alert.alert(
        "No se pudo revisar",
        getOperatorErrorMessage(
          caughtError,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const respond = async (quote: BusinessQuote) => {
    if (isSaving) return;
    setIsSaving(true);
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
      setQuoteDetail(null);
      await load();
      Alert.alert(
        "Propuesta enviada",
        "La cotización quedó respondida para el negocio.",
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo responder",
        getOperatorErrorMessage(
          caughtError,
          "Revisa los datos e intenta nuevamente.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const savePrice = async () => {
    if (isSaving) return;
    setIsSaving(true);
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
      setPriceVisible(false);
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
    } finally {
      setIsSaving(false);
    }
  };

  const approvedAccounts = accounts.filter(
    (account) => account.status === "approved",
  );

  return (
    <AdminScreen
      title="Negocios"
      subtitle="Aprobaciones y cotizaciones mayoristas"
      right={
        canManage ? (
          <Pressable
            accessibilityLabel="Nuevo precio acordado"
            accessibilityRole="button"
            style={styles.addHeader}
            onPress={() => {
              setPriceAccountId("");
              setPriceProductId("");
              setMinimumQuantity("");
              setAgreedPrice("");
              setPriceValidUntil("");
              setPriceVisible(true);
            }}
          >
            <MaterialCommunityIcons
              name="plus"
              size={23}
              color={BrandColors.white}
            />
          </Pressable>
        ) : null
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
              Activa tu perfil con PIN en la pestaña Más para revisar cuentas.
            </Text>
          </View>
        </View>
      ) : null}

      {isLoading ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text style={styles.muted}>Cargando cuentas comerciales…</Text>
        </View>
      ) : error ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <PrimaryButton label="Reintentar" onPress={() => void load()} />
        </View>
      ) : (
        <>
          <SectionTitle
            action={<Pill label={`${accounts.length}`} tone="neutral" />}
          >
            Cuentas comerciales
          </SectionTitle>
          {accounts.length ? (
            <View style={styles.list}>
              {accounts.map((account) => (
                <Pressable
                  accessibilityLabel={`Abrir cuenta ${account.tradeName ?? account.legalName}`}
                  accessibilityRole="button"
                  key={account.id}
                  onPress={() => setDetail(account)}
                  style={({ pressed }) => [
                    sharedStyles.card,
                    styles.row,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowIcon}>
                    <MaterialCommunityIcons
                      name={
                        account.businessType === "restaurant"
                          ? "silverware-fork-knife"
                          : "warehouse"
                      }
                      size={20}
                      color={BrandColors.green}
                    />
                  </View>
                  <View style={styles.rowCopy}>
                    <View style={styles.rowTop}>
                      <Text
                        maxFontSizeMultiplier={1.3}
                        numberOfLines={1}
                        style={styles.title}
                      >
                        {account.tradeName ?? account.legalName}
                      </Text>
                      <Pill
                        label={businessStatusLabels[account.status]}
                        tone={
                          account.status === "approved"
                            ? "green"
                            : account.status === "rejected" ||
                                account.status === "suspended"
                              ? "danger"
                              : "gold"
                        }
                      />
                    </View>
                    <Text numberOfLines={1} style={styles.meta}>
                      RUC {account.taxId} ·{" "}
                      {businessTypeLabels[account.businessType]}
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
                name="warehouse"
                size={24}
                color={BrandColors.muted}
              />
              <Text style={styles.muted}>
                Aún no hay cuentas de restaurantes ni mayoristas.
              </Text>
            </View>
          )}

          <SectionTitle
            action={<Pill label={`${pendingQuotes.length}`} tone="gold" />}
          >
            Cotizaciones pendientes
          </SectionTitle>
          {pendingQuotes.length ? (
            <View style={styles.list}>
              {pendingQuotes.map((quote) => (
                <Pressable
                  accessibilityLabel={`Abrir cotización ${quote.id.slice(0, 8)}`}
                  accessibilityRole="button"
                  key={quote.id}
                  onPress={() => setQuoteDetail(quote)}
                  style={({ pressed }) => [
                    sharedStyles.card,
                    styles.row,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowIcon}>
                    <MaterialCommunityIcons
                      name="file-document-edit-outline"
                      size={20}
                      color={BrandColors.green}
                    />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                      style={styles.title}
                    >
                      COT-{quote.id.slice(0, 8).toUpperCase()}
                    </Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      {quote.items.length} producto
                      {quote.items.length === 1 ? "" : "s"} por cotizar
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
                name="file-document-check-outline"
                size={24}
                color={BrandColors.muted}
              />
              <Text style={styles.muted}>
                No hay cotizaciones esperando propuesta.
              </Text>
            </View>
          )}
        </>
      )}

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setDetail(null);
        }}
        placement="bottom"
        visible={detail !== null}
      >
        {detail ? (
          <>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
                  {detail.tradeName ?? detail.legalName}
                </Text>
                <Text style={styles.sheetMeta}>
                  RUC {detail.taxId} · {businessTypeLabels[detail.businessType]}
                </Text>
              </View>
              <Pill
                label={businessStatusLabels[detail.status]}
                tone={
                  detail.status === "approved"
                    ? "green"
                    : detail.status === "rejected" || detail.status === "suspended"
                      ? "danger"
                      : "gold"
                }
              />
              <Pressable
                accessibilityLabel="Cerrar cuenta comercial"
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
              {canManage ? (
                <>
                  <Text style={styles.fieldLabel}>
                    CONDICIONES DE CRÉDITO (OPCIONAL)
                  </Text>
                  <View style={styles.twoColumns}>
                    <TextInput
                      accessibilityLabel={`Línea de crédito para ${detail.tradeName ?? detail.legalName}`}
                      keyboardType="decimal-pad"
                      placeholder="Línea S/"
                      placeholderTextColor={BrandColors.muted}
                      style={styles.input}
                      value={credit[detail.id] ?? ""}
                      onChangeText={(value) =>
                        setCredit((current) => ({
                          ...current,
                          [detail.id]: value,
                        }))
                      }
                    />
                    <TextInput
                      accessibilityLabel={`Plazo en días para ${detail.tradeName ?? detail.legalName}`}
                      keyboardType="number-pad"
                      placeholder="Plazo días"
                      placeholderTextColor={BrandColors.muted}
                      style={styles.input}
                      value={terms[detail.id] ?? ""}
                      onChangeText={(value) =>
                        setTerms((current) => ({
                          ...current,
                          [detail.id]: value,
                        }))
                      }
                    />
                  </View>
                  <Text style={styles.muted}>
                    Aprobar o rechazar aplica la decisión a la cuenta central.
                  </Text>
                </>
              ) : (
                <Text style={styles.muted}>
                  Solo un administrador puede revisar esta cuenta.
                </Text>
              )}
            </ScrollView>

            {canManage ? (
              <View style={styles.sheetFooter}>
                <ActionButton
                  label="Rechazar"
                  icon="close"
                  disabled={isSaving}
                  onPress={() => void review(detail, "rejected")}
                  style={styles.footerButton}
                  tone="danger"
                />
                <ActionButton
                  label="Aprobar"
                  icon="check"
                  disabled={isSaving}
                  onPress={() => void review(detail, "approved")}
                  style={styles.saveFooterButton}
                />
              </View>
            ) : null}
          </>
        ) : null}
      </ModalSurface>

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setQuoteDetail(null);
        }}
        placement="bottom"
        visible={quoteDetail !== null}
      >
        {quoteDetail ? (
          <>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
                  COT-{quoteDetail.id.slice(0, 8).toUpperCase()}
                </Text>
                <Text style={styles.sheetMeta}>
                  Propón el precio de cada producto y la vigencia.
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Cerrar cotización"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setQuoteDetail(null)}
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
              {quoteDetail.items.map((item) => (
                <View key={item.id} style={styles.quoteItemRow}>
                  <View style={styles.rowCopy}>
                    <Text numberOfLines={2} style={styles.title}>
                      {item.productName}
                    </Text>
                    <Text style={styles.meta}>
                      {item.quantity} {item.baseUnit === "gram" ? "g" : "un."} ·
                      catálogo {item.catalogPriceCents / 100}
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
                accessibilityLabel={`Vigencia de la cotización ${quoteDetail.id.slice(0, 8)}`}
                placeholder="Vigencia ISO"
                placeholderTextColor={BrandColors.muted}
                style={styles.input}
                value={validUntil[quoteDetail.id] ?? ""}
                onChangeText={(value) =>
                  setValidUntil((current) => ({
                    ...current,
                    [quoteDetail.id]: value,
                  }))
                }
              />
              <TextInput
                accessibilityLabel={`Observaciones de la cotización ${quoteDetail.id.slice(0, 8)}`}
                placeholder="Observaciones comerciales"
                placeholderTextColor={BrandColors.muted}
                style={[styles.input, styles.multilineInput]}
                value={notes[quoteDetail.id] ?? ""}
                onChangeText={(value) =>
                  setNotes((current) => ({
                    ...current,
                    [quoteDetail.id]: value,
                  }))
                }
              />
            </ScrollView>

            <ActionButton
              label="Enviar propuesta"
              icon="send-outline"
              loading={isSaving}
              disabled={isSaving || !validUntil[quoteDetail.id]}
              onPress={() => void respond(quoteDetail)}
            />
          </>
        ) : null}
      </ModalSurface>

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) setPriceVisible(false);
        }}
        placement="bottom"
        visible={priceVisible}
      >
        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderCopy}>
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
              Nuevo precio acordado
            </Text>
            <Text style={styles.sheetMeta}>
              Condición comercial para el negocio elegido.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Cerrar precio acordado"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setPriceVisible(false)}
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
          <Text style={styles.fieldLabel}>NEGOCIO APROBADO</Text>
          <View style={styles.chips}>
            {approvedAccounts.map((account) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: priceAccountId === account.id }}
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
          {!approvedAccounts.length ? (
            <Text accessibilityRole="alert" style={styles.error}>
              Primero aprueba una cuenta comercial.
            </Text>
          ) : null}
          <Text style={styles.fieldLabel}>PRODUCTO</Text>
          <ProductPicker
            products={products.filter((product) => product.isActive)}
            selectedId={priceProductId}
            onSelect={setPriceProductId}
          />
          <View style={styles.twoColumns}>
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
            style={styles.input}
            value={priceValidUntil}
            onChangeText={setPriceValidUntil}
          />
        </ScrollView>

        <ActionButton
          label="Guardar precio"
          icon="tag-outline"
          loading={isSaving}
          disabled={isSaving}
          onPress={() => void savePrice()}
        />
      </ModalSurface>
    </AdminScreen>
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
  error: { color: BrandColors.danger, ...Typography.caption },
  muted: {
    color: BrandColors.muted,
    ...Typography.caption,
  },
  empty: {
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xxl,
  },
  list: { gap: Spacing.sm },
  sectionEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
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
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: { flex: 1 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  title: {
    flexShrink: 1,
    color: BrandColors.text,
    ...Typography.label,
  },
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
  sheetFooter: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  footerButton: { flex: 1 },
  saveFooterButton: { flex: 1.6 },
  fieldLabel: {
    color: BrandColors.muted,
    ...Typography.overline,
  },
  twoColumns: { flexDirection: "row", gap: Spacing.sm },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
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
  priceInput: {
    width: ControlSize.default * 2 + Spacing.xxs,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.xs,
    color: BrandColors.text,
    ...Typography.body,
  },
  quoteItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
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
  picker: { gap: Spacing.xs },
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
  pickerList: {
    maxHeight: 240,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
  },
  pickerRow: {
    minHeight: ControlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  pickerRowSelected: { backgroundColor: BrandColors.greenLight },
  pickerName: { flex: 1, color: BrandColors.text, ...Typography.label },
  pickerNameSelected: { color: BrandColors.greenDark },
  pickerMeta: { color: BrandColors.muted, ...Typography.caption },
  pickerEmpty: {
    color: BrandColors.muted,
    ...Typography.caption,
    padding: Spacing.sm,
    textAlign: "center",
  },
  borderTop: { borderTopWidth: 1, borderTopColor: BrandColors.line },
});
