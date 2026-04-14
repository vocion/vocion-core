(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push(["chunks/06187_@sentry_vercel-edge_build_esm_index_32c66c7f.js",
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/vercel-edge/build/esm/index.js [instrumentation-edge] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "VercelEdgeClient",
    ()=>VercelEdgeClient,
    "getDefaultIntegrations",
    ()=>getDefaultIntegrations,
    "init",
    ()=>init,
    "vercelAIIntegration",
    ()=>vercelAIIntegration,
    "winterCGFetchIntegration",
    ()=>winterCGFetchIntegration
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$buffer__$5b$external$5d$__$28$node$3a$buffer$2c$__cjs$29$__ = /*#__PURE__*/ __turbopack_context__.i("[externals]/node:buffer [external] (node:buffer, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$server$2d$runtime$2d$client$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/server-runtime-client.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$sdkMetadata$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/sdkMetadata.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/asyncContext/index.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/hasSpansEnabled.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/dynamicSamplingContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/utils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/baggage.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/tracing.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/parseSampleRate.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeMathRandom__as__$5f$INTERNAL_safeMathRandom$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript) <export safeMathRandom as _INTERNAL_safeMathRandom>");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sampling$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/sampling.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$lru$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/lru.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracePropagationTargets$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/tracePropagationTargets.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/version.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$handleCallbackErrors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/handleCallbackErrors.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$defaultScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/defaultScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeDateNow__as__$5f$INTERNAL_safeDateNow$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript) <export safeDateNow as _INTERNAL_safeDateNow>");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debounce$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debounce.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$measurement$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/measurement.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$exports$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/exports.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$logSpans$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/logSpans.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/spanstatus.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/url.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/object.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integration.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$fetch$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/fetch.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$isSentryRequestUrl$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/isSentryRequestUrl.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$fetch$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/fetch.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/string.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$breadcrumbs$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/breadcrumbs.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$breadcrumb$2d$log$2d$level$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/breadcrumb-log-level.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$transports$2f$base$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/transports/base.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/trace.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$promisebuffer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/promisebuffer.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/stacktrace.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$node$2d$stack$2d$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/node-stack-trace.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$dedupe$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/dedupe.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$eventFilters$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/eventFilters.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$functiontostring$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/functiontostring.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$conversationId$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/conversationId.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$linkederrors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/linkederrors.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$console$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/console.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$requestdata$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/requestdata.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/vercel-ai/index.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/context-api.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/trace-api.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/trace/span_kind.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$SamplingResult$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/trace/SamplingResult.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/trace/trace_flags.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/diag-api.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$invalid$2d$span$2d$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/trace/invalid-span-constants.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/context/context.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$baggage$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/baggage/utils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$propagation$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/propagation-api.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$status$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/trace/status.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$spancontext$2d$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/trace/spancontext-utils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2f$types$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/diag/types.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$resources$2f$build$2f$esm$2f$ResourceImpl$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/resources/build/esm/ResourceImpl.js [instrumentation-edge] (ecmascript)");
{
    if (globalThis.performance === undefined) {
        globalThis.performance = {
            timeOrigin: 0,
            now: ()=>Date.now()
        };
    }
};
;
;
;
;
/**
 * The Sentry Vercel Edge Runtime SDK Client.
 *
 * @see VercelEdgeClientOptions for documentation on configuration options.
 * @see ServerRuntimeClient for usage documentation.
 */ class VercelEdgeClient extends __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$server$2d$runtime$2d$client$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["ServerRuntimeClient"] {
    /**
   * Creates a new Vercel Edge Runtime SDK instance.
   * @param options Configuration options for this SDK.
   */ constructor(options){
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$sdkMetadata$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["applySdkMetadata"])(options, 'vercel-edge');
        options._metadata = options._metadata || {};
        const clientOptions = {
            ...options,
            platform: 'javascript',
            // Use provided runtime or default to 'vercel-edge'
            runtime: options.runtime || {
                name: 'vercel-edge'
            },
            serverName: options.serverName || process.env.SENTRY_NAME
        };
        super(clientOptions);
    }
    // Eslint ignore explanation: This is already documented in super.
    // eslint-disable-next-line jsdoc/require-jsdoc
    async flush(timeout) {
        const provider = this.traceProvider;
        await provider?.forceFlush();
        if (this.getOptions().sendClientReports) {
            this._flushOutcomes();
        }
        return super.flush(timeout);
    }
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ const SUPPRESS_TRACING_KEY = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createContextKey"])('OpenTelemetry SDK Context Key SUPPRESS_TRACING');
function suppressTracing$1(context) {
    return context.setValue(SUPPRESS_TRACING_KEY, true);
}
function isTracingSuppressed(context) {
    return context.getValue(SUPPRESS_TRACING_KEY) === true;
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ const BAGGAGE_KEY_PAIR_SEPARATOR = '=';
const BAGGAGE_PROPERTIES_SEPARATOR = ';';
const BAGGAGE_ITEMS_SEPARATOR = ',';
// Name of the http header used to propagate the baggage
const BAGGAGE_HEADER = 'baggage';
// Maximum number of name-value pairs allowed by w3c spec
const BAGGAGE_MAX_NAME_VALUE_PAIRS = 180;
// Maximum number of bytes per a single name-value pair allowed by w3c spec
const BAGGAGE_MAX_PER_NAME_VALUE_PAIRS = 4096;
// Maximum total length of all name-value pairs allowed by w3c spec
const BAGGAGE_MAX_TOTAL_LENGTH = 8192;
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ function serializeKeyPairs(keyPairs) {
    return keyPairs.reduce((hValue, current)=>{
        const value = `${hValue}${hValue !== '' ? BAGGAGE_ITEMS_SEPARATOR : ''}${current}`;
        return value.length > BAGGAGE_MAX_TOTAL_LENGTH ? hValue : value;
    }, '');
}
function getKeyPairs(baggage) {
    return baggage.getAllEntries().map(([key, value])=>{
        let entry = `${encodeURIComponent(key)}=${encodeURIComponent(value.value)}`;
        // include opaque metadata if provided
        // NOTE: we intentionally don't URI-encode the metadata - that responsibility falls on the metadata implementation
        if (value.metadata !== undefined) {
            entry += BAGGAGE_PROPERTIES_SEPARATOR + value.metadata.toString();
        }
        return entry;
    });
}
function parsePairKeyValue(entry) {
    if (!entry) return;
    const metadataSeparatorIndex = entry.indexOf(BAGGAGE_PROPERTIES_SEPARATOR);
    const keyPairPart = metadataSeparatorIndex === -1 ? entry : entry.substring(0, metadataSeparatorIndex);
    const separatorIndex = keyPairPart.indexOf(BAGGAGE_KEY_PAIR_SEPARATOR);
    if (separatorIndex <= 0) return;
    const rawKey = keyPairPart.substring(0, separatorIndex).trim();
    const rawValue = keyPairPart.substring(separatorIndex + 1).trim();
    if (!rawKey || !rawValue) return;
    let key;
    let value;
    try {
        key = decodeURIComponent(rawKey);
        value = decodeURIComponent(rawValue);
    } catch  {
        return;
    }
    let metadata;
    if (metadataSeparatorIndex !== -1 && metadataSeparatorIndex < entry.length - 1) {
        const metadataString = entry.substring(metadataSeparatorIndex + 1);
        metadata = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$baggage$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["baggageEntryMetadataFromString"])(metadataString);
    }
    return {
        key,
        value,
        metadata
    };
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /**
 * Propagates {@link Baggage} through Context format propagation.
 *
 * Based on the Baggage specification:
 * https://w3c.github.io/baggage/
 */ class W3CBaggagePropagator {
    inject(context, carrier, setter) {
        const baggage = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$propagation$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["propagation"].getBaggage(context);
        if (!baggage || isTracingSuppressed(context)) return;
        const keyPairs = getKeyPairs(baggage).filter((pair)=>{
            return pair.length <= BAGGAGE_MAX_PER_NAME_VALUE_PAIRS;
        }).slice(0, BAGGAGE_MAX_NAME_VALUE_PAIRS);
        const headerValue = serializeKeyPairs(keyPairs);
        if (headerValue.length > 0) {
            setter.set(carrier, BAGGAGE_HEADER, headerValue);
        }
    }
    extract(context, carrier, getter) {
        const headerValue = getter.get(carrier, BAGGAGE_HEADER);
        const baggageString = Array.isArray(headerValue) ? headerValue.join(BAGGAGE_ITEMS_SEPARATOR) : headerValue;
        if (!baggageString) return context;
        const baggage = {};
        if (baggageString.length === 0) {
            return context;
        }
        const pairs = baggageString.split(BAGGAGE_ITEMS_SEPARATOR);
        pairs.forEach((entry)=>{
            const keyPair = parsePairKeyValue(entry);
            if (keyPair) {
                const baggageEntry = {
                    value: keyPair.value
                };
                if (keyPair.metadata) {
                    baggageEntry.metadata = keyPair.metadata;
                }
                baggage[keyPair.key] = baggageEntry;
            }
        });
        if (Object.entries(baggage).length === 0) {
            return context;
        }
        return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$propagation$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["propagation"].setBaggage(context, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$propagation$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["propagation"].createBaggage(baggage));
    }
    fields() {
        return [
            BAGGAGE_HEADER
        ];
    }
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ function sanitizeAttributes(attributes) {
    const out = {};
    if (typeof attributes !== 'object' || attributes == null) {
        return out;
    }
    for(const key in attributes){
        if (!Object.prototype.hasOwnProperty.call(attributes, key)) {
            continue;
        }
        if (!isAttributeKey(key)) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].warn(`Invalid attribute key: ${key}`);
            continue;
        }
        const val = attributes[key];
        if (!isAttributeValue(val)) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].warn(`Invalid attribute value set for key: ${key}`);
            continue;
        }
        if (Array.isArray(val)) {
            out[key] = val.slice();
        } else {
            out[key] = val;
        }
    }
    return out;
}
function isAttributeKey(key) {
    return typeof key === 'string' && key !== '';
}
function isAttributeValue(val) {
    if (val == null) {
        return true;
    }
    if (Array.isArray(val)) {
        return isHomogeneousAttributeValueArray(val);
    }
    return isValidPrimitiveAttributeValueType(typeof val);
}
function isHomogeneousAttributeValueArray(arr) {
    let type;
    for (const element of arr){
        // null/undefined elements are allowed
        if (element == null) continue;
        const elementType = typeof element;
        if (elementType === type) {
            continue;
        }
        if (!type) {
            if (isValidPrimitiveAttributeValueType(elementType)) {
                type = elementType;
                continue;
            }
            // encountered an invalid primitive
            return false;
        }
        return false;
    }
    return true;
}
function isValidPrimitiveAttributeValueType(valType) {
    switch(valType){
        case 'number':
        case 'boolean':
        case 'string':
            return true;
    }
    return false;
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /**
 * Returns a function that logs an error using the provided logger, or a
 * console logger if one was not provided.
 */ function loggingErrorHandler() {
    return (ex)=>{
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].error(stringifyException(ex));
    };
}
/**
 * Converts an exception into a string representation
 * @param {Exception} ex
 */ function stringifyException(ex) {
    if (typeof ex === 'string') {
        return ex;
    } else {
        return JSON.stringify(flattenException(ex));
    }
}
/**
 * Flattens an exception into key-value pairs by traversing the prototype chain
 * and coercing values to strings. Duplicate properties will not be overwritten;
 * the first insert wins.
 */ function flattenException(ex) {
    const result = {};
    let current = ex;
    while(current !== null){
        Object.getOwnPropertyNames(current).forEach((propertyName)=>{
            if (result[propertyName]) return;
            const value = current[propertyName];
            if (value) {
                result[propertyName] = String(value);
            }
        });
        current = Object.getPrototypeOf(current);
    }
    return result;
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /** The global error handler delegate */ let delegateHandler = loggingErrorHandler();
/**
 * Return the global error handler
 * @param {Exception} ex
 */ function globalErrorHandler(ex) {
    try {
        delegateHandler(ex);
    } catch  {} // eslint-disable-line no-empty
}
const inspect = (object)=>JSON.stringify(object, null, 2);
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /**
 * Retrieves a number from an environment variable.
 * - Returns `undefined` if the environment variable is empty, unset, contains only whitespace, or is not a number.
 * - Returns a number in all other cases.
 *
 * @param {string} key - The name of the environment variable to retrieve.
 * @returns {number | undefined} - The number value or `undefined`.
 */ function getNumberFromEnv(key) {
    const raw = process.env[key];
    if (raw == null || raw.trim() === '') {
        return undefined;
    }
    const value = Number(raw);
    if (isNaN(value)) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].warn(`Unknown value ${inspect(raw)} for ${key}, expected a number, using defaults`);
        return undefined;
    }
    return value;
}
/**
 * Retrieves a string from an environment variable.
 * - Returns `undefined` if the environment variable is empty, unset, or contains only whitespace.
 *
 * @param {string} key - The name of the environment variable to retrieve.
 * @returns {string | undefined} - The string value or `undefined`.
 */ function getStringFromEnv(key) {
    const raw = process.env[key];
    if (raw == null || raw.trim() === '') {
        return undefined;
    }
    return raw;
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ const TMP_DB_SYSTEM = 'db.system';
const TMP_DB_STATEMENT = 'db.statement';
const TMP_FAAS_TRIGGER = 'faas.trigger';
const TMP_HTTP_METHOD = 'http.method';
const TMP_HTTP_URL = 'http.url';
const TMP_HTTP_TARGET = 'http.target';
const TMP_HTTP_STATUS_CODE = 'http.status_code';
const TMP_MESSAGING_SYSTEM = 'messaging.system';
const TMP_RPC_SERVICE = 'rpc.service';
const TMP_RPC_GRPC_STATUS_CODE = 'rpc.grpc.status_code';
/**
 * An identifier for the database management system (DBMS) product being used. See below for a list of well-known identifiers.
 *
 * @deprecated Use ATTR_DB_SYSTEM in [incubating entry-point]({@link https://github.com/open-telemetry/opentelemetry-js/blob/main/semantic-conventions/README.md#unstable-semconv}).
 */ const SEMATTRS_DB_SYSTEM = TMP_DB_SYSTEM;
/**
 * The database statement being executed.
 *
 * Note: The value may be sanitized to exclude sensitive information.
 *
 * @deprecated Use ATTR_DB_STATEMENT in [incubating entry-point]({@link https://github.com/open-telemetry/opentelemetry-js/blob/main/semantic-conventions/README.md#unstable-semconv}).
 */ const SEMATTRS_DB_STATEMENT = TMP_DB_STATEMENT;
/**
 * Type of the trigger on which the function is executed.
 *
 * @deprecated Use ATTR_FAAS_TRIGGER in [incubating entry-point]({@link https://github.com/open-telemetry/opentelemetry-js/blob/main/semantic-conventions/README.md#unstable-semconv}).
 */ const SEMATTRS_FAAS_TRIGGER = TMP_FAAS_TRIGGER;
/**
 * HTTP request method.
 *
 * @deprecated Use ATTR_HTTP_METHOD in [incubating entry-point]({@link https://github.com/open-telemetry/opentelemetry-js/blob/main/semantic-conventions/README.md#unstable-semconv}).
 */ const SEMATTRS_HTTP_METHOD = TMP_HTTP_METHOD;
/**
 * Full HTTP request URL in the form `scheme://host[:port]/path?query[#fragment]`. Usually the fragment is not transmitted over HTTP, but if it is known, it should be included nevertheless.
 *
 * Note: `http.url` MUST NOT contain credentials passed via URL in form of `https://username:password@www.example.com/`. In such case the attribute&#39;s value should be `https://www.example.com/`.
 *
 * @deprecated Use ATTR_HTTP_URL in [incubating entry-point]({@link https://github.com/open-telemetry/opentelemetry-js/blob/main/semantic-conventions/README.md#unstable-semconv}).
 */ const SEMATTRS_HTTP_URL = TMP_HTTP_URL;
/**
 * The full request target as passed in a HTTP request line or equivalent.
 *
 * @deprecated Use ATTR_HTTP_TARGET in [incubating entry-point]({@link https://github.com/open-telemetry/opentelemetry-js/blob/main/semantic-conventions/README.md#unstable-semconv}).
 */ const SEMATTRS_HTTP_TARGET = TMP_HTTP_TARGET;
/**
 * [HTTP response status code](https://tools.ietf.org/html/rfc7231#section-6).
 *
 * @deprecated Use ATTR_HTTP_STATUS_CODE in [incubating entry-point]({@link https://github.com/open-telemetry/opentelemetry-js/blob/main/semantic-conventions/README.md#unstable-semconv}).
 */ const SEMATTRS_HTTP_STATUS_CODE = TMP_HTTP_STATUS_CODE;
/**
 * A string identifying the messaging system.
 *
 * @deprecated Use ATTR_MESSAGING_SYSTEM in [incubating entry-point]({@link https://github.com/open-telemetry/opentelemetry-js/blob/main/semantic-conventions/README.md#unstable-semconv}).
 */ const SEMATTRS_MESSAGING_SYSTEM = TMP_MESSAGING_SYSTEM;
/**
 * The full (logical) name of the service being called, including its package name, if applicable.
 *
 * Note: This is the logical name of the service from the RPC interface perspective, which can be different from the name of any implementing class. The `code.namespace` attribute may be used to store the latter (despite the attribute name, it may include a class name; e.g., class with method actually executing the call on the server side, RPC client stub class on the client side).
 *
 * @deprecated Use ATTR_RPC_SERVICE in [incubating entry-point]({@link https://github.com/open-telemetry/opentelemetry-js/blob/main/semantic-conventions/README.md#unstable-semconv}).
 */ const SEMATTRS_RPC_SERVICE = TMP_RPC_SERVICE;
/**
 * The [numeric status code](https://github.com/grpc/grpc/blob/v1.33.2/doc/statuscodes.md) of the gRPC request.
 *
 * @deprecated Use ATTR_RPC_GRPC_STATUS_CODE in [incubating entry-point]({@link https://github.com/open-telemetry/opentelemetry-js/blob/main/semantic-conventions/README.md#unstable-semconv}).
 */ const SEMATTRS_RPC_GRPC_STATUS_CODE = TMP_RPC_GRPC_STATUS_CODE;
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ const TMP_SERVICE_NAMESPACE = 'service.namespace';
/**
 * A namespace for `service.name`.
 *
 * Note: A string value having a meaning that helps to distinguish a group of services, for example the team name that owns a group of services. `service.name` is expected to be unique within the same namespace. If `service.namespace` is not specified in the Resource then `service.name` is expected to be unique for all services that have no explicit namespace defined (so the empty/unspecified namespace is simply one more valid namespace). Zero-length namespace string is assumed equal to unspecified namespace.
 *
 * @deprecated Use ATTR_SERVICE_NAMESPACE in [incubating entry-point]({@link https://github.com/open-telemetry/opentelemetry-js/blob/main/semantic-conventions/README.md#unstable-semconv}).
 */ const SEMRESATTRS_SERVICE_NAMESPACE = TMP_SERVICE_NAMESPACE;
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ //----------------------------------------------------------------------------------------------------------
// DO NOT EDIT, this is an Auto-generated file from scripts/semconv/templates/registry/stable/attributes.ts.j2
//----------------------------------------------------------------------------------------------------------
/**
 * ASP.NET Core exception middleware handling result.
 *
 * @example handled
 * @example unhandled
 */ /**
 * The database management system (DBMS) product as identified by the client instrumentation.
 *
 * @note The actual DBMS may differ from the one identified by the client. For example, when using PostgreSQL client libraries to connect to a CockroachDB, the `db.system.name` is set to `postgresql` based on the instrumentation's best knowledge.
 */ const ATTR_DB_SYSTEM_NAME = 'db.system.name';
/**
 * The exception message.
 *
 * @example Division by zero
 * @example Can't convert 'int' object to str implicitly
 */ const ATTR_EXCEPTION_MESSAGE = 'exception.message';
/**
 * A stacktrace as a string in the natural representation for the language runtime. The representation is to be determined and documented by each language SIG.
 *
 * @example "Exception in thread "main" java.lang.RuntimeException: Test exception\\n at com.example.GenerateTrace.methodB(GenerateTrace.java:13)\\n at com.example.GenerateTrace.methodA(GenerateTrace.java:9)\\n at com.example.GenerateTrace.main(GenerateTrace.java:5)\\n"
 */ const ATTR_EXCEPTION_STACKTRACE = 'exception.stacktrace';
/**
 * The type of the exception (its fully-qualified class name, if applicable). The dynamic type of the exception should be preferred over the static type in languages that support it.
 *
 * @example java.net.ConnectException
 * @example OSError
 */ const ATTR_EXCEPTION_TYPE = 'exception.type';
/**
 * HTTP request method.
 *
 * @example GET
 * @example POST
 * @example HEAD
 *
 * @note HTTP request method value **SHOULD** be "known" to the instrumentation.
 * By default, this convention defines "known" methods as the ones listed in [RFC9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-methods),
 * the PATCH method defined in [RFC5789](https://www.rfc-editor.org/rfc/rfc5789.html)
 * and the QUERY method defined in [httpbis-safe-method-w-body](https://datatracker.ietf.org/doc/draft-ietf-httpbis-safe-method-w-body/?include_text=1).
 *
 * If the HTTP request method is not known to instrumentation, it **MUST** set the `http.request.method` attribute to `_OTHER`.
 *
 * If the HTTP instrumentation could end up converting valid HTTP request methods to `_OTHER`, then it **MUST** provide a way to override
 * the list of known HTTP methods. If this override is done via environment variable, then the environment variable **MUST** be named
 * OTEL_INSTRUMENTATION_HTTP_KNOWN_METHODS and support a comma-separated list of case-sensitive known HTTP methods
 * (this list **MUST** be a full override of the default known method, it is not a list of known methods in addition to the defaults).
 *
 * HTTP method names are case-sensitive and `http.request.method` attribute value **MUST** match a known HTTP method name exactly.
 * Instrumentations for specific web frameworks that consider HTTP methods to be case insensitive, **SHOULD** populate a canonical equivalent.
 * Tracing instrumentations that do so, **MUST** also set `http.request.method_original` to the original value.
 */ const ATTR_HTTP_REQUEST_METHOD = 'http.request.method';
/**
 * [HTTP response status code](https://tools.ietf.org/html/rfc7231#section-6).
 *
 * @example 200
 */ const ATTR_HTTP_RESPONSE_STATUS_CODE = 'http.response.status_code';
/**
 * The matched route template for the request. This **MUST** be low-cardinality and include all static path segments, with dynamic path segments represented with placeholders.
 *
 * @example /users/:userID?
 * @example my-controller/my-action/{id?}
 *
 * @note **MUST NOT** be populated when this is not supported by the HTTP server framework as the route attribute should have low-cardinality and the URI path can NOT substitute it.
 * **SHOULD** include the [application root](/docs/http/http-spans.md#http-server-definitions) if there is one.
 *
 * A static path segment is a part of the route template with a fixed, low-cardinality value. This includes literal strings like `/users/` and placeholders that
 * are constrained to a finite, predefined set of values, e.g. `{controller}` or `{action}`.
 *
 * A dynamic path segment is a placeholder for a value that can have high cardinality and is not constrained to a predefined list like static path segments.
 *
 * Instrumentations **SHOULD** use routing information provided by the corresponding web framework. They **SHOULD** pick the most precise source of routing information and **MAY**
 * support custom route formatting. Instrumentations **SHOULD** document the format and the API used to obtain the route string.
 */ const ATTR_HTTP_ROUTE = 'http.route';
/**
 * Logical name of the service.
 *
 * @example shoppingcart
 *
 * @note **MUST** be the same for all instances of horizontally scaled services. If the value was not specified, SDKs **MUST** fallback to `unknown_service:` concatenated with [`process.executable.name`](process.md), e.g. `unknown_service:bash`. If `process.executable.name` is not available, the value **MUST** be set to `unknown_service`.
 */ const ATTR_SERVICE_NAME = 'service.name';
/**
 * The version string of the service component. The format is not defined by these conventions.
 *
 * @example 2.0.0
 * @example a01dbef8a
 */ const ATTR_SERVICE_VERSION = 'service.version';
/**
 * Absolute URL describing a network resource according to [RFC3986](https://www.rfc-editor.org/rfc/rfc3986)
 *
 * @example https://www.foo.bar/search?q=OpenTelemetry#SemConv
 * @example //localhost
 *
 * @note For network calls, URL usually has `scheme://host[:port][path][?query][#fragment]` format, where the fragment
 * is not transmitted over HTTP, but if it is known, it **SHOULD** be included nevertheless.
 *
 * `url.full` **MUST NOT** contain credentials passed via URL in form of `https://username:password@www.example.com/`.
 * In such case username and password **SHOULD** be redacted and attribute's value **SHOULD** be `https://REDACTED:REDACTED@www.example.com/`.
 *
 * `url.full` **SHOULD** capture the absolute URL when it is available (or can be reconstructed).
 *
 * Sensitive content provided in `url.full` **SHOULD** be scrubbed when instrumentations can identify it.
 *
 *
 * Query string values for the following keys **SHOULD** be redacted by default and replaced by the
 * value `REDACTED`:
 *
 *   - [`AWSAccessKeyId`](https://docs.aws.amazon.com/AmazonS3/latest/userguide/RESTAuthentication.html#RESTAuthenticationQueryStringAuth)
 *   - [`Signature`](https://docs.aws.amazon.com/AmazonS3/latest/userguide/RESTAuthentication.html#RESTAuthenticationQueryStringAuth)
 *   - [`sig`](https://learn.microsoft.com/azure/storage/common/storage-sas-overview#sas-token)
 *   - [`X-Goog-Signature`](https://cloud.google.com/storage/docs/access-control/signed-urls)
 *
 * This list is subject to change over time.
 *
 * When a query string value is redacted, the query string key **SHOULD** still be preserved, e.g.
 * `https://www.example.com/path?color=blue&sig=REDACTED`.
 */ const ATTR_URL_FULL = 'url.full';
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /**
 * @deprecated Use performance directly.
 */ const otperformance = performance;
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ const NANOSECOND_DIGITS = 9;
const NANOSECOND_DIGITS_IN_MILLIS = 6;
const MILLISECONDS_TO_NANOSECONDS = Math.pow(10, NANOSECOND_DIGITS_IN_MILLIS);
const SECOND_TO_NANOSECONDS = Math.pow(10, NANOSECOND_DIGITS);
/**
 * Converts a number of milliseconds from epoch to HrTime([seconds, remainder in nanoseconds]).
 * @param epochMillis
 */ function millisToHrTime(epochMillis) {
    const epochSeconds = epochMillis / 1000;
    // Decimals only.
    const seconds = Math.trunc(epochSeconds);
    // Round sub-nanosecond accuracy to nanosecond.
    const nanos = Math.round(epochMillis % 1000 * MILLISECONDS_TO_NANOSECONDS);
    return [
        seconds,
        nanos
    ];
}
/**
 * Returns an hrtime calculated via performance component.
 * @param performanceNow
 */ function hrTime(performanceNow) {
    const timeOrigin = millisToHrTime(otperformance.timeOrigin);
    const now = millisToHrTime(typeof performanceNow === 'number' ? performanceNow : otperformance.now());
    return addHrTimes(timeOrigin, now);
}
/**
 * Returns a duration of two hrTime.
 * @param startTime
 * @param endTime
 */ function hrTimeDuration(startTime, endTime) {
    let seconds = endTime[0] - startTime[0];
    let nanos = endTime[1] - startTime[1];
    // overflow
    if (nanos < 0) {
        seconds -= 1;
        // negate
        nanos += SECOND_TO_NANOSECONDS;
    }
    return [
        seconds,
        nanos
    ];
}
/**
 * check if time is HrTime
 * @param value
 */ function isTimeInputHrTime(value) {
    return Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number';
}
/**
 * check if input value is a correct types.TimeInput
 * @param value
 */ function isTimeInput(value) {
    return isTimeInputHrTime(value) || typeof value === 'number' || value instanceof Date;
}
/**
 * Given 2 HrTime formatted times, return their sum as an HrTime.
 */ function addHrTimes(time1, time2) {
    const out = [
        time1[0] + time2[0],
        time1[1] + time2[1]
    ];
    // Nanoseconds
    if (out[1] >= SECOND_TO_NANOSECONDS) {
        out[1] -= SECOND_TO_NANOSECONDS;
        out[0] += 1;
    }
    return out;
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ const VALID_KEY_CHAR_RANGE = '[_0-9a-z-*/]';
const VALID_KEY = `[a-z]${VALID_KEY_CHAR_RANGE}{0,255}`;
const VALID_VENDOR_KEY = `[a-z0-9]${VALID_KEY_CHAR_RANGE}{0,240}@[a-z]${VALID_KEY_CHAR_RANGE}{0,13}`;
const VALID_KEY_REGEX = new RegExp(`^(?:${VALID_KEY}|${VALID_VENDOR_KEY})$`);
const VALID_VALUE_BASE_REGEX = /^[ -~]{0,255}[!-~]$/;
const INVALID_VALUE_COMMA_EQUAL_REGEX = /,|=/;
/**
 * Key is opaque string up to 256 characters printable. It MUST begin with a
 * lowercase letter, and can only contain lowercase letters a-z, digits 0-9,
 * underscores _, dashes -, asterisks *, and forward slashes /.
 * For multi-tenant vendor scenarios, an at sign (@) can be used to prefix the
 * vendor name. Vendors SHOULD set the tenant ID at the beginning of the key.
 * see https://www.w3.org/TR/trace-context/#key
 */ function validateKey(key) {
    return VALID_KEY_REGEX.test(key);
}
/**
 * Value is opaque string up to 256 characters printable ASCII RFC0020
 * characters (i.e., the range 0x20 to 0x7E) except comma , and =.
 */ function validateValue(value) {
    return VALID_VALUE_BASE_REGEX.test(value) && !INVALID_VALUE_COMMA_EQUAL_REGEX.test(value);
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ const MAX_TRACE_STATE_ITEMS = 32;
const MAX_TRACE_STATE_LEN = 512;
const LIST_MEMBERS_SEPARATOR = ',';
const LIST_MEMBER_KEY_VALUE_SPLITTER = '=';
/**
 * TraceState must be a class and not a simple object type because of the spec
 * requirement (https://www.w3.org/TR/trace-context/#tracestate-field).
 *
 * Here is the list of allowed mutations:
 * - New key-value pair should be added into the beginning of the list
 * - The value of any key can be updated. Modified keys MUST be moved to the
 * beginning of the list.
 */ class TraceState {
    __init() {
        this._internalState = new Map();
    }
    constructor(rawTraceState){
        TraceState.prototype.__init.call(this);
        if (rawTraceState) this._parse(rawTraceState);
    }
    set(key, value) {
        // TODO: Benchmark the different approaches(map vs list) and
        // use the faster one.
        const traceState = this._clone();
        if (traceState._internalState.has(key)) {
            traceState._internalState.delete(key);
        }
        traceState._internalState.set(key, value);
        return traceState;
    }
    unset(key) {
        const traceState = this._clone();
        traceState._internalState.delete(key);
        return traceState;
    }
    get(key) {
        return this._internalState.get(key);
    }
    serialize() {
        return this._keys().reduce((agg, key)=>{
            agg.push(key + LIST_MEMBER_KEY_VALUE_SPLITTER + this.get(key));
            return agg;
        }, []).join(LIST_MEMBERS_SEPARATOR);
    }
    _parse(rawTraceState) {
        if (rawTraceState.length > MAX_TRACE_STATE_LEN) return;
        this._internalState = rawTraceState.split(LIST_MEMBERS_SEPARATOR).reverse() // Store in reverse so new keys (.set(...)) will be placed at the beginning
        .reduce((agg, part)=>{
            const listMember = part.trim(); // Optional Whitespace (OWS) handling
            const i = listMember.indexOf(LIST_MEMBER_KEY_VALUE_SPLITTER);
            if (i !== -1) {
                const key = listMember.slice(0, i);
                const value = listMember.slice(i + 1, part.length);
                if (validateKey(key) && validateValue(value)) {
                    agg.set(key, value);
                }
            }
            return agg;
        }, new Map());
        // Because of the reverse() requirement, trunc must be done after map is created
        if (this._internalState.size > MAX_TRACE_STATE_ITEMS) {
            this._internalState = new Map(Array.from(this._internalState.entries()).reverse() // Use reverse same as original tracestate parse chain
            .slice(0, MAX_TRACE_STATE_ITEMS));
        }
    }
    _keys() {
        return Array.from(this._internalState.keys()).reverse();
    }
    _clone() {
        const traceState = new TraceState();
        traceState._internalState = new Map(this._internalState);
        return traceState;
    }
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /* eslint-disable @typescript-eslint/no-explicit-any */ /**
 * based on lodash in order to support esm builds without esModuleInterop.
 * lodash is using MIT License.
 **/ const objectTag = '[object Object]';
const nullTag = '[object Null]';
const undefinedTag = '[object Undefined]';
const funcProto = Function.prototype;
const funcToString = funcProto.toString;
const objectCtorString = funcToString.call(Object);
const getPrototypeOf = Object.getPrototypeOf;
const objectProto = Object.prototype;
const hasOwnProperty = objectProto.hasOwnProperty;
const symToStringTag = Symbol ? Symbol.toStringTag : undefined;
const nativeObjectToString = objectProto.toString;
/**
 * Checks if `value` is a plain object, that is, an object created by the
 * `Object` constructor or one with a `[[Prototype]]` of `null`.
 *
 * @static
 * @memberOf _
 * @since 0.8.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a plain object, else `false`.
 * @example
 *
 * function Foo() {
 *   this.a = 1;
 * }
 *
 * _.isPlainObject(new Foo);
 * // => false
 *
 * _.isPlainObject([1, 2, 3]);
 * // => false
 *
 * _.isPlainObject({ 'x': 0, 'y': 0 });
 * // => true
 *
 * _.isPlainObject(Object.create(null));
 * // => true
 */ function isPlainObject(value) {
    if (!isObjectLike(value) || baseGetTag(value) !== objectTag) {
        return false;
    }
    const proto = getPrototypeOf(value);
    if (proto === null) {
        return true;
    }
    const Ctor = hasOwnProperty.call(proto, 'constructor') && proto.constructor;
    return typeof Ctor == 'function' && Ctor instanceof Ctor && funcToString.call(Ctor) === objectCtorString;
}
/**
 * Checks if `value` is object-like. A value is object-like if it's not `null`
 * and has a `typeof` result of "object".
 *
 * @static
 * @memberOf _
 * @since 4.0.0
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
 * @example
 *
 * _.isObjectLike({});
 * // => true
 *
 * _.isObjectLike([1, 2, 3]);
 * // => true
 *
 * _.isObjectLike(_.noop);
 * // => false
 *
 * _.isObjectLike(null);
 * // => false
 */ function isObjectLike(value) {
    return value != null && typeof value == 'object';
}
/**
 * The base implementation of `getTag` without fallbacks for buggy environments.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the `toStringTag`.
 */ function baseGetTag(value) {
    if (value == null) {
        return value === undefined ? undefinedTag : nullTag;
    }
    return symToStringTag && symToStringTag in Object(value) ? getRawTag(value) : objectToString(value);
}
/**
 * A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
 *
 * @private
 * @param {*} value The value to query.
 * @returns {string} Returns the raw `toStringTag`.
 */ function getRawTag(value) {
    const isOwn = hasOwnProperty.call(value, symToStringTag), tag = value[symToStringTag];
    let unmasked = false;
    try {
        value[symToStringTag] = undefined;
        unmasked = true;
    } catch  {
    // silence
    }
    const result = nativeObjectToString.call(value);
    if (unmasked) {
        if (isOwn) {
            value[symToStringTag] = tag;
        } else {
            delete value[symToStringTag];
        }
    }
    return result;
}
/**
 * Converts `value` to a string using `Object.prototype.toString`.
 *
 * @private
 * @param {*} value The value to convert.
 * @returns {string} Returns the converted string.
 */ function objectToString(value) {
    return nativeObjectToString.call(value);
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /* eslint-disable @typescript-eslint/no-explicit-any */ const MAX_LEVEL = 20;
/**
 * Merges objects together
 * @param args - objects / values to be merged
 */ function merge(...args) {
    let result = args.shift();
    const objects = new WeakMap();
    while(args.length > 0){
        result = mergeTwoObjects(result, args.shift(), 0, objects);
    }
    return result;
}
function takeValue(value) {
    if (isArray(value)) {
        return value.slice();
    }
    return value;
}
/**
 * Merges two objects
 * @param one - first object
 * @param two - second object
 * @param level - current deep level
 * @param objects - objects holder that has been already referenced - to prevent
 * cyclic dependency
 */ function mergeTwoObjects(one, two, level = 0, objects) {
    let result;
    if (level > MAX_LEVEL) {
        return undefined;
    }
    level++;
    if (isPrimitive(one) || isPrimitive(two) || isFunction(two)) {
        result = takeValue(two);
    } else if (isArray(one)) {
        result = one.slice();
        if (isArray(two)) {
            for(let i = 0, j = two.length; i < j; i++){
                result.push(takeValue(two[i]));
            }
        } else if (isObject(two)) {
            const keys = Object.keys(two);
            for(let i = 0, j = keys.length; i < j; i++){
                const key = keys[i];
                result[key] = takeValue(two[key]);
            }
        }
    } else if (isObject(one)) {
        if (isObject(two)) {
            if (!shouldMerge(one, two)) {
                return two;
            }
            result = Object.assign({}, one);
            const keys = Object.keys(two);
            for(let i = 0, j = keys.length; i < j; i++){
                const key = keys[i];
                const twoValue = two[key];
                if (isPrimitive(twoValue)) {
                    if (typeof twoValue === 'undefined') {
                        delete result[key];
                    } else {
                        // result[key] = takeValue(twoValue);
                        result[key] = twoValue;
                    }
                } else {
                    const obj1 = result[key];
                    const obj2 = twoValue;
                    if (wasObjectReferenced(one, key, objects) || wasObjectReferenced(two, key, objects)) {
                        delete result[key];
                    } else {
                        if (isObject(obj1) && isObject(obj2)) {
                            const arr1 = objects.get(obj1) || [];
                            const arr2 = objects.get(obj2) || [];
                            arr1.push({
                                obj: one,
                                key
                            });
                            arr2.push({
                                obj: two,
                                key
                            });
                            objects.set(obj1, arr1);
                            objects.set(obj2, arr2);
                        }
                        result[key] = mergeTwoObjects(result[key], twoValue, level, objects);
                    }
                }
            }
        } else {
            result = two;
        }
    }
    return result;
}
/**
 * Function to check if object has been already reference
 * @param obj
 * @param key
 * @param objects
 */ function wasObjectReferenced(obj, key, objects) {
    const arr = objects.get(obj[key]) || [];
    for(let i = 0, j = arr.length; i < j; i++){
        const info = arr[i];
        if (info.key === key && info.obj === obj) {
            return true;
        }
    }
    return false;
}
function isArray(value) {
    return Array.isArray(value);
}
function isFunction(value) {
    return typeof value === 'function';
}
function isObject(value) {
    return !isPrimitive(value) && !isArray(value) && !isFunction(value) && typeof value === 'object';
}
function isPrimitive(value) {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'undefined' || value instanceof Date || value instanceof RegExp || value === null;
}
function shouldMerge(one, two) {
    if (!isPlainObject(one) || !isPlainObject(two)) {
        return false;
    }
    return true;
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ // Event name definitions
const ExceptionEventName = 'exception';
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /**
 * This class represents a span.
 */ class SpanImpl {
    // Below properties are included to implement ReadableSpan for export
    // purposes but are not intended to be written-to directly.
    __init() {
        this.attributes = {};
    }
    __init2() {
        this.links = [];
    }
    __init3() {
        this.events = [];
    }
    __init4() {
        this._droppedAttributesCount = 0;
    }
    __init5() {
        this._droppedEventsCount = 0;
    }
    __init6() {
        this._droppedLinksCount = 0;
    }
    __init7() {
        this._attributesCount = 0;
    }
    __init8() {
        this.status = {
            code: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$status$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanStatusCode"].UNSET
        };
    }
    __init9() {
        this.endTime = [
            0,
            0
        ];
    }
    __init10() {
        this._ended = false;
    }
    __init11() {
        this._duration = [
            -1,
            -1
        ];
    }
    /**
     * Constructs a new SpanImpl instance.
     */ constructor(opts){
        SpanImpl.prototype.__init.call(this);
        SpanImpl.prototype.__init2.call(this);
        SpanImpl.prototype.__init3.call(this);
        SpanImpl.prototype.__init4.call(this);
        SpanImpl.prototype.__init5.call(this);
        SpanImpl.prototype.__init6.call(this);
        SpanImpl.prototype.__init7.call(this);
        SpanImpl.prototype.__init8.call(this);
        SpanImpl.prototype.__init9.call(this);
        SpanImpl.prototype.__init10.call(this);
        SpanImpl.prototype.__init11.call(this);
        const now = Date.now();
        this._spanContext = opts.spanContext;
        this._performanceStartTime = otperformance.now();
        this._performanceOffset = now - (this._performanceStartTime + otperformance.timeOrigin);
        this._startTimeProvided = opts.startTime != null;
        this._spanLimits = opts.spanLimits;
        this._attributeValueLengthLimit = this._spanLimits.attributeValueLengthLimit || 0;
        this._spanProcessor = opts.spanProcessor;
        this.name = opts.name;
        this.parentSpanContext = opts.parentSpanContext;
        this.kind = opts.kind;
        this.links = opts.links || [];
        this.startTime = this._getTime(opts.startTime ?? now);
        this.resource = opts.resource;
        this.instrumentationScope = opts.scope;
        if (opts.attributes != null) {
            this.setAttributes(opts.attributes);
        }
        this._spanProcessor.onStart(this, opts.context);
    }
    spanContext() {
        return this._spanContext;
    }
    setAttribute(key, value) {
        if (value == null || this._isSpanEnded()) return this;
        if (key.length === 0) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].warn(`Invalid attribute key: ${key}`);
            return this;
        }
        if (!isAttributeValue(value)) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].warn(`Invalid attribute value set for key: ${key}`);
            return this;
        }
        const { attributeCountLimit } = this._spanLimits;
        const isNewKey = !Object.prototype.hasOwnProperty.call(this.attributes, key);
        if (attributeCountLimit !== undefined && this._attributesCount >= attributeCountLimit && isNewKey) {
            this._droppedAttributesCount++;
            return this;
        }
        this.attributes[key] = this._truncateToSize(value);
        if (isNewKey) {
            this._attributesCount++;
        }
        return this;
    }
    setAttributes(attributes) {
        for (const [k, v] of Object.entries(attributes)){
            this.setAttribute(k, v);
        }
        return this;
    }
    /**
     *
     * @param name Span Name
     * @param [attributesOrStartTime] Span attributes or start time
     *     if type is {@type TimeInput} and 3rd param is undefined
     * @param [timeStamp] Specified time stamp for the event
     */ addEvent(name, attributesOrStartTime, timeStamp) {
        if (this._isSpanEnded()) return this;
        const { eventCountLimit } = this._spanLimits;
        if (eventCountLimit === 0) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].warn('No events allowed.');
            this._droppedEventsCount++;
            return this;
        }
        if (eventCountLimit !== undefined && this.events.length >= eventCountLimit) {
            if (this._droppedEventsCount === 0) {
                __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].debug('Dropping extra events.');
            }
            this.events.shift();
            this._droppedEventsCount++;
        }
        if (isTimeInput(attributesOrStartTime)) {
            if (!isTimeInput(timeStamp)) {
                timeStamp = attributesOrStartTime;
            }
            attributesOrStartTime = undefined;
        }
        const attributes = sanitizeAttributes(attributesOrStartTime);
        this.events.push({
            name,
            attributes,
            time: this._getTime(timeStamp),
            droppedAttributesCount: 0
        });
        return this;
    }
    addLink(link) {
        this.links.push(link);
        return this;
    }
    addLinks(links) {
        this.links.push(...links);
        return this;
    }
    setStatus(status) {
        if (this._isSpanEnded()) return this;
        this.status = {
            ...status
        };
        // When using try-catch, the caught "error" is of type `any`. When then assigning `any` to `status.message`,
        // TypeScript will not error. While this can happen during use of any API, it is more common on Span#setStatus()
        // as it's likely used in a catch-block. Therefore, we validate if `status.message` is actually a string, null, or
        // undefined to avoid an incorrect type causing issues downstream.
        if (this.status.message != null && typeof status.message !== 'string') {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].warn(`Dropping invalid status.message of type '${typeof status.message}', expected 'string'`);
            delete this.status.message;
        }
        return this;
    }
    updateName(name) {
        if (this._isSpanEnded()) return this;
        this.name = name;
        return this;
    }
    end(endTime) {
        if (this._isSpanEnded()) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].error(`${this.name} ${this._spanContext.traceId}-${this._spanContext.spanId} - You can only call end() on a span once.`);
            return;
        }
        this.endTime = this._getTime(endTime);
        this._duration = hrTimeDuration(this.startTime, this.endTime);
        if (this._duration[0] < 0) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].warn('Inconsistent start and end time, startTime > endTime. Setting span duration to 0ms.', this.startTime, this.endTime);
            this.endTime = this.startTime.slice();
            this._duration = [
                0,
                0
            ];
        }
        if (this._droppedEventsCount > 0) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].warn(`Dropped ${this._droppedEventsCount} events because eventCountLimit reached`);
        }
        if (this._spanProcessor.onEnding) {
            this._spanProcessor.onEnding(this);
        }
        this._ended = true;
        this._spanProcessor.onEnd(this);
    }
    _getTime(inp) {
        if (typeof inp === 'number' && inp <= otperformance.now()) {
            // must be a performance timestamp
            // apply correction and convert to hrtime
            return hrTime(inp + this._performanceOffset);
        }
        if (typeof inp === 'number') {
            return millisToHrTime(inp);
        }
        if (inp instanceof Date) {
            return millisToHrTime(inp.getTime());
        }
        if (isTimeInputHrTime(inp)) {
            return inp;
        }
        if (this._startTimeProvided) {
            // if user provided a time for the start manually
            // we can't use duration to calculate event/end times
            return millisToHrTime(Date.now());
        }
        const msDuration = otperformance.now() - this._performanceStartTime;
        return addHrTimes(this.startTime, millisToHrTime(msDuration));
    }
    isRecording() {
        return this._ended === false;
    }
    recordException(exception, time) {
        const attributes = {};
        if (typeof exception === 'string') {
            attributes[ATTR_EXCEPTION_MESSAGE] = exception;
        } else if (exception) {
            if (exception.code) {
                attributes[ATTR_EXCEPTION_TYPE] = exception.code.toString();
            } else if (exception.name) {
                attributes[ATTR_EXCEPTION_TYPE] = exception.name;
            }
            if (exception.message) {
                attributes[ATTR_EXCEPTION_MESSAGE] = exception.message;
            }
            if (exception.stack) {
                attributes[ATTR_EXCEPTION_STACKTRACE] = exception.stack;
            }
        }
        // these are minimum requirements from spec
        if (attributes[ATTR_EXCEPTION_TYPE] || attributes[ATTR_EXCEPTION_MESSAGE]) {
            this.addEvent(ExceptionEventName, attributes, time);
        } else {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].warn(`Failed to record an exception ${exception}`);
        }
    }
    get duration() {
        return this._duration;
    }
    get ended() {
        return this._ended;
    }
    get droppedAttributesCount() {
        return this._droppedAttributesCount;
    }
    get droppedEventsCount() {
        return this._droppedEventsCount;
    }
    get droppedLinksCount() {
        return this._droppedLinksCount;
    }
    _isSpanEnded() {
        if (this._ended) {
            const error = new Error(`Operation attempted on ended Span {traceId: ${this._spanContext.traceId}, spanId: ${this._spanContext.spanId}}`);
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].warn(`Cannot execute the operation on ended Span {traceId: ${this._spanContext.traceId}, spanId: ${this._spanContext.spanId}}`, error);
        }
        return this._ended;
    }
    // Utility function to truncate given value within size
    // for value type of string, will truncate to given limit
    // for type of non-string, will return same value
    _truncateToLimitUtil(value, limit) {
        if (value.length <= limit) {
            return value;
        }
        return value.substring(0, limit);
    }
    /**
     * If the given attribute value is of type string and has more characters than given {@code attributeValueLengthLimit} then
     * return string with truncated to {@code attributeValueLengthLimit} characters
     *
     * If the given attribute value is array of strings then
     * return new array of strings with each element truncated to {@code attributeValueLengthLimit} characters
     *
     * Otherwise return same Attribute {@code value}
     *
     * @param value Attribute value
     * @returns truncated attribute value if required, otherwise same value
     */ _truncateToSize(value) {
        const limit = this._attributeValueLengthLimit;
        // Check limit
        if (limit <= 0) {
            // Negative values are invalid, so do not truncate
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].warn(`Attribute value limit must be positive, got ${limit}`);
            return value;
        }
        // String
        if (typeof value === 'string') {
            return this._truncateToLimitUtil(value, limit);
        }
        // Array of strings
        if (Array.isArray(value)) {
            return value.map((val)=>typeof val === 'string' ? this._truncateToLimitUtil(val, limit) : val);
        }
        // Other types, no need to apply value length limit
        return value;
    }
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /**
 * A sampling decision that determines how a {@link Span} will be recorded
 * and collected.
 */ var SamplingDecision;
