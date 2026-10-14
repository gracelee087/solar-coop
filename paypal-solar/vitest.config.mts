import { defineConfig } from "vitest/config";

// Only for rendering React components in tests (tsconfig keeps "jsx": "preserve" for Next.js).
export default defineConfig({ esbuild: { jsx: "automatic" } });
