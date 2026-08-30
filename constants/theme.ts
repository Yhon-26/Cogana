import { Platform } from 'react-native';

export const BrandColors = {
  ink: '#132019',
  inkSoft: '#1D2D23',
  green: '#2E7546',
  greenDark: '#1D5634',
  greenMid: '#D4E8D8',
  greenLight: '#E8F3EA',
  gold: '#F0B43C',
  goldDark: '#9B6912',
  goldLight: '#FFF2CD',
  cream: '#F8F6EF',
  sand: '#EFE9DC',
  white: '#FFFFFF',
  surfaceMuted: '#F0F2ED',
  text: '#17231B',
  muted: '#5F6B62',
  mutedLight: '#8A948C',
  line: '#E1E5DE',
  lineStrong: '#CBD2CA',
  danger: '#A23F37',
  dangerLight: '#FBEAE7',
  warning: '#836115',
  success: '#237142',
} as const;

export const Spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const Radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  round: 999,
} as const;

export const ControlSize = {
  compact: 40,
  default: 48,
  large: 56,
} as const;

export const Breakpoints = {
  medium: 600,
  expanded: 1024,
} as const;

export const Layout = {
  welcomeMaxWidth: 760,
  commerceMaxWidth: 720,
  operationMaxWidth: 840,
  dialogMaxWidth: 420,
  navigationRailWidth: 112,
} as const;

export const ComponentMetrics = {
  inputRadius: 13,
  navigationItemRadius: 16,
  navigationItemHeight: 58,
  productVisualRadius: 19,
} as const;

export const Interaction = {
  disabledOpacity: 0.4,
  pressedOpacity: 0.84,
  pressedScale: 0.99,
} as const;

export const FocusRing = {
  color: BrandColors.greenMid,
  offset: 2,
  width: 3,
} as const;

function platformElevation(
  native: {
    elevation: number;
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
  },
  boxShadow: string
) {
  return Platform.OS === 'web' ? { boxShadow } : native;
}

export const Elevation = {
  ambientCard: platformElevation({
    elevation: 2,
    shadowColor: BrandColors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
  }, '0 2px 10px rgba(19, 32, 25, 0.06)'),
  dockUpward: platformElevation({
    elevation: 8,
    shadowColor: BrandColors.ink,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  }, '0 -3px 12px rgba(19, 32, 25, 0.08)'),
  tabUpward: platformElevation({
    elevation: 10,
    shadowColor: BrandColors.ink,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
  }, '0 -3px 10px rgba(19, 32, 25, 0.07)'),
} as const;

export const ProductPalette = {
  grain: { background: '#F7EACB', foreground: '#956B16' },
  beverage: { background: '#DCEEF1', foreground: '#2D7080' },
  home: { background: '#E4E7F6', foreground: '#575E9A' },
  bakery: { background: '#F9E2D7', foreground: '#A25334' },
  pantry: { background: '#E2EDD9', foreground: '#4E7839' },
} as const;

export const OverlayColors = {
  modal: 'rgba(19, 32, 25, 0.56)',
  onDarkSoft: 'rgba(255, 255, 255, 0.12)',
} as const;

export const Typography = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800' as const },
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '800' as const },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: '800' as const },
  h3: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  bodyLarge: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  body: { fontSize: 14, lineHeight: 21, fontWeight: '400' as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '700' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800' as const,
    letterSpacing: 1.4,
  },
} as const;

export const Colors = {
  light: {
    text: BrandColors.text,
    background: BrandColors.cream,
    tint: BrandColors.green,
    icon: BrandColors.muted,
    tabIconDefault: BrandColors.mutedLight,
    tabIconSelected: BrandColors.green,
  },
  dark: {
    text: BrandColors.text,
    background: BrandColors.cream,
    tint: BrandColors.green,
    icon: BrandColors.muted,
    tabIconDefault: BrandColors.mutedLight,
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
