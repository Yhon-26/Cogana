import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AdminScreen, Pill, SectionTitle, sharedStyles } from '@/components/admin-ui';
import { BrandColors } from '@/constants/theme';
import { useStore } from '@/context/store-context';

type Route = '/venta' | '/inventario' | '/pedidos' | '/precios';

const actions: {
  title: string;
  description: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  route: Route;
  accent: 'green' | 'gold';
}[] = [
  { title: 'Nueva venta', description: 'Vende por peso o monto', icon: 'cart-plus', route: '/venta', accent: 'green' },
  { title: 'Inventario', description: 'Revisa stock disponible', icon: 'warehouse', route: '/inventario', accent: 'gold' },
  { title: 'Pedidos', description: 'Prepara y entrega', icon: 'clipboard-list-outline', route: '/pedidos', accent: 'gold' },
  { title: 'Actualizar precios', description: 'Edita el precio por kilo', icon: 'tag-outline', route: '/precios', accent: 'green' },
];

export default function DashboardScreen() {
  const { products, orders, salesToday, saleCount } = useStore();
  const lowStock = products.filter((product) => product.stockKg <= product.minimumKg).length;
  const activeOrders = orders.filter((order) => order.status !== 'Entregado').length;
  const formattedDate = new Intl.DateTimeFormat('es-PE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <AdminScreen
      title="Panel administrador"
      subtitle={`${formattedDate.charAt(0).toUpperCase()}${formattedDate.slice(1)} · Santa Anita`}
      right={
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>CG</Text>
        </View>
      }>
      <View style={[sharedStyles.card, sharedStyles.shadow, styles.salesCard]}>
        <View>
          <Text style={styles.salesLabel}>VENTAS DE HOY</Text>
          <Text style={styles.salesAmount}>S/ {salesToday.toFixed(2)}</Text>
          <Text style={styles.salesCount}>{saleCount} ventas registradas</Text>
        </View>
        <View style={styles.trendIcon}>
          <MaterialCommunityIcons name="chart-line" size={27} color={BrandColors.gold} />
        </View>
      </View>

      <View style={styles.metricsRow}>
        <Pressable style={[sharedStyles.card, styles.metricCard]} onPress={() => router.push('/pedidos')}>
          <MaterialCommunityIcons name="clock-outline" size={21} color={BrandColors.green} />
          <Text style={styles.metricValue}>{activeOrders}</Text>
          <Text style={styles.metricLabel}>Pedidos activos</Text>
        </Pressable>
        <Pressable style={[sharedStyles.card, styles.metricCard]} onPress={() => router.push('/inventario')}>
          <MaterialCommunityIcons name="alert-circle-outline" size={21} color={BrandColors.warning} />
          <Text style={styles.metricValue}>{lowStock}</Text>
          <Text style={styles.metricLabel}>Stock por reponer</Text>
        </Pressable>
      </View>

      <SectionTitle>Accesos rápidos</SectionTitle>
      <View style={styles.actionGrid}>
        {actions.map((action) => (
          <Pressable
            accessibilityRole="button"
            key={action.title}
            onPress={() => router.push(action.route)}
            style={({ pressed }) => [sharedStyles.card, styles.actionCard, pressed && styles.pressed]}>
            <View style={[styles.actionIcon, action.accent === 'gold' && styles.actionIconGold]}>
              <MaterialCommunityIcons
                name={action.icon}
                size={25}
                color={action.accent === 'gold' ? BrandColors.warning : BrandColors.greenDark}
              />
            </View>
            <Text style={styles.actionTitle}>{action.title}</Text>
            <Text style={styles.actionDescription}>{action.description}</Text>
            <MaterialCommunityIcons name="arrow-right" size={19} color={BrandColors.muted} style={styles.arrow} />
          </Pressable>
        ))}
      </View>

      <SectionTitle action={<Pill label="En local" tone="green" />}>Estado de tienda</SectionTitle>
      <View style={[sharedStyles.card, styles.storeStatus]}>
        <View style={styles.statusDot} />
        <View style={styles.statusCopy}>
          <Text style={styles.statusTitle}>Caja operativa</Text>
          <Text style={styles.statusDescription}>Los movimientos de este prototipo se guardan temporalmente.</Text>
        </View>
      </View>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: BrandColors.green, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#477D50' },
  avatarText: { color: BrandColors.white, fontSize: 13, fontWeight: '900', letterSpacing: 0.8 },
  salesCard: { backgroundColor: BrandColors.greenDark, borderColor: BrandColors.greenDark, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
  salesLabel: { color: '#BFD2C2', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  salesAmount: { color: BrandColors.white, fontSize: 30, fontWeight: '900', marginTop: 6 },
  salesCount: { color: '#C9D8CB', fontSize: 12, marginTop: 5 },
  trendIcon: { width: 50, height: 50, borderRadius: 16, backgroundColor: '#315F39', alignItems: 'center', justifyContent: 'center' },
  metricsRow: { flexDirection: 'row', gap: 12 },
  metricCard: { flex: 1, padding: 15 },
  metricValue: { color: BrandColors.text, fontSize: 24, fontWeight: '900', marginTop: 9 },
  metricLabel: { color: BrandColors.muted, fontSize: 11, marginTop: 2 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  actionCard: { width: '48%', minHeight: 166, padding: 15 },
  actionIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: BrandColors.greenLight, alignItems: 'center', justifyContent: 'center' },
  actionIconGold: { backgroundColor: BrandColors.goldLight },
  actionTitle: { color: BrandColors.text, fontSize: 15, fontWeight: '800', marginTop: 13, paddingRight: 18 },
  actionDescription: { color: BrandColors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  arrow: { position: 'absolute', right: 13, bottom: 13 },
  storeStatus: { flexDirection: 'row', alignItems: 'center', padding: 15 },
  statusDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: BrandColors.green, marginRight: 12 },
  statusCopy: { flex: 1 },
  statusTitle: { color: BrandColors.text, fontSize: 14, fontWeight: '800' },
  statusDescription: { color: BrandColors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
