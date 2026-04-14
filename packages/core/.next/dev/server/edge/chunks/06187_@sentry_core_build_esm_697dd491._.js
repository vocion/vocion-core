(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push(["chunks/06187_@sentry_core_build_esm_697dd491._.js",
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/version.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SDK_VERSION",
    ()=>SDK_VERSION
]);
// This is a magic string replaced by rollup
const SDK_VERSION = "10.42.0";
;
 //# sourceMappingURL=version.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GLOBAL_OBJ",
    ()=>GLOBAL_OBJ
]);
/** Internal global with common properties and Sentry extensions  */ /** Get's the global object for the current JavaScript runtime */ const GLOBAL_OBJ = globalThis;
;
 //# sourceMappingURL=worldwide.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/carrier.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getGlobalSingleton",
    ()=>getGlobalSingleton,
    "getMainCarrier",
    ()=>getMainCarrier,
    "getSentryCarrier",
    ()=>getSentryCarrier
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/version.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
;
/**
 * An object that contains globally accessible properties and maintains a scope stack.
 * @hidden
 */ /**
 * Returns the global shim registry.
 *
 * FIXME: This function is problematic, because despite always returning a valid Carrier,
 * it has an optional `__SENTRY__` property, which then in turn requires us to always perform an unnecessary check
 * at the call-site. We always access the carrier through this function, so we can guarantee that `__SENTRY__` is there.
 **/ function getMainCarrier() {
    // This ensures a Sentry carrier exists
    getSentryCarrier(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"]);
    return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"];
}
/** Will either get the existing sentry carrier, or create a new one. */ function getSentryCarrier(carrier) {
    const __SENTRY__ = carrier.__SENTRY__ = carrier.__SENTRY__ || {};
    // For now: First SDK that sets the .version property wins
    __SENTRY__.version = __SENTRY__.version || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_VERSION"];
    // Intentionally populating and returning the version of "this" SDK instance
    // rather than what's set in .version so that "this" SDK always gets its carrier
    return __SENTRY__[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_VERSION"]] = __SENTRY__[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_VERSION"]] || {};
}
/**
 * Returns a global singleton contained in the global `__SENTRY__[]` object.
 *
 * If the singleton doesn't already exist in `__SENTRY__`, it will be created using the given factory
 * function and added to the `__SENTRY__` object.
 *
 * @param name name of the global singleton on __SENTRY__
 * @param creator creator Factory function to create the singleton if it doesn't already exist on `__SENTRY__`
 * @param obj (Optional) The global object on which to look for `__SENTRY__`, if not `GLOBAL_OBJ`'s return value
 * @returns the singleton
 */ function getGlobalSingleton(name, creator, obj = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"]) {
    const __SENTRY__ = obj.__SENTRY__ = obj.__SENTRY__ || {};
    const carrier = __SENTRY__[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_VERSION"]] = __SENTRY__[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_VERSION"]] || {};
    // Note: We do not want to set `carrier.version` here, as this may be called before any `init` is called, e.g. for the default scopes
    return carrier[name] || (carrier[name] = creator());
}
;
 //# sourceMappingURL=carrier.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEBUG_BUILD",
    ()=>DEBUG_BUILD
]);
/**
 * This serves as a build time flag that will be true by default, but false in non-debug builds or if users replace `__SENTRY_DEBUG__` in their generated code.
 *
 * ATTENTION: This constant must never cross package boundaries (i.e. be exported) to guarantee that it can be used for tree shaking.
 */ const DEBUG_BUILD = typeof __SENTRY_DEBUG__ === 'undefined' || __SENTRY_DEBUG__;
;
 //# sourceMappingURL=debug-build.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "isDOMError",
    ()=>isDOMError,
    "isDOMException",
    ()=>isDOMException,
    "isElement",
    ()=>isElement,
    "isError",
    ()=>isError,
    "isErrorEvent",
    ()=>isErrorEvent,
    "isEvent",
    ()=>isEvent,
    "isInstanceOf",
    ()=>isInstanceOf,
    "isParameterizedString",
    ()=>isParameterizedString,
    "isPlainObject",
    ()=>isPlainObject,
    "isPrimitive",
    ()=>isPrimitive,
    "isRegExp",
    ()=>isRegExp,
    "isRequest",
    ()=>isRequest,
    "isString",
    ()=>isString,
    "isSyntheticEvent",
    ()=>isSyntheticEvent,
    "isThenable",
    ()=>isThenable,
    "isVueViewModel",
    ()=>isVueViewModel
]);
// eslint-disable-next-line @typescript-eslint/unbound-method
const objectToString = Object.prototype.toString;
/**
 * Checks whether given value's type is one of a few Error or Error-like
 * {@link isError}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */ function isError(wat) {
    switch(objectToString.call(wat)){
        case '[object Error]':
        case '[object Exception]':
        case '[object DOMException]':
        case '[object WebAssembly.Exception]':
            return true;
        default:
            return isInstanceOf(wat, Error);
    }
}
/**
 * Checks whether given value is an instance of the given built-in class.
 *
 * @param wat The value to be checked
 * @param className
 * @returns A boolean representing the result.
 */ function isBuiltin(wat, className) {
    return objectToString.call(wat) === `[object ${className}]`;
}
/**
 * Checks whether given value's type is ErrorEvent
 * {@link isErrorEvent}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */ function isErrorEvent(wat) {
    return isBuiltin(wat, 'ErrorEvent');
}
/**
 * Checks whether given value's type is DOMError
 * {@link isDOMError}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */ function isDOMError(wat) {
    return isBuiltin(wat, 'DOMError');
}
/**
 * Checks whether given value's type is DOMException
 * {@link isDOMException}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */ function isDOMException(wat) {
    return isBuiltin(wat, 'DOMException');
}
/**
 * Checks whether given value's type is a string
 * {@link isString}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */ function isString(wat) {
    return isBuiltin(wat, 'String');
}
/**
 * Checks whether given string is parameterized
 * {@link isParameterizedString}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */ function isParameterizedString(wat) {
    return typeof wat === 'object' && wat !== null && '__sentry_template_string__' in wat && '__sentry_template_values__' in wat;
}
/**
 * Checks whether given value is a primitive (undefined, null, number, boolean, string, bigint, symbol)
 * {@link isPrimitive}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */ function isPrimitive(wat) {
    return wat === null || isParameterizedString(wat) || typeof wat !== 'object' && typeof wat !== 'function';
}
/**
 * Checks whether given value's type is an object literal, or a class instance.
 * {@link isPlainObject}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */ function isPlainObject(wat) {
    return isBuiltin(wat, 'Object');
}
/**
 * Checks whether given value's type is an Event instance
 * {@link isEvent}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */ function isEvent(wat) {
    return typeof Event !== 'undefined' && isInstanceOf(wat, Event);
}
/**
 * Checks whether given value's type is an Element instance
 * {@link isElement}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */ function isElement(wat) {
    return typeof Element !== 'undefined' && isInstanceOf(wat, Element);
}
/**
 * Checks whether given value's type is an regexp
 * {@link isRegExp}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */ function isRegExp(wat) {
    return isBuiltin(wat, 'RegExp');
}
/**
 * Checks whether given value has a then function.
 * @param wat A value to be checked.
 */ function isThenable(wat) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return Boolean(wat?.then && typeof wat.then === 'function');
}
/**
 * Checks whether given value's type is a SyntheticEvent
 * {@link isSyntheticEvent}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */ function isSyntheticEvent(wat) {
    return isPlainObject(wat) && 'nativeEvent' in wat && 'preventDefault' in wat && 'stopPropagation' in wat;
}
/**
 * Checks whether given value's type is an instance of provided constructor.
 * {@link isInstanceOf}.
 *
 * @param wat A value to be checked.
 * @param base A constructor to be used in a check.
 * @returns A boolean representing the result.
 */ // TODO: fix in v11, convert any to unknown
// export function isInstanceOf<T>(wat: unknown, base: { new (...args: any[]): T }): wat is T {
function isInstanceOf(wat, base) {
    try {
        return wat instanceof base;
    } catch  {
        return false;
    }
}
/**
 * Checks whether given value's type is a Vue ViewModel or a VNode.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */ function isVueViewModel(wat) {
    // Not using Object.prototype.toString because in Vue 3 it would read the instance's Symbol(Symbol.toStringTag) property.
    // We also need to check for __v_isVNode because Vue 3 component render instances have an internal __v_isVNode property.
    return !!(typeof wat === 'object' && wat !== null && (wat.__isVue || wat._isVue || wat.__v_isVNode));
}
/**
 * Checks whether the given parameter is a Standard Web API Request instance.
 *
 * Returns false if Request is not available in the current runtime.
 */ function isRequest(request) {
    return typeof Request !== 'undefined' && isInstanceOf(request, Request);
}
;
 //# sourceMappingURL=is.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/browser.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getComponentName",
    ()=>getComponentName,
    "getLocationHref",
    ()=>getLocationHref,
    "htmlTreeAsString",
    ()=>htmlTreeAsString
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
;
const WINDOW = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"];
const DEFAULT_MAX_STRING_LENGTH = 80;
/**
 * Given a child DOM element, returns a query-selector statement describing that
 * and its ancestors
 * e.g. [HTMLElement] => body > div > input#foo.btn[name=baz]
 * @returns generated DOM path
 */ function htmlTreeAsString(elem, options = {}) {
    if (!elem) {
        return '<unknown>';
    }
    // try/catch both:
    // - accessing event.target (see getsentry/raven-js#838, #768)
    // - `htmlTreeAsString` because it's complex, and just accessing the DOM incorrectly
    // - can throw an exception in some circumstances.
    try {
        let currentElem = elem;
        const MAX_TRAVERSE_HEIGHT = 5;
        const out = [];
        let height = 0;
        let len = 0;
        const separator = ' > ';
        const sepLength = separator.length;
        let nextStr;
        const keyAttrs = Array.isArray(options) ? options : options.keyAttrs;
        const maxStringLength = !Array.isArray(options) && options.maxStringLength || DEFAULT_MAX_STRING_LENGTH;
        while(currentElem && height++ < MAX_TRAVERSE_HEIGHT){
            nextStr = _htmlElementAsString(currentElem, keyAttrs);
            // bail out if
            // - nextStr is the 'html' element
            // - the length of the string that would be created exceeds maxStringLength
            //   (ignore this limit if we are on the first iteration)
            if (nextStr === 'html' || height > 1 && len + out.length * sepLength + nextStr.length >= maxStringLength) {
                break;
            }
            out.push(nextStr);
            len += nextStr.length;
            currentElem = currentElem.parentNode;
        }
        return out.reverse().join(separator);
    } catch  {
        return '<unknown>';
    }
}
/**
 * Returns a simple, query-selector representation of a DOM element
 * e.g. [HTMLElement] => input#foo.btn[name=baz]
 * @returns generated DOM path
 */ function _htmlElementAsString(el, keyAttrs) {
    const elem = el;
    const out = [];
    if (!elem?.tagName) {
        return '';
    }
    // @ts-expect-error WINDOW has HTMLElement
    if (WINDOW.HTMLElement) {
        // If using the component name annotation plugin, this value may be available on the DOM node
        if (elem instanceof HTMLElement && elem.dataset) {
            if (elem.dataset['sentryComponent']) {
                return elem.dataset['sentryComponent'];
            }
            if (elem.dataset['sentryElement']) {
                return elem.dataset['sentryElement'];
            }
        }
    }
    out.push(elem.tagName.toLowerCase());
    // Pairs of attribute keys defined in `serializeAttribute` and their values on element.
    const keyAttrPairs = keyAttrs?.length ? keyAttrs.filter((keyAttr)=>elem.getAttribute(keyAttr)).map((keyAttr)=>[
            keyAttr,
            elem.getAttribute(keyAttr)
        ]) : null;
    if (keyAttrPairs?.length) {
        keyAttrPairs.forEach((keyAttrPair)=>{
            out.push(`[${keyAttrPair[0]}="${keyAttrPair[1]}"]`);
        });
    } else {
        if (elem.id) {
            out.push(`#${elem.id}`);
        }
        const className = elem.className;
        if (className && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isString"])(className)) {
            const classes = className.split(/\s+/);
            for (const c of classes){
                out.push(`.${c}`);
            }
        }
    }
    const allowedAttrs = [
        'aria-label',
        'type',
        'name',
        'title',
        'alt'
    ];
    for (const k of allowedAttrs){
        const attr = elem.getAttribute(k);
        if (attr) {
            out.push(`[${k}="${attr}"]`);
        }
    }
    return out.join('');
}
/**
 * A safe form of location.href
 */ function getLocationHref() {
    try {
        return WINDOW.document.location.href;
    } catch  {
        return '';
    }
}
/**
 * Given a DOM element, traverses up the tree until it finds the first ancestor node
 * that has the `data-sentry-component` or `data-sentry-element` attribute with `data-sentry-component` taking
 * precedence. This attribute is added at build-time by projects that have the component name annotation plugin installed.
 *
 * @returns a string representation of the component for the provided DOM element, or `null` if not found
 */ function getComponentName(elem) {
    // @ts-expect-error WINDOW has HTMLElement
    if (!WINDOW.HTMLElement) {
        return null;
    }
    let currentElem = elem;
    const MAX_TRAVERSE_HEIGHT = 5;
    for(let i = 0; i < MAX_TRAVERSE_HEIGHT; i++){
        if (!currentElem) {
            return null;
        }
        if (currentElem instanceof HTMLElement) {
            if (currentElem.dataset['sentryComponent']) {
                return currentElem.dataset['sentryComponent'];
            }
            if (currentElem.dataset['sentryElement']) {
                return currentElem.dataset['sentryElement'];
            }
        }
        currentElem = currentElem.parentNode;
    }
    return null;
}
;
 //# sourceMappingURL=browser.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "CONSOLE_LEVELS",
    ()=>CONSOLE_LEVELS,
    "consoleSandbox",
    ()=>consoleSandbox,
    "debug",
    ()=>debug,
    "originalConsoleMethods",
    ()=>originalConsoleMethods
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/carrier.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
;
;
const CONSOLE_LEVELS = [
    'debug',
    'info',
    'warn',
    'error',
    'log',
    'assert',
    'trace'
];
/** Prefix for logging strings */ const PREFIX = 'Sentry Logger ';
/** This may be mutated by the console instrumentation. */ const originalConsoleMethods = {};
/**
 * Temporarily disable sentry console instrumentations.
 *
 * @param callback The function to run against the original `console` messages
 * @returns The results of the callback
 */ function consoleSandbox(callback) {
    if (!('console' in __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"])) {
        return callback();
    }
    const console = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].console;
    const wrappedFuncs = {};
    const wrappedLevels = Object.keys(originalConsoleMethods);
    // Restore all wrapped console methods
    wrappedLevels.forEach((level)=>{
        const originalConsoleMethod = originalConsoleMethods[level];
        wrappedFuncs[level] = console[level];
        console[level] = originalConsoleMethod;
    });
    try {
        return callback();
    } finally{
        // Revert restoration to wrapped state
        wrappedLevels.forEach((level)=>{
            console[level] = wrappedFuncs[level];
        });
    }
}
function enable() {
    _getLoggerSettings().enabled = true;
}
function disable() {
    _getLoggerSettings().enabled = false;
}
function isEnabled() {
    return _getLoggerSettings().enabled;
}
function log(...args) {
    _maybeLog('log', ...args);
}
function warn(...args) {
    _maybeLog('warn', ...args);
}
function error(...args) {
    _maybeLog('error', ...args);
}
function _maybeLog(level, ...args) {
    if (!__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"]) {
        return;
    }
    if (isEnabled()) {
        consoleSandbox(()=>{
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].console[level](`${PREFIX}[${level}]:`, ...args);
        });
    }
}
function _getLoggerSettings() {
    if (!__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"]) {
        return {
            enabled: false
        };
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getGlobalSingleton"])('loggerSettings', ()=>({
            enabled: false
        }));
}
/**
 * This is a logger singleton which either logs things or no-ops if logging is not enabled.
 */ const debug = {
    /** Enable logging. */ enable,
    /** Disable logging. */ disable,
    /** Check if logging is enabled. */ isEnabled,
    /** Log a message. */ log,
    /** Log a warning. */ warn,
    /** Log an error. */ error
};
;
 //# sourceMappingURL=debug-logger.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/object.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addNonEnumerableProperty",
    ()=>addNonEnumerableProperty,
    "convertToPlainObject",
    ()=>convertToPlainObject,
    "dropUndefinedKeys",
    ()=>dropUndefinedKeys,
    "extractExceptionKeysForMessage",
    ()=>extractExceptionKeysForMessage,
    "fill",
    ()=>fill,
    "getOriginalFunction",
    ()=>getOriginalFunction,
    "markFunctionWrapped",
    ()=>markFunctionWrapped,
    "objectify",
    ()=>objectify
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$browser$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/browser.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
;
;
;
;
/* eslint-disable @typescript-eslint/no-explicit-any */ /**
 * Replace a method in an object with a wrapped version of itself.
 *
 * If the method on the passed object is not a function, the wrapper will not be applied.
 *
 * @param source An object that contains a method to be wrapped.
 * @param name The name of the method to be wrapped.
 * @param replacementFactory A higher-order function that takes the original version of the given method and returns a
 * wrapped version. Note: The function returned by `replacementFactory` needs to be a non-arrow function, in order to
 * preserve the correct value of `this`, and the original method must be called using `origMethod.call(this, <other
 * args>)` or `origMethod.apply(this, [<other args>])` (rather than being called directly), again to preserve `this`.
 * @returns void
 */ function fill(source, name, replacementFactory) {
    if (!(name in source)) {
        return;
    }
    // explicitly casting to unknown because we don't know the type of the method initially at all
    const original = source[name];
    if (typeof original !== 'function') {
        return;
    }
    const wrapped = replacementFactory(original);
    // Make sure it's a function first, as we need to attach an empty prototype for `defineProperties` to work
    // otherwise it'll throw "TypeError: Object.defineProperties called on non-object"
    if (typeof wrapped === 'function') {
        markFunctionWrapped(wrapped, original);
    }
    try {
        source[name] = wrapped;
    } catch  {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`Failed to replace method "${name}" in object`, source);
    }
}
/**
 * Defines a non-enumerable property on the given object.
 *
 * @param obj The object on which to set the property
 * @param name The name of the property to be set
 * @param value The value to which to set the property
 */ function addNonEnumerableProperty(obj, name, value) {
    try {
        Object.defineProperty(obj, name, {
            // enumerable: false, // the default, so we can save on bundle size by not explicitly setting it
            value: value,
            writable: true,
            configurable: true
        });
    } catch  {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`Failed to add non-enumerable property "${name}" to object`, obj);
    }
}
/**
 * Remembers the original function on the wrapped function and
 * patches up the prototype.
 *
 * @param wrapped the wrapper function
 * @param original the original function that gets wrapped
 */ function markFunctionWrapped(wrapped, original) {
    try {
        const proto = original.prototype || {};
        wrapped.prototype = original.prototype = proto;
        addNonEnumerableProperty(wrapped, '__sentry_original__', original);
    } catch  {} // eslint-disable-line no-empty
}
/**
 * This extracts the original function if available.  See
 * `markFunctionWrapped` for more information.
 *
 * @param func the function to unwrap
 * @returns the unwrapped version of the function if available.
 */ // eslint-disable-next-line @typescript-eslint/ban-types
function getOriginalFunction(func) {
    return func.__sentry_original__;
}
/**
 * Transforms any `Error` or `Event` into a plain object with all of their enumerable properties, and some of their
 * non-enumerable properties attached.
 *
 * @param value Initial source that we have to transform in order for it to be usable by the serializer
 * @returns An Event or Error turned into an object - or the value argument itself, when value is neither an Event nor
 *  an Error.
 */ function convertToPlainObject(value) {
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isError"])(value)) {
        return {
            message: value.message,
            name: value.name,
            stack: value.stack,
            ...getOwnProperties(value)
        };
    } else if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isEvent"])(value)) {
        const newObj = {
            type: value.type,
            target: serializeEventTarget(value.target),
            currentTarget: serializeEventTarget(value.currentTarget),
            ...getOwnProperties(value)
        };
        if (typeof CustomEvent !== 'undefined' && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isInstanceOf"])(value, CustomEvent)) {
            newObj.detail = value.detail;
        }
        return newObj;
    } else {
        return value;
    }
}
/** Creates a string representation of the target of an `Event` object */ function serializeEventTarget(target) {
    try {
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isElement"])(target) ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$browser$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["htmlTreeAsString"])(target) : Object.prototype.toString.call(target);
    } catch  {
        return '<unknown>';
    }
}
/** Filters out all but an object's own properties */ function getOwnProperties(obj) {
    if (typeof obj === 'object' && obj !== null) {
        const extractedProps = {};
        for(const property in obj){
            if (Object.prototype.hasOwnProperty.call(obj, property)) {
                extractedProps[property] = obj[property];
            }
        }
        return extractedProps;
    } else {
        return {};
    }
}
/**
 * Given any captured exception, extract its keys and create a sorted
 * and truncated list that will be used inside the event message.
 * eg. `Non-error exception captured with keys: foo, bar, baz`
 */ function extractExceptionKeysForMessage(exception) {
    const keys = Object.keys(convertToPlainObject(exception));
    keys.sort();
    return !keys[0] ? '[object has no keys]' : keys.join(', ');
}
/**
 * Given any object, return a new object having removed all fields whose value was `undefined`.
 * Works recursively on objects and arrays.
 *
 * Attention: This function keeps circular references in the returned object.
 *
 * @deprecated This function is no longer used by the SDK and will be removed in a future major version.
 */ function dropUndefinedKeys(inputValue) {
    // This map keeps track of what already visited nodes map to.
    // Our Set - based memoBuilder doesn't work here because we want to the output object to have the same circular
    // references as the input object.
    const memoizationMap = new Map();
    // This function just proxies `_dropUndefinedKeys` to keep the `memoBuilder` out of this function's API
    return _dropUndefinedKeys(inputValue, memoizationMap);
}
function _dropUndefinedKeys(inputValue, memoizationMap) {
    // Early return for primitive values
    if (inputValue === null || typeof inputValue !== 'object') {
        return inputValue;
    }
    // Check memo map first for all object types
    const memoVal = memoizationMap.get(inputValue);
    if (memoVal !== undefined) {
        return memoVal;
    }
    // handle arrays
    if (Array.isArray(inputValue)) {
        const returnValue = [];
        // Store mapping to handle circular references
        memoizationMap.set(inputValue, returnValue);
        inputValue.forEach((value)=>{
            returnValue.push(_dropUndefinedKeys(value, memoizationMap));
        });
        return returnValue;
    }
    if (isPojo(inputValue)) {
        const returnValue = {};
        // Store mapping to handle circular references
        memoizationMap.set(inputValue, returnValue);
        const keys = Object.keys(inputValue);
        keys.forEach((key)=>{
            const val = inputValue[key];
            if (val !== undefined) {
                returnValue[key] = _dropUndefinedKeys(val, memoizationMap);
            }
        });
        return returnValue;
    }
    // For other object types, return as is
    return inputValue;
}
function isPojo(input) {
    // Plain objects have Object as constructor or no constructor
    const constructor = input.constructor;
    return constructor === Object || constructor === undefined;
}
/**
 * Ensure that something is an object.
 *
 * Turns `undefined` and `null` into `String`s and all other primitives into instances of their respective wrapper
 * classes (String, Boolean, Number, etc.). Acts as the identity function on non-primitives.
 *
 * @param wat The subject of the objectification
 * @returns A version of `wat` which can safely be used with `Object` class methods
 */ function objectify(wat) {
    let objectified;
    switch(true){
        // this will catch both undefined and null
        case wat == undefined:
            objectified = new String(wat);
            break;
        // Though symbols and bigints do have wrapper classes (`Symbol` and `BigInt`, respectively), for whatever reason
        // those classes don't have constructors which can be used with the `new` keyword. We therefore need to cast each as
        // an object in order to wrap it.
        case typeof wat === 'symbol' || typeof wat === 'bigint':
            objectified = Object(wat);
            break;
        // this will catch the remaining primitives: `String`, `Number`, and `Boolean`
        case (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isPrimitive"])(wat):
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            objectified = new wat.constructor(wat);
            break;
        // by process of elimination, at this point we know that `wat` must already be an object
        default:
            objectified = wat;
            break;
    }
    return objectified;
}
;
 //# sourceMappingURL=object.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "safeDateNow",
    ()=>safeDateNow,
    "safeMathRandom",
    ()=>safeMathRandom,
    "withRandomSafeContext",
    ()=>withRandomSafeContext
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
// undefined = not yet resolved, null = no runner found, function = runner found
let RESOLVED_RUNNER;
/**
 * Simple wrapper that allows SDKs to *secretly* set context wrapper to generate safe random IDs in cache components contexts
 */ function withRandomSafeContext(cb) {
    // Skips future symbol lookups if we've already resolved (or attempted to resolve) the runner once
    if (RESOLVED_RUNNER !== undefined) {
        return RESOLVED_RUNNER ? RESOLVED_RUNNER(cb) : cb();
    }
    const sym = Symbol.for('__SENTRY_SAFE_RANDOM_ID_WRAPPER__');
    const globalWithSymbol = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"];
    if (sym in globalWithSymbol && typeof globalWithSymbol[sym] === 'function') {
        RESOLVED_RUNNER = globalWithSymbol[sym];
        return RESOLVED_RUNNER(cb);
    }
    RESOLVED_RUNNER = null;
    return cb();
}
/**
 * Identical to Math.random() but wrapped in withRandomSafeContext
 * to ensure safe random number generation in certain contexts (e.g., Next.js Cache Components).
 */ function safeMathRandom() {
    return withRandomSafeContext(()=>Math.random());
}
/**
 * Identical to Date.now() but wrapped in withRandomSafeContext
 * to ensure safe time value generation in certain contexts (e.g., Next.js Cache Components).
 */ function safeDateNow() {
    return withRandomSafeContext(()=>Date.now());
}
;
 //# sourceMappingURL=randomSafeContext.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/stacktrace.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "UNKNOWN_FUNCTION",
    ()=>UNKNOWN_FUNCTION,
    "createStackParser",
    ()=>createStackParser,
    "getFramesFromEvent",
    ()=>getFramesFromEvent,
    "getFunctionName",
    ()=>getFunctionName,
    "getVueInternalName",
    ()=>getVueInternalName,
    "normalizeStackTracePath",
    ()=>normalizeStackTracePath,
    "stackParserFromStackParserOptions",
    ()=>stackParserFromStackParserOptions,
    "stripSentryFramesAndReverse",
    ()=>stripSentryFramesAndReverse
]);
const STACKTRACE_FRAME_LIMIT = 50;
const UNKNOWN_FUNCTION = '?';
// Used to sanitize webpack (error: *) wrapped stack errors
const WEBPACK_ERROR_REGEXP = /\(error: (.*)\)/;
const STRIP_FRAME_REGEXP = /captureMessage|captureException/;
/**
 * Creates a stack parser with the supplied line parsers
 *
 * StackFrames are returned in the correct order for Sentry Exception
 * frames and with Sentry SDK internal frames removed from the top and bottom
 *
 */ function createStackParser(...parsers) {
    const sortedParsers = parsers.sort((a, b)=>a[0] - b[0]).map((p)=>p[1]);
    return (stack, skipFirstLines = 0, framesToPop = 0)=>{
        const frames = [];
        const lines = stack.split('\n');
        for(let i = skipFirstLines; i < lines.length; i++){
            let line = lines[i];
            // Truncate lines over 1kb because many of the regular expressions use
            // backtracking which results in run time that increases exponentially
            // with input size. Huge strings can result in hangs/Denial of Service:
            // https://github.com/getsentry/sentry-javascript/issues/2286
            if (line.length > 1024) {
                line = line.slice(0, 1024);
            }
            // https://github.com/getsentry/sentry-javascript/issues/5459
            // Remove webpack (error: *) wrappers
            const cleanedLine = WEBPACK_ERROR_REGEXP.test(line) ? line.replace(WEBPACK_ERROR_REGEXP, '$1') : line;
            // https://github.com/getsentry/sentry-javascript/issues/7813
            // Skip Error: lines
            if (cleanedLine.match(/\S*Error: /)) {
                continue;
            }
            for (const parser of sortedParsers){
                const frame = parser(cleanedLine);
                if (frame) {
                    frames.push(frame);
                    break;
                }
            }
            if (frames.length >= STACKTRACE_FRAME_LIMIT + framesToPop) {
                break;
            }
        }
        return stripSentryFramesAndReverse(frames.slice(framesToPop));
    };
}
/**
 * Gets a stack parser implementation from Options.stackParser
 * @see Options
 *
 * If options contains an array of line parsers, it is converted into a parser
 */ function stackParserFromStackParserOptions(stackParser) {
    if (Array.isArray(stackParser)) {
        return createStackParser(...stackParser);
    }
    return stackParser;
}
/**
 * Removes Sentry frames from the top and bottom of the stack if present and enforces a limit of max number of frames.
 * Assumes stack input is ordered from top to bottom and returns the reverse representation so call site of the
 * function that caused the crash is the last frame in the array.
 * @hidden
 */ function stripSentryFramesAndReverse(stack) {
    if (!stack.length) {
        return [];
    }
    const localStack = Array.from(stack);
    // If stack starts with one of our API calls, remove it (starts, meaning it's the top of the stack - aka last call)
    if (/sentryWrapped/.test(getLastStackFrame(localStack).function || '')) {
        localStack.pop();
    }
    // Reversing in the middle of the procedure allows us to just pop the values off the stack
    localStack.reverse();
    // If stack ends with one of our internal API calls, remove it (ends, meaning it's the bottom of the stack - aka top-most call)
    if (STRIP_FRAME_REGEXP.test(getLastStackFrame(localStack).function || '')) {
        localStack.pop();
        // When using synthetic events, we will have a 2 levels deep stack, as `new Error('Sentry syntheticException')`
        // is produced within the scope itself, making it:
        //
        //   Sentry.captureException()
        //   scope.captureException()
        //
        // instead of just the top `Sentry` call itself.
        // This forces us to possibly strip an additional frame in the exact same was as above.
        if (STRIP_FRAME_REGEXP.test(getLastStackFrame(localStack).function || '')) {
            localStack.pop();
        }
    }
    return localStack.slice(0, STACKTRACE_FRAME_LIMIT).map((frame)=>({
            ...frame,
            filename: frame.filename || getLastStackFrame(localStack).filename,
            function: frame.function || UNKNOWN_FUNCTION
        }));
}
function getLastStackFrame(arr) {
    return arr[arr.length - 1] || {};
}
const defaultFunctionName = '<anonymous>';
/**
 * Safely extract function name from itself
 */ function getFunctionName(fn) {
    try {
        if (!fn || typeof fn !== 'function') {
            return defaultFunctionName;
        }
        return fn.name || defaultFunctionName;
    } catch  {
        // Just accessing custom props in some Selenium environments
        // can cause a "Permission denied" exception (see raven-js#495).
        return defaultFunctionName;
    }
}
/**
 * Get's stack frames from an event without needing to check for undefined properties.
 */ function getFramesFromEvent(event) {
    const exception = event.exception;
    if (exception) {
        const frames = [];
        try {
            // @ts-expect-error Object could be undefined
            exception.values.forEach((value)=>{
                // @ts-expect-error Value could be undefined
                if (value.stacktrace.frames) {
                    // @ts-expect-error Value could be undefined
                    frames.push(...value.stacktrace.frames);
                }
            });
            return frames;
        } catch  {
            return undefined;
        }
    }
    return undefined;
}
/**
 * Get the internal name of an internal Vue value, to represent it in a stacktrace.
 *
 * @param value The value to get the internal name of.
 */ function getVueInternalName(value) {
    // Check if it's a VNode (has __v_isVNode) or a component instance (has _isVue/__isVue)
    const isVNode = '__v_isVNode' in value && value.__v_isVNode;
    return isVNode ? '[VueVNode]' : '[VueViewModel]';
}
/**
 * Normalizes stack line paths by removing file:// prefix and leading slashes for Windows paths
 */ function normalizeStackTracePath(path) {
    let filename = path?.startsWith('file://') ? path.slice(7) : path;
    // If it's a Windows path, trim the leading slash so that `/C:/foo` becomes `C:/foo`
    if (filename?.match(/\/[A-Z]:/)) {
        filename = filename.slice(1);
    }
    return filename;
}
;
 //# sourceMappingURL=stacktrace.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/string.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "isMatchingPattern",
    ()=>isMatchingPattern,
    "safeJoin",
    ()=>safeJoin,
    "snipLine",
    ()=>snipLine,
    "stringMatchesSomePattern",
    ()=>stringMatchesSomePattern,
    "truncate",
    ()=>truncate
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/stacktrace.js [instrumentation-edge] (ecmascript)");
;
;
/**
 * Truncates given string to the maximum characters count
 *
 * @param str An object that contains serializable values
 * @param max Maximum number of characters in truncated string (0 = unlimited)
 * @returns string Encoded
 */ function truncate(str, max = 0) {
    if (typeof str !== 'string' || max === 0) {
        return str;
    }
    return str.length <= max ? str : `${str.slice(0, max)}...`;
}
/**
 * This is basically just `trim_line` from
 * https://github.com/getsentry/sentry/blob/master/src/sentry/lang/javascript/processor.py#L67
 *
 * @param str An object that contains serializable values
 * @param max Maximum number of characters in truncated string
 * @returns string Encoded
 */ function snipLine(line, colno) {
    let newLine = line;
    const lineLength = newLine.length;
    if (lineLength <= 150) {
        return newLine;
    }
    if (colno > lineLength) {
        // eslint-disable-next-line no-param-reassign
        colno = lineLength;
    }
    let start = Math.max(colno - 60, 0);
    if (start < 5) {
        start = 0;
    }
    let end = Math.min(start + 140, lineLength);
    if (end > lineLength - 5) {
        end = lineLength;
    }
    if (end === lineLength) {
        start = Math.max(end - 140, 0);
    }
    newLine = newLine.slice(start, end);
    if (start > 0) {
        newLine = `'{snip} ${newLine}`;
    }
    if (end < lineLength) {
        newLine += ' {snip}';
    }
    return newLine;
}
/**
 * Join values in array
 * @param input array of values to be joined together
 * @param delimiter string to be placed in-between values
 * @returns Joined values
 */ function safeJoin(input, delimiter) {
    if (!Array.isArray(input)) {
        return '';
    }
    const output = [];
    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for(let i = 0; i < input.length; i++){
        const value = input[i];
        try {
            // This is a hack to fix a Vue3-specific bug that causes an infinite loop of
            // console warnings. This happens when a Vue template is rendered with
            // an undeclared variable, which we try to stringify, ultimately causing
            // Vue to issue another warning which repeats indefinitely.
            // see: https://github.com/getsentry/sentry-javascript/pull/8981
            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isVueViewModel"])(value)) {
                output.push((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getVueInternalName"])(value));
            } else {
                output.push(String(value));
            }
        } catch  {
            output.push('[value cannot be serialized]');
        }
    }
    return output.join(delimiter);
}
/**
 * Checks if the given value matches a regex or string
 *
 * @param value The string to test
 * @param pattern Either a regex or a string against which `value` will be matched
 * @param requireExactStringMatch If true, `value` must match `pattern` exactly. If false, `value` will match
 * `pattern` if it contains `pattern`. Only applies to string-type patterns.
 */ function isMatchingPattern(value, pattern, requireExactStringMatch = false) {
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isString"])(value)) {
        return false;
    }
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isRegExp"])(pattern)) {
        return pattern.test(value);
    }
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isString"])(pattern)) {
        return requireExactStringMatch ? value === pattern : value.includes(pattern);
    }
    return false;
}
/**
 * Test the given string against an array of strings and regexes. By default, string matching is done on a
 * substring-inclusion basis rather than a strict equality basis
 *
 * @param testString The string to test
 * @param patterns The patterns against which to test the string
 * @param requireExactStringMatch If true, `testString` must match one of the given string patterns exactly in order to
 * count. If false, `testString` will match a string pattern if it contains that pattern.
 * @returns
 */ function stringMatchesSomePattern(testString, patterns = [], requireExactStringMatch = false) {
    return patterns.some((pattern)=>isMatchingPattern(testString, pattern, requireExactStringMatch));
}
;
 //# sourceMappingURL=string.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/misc.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addContextToFrame",
    ()=>addContextToFrame,
    "addExceptionMechanism",
    ()=>addExceptionMechanism,
    "addExceptionTypeValue",
    ()=>addExceptionTypeValue,
    "checkOrSetAlreadyCaught",
    ()=>checkOrSetAlreadyCaught,
    "getEventDescription",
    ()=>getEventDescription,
    "isAlreadyCaptured",
    ()=>isAlreadyCaptured,
    "parseSemver",
    ()=>parseSemver,
    "uuid4",
    ()=>uuid4
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/object.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/string.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
;
;
;
function getCrypto() {
    const gbl = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"];
    return gbl.crypto || gbl.msCrypto;
}
let emptyUuid;
function getRandomByte() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeMathRandom"])() * 16;
}
/**
 * UUID4 generator
 * @param crypto Object that provides the crypto API.
 * @returns string Generated UUID4.
 */ function uuid4(crypto = getCrypto()) {
    try {
        if (crypto?.randomUUID) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["withRandomSafeContext"])(()=>crypto.randomUUID()).replace(/-/g, '');
        }
    } catch  {
    // some runtimes can crash invoking crypto
    // https://github.com/getsentry/sentry-javascript/issues/8935
    }
    if (!emptyUuid) {
        // http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript/2117523#2117523
        // Concatenating the following numbers as strings results in '10000000100040008000100000000000'
        emptyUuid = [
            1e7
        ] + 1e3 + 4e3 + 8e3 + 1e11;
    }
    return emptyUuid.replace(/[018]/g, (c)=>// eslint-disable-next-line no-bitwise
        (c ^ (getRandomByte() & 15) >> c / 4).toString(16));
}
function getFirstException(event) {
    return event.exception?.values?.[0];
}
/**
 * Extracts either message or type+value from an event that can be used for user-facing logs
 * @returns event's description
 */ function getEventDescription(event) {
    const { message, event_id: eventId } = event;
    if (message) {
        return message;
    }
    const firstException = getFirstException(event);
    if (firstException) {
        if (firstException.type && firstException.value) {
            return `${firstException.type}: ${firstException.value}`;
        }
        return firstException.type || firstException.value || eventId || '<unknown>';
    }
    return eventId || '<unknown>';
}
/**
 * Adds exception values, type and value to an synthetic Exception.
 * @param event The event to modify.
 * @param value Value of the exception.
 * @param type Type of the exception.
 * @hidden
 */ function addExceptionTypeValue(event, value, type) {
    const exception = event.exception = event.exception || {};
    const values = exception.values = exception.values || [];
    const firstException = values[0] = values[0] || {};
    if (!firstException.value) {
        firstException.value = value || '';
    }
    if (!firstException.type) {
        firstException.type = type || 'Error';
    }
}
/**
 * Adds exception mechanism data to a given event. Uses defaults if the second parameter is not passed.
 *
 * @param event The event to modify.
 * @param newMechanism Mechanism data to add to the event.
 * @hidden
 */ function addExceptionMechanism(event, newMechanism) {
    const firstException = getFirstException(event);
    if (!firstException) {
        return;
    }
    const defaultMechanism = {
        type: 'generic',
        handled: true
    };
    const currentMechanism = firstException.mechanism;
    firstException.mechanism = {
        ...defaultMechanism,
        ...currentMechanism,
        ...newMechanism
    };
    if (newMechanism && 'data' in newMechanism) {
        const mergedData = {
            ...currentMechanism?.data,
            ...newMechanism.data
        };
        firstException.mechanism.data = mergedData;
    }
}
// https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
const SEMVER_REGEXP = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
/**
 * Represents Semantic Versioning object
 */ function _parseInt(input) {
    return parseInt(input || '', 10);
}
/**
 * Parses input into a SemVer interface
 * @param input string representation of a semver version
 */ function parseSemver(input) {
    const match = input.match(SEMVER_REGEXP) || [];
    const major = _parseInt(match[1]);
    const minor = _parseInt(match[2]);
    const patch = _parseInt(match[3]);
    return {
        buildmetadata: match[5],
        major: isNaN(major) ? undefined : major,
        minor: isNaN(minor) ? undefined : minor,
        patch: isNaN(patch) ? undefined : patch,
        prerelease: match[4]
    };
}
/**
 * This function adds context (pre/post/line) lines to the provided frame
 *
 * @param lines string[] containing all lines
 * @param frame StackFrame that will be mutated
 * @param linesOfContext number of context lines we want to add pre/post
 */ function addContextToFrame(lines, frame, linesOfContext = 5) {
    // When there is no line number in the frame, attaching context is nonsensical and will even break grouping
    if (frame.lineno === undefined) {
        return;
    }
    const maxLines = lines.length;
    const sourceLine = Math.max(Math.min(maxLines - 1, frame.lineno - 1), 0);
    frame.pre_context = lines.slice(Math.max(0, sourceLine - linesOfContext), sourceLine).map((line)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["snipLine"])(line, 0));
    // We guard here to ensure this is not larger than the existing number of lines
    const lineIndex = Math.min(maxLines - 1, sourceLine);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    frame.context_line = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["snipLine"])(lines[lineIndex], frame.colno || 0);
    frame.post_context = lines.slice(Math.min(sourceLine + 1, maxLines), sourceLine + 1 + linesOfContext).map((line)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["snipLine"])(line, 0));
}
/**
 * Checks whether or not we've already captured the given exception (note: not an identical exception - the very object
 * in question), and marks it captured if not.
 *
 * This is useful because it's possible for an error to get captured by more than one mechanism. After we intercept and
 * record an error, we rethrow it (assuming we've intercepted it before it's reached the top-level global handlers), so
 * that we don't interfere with whatever effects the error might have had were the SDK not there. At that point, because
 * the error has been rethrown, it's possible for it to bubble up to some other code we've instrumented. If it's not
 * caught after that, it will bubble all the way up to the global handlers (which of course we also instrument). This
 * function helps us ensure that even if we encounter the same error more than once, we only record it the first time we
 * see it.
 *
 * Note: It will ignore primitives (always return `false` and not mark them as seen), as properties can't be set on
 * them. {@link: Object.objectify} can be used on exceptions to convert any that are primitives into their equivalent
 * object wrapper forms so that this check will always work. However, because we need to flag the exact object which
 * will get rethrown, and because that rethrowing happens outside of the event processing pipeline, the objectification
 * must be done before the exception captured.
 *
 * @param A thrown exception to check or flag as having been seen
 * @returns `true` if the exception has already been captured, `false` if not (with the side effect of marking it seen)
 */ function checkOrSetAlreadyCaught(exception) {
    if (isAlreadyCaptured(exception)) {
        return true;
    }
    try {
        // set it this way rather than by assignment so that it's not ennumerable and therefore isn't recorded by the
        // `ExtraErrorData` integration
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addNonEnumerableProperty"])(exception, '__sentry_captured__', true);
    } catch  {
    // `exception` is a primitive, so we can't mark it seen
    }
    return false;
}
/**
 * Checks whether we've already captured the given exception (note: not an identical exception - the very object).
 * It is considered already captured if it has the `__sentry_captured__` property set to `true`.
 *
 * @internal Only considered for internal usage
 */ function isAlreadyCaptured(exception) {
    try {
        return exception.__sentry_captured__;
    } catch  {} // eslint-disable-line no-empty
}
;
 //# sourceMappingURL=misc.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/time.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "browserPerformanceTimeOrigin",
    ()=>browserPerformanceTimeOrigin,
    "dateTimestampInSeconds",
    ()=>dateTimestampInSeconds,
    "timestampInSeconds",
    ()=>timestampInSeconds
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
;
const ONE_SECOND_IN_MS = 1000;
/**
 * A partial definition of the [Performance Web API]{@link https://developer.mozilla.org/en-US/docs/Web/API/Performance}
 * for accessing a high-resolution monotonic clock.
 */ /**
 * Returns a timestamp in seconds since the UNIX epoch using the Date API.
 */ function dateTimestampInSeconds() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeDateNow"])() / ONE_SECOND_IN_MS;
}
/**
 * Returns a wrapper around the native Performance API browser implementation, or undefined for browsers that do not
 * support the API.
 *
 * Wrapping the native API works around differences in behavior from different browsers.
 */ function createUnixTimestampInSecondsFunc() {
    const { performance } = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"];
    // Some browser and environments don't have a performance or timeOrigin, so we fallback to
    // using Date.now() to compute the starting time.
    if (!performance?.now || !performance.timeOrigin) {
        return dateTimestampInSeconds;
    }
    const timeOrigin = performance.timeOrigin;
    // performance.now() is a monotonic clock, which means it starts at 0 when the process begins. To get the current
    // wall clock time (actual UNIX timestamp), we need to add the starting time origin and the current time elapsed.
    //
    // TODO: This does not account for the case where the monotonic clock that powers performance.now() drifts from the
    // wall clock time, which causes the returned timestamp to be inaccurate. We should investigate how to detect and
    // correct for this.
    // See: https://github.com/getsentry/sentry-javascript/issues/2590
    // See: https://github.com/mdn/content/issues/4713
    // See: https://dev.to/noamr/when-a-millisecond-is-not-a-millisecond-3h6
    return ()=>{
        return (timeOrigin + (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["withRandomSafeContext"])(()=>performance.now())) / ONE_SECOND_IN_MS;
    };
}
let _cachedTimestampInSeconds;
/**
 * Returns a timestamp in seconds since the UNIX epoch using either the Performance or Date APIs, depending on the
 * availability of the Performance API.
 *
 * BUG: Note that because of how browsers implement the Performance API, the clock might stop when the computer is
 * asleep. This creates a skew between `dateTimestampInSeconds` and `timestampInSeconds`. The
 * skew can grow to arbitrary amounts like days, weeks or months.
 * See https://github.com/getsentry/sentry-javascript/issues/2590.
 */ function timestampInSeconds() {
    // We store this in a closure so that we don't have to create a new function every time this is called.
    const func = _cachedTimestampInSeconds ?? (_cachedTimestampInSeconds = createUnixTimestampInSecondsFunc());
    return func();
}
/**
 * Cached result of getBrowserTimeOrigin.
 */ let cachedTimeOrigin = null;
/**
 * Gets the time origin and the mode used to determine it.
 *
 * Unfortunately browsers may report an inaccurate time origin data, through either performance.timeOrigin or
 * performance.timing.navigationStart, which results in poor results in performance data. We only treat time origin
 * data as reliable if they are within a reasonable threshold of the current time.
 *
 * TODO: move to `@sentry/browser-utils` package.
 */ function getBrowserTimeOrigin() {
    const { performance } = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"];
    if (!performance?.now) {
        return undefined;
    }
    const threshold = 300000; // 5 minutes in milliseconds
    const performanceNow = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["withRandomSafeContext"])(()=>performance.now());
    const dateNow = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeDateNow"])();
    const timeOrigin = performance.timeOrigin;
    if (typeof timeOrigin === 'number') {
        const timeOriginDelta = Math.abs(timeOrigin + performanceNow - dateNow);
        if (timeOriginDelta < threshold) {
            return timeOrigin;
        }
    }
    // TODO: Remove all code related to `performance.timing.navigationStart` once we drop support for Safari 14.
    // `performance.timeSince` is available in Safari 15.
    // see: https://caniuse.com/mdn-api_performance_timeorigin
    // While performance.timing.navigationStart is deprecated in favor of performance.timeOrigin, performance.timeOrigin
    // is not as widely supported. Namely, performance.timeOrigin is undefined in Safari as of writing.
    // Also as of writing, performance.timing is not available in Web Workers in mainstream browsers, so it is not always
    // a valid fallback. In the absence of an initial time provided by the browser, fallback to the current time from the
    // Date API.
    // eslint-disable-next-line deprecation/deprecation
    const navigationStart = performance.timing?.navigationStart;
    if (typeof navigationStart === 'number') {
        const navigationStartDelta = Math.abs(navigationStart + performanceNow - dateNow);
        if (navigationStartDelta < threshold) {
            return navigationStart;
        }
    }
    // Either both timeOrigin and navigationStart are skewed or neither is available, fallback to subtracting
    // `performance.now()` from `Date.now()`.
    return dateNow - performanceNow;
}
/**
 * The number of milliseconds since the UNIX epoch. This value is only usable in a browser, and only when the
 * performance API is available.
 */ function browserPerformanceTimeOrigin() {
    if (cachedTimeOrigin === null) {
        cachedTimeOrigin = getBrowserTimeOrigin();
    }
    return cachedTimeOrigin;
}
;
 //# sourceMappingURL=time.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/session.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "closeSession",
    ()=>closeSession,
    "makeSession",
    ()=>makeSession,
    "updateSession",
    ()=>updateSession
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/misc.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/time.js [instrumentation-edge] (ecmascript)");
;
;
/**
 * Creates a new `Session` object by setting certain default parameters. If optional @param context
 * is passed, the passed properties are applied to the session object.
 *
 * @param context (optional) additional properties to be applied to the returned session object
 *
 * @returns a new `Session` object
 */ function makeSession(context) {
    // Both timestamp and started are in seconds since the UNIX epoch.
    const startingTime = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timestampInSeconds"])();
    const session = {
        sid: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["uuid4"])(),
        init: true,
        timestamp: startingTime,
        started: startingTime,
        duration: 0,
        status: 'ok',
        errors: 0,
        ignoreDuration: false,
        toJSON: ()=>sessionToJSON(session)
    };
    if (context) {
        updateSession(session, context);
    }
    return session;
}
/**
 * Updates a session object with the properties passed in the context.
 *
 * Note that this function mutates the passed object and returns void.
 * (Had to do this instead of returning a new and updated session because closing and sending a session
 * makes an update to the session after it was passed to the sending logic.
 * @see Client.captureSession )
 *
 * @param session the `Session` to update
 * @param context the `SessionContext` holding the properties that should be updated in @param session
 */ // eslint-disable-next-line complexity
function updateSession(session, context = {}) {
    if (context.user) {
        if (!session.ipAddress && context.user.ip_address) {
            session.ipAddress = context.user.ip_address;
        }
        if (!session.did && !context.did) {
            session.did = context.user.id || context.user.email || context.user.username;
        }
    }
    session.timestamp = context.timestamp || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timestampInSeconds"])();
    if (context.abnormal_mechanism) {
        session.abnormal_mechanism = context.abnormal_mechanism;
    }
    if (context.ignoreDuration) {
        session.ignoreDuration = context.ignoreDuration;
    }
    if (context.sid) {
        // Good enough uuid validation. — Kamil
        session.sid = context.sid.length === 32 ? context.sid : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["uuid4"])();
    }
    if (context.init !== undefined) {
        session.init = context.init;
    }
    if (!session.did && context.did) {
        session.did = `${context.did}`;
    }
    if (typeof context.started === 'number') {
        session.started = context.started;
    }
    if (session.ignoreDuration) {
        session.duration = undefined;
    } else if (typeof context.duration === 'number') {
        session.duration = context.duration;
    } else {
        const duration = session.timestamp - session.started;
        session.duration = duration >= 0 ? duration : 0;
    }
    if (context.release) {
        session.release = context.release;
    }
    if (context.environment) {
        session.environment = context.environment;
    }
    if (!session.ipAddress && context.ipAddress) {
        session.ipAddress = context.ipAddress;
    }
    if (!session.userAgent && context.userAgent) {
        session.userAgent = context.userAgent;
    }
    if (typeof context.errors === 'number') {
        session.errors = context.errors;
    }
    if (context.status) {
        session.status = context.status;
    }
}
/**
 * Closes a session by setting its status and updating the session object with it.
 * Internally calls `updateSession` to update the passed session object.
 *
 * Note that this function mutates the passed session (@see updateSession for explanation).
 *
 * @param session the `Session` object to be closed
 * @param status the `SessionStatus` with which the session was closed. If you don't pass a status,
 *               this function will keep the previously set status, unless it was `'ok'` in which case
 *               it is changed to `'exited'`.
 */ function closeSession(session, status) {
    let context = {};
    if (status) {
        context = {
            status
        };
    } else if (session.status === 'ok') {
        context = {
            status: 'exited'
        };
    }
    updateSession(session, context);
}
/**
 * Serializes a passed session object to a JSON object with a slightly different structure.
 * This is necessary because the Sentry backend requires a slightly different schema of a session
 * than the one the JS SDKs use internally.
 *
 * @param session the session to be converted
 *
 * @returns a JSON object of the passed session
 */ function sessionToJSON(session) {
    return {
        sid: `${session.sid}`,
        init: session.init,
        // Make sure that sec is converted to ms for date constructor
        started: new Date(session.started * 1000).toISOString(),
        timestamp: new Date(session.timestamp * 1000).toISOString(),
        status: session.status,
        errors: session.errors,
        did: typeof session.did === 'number' || typeof session.did === 'string' ? `${session.did}` : undefined,
        duration: session.duration,
        abnormal_mechanism: session.abnormal_mechanism,
        attrs: {
            release: session.release,
            environment: session.environment,
            ip_address: session.ipAddress,
            user_agent: session.userAgent
        }
    };
}
;
 //# sourceMappingURL=session.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/merge.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "merge",
    ()=>merge
]);
/**
 * Shallow merge two objects.
 * Does not mutate the passed in objects.
 * Undefined/empty values in the merge object will overwrite existing values.
 *
 * By default, this merges 2 levels deep.
 */ function merge(initialObj, mergeObj, levels = 2) {
    // If the merge value is not an object, or we have no merge levels left,
    // we just set the value to the merge value
    if (!mergeObj || typeof mergeObj !== 'object' || levels <= 0) {
        return mergeObj;
    }
    // If the merge object is an empty object, and the initial object is not undefined, we return the initial object
    if (initialObj && Object.keys(mergeObj).length === 0) {
        return initialObj;
    }
    // Clone object
    const output = {
        ...initialObj
    };
    // Merge values into output, resursively
    for(const key in mergeObj){
        if (Object.prototype.hasOwnProperty.call(mergeObj, key)) {
            output[key] = merge(output[key], mergeObj[key], levels - 1);
        }
    }
    return output;
}
;
 //# sourceMappingURL=merge.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/propagationContext.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "generateSpanId",
    ()=>generateSpanId,
    "generateTraceId",
    ()=>generateTraceId
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/misc.js [instrumentation-edge] (ecmascript)");
;
/**
 * Generate a random, valid trace ID.
 */ function generateTraceId() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["uuid4"])();
}
/**
 * Generate a random, valid span ID.
 */ function generateSpanId() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["uuid4"])().substring(16);
}
;
 //# sourceMappingURL=propagationContext.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanOnScope.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "_getSpanForScope",
    ()=>_getSpanForScope,
    "_setSpanForScope",
    ()=>_setSpanForScope
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/object.js [instrumentation-edge] (ecmascript)");
;
const SCOPE_SPAN_FIELD = '_sentrySpan';
/**
 * Set the active span for a given scope.
 * NOTE: This should NOT be used directly, but is only used internally by the trace methods.
 */ function _setSpanForScope(scope, span) {
    if (span) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addNonEnumerableProperty"])(scope, SCOPE_SPAN_FIELD, span);
    } else {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete scope[SCOPE_SPAN_FIELD];
    }
}
/**
 * Get the active span for a given scope.
 * NOTE: This should NOT be used directly, but is only used internally by the trace methods.
 */ function _getSpanForScope(scope) {
    return scope[SCOPE_SPAN_FIELD];
}
;
 //# sourceMappingURL=spanOnScope.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/scope.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Scope",
    ()=>Scope
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$session$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/session.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$merge$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/merge.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/misc.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/propagationContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanOnScope.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/string.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/time.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
/**
 * Default value for maximum number of breadcrumbs added to an event.
 */ const DEFAULT_MAX_BREADCRUMBS = 100;
/**
 * A context to be used for capturing an event.
 * This can either be a Scope, or a partial ScopeContext,
 * or a callback that receives the current scope and returns a new scope to use.
 */ /**
 * Holds additional event information.
 */ class Scope {
    /** Flag if notifying is happening. */ /** Callback for client to receive scope changes. */ /** Callback list that will be called during event processing. */ /** Array of breadcrumbs. */ /** User */ /** Tags */ /** Attributes */ /** Extra */ /** Contexts */ /** Attachments */ /** Propagation Context for distributed tracing */ /**
   * A place to stash data which is needed at some point in the SDK's event processing pipeline but which shouldn't get
   * sent to Sentry
   */ /** Fingerprint */ /** Severity */ /**
   * Transaction Name
   *
   * IMPORTANT: The transaction name on the scope has nothing to do with root spans/transaction objects.
   * It's purpose is to assign a transaction to the scope that's added to non-transaction events.
   */ /** Session */ /** The client on this scope */ /** Contains the last event id of a captured event.  */ /** Conversation ID */ // NOTE: Any field which gets added here should get added not only to the constructor but also to the `clone` method.
    constructor(){
        this._notifyingListeners = false;
        this._scopeListeners = [];
        this._eventProcessors = [];
        this._breadcrumbs = [];
        this._attachments = [];
        this._user = {};
        this._tags = {};
        this._attributes = {};
        this._extra = {};
        this._contexts = {};
        this._sdkProcessingMetadata = {};
        this._propagationContext = {
            traceId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceId"])(),
            sampleRand: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeMathRandom"])()
        };
    }
    /**
   * Clone all data from this scope into a new scope.
   */ clone() {
        const newScope = new Scope();
        newScope._breadcrumbs = [
            ...this._breadcrumbs
        ];
        newScope._tags = {
            ...this._tags
        };
        newScope._attributes = {
            ...this._attributes
        };
        newScope._extra = {
            ...this._extra
        };
        newScope._contexts = {
            ...this._contexts
        };
        if (this._contexts.flags) {
            // We need to copy the `values` array so insertions on a cloned scope
            // won't affect the original array.
            newScope._contexts.flags = {
                values: [
                    ...this._contexts.flags.values
                ]
            };
        }
        newScope._user = this._user;
        newScope._level = this._level;
        newScope._session = this._session;
        newScope._transactionName = this._transactionName;
        newScope._fingerprint = this._fingerprint;
        newScope._eventProcessors = [
            ...this._eventProcessors
        ];
        newScope._attachments = [
            ...this._attachments
        ];
        newScope._sdkProcessingMetadata = {
            ...this._sdkProcessingMetadata
        };
        newScope._propagationContext = {
            ...this._propagationContext
        };
        newScope._client = this._client;
        newScope._lastEventId = this._lastEventId;
        newScope._conversationId = this._conversationId;
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_setSpanForScope"])(newScope, (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_getSpanForScope"])(this));
        return newScope;
    }
    /**
   * Update the client assigned to this scope.
   * Note that not every scope will have a client assigned - isolation scopes & the global scope will generally not have a client,
   * as well as manually created scopes.
   */ setClient(client) {
        this._client = client;
    }
    /**
   * Set the ID of the last captured error event.
   * This is generally only captured on the isolation scope.
   */ setLastEventId(lastEventId) {
        this._lastEventId = lastEventId;
    }
    /**
   * Get the client assigned to this scope.
   */ getClient() {
        return this._client;
    }
    /**
   * Get the ID of the last captured error event.
   * This is generally only available on the isolation scope.
   */ lastEventId() {
        return this._lastEventId;
    }
    /**
   * @inheritDoc
   */ addScopeListener(callback) {
        this._scopeListeners.push(callback);
    }
    /**
   * Add an event processor that will be called before an event is sent.
   */ addEventProcessor(callback) {
        this._eventProcessors.push(callback);
        return this;
    }
    /**
   * Set the user for this scope.
   * Set to `null` to unset the user.
   */ setUser(user) {
        // If null is passed we want to unset everything, but still define keys,
        // so that later down in the pipeline any existing values are cleared.
        this._user = user || {
            email: undefined,
            id: undefined,
            ip_address: undefined,
            username: undefined
        };
        if (this._session) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$session$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["updateSession"])(this._session, {
                user
            });
        }
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Get the user from this scope.
   */ getUser() {
        return this._user;
    }
    /**
   * Set the conversation ID for this scope.
   * Set to `null` to unset the conversation ID.
   */ setConversationId(conversationId) {
        this._conversationId = conversationId || undefined;
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Set an object that will be merged into existing tags on the scope,
   * and will be sent as tags data with the event.
   */ setTags(tags) {
        this._tags = {
            ...this._tags,
            ...tags
        };
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Set a single tag that will be sent as tags data with the event.
   */ setTag(key, value) {
        return this.setTags({
            [key]: value
        });
    }
    /**
   * Sets attributes onto the scope.
   *
   * These attributes are currently applied to logs and metrics.
   * In the future, they will also be applied to spans.
   *
   * Important: For now, only strings, numbers and boolean attributes are supported, despite types allowing for
   * more complex attribute types. We'll add this support in the future but already specify the wider type to
   * avoid a breaking change in the future.
   *
   * @param newAttributes - The attributes to set on the scope. You can either pass in key-value pairs, or
   * an object with a `value` and an optional `unit` (if applicable to your attribute).
   *
   * @example
   * ```typescript
   * scope.setAttributes({
   *   is_admin: true,
   *   payment_selection: 'credit_card',
   *   render_duration: { value: 'render_duration', unit: 'ms' },
   * });
   * ```
   */ setAttributes(newAttributes) {
        this._attributes = {
            ...this._attributes,
            ...newAttributes
        };
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Sets an attribute onto the scope.
   *
   * These attributes are currently applied to logs and metrics.
   * In the future, they will also be applied to spans.
   *
   * Important: For now, only strings, numbers and boolean attributes are supported, despite types allowing for
   * more complex attribute types. We'll add this support in the future but already specify the wider type to
   * avoid a breaking change in the future.
   *
   * @param key - The attribute key.
   * @param value - the attribute value. You can either pass in a raw value, or an attribute
   * object with a `value` and an optional `unit` (if applicable to your attribute).
   *
   * @example
   * ```typescript
   * scope.setAttribute('is_admin', true);
   * scope.setAttribute('render_duration', { value: 'render_duration', unit: 'ms' });
   * ```
   */ // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setAttribute(key, value) {
        return this.setAttributes({
            [key]: value
        });
    }
    /**
   * Removes the attribute with the given key from the scope.
   *
   * @param key - The attribute key.
   *
   * @example
   * ```typescript
   * scope.removeAttribute('is_admin');
   * ```
   */ removeAttribute(key) {
        if (key in this._attributes) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete this._attributes[key];
            this._notifyScopeListeners();
        }
        return this;
    }
    /**
   * Set an object that will be merged into existing extra on the scope,
   * and will be sent as extra data with the event.
   */ setExtras(extras) {
        this._extra = {
            ...this._extra,
            ...extras
        };
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Set a single key:value extra entry that will be sent as extra data with the event.
   */ setExtra(key, extra) {
        this._extra = {
            ...this._extra,
            [key]: extra
        };
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Sets the fingerprint on the scope to send with the events.
   * @param {string[]} fingerprint Fingerprint to group events in Sentry.
   */ setFingerprint(fingerprint) {
        this._fingerprint = fingerprint;
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Sets the level on the scope for future events.
   */ setLevel(level) {
        this._level = level;
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Sets the transaction name on the scope so that the name of e.g. taken server route or
   * the page location is attached to future events.
   *
   * IMPORTANT: Calling this function does NOT change the name of the currently active
   * root span. If you want to change the name of the active root span, use
   * `Sentry.updateSpanName(rootSpan, 'new name')` instead.
   *
   * By default, the SDK updates the scope's transaction name automatically on sensible
   * occasions, such as a page navigation or when handling a new request on the server.
   */ setTransactionName(name) {
        this._transactionName = name;
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Sets context data with the given name.
   * Data passed as context will be normalized. You can also pass `null` to unset the context.
   * Note that context data will not be merged - calling `setContext` will overwrite an existing context with the same key.
   */ setContext(key, context) {
        if (context === null) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete this._contexts[key];
        } else {
            this._contexts[key] = context;
        }
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Set the session for the scope.
   */ setSession(session) {
        if (!session) {
            delete this._session;
        } else {
            this._session = session;
        }
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Get the session from the scope.
   */ getSession() {
        return this._session;
    }
    /**
   * Updates the scope with provided data. Can work in three variations:
   * - plain object containing updatable attributes
   * - Scope instance that'll extract the attributes from
   * - callback function that'll receive the current scope as an argument and allow for modifications
   */ update(captureContext) {
        if (!captureContext) {
            return this;
        }
        const scopeToMerge = typeof captureContext === 'function' ? captureContext(this) : captureContext;
        const scopeInstance = scopeToMerge instanceof Scope ? scopeToMerge.getScopeData() : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isPlainObject"])(scopeToMerge) ? captureContext : undefined;
        const { tags, attributes, extra, user, contexts, level, fingerprint = [], propagationContext, conversationId } = scopeInstance || {};
        this._tags = {
            ...this._tags,
            ...tags
        };
        this._attributes = {
            ...this._attributes,
            ...attributes
        };
        this._extra = {
            ...this._extra,
            ...extra
        };
        this._contexts = {
            ...this._contexts,
            ...contexts
        };
        if (user && Object.keys(user).length) {
            this._user = user;
        }
        if (level) {
            this._level = level;
        }
        if (fingerprint.length) {
            this._fingerprint = fingerprint;
        }
        if (propagationContext) {
            this._propagationContext = propagationContext;
        }
        if (conversationId) {
            this._conversationId = conversationId;
        }
        return this;
    }
    /**
   * Clears the current scope and resets its properties.
   * Note: The client will not be cleared.
   */ clear() {
        // client is not cleared here on purpose!
        this._breadcrumbs = [];
        this._tags = {};
        this._attributes = {};
        this._extra = {};
        this._user = {};
        this._contexts = {};
        this._level = undefined;
        this._transactionName = undefined;
        this._fingerprint = undefined;
        this._session = undefined;
        this._conversationId = undefined;
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_setSpanForScope"])(this, undefined);
        this._attachments = [];
        this.setPropagationContext({
            traceId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceId"])(),
            sampleRand: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeMathRandom"])()
        });
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Adds a breadcrumb to the scope.
   * By default, the last 100 breadcrumbs are kept.
   */ addBreadcrumb(breadcrumb, maxBreadcrumbs) {
        const maxCrumbs = typeof maxBreadcrumbs === 'number' ? maxBreadcrumbs : DEFAULT_MAX_BREADCRUMBS;
        // No data has been changed, so don't notify scope listeners
        if (maxCrumbs <= 0) {
            return this;
        }
        const mergedBreadcrumb = {
            timestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dateTimestampInSeconds"])(),
            ...breadcrumb,
            // Breadcrumb messages can theoretically be infinitely large and they're held in memory so we truncate them not to leak (too much) memory
            message: breadcrumb.message ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["truncate"])(breadcrumb.message, 2048) : breadcrumb.message
        };
        this._breadcrumbs.push(mergedBreadcrumb);
        if (this._breadcrumbs.length > maxCrumbs) {
            this._breadcrumbs = this._breadcrumbs.slice(-maxCrumbs);
            this._client?.recordDroppedEvent('buffer_overflow', 'log_item');
        }
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Get the last breadcrumb of the scope.
   */ getLastBreadcrumb() {
        return this._breadcrumbs[this._breadcrumbs.length - 1];
    }
    /**
   * Clear all breadcrumbs from the scope.
   */ clearBreadcrumbs() {
        this._breadcrumbs = [];
        this._notifyScopeListeners();
        return this;
    }
    /**
   * Add an attachment to the scope.
   */ addAttachment(attachment) {
        this._attachments.push(attachment);
        return this;
    }
    /**
   * Clear all attachments from the scope.
   */ clearAttachments() {
        this._attachments = [];
        return this;
    }
    /**
   * Get the data of this scope, which should be applied to an event during processing.
   */ getScopeData() {
        return {
            breadcrumbs: this._breadcrumbs,
            attachments: this._attachments,
            contexts: this._contexts,
            tags: this._tags,
            attributes: this._attributes,
            extra: this._extra,
            user: this._user,
            level: this._level,
            fingerprint: this._fingerprint || [],
            eventProcessors: this._eventProcessors,
            propagationContext: this._propagationContext,
            sdkProcessingMetadata: this._sdkProcessingMetadata,
            transactionName: this._transactionName,
            span: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_getSpanForScope"])(this),
            conversationId: this._conversationId
        };
    }
    /**
   * Add data which will be accessible during event processing but won't get sent to Sentry.
   */ setSDKProcessingMetadata(newData) {
        this._sdkProcessingMetadata = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$merge$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["merge"])(this._sdkProcessingMetadata, newData, 2);
        return this;
    }
    /**
   * Add propagation context to the scope, used for distributed tracing
   */ setPropagationContext(context) {
        this._propagationContext = context;
        return this;
    }
    /**
   * Get propagation context from the scope, used for distributed tracing
   */ getPropagationContext() {
        return this._propagationContext;
    }
    /**
   * Capture an exception for this scope.
   *
   * @returns {string} The id of the captured Sentry event.
   */ captureException(exception, hint) {
        const eventId = hint?.event_id || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["uuid4"])();
        if (!this._client) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('No client configured on scope - will not capture exception!');
            return eventId;
        }
        const syntheticException = new Error('Sentry syntheticException');
        this._client.captureException(exception, {
            originalException: exception,
            syntheticException,
            ...hint,
            event_id: eventId
        }, this);
        return eventId;
    }
    /**
   * Capture a message for this scope.
   *
   * @returns {string} The id of the captured message.
   */ captureMessage(message, level, hint) {
        const eventId = hint?.event_id || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["uuid4"])();
        if (!this._client) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('No client configured on scope - will not capture message!');
            return eventId;
        }
        const syntheticException = hint?.syntheticException ?? new Error(message);
        this._client.captureMessage(message, level, {
            originalException: message,
            syntheticException,
            ...hint,
            event_id: eventId
        }, this);
        return eventId;
    }
    /**
   * Capture a Sentry event for this scope.
   *
   * @returns {string} The id of the captured event.
   */ captureEvent(event, hint) {
        const eventId = event.event_id || hint?.event_id || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["uuid4"])();
        if (!this._client) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('No client configured on scope - will not capture event!');
            return eventId;
        }
        this._client.captureEvent(event, {
            ...hint,
            event_id: eventId
        }, this);
        return eventId;
    }
    /**
   * This will be called on every set call.
   */ _notifyScopeListeners() {
        // We need this check for this._notifyingListeners to be able to work on scope during updates
        // If this check is not here we'll produce endless recursion when something is done with the scope
        // during the callback.
        if (!this._notifyingListeners) {
            this._notifyingListeners = true;
            this._scopeListeners.forEach((callback)=>{
                callback(this);
            });
            this._notifyingListeners = false;
        }
    }
}
;
 //# sourceMappingURL=scope.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/defaultScopes.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getDefaultCurrentScope",
    ()=>getDefaultCurrentScope,
    "getDefaultIsolationScope",
    ()=>getDefaultIsolationScope
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/carrier.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$scope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/scope.js [instrumentation-edge] (ecmascript)");
;
;
/** Get the default current scope. */ function getDefaultCurrentScope() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getGlobalSingleton"])('defaultCurrentScope', ()=>new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$scope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["Scope"]());
}
/** Get the default isolation scope. */ function getDefaultIsolationScope() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getGlobalSingleton"])('defaultIsolationScope', ()=>new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$scope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["Scope"]());
}
;
 //# sourceMappingURL=defaultScopes.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/asyncContext/stackStrategy.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AsyncContextStack",
    ()=>AsyncContextStack,
    "getStackAsyncContextStrategy",
    ()=>getStackAsyncContextStrategy
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$defaultScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/defaultScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$scope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/scope.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/carrier.js [instrumentation-edge] (ecmascript)");
;
;
;
;
/**
 * This is an object that holds a stack of scopes.
 */ class AsyncContextStack {
    constructor(scope, isolationScope){
        let assignedScope;
        if (!scope) {
            assignedScope = new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$scope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["Scope"]();
        } else {
            assignedScope = scope;
        }
        let assignedIsolationScope;
        if (!isolationScope) {
            assignedIsolationScope = new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$scope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["Scope"]();
        } else {
            assignedIsolationScope = isolationScope;
        }
        // scope stack for domains or the process
        this._stack = [
            {
                scope: assignedScope
            }
        ];
        this._isolationScope = assignedIsolationScope;
    }
    /**
   * Fork a scope for the stack.
   */ withScope(callback) {
        const scope = this._pushScope();
        let maybePromiseResult;
        try {
            maybePromiseResult = callback(scope);
        } catch (e) {
            this._popScope();
            throw e;
        }
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isThenable"])(maybePromiseResult)) {
            // @ts-expect-error - isThenable returns the wrong type
            return maybePromiseResult.then((res)=>{
                this._popScope();
                return res;
            }, (e)=>{
                this._popScope();
                throw e;
            });
        }
        this._popScope();
        return maybePromiseResult;
    }
    /**
   * Get the client of the stack.
   */ getClient() {
        return this.getStackTop().client;
    }
    /**
   * Returns the scope of the top stack.
   */ getScope() {
        return this.getStackTop().scope;
    }
    /**
   * Get the isolation scope for the stack.
   */ getIsolationScope() {
        return this._isolationScope;
    }
    /**
   * Returns the topmost scope layer in the order domain > local > process.
   */ getStackTop() {
        return this._stack[this._stack.length - 1];
    }
    /**
   * Push a scope to the stack.
   */ _pushScope() {
        // We want to clone the content of prev scope
        const scope = this.getScope().clone();
        this._stack.push({
            client: this.getClient(),
            scope
        });
        return scope;
    }
    /**
   * Pop a scope from the stack.
   */ _popScope() {
        if (this._stack.length <= 1) return false;
        return !!this._stack.pop();
    }
}
/**
 * Get the global async context stack.
 * This will be removed during the v8 cycle and is only here to make migration easier.
 */ function getAsyncContextStack() {
    const registry = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getMainCarrier"])();
    const sentry = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSentryCarrier"])(registry);
    return sentry.stack = sentry.stack || new AsyncContextStack((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$defaultScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDefaultCurrentScope"])(), (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$defaultScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDefaultIsolationScope"])());
}
function withScope(callback) {
    return getAsyncContextStack().withScope(callback);
}
function withSetScope(scope, callback) {
    const stack = getAsyncContextStack();
    return stack.withScope(()=>{
        stack.getStackTop().scope = scope;
        return callback(scope);
    });
}
function withIsolationScope(callback) {
    return getAsyncContextStack().withScope(()=>{
        return callback(getAsyncContextStack().getIsolationScope());
    });
}
/**
 * Get the stack-based async context strategy.
 */ function getStackAsyncContextStrategy() {
    return {
        withIsolationScope,
        withScope,
        withSetScope,
        withSetIsolationScope: (_isolationScope, callback)=>{
            return withIsolationScope(callback);
        },
        getCurrentScope: ()=>getAsyncContextStack().getScope(),
        getIsolationScope: ()=>getAsyncContextStack().getIsolationScope()
    };
}
;
 //# sourceMappingURL=stackStrategy.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/asyncContext/index.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getAsyncContextStrategy",
    ()=>getAsyncContextStrategy,
    "setAsyncContextStrategy",
    ()=>setAsyncContextStrategy
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/carrier.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$stackStrategy$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/asyncContext/stackStrategy.js [instrumentation-edge] (ecmascript)");
;
;
/**
 * @private Private API with no semver guarantees!
 *
 * Sets the global async context strategy
 */ function setAsyncContextStrategy(strategy) {
    // Get main carrier (global for every environment)
    const registry = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getMainCarrier"])();
    const sentry = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSentryCarrier"])(registry);
    sentry.acs = strategy;
}
/**
 * Get the current async context strategy.
 * If none has been setup, the default will be used.
 */ function getAsyncContextStrategy(carrier) {
    const sentry = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSentryCarrier"])(carrier);
    if (sentry.acs) {
        return sentry.acs;
    }
    // Otherwise, use the default one (stack)
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$stackStrategy$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getStackAsyncContextStrategy"])();
}
;
 //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getClient",
    ()=>getClient,
    "getCurrentScope",
    ()=>getCurrentScope,
    "getGlobalScope",
    ()=>getGlobalScope,
    "getIsolationScope",
    ()=>getIsolationScope,
    "getTraceContextFromScope",
    ()=>getTraceContextFromScope,
    "withIsolationScope",
    ()=>withIsolationScope,
    "withScope",
    ()=>withScope
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/asyncContext/index.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/carrier.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$scope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/scope.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/propagationContext.js [instrumentation-edge] (ecmascript)");
;
;
;
;
/**
 * Get the currently active scope.
 */ function getCurrentScope() {
    const carrier = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getMainCarrier"])();
    const acs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getAsyncContextStrategy"])(carrier);
    return acs.getCurrentScope();
}
/**
 * Get the currently active isolation scope.
 * The isolation scope is active for the current execution context.
 */ function getIsolationScope() {
    const carrier = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getMainCarrier"])();
    const acs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getAsyncContextStrategy"])(carrier);
    return acs.getIsolationScope();
}
/**
 * Get the global scope.
 * This scope is applied to _all_ events.
 */ function getGlobalScope() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getGlobalSingleton"])('globalScope', ()=>new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$scope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["Scope"]());
}
/**
 * Creates a new scope with and executes the given operation within.
 * The scope is automatically removed once the operation
 * finishes or throws.
 */ /**
 * Either creates a new active scope, or sets the given scope as active scope in the given callback.
 */ function withScope(...rest) {
    const carrier = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getMainCarrier"])();
    const acs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getAsyncContextStrategy"])(carrier);
    // If a scope is defined, we want to make this the active scope instead of the default one
    if (rest.length === 2) {
        const [scope, callback] = rest;
        if (!scope) {
            return acs.withScope(callback);
        }
        return acs.withSetScope(scope, callback);
    }
    return acs.withScope(rest[0]);
}
/**
 * Attempts to fork the current isolation scope and the current scope based on the current async context strategy. If no
 * async context strategy is set, the isolation scope and the current scope will not be forked (this is currently the
 * case, for example, in the browser).
 *
 * Usage of this function in environments without async context strategy is discouraged and may lead to unexpected behaviour.
 *
 * This function is intended for Sentry SDK and SDK integration development. It is not recommended to be used in "normal"
 * applications directly because it comes with pitfalls. Use at your own risk!
 */ /**
 * Either creates a new active isolation scope, or sets the given isolation scope as active scope in the given callback.
 */ function withIsolationScope(...rest) {
    const carrier = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getMainCarrier"])();
    const acs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getAsyncContextStrategy"])(carrier);
    // If a scope is defined, we want to make this the active scope instead of the default one
    if (rest.length === 2) {
        const [isolationScope, callback] = rest;
        if (!isolationScope) {
            return acs.withIsolationScope(callback);
        }
        return acs.withSetIsolationScope(isolationScope, callback);
    }
    return acs.withIsolationScope(rest[0]);
}
/**
 * Get the currently active client.
 */ function getClient() {
    return getCurrentScope().getClient();
}
/**
 * Get a trace context for the given scope.
 */ function getTraceContextFromScope(scope) {
    const propagationContext = scope.getPropagationContext();
    const { traceId, parentSpanId, propagationSpanId } = propagationContext;
    const traceContext = {
        trace_id: traceId,
        span_id: propagationSpanId || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateSpanId"])()
    };
    if (parentSpanId) {
        traceContext.parent_span_id = parentSpanId;
    }
    return traceContext;
}
;
 //# sourceMappingURL=currentScopes.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/request.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "extractQueryParamsFromUrl",
    ()=>extractQueryParamsFromUrl,
    "headersToDict",
    ()=>headersToDict,
    "httpHeadersToSpanAttributes",
    ()=>httpHeadersToSpanAttributes,
    "httpRequestToRequestData",
    ()=>httpRequestToRequestData,
    "winterCGHeadersToDict",
    ()=>winterCGHeadersToDict,
    "winterCGRequestToRequestData",
    ()=>winterCGRequestToRequestData
]);
/**
 * Transforms a `Headers` object that implements the `Web Fetch API` (https://developer.mozilla.org/en-US/docs/Web/API/Headers) into a simple key-value dict.
 * The header keys will be lower case: e.g. A "Content-Type" header will be stored as "content-type".
 */ function winterCGHeadersToDict(winterCGHeaders) {
    const headers = {};
    try {
        winterCGHeaders.forEach((value, key)=>{
            if (typeof value === 'string') {
                // We check that value is a string even though it might be redundant to make sure prototype pollution is not possible.
                headers[key] = value;
            }
        });
    } catch  {
    // just return the empty headers
    }
    return headers;
}
/**
 * Convert common request headers to a simple dictionary.
 */ function headersToDict(reqHeaders) {
    const headers = Object.create(null);
    try {
        Object.entries(reqHeaders).forEach(([key, value])=>{
            if (typeof value === 'string') {
                headers[key] = value;
            }
        });
    } catch  {
    // just return the empty headers
    }
    return headers;
}
/**
 * Converts a `Request` object that implements the `Web Fetch API` (https://developer.mozilla.org/en-US/docs/Web/API/Headers) into the format that the `RequestData` integration understands.
 */ function winterCGRequestToRequestData(req) {
    const headers = winterCGHeadersToDict(req.headers);
    return {
        method: req.method,
        url: req.url,
        query_string: extractQueryParamsFromUrl(req.url),
        headers
    };
}
/**
 * Convert a HTTP request object to RequestEventData to be passed as normalizedRequest.
 * Instead of allowing `PolymorphicRequest` to be passed,
 * we want to be more specific and generally require a http.IncomingMessage-like object.
 */ function httpRequestToRequestData(request) {
    const headers = request.headers || {};
    // Check for x-forwarded-host first, then fall back to host header
    const forwardedHost = typeof headers['x-forwarded-host'] === 'string' ? headers['x-forwarded-host'] : undefined;
    const host = forwardedHost || (typeof headers.host === 'string' ? headers.host : undefined);
    // Check for x-forwarded-proto first, then fall back to existing protocol detection
    const forwardedProto = typeof headers['x-forwarded-proto'] === 'string' ? headers['x-forwarded-proto'] : undefined;
    const protocol = forwardedProto || request.protocol || (request.socket?.encrypted ? 'https' : 'http');
    const url = request.url || '';
    const absoluteUrl = getAbsoluteUrl({
        url,
        host,
        protocol
    });
    // This is non-standard, but may be sometimes set
    // It may be overwritten later by our own body handling
    const data = request.body || undefined;
    // This is non-standard, but may be set on e.g. Next.js or Express requests
    const cookies = request.cookies;
    return {
        url: absoluteUrl,
        method: request.method,
        query_string: extractQueryParamsFromUrl(url),
        headers: headersToDict(headers),
        cookies,
        data
    };
}
function getAbsoluteUrl({ url, protocol, host }) {
    if (url?.startsWith('http')) {
        return url;
    }
    if (url && host) {
        return `${protocol}://${host}${url}`;
    }
    return undefined;
}
const SENSITIVE_HEADER_SNIPPETS = [
    'auth',
    'token',
    'secret',
    'session',
    'password',
    'passwd',
    'pwd',
    'key',
    'jwt',
    'bearer',
    'sso',
    'saml',
    'csrf',
    'xsrf',
    'credentials',
    // Always treat cookie headers as sensitive in case individual key-value cookie pairs cannot properly be extracted
    'set-cookie',
    'cookie'
];
const PII_HEADER_SNIPPETS = [
    'x-forwarded-',
    '-user'
];
/**
 * Converts incoming HTTP request headers to OpenTelemetry span attributes following semantic conventions.
 * Header names are converted to the format: http.request.header.<key>
 * where <key> is the header name in lowercase with dashes converted to underscores.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/registry/attributes/http/#http-request-header
 */ function httpHeadersToSpanAttributes(headers, sendDefaultPii = false) {
    const spanAttributes = {};
    try {
        Object.entries(headers).forEach(([key, value])=>{
            if (value == null) {
                return;
            }
            const lowerCasedHeaderKey = key.toLowerCase();
            const isCookieHeader = lowerCasedHeaderKey === 'cookie' || lowerCasedHeaderKey === 'set-cookie';
            if (isCookieHeader && typeof value === 'string' && value !== '') {
                // Set-Cookie: single cookie with attributes ("name=value; HttpOnly; Secure")
                // Cookie: multiple cookies separated by "; " ("cookie1=value1; cookie2=value2")
                const isSetCookie = lowerCasedHeaderKey === 'set-cookie';
                const semicolonIndex = value.indexOf(';');
                const cookieString = isSetCookie && semicolonIndex !== -1 ? value.substring(0, semicolonIndex) : value;
                const cookies = isSetCookie ? [
                    cookieString
                ] : cookieString.split('; ');
                for (const cookie of cookies){
                    // Split only at the first '=' to preserve '=' characters in cookie values
                    const equalSignIndex = cookie.indexOf('=');
                    const cookieKey = equalSignIndex !== -1 ? cookie.substring(0, equalSignIndex) : cookie;
                    const cookieValue = equalSignIndex !== -1 ? cookie.substring(equalSignIndex + 1) : '';
                    const lowerCasedCookieKey = cookieKey.toLowerCase();
                    addSpanAttribute(spanAttributes, lowerCasedHeaderKey, lowerCasedCookieKey, cookieValue, sendDefaultPii);
                }
            } else {
                addSpanAttribute(spanAttributes, lowerCasedHeaderKey, '', value, sendDefaultPii);
            }
        });
    } catch  {
    // Return empty object if there's an error
    }
    return spanAttributes;
}
function normalizeAttributeKey(key) {
    return key.replace(/-/g, '_');
}
function addSpanAttribute(spanAttributes, headerKey, cookieKey, value, sendPii) {
    const normalizedKey = cookieKey ? `http.request.header.${normalizeAttributeKey(headerKey)}.${normalizeAttributeKey(cookieKey)}` : `http.request.header.${normalizeAttributeKey(headerKey)}`;
    const headerValue = handleHttpHeader(cookieKey || headerKey, value, sendPii);
    if (headerValue !== undefined) {
        spanAttributes[normalizedKey] = headerValue;
    }
}
function handleHttpHeader(lowerCasedKey, value, sendPii) {
    const isSensitive = sendPii ? SENSITIVE_HEADER_SNIPPETS.some((snippet)=>lowerCasedKey.includes(snippet)) : [
        ...PII_HEADER_SNIPPETS,
        ...SENSITIVE_HEADER_SNIPPETS
    ].some((snippet)=>lowerCasedKey.includes(snippet));
    if (isSensitive) {
        return '[Filtered]';
    } else if (Array.isArray(value)) {
        return value.map((v)=>v != null ? String(v) : v).join(';');
    } else if (typeof value === 'string') {
        return value;
    }
    return undefined;
}
/** Extract the query params from an URL. */ function extractQueryParamsFromUrl(url) {
    // url is path and query string
    if (!url) {
        return;
    }
    try {
        // The `URL` constructor can't handle internal URLs of the form `/some/path/here`, so stick a dummy protocol and
        // hostname as the base. Since the point here is just to grab the query string, it doesn't matter what we use.
        const queryParams = new URL(url, 'http://s.io').search.slice(1);
        return queryParams.length ? queryParams : undefined;
    } catch  {
        return undefined;
    }
}
;
 //# sourceMappingURL=request.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GEN_AI_CONVERSATION_ID_ATTRIBUTE",
    ()=>GEN_AI_CONVERSATION_ID_ATTRIBUTE,
    "SEMANTIC_ATTRIBUTE_CACHE_HIT",
    ()=>SEMANTIC_ATTRIBUTE_CACHE_HIT,
    "SEMANTIC_ATTRIBUTE_CACHE_ITEM_SIZE",
    ()=>SEMANTIC_ATTRIBUTE_CACHE_ITEM_SIZE,
    "SEMANTIC_ATTRIBUTE_CACHE_KEY",
    ()=>SEMANTIC_ATTRIBUTE_CACHE_KEY,
    "SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME",
    ()=>SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME,
    "SEMANTIC_ATTRIBUTE_HTTP_REQUEST_METHOD",
    ()=>SEMANTIC_ATTRIBUTE_HTTP_REQUEST_METHOD,
    "SEMANTIC_ATTRIBUTE_PROFILE_ID",
    ()=>SEMANTIC_ATTRIBUTE_PROFILE_ID,
    "SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME",
    ()=>SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME,
    "SEMANTIC_ATTRIBUTE_SENTRY_IDLE_SPAN_FINISH_REASON",
    ()=>SEMANTIC_ATTRIBUTE_SENTRY_IDLE_SPAN_FINISH_REASON,
    "SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT",
    ()=>SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT,
    "SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE",
    ()=>SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE,
    "SEMANTIC_ATTRIBUTE_SENTRY_OP",
    ()=>SEMANTIC_ATTRIBUTE_SENTRY_OP,
    "SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN",
    ()=>SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
    "SEMANTIC_ATTRIBUTE_SENTRY_PREVIOUS_TRACE_SAMPLE_RATE",
    ()=>SEMANTIC_ATTRIBUTE_SENTRY_PREVIOUS_TRACE_SAMPLE_RATE,
    "SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE",
    ()=>SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE,
    "SEMANTIC_ATTRIBUTE_SENTRY_SOURCE",
    ()=>SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
    "SEMANTIC_ATTRIBUTE_URL_FULL",
    ()=>SEMANTIC_ATTRIBUTE_URL_FULL,
    "SEMANTIC_LINK_ATTRIBUTE_LINK_TYPE",
    ()=>SEMANTIC_LINK_ATTRIBUTE_LINK_TYPE
]);
/**
 * Use this attribute to represent the source of a span.
 * Should be one of: custom, url, route, view, component, task, unknown
 *
 */ const SEMANTIC_ATTRIBUTE_SENTRY_SOURCE = 'sentry.source';
/**
 * Attributes that holds the sample rate that was locally applied to a span.
 * If this attribute is not defined, it means that the span inherited a sampling decision.
 *
 * NOTE: Is only defined on root spans.
 */ const SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE = 'sentry.sample_rate';
/**
 * Attribute holding the sample rate of the previous trace.
 * This is used to sample consistently across subsequent traces in the browser SDK.
 *
 * Note: Only defined on root spans, if opted into consistent sampling
 */ const SEMANTIC_ATTRIBUTE_SENTRY_PREVIOUS_TRACE_SAMPLE_RATE = 'sentry.previous_trace_sample_rate';
/**
 * Use this attribute to represent the operation of a span.
 */ const SEMANTIC_ATTRIBUTE_SENTRY_OP = 'sentry.op';
/**
 * Use this attribute to represent the origin of a span.
 */ const SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN = 'sentry.origin';
/** The reason why an idle span finished. */ const SEMANTIC_ATTRIBUTE_SENTRY_IDLE_SPAN_FINISH_REASON = 'sentry.idle_span_finish_reason';
/** The unit of a measurement, which may be stored as a TimedEvent. */ const SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT = 'sentry.measurement_unit';
/** The value of a measurement, which may be stored as a TimedEvent. */ const SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE = 'sentry.measurement_value';
/**
 * A custom span name set by users guaranteed to be taken over any automatically
 * inferred name. This attribute is removed before the span is sent.
 *
 * @internal only meant for internal SDK usage
 * @hidden
 */ const SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME = 'sentry.custom_span_name';
/**
 * The id of the profile that this span occurred in.
 */ const SEMANTIC_ATTRIBUTE_PROFILE_ID = 'sentry.profile_id';
const SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME = 'sentry.exclusive_time';
const SEMANTIC_ATTRIBUTE_CACHE_HIT = 'cache.hit';
const SEMANTIC_ATTRIBUTE_CACHE_KEY = 'cache.key';
const SEMANTIC_ATTRIBUTE_CACHE_ITEM_SIZE = 'cache.item_size';
/** TODO: Remove these once we update to latest semantic conventions */ const SEMANTIC_ATTRIBUTE_HTTP_REQUEST_METHOD = 'http.request.method';
const SEMANTIC_ATTRIBUTE_URL_FULL = 'url.full';
/**
 * A span link attribute to mark the link as a special span link.
 *
 * Known values:
 * - `previous_trace`: The span links to the frontend root span of the previous trace.
 * - `next_trace`: The span links to the frontend root span of the next trace. (Not set by the SDK)
 *
 * Other values may be set as appropriate.
 * @see https://develop.sentry.dev/sdk/telemetry/traces/span-links/#link-types
 */ const SEMANTIC_LINK_ATTRIBUTE_LINK_TYPE = 'sentry.link.type';
/**
 * =============================================================================
 * GEN AI ATTRIBUTES
 * Based on OpenTelemetry Semantic Conventions for Generative AI
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 * =============================================================================
 */ /**
 * The conversation ID for linking messages across API calls.
 * For OpenAI Assistants API: thread_id
 * For LangGraph: configurable.thread_id
 */ const GEN_AI_CONVERSATION_ID_ATTRIBUTE = 'gen_ai.conversation.id';
;
 //# sourceMappingURL=semanticAttributes.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/baggage.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "MAX_BAGGAGE_STRING_LENGTH",
    ()=>MAX_BAGGAGE_STRING_LENGTH,
    "SENTRY_BAGGAGE_KEY_PREFIX",
    ()=>SENTRY_BAGGAGE_KEY_PREFIX,
    "SENTRY_BAGGAGE_KEY_PREFIX_REGEX",
    ()=>SENTRY_BAGGAGE_KEY_PREFIX_REGEX,
    "baggageHeaderToDynamicSamplingContext",
    ()=>baggageHeaderToDynamicSamplingContext,
    "dynamicSamplingContextToSentryBaggageHeader",
    ()=>dynamicSamplingContextToSentryBaggageHeader,
    "objectToBaggageHeader",
    ()=>objectToBaggageHeader,
    "parseBaggageHeader",
    ()=>parseBaggageHeader
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
;
;
;
const SENTRY_BAGGAGE_KEY_PREFIX = 'sentry-';
const SENTRY_BAGGAGE_KEY_PREFIX_REGEX = /^sentry-/;
/**
 * Max length of a serialized baggage string
 *
 * https://www.w3.org/TR/baggage/#limits
 */ const MAX_BAGGAGE_STRING_LENGTH = 8192;
/**
 * Takes a baggage header and turns it into Dynamic Sampling Context, by extracting all the "sentry-" prefixed values
 * from it.
 *
 * @param baggageHeader A very bread definition of a baggage header as it might appear in various frameworks.
 * @returns The Dynamic Sampling Context that was found on `baggageHeader`, if there was any, `undefined` otherwise.
 */ function baggageHeaderToDynamicSamplingContext(// Very liberal definition of what any incoming header might look like
baggageHeader) {
    const baggageObject = parseBaggageHeader(baggageHeader);
    if (!baggageObject) {
        return undefined;
    }
    // Read all "sentry-" prefixed values out of the baggage object and put it onto a dynamic sampling context object.
    const dynamicSamplingContext = Object.entries(baggageObject).reduce((acc, [key, value])=>{
        if (key.match(SENTRY_BAGGAGE_KEY_PREFIX_REGEX)) {
            const nonPrefixedKey = key.slice(SENTRY_BAGGAGE_KEY_PREFIX.length);
            acc[nonPrefixedKey] = value;
        }
        return acc;
    }, {});
    // Only return a dynamic sampling context object if there are keys in it.
    // A keyless object means there were no sentry values on the header, which means that there is no DSC.
    if (Object.keys(dynamicSamplingContext).length > 0) {
        return dynamicSamplingContext;
    } else {
        return undefined;
    }
}
/**
 * Turns a Dynamic Sampling Object into a baggage header by prefixing all the keys on the object with "sentry-".
 *
 * @param dynamicSamplingContext The Dynamic Sampling Context to turn into a header. For convenience and compatibility
 * with the `getDynamicSamplingContext` method on the Transaction class ,this argument can also be `undefined`. If it is
 * `undefined` the function will return `undefined`.
 * @returns a baggage header, created from `dynamicSamplingContext`, or `undefined` either if `dynamicSamplingContext`
 * was `undefined`, or if `dynamicSamplingContext` didn't contain any values.
 */ function dynamicSamplingContextToSentryBaggageHeader(// this also takes undefined for convenience and bundle size in other places
dynamicSamplingContext) {
    if (!dynamicSamplingContext) {
        return undefined;
    }
    // Prefix all DSC keys with "sentry-" and put them into a new object
    const sentryPrefixedDSC = Object.entries(dynamicSamplingContext).reduce((acc, [dscKey, dscValue])=>{
        if (dscValue) {
            acc[`${SENTRY_BAGGAGE_KEY_PREFIX}${dscKey}`] = dscValue;
        }
        return acc;
    }, {});
    return objectToBaggageHeader(sentryPrefixedDSC);
}
/**
 * Take a baggage header and parse it into an object.
 */ function parseBaggageHeader(baggageHeader) {
    if (!baggageHeader || !(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isString"])(baggageHeader) && !Array.isArray(baggageHeader)) {
        return undefined;
    }
    if (Array.isArray(baggageHeader)) {
        // Combine all baggage headers into one object containing the baggage values so we can later read the Sentry-DSC-values from it
        return baggageHeader.reduce((acc, curr)=>{
            const currBaggageObject = baggageHeaderToObject(curr);
            Object.entries(currBaggageObject).forEach(([key, value])=>{
                acc[key] = value;
            });
            return acc;
        }, {});
    }
    return baggageHeaderToObject(baggageHeader);
}
/**
 * Will parse a baggage header, which is a simple key-value map, into a flat object.
 *
 * @param baggageHeader The baggage header to parse.
 * @returns a flat object containing all the key-value pairs from `baggageHeader`.
 */ function baggageHeaderToObject(baggageHeader) {
    return baggageHeader.split(',').map((baggageEntry)=>{
        const eqIdx = baggageEntry.indexOf('=');
        if (eqIdx === -1) {
            // Likely an invalid entry
            return [];
        }
        const key = baggageEntry.slice(0, eqIdx);
        const value = baggageEntry.slice(eqIdx + 1);
        return [
            key,
            value
        ].map((keyOrValue)=>{
            try {
                return decodeURIComponent(keyOrValue.trim());
            } catch  {
                // We ignore errors here, e.g. if the value cannot be URL decoded.
                // This will then be skipped in the next step
                return;
            }
        });
    }).reduce((acc, [key, value])=>{
        if (key && value) {
            acc[key] = value;
        }
        return acc;
    }, {});
}
/**
 * Turns a flat object (key-value pairs) into a baggage header, which is also just key-value pairs.
 *
 * @param object The object to turn into a baggage header.
 * @returns a baggage header string, or `undefined` if the object didn't have any values, since an empty baggage header
 * is not spec compliant.
 */ function objectToBaggageHeader(object) {
    if (Object.keys(object).length === 0) {
        // An empty baggage header is not spec compliant: We return undefined.
        return undefined;
    }
    return Object.entries(object).reduce((baggageHeader, [objectKey, objectValue], currentIndex)=>{
        const baggageEntry = `${encodeURIComponent(objectKey)}=${encodeURIComponent(objectValue)}`;
        const newBaggageHeader = currentIndex === 0 ? baggageEntry : `${baggageHeader},${baggageEntry}`;
        if (newBaggageHeader.length > MAX_BAGGAGE_STRING_LENGTH) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(`Not adding key: ${objectKey} with val: ${objectValue} to baggage header due to exceeding baggage size limits.`);
            return baggageHeader;
        } else {
            return newBaggageHeader;
        }
    }, '');
}
;
 //# sourceMappingURL=baggage.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/handleCallbackErrors.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "handleCallbackErrors",
    ()=>handleCallbackErrors
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
;
/* eslint-disable */ // Vendor "Awaited" in to be TS 3.8 compatible
/**
 * Wrap a callback function with error handling.
 * If an error is thrown, it will be passed to the `onError` callback and re-thrown.
 *
 * If the return value of the function is a promise, it will be handled with `maybeHandlePromiseRejection`.
 *
 * If an `onFinally` callback is provided, this will be called when the callback has finished
 * - so if it returns a promise, once the promise resolved/rejected,
 * else once the callback has finished executing.
 * The `onFinally` callback will _always_ be called, no matter if an error was thrown or not.
 */ function handleCallbackErrors(fn, onError, onFinally = ()=>{}, onSuccess = ()=>{}) {
    let maybePromiseResult;
    try {
        maybePromiseResult = fn();
    } catch (e) {
        onError(e);
        onFinally();
        throw e;
    }
    return maybeHandlePromiseRejection(maybePromiseResult, onError, onFinally, onSuccess);
}
/**
 * Maybe handle a promise rejection.
 * This expects to be given a value that _may_ be a promise, or any other value.
 * If it is a promise, and it rejects, it will call the `onError` callback.
 * Other than this, it will generally return the given value as-is.
 */ function maybeHandlePromiseRejection(value, onError, onFinally, onSuccess) {
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isThenable"])(value)) {
        // @ts-expect-error - the isThenable check returns the "wrong" type here
        return value.then((res)=>{
            onFinally();
            onSuccess(res);
            return res;
        }, (e)=>{
            onError(e);
            onFinally();
            throw e;
        });
    }
    onFinally();
    onSuccess(value);
    return value;
}
;
 //# sourceMappingURL=handleCallbackErrors.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/hasSpansEnabled.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "hasSpansEnabled",
    ()=>hasSpansEnabled
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
;
// Treeshakable guard to remove all code related to tracing
/**
 * Determines if span recording is currently enabled.
 *
 * Spans are recorded when at least one of `tracesSampleRate` and `tracesSampler`
 * is defined in the SDK config. This function does not make any assumption about
 * sampling decisions, it only checks if the SDK is configured to record spans.
 *
 * Important: This function only determines if span recording is enabled. Trace
 * continuation and propagation is separately controlled and not covered by this function.
 * If this function returns `false`, traces can still be propagated (which is what
 * we refer to by "Tracing without Performance")
 * @see https://develop.sentry.dev/sdk/telemetry/traces/tracing-without-performance/
 *
 * @param maybeOptions An SDK options object to be passed to this function.
 * If this option is not provided, the function will use the current client's options.
 */ function hasSpansEnabled(maybeOptions) {
    if (typeof __SENTRY_TRACING__ === 'boolean' && !__SENTRY_TRACING__) {
        return false;
    }
    const options = maybeOptions || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])()?.getOptions();
    return !!options && // Note: This check is `!= null`, meaning "nullish". `0` is not "nullish", `undefined` and `null` are. (This comment was brought to you by 15 minutes of questioning life)
    (options.tracesSampleRate != null || !!options.tracesSampler);
}
;
 //# sourceMappingURL=hasSpansEnabled.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/parseSampleRate.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "parseSampleRate",
    ()=>parseSampleRate
]);
/**
 * Parse a sample rate from a given value.
 * This will either return a boolean or number sample rate, if the sample rate is valid (between 0 and 1).
 * If a string is passed, we try to convert it to a number.
 *
 * Any invalid sample rate will return `undefined`.
 */ function parseSampleRate(sampleRate) {
    if (typeof sampleRate === 'boolean') {
        return Number(sampleRate);
    }
    const rate = typeof sampleRate === 'string' ? parseFloat(sampleRate) : sampleRate;
    if (typeof rate !== 'number' || isNaN(rate) || rate < 0 || rate > 1) {
        return undefined;
    }
    return rate;
}
;
 //# sourceMappingURL=parseSampleRate.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/spanstatus.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SPAN_STATUS_ERROR",
    ()=>SPAN_STATUS_ERROR,
    "SPAN_STATUS_OK",
    ()=>SPAN_STATUS_OK,
    "SPAN_STATUS_UNSET",
    ()=>SPAN_STATUS_UNSET,
    "getSpanStatusFromHttpCode",
    ()=>getSpanStatusFromHttpCode,
    "setHttpStatus",
    ()=>setHttpStatus
]);
const SPAN_STATUS_UNSET = 0;
const SPAN_STATUS_OK = 1;
const SPAN_STATUS_ERROR = 2;
/**
 * Converts a HTTP status code into a sentry status with a message.
 *
 * @param httpStatus The HTTP response status code.
 * @returns The span status or internal_error.
 */ // https://develop.sentry.dev/sdk/event-payloads/span/
function getSpanStatusFromHttpCode(httpStatus) {
    if (httpStatus < 400 && httpStatus >= 100) {
        return {
            code: SPAN_STATUS_OK
        };
    }
    if (httpStatus >= 400 && httpStatus < 500) {
        switch(httpStatus){
            case 401:
                return {
                    code: SPAN_STATUS_ERROR,
                    message: 'unauthenticated'
                };
            case 403:
                return {
                    code: SPAN_STATUS_ERROR,
                    message: 'permission_denied'
                };
            case 404:
                return {
                    code: SPAN_STATUS_ERROR,
                    message: 'not_found'
                };
            case 409:
                return {
                    code: SPAN_STATUS_ERROR,
                    message: 'already_exists'
                };
            case 413:
                return {
                    code: SPAN_STATUS_ERROR,
                    message: 'failed_precondition'
                };
            case 429:
                return {
                    code: SPAN_STATUS_ERROR,
                    message: 'resource_exhausted'
                };
            case 499:
                return {
                    code: SPAN_STATUS_ERROR,
                    message: 'cancelled'
                };
            default:
                return {
                    code: SPAN_STATUS_ERROR,
                    message: 'invalid_argument'
                };
        }
    }
    if (httpStatus >= 500 && httpStatus < 600) {
        switch(httpStatus){
            case 501:
                return {
                    code: SPAN_STATUS_ERROR,
                    message: 'unimplemented'
                };
            case 503:
                return {
                    code: SPAN_STATUS_ERROR,
                    message: 'unavailable'
                };
            case 504:
                return {
                    code: SPAN_STATUS_ERROR,
                    message: 'deadline_exceeded'
                };
            default:
                return {
                    code: SPAN_STATUS_ERROR,
                    message: 'internal_error'
                };
        }
    }
    return {
        code: SPAN_STATUS_ERROR,
        message: 'internal_error'
    };
}
/**
 * Sets the Http status attributes on the current span based on the http code.
 * Additionally, the span's status is updated, depending on the http code.
 */ function setHttpStatus(span, httpStatus) {
    span.setAttribute('http.response.status_code', httpStatus);
    const spanStatus = getSpanStatusFromHttpCode(httpStatus);
    if (spanStatus.message !== 'unknown_error') {
        span.setStatus(spanStatus);
    }
}
;
 //# sourceMappingURL=spanstatus.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/utils.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getCapturedScopesOnSpan",
    ()=>getCapturedScopesOnSpan,
    "setCapturedScopesOnSpan",
    ()=>setCapturedScopesOnSpan
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/object.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
;
const SCOPE_ON_START_SPAN_FIELD = '_sentryScope';
const ISOLATION_SCOPE_ON_START_SPAN_FIELD = '_sentryIsolationScope';
/** Wrap a scope with a WeakRef if available, falling back to a direct scope. */ function wrapScopeWithWeakRef(scope) {
    try {
        // @ts-expect-error - WeakRef is not available in all environments
        const WeakRefClass = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].WeakRef;
        if (typeof WeakRefClass === 'function') {
            return new WeakRefClass(scope);
        }
    } catch  {
    // WeakRef not available or failed to create
    // We'll fall back to a direct scope
    }
    return scope;
}
/** Try to unwrap a scope from a potential WeakRef wrapper. */ function unwrapScopeFromWeakRef(scopeRef) {
    if (!scopeRef) {
        return undefined;
    }
    if (typeof scopeRef === 'object' && 'deref' in scopeRef && typeof scopeRef.deref === 'function') {
        try {
            return scopeRef.deref();
        } catch  {
            return undefined;
        }
    }
    // Fallback to a direct scope
    return scopeRef;
}
/** Store the scope & isolation scope for a span, which can the be used when it is finished. */ function setCapturedScopesOnSpan(span, scope, isolationScope) {
    if (span) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addNonEnumerableProperty"])(span, ISOLATION_SCOPE_ON_START_SPAN_FIELD, wrapScopeWithWeakRef(isolationScope));
        // We don't wrap the scope with a WeakRef here because webkit aggressively garbage collects
        // and scopes are not held in memory for long periods of time.
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addNonEnumerableProperty"])(span, SCOPE_ON_START_SPAN_FIELD, scope);
    }
}
/**
 * Grabs the scope and isolation scope off a span that were active when the span was started.
 * If WeakRef was used and scopes have been garbage collected, returns undefined for those scopes.
 */ function getCapturedScopesOnSpan(span) {
    const spanWithScopes = span;
    return {
        scope: spanWithScopes[SCOPE_ON_START_SPAN_FIELD],
        isolationScope: unwrapScopeFromWeakRef(spanWithScopes[ISOLATION_SCOPE_ON_START_SPAN_FIELD])
    };
}
;
 //# sourceMappingURL=utils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/dsn.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "dsnFromString",
    ()=>dsnFromString,
    "dsnToString",
    ()=>dsnToString,
    "extractOrgIdFromClient",
    ()=>extractOrgIdFromClient,
    "extractOrgIdFromDsnHost",
    ()=>extractOrgIdFromDsnHost,
    "makeDsn",
    ()=>makeDsn
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
;
;
/** Regular expression used to extract org ID from a DSN host. */ const ORG_ID_REGEX = /^o(\d+)\./;
/** Regular expression used to parse a Dsn. */ const DSN_REGEX = /^(?:(\w+):)\/\/(?:(\w+)(?::(\w+)?)?@)((?:\[[:.%\w]+\]|[\w.-]+))(?::(\d+))?\/(.+)/;
function isValidProtocol(protocol) {
    return protocol === 'http' || protocol === 'https';
}
/**
 * Renders the string representation of this Dsn.
 *
 * By default, this will render the public representation without the password
 * component. To get the deprecated private representation, set `withPassword`
 * to true.
 *
 * @param withPassword When set to true, the password will be included.
 */ function dsnToString(dsn, withPassword = false) {
    const { host, path, pass, port, projectId, protocol, publicKey } = dsn;
    return `${protocol}://${publicKey}${withPassword && pass ? `:${pass}` : ''}` + `@${host}${port ? `:${port}` : ''}/${path ? `${path}/` : path}${projectId}`;
}
/**
 * Parses a Dsn from a given string.
 *
 * @param str A Dsn as string
 * @returns Dsn as DsnComponents or undefined if @param str is not a valid DSN string
 */ function dsnFromString(str) {
    const match = DSN_REGEX.exec(str);
    if (!match) {
        // This should be logged to the console
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["consoleSandbox"])(()=>{
            // eslint-disable-next-line no-console
            console.error(`Invalid Sentry Dsn: ${str}`);
        });
        return undefined;
    }
    const [protocol, publicKey, pass = '', host = '', port = '', lastPath = ''] = match.slice(1);
    let path = '';
    let projectId = lastPath;
    const split = projectId.split('/');
    if (split.length > 1) {
        path = split.slice(0, -1).join('/');
        projectId = split.pop();
    }
    if (projectId) {
        const projectMatch = projectId.match(/^\d+/);
        if (projectMatch) {
            projectId = projectMatch[0];
        }
    }
    return dsnFromComponents({
        host,
        pass,
        path,
        projectId,
        port,
        protocol: protocol,
        publicKey
    });
}
function dsnFromComponents(components) {
    return {
        protocol: components.protocol,
        publicKey: components.publicKey || '',
        pass: components.pass || '',
        host: components.host,
        port: components.port || '',
        path: components.path || '',
        projectId: components.projectId
    };
}
function validateDsn(dsn) {
    if (!__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"]) {
        return true;
    }
    const { port, projectId, protocol } = dsn;
    const requiredComponents = [
        'protocol',
        'publicKey',
        'host',
        'projectId'
    ];
    const hasMissingRequiredComponent = requiredComponents.find((component)=>{
        if (!dsn[component]) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error(`Invalid Sentry Dsn: ${component} missing`);
            return true;
        }
        return false;
    });
    if (hasMissingRequiredComponent) {
        return false;
    }
    if (!projectId.match(/^\d+$/)) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error(`Invalid Sentry Dsn: Invalid projectId ${projectId}`);
        return false;
    }
    if (!isValidProtocol(protocol)) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error(`Invalid Sentry Dsn: Invalid protocol ${protocol}`);
        return false;
    }
    if (port && isNaN(parseInt(port, 10))) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error(`Invalid Sentry Dsn: Invalid port ${port}`);
        return false;
    }
    return true;
}
/**
 * Extract the org ID from a DSN host.
 *
 * @param host The host from a DSN
 * @returns The org ID if found, undefined otherwise
 */ function extractOrgIdFromDsnHost(host) {
    const match = host.match(ORG_ID_REGEX);
    return match?.[1];
}
/**
 *  Returns the organization ID of the client.
 *
 *  The organization ID is extracted from the DSN. If the client options include a `orgId`, this will always take precedence.
 */ function extractOrgIdFromClient(client) {
    const options = client.getOptions();
    const { host } = client.getDsn() || {};
    let org_id;
    if (options.orgId) {
        org_id = String(options.orgId);
    } else if (host) {
        org_id = extractOrgIdFromDsnHost(host);
    }
    return org_id;
}
/**
 * Creates a valid Sentry Dsn object, identifying a Sentry instance and project.
 * @returns a valid DsnComponents object or `undefined` if @param from is an invalid DSN source
 */ function makeDsn(from) {
    const components = typeof from === 'string' ? dsnFromString(from) : dsnFromComponents(from);
    if (!components || !validateDsn(components)) {
        return undefined;
    }
    return components;
}
;
 //# sourceMappingURL=dsn.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/tracing.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "TRACEPARENT_REGEXP",
    ()=>TRACEPARENT_REGEXP,
    "extractTraceparentData",
    ()=>extractTraceparentData,
    "generateSentryTraceHeader",
    ()=>generateSentryTraceHeader,
    "generateTraceparentHeader",
    ()=>generateTraceparentHeader,
    "propagationContextFromHeaders",
    ()=>propagationContextFromHeaders,
    "shouldContinueTrace",
    ()=>shouldContinueTrace
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/baggage.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/dsn.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/parseSampleRate.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/propagationContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
// eslint-disable-next-line @sentry-internal/sdk/no-regexp-constructor -- RegExp is used for readability here
const TRACEPARENT_REGEXP = new RegExp('^[ \\t]*' + // whitespace
'([0-9a-f]{32})?' + // trace_id
'-?([0-9a-f]{16})?' + // span_id
'-?([01])?' + // sampled
'[ \\t]*$');
/**
 * Extract transaction context data from a `sentry-trace` header.
 *
 * This is terrible naming but the function has nothing to do with the W3C traceparent header.
 * It can only parse the `sentry-trace` header and extract the "trace parent" data.
 *
 * @param traceparent Traceparent string
 *
 * @returns Object containing data from the header, or undefined if traceparent string is malformed
 */ function extractTraceparentData(traceparent) {
    if (!traceparent) {
        return undefined;
    }
    const matches = traceparent.match(TRACEPARENT_REGEXP);
    if (!matches) {
        return undefined;
    }
    let parentSampled;
    if (matches[3] === '1') {
        parentSampled = true;
    } else if (matches[3] === '0') {
        parentSampled = false;
    }
    return {
        traceId: matches[1],
        parentSampled,
        parentSpanId: matches[2]
    };
}
/**
 * Create a propagation context from incoming headers or
 * creates a minimal new one if the headers are undefined.
 */ function propagationContextFromHeaders(sentryTrace, baggage) {
    const traceparentData = extractTraceparentData(sentryTrace);
    const dynamicSamplingContext = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["baggageHeaderToDynamicSamplingContext"])(baggage);
    if (!traceparentData?.traceId) {
        return {
            traceId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceId"])(),
            sampleRand: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeMathRandom"])()
        };
    }
    const sampleRand = getSampleRandFromTraceparentAndDsc(traceparentData, dynamicSamplingContext);
    // The sample_rand on the DSC needs to be generated based on traceparent + baggage.
    if (dynamicSamplingContext) {
        dynamicSamplingContext.sample_rand = sampleRand.toString();
    }
    const { traceId, parentSpanId, parentSampled } = traceparentData;
    return {
        traceId,
        parentSpanId,
        sampled: parentSampled,
        dsc: dynamicSamplingContext || {},
        sampleRand
    };
}
/**
 * Create sentry-trace header from span context values.
 */ function generateSentryTraceHeader(traceId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceId"])(), spanId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateSpanId"])(), sampled) {
    let sampledString = '';
    if (sampled !== undefined) {
        sampledString = sampled ? '-1' : '-0';
    }
    return `${traceId}-${spanId}${sampledString}`;
}
/**
 * Creates a W3C traceparent header from the given trace and span ids.
 */ function generateTraceparentHeader(traceId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceId"])(), spanId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateSpanId"])(), sampled) {
    return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}
/**
 * Given any combination of an incoming trace, generate a sample rand based on its defined semantics.
 *
 * Read more: https://develop.sentry.dev/sdk/telemetry/traces/#propagated-random-value
 */ function getSampleRandFromTraceparentAndDsc(traceparentData, dsc) {
    // When there is an incoming sample rand use it.
    const parsedSampleRand = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseSampleRate"])(dsc?.sample_rand);
    if (parsedSampleRand !== undefined) {
        return parsedSampleRand;
    }
    // Otherwise, if there is an incoming sampling decision + sample rate, generate a sample rand that would lead to the same sampling decision.
    const parsedSampleRate = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseSampleRate"])(dsc?.sample_rate);
    if (parsedSampleRate && traceparentData?.parentSampled !== undefined) {
        return traceparentData.parentSampled ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeMathRandom"])() * parsedSampleRate : parsedSampleRate + (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeMathRandom"])() * (1 - parsedSampleRate);
    } else {
        // If nothing applies, return a random sample rand.
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeMathRandom"])();
    }
}
/**
 * Determines whether a new trace should be continued based on the provided baggage org ID and the client's `strictTraceContinuation` option.
 * If the trace should not be continued, a new trace will be started.
 *
 * The result is dependent on the `strictTraceContinuation` option in the client.
 * See https://develop.sentry.dev/sdk/telemetry/traces/#stricttracecontinuation
 */ function shouldContinueTrace(client, baggageOrgId) {
    const clientOrgId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["extractOrgIdFromClient"])(client);
    // Case: baggage orgID and Client orgID don't match - always start new trace
    if (baggageOrgId && clientOrgId && baggageOrgId !== clientOrgId) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`Won't continue trace because org IDs don't match (incoming baggage: ${baggageOrgId}, SDK options: ${clientOrgId})`);
        return false;
    }
    const strictTraceContinuation = client.getOptions().strictTraceContinuation || false; // default for `strictTraceContinuation` is `false`
    if (strictTraceContinuation) {
        // With strict continuation enabled, don't continue trace if:
        // - Baggage has orgID, but Client doesn't have one
        // - Client has orgID, but baggage doesn't have one
        if (baggageOrgId && !clientOrgId || !baggageOrgId && clientOrgId) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`Starting a new trace because strict trace continuation is enabled but one org ID is missing (incoming baggage: ${baggageOrgId}, Sentry client: ${clientOrgId})`);
            return false;
        }
    }
    return true;
}
;
 //# sourceMappingURL=tracing.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "TRACE_FLAG_NONE",
    ()=>TRACE_FLAG_NONE,
    "TRACE_FLAG_SAMPLED",
    ()=>TRACE_FLAG_SAMPLED,
    "addChildSpanToSpan",
    ()=>addChildSpanToSpan,
    "convertSpanLinksForEnvelope",
    ()=>convertSpanLinksForEnvelope,
    "getActiveSpan",
    ()=>getActiveSpan,
    "getRootSpan",
    ()=>getRootSpan,
    "getSpanDescendants",
    ()=>getSpanDescendants,
    "getStatusMessage",
    ()=>getStatusMessage,
    "removeChildSpanFromSpan",
    ()=>removeChildSpanFromSpan,
    "showSpanDropWarning",
    ()=>showSpanDropWarning,
    "spanIsSampled",
    ()=>spanIsSampled,
    "spanTimeInputToSeconds",
    ()=>spanTimeInputToSeconds,
    "spanToJSON",
    ()=>spanToJSON,
    "spanToTraceContext",
    ()=>spanToTraceContext,
    "spanToTraceHeader",
    ()=>spanToTraceHeader,
    "spanToTraceparentHeader",
    ()=>spanToTraceparentHeader,
    "spanToTransactionTraceContext",
    ()=>spanToTransactionTraceContext,
    "updateSpanName",
    ()=>updateSpanName
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/asyncContext/index.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/carrier.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/spanstatus.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/utils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/object.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/propagationContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/time.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/tracing.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanOnScope.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
// These are aligned with OpenTelemetry trace flags
const TRACE_FLAG_NONE = 0x0;
const TRACE_FLAG_SAMPLED = 0x1;
let hasShownSpanDropWarning = false;
/**
 * Convert a span to a trace context, which can be sent as the `trace` context in an event.
 * By default, this will only include trace_id, span_id & parent_span_id.
 * If `includeAllData` is true, it will also include data, op, status & origin.
 */ function spanToTransactionTraceContext(span) {
    const { spanId: span_id, traceId: trace_id } = span.spanContext();
    const { data, op, parent_span_id, status, origin, links } = spanToJSON(span);
    return {
        parent_span_id,
        span_id,
        trace_id,
        data,
        op,
        status,
        origin,
        links
    };
}
/**
 * Convert a span to a trace context, which can be sent as the `trace` context in a non-transaction event.
 */ function spanToTraceContext(span) {
    const { spanId, traceId: trace_id, isRemote } = span.spanContext();
    // If the span is remote, we use a random/virtual span as span_id to the trace context,
    // and the remote span as parent_span_id
    const parent_span_id = isRemote ? spanId : spanToJSON(span).parent_span_id;
    const scope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCapturedScopesOnSpan"])(span).scope;
    const span_id = isRemote ? scope?.getPropagationContext().propagationSpanId || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateSpanId"])() : spanId;
    return {
        parent_span_id,
        span_id,
        trace_id
    };
}
/**
 * Convert a Span to a Sentry trace header.
 */ function spanToTraceHeader(span) {
    const { traceId, spanId } = span.spanContext();
    const sampled = spanIsSampled(span);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateSentryTraceHeader"])(traceId, spanId, sampled);
}
/**
 * Convert a Span to a W3C traceparent header.
 */ function spanToTraceparentHeader(span) {
    const { traceId, spanId } = span.spanContext();
    const sampled = spanIsSampled(span);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceparentHeader"])(traceId, spanId, sampled);
}
/**
 *  Converts the span links array to a flattened version to be sent within an envelope.
 *
 *  If the links array is empty, it returns `undefined` so the empty value can be dropped before it's sent.
 */ function convertSpanLinksForEnvelope(links) {
    if (links && links.length > 0) {
        return links.map(({ context: { spanId, traceId, traceFlags, ...restContext }, attributes })=>({
                span_id: spanId,
                trace_id: traceId,
                sampled: traceFlags === TRACE_FLAG_SAMPLED,
                attributes,
                ...restContext
            }));
    } else {
        return undefined;
    }
}
/**
 * Convert a span time input into a timestamp in seconds.
 */ function spanTimeInputToSeconds(input) {
    if (typeof input === 'number') {
        return ensureTimestampInSeconds(input);
    }
    if (Array.isArray(input)) {
        // See {@link HrTime} for the array-based time format
        return input[0] + input[1] / 1e9;
    }
    if (input instanceof Date) {
        return ensureTimestampInSeconds(input.getTime());
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timestampInSeconds"])();
}
/**
 * Converts a timestamp to second, if it was in milliseconds, or keeps it as second.
 */ function ensureTimestampInSeconds(timestamp) {
    const isMs = timestamp > 9999999999;
    return isMs ? timestamp / 1000 : timestamp;
}
/**
 * Convert a span to a JSON representation.
 */ // Note: Because of this, we currently have a circular type dependency (which we opted out of in package.json).
// This is not avoidable as we need `spanToJSON` in `spanUtils.ts`, which in turn is needed by `span.ts` for backwards compatibility.
// And `spanToJSON` needs the Span class from `span.ts` to check here.
function spanToJSON(span) {
    if (spanIsSentrySpan(span)) {
        return span.getSpanJSON();
    }
    const { spanId: span_id, traceId: trace_id } = span.spanContext();
    // Handle a span from @opentelemetry/sdk-base-trace's `Span` class
    if (spanIsOpenTelemetrySdkTraceBaseSpan(span)) {
        const { attributes, startTime, name, endTime, status, links } = span;
        // In preparation for the next major of OpenTelemetry, we want to support
        // looking up the parent span id according to the new API
        // In OTel v1, the parent span id is accessed as `parentSpanId`
        // In OTel v2, the parent span id is accessed as `spanId` on the `parentSpanContext`
        const parentSpanId = 'parentSpanId' in span ? span.parentSpanId : 'parentSpanContext' in span ? span.parentSpanContext?.spanId : undefined;
        return {
            span_id,
            trace_id,
            data: attributes,
            description: name,
            parent_span_id: parentSpanId,
            start_timestamp: spanTimeInputToSeconds(startTime),
            // This is [0,0] by default in OTEL, in which case we want to interpret this as no end time
            timestamp: spanTimeInputToSeconds(endTime) || undefined,
            status: getStatusMessage(status),
            op: attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]],
            origin: attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]],
            links: convertSpanLinksForEnvelope(links)
        };
    }
    // Finally, at least we have `spanContext()`....
    // This should not actually happen in reality, but we need to handle it for type safety.
    return {
        span_id,
        trace_id,
        start_timestamp: 0,
        data: {}
    };
}
function spanIsOpenTelemetrySdkTraceBaseSpan(span) {
    const castSpan = span;
    return !!castSpan.attributes && !!castSpan.startTime && !!castSpan.name && !!castSpan.endTime && !!castSpan.status;
}
/** Exported only for tests. */ /**
 * Sadly, due to circular dependency checks we cannot actually import the Span class here and check for instanceof.
 * :( So instead we approximate this by checking if it has the `getSpanJSON` method.
 */ function spanIsSentrySpan(span) {
    return typeof span.getSpanJSON === 'function';
}
/**
 * Returns true if a span is sampled.
 * In most cases, you should just use `span.isRecording()` instead.
 * However, this has a slightly different semantic, as it also returns false if the span is finished.
 * So in the case where this distinction is important, use this method.
 */ function spanIsSampled(span) {
    // We align our trace flags with the ones OpenTelemetry use
    // So we also check for sampled the same way they do.
    const { traceFlags } = span.spanContext();
    return traceFlags === TRACE_FLAG_SAMPLED;
}
/** Get the status message to use for a JSON representation of a span. */ function getStatusMessage(status) {
    if (!status || status.code === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_UNSET"]) {
        return undefined;
    }
    if (status.code === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_OK"]) {
        return 'ok';
    }
    return status.message || 'internal_error';
}
const CHILD_SPANS_FIELD = '_sentryChildSpans';
const ROOT_SPAN_FIELD = '_sentryRootSpan';
/**
 * Adds an opaque child span reference to a span.
 */ function addChildSpanToSpan(span, childSpan) {
    // We store the root span reference on the child span
    // We need this for `getRootSpan()` to work
    const rootSpan = span[ROOT_SPAN_FIELD] || span;
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addNonEnumerableProperty"])(childSpan, ROOT_SPAN_FIELD, rootSpan);
    // We store a list of child spans on the parent span
    // We need this for `getSpanDescendants()` to work
    if (span[CHILD_SPANS_FIELD]) {
        span[CHILD_SPANS_FIELD].add(childSpan);
    } else {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addNonEnumerableProperty"])(span, CHILD_SPANS_FIELD, new Set([
            childSpan
        ]));
    }
}
/** This is only used internally by Idle Spans. */ function removeChildSpanFromSpan(span, childSpan) {
    if (span[CHILD_SPANS_FIELD]) {
        span[CHILD_SPANS_FIELD].delete(childSpan);
    }
}
/**
 * Returns an array of the given span and all of its descendants.
 */ function getSpanDescendants(span) {
    const resultSet = new Set();
    function addSpanChildren(span) {
        // This exit condition is required to not infinitely loop in case of a circular dependency.
        if (resultSet.has(span)) {
            return;
        // We want to ignore unsampled spans (e.g. non recording spans)
        } else if (spanIsSampled(span)) {
            resultSet.add(span);
            const childSpans = span[CHILD_SPANS_FIELD] ? Array.from(span[CHILD_SPANS_FIELD]) : [];
            for (const childSpan of childSpans){
                addSpanChildren(childSpan);
            }
        }
    }
    addSpanChildren(span);
    return Array.from(resultSet);
}
/**
 * Returns the root span of a given span.
 */ function getRootSpan(span) {
    return span[ROOT_SPAN_FIELD] || span;
}
/**
 * Returns the currently active span.
 */ function getActiveSpan() {
    const carrier = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getMainCarrier"])();
    const acs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getAsyncContextStrategy"])(carrier);
    if (acs.getActiveSpan) {
        return acs.getActiveSpan();
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_getSpanForScope"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])());
}
/**
 * Logs a warning once if `beforeSendSpan` is used to drop spans.
 */ function showSpanDropWarning() {
    if (!hasShownSpanDropWarning) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["consoleSandbox"])(()=>{
            // eslint-disable-next-line no-console
            console.warn('[Sentry] Returning null from `beforeSendSpan` is disallowed. To drop certain spans, configure the respective integrations directly or use `ignoreSpans`.');
        });
        hasShownSpanDropWarning = true;
    }
}
/**
 * Updates the name of the given span and ensures that the span name is not
 * overwritten by the Sentry SDK.
 *
 * Use this function instead of `span.updateName()` if you want to make sure that
 * your name is kept. For some spans, for example root `http.server` spans the
 * Sentry SDK would otherwise overwrite the span name with a high-quality name
 * it infers when the span ends.
 *
 * Use this function in server code or when your span is started on the server
 * and on the client (browser). If you only update a span name on the client,
 * you can also use `span.updateName()` the SDK does not overwrite the name.
 *
 * @param span - The span to update the name of.
 * @param name - The name to set on the span.
 */ function updateSpanName(span, name) {
    span.updateName(name);
    span.setAttributes({
        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]]: 'custom',
        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME"]]: name
    });
}
;
 //# sourceMappingURL=spanUtils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/constants.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_ENVIRONMENT",
    ()=>DEFAULT_ENVIRONMENT,
    "DEV_ENVIRONMENT",
    ()=>DEV_ENVIRONMENT
]);
const DEFAULT_ENVIRONMENT = 'production';
const DEV_ENVIRONMENT = 'development';
;
 //# sourceMappingURL=constants.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/dynamicSamplingContext.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "freezeDscOnSpan",
    ()=>freezeDscOnSpan,
    "getDynamicSamplingContextFromClient",
    ()=>getDynamicSamplingContextFromClient,
    "getDynamicSamplingContextFromScope",
    ()=>getDynamicSamplingContextFromScope,
    "getDynamicSamplingContextFromSpan",
    ()=>getDynamicSamplingContextFromSpan,
    "spanToBaggageHeader",
    ()=>spanToBaggageHeader
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/constants.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/baggage.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/dsn.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/hasSpansEnabled.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/object.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/utils.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
;
/**
 * If you change this value, also update the terser plugin config to
 * avoid minification of the object property!
 */ const FROZEN_DSC_FIELD = '_frozenDsc';
/**
 * Freeze the given DSC on the given span.
 */ function freezeDscOnSpan(span, dsc) {
    const spanWithMaybeDsc = span;
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addNonEnumerableProperty"])(spanWithMaybeDsc, FROZEN_DSC_FIELD, dsc);
}
/**
 * Creates a dynamic sampling context from a client.
 *
 * Dispatches the `createDsc` lifecycle hook as a side effect.
 */ function getDynamicSamplingContextFromClient(trace_id, client) {
    const options = client.getOptions();
    const { publicKey: public_key } = client.getDsn() || {};
    // Instead of conditionally adding non-undefined values, we add them and then remove them if needed
    // otherwise, the order of baggage entries changes, which "breaks" a bunch of tests etc.
    const dsc = {
        environment: options.environment || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEFAULT_ENVIRONMENT"],
        release: options.release,
        public_key,
        trace_id,
        org_id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["extractOrgIdFromClient"])(client)
    };
    client.emit('createDsc', dsc);
    return dsc;
}
/**
 * Get the dynamic sampling context for the currently active scopes.
 */ function getDynamicSamplingContextFromScope(client, scope) {
    const propagationContext = scope.getPropagationContext();
    return propagationContext.dsc || getDynamicSamplingContextFromClient(propagationContext.traceId, client);
}
/**
 * Creates a dynamic sampling context from a span (and client and scope)
 *
 * @param span the span from which a few values like the root span name and sample rate are extracted.
 *
 * @returns a dynamic sampling context
 */ function getDynamicSamplingContextFromSpan(span) {
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    if (!client) {
        return {};
    }
    const rootSpan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(span);
    const rootSpanJson = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(rootSpan);
    const rootSpanAttributes = rootSpanJson.data;
    const traceState = rootSpan.spanContext().traceState;
    // The span sample rate that was locally applied to the root span should also always be applied to the DSC, even if the DSC is frozen.
    // This is so that the downstream traces/services can use parentSampleRate in their `tracesSampler` to make consistent sampling decisions across the entire trace.
    const rootSpanSampleRate = traceState?.get('sentry.sample_rate') ?? rootSpanAttributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE"]] ?? rootSpanAttributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_PREVIOUS_TRACE_SAMPLE_RATE"]];
    function applyLocalSampleRateToDsc(dsc) {
        if (typeof rootSpanSampleRate === 'number' || typeof rootSpanSampleRate === 'string') {
            dsc.sample_rate = `${rootSpanSampleRate}`;
        }
        return dsc;
    }
    // For core implementation, we freeze the DSC onto the span as a non-enumerable property
    const frozenDsc = rootSpan[FROZEN_DSC_FIELD];
    if (frozenDsc) {
        return applyLocalSampleRateToDsc(frozenDsc);
    }
    // For OpenTelemetry, we freeze the DSC on the trace state
    const traceStateDsc = traceState?.get('sentry.dsc');
    // If the span has a DSC, we want it to take precedence
    const dscOnTraceState = traceStateDsc && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["baggageHeaderToDynamicSamplingContext"])(traceStateDsc);
    if (dscOnTraceState) {
        return applyLocalSampleRateToDsc(dscOnTraceState);
    }
    // Else, we generate it from the span
    const dsc = getDynamicSamplingContextFromClient(span.spanContext().traceId, client);
    // We don't want to have a transaction name in the DSC if the source is "url" because URLs might contain PII
    const source = rootSpanAttributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]];
    // after JSON conversion, txn.name becomes jsonSpan.description
    const name = rootSpanJson.description;
    if (source !== 'url' && name) {
        dsc.transaction = name;
    }
    // How can we even land here with hasSpansEnabled() returning false?
    // Otel creates a Non-recording span in Tracing Without Performance mode when handling incoming requests
    // So we end up with an active span that is not sampled (neither positively nor negatively)
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])()) {
        dsc.sampled = String((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanIsSampled"])(rootSpan));
        dsc.sample_rand = // In OTEL we store the sample rand on the trace state because we cannot access scopes for NonRecordingSpans
        // The Sentry OTEL SpanSampler takes care of writing the sample rand on the root span
        traceState?.get('sentry.sample_rand') ?? // On all other platforms we can actually get the scopes from a root span (we use this as a fallback)
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCapturedScopesOnSpan"])(rootSpan).scope?.getPropagationContext().sampleRand.toString();
    }
    applyLocalSampleRateToDsc(dsc);
    client.emit('createDsc', dsc, rootSpan);
    return dsc;
}
/**
 * Convert a Span to a baggage header.
 */ function spanToBaggageHeader(span) {
    const dsc = getDynamicSamplingContextFromSpan(span);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dynamicSamplingContextToSentryBaggageHeader"])(dsc);
}
;
 //# sourceMappingURL=dynamicSamplingContext.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/logSpans.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "logSpanEnd",
    ()=>logSpanEnd,
    "logSpanStart",
    ()=>logSpanStart
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
;
;
;
/**
 * Print a log message for a started span.
 */ function logSpanStart(span) {
    if (!__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"]) return;
    const { description = '< unknown name >', op = '< unknown op >', parent_span_id: parentSpanId } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span);
    const { spanId } = span.spanContext();
    const sampled = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanIsSampled"])(span);
    const rootSpan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(span);
    const isRootSpan = rootSpan === span;
    const header = `[Tracing] Starting ${sampled ? 'sampled' : 'unsampled'} ${isRootSpan ? 'root ' : ''}span`;
    const infoParts = [
        `op: ${op}`,
        `name: ${description}`,
        `ID: ${spanId}`
    ];
    if (parentSpanId) {
        infoParts.push(`parent ID: ${parentSpanId}`);
    }
    if (!isRootSpan) {
        const { op, description } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(rootSpan);
        infoParts.push(`root ID: ${rootSpan.spanContext().spanId}`);
        if (op) {
            infoParts.push(`root op: ${op}`);
        }
        if (description) {
            infoParts.push(`root description: ${description}`);
        }
    }
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`${header}
  ${infoParts.join('\n  ')}`);
}
/**
 * Print a log message for an ended span.
 */ function logSpanEnd(span) {
    if (!__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"]) return;
    const { description = '< unknown name >', op = '< unknown op >' } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span);
    const { spanId } = span.spanContext();
    const rootSpan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(span);
    const isRootSpan = rootSpan === span;
    const msg = `[Tracing] Finishing "${op}" ${isRootSpan ? 'root ' : ''}span "${description}" with ID ${spanId}`;
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(msg);
}
;
 //# sourceMappingURL=logSpans.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/sampling.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "sampleSpan",
    ()=>sampleSpan
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/hasSpansEnabled.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/parseSampleRate.js [instrumentation-edge] (ecmascript)");
;
;
;
;
/**
 * Makes a sampling decision for the given options.
 *
 * Called every time a root span is created. Only root spans which emerge with a `sampled` value of `true` will be
 * sent to Sentry.
 */ function sampleSpan(options, samplingContext, sampleRand) {
    // nothing to do if span recording is not enabled
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])(options)) {
        return [
            false
        ];
    }
    let localSampleRateWasApplied = undefined;
    // we would have bailed already if neither `tracesSampler` nor `tracesSampleRate` were defined, so one of these should
    // work; prefer the hook if so
    let sampleRate;
    if (typeof options.tracesSampler === 'function') {
        sampleRate = options.tracesSampler({
            ...samplingContext,
            inheritOrSampleWith: (fallbackSampleRate)=>{
                // If we have an incoming parent sample rate, we'll just use that one.
                // The sampling decision will be inherited because of the sample_rand that was generated when the trace reached the incoming boundaries of the SDK.
                if (typeof samplingContext.parentSampleRate === 'number') {
                    return samplingContext.parentSampleRate;
                }
                // Fallback if parent sample rate is not on the incoming trace (e.g. if there is no baggage)
                // This is to provide backwards compatibility if there are incoming traces from older SDKs that don't send a parent sample rate or a sample rand. In these cases we just want to force either a sampling decision on the downstream traces via the sample rate.
                if (typeof samplingContext.parentSampled === 'boolean') {
                    return Number(samplingContext.parentSampled);
                }
                return fallbackSampleRate;
            }
        });
        localSampleRateWasApplied = true;
    } else if (samplingContext.parentSampled !== undefined) {
        sampleRate = samplingContext.parentSampled;
    } else if (typeof options.tracesSampleRate !== 'undefined') {
        sampleRate = options.tracesSampleRate;
        localSampleRateWasApplied = true;
    }
    // Since this is coming from the user (or from a function provided by the user), who knows what we might get.
    // (The only valid values are booleans or numbers between 0 and 1.)
    const parsedSampleRate = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseSampleRate"])(sampleRate);
    if (parsedSampleRate === undefined) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(`[Tracing] Discarding root span because of invalid sample rate. Sample rate must be a boolean or a number between 0 and 1. Got ${JSON.stringify(sampleRate)} of type ${JSON.stringify(typeof sampleRate)}.`);
        return [
            false
        ];
    }
    // if the function returned 0 (or false), or if `tracesSampleRate` is 0, it's a sign the transaction should be dropped
    if (!parsedSampleRate) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`[Tracing] Discarding transaction because ${typeof options.tracesSampler === 'function' ? 'tracesSampler returned 0 or false' : 'a negative sampling decision was inherited or tracesSampleRate is set to 0'}`);
        return [
            false,
            parsedSampleRate,
            localSampleRateWasApplied
        ];
    }
    // We always compare the sample rand for the current execution context against the chosen sample rate.
    // Read more: https://develop.sentry.dev/sdk/telemetry/traces/#propagated-random-value
    const shouldSample = sampleRand < parsedSampleRate;
    // if we're not going to keep it, we're done
    if (!shouldSample) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`[Tracing] Discarding transaction because it's not included in the random sample (sampling rate = ${Number(sampleRate)})`);
    }
    return [
        shouldSample,
        parsedSampleRate,
        localSampleRateWasApplied
    ];
}
;
 //# sourceMappingURL=sampling.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/sentryNonRecordingSpan.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SentryNonRecordingSpan",
    ()=>SentryNonRecordingSpan
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/propagationContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
;
;
/**
 * A Sentry Span that is non-recording, meaning it will not be sent to Sentry.
 */ class SentryNonRecordingSpan {
    constructor(spanContext = {}){
        this._traceId = spanContext.traceId || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceId"])();
        this._spanId = spanContext.spanId || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateSpanId"])();
    }
    /** @inheritdoc */ spanContext() {
        return {
            spanId: this._spanId,
            traceId: this._traceId,
            traceFlags: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TRACE_FLAG_NONE"]
        };
    }
    /** @inheritdoc */ end(_timestamp) {}
    /** @inheritdoc */ setAttribute(_key, _value) {
        return this;
    }
    /** @inheritdoc */ setAttributes(_values) {
        return this;
    }
    /** @inheritdoc */ setStatus(_status) {
        return this;
    }
    /** @inheritdoc */ updateName(_name) {
        return this;
    }
    /** @inheritdoc */ isRecording() {
        return false;
    }
    /** @inheritdoc */ addEvent(_name, _attributesOrStartTime, _startTime) {
        return this;
    }
    /** @inheritDoc */ addLink(_link) {
        return this;
    }
    /** @inheritDoc */ addLinks(_links) {
        return this;
    }
    /**
   * This should generally not be used,
   * but we need it for being compliant with the OTEL Span interface.
   *
   * @hidden
   * @internal
   */ recordException(_exception, _time) {
    // noop
    }
}
;
 //# sourceMappingURL=sentryNonRecordingSpan.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/normalize.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "normalize",
    ()=>normalize,
    "normalizeToSize",
    ()=>normalizeToSize,
    "normalizeUrlToBase",
    ()=>normalizeUrlToBase
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/object.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/stacktrace.js [instrumentation-edge] (ecmascript)");
;
;
;
/**
 * Recursively normalizes the given object.
 *
 * - Creates a copy to prevent original input mutation
 * - Skips non-enumerable properties
 * - When stringifying, calls `toJSON` if implemented
 * - Removes circular references
 * - Translates non-serializable values (`undefined`/`NaN`/functions) to serializable format
 * - Translates known global objects/classes to a string representations
 * - Takes care of `Error` object serialization
 * - Optionally limits depth of final output
 * - Optionally limits number of properties/elements included in any single object/array
 *
 * @param input The object to be normalized.
 * @param depth The max depth to which to normalize the object. (Anything deeper stringified whole.)
 * @param maxProperties The max number of elements or properties to be included in any single array or
 * object in the normalized output.
 * @returns A normalized version of the object, or `"**non-serializable**"` if any errors are thrown during normalization.
 */ // eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(input, depth = 100, maxProperties = +Infinity) {
    try {
        // since we're at the outermost level, we don't provide a key
        return visit('', input, depth, maxProperties);
    } catch (err) {
        return {
            ERROR: `**non-serializable** (${err})`
        };
    }
}
/** JSDoc */ function normalizeToSize(// eslint-disable-next-line @typescript-eslint/no-explicit-any
object, // Default Node.js REPL depth
depth = 3, // 100kB, as 200kB is max payload size, so half sounds reasonable
maxSize = 100 * 1024) {
    const normalized = normalize(object, depth);
    if (jsonSize(normalized) > maxSize) {
        return normalizeToSize(object, depth - 1, maxSize);
    }
    return normalized;
}
/**
 * Visits a node to perform normalization on it
 *
 * @param key The key corresponding to the given node
 * @param value The node to be visited
 * @param depth Optional number indicating the maximum recursion depth
 * @param maxProperties Optional maximum number of properties/elements included in any single object/array
 * @param memo Optional Memo class handling decycling
 */ function visit(key, value, depth = +Infinity, maxProperties = +Infinity, memo = memoBuilder()) {
    const [memoize, unmemoize] = memo;
    // Get the simple cases out of the way first
    if (value == null || // this matches null and undefined -> eqeq not eqeqeq
    [
        'boolean',
        'string'
    ].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const stringified = stringifyValue(key, value);
    // Anything we could potentially dig into more (objects or arrays) will have come back as `"[object XXXX]"`.
    // Everything else will have already been serialized, so if we don't see that pattern, we're done.
    if (!stringified.startsWith('[object ')) {
        return stringified;
    }
    // From here on, we can assert that `value` is either an object or an array.
    // Do not normalize objects that we know have already been normalized. As a general rule, the
    // "__sentry_skip_normalization__" property should only be used sparingly and only should only be set on objects that
    // have already been normalized.
    if (value['__sentry_skip_normalization__']) {
        return value;
    }
    // We can set `__sentry_override_normalization_depth__` on an object to ensure that from there
    // We keep a certain amount of depth.
    // This should be used sparingly, e.g. we use it for the redux integration to ensure we get a certain amount of state.
    const remainingDepth = typeof value['__sentry_override_normalization_depth__'] === 'number' ? value['__sentry_override_normalization_depth__'] : depth;
    // We're also done if we've reached the max depth
    if (remainingDepth === 0) {
        // At this point we know `serialized` is a string of the form `"[object XXXX]"`. Clean it up so it's just `"[XXXX]"`.
        return stringified.replace('object ', '');
    }
    // If we've already visited this branch, bail out, as it's circular reference. If not, note that we're seeing it now.
    if (memoize(value)) {
        return '[Circular ~]';
    }
    // If the value has a `toJSON` method, we call it to extract more information
    const valueWithToJSON = value;
    if (valueWithToJSON && typeof valueWithToJSON.toJSON === 'function') {
        try {
            const jsonValue = valueWithToJSON.toJSON();
            // We need to normalize the return value of `.toJSON()` in case it has circular references
            return visit('', jsonValue, remainingDepth - 1, maxProperties, memo);
        } catch  {
        // pass (The built-in `toJSON` failed, but we can still try to do it ourselves)
        }
    }
    // At this point we know we either have an object or an array, we haven't seen it before, and we're going to recurse
    // because we haven't yet reached the max depth. Create an accumulator to hold the results of visiting each
    // property/entry, and keep track of the number of items we add to it.
    const normalized = Array.isArray(value) ? [] : {};
    let numAdded = 0;
    // Before we begin, convert`Error` and`Event` instances into plain objects, since some of each of their relevant
    // properties are non-enumerable and otherwise would get missed.
    const visitable = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["convertToPlainObject"])(value);
    for(const visitKey in visitable){
        // Avoid iterating over fields in the prototype if they've somehow been exposed to enumeration.
        if (!Object.prototype.hasOwnProperty.call(visitable, visitKey)) {
            continue;
        }
        if (numAdded >= maxProperties) {
            normalized[visitKey] = '[MaxProperties ~]';
            break;
        }
        // Recursively visit all the child nodes
        const visitValue = visitable[visitKey];
        normalized[visitKey] = visit(visitKey, visitValue, remainingDepth - 1, maxProperties, memo);
        numAdded++;
    }
    // Once we've visited all the branches, remove the parent from memo storage
    unmemoize(value);
    // Return accumulated values
    return normalized;
}
/* eslint-disable complexity */ /**
 * Stringify the given value. Handles various known special values and types.
 *
 * Not meant to be used on simple primitives which already have a string representation, as it will, for example, turn
 * the number 1231 into "[Object Number]", nor on `null`, as it will throw.
 *
 * @param value The value to stringify
 * @returns A stringified representation of the given value
 */ function stringifyValue(key, // this type is a tiny bit of a cheat, since this function does handle NaN (which is technically a number), but for
// our internal use, it'll do
value) {
    try {
        if (key === 'domain' && value && typeof value === 'object' && value._events) {
            return '[Domain]';
        }
        if (key === 'domainEmitter') {
            return '[DomainEmitter]';
        }
        // It's safe to use `global`, `window`, and `document` here in this manner, as we are asserting using `typeof` first
        // which won't throw if they are not present.
        if (("TURBOPACK compile-time value", "object") !== 'undefined' && value === /*TURBOPACK member replacement*/ __turbopack_context__.g) {
            return '[Global]';
        }
        // eslint-disable-next-line no-restricted-globals
        if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
        ;
        // eslint-disable-next-line no-restricted-globals
        if (typeof document !== 'undefined' && value === document) {
            return '[Document]';
        }
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isVueViewModel"])(value)) {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getVueInternalName"])(value);
        }
        // React's SyntheticEvent thingy
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isSyntheticEvent"])(value)) {
            return '[SyntheticEvent]';
        }
        if (typeof value === 'number' && !Number.isFinite(value)) {
            return `[${value}]`;
        }
        if (typeof value === 'function') {
            return `[Function: ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getFunctionName"])(value)}]`;
        }
        if (typeof value === 'symbol') {
            return `[${String(value)}]`;
        }
        // stringified BigInts are indistinguishable from regular numbers, so we need to label them to avoid confusion
        if (typeof value === 'bigint') {
            return `[BigInt: ${String(value)}]`;
        }
        // Now that we've knocked out all the special cases and the primitives, all we have left are objects. Simply casting
        // them to strings means that instances of classes which haven't defined their `toStringTag` will just come out as
        // `"[object Object]"`. If we instead look at the constructor's name (which is the same as the name of the class),
        // we can make sure that only plain objects come out that way.
        const objName = getConstructorName(value);
        // Handle HTML Elements
        if (/^HTML(\w*)Element$/.test(objName)) {
            return `[HTMLElement: ${objName}]`;
        }
        return `[object ${objName}]`;
    } catch (err) {
        return `**non-serializable** (${err})`;
    }
}
/* eslint-enable complexity */ function getConstructorName(value) {
    const prototype = Object.getPrototypeOf(value);
    return prototype?.constructor ? prototype.constructor.name : 'null prototype';
}
/** Calculates bytes size of input string */ function utf8Length(value) {
    // eslint-disable-next-line no-bitwise
    return ~-encodeURI(value).split(/%..|./).length;
}
/** Calculates bytes size of input object */ // eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonSize(value) {
    return utf8Length(JSON.stringify(value));
}
/**
 * Normalizes URLs in exceptions and stacktraces to a base path so Sentry can fingerprint
 * across platforms and working directory.
 *
 * @param url The URL to be normalized.
 * @param basePath The application base path.
 * @returns The normalized URL.
 */ function normalizeUrlToBase(url, basePath) {
    const escapedBase = basePath// Backslash to forward
    .replace(/\\/g, '/')// Escape RegExp special characters
    .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
    let newUrl = url;
    try {
        newUrl = decodeURI(url);
    } catch  {
    // Sometime this breaks
    }
    return newUrl.replace(/\\/g, '/').replace(/webpack:\/?/g, '') // Remove intermediate base path
    // eslint-disable-next-line @sentry-internal/sdk/no-regexp-constructor
    .replace(new RegExp(`(file://)?/*${escapedBase}/*`, 'ig'), 'app:///');
}
/**
 * Helper to decycle json objects
 */ function memoBuilder() {
    const inner = new WeakSet();
    function memoize(obj) {
        if (inner.has(obj)) {
            return true;
        }
        inner.add(obj);
        return false;
    }
    function unmemoize(obj) {
        inner.delete(obj);
    }
    return [
        memoize,
        unmemoize
    ];
}
;
 //# sourceMappingURL=normalize.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/envelope.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addItemToEnvelope",
    ()=>addItemToEnvelope,
    "createAttachmentEnvelopeItem",
    ()=>createAttachmentEnvelopeItem,
    "createEnvelope",
    ()=>createEnvelope,
    "createEventEnvelopeHeaders",
    ()=>createEventEnvelopeHeaders,
    "createSpanEnvelopeItem",
    ()=>createSpanEnvelopeItem,
    "envelopeContainsItemType",
    ()=>envelopeContainsItemType,
    "envelopeItemTypeToDataCategory",
    ()=>envelopeItemTypeToDataCategory,
    "forEachEnvelopeItem",
    ()=>forEachEnvelopeItem,
    "getSdkMetadataForEnvelopeHeader",
    ()=>getSdkMetadataForEnvelopeHeader,
    "parseEnvelope",
    ()=>parseEnvelope,
    "serializeEnvelope",
    ()=>serializeEnvelope
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/carrier.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/dsn.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/normalize.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
;
;
;
/**
 * Creates an envelope.
 * Make sure to always explicitly provide the generic to this function
 * so that the envelope types resolve correctly.
 */ function createEnvelope(headers, items = []) {
    return [
        headers,
        items
    ];
}
/**
 * Add an item to an envelope.
 * Make sure to always explicitly provide the generic to this function
 * so that the envelope types resolve correctly.
 */ function addItemToEnvelope(envelope, newItem) {
    const [headers, items] = envelope;
    return [
        headers,
        [
            ...items,
            newItem
        ]
    ];
}
/**
 * Convenience function to loop through the items and item types of an envelope.
 * (This function was mostly created because working with envelope types is painful at the moment)
 *
 * If the callback returns true, the rest of the items will be skipped.
 */ function forEachEnvelopeItem(envelope, callback) {
    const envelopeItems = envelope[1];
    for (const envelopeItem of envelopeItems){
        const envelopeItemType = envelopeItem[0].type;
        const result = callback(envelopeItem, envelopeItemType);
        if (result) {
            return true;
        }
    }
    return false;
}
/**
 * Returns true if the envelope contains any of the given envelope item types
 */ function envelopeContainsItemType(envelope, types) {
    return forEachEnvelopeItem(envelope, (_, type)=>types.includes(type));
}
/**
 * Encode a string to UTF8 array.
 */ function encodeUTF8(input) {
    const carrier = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSentryCarrier"])(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"]);
    return carrier.encodePolyfill ? carrier.encodePolyfill(input) : new TextEncoder().encode(input);
}
/**
 * Decode a UTF8 array to string.
 */ function decodeUTF8(input) {
    const carrier = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSentryCarrier"])(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"]);
    return carrier.decodePolyfill ? carrier.decodePolyfill(input) : new TextDecoder().decode(input);
}
/**
 * Serializes an envelope.
 */ function serializeEnvelope(envelope) {
    const [envHeaders, items] = envelope;
    // Initially we construct our envelope as a string and only convert to binary chunks if we encounter binary data
    let parts = JSON.stringify(envHeaders);
    function append(next) {
        if (typeof parts === 'string') {
            parts = typeof next === 'string' ? parts + next : [
                encodeUTF8(parts),
                next
            ];
        } else {
            parts.push(typeof next === 'string' ? encodeUTF8(next) : next);
        }
    }
    for (const item of items){
        const [itemHeaders, payload] = item;
        append(`\n${JSON.stringify(itemHeaders)}\n`);
        if (typeof payload === 'string' || payload instanceof Uint8Array) {
            append(payload);
        } else {
            let stringifiedPayload;
            try {
                stringifiedPayload = JSON.stringify(payload);
            } catch  {
                // In case, despite all our efforts to keep `payload` circular-dependency-free, `JSON.stringify()` still
                // fails, we try again after normalizing it again with infinite normalization depth. This of course has a
                // performance impact but in this case a performance hit is better than throwing.
                stringifiedPayload = JSON.stringify((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["normalize"])(payload));
            }
            append(stringifiedPayload);
        }
    }
    return typeof parts === 'string' ? parts : concatBuffers(parts);
}
function concatBuffers(buffers) {
    const totalLength = buffers.reduce((acc, buf)=>acc + buf.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of buffers){
        merged.set(buffer, offset);
        offset += buffer.length;
    }
    return merged;
}
/**
 * Parses an envelope
 */ function parseEnvelope(env) {
    let buffer = typeof env === 'string' ? encodeUTF8(env) : env;
    function readBinary(length) {
        const bin = buffer.subarray(0, length);
        // Replace the buffer with the remaining data excluding trailing newline
        buffer = buffer.subarray(length + 1);
        return bin;
    }
    function readJson() {
        let i = buffer.indexOf(0xa);
        // If we couldn't find a newline, we must have found the end of the buffer
        if (i < 0) {
            i = buffer.length;
        }
        return JSON.parse(decodeUTF8(readBinary(i)));
    }
    const envelopeHeader = readJson();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = [];
    while(buffer.length){
        const itemHeader = readJson();
        const binaryLength = typeof itemHeader.length === 'number' ? itemHeader.length : undefined;
        items.push([
            itemHeader,
            binaryLength ? readBinary(binaryLength) : readJson()
        ]);
    }
    return [
        envelopeHeader,
        items
    ];
}
/**
 * Creates envelope item for a single span
 */ function createSpanEnvelopeItem(spanJson) {
    const spanHeaders = {
        type: 'span'
    };
    return [
        spanHeaders,
        spanJson
    ];
}
/**
 * Creates attachment envelope items
 */ function createAttachmentEnvelopeItem(attachment) {
    const buffer = typeof attachment.data === 'string' ? encodeUTF8(attachment.data) : attachment.data;
    return [
        {
            type: 'attachment',
            length: buffer.length,
            filename: attachment.filename,
            content_type: attachment.contentType,
            attachment_type: attachment.attachmentType
        },
        buffer
    ];
}
const ITEM_TYPE_TO_DATA_CATEGORY_MAP = {
    session: 'session',
    sessions: 'session',
    attachment: 'attachment',
    transaction: 'transaction',
    event: 'error',
    client_report: 'internal',
    user_report: 'default',
    profile: 'profile',
    profile_chunk: 'profile',
    replay_event: 'replay',
    replay_recording: 'replay',
    check_in: 'monitor',
    feedback: 'feedback',
    span: 'span',
    raw_security: 'security',
    log: 'log_item',
    metric: 'metric',
    trace_metric: 'metric'
};
/**
 * Maps the type of an envelope item to a data category.
 */ function envelopeItemTypeToDataCategory(type) {
    return ITEM_TYPE_TO_DATA_CATEGORY_MAP[type];
}
/** Extracts the minimal SDK info from the metadata or an events */ function getSdkMetadataForEnvelopeHeader(metadataOrEvent) {
    if (!metadataOrEvent?.sdk) {
        return;
    }
    const { name, version } = metadataOrEvent.sdk;
    return {
        name,
        version
    };
}
/**
 * Creates event envelope headers, based on event, sdk info and tunnel
 * Note: This function was extracted from the core package to make it available in Replay
 */ function createEventEnvelopeHeaders(event, sdkInfo, tunnel, dsn) {
    const dynamicSamplingContext = event.sdkProcessingMetadata?.dynamicSamplingContext;
    return {
        event_id: event.event_id,
        sent_at: new Date().toISOString(),
        ...sdkInfo && {
            sdk: sdkInfo
        },
        ...!!tunnel && dsn && {
            dsn: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dsnToString"])(dsn)
        },
        ...dynamicSamplingContext && {
            trace: dynamicSamplingContext
        }
    };
}
;
 //# sourceMappingURL=envelope.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/should-ignore-span.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "reparentChildSpans",
    ()=>reparentChildSpans,
    "shouldIgnoreSpan",
    ()=>shouldIgnoreSpan
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/string.js [instrumentation-edge] (ecmascript)");
;
;
;
function logIgnoredSpan(droppedSpan) {
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`Ignoring span ${droppedSpan.op} - ${droppedSpan.description} because it matches \`ignoreSpans\`.`);
}
/**
 * Check if a span should be ignored based on the ignoreSpans configuration.
 */ function shouldIgnoreSpan(span, ignoreSpans) {
    if (!ignoreSpans?.length || !span.description) {
        return false;
    }
    for (const pattern of ignoreSpans){
        if (isStringOrRegExp(pattern)) {
            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isMatchingPattern"])(span.description, pattern)) {
                __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && logIgnoredSpan(span);
                return true;
            }
            continue;
        }
        if (!pattern.name && !pattern.op) {
            continue;
        }
        const nameMatches = pattern.name ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isMatchingPattern"])(span.description, pattern.name) : true;
        const opMatches = pattern.op ? span.op && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isMatchingPattern"])(span.op, pattern.op) : true;
        // This check here is only correct because we can guarantee that we ran `isMatchingPattern`
        // for at least one of `nameMatches` and `opMatches`. So in contrary to how this looks,
        // not both op and name actually have to match. This is the most efficient way to check
        // for all combinations of name and op patterns.
        if (nameMatches && opMatches) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && logIgnoredSpan(span);
            return true;
        }
    }
    return false;
}
/**
 * Takes a list of spans, and a span that was dropped, and re-parents the child spans of the dropped span to the parent of the dropped span, if possible.
 * This mutates the spans array in place!
 */ function reparentChildSpans(spans, dropSpan) {
    const droppedSpanParentId = dropSpan.parent_span_id;
    const droppedSpanId = dropSpan.span_id;
    // This should generally not happen, as we do not apply this on root spans
    // but to be safe, we just bail in this case
    if (!droppedSpanParentId) {
        return;
    }
    for (const span of spans){
        if (span.parent_span_id === droppedSpanId) {
            span.parent_span_id = droppedSpanParentId;
        }
    }
}
function isStringOrRegExp(value) {
    return typeof value === 'string' || value instanceof RegExp;
}
;
 //# sourceMappingURL=should-ignore-span.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/envelope.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "_enhanceEventWithSdkInfo",
    ()=>_enhanceEventWithSdkInfo,
    "createEventEnvelope",
    ()=>createEventEnvelope,
    "createSessionEnvelope",
    ()=>createSessionEnvelope,
    "createSpanEnvelope",
    ()=>createSpanEnvelope
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/dynamicSamplingContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/dsn.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/envelope.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$should$2d$ignore$2d$span$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/should-ignore-span.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
/**
 * Apply SdkInfo (name, version, packages, integrations) to the corresponding event key.
 * Merge with existing data if any.
 *
 * @internal, exported only for testing
 **/ function _enhanceEventWithSdkInfo(event, newSdkInfo) {
    if (!newSdkInfo) {
        return event;
    }
    const eventSdkInfo = event.sdk || {};
    event.sdk = {
        ...eventSdkInfo,
        name: eventSdkInfo.name || newSdkInfo.name,
        version: eventSdkInfo.version || newSdkInfo.version,
        integrations: [
            ...event.sdk?.integrations || [],
            ...newSdkInfo.integrations || []
        ],
        packages: [
            ...event.sdk?.packages || [],
            ...newSdkInfo.packages || []
        ],
        settings: event.sdk?.settings || newSdkInfo.settings ? {
            ...event.sdk?.settings,
            ...newSdkInfo.settings
        } : undefined
    };
    return event;
}
/** Creates an envelope from a Session */ function createSessionEnvelope(session, dsn, metadata, tunnel) {
    const sdkInfo = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSdkMetadataForEnvelopeHeader"])(metadata);
    const envelopeHeaders = {
        sent_at: new Date().toISOString(),
        ...sdkInfo && {
            sdk: sdkInfo
        },
        ...!!tunnel && dsn && {
            dsn: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dsnToString"])(dsn)
        }
    };
    const envelopeItem = 'aggregates' in session ? [
        {
            type: 'sessions'
        },
        session
    ] : [
        {
            type: 'session'
        },
        session.toJSON()
    ];
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createEnvelope"])(envelopeHeaders, [
        envelopeItem
    ]);
}
/**
 * Create an Envelope from an event.
 */ function createEventEnvelope(event, dsn, metadata, tunnel) {
    const sdkInfo = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSdkMetadataForEnvelopeHeader"])(metadata);
    /*
    Note: Due to TS, event.type may be `replay_event`, theoretically.
    In practice, we never call `createEventEnvelope` with `replay_event` type,
    and we'd have to adjust a looot of types to make this work properly.
    We want to avoid casting this around, as that could lead to bugs (e.g. when we add another type)
    So the safe choice is to really guard against the replay_event type here.
  */ const eventType = event.type && event.type !== 'replay_event' ? event.type : 'event';
    _enhanceEventWithSdkInfo(event, metadata?.sdk);
    const envelopeHeaders = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createEventEnvelopeHeaders"])(event, sdkInfo, tunnel, dsn);
    // Prevent this data (which, if it exists, was used in earlier steps in the processing pipeline) from being sent to
    // sentry. (Note: Our use of this property comes and goes with whatever we might be debugging, whatever hacks we may
    // have temporarily added, etc. Even if we don't happen to be using it at some point in the future, let's not get rid
    // of this `delete`, lest we miss putting it back in the next time the property is in use.)
    delete event.sdkProcessingMetadata;
    const eventItem = [
        {
            type: eventType
        },
        event
    ];
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createEnvelope"])(envelopeHeaders, [
        eventItem
    ]);
}
/**
 * Create envelope from Span item.
 *
 * Takes an optional client and runs spans through `beforeSendSpan` if available.
 */ function createSpanEnvelope(spans, client) {
    function dscHasRequiredProps(dsc) {
        return !!dsc.trace_id && !!dsc.public_key;
    }
    // For the moment we'll obtain the DSC from the first span in the array
    // This might need to be changed if we permit sending multiple spans from
    // different segments in one envelope
    const dsc = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(spans[0]);
    const dsn = client?.getDsn();
    const tunnel = client?.getOptions().tunnel;
    const headers = {
        sent_at: new Date().toISOString(),
        ...dscHasRequiredProps(dsc) && {
            trace: dsc
        },
        ...!!tunnel && dsn && {
            dsn: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dsnToString"])(dsn)
        }
    };
    const { beforeSendSpan, ignoreSpans } = client?.getOptions() || {};
    const filteredSpans = ignoreSpans?.length ? spans.filter((span)=>!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$should$2d$ignore$2d$span$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["shouldIgnoreSpan"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span), ignoreSpans)) : spans;
    const droppedSpans = spans.length - filteredSpans.length;
    if (droppedSpans) {
        client?.recordDroppedEvent('before_send', 'span', droppedSpans);
    }
    const convertToSpanJSON = beforeSendSpan ? (span)=>{
        const spanJson = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span);
        const processedSpan = beforeSendSpan(spanJson);
        if (!processedSpan) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["showSpanDropWarning"])();
            return spanJson;
        }
        return processedSpan;
    } : __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"];
    const items = [];
    for (const span of filteredSpans){
        const spanJson = convertToSpanJSON(span);
        if (spanJson) {
            items.push((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createSpanEnvelopeItem"])(spanJson));
        }
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createEnvelope"])(headers, items);
}
;
 //# sourceMappingURL=envelope.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/measurement.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "setMeasurement",
    ()=>setMeasurement,
    "timedEventsToMeasurements",
    ()=>timedEventsToMeasurements
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
;
;
;
;
/**
 * Adds a measurement to the active transaction on the current global scope. You can optionally pass in a different span
 * as the 4th parameter.
 */ function setMeasurement(name, value, unit, activeSpan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getActiveSpan"])()) {
    const rootSpan = activeSpan && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(activeSpan);
    if (rootSpan) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`[Measurement] Setting measurement on root span: ${name} = ${value} ${unit}`);
        rootSpan.addEvent(name, {
            [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE"]]: value,
            [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT"]]: unit
        });
    }
}
/**
 * Convert timed events to measurements.
 */ function timedEventsToMeasurements(events) {
    if (!events || events.length === 0) {
        return undefined;
    }
    const measurements = {};
    events.forEach((event)=>{
        const attributes = event.attributes || {};
        const unit = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT"]];
        const value = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE"]];
        if (typeof unit === 'string' && typeof value === 'number') {
            measurements[event.name] = {
                value,
                unit
            };
        }
    });
    return measurements;
}
;
 //# sourceMappingURL=measurement.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/sentrySpan.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SentrySpan",
    ()=>SentrySpan
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/envelope.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/propagationContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/time.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/dynamicSamplingContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$logSpans$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/logSpans.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$measurement$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/measurement.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/utils.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
const MAX_SPAN_COUNT = 1000;
/**
 * Span contains all data about a span
 */ class SentrySpan {
    /** Epoch timestamp in seconds when the span started. */ /** Epoch timestamp in seconds when the span ended. */ /** Internal keeper of the status */ /** The timed events added to this span. */ /** if true, treat span as a standalone span (not part of a transaction) */ /**
   * You should never call the constructor manually, always use `Sentry.startSpan()`
   * or other span methods.
   * @internal
   * @hideconstructor
   * @hidden
   */ constructor(spanContext = {}){
        this._traceId = spanContext.traceId || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceId"])();
        this._spanId = spanContext.spanId || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateSpanId"])();
        this._startTime = spanContext.startTimestamp || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timestampInSeconds"])();
        this._links = spanContext.links;
        this._attributes = {};
        this.setAttributes({
            [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]]: 'manual',
            [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]]: spanContext.op,
            ...spanContext.attributes
        });
        this._name = spanContext.name;
        if (spanContext.parentSpanId) {
            this._parentSpanId = spanContext.parentSpanId;
        }
        // We want to include booleans as well here
        if ('sampled' in spanContext) {
            this._sampled = spanContext.sampled;
        }
        if (spanContext.endTimestamp) {
            this._endTime = spanContext.endTimestamp;
        }
        this._events = [];
        this._isStandaloneSpan = spanContext.isStandalone;
        // If the span is already ended, ensure we finalize the span immediately
        if (this._endTime) {
            this._onSpanEnded();
        }
    }
    /** @inheritDoc */ addLink(link) {
        if (this._links) {
            this._links.push(link);
        } else {
            this._links = [
                link
            ];
        }
        return this;
    }
    /** @inheritDoc */ addLinks(links) {
        if (this._links) {
            this._links.push(...links);
        } else {
            this._links = links;
        }
        return this;
    }
    /**
   * This should generally not be used,
   * but it is needed for being compliant with the OTEL Span interface.
   *
   * @hidden
   * @internal
   */ recordException(_exception, _time) {
    // noop
    }
    /** @inheritdoc */ spanContext() {
        const { _spanId: spanId, _traceId: traceId, _sampled: sampled } = this;
        return {
            spanId,
            traceId,
            traceFlags: sampled ? __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TRACE_FLAG_SAMPLED"] : __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TRACE_FLAG_NONE"]
        };
    }
    /** @inheritdoc */ setAttribute(key, value) {
        if (value === undefined) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete this._attributes[key];
        } else {
            this._attributes[key] = value;
        }
        return this;
    }
    /** @inheritdoc */ setAttributes(attributes) {
        Object.keys(attributes).forEach((key)=>this.setAttribute(key, attributes[key]));
        return this;
    }
    /**
   * This should generally not be used,
   * but we need it for browser tracing where we want to adjust the start time afterwards.
   * USE THIS WITH CAUTION!
   *
   * @hidden
   * @internal
   */ updateStartTime(timeInput) {
        this._startTime = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanTimeInputToSeconds"])(timeInput);
    }
    /**
   * @inheritDoc
   */ setStatus(value) {
        this._status = value;
        return this;
    }
    /**
   * @inheritDoc
   */ updateName(name) {
        this._name = name;
        this.setAttribute(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"], 'custom');
        return this;
    }
    /** @inheritdoc */ end(endTimestamp) {
        // If already ended, skip
        if (this._endTime) {
            return;
        }
        this._endTime = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanTimeInputToSeconds"])(endTimestamp);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$logSpans$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["logSpanEnd"])(this);
        this._onSpanEnded();
    }
    /**
   * Get JSON representation of this span.
   *
   * @hidden
   * @internal This method is purely for internal purposes and should not be used outside
   * of SDK code. If you need to get a JSON representation of a span,
   * use `spanToJSON(span)` instead.
   */ getSpanJSON() {
        return {
            data: this._attributes,
            description: this._name,
            op: this._attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]],
            parent_span_id: this._parentSpanId,
            span_id: this._spanId,
            start_timestamp: this._startTime,
            status: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getStatusMessage"])(this._status),
            timestamp: this._endTime,
            trace_id: this._traceId,
            origin: this._attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]],
            profile_id: this._attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_PROFILE_ID"]],
            exclusive_time: this._attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME"]],
            measurements: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$measurement$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timedEventsToMeasurements"])(this._events),
            is_segment: this._isStandaloneSpan && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(this) === this || undefined,
            segment_id: this._isStandaloneSpan ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(this).spanContext().spanId : undefined,
            links: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["convertSpanLinksForEnvelope"])(this._links)
        };
    }
    /** @inheritdoc */ isRecording() {
        return !this._endTime && !!this._sampled;
    }
    /**
   * @inheritdoc
   */ addEvent(name, attributesOrStartTime, startTime) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('[Tracing] Adding an event to span:', name);
        const time = isSpanTimeInput(attributesOrStartTime) ? attributesOrStartTime : startTime || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timestampInSeconds"])();
        const attributes = isSpanTimeInput(attributesOrStartTime) ? {} : attributesOrStartTime || {};
        const event = {
            name,
            time: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanTimeInputToSeconds"])(time),
            attributes
        };
        this._events.push(event);
        return this;
    }
    /**
   * This method should generally not be used,
   * but for now we need a way to publicly check if the `_isStandaloneSpan` flag is set.
   * USE THIS WITH CAUTION!
   * @internal
   * @hidden
   * @experimental
   */ isStandaloneSpan() {
        return !!this._isStandaloneSpan;
    }
    /** Emit `spanEnd` when the span is ended. */ _onSpanEnded() {
        const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
        if (client) {
            client.emit('spanEnd', this);
        }
        // A segment span is basically the root span of a local span tree.
        // So for now, this is either what we previously refer to as the root span,
        // or a standalone span.
        const isSegmentSpan = this._isStandaloneSpan || this === (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(this);
        if (!isSegmentSpan) {
            return;
        }
        // if this is a standalone span, we send it immediately
        if (this._isStandaloneSpan) {
            if (this._sampled) {
                sendSpanEnvelope((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createSpanEnvelope"])([
                    this
                ], client));
            } else {
                __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('[Tracing] Discarding standalone span because its trace was not chosen to be sampled.');
                if (client) {
                    client.recordDroppedEvent('sample_rate', 'span');
                }
            }
            return;
        }
        const transactionEvent = this._convertSpanToTransaction();
        if (transactionEvent) {
            const scope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCapturedScopesOnSpan"])(this).scope || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])();
            scope.captureEvent(transactionEvent);
        }
    }
    /**
   * Finish the transaction & prepare the event to send to Sentry.
   */ _convertSpanToTransaction() {
        // We can only convert finished spans
        if (!isFullFinishedSpan((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(this))) {
            return undefined;
        }
        if (!this._name) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('Transaction has no name, falling back to `<unlabeled transaction>`.');
            this._name = '<unlabeled transaction>';
        }
        const { scope: capturedSpanScope, isolationScope: capturedSpanIsolationScope } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCapturedScopesOnSpan"])(this);
        const normalizedRequest = capturedSpanScope?.getScopeData().sdkProcessingMetadata?.normalizedRequest;
        if (this._sampled !== true) {
            return undefined;
        }
        // The transaction span itself as well as any potential standalone spans should be filtered out
        const finishedSpans = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSpanDescendants"])(this).filter((span)=>span !== this && !isStandaloneSpan(span));
        const spans = finishedSpans.map((span)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span)).filter(isFullFinishedSpan);
        const source = this._attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]];
        // remove internal root span attributes we don't need to send.
        /* eslint-disable @typescript-eslint/no-dynamic-delete */ delete this._attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME"]];
        spans.forEach((span)=>{
            delete span.data[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_CUSTOM_SPAN_NAME"]];
        });
        // eslint-enabled-next-line @typescript-eslint/no-dynamic-delete
        const transaction = {
            contexts: {
                trace: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToTransactionTraceContext"])(this)
            },
            spans: // spans.sort() mutates the array, but `spans` is already a copy so we can safely do this here
            // we do not use spans anymore after this point
            spans.length > MAX_SPAN_COUNT ? spans.sort((a, b)=>a.start_timestamp - b.start_timestamp).slice(0, MAX_SPAN_COUNT) : spans,
            start_timestamp: this._startTime,
            timestamp: this._endTime,
            transaction: this._name,
            type: 'transaction',
            sdkProcessingMetadata: {
                capturedSpanScope,
                capturedSpanIsolationScope,
                dynamicSamplingContext: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(this)
            },
            request: normalizedRequest,
            ...source && {
                transaction_info: {
                    source
                }
            }
        };
        const measurements = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$measurement$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timedEventsToMeasurements"])(this._events);
        const hasMeasurements = measurements && Object.keys(measurements).length;
        if (hasMeasurements) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('[Measurements] Adding measurements to transaction event', JSON.stringify(measurements, undefined, 2));
            transaction.measurements = measurements;
        }
        return transaction;
    }
}
function isSpanTimeInput(value) {
    return value && typeof value === 'number' || value instanceof Date || Array.isArray(value);
}
// We want to filter out any incomplete SpanJSON objects
function isFullFinishedSpan(input) {
    return !!input.start_timestamp && !!input.timestamp && !!input.span_id && !!input.trace_id;
}
/** `SentrySpan`s can be sent as a standalone span rather than belonging to a transaction */ function isStandaloneSpan(span) {
    return span instanceof SentrySpan && span.isStandaloneSpan();
}
/**
 * Sends a `SpanEnvelope`.
 *
 * Note: If the envelope's spans are dropped, e.g. via `beforeSendSpan`,
 * the envelope will not be sent either.
 */ function sendSpanEnvelope(envelope) {
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    if (!client) {
        return;
    }
    const spanItems = envelope[1];
    if (!spanItems || spanItems.length === 0) {
        client.recordDroppedEvent('before_send', 'span');
        return;
    }
    // sendEnvelope should not throw
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    client.sendEnvelope(envelope);
}
;
 //# sourceMappingURL=sentrySpan.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/trace.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "continueTrace",
    ()=>continueTrace,
    "startInactiveSpan",
    ()=>startInactiveSpan,
    "startNewTrace",
    ()=>startNewTrace,
    "startSpan",
    ()=>startSpan,
    "startSpanManual",
    ()=>startSpanManual,
    "suppressTracing",
    ()=>suppressTracing,
    "withActiveSpan",
    ()=>withActiveSpan
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/asyncContext/index.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/carrier.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/baggage.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$handleCallbackErrors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/handleCallbackErrors.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/hasSpansEnabled.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/parseSampleRate.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/propagationContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanOnScope.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/tracing.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/dynamicSamplingContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$logSpans$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/logSpans.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sampling$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/sampling.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sentryNonRecordingSpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/sentryNonRecordingSpan.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sentrySpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/sentrySpan.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/spanstatus.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/utils.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
/* eslint-disable max-lines */ const SUPPRESS_TRACING_KEY = '__SENTRY_SUPPRESS_TRACING__';
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
    const acs = getAcs();
    if (acs.startSpan) {
        return acs.startSpan(options, callback);
    }
    const spanArguments = parseSentrySpanArguments(options);
    const { forceTransaction, parentSpan: customParentSpan, scope: customScope } = options;
    // We still need to fork a potentially passed scope, as we set the active span on it
    // and we need to ensure that it is cleaned up properly once the span ends.
    const customForkedScope = customScope?.clone();
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["withScope"])(customForkedScope, ()=>{
        // If `options.parentSpan` is defined, we want to wrap the callback in `withActiveSpan`
        const wrapper = getActiveSpanWrapper(customParentSpan);
        return wrapper(()=>{
            const scope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])();
            const parentSpan = getParentSpan(scope, customParentSpan);
            const shouldSkipSpan = options.onlyIfParent && !parentSpan;
            const activeSpan = shouldSkipSpan ? new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sentryNonRecordingSpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SentryNonRecordingSpan"]() : createChildOrRootSpan({
                parentSpan,
                spanArguments,
                forceTransaction,
                scope
            });
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_setSpanForScope"])(scope, activeSpan);
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$handleCallbackErrors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["handleCallbackErrors"])(()=>callback(activeSpan), ()=>{
                // Only update the span status if it hasn't been changed yet, and the span is not yet finished
                const { status } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(activeSpan);
                if (activeSpan.isRecording() && (!status || status === 'ok')) {
                    activeSpan.setStatus({
                        code: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_ERROR"],
                        message: 'internal_error'
                    });
                }
            }, ()=>{
                activeSpan.end();
            });
        });
    });
}
/**
 * Similar to `Sentry.startSpan`. Wraps a function with a transaction/span, but does not finish the span
 * after the function is done automatically. Use `span.end()` to end the span.
 *
 * The created span is the active span and will be used as parent by other spans created inside the function
 * and can be accessed via `Sentry.getActiveSpan()`, as long as the function is executed while the scope is active.
 *
 * You'll always get a span passed to the callback,
 * it may just be a non-recording span if the span is not sampled or if tracing is disabled.
 */ function startSpanManual(options, callback) {
    const acs = getAcs();
    if (acs.startSpanManual) {
        return acs.startSpanManual(options, callback);
    }
    const spanArguments = parseSentrySpanArguments(options);
    const { forceTransaction, parentSpan: customParentSpan, scope: customScope } = options;
    const customForkedScope = customScope?.clone();
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["withScope"])(customForkedScope, ()=>{
        // If `options.parentSpan` is defined, we want to wrap the callback in `withActiveSpan`
        const wrapper = getActiveSpanWrapper(customParentSpan);
        return wrapper(()=>{
            const scope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])();
            const parentSpan = getParentSpan(scope, customParentSpan);
            const shouldSkipSpan = options.onlyIfParent && !parentSpan;
            const activeSpan = shouldSkipSpan ? new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sentryNonRecordingSpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SentryNonRecordingSpan"]() : createChildOrRootSpan({
                parentSpan,
                spanArguments,
                forceTransaction,
                scope
            });
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_setSpanForScope"])(scope, activeSpan);
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$handleCallbackErrors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["handleCallbackErrors"])(// We pass the `finish` function to the callback, so the user can finish the span manually
            // this is mainly here for historic purposes because previously, we instructed users to call
            // `finish` instead of `span.end()` to also clean up the scope. Nowadays, calling `span.end()`
            // or `finish` has the same effect and we simply leave it here to avoid breaking user code.
            ()=>callback(activeSpan, ()=>activeSpan.end()), ()=>{
                // Only update the span status if it hasn't been changed yet, and the span is not yet finished
                const { status } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(activeSpan);
                if (activeSpan.isRecording() && (!status || status === 'ok')) {
                    activeSpan.setStatus({
                        code: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_ERROR"],
                        message: 'internal_error'
                    });
                }
            });
        });
    });
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
    const acs = getAcs();
    if (acs.startInactiveSpan) {
        return acs.startInactiveSpan(options);
    }
    const spanArguments = parseSentrySpanArguments(options);
    const { forceTransaction, parentSpan: customParentSpan } = options;
    // If `options.scope` is defined, we use this as as a wrapper,
    // If `options.parentSpan` is defined, we want to wrap the callback in `withActiveSpan`
    const wrapper = options.scope ? (callback)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["withScope"])(options.scope, callback) : customParentSpan !== undefined ? (callback)=>withActiveSpan(customParentSpan, callback) : (callback)=>callback();
    return wrapper(()=>{
        const scope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])();
        const parentSpan = getParentSpan(scope, customParentSpan);
        const shouldSkipSpan = options.onlyIfParent && !parentSpan;
        if (shouldSkipSpan) {
            return new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sentryNonRecordingSpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SentryNonRecordingSpan"]();
        }
        return createChildOrRootSpan({
            parentSpan,
            spanArguments,
            forceTransaction,
            scope
        });
    });
}
/**
 * Continue a trace from `sentry-trace` and `baggage` values.
 * These values can be obtained from incoming request headers, or in the browser from `<meta name="sentry-trace">`
 * and `<meta name="baggage">` HTML tags.
 *
 * Spans started with `startSpan`, `startSpanManual` and `startInactiveSpan`, within the callback will automatically
 * be attached to the incoming trace.
 */ const continueTrace = (options, callback)=>{
    const carrier = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getMainCarrier"])();
    const acs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getAsyncContextStrategy"])(carrier);
    if (acs.continueTrace) {
        return acs.continueTrace(options, callback);
    }
    const { sentryTrace, baggage } = options;
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    const incomingDsc = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["baggageHeaderToDynamicSamplingContext"])(baggage);
    if (client && !(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["shouldContinueTrace"])(client, incomingDsc?.org_id)) {
        return startNewTrace(callback);
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["withScope"])((scope)=>{
        const propagationContext = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["propagationContextFromHeaders"])(sentryTrace, baggage);
        scope.setPropagationContext(propagationContext);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_setSpanForScope"])(scope, undefined);
        return callback();
    });
};
/**
 * Forks the current scope and sets the provided span as active span in the context of the provided callback. Can be
 * passed `null` to start an entirely new span tree.
 *
 * @param span Spans started in the context of the provided callback will be children of this span. If `null` is passed,
 * spans started within the callback will not be attached to a parent span.
 * @param callback Execution context in which the provided span will be active. Is passed the newly forked scope.
 * @returns the value returned from the provided callback function.
 */ function withActiveSpan(span, callback) {
    const acs = getAcs();
    if (acs.withActiveSpan) {
        return acs.withActiveSpan(span, callback);
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["withScope"])((scope)=>{
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_setSpanForScope"])(scope, span || undefined);
        return callback(scope);
    });
}
/** Suppress tracing in the given callback, ensuring no spans are generated inside of it. */ function suppressTracing(callback) {
    const acs = getAcs();
    if (acs.suppressTracing) {
        return acs.suppressTracing(callback);
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["withScope"])((scope)=>{
        // Note: We do not wait for the callback to finish before we reset the metadata
        // the reason for this is that otherwise, in the browser this can lead to very weird behavior
        // as there is only a single top scope, if the callback takes longer to finish,
        // other, unrelated spans may also be suppressed, which we do not want
        // so instead, we only suppress tracing synchronoysly in the browser
        scope.setSDKProcessingMetadata({
            [SUPPRESS_TRACING_KEY]: true
        });
        const res = callback();
        scope.setSDKProcessingMetadata({
            [SUPPRESS_TRACING_KEY]: undefined
        });
        return res;
    });
}
/**
 * Starts a new trace for the duration of the provided callback. Spans started within the
 * callback will be part of the new trace instead of a potentially previously started trace.
 *
 * Important: Only use this function if you want to override the default trace lifetime and
 * propagation mechanism of the SDK for the duration and scope of the provided callback.
 * The newly created trace will also be the root of a new distributed trace, for example if
 * you make http requests within the callback.
 * This function might be useful if the operation you want to instrument should not be part
 * of a potentially ongoing trace.
 *
 * Default behavior:
 * - Server-side: A new trace is started for each incoming request.
 * - Browser: A new trace is started for each page our route. Navigating to a new route
 *            or page will automatically create a new trace.
 */ function startNewTrace(callback) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["withScope"])((scope)=>{
        scope.setPropagationContext({
            traceId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$propagationContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceId"])(),
            sampleRand: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeMathRandom"])()
        });
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`Starting a new trace with id ${scope.getPropagationContext().traceId}`);
        return withActiveSpan(null, callback);
    });
}
function createChildOrRootSpan({ parentSpan, spanArguments, forceTransaction, scope }) {
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])()) {
        const span = new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sentryNonRecordingSpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SentryNonRecordingSpan"]();
        // If this is a root span, we ensure to freeze a DSC
        // So we can have at least partial data here
        if (forceTransaction || !parentSpan) {
            const dsc = {
                sampled: 'false',
                sample_rate: '0',
                transaction: spanArguments.name,
                ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(span)
            };
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["freezeDscOnSpan"])(span, dsc);
        }
        return span;
    }
    const isolationScope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])();
    let span;
    if (parentSpan && !forceTransaction) {
        span = _startChildSpan(parentSpan, scope, spanArguments);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addChildSpanToSpan"])(parentSpan, span);
    } else if (parentSpan) {
        // If we forced a transaction but have a parent span, make sure to continue from the parent span, not the scope
        const dsc = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(parentSpan);
        const { traceId, spanId: parentSpanId } = parentSpan.spanContext();
        const parentSampled = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanIsSampled"])(parentSpan);
        span = _startRootSpan({
            traceId,
            parentSpanId,
            ...spanArguments
        }, scope, parentSampled);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["freezeDscOnSpan"])(span, dsc);
    } else {
        const { traceId, dsc, parentSpanId, sampled: parentSampled } = {
            ...isolationScope.getPropagationContext(),
            ...scope.getPropagationContext()
        };
        span = _startRootSpan({
            traceId,
            parentSpanId,
            ...spanArguments
        }, scope, parentSampled);
        if (dsc) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["freezeDscOnSpan"])(span, dsc);
        }
    }
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$logSpans$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["logSpanStart"])(span);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["setCapturedScopesOnSpan"])(span, scope, isolationScope);
    return span;
}
/**
 * This converts StartSpanOptions to SentrySpanArguments.
 * For the most part (for now) we accept the same options,
 * but some of them need to be transformed.
 */ function parseSentrySpanArguments(options) {
    const exp = options.experimental || {};
    const initialCtx = {
        isStandalone: exp.standalone,
        ...options
    };
    if (options.startTime) {
        const ctx = {
            ...initialCtx
        };
        ctx.startTimestamp = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanTimeInputToSeconds"])(options.startTime);
        delete ctx.startTime;
        return ctx;
    }
    return initialCtx;
}
function getAcs() {
    const carrier = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getMainCarrier"])();
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getAsyncContextStrategy"])(carrier);
}
function _startRootSpan(spanArguments, scope, parentSampled) {
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    const options = client?.getOptions() || {};
    const { name = '' } = spanArguments;
    const mutableSpanSamplingData = {
        spanAttributes: {
            ...spanArguments.attributes
        },
        spanName: name,
        parentSampled
    };
    // we don't care about the decision for the moment; this is just a placeholder
    client?.emit('beforeSampling', mutableSpanSamplingData, {
        decision: false
    });
    // If hook consumers override the parentSampled flag, we will use that value instead of the actual one
    const finalParentSampled = mutableSpanSamplingData.parentSampled ?? parentSampled;
    const finalAttributes = mutableSpanSamplingData.spanAttributes;
    const currentPropagationContext = scope.getPropagationContext();
    const [sampled, sampleRate, localSampleRateWasApplied] = scope.getScopeData().sdkProcessingMetadata[SUPPRESS_TRACING_KEY] ? [
        false
    ] : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sampling$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["sampleSpan"])(options, {
        name,
        parentSampled: finalParentSampled,
        attributes: finalAttributes,
        parentSampleRate: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseSampleRate"])(currentPropagationContext.dsc?.sample_rate)
    }, currentPropagationContext.sampleRand);
    const rootSpan = new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sentrySpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SentrySpan"]({
        ...spanArguments,
        attributes: {
            [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]]: 'custom',
            [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE"]]: sampleRate !== undefined && localSampleRateWasApplied ? sampleRate : undefined,
            ...finalAttributes
        },
        sampled
    });
    if (!sampled && client) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('[Tracing] Discarding root span because its trace was not chosen to be sampled.');
        client.recordDroppedEvent('sample_rate', 'transaction');
    }
    if (client) {
        client.emit('spanStart', rootSpan);
    }
    return rootSpan;
}
/**
 * Creates a new `Span` while setting the current `Span.id` as `parentSpanId`.
 * This inherits the sampling decision from the parent span.
 */ function _startChildSpan(parentSpan, scope, spanArguments) {
    const { spanId, traceId } = parentSpan.spanContext();
    const sampled = scope.getScopeData().sdkProcessingMetadata[SUPPRESS_TRACING_KEY] ? false : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanIsSampled"])(parentSpan);
    const childSpan = sampled ? new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sentrySpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SentrySpan"]({
        ...spanArguments,
        parentSpanId: spanId,
        traceId,
        sampled
    }) : new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sentryNonRecordingSpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SentryNonRecordingSpan"]({
        traceId
    });
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addChildSpanToSpan"])(parentSpan, childSpan);
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    if (client) {
        client.emit('spanStart', childSpan);
        // If it has an endTimestamp, it's already ended
        if (spanArguments.endTimestamp) {
            client.emit('spanEnd', childSpan);
        }
    }
    return childSpan;
}
function getParentSpan(scope, customParentSpan) {
    // always use the passed in span directly
    if (customParentSpan) {
        return customParentSpan;
    }
    // This is different from `undefined` as it means the user explicitly wants no parent span
    if (customParentSpan === null) {
        return undefined;
    }
    const span = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_getSpanForScope"])(scope);
    if (!span) {
        return undefined;
    }
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    const options = client ? client.getOptions() : {};
    if (options.parentSpanIsAlwaysRootSpan) {
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(span);
    }
    return span;
}
function getActiveSpanWrapper(parentSpan) {
    return parentSpan !== undefined ? (callback)=>{
        return withActiveSpan(parentSpan, callback);
    } : (callback)=>callback();
}
;
 //# sourceMappingURL=trace.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/syncpromise.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SyncPromise",
    ()=>SyncPromise,
    "rejectedSyncPromise",
    ()=>rejectedSyncPromise,
    "resolvedSyncPromise",
    ()=>resolvedSyncPromise
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
;
/* eslint-disable @typescript-eslint/no-explicit-any */ /** SyncPromise internal states */ const STATE_PENDING = 0;
const STATE_RESOLVED = 1;
const STATE_REJECTED = 2;
/**
 * Creates a resolved sync promise.
 *
 * @param value the value to resolve the promise with
 * @returns the resolved sync promise
 */ function resolvedSyncPromise(value) {
    return new SyncPromise((resolve)=>{
        resolve(value);
    });
}
/**
 * Creates a rejected sync promise.
 *
 * @param value the value to reject the promise with
 * @returns the rejected sync promise
 */ function rejectedSyncPromise(reason) {
    return new SyncPromise((_, reject)=>{
        reject(reason);
    });
}
/**
 * Thenable class that behaves like a Promise and follows it's interface
 * but is not async internally
 */ class SyncPromise {
    constructor(executor){
        this._state = STATE_PENDING;
        this._handlers = [];
        this._runExecutor(executor);
    }
    /** @inheritdoc */ then(onfulfilled, onrejected) {
        return new SyncPromise((resolve, reject)=>{
            this._handlers.push([
                false,
                (result)=>{
                    if (!onfulfilled) {
                        // TODO: ¯\_(ツ)_/¯
                        // TODO: FIXME
                        resolve(result);
                    } else {
                        try {
                            resolve(onfulfilled(result));
                        } catch (e) {
                            reject(e);
                        }
                    }
                },
                (reason)=>{
                    if (!onrejected) {
                        reject(reason);
                    } else {
                        try {
                            resolve(onrejected(reason));
                        } catch (e) {
                            reject(e);
                        }
                    }
                }
            ]);
            this._executeHandlers();
        });
    }
    /** @inheritdoc */ catch(onrejected) {
        return this.then((val)=>val, onrejected);
    }
    /** @inheritdoc */ finally(onfinally) {
        return new SyncPromise((resolve, reject)=>{
            let val;
            let isRejected;
            return this.then((value)=>{
                isRejected = false;
                val = value;
                if (onfinally) {
                    onfinally();
                }
            }, (reason)=>{
                isRejected = true;
                val = reason;
                if (onfinally) {
                    onfinally();
                }
            }).then(()=>{
                if (isRejected) {
                    reject(val);
                    return;
                }
                resolve(val);
            });
        });
    }
    /** Excute the resolve/reject handlers. */ _executeHandlers() {
        if (this._state === STATE_PENDING) {
            return;
        }
        const cachedHandlers = this._handlers.slice();
        this._handlers = [];
        cachedHandlers.forEach((handler)=>{
            if (handler[0]) {
                return;
            }
            if (this._state === STATE_RESOLVED) {
                handler[1](this._value);
            }
            if (this._state === STATE_REJECTED) {
                handler[2](this._value);
            }
            handler[0] = true;
        });
    }
    /** Run the executor for the SyncPromise. */ _runExecutor(executor) {
        const setResult = (state, value)=>{
            if (this._state !== STATE_PENDING) {
                return;
            }
            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isThenable"])(value)) {
                void value.then(resolve, reject);
                return;
            }
            this._state = state;
            this._value = value;
            this._executeHandlers();
        };
        const resolve = (value)=>{
            setResult(STATE_RESOLVED, value);
        };
        const reject = (reason)=>{
            setResult(STATE_REJECTED, reason);
        };
        try {
            executor(resolve, reject);
        } catch (e) {
            reject(e);
        }
    }
}
;
 //# sourceMappingURL=syncpromise.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/eventProcessors.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "notifyEventProcessors",
    ()=>notifyEventProcessors
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$syncpromise$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/syncpromise.js [instrumentation-edge] (ecmascript)");
;
;
;
;
/**
 * Process an array of event processors, returning the processed event (or `null` if the event was dropped).
 */ function notifyEventProcessors(processors, event, hint, index = 0) {
    try {
        const result = _notifyEventProcessors(event, hint, processors, index);
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isThenable"])(result) ? result : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$syncpromise$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["resolvedSyncPromise"])(result);
    } catch (error) {
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$syncpromise$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["rejectedSyncPromise"])(error);
    }
}
function _notifyEventProcessors(event, hint, processors, index) {
    const processor = processors[index];
    if (!event || !processor) {
        return event;
    }
    const result = processor({
        ...event
    }, hint);
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && result === null && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`Event processor "${processor.id || '?'}" dropped event`);
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isThenable"])(result)) {
        return result.then((final)=>_notifyEventProcessors(final, hint, processors, index + 1));
    }
    return _notifyEventProcessors(result, hint, processors, index + 1);
}
;
 //# sourceMappingURL=eventProcessors.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-ids.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getDebugImagesForResources",
    ()=>getDebugImagesForResources,
    "getFilenameToDebugIdMap",
    ()=>getFilenameToDebugIdMap
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/stacktrace.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
;
let parsedStackResults;
let lastSentryKeysCount;
let lastNativeKeysCount;
let cachedFilenameDebugIds;
/**
 * Returns a map of filenames to debug identifiers.
 * Supports both proprietary _sentryDebugIds and native _debugIds (e.g., from Vercel) formats.
 */ function getFilenameToDebugIdMap(stackParser) {
    const sentryDebugIdMap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"]._sentryDebugIds;
    const nativeDebugIdMap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"]._debugIds;
    if (!sentryDebugIdMap && !nativeDebugIdMap) {
        return {};
    }
    const sentryDebugIdKeys = sentryDebugIdMap ? Object.keys(sentryDebugIdMap) : [];
    const nativeDebugIdKeys = nativeDebugIdMap ? Object.keys(nativeDebugIdMap) : [];
    // If the count of registered globals hasn't changed since the last call, we
    // can just return the cached result.
    if (cachedFilenameDebugIds && sentryDebugIdKeys.length === lastSentryKeysCount && nativeDebugIdKeys.length === lastNativeKeysCount) {
        return cachedFilenameDebugIds;
    }
    lastSentryKeysCount = sentryDebugIdKeys.length;
    lastNativeKeysCount = nativeDebugIdKeys.length;
    // Build a map of filename -> debug_id from both sources
    cachedFilenameDebugIds = {};
    if (!parsedStackResults) {
        parsedStackResults = {};
    }
    const processDebugIds = (debugIdKeys, debugIdMap)=>{
        for (const key of debugIdKeys){
            const debugId = debugIdMap[key];
            const result = parsedStackResults?.[key];
            if (result && cachedFilenameDebugIds && debugId) {
                // Use cached filename but update with current debug ID
                cachedFilenameDebugIds[result[0]] = debugId;
                // Update cached result with new debug ID
                if (parsedStackResults) {
                    parsedStackResults[key] = [
                        result[0],
                        debugId
                    ];
                }
            } else if (debugId) {
                const parsedStack = stackParser(key);
                for(let i = parsedStack.length - 1; i >= 0; i--){
                    const stackFrame = parsedStack[i];
                    const filename = stackFrame?.filename;
                    if (filename && cachedFilenameDebugIds && parsedStackResults) {
                        cachedFilenameDebugIds[filename] = debugId;
                        parsedStackResults[key] = [
                            filename,
                            debugId
                        ];
                        break;
                    }
                }
            }
        }
    };
    if (sentryDebugIdMap) {
        processDebugIds(sentryDebugIdKeys, sentryDebugIdMap);
    }
    // Native _debugIds will override _sentryDebugIds if same file
    if (nativeDebugIdMap) {
        processDebugIds(nativeDebugIdKeys, nativeDebugIdMap);
    }
    return cachedFilenameDebugIds;
}
/**
 * Returns a list of debug images for the given resources.
 */ function getDebugImagesForResources(stackParser, resource_paths) {
    const filenameDebugIdMap = getFilenameToDebugIdMap(stackParser);
    if (!filenameDebugIdMap) {
        return [];
    }
    const images = [];
    for (const path of resource_paths){
        const normalizedPath = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["normalizeStackTracePath"])(path);
        if (normalizedPath && filenameDebugIdMap[normalizedPath]) {
            images.push({
                type: 'sourcemap',
                code_file: path,
                debug_id: filenameDebugIdMap[normalizedPath]
            });
        }
    }
    return images;
}
;
 //# sourceMappingURL=debug-ids.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/scopeData.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "applyScopeDataToEvent",
    ()=>applyScopeDataToEvent,
    "getCombinedScopeData",
    ()=>getCombinedScopeData,
    "mergeAndOverwriteScopeData",
    ()=>mergeAndOverwriteScopeData,
    "mergeScopeData",
    ()=>mergeScopeData
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/dynamicSamplingContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$merge$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/merge.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
;
;
;
;
/**
 * Applies data from the scope to the event and runs all event processors on it.
 */ function applyScopeDataToEvent(event, data) {
    const { fingerprint, span, breadcrumbs, sdkProcessingMetadata } = data;
    // Apply general data
    applyDataToEvent(event, data);
    // We want to set the trace context for normal events only if there isn't already
    // a trace context on the event. There is a product feature in place where we link
    // errors with transaction and it relies on that.
    if (span) {
        applySpanToEvent(event, span);
    }
    applyFingerprintToEvent(event, fingerprint);
    applyBreadcrumbsToEvent(event, breadcrumbs);
    applySdkMetadataToEvent(event, sdkProcessingMetadata);
}
/** Merge data of two scopes together. */ function mergeScopeData(data, mergeData) {
    const { extra, tags, attributes, user, contexts, level, sdkProcessingMetadata, breadcrumbs, fingerprint, eventProcessors, attachments, propagationContext, transactionName, span } = mergeData;
    mergeAndOverwriteScopeData(data, 'extra', extra);
    mergeAndOverwriteScopeData(data, 'tags', tags);
    mergeAndOverwriteScopeData(data, 'attributes', attributes);
    mergeAndOverwriteScopeData(data, 'user', user);
    mergeAndOverwriteScopeData(data, 'contexts', contexts);
    data.sdkProcessingMetadata = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$merge$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["merge"])(data.sdkProcessingMetadata, sdkProcessingMetadata, 2);
    if (level) {
        data.level = level;
    }
    if (transactionName) {
        data.transactionName = transactionName;
    }
    if (span) {
        data.span = span;
    }
    if (breadcrumbs.length) {
        data.breadcrumbs = [
            ...data.breadcrumbs,
            ...breadcrumbs
        ];
    }
    if (fingerprint.length) {
        data.fingerprint = [
            ...data.fingerprint,
            ...fingerprint
        ];
    }
    if (eventProcessors.length) {
        data.eventProcessors = [
            ...data.eventProcessors,
            ...eventProcessors
        ];
    }
    if (attachments.length) {
        data.attachments = [
            ...data.attachments,
            ...attachments
        ];
    }
    data.propagationContext = {
        ...data.propagationContext,
        ...propagationContext
    };
}
/**
 * Merges certain scope data. Undefined values will overwrite any existing values.
 * Exported only for tests.
 */ function mergeAndOverwriteScopeData(data, prop, mergeVal) {
    data[prop] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$merge$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["merge"])(data[prop], mergeVal, 1);
}
/**
 * Get the scope data for the current scope after merging with the
 * global scope and isolation scope.
 *
 * @param currentScope - The current scope.
 * @returns The scope data.
 */ function getCombinedScopeData(isolationScope, currentScope) {
    const scopeData = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getGlobalScope"])().getScopeData();
    isolationScope && mergeScopeData(scopeData, isolationScope.getScopeData());
    currentScope && mergeScopeData(scopeData, currentScope.getScopeData());
    return scopeData;
}
function applyDataToEvent(event, data) {
    const { extra, tags, user, contexts, level, transactionName } = data;
    if (Object.keys(extra).length) {
        event.extra = {
            ...extra,
            ...event.extra
        };
    }
    if (Object.keys(tags).length) {
        event.tags = {
            ...tags,
            ...event.tags
        };
    }
    if (Object.keys(user).length) {
        event.user = {
            ...user,
            ...event.user
        };
    }
    if (Object.keys(contexts).length) {
        event.contexts = {
            ...contexts,
            ...event.contexts
        };
    }
    if (level) {
        event.level = level;
    }
    // transaction events get their `transaction` from the root span name
    if (transactionName && event.type !== 'transaction') {
        event.transaction = transactionName;
    }
}
function applyBreadcrumbsToEvent(event, breadcrumbs) {
    const mergedBreadcrumbs = [
        ...event.breadcrumbs || [],
        ...breadcrumbs
    ];
    event.breadcrumbs = mergedBreadcrumbs.length ? mergedBreadcrumbs : undefined;
}
function applySdkMetadataToEvent(event, sdkProcessingMetadata) {
    event.sdkProcessingMetadata = {
        ...event.sdkProcessingMetadata,
        ...sdkProcessingMetadata
    };
}
function applySpanToEvent(event, span) {
    event.contexts = {
        trace: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToTraceContext"])(span),
        ...event.contexts
    };
    event.sdkProcessingMetadata = {
        dynamicSamplingContext: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(span),
        ...event.sdkProcessingMetadata
    };
    const rootSpan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(span);
    const transactionName = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(rootSpan).description;
    if (transactionName && !event.transaction && event.type === 'transaction') {
        event.transaction = transactionName;
    }
}
/**
 * Applies fingerprint from the scope to the event if there's one,
 * uses message if there's one instead or get rid of empty fingerprint
 */ function applyFingerprintToEvent(event, fingerprint) {
    // Make sure it's an array first and we actually have something in place
    event.fingerprint = event.fingerprint ? Array.isArray(event.fingerprint) ? event.fingerprint : [
        event.fingerprint
    ] : [];
    // If we have something on the scope, then merge it with event
    if (fingerprint) {
        event.fingerprint = event.fingerprint.concat(fingerprint);
    }
    // If we have no data at all, remove empty array default
    if (!event.fingerprint.length) {
        delete event.fingerprint;
    }
}
;
 //# sourceMappingURL=scopeData.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/prepareEvent.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "applyClientOptions",
    ()=>applyClientOptions,
    "applyDebugIds",
    ()=>applyDebugIds,
    "applyDebugMeta",
    ()=>applyDebugMeta,
    "parseEventHintOrCaptureContext",
    ()=>parseEventHintOrCaptureContext,
    "prepareEvent",
    ()=>prepareEvent
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/constants.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$eventProcessors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/eventProcessors.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$scope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/scope.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$ids$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-ids.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/misc.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/normalize.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$scopeData$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/scopeData.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/string.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$syncpromise$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/syncpromise.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/time.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
/**
 * This type makes sure that we get either a CaptureContext, OR an EventHint.
 * It does not allow mixing them, which could lead to unexpected outcomes, e.g. this is disallowed:
 * { user: { id: '123' }, mechanism: { handled: false } }
 */ /**
 * Adds common information to events.
 *
 * The information includes release and environment from `options`,
 * breadcrumbs and context (extra, tags and user) from the scope.
 *
 * Information that is already present in the event is never overwritten. For
 * nested objects, such as the context, keys are merged.
 *
 * @param event The original event.
 * @param hint May contain additional information about the original exception.
 * @param scope A scope containing event metadata.
 * @returns A new event with more information.
 * @hidden
 */ function prepareEvent(options, event, hint, scope, client, isolationScope) {
    const { normalizeDepth = 3, normalizeMaxBreadth = 1000 } = options;
    const prepared = {
        ...event,
        event_id: event.event_id || hint.event_id || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["uuid4"])(),
        timestamp: event.timestamp || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dateTimestampInSeconds"])()
    };
    const integrations = hint.integrations || options.integrations.map((i)=>i.name);
    applyClientOptions(prepared, options);
    applyIntegrationsMetadata(prepared, integrations);
    if (client) {
        client.emit('applyFrameMetadata', event);
    }
    // Only put debug IDs onto frames for error events.
    if (event.type === undefined) {
        applyDebugIds(prepared, options.stackParser);
    }
    // If we have scope given to us, use it as the base for further modifications.
    // This allows us to prevent unnecessary copying of data if `captureContext` is not provided.
    const finalScope = getFinalScope(scope, hint.captureContext);
    if (hint.mechanism) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addExceptionMechanism"])(prepared, hint.mechanism);
    }
    const clientEventProcessors = client ? client.getEventProcessors() : [];
    // This should be the last thing called, since we want that
    // {@link Scope.addEventProcessor} gets the finished prepared event.
    // Merge scope data together
    const data = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$scopeData$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCombinedScopeData"])(isolationScope, finalScope);
    const attachments = [
        ...hint.attachments || [],
        ...data.attachments
    ];
    if (attachments.length) {
        hint.attachments = attachments;
    }
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$scopeData$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["applyScopeDataToEvent"])(prepared, data);
    const eventProcessors = [
        ...clientEventProcessors,
        // Run scope event processors _after_ all other processors
        ...data.eventProcessors
    ];
    // Skip event processors for internal exceptions to prevent recursion
    const isInternalException = hint.data && hint.data.__sentry__ === true;
    const result = isInternalException ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$syncpromise$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["resolvedSyncPromise"])(prepared) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$eventProcessors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["notifyEventProcessors"])(eventProcessors, prepared, hint);
    return result.then((evt)=>{
        if (evt) {
            // We apply the debug_meta field only after all event processors have ran, so that if any event processors modified
            // file names (e.g.the RewriteFrames integration) the filename -> debug ID relationship isn't destroyed.
            // This should not cause any PII issues, since we're only moving data that is already on the event and not adding
            // any new data
            applyDebugMeta(evt);
        }
        if (typeof normalizeDepth === 'number' && normalizeDepth > 0) {
            return normalizeEvent(evt, normalizeDepth, normalizeMaxBreadth);
        }
        return evt;
    });
}
/**
 * Enhances event using the client configuration.
 * It takes care of all "static" values like environment, release and `dist`,
 * as well as truncating overly long values.
 *
 * Only exported for tests.
 *
 * @param event event instance to be enhanced
 */ function applyClientOptions(event, options) {
    const { environment, release, dist, maxValueLength } = options;
    // empty strings do not make sense for environment, release, and dist
    // so we handle them the same as if they were not provided
    event.environment = event.environment || environment || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEFAULT_ENVIRONMENT"];
    if (!event.release && release) {
        event.release = release;
    }
    if (!event.dist && dist) {
        event.dist = dist;
    }
    const request = event.request;
    if (request?.url && maxValueLength) {
        request.url = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["truncate"])(request.url, maxValueLength);
    }
    if (maxValueLength) {
        event.exception?.values?.forEach((exception)=>{
            if (exception.value) {
                // Truncates error messages
                exception.value = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["truncate"])(exception.value, maxValueLength);
            }
        });
    }
}
/**
 * Puts debug IDs into the stack frames of an error event.
 */ function applyDebugIds(event, stackParser) {
    // Build a map of filename -> debug_id
    const filenameDebugIdMap = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$ids$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getFilenameToDebugIdMap"])(stackParser);
    event.exception?.values?.forEach((exception)=>{
        exception.stacktrace?.frames?.forEach((frame)=>{
            if (frame.filename) {
                frame.debug_id = filenameDebugIdMap[frame.filename];
            }
        });
    });
}
/**
 * Moves debug IDs from the stack frames of an error event into the debug_meta field.
 */ function applyDebugMeta(event) {
    // Extract debug IDs and filenames from the stack frames on the event.
    const filenameDebugIdMap = {};
    event.exception?.values?.forEach((exception)=>{
        exception.stacktrace?.frames?.forEach((frame)=>{
            if (frame.debug_id) {
                if (frame.abs_path) {
                    filenameDebugIdMap[frame.abs_path] = frame.debug_id;
                } else if (frame.filename) {
                    filenameDebugIdMap[frame.filename] = frame.debug_id;
                }
                delete frame.debug_id;
            }
        });
    });
    if (Object.keys(filenameDebugIdMap).length === 0) {
        return;
    }
    // Fill debug_meta information
    event.debug_meta = event.debug_meta || {};
    event.debug_meta.images = event.debug_meta.images || [];
    const images = event.debug_meta.images;
    Object.entries(filenameDebugIdMap).forEach(([filename, debug_id])=>{
        images.push({
            type: 'sourcemap',
            code_file: filename,
            debug_id
        });
    });
}
/**
 * This function adds all used integrations to the SDK info in the event.
 * @param event The event that will be filled with all integrations.
 */ function applyIntegrationsMetadata(event, integrationNames) {
    if (integrationNames.length > 0) {
        event.sdk = event.sdk || {};
        event.sdk.integrations = [
            ...event.sdk.integrations || [],
            ...integrationNames
        ];
    }
}
/**
 * Applies `normalize` function on necessary `Event` attributes to make them safe for serialization.
 * Normalized keys:
 * - `breadcrumbs.data`
 * - `user`
 * - `contexts`
 * - `extra`
 * @param event Event
 * @returns Normalized event
 */ function normalizeEvent(event, depth, maxBreadth) {
    if (!event) {
        return null;
    }
    const normalized = {
        ...event,
        ...event.breadcrumbs && {
            breadcrumbs: event.breadcrumbs.map((b)=>({
                    ...b,
                    ...b.data && {
                        data: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["normalize"])(b.data, depth, maxBreadth)
                    }
                }))
        },
        ...event.user && {
            user: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["normalize"])(event.user, depth, maxBreadth)
        },
        ...event.contexts && {
            contexts: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["normalize"])(event.contexts, depth, maxBreadth)
        },
        ...event.extra && {
            extra: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["normalize"])(event.extra, depth, maxBreadth)
        }
    };
    // event.contexts.trace stores information about a Transaction. Similarly,
    // event.spans[] stores information about child Spans. Given that a
    // Transaction is conceptually a Span, normalization should apply to both
    // Transactions and Spans consistently.
    // For now the decision is to skip normalization of Transactions and Spans,
    // so this block overwrites the normalized event to add back the original
    // Transaction information prior to normalization.
    if (event.contexts?.trace && normalized.contexts) {
        normalized.contexts.trace = event.contexts.trace;
        // event.contexts.trace.data may contain circular/dangerous data so we need to normalize it
        if (event.contexts.trace.data) {
            normalized.contexts.trace.data = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["normalize"])(event.contexts.trace.data, depth, maxBreadth);
        }
    }
    // event.spans[].data may contain circular/dangerous data so we need to normalize it
    if (event.spans) {
        normalized.spans = event.spans.map((span)=>{
            return {
                ...span,
                ...span.data && {
                    data: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["normalize"])(span.data, depth, maxBreadth)
                }
            };
        });
    }
    // event.contexts.flags (FeatureFlagContext) stores context for our feature
    // flag integrations. It has a greater nesting depth than our other typed
    // Contexts, so we re-normalize with a fixed depth of 3 here. We do not want
    // to skip this in case of conflicting, user-provided context.
    if (event.contexts?.flags && normalized.contexts) {
        normalized.contexts.flags = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["normalize"])(event.contexts.flags, 3, maxBreadth);
    }
    return normalized;
}
function getFinalScope(scope, captureContext) {
    if (!captureContext) {
        return scope;
    }
    const finalScope = scope ? scope.clone() : new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$scope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["Scope"]();
    finalScope.update(captureContext);
    return finalScope;
}
/**
 * Parse either an `EventHint` directly, or convert a `CaptureContext` to an `EventHint`.
 * This is used to allow to update method signatures that used to accept a `CaptureContext` but should now accept an `EventHint`.
 */ function parseEventHintOrCaptureContext(hint) {
    if (!hint) {
        return undefined;
    }
    // If you pass a Scope or `() => Scope` as CaptureContext, we just return this as captureContext
    if (hintIsScopeOrFunction(hint)) {
        return {
            captureContext: hint
        };
    }
    if (hintIsScopeContext(hint)) {
        return {
            captureContext: hint
        };
    }
    return hint;
}
function hintIsScopeOrFunction(hint) {
    return hint instanceof __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$scope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["Scope"] || typeof hint === 'function';
}
const captureContextKeys = [
    'user',
    'level',
    'extra',
    'contexts',
    'tags',
    'fingerprint',
    'propagationContext'
];
function hintIsScopeContext(hint) {
    return Object.keys(hint).some((key)=>captureContextKeys.includes(key));
}
;
 //# sourceMappingURL=prepareEvent.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/exports.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addEventProcessor",
    ()=>addEventProcessor,
    "captureCheckIn",
    ()=>captureCheckIn,
    "captureEvent",
    ()=>captureEvent,
    "captureException",
    ()=>captureException,
    "captureMessage",
    ()=>captureMessage,
    "captureSession",
    ()=>captureSession,
    "close",
    ()=>close,
    "endSession",
    ()=>endSession,
    "flush",
    ()=>flush,
    "isEnabled",
    ()=>isEnabled,
    "isInitialized",
    ()=>isInitialized,
    "lastEventId",
    ()=>lastEventId,
    "setContext",
    ()=>setContext,
    "setConversationId",
    ()=>setConversationId,
    "setExtra",
    ()=>setExtra,
    "setExtras",
    ()=>setExtras,
    "setTag",
    ()=>setTag,
    "setTags",
    ()=>setTags,
    "setUser",
    ()=>setUser,
    "startSession",
    ()=>startSession,
    "withMonitor",
    ()=>withMonitor
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$session$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/session.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/trace.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/misc.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$prepareEvent$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/prepareEvent.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$scopeData$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/scopeData.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/time.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
/**
 * Captures an exception event and sends it to Sentry.
 *
 * @param exception The exception to capture.
 * @param hint Optional additional data to attach to the Sentry event.
 * @returns the id of the captured Sentry event.
 */ function captureException(exception, hint) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])().captureException(exception, (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$prepareEvent$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseEventHintOrCaptureContext"])(hint));
}
/**
 * Captures a message event and sends it to Sentry.
 *
 * @param message The message to send to Sentry.
 * @param captureContext Define the level of the message or pass in additional data to attach to the message.
 * @returns the id of the captured message.
 */ function captureMessage(message, captureContext) {
    // This is necessary to provide explicit scopes upgrade, without changing the original
    // arity of the `captureMessage(message, level)` method.
    const level = typeof captureContext === 'string' ? captureContext : undefined;
    const hint = typeof captureContext !== 'string' ? {
        captureContext
    } : undefined;
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])().captureMessage(message, level, hint);
}
/**
 * Captures a manually created event and sends it to Sentry.
 *
 * @param event The event to send to Sentry.
 * @param hint Optional additional data to attach to the Sentry event.
 * @returns the id of the captured event.
 */ function captureEvent(event, hint) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])().captureEvent(event, hint);
}
/**
 * Sets context data with the given name.
 * @param name of the context
 * @param context Any kind of data. This data will be normalized.
 */ function setContext(name, context) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])().setContext(name, context);
}
/**
 * Set an object that will be merged sent as extra data with the event.
 * @param extras Extras object to merge into current context.
 */ function setExtras(extras) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])().setExtras(extras);
}
/**
 * Set key:value that will be sent as extra data with the event.
 * @param key String of extra
 * @param extra Any kind of data. This data will be normalized.
 */ function setExtra(key, extra) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])().setExtra(key, extra);
}
/**
 * Set an object that will be merged sent as tags data with the event.
 * @param tags Tags context object to merge into current context.
 */ function setTags(tags) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])().setTags(tags);
}
/**
 * Set key:value that will be sent as tags data with the event.
 *
 * Can also be used to unset a tag, by passing `undefined`.
 *
 * @param key String key of tag
 * @param value Value of tag
 */ function setTag(key, value) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])().setTag(key, value);
}
/**
 * Updates user context information for future events.
 *
 * @param user User context object to be set in the current context. Pass `null` to unset the user.
 */ function setUser(user) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])().setUser(user);
}
/**
 * Sets the conversation ID for the current isolation scope.
 *
 * @param conversationId The conversation ID to set. Pass `null` or `undefined` to unset the conversation ID.
 */ function setConversationId(conversationId) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])().setConversationId(conversationId);
}
/**
 * The last error event id of the isolation scope.
 *
 * Warning: This function really returns the last recorded error event id on the current
 * isolation scope. If you call this function after handling a certain error and another error
 * is captured in between, the last one is returned instead of the one you might expect.
 * Also, ids of events that were never sent to Sentry (for example because
 * they were dropped in `beforeSend`) could be returned.
 *
 * @returns The last event id of the isolation scope.
 */ function lastEventId() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])().lastEventId();
}
/**
 * Create a cron monitor check in and send it to Sentry.
 *
 * @param checkIn An object that describes a check in.
 * @param upsertMonitorConfig An optional object that describes a monitor config. Use this if you want
 * to create a monitor automatically when sending a check in.
 */ function captureCheckIn(checkIn, upsertMonitorConfig) {
    const scope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])();
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    if (!client) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('Cannot capture check-in. No client defined.');
    } else if (!client.captureCheckIn) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('Cannot capture check-in. Client does not support sending check-ins.');
    } else {
        return client.captureCheckIn(checkIn, upsertMonitorConfig, scope);
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["uuid4"])();
}
/**
 * Wraps a callback with a cron monitor check in. The check in will be sent to Sentry when the callback finishes.
 *
 * @param monitorSlug The distinct slug of the monitor.
 * @param callback Callback to be monitored
 * @param upsertMonitorConfig An optional object that describes a monitor config. Use this if you want
 * to create a monitor automatically when sending a check in.
 */ function withMonitor(monitorSlug, callback, upsertMonitorConfig) {
    function runCallback() {
        const checkInId = captureCheckIn({
            monitorSlug,
            status: 'in_progress'
        }, upsertMonitorConfig);
        const now = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timestampInSeconds"])();
        function finishCheckIn(status) {
            captureCheckIn({
                monitorSlug,
                status,
                checkInId,
                duration: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timestampInSeconds"])() - now
            });
        }
        // Default behavior without isolateTrace
        let maybePromiseResult;
        try {
            maybePromiseResult = callback();
        } catch (e) {
            finishCheckIn('error');
            throw e;
        }
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isThenable"])(maybePromiseResult)) {
            return maybePromiseResult.then((r)=>{
                finishCheckIn('ok');
                return r;
            }, (e)=>{
                finishCheckIn('error');
                throw e;
            });
        }
        finishCheckIn('ok');
        return maybePromiseResult;
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["withIsolationScope"])(()=>upsertMonitorConfig?.isolateTrace ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["startNewTrace"])(runCallback) : runCallback());
}
/**
 * Call `flush()` on the current client, if there is one. See {@link Client.flush}.
 *
 * @param timeout Maximum time in ms the client should wait to flush its event queue. Omitting this parameter will cause
 * the client to wait until all events are sent before resolving the promise.
 * @returns A promise which resolves to `true` if the queue successfully drains before the timeout, or `false` if it
 * doesn't (or if there's no client defined).
 */ async function flush(timeout) {
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    if (client) {
        return client.flush(timeout);
    }
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('Cannot flush events. No client defined.');
    return Promise.resolve(false);
}
/**
 * Call `close()` on the current client, if there is one. See {@link Client.close}.
 *
 * @param timeout Maximum time in ms the client should wait to flush its event queue before shutting down. Omitting this
 * parameter will cause the client to wait until all events are sent before disabling itself.
 * @returns A promise which resolves to `true` if the queue successfully drains before the timeout, or `false` if it
 * doesn't (or if there's no client defined).
 */ async function close(timeout) {
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    if (client) {
        return client.close(timeout);
    }
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('Cannot flush events and disable SDK. No client defined.');
    return Promise.resolve(false);
}
/**
 * Returns true if Sentry has been properly initialized.
 */ function isInitialized() {
    return !!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
}
/** If the SDK is initialized & enabled. */ function isEnabled() {
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    return client?.getOptions().enabled !== false && !!client?.getTransport();
}
/**
 * Add an event processor.
 * This will be added to the current isolation scope, ensuring any event that is processed in the current execution
 * context will have the processor applied.
 */ function addEventProcessor(callback) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])().addEventProcessor(callback);
}
/**
 * Start a session on the current isolation scope.
 *
 * @param context (optional) additional properties to be applied to the returned session object
 *
 * @returns the new active session
 */ function startSession(context) {
    const isolationScope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])();
    const { user } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$scopeData$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCombinedScopeData"])(isolationScope, (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])());
    // Will fetch userAgent if called from browser sdk
    const { userAgent } = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].navigator || {};
    const session = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$session$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["makeSession"])({
        user,
        ...userAgent && {
            userAgent
        },
        ...context
    });
    // End existing session if there's one
    const currentSession = isolationScope.getSession();
    if (currentSession?.status === 'ok') {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$session$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["updateSession"])(currentSession, {
            status: 'exited'
        });
    }
    endSession();
    // Afterwards we set the new session on the scope
    isolationScope.setSession(session);
    return session;
}
/**
 * End the session on the current isolation scope.
 */ function endSession() {
    const isolationScope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])();
    const currentScope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])();
    const session = currentScope.getSession() || isolationScope.getSession();
    if (session) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$session$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["closeSession"])(session);
    }
    _sendSessionUpdate();
    // the session is over; take it off of the scope
    isolationScope.setSession();
}
/**
 * Sends the current Session on the scope
 */ function _sendSessionUpdate() {
    const isolationScope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])();
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    const session = isolationScope.getSession();
    if (session && client) {
        client.captureSession(session);
    }
}
/**
 * Sends the current session on the scope to Sentry
 *
 * @param end If set the session will be marked as exited and removed from the scope.
 *            Defaults to `false`.
 */ function captureSession(end = false) {
    // both send the update and pull the session from the scope
    if (end) {
        endSession();
        return;
    }
    // only send the update
    _sendSessionUpdate();
}
;
 //# sourceMappingURL=exports.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/vercelWaitUntil.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "vercelWaitUntil",
    ()=>vercelWaitUntil
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
/**
 * Function that delays closing of a Vercel lambda until the provided promise is resolved.
 *
 * Vendored from https://www.npmjs.com/package/@vercel/functions
 */ function vercelWaitUntil(task) {
    // We only flush manually in Vercel Edge runtime
    // In Node runtime, we use process.on('SIGTERM') instead
    if (typeof ("TURBOPACK compile-time value", "edge-runtime") !== 'string') {
        return;
    }
    const vercelRequestContextGlobal = // @ts-expect-error This is not typed
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"][Symbol.for('@vercel/request-context')];
    const ctx = vercelRequestContextGlobal?.get?.();
    if (ctx?.waitUntil) {
        ctx.waitUntil(task);
    }
}
;
 //# sourceMappingURL=vercelWaitUntil.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/handlers.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addHandler",
    ()=>addHandler,
    "maybeInstrument",
    ()=>maybeInstrument,
    "resetInstrumentationHandlers",
    ()=>resetInstrumentationHandlers,
    "triggerHandlers",
    ()=>triggerHandlers
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/stacktrace.js [instrumentation-edge] (ecmascript)");
;
;
;
// We keep the handlers globally
const handlers = {};
const instrumented = {};
/** Add a handler function. */ function addHandler(type, handler) {
    handlers[type] = handlers[type] || [];
    handlers[type].push(handler);
}
/**
 * Reset all instrumentation handlers.
 * This can be used by tests to ensure we have a clean slate of instrumentation handlers.
 */ function resetInstrumentationHandlers() {
    Object.keys(handlers).forEach((key)=>{
        handlers[key] = undefined;
    });
}
/** Maybe run an instrumentation function, unless it was already called. */ function maybeInstrument(type, instrumentFn) {
    if (!instrumented[type]) {
        instrumented[type] = true;
        try {
            instrumentFn();
        } catch (e) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error(`Error while instrumenting ${type}`, e);
        }
    }
}
/** Trigger handlers for a given instrumentation type. */ function triggerHandlers(type, data) {
    const typeHandlers = type && handlers[type];
    if (!typeHandlers) {
        return;
    }
    for (const handler of typeHandlers){
        try {
            handler(data);
        } catch (e) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error(`Error while triggering instrumentation handler.\nType: ${type}\nName: ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getFunctionName"])(handler)}\nError:`, e);
        }
    }
}
;
 //# sourceMappingURL=handlers.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/console.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addConsoleInstrumentationHandler",
    ()=>addConsoleInstrumentationHandler
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/object.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/handlers.js [instrumentation-edge] (ecmascript)");
;
;
;
;
/**
 * Add an instrumentation handler for when a console.xxx method is called.
 *
 * Use at your own risk, this might break without changelog notice, only used internally.
 * @hidden
 */ function addConsoleInstrumentationHandler(handler) {
    const type = 'console';
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addHandler"])(type, handler);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["maybeInstrument"])(type, instrumentConsole);
}
function instrumentConsole() {
    if (!('console' in __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"])) {
        return;
    }
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["CONSOLE_LEVELS"].forEach(function(level) {
        if (!(level in __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].console)) {
            return;
        }
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["fill"])(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].console, level, function(originalConsoleMethod) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["originalConsoleMethods"][level] = originalConsoleMethod;
            return function(...args) {
                const handlerData = {
                    args,
                    level
                };
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["triggerHandlers"])('console', handlerData);
                const log = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["originalConsoleMethods"][level];
                log?.apply(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].console, args);
            };
        });
    });
}
;
 //# sourceMappingURL=console.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integration.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addIntegration",
    ()=>addIntegration,
    "afterSetupIntegrations",
    ()=>afterSetupIntegrations,
    "defineIntegration",
    ()=>defineIntegration,
    "getIntegrationsToSetup",
    ()=>getIntegrationsToSetup,
    "installedIntegrations",
    ()=>installedIntegrations,
    "setupIntegration",
    ()=>setupIntegration,
    "setupIntegrations",
    ()=>setupIntegrations
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
;
;
;
const installedIntegrations = [];
/** Map of integrations assigned to a client */ /**
 * Remove duplicates from the given array, preferring the last instance of any duplicate. Not guaranteed to
 * preserve the order of integrations in the array.
 *
 * @private
 */ function filterDuplicates(integrations) {
    const integrationsByName = {};
    integrations.forEach((currentInstance)=>{
        const { name } = currentInstance;
        const existingInstance = integrationsByName[name];
        // We want integrations later in the array to overwrite earlier ones of the same type, except that we never want a
        // default instance to overwrite an existing user instance
        if (existingInstance && !existingInstance.isDefaultInstance && currentInstance.isDefaultInstance) {
            return;
        }
        integrationsByName[name] = currentInstance;
    });
    return Object.values(integrationsByName);
}
/** Gets integrations to install */ function getIntegrationsToSetup(options) {
    const defaultIntegrations = options.defaultIntegrations || [];
    const userIntegrations = options.integrations;
    // We flag default instances, so that later we can tell them apart from any user-created instances of the same class
    defaultIntegrations.forEach((integration)=>{
        integration.isDefaultInstance = true;
    });
    let integrations;
    if (Array.isArray(userIntegrations)) {
        integrations = [
            ...defaultIntegrations,
            ...userIntegrations
        ];
    } else if (typeof userIntegrations === 'function') {
        const resolvedUserIntegrations = userIntegrations(defaultIntegrations);
        integrations = Array.isArray(resolvedUserIntegrations) ? resolvedUserIntegrations : [
            resolvedUserIntegrations
        ];
    } else {
        integrations = defaultIntegrations;
    }
    return filterDuplicates(integrations);
}
/**
 * Given a list of integration instances this installs them all. When `withDefaults` is set to `true` then all default
 * integrations are added unless they were already provided before.
 * @param integrations array of integration instances
 * @param withDefault should enable default integrations
 */ function setupIntegrations(client, integrations) {
    const integrationIndex = {};
    integrations.forEach((integration)=>{
        // guard against empty provided integrations
        if (integration) {
            setupIntegration(client, integration, integrationIndex);
        }
    });
    return integrationIndex;
}
/**
 * Execute the `afterAllSetup` hooks of the given integrations.
 */ function afterSetupIntegrations(client, integrations) {
    for (const integration of integrations){
        // guard against empty provided integrations
        if (integration?.afterAllSetup) {
            integration.afterAllSetup(client);
        }
    }
}
/** Setup a single integration.  */ function setupIntegration(client, integration, integrationIndex) {
    if (integrationIndex[integration.name]) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`Integration skipped because it was already installed: ${integration.name}`);
        return;
    }
    integrationIndex[integration.name] = integration;
    // `setupOnce` is only called the first time
    if (!installedIntegrations.includes(integration.name) && typeof integration.setupOnce === 'function') {
        integration.setupOnce();
        installedIntegrations.push(integration.name);
    }
    // `setup` is run for each client
    if (integration.setup && typeof integration.setup === 'function') {
        integration.setup(client);
    }
    if (typeof integration.preprocessEvent === 'function') {
        const callback = integration.preprocessEvent.bind(integration);
        client.on('preprocessEvent', (event, hint)=>callback(event, hint, client));
    }
    if (typeof integration.processEvent === 'function') {
        const callback = integration.processEvent.bind(integration);
        const processor = Object.assign((event, hint)=>callback(event, hint, client), {
            id: integration.name
        });
        client.addEventProcessor(processor);
    }
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`Integration installed: ${integration.name}`);
}
/** Add an integration to the current scope's client. */ function addIntegration(integration) {
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    if (!client) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(`Cannot add integration "${integration.name}" because no SDK Client is available.`);
        return;
    }
    client.addIntegration(integration);
}
/**
 * Define an integration function that can be used to create an integration instance.
 * Note that this by design hides the implementation details of the integration, as they are considered internal.
 */ function defineIntegration(fn) {
    return fn;
}
;
 //# sourceMappingURL=integration.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/attributes.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "attributeValueToTypedAttributeValue",
    ()=>attributeValueToTypedAttributeValue,
    "isAttributeObject",
    ()=>isAttributeObject,
    "serializeAttributes",
    ()=>serializeAttributes
]);
/**
 * Type-guard: The attribute object has the shape the official attribute object (value, type, unit).
 * https://develop.sentry.dev/sdk/telemetry/scopes/#setting-attributes
 */ function isAttributeObject(maybeObj) {
    return typeof maybeObj === 'object' && maybeObj != null && !Array.isArray(maybeObj) && Object.keys(maybeObj).includes('value');
}
/**
 * Converts an attribute value to a typed attribute value.
 *
 * For now, we intentionally only support primitive values and attribute objects with primitive values.
 * If @param useFallback is true, we stringify non-primitive values to a string attribute value. Otherwise
 * we return `undefined` for unsupported values.
 *
 * @param value - The value of the passed attribute.
 * @param useFallback - If true, unsupported values will be stringified to a string attribute value.
 *                      Defaults to false. In this case, `undefined` is returned for unsupported values.
 * @returns The typed attribute.
 */ function attributeValueToTypedAttributeValue(rawValue, useFallback) {
    const { value, unit } = isAttributeObject(rawValue) ? rawValue : {
        value: rawValue,
        unit: undefined
    };
    const attributeValue = getTypedAttributeValue(value);
    const checkedUnit = unit && typeof unit === 'string' ? {
        unit
    } : {};
    if (attributeValue) {
        return {
            ...attributeValue,
            ...checkedUnit
        };
    }
    if (!useFallback || useFallback === 'skip-undefined' && value === undefined) {
        return;
    }
    // Fallback: stringify the value
    // TODO(v11): be smarter here and use String constructor if stringify fails
    // (this is a breaking change for already existing attribute values)
    let stringValue = '';
    try {
        stringValue = JSON.stringify(value) ?? '';
    } catch  {
    // Do nothing
    }
    return {
        value: stringValue,
        type: 'string',
        ...checkedUnit
    };
}
/**
 * Serializes raw attributes to typed attributes as expected in our envelopes.
 *
 * @param attributes The raw attributes to serialize.
 * @param fallback   If true, unsupported values will be stringified to a string attribute value.
 *                   Defaults to false. In this case, `undefined` is returned for unsupported values.
 *
 * @returns The serialized attributes.
 */ function serializeAttributes(attributes, fallback = false) {
    const serializedAttributes = {};
    for (const [key, value] of Object.entries(attributes ?? {})){
        const typedValue = attributeValueToTypedAttributeValue(value, fallback);
        if (typedValue) {
            serializedAttributes[key] = typedValue;
        }
    }
    return serializedAttributes;
}
/**
 * NOTE: We intentionally do not return anything for non-primitive values:
 *  - array support will come in the future but if we stringify arrays now,
 *    sending arrays (unstringified) later will be a subtle breaking change.
 *  - Objects are not supported yet and product support is still TBD.
 *  - We still keep the type signature for TypedAttributeValue wider to avoid a
 *    breaking change once we add support for non-primitive values.
 *  - Once we go back to supporting arrays and stringifying all other values,
 *    we already implemented the serialization logic here:
 *    https://github.com/getsentry/sentry-javascript/pull/18165
 */ function getTypedAttributeValue(value) {
    const primitiveType = typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'boolean' : typeof value === 'number' && !Number.isNaN(value) ? Number.isInteger(value) ? 'integer' : 'double' : null;
    if (primitiveType) {
        // @ts-expect-error - TS complains because {@link TypedAttributeValue} is strictly typed to
        // avoid setting the wrong `type` on the attribute value.
        // In this case, getPrimitiveType already does the check but TS doesn't know that.
        // The "clean" alternative is to return an object per `typeof value` case
        // but that would require more bundle size
        // Therefore, we ignore it.
        return {
            value,
            type: primitiveType
        };
    }
}
;
 //# sourceMappingURL=attributes.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/trace-info.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "_getTraceInfoFromScope",
    ()=>_getTraceInfoFromScope
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/dynamicSamplingContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
;
;
;
/** Extract trace information from scope */ function _getTraceInfoFromScope(client, scope) {
    if (!scope) {
        return [
            undefined,
            undefined
        ];
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["withScope"])(scope, ()=>{
        const span = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getActiveSpan"])();
        const traceContext = span ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToTraceContext"])(span) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getTraceContextFromScope"])(scope);
        const dynamicSamplingContext = span ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(span) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromScope"])(client, scope);
        return [
            dynamicSamplingContext,
            traceContext
        ];
    });
}
;
 //# sourceMappingURL=trace-info.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/logs/constants.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SEVERITY_TEXT_TO_SEVERITY_NUMBER",
    ()=>SEVERITY_TEXT_TO_SEVERITY_NUMBER
]);
/**
 * Maps a log severity level to a log severity number.
 *
 * @see LogSeverityLevel
 */ const SEVERITY_TEXT_TO_SEVERITY_NUMBER = {
    trace: 1,
    debug: 5,
    info: 9,
    warn: 13,
    error: 17,
    fatal: 21
};
;
 //# sourceMappingURL=constants.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/logs/envelope.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createLogContainerEnvelopeItem",
    ()=>createLogContainerEnvelopeItem,
    "createLogEnvelope",
    ()=>createLogEnvelope
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/dsn.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/envelope.js [instrumentation-edge] (ecmascript)");
;
;
/**
 * Creates a log container envelope item for a list of logs.
 *
 * @param items - The logs to include in the envelope.
 * @returns The created log container envelope item.
 */ function createLogContainerEnvelopeItem(items) {
    return [
        {
            type: 'log',
            item_count: items.length,
            content_type: 'application/vnd.sentry.items.log+json'
        },
        {
            items
        }
    ];
}
/**
 * Creates an envelope for a list of logs.
 *
 * Logs from multiple traces can be included in the same envelope.
 *
 * @param logs - The logs to include in the envelope.
 * @param metadata - The metadata to include in the envelope.
 * @param tunnel - The tunnel to include in the envelope.
 * @param dsn - The DSN to include in the envelope.
 * @returns The created envelope.
 */ function createLogEnvelope(logs, metadata, tunnel, dsn) {
    const headers = {};
    if (metadata?.sdk) {
        headers.sdk = {
            name: metadata.sdk.name,
            version: metadata.sdk.version
        };
    }
    if (!!tunnel && !!dsn) {
        headers.dsn = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dsnToString"])(dsn);
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createEnvelope"])(headers, [
        createLogContainerEnvelopeItem(logs)
    ]);
}
;
 //# sourceMappingURL=envelope.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/logs/internal.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "_INTERNAL_captureLog",
    ()=>_INTERNAL_captureLog,
    "_INTERNAL_captureSerializedLog",
    ()=>_INTERNAL_captureSerializedLog,
    "_INTERNAL_flushLogsBuffer",
    ()=>_INTERNAL_flushLogsBuffer,
    "_INTERNAL_getLogBuffer",
    ()=>_INTERNAL_getLogBuffer
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/attributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/carrier.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$scopeData$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/scopeData.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanOnScope.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/time.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$trace$2d$info$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/trace-info.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/logs/constants.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/logs/envelope.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
const MAX_LOG_BUFFER_SIZE = 100;
/**
 * Sets a log attribute if the value exists and the attribute key is not already present.
 *
 * @param logAttributes - The log attributes object to modify.
 * @param key - The attribute key to set.
 * @param value - The value to set (only sets if truthy and key not present).
 * @param setEvenIfPresent - Whether to set the attribute if it is present. Defaults to true.
 */ function setLogAttribute(logAttributes, key, value, setEvenIfPresent = true) {
    if (value && (!logAttributes[key] || setEvenIfPresent)) {
        logAttributes[key] = value;
    }
}
/**
 * Captures a serialized log event and adds it to the log buffer for the given client.
 *
 * @param client - A client. Uses the current client if not provided.
 * @param serializedLog - The serialized log event to capture.
 *
 * @experimental This method will experience breaking changes. This is not yet part of
 * the stable Sentry SDK API and can be changed or removed without warning.
 */ function _INTERNAL_captureSerializedLog(client, serializedLog) {
    const bufferMap = _getBufferMap();
    const logBuffer = _INTERNAL_getLogBuffer(client);
    if (logBuffer === undefined) {
        bufferMap.set(client, [
            serializedLog
        ]);
    } else {
        if (logBuffer.length >= MAX_LOG_BUFFER_SIZE) {
            _INTERNAL_flushLogsBuffer(client, logBuffer);
            bufferMap.set(client, [
                serializedLog
            ]);
        } else {
            bufferMap.set(client, [
                ...logBuffer,
                serializedLog
            ]);
        }
    }
}
/**
 * Captures a log event and sends it to Sentry.
 *
 * @param log - The log event to capture.
 * @param scope - A scope. Uses the current scope if not provided.
 * @param client - A client. Uses the current client if not provided.
 * @param captureSerializedLog - A function to capture the serialized log.
 *
 * @experimental This method will experience breaking changes. This is not yet part of
 * the stable Sentry SDK API and can be changed or removed without warning.
 */ function _INTERNAL_captureLog(beforeLog, currentScope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])(), captureSerializedLog = _INTERNAL_captureSerializedLog) {
    const client = currentScope?.getClient() ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    if (!client) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('No client available to capture log.');
        return;
    }
    const { release, environment, enableLogs = false, beforeSendLog } = client.getOptions();
    if (!enableLogs) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('logging option not enabled, log will not be captured.');
        return;
    }
    const [, traceContext] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$trace$2d$info$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_getTraceInfoFromScope"])(client, currentScope);
    const processedLogAttributes = {
        ...beforeLog.attributes
    };
    const { user: { id, email, username }, attributes: scopeAttributes = {} } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$scopeData$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCombinedScopeData"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])(), currentScope);
    setLogAttribute(processedLogAttributes, 'user.id', id, false);
    setLogAttribute(processedLogAttributes, 'user.email', email, false);
    setLogAttribute(processedLogAttributes, 'user.name', username, false);
    setLogAttribute(processedLogAttributes, 'sentry.release', release);
    setLogAttribute(processedLogAttributes, 'sentry.environment', environment);
    const { name, version } = client.getSdkMetadata()?.sdk ?? {};
    setLogAttribute(processedLogAttributes, 'sentry.sdk.name', name);
    setLogAttribute(processedLogAttributes, 'sentry.sdk.version', version);
    const replay = client.getIntegrationByName('Replay');
    const replayId = replay?.getReplayId(true);
    setLogAttribute(processedLogAttributes, 'sentry.replay_id', replayId);
    if (replayId && replay?.getRecordingMode() === 'buffer') {
        // We send this so we can identify cases where the replayId is attached but the replay itself might not have been sent to Sentry
        setLogAttribute(processedLogAttributes, 'sentry._internal.replay_is_buffering', true);
    }
    const beforeLogMessage = beforeLog.message;
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isParameterizedString"])(beforeLogMessage)) {
        const { __sentry_template_string__, __sentry_template_values__ = [] } = beforeLogMessage;
        if (__sentry_template_values__?.length) {
            processedLogAttributes['sentry.message.template'] = __sentry_template_string__;
        }
        __sentry_template_values__.forEach((param, index)=>{
            processedLogAttributes[`sentry.message.parameter.${index}`] = param;
        });
    }
    const span = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_getSpanForScope"])(currentScope);
    // Add the parent span ID to the log attributes for trace context
    setLogAttribute(processedLogAttributes, 'sentry.trace.parent_span_id', span?.spanContext().spanId);
    const processedLog = {
        ...beforeLog,
        attributes: processedLogAttributes
    };
    client.emit('beforeCaptureLog', processedLog);
    // We need to wrap this in `consoleSandbox` to avoid recursive calls to `beforeSendLog`
    const log = beforeSendLog ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["consoleSandbox"])(()=>beforeSendLog(processedLog)) : processedLog;
    if (!log) {
        client.recordDroppedEvent('before_send', 'log_item', 1);
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('beforeSendLog returned null, log will not be captured.');
        return;
    }
    const { level, message, attributes: logAttributes = {}, severityNumber } = log;
    const serializedLog = {
        timestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timestampInSeconds"])(),
        level,
        body: message,
        trace_id: traceContext?.trace_id,
        severity_number: severityNumber ?? __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEVERITY_TEXT_TO_SEVERITY_NUMBER"][level],
        attributes: {
            ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["serializeAttributes"])(scopeAttributes),
            ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["serializeAttributes"])(logAttributes, true)
        }
    };
    captureSerializedLog(client, serializedLog);
    client.emit('afterCaptureLog', log);
}
/**
 * Flushes the logs buffer to Sentry.
 *
 * @param client - A client.
 * @param maybeLogBuffer - A log buffer. Uses the log buffer for the given client if not provided.
 *
 * @experimental This method will experience breaking changes. This is not yet part of
 * the stable Sentry SDK API and can be changed or removed without warning.
 */ function _INTERNAL_flushLogsBuffer(client, maybeLogBuffer) {
    const logBuffer = maybeLogBuffer ?? _INTERNAL_getLogBuffer(client) ?? [];
    if (logBuffer.length === 0) {
        return;
    }
    const clientOptions = client.getOptions();
    const envelope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createLogEnvelope"])(logBuffer, clientOptions._metadata, clientOptions.tunnel, client.getDsn());
    // Clear the log buffer after envelopes have been constructed.
    _getBufferMap().set(client, []);
    client.emit('flushLogs');
    // sendEnvelope should not throw
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    client.sendEnvelope(envelope);
}
/**
 * Returns the log buffer for a given client.
 *
 * Exported for testing purposes.
 *
 * @param client - The client to get the log buffer for.
 * @returns The log buffer for the given client.
 */ function _INTERNAL_getLogBuffer(client) {
    return _getBufferMap().get(client);
}
function _getBufferMap() {
    // The reference to the Client <> LogBuffer map is stored on the carrier to ensure it's always the same
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getGlobalSingleton"])('clientToLogBufferMap', ()=>new WeakMap());
}
;
 //# sourceMappingURL=internal.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/logs/utils.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createConsoleTemplateAttributes",
    ()=>createConsoleTemplateAttributes,
    "formatConsoleArgs",
    ()=>formatConsoleArgs,
    "hasConsoleSubstitutions",
    ()=>hasConsoleSubstitutions,
    "safeJoinConsoleArgs",
    ()=>safeJoinConsoleArgs
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/normalize.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
;
;
/**
 * Formats the given values into a string.
 *
 * @param values - The values to format.
 * @param normalizeDepth - The depth to normalize the values.
 * @param normalizeMaxBreadth - The max breadth to normalize the values.
 * @returns The formatted string.
 */ function formatConsoleArgs(values, normalizeDepth, normalizeMaxBreadth) {
    return 'util' in __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"] && typeof __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].util.format === 'function' ? __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].util.format(...values) : safeJoinConsoleArgs(values, normalizeDepth, normalizeMaxBreadth);
}
/**
 * Joins the given values into a string.
 *
 * @param values - The values to join.
 * @param normalizeDepth - The depth to normalize the values.
 * @param normalizeMaxBreadth - The max breadth to normalize the values.
 * @returns The joined string.
 */ function safeJoinConsoleArgs(values, normalizeDepth, normalizeMaxBreadth) {
    return values.map((value)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isPrimitive"])(value) ? String(value) : JSON.stringify((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["normalize"])(value, normalizeDepth, normalizeMaxBreadth))).join(' ');
}
/**
 * Checks if a string contains console substitution patterns like %s, %d, %i, %f, %o, %O, %c.
 *
 * @param str - The string to check
 * @returns true if the string contains console substitution patterns
 */ function hasConsoleSubstitutions(str) {
    // Match console substitution patterns: %s, %d, %i, %f, %o, %O, %c
    return /%[sdifocO]/.test(str);
}
/**
 * Creates template attributes for multiple console arguments.
 *
 * @param args - The console arguments
 * @returns An object with template and parameter attributes
 */ function createConsoleTemplateAttributes(firstArg, followingArgs) {
    const attributes = {};
    // Create template with placeholders for each argument
    const template = new Array(followingArgs.length).fill('{}').join(' ');
    attributes['sentry.message.template'] = `${firstArg} ${template}`;
    // Add each argument as a parameter
    followingArgs.forEach((arg, index)=>{
        attributes[`sentry.message.parameter.${index}`] = arg;
    });
    return attributes;
}
;
 //# sourceMappingURL=utils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/logs/console-integration.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "consoleLoggingIntegration",
    ()=>consoleLoggingIntegration
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$console$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/console.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integration.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$internal$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/logs/internal.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/logs/utils.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
const INTEGRATION_NAME = 'ConsoleLogs';
const DEFAULT_ATTRIBUTES = {
    [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]]: 'auto.log.console'
};
const _consoleLoggingIntegration = (options = {})=>{
    const levels = options.levels || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["CONSOLE_LEVELS"];
    return {
        name: INTEGRATION_NAME,
        setup (client) {
            const { enableLogs, normalizeDepth = 3, normalizeMaxBreadth = 1000 } = client.getOptions();
            if (!enableLogs) {
                __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('`enableLogs` is not enabled, ConsoleLogs integration disabled');
                return;
            }
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$console$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addConsoleInstrumentationHandler"])(({ args, level })=>{
                if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])() !== client || !levels.includes(level)) {
                    return;
                }
                const firstArg = args[0];
                const followingArgs = args.slice(1);
                if (level === 'assert') {
                    if (!firstArg) {
                        const assertionMessage = followingArgs.length > 0 ? `Assertion failed: ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["formatConsoleArgs"])(followingArgs, normalizeDepth, normalizeMaxBreadth)}` : 'Assertion failed';
                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$internal$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_INTERNAL_captureLog"])({
                            level: 'error',
                            message: assertionMessage,
                            attributes: DEFAULT_ATTRIBUTES
                        });
                    }
                    return;
                }
                const isLevelLog = level === 'log';
                const shouldGenerateTemplate = args.length > 1 && typeof args[0] === 'string' && !(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasConsoleSubstitutions"])(args[0]);
                const attributes = {
                    ...DEFAULT_ATTRIBUTES,
                    ...shouldGenerateTemplate ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createConsoleTemplateAttributes"])(firstArg, followingArgs) : {}
                };
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$internal$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_INTERNAL_captureLog"])({
                    level: isLevelLog ? 'info' : level,
                    message: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["formatConsoleArgs"])(args, normalizeDepth, normalizeMaxBreadth),
                    severityNumber: isLevelLog ? 10 : undefined,
                    attributes
                });
            });
        }
    };
};
/**
 * Captures calls to the `console` API as logs in Sentry. Requires the `enableLogs` option to be enabled.
 *
 * @experimental This feature is experimental and may be changed or removed in future versions.
 *
 * By default the integration instruments `console.debug`, `console.info`, `console.warn`, `console.error`,
 * `console.log`, `console.trace`, and `console.assert`. You can use the `levels` option to customize which
 * levels are captured.
 *
 * @example
 *
 * ```ts
 * import * as Sentry from '@sentry/browser';
 *
 * Sentry.init({
 *   enableLogs: true,
 *   integrations: [Sentry.consoleLoggingIntegration({ levels: ['error', 'warn'] })],
 * });
 * ```
 */ const consoleLoggingIntegration = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defineIntegration"])(_consoleLoggingIntegration);
;
 //# sourceMappingURL=console-integration.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/globalError.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addGlobalErrorInstrumentationHandler",
    ()=>addGlobalErrorInstrumentationHandler
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/handlers.js [instrumentation-edge] (ecmascript)");
;
;
let _oldOnErrorHandler = null;
/**
 * Add an instrumentation handler for when an error is captured by the global error handler.
 *
 * Use at your own risk, this might break without changelog notice, only used internally.
 * @hidden
 */ function addGlobalErrorInstrumentationHandler(handler) {
    const type = 'error';
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addHandler"])(type, handler);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["maybeInstrument"])(type, instrumentError);
}
function instrumentError() {
    _oldOnErrorHandler = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].onerror;
    // Note: The reason we are doing window.onerror instead of window.addEventListener('error')
    // is that we are using this handler in the Loader Script, to handle buffered errors consistently
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].onerror = function(msg, url, line, column, error) {
        const handlerData = {
            column,
            error,
            line,
            msg,
            url
        };
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["triggerHandlers"])('error', handlerData);
        if (_oldOnErrorHandler) {
            // eslint-disable-next-line prefer-rest-params
            return _oldOnErrorHandler.apply(this, arguments);
        }
        return false;
    };
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].onerror.__SENTRY_INSTRUMENTED__ = true;
}
;
 //# sourceMappingURL=globalError.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/globalUnhandledRejection.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addGlobalUnhandledRejectionInstrumentationHandler",
    ()=>addGlobalUnhandledRejectionInstrumentationHandler
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/handlers.js [instrumentation-edge] (ecmascript)");
;
;
let _oldOnUnhandledRejectionHandler = null;
/**
 * Add an instrumentation handler for when an unhandled promise rejection is captured.
 *
 * Use at your own risk, this might break without changelog notice, only used internally.
 * @hidden
 */ function addGlobalUnhandledRejectionInstrumentationHandler(handler) {
    const type = 'unhandledrejection';
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addHandler"])(type, handler);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["maybeInstrument"])(type, instrumentUnhandledRejection);
}
function instrumentUnhandledRejection() {
    _oldOnUnhandledRejectionHandler = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].onunhandledrejection;
    // Note: The reason we are doing window.onunhandledrejection instead of window.addEventListener('unhandledrejection')
    // is that we are using this handler in the Loader Script, to handle buffered rejections consistently
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].onunhandledrejection = function(e) {
        const handlerData = e;
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["triggerHandlers"])('unhandledrejection', handlerData);
        if (_oldOnUnhandledRejectionHandler) {
            // eslint-disable-next-line prefer-rest-params
            return _oldOnUnhandledRejectionHandler.apply(this, arguments);
        }
        return true;
    };
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].onunhandledrejection.__SENTRY_INSTRUMENTED__ = true;
}
;
 //# sourceMappingURL=globalUnhandledRejection.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/errors.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "registerSpanErrorInstrumentation",
    ()=>registerSpanErrorInstrumentation
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$globalError$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/globalError.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$globalUnhandledRejection$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/globalUnhandledRejection.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/spanstatus.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
let errorsInstrumented = false;
/**
 * Ensure that global errors automatically set the active span status.
 */ function registerSpanErrorInstrumentation() {
    if (errorsInstrumented) {
        return;
    }
    /**
   * If an error or unhandled promise occurs, we mark the active root span as failed
   */ function errorCallback() {
        const activeSpan = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getActiveSpan"])();
        const rootSpan = activeSpan && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getRootSpan"])(activeSpan);
        if (rootSpan) {
            const message = 'internal_error';
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`[Tracing] Root span: ${message} -> Global error occurred`);
            rootSpan.setStatus({
                code: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_ERROR"],
                message
            });
        }
    }
    // The function name will be lost when bundling but we need to be able to identify this listener later to maintain the
    // node.js default exit behaviour
    errorCallback.tag = 'sentry_tracingErrorCallback';
    errorsInstrumented = true;
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$globalError$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addGlobalErrorInstrumentationHandler"])(errorCallback);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$globalUnhandledRejection$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addGlobalUnhandledRejectionInstrumentationHandler"])(errorCallback);
}
;
 //# sourceMappingURL=errors.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/sdkMetadata.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "applySdkMetadata",
    ()=>applySdkMetadata
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/version.js [instrumentation-edge] (ecmascript)");
;
/**
 * A builder for the SDK metadata in the options for the SDK initialization.
 *
 * Note: This function is identical to `buildMetadata` in Remix and NextJS and SvelteKit.
 * We don't extract it for bundle size reasons.
 * @see https://github.com/getsentry/sentry-javascript/pull/7404
 * @see https://github.com/getsentry/sentry-javascript/pull/4196
 *
 * If you make changes to this function consider updating the others as well.
 *
 * @param options SDK options object that gets mutated
 * @param names list of package names
 */ function applySdkMetadata(options, name, names = [
    name
], source = 'npm') {
    const sdk = (options._metadata = options._metadata || {}).sdk = options._metadata.sdk || {};
    if (!sdk.name) {
        sdk.name = `sentry.javascript.${name}`;
        sdk.packages = names.map((name)=>({
                name: `${source}:@sentry/${name}`,
                version: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_VERSION"]
            }));
        sdk.version = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$version$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SDK_VERSION"];
    }
}
;
 //# sourceMappingURL=sdkMetadata.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/url.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getHttpSpanDetailsFromUrlObject",
    ()=>getHttpSpanDetailsFromUrlObject,
    "getSanitizedUrlString",
    ()=>getSanitizedUrlString,
    "getSanitizedUrlStringFromUrlObject",
    ()=>getSanitizedUrlStringFromUrlObject,
    "isURLObjectRelative",
    ()=>isURLObjectRelative,
    "parseStringToURLObject",
    ()=>parseStringToURLObject,
    "parseUrl",
    ()=>parseUrl,
    "stripDataUrlContent",
    ()=>stripDataUrlContent,
    "stripUrlQueryAndFragment",
    ()=>stripUrlQueryAndFragment
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)");
;
// Curious about `thismessage:/`? See: https://www.rfc-editor.org/rfc/rfc2557.html
//  > When the methods above do not yield an absolute URI, a base URL
//  > of "thismessage:/" MUST be employed. This base URL has been
//  > defined for the sole purpose of resolving relative references
//  > within a multipart/related structure when no other base URI is
//  > specified.
//
// We need to provide a base URL to `parseStringToURLObject` because the fetch API gives us a
// relative URL sometimes.
//
// This is the only case where we need to provide a base URL to `parseStringToURLObject`
// because the relative URL is not valid on its own.
const DEFAULT_BASE_URL = 'thismessage:/';
/**
 * Checks if the URL object is relative
 *
 * @param url - The URL object to check
 * @returns True if the URL object is relative, false otherwise
 */ function isURLObjectRelative(url) {
    return 'isRelative' in url;
}
/**
 * Parses string to a URL object
 *
 * @param url - The URL to parse
 * @returns The parsed URL object or undefined if the URL is invalid
 */ function parseStringToURLObject(url, urlBase) {
    const isRelative = url.indexOf('://') <= 0 && url.indexOf('//') !== 0;
    const base = urlBase ?? (isRelative ? DEFAULT_BASE_URL : undefined);
    try {
        // Use `canParse` to short-circuit the URL constructor if it's not a valid URL
        // This is faster than trying to construct the URL and catching the error
        // Node 20+, Chrome 120+, Firefox 115+, Safari 17+
        if ('canParse' in URL && !URL.canParse(url, base)) {
            return undefined;
        }
        const fullUrlObject = new URL(url, base);
        if (isRelative) {
            // Because we used a fake base URL, we need to return a relative URL object.
            // We cannot return anything about the origin, host, etc. because it will refer to the fake base URL.
            return {
                isRelative,
                pathname: fullUrlObject.pathname,
                search: fullUrlObject.search,
                hash: fullUrlObject.hash
            };
        }
        return fullUrlObject;
    } catch  {
    // empty body
    }
    return undefined;
}
/**
 * Takes a URL object and returns a sanitized string which is safe to use as span name
 * see: https://develop.sentry.dev/sdk/data-handling/#structuring-data
 */ function getSanitizedUrlStringFromUrlObject(url) {
    if (isURLObjectRelative(url)) {
        return url.pathname;
    }
    const newUrl = new URL(url);
    newUrl.search = '';
    newUrl.hash = '';
    if ([
        '80',
        '443'
    ].includes(newUrl.port)) {
        newUrl.port = '';
    }
    if (newUrl.password) {
        newUrl.password = '%filtered%';
    }
    if (newUrl.username) {
        newUrl.username = '%filtered%';
    }
    return newUrl.toString();
}
function getHttpSpanNameFromUrlObject(urlObject, kind, request, routeName) {
    const method = request?.method?.toUpperCase() ?? 'GET';
    const route = routeName ? routeName : urlObject ? kind === 'client' ? getSanitizedUrlStringFromUrlObject(urlObject) : urlObject.pathname : '/';
    return `${method} ${route}`;
}
/**
 * Takes a parsed URL object and returns a set of attributes for the span
 * that represents the HTTP request for that url. This is used for both server
 * and client http spans.
 *
 * Follows https://opentelemetry.io/docs/specs/semconv/http/.
 *
 * @param urlObject - see {@link parseStringToURLObject}
 * @param kind - The type of HTTP operation (server or client)
 * @param spanOrigin - The origin of the span
 * @param request - The request object, see {@link PartialRequest}
 * @param routeName - The name of the route, must be low cardinality
 * @returns The span name and attributes for the HTTP operation
 */ function getHttpSpanDetailsFromUrlObject(urlObject, kind, spanOrigin, request, routeName) {
    const attributes = {
        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]]: spanOrigin,
        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]]: 'url'
    };
    if (routeName) {
        // This is based on https://opentelemetry.io/docs/specs/semconv/http/http-spans/#name
        attributes[kind === 'server' ? 'http.route' : 'url.template'] = routeName;
        attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] = 'route';
    }
    if (request?.method) {
        attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_HTTP_REQUEST_METHOD"]] = request.method.toUpperCase();
    }
    if (urlObject) {
        if (urlObject.search) {
            attributes['url.query'] = urlObject.search;
        }
        if (urlObject.hash) {
            attributes['url.fragment'] = urlObject.hash;
        }
        if (urlObject.pathname) {
            attributes['url.path'] = urlObject.pathname;
            if (urlObject.pathname === '/') {
                attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_SOURCE"]] = 'route';
            }
        }
        if (!isURLObjectRelative(urlObject)) {
            attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_URL_FULL"]] = urlObject.href;
            if (urlObject.port) {
                attributes['url.port'] = urlObject.port;
            }
            if (urlObject.protocol) {
                attributes['url.scheme'] = urlObject.protocol;
            }
            if (urlObject.hostname) {
                attributes[kind === 'server' ? 'server.address' : 'url.domain'] = urlObject.hostname;
            }
        }
    }
    return [
        getHttpSpanNameFromUrlObject(urlObject, kind, request, routeName),
        attributes
    ];
}
/**
 * Parses string form of URL into an object
 * // borrowed from https://tools.ietf.org/html/rfc3986#appendix-B
 * // intentionally using regex and not <a/> href parsing trick because React Native and other
 * // environments where DOM might not be available
 * @returns parsed URL object
 */ function parseUrl(url) {
    if (!url) {
        return {};
    }
    const match = url.match(/^(([^:/?#]+):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?$/);
    if (!match) {
        return {};
    }
    // coerce to undefined values to empty string so we don't get 'undefined'
    const query = match[6] || '';
    const fragment = match[8] || '';
    return {
        host: match[4],
        path: match[5],
        protocol: match[2],
        search: query,
        hash: fragment,
        relative: match[5] + query + fragment
    };
}
/**
 * Strip the query string and fragment off of a given URL or path (if present)
 *
 * @param urlPath Full URL or path, including possible query string and/or fragment
 * @returns URL or path without query string or fragment
 */ function stripUrlQueryAndFragment(urlPath) {
    return urlPath.split(/[?#]/, 1)[0];
}
/**
 * Takes a URL object and returns a sanitized string which is safe to use as span name
 * see: https://develop.sentry.dev/sdk/data-handling/#structuring-data
 */ function getSanitizedUrlString(url) {
    const { protocol, host, path } = url;
    const filteredHost = host?.replace(/^.*@/, '[filtered]:[filtered]@').replace(/(:80)$/, '').replace(/(:443)$/, '') || '';
    return `${protocol ? `${protocol}://` : ''}${filteredHost}${path}`;
}
/**
 * Strips the content from a data URL, returning a placeholder with the MIME type.
 *
 * Data URLs can be very long (e.g. base64 encoded scripts for Web Workers),
 * with little valuable information, often leading to envelopes getting dropped due
 * to size limit violations. Therefore, we strip data URLs and replace them with a
 * placeholder.
 *
 * @param url - The URL to process
 * @param includeDataPrefix - If true, includes the first 10 characters of the data stream
 *                            for debugging (e.g., to identify magic bytes like WASM's AGFzbQ).
 *                            Defaults to true.
 * @returns For data URLs, returns a short format like `data:text/javascript;base64,SGVsbG8gV2... [truncated]`.
 *          For non-data URLs, returns the original URL unchanged.
 */ function stripDataUrlContent(url, includeDataPrefix = true) {
    if (url.startsWith('data:')) {
        // Match the MIME type (everything after 'data:' until the first ';' or ',')
        const match = url.match(/^data:([^;,]+)/);
        const mimeType = match ? match[1] : 'text/plain';
        const isBase64 = url.includes(';base64,');
        // Find where the actual data starts (after the comma)
        const dataStart = url.indexOf(',');
        let dataPrefix = '';
        if (includeDataPrefix && dataStart !== -1) {
            const data = url.slice(dataStart + 1);
            // Include first 10 chars of data to help identify content (e.g., magic bytes)
            dataPrefix = data.length > 10 ? `${data.slice(0, 10)}... [truncated]` : data;
        }
        return `data:${mimeType}${isBase64 ? ',base64' : ''}${dataPrefix ? `,${dataPrefix}` : ''}`;
    }
    return url;
}
;
 //# sourceMappingURL=url.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/isSentryRequestUrl.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "isSentryRequestUrl",
    ()=>isSentryRequestUrl
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/url.js [instrumentation-edge] (ecmascript)");
;
/**
 * Checks whether given url points to Sentry server
 *
 * @param url url to verify
 */ function isSentryRequestUrl(url, client) {
    const dsn = client?.getDsn();
    const tunnel = client?.getOptions().tunnel;
    return checkDsn(url, dsn) || checkTunnel(url, tunnel);
}
function checkTunnel(url, tunnel) {
    if (!tunnel) {
        return false;
    }
    return removeTrailingSlash(url) === removeTrailingSlash(tunnel);
}
function checkDsn(url, dsn) {
    // Requests to Sentry's ingest endpoint must have a `sentry_key` in the query string
    // This is equivalent to the public_key which is required in the DSN
    // see https://develop.sentry.dev/sdk/overview/#parsing-the-dsn
    // Therefore, a request to the same host and with a `sentry_key` in the query string
    // can be considered a request to the ingest endpoint.
    const urlParts = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseStringToURLObject"])(url);
    if (!urlParts || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isURLObjectRelative"])(urlParts)) {
        return false;
    }
    return dsn ? urlParts.host.includes(dsn.host) && /(^|&|\?)sentry_key=/.test(urlParts.search) : false;
}
function removeTrailingSlash(str) {
    return str[str.length - 1] === '/' ? str.slice(0, -1) : str;
}
;
 //# sourceMappingURL=isSentryRequestUrl.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/lru.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "LRUMap",
    ()=>LRUMap
]);
/** A simple Least Recently Used map */ class LRUMap {
    constructor(_maxSize){
        this._maxSize = _maxSize;
        this._cache = new Map();
    }
    /** Get the current size of the cache */ get size() {
        return this._cache.size;
    }
    /** Get an entry or undefined if it was not in the cache. Re-inserts to update the recently used order */ get(key) {
        const value = this._cache.get(key);
        if (value === undefined) {
            return undefined;
        }
        // Remove and re-insert to update the order
        this._cache.delete(key);
        this._cache.set(key, value);
        return value;
    }
    /** Insert an entry and evict an older entry if we've reached maxSize */ set(key, value) {
        if (this._cache.size >= this._maxSize) {
            // keys() returns an iterator in insertion order so keys().next() gives us the oldest key
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const nextKey = this._cache.keys().next().value;
            this._cache.delete(nextKey);
        }
        this._cache.set(key, value);
    }
    /** Remove an entry and return the entry if it was in the cache */ remove(key) {
        const value = this._cache.get(key);
        if (value) {
            this._cache.delete(key);
        }
        return value;
    }
    /** Clear all entries */ clear() {
        this._cache.clear();
    }
    /** Get all the keys */ keys() {
        return Array.from(this._cache.keys());
    }
    /** Get all the values */ values() {
        const values = [];
        this._cache.forEach((value)=>values.push(value));
        return values;
    }
}
;
 //# sourceMappingURL=lru.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/tracePropagationTargets.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "shouldPropagateTraceForUrl",
    ()=>shouldPropagateTraceForUrl
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/string.js [instrumentation-edge] (ecmascript)");
;
;
;
const NOT_PROPAGATED_MESSAGE = '[Tracing] Not injecting trace data for url because it does not match tracePropagationTargets:';
/**
 * Check if a given URL should be propagated to or not.
 * If no url is defined, or no trace propagation targets are defined, this will always return `true`.
 * You can also optionally provide a decision map, to cache decisions and avoid repeated regex lookups.
 */ function shouldPropagateTraceForUrl(url, tracePropagationTargets, decisionMap) {
    if (typeof url !== 'string' || !tracePropagationTargets) {
        return true;
    }
    const cachedDecision = decisionMap?.get(url);
    if (cachedDecision !== undefined) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && !cachedDecision && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(NOT_PROPAGATED_MESSAGE, url);
        return cachedDecision;
    }
    const decision = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stringMatchesSomePattern"])(url, tracePropagationTargets);
    decisionMap?.set(url, decision);
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && !decision && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(NOT_PROPAGATED_MESSAGE, url);
    return decision;
}
;
 //# sourceMappingURL=tracePropagationTargets.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript) <export safeDateNow as _INTERNAL_safeDateNow>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "_INTERNAL_safeDateNow",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeDateNow"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript)");
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debounce.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "debounce",
    ()=>debounce
]);
/**
 * Heavily simplified debounce function based on lodash.debounce.
 *
 * This function takes a callback function (@param fun) and delays its invocation
 * by @param wait milliseconds. Optionally, a maxWait can be specified in @param options,
 * which ensures that the callback is invoked at least once after the specified max. wait time.
 *
 * @param func the function whose invocation is to be debounced
 * @param wait the minimum time until the function is invoked after it was called once
 * @param options the options object, which can contain the `maxWait` property
 *
 * @returns the debounced version of the function, which needs to be called at least once to start the
 *          debouncing process. Subsequent calls will reset the debouncing timer and, in case @paramfunc
 *          was already invoked in the meantime, return @param func's return value.
 *          The debounced function has two additional properties:
 *          - `flush`: Invokes the debounced function immediately and returns its return value
 *          - `cancel`: Cancels the debouncing process and resets the debouncing timer
 */ function debounce(func, wait, options) {
    let callbackReturnValue;
    let timerId;
    let maxTimerId;
    const maxWait = options?.maxWait ? Math.max(options.maxWait, wait) : 0;
    const setTimeoutImpl = options?.setTimeoutImpl || setTimeout;
    function invokeFunc() {
        cancelTimers();
        callbackReturnValue = func();
        return callbackReturnValue;
    }
    function cancelTimers() {
        timerId !== undefined && clearTimeout(timerId);
        maxTimerId !== undefined && clearTimeout(maxTimerId);
        timerId = maxTimerId = undefined;
    }
    function flush() {
        if (timerId !== undefined || maxTimerId !== undefined) {
            return invokeFunc();
        }
        return callbackReturnValue;
    }
    function debounced() {
        if (timerId) {
            clearTimeout(timerId);
        }
        timerId = setTimeoutImpl(invokeFunc, wait);
        if (maxWait && maxTimerId === undefined) {
            maxTimerId = setTimeoutImpl(invokeFunc, maxWait);
        }
        return callbackReturnValue;
    }
    debounced.cancel = cancelTimers;
    debounced.flush = flush;
    return debounced;
}
;
 //# sourceMappingURL=debounce.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript) <export safeMathRandom as _INTERNAL_safeMathRandom>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "_INTERNAL_safeMathRandom",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeMathRandom"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript)");
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/checkin.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createCheckInEnvelope",
    ()=>createCheckInEnvelope
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/dsn.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/envelope.js [instrumentation-edge] (ecmascript)");
;
;
/**
 * Create envelope from check in item.
 */ function createCheckInEnvelope(checkIn, dynamicSamplingContext, metadata, tunnel, dsn) {
    const headers = {
        sent_at: new Date().toISOString()
    };
    if (metadata?.sdk) {
        headers.sdk = {
            name: metadata.sdk.name,
            version: metadata.sdk.version
        };
    }
    if (!!tunnel && !!dsn) {
        headers.dsn = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dsnToString"])(dsn);
    }
    if (dynamicSamplingContext) {
        headers.trace = dynamicSamplingContext;
    }
    const item = createCheckInEnvelopeItem(checkIn);
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createEnvelope"])(headers, [
        item
    ]);
}
function createCheckInEnvelopeItem(checkIn) {
    const checkInHeaders = {
        type: 'check_in'
    };
    return [
        checkInHeaders,
        checkIn
    ];
}
;
 //# sourceMappingURL=checkin.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/api.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getEnvelopeEndpointWithUrlEncodedAuth",
    ()=>getEnvelopeEndpointWithUrlEncodedAuth,
    "getReportDialogEndpoint",
    ()=>getReportDialogEndpoint
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/dsn.js [instrumentation-edge] (ecmascript)");
;
const SENTRY_API_VERSION = '7';
/** Returns the prefix to construct Sentry ingestion API endpoints. */ function getBaseApiEndpoint(dsn) {
    const protocol = dsn.protocol ? `${dsn.protocol}:` : '';
    const port = dsn.port ? `:${dsn.port}` : '';
    return `${protocol}//${dsn.host}${port}${dsn.path ? `/${dsn.path}` : ''}/api/`;
}
/** Returns the ingest API endpoint for target. */ function _getIngestEndpoint(dsn) {
    return `${getBaseApiEndpoint(dsn)}${dsn.projectId}/envelope/`;
}
/** Returns a URL-encoded string with auth config suitable for a query string. */ function _encodedAuth(dsn, sdkInfo) {
    const params = {
        sentry_version: SENTRY_API_VERSION
    };
    if (dsn.publicKey) {
        // We send only the minimum set of required information. See
        // https://github.com/getsentry/sentry-javascript/issues/2572.
        params.sentry_key = dsn.publicKey;
    }
    if (sdkInfo) {
        params.sentry_client = `${sdkInfo.name}/${sdkInfo.version}`;
    }
    return new URLSearchParams(params).toString();
}
/**
 * Returns the envelope endpoint URL with auth in the query string.
 *
 * Sending auth as part of the query string and not as custom HTTP headers avoids CORS preflight requests.
 */ function getEnvelopeEndpointWithUrlEncodedAuth(dsn, tunnel, sdkInfo) {
    return tunnel ? tunnel : `${_getIngestEndpoint(dsn)}?${_encodedAuth(dsn, sdkInfo)}`;
}
/** Returns the url to the report dialog endpoint. */ function getReportDialogEndpoint(dsnLike, dialogOptions) {
    const dsn = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["makeDsn"])(dsnLike);
    if (!dsn) {
        return '';
    }
    const endpoint = `${getBaseApiEndpoint(dsn)}embed/error-page/`;
    let encodedOptions = `dsn=${(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dsnToString"])(dsn)}`;
    for(const key in dialogOptions){
        if (key === 'dsn') {
            continue;
        }
        if (key === 'onClose') {
            continue;
        }
        if (key === 'user') {
            const user = dialogOptions.user;
            if (!user) {
                continue;
            }
            if (user.name) {
                encodedOptions += `&name=${encodeURIComponent(user.name)}`;
            }
            if (user.email) {
                encodedOptions += `&email=${encodeURIComponent(user.email)}`;
            }
        } else {
            encodedOptions += `&${encodeURIComponent(key)}=${encodeURIComponent(dialogOptions[key])}`;
        }
    }
    return `${endpoint}?${encodedOptions}`;
}
;
 //# sourceMappingURL=api.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/metrics/envelope.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createMetricContainerEnvelopeItem",
    ()=>createMetricContainerEnvelopeItem,
    "createMetricEnvelope",
    ()=>createMetricEnvelope
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/dsn.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/envelope.js [instrumentation-edge] (ecmascript)");
;
;
/**
 * Creates a metric container envelope item for a list of metrics.
 *
 * @param items - The metrics to include in the envelope.
 * @returns The created metric container envelope item.
 */ function createMetricContainerEnvelopeItem(items) {
    return [
        {
            type: 'trace_metric',
            item_count: items.length,
            content_type: 'application/vnd.sentry.items.trace-metric+json'
        },
        {
            items
        }
    ];
}
/**
 * Creates an envelope for a list of metrics.
 *
 * Metrics from multiple traces can be included in the same envelope.
 *
 * @param metrics - The metrics to include in the envelope.
 * @param metadata - The metadata to include in the envelope.
 * @param tunnel - The tunnel to include in the envelope.
 * @param dsn - The DSN to include in the envelope.
 * @returns The created envelope.
 */ function createMetricEnvelope(metrics, metadata, tunnel, dsn) {
    const headers = {};
    if (metadata?.sdk) {
        headers.sdk = {
            name: metadata.sdk.name,
            version: metadata.sdk.version
        };
    }
    if (!!tunnel && !!dsn) {
        headers.dsn = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dsnToString"])(dsn);
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createEnvelope"])(headers, [
        createMetricContainerEnvelopeItem(metrics)
    ]);
}
;
 //# sourceMappingURL=envelope.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/metrics/internal.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "_INTERNAL_captureMetric",
    ()=>_INTERNAL_captureMetric,
    "_INTERNAL_captureSerializedMetric",
    ()=>_INTERNAL_captureSerializedMetric,
    "_INTERNAL_flushMetricsBuffer",
    ()=>_INTERNAL_flushMetricsBuffer,
    "_INTERNAL_getMetricBuffer",
    ()=>_INTERNAL_getMetricBuffer
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/attributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/carrier.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$scopeData$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/scopeData.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanOnScope.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/time.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$trace$2d$info$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/trace-info.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$metrics$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/metrics/envelope.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
const MAX_METRIC_BUFFER_SIZE = 1000;
/**
 * Sets a metric attribute if the value exists and the attribute key is not already present.
 *
 * @param metricAttributes - The metric attributes object to modify.
 * @param key - The attribute key to set.
 * @param value - The value to set (only sets if truthy and key not present).
 * @param setEvenIfPresent - Whether to set the attribute if it is present. Defaults to true.
 */ function setMetricAttribute(metricAttributes, key, value, setEvenIfPresent = true) {
    if (value && (setEvenIfPresent || !(key in metricAttributes))) {
        metricAttributes[key] = value;
    }
}
/**
 * Captures a serialized metric event and adds it to the metric buffer for the given client.
 *
 * @param client - A client. Uses the current client if not provided.
 * @param serializedMetric - The serialized metric event to capture.
 *
 * @experimental This method will experience breaking changes. This is not yet part of
 * the stable Sentry SDK API and can be changed or removed without warning.
 */ function _INTERNAL_captureSerializedMetric(client, serializedMetric) {
    const bufferMap = _getBufferMap();
    const metricBuffer = _INTERNAL_getMetricBuffer(client);
    if (metricBuffer === undefined) {
        bufferMap.set(client, [
            serializedMetric
        ]);
    } else {
        if (metricBuffer.length >= MAX_METRIC_BUFFER_SIZE) {
            _INTERNAL_flushMetricsBuffer(client, metricBuffer);
            bufferMap.set(client, [
                serializedMetric
            ]);
        } else {
            bufferMap.set(client, [
                ...metricBuffer,
                serializedMetric
            ]);
        }
    }
}
/**
 * Options for capturing a metric internally.
 */ /**
 * Enriches metric with all contextual attributes (user, SDK metadata, replay, etc.)
 */ function _enrichMetricAttributes(beforeMetric, client, user) {
    const { release, environment } = client.getOptions();
    const processedMetricAttributes = {
        ...beforeMetric.attributes
    };
    // Add user attributes
    setMetricAttribute(processedMetricAttributes, 'user.id', user.id, false);
    setMetricAttribute(processedMetricAttributes, 'user.email', user.email, false);
    setMetricAttribute(processedMetricAttributes, 'user.name', user.username, false);
    // Add Sentry metadata
    setMetricAttribute(processedMetricAttributes, 'sentry.release', release);
    setMetricAttribute(processedMetricAttributes, 'sentry.environment', environment);
    // Add SDK metadata
    const { name, version } = client.getSdkMetadata()?.sdk ?? {};
    setMetricAttribute(processedMetricAttributes, 'sentry.sdk.name', name);
    setMetricAttribute(processedMetricAttributes, 'sentry.sdk.version', version);
    // Add replay metadata
    const replay = client.getIntegrationByName('Replay');
    const replayId = replay?.getReplayId(true);
    setMetricAttribute(processedMetricAttributes, 'sentry.replay_id', replayId);
    if (replayId && replay?.getRecordingMode() === 'buffer') {
        setMetricAttribute(processedMetricAttributes, 'sentry._internal.replay_is_buffering', true);
    }
    return {
        ...beforeMetric,
        attributes: processedMetricAttributes
    };
}
/**
 * Creates a serialized metric ready to be sent to Sentry.
 */ function _buildSerializedMetric(metric, client, currentScope, scopeAttributes) {
    // Get trace context
    const [, traceContext] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$trace$2d$info$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_getTraceInfoFromScope"])(client, currentScope);
    const span = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanOnScope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_getSpanForScope"])(currentScope);
    const traceId = span ? span.spanContext().traceId : traceContext?.trace_id;
    const spanId = span ? span.spanContext().spanId : undefined;
    return {
        timestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timestampInSeconds"])(),
        trace_id: traceId ?? '',
        span_id: spanId,
        name: metric.name,
        type: metric.type,
        unit: metric.unit,
        value: metric.value,
        attributes: {
            ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["serializeAttributes"])(scopeAttributes),
            ...(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["serializeAttributes"])(metric.attributes, 'skip-undefined')
        }
    };
}
/**
 * Captures a metric event and sends it to Sentry.
 *
 * @param metric - The metric event to capture.
 * @param options - Options for capturing the metric.
 *
 * @experimental This method will experience breaking changes. This is not yet part of
 * the stable Sentry SDK API and can be changed or removed without warning.
 */ function _INTERNAL_captureMetric(beforeMetric, options) {
    const currentScope = options?.scope ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])();
    const captureSerializedMetric = options?.captureSerializedMetric ?? _INTERNAL_captureSerializedMetric;
    const client = currentScope?.getClient() ?? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    if (!client) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('No client available to capture metric.');
        return;
    }
    const { _experiments, enableMetrics, beforeSendMetric } = client.getOptions();
    // todo(v11): Remove the experimental flag
    // eslint-disable-next-line deprecation/deprecation
    const metricsEnabled = enableMetrics ?? _experiments?.enableMetrics ?? true;
    if (!metricsEnabled) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('metrics option not enabled, metric will not be captured.');
        return;
    }
    // Enrich metric with contextual attributes
    const { user, attributes: scopeAttributes } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$scopeData$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCombinedScopeData"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])(), currentScope);
    const enrichedMetric = _enrichMetricAttributes(beforeMetric, client, user);
    client.emit('processMetric', enrichedMetric);
    // todo(v11): Remove the experimental `beforeSendMetric`
    // eslint-disable-next-line deprecation/deprecation
    const beforeSendCallback = beforeSendMetric || _experiments?.beforeSendMetric;
    const processedMetric = beforeSendCallback ? beforeSendCallback(enrichedMetric) : enrichedMetric;
    if (!processedMetric) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('`beforeSendMetric` returned `null`, will not send metric.');
        return;
    }
    const serializedMetric = _buildSerializedMetric(processedMetric, client, currentScope, scopeAttributes);
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('[Metric]', serializedMetric);
    captureSerializedMetric(client, serializedMetric);
    client.emit('afterCaptureMetric', processedMetric);
}
/**
 * Flushes the metrics buffer to Sentry.
 *
 * @param client - A client.
 * @param maybeMetricBuffer - A metric buffer. Uses the metric buffer for the given client if not provided.
 *
 * @experimental This method will experience breaking changes. This is not yet part of
 * the stable Sentry SDK API and can be changed or removed without warning.
 */ function _INTERNAL_flushMetricsBuffer(client, maybeMetricBuffer) {
    const metricBuffer = maybeMetricBuffer ?? _INTERNAL_getMetricBuffer(client) ?? [];
    if (metricBuffer.length === 0) {
        return;
    }
    const clientOptions = client.getOptions();
    const envelope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$metrics$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createMetricEnvelope"])(metricBuffer, clientOptions._metadata, clientOptions.tunnel, client.getDsn());
    // Clear the metric buffer after envelopes have been constructed.
    _getBufferMap().set(client, []);
    client.emit('flushMetrics');
    // sendEnvelope should not throw
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    client.sendEnvelope(envelope);
}
/**
 * Returns the metric buffer for a given client.
 *
 * Exported for testing purposes.
 *
 * @param client - The client to get the metric buffer for.
 * @returns The metric buffer for the given client.
 */ function _INTERNAL_getMetricBuffer(client) {
    return _getBufferMap().get(client);
}
function _getBufferMap() {
    // The reference to the Client <> MetricBuffer map is stored on the carrier to ensure it's always the same
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getGlobalSingleton"])('clientToMetricBufferMap', ()=>new WeakMap());
}
;
 //# sourceMappingURL=internal.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/timer.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "safeUnref",
    ()=>safeUnref
]);
/**
 * Calls `unref` on a timer, if the method is available on @param timer.
 *
 * `unref()` is used to allow processes to exit immediately, even if the timer
 * is still running and hasn't resolved yet.
 *
 * Use this in places where code can run on browser or server, since browsers
 * do not support `unref`.
 */ function safeUnref(timer) {
    if (typeof timer === 'object' && typeof timer.unref === 'function') {
        timer.unref();
    }
    return timer;
}
;
 //# sourceMappingURL=timer.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/promisebuffer.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SENTRY_BUFFER_FULL_ERROR",
    ()=>SENTRY_BUFFER_FULL_ERROR,
    "makePromiseBuffer",
    ()=>makePromiseBuffer
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$syncpromise$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/syncpromise.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$timer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/timer.js [instrumentation-edge] (ecmascript)");
;
;
const SENTRY_BUFFER_FULL_ERROR = Symbol.for('SentryBufferFullError');
/**
 * Creates an new PromiseBuffer object with the specified limit
 * @param limit max number of promises that can be stored in the buffer
 */ function makePromiseBuffer(limit = 100) {
    const buffer = new Set();
    function isReady() {
        return buffer.size < limit;
    }
    /**
   * Remove a promise from the queue.
   *
   * @param task Can be any PromiseLike<T>
   * @returns Removed promise.
   */ function remove(task) {
        buffer.delete(task);
    }
    /**
   * Add a promise (representing an in-flight action) to the queue, and set it to remove itself on fulfillment.
   *
   * @param taskProducer A function producing any PromiseLike<T>; In previous versions this used to be `task:
   *        PromiseLike<T>`, but under that model, Promises were instantly created on the call-site and their executor
   *        functions therefore ran immediately. Thus, even if the buffer was full, the action still happened. By
   *        requiring the promise to be wrapped in a function, we can defer promise creation until after the buffer
   *        limit check.
   * @returns The original promise.
   */ function add(taskProducer) {
        if (!isReady()) {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$syncpromise$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["rejectedSyncPromise"])(SENTRY_BUFFER_FULL_ERROR);
        }
        // start the task and add its promise to the queue
        const task = taskProducer();
        buffer.add(task);
        void task.then(()=>remove(task), ()=>remove(task));
        return task;
    }
    /**
   * Wait for all promises in the queue to resolve or for timeout to expire, whichever comes first.
   *
   * @param timeout The time, in ms, after which to resolve to `false` if the queue is still non-empty. Passing `0` (or
   * not passing anything) will make the promise wait as long as it takes for the queue to drain before resolving to
   * `true`.
   * @returns A promise which will resolve to `true` if the queue is already empty or drains before the timeout, and
   * `false` otherwise
   */ function drain(timeout) {
        if (!buffer.size) {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$syncpromise$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["resolvedSyncPromise"])(true);
        }
        // We want to resolve even if one of the promises rejects
        const drainPromise = Promise.allSettled(Array.from(buffer)).then(()=>true);
        if (!timeout) {
            return drainPromise;
        }
        const promises = [
            drainPromise,
            new Promise((resolve)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$timer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeUnref"])(setTimeout(()=>resolve(false), timeout)))
        ];
        return Promise.race(promises);
    }
    return {
        get $ () {
            return Array.from(buffer);
        },
        add,
        drain
    };
}
;
 //# sourceMappingURL=promisebuffer.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/ratelimit.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_RETRY_AFTER",
    ()=>DEFAULT_RETRY_AFTER,
    "disabledUntil",
    ()=>disabledUntil,
    "isRateLimited",
    ()=>isRateLimited,
    "parseRetryAfterHeader",
    ()=>parseRetryAfterHeader,
    "updateRateLimits",
    ()=>updateRateLimits
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript)");
;
// Intentionally keeping the key broad, as we don't know for sure what rate limit headers get returned from backend
const DEFAULT_RETRY_AFTER = 60 * 1000; // 60 seconds
/**
 * Extracts Retry-After value from the request header or returns default value
 * @param header string representation of 'Retry-After' header
 * @param now current unix timestamp
 *
 */ function parseRetryAfterHeader(header, now = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeDateNow"])()) {
    const headerDelay = parseInt(`${header}`, 10);
    if (!isNaN(headerDelay)) {
        return headerDelay * 1000;
    }
    const headerDate = Date.parse(`${header}`);
    if (!isNaN(headerDate)) {
        return headerDate - now;
    }
    return DEFAULT_RETRY_AFTER;
}
/**
 * Gets the time that the given category is disabled until for rate limiting.
 * In case no category-specific limit is set but a general rate limit across all categories is active,
 * that time is returned.
 *
 * @return the time in ms that the category is disabled until or 0 if there's no active rate limit.
 */ function disabledUntil(limits, dataCategory) {
    return limits[dataCategory] || limits.all || 0;
}
/**
 * Checks if a category is rate limited
 */ function isRateLimited(limits, dataCategory, now = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeDateNow"])()) {
    return disabledUntil(limits, dataCategory) > now;
}
/**
 * Update ratelimits from incoming headers.
 *
 * @return the updated RateLimits object.
 */ function updateRateLimits(limits, { statusCode, headers }, now = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeDateNow"])()) {
    const updatedRateLimits = {
        ...limits
    };
    // "The name is case-insensitive."
    // https://developer.mozilla.org/en-US/docs/Web/API/Headers/get
    const rateLimitHeader = headers?.['x-sentry-rate-limits'];
    const retryAfterHeader = headers?.['retry-after'];
    if (rateLimitHeader) {
        /**
     * rate limit headers are of the form
     *     <header>,<header>,..
     * where each <header> is of the form
     *     <retry_after>: <categories>: <scope>: <reason_code>: <namespaces>
     * where
     *     <retry_after> is a delay in seconds
     *     <categories> is the event type(s) (error, transaction, etc) being rate limited and is of the form
     *         <category>;<category>;...
     *     <scope> is what's being limited (org, project, or key) - ignored by SDK
     *     <reason_code> is an arbitrary string like "org_quota" - ignored by SDK
     *     <namespaces> Semicolon-separated list of metric namespace identifiers. Defines which namespace(s) will be affected.
     *         Only present if rate limit applies to the metric_bucket data category.
     */ for (const limit of rateLimitHeader.trim().split(',')){
            const [retryAfter, categories, , , namespaces] = limit.split(':', 5);
            const headerDelay = parseInt(retryAfter, 10);
            const delay = (!isNaN(headerDelay) ? headerDelay : 60) * 1000; // 60sec default
            if (!categories) {
                updatedRateLimits.all = now + delay;
            } else {
                for (const category of categories.split(';')){
                    if (category === 'metric_bucket') {
                        // namespaces will be present when category === 'metric_bucket'
                        if (!namespaces || namespaces.split(';').includes('custom')) {
                            updatedRateLimits[category] = now + delay;
                        }
                    } else {
                        updatedRateLimits[category] = now + delay;
                    }
                }
            }
        }
    } else if (retryAfterHeader) {
        updatedRateLimits.all = now + parseRetryAfterHeader(retryAfterHeader, now);
    } else if (statusCode === 429) {
        updatedRateLimits.all = now + 60 * 1000;
    }
    return updatedRateLimits;
}
;
 //# sourceMappingURL=ratelimit.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/transports/base.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_TRANSPORT_BUFFER_SIZE",
    ()=>DEFAULT_TRANSPORT_BUFFER_SIZE,
    "createTransport",
    ()=>createTransport
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/envelope.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$promisebuffer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/promisebuffer.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$ratelimit$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/ratelimit.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
const DEFAULT_TRANSPORT_BUFFER_SIZE = 64;
/**
 * Creates an instance of a Sentry `Transport`
 *
 * @param options
 * @param makeRequest
 */ function createTransport(options, makeRequest, buffer = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$promisebuffer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["makePromiseBuffer"])(options.bufferSize || DEFAULT_TRANSPORT_BUFFER_SIZE)) {
    let rateLimits = {};
    const flush = (timeout)=>buffer.drain(timeout);
    function send(envelope) {
        const filteredEnvelopeItems = [];
        // Drop rate limited items from envelope
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["forEachEnvelopeItem"])(envelope, (item, type)=>{
            const dataCategory = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["envelopeItemTypeToDataCategory"])(type);
            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$ratelimit$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isRateLimited"])(rateLimits, dataCategory)) {
                options.recordDroppedEvent('ratelimit_backoff', dataCategory);
            } else {
                filteredEnvelopeItems.push(item);
            }
        });
        // Skip sending if envelope is empty after filtering out rate limited events
        if (filteredEnvelopeItems.length === 0) {
            return Promise.resolve({});
        }
        const filteredEnvelope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createEnvelope"])(envelope[0], filteredEnvelopeItems);
        // Creates client report for each item in an envelope
        const recordEnvelopeLoss = (reason)=>{
            // Don't record outcomes for client reports - we don't want to create a feedback loop if client reports themselves fail to send
            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["envelopeContainsItemType"])(filteredEnvelope, [
                'client_report'
            ])) {
                __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(`Dropping client report. Will not send outcomes (reason: ${reason}).`);
                return;
            }
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["forEachEnvelopeItem"])(filteredEnvelope, (item, type)=>{
                options.recordDroppedEvent(reason, (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["envelopeItemTypeToDataCategory"])(type));
            });
        };
        const requestTask = ()=>makeRequest({
                body: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["serializeEnvelope"])(filteredEnvelope)
            }).then((response)=>{
                // Handle 413 Content Too Large
                // Loss of envelope content is expected so we record a send_error client report
                // https://develop.sentry.dev/sdk/expected-features/#dealing-with-network-failures
                if (response.statusCode === 413) {
                    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error('Sentry responded with status code 413. Envelope was discarded due to exceeding size limits.');
                    recordEnvelopeLoss('send_error');
                    return response;
                }
                // We don't want to throw on NOK responses, but we want to at least log them
                if (__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && response.statusCode !== undefined && (response.statusCode < 200 || response.statusCode >= 300)) {
                    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(`Sentry responded with status code ${response.statusCode} to sent event.`);
                }
                rateLimits = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$ratelimit$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["updateRateLimits"])(rateLimits, response);
                return response;
            }, (error)=>{
                recordEnvelopeLoss('network_error');
                __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error('Encountered error running transport request:', error);
                throw error;
            });
        return buffer.add(requestTask).then((result)=>result, (error)=>{
            if (error === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$promisebuffer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SENTRY_BUFFER_FULL_ERROR"]) {
                __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error('Skipped sending event because buffer is full.');
                recordEnvelopeLoss('queue_overflow');
                return Promise.resolve({});
            } else {
                throw error;
            }
        });
    }
    return {
        send,
        flush
    };
}
;
 //# sourceMappingURL=base.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/clientreport.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createClientReportEnvelope",
    ()=>createClientReportEnvelope
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/envelope.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/time.js [instrumentation-edge] (ecmascript)");
;
;
/**
 * Creates client report envelope
 * @param discarded_events An array of discard events
 * @param dsn A DSN that can be set on the header. Optional.
 */ function createClientReportEnvelope(discarded_events, dsn, timestamp) {
    const clientReportItem = [
        {
            type: 'client_report'
        },
        {
            timestamp: timestamp || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dateTimestampInSeconds"])(),
            discarded_events
        }
    ];
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createEnvelope"])(dsn ? {
        dsn
    } : {}, [
        clientReportItem
    ]);
}
;
 //# sourceMappingURL=clientreport.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/eventUtils.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getPossibleEventMessages",
    ()=>getPossibleEventMessages
]);
/**
 * Get a list of possible event messages from a Sentry event.
 */ function getPossibleEventMessages(event) {
    const possibleMessages = [];
    if (event.message) {
        possibleMessages.push(event.message);
    }
    try {
        // @ts-expect-error Try catching to save bundle size
        const lastException = event.exception.values[event.exception.values.length - 1];
        if (lastException?.value) {
            possibleMessages.push(lastException.value);
            if (lastException.type) {
                possibleMessages.push(`${lastException.type}: ${lastException.value}`);
            }
        }
    } catch  {
    // ignore errors here
    }
    return possibleMessages;
}
;
 //# sourceMappingURL=eventUtils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/transactionEvent.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "convertSpanJsonToTransactionEvent",
    ()=>convertSpanJsonToTransactionEvent,
    "convertTransactionEventToSpanJson",
    ()=>convertTransactionEventToSpanJson
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)");
;
/**
 * Converts a transaction event to a span JSON object.
 */ function convertTransactionEventToSpanJson(event) {
    const { trace_id, parent_span_id, span_id, status, origin, data, op } = event.contexts?.trace ?? {};
    return {
        data: data ?? {},
        description: event.transaction,
        op,
        parent_span_id,
        span_id: span_id ?? '',
        start_timestamp: event.start_timestamp ?? 0,
        status,
        timestamp: event.timestamp,
        trace_id: trace_id ?? '',
        origin,
        profile_id: data?.[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_PROFILE_ID"]],
        exclusive_time: data?.[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME"]],
        measurements: event.measurements,
        is_segment: true
    };
}
/**
 * Converts a span JSON object to a transaction event.
 */ function convertSpanJsonToTransactionEvent(span) {
    return {
        type: 'transaction',
        timestamp: span.timestamp,
        start_timestamp: span.start_timestamp,
        transaction: span.description,
        contexts: {
            trace: {
                trace_id: span.trace_id,
                span_id: span.span_id,
                parent_span_id: span.parent_span_id,
                op: span.op,
                status: span.status,
                origin: span.origin,
                data: {
                    ...span.data,
                    ...span.profile_id && {
                        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_PROFILE_ID"]]: span.profile_id
                    },
                    ...span.exclusive_time && {
                        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME"]]: span.exclusive_time
                    }
                }
            }
        },
        measurements: span.measurements
    };
}
;
 //# sourceMappingURL=transactionEvent.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/client.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Client",
    ()=>Client
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/api.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/constants.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/envelope.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integration.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$internal$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/logs/internal.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$metrics$2f$internal$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/metrics/internal.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$session$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/session.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/dynamicSamplingContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$transports$2f$base$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/transports/base.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$clientreport$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/clientreport.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/dsn.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/envelope.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$eventUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/eventUtils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$merge$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/merge.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/misc.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/parseSampleRate.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$prepareEvent$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/prepareEvent.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$promisebuffer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/promisebuffer.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/randomSafeContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$should$2d$ignore$2d$span$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/should-ignore-span.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$syncpromise$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/syncpromise.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$timer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/timer.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$transactionEvent$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/transactionEvent.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
/* eslint-disable max-lines */ const ALREADY_SEEN_ERROR = "Not capturing exception because it's already been captured.";
const MISSING_RELEASE_FOR_SESSION_ERROR = 'Discarded session because of missing or non-string release';
const INTERNAL_ERROR_SYMBOL = Symbol.for('SentryInternalError');
const DO_NOT_SEND_EVENT_SYMBOL = Symbol.for('SentryDoNotSendEventError');
// Default interval for flushing logs and metrics (5 seconds)
const DEFAULT_FLUSH_INTERVAL = 5000;
function _makeInternalError(message) {
    return {
        message,
        [INTERNAL_ERROR_SYMBOL]: true
    };
}
function _makeDoNotSendEventError(message) {
    return {
        message,
        [DO_NOT_SEND_EVENT_SYMBOL]: true
    };
}
function _isInternalError(error) {
    return !!error && typeof error === 'object' && INTERNAL_ERROR_SYMBOL in error;
}
function _isDoNotSendEventError(error) {
    return !!error && typeof error === 'object' && DO_NOT_SEND_EVENT_SYMBOL in error;
}
/**
 * Sets up weight-based flushing for logs or metrics.
 * This helper function encapsulates the common pattern of:
 * 1. Tracking accumulated weight of items
 * 2. Flushing when weight exceeds threshold (800KB)
 * 3. Flushing after timeout period from the first item
 *
 * Uses closure variables to track weight and timeout state.
 */ function setupWeightBasedFlushing(client, afterCaptureHook, flushHook, estimateSizeFn, flushFn) {
    // Track weight and timeout in closure variables
    let weight = 0;
    let flushTimeout;
    let isTimerActive = false;
    // @ts-expect-error - TypeScript can't narrow generic hook types to match specific overloads, but we know this is type-safe
    client.on(flushHook, ()=>{
        weight = 0;
        clearTimeout(flushTimeout);
        isTimerActive = false;
    });
    // @ts-expect-error - TypeScript can't narrow generic hook types to match specific overloads, but we know this is type-safe
    client.on(afterCaptureHook, (item)=>{
        weight += estimateSizeFn(item);
        // We flush the buffer if it exceeds 0.8 MB
        // The weight is a rough estimate, so we flush way before the payload gets too big.
        if (weight >= 800000) {
            flushFn(client);
        } else if (!isTimerActive) {
            // Only start timer if one isn't already running.
            // This prevents flushing being delayed by items that arrive close to the timeout limit
            // and thus resetting the flushing timeout and delaying items being flushed.
            isTimerActive = true;
            // Use safeUnref so the timer doesn't prevent the process from exiting
            flushTimeout = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$timer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeUnref"])(setTimeout(()=>{
                flushFn(client);
            // Note: isTimerActive is reset by the flushHook handler above, not here,
            // to avoid race conditions when new items arrive during the flush.
            }, DEFAULT_FLUSH_INTERVAL));
        }
    });
    client.on('flush', ()=>{
        flushFn(client);
    });
}
/**
 * Base implementation for all JavaScript SDK clients.
 *
 * Call the constructor with the corresponding options
 * specific to the client subclass. To access these options later, use
 * {@link Client.getOptions}.
 *
 * If a Dsn is specified in the options, it will be parsed and stored. Use
 * {@link Client.getDsn} to retrieve the Dsn at any moment. In case the Dsn is
 * invalid, the constructor will throw a {@link SentryException}. Note that
 * without a valid Dsn, the SDK will not send any events to Sentry.
 *
 * Before sending an event, it is passed through
 * {@link Client._prepareEvent} to add SDK information and scope data
 * (breadcrumbs and context). To add more custom information, override this
 * method and extend the resulting prepared event.
 *
 * To issue automatically created events (e.g. via instrumentation), use
 * {@link Client.captureEvent}. It will prepare the event and pass it through
 * the callback lifecycle. To issue auto-breadcrumbs, use
 * {@link Client.addBreadcrumb}.
 *
 * @example
 * class NodeClient extends Client<NodeOptions> {
 *   public constructor(options: NodeOptions) {
 *     super(options);
 *   }
 *
 *   // ...
 * }
 */ class Client {
    /** Options passed to the SDK. */ /** The client Dsn, if specified in options. Without this Dsn, the SDK will be disabled. */ /** Array of set up integrations. */ /** Number of calls being processed */ /** Holds flushable  */ // eslint-disable-next-line @typescript-eslint/ban-types
    /**
   * Initializes this client instance.
   *
   * @param options Options for the client.
   */ constructor(options){
        this._options = options;
        this._integrations = {};
        this._numProcessing = 0;
        this._outcomes = {};
        this._hooks = {};
        this._eventProcessors = [];
        this._promiseBuffer = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$promisebuffer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["makePromiseBuffer"])(options.transportOptions?.bufferSize ?? __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$transports$2f$base$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEFAULT_TRANSPORT_BUFFER_SIZE"]);
        if (options.dsn) {
            this._dsn = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["makeDsn"])(options.dsn);
        } else {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('No DSN provided, client will not send events.');
        }
        if (this._dsn) {
            const url = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$api$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getEnvelopeEndpointWithUrlEncodedAuth"])(this._dsn, options.tunnel, options._metadata ? options._metadata.sdk : undefined);
            this._transport = options.transport({
                tunnel: this._options.tunnel,
                recordDroppedEvent: this.recordDroppedEvent.bind(this),
                ...options.transportOptions,
                url
            });
        }
        // Backfill enableLogs option from _experiments.enableLogs
        // TODO(v11): Remove or change default value
        // eslint-disable-next-line deprecation/deprecation
        this._options.enableLogs = this._options.enableLogs ?? this._options._experiments?.enableLogs;
        // Setup log flushing with weight and timeout tracking
        if (this._options.enableLogs) {
            setupWeightBasedFlushing(this, 'afterCaptureLog', 'flushLogs', estimateLogSizeInBytes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$internal$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_INTERNAL_flushLogsBuffer"]);
        }
        // todo(v11): Remove the experimental flag
        // eslint-disable-next-line deprecation/deprecation
        const enableMetrics = this._options.enableMetrics ?? this._options._experiments?.enableMetrics ?? true;
        // Setup metric flushing with weight and timeout tracking
        if (enableMetrics) {
            setupWeightBasedFlushing(this, 'afterCaptureMetric', 'flushMetrics', estimateMetricSizeInBytes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$metrics$2f$internal$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_INTERNAL_flushMetricsBuffer"]);
        }
    }
    /**
   * Captures an exception event and sends it to Sentry.
   *
   * Unlike `captureException` exported from every SDK, this method requires that you pass it the current scope.
   */ captureException(exception, hint, scope) {
        const eventId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["uuid4"])();
        // ensure we haven't captured this very object before
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["checkOrSetAlreadyCaught"])(exception)) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(ALREADY_SEEN_ERROR);
            return eventId;
        }
        const hintWithEventId = {
            event_id: eventId,
            ...hint
        };
        this._process(()=>this.eventFromException(exception, hintWithEventId).then((event)=>this._captureEvent(event, hintWithEventId, scope)).then((res)=>res), 'error');
        return hintWithEventId.event_id;
    }
    /**
   * Captures a message event and sends it to Sentry.
   *
   * Unlike `captureMessage` exported from every SDK, this method requires that you pass it the current scope.
   */ captureMessage(message, level, hint, currentScope) {
        const hintWithEventId = {
            event_id: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["uuid4"])(),
            ...hint
        };
        const eventMessage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isParameterizedString"])(message) ? message : String(message);
        const isMessage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isPrimitive"])(message);
        const promisedEvent = isMessage ? this.eventFromMessage(eventMessage, level, hintWithEventId) : this.eventFromException(message, hintWithEventId);
        this._process(()=>promisedEvent.then((event)=>this._captureEvent(event, hintWithEventId, currentScope)), isMessage ? 'unknown' : 'error');
        return hintWithEventId.event_id;
    }
    /**
   * Captures a manually created event and sends it to Sentry.
   *
   * Unlike `captureEvent` exported from every SDK, this method requires that you pass it the current scope.
   */ captureEvent(event, hint, currentScope) {
        const eventId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["uuid4"])();
        // ensure we haven't captured this very object before
        if (hint?.originalException && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["checkOrSetAlreadyCaught"])(hint.originalException)) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(ALREADY_SEEN_ERROR);
            return eventId;
        }
        const hintWithEventId = {
            event_id: eventId,
            ...hint
        };
        const sdkProcessingMetadata = event.sdkProcessingMetadata || {};
        const capturedSpanScope = sdkProcessingMetadata.capturedSpanScope;
        const capturedSpanIsolationScope = sdkProcessingMetadata.capturedSpanIsolationScope;
        const dataCategory = getDataCategoryByType(event.type);
        this._process(()=>this._captureEvent(event, hintWithEventId, capturedSpanScope || currentScope, capturedSpanIsolationScope), dataCategory);
        return hintWithEventId.event_id;
    }
    /**
   * Captures a session.
   */ captureSession(session) {
        this.sendSession(session);
        // After sending, we set init false to indicate it's not the first occurrence
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$session$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["updateSession"])(session, {
            init: false
        });
    }
    /**
   * Create a cron monitor check in and send it to Sentry. This method is not available on all clients.
   *
   * @param checkIn An object that describes a check in.
   * @param upsertMonitorConfig An optional object that describes a monitor config. Use this if you want
   * to create a monitor automatically when sending a check in.
   * @param scope An optional scope containing event metadata.
   * @returns A string representing the id of the check in.
   */ /**
   * Get the current Dsn.
   */ getDsn() {
        return this._dsn;
    }
    /**
   * Get the current options.
   */ getOptions() {
        return this._options;
    }
    /**
   * Get the SDK metadata.
   * @see SdkMetadata
   */ getSdkMetadata() {
        return this._options._metadata;
    }
    /**
   * Returns the transport that is used by the client.
   * Please note that the transport gets lazy initialized so it will only be there once the first event has been sent.
   */ getTransport() {
        return this._transport;
    }
    /**
   * Wait for all events to be sent or the timeout to expire, whichever comes first.
   *
   * @param timeout Maximum time in ms the client should wait for events to be flushed. Omitting this parameter will
   *   cause the client to wait until all events are sent before resolving the promise.
   * @returns A promise that will resolve with `true` if all events are sent before the timeout, or `false` if there are
   * still events in the queue when the timeout is reached.
   */ // @ts-expect-error - PromiseLike is a subset of Promise
    async flush(timeout) {
        const transport = this._transport;
        if (!transport) {
            return true;
        }
        this.emit('flush');
        const clientFinished = await this._isClientDoneProcessing(timeout);
        const transportFlushed = await transport.flush(timeout);
        return clientFinished && transportFlushed;
    }
    /**
   * Flush the event queue and set the client to `enabled = false`. See {@link Client.flush}.
   *
   * @param {number} timeout Maximum time in ms the client should wait before shutting down. Omitting this parameter will cause
   *   the client to wait until all events are sent before disabling itself.
   * @returns {Promise<boolean>} A promise which resolves to `true` if the flush completes successfully before the timeout, or `false` if
   * it doesn't.
   */ // @ts-expect-error - PromiseLike is a subset of Promise
    async close(timeout) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$logs$2f$internal$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_INTERNAL_flushLogsBuffer"])(this);
        const result = await this.flush(timeout);
        this.getOptions().enabled = false;
        this.emit('close');
        return result;
    }
    /**
   * Get all installed event processors.
   */ getEventProcessors() {
        return this._eventProcessors;
    }
    /**
   * Adds an event processor that applies to any event processed by this client.
   */ addEventProcessor(eventProcessor) {
        this._eventProcessors.push(eventProcessor);
    }
    /**
   * Initialize this client.
   * Call this after the client was set on a scope.
   */ init() {
        if (this._isEnabled() || // Force integrations to be setup even if no DSN was set when we have
        // Spotlight enabled. This is particularly important for browser as we
        // don't support the `spotlight` option there and rely on the users
        // adding the `spotlightBrowserIntegration()` to their integrations which
        // wouldn't get initialized with the check below when there's no DSN set.
        this._options.integrations.some(({ name })=>name.startsWith('Spotlight'))) {
            this._setupIntegrations();
        }
    }
    /**
   * Gets an installed integration by its name.
   *
   * @returns {Integration|undefined} The installed integration or `undefined` if no integration with that `name` was installed.
   */ getIntegrationByName(integrationName) {
        return this._integrations[integrationName];
    }
    /**
   * Add an integration to the client.
   * This can be used to e.g. lazy load integrations.
   * In most cases, this should not be necessary,
   * and you're better off just passing the integrations via `integrations: []` at initialization time.
   * However, if you find the need to conditionally load & add an integration, you can use `addIntegration` to do so.
   */ addIntegration(integration) {
        const isAlreadyInstalled = this._integrations[integration.name];
        // This hook takes care of only installing if not already installed
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["setupIntegration"])(this, integration, this._integrations);
        // Here we need to check manually to make sure to not run this multiple times
        if (!isAlreadyInstalled) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["afterSetupIntegrations"])(this, [
                integration
            ]);
        }
    }
    /**
   * Send a fully prepared event to Sentry.
   */ sendEvent(event, hint = {}) {
        this.emit('beforeSendEvent', event, hint);
        let env = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createEventEnvelope"])(event, this._dsn, this._options._metadata, this._options.tunnel);
        for (const attachment of hint.attachments || []){
            env = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addItemToEnvelope"])(env, (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createAttachmentEnvelopeItem"])(attachment));
        }
        // sendEnvelope should not throw
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.sendEnvelope(env).then((sendResponse)=>this.emit('afterSendEvent', event, sendResponse));
    }
    /**
   * Send a session or session aggregrates to Sentry.
   */ sendSession(session) {
        // Backfill release and environment on session
        const { release: clientReleaseOption, environment: clientEnvironmentOption = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEFAULT_ENVIRONMENT"] } = this._options;
        if ('aggregates' in session) {
            const sessionAttrs = session.attrs || {};
            if (!sessionAttrs.release && !clientReleaseOption) {
                __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(MISSING_RELEASE_FOR_SESSION_ERROR);
                return;
            }
            sessionAttrs.release = sessionAttrs.release || clientReleaseOption;
            sessionAttrs.environment = sessionAttrs.environment || clientEnvironmentOption;
            session.attrs = sessionAttrs;
        } else {
            if (!session.release && !clientReleaseOption) {
                __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(MISSING_RELEASE_FOR_SESSION_ERROR);
                return;
            }
            session.release = session.release || clientReleaseOption;
            session.environment = session.environment || clientEnvironmentOption;
        }
        this.emit('beforeSendSession', session);
        const env = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$envelope$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createSessionEnvelope"])(session, this._dsn, this._options._metadata, this._options.tunnel);
        // sendEnvelope should not throw
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.sendEnvelope(env);
    }
    /**
   * Record on the client that an event got dropped (ie, an event that will not be sent to Sentry).
   */ recordDroppedEvent(reason, category, count = 1) {
        if (this._options.sendClientReports) {
            // We want to track each category (error, transaction, session, replay_event) separately
            // but still keep the distinction between different type of outcomes.
            // We could use nested maps, but it's much easier to read and type this way.
            // A correct type for map-based implementation if we want to go that route
            // would be `Partial<Record<SentryRequestType, Partial<Record<Outcome, number>>>>`
            // With typescript 4.1 we could even use template literal types
            const key = `${reason}:${category}`;
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`Recording outcome: "${key}"${count > 1 ? ` (${count} times)` : ''}`);
            this._outcomes[key] = (this._outcomes[key] || 0) + count;
        }
    }
    /* eslint-disable @typescript-eslint/unified-signatures */ /**
   * Register a callback for whenever a span is started.
   * Receives the span as argument.
   * @returns {() => void} A function that, when executed, removes the registered callback.
   */ /**
   * Register a hook on this client.
   */ on(hook, callback) {
        const hookCallbacks = this._hooks[hook] = this._hooks[hook] || new Set();
        // Wrap the callback in a function so that registering the same callback instance multiple
        // times results in the callback being called multiple times.
        // @ts-expect-error - The `callback` type is correct and must be a function due to the
        // individual, specific overloads of this function.
        // eslint-disable-next-line @typescript-eslint/ban-types
        const uniqueCallback = (...args)=>callback(...args);
        hookCallbacks.add(uniqueCallback);
        // This function returns a callback execution handler that, when invoked,
        // deregisters a callback. This is crucial for managing instances where callbacks
        // need to be unregistered to prevent self-referencing in callback closures,
        // ensuring proper garbage collection.
        return ()=>{
            hookCallbacks.delete(uniqueCallback);
        };
    }
    /** Fire a hook whenever a span starts. */ /**
   * Emit a hook that was previously registered via `on()`.
   */ emit(hook, ...rest) {
        const callbacks = this._hooks[hook];
        if (callbacks) {
            callbacks.forEach((callback)=>callback(...rest));
        }
    }
    /**
   * Send an envelope to Sentry.
   */ // @ts-expect-error - PromiseLike is a subset of Promise
    async sendEnvelope(envelope) {
        this.emit('beforeEnvelope', envelope);
        if (this._isEnabled() && this._transport) {
            try {
                return await this._transport.send(envelope);
            } catch (reason) {
                __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error('Error while sending envelope:', reason);
                return {};
            }
        }
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error('Transport disabled');
        return {};
    }
    /**
   * Disposes of the client and releases all resources.
   *
   * Subclasses should override this method to clean up their own resources.
   * After calling dispose(), the client should not be used anymore.
   */ dispose() {
    // Base class has no cleanup logic - subclasses implement their own
    }
    /* eslint-enable @typescript-eslint/unified-signatures */ /** Setup integrations for this client. */ _setupIntegrations() {
        const { integrations } = this._options;
        this._integrations = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["setupIntegrations"])(this, integrations);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["afterSetupIntegrations"])(this, integrations);
    }
    /** Updates existing session based on the provided event */ _updateSessionFromEvent(session, event) {
        // initially, set `crashed` based on the event level and update from exceptions if there are any later on
        let crashed = event.level === 'fatal';
        let errored = false;
        const exceptions = event.exception?.values;
        if (exceptions) {
            errored = true;
            // reset crashed to false if there are exceptions, to ensure `mechanism.handled` is respected.
            crashed = false;
            for (const ex of exceptions){
                if (ex.mechanism?.handled === false) {
                    crashed = true;
                    break;
                }
            }
        }
        // A session is updated and that session update is sent in only one of the two following scenarios:
        // 1. Session with non terminal status and 0 errors + an error occurred -> Will set error count to 1 and send update
        // 2. Session with non terminal status and 1 error + a crash occurred -> Will set status crashed and send update
        const sessionNonTerminal = session.status === 'ok';
        const shouldUpdateAndSend = sessionNonTerminal && session.errors === 0 || sessionNonTerminal && crashed;
        if (shouldUpdateAndSend) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$session$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["updateSession"])(session, {
                ...crashed && {
                    status: 'crashed'
                },
                errors: session.errors || Number(errored || crashed)
            });
            this.captureSession(session);
        }
    }
    /**
   * Determine if the client is finished processing. Returns a promise because it will wait `timeout` ms before saying
   * "no" (resolving to `false`) in order to give the client a chance to potentially finish first.
   *
   * @param timeout The time, in ms, after which to resolve to `false` if the client is still busy. Passing `0` (or not
   * passing anything) will make the promise wait as long as it takes for processing to finish before resolving to
   * `true`.
   * @returns A promise which will resolve to `true` if processing is already done or finishes before the timeout, and
   * `false` otherwise
   */ async _isClientDoneProcessing(timeout) {
        let ticked = 0;
        while(!timeout || ticked < timeout){
            await new Promise((resolve)=>setTimeout(resolve, 1));
            if (!this._numProcessing) {
                return true;
            }
            ticked++;
        }
        return false;
    }
    /** Determines whether this SDK is enabled and a transport is present. */ _isEnabled() {
        return this.getOptions().enabled !== false && this._transport !== undefined;
    }
    /**
   * Adds common information to events.
   *
   * The information includes release and environment from `options`,
   * breadcrumbs and context (extra, tags and user) from the scope.
   *
   * Information that is already present in the event is never overwritten. For
   * nested objects, such as the context, keys are merged.
   *
   * @param event The original event.
   * @param hint May contain additional information about the original exception.
   * @param currentScope A scope containing event metadata.
   * @returns A new event with more information.
   */ _prepareEvent(event, hint, currentScope, isolationScope) {
        const options = this.getOptions();
        const integrations = Object.keys(this._integrations);
        if (!hint.integrations && integrations?.length) {
            hint.integrations = integrations;
        }
        this.emit('preprocessEvent', event, hint);
        if (!event.type) {
            isolationScope.setLastEventId(event.event_id || hint.event_id);
        }
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$prepareEvent$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["prepareEvent"])(options, event, hint, currentScope, this, isolationScope).then((evt)=>{
            if (evt === null) {
                return evt;
            }
            this.emit('postprocessEvent', evt, hint);
            evt.contexts = {
                trace: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getTraceContextFromScope"])(currentScope),
                ...evt.contexts
            };
            const dynamicSamplingContext = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromScope"])(this, currentScope);
            evt.sdkProcessingMetadata = {
                dynamicSamplingContext,
                ...evt.sdkProcessingMetadata
            };
            return evt;
        });
    }
    /**
   * Processes the event and logs an error in case of rejection
   * @param event
   * @param hint
   * @param scope
   */ _captureEvent(event, hint = {}, currentScope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])(), isolationScope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])()) {
        if (__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && isErrorEvent(event)) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(`Captured error event \`${(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$eventUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getPossibleEventMessages"])(event)[0] || '<unknown>'}\``);
        }
        return this._processEvent(event, hint, currentScope, isolationScope).then((finalEvent)=>{
            return finalEvent.event_id;
        }, (reason)=>{
            if (__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"]) {
                if (_isDoNotSendEventError(reason)) {
                    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log(reason.message);
                } else if (_isInternalError(reason)) {
                    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(reason.message);
                } else {
                    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(reason);
                }
            }
            return undefined;
        });
    }
    /**
   * Processes an event (either error or message) and sends it to Sentry.
   *
   * This also adds breadcrumbs and context information to the event. However,
   * platform specific meta data (such as the User's IP address) must be added
   * by the SDK implementor.
   *
   *
   * @param event The event to send to Sentry.
   * @param hint May contain additional information about the original exception.
   * @param currentScope A scope containing event metadata.
   * @returns A SyncPromise that resolves with the event or rejects in case event was/will not be send.
   */ _processEvent(event, hint, currentScope, isolationScope) {
        const options = this.getOptions();
        const { sampleRate } = options;
        const isTransaction = isTransactionEvent(event);
        const isError = isErrorEvent(event);
        const eventType = event.type || 'error';
        const beforeSendLabel = `before send for type \`${eventType}\``;
        // 1.0 === 100% events are sent
        // 0.0 === 0% events are sent
        // Sampling for transaction happens somewhere else
        const parsedSampleRate = typeof sampleRate === 'undefined' ? undefined : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$parseSampleRate$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseSampleRate"])(sampleRate);
        if (isError && typeof parsedSampleRate === 'number' && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$randomSafeContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeMathRandom"])() > parsedSampleRate) {
            this.recordDroppedEvent('sample_rate', 'error');
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$syncpromise$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["rejectedSyncPromise"])(_makeDoNotSendEventError(`Discarding event because it's not included in the random sample (sampling rate = ${sampleRate})`));
        }
        const dataCategory = getDataCategoryByType(event.type);
        return this._prepareEvent(event, hint, currentScope, isolationScope).then((prepared)=>{
            if (prepared === null) {
                this.recordDroppedEvent('event_processor', dataCategory);
                throw _makeDoNotSendEventError('An event processor returned `null`, will not send event.');
            }
            const isInternalException = hint.data && hint.data.__sentry__ === true;
            if (isInternalException) {
                return prepared;
            }
            const result = processBeforeSend(this, options, prepared, hint);
            return _validateBeforeSendResult(result, beforeSendLabel);
        }).then((processedEvent)=>{
            if (processedEvent === null) {
                this.recordDroppedEvent('before_send', dataCategory);
                if (isTransaction) {
                    const spans = event.spans || [];
                    // the transaction itself counts as one span, plus all the child spans that are added
                    const spanCount = 1 + spans.length;
                    this.recordDroppedEvent('before_send', 'span', spanCount);
                }
                throw _makeDoNotSendEventError(`${beforeSendLabel} returned \`null\`, will not send event.`);
            }
            const session = currentScope.getSession() || isolationScope.getSession();
            if (isError && session) {
                this._updateSessionFromEvent(session, processedEvent);
            }
            if (isTransaction) {
                const spanCountBefore = processedEvent.sdkProcessingMetadata?.spanCountBeforeProcessing || 0;
                const spanCountAfter = processedEvent.spans ? processedEvent.spans.length : 0;
                const droppedSpanCount = spanCountBefore - spanCountAfter;
                if (droppedSpanCount > 0) {
                    this.recordDroppedEvent('before_send', 'span', droppedSpanCount);
                }
            }
            // None of the Sentry built event processor will update transaction name,
            // so if the transaction name has been changed by an event processor, we know
            // it has to come from custom event processor added by a user
            const transactionInfo = processedEvent.transaction_info;
            if (isTransaction && transactionInfo && processedEvent.transaction !== event.transaction) {
                const source = 'custom';
                processedEvent.transaction_info = {
                    ...transactionInfo,
                    source
                };
            }
            this.sendEvent(processedEvent, hint);
            return processedEvent;
        }).then(null, (reason)=>{
            if (_isDoNotSendEventError(reason) || _isInternalError(reason)) {
                throw reason;
            }
            this.captureException(reason, {
                mechanism: {
                    handled: false,
                    type: 'internal'
                },
                data: {
                    __sentry__: true
                },
                originalException: reason
            });
            throw _makeInternalError(`Event processing pipeline threw an error, original event will not be sent. Details have been sent as a new event.\nReason: ${reason}`);
        });
    }
    /**
   * Occupies the client with processing and event
   */ _process(taskProducer, dataCategory) {
        this._numProcessing++;
        void this._promiseBuffer.add(taskProducer).then((value)=>{
            this._numProcessing--;
            return value;
        }, (reason)=>{
            this._numProcessing--;
            if (reason === __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$promisebuffer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SENTRY_BUFFER_FULL_ERROR"]) {
                this.recordDroppedEvent('queue_overflow', dataCategory);
            }
            return reason;
        });
    }
    /**
   * Clears outcomes on this client and returns them.
   */ _clearOutcomes() {
        const outcomes = this._outcomes;
        this._outcomes = {};
        return Object.entries(outcomes).map(([key, quantity])=>{
            const [reason, category] = key.split(':');
            return {
                reason,
                category,
                quantity
            };
        });
    }
    /**
   * Sends client reports as an envelope.
   */ _flushOutcomes() {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('Flushing outcomes...');
        const outcomes = this._clearOutcomes();
        if (outcomes.length === 0) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('No outcomes to send');
            return;
        }
        // This is really the only place where we want to check for a DSN and only send outcomes then
        if (!this._dsn) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('No dsn provided, will not send outcomes');
            return;
        }
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('Sending outcomes:', outcomes);
        const envelope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$clientreport$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createClientReportEnvelope"])(outcomes, this._options.tunnel && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$dsn$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dsnToString"])(this._dsn));
        // sendEnvelope should not throw
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.sendEnvelope(envelope);
    }
}
function getDataCategoryByType(type) {
    return type === 'replay_event' ? 'replay' : type || 'error';
}
/**
 * Verifies that return value of configured `beforeSend` or `beforeSendTransaction` is of expected type, and returns the value if so.
 */ function _validateBeforeSendResult(beforeSendResult, beforeSendLabel) {
    const invalidValueError = `${beforeSendLabel} must return \`null\` or a valid event.`;
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isThenable"])(beforeSendResult)) {
        return beforeSendResult.then((event)=>{
            if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isPlainObject"])(event) && event !== null) {
                throw _makeInternalError(invalidValueError);
            }
            return event;
        }, (e)=>{
            throw _makeInternalError(`${beforeSendLabel} rejected with ${e}`);
        });
    } else if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isPlainObject"])(beforeSendResult) && beforeSendResult !== null) {
        throw _makeInternalError(invalidValueError);
    }
    return beforeSendResult;
}
/**
 * Process the matching `beforeSendXXX` callback.
 */ function processBeforeSend(client, options, event, hint) {
    const { beforeSend, beforeSendTransaction, beforeSendSpan, ignoreSpans } = options;
    let processedEvent = event;
    if (isErrorEvent(processedEvent) && beforeSend) {
        return beforeSend(processedEvent, hint);
    }
    if (isTransactionEvent(processedEvent)) {
        // Avoid processing if we don't have to
        if (beforeSendSpan || ignoreSpans) {
            // 1. Process root span
            const rootSpanJson = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$transactionEvent$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["convertTransactionEventToSpanJson"])(processedEvent);
            // 1.1 If the root span should be ignored, drop the whole transaction
            if (ignoreSpans?.length && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$should$2d$ignore$2d$span$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["shouldIgnoreSpan"])(rootSpanJson, ignoreSpans)) {
                // dropping the whole transaction!
                return null;
            }
            // 1.2 If a `beforeSendSpan` callback is defined, process the root span
            if (beforeSendSpan) {
                const processedRootSpanJson = beforeSendSpan(rootSpanJson);
                if (!processedRootSpanJson) {
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["showSpanDropWarning"])();
                } else {
                    // update event with processed root span values
                    processedEvent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$merge$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["merge"])(event, (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$transactionEvent$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["convertSpanJsonToTransactionEvent"])(processedRootSpanJson));
                }
            }
            // 2. Process child spans
            if (processedEvent.spans) {
                const processedSpans = [];
                const initialSpans = processedEvent.spans;
                for (const span of initialSpans){
                    // 2.a If the child span should be ignored, reparent it to the root span
                    if (ignoreSpans?.length && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$should$2d$ignore$2d$span$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["shouldIgnoreSpan"])(span, ignoreSpans)) {
                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$should$2d$ignore$2d$span$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["reparentChildSpans"])(initialSpans, span);
                        continue;
                    }
                    // 2.b If a `beforeSendSpan` callback is defined, process the child span
                    if (beforeSendSpan) {
                        const processedSpan = beforeSendSpan(span);
                        if (!processedSpan) {
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["showSpanDropWarning"])();
                            processedSpans.push(span);
                        } else {
                            processedSpans.push(processedSpan);
                        }
                    } else {
                        processedSpans.push(span);
                    }
                }
                const droppedSpans = processedEvent.spans.length - processedSpans.length;
                if (droppedSpans) {
                    client.recordDroppedEvent('before_send', 'span', droppedSpans);
                }
                processedEvent.spans = processedSpans;
            }
        }
        if (beforeSendTransaction) {
            if (processedEvent.spans) {
                // We store the # of spans before processing in SDK metadata,
                // so we can compare it afterwards to determine how many spans were dropped
                const spanCountBefore = processedEvent.spans.length;
                processedEvent.sdkProcessingMetadata = {
                    ...event.sdkProcessingMetadata,
                    spanCountBeforeProcessing: spanCountBefore
                };
            }
            return beforeSendTransaction(processedEvent, hint);
        }
    }
    return processedEvent;
}
function isErrorEvent(event) {
    return event.type === undefined;
}
function isTransactionEvent(event) {
    return event.type === 'transaction';
}
/**
 * Estimate the size of a metric in bytes.
 *
 * @param metric - The metric to estimate the size of.
 * @returns The estimated size of the metric in bytes.
 */ function estimateMetricSizeInBytes(metric) {
    let weight = 0;
    // Estimate byte size of 2 bytes per character. This is a rough estimate JS strings are stored as UTF-16.
    if (metric.name) {
        weight += metric.name.length * 2;
    }
    // Add weight for number
    weight += 8;
    return weight + estimateAttributesSizeInBytes(metric.attributes);
}
/**
 * Estimate the size of a log in bytes.
 *
 * @param log - The log to estimate the size of.
 * @returns The estimated size of the log in bytes.
 */ function estimateLogSizeInBytes(log) {
    let weight = 0;
    // Estimate byte size of 2 bytes per character. This is a rough estimate JS strings are stored as UTF-16.
    if (log.message) {
        weight += log.message.length * 2;
    }
    return weight + estimateAttributesSizeInBytes(log.attributes);
}
/**
 * Estimate the size of attributes in bytes.
 *
 * @param attributes - The attributes object to estimate the size of.
 * @returns The estimated size of the attributes in bytes.
 */ function estimateAttributesSizeInBytes(attributes) {
    if (!attributes) {
        return 0;
    }
    let weight = 0;
    Object.values(attributes).forEach((value)=>{
        if (Array.isArray(value)) {
            weight += value.length * estimatePrimitiveSizeInBytes(value[0]);
        } else if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isPrimitive"])(value)) {
            weight += estimatePrimitiveSizeInBytes(value);
        } else {
            // For objects values, we estimate the size of the object as 100 bytes
            weight += 100;
        }
    });
    return weight;
}
function estimatePrimitiveSizeInBytes(value) {
    if (typeof value === 'string') {
        return value.length * 2;
    } else if (typeof value === 'number') {
        return 8;
    } else if (typeof value === 'boolean') {
        return 4;
    }
    return 0;
}
;
 //# sourceMappingURL=client.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/transports/userAgent.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addUserAgentToTransportHeaders",
    ()=>addUserAgentToTransportHeaders
]);
/**
 * Takes the SDK metadata and adds the user-agent header to the transport options.
 * This ensures that the SDK sends the user-agent header with SDK name and version to
 * all requests made by the transport.
 *
 * @see https://develop.sentry.dev/sdk/overview/#user-agent
 */ function addUserAgentToTransportHeaders(options) {
    const sdkMetadata = options._metadata?.sdk;
    const sdkUserAgent = sdkMetadata?.name && sdkMetadata?.version ? `${sdkMetadata?.name}/${sdkMetadata?.version}` : undefined;
    options.transportOptions = {
        ...options.transportOptions,
        headers: {
            ...sdkUserAgent && {
                'user-agent': sdkUserAgent
            },
            ...options.transportOptions?.headers
        }
    };
}
;
 //# sourceMappingURL=userAgent.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/eventbuilder.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "_enhanceErrorWithSentryInfo",
    ()=>_enhanceErrorWithSentryInfo,
    "eventFromMessage",
    ()=>eventFromMessage,
    "eventFromUnknownInput",
    ()=>eventFromUnknownInput,
    "exceptionFromError",
    ()=>exceptionFromError,
    "parseStackFrames",
    ()=>parseStackFrames
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/misc.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/normalize.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/object.js [instrumentation-edge] (ecmascript)");
;
;
;
;
/**
 * Extracts stack frames from the error.stack string
 */ function parseStackFrames(stackParser, error) {
    return stackParser(error.stack || '', 1);
}
function hasSentryFetchUrlHost(error) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isError"])(error) && '__sentry_fetch_url_host__' in error && typeof error.__sentry_fetch_url_host__ === 'string';
}
/**
 * Enhances the error message with the hostname for better Sentry error reporting.
 * This allows third-party packages to still match on the original error message,
 * while Sentry gets the enhanced version with context.
 *
 * Only used internally
 * @hidden
 */ function _enhanceErrorWithSentryInfo(error) {
    // If the error has a __sentry_fetch_url_host__ property (added by fetch instrumentation),
    // enhance the error message with the hostname.
    if (hasSentryFetchUrlHost(error)) {
        return `${error.message} (${error.__sentry_fetch_url_host__})`;
    }
    return error.message;
}
/**
 * Extracts stack frames from the error and builds a Sentry Exception
 */ function exceptionFromError(stackParser, error) {
    const exception = {
        type: error.name || error.constructor.name,
        value: _enhanceErrorWithSentryInfo(error)
    };
    const frames = parseStackFrames(stackParser, error);
    if (frames.length) {
        exception.stacktrace = {
            frames
        };
    }
    return exception;
}
/** If a plain object has a property that is an `Error`, return this error. */ function getErrorPropertyFromObject(obj) {
    for(const prop in obj){
        if (Object.prototype.hasOwnProperty.call(obj, prop)) {
            const value = obj[prop];
            if (value instanceof Error) {
                return value;
            }
        }
    }
    return undefined;
}
function getMessageForObject(exception) {
    if ('name' in exception && typeof exception.name === 'string') {
        let message = `'${exception.name}' captured as exception`;
        if ('message' in exception && typeof exception.message === 'string') {
            message += ` with message '${exception.message}'`;
        }
        return message;
    } else if ('message' in exception && typeof exception.message === 'string') {
        return exception.message;
    }
    const keys = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["extractExceptionKeysForMessage"])(exception);
    // Some ErrorEvent instances do not have an `error` property, which is why they are not handled before
    // We still want to try to get a decent message for these cases
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isErrorEvent"])(exception)) {
        return `Event \`ErrorEvent\` captured as exception with message \`${exception.message}\``;
    }
    const className = getObjectClassName(exception);
    return `${className && className !== 'Object' ? `'${className}'` : 'Object'} captured as exception with keys: ${keys}`;
}
function getObjectClassName(obj) {
    try {
        const prototype = Object.getPrototypeOf(obj);
        return prototype ? prototype.constructor.name : undefined;
    } catch  {
    // ignore errors here
    }
}
function getException(client, mechanism, exception, hint) {
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isError"])(exception)) {
        return [
            exception,
            undefined
        ];
    }
    // Mutate this!
    mechanism.synthetic = true;
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isPlainObject"])(exception)) {
        const normalizeDepth = client?.getOptions().normalizeDepth;
        const extras = {
            ['__serialized__']: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$normalize$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["normalizeToSize"])(exception, normalizeDepth)
        };
        const errorFromProp = getErrorPropertyFromObject(exception);
        if (errorFromProp) {
            return [
                errorFromProp,
                extras
            ];
        }
        const message = getMessageForObject(exception);
        const ex = hint?.syntheticException || new Error(message);
        ex.message = message;
        return [
            ex,
            extras
        ];
    }
    // This handles when someone does: `throw "something awesome";`
    // We use synthesized Error here so we can extract a (rough) stack trace.
    const ex = hint?.syntheticException || new Error(exception);
    ex.message = `${exception}`;
    return [
        ex,
        undefined
    ];
}
/**
 * Builds and Event from a Exception
 * @hidden
 */ function eventFromUnknownInput(client, stackParser, exception, hint) {
    const providedMechanism = hint?.data && hint.data.mechanism;
    const mechanism = providedMechanism || {
        handled: true,
        type: 'generic'
    };
    const [ex, extras] = getException(client, mechanism, exception, hint);
    const event = {
        exception: {
            values: [
                exceptionFromError(stackParser, ex)
            ]
        }
    };
    if (extras) {
        event.extra = extras;
    }
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addExceptionTypeValue"])(event, undefined, undefined);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addExceptionMechanism"])(event, mechanism);
    return {
        ...event,
        event_id: hint?.event_id
    };
}
/**
 * Builds and Event from a Message
 * @hidden
 */ function eventFromMessage(stackParser, message, level = 'info', hint, attachStacktrace) {
    const event = {
        event_id: hint?.event_id,
        level
    };
    if (attachStacktrace && hint?.syntheticException) {
        const frames = parseStackFrames(stackParser, hint.syntheticException);
        if (frames.length) {
            event.exception = {
                values: [
                    {
                        value: message,
                        stacktrace: {
                            frames
                        }
                    }
                ]
            };
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addExceptionMechanism"])(event, {
                synthetic: true
            });
        }
    }
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isParameterizedString"])(message)) {
        const { __sentry_template_string__, __sentry_template_values__ } = message;
        event.logentry = {
            message: __sentry_template_string__,
            params: __sentry_template_values__
        };
        return event;
    }
    event.message = message;
    return event;
}
;
 //# sourceMappingURL=eventbuilder.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/server-runtime-client.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ServerRuntimeClient",
    ()=>ServerRuntimeClient
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$checkin$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/checkin.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$client$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/client.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$errors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/errors.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/misc.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$transports$2f$base$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/transports/base.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$transports$2f$userAgent$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/transports/userAgent.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$eventbuilder$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/eventbuilder.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$promisebuffer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/promisebuffer.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$syncpromise$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/syncpromise.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$trace$2d$info$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/trace-info.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
;
/**
 * The Sentry Server Runtime Client SDK.
 */ class ServerRuntimeClient extends __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$client$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["Client"] {
    /**
   * Creates a new Edge SDK instance.
   * @param options Configuration options for this SDK.
   */ constructor(options){
        // Server clients always support tracing
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$errors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["registerSpanErrorInstrumentation"])();
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$transports$2f$userAgent$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addUserAgentToTransportHeaders"])(options);
        super(options);
        this._setUpMetricsProcessing();
    }
    /**
   * @inheritDoc
   */ eventFromException(exception, hint) {
        const event = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$eventbuilder$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["eventFromUnknownInput"])(this, this._options.stackParser, exception, hint);
        event.level = 'error';
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$syncpromise$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["resolvedSyncPromise"])(event);
    }
    /**
   * @inheritDoc
   */ eventFromMessage(message, level = 'info', hint) {
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$syncpromise$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["resolvedSyncPromise"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$eventbuilder$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["eventFromMessage"])(this._options.stackParser, message, level, hint, this._options.attachStacktrace));
    }
    /**
   * @inheritDoc
   */ captureException(exception, hint, scope) {
        setCurrentRequestSessionErroredOrCrashed(hint);
        return super.captureException(exception, hint, scope);
    }
    /**
   * @inheritDoc
   */ captureEvent(event, hint, scope) {
        // If the event is of type Exception, then a request session should be captured
        const isException = !event.type && event.exception?.values && event.exception.values.length > 0;
        if (isException) {
            setCurrentRequestSessionErroredOrCrashed(hint);
        }
        return super.captureEvent(event, hint, scope);
    }
    /**
   * Create a cron monitor check in and send it to Sentry.
   *
   * @param checkIn An object that describes a check in.
   * @param upsertMonitorConfig An optional object that describes a monitor config. Use this if you want
   * to create a monitor automatically when sending a check in.
   */ captureCheckIn(checkIn, monitorConfig, scope) {
        const id = 'checkInId' in checkIn && checkIn.checkInId ? checkIn.checkInId : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["uuid4"])();
        if (!this._isEnabled()) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('SDK not enabled, will not capture check-in.');
            return id;
        }
        const options = this.getOptions();
        const { release, environment, tunnel } = options;
        const serializedCheckIn = {
            check_in_id: id,
            monitor_slug: checkIn.monitorSlug,
            status: checkIn.status,
            release,
            environment
        };
        if ('duration' in checkIn) {
            serializedCheckIn.duration = checkIn.duration;
        }
        if (monitorConfig) {
            serializedCheckIn.monitor_config = {
                schedule: monitorConfig.schedule,
                checkin_margin: monitorConfig.checkinMargin,
                max_runtime: monitorConfig.maxRuntime,
                timezone: monitorConfig.timezone,
                failure_issue_threshold: monitorConfig.failureIssueThreshold,
                recovery_threshold: monitorConfig.recoveryThreshold
            };
        }
        const [dynamicSamplingContext, traceContext] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$trace$2d$info$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["_getTraceInfoFromScope"])(this, scope);
        if (traceContext) {
            serializedCheckIn.contexts = {
                trace: traceContext
            };
        }
        const envelope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$checkin$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["createCheckInEnvelope"])(serializedCheckIn, dynamicSamplingContext, this.getSdkMetadata(), tunnel, this.getDsn());
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('Sending checkin:', checkIn.monitorSlug, checkIn.status);
        // sendEnvelope should not throw
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.sendEnvelope(envelope);
        return id;
    }
    /**
   * Disposes of the client and releases all resources.
   *
   * This method clears all internal state to allow the client to be garbage collected.
   * It clears hooks, event processors, integrations, transport, and other internal references.
   *
   * Call this method after flushing to allow the client to be garbage collected.
   * After calling dispose(), the client should not be used anymore.
   *
   * Subclasses should override this method to clean up their own resources and call `super.dispose()`.
   */ dispose() {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].log('Disposing client...');
        for (const hookName of Object.keys(this._hooks)){
            this._hooks[hookName]?.clear();
        }
        this._hooks = {};
        this._eventProcessors.length = 0;
        this._integrations = {};
        this._outcomes = {};
        this._transport = undefined;
        this._promiseBuffer = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$promisebuffer$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["makePromiseBuffer"])(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$transports$2f$base$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEFAULT_TRANSPORT_BUFFER_SIZE"]);
    }
    /**
   * @inheritDoc
   */ _prepareEvent(event, hint, currentScope, isolationScope) {
        if (this._options.platform) {
            event.platform = event.platform || this._options.platform;
        }
        if (this._options.runtime) {
            event.contexts = {
                ...event.contexts,
                runtime: event.contexts?.runtime || this._options.runtime
            };
        }
        if (this._options.serverName) {
            event.server_name = event.server_name || this._options.serverName;
        }
        return super._prepareEvent(event, hint, currentScope, isolationScope);
    }
    /**
   * Process a server-side metric before it is captured.
   */ _setUpMetricsProcessing() {
        this.on('processMetric', (metric)=>{
            if (this._options.serverName) {
                metric.attributes = {
                    'server.address': this._options.serverName,
                    ...metric.attributes
                };
            }
        });
    }
}
function setCurrentRequestSessionErroredOrCrashed(eventHint) {
    const requestSession = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])().getScopeData().sdkProcessingMetadata.requestSession;
    if (requestSession) {
        // We mutate instead of doing `setSdkProcessingMetadata` because the http integration stores away a particular
        // isolationScope. If that isolation scope is forked, setting the processing metadata here will not mutate the
        // original isolation scope that the http integration stored away.
        const isHandledException = eventHint?.mechanism?.handled ?? true;
        // A request session can go from "errored" -> "crashed" but not "crashed" -> "errored".
        // Crashed (unhandled exception) is worse than errored (handled exception).
        if (isHandledException && requestSession.status !== 'crashed') {
            requestSession.status = 'errored';
        } else if (!isHandledException) {
            requestSession.status = 'crashed';
        }
    }
}
;
 //# sourceMappingURL=server-runtime-client.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/supports.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "isNativeFunction",
    ()=>isNativeFunction,
    "supportsDOMError",
    ()=>supportsDOMError,
    "supportsDOMException",
    ()=>supportsDOMException,
    "supportsErrorEvent",
    ()=>supportsErrorEvent,
    "supportsFetch",
    ()=>supportsFetch,
    "supportsHistory",
    ()=>supportsHistory,
    "supportsNativeFetch",
    ()=>supportsNativeFetch,
    "supportsReferrerPolicy",
    ()=>supportsReferrerPolicy,
    "supportsReportingObserver",
    ()=>supportsReportingObserver
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
;
;
const WINDOW = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"];
/**
 * Tells whether current environment supports ErrorEvent objects
 * {@link supportsErrorEvent}.
 *
 * @returns Answer to the given question.
 */ function supportsErrorEvent() {
    try {
        new ErrorEvent('');
        return true;
    } catch  {
        return false;
    }
}
/**
 * Tells whether current environment supports DOMError objects
 * {@link supportsDOMError}.
 *
 * @returns Answer to the given question.
 */ function supportsDOMError() {
    try {
        // Chrome: VM89:1 Uncaught TypeError: Failed to construct 'DOMError':
        // 1 argument required, but only 0 present.
        // @ts-expect-error It really needs 1 argument, not 0.
        new DOMError('');
        return true;
    } catch  {
        return false;
    }
}
/**
 * Tells whether current environment supports DOMException objects
 * {@link supportsDOMException}.
 *
 * @returns Answer to the given question.
 */ function supportsDOMException() {
    try {
        new DOMException('');
        return true;
    } catch  {
        return false;
    }
}
/**
 * Tells whether current environment supports History API
 * {@link supportsHistory}.
 *
 * @returns Answer to the given question.
 */ function supportsHistory() {
    return 'history' in WINDOW && !!WINDOW.history;
}
/**
 * Tells whether current environment supports Fetch API
 * {@link supportsFetch}.
 *
 * @returns Answer to the given question.
 * @deprecated This is no longer used and will be removed in a future major version.
 */ const supportsFetch = _isFetchSupported;
function _isFetchSupported() {
    if (!('fetch' in WINDOW)) {
        return false;
    }
    try {
        new Headers();
        // Deno requires a valid URL so '' cannot be used as an argument
        new Request('data:,');
        new Response();
        return true;
    } catch  {
        return false;
    }
}
/**
 * isNative checks if the given function is a native implementation
 */ // eslint-disable-next-line @typescript-eslint/ban-types
function isNativeFunction(func) {
    return func && /^function\s+\w+\(\)\s+\{\s+\[native code\]\s+\}$/.test(func.toString());
}
/**
 * Tells whether current environment supports Fetch API natively
 * {@link supportsNativeFetch}.
 *
 * @returns true if `window.fetch` is natively implemented, false otherwise
 */ function supportsNativeFetch() {
    if (typeof ("TURBOPACK compile-time value", "edge-runtime") === 'string') {
        return true;
    }
    if (!_isFetchSupported()) {
        return false;
    }
    // Fast path to avoid DOM I/O
    // eslint-disable-next-line @typescript-eslint/unbound-method
    if (isNativeFunction(WINDOW.fetch)) {
        return true;
    }
    // window.fetch is implemented, but is polyfilled or already wrapped (e.g: by a chrome extension)
    // so create a "pure" iframe to see if that has native fetch
    let result = false;
    const doc = WINDOW.document;
    // eslint-disable-next-line deprecation/deprecation
    if (doc && typeof doc.createElement === 'function') {
        try {
            const sandbox = doc.createElement('iframe');
            sandbox.hidden = true;
            doc.head.appendChild(sandbox);
            if (sandbox.contentWindow?.fetch) {
                // eslint-disable-next-line @typescript-eslint/unbound-method
                result = isNativeFunction(sandbox.contentWindow.fetch);
            }
            doc.head.removeChild(sandbox);
        } catch (err) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('Could not create sandbox iframe for pure fetch check, bailing to window.fetch: ', err);
        }
    }
    return result;
}
/**
 * Tells whether current environment supports ReportingObserver API
 * {@link supportsReportingObserver}.
 *
 * @returns Answer to the given question.
 */ function supportsReportingObserver() {
    return 'ReportingObserver' in WINDOW;
}
/**
 * Tells whether current environment supports Referrer Policy API
 * {@link supportsReferrerPolicy}.
 *
 * @returns Answer to the given question.
 * @deprecated This is no longer used and will be removed in a future major version.
 */ function supportsReferrerPolicy() {
    // Despite all stars in the sky saying that Edge supports old draft syntax, aka 'never', 'always', 'origin' and 'default'
    // (see https://caniuse.com/#feat=referrer-policy),
    // it doesn't. And it throws an exception instead of ignoring this parameter...
    // REF: https://github.com/getsentry/raven-js/issues/1233
    if (!_isFetchSupported()) {
        return false;
    }
    try {
        new Request('_', {
            referrerPolicy: 'origin'
        });
        return true;
    } catch  {
        return false;
    }
}
;
 //# sourceMappingURL=supports.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/fetch.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addFetchEndInstrumentationHandler",
    ()=>addFetchEndInstrumentationHandler,
    "addFetchInstrumentationHandler",
    ()=>addFetchInstrumentationHandler,
    "parseFetchArgs",
    ()=>parseFetchArgs
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/object.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$supports$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/supports.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/time.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/handlers.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
/* eslint-disable @typescript-eslint/no-explicit-any */ /**
 * Add an instrumentation handler for when a fetch request happens.
 * The handler function is called once when the request starts and once when it ends,
 * which can be identified by checking if it has an `endTimestamp`.
 *
 * Use at your own risk, this might break without changelog notice, only used internally.
 * @hidden
 */ function addFetchInstrumentationHandler(handler, skipNativeFetchCheck) {
    const type = 'fetch';
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addHandler"])(type, handler);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["maybeInstrument"])(type, ()=>instrumentFetch(undefined, skipNativeFetchCheck));
}
/**
 * Add an instrumentation handler for long-lived fetch requests, like consuming server-sent events (SSE) via fetch.
 * The handler will resolve the request body and emit the actual `endTimestamp`, so that the
 * span can be updated accordingly.
 *
 * Only used internally
 * @hidden
 */ function addFetchEndInstrumentationHandler(handler) {
    const type = 'fetch-body-resolved';
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addHandler"])(type, handler);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["maybeInstrument"])(type, ()=>instrumentFetch(streamHandler));
}
function instrumentFetch(onFetchResolved, skipNativeFetchCheck = false) {
    if (skipNativeFetchCheck && !(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$supports$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["supportsNativeFetch"])()) {
        return;
    }
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["fill"])(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"], 'fetch', function(originalFetch) {
        return function(...args) {
            // We capture the error right here and not in the Promise error callback because Safari (and probably other
            // browsers too) will wipe the stack trace up to this point, only leaving us with this file which is useless.
            // NOTE: If you are a Sentry user, and you are seeing this stack frame,
            //       it means the error, that was caused by your fetch call did not
            //       have a stack trace, so the SDK backfilled the stack trace so
            //       you can see which fetch call failed.
            const virtualError = new Error();
            const { method, url } = parseFetchArgs(args);
            const handlerData = {
                args,
                fetchData: {
                    method,
                    url
                },
                startTimestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timestampInSeconds"])() * 1000,
                // // Adding the error to be able to fingerprint the failed fetch event in HttpClient instrumentation
                virtualError,
                headers: getHeadersFromFetchArgs(args)
            };
            // if there is no callback, fetch is instrumented directly
            if (!onFetchResolved) {
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["triggerHandlers"])('fetch', {
                    ...handlerData
                });
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            return originalFetch.apply(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"], args).then(async (response)=>{
                if (onFetchResolved) {
                    onFetchResolved(response);
                } else {
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["triggerHandlers"])('fetch', {
                        ...handlerData,
                        endTimestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timestampInSeconds"])() * 1000,
                        response
                    });
                }
                return response;
            }, (error)=>{
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["triggerHandlers"])('fetch', {
                    ...handlerData,
                    endTimestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timestampInSeconds"])() * 1000,
                    error
                });
                if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isError"])(error) && error.stack === undefined) {
                    // NOTE: If you are a Sentry user, and you are seeing this stack frame,
                    //       it means the error, that was caused by your fetch call did not
                    //       have a stack trace, so the SDK backfilled the stack trace so
                    //       you can see which fetch call failed.
                    error.stack = virtualError.stack;
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addNonEnumerableProperty"])(error, 'framesToPop', 1);
                }
                // We enhance fetch error messages with hostname information based on the configuration.
                // Possible messages we handle here:
                // * "Failed to fetch" (chromium)
                // * "Load failed" (webkit)
                // * "NetworkError when attempting to fetch resource." (firefox)
                const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
                const enhanceOption = client?.getOptions().enhanceFetchErrorMessages ?? 'always';
                const shouldEnhance = enhanceOption !== false;
                if (shouldEnhance && error instanceof TypeError && (error.message === 'Failed to fetch' || error.message === 'Load failed' || error.message === 'NetworkError when attempting to fetch resource.')) {
                    try {
                        const url = new URL(handlerData.fetchData.url);
                        const hostname = url.host;
                        if (enhanceOption === 'always') {
                            // Modify the error message directly
                            error.message = `${error.message} (${hostname})`;
                        } else {
                            // Store hostname as non-enumerable property for Sentry-only enhancement
                            // This preserves the original error message for third-party packages
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addNonEnumerableProperty"])(error, '__sentry_fetch_url_host__', hostname);
                        }
                    } catch  {
                    // ignore it if errors happen here
                    }
                }
                // NOTE: If you are a Sentry user, and you are seeing this stack frame,
                //       it means the sentry.javascript SDK caught an error invoking your application code.
                //       This is expected behavior and NOT indicative of a bug with sentry.javascript.
                throw error;
            });
        };
    });
}
async function resolveResponse(res, onFinishedResolving) {
    if (res?.body) {
        const body = res.body;
        const responseReader = body.getReader();
        // Define a maximum duration after which we just cancel
        const maxFetchDurationTimeout = setTimeout(()=>{
            body.cancel().then(null, ()=>{
            // noop
            });
        }, 90 * 1000);
        let readingActive = true;
        while(readingActive){
            let chunkTimeout;
            try {
                // abort reading if read op takes more than 5s
                chunkTimeout = setTimeout(()=>{
                    body.cancel().then(null, ()=>{
                    // noop on error
                    });
                }, 5000);
                // This .read() call will reject/throw when we abort due to timeouts through `body.cancel()`
                const { done } = await responseReader.read();
                clearTimeout(chunkTimeout);
                if (done) {
                    onFinishedResolving();
                    readingActive = false;
                }
            } catch  {
                readingActive = false;
            } finally{
                clearTimeout(chunkTimeout);
            }
        }
        clearTimeout(maxFetchDurationTimeout);
        responseReader.releaseLock();
        body.cancel().then(null, ()=>{
        // noop on error
        });
    }
}
function streamHandler(response) {
    // clone response for awaiting stream
    let clonedResponseForResolving;
    try {
        clonedResponseForResolving = response.clone();
    } catch  {
        return;
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    resolveResponse(clonedResponseForResolving, ()=>{
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$handlers$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["triggerHandlers"])('fetch-body-resolved', {
            endTimestamp: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["timestampInSeconds"])() * 1000,
            response
        });
    });
}
function hasProp(obj, prop) {
    return !!obj && typeof obj === 'object' && !!obj[prop];
}
function getUrlFromResource(resource) {
    if (typeof resource === 'string') {
        return resource;
    }
    if (!resource) {
        return '';
    }
    if (hasProp(resource, 'url')) {
        return resource.url;
    }
    if (resource.toString) {
        return resource.toString();
    }
    return '';
}
/**
 * Parses the fetch arguments to find the used Http method and the url of the request.
 * Exported for tests only.
 */ function parseFetchArgs(fetchArgs) {
    if (fetchArgs.length === 0) {
        return {
            method: 'GET',
            url: ''
        };
    }
    if (fetchArgs.length === 2) {
        const [resource, options] = fetchArgs;
        return {
            url: getUrlFromResource(resource),
            method: hasProp(options, 'method') ? String(options.method).toUpperCase() : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isRequest"])(resource) && hasProp(resource, 'method') ? String(resource.method).toUpperCase() : 'GET'
        };
    }
    const arg = fetchArgs[0];
    return {
        url: getUrlFromResource(arg),
        method: hasProp(arg, 'method') ? String(arg.method).toUpperCase() : 'GET'
    };
}
function getHeadersFromFetchArgs(fetchArgs) {
    const [requestArgument, optionsArgument] = fetchArgs;
    try {
        if (typeof optionsArgument === 'object' && optionsArgument !== null && 'headers' in optionsArgument && optionsArgument.headers) {
            return new Headers(optionsArgument.headers);
        }
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isRequest"])(requestArgument)) {
            return new Headers(requestArgument.headers);
        }
    } catch  {
    // noop
    }
    return;
}
;
 //# sourceMappingURL=fetch.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/traceData.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getTraceData",
    ()=>getTraceData
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/asyncContext/index.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/carrier.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$exports$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/exports.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/dynamicSamplingContext.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/baggage.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/tracing.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
;
/**
 * Extracts trace propagation data from the current span or from the client's scope (via transaction or propagation
 * context) and serializes it to `sentry-trace` and `baggage` values. These values can be used to propagate
 * a trace via our tracing Http headers or Html `<meta>` tags.
 *
 * This function also applies some validation to the generated sentry-trace and baggage values to ensure that
 * only valid strings are returned.
 *
 * If (@param options.propagateTraceparent) is `true`, the function will also generate a `traceparent` value,
 * following the W3C traceparent header format.
 *
 * @returns an object with the tracing data values. The object keys are the name of the tracing key to be used as header
 * or meta tag name.
 */ function getTraceData(options = {}) {
    const client = options.client || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$exports$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isEnabled"])() || !client) {
        return {};
    }
    const carrier = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$carrier$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getMainCarrier"])();
    const acs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$asyncContext$2f$index$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getAsyncContextStrategy"])(carrier);
    if (acs.getTraceData) {
        return acs.getTraceData(options);
    }
    const scope = options.scope || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])();
    const span = options.span || (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getActiveSpan"])();
    const sentryTrace = span ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToTraceHeader"])(span) : scopeToTraceHeader(scope);
    const dsc = span ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromSpan"])(span) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$dynamicSamplingContext$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getDynamicSamplingContextFromScope"])(client, scope);
    const baggage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dynamicSamplingContextToSentryBaggageHeader"])(dsc);
    const isValidSentryTraceHeader = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["TRACEPARENT_REGEXP"].test(sentryTrace);
    if (!isValidSentryTraceHeader) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('Invalid sentry-trace data. Cannot generate trace data');
        return {};
    }
    const traceData = {
        'sentry-trace': sentryTrace,
        baggage
    };
    if (options.propagateTraceparent) {
        traceData.traceparent = span ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToTraceparentHeader"])(span) : scopeToTraceparentHeader(scope);
    }
    return traceData;
}
/**
 * Get a sentry-trace header value for the given scope.
 */ function scopeToTraceHeader(scope) {
    const { traceId, sampled, propagationSpanId } = scope.getPropagationContext();
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateSentryTraceHeader"])(traceId, propagationSpanId, sampled);
}
function scopeToTraceparentHeader(scope) {
    const { traceId, sampled, propagationSpanId } = scope.getPropagationContext();
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$tracing$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["generateTraceparentHeader"])(traceId, propagationSpanId, sampled);
}
;
 //# sourceMappingURL=traceData.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/fetch.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "_addTracingHeadersToFetchRequest",
    ()=>_addTracingHeadersToFetchRequest,
    "_callOnRequestSpanEnd",
    ()=>_callOnRequestSpanEnd,
    "instrumentFetchRequest",
    ()=>instrumentFetchRequest
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/spanstatus.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/hasSpansEnabled.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/baggage.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sentryNonRecordingSpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/sentryNonRecordingSpan.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/trace.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$traceData$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/traceData.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/url.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
/**
 * Create and track fetch request spans for usage in combination with `addFetchInstrumentationHandler`.
 *
 * @returns Span if a span was created, otherwise void.
 */ function instrumentFetchRequest(handlerData, shouldCreateSpan, shouldAttachHeaders, spans, spanOriginOrOptions) {
    if (!handlerData.fetchData) {
        return undefined;
    }
    const { method, url } = handlerData.fetchData;
    const shouldCreateSpanResult = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])() && shouldCreateSpan(url);
    if (handlerData.endTimestamp) {
        const spanId = handlerData.fetchData.__span;
        if (!spanId) return;
        const span = spans[spanId];
        if (span) {
            // Only end the span and call hooks if we're actually recording
            if (shouldCreateSpanResult) {
                endSpan(span, handlerData);
                _callOnRequestSpanEnd(span, handlerData, spanOriginOrOptions);
            }
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete spans[spanId];
        }
        return undefined;
    }
    // Backwards-compatible with the old signature. Needed to introduce the combined optional parameter
    // to avoid API breakage for anyone calling this function with the optional spanOrigin parameter
    // TODO (v11): remove this backwards-compatible code and only accept the options parameter
    const { spanOrigin = 'auto.http.browser', propagateTraceparent = false } = typeof spanOriginOrOptions === 'object' ? spanOriginOrOptions : {
        spanOrigin: spanOriginOrOptions
    };
    const hasParent = !!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getActiveSpan"])();
    const span = shouldCreateSpanResult && hasParent ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$trace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["startInactiveSpan"])(getSpanStartOptions(url, method, spanOrigin)) : new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$sentryNonRecordingSpan$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SentryNonRecordingSpan"]();
    handlerData.fetchData.__span = span.spanContext().spanId;
    spans[span.spanContext().spanId] = span;
    if (shouldAttachHeaders(handlerData.fetchData.url)) {
        const request = handlerData.args[0];
        // Shallow clone the options object to avoid mutating the original user-provided object
        // Examples: users re-using same options object for multiple fetch calls, frozen objects
        const options = {
            ...handlerData.args[1] || {}
        };
        const headers = _addTracingHeadersToFetchRequest(request, options, // If performance is disabled (TWP) or there's no active root span (pageload/navigation/interaction),
        // we do not want to use the span as base for the trace headers,
        // which means that the headers will be generated from the scope and the sampling decision is deferred
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$hasSpansEnabled$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["hasSpansEnabled"])() && hasParent ? span : undefined, propagateTraceparent);
        if (headers) {
            // Ensure this is actually set, if no options have been passed previously
            handlerData.args[1] = options;
            options.headers = headers;
        }
    }
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    if (client) {
        const fetchHint = {
            input: handlerData.args,
            response: handlerData.response,
            startTimestamp: handlerData.startTimestamp,
            endTimestamp: handlerData.endTimestamp
        };
        client.emit('beforeOutgoingRequestSpan', span, fetchHint);
    }
    return span;
}
/**
 * Calls the onRequestSpanEnd callback if it is defined.
 */ function _callOnRequestSpanEnd(span, handlerData, spanOriginOrOptions) {
    const onRequestSpanEnd = typeof spanOriginOrOptions === 'object' && spanOriginOrOptions !== null ? spanOriginOrOptions.onRequestSpanEnd : undefined;
    onRequestSpanEnd?.(span, {
        headers: handlerData.response?.headers,
        error: handlerData.error
    });
}
/**
 * Adds sentry-trace and baggage headers to the various forms of fetch headers.
 * exported only for testing purposes
 *
 * When we determine if we should add a baggage header, there are 3 cases:
 * 1. No previous baggage header -> add baggage
 * 2. Previous baggage header has no sentry baggage values -> add our baggage
 * 3. Previous baggage header has sentry baggage values -> do nothing (might have been added manually by users)
 */ // eslint-disable-next-line complexity -- yup it's this complicated :(
function _addTracingHeadersToFetchRequest(request, fetchOptionsObj, span, propagateTraceparent) {
    const traceHeaders = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$traceData$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getTraceData"])({
        span,
        propagateTraceparent
    });
    const sentryTrace = traceHeaders['sentry-trace'];
    const baggage = traceHeaders.baggage;
    const traceparent = traceHeaders.traceparent;
    // Nothing to do, when we return undefined here, the original headers will be used
    if (!sentryTrace) {
        return undefined;
    }
    const originalHeaders = fetchOptionsObj.headers || ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isRequest"])(request) ? request.headers : undefined);
    if (!originalHeaders) {
        return {
            ...traceHeaders
        };
    } else if (isHeaders(originalHeaders)) {
        const newHeaders = new Headers(originalHeaders);
        // We don't want to override manually added sentry headers
        if (!newHeaders.get('sentry-trace')) {
            newHeaders.set('sentry-trace', sentryTrace);
        }
        if (propagateTraceparent && traceparent && !newHeaders.get('traceparent')) {
            newHeaders.set('traceparent', traceparent);
        }
        if (baggage) {
            const prevBaggageHeader = newHeaders.get('baggage');
            if (!prevBaggageHeader) {
                newHeaders.set('baggage', baggage);
            } else if (!baggageHeaderHasSentryBaggageValues(prevBaggageHeader)) {
                newHeaders.set('baggage', `${prevBaggageHeader},${baggage}`);
            }
        }
        return newHeaders;
    } else if (Array.isArray(originalHeaders)) {
        const newHeaders = [
            ...originalHeaders
        ];
        if (!originalHeaders.find((header)=>header[0] === 'sentry-trace')) {
            newHeaders.push([
                'sentry-trace',
                sentryTrace
            ]);
        }
        if (propagateTraceparent && traceparent && !originalHeaders.find((header)=>header[0] === 'traceparent')) {
            newHeaders.push([
                'traceparent',
                traceparent
            ]);
        }
        const prevBaggageHeaderWithSentryValues = originalHeaders.find((header)=>header[0] === 'baggage' && baggageHeaderHasSentryBaggageValues(header[1]));
        if (baggage && !prevBaggageHeaderWithSentryValues) {
            // If there are multiple entries with the same key, the browser will merge the values into a single request header.
            // Its therefore safe to simply push a "baggage" entry, even though there might already be another baggage header.
            newHeaders.push([
                'baggage',
                baggage
            ]);
        }
        return newHeaders;
    } else {
        const existingSentryTraceHeader = 'sentry-trace' in originalHeaders ? originalHeaders['sentry-trace'] : undefined;
        const existingTraceparentHeader = 'traceparent' in originalHeaders ? originalHeaders.traceparent : undefined;
        const existingBaggageHeader = 'baggage' in originalHeaders ? originalHeaders.baggage : undefined;
        const newBaggageHeaders = existingBaggageHeader ? Array.isArray(existingBaggageHeader) ? [
            ...existingBaggageHeader
        ] : [
            existingBaggageHeader
        ] : [];
        const prevBaggageHeaderWithSentryValues = existingBaggageHeader && (Array.isArray(existingBaggageHeader) ? existingBaggageHeader.find((headerItem)=>baggageHeaderHasSentryBaggageValues(headerItem)) : baggageHeaderHasSentryBaggageValues(existingBaggageHeader));
        if (baggage && !prevBaggageHeaderWithSentryValues) {
            newBaggageHeaders.push(baggage);
        }
        const newHeaders = {
            ...originalHeaders,
            'sentry-trace': existingSentryTraceHeader ?? sentryTrace,
            baggage: newBaggageHeaders.length > 0 ? newBaggageHeaders.join(',') : undefined
        };
        if (propagateTraceparent && traceparent && !existingTraceparentHeader) {
            newHeaders.traceparent = traceparent;
        }
        return newHeaders;
    }
}
function endSpan(span, handlerData) {
    if (handlerData.response) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["setHttpStatus"])(span, handlerData.response.status);
        const contentLength = handlerData.response?.headers?.get('content-length');
        if (contentLength) {
            const contentLengthNum = parseInt(contentLength);
            if (contentLengthNum > 0) {
                span.setAttribute('http.response_content_length', contentLengthNum);
            }
        }
    } else if (handlerData.error) {
        span.setStatus({
            code: __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$spanstatus$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SPAN_STATUS_ERROR"],
            message: 'internal_error'
        });
    }
    span.end();
}
function baggageHeaderHasSentryBaggageValues(baggageHeader) {
    return baggageHeader.split(',').some((baggageEntry)=>baggageEntry.trim().startsWith(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$baggage$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SENTRY_BAGGAGE_KEY_PREFIX"]));
}
function isHeaders(headers) {
    return typeof Headers !== 'undefined' && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isInstanceOf"])(headers, Headers);
}
function getSpanStartOptions(url, method, spanOrigin) {
    // Data URLs need special handling because parseStringToURLObject treats them as "relative"
    // (no "://"), causing getSanitizedUrlStringFromUrlObject to return just the pathname
    // without the "data:" prefix, making later stripDataUrlContent calls ineffective.
    // So for data URLs, we strip the content first and use that directly.
    if (url.startsWith('data:')) {
        const sanitizedUrl = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stripDataUrlContent"])(url);
        return {
            name: `${method} ${sanitizedUrl}`,
            attributes: getFetchSpanAttributes(url, undefined, method, spanOrigin)
        };
    }
    const parsedUrl = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseStringToURLObject"])(url);
    const sanitizedUrl = parsedUrl ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSanitizedUrlStringFromUrlObject"])(parsedUrl) : url;
    return {
        name: `${method} ${sanitizedUrl}`,
        attributes: getFetchSpanAttributes(url, parsedUrl, method, spanOrigin)
    };
}
function getFetchSpanAttributes(url, parsedUrl, method, spanOrigin) {
    const attributes = {
        url: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stripDataUrlContent"])(url),
        type: 'fetch',
        'http.method': method,
        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"]]: spanOrigin,
        [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"]]: 'http.client'
    };
    if (parsedUrl) {
        if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isURLObjectRelative"])(parsedUrl)) {
            attributes['http.url'] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$url$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stripDataUrlContent"])(parsedUrl.href);
            attributes['server.address'] = parsedUrl.host;
        }
        if (parsedUrl.search) {
            attributes['http.query'] = parsedUrl.search;
        }
        if (parsedUrl.hash) {
            attributes['http.fragment'] = parsedUrl.hash;
        }
    }
    return attributes;
}
;
 //# sourceMappingURL=fetch.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/breadcrumbs.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addBreadcrumb",
    ()=>addBreadcrumb
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/time.js [instrumentation-edge] (ecmascript)");
;
;
;
/**
 * Default maximum number of breadcrumbs added to an event. Can be overwritten
 * with {@link Options.maxBreadcrumbs}.
 */ const DEFAULT_BREADCRUMBS = 100;
/**
 * Records a new breadcrumb which will be attached to future events.
 *
 * Breadcrumbs will be added to subsequent events to provide more context on
 * user's actions prior to an error or crash.
 */ function addBreadcrumb(breadcrumb, hint) {
    const client = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])();
    const isolationScope = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])();
    if (!client) return;
    const { beforeBreadcrumb = null, maxBreadcrumbs = DEFAULT_BREADCRUMBS } = client.getOptions();
    if (maxBreadcrumbs <= 0) return;
    const timestamp = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$time$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["dateTimestampInSeconds"])();
    const mergedBreadcrumb = {
        timestamp,
        ...breadcrumb
    };
    const finalBreadcrumb = beforeBreadcrumb ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["consoleSandbox"])(()=>beforeBreadcrumb(mergedBreadcrumb, hint)) : mergedBreadcrumb;
    if (finalBreadcrumb === null) return;
    if (client.emit) {
        client.emit('beforeAddBreadcrumb', finalBreadcrumb, hint);
    }
    isolationScope.addBreadcrumb(finalBreadcrumb, maxBreadcrumbs);
}
;
 //# sourceMappingURL=breadcrumbs.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/breadcrumb-log-level.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getBreadcrumbLogLevelFromHttpStatusCode",
    ()=>getBreadcrumbLogLevelFromHttpStatusCode
]);
/**
 * Determine a breadcrumb's log level (only `warning` or `error`) based on an HTTP status code.
 */ function getBreadcrumbLogLevelFromHttpStatusCode(statusCode) {
    // NOTE: undefined defaults to 'info' in Sentry
    if (statusCode === undefined) {
        return undefined;
    } else if (statusCode >= 400 && statusCode < 500) {
        return 'warning';
    } else if (statusCode >= 500) {
        return 'error';
    } else {
        return undefined;
    }
}
;
 //# sourceMappingURL=breadcrumb-log-level.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/node-stack-trace.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "filenameIsInApp",
    ()=>filenameIsInApp,
    "node",
    ()=>node,
    "nodeStackLineParser",
    ()=>nodeStackLineParser
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/stacktrace.js [instrumentation-edge] (ecmascript)");
;
/**
 * Does this filename look like it's part of the app code?
 */ function filenameIsInApp(filename, isNative = false) {
    const isInternal = isNative || filename && // It's not internal if it's an absolute linux path
    !filename.startsWith('/') && // It's not internal if it's an absolute windows path
    !filename.match(/^[A-Z]:/) && // It's not internal if the path is starting with a dot
    !filename.startsWith('.') && // It's not internal if the frame has a protocol. In node, this is usually the case if the file got pre-processed with a bundler like webpack
    !filename.match(/^[a-zA-Z]([a-zA-Z0-9.\-+])*:\/\//); // Schema from: https://stackoverflow.com/a/3641782
    // in_app is all that's not an internal Node function or a module within node_modules
    // note that isNative appears to return true even for node core libraries
    // see https://github.com/getsentry/raven-node/issues/176
    return !isInternal && filename !== undefined && !filename.includes('node_modules/');
}
/** Node Stack line parser */ function node(getModule) {
    const FILENAME_MATCH = /^\s*[-]{4,}$/;
    const FULL_MATCH = /at (?:async )?(?:(.+?)\s+\()?(?:(.+):(\d+):(\d+)?|([^)]+))\)?/;
    const DATA_URI_MATCH = /at (?:async )?(.+?) \(data:(.*?),/;
    return (line)=>{
        const dataUriMatch = line.match(DATA_URI_MATCH);
        if (dataUriMatch) {
            return {
                filename: `<data:${dataUriMatch[2]}>`,
                function: dataUriMatch[1]
            };
        }
        const lineMatch = line.match(FULL_MATCH);
        if (lineMatch) {
            let object;
            let method;
            let functionName;
            let typeName;
            let methodName;
            if (lineMatch[1]) {
                functionName = lineMatch[1];
                let methodStart = functionName.lastIndexOf('.');
                if (functionName[methodStart - 1] === '.') {
                    methodStart--;
                }
                if (methodStart > 0) {
                    object = functionName.slice(0, methodStart);
                    method = functionName.slice(methodStart + 1);
                    const objectEnd = object.indexOf('.Module');
                    if (objectEnd > 0) {
                        functionName = functionName.slice(objectEnd + 1);
                        object = object.slice(0, objectEnd);
                    }
                }
                typeName = undefined;
            }
            if (method) {
                typeName = object;
                methodName = method;
            }
            if (method === '<anonymous>') {
                methodName = undefined;
                functionName = undefined;
            }
            if (functionName === undefined) {
                methodName = methodName || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["UNKNOWN_FUNCTION"];
                functionName = typeName ? `${typeName}.${methodName}` : methodName;
            }
            let filename = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["normalizeStackTracePath"])(lineMatch[2]);
            const isNative = lineMatch[5] === 'native';
            if (!filename && lineMatch[5] && !isNative) {
                filename = lineMatch[5];
            }
            const maybeDecodedFilename = filename ? _safeDecodeURI(filename) : undefined;
            return {
                filename: maybeDecodedFilename ?? filename,
                module: maybeDecodedFilename && getModule?.(maybeDecodedFilename),
                function: functionName,
                lineno: _parseIntOrUndefined(lineMatch[3]),
                colno: _parseIntOrUndefined(lineMatch[4]),
                in_app: filenameIsInApp(filename || '', isNative)
            };
        }
        if (line.match(FILENAME_MATCH)) {
            return {
                filename: line
            };
        }
        return undefined;
    };
}
/**
 * Node.js stack line parser
 *
 * This is in @sentry/core so it can be used from the Electron SDK in the browser for when `nodeIntegration == true`.
 * This allows it to be used without referencing or importing any node specific code which causes bundlers to complain
 */ function nodeStackLineParser(getModule) {
    return [
        90,
        node(getModule)
    ];
}
function _parseIntOrUndefined(input) {
    return parseInt(input || '', 10) || undefined;
}
function _safeDecodeURI(filename) {
    try {
        return decodeURI(filename);
    } catch  {
        return undefined;
    }
}
;
 //# sourceMappingURL=node-stack-trace.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/dedupe.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "_shouldDropEvent",
    ()=>_shouldDropEvent,
    "dedupeIntegration",
    ()=>dedupeIntegration
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integration.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/stacktrace.js [instrumentation-edge] (ecmascript)");
;
;
;
;
const INTEGRATION_NAME = 'Dedupe';
const _dedupeIntegration = ()=>{
    let previousEvent;
    return {
        name: INTEGRATION_NAME,
        processEvent (currentEvent) {
            // We want to ignore any non-error type events, e.g. transactions or replays
            // These should never be deduped, and also not be compared against as _previousEvent.
            if (currentEvent.type) {
                return currentEvent;
            }
            // Juuust in case something goes wrong
            try {
                if (_shouldDropEvent(currentEvent, previousEvent)) {
                    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn('Event dropped due to being a duplicate of previously captured event.');
                    return null;
                }
            } catch  {} // eslint-disable-line no-empty
            return previousEvent = currentEvent;
        }
    };
};
/**
 * Deduplication filter.
 */ const dedupeIntegration = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defineIntegration"])(_dedupeIntegration);
/** only exported for tests. */ function _shouldDropEvent(currentEvent, previousEvent) {
    if (!previousEvent) {
        return false;
    }
    if (_isSameMessageEvent(currentEvent, previousEvent)) {
        return true;
    }
    if (_isSameExceptionEvent(currentEvent, previousEvent)) {
        return true;
    }
    return false;
}
function _isSameMessageEvent(currentEvent, previousEvent) {
    const currentMessage = currentEvent.message;
    const previousMessage = previousEvent.message;
    // If neither event has a message property, they were both exceptions, so bail out
    if (!currentMessage && !previousMessage) {
        return false;
    }
    // If only one event has a stacktrace, but not the other one, they are not the same
    if (currentMessage && !previousMessage || !currentMessage && previousMessage) {
        return false;
    }
    if (currentMessage !== previousMessage) {
        return false;
    }
    if (!_isSameFingerprint(currentEvent, previousEvent)) {
        return false;
    }
    if (!_isSameStacktrace(currentEvent, previousEvent)) {
        return false;
    }
    return true;
}
function _isSameExceptionEvent(currentEvent, previousEvent) {
    const previousException = _getExceptionFromEvent(previousEvent);
    const currentException = _getExceptionFromEvent(currentEvent);
    if (!previousException || !currentException) {
        return false;
    }
    if (previousException.type !== currentException.type || previousException.value !== currentException.value) {
        return false;
    }
    if (!_isSameFingerprint(currentEvent, previousEvent)) {
        return false;
    }
    if (!_isSameStacktrace(currentEvent, previousEvent)) {
        return false;
    }
    return true;
}
function _isSameStacktrace(currentEvent, previousEvent) {
    let currentFrames = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getFramesFromEvent"])(currentEvent);
    let previousFrames = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$stacktrace$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getFramesFromEvent"])(previousEvent);
    // If neither event has a stacktrace, they are assumed to be the same
    if (!currentFrames && !previousFrames) {
        return true;
    }
    // If only one event has a stacktrace, but not the other one, they are not the same
    if (currentFrames && !previousFrames || !currentFrames && previousFrames) {
        return false;
    }
    currentFrames = currentFrames;
    previousFrames = previousFrames;
    // If number of frames differ, they are not the same
    if (previousFrames.length !== currentFrames.length) {
        return false;
    }
    // Otherwise, compare the two
    for(let i = 0; i < previousFrames.length; i++){
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const frameA = previousFrames[i];
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const frameB = currentFrames[i];
        if (frameA.filename !== frameB.filename || frameA.lineno !== frameB.lineno || frameA.colno !== frameB.colno || frameA.function !== frameB.function) {
            return false;
        }
    }
    return true;
}
function _isSameFingerprint(currentEvent, previousEvent) {
    let currentFingerprint = currentEvent.fingerprint;
    let previousFingerprint = previousEvent.fingerprint;
    // If neither event has a fingerprint, they are assumed to be the same
    if (!currentFingerprint && !previousFingerprint) {
        return true;
    }
    // If only one event has a fingerprint, but not the other one, they are not the same
    if (currentFingerprint && !previousFingerprint || !currentFingerprint && previousFingerprint) {
        return false;
    }
    currentFingerprint = currentFingerprint;
    previousFingerprint = previousFingerprint;
    // Otherwise, compare the two
    try {
        return !!(currentFingerprint.join('') === previousFingerprint.join(''));
    } catch  {
        return false;
    }
}
function _getExceptionFromEvent(event) {
    return event.exception?.values?.[0];
}
;
 //# sourceMappingURL=dedupe.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/eventFilters.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "eventFiltersIntegration",
    ()=>eventFiltersIntegration,
    "inboundFiltersIntegration",
    ()=>inboundFiltersIntegration
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/debug-build.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integration.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$eventUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/eventUtils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/misc.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/string.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
// "Script error." is hard coded into browsers for errors that it can't read.
// this is the result of a script being pulled in from an external domain and CORS.
const DEFAULT_IGNORE_ERRORS = [
    /^Script error\.?$/,
    /^Javascript error: Script error\.? on line 0$/,
    /^ResizeObserver loop completed with undelivered notifications.$/,
    /^Cannot redefine property: googletag$/,
    /^Can't find variable: gmo$/,
    /^undefined is not an object \(evaluating 'a\.[A-Z]'\)$/,
    'can\'t redefine non-configurable property "solana"',
    "vv().getRestrictions is not a function. (In 'vv().getRestrictions(1,a)', 'vv().getRestrictions' is undefined)",
    "Can't find variable: _AutofillCallbackHandler",
    /^Non-Error promise rejection captured with value: Object Not Found Matching Id:\d+, MethodName:simulateEvent, ParamCount:\d+$/,
    /^Java exception was raised during method invocation$/
];
/** Options for the EventFilters integration */ const INTEGRATION_NAME = 'EventFilters';
/**
 * An integration that filters out events (errors and transactions) based on:
 *
 * - (Errors) A curated list of known low-value or irrelevant errors (see {@link DEFAULT_IGNORE_ERRORS})
 * - (Errors) A list of error messages or urls/filenames passed in via
 *   - Top level Sentry.init options (`ignoreErrors`, `denyUrls`, `allowUrls`)
 *   - The same options passed to the integration directly via @param options
 * - (Transactions/Spans) A list of root span (transaction) names passed in via
 *   - Top level Sentry.init option (`ignoreTransactions`)
 *   - The same option passed to the integration directly via @param options
 *
 * Events filtered by this integration will not be sent to Sentry.
 */ const eventFiltersIntegration = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defineIntegration"])((options = {})=>{
    let mergedOptions;
    return {
        name: INTEGRATION_NAME,
        setup (client) {
            const clientOptions = client.getOptions();
            mergedOptions = _mergeOptions(options, clientOptions);
        },
        processEvent (event, _hint, client) {
            if (!mergedOptions) {
                const clientOptions = client.getOptions();
                mergedOptions = _mergeOptions(options, clientOptions);
            }
            return _shouldDropEvent(event, mergedOptions) ? null : event;
        }
    };
});
/**
 * An integration that filters out events (errors and transactions) based on:
 *
 * - (Errors) A curated list of known low-value or irrelevant errors (see {@link DEFAULT_IGNORE_ERRORS})
 * - (Errors) A list of error messages or urls/filenames passed in via
 *   - Top level Sentry.init options (`ignoreErrors`, `denyUrls`, `allowUrls`)
 *   - The same options passed to the integration directly via @param options
 * - (Transactions/Spans) A list of root span (transaction) names passed in via
 *   - Top level Sentry.init option (`ignoreTransactions`)
 *   - The same option passed to the integration directly via @param options
 *
 * Events filtered by this integration will not be sent to Sentry.
 *
 * @deprecated this integration was renamed and will be removed in a future major version.
 * Use `eventFiltersIntegration` instead.
 */ const inboundFiltersIntegration = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defineIntegration"])((options = {})=>{
    return {
        ...eventFiltersIntegration(options),
        name: 'InboundFilters'
    };
});
function _mergeOptions(internalOptions = {}, clientOptions = {}) {
    return {
        allowUrls: [
            ...internalOptions.allowUrls || [],
            ...clientOptions.allowUrls || []
        ],
        denyUrls: [
            ...internalOptions.denyUrls || [],
            ...clientOptions.denyUrls || []
        ],
        ignoreErrors: [
            ...internalOptions.ignoreErrors || [],
            ...clientOptions.ignoreErrors || [],
            ...internalOptions.disableErrorDefaults ? [] : DEFAULT_IGNORE_ERRORS
        ],
        ignoreTransactions: [
            ...internalOptions.ignoreTransactions || [],
            ...clientOptions.ignoreTransactions || []
        ]
    };
}
function _shouldDropEvent(event, options) {
    if (!event.type) {
        // Filter errors
        if (_isIgnoredError(event, options.ignoreErrors)) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(`Event dropped due to being matched by \`ignoreErrors\` option.\nEvent: ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getEventDescription"])(event)}`);
            return true;
        }
        if (_isUselessError(event)) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(`Event dropped due to not having an error message, error type or stacktrace.\nEvent: ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getEventDescription"])(event)}`);
            return true;
        }
        if (_isDeniedUrl(event, options.denyUrls)) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(`Event dropped due to being matched by \`denyUrls\` option.\nEvent: ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getEventDescription"])(event)}.\nUrl: ${_getEventFilterUrl(event)}`);
            return true;
        }
        if (!_isAllowedUrl(event, options.allowUrls)) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(`Event dropped due to not being matched by \`allowUrls\` option.\nEvent: ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getEventDescription"])(event)}.\nUrl: ${_getEventFilterUrl(event)}`);
            return true;
        }
    } else if (event.type === 'transaction') {
        // Filter transactions
        if (_isIgnoredTransaction(event, options.ignoreTransactions)) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].warn(`Event dropped due to being matched by \`ignoreTransactions\` option.\nEvent: ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getEventDescription"])(event)}`);
            return true;
        }
    }
    return false;
}
function _isIgnoredError(event, ignoreErrors) {
    if (!ignoreErrors?.length) {
        return false;
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$eventUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getPossibleEventMessages"])(event).some((message)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stringMatchesSomePattern"])(message, ignoreErrors));
}
function _isIgnoredTransaction(event, ignoreTransactions) {
    if (!ignoreTransactions?.length) {
        return false;
    }
    const name = event.transaction;
    return name ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stringMatchesSomePattern"])(name, ignoreTransactions) : false;
}
function _isDeniedUrl(event, denyUrls) {
    if (!denyUrls?.length) {
        return false;
    }
    const url = _getEventFilterUrl(event);
    return !url ? false : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stringMatchesSomePattern"])(url, denyUrls);
}
function _isAllowedUrl(event, allowUrls) {
    if (!allowUrls?.length) {
        return true;
    }
    const url = _getEventFilterUrl(event);
    return !url ? true : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stringMatchesSomePattern"])(url, allowUrls);
}
function _getLastValidUrl(frames = []) {
    for(let i = frames.length - 1; i >= 0; i--){
        const frame = frames[i];
        if (frame && frame.filename !== '<anonymous>' && frame.filename !== '[native code]') {
            return frame.filename || null;
        }
    }
    return null;
}
function _getEventFilterUrl(event) {
    try {
        // If there are linked exceptions or exception aggregates we only want to match against the top frame of the "root" (the main exception)
        // The root always comes last in linked exceptions
        const rootException = [
            ...event.exception?.values ?? []
        ].reverse().find((value)=>value.mechanism?.parent_id === undefined && value.stacktrace?.frames?.length);
        const frames = rootException?.stacktrace?.frames;
        return frames ? _getLastValidUrl(frames) : null;
    } catch  {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$debug$2d$build$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["DEBUG_BUILD"] && __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["debug"].error(`Cannot extract url for event ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$misc$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getEventDescription"])(event)}`);
        return null;
    }
}
function _isUselessError(event) {
    // We only want to consider events for dropping that actually have recorded exception values.
    if (!event.exception?.values?.length) {
        return false;
    }
    return(// No top-level message
    !event.message && // There are no exception values that have a stacktrace, a non-generic-Error type or value
    !event.exception.values.some((value)=>value.stacktrace || value.type && value.type !== 'Error' || value.value));
}
;
 //# sourceMappingURL=eventFilters.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/functiontostring.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "functionToStringIntegration",
    ()=>functionToStringIntegration
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integration.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/object.js [instrumentation-edge] (ecmascript)");
;
;
;
let originalFunctionToString;
const INTEGRATION_NAME = 'FunctionToString';
const SETUP_CLIENTS = new WeakMap();
const _functionToStringIntegration = ()=>{
    return {
        name: INTEGRATION_NAME,
        setupOnce () {
            // eslint-disable-next-line @typescript-eslint/unbound-method
            originalFunctionToString = Function.prototype.toString;
            // intrinsics (like Function.prototype) might be immutable in some environments
            // e.g. Node with --frozen-intrinsics, XS (an embedded JavaScript engine) or SES (a JavaScript proposal)
            try {
                Function.prototype.toString = function(...args) {
                    const originalFunction = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$object$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getOriginalFunction"])(this);
                    const context = SETUP_CLIENTS.has((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])()) && originalFunction !== undefined ? originalFunction : this;
                    return originalFunctionToString.apply(context, args);
                };
            } catch  {
            // ignore errors here, just don't patch this
            }
        },
        setup (client) {
            SETUP_CLIENTS.set(client, true);
        }
    };
};
/**
 * Patch toString calls to return proper name for wrapped functions.
 *
 * ```js
 * Sentry.init({
 *   integrations: [
 *     functionToStringIntegration(),
 *   ],
 * });
 * ```
 */ const functionToStringIntegration = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defineIntegration"])(_functionToStringIntegration);
;
 //# sourceMappingURL=functiontostring.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/conversationId.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "conversationIdIntegration",
    ()=>conversationIdIntegration
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integration.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)");
;
;
;
const INTEGRATION_NAME = 'ConversationId';
const _conversationIdIntegration = ()=>{
    return {
        name: INTEGRATION_NAME,
        setup (client) {
            client.on('spanStart', (span)=>{
                const scopeData = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getCurrentScope"])().getScopeData();
                const isolationScopeData = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getIsolationScope"])().getScopeData();
                const conversationId = scopeData.conversationId || isolationScopeData.conversationId;
                if (conversationId) {
                    span.setAttribute(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_CONVERSATION_ID_ATTRIBUTE"], conversationId);
                }
            });
        }
    };
};
/**
 * Automatically applies conversation ID from scope to spans.
 *
 * This integration reads the conversation ID from the current or isolation scope
 * and applies it to spans when they start. This ensures the conversation ID is
 * available for all AI-related operations.
 */ const conversationIdIntegration = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defineIntegration"])(_conversationIdIntegration);
;
 //# sourceMappingURL=conversationId.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/aggregate-errors.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "applyAggregateErrorsToEvent",
    ()=>applyAggregateErrorsToEvent
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/is.js [instrumentation-edge] (ecmascript)");
;
/**
 * Creates exceptions inside `event.exception.values` for errors that are nested on properties based on the `key` parameter.
 */ function applyAggregateErrorsToEvent(exceptionFromErrorImplementation, parser, key, limit, event, hint) {
    if (!event.exception?.values || !hint || !(0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isInstanceOf"])(hint.originalException, Error)) {
        return;
    }
    // Generally speaking the last item in `event.exception.values` is the exception originating from the original Error
    const originalException = event.exception.values.length > 0 ? event.exception.values[event.exception.values.length - 1] : undefined;
    // We only create exception grouping if there is an exception in the event.
    if (originalException) {
        event.exception.values = aggregateExceptionsFromError(exceptionFromErrorImplementation, parser, limit, hint.originalException, key, event.exception.values, originalException, 0);
    }
}
function aggregateExceptionsFromError(exceptionFromErrorImplementation, parser, limit, error, key, prevExceptions, exception, exceptionId) {
    if (prevExceptions.length >= limit + 1) {
        return prevExceptions;
    }
    let newExceptions = [
        ...prevExceptions
    ];
    // Recursively call this function in order to walk down a chain of errors
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isInstanceOf"])(error[key], Error)) {
        applyExceptionGroupFieldsForParentException(exception, exceptionId, error);
        const newException = exceptionFromErrorImplementation(parser, error[key]);
        const newExceptionId = newExceptions.length;
        applyExceptionGroupFieldsForChildException(newException, key, newExceptionId, exceptionId);
        newExceptions = aggregateExceptionsFromError(exceptionFromErrorImplementation, parser, limit, error[key], key, [
            newException,
            ...newExceptions
        ], newException, newExceptionId);
    }
    // This will create exception grouping for AggregateErrors
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AggregateError
    if (isExceptionGroup(error)) {
        error.errors.forEach((childError, i)=>{
            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$is$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isInstanceOf"])(childError, Error)) {
                applyExceptionGroupFieldsForParentException(exception, exceptionId, error);
                const newException = exceptionFromErrorImplementation(parser, childError);
                const newExceptionId = newExceptions.length;
                applyExceptionGroupFieldsForChildException(newException, `errors[${i}]`, newExceptionId, exceptionId);
                newExceptions = aggregateExceptionsFromError(exceptionFromErrorImplementation, parser, limit, childError, key, [
                    newException,
                    ...newExceptions
                ], newException, newExceptionId);
            }
        });
    }
    return newExceptions;
}
function isExceptionGroup(error) {
    return Array.isArray(error.errors);
}
function applyExceptionGroupFieldsForParentException(exception, exceptionId, error) {
    exception.mechanism = {
        handled: true,
        type: 'auto.core.linked_errors',
        ...isExceptionGroup(error) && {
            is_exception_group: true
        },
        ...exception.mechanism,
        exception_id: exceptionId
    };
}
function applyExceptionGroupFieldsForChildException(exception, source, exceptionId, parentId) {
    exception.mechanism = {
        handled: true,
        ...exception.mechanism,
        type: 'chained',
        source,
        exception_id: exceptionId,
        parent_id: parentId
    };
}
;
 //# sourceMappingURL=aggregate-errors.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/linkederrors.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "linkedErrorsIntegration",
    ()=>linkedErrorsIntegration
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integration.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$aggregate$2d$errors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/aggregate-errors.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$eventbuilder$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/eventbuilder.js [instrumentation-edge] (ecmascript)");
;
;
;
const DEFAULT_KEY = 'cause';
const DEFAULT_LIMIT = 5;
const INTEGRATION_NAME = 'LinkedErrors';
const _linkedErrorsIntegration = (options = {})=>{
    const limit = options.limit || DEFAULT_LIMIT;
    const key = options.key || DEFAULT_KEY;
    return {
        name: INTEGRATION_NAME,
        preprocessEvent (event, hint, client) {
            const options = client.getOptions();
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$aggregate$2d$errors$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["applyAggregateErrorsToEvent"])(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$eventbuilder$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["exceptionFromError"], options.stackParser, key, limit, event, hint);
        }
    };
};
const linkedErrorsIntegration = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defineIntegration"])(_linkedErrorsIntegration);
;
 //# sourceMappingURL=linkederrors.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/severity.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "severityLevelFromString",
    ()=>severityLevelFromString
]);
/**
 * Converts a string-based level into a `SeverityLevel`, normalizing it along the way.
 *
 * @param level String representation of desired `SeverityLevel`.
 * @returns The `SeverityLevel` corresponding to the given string, or 'log' if the string isn't a valid level.
 */ function severityLevelFromString(level) {
    return level === 'warn' ? 'warning' : [
        'fatal',
        'error',
        'warning',
        'log',
        'info',
        'debug'
    ].includes(level) ? level : 'log';
}
;
 //# sourceMappingURL=severity.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/console.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addConsoleBreadcrumb",
    ()=>addConsoleBreadcrumb,
    "consoleIntegration",
    ()=>consoleIntegration
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$breadcrumbs$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/breadcrumbs.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/currentScopes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$console$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/instrument/console.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integration.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/debug-logger.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$severity$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/severity.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/string.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
;
;
const INTEGRATION_NAME = 'Console';
/**
 * Captures calls to the `console` API as breadcrumbs in Sentry.
 *
 * By default the integration instruments `console.debug`, `console.info`, `console.warn`, `console.error`,
 * `console.log`, `console.trace`, and `console.assert`. You can use the `levels` option to customize which
 * levels are captured.
 *
 * @example
 *
 * ```js
 * Sentry.init({
 *   integrations: [Sentry.consoleIntegration({ levels: ['error', 'warn'] })],
 * });
 * ```
 */ const consoleIntegration = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defineIntegration"])((options = {})=>{
    const levels = new Set(options.levels || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$debug$2d$logger$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["CONSOLE_LEVELS"]);
    return {
        name: INTEGRATION_NAME,
        setup (client) {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$instrument$2f$console$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addConsoleInstrumentationHandler"])(({ args, level })=>{
                if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$currentScopes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClient"])() !== client || !levels.has(level)) {
                    return;
                }
                addConsoleBreadcrumb(level, args);
            });
        }
    };
});
/**
 * Capture a console breadcrumb.
 *
 * Exported just for tests.
 */ function addConsoleBreadcrumb(level, args) {
    const breadcrumb = {
        category: 'console',
        data: {
            arguments: args,
            logger: 'console'
        },
        level: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$severity$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["severityLevelFromString"])(level),
        message: formatConsoleArgs(args)
    };
    if (level === 'assert') {
        if (args[0] === false) {
            const assertionArgs = args.slice(1);
            breadcrumb.message = assertionArgs.length > 0 ? `Assertion failed: ${formatConsoleArgs(assertionArgs)}` : 'Assertion failed';
            breadcrumb.data.arguments = assertionArgs;
        } else {
            // Don't capture a breadcrumb for passed assertions
            return;
        }
    }
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$breadcrumbs$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["addBreadcrumb"])(breadcrumb, {
        input: args,
        level
    });
}
function formatConsoleArgs(values) {
    return 'util' in __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"] && typeof __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].util.format === 'function' ? __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].util.format(...values) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$string$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["safeJoin"])(values, ' ');
}
;
 //# sourceMappingURL=console.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/cookie.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "parseCookie",
    ()=>parseCookie
]);
/**
 * This code was originally copied from the 'cookie` module at v0.5.0 and was simplified for our use case.
 * https://github.com/jshttp/cookie/blob/a0c84147aab6266bdb3996cf4062e93907c0b0fc/index.js
 * It had the following license:
 *
 * (The MIT License)
 *
 * Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com>
 * Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * 'Software'), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */ /**
 * Parses a cookie string
 */ function parseCookie(str) {
    const obj = {};
    let index = 0;
    while(index < str.length){
        const eqIdx = str.indexOf('=', index);
        // no more cookie pairs
        if (eqIdx === -1) {
            break;
        }
        let endIdx = str.indexOf(';', index);
        if (endIdx === -1) {
            endIdx = str.length;
        } else if (endIdx < eqIdx) {
            // backtrack on prior semicolon
            index = str.lastIndexOf(';', eqIdx - 1) + 1;
            continue;
        }
        const key = str.slice(index, eqIdx).trim();
        // only assign once
        if (undefined === obj[key]) {
            let val = str.slice(eqIdx + 1, endIdx).trim();
            // quoted values
            if (val.charCodeAt(0) === 0x22) {
                val = val.slice(1, -1);
            }
            try {
                obj[key] = val.indexOf('%') !== -1 ? decodeURIComponent(val) : val;
            } catch  {
                obj[key] = val;
            }
        }
        index = endIdx + 1;
    }
    return obj;
}
;
 //# sourceMappingURL=cookie.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/vendor/getIpAddress.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getClientIPAddress",
    ()=>getClientIPAddress,
    "ipHeaderNames",
    ()=>ipHeaderNames
]);
// Vendored / modified from @sergiodxa/remix-utils
// https://github.com/sergiodxa/remix-utils/blob/02af80e12829a53696bfa8f3c2363975cf59f55e/src/server/get-client-ip-address.ts
// MIT License
// Copyright (c) 2021 Sergio Xalambrí
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// The headers to check, in priority order
const ipHeaderNames = [
    'X-Client-IP',
    'X-Forwarded-For',
    'Fly-Client-IP',
    'CF-Connecting-IP',
    'Fastly-Client-Ip',
    'True-Client-Ip',
    'X-Real-IP',
    'X-Cluster-Client-IP',
    'X-Forwarded',
    'Forwarded-For',
    'Forwarded',
    'X-Vercel-Forwarded-For'
];
/**
 * Get the IP address of the client sending a request.
 *
 * It receives a Request headers object and use it to get the
 * IP address from one of the following headers in order.
 *
 * If the IP address is valid, it will be returned. Otherwise, null will be
 * returned.
 *
 * If the header values contains more than one IP address, the first valid one
 * will be returned.
 */ function getClientIPAddress(headers) {
    // Build a map of lowercase header names to their values for case-insensitive lookup
    // This is needed because headers from different sources may have different casings
    const lowerCaseHeaders = {};
    for (const key of Object.keys(headers)){
        lowerCaseHeaders[key.toLowerCase()] = headers[key];
    }
    // This will end up being Array<string | string[] | undefined | null> because of the various possible values a header
    // can take
    const headerValues = ipHeaderNames.map((headerName)=>{
        const rawValue = lowerCaseHeaders[headerName.toLowerCase()];
        const value = Array.isArray(rawValue) ? rawValue.join(';') : rawValue;
        if (headerName === 'Forwarded') {
            return parseForwardedHeader(value);
        }
        return value?.split(',').map((v)=>v.trim());
    });
    // Flatten the array and filter out any falsy entries
    const flattenedHeaderValues = headerValues.reduce((acc, val)=>{
        if (!val) {
            return acc;
        }
        return acc.concat(val);
    }, []);
    // Find the first value which is a valid IP address, if any
    const ipAddress = flattenedHeaderValues.find((ip)=>ip !== null && isIP(ip));
    return ipAddress || null;
}
function parseForwardedHeader(value) {
    if (!value) {
        return null;
    }
    for (const part of value.split(';')){
        if (part.startsWith('for=')) {
            return part.slice(4);
        }
    }
    return null;
}
//
/**
 * Custom method instead of importing this from `net` package, as this only exists in node
 * Accepts:
 * 127.0.0.1
 * 192.168.1.1
 * 192.168.1.255
 * 255.255.255.255
 * 10.1.1.1
 * 0.0.0.0
 * 2b01:cb19:8350:ed00:d0dd:fa5b:de31:8be5
 *
 * Rejects:
 * 1.1.1.01
 * 30.168.1.255.1
 * 127.1
 * 192.168.1.256
 * -1.2.3.4
 * 1.1.1.1.
 * 3...3
 * 192.168.1.099
 */ function isIP(str) {
    const regex = /(?:^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$)|(?:^(?:(?:[a-fA-F\d]{1,4}:){7}(?:[a-fA-F\d]{1,4}|:)|(?:[a-fA-F\d]{1,4}:){6}(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|:[a-fA-F\d]{1,4}|:)|(?:[a-fA-F\d]{1,4}:){5}(?::(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?::[a-fA-F\d]{1,4}){1,2}|:)|(?:[a-fA-F\d]{1,4}:){4}(?:(?::[a-fA-F\d]{1,4}){0,1}:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?::[a-fA-F\d]{1,4}){1,3}|:)|(?:[a-fA-F\d]{1,4}:){3}(?:(?::[a-fA-F\d]{1,4}){0,2}:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?::[a-fA-F\d]{1,4}){1,4}|:)|(?:[a-fA-F\d]{1,4}:){2}(?:(?::[a-fA-F\d]{1,4}){0,3}:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?::[a-fA-F\d]{1,4}){1,5}|:)|(?:[a-fA-F\d]{1,4}:){1}(?:(?::[a-fA-F\d]{1,4}){0,4}:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?::[a-fA-F\d]{1,4}){1,6}|:)|(?::(?:(?::[a-fA-F\d]{1,4}){0,5}:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?::[a-fA-F\d]{1,4}){1,7}|:)))(?:%[0-9a-zA-Z]{1,})?$)/;
    return regex.test(str);
}
;
 //# sourceMappingURL=getIpAddress.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/requestdata.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "requestDataIntegration",
    ()=>requestDataIntegration
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integration.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$cookie$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/cookie.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$vendor$2f$getIpAddress$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/vendor/getIpAddress.js [instrumentation-edge] (ecmascript)");
;
;
;
// TODO(v11): Change defaults based on `sendDefaultPii`
const DEFAULT_INCLUDE = {
    cookies: true,
    data: true,
    headers: true,
    query_string: true,
    url: true
};
const INTEGRATION_NAME = 'RequestData';
const _requestDataIntegration = (options = {})=>{
    const include = {
        ...DEFAULT_INCLUDE,
        ...options.include
    };
    return {
        name: INTEGRATION_NAME,
        processEvent (event, _hint, client) {
            const { sdkProcessingMetadata = {} } = event;
            const { normalizedRequest, ipAddress } = sdkProcessingMetadata;
            const includeWithDefaultPiiApplied = {
                ...include,
                ip: include.ip ?? client.getOptions().sendDefaultPii
            };
            if (normalizedRequest) {
                addNormalizedRequestDataToEvent(event, normalizedRequest, {
                    ipAddress
                }, includeWithDefaultPiiApplied);
            }
            return event;
        }
    };
};
/**
 * Add data about a request to an event. Primarily for use in Node-based SDKs, but included in `@sentry/core`
 * so it can be used in cross-platform SDKs like `@sentry/nextjs`.
 */ const requestDataIntegration = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defineIntegration"])(_requestDataIntegration);
/**
 * Add already normalized request data to an event.
 * This mutates the passed in event.
 */ function addNormalizedRequestDataToEvent(event, req, // Data that should not go into `event.request` but is somehow related to requests
additionalData, include) {
    event.request = {
        ...event.request,
        ...extractNormalizedRequestData(req, include)
    };
    if (include.ip) {
        const ip = req.headers && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$vendor$2f$getIpAddress$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getClientIPAddress"])(req.headers) || additionalData.ipAddress;
        if (ip) {
            event.user = {
                ...event.user,
                ip_address: ip
            };
        }
    }
}
function extractNormalizedRequestData(normalizedRequest, include) {
    const requestData = {};
    const headers = {
        ...normalizedRequest.headers
    };
    if (include.headers) {
        requestData.headers = headers;
        // Remove the Cookie header in case cookie data should not be included in the event
        if (!include.cookies) {
            delete headers.cookie;
        }
        // Remove IP headers in case IP data should not be included in the event
        if (!include.ip) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$vendor$2f$getIpAddress$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["ipHeaderNames"].forEach((ipHeaderName)=>{
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete headers[ipHeaderName];
            });
        }
    }
    requestData.method = normalizedRequest.method;
    if (include.url) {
        requestData.url = normalizedRequest.url;
    }
    if (include.cookies) {
        const cookies = normalizedRequest.cookies || (headers?.cookie ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$cookie$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["parseCookie"])(headers.cookie) : undefined);
        requestData.cookies = cookies || {};
    }
    if (include.query_string) {
        requestData.query_string = normalizedRequest.query_string;
    }
    if (include.data) {
        requestData.data = normalizedRequest.data;
    }
    return requestData;
}
;
 //# sourceMappingURL=requestdata.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/ai/gen-ai-attributes.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ANTHROPIC_AI_RESPONSE_TIMESTAMP_ATTRIBUTE",
    ()=>ANTHROPIC_AI_RESPONSE_TIMESTAMP_ATTRIBUTE,
    "GEN_AI_AGENT_NAME_ATTRIBUTE",
    ()=>GEN_AI_AGENT_NAME_ATTRIBUTE,
    "GEN_AI_CONVERSATION_ID_ATTRIBUTE",
    ()=>GEN_AI_CONVERSATION_ID_ATTRIBUTE,
    "GEN_AI_EMBEDDINGS_INPUT_ATTRIBUTE",
    ()=>GEN_AI_EMBEDDINGS_INPUT_ATTRIBUTE,
    "GEN_AI_EMBED_DO_EMBED_OPERATION_ATTRIBUTE",
    ()=>GEN_AI_EMBED_DO_EMBED_OPERATION_ATTRIBUTE,
    "GEN_AI_EMBED_MANY_DO_EMBED_OPERATION_ATTRIBUTE",
    ()=>GEN_AI_EMBED_MANY_DO_EMBED_OPERATION_ATTRIBUTE,
    "GEN_AI_EXECUTE_TOOL_OPERATION_ATTRIBUTE",
    ()=>GEN_AI_EXECUTE_TOOL_OPERATION_ATTRIBUTE,
    "GEN_AI_GENERATE_OBJECT_DO_GENERATE_OPERATION_ATTRIBUTE",
    ()=>GEN_AI_GENERATE_OBJECT_DO_GENERATE_OPERATION_ATTRIBUTE,
    "GEN_AI_GENERATE_TEXT_DO_GENERATE_OPERATION_ATTRIBUTE",
    ()=>GEN_AI_GENERATE_TEXT_DO_GENERATE_OPERATION_ATTRIBUTE,
    "GEN_AI_INPUT_MESSAGES_ATTRIBUTE",
    ()=>GEN_AI_INPUT_MESSAGES_ATTRIBUTE,
    "GEN_AI_INPUT_MESSAGES_ORIGINAL_LENGTH_ATTRIBUTE",
    ()=>GEN_AI_INPUT_MESSAGES_ORIGINAL_LENGTH_ATTRIBUTE,
    "GEN_AI_INVOKE_AGENT_OPERATION_ATTRIBUTE",
    ()=>GEN_AI_INVOKE_AGENT_OPERATION_ATTRIBUTE,
    "GEN_AI_OPERATION_NAME_ATTRIBUTE",
    ()=>GEN_AI_OPERATION_NAME_ATTRIBUTE,
    "GEN_AI_PIPELINE_NAME_ATTRIBUTE",
    ()=>GEN_AI_PIPELINE_NAME_ATTRIBUTE,
    "GEN_AI_PROMPT_ATTRIBUTE",
    ()=>GEN_AI_PROMPT_ATTRIBUTE,
    "GEN_AI_REQUEST_AVAILABLE_TOOLS_ATTRIBUTE",
    ()=>GEN_AI_REQUEST_AVAILABLE_TOOLS_ATTRIBUTE,
    "GEN_AI_REQUEST_DIMENSIONS_ATTRIBUTE",
    ()=>GEN_AI_REQUEST_DIMENSIONS_ATTRIBUTE,
    "GEN_AI_REQUEST_ENCODING_FORMAT_ATTRIBUTE",
    ()=>GEN_AI_REQUEST_ENCODING_FORMAT_ATTRIBUTE,
    "GEN_AI_REQUEST_FREQUENCY_PENALTY_ATTRIBUTE",
    ()=>GEN_AI_REQUEST_FREQUENCY_PENALTY_ATTRIBUTE,
    "GEN_AI_REQUEST_MAX_TOKENS_ATTRIBUTE",
    ()=>GEN_AI_REQUEST_MAX_TOKENS_ATTRIBUTE,
    "GEN_AI_REQUEST_MODEL_ATTRIBUTE",
    ()=>GEN_AI_REQUEST_MODEL_ATTRIBUTE,
    "GEN_AI_REQUEST_PRESENCE_PENALTY_ATTRIBUTE",
    ()=>GEN_AI_REQUEST_PRESENCE_PENALTY_ATTRIBUTE,
    "GEN_AI_REQUEST_STREAM_ATTRIBUTE",
    ()=>GEN_AI_REQUEST_STREAM_ATTRIBUTE,
    "GEN_AI_REQUEST_TEMPERATURE_ATTRIBUTE",
    ()=>GEN_AI_REQUEST_TEMPERATURE_ATTRIBUTE,
    "GEN_AI_REQUEST_TOP_K_ATTRIBUTE",
    ()=>GEN_AI_REQUEST_TOP_K_ATTRIBUTE,
    "GEN_AI_REQUEST_TOP_P_ATTRIBUTE",
    ()=>GEN_AI_REQUEST_TOP_P_ATTRIBUTE,
    "GEN_AI_RERANK_DO_RERANK_OPERATION_ATTRIBUTE",
    ()=>GEN_AI_RERANK_DO_RERANK_OPERATION_ATTRIBUTE,
    "GEN_AI_RESPONSE_FINISH_REASONS_ATTRIBUTE",
    ()=>GEN_AI_RESPONSE_FINISH_REASONS_ATTRIBUTE,
    "GEN_AI_RESPONSE_ID_ATTRIBUTE",
    ()=>GEN_AI_RESPONSE_ID_ATTRIBUTE,
    "GEN_AI_RESPONSE_MODEL_ATTRIBUTE",
    ()=>GEN_AI_RESPONSE_MODEL_ATTRIBUTE,
    "GEN_AI_RESPONSE_STOP_REASON_ATTRIBUTE",
    ()=>GEN_AI_RESPONSE_STOP_REASON_ATTRIBUTE,
    "GEN_AI_RESPONSE_STREAMING_ATTRIBUTE",
    ()=>GEN_AI_RESPONSE_STREAMING_ATTRIBUTE,
    "GEN_AI_RESPONSE_TEXT_ATTRIBUTE",
    ()=>GEN_AI_RESPONSE_TEXT_ATTRIBUTE,
    "GEN_AI_RESPONSE_TOOL_CALLS_ATTRIBUTE",
    ()=>GEN_AI_RESPONSE_TOOL_CALLS_ATTRIBUTE,
    "GEN_AI_STREAM_OBJECT_DO_STREAM_OPERATION_ATTRIBUTE",
    ()=>GEN_AI_STREAM_OBJECT_DO_STREAM_OPERATION_ATTRIBUTE,
    "GEN_AI_STREAM_TEXT_DO_STREAM_OPERATION_ATTRIBUTE",
    ()=>GEN_AI_STREAM_TEXT_DO_STREAM_OPERATION_ATTRIBUTE,
    "GEN_AI_SYSTEM_ATTRIBUTE",
    ()=>GEN_AI_SYSTEM_ATTRIBUTE,
    "GEN_AI_SYSTEM_INSTRUCTIONS_ATTRIBUTE",
    ()=>GEN_AI_SYSTEM_INSTRUCTIONS_ATTRIBUTE,
    "GEN_AI_TOOL_CALL_ID_ATTRIBUTE",
    ()=>GEN_AI_TOOL_CALL_ID_ATTRIBUTE,
    "GEN_AI_TOOL_INPUT_ATTRIBUTE",
    ()=>GEN_AI_TOOL_INPUT_ATTRIBUTE,
    "GEN_AI_TOOL_NAME_ATTRIBUTE",
    ()=>GEN_AI_TOOL_NAME_ATTRIBUTE,
    "GEN_AI_TOOL_OUTPUT_ATTRIBUTE",
    ()=>GEN_AI_TOOL_OUTPUT_ATTRIBUTE,
    "GEN_AI_TOOL_TYPE_ATTRIBUTE",
    ()=>GEN_AI_TOOL_TYPE_ATTRIBUTE,
    "GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS_ATTRIBUTE",
    ()=>GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS_ATTRIBUTE,
    "GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS_ATTRIBUTE",
    ()=>GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS_ATTRIBUTE,
    "GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE",
    ()=>GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE,
    "GEN_AI_USAGE_INPUT_TOKENS_CACHED_ATTRIBUTE",
    ()=>GEN_AI_USAGE_INPUT_TOKENS_CACHED_ATTRIBUTE,
    "GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE_ATTRIBUTE",
    ()=>GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE_ATTRIBUTE,
    "GEN_AI_USAGE_OUTPUT_TOKENS_ATTRIBUTE",
    ()=>GEN_AI_USAGE_OUTPUT_TOKENS_ATTRIBUTE,
    "GEN_AI_USAGE_TOTAL_TOKENS_ATTRIBUTE",
    ()=>GEN_AI_USAGE_TOTAL_TOKENS_ATTRIBUTE,
    "OPENAI_OPERATIONS",
    ()=>OPENAI_OPERATIONS,
    "OPENAI_RESPONSE_ID_ATTRIBUTE",
    ()=>OPENAI_RESPONSE_ID_ATTRIBUTE,
    "OPENAI_RESPONSE_MODEL_ATTRIBUTE",
    ()=>OPENAI_RESPONSE_MODEL_ATTRIBUTE,
    "OPENAI_RESPONSE_TIMESTAMP_ATTRIBUTE",
    ()=>OPENAI_RESPONSE_TIMESTAMP_ATTRIBUTE,
    "OPENAI_USAGE_COMPLETION_TOKENS_ATTRIBUTE",
    ()=>OPENAI_USAGE_COMPLETION_TOKENS_ATTRIBUTE,
    "OPENAI_USAGE_PROMPT_TOKENS_ATTRIBUTE",
    ()=>OPENAI_USAGE_PROMPT_TOKENS_ATTRIBUTE
]);
/**
 * OpenAI Integration Telemetry Attributes
 * Based on OpenTelemetry Semantic Conventions for Generative AI
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */ // =============================================================================
// OPENTELEMETRY SEMANTIC CONVENTIONS FOR GENAI
// =============================================================================
/**
 * The input messages sent to the model
 */ const GEN_AI_PROMPT_ATTRIBUTE = 'gen_ai.prompt';
/**
 * The Generative AI system being used
 * For OpenAI, this should always be "openai"
 */ const GEN_AI_SYSTEM_ATTRIBUTE = 'gen_ai.system';
/**
 * The name of the model as requested
 * Examples: "gpt-4", "gpt-3.5-turbo"
 */ const GEN_AI_REQUEST_MODEL_ATTRIBUTE = 'gen_ai.request.model';
/**
 * Whether streaming was enabled for the request
 */ const GEN_AI_REQUEST_STREAM_ATTRIBUTE = 'gen_ai.request.stream';
/**
 * The temperature setting for the model request
 */ const GEN_AI_REQUEST_TEMPERATURE_ATTRIBUTE = 'gen_ai.request.temperature';
/**
 * The maximum number of tokens requested
 */ const GEN_AI_REQUEST_MAX_TOKENS_ATTRIBUTE = 'gen_ai.request.max_tokens';
/**
 * The frequency penalty setting for the model request
 */ const GEN_AI_REQUEST_FREQUENCY_PENALTY_ATTRIBUTE = 'gen_ai.request.frequency_penalty';
/**
 * The presence penalty setting for the model request
 */ const GEN_AI_REQUEST_PRESENCE_PENALTY_ATTRIBUTE = 'gen_ai.request.presence_penalty';
/**
 * The top_p (nucleus sampling) setting for the model request
 */ const GEN_AI_REQUEST_TOP_P_ATTRIBUTE = 'gen_ai.request.top_p';
/**
 * The top_k setting for the model request
 */ const GEN_AI_REQUEST_TOP_K_ATTRIBUTE = 'gen_ai.request.top_k';
/**
 * The encoding format for the model request
 */ const GEN_AI_REQUEST_ENCODING_FORMAT_ATTRIBUTE = 'gen_ai.request.encoding_format';
/**
 * The dimensions for the model request
 */ const GEN_AI_REQUEST_DIMENSIONS_ATTRIBUTE = 'gen_ai.request.dimensions';
/**
 * Array of reasons why the model stopped generating tokens
 */ const GEN_AI_RESPONSE_FINISH_REASONS_ATTRIBUTE = 'gen_ai.response.finish_reasons';
/**
 * The name of the model that generated the response
 */ const GEN_AI_RESPONSE_MODEL_ATTRIBUTE = 'gen_ai.response.model';
/**
 * The unique identifier for the response
 */ const GEN_AI_RESPONSE_ID_ATTRIBUTE = 'gen_ai.response.id';
/**
 * The reason why the model stopped generating tokens
 */ const GEN_AI_RESPONSE_STOP_REASON_ATTRIBUTE = 'gen_ai.response.stop_reason';
/**
 * The number of tokens used in the prompt
 */ const GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE = 'gen_ai.usage.input_tokens';
/**
 * The number of tokens used in the response
 */ const GEN_AI_USAGE_OUTPUT_TOKENS_ATTRIBUTE = 'gen_ai.usage.output_tokens';
/**
 * The total number of tokens used (input + output)
 */ const GEN_AI_USAGE_TOTAL_TOKENS_ATTRIBUTE = 'gen_ai.usage.total_tokens';
/**
 * The operation name
 */ const GEN_AI_OPERATION_NAME_ATTRIBUTE = 'gen_ai.operation.name';
/**
 * Original length of messages array, used to indicate truncations had occured
 */ const GEN_AI_INPUT_MESSAGES_ORIGINAL_LENGTH_ATTRIBUTE = 'sentry.sdk_meta.gen_ai.input.messages.original_length';
/**
 * The prompt messages
 * Only recorded when recordInputs is enabled
 */ const GEN_AI_INPUT_MESSAGES_ATTRIBUTE = 'gen_ai.input.messages';
/**
 * The system instructions extracted from system messages
 * Only recorded when recordInputs is enabled
 * According to OpenTelemetry spec: https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/#gen-ai-system-instructions
 */ const GEN_AI_SYSTEM_INSTRUCTIONS_ATTRIBUTE = 'gen_ai.system_instructions';
/**
 * The response text
 * Only recorded when recordOutputs is enabled
 */ const GEN_AI_RESPONSE_TEXT_ATTRIBUTE = 'gen_ai.response.text';
/**
 * The available tools from incoming request
 * Only recorded when recordInputs is enabled
 */ const GEN_AI_REQUEST_AVAILABLE_TOOLS_ATTRIBUTE = 'gen_ai.request.available_tools';
/**
 * Whether the response is a streaming response
 */ const GEN_AI_RESPONSE_STREAMING_ATTRIBUTE = 'gen_ai.response.streaming';
/**
 * The tool calls from the response
 * Only recorded when recordOutputs is enabled
 */ const GEN_AI_RESPONSE_TOOL_CALLS_ATTRIBUTE = 'gen_ai.response.tool_calls';
/**
 * The agent name
 */ const GEN_AI_AGENT_NAME_ATTRIBUTE = 'gen_ai.agent.name';
/**
 * The pipeline name
 */ const GEN_AI_PIPELINE_NAME_ATTRIBUTE = 'gen_ai.pipeline.name';
/**
 * The conversation ID for linking messages across API calls
 * For OpenAI Assistants API: thread_id
 * For LangGraph: configurable.thread_id
 */ const GEN_AI_CONVERSATION_ID_ATTRIBUTE = 'gen_ai.conversation.id';
/**
 * The number of cache creation input tokens used
 */ const GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS_ATTRIBUTE = 'gen_ai.usage.cache_creation_input_tokens';
/**
 * The number of cache read input tokens used
 */ const GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS_ATTRIBUTE = 'gen_ai.usage.cache_read_input_tokens';
/**
 * The number of cache write input tokens used
 */ const GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE_ATTRIBUTE = 'gen_ai.usage.input_tokens.cache_write';
/**
 * The number of cached input tokens that were used
 */ const GEN_AI_USAGE_INPUT_TOKENS_CACHED_ATTRIBUTE = 'gen_ai.usage.input_tokens.cached';
/**
 * The span operation name for invoking an agent
 */ const GEN_AI_INVOKE_AGENT_OPERATION_ATTRIBUTE = 'gen_ai.invoke_agent';
/**
 * The span operation name for generating text
 */ const GEN_AI_GENERATE_TEXT_DO_GENERATE_OPERATION_ATTRIBUTE = 'gen_ai.generate_text';
/**
 * The span operation name for streaming text
 */ const GEN_AI_STREAM_TEXT_DO_STREAM_OPERATION_ATTRIBUTE = 'gen_ai.stream_text';
/**
 * The span operation name for generating object
 */ const GEN_AI_GENERATE_OBJECT_DO_GENERATE_OPERATION_ATTRIBUTE = 'gen_ai.generate_object';
/**
 * The span operation name for streaming object
 */ const GEN_AI_STREAM_OBJECT_DO_STREAM_OPERATION_ATTRIBUTE = 'gen_ai.stream_object';
/**
 * The embeddings input
 * Only recorded when recordInputs is enabled
 */ const GEN_AI_EMBEDDINGS_INPUT_ATTRIBUTE = 'gen_ai.embeddings.input';
/**
 * The span operation name for embedding
 */ const GEN_AI_EMBED_DO_EMBED_OPERATION_ATTRIBUTE = 'gen_ai.embed';
/**
 * The span operation name for embedding many
 */ const GEN_AI_EMBED_MANY_DO_EMBED_OPERATION_ATTRIBUTE = 'gen_ai.embed_many';
/**
 * The span operation name for reranking
 */ const GEN_AI_RERANK_DO_RERANK_OPERATION_ATTRIBUTE = 'gen_ai.rerank';
/**
 * The span operation name for executing a tool
 */ const GEN_AI_EXECUTE_TOOL_OPERATION_ATTRIBUTE = 'gen_ai.execute_tool';
/**
 * The tool name for tool call spans
 */ const GEN_AI_TOOL_NAME_ATTRIBUTE = 'gen_ai.tool.name';
/**
 * The tool call ID
 */ const GEN_AI_TOOL_CALL_ID_ATTRIBUTE = 'gen_ai.tool.call.id';
/**
 * The tool type (e.g., 'function')
 */ const GEN_AI_TOOL_TYPE_ATTRIBUTE = 'gen_ai.tool.type';
/**
 * The tool input/arguments
 */ const GEN_AI_TOOL_INPUT_ATTRIBUTE = 'gen_ai.tool.input';
/**
 * The tool output/result
 */ const GEN_AI_TOOL_OUTPUT_ATTRIBUTE = 'gen_ai.tool.output';
// =============================================================================
// OPENAI-SPECIFIC ATTRIBUTES
// =============================================================================
/**
 * The response ID from OpenAI
 */ const OPENAI_RESPONSE_ID_ATTRIBUTE = 'openai.response.id';
/**
 * The response model from OpenAI
 */ const OPENAI_RESPONSE_MODEL_ATTRIBUTE = 'openai.response.model';
/**
 * The response timestamp from OpenAI (ISO string)
 */ const OPENAI_RESPONSE_TIMESTAMP_ATTRIBUTE = 'openai.response.timestamp';
/**
 * The number of completion tokens used
 */ const OPENAI_USAGE_COMPLETION_TOKENS_ATTRIBUTE = 'openai.usage.completion_tokens';
/**
 * The number of prompt tokens used
 */ const OPENAI_USAGE_PROMPT_TOKENS_ATTRIBUTE = 'openai.usage.prompt_tokens';
// =============================================================================
// OPENAI OPERATIONS
// =============================================================================
/**
 * OpenAI API operations following OpenTelemetry semantic conventions
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/#llm-request-spans
 */ const OPENAI_OPERATIONS = {
    CHAT: 'chat',
    EMBEDDINGS: 'embeddings'
};
// =============================================================================
// ANTHROPIC AI OPERATIONS
// =============================================================================
/**
 * The response timestamp from Anthropic AI (ISO string)
 */ const ANTHROPIC_AI_RESPONSE_TIMESTAMP_ATTRIBUTE = 'anthropic.response.timestamp';
;
 //# sourceMappingURL=gen-ai-attributes.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/vercel-ai/constants.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "EMBEDDINGS_OPS",
    ()=>EMBEDDINGS_OPS,
    "GENERATE_CONTENT_OPS",
    ()=>GENERATE_CONTENT_OPS,
    "INVOKE_AGENT_OPS",
    ()=>INVOKE_AGENT_OPS,
    "RERANK_OPS",
    ()=>RERANK_OPS,
    "toolCallSpanMap",
    ()=>toolCallSpanMap
]);
// Global Map to track tool call IDs to their corresponding spans
// This allows us to capture tool errors and link them to the correct span
const toolCallSpanMap = new Map();
// Operation sets for efficient mapping to OpenTelemetry semantic convention values
const INVOKE_AGENT_OPS = new Set([
    'ai.generateText',
    'ai.streamText',
    'ai.generateObject',
    'ai.streamObject',
    'ai.embed',
    'ai.embedMany',
    'ai.rerank'
]);
const GENERATE_CONTENT_OPS = new Set([
    'ai.generateText.doGenerate',
    'ai.streamText.doStream',
    'ai.generateObject.doGenerate',
    'ai.streamObject.doStream'
]);
const EMBEDDINGS_OPS = new Set([
    'ai.embed.doEmbed',
    'ai.embedMany.doEmbed'
]);
const RERANK_OPS = new Set([
    'ai.rerank.doRerank'
]);
;
 //# sourceMappingURL=constants.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/ai/mediaStripping.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "isContentMedia",
    ()=>isContentMedia,
    "stripInlineMediaFromSingleMessage",
    ()=>stripInlineMediaFromSingleMessage
]);
/**
 * Inline media content source, with a potentially very large base64
 * blob or data: uri.
 */ /**
 * Check if a content part is an OpenAI/Anthropic media source
 */ function isContentMedia(part) {
    if (!part || typeof part !== 'object') return false;
    return isContentMediaSource(part) || hasInlineData(part) || hasImageUrl(part) || hasInputAudio(part) || hasFileData(part) || hasMediaTypeData(part) || hasBlobOrBase64Type(part) || hasB64Json(part) || hasImageGenerationResult(part) || hasDataUri(part);
}
function hasImageUrl(part) {
    if (!('image_url' in part)) return false;
    if (typeof part.image_url === 'string') return part.image_url.startsWith('data:');
    return hasNestedImageUrl(part);
}
function hasNestedImageUrl(part) {
    return 'image_url' in part && !!part.image_url && typeof part.image_url === 'object' && 'url' in part.image_url && typeof part.image_url.url === 'string' && part.image_url.url.startsWith('data:');
}
function isContentMediaSource(part) {
    return 'type' in part && typeof part.type === 'string' && 'source' in part && isContentMedia(part.source);
}
function hasInlineData(part) {
    return 'inlineData' in part && !!part.inlineData && typeof part.inlineData === 'object' && 'data' in part.inlineData && typeof part.inlineData.data === 'string';
}
function hasInputAudio(part) {
    return 'type' in part && part.type === 'input_audio' && 'input_audio' in part && !!part.input_audio && typeof part.input_audio === 'object' && 'data' in part.input_audio && typeof part.input_audio.data === 'string';
}
function hasFileData(part) {
    return 'type' in part && part.type === 'file' && 'file' in part && !!part.file && typeof part.file === 'object' && 'file_data' in part.file && typeof part.file.file_data === 'string';
}
function hasMediaTypeData(part) {
    return 'media_type' in part && typeof part.media_type === 'string' && 'data' in part;
}
function hasBlobOrBase64Type(part) {
    return 'type' in part && (part.type === 'blob' || part.type === 'base64');
}
function hasB64Json(part) {
    return 'b64_json' in part;
}
function hasImageGenerationResult(part) {
    return 'type' in part && 'result' in part && part.type === 'image_generation';
}
function hasDataUri(part) {
    return 'uri' in part && typeof part.uri === 'string' && part.uri.startsWith('data:');
}
const REMOVED_STRING = '[Blob substitute]';
const MEDIA_FIELDS = [
    'image_url',
    'data',
    'content',
    'b64_json',
    'result',
    'uri'
];
/**
 * Replace inline binary data in a single media content part with a placeholder.
 */ function stripInlineMediaFromSingleMessage(part) {
    const strip = {
        ...part
    };
    if (isContentMedia(strip.source)) {
        strip.source = stripInlineMediaFromSingleMessage(strip.source);
    }
    if (hasInlineData(part)) {
        strip.inlineData = {
            ...part.inlineData,
            data: REMOVED_STRING
        };
    }
    if (hasNestedImageUrl(part)) {
        strip.image_url = {
            ...part.image_url,
            url: REMOVED_STRING
        };
    }
    if (hasInputAudio(part)) {
        strip.input_audio = {
            ...part.input_audio,
            data: REMOVED_STRING
        };
    }
    if (hasFileData(part)) {
        strip.file = {
            ...part.file,
            file_data: REMOVED_STRING
        };
    }
    for (const field of MEDIA_FIELDS){
        if (typeof strip[field] === 'string') strip[field] = REMOVED_STRING;
    }
    return strip;
}
;
 //# sourceMappingURL=mediaStripping.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/ai/messageTruncation.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_GEN_AI_MESSAGES_BYTE_LIMIT",
    ()=>DEFAULT_GEN_AI_MESSAGES_BYTE_LIMIT,
    "truncateGenAiMessages",
    ()=>truncateGenAiMessages,
    "truncateGenAiStringInput",
    ()=>truncateGenAiStringInput
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$mediaStripping$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/ai/mediaStripping.js [instrumentation-edge] (ecmascript)");
;
/**
 * Default maximum size in bytes for GenAI messages.
 * Messages exceeding this limit will be truncated.
 */ const DEFAULT_GEN_AI_MESSAGES_BYTE_LIMIT = 20000;
/**
 * Message format used by OpenAI and Anthropic APIs.
 */ /**
 * Calculate the UTF-8 byte length of a string.
 */ const utf8Bytes = (text)=>{
    return new TextEncoder().encode(text).length;
};
/**
 * Calculate the UTF-8 byte length of a value's JSON representation.
 */ const jsonBytes = (value)=>{
    return utf8Bytes(JSON.stringify(value));
};
/**
 * Truncate a string to fit within maxBytes (inclusive) when encoded as UTF-8.
 * Uses binary search for efficiency with multi-byte characters.
 *
 * @param text - The string to truncate
 * @param maxBytes - Maximum byte length (inclusive, UTF-8 encoded)
 * @returns Truncated string whose UTF-8 byte length is at most maxBytes
 */ function truncateTextByBytes(text, maxBytes) {
    if (utf8Bytes(text) <= maxBytes) {
        return text;
    }
    let low = 0;
    let high = text.length;
    let bestFit = '';
    while(low <= high){
        const mid = Math.floor((low + high) / 2);
        const candidate = text.slice(0, mid);
        const byteSize = utf8Bytes(candidate);
        if (byteSize <= maxBytes) {
            bestFit = candidate;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return bestFit;
}
/**
 * Extract text content from a Google GenAI message part.
 * Parts are either plain strings or objects with a text property.
 *
 * @returns The text content
 */ function getPartText(part) {
    if (typeof part === 'string') {
        return part;
    }
    if ('text' in part) return part.text;
    return '';
}
/**
 * Create a new part with updated text content while preserving the original structure.
 *
 * @param part - Original part (string or object)
 * @param text - New text content
 * @returns New part with updated text
 */ function withPartText(part, text) {
    if (typeof part === 'string') {
        return text;
    }
    return {
        ...part,
        text
    };
}
/**
 * Check if a message has the OpenAI/Anthropic content format.
 */ function isContentMessage(message) {
    return message !== null && typeof message === 'object' && 'content' in message && typeof message.content === 'string';
}
/**
 * Check if a message has the OpenAI/Anthropic content array format.
 */ function isContentArrayMessage(message) {
    return message !== null && typeof message === 'object' && 'content' in message && Array.isArray(message.content);
}
/**
 * Check if a message has the Google GenAI parts format.
 */ function isPartsMessage(message) {
    return message !== null && typeof message === 'object' && 'parts' in message && Array.isArray(message.parts) && message.parts.length > 0;
}
/**
 * Truncate a message with `content: string` format (OpenAI/Anthropic).
 *
 * @param message - Message with content property
 * @param maxBytes - Maximum byte limit
 * @returns Array with truncated message, or empty array if it doesn't fit
 */ function truncateContentMessage(message, maxBytes) {
    // Calculate overhead (message structure without content)
    const emptyMessage = {
        ...message,
        content: ''
    };
    const overhead = jsonBytes(emptyMessage);
    const availableForContent = maxBytes - overhead;
    if (availableForContent <= 0) {
        return [];
    }
    const truncatedContent = truncateTextByBytes(message.content, availableForContent);
    return [
        {
            ...message,
            content: truncatedContent
        }
    ];
}
/**
 * Truncate a message with `parts: [...]` format (Google GenAI).
 * Keeps as many complete parts as possible, only truncating the first part if needed.
 *
 * @param message - Message with parts array
 * @param maxBytes - Maximum byte limit
 * @returns Array with truncated message, or empty array if it doesn't fit
 */ function truncatePartsMessage(message, maxBytes) {
    const { parts } = message;
    // Calculate overhead by creating empty text parts
    const emptyParts = parts.map((part)=>withPartText(part, ''));
    const overhead = jsonBytes({
        ...message,
        parts: emptyParts
    });
    let remainingBytes = maxBytes - overhead;
    if (remainingBytes <= 0) {
        return [];
    }
    // Include parts until we run out of space
    const includedParts = [];
    for (const part of parts){
        const text = getPartText(part);
        const textSize = utf8Bytes(text);
        if (textSize <= remainingBytes) {
            // Part fits: include it as-is
            includedParts.push(part);
            remainingBytes -= textSize;
        } else if (includedParts.length === 0) {
            // First part doesn't fit: truncate it
            const truncated = truncateTextByBytes(text, remainingBytes);
            if (truncated) {
                includedParts.push(withPartText(part, truncated));
            }
            break;
        } else {
            break;
        }
    }
    /* c8 ignore start
   * for type safety only, algorithm guarantees SOME text included */ if (includedParts.length <= 0) {
        return [];
    } else {
        /* c8 ignore stop */ return [
            {
                ...message,
                parts: includedParts
            }
        ];
    }
}
/**
 * Truncate a single message to fit within maxBytes.
 *
 * Supports two message formats:
 * - OpenAI/Anthropic: `{ ..., content: string }`
 * - Google GenAI: `{ ..., parts: Array<string | {text: string} | non-text> }`
 *
 * @param message - The message to truncate
 * @param maxBytes - Maximum byte limit for the message
 * @returns Array containing the truncated message, or empty array if truncation fails
 */ function truncateSingleMessage(message, maxBytes) {
    if (!message) return [];
    // Handle plain strings (e.g., embeddings input)
    if (typeof message === 'string') {
        const truncated = truncateTextByBytes(message, maxBytes);
        return truncated ? [
            truncated
        ] : [];
    }
    if (typeof message !== 'object') {
        return [];
    }
    if (isContentMessage(message)) {
        return truncateContentMessage(message, maxBytes);
    }
    if (isPartsMessage(message)) {
        return truncatePartsMessage(message, maxBytes);
    }
    // Unknown message format: cannot truncate safely
    return [];
}
/**
 * Strip the inline media from message arrays.
 *
 * This returns a stripped message. We do NOT want to mutate the data in place,
 * because of course we still want the actual API/client to handle the media.
 */ function stripInlineMediaFromMessages(messages) {
    const stripped = messages.map((message)=>{
        let newMessage = undefined;
        if (!!message && typeof message === 'object') {
            if (isContentArrayMessage(message)) {
                newMessage = {
                    ...message,
                    content: stripInlineMediaFromMessages(message.content)
                };
            } else if ('content' in message && (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$mediaStripping$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isContentMedia"])(message.content)) {
                newMessage = {
                    ...message,
                    content: (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$mediaStripping$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stripInlineMediaFromSingleMessage"])(message.content)
                };
            }
            if (isPartsMessage(message)) {
                newMessage = {
                    // might have to strip content AND parts
                    ...newMessage ?? message,
                    parts: stripInlineMediaFromMessages(message.parts)
                };
            }
            if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$mediaStripping$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isContentMedia"])(newMessage)) {
                newMessage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$mediaStripping$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stripInlineMediaFromSingleMessage"])(newMessage);
            } else if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$mediaStripping$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["isContentMedia"])(message)) {
                newMessage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$mediaStripping$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["stripInlineMediaFromSingleMessage"])(message);
            }
        }
        return newMessage ?? message;
    });
    return stripped;
}
/**
 * Truncate an array of messages to fit within a byte limit.
 *
 * Strategy:
 * - Always keeps only the last (newest) message
 * - Strips inline media from the message
 * - Truncates the message content if it exceeds the byte limit
 *
 * @param messages - Array of messages to truncate
 * @param maxBytes - Maximum total byte limit for the message
 * @returns Array containing only the last message (possibly truncated)
 *
 * @example
 * ```ts
 * const messages = [msg1, msg2, msg3, msg4]; // newest is msg4
 * const truncated = truncateMessagesByBytes(messages, 10000);
 * // Returns [msg4] (truncated if needed)
 * ```
 */ function truncateMessagesByBytes(messages, maxBytes) {
    // Early return for empty or invalid input
    if (!Array.isArray(messages) || messages.length === 0) {
        return messages;
    }
    // The result is always a single-element array that callers wrap with
    // JSON.stringify([message]), so subtract the 2-byte array wrapper ("["  and "]")
    // to ensure the final serialized value stays under the limit.
    const effectiveMaxBytes = maxBytes - 2;
    // Always keep only the last message
    const lastMessage = messages[messages.length - 1];
    // Strip inline media from the single message
    const stripped = stripInlineMediaFromMessages([
        lastMessage
    ]);
    const strippedMessage = stripped[0];
    // Check if it fits
    const messageBytes = jsonBytes(strippedMessage);
    if (messageBytes <= effectiveMaxBytes) {
        return stripped;
    }
    // Truncate the single message if needed
    return truncateSingleMessage(strippedMessage, effectiveMaxBytes);
}
/**
 * Truncate GenAI messages using the default byte limit.
 *
 * Convenience wrapper around `truncateMessagesByBytes` with the default limit.
 *
 * @param messages - Array of messages to truncate
 * @returns Truncated array of messages
 */ function truncateGenAiMessages(messages) {
    return truncateMessagesByBytes(messages, DEFAULT_GEN_AI_MESSAGES_BYTE_LIMIT);
}
/**
 * Truncate GenAI string input using the default byte limit.
 *
 * @param input - The string to truncate
 * @returns Truncated string
 */ function truncateGenAiStringInput(input) {
    return truncateTextByBytes(input, DEFAULT_GEN_AI_MESSAGES_BYTE_LIMIT);
}
;
 //# sourceMappingURL=messageTruncation.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/ai/utils.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "buildMethodPath",
    ()=>buildMethodPath,
    "extractSystemInstructions",
    ()=>extractSystemInstructions,
    "getFinalOperationName",
    ()=>getFinalOperationName,
    "getSpanOperation",
    ()=>getSpanOperation,
    "getTruncatedJsonString",
    ()=>getTruncatedJsonString,
    "setTokenUsageAttributes",
    ()=>setTokenUsageAttributes
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/ai/gen-ai-attributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$messageTruncation$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/ai/messageTruncation.js [instrumentation-edge] (ecmascript)");
;
;
/**
 * Maps AI method paths to OpenTelemetry semantic convention operation names
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/#llm-request-spans
 */ function getFinalOperationName(methodPath) {
    if (methodPath.includes('messages')) {
        return 'chat';
    }
    if (methodPath.includes('completions')) {
        return 'text_completion';
    }
    // Google GenAI: models.generateContent* -> generate_content (actually generates AI responses)
    if (methodPath.includes('generateContent')) {
        return 'generate_content';
    }
    // Anthropic: models.get/retrieve -> models (metadata retrieval only)
    if (methodPath.includes('models')) {
        return 'models';
    }
    if (methodPath.includes('chat')) {
        return 'chat';
    }
    return methodPath.split('.').pop() || 'unknown';
}
/**
 * Get the span operation for AI methods
 * Following Sentry's convention: "gen_ai.{operation_name}"
 */ function getSpanOperation(methodPath) {
    return `gen_ai.${getFinalOperationName(methodPath)}`;
}
/**
 * Build method path from current traversal
 */ function buildMethodPath(currentPath, prop) {
    return currentPath ? `${currentPath}.${prop}` : prop;
}
/**
 * Set token usage attributes
 * @param span - The span to add attributes to
 * @param promptTokens - The number of prompt tokens
 * @param completionTokens - The number of completion tokens
 * @param cachedInputTokens - The number of cached input tokens
 * @param cachedOutputTokens - The number of cached output tokens
 */ function setTokenUsageAttributes(span, promptTokens, completionTokens, cachedInputTokens, cachedOutputTokens) {
    if (promptTokens !== undefined) {
        span.setAttributes({
            [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE"]]: promptTokens
        });
    }
    if (completionTokens !== undefined) {
        span.setAttributes({
            [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_OUTPUT_TOKENS_ATTRIBUTE"]]: completionTokens
        });
    }
    if (promptTokens !== undefined || completionTokens !== undefined || cachedInputTokens !== undefined || cachedOutputTokens !== undefined) {
        /**
     * Total input tokens in a request is the summation of `input_tokens`,
     * `cache_creation_input_tokens`, and `cache_read_input_tokens`.
     */ const totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0) + (cachedInputTokens ?? 0) + (cachedOutputTokens ?? 0);
        span.setAttributes({
            [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_TOTAL_TOKENS_ATTRIBUTE"]]: totalTokens
        });
    }
}
/**
 * Get the truncated JSON string for a string or array of strings.
 *
 * @param value - The string or array of strings to truncate
 * @returns The truncated JSON string
 */ function getTruncatedJsonString(value) {
    if (typeof value === 'string') {
        // Some values are already JSON strings, so we don't need to duplicate the JSON parsing
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$messageTruncation$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["truncateGenAiStringInput"])(value);
    }
    if (Array.isArray(value)) {
        // truncateGenAiMessages returns an array of strings, so we need to stringify it
        const truncatedMessages = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$messageTruncation$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["truncateGenAiMessages"])(value);
        return JSON.stringify(truncatedMessages);
    }
    // value is an object, so we need to stringify it
    return JSON.stringify(value);
}
/**
 * Extract system instructions from messages array.
 * Finds the first system message and formats it according to OpenTelemetry semantic conventions.
 *
 * @param messages - Array of messages to extract system instructions from
 * @returns systemInstructions (JSON string) and filteredMessages (without system message)
 */ function extractSystemInstructions(messages) {
    if (!Array.isArray(messages)) {
        return {
            systemInstructions: undefined,
            filteredMessages: messages
        };
    }
    const systemMessageIndex = messages.findIndex((msg)=>msg && typeof msg === 'object' && 'role' in msg && msg.role === 'system');
    if (systemMessageIndex === -1) {
        return {
            systemInstructions: undefined,
            filteredMessages: messages
        };
    }
    const systemMessage = messages[systemMessageIndex];
    const systemContent = typeof systemMessage.content === 'string' ? systemMessage.content : systemMessage.content !== undefined ? JSON.stringify(systemMessage.content) : undefined;
    if (!systemContent) {
        return {
            systemInstructions: undefined,
            filteredMessages: messages
        };
    }
    const systemInstructions = JSON.stringify([
        {
            type: 'text',
            content: systemContent
        }
    ]);
    const filteredMessages = [
        ...messages.slice(0, systemMessageIndex),
        ...messages.slice(systemMessageIndex + 1)
    ];
    return {
        systemInstructions,
        filteredMessages
    };
}
;
 //# sourceMappingURL=utils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/vercel-ai/vercel-ai-attributes.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AI_MODEL_ID_ATTRIBUTE",
    ()=>AI_MODEL_ID_ATTRIBUTE,
    "AI_OPERATION_ID_ATTRIBUTE",
    ()=>AI_OPERATION_ID_ATTRIBUTE,
    "AI_PROMPT_ATTRIBUTE",
    ()=>AI_PROMPT_ATTRIBUTE,
    "AI_PROMPT_MESSAGES_ATTRIBUTE",
    ()=>AI_PROMPT_MESSAGES_ATTRIBUTE,
    "AI_PROMPT_TOOLS_ATTRIBUTE",
    ()=>AI_PROMPT_TOOLS_ATTRIBUTE,
    "AI_RESPONSE_OBJECT_ATTRIBUTE",
    ()=>AI_RESPONSE_OBJECT_ATTRIBUTE,
    "AI_RESPONSE_PROVIDER_METADATA_ATTRIBUTE",
    ()=>AI_RESPONSE_PROVIDER_METADATA_ATTRIBUTE,
    "AI_RESPONSE_TEXT_ATTRIBUTE",
    ()=>AI_RESPONSE_TEXT_ATTRIBUTE,
    "AI_RESPONSE_TOOL_CALLS_ATTRIBUTE",
    ()=>AI_RESPONSE_TOOL_CALLS_ATTRIBUTE,
    "AI_SCHEMA_ATTRIBUTE",
    ()=>AI_SCHEMA_ATTRIBUTE,
    "AI_TELEMETRY_FUNCTION_ID_ATTRIBUTE",
    ()=>AI_TELEMETRY_FUNCTION_ID_ATTRIBUTE,
    "AI_TOOL_CALL_ARGS_ATTRIBUTE",
    ()=>AI_TOOL_CALL_ARGS_ATTRIBUTE,
    "AI_TOOL_CALL_ID_ATTRIBUTE",
    ()=>AI_TOOL_CALL_ID_ATTRIBUTE,
    "AI_TOOL_CALL_NAME_ATTRIBUTE",
    ()=>AI_TOOL_CALL_NAME_ATTRIBUTE,
    "AI_TOOL_CALL_RESULT_ATTRIBUTE",
    ()=>AI_TOOL_CALL_RESULT_ATTRIBUTE,
    "AI_USAGE_CACHED_INPUT_TOKENS_ATTRIBUTE",
    ()=>AI_USAGE_CACHED_INPUT_TOKENS_ATTRIBUTE,
    "AI_USAGE_COMPLETION_TOKENS_ATTRIBUTE",
    ()=>AI_USAGE_COMPLETION_TOKENS_ATTRIBUTE,
    "AI_USAGE_PROMPT_TOKENS_ATTRIBUTE",
    ()=>AI_USAGE_PROMPT_TOKENS_ATTRIBUTE,
    "OPERATION_NAME_ATTRIBUTE",
    ()=>OPERATION_NAME_ATTRIBUTE
]);
/* eslint-disable max-lines */ /**
 * AI SDK Telemetry Attributes
 * Based on https://ai-sdk.dev/docs/ai-sdk-core/telemetry#collected-data
 */ // =============================================================================
// COMMON ATTRIBUTES
// =============================================================================
/**
 * Common attribute for operation name across all functions and spans
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#collected-data
 */ const OPERATION_NAME_ATTRIBUTE = 'operation.name';
/**
 * Common attribute for AI operation ID across all functions and spans
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#collected-data
 */ const AI_OPERATION_ID_ATTRIBUTE = 'ai.operationId';
// =============================================================================
// SHARED ATTRIBUTES
// =============================================================================
/**
 * `generateText` function - `ai.generateText` span
 * `streamText` function - `ai.streamText` span
 *
 * The prompt that was used when calling the function
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#generatetext-function
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#streamtext-function
 */ const AI_PROMPT_ATTRIBUTE = 'ai.prompt';
/**
 * `generateObject` function - `ai.generateObject` span
 * `streamObject` function - `ai.streamObject` span
 *
 * The JSON schema version of the schema that was passed into the function
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#generateobject-function
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#streamobject-function
 */ const AI_SCHEMA_ATTRIBUTE = 'ai.schema';
/**
 * `generateObject` function - `ai.generateObject` span
 * `streamObject` function - `ai.streamObject` span
 *
 * The object that was generated (stringified JSON)
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#generateobject-function
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#streamobject-function
 */ const AI_RESPONSE_OBJECT_ATTRIBUTE = 'ai.response.object';
// =============================================================================
// GENERATETEXT FUNCTION - UNIQUE ATTRIBUTES
// =============================================================================
/**
 * `generateText` function - `ai.generateText` span
 *
 * The text that was generated
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#generatetext-function
 */ const AI_RESPONSE_TEXT_ATTRIBUTE = 'ai.response.text';
/**
 * `generateText` function - `ai.generateText` span
 *
 * The tool calls that were made as part of the generation (stringified JSON)
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#generatetext-function
 */ const AI_RESPONSE_TOOL_CALLS_ATTRIBUTE = 'ai.response.toolCalls';
/**
 * `generateText` function - `ai.generateText.doGenerate` span
 *
 * The messages that were passed into the provider
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#generatetext-function
 */ const AI_PROMPT_MESSAGES_ATTRIBUTE = 'ai.prompt.messages';
/**
 * `generateText` function - `ai.generateText.doGenerate` span
 *
 * Array of stringified tool definitions
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#generatetext-function
 */ const AI_PROMPT_TOOLS_ATTRIBUTE = 'ai.prompt.tools';
/**
 * Basic LLM span information
 * Multiple spans
 *
 * The id of the model
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#basic-llm-span-information
 */ const AI_MODEL_ID_ATTRIBUTE = 'ai.model.id';
/**
 * Basic LLM span information
 * Multiple spans
 *
 * Provider specific metadata returned with the generation response
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#basic-llm-span-information
 */ const AI_RESPONSE_PROVIDER_METADATA_ATTRIBUTE = 'ai.response.providerMetadata';
/**
 * Basic LLM span information
 * Multiple spans
 *
 * The number of cached input tokens that were used
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#basic-llm-span-information
 */ const AI_USAGE_CACHED_INPUT_TOKENS_ATTRIBUTE = 'ai.usage.cachedInputTokens';
/**
 * Basic LLM span information
 * Multiple spans
 *
 * The functionId that was set through `telemetry.functionId`
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#basic-llm-span-information
 */ const AI_TELEMETRY_FUNCTION_ID_ATTRIBUTE = 'ai.telemetry.functionId';
/**
 * Basic LLM span information
 * Multiple spans
 *
 * The number of completion tokens that were used
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#basic-llm-span-information
 */ const AI_USAGE_COMPLETION_TOKENS_ATTRIBUTE = 'ai.usage.completionTokens';
/**
 * Basic LLM span information
 * Multiple spans
 *
 * The number of prompt tokens that were used
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#basic-llm-span-information
 */ const AI_USAGE_PROMPT_TOKENS_ATTRIBUTE = 'ai.usage.promptTokens';
// =============================================================================
// TOOL CALL SPANS
// =============================================================================
/**
 * Tool call spans
 * `ai.toolCall` span
 *
 * The name of the tool
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#tool-call-spans
 */ const AI_TOOL_CALL_NAME_ATTRIBUTE = 'ai.toolCall.name';
/**
 * Tool call spans
 * `ai.toolCall` span
 *
 * The id of the tool call
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#tool-call-spans
 */ const AI_TOOL_CALL_ID_ATTRIBUTE = 'ai.toolCall.id';
/**
 * Tool call spans
 * `ai.toolCall` span
 *
 * The parameters of the tool call
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#tool-call-spans
 */ const AI_TOOL_CALL_ARGS_ATTRIBUTE = 'ai.toolCall.args';
/**
 * Tool call spans
 * `ai.toolCall` span
 *
 * The result of the tool call
 * @see https://ai-sdk.dev/docs/ai-sdk-core/telemetry#tool-call-spans
 */ const AI_TOOL_CALL_RESULT_ATTRIBUTE = 'ai.toolCall.result';
;
 //# sourceMappingURL=vercel-ai-attributes.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/vercel-ai/utils.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "_INTERNAL_cleanupToolCallSpan",
    ()=>_INTERNAL_cleanupToolCallSpan,
    "_INTERNAL_getSpanForToolCallId",
    ()=>_INTERNAL_getSpanForToolCallId,
    "accumulateTokensForParent",
    ()=>accumulateTokensForParent,
    "applyAccumulatedTokens",
    ()=>applyAccumulatedTokens,
    "convertAvailableToolsToJsonString",
    ()=>convertAvailableToolsToJsonString,
    "convertUserInputToMessagesFormat",
    ()=>convertUserInputToMessagesFormat,
    "getSpanOpFromName",
    ()=>getSpanOpFromName,
    "requestMessagesFromPrompt",
    ()=>requestMessagesFromPrompt
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/ai/gen-ai-attributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/ai/utils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/vercel-ai/constants.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/vercel-ai/vercel-ai-attributes.js [instrumentation-edge] (ecmascript)");
;
;
;
;
/**
 * Accumulates token data from a span to its parent in the token accumulator map.
 * This function extracts token usage from the current span and adds it to the
 * accumulated totals for its parent span.
 */ function accumulateTokensForParent(span, tokenAccumulator) {
    const parentSpanId = span.parent_span_id;
    if (!parentSpanId) {
        return;
    }
    const inputTokens = span.data[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE"]];
    const outputTokens = span.data[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_OUTPUT_TOKENS_ATTRIBUTE"]];
    if (typeof inputTokens === 'number' || typeof outputTokens === 'number') {
        const existing = tokenAccumulator.get(parentSpanId) || {
            inputTokens: 0,
            outputTokens: 0
        };
        if (typeof inputTokens === 'number') {
            existing.inputTokens += inputTokens;
        }
        if (typeof outputTokens === 'number') {
            existing.outputTokens += outputTokens;
        }
        tokenAccumulator.set(parentSpanId, existing);
    }
}
/**
 * Applies accumulated token data to the `gen_ai.invoke_agent` span.
 * Only immediate children of the `gen_ai.invoke_agent` span are considered,
 * since aggregation will automatically occur for each parent span.
 */ function applyAccumulatedTokens(spanOrTrace, tokenAccumulator) {
    const accumulated = tokenAccumulator.get(spanOrTrace.span_id);
    if (!accumulated || !spanOrTrace.data) {
        return;
    }
    if (accumulated.inputTokens > 0) {
        spanOrTrace.data[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE"]] = accumulated.inputTokens;
    }
    if (accumulated.outputTokens > 0) {
        spanOrTrace.data[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_OUTPUT_TOKENS_ATTRIBUTE"]] = accumulated.outputTokens;
    }
    if (accumulated.inputTokens > 0 || accumulated.outputTokens > 0) {
        spanOrTrace.data['gen_ai.usage.total_tokens'] = accumulated.inputTokens + accumulated.outputTokens;
    }
}
/**
 * Get the span associated with a tool call ID
 */ function _INTERNAL_getSpanForToolCallId(toolCallId) {
    return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["toolCallSpanMap"].get(toolCallId);
}
/**
 * Clean up the span mapping for a tool call ID
 */ function _INTERNAL_cleanupToolCallSpan(toolCallId) {
    __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["toolCallSpanMap"].delete(toolCallId);
}
/**
 * Convert an array of tool strings to a JSON string
 */ function convertAvailableToolsToJsonString(tools) {
    const toolObjects = tools.map((tool)=>{
        if (typeof tool === 'string') {
            try {
                return JSON.parse(tool);
            } catch  {
                return tool;
            }
        }
        return tool;
    });
    return JSON.stringify(toolObjects);
}
/**
 * Filter out invalid entries in messages array
 * @param input - The input array to filter
 * @returns The filtered array
 */ function filterMessagesArray(input) {
    return input.filter((m)=>!!m && typeof m === 'object' && 'role' in m && 'content' in m);
}
/**
 * Normalize the user input (stringified object with prompt, system, messages) to messages array
 */ function convertUserInputToMessagesFormat(userInput) {
    try {
        const p = JSON.parse(userInput);
        if (!!p && typeof p === 'object') {
            let { messages } = p;
            const { prompt, system } = p;
            const result = [];
            // prepend top-level system instruction if present
            if (typeof system === 'string') {
                result.push({
                    role: 'system',
                    content: system
                });
            }
            // stringified messages array
            if (typeof messages === 'string') {
                try {
                    messages = JSON.parse(messages);
                } catch  {
                // ignore parse errors
                }
            }
            // messages array format: { messages: [...] }
            if (Array.isArray(messages)) {
                result.push(...filterMessagesArray(messages));
                return result;
            }
            // prompt array format: { prompt: [...] }
            if (Array.isArray(prompt)) {
                result.push(...filterMessagesArray(prompt));
                return result;
            }
            // prompt string format: { prompt: "..." }
            if (typeof prompt === 'string') {
                result.push({
                    role: 'user',
                    content: prompt
                });
            }
            if (result.length > 0) {
                return result;
            }
        }
    // eslint-disable-next-line no-empty
    } catch  {}
    return [];
}
/**
 * Generate a request.messages JSON array from the prompt field in the
 * invoke_agent op
 */ function requestMessagesFromPrompt(span, attributes) {
    if (typeof attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_PROMPT_ATTRIBUTE"]] === 'string' && !attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_INPUT_MESSAGES_ATTRIBUTE"]] && !attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_PROMPT_MESSAGES_ATTRIBUTE"]]) {
        // No messages array is present, so we need to convert the prompt to the proper messages format
        // This is the case for ai.generateText spans
        // The ai.prompt attribute is a stringified object with prompt, system, messages attributes
        // The format of these is described in the vercel docs, for instance: https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-object#parameters
        const userInput = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_PROMPT_ATTRIBUTE"]];
        const messages = convertUserInputToMessagesFormat(userInput);
        if (messages.length) {
            const { systemInstructions, filteredMessages } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["extractSystemInstructions"])(messages);
            if (systemInstructions) {
                span.setAttribute(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_SYSTEM_INSTRUCTIONS_ATTRIBUTE"], systemInstructions);
            }
            const filteredLength = Array.isArray(filteredMessages) ? filteredMessages.length : 0;
            const truncatedMessages = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getTruncatedJsonString"])(filteredMessages);
            span.setAttributes({
                [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_PROMPT_ATTRIBUTE"]]: truncatedMessages,
                [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_INPUT_MESSAGES_ATTRIBUTE"]]: truncatedMessages,
                [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_INPUT_MESSAGES_ORIGINAL_LENGTH_ATTRIBUTE"]]: filteredLength
            });
        }
    } else if (typeof attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_PROMPT_MESSAGES_ATTRIBUTE"]] === 'string') {
        // In this case we already get a properly formatted messages array, this is the preferred way to get the messages
        // This is the case for ai.generateText.doGenerate spans
        try {
            const messages = JSON.parse(attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_PROMPT_MESSAGES_ATTRIBUTE"]]);
            if (Array.isArray(messages)) {
                const { systemInstructions, filteredMessages } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["extractSystemInstructions"])(messages);
                if (systemInstructions) {
                    span.setAttribute(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_SYSTEM_INSTRUCTIONS_ATTRIBUTE"], systemInstructions);
                }
                const filteredLength = Array.isArray(filteredMessages) ? filteredMessages.length : 0;
                const truncatedMessages = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getTruncatedJsonString"])(filteredMessages);
                span.setAttributes({
                    [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_PROMPT_MESSAGES_ATTRIBUTE"]]: truncatedMessages,
                    [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_INPUT_MESSAGES_ATTRIBUTE"]]: truncatedMessages,
                    [__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_INPUT_MESSAGES_ORIGINAL_LENGTH_ATTRIBUTE"]]: filteredLength
                });
            }
        // eslint-disable-next-line no-empty
        } catch  {}
    }
}
/**
 * Maps a Vercel AI span name to the corresponding Sentry op.
 */ function getSpanOpFromName(name) {
    switch(name){
        case 'ai.generateText':
        case 'ai.streamText':
        case 'ai.generateObject':
        case 'ai.streamObject':
        case 'ai.embed':
        case 'ai.embedMany':
        case 'ai.rerank':
            return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_INVOKE_AGENT_OPERATION_ATTRIBUTE"];
        case 'ai.generateText.doGenerate':
            return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_GENERATE_TEXT_DO_GENERATE_OPERATION_ATTRIBUTE"];
        case 'ai.streamText.doStream':
            return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_STREAM_TEXT_DO_STREAM_OPERATION_ATTRIBUTE"];
        case 'ai.generateObject.doGenerate':
            return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_GENERATE_OBJECT_DO_GENERATE_OPERATION_ATTRIBUTE"];
        case 'ai.streamObject.doStream':
            return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_STREAM_OBJECT_DO_STREAM_OPERATION_ATTRIBUTE"];
        case 'ai.embed.doEmbed':
            return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_EMBED_DO_EMBED_OPERATION_ATTRIBUTE"];
        case 'ai.embedMany.doEmbed':
            return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_EMBED_MANY_DO_EMBED_OPERATION_ATTRIBUTE"];
        case 'ai.rerank.doRerank':
            return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_RERANK_DO_RERANK_OPERATION_ATTRIBUTE"];
        case 'ai.toolCall':
            return __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_EXECUTE_TOOL_OPERATION_ATTRIBUTE"];
        default:
            if (name.startsWith('ai.stream')) {
                return 'ai.run';
            }
            return undefined;
    }
}
;
 //# sourceMappingURL=utils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/vercel-ai/index.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addVercelAiProcessors",
    ()=>addVercelAiProcessors
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/semanticAttributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/spanUtils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/ai/gen-ai-attributes.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/vercel-ai/constants.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/vercel-ai/utils.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/tracing/vercel-ai/vercel-ai-attributes.js [instrumentation-edge] (ecmascript)");
;
;
;
;
;
;
function addOriginToSpan(span, origin) {
    span.setAttribute(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN"], origin);
}
/**
 * Maps Vercel AI SDK operation names to OpenTelemetry semantic convention values
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/#llm-request-spans
 */ function mapVercelAiOperationName(operationName) {
    // Top-level pipeline operations map to invoke_agent
    if (__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["INVOKE_AGENT_OPS"].has(operationName)) {
        return 'invoke_agent';
    }
    // .do* operations are the actual LLM calls
    if (__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GENERATE_CONTENT_OPS"].has(operationName)) {
        return 'generate_content';
    }
    if (__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["EMBEDDINGS_OPS"].has(operationName)) {
        return 'embeddings';
    }
    if (__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["RERANK_OPS"].has(operationName)) {
        return 'rerank';
    }
    if (operationName === 'ai.toolCall') {
        return 'execute_tool';
    }
    // Return the original value for unknown operations
    return operationName;
}
/**
 * Post-process spans emitted by the Vercel AI SDK.
 * This is supposed to be used in `client.on('spanStart', ...)
 */ function onVercelAiSpanStart(span) {
    const { data: attributes, description: name } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$spanUtils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["spanToJSON"])(span);
    if (!name) {
        return;
    }
    // Tool call spans
    // https://ai-sdk.dev/docs/ai-sdk-core/telemetry#tool-call-spans
    if (attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_TOOL_CALL_NAME_ATTRIBUTE"]] && attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_TOOL_CALL_ID_ATTRIBUTE"]] && name === 'ai.toolCall') {
        processToolCallSpan(span, attributes);
        return;
    }
    // V6+ Check if this is a Vercel AI span by checking if the operation ID attribute is present.
    // V5+ Check if this is a Vercel AI span by name pattern.
    if (!attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_OPERATION_ID_ATTRIBUTE"]] && !name.startsWith('ai.')) {
        return;
    }
    processGenerateSpan(span, name, attributes);
}
function vercelAiEventProcessor(event) {
    if (event.type === 'transaction' && event.spans) {
        // Map to accumulate token data by parent span ID
        const tokenAccumulator = new Map();
        // First pass: process all spans and accumulate token data
        for (const span of event.spans){
            processEndedVercelAiSpan(span);
            // Accumulate token data for parent spans
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["accumulateTokensForParent"])(span, tokenAccumulator);
        }
        // Second pass: apply accumulated token data to parent spans
        for (const span of event.spans){
            if (span.op !== 'gen_ai.invoke_agent') {
                continue;
            }
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["applyAccumulatedTokens"])(span, tokenAccumulator);
        }
        // Also apply to root when it is the invoke_agent pipeline
        const trace = event.contexts?.trace;
        if (trace && trace.op === 'gen_ai.invoke_agent') {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["applyAccumulatedTokens"])(trace, tokenAccumulator);
        }
    }
    return event;
}
/**
 * Post-process spans emitted by the Vercel AI SDK.
 */ function processEndedVercelAiSpan(span) {
    const { data: attributes, origin } = span;
    if (origin !== 'auto.vercelai.otel') {
        return;
    }
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_USAGE_COMPLETION_TOKENS_ATTRIBUTE"], __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_OUTPUT_TOKENS_ATTRIBUTE"]);
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_USAGE_PROMPT_TOKENS_ATTRIBUTE"], __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE"]);
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_USAGE_CACHED_INPUT_TOKENS_ATTRIBUTE"], __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_CACHED_ATTRIBUTE"]);
    // Parent spans (ai.streamText, ai.streamObject, etc.) use inputTokens/outputTokens instead of promptTokens/completionTokens
    renameAttributeKey(attributes, 'ai.usage.inputTokens', __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE"]);
    renameAttributeKey(attributes, 'ai.usage.outputTokens', __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_OUTPUT_TOKENS_ATTRIBUTE"]);
    // AI SDK uses avgOutputTokensPerSecond, map to our expected attribute name
    renameAttributeKey(attributes, 'ai.response.avgOutputTokensPerSecond', 'ai.response.avgCompletionTokensPerSecond');
    // Input tokens is the sum of prompt tokens and cached input tokens
    if (typeof attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE"]] === 'number' && typeof attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_CACHED_ATTRIBUTE"]] === 'number') {
        attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE"]] = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE"]] + attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_CACHED_ATTRIBUTE"]];
    }
    if (typeof attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_OUTPUT_TOKENS_ATTRIBUTE"]] === 'number' && typeof attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE"]] === 'number') {
        attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_TOTAL_TOKENS_ATTRIBUTE"]] = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_OUTPUT_TOKENS_ATTRIBUTE"]] + attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_ATTRIBUTE"]];
    }
    // Convert the available tools array to a JSON string
    if (attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_PROMPT_TOOLS_ATTRIBUTE"]] && Array.isArray(attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_PROMPT_TOOLS_ATTRIBUTE"]])) {
        attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_PROMPT_TOOLS_ATTRIBUTE"]] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["convertAvailableToolsToJsonString"])(attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_PROMPT_TOOLS_ATTRIBUTE"]]);
    }
    // Rename AI SDK attributes to standardized gen_ai attributes
    // Map operation.name to OpenTelemetry semantic convention values
    if (attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["OPERATION_NAME_ATTRIBUTE"]]) {
        const operationName = mapVercelAiOperationName(attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["OPERATION_NAME_ATTRIBUTE"]]);
        attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_OPERATION_NAME_ATTRIBUTE"]] = operationName;
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["OPERATION_NAME_ATTRIBUTE"]];
    }
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_PROMPT_MESSAGES_ATTRIBUTE"], __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_INPUT_MESSAGES_ATTRIBUTE"]);
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_RESPONSE_TEXT_ATTRIBUTE"], 'gen_ai.response.text');
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_RESPONSE_TOOL_CALLS_ATTRIBUTE"], 'gen_ai.response.tool_calls');
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_RESPONSE_OBJECT_ATTRIBUTE"], 'gen_ai.response.object');
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_PROMPT_TOOLS_ATTRIBUTE"], 'gen_ai.request.available_tools');
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_TOOL_CALL_ARGS_ATTRIBUTE"], __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_TOOL_INPUT_ATTRIBUTE"]);
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_TOOL_CALL_RESULT_ATTRIBUTE"], __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_TOOL_OUTPUT_ATTRIBUTE"]);
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_SCHEMA_ATTRIBUTE"], 'gen_ai.request.schema');
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_MODEL_ID_ATTRIBUTE"], __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_REQUEST_MODEL_ATTRIBUTE"]);
    addProviderMetadataToAttributes(attributes);
    // Change attributes namespaced with `ai.X` to `vercel.ai.X`
    for (const key of Object.keys(attributes)){
        if (key.startsWith('ai.')) {
            renameAttributeKey(attributes, key, `vercel.${key}`);
        }
    }
}
/**
 * Renames an attribute key in the provided attributes object if the old key exists.
 * This function safely handles null and undefined values.
 */ function renameAttributeKey(attributes, oldKey, newKey) {
    if (attributes[oldKey] != null) {
        attributes[newKey] = attributes[oldKey];
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete attributes[oldKey];
    }
}
function processToolCallSpan(span, attributes) {
    addOriginToSpan(span, 'auto.vercelai.otel');
    span.setAttribute(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"], 'gen_ai.execute_tool');
    span.setAttribute(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_OPERATION_NAME_ATTRIBUTE"], 'execute_tool');
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_TOOL_CALL_NAME_ATTRIBUTE"], __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_TOOL_NAME_ATTRIBUTE"]);
    renameAttributeKey(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_TOOL_CALL_ID_ATTRIBUTE"], __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_TOOL_CALL_ID_ATTRIBUTE"]);
    // Store the span in our global map using the tool call ID
    // This allows us to capture tool errors and link them to the correct span
    const toolCallId = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_TOOL_CALL_ID_ATTRIBUTE"]];
    if (typeof toolCallId === 'string') {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$constants$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["toolCallSpanMap"].set(toolCallId, span);
    }
    // https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/#gen-ai-tool-type
    if (!attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_TOOL_TYPE_ATTRIBUTE"]]) {
        span.setAttribute(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_TOOL_TYPE_ATTRIBUTE"], 'function');
    }
    const toolName = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_TOOL_NAME_ATTRIBUTE"]];
    if (toolName) {
        span.updateName(`execute_tool ${toolName}`);
    }
}
function processGenerateSpan(span, name, attributes) {
    addOriginToSpan(span, 'auto.vercelai.otel');
    const nameWthoutAi = name.replace('ai.', '');
    span.setAttribute('ai.pipeline.name', nameWthoutAi);
    span.updateName(nameWthoutAi);
    // If a telemetry name is set and the span represents a pipeline, use it as the operation name.
    // This name can be set at the request level by adding `experimental_telemetry.functionId`.
    const functionId = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_TELEMETRY_FUNCTION_ID_ATTRIBUTE"]];
    if (functionId && typeof functionId === 'string') {
        span.updateName(`${nameWthoutAi} ${functionId}`);
        span.setAttribute('gen_ai.function_id', functionId);
    }
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["requestMessagesFromPrompt"])(span, attributes);
    if (attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_MODEL_ID_ATTRIBUTE"]] && !attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_RESPONSE_MODEL_ATTRIBUTE"]]) {
        span.setAttribute(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_RESPONSE_MODEL_ATTRIBUTE"], attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_MODEL_ID_ATTRIBUTE"]]);
    }
    span.setAttribute('ai.streaming', name.includes('stream'));
    // Set the op based on the span name
    const op = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$utils$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["getSpanOpFromName"])(name);
    if (op) {
        span.setAttribute(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$semanticAttributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["SEMANTIC_ATTRIBUTE_SENTRY_OP"], op);
    }
    // Update span names for .do* spans to include the model ID (only if model ID exists)
    const modelId = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_MODEL_ID_ATTRIBUTE"]];
    if (modelId) {
        switch(name){
            case 'ai.generateText.doGenerate':
                span.updateName(`generate_text ${modelId}`);
                break;
            case 'ai.streamText.doStream':
                span.updateName(`stream_text ${modelId}`);
                break;
            case 'ai.generateObject.doGenerate':
                span.updateName(`generate_object ${modelId}`);
                break;
            case 'ai.streamObject.doStream':
                span.updateName(`stream_object ${modelId}`);
                break;
            case 'ai.embed.doEmbed':
                span.updateName(`embed ${modelId}`);
                break;
            case 'ai.embedMany.doEmbed':
                span.updateName(`embed_many ${modelId}`);
                break;
            case 'ai.rerank.doRerank':
                span.updateName(`rerank ${modelId}`);
                break;
        }
    }
}
/**
 * Add event processors to the given client to process Vercel AI spans.
 */ function addVercelAiProcessors(client) {
    client.on('spanStart', onVercelAiSpanStart);
    // Note: We cannot do this on `spanEnd`, because the span cannot be mutated anymore at this point
    client.addEventProcessor(Object.assign(vercelAiEventProcessor, {
        id: 'VercelAiEventProcessor'
    }));
}
function addProviderMetadataToAttributes(attributes) {
    const providerMetadata = attributes[__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$vercel$2d$ai$2f$vercel$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["AI_RESPONSE_PROVIDER_METADATA_ATTRIBUTE"]];
    if (providerMetadata) {
        try {
            const providerMetadataObject = JSON.parse(providerMetadata);
            // Handle OpenAI metadata (v5 uses 'openai', v6 Azure Responses API uses 'azure')
            const openaiMetadata = providerMetadataObject.openai ?? providerMetadataObject.azure;
            if (openaiMetadata) {
                setAttributeIfDefined(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_CACHED_ATTRIBUTE"], openaiMetadata.cachedPromptTokens);
                setAttributeIfDefined(attributes, 'gen_ai.usage.output_tokens.reasoning', openaiMetadata.reasoningTokens);
                setAttributeIfDefined(attributes, 'gen_ai.usage.output_tokens.prediction_accepted', openaiMetadata.acceptedPredictionTokens);
                setAttributeIfDefined(attributes, 'gen_ai.usage.output_tokens.prediction_rejected', openaiMetadata.rejectedPredictionTokens);
                setAttributeIfDefined(attributes, 'gen_ai.conversation.id', openaiMetadata.responseId);
            }
            if (providerMetadataObject.anthropic) {
                const cachedInputTokens = providerMetadataObject.anthropic.usage?.cache_read_input_tokens ?? providerMetadataObject.anthropic.cacheReadInputTokens;
                setAttributeIfDefined(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_CACHED_ATTRIBUTE"], cachedInputTokens);
                const cacheWriteInputTokens = providerMetadataObject.anthropic.usage?.cache_creation_input_tokens ?? providerMetadataObject.anthropic.cacheCreationInputTokens;
                setAttributeIfDefined(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE_ATTRIBUTE"], cacheWriteInputTokens);
            }
            if (providerMetadataObject.bedrock?.usage) {
                setAttributeIfDefined(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_CACHED_ATTRIBUTE"], providerMetadataObject.bedrock.usage.cacheReadInputTokens);
                setAttributeIfDefined(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_CACHE_WRITE_ATTRIBUTE"], providerMetadataObject.bedrock.usage.cacheWriteInputTokens);
            }
            if (providerMetadataObject.deepseek) {
                setAttributeIfDefined(attributes, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$tracing$2f$ai$2f$gen$2d$ai$2d$attributes$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GEN_AI_USAGE_INPUT_TOKENS_CACHED_ATTRIBUTE"], providerMetadataObject.deepseek.promptCacheHitTokens);
                setAttributeIfDefined(attributes, 'gen_ai.usage.input_tokens.cache_miss', providerMetadataObject.deepseek.promptCacheMissTokens);
            }
        } catch  {
        // Ignore
        }
    }
}
/**
 * Sets an attribute only if the value is not null or undefined.
 */ function setAttributeIfDefined(attributes, key, value) {
    if (value != null) {
        attributes[key] = value;
    }
}
;
 //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/vendor/escapeStringForRegex.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "escapeStringForRegex",
    ()=>escapeStringForRegex
]);
// Based on https://github.com/sindresorhus/escape-string-regexp but with modifications to:
//   a) reduce the size by skipping the runtime type - checking
//   b) ensure it gets down - compiled for old versions of Node(the published package only supports Node 14+).
//
// MIT License
//
// Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files(the "Software"), to deal in the Software without restriction, including without limitation
// the rights to use, copy, modify, merge, publish, distribute, sublicense, and / or sell copies of the Software, and
// to permit persons to whom the Software is furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all copies or substantial portions of
// the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
// THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.
/**
 * Given a string, escape characters which have meaning in the regex grammar, such that the result is safe to feed to
 * `new RegExp()`.
 *
 * @param regexString The string to escape
 * @returns An version of the string with all special regex characters escaped
 */ function escapeStringForRegex(regexString) {
    // escape the hyphen separately so we can also replace it with a unicode literal hyphen, to avoid the problems
    // discussed in https://github.com/sindresorhus/escape-string-regexp/issues/20.
    return regexString.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
}
;
 //# sourceMappingURL=escapeStringForRegex.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/path.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "basename",
    ()=>basename,
    "dirname",
    ()=>dirname,
    "isAbsolute",
    ()=>isAbsolute,
    "join",
    ()=>join,
    "normalizePath",
    ()=>normalizePath,
    "relative",
    ()=>relative,
    "resolve",
    ()=>resolve
]);
// Slightly modified (no IE8 support, ES6) and transcribed to TypeScript
// https://github.com/calvinmetcalf/rollup-plugin-node-builtins/blob/63ab8aacd013767445ca299e468d9a60a95328d7/src/es6/path.js
//
// Copyright Joyent, Inc.and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
/** JSDoc */ function normalizeArray(parts, allowAboveRoot) {
    // if the path tries to go above the root, `up` ends up > 0
    let up = 0;
    for(let i = parts.length - 1; i >= 0; i--){
        const last = parts[i];
        if (last === '.') {
            parts.splice(i, 1);
        } else if (last === '..') {
            parts.splice(i, 1);
            up++;
        } else if (up) {
            parts.splice(i, 1);
            up--;
        }
    }
    // if the path is allowed to go above the root, restore leading ..s
    if (allowAboveRoot) {
        for(; up--; up){
            parts.unshift('..');
        }
    }
    return parts;
}
// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
const splitPathRe = /^(\S+:\\|\/?)([\s\S]*?)((?:\.{1,2}|[^/\\]+?|)(\.[^./\\]*|))(?:[/\\]*)$/;
/** JSDoc */ function splitPath(filename) {
    // Truncate files names greater than 1024 characters to avoid regex dos
    // https://github.com/getsentry/sentry-javascript/pull/8737#discussion_r1285719172
    const truncated = filename.length > 1024 ? `<truncated>${filename.slice(-1024)}` : filename;
    const parts = splitPathRe.exec(truncated);
    return parts ? parts.slice(1) : [];
}
// path.resolve([from ...], to)
// posix version
/** JSDoc */ function resolve(...args) {
    let resolvedPath = '';
    let resolvedAbsolute = false;
    for(let i = args.length - 1; i >= -1 && !resolvedAbsolute; i--){
        const path = i >= 0 ? args[i] : '/';
        // Skip empty entries
        if (!path) {
            continue;
        }
        resolvedPath = `${path}/${resolvedPath}`;
        resolvedAbsolute = path.charAt(0) === '/';
    }
    // At this point the path should be resolved to a full absolute path, but
    // handle relative paths to be safe (might happen when process.cwd() fails)
    // Normalize the path
    resolvedPath = normalizeArray(resolvedPath.split('/').filter((p)=>!!p), !resolvedAbsolute).join('/');
    return (resolvedAbsolute ? '/' : '') + resolvedPath || '.';
}
/** JSDoc */ function trim(arr) {
    let start = 0;
    for(; start < arr.length; start++){
        if (arr[start] !== '') {
            break;
        }
    }
    let end = arr.length - 1;
    for(; end >= 0; end--){
        if (arr[end] !== '') {
            break;
        }
    }
    if (start > end) {
        return [];
    }
    return arr.slice(start, end - start + 1);
}
// path.relative(from, to)
// posix version
/** JSDoc */ function relative(from, to) {
    /* eslint-disable no-param-reassign */ from = resolve(from).slice(1);
    to = resolve(to).slice(1);
    /* eslint-enable no-param-reassign */ const fromParts = trim(from.split('/'));
    const toParts = trim(to.split('/'));
    const length = Math.min(fromParts.length, toParts.length);
    let samePartsLength = length;
    for(let i = 0; i < length; i++){
        if (fromParts[i] !== toParts[i]) {
            samePartsLength = i;
            break;
        }
    }
    let outputParts = [];
    for(let i = samePartsLength; i < fromParts.length; i++){
        outputParts.push('..');
    }
    outputParts = outputParts.concat(toParts.slice(samePartsLength));
    return outputParts.join('/');
}
// path.normalize(path)
// posix version
/** JSDoc */ function normalizePath(path) {
    const isPathAbsolute = isAbsolute(path);
    const trailingSlash = path.slice(-1) === '/';
    // Normalize the path
    let normalizedPath = normalizeArray(path.split('/').filter((p)=>!!p), !isPathAbsolute).join('/');
    if (!normalizedPath && !isPathAbsolute) {
        normalizedPath = '.';
    }
    if (normalizedPath && trailingSlash) {
        normalizedPath += '/';
    }
    return (isPathAbsolute ? '/' : '') + normalizedPath;
}
// posix version
/** JSDoc */ function isAbsolute(path) {
    return path.charAt(0) === '/';
}
// posix version
/** JSDoc */ function join(...args) {
    return normalizePath(args.join('/'));
}
/** JSDoc */ function dirname(path) {
    const result = splitPath(path);
    const root = result[0] || '';
    let dir = result[1];
    if (!root && !dir) {
        // No dirname whatsoever
        return '.';
    }
    if (dir) {
        // It has a dirname, strip trailing slash
        dir = dir.slice(0, dir.length - 1);
    }
    return root + dir;
}
/** JSDoc */ function basename(path, ext) {
    let f = splitPath(path)[2] || '';
    if (ext && f.slice(ext.length * -1) === ext) {
        f = f.slice(0, f.length - ext.length);
    }
    return f;
}
;
 //# sourceMappingURL=path.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integrations/rewriteframes.js [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "generateIteratee",
    ()=>generateIteratee,
    "rewriteFramesIntegration",
    ()=>rewriteFramesIntegration
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/integration.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$path$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/path.js [instrumentation-edge] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/esm/utils/worldwide.js [instrumentation-edge] (ecmascript)");
;
;
;
const INTEGRATION_NAME = 'RewriteFrames';
/**
 * Rewrite event frames paths.
 */ const rewriteFramesIntegration = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$integration$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["defineIntegration"])((options = {})=>{
    const root = options.root;
    const prefix = options.prefix || 'app:///';
    const isBrowser = 'window' in __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"] && !!__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$worldwide$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["GLOBAL_OBJ"].window;
    const iteratee = options.iteratee || generateIteratee({
        isBrowser,
        root,
        prefix
    });
    /** Process an exception event. */ function _processExceptionsEvent(event) {
        try {
            return {
                ...event,
                exception: {
                    ...event.exception,
                    // The check for this is performed inside `process` call itself, safe to skip here
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    values: event.exception.values.map((value)=>({
                            ...value,
                            ...value.stacktrace && {
                                stacktrace: _processStacktrace(value.stacktrace)
                            }
                        }))
                }
            };
        } catch  {
            return event;
        }
    }
    /** Process a stack trace. */ function _processStacktrace(stacktrace) {
        return {
            ...stacktrace,
            frames: stacktrace?.frames?.map((f)=>iteratee(f))
        };
    }
    return {
        name: INTEGRATION_NAME,
        processEvent (originalEvent) {
            let processedEvent = originalEvent;
            if (originalEvent.exception && Array.isArray(originalEvent.exception.values)) {
                processedEvent = _processExceptionsEvent(processedEvent);
            }
            return processedEvent;
        }
    };
});
/**
 * Exported only for tests.
 */ function generateIteratee({ isBrowser, root, prefix }) {
    return (frame)=>{
        if (!frame.filename) {
            return frame;
        }
        // Determine if this is a Windows frame by checking for a Windows-style prefix such as `C:\`
        const isWindowsFrame = /^[a-zA-Z]:\\/.test(frame.filename) || frame.filename.includes('\\') && !frame.filename.includes('/');
        // Check if the frame filename begins with `/`
        const startsWithSlash = /^\//.test(frame.filename);
        if (isBrowser) {
            if (root) {
                const oldFilename = frame.filename;
                if (oldFilename.indexOf(root) === 0) {
                    frame.filename = oldFilename.replace(root, prefix);
                }
            }
        } else {
            if (isWindowsFrame || startsWithSlash) {
                const filename = isWindowsFrame ? frame.filename.replace(/^[a-zA-Z]:/, '') // remove Windows-style prefix
                .replace(/\\/g, '/') // replace all `\\` instances with `/`
                 : frame.filename;
                const base = root ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$path$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["relative"])(root, filename) : (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$sentry$2f$core$2f$build$2f$esm$2f$utils$2f$path$2e$js__$5b$instrumentation$2d$edge$5d$__$28$ecmascript$29$__["basename"])(filename);
                frame.filename = `${prefix}${base}`;
            }
        }
        return frame;
    };
}
;
 //# sourceMappingURL=rewriteframes.js.map
}),
]);

//# sourceMappingURL=06187_%40sentry_core_build_esm_697dd491._.js.map