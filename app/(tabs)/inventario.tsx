import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AdminScreen, Pill, SectionTitle, sharedStyles } from '@/components/admin-ui';
import { BrandColors } from '@/constants/theme';
import { useStore } from '@/context/store-context';

export default function InventoryScreen() {
  const { products } = useStore();
  const [query, setQuery] = useState('');
  const lowStock = products.filter((product) => product.stockKg <= product.minimumKg).length;
  const totalStock = products.reduce((sum, product) => sum + product.stockKg, 0);
  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es-PE');
    if (!normalized) return products;
    return products.filter((product) => `${product.name} ${product.code} ${product.category}`.toLocaleLowerCase('es-PE').includes(normalized));
  }, [products, query]);

  return (
    <AdminScreen title="Inventario" subtitle="Consulta existencias y productos por reponer">
      <View style={styles.metricRow}>
        <View style={[sharedStyles.card, styles.metricCard]}>
          <Text style={styles.metricLabel}>STOCK TOTAL</Text>
          <Text style={styles.metricValue}>{totalStock.toFixed(1)} kg</Text>
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
          const low = product.stockKg <= product.minimumKg;
          const ratio = Math.min(1, product.stockKg / Math.max(product.minimumKg * 3, 1));
          return (
            <View key={product.id} style={[sharedStyles.card, styles.productCard]}>
              <View style={styles.productTop}>
                <View style={[styles.iconWrap, low && styles.iconWrapLow]}>
                  <MaterialCommunityIcons name="barley" size={23} color={low ? BrandColors.warning : BrandColors.green} />
                </View>
                <View style={styles.productCopy}>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productMeta}>{product.code} · {product.category}</Text>
                </View>
                <Pill label={low ? 'Stock bajo' : 'Disponible'} tone={low ? 'gold' : 'green'} />
              </View>
              <View style={styles.stockRow}>
                <View>
                  <Text style={styles.stockLabel}>Existencia</Text>
                  <Text style={styles.stockValue}>{product.stockKg.toFixed(2)} kg</Text>
                </View>
                <View style={styles.priceCopy}>
                  <Text style={styles.stockLabel}>Precio actual</Text>
                  <Text style={styles.priceValue}>S/ {product.pricePerKg.toFixed(2)} / kg</Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(ratio * 100, 3)}%` }, low && styles.progressFillLow]} />
              </View>
              <Text style={styles.minimum}>Mínimo recomendado: {product.minimumKg} kg</Text>
            </View>
          );
        })}
      </View>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
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
