import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { io } from "socket.io-client";
import { useAuth } from "./auth.jsx";

const RealtimeContext = createContext(null);

function getSocketOrigin() {
  if (import.meta.env.VITE_SOCKET_URL) return import.meta.env.VITE_SOCKET_URL;
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
  return apiUrl.replace(/\/api\/?$/, "");
}

export function RealtimeProvider({ children }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [updates, setUpdates] = useState([]);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      setConnected(false);
      setUpdates([]);
      setToasts([]);
      return undefined;
    }

    setUpdates([]);
    setToasts([]);
    const client = io(getSocketOrigin(), {
      auth: { token },
      transports: ["websocket", "polling"]
    });
    setSocket(client);
    client.on("connect", () => setConnected(true));
    client.on("disconnect", () => setConnected(false));
    client.on("order:updated", (update) => {
      const notice = {
        ...update,
        receivedAt: new Date().toISOString(),
        notificationId: `${update.orderId}-${update.status}-${Date.now()}`
      };
      setUpdates((current) => [notice, ...current].slice(0, 12));
      setToasts((current) => [notice, ...current].slice(0, 3));
      window.setTimeout(() => {
        setToasts((current) =>
          current.filter((item) => item.notificationId !== notice.notificationId)
        );
      }, 5000);
    });
    return () => {
      client.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [token]);

  const clearUpdates = useCallback(() => setUpdates([]), []);
  const value = useMemo(
    () => ({ socket, connected, updates, clearUpdates }),
    [socket, connected, updates, clearUpdates]
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="pointer-events-none fixed right-4 top-20 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        >
          {toasts.map((update) => (
            <div
              className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg"
              key={update.notificationId}
            >
              Order #{String(update.orderId).slice(-8).toUpperCase()} is now{" "}
              {update.status}.
            </div>
          ))}
        </div>
      )}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime must be used within a RealtimeProvider");
  }
  return context;
}