(function(SamplingDecision) {
    /**
     * `Span.isRecording() === false`, span will not be recorded and all events
     * and attributes will be dropped.
     */ SamplingDecision[SamplingDecision["NOT_RECORD"] = 0] = "NOT_RECORD";
    /**
     * `Span.isRecording() === true`, but `Sampled` flag in {@link TraceFlags}
     * MUST NOT be set.
     */ SamplingDecision[SamplingDecision["RECORD"] = 1] = "RECORD";
    /**
     * `Span.isRecording() === true` AND `Sampled` flag in {@link TraceFlags}
     * MUST be set.
     */ SamplingDecision[SamplingDecision["RECORD_AND_SAMPLED"] = 2] = "RECORD_AND_SAMPLED";
})(SamplingDecision || (SamplingDecision = {}));
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /** Sampler that samples no traces. */ class AlwaysOffSampler {
    shouldSample() {
        return {
            decision: SamplingDecision.NOT_RECORD
        };
    }
    toString() {
        return 'AlwaysOffSampler';
    }
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /** Sampler that samples all traces. */ class AlwaysOnSampler {
    shouldSample() {
        return {
            decision: SamplingDecision.RECORD_AND_SAMPLED
        };
    }
    toString() {
        return 'AlwaysOnSampler';
    }
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /**
 * A composite sampler that either respects the parent span's sampling decision
 * or delegates to `delegateSampler` for root spans.
 */ class ParentBasedSampler {
    constructor(config){
        this._root = config.root;
        if (!this._root) {
            globalErrorHandler(new Error('ParentBasedSampler must have a root sampler configured'));
            this._root = new AlwaysOnSampler();
        }
        this._remoteParentSampled = config.remoteParentSampled ?? new AlwaysOnSampler();
        this._remoteParentNotSampled = config.remoteParentNotSampled ?? new AlwaysOffSampler();
        this._localParentSampled = config.localParentSampled ?? new AlwaysOnSampler();
        this._localParentNotSampled = config.localParentNotSampled ?? new AlwaysOffSampler();
    }
    shouldSample(context, traceId, spanName, spanKind, attributes, links) {
        const parentContext = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpanContext(context);
        if (!parentContext || !(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$spancontext$2d$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isSpanContextValid"])(parentContext)) {
            return this._root.shouldSample(context, traceId, spanName, spanKind, attributes, links);
        }
        if (parentContext.isRemote) {
            if (parentContext.traceFlags & __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].SAMPLED) {
                return this._remoteParentSampled.shouldSample(context, traceId, spanName, spanKind, attributes, links);
            }
            return this._remoteParentNotSampled.shouldSample(context, traceId, spanName, spanKind, attributes, links);
        }
        if (parentContext.traceFlags & __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].SAMPLED) {
            return this._localParentSampled.shouldSample(context, traceId, spanName, spanKind, attributes, links);
        }
        return this._localParentNotSampled.shouldSample(context, traceId, spanName, spanKind, attributes, links);
    }
    toString() {
        return `ParentBased{root=${this._root.toString()}, remoteParentSampled=${this._remoteParentSampled.toString()}, remoteParentNotSampled=${this._remoteParentNotSampled.toString()}, localParentSampled=${this._localParentSampled.toString()}, localParentNotSampled=${this._localParentNotSampled.toString()}}`;
    }
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /** Sampler that samples a given fraction of traces based of trace id deterministically. */ class TraceIdRatioBasedSampler {
    constructor(ratio = 0){
        this._ratio = this._normalize(ratio);
        this._upperBound = Math.floor(this._ratio * 0xffffffff);
    }
    shouldSample(context, traceId) {
        return {
            decision: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$spancontext$2d$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isValidTraceId"])(traceId) && this._accumulate(traceId) < this._upperBound ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD
        };
    }
    toString() {
        return `TraceIdRatioBased{${this._ratio}}`;
    }
    _normalize(ratio) {
        if (typeof ratio !== 'number' || isNaN(ratio)) return 0;
        return ratio >= 1 ? 1 : ratio <= 0 ? 0 : ratio;
    }
    _accumulate(traceId) {
        let accumulation = 0;
        for(let i = 0; i < traceId.length / 8; i++){
            const pos = i * 8;
            const part = parseInt(traceId.slice(pos, pos + 8), 16);
            accumulation = (accumulation ^ part) >>> 0;
        }
        return accumulation;
    }
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ var TracesSamplerValues;
(function(TracesSamplerValues) {
    TracesSamplerValues["AlwaysOff"] = "always_off";
    TracesSamplerValues["AlwaysOn"] = "always_on";
    TracesSamplerValues["ParentBasedAlwaysOff"] = "parentbased_always_off";
    TracesSamplerValues["ParentBasedAlwaysOn"] = "parentbased_always_on";
    TracesSamplerValues["ParentBasedTraceIdRatio"] = "parentbased_traceidratio";
    TracesSamplerValues["TraceIdRatio"] = "traceidratio";
})(TracesSamplerValues || (TracesSamplerValues = {}));
const DEFAULT_RATIO = 1;
/**
 * Load default configuration. For fields with primitive values, any user-provided
 * value will override the corresponding default value. For fields with
 * non-primitive values (like `spanLimits`), the user-provided value will be
 * used to extend the default value.
 */ // object needs to be wrapped in this function and called when needed otherwise
// envs are parsed before tests are ran - causes tests using these envs to fail
function loadDefaultConfig() {
    return {
        sampler: buildSamplerFromEnv(),
        forceFlushTimeoutMillis: 30000,
        generalLimits: {
            attributeValueLengthLimit: getNumberFromEnv('OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT') ?? Infinity,
            attributeCountLimit: getNumberFromEnv('OTEL_ATTRIBUTE_COUNT_LIMIT') ?? 128
        },
        spanLimits: {
            attributeValueLengthLimit: getNumberFromEnv('OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT') ?? Infinity,
            attributeCountLimit: getNumberFromEnv('OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT') ?? 128,
            linkCountLimit: getNumberFromEnv('OTEL_SPAN_LINK_COUNT_LIMIT') ?? 128,
            eventCountLimit: getNumberFromEnv('OTEL_SPAN_EVENT_COUNT_LIMIT') ?? 128,
            attributePerEventCountLimit: getNumberFromEnv('OTEL_SPAN_ATTRIBUTE_PER_EVENT_COUNT_LIMIT') ?? 128,
            attributePerLinkCountLimit: getNumberFromEnv('OTEL_SPAN_ATTRIBUTE_PER_LINK_COUNT_LIMIT') ?? 128
        }
    };
}
/**
 * Based on environment, builds a sampler, complies with specification.
 */ function buildSamplerFromEnv() {
    const sampler = getStringFromEnv('OTEL_TRACES_SAMPLER') ?? TracesSamplerValues.ParentBasedAlwaysOn;
    switch(sampler){
        case TracesSamplerValues.AlwaysOn:
            return new AlwaysOnSampler();
        case TracesSamplerValues.AlwaysOff:
            return new AlwaysOffSampler();
        case TracesSamplerValues.ParentBasedAlwaysOn:
            return new ParentBasedSampler({
                root: new AlwaysOnSampler()
            });
        case TracesSamplerValues.ParentBasedAlwaysOff:
            return new ParentBasedSampler({
                root: new AlwaysOffSampler()
            });
        case TracesSamplerValues.TraceIdRatio:
            return new TraceIdRatioBasedSampler(getSamplerProbabilityFromEnv());
        case TracesSamplerValues.ParentBasedTraceIdRatio:
            return new ParentBasedSampler({
                root: new TraceIdRatioBasedSampler(getSamplerProbabilityFromEnv())
            });
        default:
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].error(`OTEL_TRACES_SAMPLER value "${sampler}" invalid, defaulting to "${TracesSamplerValues.ParentBasedAlwaysOn}".`);
            return new ParentBasedSampler({
                root: new AlwaysOnSampler()
            });
    }
}
function getSamplerProbabilityFromEnv() {
    const probability = getNumberFromEnv('OTEL_TRACES_SAMPLER_ARG');
    if (probability == null) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].error(`OTEL_TRACES_SAMPLER_ARG is blank, defaulting to ${DEFAULT_RATIO}.`);
        return DEFAULT_RATIO;
    }
    if (probability < 0 || probability > 1) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].error(`OTEL_TRACES_SAMPLER_ARG=${probability} was given, but it is out of range ([0..1]), defaulting to ${DEFAULT_RATIO}.`);
        return DEFAULT_RATIO;
    }
    return probability;
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ const DEFAULT_ATTRIBUTE_COUNT_LIMIT = 128;
const DEFAULT_ATTRIBUTE_VALUE_LENGTH_LIMIT = Infinity;
/**
 * Function to merge Default configuration (as specified in './config') with
 * user provided configurations.
 */ function mergeConfig(userConfig) {
    const perInstanceDefaults = {
        sampler: buildSamplerFromEnv()
    };
    const DEFAULT_CONFIG = loadDefaultConfig();
    const target = Object.assign({}, DEFAULT_CONFIG, perInstanceDefaults, userConfig);
    target.generalLimits = Object.assign({}, DEFAULT_CONFIG.generalLimits, userConfig.generalLimits || {});
    target.spanLimits = Object.assign({}, DEFAULT_CONFIG.spanLimits, userConfig.spanLimits || {});
    return target;
}
/**
 * When general limits are provided and model specific limits are not,
 * configures the model specific limits by using the values from the general ones.
 * @param userConfig User provided tracer configuration
 */ function reconfigureLimits(userConfig) {
    const spanLimits = Object.assign({}, userConfig.spanLimits);
    /**
     * Reassign span attribute count limit to use first non null value defined by user or use default value
     */ spanLimits.attributeCountLimit = userConfig.spanLimits?.attributeCountLimit ?? userConfig.generalLimits?.attributeCountLimit ?? getNumberFromEnv('OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT') ?? getNumberFromEnv('OTEL_ATTRIBUTE_COUNT_LIMIT') ?? DEFAULT_ATTRIBUTE_COUNT_LIMIT;
    /**
     * Reassign span attribute value length limit to use first non null value defined by user or use default value
     */ spanLimits.attributeValueLengthLimit = userConfig.spanLimits?.attributeValueLengthLimit ?? userConfig.generalLimits?.attributeValueLengthLimit ?? getNumberFromEnv('OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT') ?? getNumberFromEnv('OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT') ?? DEFAULT_ATTRIBUTE_VALUE_LENGTH_LIMIT;
    return Object.assign({}, userConfig, {
        spanLimits
    });
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ const SPAN_ID_BYTES = 8;
const TRACE_ID_BYTES = 16;
class RandomIdGenerator {
    constructor(){
        RandomIdGenerator.prototype.__init.call(this);
        RandomIdGenerator.prototype.__init2.call(this);
    }
    /**
     * Returns a random 16-byte trace ID formatted/encoded as a 32 lowercase hex
     * characters corresponding to 128 bits.
     */ __init() {
        this.generateTraceId = getIdGenerator(TRACE_ID_BYTES);
    }
    /**
     * Returns a random 8-byte span ID formatted/encoded as a 16 lowercase hex
     * characters corresponding to 64 bits.
     */ __init2() {
        this.generateSpanId = getIdGenerator(SPAN_ID_BYTES);
    }
}
const SHARED_BUFFER = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$buffer__$5b$external$5d$__$28$node$3a$buffer$2c$__cjs$29$__["Buffer"].allocUnsafe(TRACE_ID_BYTES);
function getIdGenerator(bytes) {
    return function generateId() {
        for(let i = 0; i < bytes / 4; i++){
            // unsigned right shift drops decimal part of the number
            // it is required because if a number between 2**32 and 2**32 - 1 is generated, an out of range error is thrown by writeUInt32BE
            SHARED_BUFFER.writeUInt32BE(Math.random() * 2 ** 32 >>> 0, i * 4);
        }
        // If buffer is all 0, set the last byte to 1 to guarantee a valid w3c id is generated
        for(let i = 0; i < bytes; i++){
            if (SHARED_BUFFER[i] > 0) {
                break;
            } else if (i === bytes - 1) {
                SHARED_BUFFER[bytes - 1] = 1;
            }
        }
        return SHARED_BUFFER.toString('hex', 0, bytes);
    };
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /**
 * This class represents a basic tracer.
 */ class Tracer {
    /**
     * Constructs a new Tracer instance.
     */ constructor(instrumentationScope, config, resource, spanProcessor){
        const localConfig = mergeConfig(config);
        this._sampler = localConfig.sampler;
        this._generalLimits = localConfig.generalLimits;
        this._spanLimits = localConfig.spanLimits;
        this._idGenerator = config.idGenerator || new RandomIdGenerator();
        this._resource = resource;
        this._spanProcessor = spanProcessor;
        this.instrumentationScope = instrumentationScope;
    }
    /**
     * Starts a new Span or returns the default NoopSpan based on the sampling
     * decision.
     */ startSpan(name, options = {}, context = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active()) {
        // remove span from context in case a root span is requested via options
        if (options.root) {
            context = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].deleteSpan(context);
        }
        const parentSpan = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(context);
        if (isTracingSuppressed(context)) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].debug('Instrumentation suppressed, returning Noop Span');
            const nonRecordingSpan = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].wrapSpanContext(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$invalid$2d$span$2d$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["INVALID_SPAN_CONTEXT"]);
            return nonRecordingSpan;
        }
        const parentSpanContext = parentSpan?.spanContext();
        const spanId = this._idGenerator.generateSpanId();
        let validParentSpanContext;
        let traceId;
        let traceState;
        if (!parentSpanContext || !__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].isSpanContextValid(parentSpanContext)) {
            // New root span.
            traceId = this._idGenerator.generateTraceId();
        } else {
            // New child span.
            traceId = parentSpanContext.traceId;
            traceState = parentSpanContext.traceState;
            validParentSpanContext = parentSpanContext;
        }
        const spanKind = options.kind ?? __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].INTERNAL;
        const links = (options.links ?? []).map((link)=>{
            return {
                context: link.context,
                attributes: sanitizeAttributes(link.attributes)
            };
        });
        const attributes = sanitizeAttributes(options.attributes);
        // make sampling decision
        const samplingResult = this._sampler.shouldSample(context, traceId, name, spanKind, attributes, links);
        traceState = samplingResult.traceState ?? traceState;
        const traceFlags = samplingResult.decision === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$SamplingResult$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SamplingDecision"].RECORD_AND_SAMPLED ? __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].SAMPLED : __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].NONE;
        const spanContext = {
            traceId,
            spanId,
            traceFlags,
            traceState
        };
        if (samplingResult.decision === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$SamplingResult$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SamplingDecision"].NOT_RECORD) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].debug('Recording is off, propagating context in a non-recording span');
            const nonRecordingSpan = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].wrapSpanContext(spanContext);
            return nonRecordingSpan;
        }
        // Set initial span attributes. The attributes object may have been mutated
        // by the sampler, so we sanitize the merged attributes before setting them.
        const initAttributes = sanitizeAttributes(Object.assign(attributes, samplingResult.attributes));
        const span = new SpanImpl({
            resource: this._resource,
            scope: this.instrumentationScope,
            context,
            spanContext,
            name,
            kind: spanKind,
            links,
            parentSpanContext: validParentSpanContext,
            attributes: initAttributes,
            startTime: options.startTime,
            spanProcessor: this._spanProcessor,
            spanLimits: this._spanLimits
        });
        return span;
    }
    startActiveSpan(name, arg2, arg3, arg4) {
        let opts;
        let ctx;
        let fn;
        if (arguments.length < 2) {
            return;
        } else if (arguments.length === 2) {
            fn = arg2;
        } else if (arguments.length === 3) {
            opts = arg2;
            fn = arg3;
        } else {
            opts = arg2;
            ctx = arg3;
            fn = arg4;
        }
        const parentContext = ctx ?? __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
        const span = this.startSpan(name, opts, parentContext);
        const contextWithSpanSet = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].setSpan(parentContext, span);
        return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(contextWithSpanSet, fn, undefined, span);
    }
    /** Returns the active {@link GeneralLimits}. */ getGeneralLimits() {
        return this._generalLimits;
    }
    /** Returns the active {@link SpanLimits}. */ getSpanLimits() {
        return this._spanLimits;
    }
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ /**
 * Implementation of the {@link SpanProcessor} that simply forwards all
 * received events to a list of {@link SpanProcessor}s.
 */ class MultiSpanProcessor {
    constructor(spanProcessors){
        this._spanProcessors = spanProcessors;
    }
    forceFlush() {
        const promises = [];
        for (const spanProcessor of this._spanProcessors){
            promises.push(spanProcessor.forceFlush());
        }
        return new Promise((resolve)=>{
            Promise.all(promises).then(()=>{
                resolve();
            }).catch((error)=>{
                globalErrorHandler(error || new Error('MultiSpanProcessor: forceFlush failed'));
                resolve();
            });
        });
    }
    onStart(span, context) {
        for (const spanProcessor of this._spanProcessors){
            spanProcessor.onStart(span, context);
        }
    }
    onEnding(span) {
        for (const spanProcessor of this._spanProcessors){
            if (spanProcessor.onEnding) {
                spanProcessor.onEnding(span);
            }
        }
    }
    onEnd(span) {
        for (const spanProcessor of this._spanProcessors){
            spanProcessor.onEnd(span);
        }
    }
    shutdown() {
        const promises = [];
        for (const spanProcessor of this._spanProcessors){
            promises.push(spanProcessor.shutdown());
        }
        return new Promise((resolve, reject)=>{
            Promise.all(promises).then(()=>{
                resolve();
            }, reject);
        });
    }
}
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ var ForceFlushState;
(function(ForceFlushState) {
    ForceFlushState[ForceFlushState["resolved"] = 0] = "resolved";
    ForceFlushState[ForceFlushState["timeout"] = 1] = "timeout";
    ForceFlushState[ForceFlushState["error"] = 2] = "error";
    ForceFlushState[ForceFlushState["unresolved"] = 3] = "unresolved";
})(ForceFlushState || (ForceFlushState = {}));
/**
 * This class represents a basic tracer provider which platform libraries can extend
 */ class BasicTracerProvider {
    __init() {
        this._tracers = new Map();
    }
    constructor(config = {}){
        BasicTracerProvider.prototype.__init.call(this);
        const mergedConfig = merge({}, loadDefaultConfig(), reconfigureLimits(config));
        this._resource = mergedConfig.resource ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$resources$2f$build$2f$esm$2f$ResourceImpl$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defaultResource"])();
        this._config = Object.assign({}, mergedConfig, {
            resource: this._resource
        });
        const spanProcessors = [];
        if (config.spanProcessors?.length) {
            spanProcessors.push(...config.spanProcessors);
        }
        this._activeSpanProcessor = new MultiSpanProcessor(spanProcessors);
    }
    getTracer(name, version, options) {
        const key = `${name}@${version || ''}:${options?.schemaUrl || ''}`;
        if (!this._tracers.has(key)) {
            this._tracers.set(key, new Tracer({
                name,
                version,
                schemaUrl: options?.schemaUrl
            }, this._config, this._resource, this._activeSpanProcessor));
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return this._tracers.get(key);
    }
    forceFlush() {
        const timeout = this._config.forceFlushTimeoutMillis;
        const promises = this._activeSpanProcessor['_spanProcessors'].map((spanProcessor)=>{
            return new Promise((resolve)=>{
                let state;
                const timeoutInterval = setTimeout(()=>{
                    resolve(new Error(`Span processor did not completed within timeout period of ${timeout} ms`));
                    state = ForceFlushState.timeout;
                }, timeout);
                spanProcessor.forceFlush().then(()=>{
                    clearTimeout(timeoutInterval);
                    if (state !== ForceFlushState.timeout) {
                        state = ForceFlushState.resolved;
                        resolve(state);
                    }
                }).catch((error)=>{
                    clearTimeout(timeoutInterval);
                    state = ForceFlushState.error;
                    resolve(error);
                });
            });
        });
        return new Promise((resolve, reject)=>{
            Promise.all(promises).then((results)=>{
                const errors = results.filter((result)=>result !== ForceFlushState.resolved);
                if (errors.length > 0) {
                    reject(errors);
                } else {
                    resolve();
                }
            }).catch((error)=>reject([
                    error
                ]));
        });
    }
    shutdown() {
        return this._activeSpanProcessor.shutdown();
    }
}
/** If this attribute is true, it means that the parent is a remote span. */ const SEMANTIC_ATTRIBUTE_SENTRY_PARENT_IS_REMOTE = 'sentry.parentIsRemote';
// These are not standardized yet, but used by the graphql instrumentation
const SEMANTIC_ATTRIBUTE_SENTRY_GRAPHQL_OPERATION = 'sentry.graphql.operation';
/**
 * Get the parent span id from a span.
 * In OTel v1, the parent span id is accessed as `parentSpanId`
 * In OTel v2, the parent span id is accessed as `spanId` on the `parentSpanContext`
 */ function getParentSpanId(span) {
    if ('parentSpanId' in span) {
        return span.parentSpanId;
    } else if ('parentSpanContext' in span) {
        return span.parentSpanContext?.spanId;
    }
    return undefined;
}
/**
 * Check if a given span has attributes.
 * This is necessary because the base `Span` type does not have attributes,
 * so in places where we are passed a generic span, we need to check if we want to access them.
 */ function spanHasAttributes(span) {
    const castSpan = span;
    return !!castSpan.attributes && typeof castSpan.attributes === 'object';
}
/**
 * Check if a given span has a kind.
 * This is necessary because the base `Span` type does not have a kind,
 * so in places where we are passed a generic span, we need to check if we want to access it.
 */ function spanHasKind(span) {
    const castSpan = span;
    return typeof castSpan.kind === 'number';
}
/**
 * Check if a given span has a status.
 * This is necessary because the base `Span` type does not have a status,
 * so in places where we are passed a generic span, we need to check if we want to access it.
 */ function spanHasStatus(span) {
    const castSpan = span;
    return !!castSpan.status;
}
/**
 * Check if a given span has a name.
 * This is necessary because the base `Span` type does not have a name,
 * so in places where we are passed a generic span, we need to check if we want to access it.
 */ function spanHasName(span) {
    const castSpan = span;
    return !!castSpan.name;
}
/**
 * Get sanitizied request data from an OTEL span.
 */ function getRequestSpanData(span) {
    // The base `Span` type has no `attributes`, so we need to guard here against that
    if (!spanHasAttributes(span)) {
        return {};
    }
    // eslint-disable-next-line deprecation/deprecation
    const maybeUrlAttribute = span.attributes[ATTR_URL_FULL] || span.attributes[SEMATTRS_HTTP_URL];
    const data = {
        url: maybeUrlAttribute,
        // eslint-disable-next-line deprecation/deprecation
        'http.method': span.attributes[ATTR_HTTP_REQUEST_METHOD] || span.attributes[SEMATTRS_HTTP_METHOD]
    };
    // Default to GET if URL is set but method is not
    if (!data['http.method'] && data.url) {
        data['http.method'] = 'GET';
    }
    try {
        if (typeof maybeUrlAttribute === 'string') {
            const url = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseUrl"])(maybeUrlAttribute);
            data.url = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSanitizedUrlString"])(url);
            if (url.search) {
                data['http.query'] = url.search;
            }
            if (url.hash) {
                data['http.fragment'] = url.hash;
            }
        }
    } catch  {
    // ignore
    }
    return data;
}
/* eslint-enable @typescript-eslint/no-explicit-any */ /**
 * Get the span kind from a span.
 * For whatever reason, this is not public API on the generic "Span" type,
 * so we need to check if we actually have a `SDKTraceBaseSpan` where we can fetch this from.
 * Otherwise, we fall back to `SpanKind.INTERNAL`.
 */ function getSpanKind(span) {
    if (spanHasKind(span)) {
        return span.kind;
    }
    return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].INTERNAL;
}
const SENTRY_TRACE_HEADER = 'sentry-trace';
const SENTRY_BAGGAGE_HEADER = 'baggage';
const SENTRY_TRACE_STATE_DSC = 'sentry.dsc';
const SENTRY_TRACE_STATE_SAMPLED_NOT_RECORDING = 'sentry.sampled_not_recording';
const SENTRY_TRACE_STATE_URL = 'sentry.url';
const SENTRY_TRACE_STATE_SAMPLE_RAND = 'sentry.sample_rand';
const SENTRY_TRACE_STATE_SAMPLE_RATE = 'sentry.sample_rate';
const SENTRY_SCOPES_CONTEXT_KEY = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createContextKey"])('sentry_scopes');
const SENTRY_FORK_ISOLATION_SCOPE_CONTEXT_KEY = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createContextKey"])('sentry_fork_isolation_scope');
const SENTRY_FORK_SET_SCOPE_CONTEXT_KEY = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createContextKey"])('sentry_fork_set_scope');
const SENTRY_FORK_SET_ISOLATION_SCOPE_CONTEXT_KEY = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createContextKey"])('sentry_fork_set_isolation_scope');
const SCOPE_CONTEXT_FIELD = '_scopeContext';
/**
 * Try to get the current scopes from the given OTEL context.
 * This requires a Context Manager that was wrapped with getWrappedContextManager.
 */ function getScopesFromContext(context) {
    return context.getValue(SENTRY_SCOPES_CONTEXT_KEY);
}
/**
 * Set the current scopes on an OTEL context.
 * This will return a forked context with the Propagation Context set.
 */ function setScopesOnContext(context, scopes) {
    return context.setValue(SENTRY_SCOPES_CONTEXT_KEY, scopes);
}
/**
 * Set the context on the scope so we can later look it up.
 * We need this to get the context from the scope in the `trace` functions.
 */ function setContextOnScope(scope, context) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addNonEnumerableProperty"])(scope, SCOPE_CONTEXT_FIELD, context);
}
/**
 * Get the context related to a scope.
 */ function getContextFromScope(scope) {
    return scope[SCOPE_CONTEXT_FIELD];
}
/**
 * OpenTelemetry only knows about SAMPLED or NONE decision,
 * but for us it is important to differentiate between unset and unsampled.
 *
 * Both of these are identified as `traceFlags === TracegFlags.NONE`,
 * but we additionally look at a special trace state to differentiate between them.
 */ function getSamplingDecision(spanContext) {
    const { traceFlags, traceState } = spanContext;
    const sampledNotRecording = traceState ? traceState.get(SENTRY_TRACE_STATE_SAMPLED_NOT_RECORDING) === '1' : false;
    // If trace flag is `SAMPLED`, we interpret this as sampled
    // If it is `NONE`, it could mean either it was sampled to be not recorder, or that it was not sampled at all
    // For us this is an important difference, sow e look at the SENTRY_TRACE_STATE_SAMPLED_NOT_RECORDING
    // to identify which it is
    if (traceFlags === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].SAMPLED) {
        return true;
    }
    if (sampledNotRecording) {
        return false;
    }
    // Fall back to DSC as a last resort, that may also contain `sampled`...
    const dscString = traceState ? traceState.get(SENTRY_TRACE_STATE_DSC) : undefined;
    const dsc = dscString ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["baggageHeaderToDynamicSamplingContext"])(dscString) : undefined;
    if (dsc?.sampled === 'true') {
        return true;
    }
    if (dsc?.sampled === 'false') {
        return false;
    }
    return undefined;
}
/**
 * Infer the op & description for a set of name, attributes and kind of a span.
 */ function inferSpanData(spanName, attributes, kind) {
    // if http.method exists, this is an http request span
    // eslint-disable-next-line deprecation/deprecation
    const httpMethod = attributes[ATTR_HTTP_REQUEST_METHOD] || attributes[SEMATTRS_HTTP_METHOD];
    if (httpMethod) {
        return descriptionForHttpMethod({
            attributes,
            name: spanName,
            kind
        }, httpMethod);
    }
    // eslint-disable-next-line deprecation/deprecation
    const dbSystem = attributes[ATTR_DB_SYSTEM_NAME] || attributes[SEMATTRS_DB_SYSTEM];
    const opIsCache = typeof attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]] === 'string' && attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]].startsWith('cache.');
    // If db.type exists then this is a database call span
    // If the Redis DB is used as a cache, the span description should not be changed
    if (dbSystem && !opIsCache) {
        return descriptionForDbSystem({
            attributes,
            name: spanName
        });
    }
    const customSourceOrRoute = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] === 'custom' ? 'custom' : 'route';
    // If rpc.service exists then this is a rpc call span.
    // eslint-disable-next-line deprecation/deprecation
    const rpcService = attributes[SEMATTRS_RPC_SERVICE];
    if (rpcService) {
        return {
            ...getUserUpdatedNameAndSource(spanName, attributes, 'route'),
            op: 'rpc'
        };
    }
    // If messaging.system exists then this is a messaging system span.
    // eslint-disable-next-line deprecation/deprecation
    const messagingSystem = attributes[SEMATTRS_MESSAGING_SYSTEM];
    if (messagingSystem) {
        return {
            ...getUserUpdatedNameAndSource(spanName, attributes, customSourceOrRoute),
            op: 'message'
        };
    }
    // If faas.trigger exists then this is a function as a service span.
    // eslint-disable-next-line deprecation/deprecation
    const faasTrigger = attributes[SEMATTRS_FAAS_TRIGGER];
    if (faasTrigger) {
        return {
            ...getUserUpdatedNameAndSource(spanName, attributes, customSourceOrRoute),
            op: faasTrigger.toString()
        };
    }
    return {
        op: undefined,
        description: spanName,
        source: 'custom'
    };
}
/**
 * Extract better op/description from an otel span.
 *
 * Does not overwrite the span name if the source is already set to custom to ensure
 * that user-updated span names are preserved. In this case, we only adjust the op but
 * leave span description and source unchanged.
 *
 * Based on https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/7422ce2a06337f68a59b552b8c5a2ac125d6bae5/exporter/sentryexporter/sentry_exporter.go#L306
 */ function parseSpanDescription(span) {
    const attributes = spanHasAttributes(span) ? span.attributes : {};
    const name = spanHasName(span) ? span.name : '<unknown>';
    const kind = getSpanKind(span);
    return inferSpanData(name, attributes, kind);
}
function descriptionForDbSystem({ attributes, name }) {
    // if we already have a custom name, we don't overwrite it but only set the op
    const userDefinedName = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME"]];
    if (typeof userDefinedName === 'string') {
        return {
            op: 'db',
            description: userDefinedName,
            source: attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] || 'custom'
        };
    }
    // if we already have the source set to custom, we don't overwrite the span description but only set the op
    if (attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] === 'custom') {
        return {
            op: 'db',
            description: name,
            source: 'custom'
        };
    }
    // Use DB statement (Ex "SELECT * FROM table") if possible as description.
    // eslint-disable-next-line deprecation/deprecation
    const statement = attributes[SEMATTRS_DB_STATEMENT];
    const description = statement ? statement.toString() : name;
    return {
        op: 'db',
        description,
        source: 'task'
    };
}
/** Only exported for tests. */ function descriptionForHttpMethod({ name, kind, attributes }, httpMethod) {
    const opParts = [
        'http'
    ];
    switch(kind){
        case __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].CLIENT:
            opParts.push('client');
            break;
        case __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].SERVER:
            opParts.push('server');
            break;
    }
    // Spans for HTTP requests we have determined to be prefetch requests will have a `.prefetch` postfix in the op
    if (attributes['sentry.http.prefetch']) {
        opParts.push('prefetch');
    }
    const { urlPath, url, query, fragment, hasRoute } = getSanitizedUrl(attributes, kind);
    if (!urlPath) {
        return {
            ...getUserUpdatedNameAndSource(name, attributes),
            op: opParts.join('.')
        };
    }
    const graphqlOperationsAttribute = attributes[SEMANTIC_ATTRIBUTE_SENTRY_GRAPHQL_OPERATION];
    // Ex. GET /api/users
    const baseDescription = `${httpMethod} ${urlPath}`;
    // When the http span has a graphql operation, append it to the description
    // We add these in the graphqlIntegration
    const inferredDescription = graphqlOperationsAttribute ? `${baseDescription} (${getGraphqlOperationNamesFromAttribute(graphqlOperationsAttribute)})` : baseDescription;
    // If `httpPath` is a root path, then we can categorize the transaction source as route.
    const inferredSource = hasRoute || urlPath === '/' ? 'route' : 'url';
    const data = {};
    if (url) {
        data.url = url;
    }
    if (query) {
        data['http.query'] = query;
    }
    if (fragment) {
        data['http.fragment'] = fragment;
    }
    // If the span kind is neither client nor server, we use the original name
    // this infers that somebody manually started this span, in which case we don't want to overwrite the name
    const isClientOrServerKind = kind === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].CLIENT || kind === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].SERVER;
    // If the span is an auto-span (=it comes from one of our instrumentations),
    // we always want to infer the name
    // this is necessary because some of the auto-instrumentation we use uses kind=INTERNAL
    const origin = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]] || 'manual';
    const isManualSpan = !`${origin}`.startsWith('auto');
    // If users (or in very rare occasions we) set the source to custom, we don't overwrite the name
    const alreadyHasCustomSource = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] === 'custom';
    const customSpanName = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME"]];
    const useInferredDescription = !alreadyHasCustomSource && customSpanName == null && (isClientOrServerKind || !isManualSpan);
    const { description, source } = useInferredDescription ? {
        description: inferredDescription,
        source: inferredSource
    } : getUserUpdatedNameAndSource(name, attributes);
    return {
        op: opParts.join('.'),
        description,
        source,
        data
    };
}
function getGraphqlOperationNamesFromAttribute(attr) {
    if (Array.isArray(attr)) {
        const sorted = attr.slice().sort();
        // Up to 5 items, we just add all of them
        if (sorted.length <= 5) {
            return sorted.join(', ');
        } else {
            // Else, we add the first 5 and the diff of other operations
            return `${sorted.slice(0, 5).join(', ')}, +${sorted.length - 5}`;
        }
    }
    return `${attr}`;
}
/** Exported for tests only */ function getSanitizedUrl(attributes, kind) {
    // This is the relative path of the URL, e.g. /sub
    // eslint-disable-next-line deprecation/deprecation
    const httpTarget = attributes[SEMATTRS_HTTP_TARGET];
    // This is the full URL, including host & query params etc., e.g. https://example.com/sub?foo=bar
    // eslint-disable-next-line deprecation/deprecation
    const httpUrl = attributes[SEMATTRS_HTTP_URL] || attributes[ATTR_URL_FULL];
    // This is the normalized route name - may not always be available!
    const httpRoute = attributes[ATTR_HTTP_ROUTE];
    const parsedUrl = typeof httpUrl === 'string' ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseUrl"])(httpUrl) : undefined;
    const url = parsedUrl ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSanitizedUrlString"])(parsedUrl) : undefined;
    const query = parsedUrl?.search || undefined;
    const fragment = parsedUrl?.hash || undefined;
    if (typeof httpRoute === 'string') {
        return {
            urlPath: httpRoute,
            url,
            query,
            fragment,
            hasRoute: true
        };
    }
    if (kind === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].SERVER && typeof httpTarget === 'string') {
        return {
            urlPath: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stripUrlQueryAndFragment"])(httpTarget),
            url,
            query,
            fragment,
            hasRoute: false
        };
    }
    if (parsedUrl) {
        return {
            urlPath: url,
            url,
            query,
            fragment,
            hasRoute: false
        };
    }
    // fall back to target even for client spans, if no URL is present
    if (typeof httpTarget === 'string') {
        return {
            urlPath: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stripUrlQueryAndFragment"])(httpTarget),
            url,
            query,
            fragment,
            hasRoute: false
        };
    }
    return {
        urlPath: undefined,
        url,
        query,
        fragment,
        hasRoute: false
    };
}
/**
 * Because Otel instrumentation sometimes mutates span names via `span.updateName`, the only way
 * to ensure that a user-set span name is preserved is to store it as a tmp attribute on the span.
 * We delete this attribute once we're done with it when preparing the event envelope.
 *
 * This temp attribute always takes precedence over the original name.
 *
 * We also need to take care of setting the correct source. Users can always update the source
 * after updating the name, so we need to respect that.
 *
 * @internal exported only for testing
 */ function getUserUpdatedNameAndSource(originalName, attributes, fallbackSource = 'custom') {
    const source = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] || fallbackSource;
    const description = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME"]];
    if (description && typeof description === 'string') {
        return {
            description,
            source
        };
    }
    return {
        description: originalName,
        source
    };
}
/**
 * Setup a DSC handler on the passed client,
 * ensuring that the transaction name is inferred from the span correctly.
 */ function enhanceDscWithOpenTelemetryRootSpanName(client) {
    client.on('createDsc', (dsc, rootSpan)=>{
        if (!rootSpan) {
            return;
        }
        // We want to overwrite the transaction on the DSC that is created by default in core
        // The reason for this is that we want to infer the span name, not use the initial one
        // Otherwise, we'll get names like "GET" instead of e.g. "GET /foo"
        // `parseSpanDescription` takes the attributes of the span into account for the name
        // This mutates the passed-in DSC
        const jsonSpan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(rootSpan);
        const attributes = jsonSpan.data;
        const source = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]];
        const { description } = spanHasName(rootSpan) ? parseSpanDescription(rootSpan) : {
            description: undefined
        };
        if (source !== 'url' && description) {
            dsc.transaction = description;
        }
        // Also ensure sampling decision is correctly inferred
        // In core, we use `spanIsSampled`, which just looks at the trace flags
        // but in OTEL, we use a slightly more complex logic to be able to differntiate between unsampled and deferred sampling
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])()) {
            const sampled = getSamplingDecision(rootSpan.spanContext());
            dsc.sampled = sampled == undefined ? undefined : String(sampled);
        }
    });
}
/**
 * Returns the currently active span.
 */ function getActiveSpan() {
    return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getActiveSpan();
}
/**
 * This serves as a build time flag that will be true by default, but false in non-debug builds or if users replace `__SENTRY_DEBUG__` in their generated code.
 *
 * ATTENTION: This constant must never cross package boundaries (i.e. be exported) to guarantee that it can be used for tree shaking.
 */ const DEBUG_BUILD$1 = typeof __SENTRY_DEBUG__ === 'undefined' || __SENTRY_DEBUG__;
