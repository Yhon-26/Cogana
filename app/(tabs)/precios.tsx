import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AdminScreen, Pill, PrimaryButton, SectionTitle, sharedStyles } from '@/components/admin-ui';
import { BrandColors } from '@/constants/theme';
import type { ProductRecord } from '@/database/models';
import { updateProductPrice } from '@/database/repositories/price-repository';
import { DEFAULT_STORE_ID, DEMO_ADMIN_USER_ID, DEMO_DEVICE_ID } from '@/database/seed';
import { useLocalProducts } from '@/hooks/use-local-products';

function formatPricingUnit(product: ProductRecord) {
  if (product.baseUnit === 'gram' && product.pricingQuantity === 1000) return 'kg';
  if (product.baseUnit === 'gram') return `${product.pricingQuantity} g`;
  if (product.pricingQuantity === 1) return 'unidad';
  return `${product.pricingQuantity} un.`;
}

function PriceEditor({
  product,
  onSave,
}: {
  product: ProductRecord;
  onSave: (priceCents: number) => Promise<void>;
}) {
  const [value, setValue] = useState((product.priceCents / 100).toFixed(2));
  const [isSaving, setIsSaving] = useState(false);
  const parsedValue = Number(value.replace(',', '.'));
  const parsedCents = Math.round(parsedValue * 100);
  const valid = Number.isFinite(parsedValue) && parsedValue > 0 && Number.isSafeInteger(parsedCents);
  const changed = valid && parsedCents !== product.priceCents;
  const pricingUnit = formatPricingUnit(product);

  const adjust = (difference: number) => {
    const current = valid ? parsedValue : product.priceCents / 100;
    setValue(Math.max(0.1, current + difference).toFixed(2));
  };

  const save = async () => {
    if (!valid || !changed || isSaving) return;

    setIsSaving(true);
    try {
      await onSave(parsedCents);
      setValue((parsedCents / 100).toFixed(2));
      Alert.alert(
        'Precio actualizado',
        `${product.name}\nNuevo precio: S/ ${(parsedCents / 100).toFixed(2)} por ${pricingUnit}`
      );
    } catch (caughtError) {
      Alert.alert(
        'No se pudo actualizar',
        caughtError instanceof Error ? caughtError.message : 'Ocurrió un error inesperado.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[sharedStyles.card, styles.priceCard]}>
      <View style={styles.productHeader}>
        <View style={styles.productIcon}>
          <MaterialCommunityIcons name="barley" size={23} color={BrandColors.green} />
        </View>
        <View style={styles.productCopy}>
          <Text style={styles.productName}>{product.name}</Text>
          <Text style={styles.productMeta}>{product.sku} · {product.category}</Text>
        </View>
        {changed ? <Pill label="Sin guardar" tone="gold" /> : null}
      </View>

      <Text style={styles.inputLabel}>Precio de venta por {pricingUnit}</Text>
      <View style={styles.editorRow}>
        <Pressable accessibilityLabel="Reducir precio" onPress={() => adjust(-0.1)} style={styles.stepButton}>
          <MaterialCommunityIcons name="minus" size={21} color={BrandColors.greenDark} />
        </Pressable>
        <View style={[styles.inputWrap, !valid && styles.inputInvalid]}>
          <Text style={styles.currency}>S/</Text>
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={setValue}
            selectTextOnFocus
            style={styles.priceInput}
            value={value}
          />
          <Text style={styles.unit}>/ {pricingUnit}</Text>
        </View>
        <Pressable accessibilityLabel="Aumentar precio" onPress={() => adjust(0.1)} style={styles.stepButton}>
          <MaterialCommunityIcons name="plus" size={21} color={BrandColors.greenDark} />
        </Pressable>
      </View>
      {!valid ? <Text style={styles.errorText}>Ingresa un precio mayor que cero.</Text> : null}
      <Pressable
        disabled={!changed || isSaving}
        onPress={() => void save()}
        style={({ pressed }) => [
          styles.saveButton,
          (!changed || isSaving) && styles.saveButtonDisabled,
          pressed && changed && !isSaving && styles.pressed,
        ]}>
        <MaterialCommunityIcons
          name="content-save-outline"
          size={18}
          color={changed && !isSaving ? BrandColors.white : '#939A94'}
        />
        <Text style={[styles.saveText, (!changed || isSaving) && styles.saveTextDisabled]}>
          {isSaving ? 'Guardando…' : 'Guardar precio'}
        </Text>
      </Pressable>
    </View>
  );
}

export default function PricesScreen() {
  const { database, products, isLoading, error, refresh } = useLocalProducts();

  const savePrice = async (productId: string, priceCents: number) => {
    await updateProductPrice(database, {
      storeId: DEFAULT_STORE_ID,
      productId,
      newPriceCents: priceCents,
      actorUserId: DEMO_ADMIN_USER_ID,
      deviceId: DEMO_DEVICE_ID,
    });
    await refresh(false);
  };

  if (isLoading) {
    return (
      <AdminScreen title="Actualización de precios" subtitle="Modifica el precio base de cada producto">
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text style={styles.feedbackTitle}>Cargando precios locales…</Text>
          <Text style={styles.feedbackText}>Leyendo el catálogo guardado en este dispositivo.</Text>
        </View>
      </AdminScreen>
    );
  }

  if (error) {
    return (
      <AdminScreen title="Actualización de precios" subtitle="Modifica el precio base de cada producto">
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text style={styles.feedbackTitle}>No se pudieron cargar los precios</Text>
          <Text style={styles.feedbackText}>{error.message}</Text>
          <PrimaryButton label="Intentar nuevamente" onPress={() => void refresh()} />
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen title="Actualización de precios" subtitle="Modifica el precio base de cada producto">
      <View style={[sharedStyles.card, styles.infoCard]}>
        <View style={styles.infoIcon}>
          <MaterialCommunityIcons name="information-outline" size={21} color={BrandColors.warning} />
        </View>
        <Text style={styles.infoText}>
          Los cambios se guardan en SQLite, conservan su historial y quedan pendientes de sincronización.
        </Text>
      </View>

      <SectionTitle action={<Text style={styles.productCount}>{products.length} productos</Text>}>
        Lista de precios
      </SectionTitle>
      <View style={styles.list}>
        {products.map((product) => (
          <PriceEditor
            key={product.id}
            product={product}
            onSave={(priceCents) => savePrice(product.id, priceCents)}
          />
        ))}
      </View>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  feedbackCard: { gap: 12, padding: 18 },
  feedbackTitle: { color: BrandColors.text, fontSize: 15, fontWeight: '800' },
  feedbackText: { color: BrandColors.muted, fontSize: 11, lineHeight: 17 },
  infoCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: BrandColors.goldLight, borderColor: '#E9D994', padding: 14 },
  infoIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#F1DF9D', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  infoText: { flex: 1, color: '#6E571B', fontSize: 11, lineHeight: 16 },
  productCount: { color: BrandColors.muted, fontSize: 11, fontWeight: '700' },
  list: { gap: 11 },
  priceCard: { padding: 15 },
  productHeader: { flexDirection: 'row', alignItems: 'center' },
  productIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: BrandColors.greenLight, alignItems: 'center', justifyContent: 'center' },
  productCopy: { flex: 1, marginHorizontal: 11 },
  productName: { color: BrandColors.text, fontSize: 14, fontWeight: '800' },
  productMeta: { color: BrandColors.muted, fontSize: 10, marginTop: 3 },
  inputLabel: { color: BrandColors.muted, fontSize: 10, fontWeight: '700', marginTop: 15, marginBottom: 7 },
  editorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepButton: { width: 42, height: 48, borderRadius: 13, borderWidth: 1, borderColor: '#C9D4CA', backgroundColor: BrandColors.greenLight, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, height: 48, borderRadius: 13, borderWidth: 1.5, borderColor: BrandColors.line, backgroundColor: '#FBFCFA', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11 },
  inputInvalid: { borderColor: BrandColors.danger },
  currency: { color: BrandColors.muted, fontSize: 14, fontWeight: '700', marginRight: 5 },
  priceInput: { flex: 1, color: BrandColors.text, fontSize: 18, fontWeight: '900', paddingVertical: 0 },
  unit: { color: BrandColors.muted, fontSize: 11, fontWeight: '700' },
  errorText: { color: BrandColors.danger, fontSize: 10, marginTop: 5 },
  saveButton: { height: 43, borderRadius: 12, backgroundColor: BrandColors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 12 },
  saveButtonDisabled: { backgroundColor: '#E5E8E4' },
  saveText: { color: BrandColors.white, fontSize: 12, fontWeight: '800' },
  saveTextDisabled: { color: '#939A94' },
  pressed: { opacity: 0.78 },
});
