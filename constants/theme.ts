import { Platform } from 'react-native';

export const BrandColors = {
  ink: '#101511',
  inkSoft: '#1B241D',
  green: '#2F6B3A',
  greenDark: '#1F4E2A',
  greenLight: '#E4F0E5',
  gold: '#C9A227',
  goldLight: '#F6EBC8',
  cream: '#F7F5EE',
  white: '#FFFFFF',
  text: '#172019',
  muted: '#69736B',
  line: '#E3E5DF',
  danger: '#A33A32',
  dangerLight: '#FBE9E7',
  warning: '#936D12',
} as const;

export const Colors = {
  light: {
    text: BrandColors.text,
    background: BrandColors.cream,
    tint: BrandColors.green,
    icon: BrandColors.muted,
    tabIconDefault: '#8A918B',
    tabIconSelected: BrandColors.green,
  },
  dark: {
    text: BrandColors.text,
    background: BrandColors.cream,
    tint: BrandColors.green,
    icon: BrandColors.muted,
    tabIconDefault: '#8A918B',
    tabIconSelected: BrandColors.green,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
