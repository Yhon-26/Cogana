import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, type Href, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AdminScreen,
  Pill,
  PrimaryButton,
  SectionTitle,
  sharedStyles,
} from "@/components/admin-ui";
import { ModalSurface } from "@/components/modal-surface";
import { OperatorSelector } from "@/components/operator-selector";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
import {
  DEFAULT_SELLER_MODULES,
  operatorModuleFromPath,
} from "@/auth/operator-route-access";
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
import { useSupabaseAuth } from "@/context/supabase-auth-context";
import { parseDecimalToInteger } from "@/database/integer-calculations";
import type {
  CashMovementType,
  PaymentMethod,
  RecentSaleRecord,
} from "@/database/models";
import {
  closeCashSession,
  openCashSession,
  recordCashMovement,
} from "@/database/repositories/cash-repository";
import { voidSale } from "@/database/repositories/sales-corrections-repository";
import {
  listRolePermissions,
  type RolePermission,
} from "@/database/repositories/personnel-operations-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { formatSoles as formatMoney } from "@/lib/money";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";
import { useAdaptiveLayout } from "@/hooks/use-adaptive-layout";
import { useCashSession } from "@/hooks/use-cash-session";
import { useLocalProducts } from "@/hooks/use-local-products";
import { useSync } from "@/hooks/use-sync";

type Route =
  | "/venta"
  | "/inventario"
  | "/pedidos"
  | "/precios"
  | "/proveedores"
  | "/negocios"
  | "/repartos"
  | "/reportes"
  | "/soporte"
  | "/configuracion"
  | "/empleados"
  | "/historial-ventas"
  | "/delivery-zones"
  | "/compras"
  | "/scanner"
  | "/catalogo-admin"
  | "/personal-avanzado"
  | "/promociones";

const actions: {
  title: string;
  description: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  route?: Route;
  accent: "green" | "gold";
}[] = [
  {
    title: "Nueva venta",
    description: "Vende por peso, unidad o monto",
    icon: "cart-plus",
    route: "/venta",
    accent: "green",
  },
  {
    title: "Inventario",
    description: "Revisa stock disponible",
    icon: "warehouse",
    route: "/inventario",
    accent: "gold",
  },
  {
    title: "Pedidos",
    description: "Preparación, peso final y seguimiento",
    icon: "clipboard-list-outline",
    accent: "gold",
    route: "/pedidos",
  },
  {
    title: "Actualizar precios",
    description: "Edita el precio base",
    icon: "tag-outline",
    route: "/precios",
    accent: "green",
  },
  {
    title: "Proveedores",
    description: "Administra datos y contactos",
    icon: "truck-outline",
    route: "/proveedores",
    accent: "gold",
  },
  {
    title: "Negocios",
    description: "Cuentas y cotizaciones mayoristas",
    icon: "storefront-outline",
    route: "/negocios",
    accent: "green",
  },
  {
    title: "Repartos",
    description: "Despacho, ruta y confirmación",
    icon: "moped-outline",
    route: "/repartos",
    accent: "green",
  },
  {
    title: "Reportes",
    description: "Ventas, margen, caja y auditoría",
    icon: "chart-box-outline",
    route: "/reportes",
    accent: "gold",
  },
  {
    title: "Soporte",
    description: "Solicitudes y respuestas",
    icon: "lifebuoy",
    route: "/soporte",
    accent: "gold",
  },
  {
    title: "Configuración",
    description: "Tienda, sucursales y SUNAT",
    icon: "cog-outline",
    route: "/configuracion",
    accent: "gold",
  },
  {
    title: "Empleados",
    description: "Personal, roles y PIN",
    icon: "account-group-outline",
    route: "/empleados",
    accent: "green",
  },
  {
    title: "Historial de ventas",
    description: "Buscar, revisar y anular",
    icon: "receipt-text-clock-outline",
    route: "/historial-ventas",
    accent: "gold",
  },
  {
    title: "Zonas delivery",
    description: "Cobertura, tarifas y horarios",
    icon: "map-marker-radius-outline",
    route: "/delivery-zones",
    accent: "gold",
  },
  {
    title: "Compras y lotes",
    description: "Órdenes, recepción y conteo",
    icon: "cart-arrow-down",
    route: "/compras",
    accent: "green",
  },
  {
    title: "Escanear producto",
    description: "Cámara, lector o SKU",
    icon: "barcode-scan",
    route: "/scanner",
    accent: "gold",
  },
  {
    title: "Catálogo avanzado",
    description: "Categorías, presentaciones e historial",
    icon: "shape-plus-outline",
    route: "/catalogo-admin",
    accent: "green",
  },
  {
    title: "Personal avanzado",
    description: "Permisos, turnos y asistencia",
    icon: "account-clock-outline",
    route: "/personal-avanzado",
    accent: "gold",
  },
  {
    title: "Promociones",
    description: "Cupones, vigencias y publicación",
    icon: "sale-outline",
    route: "/promociones",
    accent: "green",
  },
];

