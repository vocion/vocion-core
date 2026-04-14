;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="802ab26a-62b9-542f-2820-759d970b2c97")}catch(e){}}();
module.exports = [
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/lib/incremental-cache/tags-manifest.external.js [external] (next/dist/server/lib/incremental-cache/tags-manifest.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/lib/incremental-cache/tags-manifest.external.js", () => require("next/dist/server/lib/incremental-cache/tags-manifest.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/node:async_hooks [external] (node:async_hooks, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:async_hooks", () => require("node:async_hooks"));

module.exports = mod;
}),
"[externals]/node:crypto [external] (node:crypto, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:crypto", () => require("node:crypto"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/action-async-storage.external.js [external] (next/dist/server/app-render/action-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/action-async-storage.external.js", () => require("next/dist/server/app-render/action-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[project]/metacto/metacto-internal/context-stack/packages/core/src/types/Subscription.ts [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "BILLING_INTERVAL",
    ()=>BILLING_INTERVAL,
    "SUBSCRIPTION_STATUS",
    ()=>SUBSCRIPTION_STATUS
]);
const BILLING_INTERVAL = {
    MONTH: 'month',
    YEAR: 'year'
};
const SUBSCRIPTION_STATUS = {
    ACTIVE: 'active',
    PENDING: 'pending'
};
}),
"[project]/metacto/metacto-internal/context-stack/packages/core/src/utils/AppConfig.ts [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AllLocales",
    ()=>AllLocales,
    "AppConfig",
    ()=>AppConfig,
    "ClerkLocalizations",
    ()=>ClerkLocalizations,
    "PLAN_ID",
    ()=>PLAN_ID,
    "PricingPlanList",
    ()=>PricingPlanList
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$clerk$2f$localizations$2f$dist$2f$index$2e$mjs__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@clerk/localizations/dist/index.mjs [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$packages$2f$core$2f$src$2f$types$2f$Subscription$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/packages/core/src/types/Subscription.ts [middleware] (ecmascript)");
;
;
/** Locale prefix strategy for next-intl routing. */ const localePrefix = 'as-needed';
const locales = [
    {
        id: 'en',
        name: 'English',
        stripeLocale: 'en'
    },
    {
        id: 'fr',
        name: 'Français',
        stripeLocale: 'fr'
    }
];
const AppConfig = {
    name: 'Compiles.ai',
    sidebarCookieName: 'sidebar:state',
    i18n: {
        locales,
        defaultLocale: 'en',
        localePrefix
    }
};
const supportedLocales = {
    en: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$clerk$2f$localizations$2f$dist$2f$index$2e$mjs__$5b$middleware$5d$__$28$ecmascript$29$__["enUS"],
    fr: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$clerk$2f$localizations$2f$dist$2f$index$2e$mjs__$5b$middleware$5d$__$28$ecmascript$29$__["frFR"]
};
const ClerkLocalizations = {
    defaultLocale: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$clerk$2f$localizations$2f$dist$2f$index$2e$mjs__$5b$middleware$5d$__$28$ecmascript$29$__["enUS"],
    supportedLocales
};
const AllLocales = AppConfig.i18n.locales.map((locale)=>locale.id);
const PLAN_ID = {
    FREE: 'free',
    PREMIUM: 'premium',
    ENTERPRISE: 'enterprise'
};
const PricingPlanList = {
    [PLAN_ID.FREE]: {
        id: PLAN_ID.FREE,
        price: 0,
        interval: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$packages$2f$core$2f$src$2f$types$2f$Subscription$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["BILLING_INTERVAL"].MONTH,
        testPriceId: '',
        devPriceId: '',
        prodPriceId: '',
        features: {
            teamMember: 2,
            website: 2,
            storage: 2,
            transfer: 2
        }
    },
    [PLAN_ID.PREMIUM]: {
        id: PLAN_ID.PREMIUM,
        price: 79,
        interval: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$packages$2f$core$2f$src$2f$types$2f$Subscription$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["BILLING_INTERVAL"].MONTH,
        testPriceId: 'price_premium_test',
        // FIXME: Update the price ID, you can create it after running `npm run stripe:setup-price`
        devPriceId: 'price_1PNksvKOp3DEwzQlGOXO7YBK',
        prodPriceId: '',
        features: {
            teamMember: 5,
            website: 5,
            storage: 5,
            transfer: 5
        }
    },
    [PLAN_ID.ENTERPRISE]: {
        id: PLAN_ID.ENTERPRISE,
        price: 199,
        interval: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$packages$2f$core$2f$src$2f$types$2f$Subscription$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["BILLING_INTERVAL"].MONTH,
        testPriceId: 'price_enterprise_test',
        // FIXME: Update the price ID, you can create it after running `npm run stripe:setup-price`
        devPriceId: 'price_1PNksvKOp3DEwzQli9IvXzgb',
        prodPriceId: 'price_123',
        features: {
            teamMember: 100,
            website: 100,
            storage: 100,
            transfer: 100
        }
    }
};
}),
"[project]/metacto/metacto-internal/context-stack/packages/core/src/libs/I18nRouting.ts [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "routing",
    ()=>routing
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$routing$2f$defineRouting$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__$3c$export__default__as__defineRouting$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/routing/defineRouting.js [middleware] (ecmascript) <export default as defineRouting>");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$packages$2f$core$2f$src$2f$utils$2f$AppConfig$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/packages/core/src/utils/AppConfig.ts [middleware] (ecmascript)");
;
;
const routing = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$routing$2f$defineRouting$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__$3c$export__default__as__defineRouting$3e$__["defineRouting"])({
    locales: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$packages$2f$core$2f$src$2f$utils$2f$AppConfig$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["AllLocales"],
    localePrefix: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$packages$2f$core$2f$src$2f$utils$2f$AppConfig$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["AppConfig"].i18n.localePrefix,
    defaultLocale: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$packages$2f$core$2f$src$2f$utils$2f$AppConfig$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["AppConfig"].i18n.defaultLocale
});
}),
"[project]/metacto/metacto-internal/context-stack/packages/core/src/proxy.ts [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "config",
    ()=>config,
    "default",
    ()=>proxy
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$clerk$2f$nextjs$2f$dist$2f$esm$2f$server$2f$clerkMiddleware$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@clerk/nextjs/dist/esm/server/clerkMiddleware.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$clerk$2f$nextjs$2f$dist$2f$esm$2f$server$2f$routeMatcher$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@clerk/nextjs/dist/esm/server/routeMatcher.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$middleware$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/middleware/middleware.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next/server.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$packages$2f$core$2f$src$2f$libs$2f$I18nRouting$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/packages/core/src/libs/I18nRouting.ts [middleware] (ecmascript)");
;
;
;
;
const handleI18nRouting = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$middleware$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["default"])(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$packages$2f$core$2f$src$2f$libs$2f$I18nRouting$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["routing"]);
const isProtectedRoute = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$clerk$2f$nextjs$2f$dist$2f$esm$2f$server$2f$routeMatcher$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["createRouteMatcher"])([
    '/dashboard(.*)',
    '/:locale/dashboard(.*)',
    '/onboarding(.*)',
    '/:locale/onboarding(.*)',
    '/rpc(.*)',
    '/:locale/rpc(.*)'
]);
const isAuthPage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$clerk$2f$nextjs$2f$dist$2f$esm$2f$server$2f$routeMatcher$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["createRouteMatcher"])([
    '/sign-in(.*)',
    '/:locale/sign-in(.*)',
    '/sign-up(.*)',
    '/:locale/sign-up(.*)'
]);
async function proxy(request, event) {
    // Clerk keyless mode doesn't work with i18n, this is why we need to run the middleware conditionally
    if (isAuthPage(request) || isProtectedRoute(request)) {
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$clerk$2f$nextjs$2f$dist$2f$esm$2f$server$2f$clerkMiddleware$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["clerkMiddleware"])(async (auth, req)=>{
            // Check if the current route is protected and requires authentication
            // If user is not authenticated, redirect them to the sign-in page with proper locale
            if (isProtectedRoute(req)) {
                const locale = req.nextUrl.pathname.match(/(\/.*)\/dashboard/)?.at(1) ?? '';
                const signInUrl = new URL(`${locale}/sign-in`, req.url);
                await auth.protect({
                    unauthenticatedUrl: signInUrl.toString()
                });
            }
            const authObj = await auth();
            // Redirect authenticated users without an organization to the organization selection page
            // This ensures users are properly associated with an organization before accessing the dashboard
            if (authObj.userId && !authObj.orgId && req.nextUrl.pathname.includes('/dashboard') && !req.nextUrl.pathname.endsWith('/organization-selection')) {
                const orgSelection = new URL('/onboarding/organization-selection', req.url);
                return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].redirect(orgSelection);
            }
            return handleI18nRouting(req);
        })(request, event);
    }
    return handleI18nRouting(request);
}
const config = {
    // Match all pathnames except for
    // - … if they start with `/_next`, `/_vercel` or `monitoring`
    // - … the ones containing a dot (e.g. `favicon.ico`)
    matcher: '/((?!_next|_vercel|monitoring|.*\\..*).*)'
};
}),
];

//# debugId=802ab26a-62b9-542f-2820-759d970b2c97
//# sourceMappingURL=%5Broot-of-the-server%5D__2d7d9c42._.js.map