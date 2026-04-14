(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push(["chunks/[root-of-the-server]__489dd2f5._.js",
"[externals]/node:buffer [external] (node:buffer, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:buffer", () => require("node:buffer"));

module.exports = mod;
}),
"[project]/metacto/metacto-internal/context-stack/packages/core/src/instrumentation.ts [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "onRequestError",
    ()=>onRequestError,
    "register",
    ()=>register
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$nextjs$2f$build$2f$esm$2f$common$2f$captureRequestError$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/esm/common/captureRequestError.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$console$2d$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/logs/console-integration.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$nextjs$2f$build$2f$esm$2f$edge$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/esm/edge/index.js [instrumentation-edge] (ecmascript) <locals>");
globalThis["__SENTRY_SERVER_MODULES__"] = {
    "@anthropic-ai/sdk": "^0.88.0",
    "@clerk/localizations": "^3.37.2",
    "@clerk/nextjs": "^6.39.0",
    "@clerk/themes": "^2.4.57",
    "@compiles/sdk": "*",
    "@hookform/resolvers": "^5.2.2",
    "@logtape/logtape": "^2.0.4",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@orpc/client": "^1.13.6",
    "@orpc/server": "^1.13.6",
    "@radix-ui/react-accordion": "^1.2.12",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-icons": "^1.3.2",
    "@radix-ui/react-label": "^2.1.8",
    "@radix-ui/react-popover": "^1.1.15",
    "@radix-ui/react-separator": "^1.1.8",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-tooltip": "^1.2.8",
    "@sentry/nextjs": "^10.42.0",
    "@t3-oss/env-nextjs": "^0.13.10",
    "@tanstack/react-table": "^8.21.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "dotenv": "^17.4.2",
    "drizzle-orm": "^0.45.1",
    "langfuse": "^3.38.6",
    "lucide-react": "^0.577.0",
    "next": "^16.1.6",
    "next-intl": "^4.8.3",
    "next-themes": "^0.4.6",
    "openai": "^6.32.0",
    "pg": "^8.20.0",
    "radix-ui": "^1.4.3",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-hook-form": "^7.71.2",
    "react-markdown": "^10.1.0",
    "remark-gfm": "^4.0.1",
    "stripe": "^18.5.0",
    "tailwind-merge": "^3.5.0",
    "yaml": "^2.8.3",
    "zod": "^4.3.6",
    "@chromatic-com/playwright": "^0.12.8",
    "@clerk/testing": "^1.14.3",
    "@electric-sql/pglite": "^0.3.15",
    "@electric-sql/pglite-socket": "^0.0.20",
    "@faker-js/faker": "^10.3.0",
    "@lingual/i18n-check": "^0.8.19",
    "@next/bundle-analyzer": "^16.1.6",
    "@playwright/test": "^1.58.2",
    "@spotlightjs/spotlight": "^4.10.0",
    "@storybook/addon-a11y": "^10.2.15",
    "@storybook/addon-docs": "^10.2.15",
    "@storybook/addon-vitest": "^10.2.15",
    "@storybook/nextjs-vite": "^10.2.15",
    "@swc/helpers": "^0.5.19",
    "@tailwindcss/postcss": "^4.2.1",
    "@tailwindcss/typography": "^0.5.19",
    "@types/node": "^25.3.5",
    "@types/pg": "^8.18.0",
    "@types/react": "^19.2.14",
    "@vitejs/plugin-react": "^5.1.4",
    "@vitest/browser": "^4.0.18",
    "@vitest/browser-playwright": "^4.0.18",
    "@vitest/coverage-v8": "^4.0.18",
    "babel-plugin-react-compiler": "^1.0.0",
    "checkly": "^7.5.2",
    "cross-env": "^10.1.0",
    "dotenv-cli": "^11.0.0",
    "drizzle-kit": "^0.31.9",
    "npm-run-all": "^4.1.5",
    "postcss": "^8.5.8",
    "postcss-load-config": "^6.0.1",
    "rimraf": "^6.1.3",
    "storybook": "^10.2.15",
    "tailwindcss": "^4.2.1",
    "tsx": "^4.21.0",
    "tw-animate-css": "^1.4.0",
    "vite-tsconfig-paths": "^6.1.1",
    "vitest": "^4.0.18",
    "vitest-browser-react": "^2.0.5"
};
globalThis["_sentryNextJsVersion"] = "16.1.6";
globalThis["_sentryRewritesTunnelPath"] = "/monitoring";
;
const sentryOptions = {
    // Sentry DSN
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // Enable Spotlight in development
    spotlight: ("TURBOPACK compile-time value", "development") === 'development',
    integrations: [
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$console$2d$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["consoleLoggingIntegration"]()
    ],
    // Adds request headers and IP for users, for more info visit
    sendDefaultPii: true,
    // Adjust this value in production, or use tracesSampler for greater control
    tracesSampleRate: 1,
    // Enable logs to be sent to Sentry
    enableLogs: true,
    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: false
};
async function register() {
    if (!process.env.NEXT_PUBLIC_SENTRY_DISABLED) {
        if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
        ;
        if ("TURBOPACK compile-time truthy", 1) {
            // Edge Sentry configuration
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$nextjs$2f$build$2f$esm$2f$edge$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$locals$3e$__["init"](sentryOptions);
        }
    }
}
const onRequestError = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$nextjs$2f$build$2f$esm$2f$common$2f$captureRequestError$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["captureRequestError"];
}),
]);

//# sourceMappingURL=%5Broot-of-the-server%5D__489dd2f5._.js.map