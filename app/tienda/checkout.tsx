import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { CommerceButton, TrustItem } from "@/components/commerce-ui";
import { ModalSurface } from "@/components/modal-surface";
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
import { DELIVERY_DISTRICTS } from "@/constants/districts";
import { useCart } from "@/context/cart-context";
import { useCustomerAuth } from "@/context/customer-auth-context";
import { formatSoles } from "@/lib/money";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import type { FulfillmentType, PaymentMethod } from "@/database/models";
import type {
  OnlineCatalog,
  SavedCustomerAddress,
} from "@/online/contracts";
import {
  createOnlineOrder,
  getMyAddresses,
  getOnlineCatalog,
} from "@/online/store-api";

function normalizeDistrict(value: string) {
  return value.trim().toLocaleLowerCase("es-PE");
}

export default function CheckoutScreen() {
  const { items, subtotalCents, clear } = useCart();
  const { account } = useCustomerAuth();
  const [catalog, setCatalog] = useState<OnlineCatalog | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<SavedCustomerAddress[]>(
    [],
  );
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [fulfillment, setFulfillment] = useState<FulfillmentType>("pickup");
  const [zoneId, setZoneId] = useState("");
  const [label, setLabel] = useState("Dirección");
  const [address, setAddress] = useState("");
  const [district, setDistrict] = useState("");
  const [instructions, setInstructions] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zoneFeedback, setZoneFeedback] = useState<string | null>(null);
  const [isDistrictPickerOpen, setIsDistrictPickerOpen] = useState(false);
  const [districtQuery, setDistrictQuery] = useState("");

  const loadOptions = useCallback(async () => {
    setIsLoadingOptions(true);
    setLoadError(null);
    try {
      const [nextCatalog, nextAddresses] = await Promise.all([
        getOnlineCatalog(),
        account ? getMyAddresses(account.id) : Promise.resolve([]),
      ]);
      setCatalog(nextCatalog);
      setSavedAddresses(nextAddresses);
    } catch {
      setCatalog(null);
      setSavedAddresses([]);
      setSelectedAddressId("");
      setZoneId("");
      setLoadError(
        "No pudimos cargar las zonas de delivery. Revisa tu conexión e intenta nuevamente.",
      );
    } finally {
      setIsLoadingOptions(false);
    }
  }, [account]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const zone =
    catalog?.deliveryZones.find((item) => item.id === zoneId) ?? null;
  const checkoutPending =
    fulfillment === "delivery" && (isLoadingOptions || Boolean(loadError));
  const total =
    subtotalCents + (fulfillment === "delivery" ? (zone?.feeCents ?? 0) : 0);

  const districtOptions = useMemo(() => {
    const normalized = districtQuery.trim().toLocaleLowerCase("es-PE");
    if (!normalized) return DELIVERY_DISTRICTS;
    return DELIVERY_DISTRICTS.filter((value) =>
      value.toLocaleLowerCase("es-PE").includes(normalized),
    );
  }, [districtQuery]);

  const coveredDistricts = useMemo(
    () =>
      new Set(
        (catalog?.deliveryZones ?? []).map((zoneItem) =>
          normalizeDistrict(zoneItem.district),
        ),
      ),
    [catalog],
  );

  const selectDistrict = (nextDistrict: string) => {
    setIsDistrictPickerOpen(false);
    setDistrictQuery("");
    setSelectedAddressId("");
    setDistrict(nextDistrict);
    const matchingZone = catalog?.deliveryZones.find(
      (candidate) =>
        normalizeDistrict(candidate.district) === normalizeDistrict(nextDistrict),
    );
    if (matchingZone) {
      setZoneId(matchingZone.id);
      setZoneFeedback(null);
    } else {
      setZoneId("");
      setZoneFeedback(
        `Aún no tenemos delivery en ${nextDistrict}. Elige otro distrito o recoge en tienda.`,
      );
    }
  };

  const selectSavedAddress = (saved: SavedCustomerAddress) => {
    setZoneId("");
    setZoneFeedback(null);
    setSelectedAddressId(saved.id);
    setLabel(saved.label);
    setAddress(saved.address);
    setDistrict(saved.district);
    setInstructions(saved.instructions ?? "");
    const matchingZone = catalog?.deliveryZones.find(
      (candidate) =>
        candidate.district.toLocaleLowerCase("es-PE") ===
        saved.district.toLocaleLowerCase("es-PE"),
    );
    if (matchingZone) {
      setZoneId(matchingZone.id);
    } else {
      setZoneFeedback(
        `Aún no tenemos una zona de delivery para ${saved.district}. Elige otra dirección o recojo en tienda.`,
      );
    }
  };

  const changeAddress = (value: string) => {
    setSelectedAddressId("");
    setAddress(value);
  };

  const validation = useMemo(() => {
    if (!items.length) return "El carrito está vacío.";
    if (fulfillment === "delivery" && !district)
      return "Selecciona el distrito de entrega.";
    if (fulfillment === "delivery" && !zone)
      return "Aún no tenemos delivery en ese distrito.";
    if (fulfillment === "delivery" && !address.trim())
      return "Escribe la dirección exacta.";
    if (zone && subtotalCents < zone.minimumOrderCents)
      return `El mínimo de la zona es ${formatSoles(zone.minimumOrderCents)}.`;
    if (["yape", "plin"].includes(paymentMethod) && !reference.trim())
      return "Ingresa la referencia del pago digital.";
    return null;
  }, [
    address,
    district,
    fulfillment,
    items.length,
    paymentMethod,
    reference,
    subtotalCents,
    zone,
  ]);

  const submit = async () => {
    if (checkoutPending) return;
    if (validation) {
      Alert.alert("Revisa tu pedido", validation);
      return;
    }
    setIsSaving(true);
    try {
      const result = await createOnlineOrder({
        fulfillmentType: fulfillment,
        deliveryZoneId: fulfillment === "delivery" ? zoneId : null,
        address:
          fulfillment === "delivery"
            ? { label, address, district, instructions }
            : null,
        items,
        paymentMethod,
        paymentReference: ["yape", "plin"].includes(paymentMethod)
          ? reference
          : null,
        notes,
      });
      clear();
      router.replace(
        `/tienda/confirmacion?numero=${encodeURIComponent(result.orderNumber)}&total=${result.estimatedTotalCents}` as Href,
      );
    } catch (error) {
      Alert.alert(
        "No se pudo crear el pedido",
        getUserFacingErrorMessage(
          error,
          "Revisa los datos del pedido e intenta nuevamente.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <OnlineScreen
      title="Finalizar compra"
      subtitle="Confirma cómo recibirás tu pedido"
      footer={
        <View style={styles.footer}>
          <View>
            <Text style={styles.footerLabel}>Total estimado</Text>
            <Text maxFontSizeMultiplier={1.4} style={styles.footerTotal}>
              S/ {(total / 100).toFixed(2)}
            </Text>
          </View>
          <CommerceButton
            compact
            disabled={checkoutPending || Boolean(validation) || isSaving}
            icon="check-circle-outline"
            label={isSaving ? "Confirmando…" : "Confirmar pedido"}
            loading={isSaving}
            onPress={() => void submit()}
            style={styles.footerButton}
            tone="accent"
          />
        </View>
      }
    >
      <View style={styles.progress}>
        <View style={styles.progressDone}>
          <MaterialCommunityIcons
            name="check"
            size={14}
            color={BrandColors.white}
          />
        </View>
        <View style={styles.progressLineActive} />
        <View style={styles.progressActive}>
          <Text style={styles.progressActiveText}>2</Text>
        </View>
        <View style={styles.progressLine} />
        <View style={styles.progressStep}>
          <Text style={styles.progressText}>3</Text>
        </View>
        <Text style={styles.progressLabel}>Entrega y pago</Text>
      </View>

      <Section icon="truck-delivery-outline" title="¿Cómo recibes tu compra?">
        <View style={styles.row}>
          <Choice
            active={fulfillment === "pickup"}
            description="Sin costo adicional"
            icon="store-marker-outline"
            label="Recojo"
            onPress={() => {
              setFulfillment("pickup");
              setZoneId("");
              setZoneFeedback(null);
            }}
          />
          <Choice
            active={fulfillment === "delivery"}
            description="Recíbelo en casa"
            icon="moped-outline"
            label="Delivery"
            onPress={() => setFulfillment("delivery")}
          />
        </View>

        {fulfillment === "delivery" ? (
          <>
            {savedAddresses.length ? (
              <>
                <Text style={styles.label}>Usa una dirección guardada</Text>
                <View style={styles.savedAddresses}>
                  {savedAddresses.map((saved) => (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: selectedAddressId === saved.id,
                      }}
                      key={saved.id}
                      onPress={() => selectSavedAddress(saved)}
                      style={({ pressed }) => [
                        styles.savedAddress,
                        selectedAddressId === saved.id &&
                          styles.savedAddressActive,
                        pressed && styles.pressed,
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="map-marker-outline"
                        size={19}
                        color={
                          selectedAddressId === saved.id
                            ? BrandColors.greenDark
                            : BrandColors.muted
                        }
                      />
                      <View style={styles.savedAddressCopy}>
                        <Text style={styles.savedAddressLabel}>
                          {saved.label}
                        </Text>
                        <Text numberOfLines={1} style={styles.savedAddressText}>
                          {saved.address} · {saved.district}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            <View style={styles.fieldGrid}>
              <Field
                label="Dirección exacta"
                value={address}
                onChangeText={changeAddress}
              />
              <Field
                label="Referencia para encontrarla"
                multiline
                value={instructions}
                onChangeText={setInstructions}
              />
            </View>

            <Text style={styles.label}>Distrito de entrega</Text>
            <Pressable
              accessibilityLabel="Seleccionar distrito de entrega"
              accessibilityRole="button"
              onPress={() => setIsDistrictPickerOpen(true)}
              style={({ pressed }) => [
                styles.pickerButton,
                pressed && styles.pressed,
              ]}
            >
              <MaterialCommunityIcons
                name="map-marker-outline"
                size={20}
                color={district ? BrandColors.greenDark : BrandColors.muted}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.pickerText,
                  !district && styles.pickerPlaceholder,
                ]}
              >
                {district || "Selecciona tu distrito"}
              </Text>
              <MaterialCommunityIcons
                name="chevron-down"
                size={20}
                color={BrandColors.muted}
              />
            </Pressable>

            {loadError ? (
              <View
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
                style={styles.optionError}
              >
                <View style={styles.optionErrorCopy}>
                  <MaterialCommunityIcons
                    name="wifi-alert"
                    size={20}
                    color={BrandColors.warning}
                  />
                  <Text style={styles.optionErrorText}>{loadError}</Text>
                </View>
                <CommerceButton
                  compact
                  disabled={isLoadingOptions}
                  label={isLoadingOptions ? "Cargando…" : "Reintentar"}
                  loading={isLoadingOptions}
                  onPress={() => void loadOptions()}
                  style={styles.optionErrorButton}
                  tone="ghost"
                />
              </View>
            ) : null}
            {zone ? (
              <View style={styles.zoneSummary}>
                <View style={styles.zoneSummaryRow}>
                  <MaterialCommunityIcons
                    name="moped-outline"
                    size={20}
                    color={BrandColors.greenDark}
                  />
                  <Text style={styles.zoneSummaryName}>{zone.name}</Text>
                  <Text style={styles.zoneSummaryFee}>
                    S/ {(zone.feeCents / 100).toFixed(2)}
                  </Text>
                </View>
                <Text style={styles.zoneSummaryMeta}>
                  Llega en {zone.etaMinMinutes}–{zone.etaMaxMinutes} min ·
                  mínimo {formatSoles(zone.minimumOrderCents)}
                </Text>
              </View>
            ) : null}
            {zoneFeedback ? (
              <View
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
                style={styles.zoneFeedback}
              >
                <MaterialCommunityIcons
                  name="map-marker-alert-outline"
                  size={20}
                  color={BrandColors.warning}
                />
                <Text style={styles.zoneFeedbackText}>{zoneFeedback}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.pickup}>
            <View style={styles.pickupIcon}>
              <MaterialCommunityIcons
                name="storefront-outline"
                size={23}
                color={BrandColors.greenDark}
              />
            </View>
            <View style={styles.pickupCopy}>
              <Text style={styles.pickupTitle}>
                Mercado Cogana · Santa Anita
              </Text>
              <Text style={styles.pickupText}>
                Te avisaremos cuando esté listo. Presenta el número de pedido al
                recogerlo.
              </Text>
            </View>
          </View>
        )}
      </Section>

      <Section icon="wallet-outline" title="Elige cómo pagar">
        <View style={styles.paymentGrid}>
          {(
            [
              ["cash", "cash", "Efectivo"],
              ["yape", "cellphone", "Yape"],
              ["plin", "cellphone-check", "Plin"],
              ["card", "credit-card-outline", "Tarjeta al recibir"],
            ] as const
          ).map(([method, icon, paymentLabel]) => (
            <Choice
              active={paymentMethod === method}
              icon={icon}
              key={method}
              label={paymentLabel}
              onPress={() => setPaymentMethod(method)}
              style={styles.choiceGridItem}
            />
          ))}
        </View>

        {["yape", "plin"].includes(paymentMethod) ? (
          <Field
            keyboardType="number-pad"
            label="Código o referencia de operación"
            value={reference}
            onChangeText={setReference}
          />
        ) : null}
        {["yape", "plin"].includes(paymentMethod) ? (
          <View style={styles.paymentNotice}>
            <MaterialCommunityIcons
              name="shield-check-outline"
              size={19}
              color={BrandColors.greenDark}
            />
            <Text style={styles.paymentNoticeText}>
              Validaremos la referencia antes de preparar el pedido.
            </Text>
          </View>
        ) : null}
        <Field
          label="Notas para el pedido"
          multiline
          value={notes}
          onChangeText={setNotes}
        />
      </Section>

      <View style={styles.summary}>
        <View style={styles.summaryHeader}>
          <View>
            <Text style={styles.summaryEyebrow}>RESUMEN</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.summaryTitle}>
            {items.length} productos
          </Text>
          </View>
          <MaterialCommunityIcons
            name="receipt-text-outline"
            size={25}
            color={BrandColors.green}
          />
        </View>
        <Line label="Productos" cents={subtotalCents} />
        <Line
          label={fulfillment === "delivery" ? "Delivery" : "Recojo en tienda"}
          cents={fulfillment === "delivery" ? (zone?.feeCents ?? 0) : 0}
        />
        <View style={styles.divider} />
        <Line label="Total estimado" cents={total} strong />
      </View>

      {!checkoutPending && validation ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.validation}
        >
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={20}
            color={BrandColors.warning}
          />
          <Text style={styles.error}>{validation}</Text>
        </View>
      ) : !checkoutPending ? (
        <View style={styles.ready}>
          <MaterialCommunityIcons
            name="check-circle-outline"
            size={20}
            color={BrandColors.success}
          />
          <Text style={styles.readyText}>
            Todo listo para confirmar tu pedido.
          </Text>
        </View>
      ) : null}

      <View style={styles.trust}>
        <TrustItem icon="shield-lock-outline">Datos protegidos</TrustItem>
        <TrustItem icon="bell-check-outline">
          Te avisaremos cada avance
        </TrustItem>
      </View>

      <ModalSurface
        animationType="slide"
        onClose={() => setIsDistrictPickerOpen(false)}
        placement="bottom"
        visible={isDistrictPickerOpen}
      >
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle}>Selecciona tu distrito</Text>
          <Pressable
            accessibilityLabel="Cerrar selector de distrito"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setIsDistrictPickerOpen(false)}
            style={styles.pickerClose}
          >
            <MaterialCommunityIcons
              name="close"
              size={22}
              color={BrandColors.muted}
            />
          </Pressable>
        </View>
        <TextInput
          accessibilityLabel="Buscar distrito"
          autoCapitalize="words"
          onChangeText={setDistrictQuery}
          placeholder="Buscar distrito…"
          style={styles.pickerSearch}
          value={districtQuery}
        />
        <FlatList
          data={districtOptions}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item}
          renderItem={({ item }) => {
            const selected = item === district;
            const covered = coveredDistricts.has(normalizeDistrict(item));
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => selectDistrict(item)}
                style={({ pressed }) => [
                  styles.districtRow,
                  pressed && styles.pressed,
                ]}
              >
                <MaterialCommunityIcons
                  name="map-marker-outline"
                  size={18}
                  color={selected ? BrandColors.greenDark : BrandColors.muted}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.districtText,
                    selected && styles.districtTextActive,
                  ]}
                >
                  {item}
                </Text>
                {covered ? (
                  <View style={styles.coveredPill}>
                    <Text style={styles.coveredPillText}>Delivery</Text>
                  </View>
                ) : null}
                {selected ? (
                  <MaterialCommunityIcons
                    name="check"
                    size={18}
                    color={BrandColors.greenDark}
                  />
                ) : null}
              </Pressable>
            );
          }}
          style={styles.districtList}
        />
      </ModalSurface>
    </OnlineScreen>
  );
}

