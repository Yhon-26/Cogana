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
  ComponentMetrics,
  ControlSize,
  Elevation,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useLocalOperator } from "@/context/local-operator-context";
import type { SupplierRecord } from "@/database/models";
import {
  createSupplier,
  setSupplierActive,
  updateSupplier,
} from "@/database/repositories/supplier-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import { useLocalSuppliers } from "@/hooks/use-local-suppliers";

type SupplierForm = {
  name: string;
  taxId: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
};

const emptyForm: SupplierForm = {
  name: "",
  taxId: "",
  contactName: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
};

function SupplierInput({
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

function formFromSupplier(supplier: SupplierRecord): SupplierForm {
  return {
    name: supplier.name,
    taxId: supplier.taxId ?? "",
    contactName: supplier.contactName ?? "",
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    address: supplier.address ?? "",
    notes: supplier.notes ?? "",
  };
}

export default function SuppliersScreen() {
  const { selectedUser, deviceId } = useLocalOperator();
  const { database, suppliers, isLoading, error, refresh } =
    useLocalSuppliers();
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.round(height * 0.88);
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<SupplierRecord | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptyForm);
  const [editing, setEditing] = useState<SupplierRecord | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const canManage = selectedUser?.role === "administrator";
  const filteredSuppliers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-PE");
    if (!normalized) return suppliers;
    return suppliers.filter((supplier) =>
      [supplier.name, supplier.taxId, supplier.contactName, supplier.phone]
        .filter(Boolean)
        .some((value) =>
          value?.toLocaleLowerCase("es-PE").includes(normalized),
        ),
    );
  }, [query, suppliers]);

  const closeForm = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormVisible(false);
  };

  const startCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormVisible(true);
  };

  const startEdit = (supplier: SupplierRecord) => {
    setEditing(supplier);
    setForm(formFromSupplier(supplier));
    setDetail(null);
    setFormVisible(true);
  };

  const save = async () => {
    if (!selectedUser || !canManage || isSaving) return;
    setIsSaving(true);
    try {
      const fields = {
        ...form,
        storeId: DEFAULT_STORE_ID,
        actorUserId: selectedUser.id,
        deviceId,
      };
      if (editing) {
        await updateSupplier(database, {
          ...fields,
          supplierId: editing.id,
          expectedVersion: editing.version,
        });
      } else {
        await createSupplier(database, fields);
      }
      await refresh(false);
      closeForm();
      Alert.alert(
        editing ? "Proveedor actualizado" : "Proveedor creado",
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

  const toggleActive = (supplier: SupplierRecord) => {
    if (!selectedUser || !canManage) return;
    const nextActive = !supplier.isActive;
    Alert.alert(
      nextActive ? "Activar proveedor" : "Desactivar proveedor",
      `${supplier.name} ${nextActive ? "volverá a estar disponible" : "dejará de aparecer como disponible"}.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: nextActive ? "Activar" : "Desactivar",
          style: nextActive ? "default" : "destructive",
          onPress: () => {
            void (async () => {
              try {
                await setSupplierActive(database, {
                  storeId: DEFAULT_STORE_ID,
                  supplierId: supplier.id,
                  expectedVersion: supplier.version,
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

  const activeCount = suppliers.filter((supplier) => supplier.isActive).length;

  return (
    <AdminScreen
      title="Proveedores"
      subtitle="Datos fiscales, contacto y disponibilidad"
      right={
        canManage ? (
          <Pressable
            accessibilityLabel="Nuevo proveedor"
            accessibilityRole="button"
            style={styles.addHeader}
            onPress={startCreate}
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
              Activa tu perfil con PIN en la pestaña Más para gestionar
              proveedores.
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
              Puedes revisar el directorio. Solo un administrador crea o
              modifica proveedores.
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
          accessibilityLabel="Buscar proveedores"
          onChangeText={setQuery}
          placeholder="Buscar por nombre, RUC o contacto"
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

      <SectionTitle action={<Pill label={`${activeCount} activos`} />}>
        Directorio
      </SectionTitle>

      {isLoading ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text style={styles.muted}>Cargando proveedores…</Text>
        </View>
      ) : error ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {getOperatorErrorMessage(
              error,
              "No se pudieron cargar los proveedores. Intenta nuevamente.",
            )}
          </Text>
          <PrimaryButton label="Reintentar" onPress={() => void refresh()} />
        </View>
      ) : filteredSuppliers.length === 0 ? (
        <View style={[sharedStyles.card, styles.empty]}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons
              name="truck-outline"
              size={30}
              color={BrandColors.green}
            />
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
            {suppliers.length === 0
              ? "Aún no hay proveedores"
              : "Sin resultados"}
          </Text>
          <Text style={styles.muted}>
            {suppliers.length === 0
              ? "Registra tu distribuidora con sus datos de contacto y RUC."
              : "Prueba con otro nombre, RUC o contacto."}
          </Text>
          {suppliers.length === 0 && canManage ? (
            <PrimaryButton
              label="Nuevo proveedor"
              icon="truck-plus-outline"
              onPress={startCreate}
            />
          ) : null}
          {suppliers.length > 0 ? (
            <PrimaryButton
              label="Limpiar búsqueda"
              icon="magnify"
              onPress={() => setQuery("")}
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.list}>
          {filteredSuppliers.map((supplier) => (
            <Pressable
              accessibilityLabel={`Abrir proveedor ${supplier.name}`}
              accessibilityRole="button"
              key={supplier.id}
              onPress={() => setDetail(supplier)}
              style={({ pressed }) => [
                sharedStyles.card,
                styles.supplierRow,
                pressed && styles.pressed,
              ]}
            >
              <View
                style={[
                  styles.rowIcon,
                  !supplier.isActive && styles.rowIconMuted,
                ]}
              >
                <MaterialCommunityIcons
                  name="truck-delivery-outline"
                  size={20}
                  color={supplier.isActive ? BrandColors.green : BrandColors.muted}
                />
              </View>
              <View style={styles.rowCopy}>
                <Text
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  style={styles.rowName}
                >
                  {supplier.name}
                </Text>
                <Text numberOfLines={1} style={styles.rowMeta}>
                  {supplier.contactName
                    ? supplier.contactName
                    : supplier.taxId
                      ? `RUC ${supplier.taxId}`
                      : "Sin contacto registrado"}
                </Text>
              </View>
              <Pill
                label={supplier.isActive ? "Activo" : "Inactivo"}
                tone={supplier.isActive ? "green" : "neutral"}
              />
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
                <Text
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={2}
                  style={styles.sheetTitle}
                >
                  {detail.name}
                </Text>
                <Text style={styles.sheetMeta}>
                  {detail.taxId ? `RUC ${detail.taxId}` : "Sin RUC registrado"}
                </Text>
              </View>
              <Pill
                label={detail.isActive ? "Activo" : "Inactivo"}
                tone={detail.isActive ? "green" : "neutral"}
              />
              <Pressable
                accessibilityLabel="Cerrar detalle del proveedor"
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
              <View style={[sharedStyles.card, styles.summaryCard]}>
                {detail.contactName ? (
                  <View style={styles.summaryRow}>
                    <MaterialCommunityIcons
                      name="account-outline"
                      size={16}
                      color={BrandColors.muted}
                    />
                    <Text style={styles.summaryText}>
                      {detail.contactName}
                    </Text>
                  </View>
                ) : null}
                {detail.phone ? (
                  <View style={styles.summaryRow}>
                    <MaterialCommunityIcons
                      name="phone-outline"
                      size={16}
                      color={BrandColors.muted}
                    />
                    <Text style={styles.summaryText}>{detail.phone}</Text>
                  </View>
                ) : null}
                {detail.email ? (
                  <View style={styles.summaryRow}>
                    <MaterialCommunityIcons
                      name="email-outline"
                      size={16}
                      color={BrandColors.muted}
                    />
                    <Text style={styles.summaryText}>{detail.email}</Text>
                  </View>
                ) : null}
                {detail.address ? (
                  <View style={styles.summaryRow}>
                    <MaterialCommunityIcons
                      name="map-marker-outline"
                      size={16}
                      color={BrandColors.muted}
                    />
                    <Text style={styles.summaryText}>{detail.address}</Text>
                  </View>
                ) : null}
                {detail.notes ? (
                  <View style={styles.summaryRow}>
                    <MaterialCommunityIcons
                      name="text-box-outline"
                      size={16}
                      color={BrandColors.muted}
                    />
                    <Text style={styles.summaryText}>{detail.notes}</Text>
                  </View>
                ) : null}
                {!detail.contactName &&
                !detail.phone &&
                !detail.email &&
                !detail.address &&
                !detail.notes ? (
                  <Text style={styles.summaryText}>
                    Este proveedor aún no tiene datos de contacto. Agrégalos
                    editando la ficha.
                  </Text>
                ) : null}
              </View>
            </ScrollView>

            {canManage ? (
              <View style={styles.sheetFooter}>
                <ActionButton
                  label="Editar ficha"
                  icon="pencil-outline"
                  onPress={() => startEdit(detail)}
                  style={styles.footerButton}
                  tone="secondary"
                />
                <ActionButton
                  label={detail.isActive ? "Desactivar" : "Activar"}
                  icon={detail.isActive ? "archive-outline" : "restore"}
                  onPress={() => toggleActive(detail)}
                  style={styles.footerButton}
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
              {editing ? "Editar proveedor" : "Nuevo proveedor"}
            </Text>
            <Text style={styles.sheetMeta}>
              El RUC es opcional, pero debe tener 11 dígitos.
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
          <SupplierInput
            label="Razón social o nombre *"
            onChangeText={(name) => setForm((current) => ({ ...current, name }))}
            placeholder="Ej. Distribuidora Santa Anita"
            value={form.name}
          />
          <View style={styles.twoColumns}>
            <View style={styles.half}>
              <SupplierInput
                keyboardType="number-pad"
                label="RUC"
                maxLength={11}
                onChangeText={(taxId) =>
                  setForm((current) => ({ ...current, taxId }))
                }
                placeholder="20123456789"
                value={form.taxId}
              />
            </View>
            <View style={styles.half}>
              <SupplierInput
                keyboardType="phone-pad"
                label="Teléfono"
                onChangeText={(phone) =>
                  setForm((current) => ({ ...current, phone }))
                }
                placeholder="999 999 999"
                value={form.phone}
              />
            </View>
          </View>
          <SupplierInput
            label="Persona de contacto"
            onChangeText={(contactName) =>
              setForm((current) => ({ ...current, contactName }))
            }
            placeholder="Nombre del contacto"
            value={form.contactName}
          />
          <SupplierInput
            autoCapitalize="none"
            keyboardType="email-address"
            label="Correo"
            onChangeText={(email) =>
              setForm((current) => ({ ...current, email }))
            }
            placeholder="ventas@proveedor.pe"
            value={form.email}
          />
          <SupplierInput
            label="Dirección"
            onChangeText={(address) =>
              setForm((current) => ({ ...current, address }))
            }
            placeholder="Dirección comercial"
            value={form.address}
          />
          <SupplierInput
            label="Notas"
            multiline
            onChangeText={(notes) =>
              setForm((current) => ({ ...current, notes }))
            }
            placeholder="Condiciones, días de reparto u observaciones"
            value={form.notes}
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
            disabled={!form.name.trim() || isSaving}
            label={isSaving ? "Guardando…" : "Guardar proveedor"}
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
  muted: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
  errorText: { color: BrandColors.danger, ...Typography.caption },
  list: { gap: Spacing.sm },
  supplierRow: {
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
  rowName: { color: BrandColors.text, ...Typography.label },
  rowMeta: {
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
  field: { gap: Spacing.xxs },
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
  twoColumns: { flexDirection: "row", gap: Spacing.sm },
  half: { flex: 1 },
  saveFooterButton: { flex: 1.6 },
});
