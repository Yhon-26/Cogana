import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AdminScreen, PrimaryButton, SectionTitle, sharedStyles } from '@/components/admin-ui';
import { BrandColors } from '@/constants/theme';
import { SaleLine, useStore } from '@/context/store-context';

type SaleMode = 'gramos' | 'kilos' | 'soles';

const modes: { id: SaleMode; label: string; hint: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { id: 'gramos', label: 'Gramos', hint: 'Ej. 500', icon: 'scale-balance' },
  { id: 'kilos', label: 'Kilos', hint: 'Ej. 1.5', icon: 'weight-kilogram' },
  { id: 'soles', label: 'Por monto', hint: 'Ej. 10.00', icon: 'cash' },
];

function parseAmount(value: string) {
  return Number(value.replace(',', '.'));
}

export default function SaleScreen() {
  const { products, registerSale } = useStore();
  const [selectedId, setSelectedId] = useState(products[0]?.id ?? '');
  const [mode, setMode] = useState<SaleMode>('gramos');
  const [amount, setAmount] = useState('');
  const [cart, setCart] = useState<SaleLine[]>([]);

  const selectedProduct = products.find((product) => product.id === selectedId) ?? products[0];
  const enteredAmount = parseAmount(amount);
  const alreadyInCart = cart
    .filter((line) => line.productId === selectedProduct?.id)
    .reduce((sum, line) => sum + line.quantityKg, 0);
  const availableStock = Math.max(0, (selectedProduct?.stockKg ?? 0) - alreadyInCart);

  const calculation = useMemo(() => {
    if (!selectedProduct || !Number.isFinite(enteredAmount) || enteredAmount <= 0) {
      return { quantityKg: 0, total: 0 };
    }

    const quantityKg = mode === 'gramos'
      ? enteredAmount / 1000
      : mode === 'kilos'
        ? enteredAmount
        : enteredAmount / selectedProduct.pricePerKg;
    const total = mode === 'soles' ? enteredAmount : quantityKg * selectedProduct.pricePerKg;
    return { quantityKg, total };
  }, [enteredAmount, mode, selectedProduct]);

  const exceedsStock = calculation.quantityKg > availableStock + 0.0001;
  const canAdd = calculation.quantityKg > 0 && !exceedsStock;
  const cartTotal = cart.reduce((sum, line) => sum + line.total, 0);

  const addToCart = () => {
    if (!selectedProduct || !canAdd) return;
    const saleLabel = mode === 'gramos'
      ? `${enteredAmount.toLocaleString('es-PE')} g`
      : mode === 'kilos'
        ? `${enteredAmount.toLocaleString('es-PE')} kg`
        : `S/ ${enteredAmount.toFixed(2)}`;

    setCart((current) => [...current, {
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      quantityKg: calculation.quantityKg,
      pricePerKg: selectedProduct.pricePerKg,
      total: calculation.total,
      saleLabel,
    }]);
    setAmount('');
  };

  const confirmSale = () => {
    if (cart.length === 0) return;
    const code = registerSale(cart);
    const total = cartTotal;
    setCart([]);
    Alert.alert('Venta registrada', `${code} · Total S/ ${total.toFixed(2)}\n\nRegistro guardado solo durante esta sesión.`);
  };

  return (
    <AdminScreen title="Nueva venta" subtitle="Registra productos por peso o por monto en soles">
      <SectionTitle>1. Elige un producto</SectionTitle>
      <ScrollView
        horizontal
        contentContainerStyle={styles.productList}
        showsHorizontalScrollIndicator={false}>
        {products.map((product) => {
          const selected = product.id === selectedProduct?.id;
          return (
            <Pressable
              key={product.id}
              onPress={() => setSelectedId(product.id)}
              style={({ pressed }) => [
                styles.productCard,
                selected && styles.productCardSelected,
                pressed && styles.pressed,
              ]}>
              <View style={[styles.productIcon, selected && styles.productIconSelected]}>
                <MaterialCommunityIcons name="barley" size={24} color={selected ? BrandColors.white : BrandColors.green} />
              </View>
              <Text numberOfLines={2} style={[styles.productName, selected && styles.productNameSelected]}>{product.name}</Text>
              <Text style={[styles.productPrice, selected && styles.productPriceSelected]}>S/ {product.pricePerKg.toFixed(2)} / kg</Text>
              <Text style={[styles.productStock, selected && styles.productStockSelected]}>{product.stockKg.toFixed(1)} kg disp.</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <SectionTitle>2. Forma de venta</SectionTitle>
      <View style={styles.modeRow}>
        {modes.map((item) => {
          const selected = mode === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => { setMode(item.id); setAmount(''); }}
              style={[styles.modeButton, selected && styles.modeButtonSelected]}>
              <MaterialCommunityIcons name={item.icon} size={20} color={selected ? BrandColors.greenDark : BrandColors.muted} />
              <Text style={[styles.modeLabel, selected && styles.modeLabelSelected]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[sharedStyles.card, styles.calculatorCard]}>
        <Text style={styles.inputLabel}>
          {mode === 'gramos' ? 'Cantidad en gramos' : mode === 'kilos' ? 'Cantidad en kilos' : 'Monto en soles'}
        </Text>
        <View style={[styles.inputWrap, exceedsStock && styles.inputError]}>
          {mode === 'soles' ? <Text style={styles.inputPrefix}>S/</Text> : null}
          <TextInput
            accessibilityLabel="Cantidad de venta"
            keyboardType="decimal-pad"
            onChangeText={setAmount}
            placeholder={modes.find((item) => item.id === mode)?.hint}
            placeholderTextColor="#9DA49E"
            selectTextOnFocus
            style={styles.input}
            value={amount}
          />
          {mode !== 'soles' ? <Text style={styles.inputUnit}>{mode === 'gramos' ? 'g' : 'kg'}</Text> : null}
        </View>
        {exceedsStock ? (
          <Text style={styles.errorText}>Supera el stock disponible ({availableStock.toFixed(2)} kg).</Text>
        ) : null}

        <View style={styles.resultRow}>
          <View>
            <Text style={styles.resultLabel}>Peso calculado</Text>
            <Text style={styles.resultValue}>{calculation.quantityKg.toFixed(3)} kg</Text>
          </View>
          <View style={styles.resultDivider} />
          <View style={styles.resultRight}>
            <Text style={styles.resultLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>S/ {calculation.total.toFixed(2)}</Text>
          </View>
        </View>
        <PrimaryButton label="Agregar a la venta" icon="plus" onPress={addToCart} disabled={!canAdd} />
      </View>

      <SectionTitle action={cart.length > 0 ? <Text style={styles.itemCount}>{cart.length} ítem(s)</Text> : undefined}>
        3. Resumen
      </SectionTitle>
      <View style={[sharedStyles.card, styles.cartCard]}>
        {cart.length === 0 ? (
          <View style={styles.emptyCart}>
            <MaterialCommunityIcons name="cart-outline" size={34} color="#A5ACA6" />
            <Text style={styles.emptyTitle}>La venta está vacía</Text>
            <Text style={styles.emptyText}>Selecciona un producto y agrega una cantidad.</Text>
          </View>
        ) : (
          <>
            {cart.map((line, index) => (
              <View key={`${line.productId}-${index}`} style={[styles.cartLine, index > 0 && styles.cartLineBorder]}>
                <View style={styles.cartLineCopy}>
                  <Text style={styles.cartProduct}>{line.productName}</Text>
                  <Text style={styles.cartDetail}>{line.saleLabel} · {line.quantityKg.toFixed(3)} kg</Text>
                </View>
                <Text style={styles.cartPrice}>S/ {line.total.toFixed(2)}</Text>
                <Pressable accessibilityLabel={`Quitar ${line.productName}`} onPress={() => setCart((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.removeButton}>
                  <MaterialCommunityIcons name="close" size={18} color={BrandColors.danger} />
                </Pressable>
              </View>
            ))}
            <View style={styles.cartTotalRow}>
              <Text style={styles.cartTotalLabel}>TOTAL</Text>
              <Text style={styles.cartTotal}>S/ {cartTotal.toFixed(2)}</Text>
            </View>
          </>
        )}
      </View>
      <PrimaryButton label={`Confirmar venta · S/ ${cartTotal.toFixed(2)}`} icon="check-circle-outline" onPress={confirmSale} disabled={cart.length === 0} />
      <Text style={styles.localNotice}>Prototipo local: no se procesa ningún pago real.</Text>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  productList: { gap: 10, paddingRight: 6 },
  productCard: { width: 148, minHeight: 155, borderRadius: 18, borderWidth: 1, borderColor: BrandColors.line, backgroundColor: BrandColors.white, padding: 13 },
  productCardSelected: { backgroundColor: BrandColors.greenDark, borderColor: BrandColors.gold },
  productIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: BrandColors.greenLight, alignItems: 'center', justifyContent: 'center' },
  productIconSelected: { backgroundColor: BrandColors.green },
  productName: { color: BrandColors.text, fontSize: 14, lineHeight: 18, fontWeight: '800', marginTop: 10 },
  productNameSelected: { color: BrandColors.white },
  productPrice: { color: BrandColors.greenDark, fontSize: 12, fontWeight: '800', marginTop: 7 },
  productPriceSelected: { color: BrandColors.gold },
  productStock: { color: BrandColors.muted, fontSize: 10, marginTop: 3 },
  productStockSelected: { color: '#C6D3C8' },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeButton: { flex: 1, minHeight: 68, backgroundColor: BrandColors.white, borderColor: BrandColors.line, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 4 },
  modeButtonSelected: { borderColor: BrandColors.green, backgroundColor: BrandColors.greenLight, borderWidth: 2 },
  modeLabel: { color: BrandColors.muted, fontSize: 11, fontWeight: '700' },
  modeLabelSelected: { color: BrandColors.greenDark },
  calculatorCard: { gap: 13 },
  inputLabel: { color: BrandColors.text, fontSize: 13, fontWeight: '800' },
  inputWrap: { height: 58, borderWidth: 1.5, borderColor: BrandColors.line, borderRadius: 14, backgroundColor: '#FBFCFA', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15 },
  inputError: { borderColor: BrandColors.danger },
  inputPrefix: { color: BrandColors.text, fontSize: 20, fontWeight: '800', marginRight: 8 },
  input: { flex: 1, color: BrandColors.text, fontSize: 22, fontWeight: '800', paddingVertical: 0 },
  inputUnit: { color: BrandColors.muted, fontSize: 15, fontWeight: '700' },
  errorText: { color: BrandColors.danger, fontSize: 11, marginTop: -6 },
  resultRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: BrandColors.cream, borderRadius: 13, padding: 13 },
  resultDivider: { width: 1, alignSelf: 'stretch', backgroundColor: BrandColors.line, marginHorizontal: 15 },
  resultRight: { flex: 1, alignItems: 'flex-end' },
  resultLabel: { color: BrandColors.muted, fontSize: 10, fontWeight: '700' },
  resultValue: { color: BrandColors.text, fontSize: 15, fontWeight: '800', marginTop: 4 },
  totalValue: { color: BrandColors.greenDark, fontSize: 20, fontWeight: '900', marginTop: 2 },
  itemCount: { color: BrandColors.green, fontSize: 12, fontWeight: '800' },
  cartCard: { paddingVertical: 5 },
  emptyCart: { alignItems: 'center', paddingVertical: 22 },
  emptyTitle: { color: BrandColors.text, fontSize: 14, fontWeight: '800', marginTop: 8 },
  emptyText: { color: BrandColors.muted, fontSize: 11, marginTop: 3 },
  cartLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  cartLineBorder: { borderTopWidth: 1, borderTopColor: BrandColors.line },
  cartLineCopy: { flex: 1 },
  cartProduct: { color: BrandColors.text, fontSize: 13, fontWeight: '800' },
  cartDetail: { color: BrandColors.muted, fontSize: 10, marginTop: 4 },
  cartPrice: { color: BrandColors.text, fontSize: 13, fontWeight: '900', marginHorizontal: 8 },
  removeButton: { width: 30, height: 30, borderRadius: 9, backgroundColor: BrandColors.dangerLight, alignItems: 'center', justifyContent: 'center' },
  cartTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: BrandColors.line, paddingVertical: 15 },
  cartTotalLabel: { color: BrandColors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  cartTotal: { color: BrandColors.greenDark, fontSize: 22, fontWeight: '900' },
  localNotice: { color: BrandColors.muted, fontSize: 10, textAlign: 'center', marginTop: -8 },
  pressed: { opacity: 0.78 },
});
