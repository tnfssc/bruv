import { BellIcon, BellOffIcon, QrCodeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "@/state/use-store";
import { Button } from "./ui/button";

const key = new URLSearchParams(location.search).get("t") ?? "";
const withKey = (path: string) => `${path}?t=${encodeURIComponent(key)}`;
const installed =
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const desktop = matchMedia("(pointer: fine)").matches;
/** Push needs a secure page (https, or localhost) and, on phones, the installed app (iOS allows no other). */
const canPush =
  isSecureContext &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window &&
  (installed || desktop);

const bytes = (base64url: string) => {
  const text = atob(base64url.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
};
const same = (a: ArrayBuffer | null | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.length && new Uint8Array(a).every((byte, index) => byte === b[index]);

const post = (path: string, body: unknown) =>
  fetch(withKey(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

type Push = "unknown" | "off" | "on" | "denied" | "busy";

/**
 * Whether this device gets the assistant's news as notifications. A subscription found at load is sent
 * again, so the server has it even if its file was lost; it writes only when something changed.
 */
function usePush() {
  const [state, setState] = useState<Push>("unknown");
  useEffect(() => {
    if (!canPush) return;
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    void navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.pushManager.getSubscription())
      .then((sub) => {
        if (sub && Notification.permission === "granted") void post("/push/subscribe", sub.toJSON()).catch(() => {});
        setState(sub && Notification.permission === "granted" ? "on" : "off");
      })
      .catch(() => setState("off"));
  }, []);

  // Asked from a tap: iOS shows the permission prompt only then.
  const turnOn = async () => {
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const { key: serverKey } = (await (await fetch(withKey("/push/key"))).json()) as { key: string };
      const wanted = bytes(serverKey);
      let sub = await registration.pushManager.getSubscription();
      // A subscription made with another server key can't be used; start over.
      if (sub && !same(sub.options.applicationServerKey, wanted)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
      const saved = await post("/push/subscribe", sub.toJSON());
      setState(saved.ok ? "on" : "off");
    } catch {
      setState("off");
    }
  };

  const turnOff = async () => {
    setState("busy");
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) {
        await post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
    } finally {
      setState("off");
    }
  };
  return { state, turnOn, turnOff };
}

/**
 * The phone's QR code, while a tunnel serves the page. Asked for when the socket (re)connects and when the
 * page comes to the front, and once more a little after load, since the tunnel takes a few seconds to come up.
 */
function useQr(enabled: boolean) {
  const online = useStore((state) => state.online);
  const [svg, setSvg] = useState<string>();
  useEffect(() => {
    if (!enabled || !online) return;
    let live = true;
    const check = () =>
      fetch(withKey("/qr.svg"), { cache: "no-store" })
        .then((response) => (response.ok ? response.text() : undefined))
        .then((text) => live && setSvg(text))
        .catch(() => {});
    void check();
    const later = setTimeout(check, 15_000);
    const front = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", front);
    return () => {
      live = false;
      clearTimeout(later);
      document.removeEventListener("visibilitychange", front);
    };
  }, [enabled, online]);
  return svg;
}

/** For the phone: a QR code to open the page there (on a computer), and notifications for news. */
export function Phone() {
  const push = usePush();
  const svg = useQr(desktop && !installed);
  const [shown, setShown] = useState(false);
  const pushing = canPush && push.state !== "unknown";
  if (!svg && !pushing) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {svg ? (
          <Button variant="ghost" size="sm" aria-expanded={shown} onClick={() => setShown(!shown)}>
            <QrCodeIcon className="size-4" />
            Open on your phone
          </Button>
        ) : null}
        {!pushing ? null : push.state === "denied" ? (
          <span className="px-2 text-[13px] text-muted-foreground">Notifications are blocked in this browser</span>
        ) : push.state === "on" ? (
          <Button variant="ghost" size="sm" onClick={push.turnOff}>
            <BellOffIcon className="size-4" />
            Stop notifications
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={push.state === "busy"} onClick={push.turnOn}>
            <BellIcon className="size-4" />
            Notify me
          </Button>
        )}
      </div>
      {svg && shown ? (
        <img
          src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
          alt="QR code for this page on your phone"
          className="size-40 self-center rounded-md bg-white"
        />
      ) : null}
    </div>
  );
}
