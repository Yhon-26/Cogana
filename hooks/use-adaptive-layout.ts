import { useWindowDimensions } from 'react-native';

import { Breakpoints, Spacing } from '@/constants/theme';

export type WindowSizeClass = 'compact' | 'medium' | 'expanded';

/**
 * Clases de ancho compartidas para que teléfono, tablet y web adapten la
 * composición sin convertir cada pantalla en un conjunto de breakpoints.
 */
export function useAdaptiveLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  const isExpanded = width >= Breakpoints.expanded;
  const isMedium = width >= Breakpoints.medium;
  const sizeClass: WindowSizeClass = isExpanded
    ? 'expanded'
    : isMedium
      ? 'medium'
      : 'compact';

  return {
    width,
    height,
    fontScale,
    sizeClass,
    isMedium,
    isExpanded,
    isLandscape: width > height,
    gutter: isExpanded ? Spacing.xxl : isMedium ? Spacing.xl : Spacing.md,
  } as const;
}
