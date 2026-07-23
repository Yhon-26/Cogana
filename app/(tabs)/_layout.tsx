import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { BrandColors } from '@/constants/theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

function TabIcon({ name, color }: { name: IconName; color: string }) {
  return <MaterialCommunityIcons name={name} size={23} color={color} />;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: BrandColors.green,
        tabBarInactiveTintColor: '#808981',
        tabBarButton: HapticTab,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', marginTop: 1 },
        tabBarStyle: {
          height: 70,
          paddingTop: 8,
          paddingBottom: 8,
          backgroundColor: BrandColors.white,
          borderTopColor: BrandColors.line,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color }) => <TabIcon name="view-dashboard-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="venta"
        options={{
          title: 'Venta',
          tabBarIcon: ({ color }) => <TabIcon name="cart-plus" color={color} />,
        }}
      />
      <Tabs.Screen
        name="inventario"
        options={{
          title: 'Inventario',
          tabBarIcon: ({ color }) => <TabIcon name="warehouse" color={color} />,
        }}
      />
      <Tabs.Screen
        name="pedidos"
        options={{
          title: 'Pedidos',
          tabBarIcon: ({ color }) => <TabIcon name="clipboard-list-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="precios"
        options={{
          title: 'Precios',
          tabBarIcon: ({ color }) => <TabIcon name="tag-outline" color={color} />,
        }}
      />
    </Tabs>
  );
}