const paymentLabels: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  yape: "Yape",
  plin: "Plin",
  card: "Tarjeta",
};

export default function InternalDashboardScreen() {
  const { isMedium } = useAdaptiveLayout();
  const { selectedUser, deviceId } = useLocalOperator();
  const { state: authState, getAccessToken } = useSupabaseAuth();
  const { products } = useLocalProducts();
  const { database, session, summary, recentSales, isLoading, error, refresh } =
    useCashSession();
  const [openingAmount, setOpeningAmount] = useState("");
  const [movementType, setMovementType] = useState<CashMovementType>("income");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [countedAmount, setCountedAmount] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [voidTarget, setVoidTarget] = useState<RecentSaleRecord | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [isVoiding, setIsVoiding] = useState(false);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  useFocusEffect(
    useCallback(() => {
      void listRolePermissions(database, DEFAULT_STORE_ID)
        .then(setRolePermissions)
        .catch(() => setRolePermissions([]));
    }, [database]),
  );
  const visibleActions = useMemo(() => {
    if (selectedUser?.role === "administrator") return actions;
    return actions.filter((action) => {
      if (!action.route) return false;
      const module = operatorModuleFromPath(action.route);
      const configured = rolePermissions.find(
        (permission) =>
          permission.role === "seller" && permission.module === module,
      );
      return configured?.canView ?? DEFAULT_SELLER_MODULES.has(module);
    });
  }, [rolePermissions, selectedUser?.role]);
  const { isSyncing, lastResult, syncNow } = useSync({
    storeId: DEFAULT_STORE_ID,
    deviceId,
    actorUserId: selectedUser?.id ?? "",
    getAccessToken,
  });

  const lowStock = products.filter(
    (product) => product.stockQuantity <= product.minimumStockQuantity,
  ).length;
  const openingCents = parseDecimalToInteger(openingAmount, 2);
  const movementCents = parseDecimalToInteger(movementAmount, 2);
  const countedCents = parseDecimalToInteger(countedAmount, 2);
  const formattedDate = new Intl.DateTimeFormat("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  const runOperation = async (operation: () => Promise<void>) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await operation();
      await refresh(false);
    } catch (caughtError) {
      Alert.alert(
        "No se pudo completar",
        getOperatorErrorMessage(
          caughtError,
          "No se pudo completar la operación.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpen = () => {
    if (!selectedUser || openingCents === null) return;
    void runOperation(async () => {
      await openCashSession(database, {
        storeId: DEFAULT_STORE_ID,
        deviceId,
        responsibleUserId: selectedUser.id,
        openingCashCents: openingCents,
      });
      setOpeningAmount("");
    });
  };

  const handleMovement = () => {
    if (
      !session ||
      !selectedUser ||
      movementCents === null ||
      movementCents <= 0 ||
      !movementReason.trim()
    )
      return;
    void runOperation(async () => {
      await recordCashMovement(database, {
        storeId: DEFAULT_STORE_ID,
        deviceId,
        cashSessionId: session.id,
        actorUserId: selectedUser.id,
        type: movementType,
        amountCents: movementCents,
        reason: movementReason,
      });
      setMovementAmount("");
      setMovementReason("");
    });
  };

  const handleClose = () => {
    if (!session || !selectedUser || countedCents === null) return;

    Alert.alert(
      "Cerrar caja",
      `Efectivo esperado: ${formatMoney(summary?.expectedCashCents ?? 0)}\nEfectivo contado: ${formatMoney(countedCents)}`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Cerrar caja",
          style: "destructive",
          onPress: () => {
            void runOperation(async () => {
              const closed = await closeCashSession(database, {
                storeId: DEFAULT_STORE_ID,
                deviceId,
                cashSessionId: session.id,
                actorUserId: selectedUser.id,
                countedCashCents: countedCents,
              });
              setCountedAmount("");
              Alert.alert(
                "Caja cerrada",
                `Diferencia: ${formatMoney(closed.differenceCents ?? 0)}`,
              );
            });
          },
        },
      ],
    );
  };

  const handleVoid = () => {
    if (!selectedUser || !voidTarget || !voidReason.trim()) return;
    if (selectedUser.role !== "administrator") {
      Alert.alert("Sin permiso", "Solo el administrador puede anular ventas.");
      return;
    }
    setIsVoiding(true);
    voidSale(database, {
      storeId: DEFAULT_STORE_ID,
      saleId: voidTarget.id,
      actorUserId: selectedUser.id,
      deviceId,
      reason: voidReason.trim(),
    })
      .then(() => {
        setVoidTarget(null);
        setVoidReason("");
        return refresh(false);
      })
      .then(() =>
        Alert.alert(
          "Venta anulada",
          `${voidTarget.receiptNumber} anulada y stock restaurado.`,
        ),
      )
      .catch((caughtError) => {
        Alert.alert(
          "No se pudo anular",
          getOperatorErrorMessage(caughtError, "No se pudo anular la venta."),
        );
      })
      .finally(() => setIsVoiding(false));
  };

  const handleSync = async () => {
    try {
      const result = await syncNow();
      if (result.status === "completed") {
        Alert.alert(
          "Sincronización completada",
          `${result.pushed} enviadas · ${result.pulled} recibidas · ${result.rejected} rechazadas`,
        );
      } else if (result.status === "offline") {
        Alert.alert(
          "Sin conexión",
          result.error ??
            "Cogana necesita internet para mantener inventario y pedidos al día.",
        );
      }
    } catch (caughtError) {
      Alert.alert(
        "No se pudo sincronizar",
        getOperatorErrorMessage(
          caughtError,
          "Revisa la conexión e intenta nuevamente.",
        ),
      );
    }
  };

  return (
    <AdminScreen
      title="Panel administrador"
      subtitle={`${formattedDate.charAt(0).toUpperCase()}${formattedDate.slice(1)} · Santa Anita`}
      right={
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>CG</Text>
        </View>
      }
    >
      <Pressable
        accessibilityLabel="Iniciar una nueva venta"
        accessibilityRole="button"
        onPress={() => router.push("/venta")}
        style={({ pressed }) => [
          styles.sellNow,
          pressed && styles.actionPressed,
        ]}
      >
        <View style={styles.sellNowIcon}>
          <MaterialCommunityIcons
            name="cash-register"
            size={28}
            color={BrandColors.greenDark}
          />
        </View>
        <View style={styles.sellNowCopy}>
          <Text style={styles.sellNowEyebrow}>ACCIÓN PRINCIPAL</Text>
          <Text style={styles.sellNowTitle}>Iniciar una nueva venta</Text>
          <Text style={styles.sellNowText}>
            Busca, escanea y cobra sin perder tiempo.
          </Text>
        </View>
        <View style={styles.sellNowArrow}>
          <MaterialCommunityIcons
            name="arrow-right"
            size={21}
            color={BrandColors.ink}
          />
        </View>
      </Pressable>

      <SectionTitle>Usuario de la operación</SectionTitle>
      <OperatorSelector />
      <View style={[sharedStyles.card, styles.syncCard]}>
        <View style={styles.syncCopy}>
          <Text style={styles.syncTitle}>Sincronización Supabase</Text>
          <Text style={styles.syncDetail}>
            {authState === "authenticated"
              ? lastResult
                ? `${lastResult.pushed} enviadas · ${lastResult.pulled} recibidas`
                : "Sesión individual lista para sincronizar."
              : "Desbloquea y vincula la cuenta individual del operador."}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Sincronizar datos con Supabase"
          accessibilityRole="button"
          accessibilityState={{
            disabled:
              authState !== "authenticated" ||
              !selectedUser ||
              !deviceId ||
              isSyncing,
            busy: isSyncing,
          }}
          disabled={
            authState !== "authenticated" ||
            !selectedUser ||
            !deviceId ||
            isSyncing
          }
          onPress={() => void handleSync()}
          style={[
            styles.syncButton,
            (authState !== "authenticated" ||
              !selectedUser ||
              !deviceId ||
              isSyncing) &&
              styles.syncButtonDisabled,
          ]}
        >
          <MaterialCommunityIcons
            name={isSyncing ? "cloud-sync-outline" : "cloud-upload-outline"}
            size={17}
            color={BrandColors.white}
          />
          <Text style={styles.syncButtonText}>
            {isSyncing ? "Sincronizando…" : "Sincronizar"}
          </Text>
        </Pressable>
      </View>

      <View style={[sharedStyles.card, sharedStyles.shadow, styles.salesCard]}>
        <View>
          <Text style={styles.salesLabel}>VENTAS DEL TURNO</Text>
          <Text style={styles.salesAmount}>
            {formatMoney(summary?.totalSalesCents ?? 0)}
          </Text>
          <Text style={styles.salesCount}>
            {summary?.saleCount ?? 0} ventas persistidas
          </Text>
        </View>
        <View style={styles.trendIcon}>
          <MaterialCommunityIcons
            name="cash-register"
            size={27}
            color={BrandColors.gold}
          />
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View
          style={[
            sharedStyles.card,
            styles.metricCard,
            isMedium && styles.metricCardMedium,
          ]}
        >
          <MaterialCommunityIcons
            name="cash"
            size={21}
            color={BrandColors.green}
          />
          <Text style={styles.metricValue}>
            {formatMoney(summary?.expectedCashCents ?? 0)}
          </Text>
          <Text style={styles.metricLabel}>Efectivo esperado</Text>
        </View>
        <Pressable
          accessibilityLabel={`${lowStock} productos con stock por reponer`}
          accessibilityRole="button"
          style={[
            sharedStyles.card,
            styles.metricCard,
            isMedium && styles.metricCardMedium,
          ]}
          onPress={() => router.push("/inventario")}
        >
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={21}
            color={BrandColors.warning}
          />
          <Text style={styles.metricValue}>{lowStock}</Text>
          <Text style={styles.metricLabel}>Stock por reponer</Text>
        </Pressable>
      </View>

      <SectionTitle
        action={
          <Pill
            label={session ? "Abierta" : "Cerrada"}
            tone={session ? "green" : "neutral"}
          />
        }
      >
        Caja
      </SectionTitle>
      {isLoading ? (
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text style={styles.feedbackTitle}>Cargando caja local…</Text>
        </View>
      ) : error ? (
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {getOperatorErrorMessage(error, "No se pudo cargar el panel.")}
          </Text>
          <PrimaryButton
            label="Intentar nuevamente"
            onPress={() => void refresh()}
          />
        </View>
      ) : !session ? (
        <View style={[sharedStyles.card, styles.formCard]}>
          <Text style={styles.formTitle}>Apertura de caja</Text>
          <Text style={styles.formHint}>
            Registra el fondo inicial del turno.
          </Text>
          <View style={styles.inputWrap}>
            <Text style={styles.inputPrefix}>S/</Text>
            <TextInput
              accessibilityLabel="Fondo inicial de caja"
              keyboardType="decimal-pad"
              onChangeText={setOpeningAmount}
              placeholder="0.00"
              placeholderTextColor={BrandColors.muted}
              style={styles.input}
              value={openingAmount}
            />
          </View>
          <PrimaryButton
            label={isSaving ? "Abriendo…" : "Abrir caja"}
            icon="lock-open-outline"
            onPress={handleOpen}
            disabled={!selectedUser || openingCents === null || isSaving}
          />
        </View>
      ) : (
        <>
          <View style={[sharedStyles.card, styles.sessionCard]}>
            <Text style={styles.formTitle}>Turno en curso</Text>
            <Text style={styles.sessionDetail}>
              Abierta {new Date(session.openedAt).toLocaleString("es-PE")}
            </Text>
            <View style={styles.summaryGrid}>
              <SummaryValue
                isMedium={isMedium}
                label="Fondo inicial"
                value={session.openingCashCents}
              />
              <SummaryValue
                isMedium={isMedium}
                label="Ventas efectivo"
                value={summary?.cashSalesCents ?? 0}
              />
              <SummaryValue
                isMedium={isMedium}
                label="Ingresos"
                value={summary?.manualIncomeCents ?? 0}
              />
              <SummaryValue
                isMedium={isMedium}
                label="Salidas"
                value={summary?.manualOutflowCents ?? 0}
              />
            </View>
          </View>

          <View style={[sharedStyles.card, styles.formCard]}>
            <Text style={styles.formTitle}>Movimiento manual</Text>
            <View style={styles.choiceRow}>
              {(["income", "outflow"] as const).map((type) => (
                <Pressable
                  accessibilityLabel={
                    type === "income"
                      ? "Registrar tipo ingreso"
                      : "Registrar tipo salida"
                  }
                  accessibilityRole="radio"
                  accessibilityState={{ selected: movementType === type }}
                  key={type}
                  onPress={() => setMovementType(type)}
                  style={[
                    styles.choiceButton,
                    movementType === type && styles.choiceButtonSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.choiceText,
                      movementType === type && styles.choiceTextSelected,
                    ]}
                  >
                    {type === "income" ? "Ingreso" : "Salida"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.inputWrap}>
              <Text style={styles.inputPrefix}>S/</Text>
              <TextInput
                accessibilityLabel="Monto del movimiento"
                keyboardType="decimal-pad"
                onChangeText={setMovementAmount}
                placeholder="0.00"
                placeholderTextColor={BrandColors.muted}
                style={styles.input}
                value={movementAmount}
              />
            </View>
            <TextInput
              accessibilityLabel="Motivo del movimiento"
              onChangeText={setMovementReason}
              placeholder="Motivo del movimiento"
              placeholderTextColor={BrandColors.muted}
              style={styles.textInput}
              value={movementReason}
            />
            <PrimaryButton
              label={isSaving ? "Guardando…" : "Registrar movimiento"}
              onPress={handleMovement}
              disabled={
                movementCents === null ||
                movementCents <= 0 ||
                !movementReason.trim() ||
                isSaving
              }
            />
          </View>

          <View style={[sharedStyles.card, styles.formCard]}>
            <Text style={styles.formTitle}>Cierre de caja</Text>
            <Text style={styles.formHint}>
              Esperado: {formatMoney(summary?.expectedCashCents ?? 0)}
            </Text>
            <View style={styles.inputWrap}>
              <Text style={styles.inputPrefix}>S/</Text>
              <TextInput
                accessibilityLabel="Efectivo contado"
                keyboardType="decimal-pad"
                onChangeText={setCountedAmount}
                placeholder="Efectivo contado"
                placeholderTextColor={BrandColors.muted}
                style={styles.input}
                value={countedAmount}
              />
            </View>
            <PrimaryButton
              label={isSaving ? "Cerrando…" : "Cerrar caja"}
              icon="lock-outline"
              onPress={handleClose}
              disabled={countedCents === null || isSaving}
            />
          </View>
        </>
      )}

      <SectionTitle
        action={<Text style={styles.salesCountText}>{recentSales.length}</Text>}
      >
        Ventas recientes
      </SectionTitle>
      <View style={[sharedStyles.card, styles.recentCard]}>
        {!session ? (
          <EmptyMessage text="Abre una caja para iniciar un turno." />
        ) : recentSales.length === 0 ? (
          <EmptyMessage text="Todavía no hay ventas en este turno." />
        ) : (
          recentSales.map((sale, index) => (
            <View
              key={sale.id}
              style={[styles.saleRow, index > 0 && styles.saleBorder]}
            >
              <View style={styles.saleCopy}>
                <Text style={styles.receipt}>{sale.receiptNumber}</Text>
                <Text style={styles.saleMeta}>
                  {sale.actorDisplayName} · {paymentLabels[sale.paymentMethod]}{" "}
                  ·{" "}
                  {new Date(sale.createdAt).toLocaleTimeString("es-PE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
              <Text style={styles.saleTotal}>
                {formatMoney(sale.totalCents)}
              </Text>
              {selectedUser?.role === "administrator" ? (
                <Pressable
                  accessibilityLabel={`Anular ${sale.receiptNumber}`}
                  accessibilityRole="button"
                  onPress={() => {
                    setVoidTarget(sale);
                    setVoidReason("");
                  }}
                  style={styles.voidButton}
                >
                  <MaterialCommunityIcons
                    name="undo-variant"
                    size={15}
                    color={BrandColors.danger}
                  />
                  <Text style={styles.voidText}>Anular</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        )}
      </View>

      <ModalSurface
        dialogStyle={styles.voidDialog}
        dismissOnBackdrop={!isVoiding}
        visible={Boolean(voidTarget)}
        onClose={() => {
          if (isVoiding) return;
          setVoidTarget(null);
          setVoidReason("");
        }}
      >
        <View style={styles.voidHeader}>
          <MaterialCommunityIcons
            name="undo-variant"
            size={24}
            color={BrandColors.danger}
          />
          <Text style={styles.voidTitle}>Anular venta</Text>
        </View>
        <Text style={styles.voidSubtitle}>
          {voidTarget?.receiptNumber} ·{" "}
          {voidTarget ? formatMoney(voidTarget.totalCents) : ""}
        </Text>
        <Text style={styles.voidHint}>
          La venta quedará cancelada, el stock se restaurará y el efectivo
          esperado se recalculará. La operación queda registrada con tu usuario
          y dispositivo.
        </Text>
        <Text style={styles.voidLabel}>Motivo de la anulación</Text>
        <TextInput
          accessibilityLabel="Motivo de la anulación"
          autoFocus
          onChangeText={setVoidReason}
          placeholder="Ej. Cobro duplicado"
          placeholderTextColor={BrandColors.muted}
          style={styles.voidInput}
          value={voidReason}
        />
        <View style={styles.voidActions}>
          <Pressable
            accessibilityLabel="Cancelar anulación"
            accessibilityRole="button"
            accessibilityState={{ disabled: isVoiding }}
            disabled={isVoiding}
            onPress={() => {
              setVoidTarget(null);
              setVoidReason("");
            }}
            style={({ pressed }) => [
              styles.voidCancel,
              isVoiding && styles.voidConfirmDisabled,
              pressed && !isVoiding && styles.pressed,
            ]}
          >
            <Text style={styles.voidCancelText}>Cancelar</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Confirmar anulación de venta"
            accessibilityRole="button"
            accessibilityState={{
              disabled: !voidReason.trim() || isVoiding,
              busy: isVoiding,
            }}
            disabled={!voidReason.trim() || isVoiding}
            onPress={handleVoid}
            style={({ pressed }) => [
              styles.voidConfirm,
              (!voidReason.trim() || isVoiding) && styles.voidConfirmDisabled,
              pressed &&
                Boolean(voidReason.trim()) &&
                !isVoiding &&
                styles.pressed,
            ]}
          >
            <Text style={styles.voidConfirmText}>
              {isVoiding ? "Anulando…" : "Anular venta"}
            </Text>
          </Pressable>
        </View>
      </ModalSurface>

      <SectionTitle>Accesos rápidos</SectionTitle>
      <View style={styles.actionGrid}>
        {visibleActions.map((action) => (
          <Pressable
            accessibilityLabel={action.title}
            accessibilityRole="button"
            disabled={!action.route}
            key={action.title}
            onPress={() => action.route && router.push(action.route as Href)}
            style={({ pressed }) => [
              sharedStyles.card,
              styles.actionCard,
              isMedium && styles.actionCardMedium,
              !action.route && styles.actionDisabled,
              pressed && action.route && styles.pressed,
            ]}
          >
            <View
              style={[
                styles.actionIcon,
                action.accent === "gold" && styles.actionIconGold,
              ]}
            >
              <MaterialCommunityIcons
                name={action.icon}
                size={25}
                color={
                  action.accent === "gold"
                    ? BrandColors.warning
                    : BrandColors.greenDark
                }
              />
            </View>
            <Text style={styles.actionTitle}>{action.title}</Text>
            <Text style={styles.actionDescription}>{action.description}</Text>
            {action.route ? (
              <MaterialCommunityIcons
                name="arrow-right"
                size={19}
                color={BrandColors.muted}
                style={styles.arrow}
              />
            ) : (
              <Pill label="Próximamente" tone="neutral" />
            )}
          </Pressable>
        ))}
      </View>
    </AdminScreen>
  );
}

function SummaryValue({
  isMedium,
  label,
  value,
}: {
  isMedium: boolean;
  label: string;
  value: number;
}) {
  return (
    <View style={[styles.summaryValue, isMedium && styles.summaryValueMedium]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryAmount}>{formatMoney(value)}</Text>
    </View>
  );
}

function EmptyMessage({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons
        name="receipt-text-outline"
        size={30}
        color={BrandColors.mutedLight}
      />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sellNow: {
    minHeight: 104,
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.gold,
    padding: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  sellNowIcon: {
    width: ControlSize.large,
    height: ControlSize.large,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  sellNowCopy: { flex: 1, minWidth: 0 },
  sellNowEyebrow: { color: BrandColors.warning, ...Typography.overline },
  sellNowTitle: {
    color: BrandColors.ink,
    ...Typography.h3,
    marginTop: Spacing.xxs,
    flexShrink: 1,
  },
  sellNowText: {
    color: BrandColors.warning,
    ...Typography.caption,
    marginTop: Spacing.xxs,
    flexShrink: 1,
  },
  sellNowArrow: {
    width: ControlSize.compact,
    height: ControlSize.compact,
    borderRadius: ComponentMetrics.inputRadius,
    backgroundColor: BrandColors.goldLight,
    alignItems: "center",
    justifyContent: "center",
  },
  actionPressed: {
    opacity: Interaction.pressedOpacity,
    transform: [{ scale: Interaction.pressedScale }],
  },
  avatar: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BrandColors.green,
  },
  avatarText: { color: BrandColors.white, ...Typography.label },
  salesCard: {
    backgroundColor: BrandColors.greenDark,
    borderColor: BrandColors.greenDark,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
  },
  syncCard: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm,
  },
  syncCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 0 },
  syncTitle: { color: BrandColors.text, ...Typography.label, flexShrink: 1 },
  syncDetail: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
    flexShrink: 1,
  },
  syncButton: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 150,
    minWidth: 140,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  syncButtonDisabled: { opacity: Interaction.disabledOpacity },
  syncButtonText: { color: BrandColors.white, ...Typography.label },
  salesLabel: { color: BrandColors.greenMid, ...Typography.overline },
  salesAmount: {
    color: BrandColors.white,
    ...Typography.display,
    marginTop: Spacing.xs,
  },
  salesCount: {
    color: BrandColors.greenMid,
    ...Typography.caption,
    marginTop: Spacing.xxs,
  },
  trendIcon: {
    width: ControlSize.large,
    height: ControlSize.large,
    borderRadius: Radius.lg,
    backgroundColor: BrandColors.inkSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  metricsRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  metricCard: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    minWidth: 190,
    padding: Spacing.md,
  },
  metricCardMedium: { maxWidth: 372 },
  metricValue: {
    color: BrandColors.text,
    ...Typography.h2,
    marginTop: Spacing.xs,
    flexShrink: 1,
  },
  metricLabel: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
    flexShrink: 1,
  },
  feedbackCard: { gap: Spacing.sm },
  feedbackTitle: { color: BrandColors.text, ...Typography.label },
  errorText: { color: BrandColors.danger, ...Typography.caption },
  formCard: { gap: Spacing.sm },
  sessionCard: { gap: Spacing.xs },
  formTitle: { color: BrandColors.text, ...Typography.h3 },
  formHint: { color: BrandColors.muted, ...Typography.caption },
  sessionDetail: { color: BrandColors.muted, ...Typography.caption },
  inputWrap: {
    minHeight: ControlSize.default,
    borderWidth: 1.5,
    borderColor: BrandColors.line,
    borderRadius: ComponentMetrics.inputRadius,
    backgroundColor: BrandColors.white,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
  },
  inputPrefix: {
    color: BrandColors.text,
    ...Typography.label,
    marginRight: Spacing.xs,
  },
  input: {
    flex: 1,
    color: BrandColors.text,
    ...Typography.h3,
    paddingVertical: 0,
  },
  textInput: {
    minHeight: ControlSize.default,
    borderWidth: 1.5,
    borderColor: BrandColors.line,
    borderRadius: ComponentMetrics.inputRadius,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    paddingHorizontal: Spacing.sm,
    ...Typography.body,
  },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  choiceButton: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 160,
    minWidth: 140,
    minHeight: ControlSize.default,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceButtonSelected: {
    borderColor: BrandColors.green,
    backgroundColor: BrandColors.greenLight,
  },
  choiceText: { color: BrandColors.muted, ...Typography.label },
  choiceTextSelected: { color: BrandColors.greenDark, ...Typography.label },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  summaryValue: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 200,
    minWidth: 160,
    backgroundColor: BrandColors.cream,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  summaryValueMedium: { maxWidth: 252 },
  summaryLabel: {
    color: BrandColors.muted,
    ...Typography.caption,
    flexShrink: 1,
  },
  summaryAmount: {
    color: BrandColors.text,
    ...Typography.label,
    marginTop: Spacing.xxs,
    flexShrink: 1,
  },
  salesCountText: { color: BrandColors.green, ...Typography.label },
  recentCard: { paddingVertical: Spacing.xxs },
  saleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  saleBorder: { borderTopWidth: 1, borderTopColor: BrandColors.line },
  saleCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 160 },
  receipt: { color: BrandColors.greenDark, ...Typography.label, flexShrink: 1 },
  saleMeta: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
    flexShrink: 1,
  },
  saleTotal: { color: BrandColors.text, ...Typography.label, flexShrink: 0 },
  empty: { alignItems: "center", paddingVertical: Spacing.lg, gap: Spacing.xs },
  emptyText: {
    color: BrandColors.muted,
    ...Typography.caption,
    textAlign: "center",
  },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  actionCard: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    minWidth: 190,
    minHeight: 154,
    padding: Spacing.md,
  },
  actionCardMedium: { maxWidth: 252 },
  actionDisabled: { opacity: Interaction.disabledOpacity },
  actionIcon: {
    width: ControlSize.default,
    height: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.greenLight,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIconGold: { backgroundColor: BrandColors.goldLight },
  actionTitle: {
    color: BrandColors.text,
    ...Typography.label,
    marginTop: Spacing.sm,
    flexShrink: 1,
  },
  actionDescription: {
    color: BrandColors.muted,
    ...Typography.caption,
    marginTop: Spacing.xxs,
    marginBottom: Spacing.xs,
    flexShrink: 1,
  },
  arrow: { position: "absolute", right: Spacing.md, bottom: Spacing.md },
  pressed: { opacity: Interaction.pressedOpacity },
  voidButton: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: ControlSize.default,
    gap: Spacing.xxs,
    borderRadius: Radius.sm,
    backgroundColor: BrandColors.dangerLight,
    paddingHorizontal: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  voidText: { color: BrandColors.danger, ...Typography.label },
  voidDialog: {
    backgroundColor: BrandColors.white,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  voidHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  voidTitle: { color: BrandColors.text, ...Typography.h3 },
  voidSubtitle: { color: BrandColors.danger, ...Typography.label },
  voidHint: { color: BrandColors.muted, ...Typography.caption },
  voidLabel: { color: BrandColors.text, ...Typography.label },
  voidInput: {
    borderWidth: 1.5,
    borderColor: BrandColors.line,
    borderRadius: ComponentMetrics.inputRadius,
    backgroundColor: BrandColors.white,
    color: BrandColors.text,
    ...Typography.body,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  voidActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: Spacing.xs,
    marginTop: Spacing.xxs,
  },
  voidCancel: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 140,
    minWidth: 120,
    minHeight: ControlSize.default,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: BrandColors.goldLight,
    alignItems: "center",
    justifyContent: "center",
  },
  voidCancelText: { color: BrandColors.muted, ...Typography.label },
  voidConfirm: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 140,
    minWidth: 120,
    minHeight: ControlSize.default,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.lg,
    backgroundColor: BrandColors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  voidConfirmDisabled: { opacity: Interaction.disabledOpacity },
  voidConfirmText: { color: BrandColors.white, ...Typography.label },
});