/**
 * Generate a TraceState for the given data.
 */ function makeTraceState({ dsc, sampled }) {
    // We store the DSC as OTEL trace state on the span context
    const dscString = dsc ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dynamicSamplingContextToSentryBaggageHeader"])(dsc) : undefined;
    const traceStateBase = new TraceState();
    const traceStateWithDsc = dscString ? traceStateBase.set(SENTRY_TRACE_STATE_DSC, dscString) : traceStateBase;
    // We also specifically want to store if this is sampled to be not recording,
    // or unsampled (=could be either sampled or not)
    return sampled === false ? traceStateWithDsc.set(SENTRY_TRACE_STATE_SAMPLED_NOT_RECORDING, '1') : traceStateWithDsc;
}
const setupElements = new Set();
/** Get all the OpenTelemetry elements that have been set up. */ function openTelemetrySetupCheck() {
    return Array.from(setupElements);
}
/** Mark an OpenTelemetry element as setup. */ function setIsSetup(element) {
    setupElements.add(element);
}
/**
 * Injects and extracts `sentry-trace` and `baggage` headers from carriers.
 */ class SentryPropagator extends W3CBaggagePropagator {
    /** A map of URLs that have already been checked for if they match tracePropagationTargets. */ constructor(){
        super();
        setIsSetup('SentryPropagator');
        // We're caching results so we don't have to recompute regexp every time we create a request.
        this._urlMatchesTargetsMap = new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$lru$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["LRUMap"](100);
    }
    /**
   * @inheritDoc
   */ inject(context, carrier, setter) {
        if (isTracingSuppressed(context)) {
            DEBUG_BUILD$1 && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('[Tracing] Not injecting trace data for url because tracing is suppressed.');
            return;
        }
        const activeSpan = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(context);
        const url = activeSpan && getCurrentURL(activeSpan);
        const { tracePropagationTargets, propagateTraceparent } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])()?.getOptions() || {};
        if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracePropagationTargets$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["shouldPropagateTraceForUrl"])(url, tracePropagationTargets, this._urlMatchesTargetsMap)) {
            DEBUG_BUILD$1 && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('[Tracing] Not injecting trace data for url because it does not match tracePropagationTargets:', url);
            return;
        }
        const existingBaggageHeader = getExistingBaggage(carrier);
        let baggage = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$propagation$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["propagation"].getBaggage(context) || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$propagation$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["propagation"].createBaggage({});
        const { dynamicSamplingContext, traceId, spanId, sampled } = getInjectionData(context);
        if (existingBaggageHeader) {
            const baggageEntries = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseBaggageHeader"])(existingBaggageHeader);
            if (baggageEntries) {
                Object.entries(baggageEntries).forEach(([key, value])=>{
                    baggage = baggage.setEntry(key, {
                        value
                    });
                });
            }
        }
        if (dynamicSamplingContext) {
            baggage = Object.entries(dynamicSamplingContext).reduce((b, [dscKey, dscValue])=>{
                if (dscValue) {
                    return b.setEntry(`${__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SENTRY_BAGGAGE_KEY_PREFIX"]}${dscKey}`, {
                        value: dscValue
                    });
                }
                return b;
            }, baggage);
        }
        // We also want to avoid setting the default OTEL trace ID, if we get that for whatever reason
        if (traceId && traceId !== __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$invalid$2d$span$2d$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["INVALID_TRACEID"]) {
            setter.set(carrier, SENTRY_TRACE_HEADER, (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateSentryTraceHeader"])(traceId, spanId, sampled));
            if (propagateTraceparent) {
                setter.set(carrier, 'traceparent', (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceparentHeader"])(traceId, spanId, sampled));
            }
        }
        super.inject(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$propagation$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["propagation"].setBaggage(context, baggage), carrier, setter);
    }
    /**
   * @inheritDoc
   */ extract(context, carrier, getter) {
        const maybeSentryTraceHeader = getter.get(carrier, SENTRY_TRACE_HEADER);
        const baggage = getter.get(carrier, SENTRY_BAGGAGE_HEADER);
        const sentryTrace = maybeSentryTraceHeader ? Array.isArray(maybeSentryTraceHeader) ? maybeSentryTraceHeader[0] : maybeSentryTraceHeader : undefined;
        // Add remote parent span context
        // If there is no incoming trace, this will return the context as-is
        return ensureScopesOnContext(getContextWithRemoteActiveSpan(context, {
            sentryTrace,
            baggage
        }));
    }
    /**
   * @inheritDoc
   */ fields() {
        return [
            SENTRY_TRACE_HEADER,
            SENTRY_BAGGAGE_HEADER,
            'traceparent'
        ];
    }
}
/**
 * Get propagation injection data for the given context.
 * The additional options can be passed to override the scope and client that is otherwise derived from the context.
 */ function getInjectionData(context, options = {}) {
    const span = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(context);
    // If we have a remote span, the spanId should be considered as the parentSpanId, not spanId itself
    // Instead, we use a virtual (generated) spanId for propagation
    if (span?.spanContext().isRemote) {
        const spanContext = span.spanContext();
        const dynamicSamplingContext = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(span);
        return {
            dynamicSamplingContext,
            traceId: spanContext.traceId,
            spanId: undefined,
            sampled: getSamplingDecision(spanContext)
        };
    }
    // If we have a local span, we just use this
    if (span) {
        const spanContext = span.spanContext();
        const dynamicSamplingContext = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(span);
        return {
            dynamicSamplingContext,
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
            sampled: getSamplingDecision(spanContext)
        };
    }
    // Else we try to use the propagation context from the scope
    // The only scenario where this should happen is when we neither have a span, nor an incoming trace
    const scope = options.scope || getScopesFromContext(context)?.scope || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])();
    const client = options.client || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    const propagationContext = scope.getPropagationContext();
    const dynamicSamplingContext = client ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromScope"])(client, scope) : undefined;
    return {
        dynamicSamplingContext,
        traceId: propagationContext.traceId,
        spanId: propagationContext.propagationSpanId,
        sampled: propagationContext.sampled
    };
}
function getContextWithRemoteActiveSpan(ctx, { sentryTrace, baggage }) {
    const propagationContext = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["propagationContextFromHeaders"])(sentryTrace, baggage);
    const { traceId, parentSpanId, sampled, dsc } = propagationContext;
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    const incomingDsc = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["baggageHeaderToDynamicSamplingContext"])(baggage);
    // We only want to set the virtual span if we are continuing a concrete trace
    // Otherwise, we ignore the incoming trace here, e.g. if we have no trace headers
    if (!parentSpanId || client && !(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["shouldContinueTrace"])(client, incomingDsc?.org_id)) {
        return ctx;
    }
    const spanContext = generateRemoteSpanContext({
        traceId,
        spanId: parentSpanId,
        sampled,
        dsc
    });
    return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].setSpanContext(ctx, spanContext);
}
/**
 * Takes trace strings and propagates them as a remote active span.
 * This should be used in addition to `continueTrace` in OTEL-powered environments.
 */ function continueTraceAsRemoteSpan(ctx, options, callback) {
    const ctxWithSpanContext = ensureScopesOnContext(getContextWithRemoteActiveSpan(ctx, options));
    return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(ctxWithSpanContext, callback);
}
function ensureScopesOnContext(ctx) {
    // If there are no scopes yet on the context, ensure we have them
    const scopes = getScopesFromContext(ctx);
    const newScopes = {
        // If we have no scope here, this is most likely either the root context or a context manually derived from it
        // In this case, we want to fork the current scope, to ensure we do not pollute the root scope
        scope: scopes ? scopes.scope : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])().clone(),
        isolationScope: scopes ? scopes.isolationScope : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])()
    };
    return setScopesOnContext(ctx, newScopes);
}
/** Try to get the existing baggage header so we can merge this in. */ function getExistingBaggage(carrier) {
    try {
        const baggage = carrier[SENTRY_BAGGAGE_HEADER];
        return Array.isArray(baggage) ? baggage.join(',') : baggage;
    } catch  {
        return undefined;
    }
}
/**
 * It is pretty tricky to get access to the outgoing request URL of a request in the propagator.
 * As we only have access to the context of the span to be sent and the carrier (=headers),
 * but the span may be unsampled and thus have no attributes.
 *
 * So we use the following logic:
 * 1. If we have an active span, we check if it has a URL attribute.
 * 2. Else, if the active span has no URL attribute (e.g. it is unsampled), we check a special trace state (which we set in our sampler).
 */ function getCurrentURL(span) {
    const spanData = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span).data;
    // `ATTR_URL_FULL` is the new attribute, but we still support the old one, `SEMATTRS_HTTP_URL`, for now.
    // eslint-disable-next-line deprecation/deprecation
    const urlAttribute = spanData[SEMATTRS_HTTP_URL] || spanData[ATTR_URL_FULL];
    if (typeof urlAttribute === 'string') {
        return urlAttribute;
    }
    // Also look at the traceState, which we may set in the sampler even for unsampled spans
    const urlTraceState = span.spanContext().traceState?.get(SENTRY_TRACE_STATE_URL);
    if (urlTraceState) {
        return urlTraceState;
    }
    return undefined;
}
function generateRemoteSpanContext({ spanId, traceId, sampled, dsc }) {
    // We store the DSC as OTEL trace state on the span context
    const traceState = makeTraceState({
        dsc,
        sampled
    });
    const spanContext = {
        traceId,
        spanId,
        isRemote: true,
        traceFlags: sampled ? __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].SAMPLED : __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].NONE,
        traceState
    };
    return spanContext;
}
/**
 * Internal helper for starting spans and manual spans. See {@link startSpan} and {@link startSpanManual} for the public APIs.
 * @param options - The span context options
 * @param callback - The callback to execute with the span
 * @param autoEnd - Whether to automatically end the span after the callback completes
 */ function _startSpan(options, callback, autoEnd) {
    const tracer = getTracer();
    const { name, parentSpan: customParentSpan } = options;
    // If `options.parentSpan` is defined, we want to wrap the callback in `withActiveSpan`
    const wrapper = getActiveSpanWrapper(customParentSpan);
    return wrapper(()=>{
        const activeCtx = getContext(options.scope, options.forceTransaction);
        const shouldSkipSpan = options.onlyIfParent && !__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(activeCtx);
        const ctx = shouldSkipSpan ? suppressTracing$1(activeCtx) : activeCtx;
        const spanOptions = getSpanOptions(options);
        // If spans are not enabled, ensure we suppress tracing for the span creation
        // but preserve the original context for the callback execution
        // This ensures that we don't create spans when tracing is disabled which
        // would otherwise be a problem for users that don't enable tracing but use
        // custom OpenTelemetry setups.
        if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])()) {
            const suppressedCtx = isTracingSuppressed(ctx) ? ctx : suppressTracing$1(ctx);
            return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(suppressedCtx, ()=>{
                return tracer.startActiveSpan(name, spanOptions, suppressedCtx, (span)=>{
                    // Restore the original unsuppressed context for the callback execution
                    // so that custom OpenTelemetry spans maintain the correct context.
                    // We use activeCtx (not ctx) because ctx may be suppressed when onlyIfParent is true
                    // and no parent span exists. Using activeCtx ensures custom OTel spans are never
                    // inadvertently suppressed.
                    return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(activeCtx, ()=>{
                        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$handleCallbackErrors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["handleCallbackErrors"])(()=>callback(span), ()=>{
                            // Only set the span status to ERROR when there wasn't any status set before, in order to avoid stomping useful span statuses
                            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span).status === undefined) {
                                span.setStatus({
                                    code: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$status$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanStatusCode"].ERROR
                                });
                            }
                        }, autoEnd ? ()=>span.end() : undefined);
                    });
                });
            });
        }
        return tracer.startActiveSpan(name, spanOptions, ctx, (span)=>{
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$handleCallbackErrors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["handleCallbackErrors"])(()=>callback(span), ()=>{
                // Only set the span status to ERROR when there wasn't any status set before, in order to avoid stomping useful span statuses
                if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span).status === undefined) {
                    span.setStatus({
                        code: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$status$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanStatusCode"].ERROR
                    });
                }
            }, autoEnd ? ()=>span.end() : undefined);
        });
    });
}
/**
 * Wraps a function with a transaction/span and finishes the span after the function is done.
 * The created span is the active span and will be used as parent by other spans created inside the function
 * and can be accessed via `Sentry.getActiveSpan()`, as long as the function is executed while the scope is active.
 *
 * If you want to create a span that is not set as active, use {@link startInactiveSpan}.
 *
 * You'll always get a span passed to the callback,
 * it may just be a non-recording span if the span is not sampled or if tracing is disabled.
 */ function startSpan(options, callback) {
    return _startSpan(options, callback, true);
}
/**
 * Similar to `Sentry.startSpan`. Wraps a function with a span, but does not finish the span
 * after the function is done automatically. You'll have to call `span.end()` or the `finish` function passed to the callback manually.
 *
 * The created span is the active span and will be used as parent by other spans created inside the function
 * and can be accessed via `Sentry.getActiveSpan()`, as long as the function is executed while the scope is active.
 *
 * You'll always get a span passed to the callback,
 * it may just be a non-recording span if the span is not sampled or if tracing is disabled.
 */ function startSpanManual(options, callback) {
    return _startSpan(options, (span)=>callback(span, ()=>span.end()), false);
}
/**
 * Creates a span. This span is not set as active, so will not get automatic instrumentation spans
 * as children or be able to be accessed via `Sentry.getActiveSpan()`.
 *
 * If you want to create a span that is set as active, use {@link startSpan}.
 *
 * This function will always return a span,
 * it may just be a non-recording span if the span is not sampled or if tracing is disabled.
 */ function startInactiveSpan(options) {
    const tracer = getTracer();
    const { name, parentSpan: customParentSpan } = options;
    // If `options.parentSpan` is defined, we want to wrap the callback in `withActiveSpan`
    const wrapper = getActiveSpanWrapper(customParentSpan);
    return wrapper(()=>{
        const activeCtx = getContext(options.scope, options.forceTransaction);
        const shouldSkipSpan = options.onlyIfParent && !__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(activeCtx);
        let ctx = shouldSkipSpan ? suppressTracing$1(activeCtx) : activeCtx;
        const spanOptions = getSpanOptions(options);
        if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])()) {
            ctx = isTracingSuppressed(ctx) ? ctx : suppressTracing$1(ctx);
        }
        return tracer.startSpan(name, spanOptions, ctx);
    });
}
/**
 * Forks the current scope and sets the provided span as active span in the context of the provided callback. Can be
 * passed `null` to start an entirely new span tree.
 *
 * @param span Spans started in the context of the provided callback will be children of this span. If `null` is passed,
 * spans started within the callback will be root spans.
 * @param callback Execution context in which the provided span will be active. Is passed the newly forked scope.
 * @returns the value returned from the provided callback function.
 */ function withActiveSpan(span, callback) {
    const newContextWithActiveSpan = span ? __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].setSpan(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active(), span) : __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].deleteSpan(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active());
    return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(newContextWithActiveSpan, ()=>callback((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])()));
}
function getTracer() {
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    return client?.tracer || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getTracer('@sentry/opentelemetry', __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_VERSION"]);
}
function getSpanOptions(options) {
    const { startTime, attributes, kind, op, links } = options;
    // OTEL expects timestamps in ms, not seconds
    const fixedStartTime = typeof startTime === 'number' ? ensureTimestampInMilliseconds(startTime) : startTime;
    return {
        attributes: op ? {
            [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]]: op,
            ...attributes
        } : attributes,
        kind,
        links,
        startTime: fixedStartTime
    };
}
function ensureTimestampInMilliseconds(timestamp) {
    const isMs = timestamp < 9999999999;
    return isMs ? timestamp * 1000 : timestamp;
}
function getContext(scope, forceTransaction) {
    const ctx = getContextForScope(scope);
    const parentSpan = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(ctx);
    // In the case that we have no parent span, we start a new trace
    // Note that if we continue a trace, we'll always have a remote parent span here anyhow
    if (!parentSpan) {
        return ctx;
    }
    // If we don't want to force a transaction, and we have a parent span, all good, we just return as-is!
    if (!forceTransaction) {
        return ctx;
    }
    // Else, if we do have a parent span but want to force a transaction, we have to simulate a "root" context
    // Else, we need to do two things:
    // 1. Unset the parent span from the context, so we'll create a new root span
    // 2. Ensure the propagation context is correct, so we'll continue from the parent span
    const ctxWithoutSpan = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].deleteSpan(ctx);
    const { spanId, traceId } = parentSpan.spanContext();
    const sampled = getSamplingDecision(parentSpan.spanContext());
    // In this case, when we are forcing a transaction, we want to treat this like continuing an incoming trace
    // so we set the traceState according to the root span
    const rootSpan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(parentSpan);
    const dsc = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(rootSpan);
    const traceState = makeTraceState({
        dsc,
        sampled
    });
    const spanOptions = {
        traceId,
        spanId,
        isRemote: true,
        traceFlags: sampled ? __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].SAMPLED : __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$trace_flags$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TraceFlags"].NONE,
        traceState
    };
    const ctxWithSpanContext = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].setSpanContext(ctxWithoutSpan, spanOptions);
    return ctxWithSpanContext;
}
function getContextForScope(scope) {
    if (scope) {
        const ctx = getContextFromScope(scope);
        if (ctx) {
            return ctx;
        }
    }
    return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
}
/**
 * Continue a trace from `sentry-trace` and `baggage` values.
 * These values can be obtained from incoming request headers, or in the browser from `<meta name="sentry-trace">`
 * and `<meta name="baggage">` HTML tags.
 *
 * Spans started with `startSpan`, `startSpanManual` and `startInactiveSpan`, within the callback will automatically
 * be attached to the incoming trace.
 *
 * This is a custom version of `continueTrace` that is used in OTEL-powered environments.
 * It propagates the trace as a remote span, in addition to setting it on the propagation context.
 */ function continueTrace(options, callback) {
    return continueTraceAsRemoteSpan(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active(), options, callback);
}
function getActiveSpanWrapper(parentSpan) {
    return parentSpan !== undefined ? (callback)=>{
        return withActiveSpan(parentSpan, callback);
    } : (callback)=>callback();
}
/** Suppress tracing in the given callback, ensuring no spans are generated inside of it. */ function suppressTracing(callback) {
    const ctx = suppressTracing$1(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active());
    return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(ctx, callback);
}
/** Ensure the `trace` context is set on all events. */ function setupEventContextTrace(client) {
    client.on('preprocessEvent', (event)=>{
        const span = getActiveSpan();
        // For transaction events, this is handled separately
        // Because the active span may not be the span that is actually the transaction event
        if (!span || event.type === 'transaction') {
            return;
        }
        // If event has already set `trace` context, use that one.
        event.contexts = {
            trace: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToTraceContext"])(span),
            ...event.contexts
        };
        const rootSpan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(span);
        event.sdkProcessingMetadata = {
            dynamicSamplingContext: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(rootSpan),
            ...event.sdkProcessingMetadata
        };
        return event;
    });
}
/**
 * Otel-specific implementation of `getTraceData`.
 * @see `@sentry/core` version of `getTraceData` for more information
 */ function getTraceData({ span, scope, client, propagateTraceparent } = {}) {
    let ctx = (scope && getContextFromScope(scope)) ?? __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
    if (span) {
        const { scope } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCapturedScopesOnSpan"])(span);
        // fall back to current context if for whatever reason we can't find the one of the span
        ctx = scope && getContextFromScope(scope) || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].setSpan(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active(), span);
    }
    const { traceId, spanId, sampled, dynamicSamplingContext } = getInjectionData(ctx, {
        scope,
        client
    });
    const traceData = {
        'sentry-trace': (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateSentryTraceHeader"])(traceId, spanId, sampled),
        baggage: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dynamicSamplingContextToSentryBaggageHeader"])(dynamicSamplingContext)
    };
    if (propagateTraceparent) {
        traceData.traceparent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceparentHeader"])(traceId, spanId, sampled);
    }
    return traceData;
}
/**
 * Sets the async context strategy to use follow the OTEL context under the hood.
 * We handle forking a hub inside of our custom OTEL Context Manager (./otelContextManager.ts)
 */ function setOpenTelemetryContextAsyncContextStrategy() {
    function getScopes() {
        const ctx = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
        const scopes = getScopesFromContext(ctx);
        if (scopes) {
            return scopes;
        }
        // fallback behavior:
        // if, for whatever reason, we can't find scopes on the context here, we have to fix this somehow
        return {
            scope: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$defaultScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDefaultCurrentScope"])(),
            isolationScope: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$defaultScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDefaultIsolationScope"])()
        };
    }
    function withScope(callback) {
        const ctx = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
        // We depend on the otelContextManager to handle the context/hub
        // We set the `SENTRY_FORK_ISOLATION_SCOPE_CONTEXT_KEY` context value, which is picked up by
        // the OTEL context manager, which uses the presence of this key to determine if it should
        // fork the isolation scope, or not
        // as by default, we don't want to fork this, unless triggered explicitly by `withScope`
        return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(ctx, ()=>{
            return callback(getCurrentScope());
        });
    }
    function withSetScope(scope, callback) {
        const ctx = getContextFromScope(scope) || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
        // We depend on the otelContextManager to handle the context/hub
        // We set the `SENTRY_FORK_SET_SCOPE_CONTEXT_KEY` context value, which is picked up by
        // the OTEL context manager, which picks up this scope as the current scope
        return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(ctx.setValue(SENTRY_FORK_SET_SCOPE_CONTEXT_KEY, scope), ()=>{
            return callback(scope);
        });
    }
    function withIsolationScope(callback) {
        const ctx = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
        // We depend on the otelContextManager to handle the context/hub
        // We set the `SENTRY_FORK_ISOLATION_SCOPE_CONTEXT_KEY` context value, which is picked up by
        // the OTEL context manager, which uses the presence of this key to determine if it should
        // fork the isolation scope, or not
        return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(ctx.setValue(SENTRY_FORK_ISOLATION_SCOPE_CONTEXT_KEY, true), ()=>{
            return callback(getIsolationScope());
        });
    }
    function withSetIsolationScope(isolationScope, callback) {
        const ctx = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].active();
        // We depend on the otelContextManager to handle the context/hub
        // We set the `SENTRY_FORK_ISOLATION_SCOPE_CONTEXT_KEY` context value, which is picked up by
        // the OTEL context manager, which uses the presence of this key to determine if it should
        // fork the isolation scope, or not
        return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].with(ctx.setValue(SENTRY_FORK_SET_ISOLATION_SCOPE_CONTEXT_KEY, isolationScope), ()=>{
            return callback(getIsolationScope());
        });
    }
    function getCurrentScope() {
        return getScopes().scope;
    }
    function getIsolationScope() {
        return getScopes().isolationScope;
    }
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["setAsyncContextStrategy"])({
        withScope,
        withSetScope,
        withSetIsolationScope,
        withIsolationScope,
        getCurrentScope,
        getIsolationScope,
        startSpan,
        startSpanManual,
        startInactiveSpan,
        getActiveSpan,
        suppressTracing,
        getTraceData,
        continueTrace,
        // The types here don't fully align, because our own `Span` type is narrower
        // than the OTEL one - but this is OK for here, as we now we'll only have OTEL spans passed around
        withActiveSpan: withActiveSpan
    });
}
/**
 * Wrap an OpenTelemetry ContextManager in a way that ensures the context is kept in sync with the Sentry Scope.
 *
 * Usage:
 * import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
 * const SentryContextManager = wrapContextManagerClass(AsyncLocalStorageContextManager);
 * const contextManager = new SentryContextManager();
 */ function wrapContextManagerClass(ContextManagerClass) {
    /**
   * This is a custom ContextManager for OpenTelemetry, which extends the default AsyncLocalStorageContextManager.
   * It ensures that we create new scopes per context, so that the OTEL Context & the Sentry Scope are always in sync.
   *
   * Note that we currently only support AsyncHooks with this,
   * but since this should work for Node 14+ anyhow that should be good enough.
   */ // @ts-expect-error TS does not like this, but we know this is fine
    class SentryContextManager extends ContextManagerClass {
        constructor(...args){
            super(...args);
            setIsSetup('SentryContextManager');
        }
        /**
     * Overwrite with() of the original AsyncLocalStorageContextManager
     * to ensure we also create new scopes per context.
     */ with(context, fn, thisArg, ...args) {
            const currentScopes = getScopesFromContext(context);
            const currentScope = currentScopes?.scope || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])();
            const currentIsolationScope = currentScopes?.isolationScope || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])();
            const shouldForkIsolationScope = context.getValue(SENTRY_FORK_ISOLATION_SCOPE_CONTEXT_KEY) === true;
            const scope = context.getValue(SENTRY_FORK_SET_SCOPE_CONTEXT_KEY);
            const isolationScope = context.getValue(SENTRY_FORK_SET_ISOLATION_SCOPE_CONTEXT_KEY);
            const newCurrentScope = scope || currentScope.clone();
            const newIsolationScope = isolationScope || (shouldForkIsolationScope ? currentIsolationScope.clone() : currentIsolationScope);
            const scopes = {
                scope: newCurrentScope,
                isolationScope: newIsolationScope
            };
            const ctx1 = setScopesOnContext(context, scopes);
            // Remove the unneeded values again
            const ctx2 = ctx1.deleteValue(SENTRY_FORK_ISOLATION_SCOPE_CONTEXT_KEY).deleteValue(SENTRY_FORK_SET_SCOPE_CONTEXT_KEY).deleteValue(SENTRY_FORK_SET_ISOLATION_SCOPE_CONTEXT_KEY);
            setContextOnScope(newCurrentScope, ctx2);
            return super.with(ctx2, fn, thisArg, ...args);
        }
        /**
     * Gets underlying AsyncLocalStorage and symbol to allow lookup of scope.
     */ getAsyncLocalStorageLookup() {
            return {
                // @ts-expect-error This is on the base class, but not part of the interface
                asyncLocalStorage: this._asyncLocalStorage,
                contextSymbol: SENTRY_SCOPES_CONTEXT_KEY
            };
        }
    }
    return SentryContextManager;
}
/**
 * This function runs through a list of OTEL Spans, and wraps them in an `SpanNode`
 * where each node holds a reference to their parent node.
 */ function groupSpansWithParents(spans) {
    const nodeMap = new Map();
    for (const span of spans){
        createOrUpdateSpanNodeAndRefs(nodeMap, span);
    }
    return Array.from(nodeMap, function([_id, spanNode]) {
        return spanNode;
    });
}
/**
 * This returns the _local_ parent ID - `parentId` on the span may point to a remote span.
 */ function getLocalParentId(span) {
    const parentIsRemote = span.attributes[SEMANTIC_ATTRIBUTE_SENTRY_PARENT_IS_REMOTE] === true;
    // If the parentId is the trace parent ID, we pretend it's undefined
    // As this means the parent exists somewhere else
    return !parentIsRemote ? getParentSpanId(span) : undefined;
}
function createOrUpdateSpanNodeAndRefs(nodeMap, span) {
    const id = span.spanContext().spanId;
    const parentId = getLocalParentId(span);
    if (!parentId) {
        createOrUpdateNode(nodeMap, {
            id,
            span,
            children: []
        });
        return;
    }
    // Else make sure to create parent node as well
    // Note that the parent may not know it's parent _yet_, this may be updated in a later pass
    const parentNode = createOrGetParentNode(nodeMap, parentId);
    const node = createOrUpdateNode(nodeMap, {
        id,
        span,
        parentNode,
        children: []
    });
    parentNode.children.push(node);
}
function createOrGetParentNode(nodeMap, id) {
    const existing = nodeMap.get(id);
    if (existing) {
        return existing;
    }
    return createOrUpdateNode(nodeMap, {
        id,
        children: []
    });
}
function createOrUpdateNode(nodeMap, spanNode) {
    const existing = nodeMap.get(spanNode.id);
    // If span is already set, nothing to do here
    if (existing?.span) {
        return existing;
    }
    // If it exists but span is not set yet, we update it
    if (existing && !existing.span) {
        existing.span = spanNode.span;
        existing.parentNode = spanNode.parentNode;
        return existing;
    }
    // Else, we create a new one...
    nodeMap.set(spanNode.id, spanNode);
    return spanNode;
}
// canonicalCodesGrpcMap maps some GRPC codes to Sentry's span statuses. See description in grpc documentation.
const canonicalGrpcErrorCodesMap = {
    '1': 'cancelled',
    '2': 'unknown_error',
    '3': 'invalid_argument',
    '4': 'deadline_exceeded',
    '5': 'not_found',
    '6': 'already_exists',
    '7': 'permission_denied',
    '8': 'resource_exhausted',
    '9': 'failed_precondition',
    '10': 'aborted',
    '11': 'out_of_range',
    '12': 'unimplemented',
    '13': 'internal_error',
    '14': 'unavailable',
    '15': 'data_loss',
    '16': 'unauthenticated'
};
const isStatusErrorMessageValid = (message)=>{
    return Object.values(canonicalGrpcErrorCodesMap).includes(message);
};
/**
 * Get a Sentry span status from an otel span.
 */ function mapStatus(span) {
    const attributes = spanHasAttributes(span) ? span.attributes : {};
    const status = spanHasStatus(span) ? span.status : undefined;
    if (status) {
        // Since span status OK is not set by default, we give it priority: https://opentelemetry.io/docs/concepts/signals/traces/#span-status
        if (status.code === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$status$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanStatusCode"].OK) {
            return {
                code: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_OK"]
            };
        // If the span is already marked as erroneous we return that exact status
        } else if (status.code === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$status$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanStatusCode"].ERROR) {
            if (typeof status.message === 'undefined') {
                const inferredStatus = inferStatusFromAttributes(attributes);
                if (inferredStatus) {
                    return inferredStatus;
                }
            }
            if (status.message && isStatusErrorMessageValid(status.message)) {
                return {
                    code: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_ERROR"],
                    message: status.message
                };
            } else {
                return {
                    code: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_ERROR"],
                    message: 'internal_error'
                };
            }
        }
    }
    // If the span status is UNSET, we try to infer it from HTTP or GRPC status codes.
    const inferredStatus = inferStatusFromAttributes(attributes);
    if (inferredStatus) {
        return inferredStatus;
    }
    // We default to setting the spans status to ok.
    if (status?.code === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$status$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanStatusCode"].UNSET) {
        return {
            code: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_OK"]
        };
    } else {
        return {
            code: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_ERROR"],
            message: 'unknown_error'
        };
    }
}
function inferStatusFromAttributes(attributes) {
    // If the span status is UNSET, we try to infer it from HTTP or GRPC status codes.
    // eslint-disable-next-line deprecation/deprecation
    const httpCodeAttribute = attributes[ATTR_HTTP_RESPONSE_STATUS_CODE] || attributes[SEMATTRS_HTTP_STATUS_CODE];
    // eslint-disable-next-line deprecation/deprecation
    const grpcCodeAttribute = attributes[SEMATTRS_RPC_GRPC_STATUS_CODE];
    const numberHttpCode = typeof httpCodeAttribute === 'number' ? httpCodeAttribute : typeof httpCodeAttribute === 'string' ? parseInt(httpCodeAttribute) : undefined;
    if (typeof numberHttpCode === 'number') {
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSpanStatusFromHttpCode"])(numberHttpCode);
    }
    if (typeof grpcCodeAttribute === 'string') {
        return {
            code: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_ERROR"],
            message: canonicalGrpcErrorCodesMap[grpcCodeAttribute] || 'unknown_error'
        };
    }
    return undefined;
}
const MAX_SPAN_COUNT = 1000;
const DEFAULT_TIMEOUT = 300; // 5 min
/**
 * A Sentry-specific exporter that converts OpenTelemetry Spans to Sentry Spans & Transactions.
 */ class SentrySpanExporter {
    /*
   * A quick explanation on the buckets: We do bucketing of finished spans for efficiency. This span exporter is
   * accumulating spans until a root span is encountered and then it flushes all the spans that are descendants of that
   * root span. Because it is totally in the realm of possibilities that root spans are never finished, and we don't
   * want to accumulate spans indefinitely in memory, we need to periodically evacuate spans. Naively we could simply
   * store the spans in an array and each time a new span comes in we could iterate through the entire array and
   * evacuate all spans that have an end-timestamp that is older than our limit. This could get quite expensive because
   * we would have to iterate a potentially large number of spans every time we evacuate. We want to avoid these large
   * bursts of computation.
   *
   * Instead we go for a bucketing approach and put spans into buckets, based on what second
   * (modulo the time limit) the span was put into the exporter. With buckets, when we decide to evacuate, we can
   * iterate through the bucket entries instead, which have an upper bound of items, making the evacuation much more
   * efficient. Cleaning up also becomes much more efficient since it simply involves de-referencing a bucket within the
   * bucket array, and letting garbage collection take care of the rest.
   */ // Essentially a a set of span ids that are already sent. The values are expiration
    // times in this cache so we don't hold onto them indefinitely.
    /* Internally, we use a debounced flush to give some wiggle room to the span processor to accumulate more spans. */ constructor(options){
        this._finishedSpanBucketSize = options?.timeout || DEFAULT_TIMEOUT;
        this._finishedSpanBuckets = new Array(this._finishedSpanBucketSize).fill(undefined);
        this._lastCleanupTimestampInS = Math.floor((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeDateNow__as__$5f$INTERNAL_safeDateNow$3e$__["_INTERNAL_safeDateNow"])() / 1000);
        this._spansToBucketEntry = new WeakMap();
        this._sentSpans = new Map();
        this._debouncedFlush = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debounce$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debounce"])(this.flush.bind(this), 1, {
            maxWait: 100
        });
    }
    /**
   * Export a single span.
   * This is called by the span processor whenever a span is ended.
   */ export(span) {
        const currentTimestampInS = Math.floor((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeDateNow__as__$5f$INTERNAL_safeDateNow$3e$__["_INTERNAL_safeDateNow"])() / 1000);
        if (this._lastCleanupTimestampInS !== currentTimestampInS) {
            let droppedSpanCount = 0;
            this._finishedSpanBuckets.forEach((bucket, i)=>{
                if (bucket && bucket.timestampInS <= currentTimestampInS - this._finishedSpanBucketSize) {
                    droppedSpanCount += bucket.spans.size;
                    this._finishedSpanBuckets[i] = undefined;
                }
            });
            if (droppedSpanCount > 0) {
                DEBUG_BUILD$1 && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`SpanExporter dropped ${droppedSpanCount} spans because they were pending for more than ${this._finishedSpanBucketSize} seconds.`);
            }
            this._lastCleanupTimestampInS = currentTimestampInS;
        }
        const currentBucketIndex = currentTimestampInS % this._finishedSpanBucketSize;
        const currentBucket = this._finishedSpanBuckets[currentBucketIndex] || {
            timestampInS: currentTimestampInS,
            spans: new Set()
        };
        this._finishedSpanBuckets[currentBucketIndex] = currentBucket;
        currentBucket.spans.add(span);
        this._spansToBucketEntry.set(span, currentBucket);
        // If the span doesn't have a local parent ID (it's a root span), we're gonna flush all the ended spans
        const localParentId = getLocalParentId(span);
        if (!localParentId || this._sentSpans.has(localParentId)) {
            this._debouncedFlush();
        }
    }
    /**
   * Try to flush any pending spans immediately.
   * This is called internally by the exporter (via _debouncedFlush),
   * but can also be triggered externally if we force-flush.
   */ flush() {
        const finishedSpans = this._finishedSpanBuckets.flatMap((bucket)=>bucket ? Array.from(bucket.spans) : []);
        this._flushSentSpanCache();
        const sentSpans = this._maybeSend(finishedSpans);
        const sentSpanCount = sentSpans.size;
        const remainingOpenSpanCount = finishedSpans.length - sentSpanCount;
        DEBUG_BUILD$1 && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`SpanExporter exported ${sentSpanCount} spans, ${remainingOpenSpanCount} spans are waiting for their parent spans to finish`);
        const expirationDate = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeDateNow__as__$5f$INTERNAL_safeDateNow$3e$__["_INTERNAL_safeDateNow"])() + DEFAULT_TIMEOUT * 1000;
        for (const span of sentSpans){
            this._sentSpans.set(span.spanContext().spanId, expirationDate);
            const bucketEntry = this._spansToBucketEntry.get(span);
            if (bucketEntry) {
                bucketEntry.spans.delete(span);
            }
        }
        // Cancel a pending debounced flush, if there is one
        // This can be relevant if we directly flush, circumventing the debounce
        // in that case, we want to cancel any pending debounced flush
        this._debouncedFlush.cancel();
    }
    /**
   * Clear the exporter.
   * This is called when the span processor is shut down.
   */ clear() {
        this._finishedSpanBuckets = this._finishedSpanBuckets.fill(undefined);
        this._sentSpans.clear();
        this._debouncedFlush.cancel();
    }
    /**
   * Send the given spans, but only if they are part of a finished transaction.
   *
   * Returns the sent spans.
   * Spans remain unsent when their parent span is not yet finished.
   * This will happen regularly, as child spans are generally finished before their parents.
   * But it _could_ also happen because, for whatever reason, a parent span was lost.
   * In this case, we'll eventually need to clean this up.
   */ _maybeSend(spans) {
        const grouped = groupSpansWithParents(spans);
        const sentSpans = new Set();
        const rootNodes = this._getCompletedRootNodes(grouped);
        for (const root of rootNodes){
            const span = root.span;
            sentSpans.add(span);
            const transactionEvent = createTransactionForOtelSpan(span);
            // Add an attribute to the transaction event to indicate that this transaction is an orphaned transaction
            if (root.parentNode && this._sentSpans.has(root.parentNode.id)) {
                const traceData = transactionEvent.contexts?.trace?.data;
                if (traceData) {
                    traceData['sentry.parent_span_already_sent'] = true;
                }
            }
            // We'll recursively add all the child spans to this array
            const spans = transactionEvent.spans || [];
            for (const child of root.children){
                createAndFinishSpanForOtelSpan(child, spans, sentSpans);
            }
            // spans.sort() mutates the array, but we do not use this anymore after this point
            // so we can safely mutate it here
            transactionEvent.spans = spans.length > MAX_SPAN_COUNT ? spans.sort((a, b)=>a.start_timestamp - b.start_timestamp).slice(0, MAX_SPAN_COUNT) : spans;
            const measurements = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$measurement$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timedEventsToMeasurements"])(span.events);
            if (measurements) {
                transactionEvent.measurements = measurements;
            }
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$exports$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["captureEvent"])(transactionEvent);
        }
        return sentSpans;
    }
    /** Remove "expired" span id entries from the _sentSpans cache. */ _flushSentSpanCache() {
        const currentTimestamp = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeDateNow__as__$5f$INTERNAL_safeDateNow$3e$__["_INTERNAL_safeDateNow"])();
        // Note, it is safe to delete items from the map as we go: https://stackoverflow.com/a/35943995/90297
        for (const [spanId, expirationTime] of this._sentSpans.entries()){
            if (expirationTime <= currentTimestamp) {
                this._sentSpans.delete(spanId);
            }
        }
    }
    /** Check if a node is a completed root node or a node whose parent has already been sent */ _nodeIsCompletedRootNodeOrHasSentParent(node) {
        return !!node.span && (!node.parentNode || this._sentSpans.has(node.parentNode.id));
    }
    /** Get all completed root nodes from a list of nodes */ _getCompletedRootNodes(nodes) {
        // TODO: We should be able to remove the explicit `node is SpanNodeCompleted` type guard
        //       once we stop supporting TS < 5.5
        return nodes.filter((node)=>this._nodeIsCompletedRootNodeOrHasSentParent(node));
    }
}
function parseSpan(span) {
    const attributes = span.attributes;
    const origin = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]];
    const op = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]];
    const source = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]];
    return {
        origin,
        op,
        source
    };
}
/** Exported only for tests. */ function createTransactionForOtelSpan(span) {
    const { op, description, data, origin = 'manual', source } = getSpanData(span);
    const capturedSpanScopes = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCapturedScopesOnSpan"])(span);
    const sampleRate = span.attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE"]];
    const attributes = {
        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]]: source,
        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE"]]: sampleRate,
        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]]: op,
        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]]: origin,
        ...data,
        ...removeSentryAttributes(span.attributes)
    };
    const { links } = span;
    const { traceId: trace_id, spanId: span_id } = span.spanContext();
    // If parentSpanIdFromTraceState is defined at all, we want it to take precedence
    // In that case, an empty string should be interpreted as "no parent span id",
    // even if `span.parentSpanId` is set
    // this is the case when we are starting a new trace, where we have a virtual span based on the propagationContext
    // We only want to continue the traceId in this case, but ignore the parent span
    const parent_span_id = getParentSpanId(span);
    const status = mapStatus(span);
    const traceContext = {
        parent_span_id,
        span_id,
        trace_id,
        data: attributes,
        origin,
        op,
        status: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getStatusMessage"])(status),
        links: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["convertSpanLinksForEnvelope"])(links)
    };
    const statusCode = attributes[ATTR_HTTP_RESPONSE_STATUS_CODE];
    const responseContext = typeof statusCode === 'number' ? {
        response: {
            status_code: statusCode
        }
    } : undefined;
    const transactionEvent = {
        contexts: {
            trace: traceContext,
            otel: {
                resource: span.resource.attributes
            },
            ...responseContext
        },
        spans: [],
        start_timestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanTimeInputToSeconds"])(span.startTime),
        timestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanTimeInputToSeconds"])(span.endTime),
        transaction: description,
        type: 'transaction',
        sdkProcessingMetadata: {
            capturedSpanScope: capturedSpanScopes.scope,
            capturedSpanIsolationScope: capturedSpanScopes.isolationScope,
            sampleRate,
            dynamicSamplingContext: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(span)
        },
        ...source && {
            transaction_info: {
                source
            }
        }
    };
    return transactionEvent;
}
function createAndFinishSpanForOtelSpan(node, spans, sentSpans) {
    const span = node.span;
    if (span) {
        sentSpans.add(span);
    }
    const shouldDrop = !span;
    // If this span should be dropped, we still want to create spans for the children of this
    if (shouldDrop) {
        node.children.forEach((child)=>{
            createAndFinishSpanForOtelSpan(child, spans, sentSpans);
        });
        return;
    }
    const span_id = span.spanContext().spanId;
    const trace_id = span.spanContext().traceId;
    const parentSpanId = getParentSpanId(span);
    const { attributes, startTime, endTime, links } = span;
    const { op, description, data, origin = 'manual' } = getSpanData(span);
    const allData = {
        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]]: origin,
        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]]: op,
        ...removeSentryAttributes(attributes),
        ...data
    };
    const status = mapStatus(span);
    const spanJSON = {
        span_id,
        trace_id,
        data: allData,
        description,
        parent_span_id: parentSpanId,
        start_timestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanTimeInputToSeconds"])(startTime),
        // This is [0,0] by default in OTEL, in which case we want to interpret this as no end time
        timestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanTimeInputToSeconds"])(endTime) || undefined,
        status: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getStatusMessage"])(status),
        op,
        origin,
        measurements: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$measurement$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timedEventsToMeasurements"])(span.events),
        links: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["convertSpanLinksForEnvelope"])(links)
    };
    spans.push(spanJSON);
    node.children.forEach((child)=>{
        createAndFinishSpanForOtelSpan(child, spans, sentSpans);
    });
}
function getSpanData(span) {
    const { op: definedOp, source: definedSource, origin } = parseSpan(span);
    const { op: inferredOp, description, source: inferredSource, data: inferredData } = parseSpanDescription(span);
    const op = definedOp || inferredOp;
    const source = definedSource || inferredSource;
    const data = {
        ...inferredData,
        ...getData(span)
    };
    return {
        op,
        description,
        source,
        origin,
        data
    };
}
/**
 * Remove custom `sentry.` attributes we do not need to send.
 * These are more carrier attributes we use inside of the SDK, we do not need to send them to the API.
 */ function removeSentryAttributes(data) {
    const cleanedData = {
        ...data
    };
    /* eslint-disable @typescript-eslint/no-dynamic-delete */ delete cleanedData[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE"]];
    delete cleanedData[SEMANTIC_ATTRIBUTE_SENTRY_PARENT_IS_REMOTE];
    delete cleanedData[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME"]];
    /* eslint-enable @typescript-eslint/no-dynamic-delete */ return cleanedData;
}
function getData(span) {
    const attributes = span.attributes;
    const data = {};
    if (span.kind !== __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].INTERNAL) {
        data['otel.kind'] = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"][span.kind];
    }
    // eslint-disable-next-line deprecation/deprecation
    const maybeHttpStatusCodeAttribute = attributes[SEMATTRS_HTTP_STATUS_CODE];
    if (maybeHttpStatusCodeAttribute) {
        data[ATTR_HTTP_RESPONSE_STATUS_CODE] = maybeHttpStatusCodeAttribute;
    }
    const requestData = getRequestSpanData(span);
    if (requestData.url) {
        data.url = requestData.url;
    }
    if (requestData['http.query']) {
        data['http.query'] = requestData['http.query'].slice(1);
    }
    if (requestData['http.fragment']) {
        data['http.fragment'] = requestData['http.fragment'].slice(1);
    }
    return data;
}
function onSpanStart(span, parentContext) {
    // This is a reliable way to get the parent span - because this is exactly how the parent is identified in the OTEL SDK
    const parentSpan = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(parentContext);
    let scopes = getScopesFromContext(parentContext);
    // We need access to the parent span in order to be able to move up the span tree for breadcrumbs
    if (parentSpan && !parentSpan.spanContext().isRemote) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addChildSpanToSpan"])(parentSpan, span);
    }
    // We need this in the span exporter
    if (parentSpan?.spanContext().isRemote) {
        span.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_PARENT_IS_REMOTE, true);
    }
    // The root context does not have scopes stored, so we check for this specifically
    // As fallback we attach the global scopes
    if (parentContext === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["ROOT_CONTEXT"]) {
        scopes = {
            scope: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$defaultScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDefaultCurrentScope"])(),
            isolationScope: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$defaultScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDefaultIsolationScope"])()
        };
    }
    // We need the scope at time of span creation in order to apply it to the event when the span is finished
    if (scopes) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["setCapturedScopesOnSpan"])(span, scopes.scope, scopes.isolationScope);
    }
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$logSpans$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["logSpanStart"])(span);
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    client?.emit('spanStart', span);
}
function onSpanEnd(span) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$logSpans$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["logSpanEnd"])(span);
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    client?.emit('spanEnd', span);
}
/**
 * Converts OpenTelemetry Spans to Sentry Spans and sends them to Sentry via
 * the Sentry SDK.
 */ class SentrySpanProcessor {
    constructor(options){
        setIsSetup('SentrySpanProcessor');
        this._exporter = new SentrySpanExporter(options);
    }
    /**
   * @inheritDoc
   */ async forceFlush() {
        this._exporter.flush();
    }
    /**
   * @inheritDoc
   */ async shutdown() {
        this._exporter.clear();
    }
    /**
   * @inheritDoc
   */ onStart(span, parentContext) {
        onSpanStart(span, parentContext);
    }
    /** @inheritDoc */ onEnd(span) {
        onSpanEnd(span);
        this._exporter.export(span);
    }
}
/**
 * A custom OTEL sampler that uses Sentry sampling rates to make its decision
 */ class SentrySampler {
    constructor(client){
        this._client = client;
        setIsSetup('SentrySampler');
    }
    /** @inheritDoc */ shouldSample(context, traceId, spanName, spanKind, spanAttributes, _links) {
        const options = this._client.getOptions();
        const parentSpan = getValidSpan(context);
        const parentContext = parentSpan?.spanContext();
        if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])(options)) {
            return wrapSamplingDecision({
                decision: undefined,
                context,
                spanAttributes
            });
        }
        // `ATTR_HTTP_REQUEST_METHOD` is the new attribute, but we still support the old one, `SEMATTRS_HTTP_METHOD`, for now.
        // eslint-disable-next-line deprecation/deprecation
        const maybeSpanHttpMethod = spanAttributes[SEMATTRS_HTTP_METHOD] || spanAttributes[ATTR_HTTP_REQUEST_METHOD];
        // If we have a http.client span that has no local parent, we never want to sample it
        // but we want to leave downstream sampling decisions up to the server
        if (spanKind === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$span_kind$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SpanKind"].CLIENT && maybeSpanHttpMethod && (!parentSpan || parentContext?.isRemote)) {
            return wrapSamplingDecision({
                decision: undefined,
                context,
                spanAttributes
            });
        }
        const parentSampled = parentSpan ? getParentSampled(parentSpan, traceId, spanName) : undefined;
        const isRootSpan = !parentSpan || parentContext?.isRemote;
        // We only sample based on parameters (like tracesSampleRate or tracesSampler) for root spans (which is done in sampleSpan).
        // Non-root-spans simply inherit the sampling decision from their parent.
        if (!isRootSpan) {
            return wrapSamplingDecision({
                decision: parentSampled ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD,
                context,
                spanAttributes
            });
        }
        // We want to pass the inferred name & attributes to the sampler method
        const { description: inferredSpanName, data: inferredAttributes, op } = inferSpanData(spanName, spanAttributes, spanKind);
        const mergedAttributes = {
            ...inferredAttributes,
            ...spanAttributes
        };
        if (op) {
            mergedAttributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]] = op;
        }
        const mutableSamplingDecision = {
            decision: true
        };
        this._client.emit('beforeSampling', {
            spanAttributes: mergedAttributes,
            spanName: inferredSpanName,
            parentSampled: parentSampled,
            parentContext: parentContext
        }, mutableSamplingDecision);
        if (!mutableSamplingDecision.decision) {
            return wrapSamplingDecision({
                decision: undefined,
                context,
                spanAttributes
            });
        }
        const { isolationScope } = getScopesFromContext(context) ?? {};
        const dscString = parentContext?.traceState ? parentContext.traceState.get(SENTRY_TRACE_STATE_DSC) : undefined;
        const dsc = dscString ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["baggageHeaderToDynamicSamplingContext"])(dscString) : undefined;
        const sampleRand = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseSampleRate"])(dsc?.sample_rand) ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__$3c$export__safeMathRandom__as__$5f$INTERNAL_safeMathRandom$3e$__["_INTERNAL_safeMathRandom"])();
        const [sampled, sampleRate, localSampleRateWasApplied] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sampling$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["sampleSpan"])(options, {
            name: inferredSpanName,
            attributes: mergedAttributes,
            normalizedRequest: isolationScope?.getScopeData().sdkProcessingMetadata.normalizedRequest,
            parentSampled,
            parentSampleRate: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseSampleRate"])(dsc?.sample_rate)
        }, sampleRand);
        const method = `${maybeSpanHttpMethod}`.toUpperCase();
        if (method === 'OPTIONS' || method === 'HEAD') {
            DEBUG_BUILD$1 && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`[Tracing] Not sampling span because HTTP method is '${method}' for ${spanName}`);
            return wrapSamplingDecision({
                decision: SamplingDecision.NOT_RECORD,
                context,
                spanAttributes,
                sampleRand,
                downstreamTraceSampleRate: 0
            });
        }
        if (!sampled && // We check for `parentSampled === undefined` because we only want to record client reports for spans that are trace roots (ie. when there was incoming trace)
        parentSampled === undefined) {
            DEBUG_BUILD$1 && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('[Tracing] Discarding root span because its trace was not chosen to be sampled.');
            this._client.recordDroppedEvent('sample_rate', 'transaction');
        }
        return {
            ...wrapSamplingDecision({
                decision: sampled ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD,
                context,
                spanAttributes,
                sampleRand,
                downstreamTraceSampleRate: localSampleRateWasApplied ? sampleRate : undefined
            }),
            attributes: {
                // We set the sample rate on the span when a local sample rate was applied to better understand how traces were sampled in Sentry
                [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE"]]: localSampleRateWasApplied ? sampleRate : undefined
            }
        };
    }
    /** Returns the sampler name or short description with the configuration. */ toString() {
        return 'SentrySampler';
    }
}
function getParentSampled(parentSpan, traceId, spanName) {
    const parentContext = parentSpan.spanContext();
    // Only inherit sample rate if `traceId` is the same
    // Note for testing: `isSpanContextValid()` checks the format of the traceId/spanId, so we need to pass valid ones
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$spancontext$2d$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isSpanContextValid"])(parentContext) && parentContext.traceId === traceId) {
        if (parentContext.isRemote) {
            const parentSampled = getSamplingDecision(parentSpan.spanContext());
            DEBUG_BUILD$1 && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`[Tracing] Inheriting remote parent's sampled decision for ${spanName}: ${parentSampled}`);
            return parentSampled;
        }
        const parentSampled = getSamplingDecision(parentContext);
        DEBUG_BUILD$1 && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`[Tracing] Inheriting parent's sampled decision for ${spanName}: ${parentSampled}`);
        return parentSampled;
    }
    return undefined;
}
/**
 * Wrap a sampling decision with data that Sentry needs to work properly with it.
 * If you pass `decision: undefined`, it will be treated as `NOT_RECORDING`, but in contrast to passing `NOT_RECORDING`
 * it will not propagate this decision to downstream Sentry SDKs.
 */ function wrapSamplingDecision({ decision, context, spanAttributes, sampleRand, downstreamTraceSampleRate }) {
    let traceState = getBaseTraceState(context, spanAttributes);
    // We will override the propagated sample rate downstream when
    // - the tracesSampleRate is applied
    // - the tracesSampler is invoked
    // Since unsampled OTEL spans (NonRecordingSpans) cannot hold attributes we need to store this on the (trace)context.
    if (downstreamTraceSampleRate !== undefined) {
        traceState = traceState.set(SENTRY_TRACE_STATE_SAMPLE_RATE, `${downstreamTraceSampleRate}`);
    }
    if (sampleRand !== undefined) {
        traceState = traceState.set(SENTRY_TRACE_STATE_SAMPLE_RAND, `${sampleRand}`);
    }
    // If the decision is undefined, we treat it as NOT_RECORDING, but we don't propagate this decision to downstream SDKs
    // Which is done by not setting `SENTRY_TRACE_STATE_SAMPLED_NOT_RECORDING` traceState
    if (decision == undefined) {
        return {
            decision: SamplingDecision.NOT_RECORD,
            traceState
        };
    }
    if (decision === SamplingDecision.NOT_RECORD) {
        return {
            decision,
            traceState: traceState.set(SENTRY_TRACE_STATE_SAMPLED_NOT_RECORDING, '1')
        };
    }
    return {
        decision,
        traceState
    };
}
function getBaseTraceState(context, spanAttributes) {
    const parentSpan = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(context);
    const parentContext = parentSpan?.spanContext();
    let traceState = parentContext?.traceState || new TraceState();
    // We always keep the URL on the trace state, so we can access it in the propagator
    // `ATTR_URL_FULL` is the new attribute, but we still support the old one, `ATTR_HTTP_URL`, for now.
    // eslint-disable-next-line deprecation/deprecation
    const url = spanAttributes[SEMATTRS_HTTP_URL] || spanAttributes[ATTR_URL_FULL];
    if (url && typeof url === 'string') {
        traceState = traceState.set(SENTRY_TRACE_STATE_URL, url);
    }
    return traceState;
}
/**
 * If the active span is invalid, we want to ignore it as parent.
 * This aligns with how otel tracers and default samplers handle these cases.
 */ function getValidSpan(context) {
    const span = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].getSpan(context);
    return span && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2f$spancontext$2d$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isSpanContextValid"])(span.spanContext()) ? span : undefined;
}
/**
 * This serves as a build time flag that will be true by default, but false in non-debug builds or if users replace `__SENTRY_DEBUG__` in their generated code.
 *
 * ATTENTION: This constant must never cross package boundaries (i.e. be exported) to guarantee that it can be used for tree shaking.
 */ const DEBUG_BUILD = typeof __SENTRY_DEBUG__ === 'undefined' || __SENTRY_DEBUG__;
