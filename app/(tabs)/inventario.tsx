import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AdminScreen, Pill, PrimaryButton, SectionTitle, sharedStyles } from '@/components/admin-ui';
import { BrandColors } from '@/constants/theme';
import type { ProductRecord } from '@/database/models';
import { useLocalProducts } from '@/hooks/use-local-products';

function formatStock(product: ProductRecord, quantity: number) {
  return product.baseUnit === 'gram'
    ? `${(quantity / 1000).toFixed(2)} kg`
    : `${quantity} un.`;
}

function formatPricingUnit(product: ProductRecord) {
  if (product.baseUnit === 'gram' && product.pricingQuantity === 1000) return 'kg';
  if (product.baseUnit === 'gram') return `${product.pricingQuantity} g`;
  if (product.pricingQuantity === 1) return 'unidad';
  return `${product.pricingQuantity} un.`;
}

export default function InventoryScreen() {
  const { products, isLoading, error, refresh } = useLocalProducts();
  const [query, setQuery] = useState('');
  const lowStock = products.filter(
    (product) => product.stockQuantity <= product.minimumStockQuantity
  ).length;
  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es-PE');
    if (!normalized) return products;
    return products.filter((product) =>
      `${product.name} ${product.sku} ${product.category}`
        .toLocaleLowerCase('es-PE')
        .includes(normalized)
    );
  }, [products, query]);

  if (isLoading) {
    return (
      <AdminScreen title="Inventario" subtitle="Consulta existencias y productos por reponer">
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text style={styles.feedbackTitle}>Cargando inventario local…</Text>
          <Text style={styles.feedbackText}>Leyendo productos guardados en este dispositivo.</Text>
        </View>
      </AdminScreen>
    );
  }

  if (error) {
    return (
      <AdminScreen title="Inventario" subtitle="Consulta existencias y productos por reponer">
        <View style={[sharedStyles.card, styles.feedbackCard]}>
          <Text style={styles.feedbackTitle}>No se pudo cargar el inventario</Text>
          <Text style={styles.feedbackText}>{error.message}</Text>
          <PrimaryButton label="Intentar nuevamente" onPress={() => void refresh()} />
        </View>
      </AdminScreen>
    );
  }

  return (
    <AdminScreen title="Inventario" subtitle="Consulta existencias y productos por reponer">
      <View style={styles.metricRow}>
        <View style={[sharedStyles.card, styles.metricCard]}>
          <Text style={styles.metricLabel}>PRODUCTOS ACTIVOS</Text>
          <Text style={styles.metricValue}>{products.length}</Text>
        </View>
        <View style={[sharedStyles.card, styles.metricCard, styles.alertMetric]}>
          <Text style={styles.alertLabel}>POR REPONER</Text>
          <Text style={styles.alertValue}>{lowStock}</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <MaterialCommunityIcons name="magnify" size={21} color={BrandColors.muted} />
        <TextInput
          onChangeText={setQuery}
          placeholder="Buscar producto o código"
          placeholderTextColor="#8D968E"
          style={styles.searchInput}
          value={query}
        />
        {query ? <MaterialCommunityIcons name="close-circle" size={19} color="#9AA19B" onPress={() => setQuery('')} /> : null}
      </View>

      <SectionTitle action={<Text style={styles.resultCount}>{filteredProducts.length} productos</Text>}>
        Existencias
      </SectionTitle>
      <View style={styles.list}>
        {filteredProducts.map((product) => {
          const low = product.stockQuantity <= product.minimumStockQuantity;
          const ratio = Math.min(
            1,
            product.stockQuantity / Math.max(product.minimumStockQuantity * 3, 1)
          );
          return (
            <View key={product.id} style={[sharedStyles.card, styles.productCard]}>
              <View style={styles.productTop}>
                <View style={[styles.iconWrap, low && styles.iconWrapLow]}>
                  <MaterialCommunityIcons name="barley" size={23} color={low ? BrandColors.warning : BrandColors.green} />
                </View>
                <View style={styles.productCopy}>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productMeta}>{product.sku} · {product.category}</Text>
                </View>
                <Pill label={low ? 'Stock bajo' : 'Disponible'} tone={low ? 'gold' : 'green'} />
              </View>
              <View style={styles.stockRow}>
                <View>
                  <Text style={styles.stockLabel}>Existencia</Text>
                  <Text style={styles.stockValue}>
                    {formatStock(product, product.stockQuantity)}
                  </Text>
                </View>
                <View style={styles.priceCopy}>
                  <Text style={styles.stockLabel}>Precio actual</Text>
                  <Text style={styles.priceValue}>
                    S/ {(product.priceCents / 100).toFixed(2)} / {formatPricingUnit(product)}
                  </Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(ratio * 100, 3)}%` }, low && styles.progressFillLow]} />
              </View>
              <Text style={styles.minimum}>
                Mínimo recomendado: {formatStock(product, product.minimumStockQuantity)}
              </Text>
            </View>
          );
        })}
      </View>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  feedbackCard: { gap: 12, padding: 18 },
  feedbackTitle: { color: BrandColors.text, fontSize: 15, fontWeight: '800' },
  feedbackText: { color: BrandColors.muted, fontSize: 11, lineHeight: 17 },
  metricRow: { flexDirection: 'row', gap: 12 },
  metricCard: { flex: 1, padding: 15 },
  alertMetric: { backgroundColor: BrandColors.goldLight, borderColor: '#E8D68F' },
  metricLabel: { color: BrandColors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  alertLabel: { color: BrandColors.warning, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  metricValue: { color: BrandColors.text, fontSize: 22, fontWeight: '900', marginTop: 7 },
  alertValue: { color: BrandColors.warning, fontSize: 22, fontWeight: '900', marginTop: 7 },
  searchWrap: { height: 50, borderRadius: 15, borderWidth: 1, borderColor: BrandColors.line, backgroundColor: BrandColors.white, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 9 },
  searchInput: { flex: 1, color: BrandColors.text, fontSize: 14, paddingVertical: 0 },
  resultCount: { color: BrandColors.muted, fontSize: 11, fontWeight: '700' },
  list: { gap: 11 },
  productCard: { padding: 15 },
  productTop: { flexDirection: 'row', alignItems: 'center' },
  iconWrap: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: BrandColors.greenLight },
  iconWrapLow: { backgroundColor: BrandColors.goldLight },
  productCopy: { flex: 1, marginHorizontal: 11 },
  productName: { color: BrandColors.text, fontSize: 14, fontWeight: '800' },
  productMeta: { color: BrandColors.muted, fontSize: 10, marginTop: 3 },
  stockRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 15 },
  priceCopy: { alignItems: 'flex-end' },
  stockLabel: { color: BrandColors.muted, fontSize: 10 },
  stockValue: { color: BrandColors.text, fontSize: 16, fontWeight: '900', marginTop: 3 },
  priceValue: { color: BrandColors.greenDark, fontSize: 13, fontWeight: '800', marginTop: 4 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#E9ECE8', overflow: 'hidden', marginTop: 13 },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: BrandColors.green },
  progressFillLow: { backgroundColor: BrandColors.gold },
  minimum: { color: BrandColors.muted, fontSize: 9, marginTop: 6 },
});
