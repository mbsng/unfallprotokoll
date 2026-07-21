import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./i18n";
import "./globals.css";

createRoot(document.getElementById("root")!).render(<App />);
