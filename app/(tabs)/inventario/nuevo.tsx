import { router, type Href } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";

import { AdminScreen } from "@/components/admin-ui";
import { ProductForm, type ProductFormValue } from "@/components/product-form";
import { useLocalOperator } from "@/context/local-operator-context";
import { createProduct } from "@/database/repositories/product-repository";
import { DEFAULT_STORE_ID } from "@/database/seed";
import { useLocalDatabase } from "@/hooks/use-local-database";

export default function CreateProductScreen() {
  const database = useLocalDatabase();
  const { selectedUser, deviceId } = useLocalOperator();
  const [isSaving, setIsSaving] = useState(false);

  const save = async (value: ProductFormValue) => {
    if (!selectedUser || selectedUser.role !== "administrator") {
      throw new Error("Selecciona un administrador para crear productos.");
    }
    setIsSaving(true);
    try {
      const product = await createProduct(database, {
        storeId: DEFAULT_STORE_ID,
        initialStockQuantity: value.stockQuantity,
        actorUserId: selectedUser.id,
        deviceId,
        ...value,
      });
      Alert.alert(
        "Producto creado",
        `${product.name} quedó registrado y pendiente de confirmación central.`,
      );
      router.replace(`/inventario/${product.id}` as Href);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AdminScreen
      back
      eyebrow="INVENTARIO"
      title="Crear producto"
      subtitle="Datos comerciales, unidad y stock inicial"
    >
      <ProductForm isSaving={isSaving} onSubmit={save} />
    </AdminScreen>
  );
}
