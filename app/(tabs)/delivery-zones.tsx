import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextInputProps,
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
import { parseDecimalToInteger } from "@/database/integer-calculations";
import type { DeliveryZoneRecord } from "@/database/models";
import {
  createDeliveryZone,
  updateDeliveryZone,
} from "@/database/repositories/delivery-zone-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { formatSoles as formatMoney } from "@/lib/money";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import { useDeliveryZones } from "@/hooks/use-delivery-zones";

type ZoneForm = {
  name: string;
  district: string;
  fee: string;
  minimumOrder: string;
  etaMin: string;
  etaMax: string;
  scheduleText: string;
  restrictions: string;
};

const emptyForm: ZoneForm = {
  name: "",
  district: "",
  fee: "",
  minimumOrder: "",
  etaMin: "",
  etaMax: "",
  scheduleText: "",
  restrictions: "",
};

function ZoneInput({
  label,
  multiline = false,
  ...props
}: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        {...props}
        multiline={multiline}
        placeholderTextColor={BrandColors.muted}
        style={[styles.input, multiline && styles.multilineInput]}
      />
    </View>
  );
}

function formFromZone(zone: DeliveryZoneRecord): ZoneForm {
  return {
    name: zone.name,
    district: zone.district,
    fee: (zone.feeCents / 100).toFixed(2),
    minimumOrder: (zone.minimumOrderCents / 100).toFixed(2),
    etaMin: String(zone.etaMinMinutes),
    etaMax: String(zone.etaMaxMinutes),
    scheduleText: zone.scheduleText,
    restrictions: zone.restrictions ?? "",
  };
}

