import "dotenv/config";
import { createServer } from "node:http";
import app from "./app.js";
import { connectDatabase } from "./config/database.js";
import { initializeRealtime } from "./services/realtime.js";

const port = Number(process.env.PORT || 4000);

try {
  await connectDatabase();
  const httpServer = createServer(app);
  initializeRealtime(httpServer);
  httpServer.listen(port, () => {
    console.log(`Food marketplace API listening on port ${port}`);
  });
} catch (error) {
  console.error("Failed to start the API.", {
    name: error?.name || "Error",
    code: error?.code || "UNKNOWN"
  });
  process.exitCode = 1;
}
