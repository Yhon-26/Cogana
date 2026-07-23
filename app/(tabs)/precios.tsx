import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AdminScreen, Pill, SectionTitle, sharedStyles } from '@/components/admin-ui';
import { BrandColors } from '@/constants/theme';
import { Product, useStore } from '@/context/store-context';

function PriceEditor({ product, onSave }: { product: Product; onSave: (price: number) => void }) {
  const [value, setValue] = useState(product.pricePerKg.toFixed(2));
  const parsedValue = Number(value.replace(',', '.'));
  const valid = Number.isFinite(parsedValue) && parsedValue > 0;
  const changed = valid && Math.abs(parsedValue - product.pricePerKg) > 0.001;

  const adjust = (difference: number) => {
    const current = valid ? parsedValue : product.pricePerKg;
    setValue(Math.max(0.1, current + difference).toFixed(2));
  };

  const save = () => {
    if (!valid || !changed) return;
    onSave(parsedValue);
    setValue(parsedValue.toFixed(2));
    Alert.alert('Precio actualizado', `${product.name}\nNuevo precio: S/ ${parsedValue.toFixed(2)} por kg`);
  };

  return (
    <View style={[sharedStyles.card, styles.priceCard]}>
      <View style={styles.productHeader}>
        <View style={styles.productIcon}>
          <MaterialCommunityIcons name="barley" size={23} color={BrandColors.green} />
        </View>
        <View style={styles.productCopy}>
          <Text style={styles.productName}>{product.name}</Text>
          <Text style={styles.productMeta}>{product.code} · {product.category}</Text>
        </View>
        {changed ? <Pill label="Sin guardar" tone="gold" /> : null}
      </View>

      <Text style={styles.inputLabel}>Precio de venta por kilogramo</Text>
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
          <Text style={styles.unit}>/ kg</Text>
        </View>
        <Pressable accessibilityLabel="Aumentar precio" onPress={() => adjust(0.1)} style={styles.stepButton}>
          <MaterialCommunityIcons name="plus" size={21} color={BrandColors.greenDark} />
        </Pressable>
      </View>
      {!valid ? <Text style={styles.errorText}>Ingresa un precio mayor que cero.</Text> : null}
      <Pressable
        disabled={!changed}
        onPress={save}
        style={({ pressed }) => [styles.saveButton, !changed && styles.saveButtonDisabled, pressed && changed && styles.pressed]}>
        <MaterialCommunityIcons name="content-save-outline" size={18} color={changed ? BrandColors.white : '#939A94'} />
        <Text style={[styles.saveText, !changed && styles.saveTextDisabled]}>Guardar precio</Text>
      </Pressable>
    </View>
  );
}

export default function PricesScreen() {
  const { products, updatePrice } = useStore();

  return (
    <AdminScreen title="Actualización de precios" subtitle="Modifica el precio por kilo de cada producto">
      <View style={[sharedStyles.card, styles.infoCard]}>
        <View style={styles.infoIcon}>
          <MaterialCommunityIcons name="information-outline" size={21} color={BrandColors.warning} />
        </View>
        <Text style={styles.infoText}>Los cambios se reflejan de inmediato en Nueva venta y se reinician al recargar la app.</Text>
      </View>

      <SectionTitle action={<Text style={styles.productCount}>{products.length} productos</Text>}>
        Lista de precios
      </SectionTitle>
      <View style={styles.list}>
        {products.map((product) => (
          <PriceEditor key={product.id} product={product} onSave={(price) => updatePrice(product.id, price)} />
        ))}
      </View>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
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
