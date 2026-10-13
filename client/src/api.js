import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

const api = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
  timeout: 12000
});

let onUnauthorized = null;

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

api.interceptors.request.use((config) => {
  const stored = window.localStorage.getItem("dishdash.session");
  if (stored) {
    try {
      const session = JSON.parse(stored);
      if (session.token) {
        config.headers.Authorization = `Bearer ${session.token}`;
      }
    } catch {
      window.localStorage.removeItem("dishdash.session");
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const stored = window.localStorage.getItem("dishdash.session");
    if (error.response?.status === 401 && stored && onUnauthorized) {
      onUnauthorized();
    }
    return Promise.reject(error);
  }
);

export function getErrorMessage(error, fallback = "Something went wrong.") {
  const message = error.response?.data?.message;
  const validationMessage = error.response?.data?.errors?.[0]?.msg;
  if (validationMessage) return validationMessage;
  if (message) return message;
  if (error.code === "ECONNABORTED")
    return "The server took too long to respond.";
  if (!error.response)
    return "Could not connect to the server. Check that the API is running.";
  return fallback;
}

export default api;
