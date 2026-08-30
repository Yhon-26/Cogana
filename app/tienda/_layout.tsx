import { Stack } from "expo-router";

import { CartProvider } from "@/context/cart-context";
import { useAppStackScreenOptions } from "@/hooks/use-app-stack-screen-options";

export default function OnlineStoreLayout() {
  const screenOptions = useAppStackScreenOptions();

  return (
    <CartProvider>
      <Stack screenOptions={screenOptions} />
    </CartProvider>
  );
}
