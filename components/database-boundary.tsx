import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandColors } from '@/constants/theme';

type DatabaseBoundaryState = {
  error: Error | null;
};

export class DatabaseErrorBoundary extends Component<PropsWithChildren, DatabaseBoundaryState> {
  state: DatabaseBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): DatabaseBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('No se pudo iniciar la base local de Coguana.', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.card}>
            <Text style={styles.title}>No se pudo abrir el almacenamiento local</Text>
            <Text style={styles.description}>
              Cierra y vuelve a abrir la aplicación. Tus datos existentes no se eliminaron.
            </Text>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

export function DatabaseLoadingScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>COGUANA</Text>
        <Text style={styles.title}>Preparando almacenamiento local…</Text>
        <Text style={styles.description}>Verificando productos e inventario.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BrandColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    backgroundColor: BrandColors.white,
    padding: 22,
  },
  eyebrow: {
    color: BrandColors.gold,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.8,
    marginBottom: 10,
  },
  title: {
    color: BrandColors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  description: {
    color: BrandColors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
  },
});