const INTEGRATION_NAME$1 = 'WinterCGFetch';
const HAS_CLIENT_MAP = new WeakMap();
const _winterCGFetch = (options = {})=>{
    const breadcrumbs = options.breadcrumbs === undefined ? true : options.breadcrumbs;
    const shouldCreateSpanForRequest = options.shouldCreateSpanForRequest;
    const _createSpanUrlMap = new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$lru$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["LRUMap"](100);
    const _headersUrlMap = new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$lru$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["LRUMap"](100);
    const spans = {};
    /** Decides whether to attach trace data to the outgoing fetch request */ function _shouldAttachTraceData(url) {
        const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
        if (!client) {
            return false;
        }
        const clientOptions = client.getOptions();
        if (clientOptions.tracePropagationTargets === undefined) {
            return true;
        }
        const cachedDecision = _headersUrlMap.get(url);
        if (cachedDecision !== undefined) {
            return cachedDecision;
        }
        const decision = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stringMatchesSomePattern"])(url, clientOptions.tracePropagationTargets);
        _headersUrlMap.set(url, decision);
        return decision;
    }
    /** Helper that wraps shouldCreateSpanForRequest option */ function _shouldCreateSpan(url) {
        if (shouldCreateSpanForRequest === undefined) {
            return true;
        }
        const cachedDecision = _createSpanUrlMap.get(url);
        if (cachedDecision !== undefined) {
            return cachedDecision;
        }
        const decision = shouldCreateSpanForRequest(url);
        _createSpanUrlMap.set(url, decision);
        return decision;
    }
    return {
        name: INTEGRATION_NAME$1,
        setupOnce () {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$fetch$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addFetchInstrumentationHandler"])((handlerData)=>{
                const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
                if (!client || !HAS_CLIENT_MAP.get(client)) {
                    return;
                }
                if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$isSentryRequestUrl$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isSentryRequestUrl"])(handlerData.fetchData.url, client)) {
                    return;
                }
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$fetch$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["instrumentFetchRequest"])(handlerData, _shouldCreateSpan, _shouldAttachTraceData, spans, {
                    spanOrigin: 'auto.http.wintercg_fetch'
                });
                if (breadcrumbs) {
                    createBreadcrumb(handlerData);
                }
            });
        },
        setup (client) {
            HAS_CLIENT_MAP.set(client, true);
        }
    };
};
/**
 * Creates spans and attaches tracing headers to fetch requests on WinterCG runtimes.
 */ const winterCGFetchIntegration = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defineIntegration"])(_winterCGFetch);
