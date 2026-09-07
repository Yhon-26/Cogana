import { Platform } from 'react-native';

export const BrandColors = {
  ink: '#132019',
  inkSoft: '#1D2D23',
  green: '#2E7546',
  greenDark: '#1D5634',
  greenMid: '#D4E8D8',
  greenLight: '#E8F3EA',
  gold: '#F0B43C',
  offer: '#C2410C',
  offerSoft: '#FFF1E7',
  goldDark: '#9B6912',
  goldLight: '#FEF3E7',
  cream: '#F8F9FA',
  sand: '#EEF1F4',
  white: '#FFFFFF',
  surfaceMuted: '#F1F5F9',
  text: '#17231B',
  muted: '#5F6B62',
  mutedLight: '#8A948C',
  line: '#E2E8F0',
  lineStrong: '#CBD5E1',
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
  sm: 6,
  md: 8,
  lg: 8,
  xl: 12,
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
  inputRadius: 8,
  navigationItemRadius: 8,
  navigationItemHeight: 58,
  productVisualRadius: 8,
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

// La interfaz es un marco invisible: sin sombras difusas. La separación se
// logra con espaciado y líneas de 1px (BrandColors.line).
export const Elevation = {
  ambientCard: {},
  dockUpward: {},
  tabUpward: {},
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
  display: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800' as const,
    fontFamily: 'Outfit_800ExtraBold',
  },
  h1: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800' as const,
    fontFamily: 'Outfit_800ExtraBold',
  },
  h2: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800' as const,
    fontFamily: 'Outfit_800ExtraBold',
  },
  h3: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700' as const,
    fontFamily: 'Outfit_700Bold',
  },
  bodyLarge: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
    fontFamily: 'PlusJakartaSans_400Regular',
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '400' as const,
    fontFamily: 'PlusJakartaSans_400Regular',
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600' as const,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
    fontFamily: 'PlusJakartaSans_500Medium',
  },
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
    fontFamily: 'PlusJakartaSans_700Bold',
  },
  // Precios: el elemento más visible de la tarjeta de producto
  price: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800' as const,
    fontFamily: 'Outfit_800ExtraBold',
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
