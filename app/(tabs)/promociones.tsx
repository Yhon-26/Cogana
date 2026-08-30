import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
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
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import {
  listStorePromotions,
  saveStorePromotion,
  type StorePromotion,
} from "@/online/promotion-admin-api";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";

export default function PromotionsScreen() {
  const [promotions, setPromotions] = useState<StorePromotion[]>([]);
  const [editing, setEditing] = useState<StorePromotion | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setPromotions(await listStorePromotions());
    } catch (caughtError) {
      setLoadError(
        getOperatorErrorMessage(
          caughtError,
          "No se pudieron consultar las promociones. Intenta nuevamente.",
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));
  const reset = () => {
    setEditing(null);
    setTitle("");
    setDescription("");
    setCouponCode("");
    setStartsAt("");
    setEndsAt("");
  };
  const edit = (promotion: StorePromotion) => {
    setEditing(promotion);
    setTitle(promotion.title);
    setDescription(promotion.description);
    setCouponCode(promotion.couponCode ?? "");
    setStartsAt(promotion.startsAt);
    setEndsAt(promotion.endsAt);
  };
  const save = async (isActive = editing?.isActive ?? true) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await saveStorePromotion({
        id: editing?.id,
        expectedVersion: editing?.version,
        title,
        description,
        couponCode: couponCode.trim() || null,
        startsAt,
        endsAt,
        isActive,
      });
      reset();
      await load();
    } catch (error) {
      Alert.alert(
        "No se pudo guardar",
        getOperatorErrorMessage(
          error,
          "Revisa la vigencia e intenta nuevamente.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };
  const toggle = async (promotion: StorePromotion) => {
    if (updatingId) return;
    setUpdatingId(promotion.id);
    try {
      await saveStorePromotion({
        ...promotion,
        expectedVersion: promotion.version,
        isActive: !promotion.isActive,
      });
      await load();
    } catch (error) {
      Alert.alert(
        "No se pudo actualizar",
        getOperatorErrorMessage(error, "Intenta nuevamente."),
      );
    } finally {
      setUpdatingId(null);
    }
  };
  return (
    <AdminScreen
      title="Promociones"
      subtitle="Vigencias, cupones y publicación online"
    >
      <OperatorSelector />
      <SectionTitle>
        {editing ? "Editar promoción" : "Nueva promoción"}
      </SectionTitle>
      <View style={[sharedStyles.card, styles.card]}>
        <Field placeholder="Título" value={title} onChangeText={setTitle} />
        <Field
          placeholder="Descripción y condiciones"
          value={description}
          onChangeText={setDescription}
        />
        <Field
          autoCapitalize="characters"
          placeholder="Cupón opcional"
          value={couponCode}
          onChangeText={setCouponCode}
        />
        <Field
          placeholder="Inicio ISO"
          value={startsAt}
          onChangeText={setStartsAt}
        />
        <Field placeholder="Fin ISO" value={endsAt} onChangeText={setEndsAt} />
        <View style={styles.actions}>
          {editing ? (
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={reset}
              style={[styles.secondary, isSaving && styles.disabled]}
            >
              <Text style={styles.secondaryText}>Cancelar</Text>
            </Pressable>
          ) : null}
          <PrimaryButton
            disabled={
              !title.trim() ||
              !description.trim() ||
              !startsAt ||
              !endsAt ||
              isSaving
            }
            icon="sale-outline"
            label={
              isSaving
                ? "Guardando…"
                : editing
                  ? "Guardar cambios"
                  : "Guardar promoción"
            }
            loading={isSaving}
            onPress={() => void save()}
            style={styles.fill}
          />
        </View>
      </View>
      <SectionTitle
        action={<Pill label={`${promotions.length}`} tone="neutral" />}
      >
        Reglas publicadas
      </SectionTitle>
      {isLoading ? (
        <View style={[sharedStyles.card, styles.stateCard]}>
          <ActivityIndicator
            accessibilityLabel="Cargando promociones"
            color={BrandColors.green}
            size="small"
          />
          <Text accessibilityLiveRegion="polite" style={styles.stateTitle}>
            Cargando promociones…
          </Text>
          <Text style={styles.stateText}>
            Consultando reglas y vigencias publicadas.
          </Text>
        </View>
      ) : (
        <>
          {loadError ? (
            <View style={[sharedStyles.card, styles.stateCard]}>
              <MaterialCommunityIcons
                name="cloud-alert-outline"
                size={32}
                color={BrandColors.danger}
              />
              <Text style={styles.stateTitle}>
                No se pudieron cargar las promociones
              </Text>
              <Text
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                style={styles.stateText}
              >
                {loadError}
              </Text>
              <PrimaryButton
                icon="refresh"
                label="Intentar nuevamente"
                onPress={() => void load()}
                style={styles.stateAction}
              />
            </View>
          ) : null}

          {!loadError && promotions.length === 0 ? (
            <View style={[sharedStyles.card, styles.stateCard]}>
              <View style={styles.emptyIcon}>
                <MaterialCommunityIcons
                  name="sale-outline"
                  size={29}
                  color={BrandColors.greenDark}
                />
              </View>
              <Text accessibilityLiveRegion="polite" style={styles.stateTitle}>
                Aún no hay promociones publicadas
              </Text>
              <Text style={styles.stateText}>
                Completa el formulario superior para crear la primera regla
                comercial.
              </Text>
            </View>
          ) : (
            promotions.map((promotion) => {
              const updating = updatingId === promotion.id;
              return (
                <View
                  key={promotion.id}
                  style={[sharedStyles.card, styles.card]}
                >
                  <View style={styles.row}>
                    <View style={styles.fill}>
                      <Text style={styles.title}>{promotion.title}</Text>
                      <Text style={styles.meta}>{promotion.description}</Text>
                    </View>
                    <Pill
                      label={promotion.isActive ? "Activa" : "Inactiva"}
                      tone={promotion.isActive ? "green" : "neutral"}
                    />
                  </View>
                  <Text style={styles.meta}>
                    {promotion.couponCode
                      ? `Cupón ${promotion.couponCode} · `
                      : ""}
                    {new Date(promotion.startsAt).toLocaleString("es-PE")} →{" "}
                    {new Date(promotion.endsAt).toLocaleString("es-PE")}
                  </Text>
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: updating }}
                      disabled={updating}
                      onPress={() => edit(promotion)}
                      style={[styles.secondary, updating && styles.disabled]}
                    >
                      <Text style={styles.secondaryText}>Editar</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`${promotion.isActive ? "Pausar" : "Activar"} promoción ${promotion.title}`}
                      accessibilityRole="switch"
                      accessibilityState={{
                        busy: updating,
                        checked: promotion.isActive,
                        disabled: updating,
                      }}
                      disabled={updating}
                      onPress={() => void toggle(promotion)}
                      style={[styles.secondary, updating && styles.disabled]}
                    >
                      <Text style={styles.secondaryText}>
                        {updating
                          ? "Actualizando…"
                          : promotion.isActive
                            ? "Pausar"
                            : "Activar"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </>
      )}
    </AdminScreen>
  );
}

function Field(props: ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
      {...props}
      placeholderTextColor={BrandColors.muted}
      style={styles.input}
    />
  );
}
const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  stateCard: { alignItems: "center", gap: Spacing.sm, padding: Spacing.xl },
  stateTitle: {
    color: BrandColors.text,
    ...Typography.h3,
    textAlign: "center",
  },
  stateText: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
  stateAction: { alignSelf: "stretch", marginTop: Spacing.xs },
  emptyIcon: {
    width: ControlSize.large,
    height: ControlSize.large,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    minHeight: ControlSize.default,
    borderRadius: ComponentMetrics.inputRadius,
    borderWidth: 1,
    borderColor: BrandColors.line,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
  },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  fill: { flex: 1 },
  title: { color: BrandColors.text, ...Typography.label },
  meta: { color: BrandColors.muted, ...Typography.caption },
  actions: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  secondary: {
    flex: 1,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  secondaryText: { color: BrandColors.greenDark, ...Typography.label },
  disabled: { opacity: Interaction.disabledOpacity },
});