function createBreadcrumb(handlerData) {
    const { startTimestamp, endTimestamp } = handlerData;
    // We only capture complete fetch requests
    if (!endTimestamp) {
        return;
    }
    const breadcrumbData = {
        method: handlerData.fetchData.method,
        url: handlerData.fetchData.url
    };
    if (handlerData.error) {
        const hint = {
            data: handlerData.error,
            input: handlerData.args,
            startTimestamp,
            endTimestamp
        };
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$breadcrumbs$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addBreadcrumb"])({
            category: 'fetch',
            data: breadcrumbData,
            level: 'error',
            type: 'http'
        }, hint);
    } else {
        const response = handlerData.response;
        breadcrumbData.request_body_size = handlerData.fetchData.request_body_size;
        breadcrumbData.response_body_size = handlerData.fetchData.response_body_size;
        breadcrumbData.status_code = response?.status;
        const hint = {
            input: handlerData.args,
            response,
            startTimestamp,
            endTimestamp
        };
        const level = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$breadcrumb$2d$log$2d$level$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getBreadcrumbLogLevelFromHttpStatusCode"])(breadcrumbData.status_code);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$breadcrumbs$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addBreadcrumb"])({
            category: 'fetch',
            data: breadcrumbData,
            type: 'http',
            level
        }, hint);
    }
}
const DEFAULT_TRANSPORT_BUFFER_SIZE = 30;
/**
 * This is a modified promise buffer that collects tasks until drain is called.
 * We need this in the edge runtime because edge function invocations may not share I/O objects, like fetch requests
 * and responses, and the normal PromiseBuffer inherently buffers stuff inbetween incoming requests.
 *
 * A limitation we need to be aware of is that DEFAULT_TRANSPORT_BUFFER_SIZE is the maximum amount of payloads the
 * SDK can send for a given edge function invocation.
 */ class IsolatedPromiseBuffer {
    // We just have this field because the promise buffer interface requires it.
    // If we ever remove it from the interface we should also remove it here.
    constructor(_bufferSize = DEFAULT_TRANSPORT_BUFFER_SIZE){
        this.$ = [];
        this._taskProducers = [];
        this._bufferSize = _bufferSize;
    }
    /**
   * @inheritdoc
   */ add(taskProducer) {
        if (this._taskProducers.length >= this._bufferSize) {
            return Promise.reject(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$promisebuffer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SENTRY_BUFFER_FULL_ERROR"]);
        }
        this._taskProducers.push(taskProducer);
        return Promise.resolve({});
    }
    /**
   * @inheritdoc
   */ drain(timeout) {
        const oldTaskProducers = [
            ...this._taskProducers
        ];
        this._taskProducers = [];
        return new Promise((resolve)=>{
            const timer = setTimeout(()=>{
                if (timeout && timeout > 0) {
                    resolve(false);
                }
            }, timeout);
            // This cannot reject
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            Promise.all(oldTaskProducers.map((taskProducer)=>taskProducer().then(null, ()=>{
                // catch all failed requests
                }))).then(()=>{
                // resolve to true if all fetch requests settled
                clearTimeout(timer);
                resolve(true);
            });
        });
    }
}
/**
 * Creates a Transport that uses the Edge Runtimes native fetch API to send events to Sentry.
 */ function makeEdgeTransport(options) {
    function makeRequest(request) {
        const requestOptions = {
            body: request.body,
            method: 'POST',
            headers: options.headers,
            ...options.fetchOptions
        };
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["suppressTracing"])(()=>{
            return fetch(options.url, requestOptions).then((response)=>{
                return {
                    statusCode: response.status,
                    headers: {
                        'x-sentry-rate-limits': response.headers.get('X-Sentry-Rate-Limits'),
                        'retry-after': response.headers.get('Retry-After')
                    }
                };
            });
        });
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$transports$2f$base$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createTransport"])(options, makeRequest, new IsolatedPromiseBuffer(options.bufferSize));
}
/**
 * Returns an environment setting value determined by Vercel's `VERCEL_ENV` environment variable.
 *
 * @param isClient Flag to indicate whether to use the `NEXT_PUBLIC_` prefixed version of the environment variable.
 */ function getVercelEnv(isClient) {
    const vercelEnvVar = process.env.VERCEL_ENV;
    return vercelEnvVar ? `vercel-${vercelEnvVar}` : undefined;
}
const ADD_LISTENER_METHODS = [
    'addListener',
    'on',
    'once',
    'prependListener',
    'prependOnceListener'
];
class AbstractAsyncHooksContextManager {
    constructor(){
        AbstractAsyncHooksContextManager.prototype.__init.call(this);
        AbstractAsyncHooksContextManager.prototype.__init2.call(this);
    }
    /**
   * Binds a the certain context or the active one to the target function and then returns the target
   * @param context A context (span) to be bind to target
   * @param target a function or event emitter. When target or one of its callbacks is called,
   *  the provided context will be used as the active context for the duration of the call.
   */ bind(context, target) {
        if (typeof target === 'object' && target !== null && 'on' in target) {
            return this._bindEventEmitter(context, target);
        }
        if (typeof target === 'function') {
            return this._bindFunction(context, target);
        }
        return target;
    }
    _bindFunction(context, target) {
        const manager = this;
        const contextWrapper = function(...args) {
            return manager.with(context, ()=>target.apply(this, args));
        };
        Object.defineProperty(contextWrapper, 'length', {
            enumerable: false,
            configurable: true,
            writable: false,
            value: target.length
        });
        /**
     * It isn't possible to tell Typescript that contextWrapper is the same as T
     * so we forced to cast as any here.
     */ // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return contextWrapper;
    }
    /**
   * By default, EventEmitter call their callback with their context, which we do
   * not want, instead we will bind a specific context to all callbacks that
   * go through it.
   * @param context the context we want to bind
   * @param ee EventEmitter an instance of EventEmitter to patch
   */ _bindEventEmitter(context, ee) {
        const map = this._getPatchMap(ee);
        if (map !== undefined) return ee;
        this._createPatchMap(ee);
        // patch methods that add a listener to propagate context
        ADD_LISTENER_METHODS.forEach((methodName)=>{
            if (ee[methodName] === undefined) return;
            ee[methodName] = this._patchAddListener(ee, ee[methodName], context);
        });
        // patch methods that remove a listener
        if (typeof ee.removeListener === 'function') {
            ee.removeListener = this._patchRemoveListener(ee, ee.removeListener);
        }
        if (typeof ee.off === 'function') {
            ee.off = this._patchRemoveListener(ee, ee.off);
        }
        // patch method that remove all listeners
        if (typeof ee.removeAllListeners === 'function') {
            ee.removeAllListeners = this._patchRemoveAllListeners(ee, ee.removeAllListeners);
        }
        return ee;
    }
    /**
   * Patch methods that remove a given listener so that we match the "patched"
   * version of that listener (the one that propagate context).
   * @param ee EventEmitter instance
   * @param original reference to the patched method
   */ _patchRemoveListener(ee, original) {
        const contextManager = this;
        return function(event, listener) {
            const events = contextManager._getPatchMap(ee)?.[event];
            if (events === undefined) {
                return original.call(this, event, listener);
            }
            const patchedListener = events.get(listener);
            return original.call(this, event, patchedListener || listener);
        };
    }
    /**
   * Patch methods that remove all listeners so we remove our
   * internal references for a given event.
   * @param ee EventEmitter instance
   * @param original reference to the patched method
   */ _patchRemoveAllListeners(ee, original) {
        const contextManager = this;
        return function(event) {
            const map = contextManager._getPatchMap(ee);
            if (map !== undefined) {
                if (arguments.length === 0) {
                    contextManager._createPatchMap(ee);
                } else if (map[event] !== undefined) {
                    delete map[event];
                }
            }
            return original.apply(this, arguments);
        };
    }
    /**
   * Patch methods on an event emitter instance that can add listeners so we
   * can force them to propagate a given context.
   * @param ee EventEmitter instance
   * @param original reference to the patched method
   * @param [context] context to propagate when calling listeners
   */ _patchAddListener(ee, original, context) {
        const contextManager = this;
        return function(event, listener) {
            /**
       * This check is required to prevent double-wrapping the listener.
       * The implementation for ee.once wraps the listener and calls ee.on.
       * Without this check, we would wrap that wrapped listener.
       * This causes an issue because ee.removeListener depends on the onceWrapper
       * to properly remove the listener. If we wrap their wrapper, we break
       * that detection.
       */ if (contextManager._wrapped) {
                return original.call(this, event, listener);
            }
            let map = contextManager._getPatchMap(ee);
            if (map === undefined) {
                map = contextManager._createPatchMap(ee);
            }
            let listeners = map[event];
            if (listeners === undefined) {
                listeners = new WeakMap();
                map[event] = listeners;
            }
            const patchedListener = contextManager.bind(context, listener);
            // store a weak reference of the user listener to ours
            listeners.set(listener, patchedListener);
            /**
       * See comment at the start of this function for the explanation of this property.
       */ contextManager._wrapped = true;
            try {
                return original.call(this, event, patchedListener);
            } finally{
                contextManager._wrapped = false;
            }
        };
    }
    _createPatchMap(ee) {
        const map = Object.create(null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ee[this._kOtListeners] = map;
        return map;
    }
    _getPatchMap(ee) {
        return ee[this._kOtListeners];
    }
    __init() {
        this._kOtListeners = Symbol('OtListeners');
    }
    __init2() {
        this._wrapped = false;
    }
}
// Inline AsyncLocalStorage interface to avoid Node.js module dependency
// This prevents Node.js type leaks in edge runtime environments
class AsyncLocalStorageContextManager extends AbstractAsyncHooksContextManager {
    constructor(){
        super();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const MaybeGlobalAsyncLocalStorageConstructor = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].AsyncLocalStorage;
        if (!MaybeGlobalAsyncLocalStorageConstructor) {
            DEBUG_BUILD && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn("Tried to register AsyncLocalStorage async context strategy in a runtime that doesn't support AsyncLocalStorage.");
            this._asyncLocalStorage = {
                getStore () {
                    return undefined;
                },
                run (_store, callback, ...args) {
                    return callback.apply(this, args);
                },
                disable () {
                // noop
                }
            };
        } else {
            this._asyncLocalStorage = new MaybeGlobalAsyncLocalStorageConstructor();
        }
    }
    active() {
        return this._asyncLocalStorage.getStore() ?? __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2f$context$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["ROOT_CONTEXT"];
    }
    with(context, fn, thisArg, ...args) {
        const cb = thisArg == null ? fn : fn.bind(thisArg);
        return this._asyncLocalStorage.run(context, cb, ...args);
    }
    enable() {
        return this;
    }
    disable() {
        this._asyncLocalStorage.disable();
        return this;
    }
}
const nodeStackParser = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createStackParser"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$node$2d$stack$2d$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["nodeStackLineParser"])());
/** Get the default integrations for the browser SDK. */ function getDefaultIntegrations(options) {
    return [
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$dedupe$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dedupeIntegration"])(),
        // TODO(v11): Replace with `eventFiltersIntegration` once we remove the deprecated `inboundFiltersIntegration`
        // eslint-disable-next-line deprecation/deprecation
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$eventFilters$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["inboundFiltersIntegration"])(),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$functiontostring$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["functionToStringIntegration"])(),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$conversationId$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["conversationIdIntegration"])(),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$linkederrors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["linkedErrorsIntegration"])(),
        winterCGFetchIntegration(),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$console$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["consoleIntegration"])(),
        // TODO(v11): integration can be included - but integration should not add IP address etc
        ...options.sendDefaultPii ? [
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integrations$2f$requestdata$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["requestDataIntegration"])()
        ] : []
    ];
}
/** Inits the Sentry NextJS SDK on the Edge Runtime. */ function init(options = {}) {
    setOpenTelemetryContextAsyncContextStrategy();
    const scope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])();
    scope.update(options.initialScope);
    if (options.defaultIntegrations === undefined) {
        options.defaultIntegrations = getDefaultIntegrations(options);
    }
    if (options.dsn === undefined && process.env.SENTRY_DSN) {
        options.dsn = process.env.SENTRY_DSN;
    }
    if (options.tracesSampleRate === undefined && process.env.SENTRY_TRACES_SAMPLE_RATE) {
        const tracesSampleRate = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE);
        if (isFinite(tracesSampleRate)) {
            options.tracesSampleRate = tracesSampleRate;
        }
    }
    if (options.release === undefined) {
        const detectedRelease = getSentryRelease();
        if (detectedRelease !== undefined) {
            options.release = detectedRelease;
        }
    }
    options.environment = options.environment || process.env.SENTRY_ENVIRONMENT || getVercelEnv() || ("TURBOPACK compile-time value", "development");
    const client = new VercelEdgeClient({
        ...options,
        stackParser: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stackParserFromStackParserOptions"])(options.stackParser || nodeStackParser),
        integrations: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIntegrationsToSetup"])(options),
        transport: options.transport || makeEdgeTransport
    });
    // The client is on the current scope, from where it generally is inherited
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])().setClient(client);
    client.init();
    // If users opt-out of this, they _have_ to set up OpenTelemetry themselves
    // There is no way to use this SDK without OpenTelemetry!
    if (!options.skipOpenTelemetrySetup) {
        setupOtel(client);
        validateOpenTelemetrySetup();
    }
    enhanceDscWithOpenTelemetryRootSpanName(client);
    setupEventContextTrace(client);
    return client;
}
function validateOpenTelemetrySetup() {
    if (!DEBUG_BUILD) {
        return;
    }
    const setup = openTelemetrySetupCheck();
    const required = [
        'SentryContextManager',
        'SentryPropagator'
    ];
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])()) {
        required.push('SentrySpanProcessor');
    }
    for (const k of required){
        if (!setup.includes(k)) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error(`You have to set up the ${k}. Without this, the OpenTelemetry & Sentry integration will not work properly.`);
        }
    }
    if (!setup.includes('SentrySampler')) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('You have to set up the SentrySampler. Without this, the OpenTelemetry & Sentry integration may still work, but sample rates set for the Sentry SDK will not be respected. If you use a custom sampler, make sure to use `wrapSamplingDecision`.');
    }
}
// exported for tests
// eslint-disable-next-line jsdoc/require-jsdoc
function setupOtel(client) {
    if (client.getOptions().debug) {
        setupOpenTelemetryLogger();
    }
    // Create and configure NodeTracerProvider
    const provider = new BasicTracerProvider({
        sampler: new SentrySampler(client),
        resource: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$resources$2f$build$2f$esm$2f$ResourceImpl$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defaultResource"])().merge((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$resources$2f$build$2f$esm$2f$ResourceImpl$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["resourceFromAttributes"])({
            [ATTR_SERVICE_NAME]: 'edge',
            // eslint-disable-next-line deprecation/deprecation
            [SEMRESATTRS_SERVICE_NAMESPACE]: 'sentry',
            [ATTR_SERVICE_VERSION]: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_VERSION"]
        })),
        forceFlushTimeoutMillis: 500,
        spanProcessors: [
            new SentrySpanProcessor({
                timeout: client.getOptions().maxSpanWaitDuration
            })
        ]
    });
    const SentryContextManager = wrapContextManagerClass(AsyncLocalStorageContextManager);
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["trace"].setGlobalTracerProvider(provider);
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$propagation$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["propagation"].setGlobalPropagator(new SentryPropagator());
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$context$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["context"].setGlobalContextManager(new SentryContextManager());
    client.traceProvider = provider;
}
/**
 * Setup the OTEL logger to use our own debug logger.
 */ function setupOpenTelemetryLogger() {
    // Disable diag, to ensure this works even if called multiple times
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].disable();
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["diag"].setLogger({
        error: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error,
        warn: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn,
        info: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log,
        debug: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log,
        verbose: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log
    }, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2f$types$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DiagLogLevel"].DEBUG);
}
/**
 * Returns a release dynamically from environment variables.
 */ // eslint-disable-next-line complexity
