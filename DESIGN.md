---
version: alpha
name: Cogana
description: Sistema móvil cálido y operativo para vender, controlar y repartir abarrotes pesables en tiempo real.
colors:
  ink: "#132019"
  ink-soft: "#1D2D23"
  green: "#2E7546"
  green-dark: "#1D5634"
  green-mid: "#D4E8D8"
  green-light: "#E8F3EA"
  gold: "#F0B43C"
  gold-dark: "#9B6912"
  gold-light: "#FFF2CD"
  cream: "#F8F6EF"
  sand: "#EFE9DC"
  white: "#FFFFFF"
  surface-muted: "#F0F2ED"
  text: "#17231B"
  muted: "#5F6B62"
  muted-light: "#8A948C"
  line: "#E1E5DE"
  line-strong: "#CBD2CA"
  danger: "#A23F37"
  danger-light: "#FBEAE7"
  warning: "#836115"
  success: "#237142"
typography:
  display:
    fontSize: "34px"
    fontWeight: 800
    lineHeight: "40px"
  h1:
    fontSize: "28px"
    fontWeight: 800
    lineHeight: "34px"
  h2:
    fontSize: "22px"
    fontWeight: 800
    lineHeight: "28px"
  h3:
    fontSize: "18px"
    fontWeight: 700
    lineHeight: "24px"
  body-large:
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
  body:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "21px"
  label:
    fontSize: "13px"
    fontWeight: 700
    lineHeight: "18px"
  caption:
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  overline:
    fontSize: "11px"
    fontWeight: 800
    lineHeight: "14px"
    letterSpacing: "1.4px"
rounded:
  sm: "10px"
  md: "14px"
  lg: "18px"
  xl: "24px"
  round: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
  xxxl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "56px"
  button-accent:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "56px"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.green-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "56px"
  button-ghost:
    backgroundColor: "{colors.green-light}"
    textColor: "{colors.green-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "56px"
  button-compact:
    backgroundColor: "{colors.green}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "48px"
  card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input-default:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text}"
    rounded: "13px"
    padding: "0 13px"
    height: "48px"
  pill-green:
    backgroundColor: "{colors.green-light}"
    textColor: "{colors.green-dark}"
    typography: "{typography.caption}"
    rounded: "{rounded.round}"
    padding: "5px 10px"
  pill-gold:
    backgroundColor: "{colors.gold-light}"
    textColor: "{colors.warning}"
    typography: "{typography.caption}"
    rounded: "{rounded.round}"
    padding: "5px 10px"
  pill-danger:
    backgroundColor: "{colors.danger-light}"
    textColor: "{colors.danger}"
    typography: "{typography.caption}"
    rounded: "{rounded.round}"
    padding: "5px 10px"
  pill-neutral:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.round}"
    padding: "5px 10px"
  navigation-item-active:
    backgroundColor: "{colors.green-light}"
    textColor: "{colors.green-dark}"
    rounded: "16px"
    height: "58px"
  quantity-stepper:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "4px"
    height: "48px"
  product-visual-default:
    backgroundColor: "{colors.green-light}"
    textColor: "{colors.green}"
    rounded: "19px"
    size: "64px"
---


