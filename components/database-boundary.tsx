import { Component, type ErrorInfo, type PropsWithChildren, useEffect, useRef } from "react";
import { StatusBar } from "expo-status-bar";
import { Animated, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";

import { PrimaryButton, sharedStyles } from "@/components/admin-ui";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BrandColors, Layout, Spacing, Typography } from "@/constants/theme";

type DatabaseBoundaryState = {
  error: Error | null;
};

export class DatabaseErrorBoundary extends Component<
  PropsWithChildren,
  DatabaseBoundaryState
> {
  state: DatabaseBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): DatabaseBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "No se pudo iniciar la base local de Coguana.",
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView style={styles.container}>
          <StatusBar style="light" />
          <View style={[sharedStyles.card, styles.card]}>
            <Text accessibilityRole="header" style={styles.title}>
              No se pudo abrir el almacenamiento de Coguana
            </Text>
            <Text accessibilityRole="alert" style={styles.description}>
              Cierra y vuelve a abrir la aplicación. Tus datos existentes no se
              eliminaron.
            </Text>
            <PrimaryButton
              label="Reintentar"
              onPress={() => this.setState({ error: null })}
              style={styles.retryButton}
            />
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

export function DatabaseLoadingScreen() {
  const leaf1 = useRef(new Animated.Value(0)).current;
  const leaf2 = useRef(new Animated.Value(0)).current;
  const leaf3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    SplashScreen.hideAsync();
    const startAnim = (anim: Animated.Value, delay: number) => {
      setTimeout(() => {
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue: 1,
              duration: 750,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0,
              duration: 750,
              useNativeDriver: true,
            }),
          ])
        ).start();
      }, delay);
    };

    startAnim(leaf1, 0);
    startAnim(leaf2, 300);
    startAnim(leaf3, 600);
  }, [leaf1, leaf2, leaf3]);

  const getStyle = (anim: Animated.Value) => ({
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.1] }) }],
  });

  return (
    <SafeAreaView style={styles.splashContainer}>
      <StatusBar style="dark" />
      <View style={styles.splashCenter}>
        <View style={styles.splashLogoGroup}>
          <Text style={styles.splashTitle}>Cogana</Text>
          <View style={styles.leavesRow}>
            <Animated.View style={getStyle(leaf1)}>
              <MaterialCommunityIcons name="leaf" size={42} color={BrandColors.green} />
            </Animated.View>
            <Animated.View style={getStyle(leaf2)}>
              <MaterialCommunityIcons name="leaf" size={42} color={BrandColors.green} />
            </Animated.View>
            <Animated.View style={getStyle(leaf3)}>
              <MaterialCommunityIcons name="leaf" size={42} color={BrandColors.green} />
            </Animated.View>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BrandColors.ink,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: Layout.dialogMaxWidth,
    gap: Spacing.sm,
    backgroundColor: BrandColors.white,
    padding: Spacing.xl,
    borderRadius: 16,
  },
  title: {
    color: BrandColors.text,
    ...Typography.h3,
  },
  description: {
    color: BrandColors.muted,
    ...Typography.body,
  },
  retryButton: {
    marginTop: Spacing.xs,
  },
  splashContainer: {
    flex: 1,
    backgroundColor: BrandColors.cream,
    alignItems: "center",
  },
  splashCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  splashLogoGroup: {
    alignItems: "center",
  },
  splashTitle: {
    color: BrandColors.ink,
    ...Typography.display,
    marginBottom: Spacing.sm,
  },
  leavesRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    justifyContent: "center",
  },
});
