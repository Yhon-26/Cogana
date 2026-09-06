import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AdminScreen,
  PrimaryButton,
  SectionTitle,
  sharedStyles,
} from "@/components/admin-ui";
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
import { createId } from "@/database/ids";
import {
  calculateLineTotalCents,
  calculateQuantityForAmountCents,
  parseDecimalToInteger,
} from "@/database/integer-calculations";
import { demoPaymentValidationAdapter } from "@/database/payment-validation";
import {
  formatSoles as formatMoney,
  formatSolesInput as formatMoneyInput,
} from "@/lib/money";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import type {
  PaymentMethod,
  ProductBaseUnit,
  ProductPresentationRecord,
  ProductRecord,
} from "@/database/models";
import { confirmSale } from "@/database/repositories/sales-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { useAdaptiveLayout } from "@/hooks/use-adaptive-layout";
import { useCashSession } from "@/hooks/use-cash-session";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLocalPresentations } from "@/hooks/use-local-presentations";
import { useLocalProducts } from "@/hooks/use-local-products";
import { formatQuantity, formatPricingUnit as priceLabel } from "@/lib/units";

type SaleMode = "grams" | "kilograms" | "units" | "amount" | "presentation";

type CartLine = {
  id: string;
  productId: string;
  productName: string;
  baseUnit: ProductBaseUnit;
  quantity: number;
  totalCents: number;
  saleLabel: string;
  presentationId?: string;
  presentationCount?: number;
};

type Calculation = {
  quantity: number;
  totalCents: number;
  saleLabel: string;
  error: string | null;
};

type PaymentDraft = {
  method: PaymentMethod;
  amount: string;
  amountReceived: string;
  reference: string;
  validationStatus: "idle" | "validating" | "approved" | "rejected";
  validationMessage: string;
};

const paymentMethods: {
  id: PaymentMethod;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}[] = [
  { id: "cash", label: "Efectivo", icon: "cash" },
  { id: "yape", label: "Yape", icon: "cellphone" },
  { id: "plin", label: "Plin", icon: "cellphone-check" },
  { id: "card", label: "Tarjeta", icon: "credit-card-outline" },
];

function createPaymentDraft(method: PaymentMethod, amount = ""): PaymentDraft {
  return {
    method,
    amount,
    amountReceived: "",
    reference: "",
    validationStatus: "idle",
    validationMessage: "",
  };
}

function requiresDemoValidation(method: PaymentMethod) {
  return method === "yape" || method === "plin";
}

function modesForProduct(
  product: ProductRecord | undefined,
  hasPresentations: boolean,
): {
  id: SaleMode;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}[] {
  if (!product) return [];

  const modes: {
    id: SaleMode;
    label: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
  }[] =
    product.baseUnit === "gram"
      ? [
          { id: "grams", label: "Gramos", icon: "scale-balance" },
          { id: "kilograms", label: "Kilos", icon: "weight-kilogram" },
          { id: "amount", label: "Por monto", icon: "cash" },
        ]
      : [{ id: "units", label: "Unidades", icon: "counter" }];

  if (hasPresentations) {
    modes.push({
      id: "presentation",
      label: "Presentación",
      icon: "package-variant-closed",
    });
  }
  return modes;
}

function calculateEntry(
  product: ProductRecord | undefined,
  presentation: ProductPresentationRecord | undefined,
  mode: SaleMode,
  amount: string,
): Calculation {
  if (!product || !amount.trim()) {
    return { quantity: 0, totalCents: 0, saleLabel: "", error: null };
  }

  try {
    let quantity: number | null = null;
    let totalCents = 0;
    let saleLabel = "";

    if (mode === "grams") {
      quantity = parseDecimalToInteger(amount, 0);
      saleLabel = quantity === null ? "" : `${quantity} g`;
    } else if (mode === "kilograms") {
      quantity = parseDecimalToInteger(amount, 3);
      saleLabel = quantity === null ? "" : `${amount.replace(",", ".")} kg`;
    } else if (mode === "units") {
      quantity = parseDecimalToInteger(amount, 0);
      saleLabel = quantity === null ? "" : `${quantity} unidad(es)`;
    } else if (mode === "amount") {
      const requestedCents = parseDecimalToInteger(amount, 2);
      if (requestedCents === null || requestedCents <= 0) {
        return {
          quantity: 0,
          totalCents: 0,
          saleLabel: "",
          error: "Ingresa un monto válido con hasta dos decimales.",
        };
      }
      quantity = calculateQuantityForAmountCents(
        requestedCents,
        product.priceCents,
        product.pricingQuantity,
      );
      totalCents = calculateLineTotalCents(
        quantity,
        product.priceCents,
        product.pricingQuantity,
      );
      saleLabel = `${formatMoney(requestedCents)} solicitado · ${quantity} g finales`;
    } else {
      const count = parseDecimalToInteger(amount, 0);
      if (!presentation || count === null || count <= 0) {
        return {
          quantity: 0,
          totalCents: 0,
          saleLabel: "",
          error: presentation
            ? "Ingresa un número entero de presentaciones."
            : "Selecciona una presentación.",
        };
      }
      quantity = presentation.quantityInBaseUnits * count;
      if (!Number.isSafeInteger(quantity)) {
        throw new Error("La cantidad excede el rango permitido.");
      }
      totalCents = calculateLineTotalCents(
        quantity,
        presentation.fixedPriceCents ?? product.priceCents,
        presentation.fixedPriceCents === null
          ? product.pricingQuantity
          : presentation.quantityInBaseUnits,
      );
      saleLabel = `${count} × ${presentation.name}`;
    }

    if (quantity === null || quantity <= 0) {
      return {
        quantity: 0,
        totalCents: 0,
        saleLabel: "",
        error: "Ingresa una cantidad entera válida.",
      };
    }
    if (totalCents === 0) {
      totalCents = calculateLineTotalCents(
        quantity,
        product.priceCents,
        product.pricingQuantity,
      );
    }

    return { quantity, totalCents, saleLabel, error: null };
  } catch (caughtError) {
    return {
      quantity: 0,
      totalCents: 0,
      saleLabel: "",
      error: getOperatorErrorMessage(caughtError, "No se pudo calcular."),
    };
  }
}

