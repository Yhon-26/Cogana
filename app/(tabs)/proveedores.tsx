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
  const [query, setQuery] = useState("");
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
        title="Proveedores"
        subtitle="Directorio comercial y condiciones de compra"
      >
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text accessibilityLiveRegion="polite" style={styles.feedbackTitle}>
            Cargando proveedores locales…
          </Text>
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen
      title="Proveedores"
      subtitle="Datos fiscales, contacto y disponibilidad"
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
            Puedes consultar el directorio. Solo un administrador puede crear o
            modificar proveedores.
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
              "No se pudieron cargar los proveedores. Intenta nuevamente.",
            )}
          </Text>
          <PrimaryButton label="Reintentar" onPress={() => void refresh()} />
        </View>
      ) : null}

      {formVisible ? (
        <View style={[sharedStyles.card, styles.formCard]}>
          <View style={styles.formHeader}>
            <View>
              <Text style={styles.formTitle}>
                {editing ? "Editar proveedor" : "Nuevo proveedor"}
              </Text>
              <Text style={styles.formSubtitle}>
                El RUC es opcional, pero debe tener 11 dígitos.
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
          <SupplierInput
            label="Razón social o nombre *"
            onChangeText={(name) =>
              setForm((current) => ({ ...current, name }))
            }
            placeholder="Ej. Distribuidora Santa Anita"
            value={form.name}
          />
          <View style={styles.twoColumns}>
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
          <View style={styles.formActions}>
            <Pressable
              accessibilityRole="button"
              onPress={closeForm}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Cancelar</Text>
            </Pressable>
            <PrimaryButton
              disabled={!form.name.trim() || isSaving}
              icon="content-save-outline"
              label={isSaving ? "Guardando…" : "Guardar proveedor"}
              onPress={() => void save()}
              style={styles.saveButton}
            />
          </View>
        </View>
      ) : canManage ? (
        <PrimaryButton
          icon="truck-plus-outline"
          label="Nuevo proveedor"
          onPress={startCreate}
        />
      ) : null}

      <SectionTitle
        action={
          <Pill
            label={`${suppliers.filter((item) => item.isActive).length} activos`}
          />
        }
      >
        Directorio
      </SectionTitle>
      <View style={styles.searchWrap}>
        <MaterialCommunityIcons
          name="magnify"
          size={Typography.h2.fontSize}
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
      </View>

      <View style={styles.list}>
        {filteredSuppliers.length === 0 ? (
          <View style={[sharedStyles.card, styles.emptyCard]}>
            <MaterialCommunityIcons
              name="truck-outline"
              size={Typography.display.fontSize}
              color={BrandColors.muted}
            />
            <Text style={styles.emptyTitle}>
              No hay proveedores para mostrar
            </Text>
            <Text style={styles.emptyText}>
              Crea el primero o cambia el texto de búsqueda.
            </Text>
          </View>
        ) : (
          filteredSuppliers.map((supplier) => (
            <View
              key={supplier.id}
              style={[
                sharedStyles.card,
                styles.supplierCard,
                !supplier.isActive && styles.supplierInactive,
              ]}
            >
              <View style={styles.supplierHeader}>
                <View style={styles.supplierIcon}>
                  <MaterialCommunityIcons
                    name="truck-delivery-outline"
                    size={Typography.h2.fontSize}
                    color={BrandColors.greenDark}
                  />
                </View>
                <View style={styles.supplierCopy}>
                  <Text style={styles.supplierName}>{supplier.name}</Text>
                  <Text style={styles.supplierMeta}>
                    {supplier.taxId
                      ? `RUC ${supplier.taxId}`
                      : "Sin RUC registrado"}
                  </Text>
                </View>
                <Pill
                  label={supplier.isActive ? "Activo" : "Inactivo"}
                  tone={supplier.isActive ? "green" : "neutral"}
                />
              </View>
              {supplier.contactName || supplier.phone || supplier.email ? (
                <View style={styles.contactBlock}>
                  {supplier.contactName ? (
                    <Text style={styles.contactText}>
                      Contacto: {supplier.contactName}
                    </Text>
                  ) : null}
                  {supplier.phone ? (
                    <Text style={styles.contactText}>
                      Teléfono: {supplier.phone}
                    </Text>
                  ) : null}
                  {supplier.email ? (
                    <Text style={styles.contactText}>
                      Correo: {supplier.email}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {canManage ? (
                <View style={styles.cardActions}>
                  <Pressable
                    accessibilityLabel={`Editar proveedor ${supplier.name}`}
                    accessibilityRole="button"
                    onPress={() => startEdit(supplier)}
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
                    accessibilityLabel={`${supplier.isActive ? "Desactivar" : "Activar"} proveedor ${supplier.name}`}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: supplier.isActive }}
                    onPress={() => toggleActive(supplier)}
                    style={[
                      styles.cardActionButton,
                      !supplier.isActive && styles.activateButton,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={supplier.isActive ? "archive-outline" : "restore"}
                      size={Typography.h3.fontSize}
                      color={
                        supplier.isActive
                          ? BrandColors.danger
                          : BrandColors.greenDark
                      }
                    />
                    <Text
                      style={[
                        styles.cardActionText,
                        supplier.isActive && styles.deactivateText,
                      ]}
                    >
                      {supplier.isActive ? "Desactivar" : "Activar"}
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
  },
  supplierCard: { gap: Spacing.sm },
  supplierInactive: { backgroundColor: BrandColors.surfaceMuted },
  supplierHeader: { flexDirection: "row", alignItems: "center" },
  supplierIcon: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  supplierCopy: { flex: 1, marginHorizontal: Spacing.sm },
  supplierName: { color: BrandColors.text, ...Typography.h3 },
  supplierMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  contactBlock: {
    backgroundColor: BrandColors.cream,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    gap: Spacing.xxs,
  },
  contactText: { color: BrandColors.muted, ...Typography.body },
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
