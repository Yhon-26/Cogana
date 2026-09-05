import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Text, View } from "react-native";

import {
  AdminScreen,
  PrimaryButton,
  sharedStyles,
} from "@/components/admin-ui";
import { ProductForm, type ProductFormValue } from "@/components/product-form";
import { useLocalOperator } from "@/context/local-operator-context";
import type { ProductRecord } from "@/database/models";
import {
  getProductById,
  updateProduct,
} from "@/database/repositories/product-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { useLocalDatabase } from "@/hooks/use-local-database";
import { useSaveSync } from "@/hooks/use-save-sync";
import { getOperatorErrorMessage } from "@/lib/user-facing-error";

export default function EditProductScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const database = useLocalDatabase();
  const { selectedUser, deviceId } = useLocalOperator();
  const { flushNow } = useSaveSync();
  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!productId) {
      setLoadError("No recibimos un identificador de producto válido.");
      return;
    }
    setLoadError(null);
    try {
      setProduct(await getProductById(database, DEFAULT_STORE_ID, productId));
    } catch (error) {
      setProduct(null);
      setLoadError(
        getOperatorErrorMessage(error, "No se pudo cargar el producto."),
      );
    }
  }, [database, productId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const save = async (value: ProductFormValue) => {
    if (!product || !selectedUser || selectedUser.role !== "administrator") {
      throw new Error("Selecciona un administrador para editar productos.");
    }
    setIsSaving(true);
    try {
      await updateProduct(database, {
        storeId: DEFAULT_STORE_ID,
        productId: product.id,
        expectedVersion: product.version,
        actorUserId: selectedUser.id,
        deviceId,
        ...value,
        priceCents: product.priceCents,
      });
      const syncState = await flushNow();
      Alert.alert(
        "Producto actualizado",
        syncState === "synced"
          ? `${product.name} quedó actualizado y sincronizado con la central.`
          : `${product.name} quedó actualizado. La central lo sincronizará automáticamente.`,
      );
      router.back();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminScreen
      back
      eyebrow="INVENTARIO"
      title="Editar producto"
      subtitle="Actualiza datos y stock mínimo"
    >
      {product ? (
        <ProductForm product={product} isSaving={isSaving} onSubmit={save} />
      ) : loadError ? (
        <View style={sharedStyles.card}>
          <Text accessibilityRole="alert">{loadError}</Text>
          <PrimaryButton label="Reintentar" onPress={() => void load()} />
        </View>
      ) : (
        <View style={sharedStyles.card}>
          <Text>Cargando producto…</Text>
        </View>
      )}
    </AdminScreen>
  );
}