export default function SaleScreen() {
  const { isMedium } = useAdaptiveLayout();
  const {
    database,
    products,
    isLoading: productsLoading,
    error: productsError,
    refresh: refreshProducts,
  } = useLocalProducts();
  const {
    presentations,
    isLoading: presentationsLoading,
    error: presentationsError,
  } = useLocalPresentations();
  const {
    session,
    isLoading: cashLoading,
    error: cashError,
    refresh: refreshCash,
  } = useCashSession();
  const { selectedUser, deviceId } = useLocalOperator();
  const [selectedId, setSelectedId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [selectedPresentationId, setSelectedPresentationId] = useState("");
  const [mode, setMode] = useState<SaleMode>("grams");
  const [amount, setAmount] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentDrafts, setPaymentDrafts] = useState<PaymentDraft[]>([
    createPaymentDraft("cash", "0.00"),
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const pendingOperationId = useRef<string | null>(null);

  useEffect(() => {
    if (!products.length) return;
    if (!products.some((product) => product.id === selectedId)) {
      setSelectedId(products[0].id);
    }
  }, [products, selectedId]);

  const debouncedProductQuery = useDebouncedValue(productQuery);
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedId) ?? products[0],
    [products, selectedId],
  );
  const visibleProducts = useMemo(() => {
    const normalized = debouncedProductQuery.trim().toLocaleLowerCase("es-PE");
    if (!normalized) return products;
    return products.filter((product) =>
      `${product.name} ${product.sku} ${product.category}`
        .toLocaleLowerCase("es-PE")
        .includes(normalized),
    );
  }, [debouncedProductQuery, products]);
  const productPresentations = useMemo(
    () =>
      presentations.filter(
        (presentation) => presentation.productId === selectedProduct?.id,
      ),
    [presentations, selectedProduct],
  );
  const selectedPresentation = useMemo(
    () =>
      productPresentations.find(
        (presentation) => presentation.id === selectedPresentationId,
      ) ?? productPresentations[0],
    [productPresentations, selectedPresentationId],
  );
  const availableModes = useMemo(
    () => modesForProduct(selectedProduct, productPresentations.length > 0),
    [selectedProduct, productPresentations],
  );

  useEffect(() => {
    if (!selectedProduct) return;
    const nextMode = selectedProduct.baseUnit === "gram" ? "grams" : "units";
    setMode(nextMode);
    setAmount("");
    setSelectedPresentationId("");
  }, [selectedProduct]);

  useEffect(() => {
    if (
      visibleProducts.length &&
      !visibleProducts.some((product) => product.id === selectedId)
    ) {
      setSelectedId(visibleProducts[0].id);
    }
  }, [selectedId, visibleProducts]);

  useEffect(() => {
    if (mode === "presentation" && selectedPresentation) {
      setSelectedPresentationId(selectedPresentation.id);
    }
  }, [mode, selectedPresentation]);

  const calculation = useMemo(
    () => calculateEntry(selectedProduct, selectedPresentation, mode, amount),
    [selectedProduct, selectedPresentation, mode, amount],
  );
  const { cartTotalCents, parsedPayments, allocatedCents, pendingPaymentCents, paymentsAreValid, alreadyInCart } =
    useMemo(() => {
      const cartTotalCents = cart.reduce(
        (sum, line) => sum + line.totalCents,
        0,
      );
      const parsedPayments = paymentDrafts.map((payment) => {
        const amountCents = parseDecimalToInteger(payment.amount, 2);
        const amountReceivedCents =
          payment.method === "cash"
            ? parseDecimalToInteger(payment.amountReceived, 2)
            : null;
        const changeCents =
          payment.method === "cash" &&
          amountCents !== null &&
          amountReceivedCents !== null &&
          amountReceivedCents >= amountCents
            ? amountReceivedCents - amountCents
            : null;
        return { ...payment, amountCents, amountReceivedCents, changeCents };
      });
      const allocatedCents = parsedPayments.reduce(
        (sum, payment) => sum + (payment.amountCents ?? 0),
        0,
      );
      const pendingPaymentCents = cartTotalCents - allocatedCents;
      const paymentsAreValid =
        parsedPayments.length > 0 &&
        parsedPayments.every(
          (payment) =>
            payment.amountCents !== null &&
            payment.amountCents > 0 &&
            (payment.method !== "cash" || payment.changeCents !== null) &&
            (!requiresDemoValidation(payment.method) ||
              payment.validationStatus === "approved"),
        ) &&
        pendingPaymentCents === 0;
      const alreadyInCart = cart
        .filter((line) => line.productId === selectedProduct?.id)
        .reduce((sum, line) => sum + line.quantity, 0);
      return {
        cartTotalCents,
        parsedPayments,
        allocatedCents,
        pendingPaymentCents,
        paymentsAreValid,
        alreadyInCart,
      };
    }, [cart, paymentDrafts, selectedProduct]);
  const availableStock = Math.max(
    0,
    (selectedProduct?.stockQuantity ?? 0) - alreadyInCart,
  );
  const exceedsStock = calculation.quantity > availableStock;
  const canAdd =
    calculation.quantity > 0 &&
    calculation.totalCents > 0 &&
    !calculation.error &&
    !exceedsStock;
  const handleSelectProduct = useCallback(
    (productId: string) => setSelectedId(productId),
    [],
  );

  const canConfirm =
    Boolean(session && selectedUser && cart.length > 0) &&
    paymentsAreValid &&
    !isSaving;

  useEffect(() => {
    setPaymentDrafts((current) =>
      current.length === 1
        ? [
            {
              ...current[0],
              amount: formatMoneyInput(cartTotalCents),
              ...(current[0].amount === formatMoneyInput(cartTotalCents)
                ? {}
                : { validationStatus: "idle" as const, validationMessage: "" }),
            },
          ]
        : current,
    );
  }, [cartTotalCents]);

  const addToCart = () => {
    if (!selectedProduct || !canAdd) return;

    setCart((current) => [
      ...current,
      {
        id: createId(),
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        baseUnit: selectedProduct.baseUnit,
        quantity: calculation.quantity,
        totalCents: calculation.totalCents,
        saleLabel: calculation.saleLabel,
        presentationId:
          mode === "presentation" ? selectedPresentation?.id : undefined,
        presentationCount:
          mode === "presentation"
            ? (parseDecimalToInteger(amount, 0) ?? undefined)
            : undefined,
      },
    ]);
    setAmount("");
  };

  const togglePaymentMethod = (method: PaymentMethod) => {
    setPaymentDrafts((current) => {
      const existing = current.find((payment) => payment.method === method);
      if (existing) {
        return current.length === 1
          ? current
          : current.filter((payment) => payment.method !== method);
      }
      return [...current, createPaymentDraft(method)];
    });
  };

  const updatePaymentDraft = (
    method: PaymentMethod,
    field: "amount" | "amountReceived" | "reference",
    value: string,
  ) => {
    setPaymentDrafts((current) =>
      current.map((payment) =>
        payment.method === method
          ? {
              ...payment,
              [field]: value,
              ...((field === "amount" || field === "reference") &&
              requiresDemoValidation(payment.method)
                ? { validationStatus: "idle" as const, validationMessage: "" }
                : {}),
            }
          : payment,
      ),
    );
  };

  const fillPendingBalance = (method: PaymentMethod) => {
    const otherPaymentsCents = parsedPayments.reduce(
      (sum, payment) =>
        payment.method === method ? sum : sum + (payment.amountCents ?? 0),
      0,
    );
    updatePaymentDraft(
      method,
      "amount",
      formatMoneyInput(Math.max(cartTotalCents - otherPaymentsCents, 0)),
    );
  };

  const validateDigitalPayment = async (method: "yape" | "plin") => {
    const payment = parsedPayments.find(
      (candidate) => candidate.method === method,
    );
    if (!payment || payment.amountCents === null || payment.amountCents <= 0) {
      Alert.alert(
        "Falta el monto",
        "Asigna primero el monto que se pagará por este medio.",
      );
      return;
    }

    setPaymentDrafts((current) =>
      current.map((draft) =>
        draft.method === method
          ? { ...draft, validationStatus: "validating", validationMessage: "" }
          : draft,
      ),
    );

    try {
      const result = await demoPaymentValidationAdapter.validate({
        method,
        amountCents: payment.amountCents,
        reference: payment.reference,
      });
      setPaymentDrafts((current) =>
        current.map((draft) =>
          draft.method === method
            ? {
                ...draft,
                reference: result.normalizedReference,
                validationStatus: result.status,
                validationMessage: result.message,
              }
            : draft,
        ),
      );
    } catch (caughtError) {
      setPaymentDrafts((current) =>
        current.map((draft) =>
          draft.method === method
            ? {
                ...draft,
                validationStatus: "rejected",
                validationMessage: getOperatorErrorMessage(
                  caughtError,
                  "No se pudo validar el pago.",
                ),
              }
            : draft,
        ),
      );
    }
  };

  const handleConfirm = async () => {
    if (!canConfirm || !selectedUser) return;

    setIsSaving(true);
    pendingOperationId.current ??= createId();
    try {
      const result = await confirmSale(database, {
        storeId: DEFAULT_STORE_ID,
        deviceId,
        actorUserId: selectedUser.id,
        operationId: pendingOperationId.current,
        items: cart.map((line) => ({
          productId: line.productId,
          quantity: line.presentationId ? undefined : line.quantity,
          presentationId: line.presentationId,
          presentationCount: line.presentationCount,
        })),
        payments: parsedPayments.map((payment) => ({
          method: payment.method,
          amountCents: payment.amountCents as number,
          amountReceivedCents:
            payment.method === "cash"
              ? (payment.amountReceivedCents as number)
              : undefined,
          reference: payment.method === "cash" ? undefined : payment.reference,
        })),
      });

      pendingOperationId.current = null;
      setCart([]);
      setPaymentDrafts([createPaymentDraft("cash", "0.00")]);
      await Promise.all([refreshProducts(false), refreshCash(false)]);
      const totalChangeCents = result.payments.reduce(
        (sum, payment) => sum + payment.changeCents,
        0,
      );
      Alert.alert(
        "Venta registrada",
        `${result.sale.receiptNumber}\nTotal: ${formatMoney(result.sale.totalCents)}${
          totalChangeCents > 0
            ? `\nVuelto: ${formatMoney(totalChangeCents)}`
            : ""
        }`,
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo registrar la venta",
        getOperatorErrorMessage(caughtError, "No se pudo registrar la venta."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const isLoading = productsLoading || presentationsLoading || cashLoading;
  const loadError = productsError ?? presentationsError ?? cashError;

  if (isLoading) {
    return (
      <AdminScreen title="Nueva venta" subtitle="Venta presencial persistente">
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text style={styles.feedbackTitle}>Cargando caja y catálogo…</Text>
          <Text style={styles.feedbackText}>
            Verificando productos, stock y turno abierto.
          </Text>
        </View>
      </AdminScreen>
    );
  }

  if (loadError) {
    return (
      <AdminScreen title="Nueva venta" subtitle="Venta presencial persistente">
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {getOperatorErrorMessage(
              loadError,
              "No se pudo cargar caja y catálogo.",
            )}
          </Text>
        </View>
      </AdminScreen>
    );
  }

  if (!products.length) {
    return (
      <AdminScreen title="Nueva venta" subtitle="Venta presencial persistente">
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text style={styles.feedbackTitle}>Todavía no hay productos</Text>
          <Text style={styles.feedbackText}>
            Crea productos desde Inventario para comenzar a vender.
          </Text>
          <PrimaryButton
            label="Ir a Inventario"
            icon="warehouse"
            onPress={() => router.push("/inventario")}
          />
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen
      title="Nueva venta"
      subtitle="Registra productos por peso, unidad, presentación o monto"
      footer={
        cart.length ? (
          <View style={styles.stickySale}>
            <View style={styles.stickySaleCopy}>
              <Text style={styles.stickySaleLabel}>{cart.length} ítem(s)</Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.stickySaleTotal}>
                {formatMoney(cartTotalCents)}
              </Text>
            </View>
            <PrimaryButton
              label={isSaving ? "Guardando…" : "Cobrar"}
              icon="cash-register"
              onPress={() => void handleConfirm()}
              disabled={!canConfirm}
              style={styles.stickySaleButton}
            />
          </View>
        ) : undefined
      }
    >
      {!session ? (
        <View style={[sharedStyles.card, styles.cashWarning]}>
          <MaterialCommunityIcons
            name="cash-register"
            size={24}
            color={BrandColors.warning}
          />
          <View style={styles.warningCopy}>
            <Text style={styles.warningTitle}>Caja cerrada</Text>
            <Text style={styles.warningText}>
              Abre una caja desde el panel antes de confirmar.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Ir al panel para abrir caja"
            accessibilityRole="button"
            onPress={() => router.push("/panel")}
            style={styles.warningButton}
          >
            <Text style={styles.warningButtonText}>Ir al panel</Text>
          </Pressable>
        </View>
      ) : null}

      <SectionTitle>1. Elige un producto</SectionTitle>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <MaterialCommunityIcons
            name="magnify"
            size={21}
            color={BrandColors.muted}
          />
          <TextInput
            accessibilityLabel="Buscar producto para vender"
            onChangeText={setProductQuery}
            placeholder="Buscar por nombre, SKU o categoría"
            placeholderTextColor={BrandColors.muted}
            style={styles.searchInput}
            value={productQuery}
          />
          {productQuery ? (
            <Pressable
              accessibilityLabel="Limpiar búsqueda"
              accessibilityRole="button"
              onPress={() => setProductQuery("")}
              style={styles.clearSearchButton}
            >
              <MaterialCommunityIcons
                name="close-circle"
                size={20}
                color={BrandColors.muted}
              />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="Escanear producto"
          accessibilityRole="button"
          onPress={() => router.push("/scanner")}
          style={styles.scanButton}
        >
          <MaterialCommunityIcons
            name="barcode-scan"
            size={22}
            color={BrandColors.white}
          />
        </Pressable>
      </View>
      <ScrollView
        horizontal
        contentContainerStyle={styles.productList}
        showsHorizontalScrollIndicator={false}
      >
        {visibleProducts.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            selected={product.id === selectedProduct?.id}
            onSelect={handleSelectProduct}
          />
        ))}
      </ScrollView>
      {!visibleProducts.length ? (
        <View style={[sharedStyles.card, styles.noProducts]}>
          <MaterialCommunityIcons
            name="magnify-close"
            size={28}
            color={BrandColors.muted}
          />
          <Text style={styles.noProductsText}>
            No encontramos productos con esa búsqueda.
          </Text>
        </View>
      ) : null}

      <SectionTitle>2. Forma de venta</SectionTitle>
      <View style={styles.modeRow}>
        {availableModes.map((item) => {
          const selected = mode === item.id;
          return (
            <Pressable
              accessibilityLabel={item.label}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              key={item.id}
              onPress={() => {
                setMode(item.id);
                setAmount("");
              }}
              style={[
                styles.modeButton,
                isMedium && styles.modeButtonMedium,
                selected && styles.modeButtonSelected,
              ]}
            >
              <MaterialCommunityIcons
                name={item.icon}
                size={20}
                color={selected ? BrandColors.greenDark : BrandColors.muted}
              />
              <Text
                style={[styles.modeLabel, selected && styles.modeLabelSelected]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {mode === "presentation" ? (
        <View style={styles.presentationList}>
          {productPresentations.map((presentation) => {
            const selected = presentation.id === selectedPresentation?.id;
            return (
              <Pressable
                accessibilityLabel={presentation.name}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                key={presentation.id}
                onPress={() => {
                  setSelectedPresentationId(presentation.id);
                  setAmount("");
                }}
                style={[
                  styles.presentationButton,
                  selected && styles.presentationButtonSelected,
                ]}
              >
                <Text
                  style={[
                    styles.presentationName,
                    selected && styles.presentationNameSelected,
                  ]}
                >
                  {presentation.name}
                </Text>
                <Text style={styles.presentationDetail}>
                  {formatQuantity(
                    selectedProduct.baseUnit,
                    presentation.quantityInBaseUnits,
                    true,
                  )}
                  {presentation.fixedPriceCents !== null
                    ? ` · ${formatMoney(presentation.fixedPriceCents)}`
                    : " · precio calculado"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={[sharedStyles.card, styles.calculatorCard]}>
        <Text style={styles.inputLabel}>
          {mode === "grams"
            ? "Cantidad en gramos"
            : mode === "kilograms"
              ? "Cantidad en kilos"
              : mode === "units"
                ? "Cantidad de unidades"
                : mode === "amount"
                  ? "Monto solicitado en soles"
                  : "Número de presentaciones"}
        </Text>
        <View
          style={[
            styles.inputWrap,
            (exceedsStock || calculation.error) && styles.inputError,
          ]}
        >
          {mode === "amount" ? (
            <Text style={styles.inputPrefix}>S/</Text>
          ) : null}
          <TextInput
            accessibilityLabel="Cantidad de venta"
            keyboardType="decimal-pad"
            onChangeText={setAmount}
            placeholder={
              mode === "grams"
                ? "Ej. 250"
                : mode === "kilograms"
                  ? "Ej. 2.500"
                  : mode === "amount"
                    ? "Ej. 10.00"
                    : "Ej. 2"
            }
            placeholderTextColor={BrandColors.muted}
            selectTextOnFocus
            style={styles.input}
            value={amount}
          />
          {mode === "grams" ? <Text style={styles.inputUnit}>g</Text> : null}
          {mode === "kilograms" ? (
            <Text style={styles.inputUnit}>kg</Text>
          ) : null}
        </View>
        {calculation.error ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {calculation.error}
          </Text>
        ) : null}
        {exceedsStock ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            Supera el stock disponible (
            {formatQuantity(selectedProduct.baseUnit, availableStock, true)}).
          </Text>
        ) : null}

        <View style={styles.resultRow}>
          <View>
            <Text style={styles.resultLabel}>Cantidad final</Text>
            <Text style={styles.resultValue}>
              {formatQuantity(
                selectedProduct.baseUnit,
                calculation.quantity,
                true,
              )}
            </Text>
          </View>
          <View style={styles.resultDivider} />
          <View style={styles.resultRight}>
            <Text style={styles.resultLabel}>Subtotal real</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.totalValue}>
              {formatMoney(calculation.totalCents)}
            </Text>
          </View>
        </View>
        <PrimaryButton
          label="Agregar a la venta"
          icon="plus"
          onPress={addToCart}
          disabled={!canAdd}
        />
      </View>

      <SectionTitle
        action={
          cart.length > 0 ? (
            <Text style={styles.itemCount}>{cart.length} ítem(s)</Text>
          ) : undefined
        }
      >
        3. Resumen
      </SectionTitle>
      <View style={[sharedStyles.card, styles.cartCard]}>
        {cart.length === 0 ? (
          <View style={styles.emptyCart}>
            <MaterialCommunityIcons
              name="cart-outline"
              size={34}
              color={BrandColors.mutedLight}
            />
            <Text style={styles.emptyTitle}>La venta está vacía</Text>
            <Text style={styles.emptyText}>
              Selecciona un producto y agrega una cantidad.
            </Text>
          </View>
        ) : (
          <>
            {cart.map((line, index) => (
              <View
                key={line.id}
                style={[styles.cartLine, index > 0 && styles.cartLineBorder]}
              >
                <View style={styles.cartLineCopy}>
                  <Text style={styles.cartProduct}>{line.productName}</Text>
                  <Text style={styles.cartDetail}>
                    {line.saleLabel} ·{" "}
                    {formatQuantity(line.baseUnit, line.quantity, true)}
                  </Text>
                </View>
                <Text style={styles.cartPrice}>
                  {formatMoney(line.totalCents)}
                </Text>
                <Pressable
                  accessibilityLabel={`Quitar ${line.productName}`}
                  accessibilityRole="button"
                  onPress={() =>
                    setCart((current) =>
                      current.filter((item) => item.id !== line.id),
                    )
                  }
                  style={styles.removeButton}
                >
                  <MaterialCommunityIcons
                    name="close"
                    size={18}
                    color={BrandColors.danger}
                  />
                </Pressable>
              </View>
            ))}
            <View style={styles.cartTotalRow}>
              <Text style={styles.cartTotalLabel}>TOTAL</Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.cartTotal}>
                {formatMoney(cartTotalCents)}
              </Text>
            </View>
          </>
        )}
      </View>

      <SectionTitle>4. Medios de pago</SectionTitle>
      <View style={styles.paymentRow}>
        {paymentMethods.map((payment) => {
          const selected = paymentDrafts.some(
            (draft) => draft.method === payment.id,
          );
          return (
            <Pressable
              accessibilityLabel={payment.label}
              key={payment.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              onPress={() => togglePaymentMethod(payment.id)}
              style={[
                styles.paymentButton,
                isMedium && styles.paymentButtonMedium,
                selected && styles.paymentButtonSelected,
              ]}
            >
              <MaterialCommunityIcons
                name={payment.icon}
                size={19}
                color={selected ? BrandColors.greenDark : BrandColors.muted}
              />
              <Text
                style={[
                  styles.paymentLabel,
                  selected && styles.paymentLabelSelected,
                ]}
              >
                {payment.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View
        style={[
          sharedStyles.card,
          styles.allocationSummary,
          pendingPaymentCents !== 0 && styles.allocationSummaryPending,
        ]}
      >
        <Text style={styles.resultLabel}>Distribución del total</Text>
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.allocationValue,
            pendingPaymentCents !== 0 && styles.allocationValuePending,
          ]}
        >
          {pendingPaymentCents === 0
            ? `Completa · ${formatMoney(allocatedCents)}`
            : pendingPaymentCents > 0
              ? `Falta asignar ${formatMoney(pendingPaymentCents)}`
              : `Excede por ${formatMoney(Math.abs(pendingPaymentCents))}`}
        </Text>
      </View>

      {parsedPayments.map((payment) => {
        const metadata = paymentMethods.find(
          (item) => item.id === payment.method,
        );
        return (
          <View
            key={payment.method}
            style={[sharedStyles.card, styles.paymentCard]}
          >
            <View style={styles.paymentCardHeader}>
              <View style={styles.paymentCardTitle}>
                <MaterialCommunityIcons
                  name={metadata?.icon ?? "cash"}
                  size={20}
                  color={BrandColors.greenDark}
                />
                <Text style={styles.paymentCardTitleText}>
                  {metadata?.label}
                </Text>
              </View>
              {paymentDrafts.length > 1 ? (
                <Pressable
                  accessibilityLabel={`Quitar pago ${metadata?.label}`}
                  accessibilityRole="button"
                  onPress={() => togglePaymentMethod(payment.method)}
                  style={styles.removePaymentButton}
                >
                  <MaterialCommunityIcons
                    name="close"
                    size={17}
                    color={BrandColors.danger}
                  />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.paymentAmountHeader}>
              <Text style={styles.inputLabel}>Monto aplicado</Text>
              <Pressable
                accessibilityLabel={`Usar saldo pendiente con ${metadata?.label}`}
                accessibilityRole="button"
                onPress={() => fillPendingBalance(payment.method)}
                style={styles.useBalanceButton}
              >
                <Text style={styles.useBalanceText}>Usar saldo</Text>
              </Pressable>
            </View>
            <View style={styles.inputWrap}>
              <Text style={styles.inputPrefix}>S/</Text>
              <TextInput
                accessibilityLabel={`Monto pagado con ${metadata?.label}`}
                keyboardType="decimal-pad"
                onChangeText={(value) =>
                  updatePaymentDraft(payment.method, "amount", value)
                }
                placeholder="0.00"
                placeholderTextColor={BrandColors.muted}
                selectTextOnFocus
                style={styles.input}
                value={payment.amount}
              />
            </View>

            {payment.method === "cash" ? (
              <>
                <Text style={styles.inputLabel}>Efectivo recibido</Text>
                <View style={styles.inputWrap}>
                  <Text style={styles.inputPrefix}>S/</Text>
                  <TextInput
                    accessibilityLabel="Efectivo recibido"
                    keyboardType="decimal-pad"
                    onChangeText={(value) =>
                      updatePaymentDraft(
                        payment.method,
                        "amountReceived",
                        value,
                      )
                    }
                    placeholder={payment.amount || "0.00"}
                    placeholderTextColor={BrandColors.muted}
                    style={styles.input}
                    value={payment.amountReceived}
                  />
                </View>
                <View style={styles.changeRow}>
                  <Text style={styles.resultLabel}>Vuelto</Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.changeValue}>
                {payment.changeCents === null
                  ? "—"
                  : formatMoney(payment.changeCents)}
              </Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.inputLabel}>
                  {requiresDemoValidation(payment.method)
                    ? "Código de operación *"
                    : "Referencia opcional"}
                </Text>
                <TextInput
                  accessibilityLabel={
                    requiresDemoValidation(payment.method)
                      ? `Código de operación de ${metadata?.label}`
                      : `Referencia de ${metadata?.label}`
                  }
                  keyboardType={
                    requiresDemoValidation(payment.method)
                      ? "number-pad"
                      : "default"
                  }
                  onChangeText={(value) =>
                    updatePaymentDraft(payment.method, "reference", value)
                  }
                  placeholder={
                    requiresDemoValidation(payment.method)
                      ? "Entre 6 y 12 dígitos"
                      : `Código o referencia de ${metadata?.label}`
                  }
                  placeholderTextColor={BrandColors.muted}
                  style={styles.referenceInput}
                  value={payment.reference}
                />
                {requiresDemoValidation(payment.method) ? (
                  <>
                    <Pressable
                      accessibilityLabel={`Validar pago ${metadata?.label}`}
                      accessibilityRole="button"
                      accessibilityState={{
                        disabled:
                          payment.validationStatus === "validating" ||
                          payment.amountCents === null ||
                          payment.amountCents <= 0 ||
                          !payment.reference.trim(),
                        busy: payment.validationStatus === "validating",
                      }}
                      disabled={
                        payment.validationStatus === "validating" ||
                        payment.amountCents === null ||
                        payment.amountCents <= 0 ||
                        !payment.reference.trim()
                      }
                      onPress={() =>
                        void validateDigitalPayment(
                          payment.method as "yape" | "plin",
                        )
                      }
                      style={[
                        styles.validationButton,
                        payment.validationStatus === "approved" &&
                          styles.validationButtonApproved,
                        (payment.validationStatus === "validating" ||
                          payment.amountCents === null ||
                          payment.amountCents <= 0 ||
                          !payment.reference.trim()) &&
                          styles.validationButtonDisabled,
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={
                          payment.validationStatus === "approved"
                            ? "check-decagram"
                            : "shield-check-outline"
                        }
                        size={18}
                        color={
                          payment.validationStatus === "approved"
                            ? BrandColors.greenDark
                            : BrandColors.white
                        }
                      />
                      <Text
                        style={[
                          styles.validationButtonText,
                          payment.validationStatus === "approved" &&
                            styles.validationButtonApprovedText,
                        ]}
                      >
                        {payment.validationStatus === "validating"
                          ? "Validando…"
                          : payment.validationStatus === "approved"
                            ? "Pago validado"
                            : `Validar ${metadata?.label} (demo)`}
                      </Text>
                    </Pressable>
                    {payment.validationMessage ? (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={[
                          styles.validationMessage,
                          payment.validationStatus === "approved"
                            ? styles.validationApproved
                            : styles.validationRejected,
                        ]}
                      >
                        {payment.validationMessage}
                      </Text>
                    ) : null}
                    <Text style={styles.paymentNotice}>
                      Simulación local para demo. No consulta Yape, Plin ni una
                      entidad financiera real.
                    </Text>
                  </>
                ) : (
                  <Text style={styles.paymentNotice}>
                    Solo se guardará la referencia; no se procesa ningún pago
                    real.
                  </Text>
                )}
              </>
            )}
          </View>
        );
      })}

      <Text style={styles.localNotice}>
        Confirmación central pendiente. La validación Yape/Plin es simulada para
        demostración.
      </Text>
    </AdminScreen>
  );
}

type ProductCardProps = {
  product: ProductRecord;
  selected: boolean;
  onSelect: (productId: string) => void;
};

// Memoizado: el grid horizontal del POS deja de reconciliarse cuando el
// operador teclea montos o cantidades; solo re-renderiza la tarjeta cuyo
// estado `selected` cambia.
const ProductCard = memo(function ProductCard({
  product,
  selected,
  onSelect,
}: ProductCardProps) {
  return (
    <Pressable
      accessibilityLabel={`${product.name}, ${formatMoney(product.priceCents)} por ${priceLabel(product)}`}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => onSelect(product.id)}
      style={({ pressed }) => [
        styles.productCard,
        selected && styles.productCardSelected,
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[styles.productIcon, selected && styles.productIconSelected]}
      >
        <MaterialCommunityIcons
          name={product.baseUnit === "gram" ? "barley" : "package-variant"}
          size={24}
          color={selected ? BrandColors.white : BrandColors.green}
        />
      </View>
      <Text
        numberOfLines={1}
        style={[styles.productName, selected && styles.productNameSelected]}
      >
        {product.name}
      </Text>
      <Text
        style={[styles.productPrice, selected && styles.productPriceSelected]}
      >
        {formatMoney(product.priceCents)} / {priceLabel(product)}
      </Text>
      <Text
        style={[styles.productStock, selected && styles.productStockSelected]}
      >
        {formatQuantity(product.baseUnit, product.stockQuantity, true)} disp.
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  feedbackCard: { gap: Spacing.xs, padding: Spacing.lg },
  feedbackTitle: { color: BrandColors.text, ...Typography.label },
  feedbackText: { color: BrandColors.muted, ...Typography.caption },
  cashWarning: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: BrandColors.goldLight,
    borderColor: BrandColors.goldDark,
  },
  warningCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 0 },
  warningTitle: {
    color: BrandColors.warning,
    ...Typography.label,
    flexShrink: 1,
  },
  warningText: {
    color: BrandColors.warning,
    ...Typography.caption,
    marginTop: Spacing.xxs,
    flexShrink: 1,
  },
  warningButton: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 140,
    minWidth: 120,
    minHeight: ControlSize.default,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.warning,
    paddingHorizontal: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  warningButtonText: { color: BrandColors.white, ...Typography.label },
  searchRow: { flexDirection: "row", gap: Spacing.xs },
  search: {
    flex: 1,
    minWidth: 0,
    minHeight: ControlSize.default,
    borderWidth: 1,
    borderColor: BrandColors.lineStrong,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.white,
    paddingLeft: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: BrandColors.text,
    ...Typography.body,
  },
  clearSearchButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
  },
  scanButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenDark,
    alignItems: "center",
    justifyContent: "center",
  },
  noProducts: { alignItems: "center", gap: Spacing.xs, padding: Spacing.lg },
  noProductsText: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
  productList: { gap: Spacing.sm, paddingRight: Spacing.xs },
  productCard: {
    width: 126,
    minHeight: 104,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    padding: Spacing.xs,
  },
  productCardSelected: {
    backgroundColor: BrandColors.greenDark,
    borderColor: BrandColors.gold,
  },
  productIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  productIconSelected: { backgroundColor: BrandColors.green },
  productName: {
    color: BrandColors.text,
    ...Typography.caption,
    fontWeight: "700",
    marginTop: Spacing.xs,
  },
  productNameSelected: { color: BrandColors.white },
  productPrice: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    marginTop: 2,
  },
  productPriceSelected: { color: BrandColors.gold },
  productStock: {
    color: BrandColors.muted,
    ...Typography.overline,
    letterSpacing: 0,
    marginTop: 2,
  },
  productStockSelected: { color: BrandColors.greenMid },
  modeRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  modeButton: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 150,
    minWidth: 120,
    minHeight: ControlSize.default,
    backgroundColor: BrandColors.white,
    borderColor: BrandColors.line,
    borderWidth: 1,
    borderRadius: Radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.xs,
  },
  modeButtonMedium: { maxWidth: 200 },
  modeButtonSelected: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
    borderWidth: 2,
  },
  modeLabel: {
    color: BrandColors.muted,
    ...Typography.label,
    textAlign: "center",
    flexShrink: 1,
  },
  modeLabelSelected: { color: BrandColors.greenDark },
  presentationList: { gap: Spacing.xs },
  presentationButton: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    padding: Spacing.sm,
    justifyContent: "center",
  },
  presentationButtonSelected: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
    borderWidth: 2,
  },
  presentationName: { color: BrandColors.text, ...Typography.label },
  presentationNameSelected: { color: BrandColors.greenDark },
  presentationDetail: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  calculatorCard: { gap: Spacing.sm },
  inputLabel: { color: BrandColors.text, ...Typography.label },
  inputWrap: {
    minHeight: ControlSize.large,
    borderWidth: 1.5,
    borderColor: BrandColors.line,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.white,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
  },
  inputError: { borderColor: BrandColors.danger },
  inputPrefix: {
    color: BrandColors.text,
    ...Typography.h2,
    marginRight: Spacing.xs,
  },
  input: {
    flex: 1,
    color: BrandColors.text,
    ...Typography.h2,
    paddingVertical: 0,
  },
  inputUnit: { color: BrandColors.muted, ...Typography.h3 },
  errorText: { color: BrandColors.danger, ...Typography.caption },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: BrandColors.cream,
    borderRadius: ComponentMetrics.inputRadius,
    padding: Spacing.sm,
  },
  resultDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: BrandColors.line,
    marginHorizontal: Spacing.md,
  },
  resultRight: { flex: 1, alignItems: "flex-end" },
  resultLabel: { color: BrandColors.muted, ...Typography.label },
  resultValue: {
    color: BrandColors.text,
    ...Typography.h3,
    marginTop: Spacing.xxs,
  },
  totalValue: {
    color: BrandColors.greenDark,
    ...Typography.h2,
    marginTop: Spacing.xxs,
  },
  itemCount: { color: BrandColors.green, ...Typography.label },
  cartCard: { paddingVertical: Spacing.xxs },
  emptyCart: { alignItems: "center", paddingVertical: Spacing.xl },
  emptyTitle: {
    color: BrandColors.text,
    ...Typography.label,
    marginTop: Spacing.xs,
  },
  emptyText: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  cartLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  cartLineBorder: { borderTopWidth: 1, borderTopColor: BrandColors.line },
  cartLineCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 160 },
  cartProduct: { color: BrandColors.text, ...Typography.label, flexShrink: 1 },
  cartDetail: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
    flexShrink: 1,
  },
  cartPrice: { color: BrandColors.text, ...Typography.label, flexShrink: 0 },
  removeButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.dangerLight,
    alignItems: "center",
    justifyContent: "center",
  },
  cartTotalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: BrandColors.line,
    paddingVertical: Spacing.md,
  },
  cartTotalLabel: { color: BrandColors.muted, ...Typography.overline },
  cartTotal: { color: BrandColors.greenDark, ...Typography.h2, flexShrink: 1 },
  paymentRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  paymentButton: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "47%",
    minWidth: 130,
    minHeight: ControlSize.default,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    borderRadius: ComponentMetrics.inputRadius,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  paymentButtonMedium: { flexBasis: "23%" },
  paymentButtonSelected: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
    borderWidth: 2,
  },
  paymentLabel: {
    color: BrandColors.muted,
    ...Typography.label,
    flexShrink: 1,
  },
  paymentLabelSelected: { color: BrandColors.greenDark, ...Typography.label },
  paymentCard: { gap: Spacing.sm },
  paymentCardHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  paymentCardTitle: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  paymentCardTitleText: {
    color: BrandColors.text,
    ...Typography.label,
    flexShrink: 1,
  },
  removePaymentButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.dangerLight,
    alignItems: "center",
    justifyContent: "center",
  },
  paymentAmountHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  useBalanceButton: {
    flexShrink: 1,
    minHeight: ControlSize.default,
    justifyContent: "center",
  },
  useBalanceText: {
    color: BrandColors.greenDark,
    ...Typography.label,
    flexShrink: 1,
  },
  allocationSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
    backgroundColor: BrandColors.greenLight,
  },
  allocationSummaryPending: { backgroundColor: BrandColors.goldLight },
  allocationValue: {
    color: BrandColors.greenDark,
    ...Typography.label,
    flexShrink: 1,
    textAlign: "right",
  },
  allocationValuePending: { color: BrandColors.warning },
  changeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.xs,
    backgroundColor: BrandColors.cream,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  changeValue: {
    color: BrandColors.greenDark,
    ...Typography.h2,
    flexShrink: 1,
  },
  referenceInput: {
    minHeight: ControlSize.default,
    borderWidth: 1.5,
    borderColor: BrandColors.line,
    borderRadius: ComponentMetrics.inputRadius,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
  },
  validationButton: {
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  validationButtonApproved: {
    backgroundColor: BrandColors.greenLight,
    borderWidth: 1,
    borderColor: BrandColors.green,
  },
  validationButtonDisabled: { opacity: Interaction.disabledOpacity },
  validationButtonText: { color: BrandColors.white, ...Typography.label },
  validationButtonApprovedText: { color: BrandColors.greenDark },
  validationMessage: { ...Typography.caption },
  validationApproved: { color: BrandColors.greenDark },
  validationRejected: { color: BrandColors.danger },
  paymentNotice: { color: BrandColors.muted, ...Typography.caption },
  localNotice: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
    marginTop: -Spacing.xs,
  },
  stickySale: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.md,
  },
  stickySaleCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 120, minWidth: 0 },
  stickySaleLabel: {
    color: BrandColors.muted,
    ...Typography.label,
    flexShrink: 1,
  },
  stickySaleTotal: { color: BrandColors.text, ...Typography.h2, flexShrink: 1 },
  stickySaleButton: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    minWidth: 180,
  },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
