import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PropsWithChildren, ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandColors } from '@/constants/theme';

type ScreenProps = PropsWithChildren<{
  eyebrow?: string;
  title: string;
  subtitle: string;
  right?: ReactNode;
  scroll?: boolean;
}>;

export function AdminScreen({ eyebrow = 'COGUANA', title, subtitle, right, children, scroll = true }: ScreenProps) {
  const content = (
    <>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {right}
      </View>
      <View style={styles.body}>{children}</View>
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {content}
        </ScrollView>
      ) : content}
    </SafeAreaView>
  );
}

export function SectionTitle({ children, action }: PropsWithChildren<{ action?: ReactNode }>) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

export function Pill({ label, tone = 'green' }: { label: string; tone?: 'green' | 'gold' | 'danger' | 'neutral' }) {
  const toneStyle = {
    green: styles.pillGreen,
    gold: styles.pillGold,
    danger: styles.pillDanger,
    neutral: styles.pillNeutral,
  }[tone];
  const textToneStyle = {
    green: styles.pillGreenText,
    gold: styles.pillGoldText,
    danger: styles.pillDangerText,
    neutral: styles.pillNeutralText,
  }[tone];

  return (
    <View style={[styles.pill, toneStyle]}>
      <Text style={[styles.pillText, textToneStyle]}>{label}</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  icon,
  onPress,
  disabled = false,
  style,
}: {
  label: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        style,
        disabled && styles.primaryButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}>
      {icon ? <MaterialCommunityIcons name={icon} size={20} color={BrandColors.white} /> : null}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export const sharedStyles = StyleSheet.create({
  card: {
    backgroundColor: BrandColors.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BrandColors.line,
    padding: 16,
  },
  shadow: {
    elevation: 3,
    shadowColor: BrandColors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: BrandColors.ink },
  scrollContent: { flexGrow: 1, backgroundColor: BrandColors.cream, paddingBottom: 28 },
  header: {
    backgroundColor: BrandColors.ink,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCopy: { flex: 1, paddingRight: 12 },
  eyebrow: { color: BrandColors.gold, fontWeight: '900', fontSize: 12, letterSpacing: 2.1 },
  title: { color: BrandColors.white, fontSize: 28, lineHeight: 34, fontWeight: '800', marginTop: 7 },
  subtitle: { color: '#BAC2BC', fontSize: 13, lineHeight: 19, marginTop: 4 },
  body: { padding: 18, gap: 18 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: BrandColors.text, fontSize: 18, fontWeight: '800' },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 11, fontWeight: '800' },
  pillGreen: { backgroundColor: BrandColors.greenLight },
  pillGreenText: { color: BrandColors.greenDark },
  pillGold: { backgroundColor: BrandColors.goldLight },
  pillGoldText: { color: BrandColors.warning },
  pillDanger: { backgroundColor: BrandColors.dangerLight },
  pillDangerText: { color: BrandColors.danger },
  pillNeutral: { backgroundColor: '#EEF0ED' },
  pillNeutralText: { color: BrandColors.muted },
  primaryButton: {
    minHeight: 52,
    borderRadius: 15,
    backgroundColor: BrandColors.green,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
  },
  primaryButtonDisabled: { opacity: 0.42 },
  primaryButtonText: { color: BrandColors.white, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
});
