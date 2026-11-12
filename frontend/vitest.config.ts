import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside a server bundle; stub it so unit tests of
      // server-only modules (turnstile, supabase/service) can import them.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "e2e/**/*.test.ts"],
  },
});
