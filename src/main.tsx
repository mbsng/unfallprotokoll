import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./i18n";
import "./globals.css";

if (!Capacitor.isNativePlatform()) registerSW({ immediate: true });
createRoot(document.getElementById("root")!).render(<App />);