function getSentryRelease(fallback) {
    // Always read first as Sentry takes this as precedence
    if (process.env.SENTRY_RELEASE) {
        return process.env.SENTRY_RELEASE;
    }
    // This supports the variable that sentry-webpack-plugin injects
    if (__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].SENTRY_RELEASE?.id) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].SENTRY_RELEASE.id;
    }
    // This list is in approximate alpha order, separated into 3 categories:
    // 1. Git providers
    // 2. CI providers with specific environment variables (has the provider name in the variable name)
    // 3. CI providers with generic environment variables (checked for last to prevent possible false positives)
    const possibleReleaseNameOfGitProvider = // GitHub Actions - https://help.github.com/en/actions/configuring-and-managing-workflows/using-environment-variables#default-environment-variables
    process.env['GITHUB_SHA'] || // GitLab CI - https://docs.gitlab.com/ee/ci/variables/predefined_variables.html
    process.env['CI_MERGE_REQUEST_SOURCE_BRANCH_SHA'] || process.env['CI_BUILD_REF'] || process.env['CI_COMMIT_SHA'] || // Bitbucket - https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/
    process.env['BITBUCKET_COMMIT'];
    const possibleReleaseNameOfCiProvidersWithSpecificEnvVar = // AppVeyor - https://www.appveyor.com/docs/environment-variables/
    process.env['APPVEYOR_PULL_REQUEST_HEAD_COMMIT'] || process.env['APPVEYOR_REPO_COMMIT'] || // AWS CodeBuild - https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-env-vars.html
    process.env['CODEBUILD_RESOLVED_SOURCE_VERSION'] || // AWS Amplify - https://docs.aws.amazon.com/amplify/latest/userguide/environment-variables.html
    process.env['AWS_COMMIT_ID'] || // Azure Pipelines - https://docs.microsoft.com/en-us/azure/devops/pipelines/build/variables?view=azure-devops&tabs=yaml
    process.env['BUILD_SOURCEVERSION'] || // Bitrise - https://devcenter.bitrise.io/builds/available-environment-variables/
    process.env['GIT_CLONE_COMMIT_HASH'] || // Buddy CI - https://buddy.works/docs/pipelines/environment-variables#default-environment-variables
    process.env['BUDDY_EXECUTION_REVISION'] || // Builtkite - https://buildkite.com/docs/pipelines/environment-variables
    process.env['BUILDKITE_COMMIT'] || // CircleCI - https://circleci.com/docs/variables/
    process.env['CIRCLE_SHA1'] || // Cirrus CI - https://cirrus-ci.org/guide/writing-tasks/#environment-variables
    process.env['CIRRUS_CHANGE_IN_REPO'] || // Codefresh - https://codefresh.io/docs/docs/codefresh-yaml/variables/
    process.env['CF_REVISION'] || // Codemagic - https://docs.codemagic.io/yaml-basic-configuration/environment-variables/
    process.env['CM_COMMIT'] || // Cloudflare Pages - https://developers.cloudflare.com/pages/platform/build-configuration/#environment-variables
    process.env['CF_PAGES_COMMIT_SHA'] || // Drone - https://docs.drone.io/pipeline/environment/reference/
    process.env['DRONE_COMMIT_SHA'] || // Flightcontrol - https://www.flightcontrol.dev/docs/guides/flightcontrol/environment-variables#built-in-environment-variables
    process.env['FC_GIT_COMMIT_SHA'] || // Heroku #1 https://devcenter.heroku.com/articles/heroku-ci
    process.env['HEROKU_TEST_RUN_COMMIT_VERSION'] || // Heroku #2 https://docs.sentry.io/product/integrations/deployment/heroku/#configure-releases
    process.env['HEROKU_SLUG_COMMIT'] || // Railway - https://docs.railway.app/reference/variables#git-variables
    process.env['RAILWAY_GIT_COMMIT_SHA'] || // Render - https://render.com/docs/environment-variables
    process.env['RENDER_GIT_COMMIT'] || // Semaphore CI - https://docs.semaphoreci.com/ci-cd-environment/environment-variables
    process.env['SEMAPHORE_GIT_SHA'] || // TravisCI - https://docs.travis-ci.com/user/environment-variables/#default-environment-variables
    process.env['TRAVIS_PULL_REQUEST_SHA'] || // Vercel - https://vercel.com/docs/v2/build-step#system-environment-variables
    process.env['VERCEL_GIT_COMMIT_SHA'] || process.env['VERCEL_GITHUB_COMMIT_SHA'] || process.env['VERCEL_GITLAB_COMMIT_SHA'] || process.env['VERCEL_BITBUCKET_COMMIT_SHA'] || // Zeit (now known as Vercel)
    process.env['ZEIT_GITHUB_COMMIT_SHA'] || process.env['ZEIT_GITLAB_COMMIT_SHA'] || process.env['ZEIT_BITBUCKET_COMMIT_SHA'];
    const possibleReleaseNameOfCiProvidersWithGenericEnvVar = // CloudBees CodeShip - https://docs.cloudbees.com/docs/cloudbees-codeship/latest/pro-builds-and-configuration/environment-variables
    process.env['CI_COMMIT_ID'] || // Coolify - https://coolify.io/docs/knowledge-base/environment-variables
    process.env['SOURCE_COMMIT'] || // Heroku #3 https://devcenter.heroku.com/changelog-items/630
    process.env['SOURCE_VERSION'] || // Jenkins - https://plugins.jenkins.io/git/#environment-variables
    process.env['GIT_COMMIT'] || // Netlify - https://docs.netlify.com/configure-builds/environment-variables/#build-metadata
    process.env['COMMIT_REF'] || // TeamCity - https://www.jetbrains.com/help/teamcity/predefined-build-parameters.html
    process.env['BUILD_VCS_NUMBER'] || // Woodpecker CI - https://woodpecker-ci.org/docs/usage/environment
    process.env['CI_COMMIT_SHA'];
    return possibleReleaseNameOfGitProvider || possibleReleaseNameOfCiProvidersWithSpecificEnvVar || possibleReleaseNameOfCiProvidersWithGenericEnvVar || fallback;
}
const INTEGRATION_NAME = 'VercelAI';
const _vercelAIIntegration = ()=>{
    return {
        name: INTEGRATION_NAME,
        setup (client) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addVercelAiProcessors"])(client);
        }
    };
};
/**
 * Adds Sentry tracing instrumentation for the [ai](https://www.npmjs.com/package/ai) library.
 * This integration is not enabled by default, you need to manually add it.
 *
 * For more information, see the [`ai` documentation](https://sdk.vercel.ai/docs/ai-sdk-core/telemetry).
 *
 *  You need to enable collecting spans for a specific call by setting
 * `experimental_telemetry.isEnabled` to `true` in the first argument of the function call.
 *
 * ```javascript
 * const result = await generateText({
 *   model: openai('gpt-4-turbo'),
 *   experimental_telemetry: { isEnabled: true },
 * });
 * ```
 *
 * If you want to collect inputs and outputs for a specific call, you must specifically opt-in to each
 * function call by setting `experimental_telemetry.recordInputs` and `experimental_telemetry.recordOutputs`
 * to `true`.
 *
 * ```javascript
 * const result = await generateText({
 *  model: openai('gpt-4-turbo'),
 *  experimental_telemetry: { isEnabled: true, recordInputs: true, recordOutputs: true },
 * });
 */ const vercelAIIntegration = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defineIntegration"])(_vercelAIIntegration);
;
 //# sourceMappingURL=index.js.map
}),
]);

//# sourceMappingURL=06187_%40sentry_vercel-edge_build_esm_index_32c66c7f.js.map