;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="df6cec33-68f2-2d20-48ea-d4f21455da4f")}catch(e){}}();
module.exports = [
"[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/routing/config.js [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "receiveRoutingConfig",
    ()=>receiveRoutingConfig
]);
function receiveRoutingConfig(input) {
    return {
        ...input,
        localePrefix: receiveLocalePrefixConfig(input.localePrefix),
        localeCookie: receiveLocaleCookie(input.localeCookie),
        localeDetection: input.localeDetection ?? true,
        alternateLinks: input.alternateLinks ?? true
    };
}
function receiveLocaleCookie(localeCookie) {
    return localeCookie ?? true ? {
        name: 'NEXT_LOCALE',
        sameSite: 'lax',
        ...typeof localeCookie === 'object' && localeCookie
    } : false;
}
function receiveLocalePrefixConfig(localePrefix) {
    return typeof localePrefix === 'object' ? localePrefix : {
        mode: localePrefix || 'always'
    };
}
;
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/shared/constants.js [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "HEADER_LOCALE_NAME",
    ()=>HEADER_LOCALE_NAME
]);
// Used to read the locale from the middleware
const HEADER_LOCALE_NAME = 'X-NEXT-INTL-LOCALE';
;
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/shared/utils.js [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getLocaleAsPrefix",
    ()=>getLocaleAsPrefix,
    "getLocalePrefix",
    ()=>getLocalePrefix,
    "getLocalizedTemplate",
    ()=>getLocalizedTemplate,
    "getSortedPathnames",
    ()=>getSortedPathnames,
    "hasPathnamePrefixed",
    ()=>hasPathnamePrefixed,
    "isLocalizableHref",
    ()=>isLocalizableHref,
    "isPromise",
    ()=>isPromise,
    "matchesPathname",
    ()=>matchesPathname,
    "normalizeTrailingSlash",
    ()=>normalizeTrailingSlash,
    "prefixPathname",
    ()=>prefixPathname,
    "templateToRegex",
    ()=>templateToRegex,
    "unprefixPathname",
    ()=>unprefixPathname
]);
function isRelativeHref(href) {
    const pathname = typeof href === 'object' ? href.pathname : href;
    return pathname != null && !pathname.startsWith('/');
}
function isLocalHref(href) {
    if (typeof href === 'object') {
        return href.host == null && href.hostname == null;
    } else {
        const hasProtocol = /^[a-z]+:/i.test(href);
        return !hasProtocol;
    }
}
function isLocalizableHref(href) {
    return isLocalHref(href) && !isRelativeHref(href);
}
function unprefixPathname(pathname, prefix) {
    return pathname.replace(new RegExp(`^${prefix}`), '') || '/';
}
function prefixPathname(prefix, pathname) {
    let localizedHref = prefix;
    // Avoid trailing slashes
    if (/^\/(\?.*)?$/.test(pathname)) {
        pathname = pathname.slice(1);
    }
    localizedHref += pathname;
    return localizedHref;
}
function hasPathnamePrefixed(prefix, pathname) {
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
function hasTrailingSlash() {
    try {
        // Provided via `env` setting in `next.config.js` via the plugin
        return process.env._next_intl_trailing_slash === 'true';
    } catch  {
        return false;
    }
}
function getLocalizedTemplate(pathnameConfig, locale, internalTemplate) {
    return typeof pathnameConfig === 'string' ? pathnameConfig : pathnameConfig[locale] || internalTemplate;
}
function normalizeTrailingSlash(pathname) {
    const trailingSlash = hasTrailingSlash();
    const [path, ...hashParts] = pathname.split('#');
    const hash = hashParts.join('#');
    let normalizedPath = path;
    if (normalizedPath !== '/') {
        const pathnameEndsWithSlash = normalizedPath.endsWith('/');
        if (trailingSlash && !pathnameEndsWithSlash) {
            normalizedPath += '/';
        } else if (!trailingSlash && pathnameEndsWithSlash) {
            normalizedPath = normalizedPath.slice(0, -1);
        }
    }
    if (hash) {
        normalizedPath += '#' + hash;
    }
    return normalizedPath;
}
function matchesPathname(/** E.g. `/users/[userId]-[userName]` */ template, /** E.g. `/users/23-jane` */ pathname) {
    const normalizedTemplate = normalizeTrailingSlash(template);
    const normalizedPathname = normalizeTrailingSlash(pathname);
    const regex = templateToRegex(normalizedTemplate);
    return regex.test(normalizedPathname);
}
function getLocalePrefix(locale, localePrefix) {
    return localePrefix.mode !== 'never' && localePrefix.prefixes?.[locale] || // We return a prefix even if `mode: 'never'`. It's up to the consumer
    // to decide to use it or not.
    getLocaleAsPrefix(locale);
}
function getLocaleAsPrefix(locale) {
    return '/' + locale;
}
function templateToRegex(template) {
    const regexPattern = template// Replace optional catchall ('[[...slug]]')
    .replace(/\/\[\[(\.\.\.[^\]]+)\]\]/g, '(?:/(.*))?') // With leading slash
    .replace(/\[\[(\.\.\.[^\]]+)\]\]/g, '(?:/(.*))?') // Without leading slash
    // Replace catchall ('[...slug]')
    .replace(/\[(\.\.\.[^\]]+)\]/g, '(.+)')// Replace regular parameter ('[slug]')
    .replace(/\[([^\]]+)\]/g, '([^/]+)');
    return new RegExp(`^${regexPattern}$`);
}
function isOptionalCatchAllSegment(pathname) {
    return pathname.includes('[[...');
}
function isCatchAllSegment(pathname) {
    return pathname.includes('[...');
}
function isDynamicSegment(pathname) {
    return pathname.includes('[');
}
function comparePathnamePairs(a, b) {
    const pathA = a.split('/');
    const pathB = b.split('/');
    const maxLength = Math.max(pathA.length, pathB.length);
    for(let i = 0; i < maxLength; i++){
        const segmentA = pathA[i];
        const segmentB = pathB[i];
        // If one of the paths ends, prioritize the shorter path
        if (!segmentA && segmentB) return -1;
        if (segmentA && !segmentB) return 1;
        if (!segmentA && !segmentB) continue;
        // Prioritize static segments over dynamic segments
        if (!isDynamicSegment(segmentA) && isDynamicSegment(segmentB)) return -1;
        if (isDynamicSegment(segmentA) && !isDynamicSegment(segmentB)) return 1;
        // Prioritize non-catch-all segments over catch-all segments
        if (!isCatchAllSegment(segmentA) && isCatchAllSegment(segmentB)) return -1;
        if (isCatchAllSegment(segmentA) && !isCatchAllSegment(segmentB)) return 1;
        // Prioritize non-optional catch-all segments over optional catch-all segments
        if (!isOptionalCatchAllSegment(segmentA) && isOptionalCatchAllSegment(segmentB)) {
            return -1;
        }
        if (isOptionalCatchAllSegment(segmentA) && !isOptionalCatchAllSegment(segmentB)) {
            return 1;
        }
        if (segmentA === segmentB) continue;
    }
    // Both pathnames are completely static
    return 0;
}
function getSortedPathnames(pathnames) {
    return pathnames.sort(comparePathnamePairs);
}
function isPromise(value) {
    // https://github.com/amannn/next-intl/issues/1711
    return typeof value.then === 'function';
}
;
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/middleware/utils.js [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "applyBasePath",
    ()=>applyBasePath,
    "formatPathname",
    ()=>formatPathname,
    "formatPathnameTemplate",
    ()=>formatPathnameTemplate,
    "formatTemplatePathname",
    ()=>formatTemplatePathname,
    "getBestMatchingDomain",
    ()=>getBestMatchingDomain,
    "getHost",
    ()=>getHost,
    "getInternalTemplate",
    ()=>getInternalTemplate,
    "getLocaleAsPrefix",
    ()=>getLocaleAsPrefix,
    "getLocalePrefixes",
    ()=>getLocalePrefixes,
    "getNormalizedPathname",
    ()=>getNormalizedPathname,
    "getPathnameMatch",
    ()=>getPathnameMatch,
    "getRouteParams",
    ()=>getRouteParams,
    "isLocaleSupportedOnDomain",
    ()=>isLocaleSupportedOnDomain,
    "sanitizePathname",
    ()=>sanitizePathname
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/shared/utils.js [middleware] (ecmascript)");
;
function getInternalTemplate(pathnames, pathname, locale) {
    const sortedPathnames = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getSortedPathnames"])(Object.keys(pathnames));
    // Try to find a localized pathname that matches
    for (const internalPathname of sortedPathnames){
        const localizedPathnamesOrPathname = pathnames[internalPathname];
        if (typeof localizedPathnamesOrPathname === 'string') {
            const localizedPathname = localizedPathnamesOrPathname;
            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["matchesPathname"])(localizedPathname, pathname)) {
                return [
                    undefined,
                    internalPathname
                ];
            }
        } else {
            // Prefer the entry with the current locale in case multiple
            // localized pathnames match the current pathname
            const sortedEntries = Object.entries(localizedPathnamesOrPathname);
            const curLocaleIndex = sortedEntries.findIndex(([entryLocale])=>entryLocale === locale);
            if (curLocaleIndex > 0) {
                sortedEntries.unshift(sortedEntries.splice(curLocaleIndex, 1)[0]);
            }
            for (const [entryLocale] of sortedEntries){
                const localizedTemplate = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getLocalizedTemplate"])(pathnames[internalPathname], entryLocale, internalPathname);
                if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["matchesPathname"])(localizedTemplate, pathname)) {
                    return [
                        entryLocale,
                        internalPathname
                    ];
                }
            }
        }
    }
    // Try to find an internal pathname that matches (this can be the case
    // if all localized pathnames are different from the internal pathnames)
    for (const internalPathname of Object.keys(pathnames)){
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["matchesPathname"])(internalPathname, pathname)) {
            return [
                undefined,
                internalPathname
            ];
        }
    }
    // No match
    return [
        undefined,
        undefined
    ];
}
function formatTemplatePathname(sourcePathname, sourceTemplate, targetTemplate, prefix) {
    const params = getRouteParams(sourceTemplate, sourcePathname);
    let targetPathname = '';
    targetPathname += formatPathnameTemplate(targetTemplate, params);
    // A pathname with an optional catchall like `/categories/[[...slug]]`
    // should be normalized to `/categories` if the catchall is not present
    // and no trailing slash is configured
    targetPathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["normalizeTrailingSlash"])(targetPathname);
    return targetPathname;
}
/**
 * Removes potential prefixes from the pathname.
 */ function getNormalizedPathname(pathname, locales, localePrefix) {
    // Add trailing slash for consistent handling
    // both for the root as well as nested paths
    if (!pathname.endsWith('/')) {
        pathname += '/';
    }
    const localePrefixes = getLocalePrefixes(locales, localePrefix);
    const regex = new RegExp(`^(${localePrefixes.map(([, prefix])=>prefix.replaceAll('/', '\\/')).join('|')})/(.*)`, 'i');
    const match = pathname.match(regex);
    let result = match ? '/' + match[2] : pathname;
    if (result !== '/') {
        result = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["normalizeTrailingSlash"])(result);
    }
    return result;
}
function getLocalePrefixes(locales, localePrefix, sort = true) {
    const prefixes = locales.map((locale)=>[
            locale,
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getLocalePrefix"])(locale, localePrefix)
        ]);
    if (sort) {
        // More specific ones first
        prefixes.sort((a, b)=>b[1].length - a[1].length);
    }
    return prefixes;
}
function getPathnameMatch(pathname, locales, localePrefix, domain) {
    const localePrefixes = getLocalePrefixes(locales, localePrefix);
    // Sort to prioritize domain locales
    if (domain) {
        localePrefixes.sort(([localeA], [localeB])=>{
            if (localeA === domain.defaultLocale) return -1;
            if (localeB === domain.defaultLocale) return 1;
            const isLocaleAInDomain = domain.locales.includes(localeA);
            const isLocaleBInDomain = domain.locales.includes(localeB);
            if (isLocaleAInDomain && !isLocaleBInDomain) return -1;
            if (!isLocaleAInDomain && isLocaleBInDomain) return 1;
            return 0;
        });
    }
    for (const [locale, prefix] of localePrefixes){
        let exact, matches;
        if (pathname === prefix || pathname.startsWith(prefix + '/')) {
            exact = matches = true;
        } else {
            const normalizedPathname = pathname.toLowerCase();
            const normalizedPrefix = prefix.toLowerCase();
            if (normalizedPathname === normalizedPrefix || normalizedPathname.startsWith(normalizedPrefix + '/')) {
                exact = false;
                matches = true;
            }
        }
        if (matches) {
            return {
                locale,
                prefix,
                matchedPrefix: pathname.slice(0, prefix.length),
                exact
            };
        }
    }
}
function getRouteParams(template, pathname) {
    const normalizedPathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["normalizeTrailingSlash"])(pathname);
    const normalizedTemplate = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["normalizeTrailingSlash"])(template);
    const regex = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["templateToRegex"])(normalizedTemplate);
    const match = regex.exec(normalizedPathname);
    if (!match) return undefined;
    const params = {};
    const keys = normalizedTemplate.match(/\[([^\]]+)\]/g) ?? [];
    for(let i = 1; i < match.length; i++){
        const rawKey = keys[i - 1];
        if (!rawKey) continue;
        const key = rawKey.replace(/[[\]]/g, '');
        const value = match[i] ?? '';
        params[key] = value;
    }
    return params;
}
function formatPathnameTemplate(template, params) {
    if (!params) return template;
    // Simplify syntax for optional catchall ('[[...slug]]') so
    // we can replace the value with simple interpolation
    template = template.replace(/\[\[/g, '[').replace(/\]\]/g, ']');
    let result = template;
    Object.entries(params).forEach(([key, value])=>{
        result = result.replace(`[${key}]`, value);
    });
    return result;
}
function formatPathname(pathname, prefix, search) {
    let result = pathname;
    if (prefix) {
        result = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["prefixPathname"])(prefix, result);
    }
    if (search) {
        result += search;
    }
    return result;
}
function getHost(requestHeaders) {
    return requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? undefined;
}
function isLocaleSupportedOnDomain(locale, domain) {
    return domain.defaultLocale === locale || domain.locales.includes(locale);
}
function getBestMatchingDomain(curHostDomain, locale, domainsConfig) {
    let domainConfig;
    // Prio 1: Stay on current domain
    if (curHostDomain && isLocaleSupportedOnDomain(locale, curHostDomain)) {
        domainConfig = curHostDomain;
    }
    // Prio 2: Use alternative domain with matching default locale
    if (!domainConfig) {
        domainConfig = domainsConfig.find((cur)=>cur.defaultLocale === locale);
    }
    // Prio 3: Use alternative domain that supports the locale
    if (!domainConfig) {
        domainConfig = domainsConfig.find((cur)=>cur.locales.includes(locale));
    }
    return domainConfig;
}
function applyBasePath(pathname, basePath) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["normalizeTrailingSlash"])(basePath + pathname);
}
function getLocaleAsPrefix(locale) {
    return `/${locale}`;
}
function sanitizePathname(pathname) {
    // Sanitize malicious URIs, e.g.:
    // '/en/\\example.org → /en/%5C%5Cexample.org'
    // '/en////example.org → /en/example.org'
    return pathname.replace(/\\/g, '%5C').replace(/\/+/g, '/');
}
;
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/middleware/getAlternateLinksHeaderValue.js [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>getAlternateLinksHeaderValue
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/shared/utils.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/middleware/utils.js [middleware] (ecmascript)");
;
;
/**
 * See https://developers.google.com/search/docs/specialty/international/localized-versions
 */ function getAlternateLinksHeaderValue({ internalTemplateName, localizedPathnames, request, resolvedLocale, routing }) {
    const normalizedUrl = request.nextUrl.clone();
    const host = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getHost"])(request.headers);
    if (host) {
        normalizedUrl.port = '';
        normalizedUrl.host = host;
    }
    normalizedUrl.protocol = request.headers.get('x-forwarded-proto') ?? normalizedUrl.protocol;
    normalizedUrl.pathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getNormalizedPathname"])(normalizedUrl.pathname, routing.locales, routing.localePrefix);
    function getAlternateEntry(url, locale) {
        url.pathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["normalizeTrailingSlash"])(url.pathname);
        if (request.nextUrl.basePath) {
            url = new URL(url);
            url.pathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["applyBasePath"])(url.pathname, request.nextUrl.basePath);
        }
        return `<${url.toString()}>; rel="alternate"; hreflang="${locale}"`;
    }
    function getLocalizedPathname(pathname, locale) {
        if (localizedPathnames && typeof localizedPathnames === 'object') {
            const sourceTemplate = localizedPathnames[resolvedLocale];
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["formatTemplatePathname"])(pathname, sourceTemplate ?? internalTemplateName, localizedPathnames[locale] ?? internalTemplateName);
        } else {
            return pathname;
        }
    }
    const links = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getLocalePrefixes"])(routing.locales, routing.localePrefix, false).flatMap(([locale, prefix])=>{
        function prefixPathname(pathname) {
            if (pathname === '/') {
                return prefix;
            } else {
                return prefix + pathname;
            }
        }
        let url;
        if (routing.domains) {
            const domainConfigs = routing.domains.filter((cur)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["isLocaleSupportedOnDomain"])(locale, cur));
            return domainConfigs.map((domainConfig)=>{
                url = new URL(normalizedUrl);
                url.port = '';
                url.host = domainConfig.domain;
                // Important: Use `normalizedUrl` here, as `url` potentially uses
                // a `basePath` that automatically gets applied to the pathname
                url.pathname = getLocalizedPathname(normalizedUrl.pathname, locale);
                if (locale !== domainConfig.defaultLocale || routing.localePrefix.mode === 'always') {
                    url.pathname = prefixPathname(url.pathname);
                }
                return getAlternateEntry(url, locale);
            });
        } else {
            let pathname;
            if (localizedPathnames && typeof localizedPathnames === 'object') {
                pathname = getLocalizedPathname(normalizedUrl.pathname, locale);
            } else {
                pathname = normalizedUrl.pathname;
            }
            if (locale !== routing.defaultLocale || routing.localePrefix.mode === 'always') {
                pathname = prefixPathname(pathname);
            }
            url = new URL(pathname, normalizedUrl);
        }
        return getAlternateEntry(url, locale);
    });
    // Add x-default entry
    const shouldAddXDefault = // For domain-based routing there is no reasonable x-default
    !routing.domains || routing.domains.length === 0;
    if (shouldAddXDefault) {
        const localizedPathname = getLocalizedPathname(normalizedUrl.pathname, routing.defaultLocale);
        if (localizedPathname) {
            const url = new URL(localizedPathname, normalizedUrl);
            links.push(getAlternateEntry(url, 'x-default'));
        }
    }
    return links.join(', ');
}
;
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/middleware/resolveLocale.js [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>resolveLocale,
    "getAcceptLanguageLocale",
    ()=>getAcceptLanguageLocale
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$node_modules$2f40$formatjs$2f$intl$2d$localematcher$2f$index$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/node_modules/@formatjs/intl-localematcher/index.js [middleware] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$negotiator$2f$index$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/negotiator/index.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/middleware/utils.js [middleware] (ecmascript)");
;
;
;
function findDomainFromHost(requestHeaders, domains) {
    const host = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getHost"])(requestHeaders);
    if (host) {
        return domains.find((cur)=>cur.domain === host);
    }
    return undefined;
}
function orderLocales(locales) {
    // Workaround for https://github.com/formatjs/formatjs/issues/4469
    return locales.slice().sort((a, b)=>b.length - a.length);
}
function mapToProvidedLocale(locales, locale) {
    return locales.find((cur)=>cur.toLowerCase() === locale.toLowerCase());
}
function getAcceptLanguageLocale(requestHeaders, locales, defaultLocale) {
    let locale;
    const languages = new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$negotiator$2f$index$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["default"]({
        headers: {
            'accept-language': requestHeaders.get('accept-language') || undefined
        }
    }).languages();
    try {
        const orderedLocales = orderLocales(locales);
        locale = mapToProvidedLocale(locales, (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$node_modules$2f40$formatjs$2f$intl$2d$localematcher$2f$index$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__$3c$locals$3e$__["match"])(languages, orderedLocales, defaultLocale));
    } catch  {
    // Invalid language
    }
    return locale;
}
function getLocaleFromCookie(routing, requestCookies) {
    if (routing.localeCookie && requestCookies.has(routing.localeCookie.name)) {
        const value = requestCookies.get(routing.localeCookie.name)?.value;
        if (value && routing.locales.includes(value)) {
            return value;
        }
    }
}
function resolveLocaleFromPrefix(routing, requestHeaders, requestCookies, pathname) {
    let locale;
    // Prio 1: Use route prefix
    if (pathname) {
        locale = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getPathnameMatch"])(pathname, routing.locales, routing.localePrefix)?.locale;
    }
    // Prio 2: Use existing cookie
    if (!locale && routing.localeDetection) {
        locale = getLocaleFromCookie(routing, requestCookies);
    }
    // Prio 3: Use the `accept-language` header
    if (!locale && routing.localeDetection) {
        locale = getAcceptLanguageLocale(requestHeaders, routing.locales, routing.defaultLocale);
    }
    // Prio 4: Use default locale
    if (!locale) {
        locale = routing.defaultLocale;
    }
    return locale;
}
function resolveLocaleFromDomain(routing, requestHeaders, requestCookies, pathname) {
    const domains = routing.domains;
    const domain = findDomainFromHost(requestHeaders, domains);
    if (!domain) {
        return {
            locale: resolveLocaleFromPrefix(routing, requestHeaders, requestCookies, pathname)
        };
    }
    let locale;
    // Prio 1: Use route prefix
    if (pathname) {
        const prefixLocale = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getPathnameMatch"])(pathname, routing.locales, routing.localePrefix, domain)?.locale;
        if (prefixLocale) {
            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["isLocaleSupportedOnDomain"])(prefixLocale, domain)) {
                locale = prefixLocale;
            } else {
                // Causes a redirect to a domain that supports the locale
                return {
                    locale: prefixLocale,
                    domain
                };
            }
        }
    }
    // Prio 2: Use existing cookie
    if (!locale && routing.localeDetection) {
        const cookieLocale = getLocaleFromCookie(routing, requestCookies);
        if (cookieLocale) {
            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["isLocaleSupportedOnDomain"])(cookieLocale, domain)) {
                locale = cookieLocale;
            }
        }
    }
    // Prio 3: Use the `accept-language` header
    if (!locale && routing.localeDetection) {
        const headerLocale = getAcceptLanguageLocale(requestHeaders, domain.locales, domain.defaultLocale);
        if (headerLocale) {
            locale = headerLocale;
        }
    }
    // Prio 4: Use default locale
    if (!locale) {
        locale = domain.defaultLocale;
    }
    return {
        locale,
        domain
    };
}
function resolveLocale(routing, requestHeaders, requestCookies, pathname) {
    if (routing.domains) {
        return resolveLocaleFromDomain(routing, requestHeaders, requestCookies, pathname);
    } else {
        return {
            locale: resolveLocaleFromPrefix(routing, requestHeaders, requestCookies, pathname)
        };
    }
}
;
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/middleware/syncCookie.js [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>syncCookie
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$resolveLocale$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/middleware/resolveLocale.js [middleware] (ecmascript)");
;
function syncCookie(request, response, locale, routing, domain) {
    if (!routing.localeCookie) return;
    const { name, ...rest } = routing.localeCookie;
    const hasLocaleCookie = request.cookies.has(name);
    const hasOutdatedCookie = hasLocaleCookie && request.cookies.get(name)?.value !== locale;
    if (hasOutdatedCookie) {
        response.cookies.set(name, locale, {
            path: request.nextUrl.basePath || undefined,
            ...rest
        });
    } else if (!hasLocaleCookie) {
        const acceptLanguageLocale = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$resolveLocale$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getAcceptLanguageLocale"])(request.headers, domain?.locales || routing.locales, routing.defaultLocale);
        if (acceptLanguageLocale !== locale) {
            response.cookies.set(name, locale, {
                path: request.nextUrl.basePath || undefined,
                ...rest
            });
        }
    }
}
;
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/middleware/middleware.js [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>createMiddleware
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next/server.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$routing$2f$config$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/routing/config.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$constants$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/shared/constants.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/shared/utils.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$getAlternateLinksHeaderValue$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/middleware/getAlternateLinksHeaderValue.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$resolveLocale$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/middleware/resolveLocale.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$syncCookie$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/middleware/syncCookie.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/middleware/utils.js [middleware] (ecmascript)");
;
;
;
;
;
;
;
;
function createMiddleware(routing) {
    const resolvedRouting = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$routing$2f$config$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["receiveRoutingConfig"])(routing);
    return function middleware(request) {
        let unsafeExternalPathname;
        try {
            // Resolve potential foreign symbols (e.g. /ja/%E7%B4%84 → /ja/約))
            unsafeExternalPathname = decodeURI(request.nextUrl.pathname);
        } catch  {
            // In case an invalid pathname is encountered, forward
            // it to Next.js which in turn responds with a 400
            return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].next();
        }
        // Sanitize malicious URIs to prevent open redirect attacks due to
        // decodeURI doesn't escape encoded backslashes ('%5C' & '%5c')
        const externalPathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["sanitizePathname"])(unsafeExternalPathname);
        const { domain, locale } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$resolveLocale$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["default"])(resolvedRouting, request.headers, request.cookies, externalPathname);
        const hasMatchedDefaultLocale = domain ? domain.defaultLocale === locale : locale === resolvedRouting.defaultLocale;
        const domainsConfig = resolvedRouting.domains?.filter((curDomain)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["isLocaleSupportedOnDomain"])(locale, curDomain)) || [];
        const hasUnknownHost = resolvedRouting.domains != null && !domain;
        function next(url) {
            const urlObj = new URL(url, request.url);
            if (request.nextUrl.basePath) {
                urlObj.pathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["applyBasePath"])(urlObj.pathname, request.nextUrl.basePath);
            }
            const headers = new Headers(request.headers);
            headers.set(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$constants$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["HEADER_LOCALE_NAME"], locale);
            const isRewriteNecessary = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["normalizeTrailingSlash"])(request.nextUrl.pathname) !== (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["normalizeTrailingSlash"])(urlObj.pathname);
            if (isRewriteNecessary) {
                return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].rewrite(urlObj, {
                    request: {
                        headers
                    }
                });
            } else {
                return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].next({
                    request: {
                        headers
                    }
                });
            }
        }
        function redirect(url, redirectDomain) {
            const urlObj = new URL(url, request.url);
            urlObj.pathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["normalizeTrailingSlash"])(urlObj.pathname);
            if (domainsConfig.length > 0 && !redirectDomain && domain) {
                const bestMatchingDomain = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getBestMatchingDomain"])(domain, locale, domainsConfig);
                if (bestMatchingDomain) {
                    redirectDomain = bestMatchingDomain.domain;
                    if (bestMatchingDomain.defaultLocale === locale && resolvedRouting.localePrefix.mode === 'as-needed') {
                        urlObj.pathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getNormalizedPathname"])(urlObj.pathname, resolvedRouting.locales, resolvedRouting.localePrefix);
                    }
                }
            }
            if (redirectDomain) {
                urlObj.host = redirectDomain;
                if (request.headers.get('x-forwarded-host')) {
                    urlObj.protocol = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol;
                    const redirectDomainPort = redirectDomain.split(':')[1];
                    urlObj.port = redirectDomainPort ?? request.headers.get('x-forwarded-port') ?? '';
                }
            }
            if (request.nextUrl.basePath) {
                urlObj.pathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["applyBasePath"])(urlObj.pathname, request.nextUrl.basePath);
            }
            hasRedirected = true;
            return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].redirect(urlObj.toString());
        }
        const unprefixedExternalPathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getNormalizedPathname"])(externalPathname, resolvedRouting.locales, resolvedRouting.localePrefix);
        const pathnameMatch = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getPathnameMatch"])(externalPathname, resolvedRouting.locales, resolvedRouting.localePrefix, domain);
        const hasLocalePrefix = pathnameMatch != null;
        const isUnprefixedRouting = resolvedRouting.localePrefix.mode === 'never' || hasMatchedDefaultLocale && resolvedRouting.localePrefix.mode === 'as-needed';
        let response;
        let internalTemplateName;
        let hasRedirected;
        let unprefixedInternalPathname = unprefixedExternalPathname;
        const pathnames = resolvedRouting.pathnames;
        if (pathnames) {
            let resolvedTemplateLocale;
            [resolvedTemplateLocale, internalTemplateName] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getInternalTemplate"])(pathnames, unprefixedExternalPathname, locale);
            if (internalTemplateName) {
                const pathnameConfig = pathnames[internalTemplateName];
                const localeTemplate = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getLocalizedTemplate"])(pathnameConfig, locale, internalTemplateName);
                if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["matchesPathname"])(localeTemplate, unprefixedExternalPathname)) {
                    unprefixedInternalPathname = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["formatTemplatePathname"])(unprefixedExternalPathname, localeTemplate, internalTemplateName);
                } else {
                    let sourceTemplate;
                    if (resolvedTemplateLocale) {
                        // A localized pathname from another locale has matched
                        sourceTemplate = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getLocalizedTemplate"])(pathnameConfig, resolvedTemplateLocale, internalTemplateName);
                    } else {
                        // An internal pathname has matched that
                        // doesn't have a localized pathname
                        sourceTemplate = internalTemplateName;
                    }
                    const localePrefix = isUnprefixedRouting ? undefined : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getLocalePrefix"])(locale, resolvedRouting.localePrefix);
                    const template = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["formatTemplatePathname"])(unprefixedExternalPathname, sourceTemplate, localeTemplate);
                    response = redirect((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["formatPathname"])(template, localePrefix, request.nextUrl.search));
                }
            }
        }
        if (!response) {
            if (unprefixedInternalPathname === '/' && !hasLocalePrefix) {
                if (isUnprefixedRouting) {
                    response = next((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["formatPathname"])(unprefixedInternalPathname, (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getLocaleAsPrefix"])(locale), request.nextUrl.search));
                } else {
                    response = redirect((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["formatPathname"])(unprefixedExternalPathname, (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getLocalePrefix"])(locale, resolvedRouting.localePrefix), request.nextUrl.search));
                }
            } else {
                const internalHref = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["formatPathname"])(unprefixedInternalPathname, (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getLocaleAsPrefix"])(locale), request.nextUrl.search);
                if (hasLocalePrefix) {
                    const externalHref = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["formatPathname"])(unprefixedExternalPathname, pathnameMatch.prefix, request.nextUrl.search);
                    if (resolvedRouting.localePrefix.mode === 'never') {
                        response = redirect((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["formatPathname"])(unprefixedExternalPathname, undefined, request.nextUrl.search));
                    } else if (pathnameMatch.exact) {
                        if (hasMatchedDefaultLocale && isUnprefixedRouting) {
                            response = redirect((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["formatPathname"])(unprefixedExternalPathname, undefined, request.nextUrl.search));
                        } else {
                            if (resolvedRouting.domains) {
                                const pathDomain = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getBestMatchingDomain"])(domain, pathnameMatch.locale, domainsConfig);
                                if (domain?.domain !== pathDomain?.domain && !hasUnknownHost) {
                                    response = redirect(externalHref, pathDomain?.domain);
                                } else {
                                    response = next(internalHref);
                                }
                            } else {
                                response = next(internalHref);
                            }
                        }
                    } else {
                        response = redirect(externalHref);
                    }
                } else {
                    if (isUnprefixedRouting) {
                        response = next(internalHref);
                    } else {
                        response = redirect((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["formatPathname"])(unprefixedExternalPathname, (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$shared$2f$utils$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["getLocalePrefix"])(locale, resolvedRouting.localePrefix), request.nextUrl.search));
                    }
                }
            }
        }
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$syncCookie$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["default"])(request, response, locale, resolvedRouting, domain);
        if (!hasRedirected && resolvedRouting.localePrefix.mode !== 'never' && resolvedRouting.alternateLinks && resolvedRouting.locales.length > 1) {
            response.headers.set('Link', (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$middleware$2f$getAlternateLinksHeaderValue$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["default"])({
                routing: resolvedRouting,
                internalTemplateName,
                localizedPathnames: internalTemplateName != null && pathnames ? pathnames[internalTemplateName] : undefined,
                request,
                resolvedLocale: locale
            }));
        }
        return response;
    };
}
;
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/routing/defineRouting.js [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>defineRouting
]);
function defineRouting(config) {
    if (config.domains) {
        validateUniqueLocalesPerDomain(config.domains);
    }
    return config;
}
function validateUniqueLocalesPerDomain(domains) {
    const domainsByLocale = new Map();
    for (const { domain, locales } of domains){
        for (const locale of locales){
            const localeDomains = domainsByLocale.get(locale) || new Set();
            localeDomains.add(domain);
            domainsByLocale.set(locale, localeDomains);
        }
    }
    const duplicateLocaleMessages = Array.from(domainsByLocale.entries()).filter(([, localeDomains])=>localeDomains.size > 1).map(([locale, localeDomains])=>`- "${locale}" is used by: ${Array.from(localeDomains).join(', ')}`);
    if (duplicateLocaleMessages.length > 0) {
        console.warn('Locales are expected to be unique per domain, but found overlap:\n' + duplicateLocaleMessages.join('\n') + '\nPlease see https://next-intl.dev/docs/routing/configuration#domains');
    }
}
;
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/routing/defineRouting.js [middleware] (ecmascript) <export default as defineRouting>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "defineRouting",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$routing$2f$defineRouting$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["default"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$next$2d$intl$2f$dist$2f$esm$2f$development$2f$routing$2f$defineRouting$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/dist/esm/development/routing/defineRouting.js [middleware] (ecmascript)");
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/next-intl/node_modules/@formatjs/fast-memoize/index.js [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "memoize",
    ()=>memoize,
    "strategies",
    ()=>strategies
]);
function memoize(fn, options) {
    const cache = options && options.cache ? options.cache : cacheDefault;
    const serializer = options && options.serializer ? options.serializer : serializerDefault;
    const strategy = options && options.strategy ? options.strategy : strategyDefault;
    return strategy(fn, {
        cache,
        serializer
    });
}
//
// Strategy
//
function isPrimitive(value) {
    return value == null || typeof value === "number" || typeof value === "boolean";
}
function monadic(fn, cache, serializer, arg) {
    const cacheKey = isPrimitive(arg) ? arg : serializer(arg);
    let computedValue = cache.get(cacheKey);
    if (typeof computedValue === "undefined") {
        computedValue = fn.call(this, arg);
        cache.set(cacheKey, computedValue);
    }
    return computedValue;
}
function variadic(fn, cache, serializer) {
    const args = Array.prototype.slice.call(arguments, 3);
    const cacheKey = serializer(args);
    let computedValue = cache.get(cacheKey);
    if (typeof computedValue === "undefined") {
        computedValue = fn.apply(this, args);
        cache.set(cacheKey, computedValue);
    }
    return computedValue;
}
function assemble(fn, context, strategy, cache, serialize) {
    return strategy.bind(context, fn, cache, serialize);
}
function strategyDefault(fn, options) {
    const strategy = fn.length === 1 ? monadic : variadic;
    return assemble(fn, this, strategy, options.cache.create(), options.serializer);
}
function strategyVariadic(fn, options) {
    return assemble(fn, this, variadic, options.cache.create(), options.serializer);
}
function strategyMonadic(fn, options) {
    return assemble(fn, this, monadic, options.cache.create(), options.serializer);
}
//
// Serializer
//
const serializerDefault = function() {
    return JSON.stringify(arguments);
};
//
// Cache
//
class ObjectWithoutPrototypeCache {
    cache;
    constructor(){
        this.cache = Object.create(null);
    }
    get(key) {
        return this.cache[key];
    }
    set(key, value) {
        this.cache[key] = value;
    }
}
const cacheDefault = {
    create: function create() {
        return new ObjectWithoutPrototypeCache();
    }
};
const strategies = {
    variadic: strategyVariadic,
    monadic: strategyMonadic
};
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/negotiator/lib/charset.js [middleware] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

/**
 * negotiator
 * Copyright(c) 2012 Isaac Z. Schlueter
 * Copyright(c) 2014 Federico Romero
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */ /**
 * Module exports.
 * @public
 */ module.exports = preferredCharsets;
module.exports.preferredCharsets = preferredCharsets;
/**
 * Module variables.
 * @private
 */ var simpleCharsetRegExp = /^\s*([^\s;]+)\s*(?:;(.*))?$/;
/**
 * Parse the Accept-Charset header.
 * @private
 */ function parseAcceptCharset(accept) {
    var accepts = accept.split(',');
    for(var i = 0, j = 0; i < accepts.length; i++){
        var charset = parseCharset(accepts[i].trim(), i);
        if (charset) {
            accepts[j++] = charset;
        }
    }
    // trim accepts
    accepts.length = j;
    return accepts;
}
/**
 * Parse a charset from the Accept-Charset header.
 * @private
 */ function parseCharset(str, i) {
    var match = simpleCharsetRegExp.exec(str);
    if (!match) return null;
    var charset = match[1];
    var q = 1;
    if (match[2]) {
        var params = match[2].split(';');
        for(var j = 0; j < params.length; j++){
            var p = params[j].trim().split('=');
            if (p[0] === 'q') {
                q = parseFloat(p[1]);
                break;
            }
        }
    }
    return {
        charset: charset,
        q: q,
        i: i
    };
}
/**
 * Get the priority of a charset.
 * @private
 */ function getCharsetPriority(charset, accepted, index) {
    var priority = {
        o: -1,
        q: 0,
        s: 0
    };
    for(var i = 0; i < accepted.length; i++){
        var spec = specify(charset, accepted[i], index);
        if (spec && (priority.s - spec.s || priority.q - spec.q || priority.o - spec.o) < 0) {
            priority = spec;
        }
    }
    return priority;
}
/**
 * Get the specificity of the charset.
 * @private
 */ function specify(charset, spec, index) {
    var s = 0;
    if (spec.charset.toLowerCase() === charset.toLowerCase()) {
        s |= 1;
    } else if (spec.charset !== '*') {
        return null;
    }
    return {
        i: index,
        o: spec.i,
        q: spec.q,
        s: s
    };
}
/**
 * Get the preferred charsets from an Accept-Charset header.
 * @public
 */ function preferredCharsets(accept, provided) {
    // RFC 2616 sec 14.2: no header = *
    var accepts = parseAcceptCharset(accept === undefined ? '*' : accept || '');
    if (!provided) {
        // sorted list of all charsets
        return accepts.filter(isQuality).sort(compareSpecs).map(getFullCharset);
    }
    var priorities = provided.map(function getPriority(type, index) {
        return getCharsetPriority(type, accepts, index);
    });
    // sorted list of accepted charsets
    return priorities.filter(isQuality).sort(compareSpecs).map(function getCharset(priority) {
        return provided[priorities.indexOf(priority)];
    });
}
/**
 * Compare two specs.
 * @private
 */ function compareSpecs(a, b) {
    return b.q - a.q || b.s - a.s || a.o - b.o || a.i - b.i || 0;
}
/**
 * Get full charset string.
 * @private
 */ function getFullCharset(spec) {
    return spec.charset;
}
/**
 * Check if a spec has any quality.
 * @private
 */ function isQuality(spec) {
    return spec.q > 0;
}
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/negotiator/lib/encoding.js [middleware] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

/**
 * negotiator
 * Copyright(c) 2012 Isaac Z. Schlueter
 * Copyright(c) 2014 Federico Romero
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */ /**
 * Module exports.
 * @public
 */ module.exports = preferredEncodings;
module.exports.preferredEncodings = preferredEncodings;
/**
 * Module variables.
 * @private
 */ var simpleEncodingRegExp = /^\s*([^\s;]+)\s*(?:;(.*))?$/;
/**
 * Parse the Accept-Encoding header.
 * @private
 */ function parseAcceptEncoding(accept) {
    var accepts = accept.split(',');
    var hasIdentity = false;
    var minQuality = 1;
    for(var i = 0, j = 0; i < accepts.length; i++){
        var encoding = parseEncoding(accepts[i].trim(), i);
        if (encoding) {
            accepts[j++] = encoding;
            hasIdentity = hasIdentity || specify('identity', encoding);
            minQuality = Math.min(minQuality, encoding.q || 1);
        }
    }
    if (!hasIdentity) {
        /*
     * If identity doesn't explicitly appear in the accept-encoding header,
     * it's added to the list of acceptable encoding with the lowest q
     */ accepts[j++] = {
            encoding: 'identity',
            q: minQuality,
            i: i
        };
    }
    // trim accepts
    accepts.length = j;
    return accepts;
}
/**
 * Parse an encoding from the Accept-Encoding header.
 * @private
 */ function parseEncoding(str, i) {
    var match = simpleEncodingRegExp.exec(str);
    if (!match) return null;
    var encoding = match[1];
    var q = 1;
    if (match[2]) {
        var params = match[2].split(';');
        for(var j = 0; j < params.length; j++){
            var p = params[j].trim().split('=');
            if (p[0] === 'q') {
                q = parseFloat(p[1]);
                break;
            }
        }
    }
    return {
        encoding: encoding,
        q: q,
        i: i
    };
}
/**
 * Get the priority of an encoding.
 * @private
 */ function getEncodingPriority(encoding, accepted, index) {
    var priority = {
        encoding: encoding,
        o: -1,
        q: 0,
        s: 0
    };
    for(var i = 0; i < accepted.length; i++){
        var spec = specify(encoding, accepted[i], index);
        if (spec && (priority.s - spec.s || priority.q - spec.q || priority.o - spec.o) < 0) {
            priority = spec;
        }
    }
    return priority;
}
/**
 * Get the specificity of the encoding.
 * @private
 */ function specify(encoding, spec, index) {
    var s = 0;
    if (spec.encoding.toLowerCase() === encoding.toLowerCase()) {
        s |= 1;
    } else if (spec.encoding !== '*') {
        return null;
    }
    return {
        encoding: encoding,
        i: index,
        o: spec.i,
        q: spec.q,
        s: s
    };
}
;
/**
 * Get the preferred encodings from an Accept-Encoding header.
 * @public
 */ function preferredEncodings(accept, provided, preferred) {
    var accepts = parseAcceptEncoding(accept || '');
    var comparator = preferred ? function comparator(a, b) {
        if (a.q !== b.q) {
            return b.q - a.q // higher quality first
            ;
        }
        var aPreferred = preferred.indexOf(a.encoding);
        var bPreferred = preferred.indexOf(b.encoding);
        if (aPreferred === -1 && bPreferred === -1) {
            // consider the original specifity/order
            return b.s - a.s || a.o - b.o || a.i - b.i;
        }
        if (aPreferred !== -1 && bPreferred !== -1) {
            return aPreferred - bPreferred // consider the preferred order
            ;
        }
        return aPreferred === -1 ? 1 : -1 // preferred first
        ;
    } : compareSpecs;
    if (!provided) {
        // sorted list of all encodings
        return accepts.filter(isQuality).sort(comparator).map(getFullEncoding);
    }
    var priorities = provided.map(function getPriority(type, index) {
        return getEncodingPriority(type, accepts, index);
    });
    // sorted list of accepted encodings
    return priorities.filter(isQuality).sort(comparator).map(function getEncoding(priority) {
        return provided[priorities.indexOf(priority)];
    });
}
/**
 * Compare two specs.
 * @private
 */ function compareSpecs(a, b) {
    return b.q - a.q || b.s - a.s || a.o - b.o || a.i - b.i;
}
/**
 * Get full encoding string.
 * @private
 */ function getFullEncoding(spec) {
    return spec.encoding;
}
/**
 * Check if a spec has any quality.
 * @private
 */ function isQuality(spec) {
    return spec.q > 0;
}
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/negotiator/lib/language.js [middleware] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

/**
 * negotiator
 * Copyright(c) 2012 Isaac Z. Schlueter
 * Copyright(c) 2014 Federico Romero
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */ /**
 * Module exports.
 * @public
 */ module.exports = preferredLanguages;
module.exports.preferredLanguages = preferredLanguages;
/**
 * Module variables.
 * @private
 */ var simpleLanguageRegExp = /^\s*([^\s\-;]+)(?:-([^\s;]+))?\s*(?:;(.*))?$/;
/**
 * Parse the Accept-Language header.
 * @private
 */ function parseAcceptLanguage(accept) {
    var accepts = accept.split(',');
    for(var i = 0, j = 0; i < accepts.length; i++){
        var language = parseLanguage(accepts[i].trim(), i);
        if (language) {
            accepts[j++] = language;
        }
    }
    // trim accepts
    accepts.length = j;
    return accepts;
}
/**
 * Parse a language from the Accept-Language header.
 * @private
 */ function parseLanguage(str, i) {
    var match = simpleLanguageRegExp.exec(str);
    if (!match) return null;
    var prefix = match[1];
    var suffix = match[2];
    var full = prefix;
    if (suffix) full += "-" + suffix;
    var q = 1;
    if (match[3]) {
        var params = match[3].split(';');
        for(var j = 0; j < params.length; j++){
            var p = params[j].split('=');
            if (p[0] === 'q') q = parseFloat(p[1]);
        }
    }
    return {
        prefix: prefix,
        suffix: suffix,
        q: q,
        i: i,
        full: full
    };
}
/**
 * Get the priority of a language.
 * @private
 */ function getLanguagePriority(language, accepted, index) {
    var priority = {
        o: -1,
        q: 0,
        s: 0
    };
    for(var i = 0; i < accepted.length; i++){
        var spec = specify(language, accepted[i], index);
        if (spec && (priority.s - spec.s || priority.q - spec.q || priority.o - spec.o) < 0) {
            priority = spec;
        }
    }
    return priority;
}
/**
 * Get the specificity of the language.
 * @private
 */ function specify(language, spec, index) {
    var p = parseLanguage(language);
    if (!p) return null;
    var s = 0;
    if (spec.full.toLowerCase() === p.full.toLowerCase()) {
        s |= 4;
    } else if (spec.prefix.toLowerCase() === p.full.toLowerCase()) {
        s |= 2;
    } else if (spec.full.toLowerCase() === p.prefix.toLowerCase()) {
        s |= 1;
    } else if (spec.full !== '*') {
        return null;
    }
    return {
        i: index,
        o: spec.i,
        q: spec.q,
        s: s
    };
}
;
/**
 * Get the preferred languages from an Accept-Language header.
 * @public
 */ function preferredLanguages(accept, provided) {
    // RFC 2616 sec 14.4: no header = *
    var accepts = parseAcceptLanguage(accept === undefined ? '*' : accept || '');
    if (!provided) {
        // sorted list of all languages
        return accepts.filter(isQuality).sort(compareSpecs).map(getFullLanguage);
    }
    var priorities = provided.map(function getPriority(type, index) {
        return getLanguagePriority(type, accepts, index);
    });
    // sorted list of accepted languages
    return priorities.filter(isQuality).sort(compareSpecs).map(function getLanguage(priority) {
        return provided[priorities.indexOf(priority)];
    });
}
/**
 * Compare two specs.
 * @private
 */ function compareSpecs(a, b) {
    return b.q - a.q || b.s - a.s || a.o - b.o || a.i - b.i || 0;
}
/**
 * Get full language string.
 * @private
 */ function getFullLanguage(spec) {
    return spec.full;
}
/**
 * Check if a spec has any quality.
 * @private
 */ function isQuality(spec) {
    return spec.q > 0;
}
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/negotiator/lib/mediaType.js [middleware] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

/**
 * negotiator
 * Copyright(c) 2012 Isaac Z. Schlueter
 * Copyright(c) 2014 Federico Romero
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */ /**
 * Module exports.
 * @public
 */ module.exports = preferredMediaTypes;
module.exports.preferredMediaTypes = preferredMediaTypes;
/**
 * Module variables.
 * @private
 */ var simpleMediaTypeRegExp = /^\s*([^\s\/;]+)\/([^;\s]+)\s*(?:;(.*))?$/;
/**
 * Parse the Accept header.
 * @private
 */ function parseAccept(accept) {
    var accepts = splitMediaTypes(accept);
    for(var i = 0, j = 0; i < accepts.length; i++){
        var mediaType = parseMediaType(accepts[i].trim(), i);
        if (mediaType) {
            accepts[j++] = mediaType;
        }
    }
    // trim accepts
    accepts.length = j;
    return accepts;
}
/**
 * Parse a media type from the Accept header.
 * @private
 */ function parseMediaType(str, i) {
    var match = simpleMediaTypeRegExp.exec(str);
    if (!match) return null;
    var params = Object.create(null);
    var q = 1;
    var subtype = match[2];
    var type = match[1];
    if (match[3]) {
        var kvps = splitParameters(match[3]).map(splitKeyValuePair);
        for(var j = 0; j < kvps.length; j++){
            var pair = kvps[j];
            var key = pair[0].toLowerCase();
            var val = pair[1];
            // get the value, unwrapping quotes
            var value = val && val[0] === '"' && val[val.length - 1] === '"' ? val.slice(1, -1) : val;
            if (key === 'q') {
                q = parseFloat(value);
                break;
            }
            // store parameter
            params[key] = value;
        }
    }
    return {
        type: type,
        subtype: subtype,
        params: params,
        q: q,
        i: i
    };
}
/**
 * Get the priority of a media type.
 * @private
 */ function getMediaTypePriority(type, accepted, index) {
    var priority = {
        o: -1,
        q: 0,
        s: 0
    };
    for(var i = 0; i < accepted.length; i++){
        var spec = specify(type, accepted[i], index);
        if (spec && (priority.s - spec.s || priority.q - spec.q || priority.o - spec.o) < 0) {
            priority = spec;
        }
    }
    return priority;
}
/**
 * Get the specificity of the media type.
 * @private
 */ function specify(type, spec, index) {
    var p = parseMediaType(type);
    var s = 0;
    if (!p) {
        return null;
    }
    if (spec.type.toLowerCase() == p.type.toLowerCase()) {
        s |= 4;
    } else if (spec.type != '*') {
        return null;
    }
    if (spec.subtype.toLowerCase() == p.subtype.toLowerCase()) {
        s |= 2;
    } else if (spec.subtype != '*') {
        return null;
    }
    var keys = Object.keys(spec.params);
    if (keys.length > 0) {
        if (keys.every(function(k) {
            return spec.params[k] == '*' || (spec.params[k] || '').toLowerCase() == (p.params[k] || '').toLowerCase();
        })) {
            s |= 1;
        } else {
            return null;
        }
    }
    return {
        i: index,
        o: spec.i,
        q: spec.q,
        s: s
    };
}
/**
 * Get the preferred media types from an Accept header.
 * @public
 */ function preferredMediaTypes(accept, provided) {
    // RFC 2616 sec 14.2: no header = */*
    var accepts = parseAccept(accept === undefined ? '*/*' : accept || '');
    if (!provided) {
        // sorted list of all types
        return accepts.filter(isQuality).sort(compareSpecs).map(getFullType);
    }
    var priorities = provided.map(function getPriority(type, index) {
        return getMediaTypePriority(type, accepts, index);
    });
    // sorted list of accepted types
    return priorities.filter(isQuality).sort(compareSpecs).map(function getType(priority) {
        return provided[priorities.indexOf(priority)];
    });
}
/**
 * Compare two specs.
 * @private
 */ function compareSpecs(a, b) {
    return b.q - a.q || b.s - a.s || a.o - b.o || a.i - b.i || 0;
}
/**
 * Get full type string.
 * @private
 */ function getFullType(spec) {
    return spec.type + '/' + spec.subtype;
}
/**
 * Check if a spec has any quality.
 * @private
 */ function isQuality(spec) {
    return spec.q > 0;
}
/**
 * Count the number of quotes in a string.
 * @private
 */ function quoteCount(string) {
    var count = 0;
    var index = 0;
    while((index = string.indexOf('"', index)) !== -1){
        count++;
        index++;
    }
    return count;
}
/**
 * Split a key value pair.
 * @private
 */ function splitKeyValuePair(str) {
    var index = str.indexOf('=');
    var key;
    var val;
    if (index === -1) {
        key = str;
    } else {
        key = str.slice(0, index);
        val = str.slice(index + 1);
    }
    return [
        key,
        val
    ];
}
/**
 * Split an Accept header into media types.
 * @private
 */ function splitMediaTypes(accept) {
    var accepts = accept.split(',');
    for(var i = 1, j = 0; i < accepts.length; i++){
        if (quoteCount(accepts[j]) % 2 == 0) {
            accepts[++j] = accepts[i];
        } else {
            accepts[j] += ',' + accepts[i];
        }
    }
    // trim accepts
    accepts.length = j + 1;
    return accepts;
}
/**
 * Split a string of parameters.
 * @private
 */ function splitParameters(str) {
    var parameters = str.split(';');
    for(var i = 1, j = 0; i < parameters.length; i++){
        if (quoteCount(parameters[j]) % 2 == 0) {
            parameters[++j] = parameters[i];
        } else {
            parameters[j] += ';' + parameters[i];
        }
    }
    // trim parameters
    parameters.length = j + 1;
    for(var i = 0; i < parameters.length; i++){
        parameters[i] = parameters[i].trim();
    }
    return parameters;
}
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/negotiator/index.js [middleware] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

/*!
 * negotiator
 * Copyright(c) 2012 Federico Romero
 * Copyright(c) 2012-2014 Isaac Z. Schlueter
 * Copyright(c) 2015 Douglas Christopher Wilson
 * MIT Licensed
 */ var preferredCharsets = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/negotiator/lib/charset.js [middleware] (ecmascript)");
var preferredEncodings = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/negotiator/lib/encoding.js [middleware] (ecmascript)");
var preferredLanguages = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/negotiator/lib/language.js [middleware] (ecmascript)");
var preferredMediaTypes = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/negotiator/lib/mediaType.js [middleware] (ecmascript)");
/**
 * Module exports.
 * @public
 */ module.exports = Negotiator;
module.exports.Negotiator = Negotiator;
/**
 * Create a Negotiator instance from a request.
 * @param {object} request
 * @public
 */ function Negotiator(request) {
    if (!(this instanceof Negotiator)) {
        return new Negotiator(request);
    }
    this.request = request;
}
Negotiator.prototype.charset = function charset(available) {
    var set = this.charsets(available);
    return set && set[0];
};
Negotiator.prototype.charsets = function charsets(available) {
    return preferredCharsets(this.request.headers['accept-charset'], available);
};
Negotiator.prototype.encoding = function encoding(available, opts) {
    var set = this.encodings(available, opts);
    return set && set[0];
};
Negotiator.prototype.encodings = function encodings(available, options) {
    var opts = options || {};
    return preferredEncodings(this.request.headers['accept-encoding'], available, opts.preferred);
};
Negotiator.prototype.language = function language(available) {
    var set = this.languages(available);
    return set && set[0];
};
Negotiator.prototype.languages = function languages(available) {
    return preferredLanguages(this.request.headers['accept-language'], available);
};
Negotiator.prototype.mediaType = function mediaType(available) {
    var set = this.mediaTypes(available);
    return set && set[0];
};
Negotiator.prototype.mediaTypes = function mediaTypes(available) {
    return preferredMediaTypes(this.request.headers.accept, available);
};
// Backwards compatibility
Negotiator.prototype.preferredCharset = Negotiator.prototype.charset;
Negotiator.prototype.preferredCharsets = Negotiator.prototype.charsets;
Negotiator.prototype.preferredEncoding = Negotiator.prototype.encoding;
Negotiator.prototype.preferredEncodings = Negotiator.prototype.encodings;
Negotiator.prototype.preferredLanguage = Negotiator.prototype.language;
Negotiator.prototype.preferredLanguages = Negotiator.prototype.languages;
Negotiator.prototype.preferredMediaType = Negotiator.prototype.mediaType;
Negotiator.prototype.preferredMediaTypes = Negotiator.prototype.mediaTypes;
}),
];

//# debugId=df6cec33-68f2-2d20-48ea-d4f21455da4f
//# sourceMappingURL=06187_d947b412._.js.map