function Section({
  icon,
  title,
  children,
}: React.PropsWithChildren<{
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
}>) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionTitleRow}>
        <View style={styles.sectionIcon}>
          <MaterialCommunityIcons
            name={icon}
            size={20}
            color={BrandColors.greenDark}
          />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}
function Choice({
  active,
  description,
  icon,
  label,
  onPress,
  style,
}: {
  active: boolean;
  description?: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        style,
        active && styles.choiceActive,
        pressed && styles.pressed,
      ]}
    >
      {icon ? (
        <MaterialCommunityIcons
          name={icon}
          size={21}
          color={active ? BrandColors.greenDark : BrandColors.muted}
        />
      ) : null}
      <View style={styles.choiceCopy}>
        <Text style={[styles.choiceText, active && styles.choiceTextActive]}>
          {label}
        </Text>
        {description ? (
          <Text style={styles.choiceDescription}>{description}</Text>
        ) : null}
      </View>
      <View style={[styles.radio, active && styles.radioActive]}>
        {active ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}
function Field({
  label,
  multiline = false,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        maxFontSizeMultiplier={1.5}
        multiline={multiline}
        {...props}
        placeholderTextColor={BrandColors.muted}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          props.editable === false && styles.inputDisabled,
        ]}
      />
    </View>
  );
}
function Line({
  label,
  cents,
  strong,
}: {
  label: string;
  cents: number;
  strong?: boolean;
}) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.strong]}>
        S/ {(cents / 100).toFixed(2)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  progress: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    paddingHorizontal: Spacing.sm,
  },
  progressDone: {
    width: 26,
    height: 26,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  progressActive: {
    width: 26,
    height: 26,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenDark,
    alignItems: "center",
    justifyContent: "center",
  },
  progressStep: {
    width: 26,
    height: 26,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  progressLineActive: {
    width: 18,
    height: 2,
    backgroundColor: BrandColors.success,
  },
  progressLine: {
    width: 18,
    height: 1,
    backgroundColor: BrandColors.lineStrong,
  },
  progressActiveText: {
    color: BrandColors.white,
    ...Typography.overline,
    letterSpacing: 0,
  },
  progressText: {
    color: BrandColors.muted,
    ...Typography.caption,
    fontWeight: "700",
  },
  progressLabel: {
    color: BrandColors.greenDark,
    ...Typography.label,
    marginLeft: Spacing.sm,
  },
  section: {
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  sectionIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: { flex: 1, color: BrandColors.text, ...Typography.h3 },
  row: { flexDirection: "row", gap: Spacing.xs },
  choice: {
    flex: 1,
    minHeight: 64,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.surfaceMuted,
    borderWidth: 1,
    borderColor: BrandColors.line,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  choiceActive: {
    backgroundColor: BrandColors.greenLight,
    borderColor: BrandColors.green,
  },
  choiceCopy: { flex: 1 },
  choiceText: { color: BrandColors.text, ...Typography.label },
  choiceTextActive: { color: BrandColors.greenDark },
  choiceDescription: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: Radius.round,
    borderWidth: 1.5,
    borderColor: BrandColors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioActive: { borderColor: BrandColors.green },
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: Radius.round,
    backgroundColor: BrandColors.green,
  },
  savedAddresses: { gap: Spacing.xs },
  savedAddress: {
    minHeight: 58,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.surfaceMuted,
    paddingHorizontal: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  savedAddressActive: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  savedAddressCopy: { flex: 1 },
  savedAddressLabel: { color: BrandColors.text, ...Typography.label },
  savedAddressText: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  optionError: {
    borderRadius: Radius.md,
    backgroundColor: BrandColors.goldLight,
    padding: Spacing.sm,
    gap: Spacing.sm,
  },
  optionErrorCopy: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
  },
  optionErrorText: {
    flex: 1,
    color: BrandColors.warning,
    ...Typography.caption,
  },
  optionErrorButton: { alignSelf: "stretch" },
  zoneFeedback: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.goldLight,
    padding: Spacing.sm,
  },
  zoneFeedbackText: {
    flex: 1,
    color: BrandColors.warning,
    ...Typography.caption,
  },
  pickerButton: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.lineStrong,
    backgroundColor: BrandColors.white,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  pickerText: {
    flex: 1,
    color: BrandColors.text,
    ...Typography.body,
  },
  pickerPlaceholder: { color: BrandColors.muted },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickerTitle: { color: BrandColors.text, ...Typography.h3 },
  pickerClose: {
    width: ControlSize.compact,
    height: ControlSize.compact,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerSearch: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 13,
    includeFontPadding: false,
    textAlignVertical: "center",
    ...Typography.body,
  },
  districtList: { maxHeight: 380 },
  districtRow: {
    minHeight: ControlSize.default,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.xxs,
  },
  districtText: {
    flex: 1,
    color: BrandColors.text,
    ...Typography.body,
  },
  districtTextActive: { color: BrandColors.greenDark, fontWeight: "700" },
  coveredPill: {
    borderRadius: Radius.round,
    backgroundColor: BrandColors.greenLight,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
  },
  coveredPillText: { color: BrandColors.greenDark, ...Typography.overline, letterSpacing: 0 },
  zoneSummary: {
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    padding: Spacing.sm,
    gap: Spacing.xxs,
  },
  zoneSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  zoneSummaryName: {
    flex: 1,
    color: BrandColors.greenDark,
    ...Typography.label,
  },
  zoneSummaryFee: { color: BrandColors.greenDark, ...Typography.label },
  zoneSummaryMeta: {
    color: BrandColors.greenDark,
    ...Typography.caption,
  },
  fieldGrid: { gap: Spacing.sm },
  field: { gap: Spacing.xs },
  label: { color: BrandColors.text, ...Typography.label },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.lineStrong,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 13,
    includeFontPadding: false,
    textAlignVertical: "center",
    ...Typography.body,
  },
  inputMultiline: {
    minHeight: 84,
    paddingVertical: Spacing.sm,
    textAlignVertical: "top",
  },
  inputDisabled: {
    backgroundColor: BrandColors.surfaceMuted,
    color: BrandColors.muted,
  },
  pickup: {
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    padding: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  pickupIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  pickupCopy: { flex: 1 },
  pickupTitle: { color: BrandColors.greenDark, ...Typography.label },
  pickupText: {
    color: BrandColors.greenDark,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  paymentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    rowGap: Spacing.xs,
  },
  choiceGridItem: { flexBasis: "47%", flexGrow: 0 },
  paymentNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    padding: Spacing.sm,
  },
  paymentNoticeText: {
    flex: 1,
    color: BrandColors.greenDark,
    ...Typography.caption,
  },
  summary: {
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.greenDark,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xxs,
  },
  summaryEyebrow: { color: BrandColors.gold, ...Typography.overline },
  summaryTitle: {
    color: BrandColors.white,
    ...Typography.h3,
    marginTop: Spacing.xxs,
  },
  line: { flexDirection: "row", justifyContent: "space-between" },
  lineLabel: { color: BrandColors.greenMid, ...Typography.body },
  lineValue: { color: BrandColors.white, ...Typography.label },
  strong: { color: BrandColors.white, ...Typography.h3, fontWeight: "800" },
  divider: { height: 1, backgroundColor: BrandColors.green },
  validation: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.goldLight,
    padding: Spacing.sm,
  },
  error: { flex: 1, color: BrandColors.warning, ...Typography.caption },
  ready: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    padding: Spacing.sm,
  },
  readyText: { flex: 1, color: BrandColors.greenDark, ...Typography.caption },
  trust: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: Spacing.lg,
    rowGap: Spacing.xs,
    paddingHorizontal: Spacing.xxs,
  },
  footer: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  footerLabel: { color: BrandColors.muted, ...Typography.caption },
  footerTotal: { color: BrandColors.text, ...Typography.h2 },
  footerButton: { flex: 1 },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