export default function DeliveryZonesScreen() {
  const { selectedUser, deviceId } = useLocalOperator();
  const { database, zones, isLoading, error, refresh } = useDeliveryZones();
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.round(height * 0.88);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<DeliveryZoneRecord | null>(null);
  const [form, setForm] = useState<ZoneForm>(emptyForm);
  const [editing, setEditing] = useState<DeliveryZoneRecord | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const canManage = selectedUser?.role === "administrator";
  const filteredZones = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-PE");
    if (!normalized) return zones;
    return zones.filter((zone) =>
      [zone.name, zone.district, zone.scheduleText].some((value) =>
        value.toLocaleLowerCase("es-PE").includes(normalized),
      ),
    );
  }, [query, zones]);

  const closeForm = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormVisible(false);
  };

  const save = async () => {
    if (!selectedUser || !canManage || isSaving) return;
    const feeCents = parseDecimalToInteger(form.fee, 2);
    const minimumOrderCents = parseDecimalToInteger(form.minimumOrder, 2);
    const etaMinMinutes = parseDecimalToInteger(form.etaMin, 0);
    const etaMaxMinutes = parseDecimalToInteger(form.etaMax, 0);
    if (
      feeCents === null ||
      minimumOrderCents === null ||
      etaMinMinutes === null ||
      etaMaxMinutes === null
    ) {
      Alert.alert(
        "Datos inválidos",
        "Revisa la tarifa, el pedido mínimo y los minutos.",
      );
      return;
    }

    setIsSaving(true);
    try {
      const fields = {
        storeId: DEFAULT_STORE_ID,
        name: form.name,
        district: form.district,
        feeCents,
        minimumOrderCents,
        etaMinMinutes,
        etaMaxMinutes,
        scheduleText: form.scheduleText,
        restrictions: form.restrictions,
        actorUserId: selectedUser.id,
        deviceId,
      };
      if (editing) {
        await updateDeliveryZone(database, {
          ...fields,
          zoneId: editing.id,
          expectedVersion: editing.version,
          isActive: editing.isActive,
        });
      } else {
        await createDeliveryZone(database, fields);
      }
      await refresh(false);
      closeForm();
      Alert.alert(
        editing ? "Zona actualizada" : "Zona creada",
        "El cambio quedó registrado y pendiente de confirmación central.",
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

  const toggleActive = (zone: DeliveryZoneRecord) => {
    if (!selectedUser || !canManage) return;
    const nextActive = !zone.isActive;
    Alert.alert(
      nextActive ? "Activar zona" : "Desactivar zona",
      `${zone.name} ${nextActive ? "aceptará pedidos" : "dejará de aceptar pedidos"}.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: nextActive ? "Activar" : "Desactivar",
          style: nextActive ? "default" : "destructive",
          onPress: () => {
            void (async () => {
              try {
                await updateDeliveryZone(database, {
                  storeId: DEFAULT_STORE_ID,
                  zoneId: zone.id,
                  expectedVersion: zone.version,
                  name: zone.name,
                  district: zone.district,
                  feeCents: zone.feeCents,
                  minimumOrderCents: zone.minimumOrderCents,
                  etaMinMinutes: zone.etaMinMinutes,
                  etaMaxMinutes: zone.etaMaxMinutes,
                  scheduleText: zone.scheduleText,
                  restrictions: zone.restrictions,
                  isActive: nextActive,
                  actorUserId: selectedUser.id,
                  deviceId,
                });
                await refresh(false);
                setDetail(null);
              } catch (caughtError) {
                Alert.alert(
                  "No se pudo cambiar el estado",
                  getOperatorErrorMessage(caughtError, "Intenta nuevamente."),
                );
              }
            })();
          },
        },
      ],
    );
  };

  const startEdit = (zone: DeliveryZoneRecord) => {
    setEditing(zone);
    setForm(formFromZone(zone));
    setDetail(null);
    setFormVisible(true);
  };

  const formValid =
    Boolean(
      form.name.trim() && form.district.trim() && form.scheduleText.trim(),
    ) &&
    parseDecimalToInteger(form.fee, 2) !== null &&
    parseDecimalToInteger(form.minimumOrder, 2) !== null &&
    parseDecimalToInteger(form.etaMin, 0) !== null &&
    parseDecimalToInteger(form.etaMax, 0) !== null;

  return (
    <AdminScreen
      title="Zonas de delivery"
      subtitle="Cobertura, tarifa, mínimos, tiempos y horarios"
      right={
        canManage ? (
          <Pressable
            accessibilityLabel="Nueva zona"
            accessibilityRole="button"
            style={styles.addHeader}
            onPress={() => {
              setEditing(null);
              setForm(emptyForm);
              setFormVisible(true);
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
              Activa tu perfil con PIN en la pestaña Más para modificar la
              cobertura.
            </Text>
          </View>
        </View>
      ) : null}

      {selectedUser && !canManage ? (
        <View style={[sharedStyles.card, styles.operatorNotice]}>
          <MaterialCommunityIcons
            name="shield-lock-outline"
            size={22}
            color={BrandColors.warning}
          />
          <View style={styles.operatorNoticeCopy}>
            <Text style={styles.operatorNoticeTitle}>Solo consulta</Text>
            <Text style={styles.operatorNoticeText}>
              Puedes revisar la cobertura. Solo un administrador la modifica.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.searchWrap}>
        <MaterialCommunityIcons
          name="magnify"
          size={21}
          color={BrandColors.muted}
        />
        <TextInput
          accessibilityLabel="Buscar zonas de delivery"
          onChangeText={setQuery}
          placeholder="Buscar por zona, distrito u horario"
          placeholderTextColor={BrandColors.muted}
          style={styles.searchInput}
          value={query}
        />
        {query ? (
          <Pressable
            accessibilityLabel="Limpiar búsqueda"
            accessibilityRole="button"
            onPress={() => setQuery("")}
            style={styles.clearButton}
          >
            <MaterialCommunityIcons
              name="close-circle"
              size={19}
              color={BrandColors.muted}
            />
          </Pressable>
        ) : null}
      </View>

      <SectionTitle
        action={
          <Pill
            label={`${zones.filter((zone) => zone.isActive).length} activas`}
          />
        }
      >
        Cobertura
      </SectionTitle>

      {isLoading ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text style={styles.muted}>Cargando zonas…</Text>
        </View>
      ) : error ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {getOperatorErrorMessage(
              error,
              "No se pudieron cargar las zonas. Intenta nuevamente.",
            )}
          </Text>
          <PrimaryButton label="Reintentar" onPress={() => void refresh()} />
        </View>
      ) : filteredZones.length === 0 ? (
        <View style={[sharedStyles.card, styles.empty]}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons
              name="map-marker-radius-outline"
              size={30}
              color={BrandColors.green}
            />
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
            {zones.length === 0 ? "Aún no hay zonas configuradas" : "Sin resultados"}
          </Text>
          <Text style={styles.muted}>
            {zones.length === 0
              ? "Define la cobertura comercial con su tarifa y horario."
              : "Prueba con otra zona, distrito u horario."}
          </Text>
          {zones.length === 0 && canManage ? (
            <PrimaryButton
              label="Nueva zona"
              icon="map-marker-plus-outline"
              onPress={() => {
                setEditing(null);
                setForm(emptyForm);
                setFormVisible(true);
              }}
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.list}>
          {filteredZones.map((zone) => (
            <Pressable
              accessibilityLabel={`Abrir zona ${zone.name}`}
              accessibilityRole="button"
              key={zone.id}
              onPress={() => setDetail(zone)}
              style={({ pressed }) => [
                sharedStyles.card,
                styles.zoneRow,
                pressed && styles.pressed,
              ]}
            >
              <View
                style={[
                  styles.rowIcon,
                  !zone.isActive && styles.rowIconMuted,
                ]}
              >
                <MaterialCommunityIcons
                  name="map-marker-radius-outline"
                  size={20}
                  color={zone.isActive ? BrandColors.green : BrandColors.muted}
                />
              </View>
              <View style={styles.rowCopy}>
                <View style={styles.rowTop}>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={styles.rowName}
                  >
                    {zone.name}
                  </Text>
                  <Pill
                    label={zone.isActive ? "Activa" : "Inactiva"}
                    tone={zone.isActive ? "green" : "neutral"}
                  />
                </View>
                <Text numberOfLines={1} style={styles.rowMeta}>
                  {zone.district} · {zone.etaMinMinutes}–{zone.etaMaxMinutes} min
                </Text>
              </View>
              <Text
                maxFontSizeMultiplier={1.4}
                adjustsFontSizeToFit
                numberOfLines={1}
                style={styles.rowFee}
              >
                {formatMoney(zone.feeCents)}
              </Text>
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
                  {detail.name}
                </Text>
                <Text style={styles.sheetMeta}>{detail.district}</Text>
              </View>
              <Pill
                label={detail.isActive ? "Activa" : "Inactiva"}
                tone={detail.isActive ? "green" : "neutral"}
              />
              <Pressable
                accessibilityLabel="Cerrar detalle de la zona"
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
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.sheetScroll}
            >
              <View style={styles.metricsRow}>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Tarifa</Text>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    adjustsFontSizeToFit
                    numberOfLines={1}
                    style={styles.metricValue}
                  >
                    {formatMoney(detail.feeCents)}
                  </Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Pedido mínimo</Text>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    adjustsFontSizeToFit
                    numberOfLines={1}
                    style={styles.metricValue}
                  >
                    {formatMoney(detail.minimumOrderCents)}
                  </Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Entrega</Text>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    adjustsFontSizeToFit
                    numberOfLines={1}
                    style={styles.metricValue}
                  >
                    {detail.etaMinMinutes}–{detail.etaMaxMinutes} min
                  </Text>
                </View>
              </View>
              <View style={[sharedStyles.card, styles.summaryCard]}>
                <View style={styles.summaryRow}>
                  <MaterialCommunityIcons
                    name="clock-outline"
                    size={16}
                    color={BrandColors.muted}
                  />
                  <Text style={styles.summaryText}>
                    {detail.scheduleText}
                  </Text>
                </View>
                {detail.restrictions ? (
                  <View style={styles.summaryRow}>
                    <MaterialCommunityIcons
                      name="text-box-outline"
                      size={16}
                      color={BrandColors.muted}
                    />
                    <Text style={styles.summaryText}>
                      {detail.restrictions}
                    </Text>
                  </View>
                ) : null}
              </View>
            </ScrollView>

            {canManage ? (
              <View style={styles.sheetFooter}>
                <ActionButton
                  label="Editar"
                  icon="pencil-outline"
                  onPress={() => startEdit(detail)}
                  style={styles.footerButton}
                  tone="secondary"
                />
                <ActionButton
                  label={detail.isActive ? "Desactivar" : "Activar"}
                  icon={detail.isActive ? "archive-outline" : "restore"}
                  onPress={() => toggleActive(detail)}
                  style={styles.saveFooterButton}
                  tone={detail.isActive ? "danger" : "primary"}
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
          if (!isSaving) closeForm();
        }}
        placement="bottom"
        visible={formVisible}
      >
        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderCopy}>
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
              {editing ? "Editar zona" : "Nueva zona"}
            </Text>
            <Text style={styles.sheetMeta}>
              La tarifa y el mínimo se guardan en céntimos.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Cerrar formulario"
            accessibilityRole="button"
            hitSlop={8}
            onPress={closeForm}
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
          <View style={styles.twoColumns}>
            <View style={styles.half}>
              <ZoneInput
                label="Nombre *"
                onChangeText={(name) =>
                  setForm((current) => ({ ...current, name }))
                }
                placeholder="Ej. Zona Este 1"
                value={form.name}
              />
            </View>
            <View style={styles.half}>
              <ZoneInput
                label="Distrito *"
                onChangeText={(district) =>
                  setForm((current) => ({ ...current, district }))
                }
                placeholder="Ej. Santa Anita"
                value={form.district}
              />
            </View>
          </View>
          <View style={styles.twoColumns}>
            <View style={styles.half}>
              <ZoneInput
                keyboardType="decimal-pad"
                label="Tarifa (S/) *"
                onChangeText={(fee) =>
                  setForm((current) => ({ ...current, fee }))
                }
                placeholder="0.00"
                value={form.fee}
              />
            </View>
            <View style={styles.half}>
              <ZoneInput
                keyboardType="decimal-pad"
                label="Pedido mínimo (S/) *"
                onChangeText={(minimumOrder) =>
                  setForm((current) => ({ ...current, minimumOrder }))
                }
                placeholder="0.00"
                value={form.minimumOrder}
              />
            </View>
          </View>
          <View style={styles.twoColumns}>
            <View style={styles.half}>
              <ZoneInput
                keyboardType="number-pad"
                label="ETA mínimo (min) *"
                onChangeText={(etaMin) =>
                  setForm((current) => ({ ...current, etaMin }))
                }
                placeholder="30"
                value={form.etaMin}
              />
            </View>
            <View style={styles.half}>
              <ZoneInput
                keyboardType="number-pad"
                label="ETA máximo (min) *"
                onChangeText={(etaMax) =>
                  setForm((current) => ({ ...current, etaMax }))
                }
                placeholder="60"
                value={form.etaMax}
              />
            </View>
          </View>
          <ZoneInput
            label="Horario *"
            onChangeText={(scheduleText) =>
              setForm((current) => ({ ...current, scheduleText }))
            }
            placeholder="Ej. Lun–Sáb 09:00–18:00"
            value={form.scheduleText}
          />
          <ZoneInput
            label="Restricciones"
            multiline
            onChangeText={(restrictions) =>
              setForm((current) => ({ ...current, restrictions }))
            }
            placeholder="Calles no cubiertas, peso máximo u observaciones"
            value={form.restrictions}
          />
        </ScrollView>

        <View style={styles.sheetFooter}>
          <ActionButton
            compact
            disabled={isSaving}
            label="Cancelar"
            onPress={closeForm}
            style={styles.footerButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={!formValid || isSaving}
            label="Guardar zona"
            loading={isSaving}
            onPress={() => void save()}
            style={styles.saveFooterButton}
          />
        </View>
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
  clearButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
  },
  feedback: { gap: Spacing.sm },
  errorText: { color: BrandColors.danger, ...Typography.caption },
  muted: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
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
  zoneRow: {
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
  rowIconMuted: { backgroundColor: BrandColors.surfaceMuted },
  rowCopy: { flex: 1 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  rowName: { flexShrink: 1, color: BrandColors.text, ...Typography.label },
  rowMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  rowFee: { color: BrandColors.text, ...Typography.h3, flexShrink: 1 },
  field: { gap: Spacing.xxs },
  inputLabel: { color: BrandColors.text, ...Typography.label },
  input: {
    minHeight: ControlSize.default,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
  },
  multilineInput: {
    minHeight: ControlSize.default + Spacing.xxl,
    paddingTop: Spacing.sm,
    textAlignVertical: "top",
  },
  twoColumns: { flexDirection: "row", gap: Spacing.sm },
  half: { flex: 1 },
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
  metricsRow: { flexDirection: "row", gap: Spacing.xs },
  metric: {
    flex: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    padding: Spacing.sm,
    ...Elevation.ambientCard,
  },
  metricLabel: {
    color: BrandColors.muted,
    ...Typography.caption,
  },
  metricValue: { color: BrandColors.text, ...Typography.label },
  summaryCard: { gap: Spacing.xs },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  summaryText: {
    flex: 1,
    color: BrandColors.muted,
    ...Typography.caption,
  },
  sheetFooter: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  footerButton: { flex: 1 },
  saveFooterButton: { flex: 1.6 },
});
