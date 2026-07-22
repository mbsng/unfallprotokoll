import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./i18n";
import "./globals.css";

registerSW({ immediate: true });
createRoot(document.getElementById("root")!).render(<App />);
