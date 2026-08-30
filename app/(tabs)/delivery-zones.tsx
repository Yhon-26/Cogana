import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  type TextInputProps,
  View,
} from "react-native";

import {
  AdminScreen,
  Pill,
  PrimaryButton,
  SectionTitle,
  sharedStyles,
} from "@/components/admin-ui";
import { OperatorSelector } from "@/components/operator-selector";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
import {
  BrandColors,
  ComponentMetrics,
  ControlSize,
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
  const [query, setQuery] = useState("");
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

  if (isLoading) {
    return (
      <AdminScreen
        title="Zonas de delivery"
        subtitle="Cobertura, tarifas y tiempos de entrega"
      >
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text accessibilityLiveRegion="polite" style={styles.feedbackTitle}>
            Cargando zonas…
          </Text>
        </View>
      </AdminScreen>
    );
  }

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
    >
      <SectionTitle>Usuario de la operación</SectionTitle>
      <OperatorSelector />

      {!canManage ? (
        <View style={[sharedStyles.card, styles.warningCard]}>
          <MaterialCommunityIcons
            name="shield-lock-outline"
            size={Typography.h2.fontSize}
            color={BrandColors.warning}
          />
          <Text style={styles.warningText}>
            Puedes consultar la cobertura. Solo un administrador puede
            modificarla.
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text
            accessibilityLiveRegion="assertive"
            accessibilityRole="alert"
            style={styles.errorText}
          >
            {getOperatorErrorMessage(
              error,
              "No se pudieron cargar las zonas. Intenta nuevamente.",
            )}
          </Text>
          <PrimaryButton label="Reintentar" onPress={() => void refresh()} />
        </View>
      ) : null}

      {formVisible ? (
        <View style={[sharedStyles.card, styles.formCard]}>
          <View style={styles.formHeader}>
            <View style={styles.formHeaderCopy}>
              <Text style={styles.formTitle}>
                {editing ? "Editar zona" : "Nueva zona"}
              </Text>
              <Text style={styles.formSubtitle}>
                La tarifa y el mínimo se guardan en céntimos.
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Cerrar formulario"
              accessibilityRole="button"
              onPress={closeForm}
              style={styles.iconButton}
            >
              <MaterialCommunityIcons
                name="close"
                size={Typography.h2.fontSize}
                color={BrandColors.muted}
              />
            </Pressable>
          </View>
          <View style={styles.twoColumns}>
            <ZoneInput
              label="Nombre *"
              onChangeText={(name) =>
                setForm((current) => ({ ...current, name }))
              }
              placeholder="Ej. Zona Este 1"
              value={form.name}
            />
            <ZoneInput
              label="Distrito *"
              onChangeText={(district) =>
                setForm((current) => ({ ...current, district }))
              }
              placeholder="Ej. Santa Anita"
              value={form.district}
            />
          </View>
          <View style={styles.twoColumns}>
            <ZoneInput
              keyboardType="decimal-pad"
              label="Tarifa (S/) *"
              onChangeText={(fee) =>
                setForm((current) => ({ ...current, fee }))
              }
              placeholder="0.00"
              value={form.fee}
            />
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
          <View style={styles.twoColumns}>
            <ZoneInput
              keyboardType="number-pad"
              label="ETA mínimo (min) *"
              onChangeText={(etaMin) =>
                setForm((current) => ({ ...current, etaMin }))
              }
              placeholder="30"
              value={form.etaMin}
            />
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
          <View style={styles.formActions}>
            <Pressable
              accessibilityRole="button"
              onPress={closeForm}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Cancelar</Text>
            </Pressable>
            <PrimaryButton
              disabled={!formValid || isSaving}
              icon="content-save-outline"
              label={isSaving ? "Guardando…" : "Guardar zona"}
              onPress={() => void save()}
              style={styles.saveButton}
            />
          </View>
        </View>
      ) : canManage ? (
        <PrimaryButton
          icon="map-marker-plus-outline"
          label="Nueva zona"
          onPress={() => {
            setEditing(null);
            setForm(emptyForm);
            setFormVisible(true);
          }}
        />
      ) : null}

      <SectionTitle
        action={
          <Pill
            label={`${zones.filter((zone) => zone.isActive).length} activas`}
          />
        }
      >
        Cobertura
      </SectionTitle>
      <View style={styles.searchWrap}>
        <MaterialCommunityIcons
          name="magnify"
          size={Typography.h2.fontSize}
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
      </View>

      <View style={styles.list}>
        {filteredZones.length === 0 ? (
          <View style={[sharedStyles.card, styles.emptyCard]}>
            <MaterialCommunityIcons
              name="map-marker-radius-outline"
              size={Typography.display.fontSize}
              color={BrandColors.muted}
            />
            <Text style={styles.emptyTitle}>No hay zonas configuradas</Text>
            <Text style={styles.emptyText}>
              Define la cobertura comercial cuando tengas las tarifas acordadas.
            </Text>
          </View>
        ) : (
          filteredZones.map((zone) => (
            <View
              key={zone.id}
              style={[
                sharedStyles.card,
                styles.zoneCard,
                !zone.isActive && styles.zoneInactive,
              ]}
            >
              <View style={styles.zoneHeader}>
                <View style={styles.zoneIcon}>
                  <MaterialCommunityIcons
                    name="map-marker-radius-outline"
                    size={Typography.h2.fontSize}
                    color={BrandColors.greenDark}
                  />
                </View>
                <View style={styles.zoneCopy}>
                  <Text style={styles.zoneName}>{zone.name}</Text>
                  <Text style={styles.zoneMeta}>{zone.district}</Text>
                </View>
                <Pill
                  label={zone.isActive ? "Activa" : "Inactiva"}
                  tone={zone.isActive ? "green" : "neutral"}
                />
              </View>
              <View style={styles.metrics}>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Tarifa</Text>
                  <Text style={styles.metricValue}>
                    {formatMoney(zone.feeCents)}
                  </Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Pedido mínimo</Text>
                  <Text style={styles.metricValue}>
                    {formatMoney(zone.minimumOrderCents)}
                  </Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Entrega</Text>
                  <Text style={styles.metricValue}>
                    {zone.etaMinMinutes}–{zone.etaMaxMinutes} min
                  </Text>
                </View>
              </View>
              <Text style={styles.schedule}>{zone.scheduleText}</Text>
              {zone.restrictions ? (
                <Text style={styles.restrictions}>{zone.restrictions}</Text>
              ) : null}
              {canManage ? (
                <View style={styles.cardActions}>
                  <Pressable
                    accessibilityLabel={`Editar zona ${zone.name}`}
                    accessibilityRole="button"
                    onPress={() => {
                      setEditing(zone);
                      setForm(formFromZone(zone));
                      setFormVisible(true);
                    }}
                    style={styles.cardActionButton}
                  >
                    <MaterialCommunityIcons
                      name="pencil-outline"
                      size={Typography.h3.fontSize}
                      color={BrandColors.greenDark}
                    />
                    <Text style={styles.cardActionText}>Editar</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`${zone.isActive ? "Desactivar" : "Activar"} zona ${zone.name}`}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: zone.isActive }}
                    onPress={() => toggleActive(zone)}
                    style={[
                      styles.cardActionButton,
                      !zone.isActive && styles.activateButton,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={zone.isActive ? "archive-outline" : "restore"}
                      size={Typography.h3.fontSize}
                      color={
                        zone.isActive
                          ? BrandColors.danger
                          : BrandColors.greenDark
                      }
                    />
                    <Text
                      style={[
                        styles.cardActionText,
                        zone.isActive && styles.deactivateText,
                      ]}
                    >
                      {zone.isActive ? "Desactivar" : "Activar"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))
        )}
      </View>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  feedbackCard: { gap: Spacing.sm },
  feedbackTitle: { color: BrandColors.text, ...Typography.label },
  errorText: { color: BrandColors.danger, ...Typography.caption },
  warningCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: BrandColors.goldLight,
  },
  warningText: { flex: 1, color: BrandColors.warning, ...Typography.body },
  formCard: { gap: Spacing.sm },
  formHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  formHeaderCopy: { flex: 1, marginRight: Spacing.sm },
  formTitle: { color: BrandColors.text, ...Typography.h3 },
  formSubtitle: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  iconButton: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  field: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    minWidth: 190,
    gap: Spacing.xs,
  },
  inputLabel: { color: BrandColors.text, ...Typography.label },
  input: {
    minHeight: ControlSize.default,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: ComponentMetrics.inputRadius,
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
  twoColumns: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  formActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.xxs,
  },
  secondaryButton: {
    minHeight: ControlSize.large,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  secondaryButtonText: { color: BrandColors.greenDark, ...Typography.label },
  saveButton: { flex: 1 },
  searchWrap: {
    minHeight: ControlSize.default,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: ComponentMetrics.inputRadius,
    backgroundColor: BrandColors.white,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  searchInput: { flex: 1, color: BrandColors.text, ...Typography.body },
  list: { gap: Spacing.sm },
  emptyCard: { alignItems: "center", paddingVertical: Spacing.xxl },
  emptyTitle: {
    color: BrandColors.text,
    ...Typography.h3,
    marginTop: Spacing.sm,
  },
  emptyText: {
    color: BrandColors.muted,
    ...Typography.body,
    marginTop: Spacing.xxs,
    textAlign: "center",
  },
  zoneCard: { gap: Spacing.sm },
  zoneInactive: { backgroundColor: BrandColors.surfaceMuted },
  zoneHeader: { flexDirection: "row", alignItems: "center" },
  zoneIcon: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  zoneCopy: { flex: 1, marginHorizontal: Spacing.sm },
  zoneName: { color: BrandColors.text, ...Typography.h3 },
  zoneMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  metric: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    minWidth: 140,
    backgroundColor: BrandColors.cream,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  metricLabel: { color: BrandColors.muted, ...Typography.caption },
  metricValue: {
    color: BrandColors.text,
    ...Typography.label,
    marginTop: Spacing.xxs,
  },
  schedule: { color: BrandColors.greenDark, ...Typography.label },
  restrictions: { color: BrandColors.muted, ...Typography.body },
  cardActions: { flexDirection: "row", gap: Spacing.sm },
  cardActionButton: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  activateButton: { backgroundColor: BrandColors.greenLight },
  cardActionText: { color: BrandColors.greenDark, ...Typography.label },
  deactivateText: { color: BrandColors.danger },
});
