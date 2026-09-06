import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState, type ComponentProps } from "react";
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
  ComponentMetrics,
  ControlSize,
  Elevation,
  Interaction,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useLocalOperator } from "@/context/local-operator-context";
import {
  listStorePromotions,
  saveStorePromotion,
  type StorePromotion,
} from "@/online/promotion-admin-api";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";

export default function PromotionsScreen() {
  const { height } = useWindowDimensions();
  const sheetMaxHeight = Math.round(height * 0.88);
  const { selectedUser } = useLocalOperator();
  const [promotions, setPromotions] = useState<StorePromotion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<StorePromotion | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StorePromotion | null>(null);

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
    setFormVisible(false);
  };

  const startCreate = () => {
    setEditing(null);
    setTitle("");
    setDescription("");
    setCouponCode("");
    setStartsAt("");
    setEndsAt("");
    setFormVisible(true);
  };

  const edit = (promotion: StorePromotion) => {
    setEditing(promotion);
    setTitle(promotion.title);
    setDescription(promotion.description);
    setCouponCode(promotion.couponCode ?? "");
    setStartsAt(promotion.startsAt);
    setEndsAt(promotion.endsAt);
    setDetail(null);
    setFormVisible(true);
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
      setDetail(null);
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
      right={
        <Pressable
          accessibilityLabel="Nueva promoción"
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
              promociones.
            </Text>
          </View>
        </View>
      ) : null}

      <SectionTitle
        action={<Pill label={`${promotions.length}`} tone="neutral" />}
      >
        Reglas publicadas
      </SectionTitle>

      {isLoading ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text style={styles.muted}>Cargando promociones…</Text>
        </View>
      ) : loadError ? (
        <View style={[sharedStyles.card, styles.feedback]}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {loadError}
          </Text>
          <PrimaryButton
            icon="refresh"
            label="Intentar nuevamente"
            onPress={() => void load()}
          />
        </View>
      ) : promotions.length === 0 ? (
        <View style={[sharedStyles.card, styles.empty]}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons
              name="sale-outline"
              size={30}
              color={BrandColors.green}
            />
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
            Aún no hay promociones publicadas
          </Text>
          <Text style={styles.muted}>
            Crea la primera regla comercial con su cupón y vigencia.
          </Text>
          <PrimaryButton
            label="Nueva promoción"
            icon="plus"
            onPress={startCreate}
          />
        </View>
      ) : (
        <View style={styles.list}>
          {promotions.map((promotion) => (
            <Pressable
              accessibilityLabel={`Abrir promoción ${promotion.title}`}
              accessibilityRole="button"
              key={promotion.id}
              onPress={() => setDetail(promotion)}
              style={({ pressed }) => [
                sharedStyles.card,
                styles.row,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.rowCopy}>
                <View style={styles.rowTop}>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={styles.title}
                  >
                    {promotion.title}
                  </Text>
                  <Pill
                    label={promotion.isActive ? "Activa" : "Inactiva"}
                    tone={promotion.isActive ? "green" : "neutral"}
                  />
                </View>
                <Text numberOfLines={1} style={styles.meta}>
                  {promotion.description}
                </Text>
                <Text numberOfLines={1} style={styles.meta}>
                  {promotion.couponCode ? `Cupón ${promotion.couponCode} · ` : ""}
                  {new Date(promotion.startsAt).toLocaleDateString("es-PE")} →{" "}
                  {new Date(promotion.endsAt).toLocaleDateString("es-PE")}
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
                  {detail.title}
                </Text>
                <Text style={styles.sheetMeta}>
                  {detail.couponCode ? `Cupón ${detail.couponCode}` : "Sin cupón"}
                </Text>
              </View>
              <Pill
                label={detail.isActive ? "Activa" : "Inactiva"}
                tone={detail.isActive ? "green" : "neutral"}
              />
              <Pressable
                accessibilityLabel="Cerrar detalle de la promoción"
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
                <Text style={styles.detailDescription}>
                  {detail.description}
                </Text>
                <View style={styles.summaryRow}>
                  <MaterialCommunityIcons
                    name="calendar-outline"
                    size={16}
                    color={BrandColors.muted}
                  />
                  <Text style={styles.summaryText}>
                    {new Date(detail.startsAt).toLocaleString("es-PE")} →{" "}
                    {new Date(detail.endsAt).toLocaleString("es-PE")}
                  </Text>
                </View>
              </View>
            </ScrollView>

            <View style={styles.sheetFooter}>
              <ActionButton
                label="Editar"
                icon="pencil-outline"
                onPress={() => edit(detail)}
                style={styles.footerButton}
                tone="secondary"
              />
              <ActionButton
                label={detail.isActive ? "Pausar" : "Activar"}
                icon={
                  detail.isActive ? "pause-circle-outline" : "play-circle-outline"
                }
                loading={updatingId === detail.id}
                disabled={updatingId !== null}
                onPress={() => void toggle(detail)}
                style={styles.footerButton}
                tone={detail.isActive ? "danger" : "primary"}
              />
            </View>
          </>
        ) : null}
      </ModalSurface>

      <ModalSurface
        animationType="slide"
        dialogStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}
        dismissOnBackdrop={!isSaving}
        onClose={() => {
          if (!isSaving) reset();
        }}
        placement="bottom"
        visible={formVisible}
      >
        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderCopy}>
            <Text maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>
              {editing ? "Editar promoción" : "Nueva promoción"}
            </Text>
            <Text style={styles.sheetMeta}>
              Se publica en la tienda online del cliente.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Cerrar formulario"
            accessibilityRole="button"
            hitSlop={8}
            onPress={reset}
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
          <Field placeholder="Título" value={title} onChangeText={setTitle} />
          <Field
            multiline
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
            accessibilityLabel="Inicio de la promoción en formato ISO"
            placeholder="Inicio ISO"
            value={startsAt}
            onChangeText={setStartsAt}
          />
          <Field
            accessibilityLabel="Fin de la promoción en formato ISO"
            placeholder="Fin ISO"
            value={endsAt}
            onChangeText={setEndsAt}
          />
        </ScrollView>

        <View style={styles.sheetFooter}>
          <ActionButton
            compact
            disabled={isSaving}
            label="Cancelar"
            onPress={reset}
            style={styles.footerButton}
            tone="ghost"
          />
          <ActionButton
            compact
            disabled={
              !title.trim() ||
              !description.trim() ||
              !startsAt ||
              !endsAt ||
              isSaving
            }
            label={editing ? "Guardar cambios" : "Guardar promoción"}
            loading={isSaving}
            onPress={() => void save()}
            style={styles.saveFooterButton}
          />
        </View>
      </ModalSurface>
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
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    ...Elevation.ambientCard,
  },
  pressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  rowCopy: { flex: 1 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  title: { flexShrink: 1, color: BrandColors.text, ...Typography.label },
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
  summaryCard: { gap: Spacing.xs },
  detailDescription: { color: BrandColors.text, ...Typography.body },
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
});
