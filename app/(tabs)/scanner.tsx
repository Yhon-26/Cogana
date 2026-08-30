import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import { router, type Href } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AdminScreen,
  PrimaryButton,
  sharedStyles,
} from "@/components/admin-ui";
import { ThemedTextInput as TextInput } from "@/components/themed-text-input";
import {
  BrandColors,
  ComponentMetrics,
  ControlSize,
  Layout,
  Radius,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useLocalProducts } from "@/hooks/use-local-products";

export default function ScannerScreen() {
  const { products } = useLocalProducts();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const isFocused = useIsFocused();

  const resolveCode = (rawCode: string) => {
    const code = rawCode.trim().toLocaleUpperCase("es-PE");
    const product = products.find(
      (candidate) => candidate.sku.toLocaleUpperCase("es-PE") === code,
    );
    if (!product) {
      setScanned(true);
      Alert.alert(
        "Código no encontrado",
        `${rawCode} no está asociado a un SKU local.`,
        [{ text: "Escanear otro", onPress: () => setScanned(false) }],
      );
      return;
    }
    router.replace(`/inventario/${product.id}` as Href);
  };

  const onBarcodeScanned = ({ data }: BarcodeScanningResult) => {
    if (scanned) return;
    setScanned(true);
    resolveCode(data);
  };

  if (!permission) {
    return (
      <AdminScreen title="Escáner" subtitle="Preparando permiso de cámara">
        <View style={[sharedStyles.card, styles.center]}>
          <Text accessibilityLiveRegion="polite" style={styles.meta}>
            Consultando permisos…
          </Text>
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen
      title="Escáner"
      subtitle="Busca productos por código de barras o SKU"
    >
      {!permission.granted ? (
        <View style={[sharedStyles.card, styles.card]}>
          <MaterialCommunityIcons
            name="camera-lock-outline"
            size={Spacing.xxxl}
            color={BrandColors.warning}
          />
          <Text style={styles.title}>La cámara necesita permiso</Text>
          <Text style={styles.meta}>
            El código se procesa en el dispositivo y no se envía a un tercero.
          </Text>
          <PrimaryButton
            icon="camera-outline"
            label="Permitir cámara"
            onPress={() => void requestPermission()}
          />
        </View>
      ) : (
        <View style={styles.cameraWrap}>
          <CameraView
            active={isFocused}
            barcodeScannerSettings={{
              barcodeTypes: [
                "ean13",
                "ean8",
                "upc_a",
                "upc_e",
                "code128",
                "code39",
                "qr",
              ],
            }}
            facing="back"
            onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
            style={styles.camera}
          />
          <View pointerEvents="none" style={styles.frame} />
          {scanned ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setScanned(false)}
              style={styles.scanAgain}
            >
              <Text style={styles.scanAgainText}>Escanear otra vez</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      <View style={[sharedStyles.card, styles.card]}>
        <Text style={styles.title}>Lector externo o entrada manual</Text>
        <Text style={styles.meta}>
          Los lectores Bluetooth que escriben como teclado funcionan en este
          campo.
        </Text>
        <TextInput
          accessibilityLabel="SKU o código"
          autoCapitalize="characters"
          autoCorrect={false}
          onChangeText={setManualCode}
          onSubmitEditing={() => resolveCode(manualCode)}
          placeholder="SKU o código"
          placeholderTextColor={BrandColors.muted}
          style={styles.input}
          value={manualCode}
        />
        <PrimaryButton
          disabled={!manualCode.trim()}
          icon="magnify"
          label="Buscar código"
          onPress={() => resolveCode(manualCode)}
        />
      </View>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm, alignItems: "center" },
  center: { alignItems: "center" },
  title: { color: BrandColors.text, ...Typography.h3, textAlign: "center" },
  meta: { color: BrandColors.muted, ...Typography.body, textAlign: "center" },
  cameraWrap: {
    height: Layout.dialogMaxWidth - Spacing.xxxl - Spacing.lg,
    overflow: "hidden",
    borderRadius: Radius.xl,
    backgroundColor: BrandColors.ink,
  },
  camera: { flex: 1 },
  frame: {
    position: "absolute",
    left: Spacing.xxl,
    right: Spacing.xxl,
    top: ControlSize.default * 2,
    height: ControlSize.default * 3,
    borderWidth: 3,
    borderColor: BrandColors.gold,
    borderRadius: Radius.lg,
  },
  scanAgain: {
    position: "absolute",
    bottom: Spacing.lg,
    left: Spacing.xxxl,
    right: Spacing.xxxl,
    minHeight: ControlSize.default,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.green,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  scanAgainText: { color: BrandColors.white, ...Typography.label },
  input: {
    alignSelf: "stretch",
    minHeight: ControlSize.default,
    borderWidth: 1,
    borderColor: BrandColors.line,
    borderRadius: ComponentMetrics.inputRadius,
    paddingHorizontal: Spacing.sm,
    color: BrandColors.text,
    backgroundColor: BrandColors.white,
    ...Typography.body,
  },
});
