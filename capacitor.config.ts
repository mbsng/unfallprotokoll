import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ch.upsala.app",
  appName: "Upsala.ch",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  ios: {
    scheme: "Upsala",
    contentInset: "automatic",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
