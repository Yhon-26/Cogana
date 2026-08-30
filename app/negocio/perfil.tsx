import * as Linking from "expo-linking";
import { useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

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
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  getMyBusinessContext,
  updateMyBusinessAccount,
} from "@/online/business-api";
import type {
  BusinessAccount,
  BusinessDocument,
} from "@/online/business-contracts";

export default function BusinessProfileScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const [account, setAccount] = useState<BusinessAccount | null>(null);
  const [documents, setDocuments] = useState<BusinessDocument[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    legalName: "",
    tradeName: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
  });
  useFocusEffect(
    useCallback(() => {
      void getMyBusinessContext()
        .then((context) => {
          const nextAccount =
            context.accounts.find((candidate) => candidate.id === businessId) ??
            null;
          setAccount(nextAccount);
          if (nextAccount) {
            setForm({
              legalName: nextAccount.legalName,
              tradeName: nextAccount.tradeName ?? "",
              contactName: nextAccount.contactName,
              contactPhone: nextAccount.contactPhone,
              contactEmail: nextAccount.contactEmail ?? "",
            });
          }
          setDocuments(
            context.documents.filter(
              (document) => document.businessAccountId === businessId,
            ),
          );
        })
        .catch((error) =>
          Alert.alert(
            "No se pudo cargar",
            getUserFacingErrorMessage(error, "Intenta nuevamente."),
          ),
        );
    }, [businessId]),
  );
  const available = Math.max(
    0,
    (account?.creditLimitCents ?? 0) - (account?.creditUsedCents ?? 0),
  );
  const save = async () => {
    if (!account) return;
    try {
      await updateMyBusinessAccount({
        businessAccountId: account.id,
        ...form,
      });
      setAccount({
        ...account,
        ...form,
        tradeName: form.tradeName || null,
        contactEmail: form.contactEmail || null,
      });
      setEditing(false);
      Alert.alert(
        "Perfil actualizado",
        "Los datos comerciales fueron guardados.",
      );
    } catch (caughtError) {
      Alert.alert(
        "No se pudo guardar",
        getUserFacingErrorMessage(caughtError, "Revisa los datos."),
      );
    }
  };
  return (
    <OnlineScreen
      title="Perfil de negocio"
      subtitle={account?.legalName}
      cartHref={
        businessId
          ? (`/negocio/carrito?businessId=${businessId}` as Href)
          : null
      }
    >
      {account ? (
        <>
          <View style={styles.card}>
            <View style={styles.titleRow}>
              <Text style={styles.section}>Datos comerciales</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditing((current) => !current)}
                style={styles.linkButton}
              >
                <Text style={styles.link}>
                  {editing ? "Cancelar" : "Editar"}
                </Text>
              </Pressable>
            </View>
            {editing ? (
              <>
                <Editor
                  label="Razón social"
                  value={form.legalName}
                  onChangeText={(value) =>
                    setForm((current) => ({ ...current, legalName: value }))
                  }
                />
                <Editor
                  label="Nombre comercial"
                  value={form.tradeName}
                  onChangeText={(value) =>
                    setForm((current) => ({ ...current, tradeName: value }))
                  }
                />
                <Editor
                  label="Contacto"
                  value={form.contactName}
                  onChangeText={(value) =>
                    setForm((current) => ({ ...current, contactName: value }))
                  }
                />
                <Editor
                  label="Teléfono"
                  value={form.contactPhone}
                  onChangeText={(value) =>
                    setForm((current) => ({ ...current, contactPhone: value }))
                  }
                />
                <Editor
                  label="Correo"
                  value={form.contactEmail}
                  onChangeText={(value) =>
                    setForm((current) => ({ ...current, contactEmail: value }))
                  }
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void save()}
                  style={({ pressed }) => [
                    styles.save,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.saveText}>Guardar perfil</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Field label="Razón social" value={account.legalName} />
                <Field
                  label="Nombre comercial"
                  value={account.tradeName ?? "—"}
                />
                <Field label="RUC" value={account.taxId} />
                <Field
                  label="Contacto"
                  value={`${account.contactName} · ${account.contactPhone}`}
                />
                <Field label="Correo" value={account.contactEmail ?? "—"} />
              </>
            )}
          </View>
          <View style={styles.credit}>
            <Text style={styles.creditTitle}>
              Crédito y condiciones de pago
            </Text>
            <Text style={styles.creditValue}>
              S/ {(available / 100).toFixed(2)} disponible
            </Text>
            <Text style={styles.creditCopy}>
              Línea S/ {(account.creditLimitCents / 100).toFixed(2)} · plazo{" "}
              {account.paymentTermsDays} días
            </Text>
          </View>
          <Text style={styles.section}>Comprobantes y documentos</Text>
          <View style={styles.card}>
            {documents.map((document) => (
              <View key={document.id} style={styles.document}>
                <View style={styles.fill}>
                  <Text style={styles.value}>{document.documentNumber}</Text>
                  <Text style={styles.label}>
                    {document.documentType} · S/{" "}
                    {(document.amountCents / 100).toFixed(2)}
                  </Text>
                </View>
                {document.downloadUrl ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() =>
                      void Linking.openURL(document.downloadUrl as string)
                    }
                    style={styles.linkButton}
                  >
                    <Text style={styles.link}>Abrir</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {!documents.length ? (
              <Text style={styles.label}>Aún no hay documentos emitidos.</Text>
            ) : null}
          </View>
        </>
      ) : null}
    </OnlineScreen>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function Editor({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={BrandColors.muted}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  label: { color: BrandColors.muted, ...Typography.overline },
  value: {
    color: BrandColors.text,
    ...Typography.label,
    marginTop: Spacing.xxs,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    marginTop: Spacing.xxs,
    ...Typography.body,
  },
  save: {
    minHeight: ControlSize.large,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { color: BrandColors.white, ...Typography.label },
  credit: {
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.greenDark,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  creditTitle: { color: BrandColors.gold, ...Typography.label },
  creditValue: { color: BrandColors.white, ...Typography.h2 },
  creditCopy: { color: BrandColors.greenMid, ...Typography.caption },
  section: { color: BrandColors.text, ...Typography.h3 },
  document: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.line,
    paddingVertical: Spacing.xs,
  },
  fill: { flex: 1 },
  linkButton: {
    minWidth: ControlSize.default,
    minHeight: ControlSize.default,
    alignItems: "center",
    justifyContent: "center",
  },
  link: { color: BrandColors.greenDark, ...Typography.label },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
});
