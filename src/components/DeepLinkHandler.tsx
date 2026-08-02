import { useEffect } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router-dom";

const routeForUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "upsala.ch") return null;
    const match = /^\/join\/([A-Z0-9]{8})\/?$/i.exec(url.pathname);
    return match ? `/join/${match[1].toUpperCase()}` : null;
  } catch {
    return null;
  }
};

export function DeepLinkHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    let removeListener: (() => Promise<void>) | undefined;
    void App.addListener("appUrlOpen", ({ url }) => {
      const route = routeForUrl(url);
      if (route) navigate(route);
    }).then((listener) => {
      if (!active) void listener.remove();
      else removeListener = () => listener.remove();
    });
    void App.getLaunchUrl().then((launch) => {
      const route = launch?.url ? routeForUrl(launch.url) : null;
      if (active && route) navigate(route, { replace: true });
    });
    return () => {
      active = false;
      if (removeListener) void removeListener();
    };
  }, [navigate]);
  return null;
}
