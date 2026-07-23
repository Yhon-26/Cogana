import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AdminScreen, Pill, SectionTitle, sharedStyles } from '@/components/admin-ui';
import { BrandColors } from '@/constants/theme';
import { OrderStatus, useStore } from '@/context/store-context';

const nextLabel: Record<OrderStatus, string | null> = {
  Pendiente: 'Empezar preparación',
  Preparando: 'Marcar como listo',
  Listo: 'Marcar entregado',
  Entregado: null,
};

function statusTone(status: OrderStatus): 'green' | 'gold' | 'neutral' {
  if (status === 'Listo') return 'green';
  if (status === 'Entregado') return 'neutral';
  return 'gold';
}

export default function OrdersScreen() {
  const { orders, advanceOrder } = useStore();
  const [filter, setFilter] = useState<'Activos' | 'Todos'>('Activos');
  const visibleOrders = filter === 'Activos' ? orders.filter((order) => order.status !== 'Entregado') : orders;
  const pending = orders.filter((order) => order.status === 'Pendiente').length;
  const ready = orders.filter((order) => order.status === 'Listo').length;

  return (
    <AdminScreen title="Pedidos" subtitle="Organiza la preparación y entrega de pedidos">
      <View style={styles.metricsRow}>
        <View style={[sharedStyles.card, styles.metricCard]}>
          <MaterialCommunityIcons name="timer-sand" size={21} color={BrandColors.warning} />
          <Text style={styles.metricValue}>{pending}</Text>
          <Text style={styles.metricLabel}>Por iniciar</Text>
        </View>
        <View style={[sharedStyles.card, styles.metricCard]}>
          <MaterialCommunityIcons name="package-variant-closed-check" size={21} color={BrandColors.green} />
          <Text style={styles.metricValue}>{ready}</Text>
          <Text style={styles.metricLabel}>Listos para entregar</Text>
        </View>
      </View>

      <View style={styles.filterWrap}>
        {(['Activos', 'Todos'] as const).map((item) => (
          <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filterButton, filter === item && styles.filterButtonActive]}>
            <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>

      <SectionTitle action={<Text style={styles.orderCount}>{visibleOrders.length} pedidos</Text>}>
        Pedidos de hoy
      </SectionTitle>
      <View style={styles.orderList}>
        {visibleOrders.map((order) => {
          const actionLabel = nextLabel[order.status];
          return (
            <View key={order.id} style={[sharedStyles.card, styles.orderCard]}>
              <View style={styles.orderHeader}>
                <View>
                  <Text style={styles.orderId}>{order.id}</Text>
                  <Text style={styles.orderTime}>{order.time}</Text>
                </View>
                <Pill label={order.status} tone={statusTone(order.status)} />
              </View>
              <View style={styles.separator} />
              <Text style={styles.customer}>{order.customer}</Text>
              <Text style={styles.summary}>{order.summary}</Text>
              <View style={styles.orderFooter}>
                <View>
                  <Text style={styles.totalLabel}>TOTAL</Text>
                  <Text style={styles.totalValue}>S/ {order.total.toFixed(2)}</Text>
                </View>
                {actionLabel ? (
                  <Pressable
                    onPress={() => advanceOrder(order.id)}
                    style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
                    <Text style={styles.actionText}>{actionLabel}</Text>
                    <MaterialCommunityIcons name="arrow-right" size={17} color={BrandColors.white} />
                  </Pressable>
                ) : (
                  <View style={styles.completedMark}>
                    <MaterialCommunityIcons name="check" size={17} color={BrandColors.green} />
                    <Text style={styles.completedText}>Completado</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}
        {visibleOrders.length === 0 ? (
          <View style={[sharedStyles.card, styles.emptyState]}>
            <MaterialCommunityIcons name="clipboard-check-outline" size={36} color={BrandColors.green} />
            <Text style={styles.emptyTitle}>Todo al día</Text>
            <Text style={styles.emptyText}>No quedan pedidos activos.</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.localNotice}>Los estados se actualizan únicamente durante esta sesión.</Text>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  metricsRow: { flexDirection: 'row', gap: 12 },
  metricCard: { flex: 1, padding: 15 },
  metricValue: { color: BrandColors.text, fontSize: 23, fontWeight: '900', marginTop: 7 },
  metricLabel: { color: BrandColors.muted, fontSize: 10, marginTop: 2 },
  filterWrap: { flexDirection: 'row', backgroundColor: '#E8EBE6', borderRadius: 14, padding: 4 },
  filterButton: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  filterButtonActive: { backgroundColor: BrandColors.white, elevation: 1 },
  filterText: { color: BrandColors.muted, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: BrandColors.greenDark, fontWeight: '900' },
  orderCount: { color: BrandColors.muted, fontSize: 11, fontWeight: '700' },
  orderList: { gap: 11 },
  orderCard: { padding: 16 },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  orderId: { color: BrandColors.greenDark, fontSize: 13, fontWeight: '900', letterSpacing: 0.6 },
  orderTime: { color: BrandColors.muted, fontSize: 10, marginTop: 3 },
  separator: { height: 1, backgroundColor: BrandColors.line, marginVertical: 13 },
  customer: { color: BrandColors.text, fontSize: 15, fontWeight: '800' },
  summary: { color: BrandColors.muted, fontSize: 11, marginTop: 5 },
  orderFooter: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 17 },
  totalLabel: { color: BrandColors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  totalValue: { color: BrandColors.text, fontSize: 18, fontWeight: '900', marginTop: 3 },
  actionButton: { minHeight: 39, borderRadius: 12, backgroundColor: BrandColors.green, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 5 },
  actionText: { color: BrandColors.white, fontSize: 10, fontWeight: '800' },
  completedMark: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 8 },
  completedText: { color: BrandColors.green, fontSize: 11, fontWeight: '800' },
  emptyState: { alignItems: 'center', paddingVertical: 25 },
  emptyTitle: { color: BrandColors.text, fontSize: 15, fontWeight: '800', marginTop: 8 },
  emptyText: { color: BrandColors.muted, fontSize: 11, marginTop: 3 },
  localNotice: { color: BrandColors.muted, fontSize: 10, textAlign: 'center' },
  pressed: { opacity: 0.78 },
});
