export function getAllowedOrigins(
  value = process.env.CLIENT_ORIGIN || "http://localhost:5173"
) {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
