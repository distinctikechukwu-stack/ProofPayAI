import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: "../..",
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "ag-grid",
              test: /node_modules[\\/]ag-grid-community[\\/]/,
              minSize: 100_000,
              maxSize: 400_000,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
