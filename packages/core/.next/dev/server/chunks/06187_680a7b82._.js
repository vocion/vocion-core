;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="45edcae4-b5a8-5e7f-2208-7117a1f2c804")}catch(e){}}();
module.exports = [
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

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
 */ __turbopack_context__.s([]);
;
;
;
;
;
;
 //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/autoLoaderUtils.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 * Enable instrumentations
 * @param instrumentations
 * @param tracerProvider
 * @param meterProvider
 */ __turbopack_context__.s([
    "disableInstrumentations",
    ()=>disableInstrumentations,
    "enableInstrumentations",
    ()=>enableInstrumentations
]);
function enableInstrumentations(instrumentations, tracerProvider, meterProvider, loggerProvider) {
    for(let i = 0, j = instrumentations.length; i < j; i++){
        const instrumentation = instrumentations[i];
        if (tracerProvider) {
            instrumentation.setTracerProvider(tracerProvider);
        }
        if (meterProvider) {
            instrumentation.setMeterProvider(meterProvider);
        }
        if (loggerProvider && instrumentation.setLoggerProvider) {
            instrumentation.setLoggerProvider(loggerProvider);
        }
        // instrumentations have been already enabled during creation
        // so enable only if user prevented that by setting enabled to false
        // this is to prevent double enabling but when calling register all
        // instrumentations should be now enabled
        if (!instrumentation.getConfig().enabled) {
            instrumentation.enable();
        }
    }
}
function disableInstrumentations(instrumentations) {
    instrumentations.forEach((instrumentation)=>instrumentation.disable());
} //# sourceMappingURL=autoLoaderUtils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/autoLoader.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "registerInstrumentations",
    ()=>registerInstrumentations
]);
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
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/trace-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$metrics$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/metrics-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2d$logs$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api-logs/build/esm/index.js [instrumentation] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoaderUtils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/autoLoaderUtils.js [instrumentation] (ecmascript)");
;
;
;
function registerInstrumentations(options) {
    const tracerProvider = options.tracerProvider || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["trace"].getTracerProvider();
    const meterProvider = options.meterProvider || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$metrics$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["metrics"].getMeterProvider();
    const loggerProvider = options.loggerProvider || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2d$logs$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__["logs"].getLoggerProvider();
    const instrumentations = options.instrumentations?.flat() ?? [];
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoaderUtils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["enableInstrumentations"])(instrumentations, tracerProvider, meterProvider, loggerProvider);
    return ()=>{
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoaderUtils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["disableInstrumentations"])(instrumentations);
    };
} //# sourceMappingURL=autoLoader.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/semver.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "satisfies",
    ()=>satisfies
]);
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
 */ // This is a custom semantic versioning implementation compatible with the
// `satisfies(version, range, options?)` function from the `semver` npm package;
// with the exception that the `loose` option is not supported.
//
// The motivation for the custom semver implementation is that
// `semver` package has some initialization delay (lots of RegExp init and compile)
// and this leads to coldstart overhead for the OTEL Lambda Node.js layer.
// Hence, we have implemented lightweight version of it internally with required functionalities.
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/diag-api.js [instrumentation] (ecmascript)");
;
const VERSION_REGEXP = /^(?:v)?(?<version>(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*))(?:-(?<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?<build>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const RANGE_REGEXP = /^(?<op><|>|=|==|<=|>=|~|\^|~>)?\s*(?:v)?(?<version>(?<major>x|X|\*|0|[1-9]\d*)(?:\.(?<minor>x|X|\*|0|[1-9]\d*))?(?:\.(?<patch>x|X|\*|0|[1-9]\d*))?)(?:-(?<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?<build>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const operatorResMap = {
    '>': [
        1
    ],
    '>=': [
        0,
        1
    ],
    '=': [
        0
    ],
    '<=': [
        -1,
        0
    ],
    '<': [
        -1
    ],
    '!=': [
        -1,
        1
    ]
};
function satisfies(version, range, options) {
    // Strict semver format check
    if (!_validateVersion(version)) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error(`Invalid version: ${version}`);
        return false;
    }
    // If range is empty, satisfy check succeeds regardless what version is
    if (!range) {
        return true;
    }
    // Cleanup range
    range = range.replace(/([<>=~^]+)\s+/g, '$1');
    // Parse version
    const parsedVersion = _parseVersion(version);
    if (!parsedVersion) {
        return false;
    }
    const allParsedRanges = [];
    // Check given version whether it satisfies given range expression
    const checkResult = _doSatisfies(parsedVersion, range, allParsedRanges, options);
    // If check result is OK,
    // do another final check for pre-release, if pre-release check is included by option
    if (checkResult && !options?.includePrerelease) {
        return _doPreleaseCheck(parsedVersion, allParsedRanges);
    }
    return checkResult;
}
function _validateVersion(version) {
    return typeof version === 'string' && VERSION_REGEXP.test(version);
}
function _doSatisfies(parsedVersion, range, allParsedRanges, options) {
    if (range.includes('||')) {
        // A version matches a range if and only if
        // every comparator in at least one of the ||-separated comparator sets is satisfied by the version
        const ranges = range.trim().split('||');
        for (const r of ranges){
            if (_checkRange(parsedVersion, r, allParsedRanges, options)) {
                return true;
            }
        }
        return false;
    } else if (range.includes(' - ')) {
        // Hyphen ranges: https://github.com/npm/node-semver#hyphen-ranges-xyz---abc
        range = replaceHyphen(range, options);
    } else if (range.includes(' ')) {
        // Multiple separated ranges and all needs to be satisfied for success
        const ranges = range.trim().replace(/\s{2,}/g, ' ').split(' ');
        for (const r of ranges){
            if (!_checkRange(parsedVersion, r, allParsedRanges, options)) {
                return false;
            }
        }
        return true;
    }
    // Check given parsed version with given range
    return _checkRange(parsedVersion, range, allParsedRanges, options);
}
function _checkRange(parsedVersion, range, allParsedRanges, options) {
    range = _normalizeRange(range, options);
    if (range.includes(' ')) {
        // If there are multiple ranges separated, satisfy each of them
        return _doSatisfies(parsedVersion, range, allParsedRanges, options);
    } else {
        // Validate and parse range
        const parsedRange = _parseRange(range);
        allParsedRanges.push(parsedRange);
        // Check parsed version by parsed range
        return _satisfies(parsedVersion, parsedRange);
    }
}
function _satisfies(parsedVersion, parsedRange) {
    // If range is invalid, satisfy check fails (no error throw)
    if (parsedRange.invalid) {
        return false;
    }
    // If range is empty or wildcard, satisfy check succeeds regardless what version is
    if (!parsedRange.version || _isWildcard(parsedRange.version)) {
        return true;
    }
    // Compare version segment first
    let comparisonResult = _compareVersionSegments(parsedVersion.versionSegments || [], parsedRange.versionSegments || []);
    // If versions segments are equal, compare by pre-release segments
    if (comparisonResult === 0) {
        const versionPrereleaseSegments = parsedVersion.prereleaseSegments || [];
        const rangePrereleaseSegments = parsedRange.prereleaseSegments || [];
        if (!versionPrereleaseSegments.length && !rangePrereleaseSegments.length) {
            comparisonResult = 0;
        } else if (!versionPrereleaseSegments.length && rangePrereleaseSegments.length) {
            comparisonResult = 1;
        } else if (versionPrereleaseSegments.length && !rangePrereleaseSegments.length) {
            comparisonResult = -1;
        } else {
            comparisonResult = _compareVersionSegments(versionPrereleaseSegments, rangePrereleaseSegments);
        }
    }
    // Resolve check result according to comparison operator
    return operatorResMap[parsedRange.op]?.includes(comparisonResult);
}
function _doPreleaseCheck(parsedVersion, allParsedRanges) {
    if (parsedVersion.prerelease) {
        return allParsedRanges.some((r)=>r.prerelease && r.version === parsedVersion.version);
    }
    return true;
}
function _normalizeRange(range, options) {
    range = range.trim();
    range = replaceCaret(range, options);
    range = replaceTilde(range);
    range = replaceXRange(range, options);
    range = range.trim();
    return range;
}
function isX(id) {
    return !id || id.toLowerCase() === 'x' || id === '*';
}
function _parseVersion(versionString) {
    const match = versionString.match(VERSION_REGEXP);
    if (!match) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error(`Invalid version: ${versionString}`);
        return undefined;
    }
    const version = match.groups.version;
    const prerelease = match.groups.prerelease;
    const build = match.groups.build;
    const versionSegments = version.split('.');
    const prereleaseSegments = prerelease?.split('.');
    return {
        op: undefined,
        version,
        versionSegments,
        versionSegmentCount: versionSegments.length,
        prerelease,
        prereleaseSegments,
        prereleaseSegmentCount: prereleaseSegments ? prereleaseSegments.length : 0,
        build
    };
}
function _parseRange(rangeString) {
    if (!rangeString) {
        return {};
    }
    const match = rangeString.match(RANGE_REGEXP);
    if (!match) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error(`Invalid range: ${rangeString}`);
        return {
            invalid: true
        };
    }
    let op = match.groups.op;
    const version = match.groups.version;
    const prerelease = match.groups.prerelease;
    const build = match.groups.build;
    const versionSegments = version.split('.');
    const prereleaseSegments = prerelease?.split('.');
    if (op === '==') {
        op = '=';
    }
    return {
        op: op || '=',
        version,
        versionSegments,
        versionSegmentCount: versionSegments.length,
        prerelease,
        prereleaseSegments,
        prereleaseSegmentCount: prereleaseSegments ? prereleaseSegments.length : 0,
        build
    };
}
function _isWildcard(s) {
    return s === '*' || s === 'x' || s === 'X';
}
function _parseVersionString(v) {
    const n = parseInt(v, 10);
    return isNaN(n) ? v : n;
}
function _normalizeVersionType(a, b) {
    if (typeof a === typeof b) {
        if (typeof a === 'number') {
            return [
                a,
                b
            ];
        } else if (typeof a === 'string') {
            return [
                a,
                b
            ];
        } else {
            throw new Error('Version segments can only be strings or numbers');
        }
    } else {
        return [
            String(a),
            String(b)
        ];
    }
}
function _compareVersionStrings(v1, v2) {
    if (_isWildcard(v1) || _isWildcard(v2)) {
        return 0;
    }
    const [parsedV1, parsedV2] = _normalizeVersionType(_parseVersionString(v1), _parseVersionString(v2));
    if (parsedV1 > parsedV2) {
        return 1;
    } else if (parsedV1 < parsedV2) {
        return -1;
    }
    return 0;
}
function _compareVersionSegments(v1, v2) {
    for(let i = 0; i < Math.max(v1.length, v2.length); i++){
        const res = _compareVersionStrings(v1[i] || '0', v2[i] || '0');
        if (res !== 0) {
            return res;
        }
    }
    return 0;
}
////////////////////////////////////////////////////////////////////////////////
// The rest of this file is adapted from portions of https://github.com/npm/node-semver/tree/868d4bb
// License:
/*
 * The ISC License
 *
 * Copyright (c) Isaac Z. Schlueter and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
 * IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */ const LETTERDASHNUMBER = '[a-zA-Z0-9-]';
const NUMERICIDENTIFIER = '0|[1-9]\\d*';
const NONNUMERICIDENTIFIER = `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`;
const GTLT = '((?:<|>)?=?)';
const PRERELEASEIDENTIFIER = `(?:${NUMERICIDENTIFIER}|${NONNUMERICIDENTIFIER})`;
const PRERELEASE = `(?:-(${PRERELEASEIDENTIFIER}(?:\\.${PRERELEASEIDENTIFIER})*))`;
const BUILDIDENTIFIER = `${LETTERDASHNUMBER}+`;
const BUILD = `(?:\\+(${BUILDIDENTIFIER}(?:\\.${BUILDIDENTIFIER})*))`;
const XRANGEIDENTIFIER = `${NUMERICIDENTIFIER}|x|X|\\*`;
const XRANGEPLAIN = `[v=\\s]*(${XRANGEIDENTIFIER})` + `(?:\\.(${XRANGEIDENTIFIER})` + `(?:\\.(${XRANGEIDENTIFIER})` + `(?:${PRERELEASE})?${BUILD}?` + `)?)?`;
const XRANGE = `^${GTLT}\\s*${XRANGEPLAIN}$`;
const XRANGE_REGEXP = new RegExp(XRANGE);
const HYPHENRANGE = `^\\s*(${XRANGEPLAIN})` + `\\s+-\\s+` + `(${XRANGEPLAIN})` + `\\s*$`;
const HYPHENRANGE_REGEXP = new RegExp(HYPHENRANGE);
const LONETILDE = '(?:~>?)';
const TILDE = `^${LONETILDE}${XRANGEPLAIN}$`;
const TILDE_REGEXP = new RegExp(TILDE);
const LONECARET = '(?:\\^)';
const CARET = `^${LONECARET}${XRANGEPLAIN}$`;
const CARET_REGEXP = new RegExp(CARET);
// Borrowed from https://github.com/npm/node-semver/blob/868d4bbe3d318c52544f38d5f9977a1103e924c2/classes/range.js#L285
//
// ~, ~> --> * (any, kinda silly)
// ~2, ~2.x, ~2.x.x, ~>2, ~>2.x ~>2.x.x --> >=2.0.0 <3.0.0-0
// ~2.0, ~2.0.x, ~>2.0, ~>2.0.x --> >=2.0.0 <2.1.0-0
// ~1.2, ~1.2.x, ~>1.2, ~>1.2.x --> >=1.2.0 <1.3.0-0
// ~1.2.3, ~>1.2.3 --> >=1.2.3 <1.3.0-0
// ~1.2.0, ~>1.2.0 --> >=1.2.0 <1.3.0-0
// ~0.0.1 --> >=0.0.1 <0.1.0-0
function replaceTilde(comp) {
    const r = TILDE_REGEXP;
    return comp.replace(r, (_, M, m, p, pr)=>{
        let ret;
        if (isX(M)) {
            ret = '';
        } else if (isX(m)) {
            ret = `>=${M}.0.0 <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
            // ~1.2 == >=1.2.0 <1.3.0-0
            ret = `>=${M}.${m}.0 <${M}.${+m + 1}.0-0`;
        } else if (pr) {
            ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
        } else {
            // ~1.2.3 == >=1.2.3 <1.3.0-0
            ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
        }
        return ret;
    });
}
// Borrowed from https://github.com/npm/node-semver/blob/868d4bbe3d318c52544f38d5f9977a1103e924c2/classes/range.js#L329
//
// ^ --> * (any, kinda silly)
// ^2, ^2.x, ^2.x.x --> >=2.0.0 <3.0.0-0
// ^2.0, ^2.0.x --> >=2.0.0 <3.0.0-0
// ^1.2, ^1.2.x --> >=1.2.0 <2.0.0-0
// ^1.2.3 --> >=1.2.3 <2.0.0-0
// ^1.2.0 --> >=1.2.0 <2.0.0-0
// ^0.0.1 --> >=0.0.1 <0.0.2-0
// ^0.1.0 --> >=0.1.0 <0.2.0-0
function replaceCaret(comp, options) {
    const r = CARET_REGEXP;
    const z = options?.includePrerelease ? '-0' : '';
    return comp.replace(r, (_, M, m, p, pr)=>{
        let ret;
        if (isX(M)) {
            ret = '';
        } else if (isX(m)) {
            ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
            if (M === '0') {
                ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
            } else {
                ret = `>=${M}.${m}.0${z} <${+M + 1}.0.0-0`;
            }
        } else if (pr) {
            if (M === '0') {
                if (m === '0') {
                    ret = `>=${M}.${m}.${p}-${pr} <${M}.${m}.${+p + 1}-0`;
                } else {
                    ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
                }
            } else {
                ret = `>=${M}.${m}.${p}-${pr} <${+M + 1}.0.0-0`;
            }
        } else {
            if (M === '0') {
                if (m === '0') {
                    ret = `>=${M}.${m}.${p}${z} <${M}.${m}.${+p + 1}-0`;
                } else {
                    ret = `>=${M}.${m}.${p}${z} <${M}.${+m + 1}.0-0`;
                }
            } else {
                ret = `>=${M}.${m}.${p} <${+M + 1}.0.0-0`;
            }
        }
        return ret;
    });
}
// Borrowed from https://github.com/npm/node-semver/blob/868d4bbe3d318c52544f38d5f9977a1103e924c2/classes/range.js#L390
function replaceXRange(comp, options) {
    const r = XRANGE_REGEXP;
    return comp.replace(r, (ret, gtlt, M, m, p, pr)=>{
        const xM = isX(M);
        const xm = xM || isX(m);
        const xp = xm || isX(p);
        const anyX = xp;
        if (gtlt === '=' && anyX) {
            gtlt = '';
        }
        // if we're including prereleases in the match, then we need
        // to fix this to -0, the lowest possible prerelease value
        pr = options?.includePrerelease ? '-0' : '';
        if (xM) {
            if (gtlt === '>' || gtlt === '<') {
                // nothing is allowed
                ret = '<0.0.0-0';
            } else {
                // nothing is forbidden
                ret = '*';
            }
        } else if (gtlt && anyX) {
            // we know patch is an x, because we have any x at all.
            // replace X with 0
            if (xm) {
                m = 0;
            }
            p = 0;
            if (gtlt === '>') {
                // >1 => >=2.0.0
                // >1.2 => >=1.3.0
                gtlt = '>=';
                if (xm) {
                    M = +M + 1;
                    m = 0;
                    p = 0;
                } else {
                    m = +m + 1;
                    p = 0;
                }
            } else if (gtlt === '<=') {
                // <=0.7.x is actually <0.8.0, since any 0.7.x should
                // pass.  Similarly, <=7.x is actually <8.0.0, etc.
                gtlt = '<';
                if (xm) {
                    M = +M + 1;
                } else {
                    m = +m + 1;
                }
            }
            if (gtlt === '<') {
                pr = '-0';
            }
            ret = `${gtlt + M}.${m}.${p}${pr}`;
        } else if (xm) {
            ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
        } else if (xp) {
            ret = `>=${M}.${m}.0${pr} <${M}.${+m + 1}.0-0`;
        }
        return ret;
    });
}
// Borrowed from https://github.com/npm/node-semver/blob/868d4bbe3d318c52544f38d5f9977a1103e924c2/classes/range.js#L488
//
// 1.2 - 3.4.5 => >=1.2.0 <=3.4.5
// 1.2.3 - 3.4 => >=1.2.0 <3.5.0-0 Any 3.4.x will do
// 1.2 - 3.4 => >=1.2.0 <3.5.0-0
function replaceHyphen(comp, options) {
    const r = HYPHENRANGE_REGEXP;
    return comp.replace(r, (_, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr)=>{
        if (isX(fM)) {
            from = '';
        } else if (isX(fm)) {
            from = `>=${fM}.0.0${options?.includePrerelease ? '-0' : ''}`;
        } else if (isX(fp)) {
            from = `>=${fM}.${fm}.0${options?.includePrerelease ? '-0' : ''}`;
        } else if (fpr) {
            from = `>=${from}`;
        } else {
            from = `>=${from}${options?.includePrerelease ? '-0' : ''}`;
        }
        if (isX(tM)) {
            to = '';
        } else if (isX(tm)) {
            to = `<${+tM + 1}.0.0-0`;
        } else if (isX(tp)) {
            to = `<${tM}.${+tm + 1}.0-0`;
        } else if (tpr) {
            to = `<=${tM}.${tm}.${tp}-${tpr}`;
        } else if (options?.includePrerelease) {
            to = `<${tM}.${tm}.${+tp + 1}-0`;
        } else {
            to = `<=${to}`;
        }
        return `${from} ${to}`.trim();
    });
} //# sourceMappingURL=semver.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/shimmer.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>shimmer,
    "massUnwrap",
    ()=>massUnwrap,
    "massWrap",
    ()=>massWrap,
    "unwrap",
    ()=>unwrap,
    "wrap",
    ()=>wrap
]);
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
 */ // Default to complaining loudly when things don't go according to plan.
// eslint-disable-next-line no-console
let logger = console.error.bind(console);
// Sets a property on an object, preserving its enumerability.
// This function assumes that the property is already writable.
function defineProperty(obj, name, value) {
    const enumerable = !!obj[name] && Object.prototype.propertyIsEnumerable.call(obj, name);
    Object.defineProperty(obj, name, {
        configurable: true,
        enumerable,
        writable: true,
        value
    });
}
const wrap = (nodule, name, wrapper)=>{
    if (!nodule || !nodule[name]) {
        logger('no original function ' + String(name) + ' to wrap');
        return;
    }
    if (!wrapper) {
        logger('no wrapper function');
        logger(new Error().stack);
        return;
    }
    const original = nodule[name];
    if (typeof original !== 'function' || typeof wrapper !== 'function') {
        logger('original object and wrapper must be functions');
        return;
    }
    const wrapped = wrapper(original, name);
    defineProperty(wrapped, '__original', original);
    defineProperty(wrapped, '__unwrap', ()=>{
        if (nodule[name] === wrapped) {
            defineProperty(nodule, name, original);
        }
    });
    defineProperty(wrapped, '__wrapped', true);
    defineProperty(nodule, name, wrapped);
    return wrapped;
};
const massWrap = (nodules, names, wrapper)=>{
    if (!nodules) {
        logger('must provide one or more modules to patch');
        logger(new Error().stack);
        return;
    } else if (!Array.isArray(nodules)) {
        nodules = [
            nodules
        ];
    }
    if (!(names && Array.isArray(names))) {
        logger('must provide one or more functions to wrap on modules');
        return;
    }
    nodules.forEach((nodule)=>{
        names.forEach((name)=>{
            wrap(nodule, name, wrapper);
        });
    });
};
const unwrap = (nodule, name)=>{
    if (!nodule || !nodule[name]) {
        logger('no function to unwrap.');
        logger(new Error().stack);
        return;
    }
    const wrapped = nodule[name];
    if (!wrapped.__unwrap) {
        logger('no original to unwrap to -- has ' + String(name) + ' already been unwrapped?');
    } else {
        wrapped.__unwrap();
        return;
    }
};
const massUnwrap = (nodules, names)=>{
    if (!nodules) {
        logger('must provide one or more modules to patch');
        logger(new Error().stack);
        return;
    } else if (!Array.isArray(nodules)) {
        nodules = [
            nodules
        ];
    }
    if (!(names && Array.isArray(names))) {
        logger('must provide one or more functions to unwrap on modules');
        return;
    }
    nodules.forEach((nodule)=>{
        names.forEach((name)=>{
            unwrap(nodule, name);
        });
    });
};
function shimmer(options) {
    if (options && options.logger) {
        if (typeof options.logger !== 'function') {
            logger("new logger isn't a function, not replacing");
        } else {
            logger = options.logger;
        }
    }
}
shimmer.wrap = wrap;
shimmer.massWrap = massWrap;
shimmer.unwrap = unwrap;
shimmer.massUnwrap = massUnwrap; //# sourceMappingURL=shimmer.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/instrumentation.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InstrumentationAbstract",
    ()=>InstrumentationAbstract
]);
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
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/diag-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$metrics$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/metrics-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/trace-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2d$logs$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api-logs/build/esm/index.js [instrumentation] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/shimmer.js [instrumentation] (ecmascript)");
;
;
;
class InstrumentationAbstract {
    _config = {};
    _tracer;
    _meter;
    _logger;
    _diag;
    instrumentationName;
    instrumentationVersion;
    constructor(instrumentationName, instrumentationVersion, config){
        this.instrumentationName = instrumentationName;
        this.instrumentationVersion = instrumentationVersion;
        this.setConfig(config);
        this._diag = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].createComponentLogger({
            namespace: instrumentationName
        });
        this._tracer = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["trace"].getTracer(instrumentationName, instrumentationVersion);
        this._meter = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$metrics$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["metrics"].getMeter(instrumentationName, instrumentationVersion);
        this._logger = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2d$logs$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__["logs"].getLogger(instrumentationName, instrumentationVersion);
        this._updateMetricInstruments();
    }
    /* Api to wrap instrumented method */ _wrap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["wrap"];
    /* Api to unwrap instrumented methods */ _unwrap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["unwrap"];
    /* Api to mass wrap instrumented method */ _massWrap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["massWrap"];
    /* Api to mass unwrap instrumented methods */ _massUnwrap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["massUnwrap"];
    /* Returns meter */ get meter() {
        return this._meter;
    }
    /**
     * Sets MeterProvider to this plugin
     * @param meterProvider
     */ setMeterProvider(meterProvider) {
        this._meter = meterProvider.getMeter(this.instrumentationName, this.instrumentationVersion);
        this._updateMetricInstruments();
    }
    /* Returns logger */ get logger() {
        return this._logger;
    }
    /**
     * Sets LoggerProvider to this plugin
     * @param loggerProvider
     */ setLoggerProvider(loggerProvider) {
        this._logger = loggerProvider.getLogger(this.instrumentationName, this.instrumentationVersion);
    }
    /**
     * @experimental
     *
     * Get module definitions defined by {@link init}.
     * This can be used for experimental compile-time instrumentation.
     *
     * @returns an array of {@link InstrumentationModuleDefinition}
     */ getModuleDefinitions() {
        const initResult = this.init() ?? [];
        if (!Array.isArray(initResult)) {
            return [
                initResult
            ];
        }
        return initResult;
    }
    /**
     * Sets the new metric instruments with the current Meter.
     */ _updateMetricInstruments() {
        return;
    }
    /* Returns InstrumentationConfig */ getConfig() {
        return this._config;
    }
    /**
     * Sets InstrumentationConfig to this plugin
     * @param config
     */ setConfig(config) {
        // copy config first level properties to ensure they are immutable.
        // nested properties are not copied, thus are mutable from the outside.
        this._config = {
            enabled: true,
            ...config
        };
    }
    /**
     * Sets TraceProvider to this plugin
     * @param tracerProvider
     */ setTracerProvider(tracerProvider) {
        this._tracer = tracerProvider.getTracer(this.instrumentationName, this.instrumentationVersion);
    }
    /* Returns tracer */ get tracer() {
        return this._tracer;
    }
    /**
     * Execute span customization hook, if configured, and log any errors.
     * Any semantics of the trigger and info are defined by the specific instrumentation.
     * @param hookHandler The optional hook handler which the user has configured via instrumentation config
     * @param triggerName The name of the trigger for executing the hook for logging purposes
     * @param span The span to which the hook should be applied
     * @param info The info object to be passed to the hook, with useful data the hook may use
     */ _runSpanCustomizationHook(hookHandler, triggerName, span, info) {
        if (!hookHandler) {
            return;
        }
        try {
            hookHandler(span, info);
        } catch (e) {
            this._diag.error(`Error running span customization hook due to exception in handler`, {
                triggerName
            }, e);
        }
    }
} //# sourceMappingURL=instrumentation.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/ModuleNameTrie.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 */ __turbopack_context__.s([
    "ModuleNameSeparator",
    ()=>ModuleNameSeparator,
    "ModuleNameTrie",
    ()=>ModuleNameTrie
]);
const ModuleNameSeparator = '/';
/**
 * Node in a `ModuleNameTrie`
 */ class ModuleNameTrieNode {
    hooks = [];
    children = new Map();
}
class ModuleNameTrie {
    _trie = new ModuleNameTrieNode();
    _counter = 0;
    /**
     * Insert a module hook into the trie
     *
     * @param {Hooked} hook Hook
     */ insert(hook) {
        let trieNode = this._trie;
        for (const moduleNamePart of hook.moduleName.split(ModuleNameSeparator)){
            let nextNode = trieNode.children.get(moduleNamePart);
            if (!nextNode) {
                nextNode = new ModuleNameTrieNode();
                trieNode.children.set(moduleNamePart, nextNode);
            }
            trieNode = nextNode;
        }
        trieNode.hooks.push({
            hook,
            insertedId: this._counter++
        });
    }
    /**
     * Search for matching hooks in the trie
     *
     * @param {string} moduleName Module name
     * @param {boolean} maintainInsertionOrder Whether to return the results in insertion order
     * @param {boolean} fullOnly Whether to return only full matches
     * @returns {Hooked[]} Matching hooks
     */ search(moduleName, { maintainInsertionOrder, fullOnly } = {}) {
        let trieNode = this._trie;
        const results = [];
        let foundFull = true;
        for (const moduleNamePart of moduleName.split(ModuleNameSeparator)){
            const nextNode = trieNode.children.get(moduleNamePart);
            if (!nextNode) {
                foundFull = false;
                break;
            }
            if (!fullOnly) {
                results.push(...nextNode.hooks);
            }
            trieNode = nextNode;
        }
        if (fullOnly && foundFull) {
            results.push(...trieNode.hooks);
        }
        if (results.length === 0) {
            return [];
        }
        if (results.length === 1) {
            return [
                results[0].hook
            ];
        }
        if (maintainInsertionOrder) {
            results.sort((a, b)=>a.insertedId - b.insertedId);
        }
        return results.map(({ hook })=>hook);
    }
} //# sourceMappingURL=ModuleNameTrie.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/RequireInTheMiddleSingleton.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "RequireInTheMiddleSingleton",
    ()=>RequireInTheMiddleSingleton
]);
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
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f$require$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$require$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$require$2d$in$2d$the$2d$middle$29$__ = __turbopack_context__.i("[externals]/require-in-the-middle [external] (require-in-the-middle, cjs, [project]/metacto/metacto-internal/context-stack/node_modules/require-in-the-middle)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$ModuleNameTrie$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/ModuleNameTrie.js [instrumentation] (ecmascript)");
;
;
;
/**
 * Whether Mocha is running in this process
 * Inspired by https://github.com/AndreasPizsa/detect-mocha
 *
 * @type {boolean}
 */ const isMocha = [
    'afterEach',
    'after',
    'beforeEach',
    'before',
    'describe',
    'it'
].every((fn)=>{
    // @ts-expect-error TS7053: Element implicitly has an 'any' type
    return typeof /*TURBOPACK member replacement*/ __turbopack_context__.g[fn] === 'function';
});
class RequireInTheMiddleSingleton {
    _moduleNameTrie = new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$ModuleNameTrie$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["ModuleNameTrie"]();
    static _instance;
    constructor(){
        this._initialize();
    }
    _initialize() {
        new __TURBOPACK__imported__module__$5b$externals$5d2f$require$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$require$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$require$2d$in$2d$the$2d$middle$29$__["Hook"](// Intercept all `require` calls; we will filter the matching ones below
        null, {
            internals: true
        }, (exports, name, basedir)=>{
            // For internal files on Windows, `name` will use backslash as the path separator
            const normalizedModuleName = normalizePathSeparators(name);
            const matches = this._moduleNameTrie.search(normalizedModuleName, {
                maintainInsertionOrder: true,
                // For core modules (e.g. `fs`), do not match on sub-paths (e.g. `fs/promises').
                // This matches the behavior of `require-in-the-middle`.
                // `basedir` is always `undefined` for core modules.
                fullOnly: basedir === undefined
            });
            for (const { onRequire } of matches){
                exports = onRequire(exports, name, basedir);
            }
            return exports;
        });
    }
    /**
     * Register a hook with `require-in-the-middle`
     *
     * @param {string} moduleName Module name
     * @param {OnRequireFn} onRequire Hook function
     * @returns {Hooked} Registered hook
     */ register(moduleName, onRequire) {
        const hooked = {
            moduleName,
            onRequire
        };
        this._moduleNameTrie.insert(hooked);
        return hooked;
    }
    /**
     * Get the `RequireInTheMiddleSingleton` singleton
     *
     * @returns {RequireInTheMiddleSingleton} Singleton of `RequireInTheMiddleSingleton`
     */ static getInstance() {
        // Mocha runs all test suites in the same process
        // This prevents test suites from sharing a singleton
        if (isMocha) return new RequireInTheMiddleSingleton();
        return this._instance = this._instance ?? new RequireInTheMiddleSingleton();
    }
}
/**
 * Normalize the path separators to forward slash in a module name or path
 *
 * @param {string} moduleNameOrPath Module name or path
 * @returns {string} Normalized module name or path
 */ function normalizePathSeparators(moduleNameOrPath) {
    return __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["sep"] !== __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$ModuleNameTrie$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["ModuleNameSeparator"] ? moduleNameOrPath.split(__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["sep"]).join(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$ModuleNameTrie$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["ModuleNameSeparator"]) : moduleNameOrPath;
} //# sourceMappingURL=RequireInTheMiddleSingleton.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/utils.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 * function to execute patched function and being able to catch errors
 * @param execute - function to be executed
 * @param onFinish - callback to run when execute finishes
 */ __turbopack_context__.s([
    "isWrapped",
    ()=>isWrapped,
    "safeExecuteInTheMiddle",
    ()=>safeExecuteInTheMiddle,
    "safeExecuteInTheMiddleAsync",
    ()=>safeExecuteInTheMiddleAsync
]);
function safeExecuteInTheMiddle(execute, onFinish, preventThrowingError) {
    let error;
    let result;
    try {
        result = execute();
    } catch (e) {
        error = e;
    } finally{
        onFinish(error, result);
        if (error && !preventThrowingError) {
            // eslint-disable-next-line no-unsafe-finally
            throw error;
        }
        // eslint-disable-next-line no-unsafe-finally
        return result;
    }
}
async function safeExecuteInTheMiddleAsync(execute, onFinish, preventThrowingError) {
    let error;
    let result;
    try {
        result = await execute();
    } catch (e) {
        error = e;
    } finally{
        await onFinish(error, result);
        if (error && !preventThrowingError) {
            // eslint-disable-next-line no-unsafe-finally
            throw error;
        }
        // eslint-disable-next-line no-unsafe-finally
        return result;
    }
}
function isWrapped(func) {
    return typeof func === 'function' && typeof func.__original === 'function' && typeof func.__unwrap === 'function' && func.__wrapped === true;
} //# sourceMappingURL=utils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/instrumentation.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InstrumentationBase",
    ()=>InstrumentationBase
]);
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
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$util__$5b$external$5d$__$28$util$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/util [external] (util, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semver$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/semver.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/shimmer.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentation$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/instrumentation.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$RequireInTheMiddleSingleton$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/RequireInTheMiddleSingleton.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$import$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$import$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$import$2d$in$2d$the$2d$middle$29$__ = __turbopack_context__.i("[externals]/import-in-the-middle [external] (import-in-the-middle, cjs, [project]/metacto/metacto-internal/context-stack/node_modules/import-in-the-middle)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/diag-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$require$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$require$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$require$2d$in$2d$the$2d$middle$29$__ = __turbopack_context__.i("[externals]/require-in-the-middle [external] (require-in-the-middle, cjs, [project]/metacto/metacto-internal/context-stack/node_modules/require-in-the-middle)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/fs [external] (fs, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/utils.js [instrumentation] (ecmascript)");
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
class InstrumentationBase extends __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentation$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["InstrumentationAbstract"] {
    _modules;
    _hooks = [];
    _requireInTheMiddleSingleton = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$RequireInTheMiddleSingleton$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["RequireInTheMiddleSingleton"].getInstance();
    _enabled = false;
    constructor(instrumentationName, instrumentationVersion, config){
        super(instrumentationName, instrumentationVersion, config);
        let modules = this.init();
        if (modules && !Array.isArray(modules)) {
            modules = [
                modules
            ];
        }
        this._modules = modules || [];
        if (this._config.enabled) {
            this.enable();
        }
    }
    _wrap = (moduleExports, name, wrapper)=>{
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["isWrapped"])(moduleExports[name])) {
            this._unwrap(moduleExports, name);
        }
        if (!__TURBOPACK__imported__module__$5b$externals$5d2f$util__$5b$external$5d$__$28$util$2c$__cjs$29$__["types"].isProxy(moduleExports)) {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["wrap"])(moduleExports, name, wrapper);
        } else {
            const wrapped = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["wrap"])(Object.assign({}, moduleExports), name, wrapper);
            Object.defineProperty(moduleExports, name, {
                value: wrapped
            });
            return wrapped;
        }
    };
    _unwrap = (moduleExports, name)=>{
        if (!__TURBOPACK__imported__module__$5b$externals$5d2f$util__$5b$external$5d$__$28$util$2c$__cjs$29$__["types"].isProxy(moduleExports)) {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["unwrap"])(moduleExports, name);
        } else {
            return Object.defineProperty(moduleExports, name, {
                value: moduleExports[name]
            });
        }
    };
    _massWrap = (moduleExportsArray, names, wrapper)=>{
        if (!moduleExportsArray) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error('must provide one or more modules to patch');
            return;
        } else if (!Array.isArray(moduleExportsArray)) {
            moduleExportsArray = [
                moduleExportsArray
            ];
        }
        if (!(names && Array.isArray(names))) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error('must provide one or more functions to wrap on modules');
            return;
        }
        moduleExportsArray.forEach((moduleExports)=>{
            names.forEach((name)=>{
                this._wrap(moduleExports, name, wrapper);
            });
        });
    };
    _massUnwrap = (moduleExportsArray, names)=>{
        if (!moduleExportsArray) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error('must provide one or more modules to patch');
            return;
        } else if (!Array.isArray(moduleExportsArray)) {
            moduleExportsArray = [
                moduleExportsArray
            ];
        }
        if (!(names && Array.isArray(names))) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error('must provide one or more functions to wrap on modules');
            return;
        }
        moduleExportsArray.forEach((moduleExports)=>{
            names.forEach((name)=>{
                this._unwrap(moduleExports, name);
            });
        });
    };
    _warnOnPreloadedModules() {
        this._modules.forEach((module)=>{
            const { name } = module;
            try {
                const resolvedModule = (()=>{
                    const e = new Error("Cannot find module as expression is too dynamic");
                    e.code = 'MODULE_NOT_FOUND';
                    throw e;
                })();
                if (__turbopack_context__.c[resolvedModule]) {
                    // Module is already cached, which means the instrumentation hook might not work
                    this._diag.warn(`Module ${name} has been loaded before ${this.instrumentationName} so it might not work, please initialize it before requiring ${name}`);
                }
            } catch  {
            // Module isn't available, we can simply skip
            }
        });
    }
    _extractPackageVersion(baseDir) {
        try {
            const json = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["readFileSync"])(__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"](baseDir, 'package.json'), {
                encoding: 'utf8'
            });
            const version = JSON.parse(json).version;
            return typeof version === 'string' ? version : undefined;
        } catch  {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].warn('Failed extracting version', baseDir);
        }
        return undefined;
    }
    _onRequire(module, exports, name, baseDir) {
        if (!baseDir) {
            if (typeof module.patch === 'function') {
                module.moduleExports = exports;
                if (this._enabled) {
                    this._diag.debug('Applying instrumentation patch for nodejs core module on require hook', {
                        module: module.name
                    });
                    return module.patch(exports);
                }
            }
            return exports;
        }
        const version = this._extractPackageVersion(baseDir);
        module.moduleVersion = version;
        if (module.name === name) {
            // main module
            if (isSupported(module.supportedVersions, version, module.includePrerelease)) {
                if (typeof module.patch === 'function') {
                    module.moduleExports = exports;
                    if (this._enabled) {
                        this._diag.debug('Applying instrumentation patch for module on require hook', {
                            module: module.name,
                            version: module.moduleVersion,
                            baseDir
                        });
                        return module.patch(exports, module.moduleVersion);
                    }
                }
            }
            return exports;
        }
        // internal file
        const files = module.files ?? [];
        const normalizedName = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["normalize"](name);
        const supportedFileInstrumentations = files.filter((f)=>f.name === normalizedName && isSupported(f.supportedVersions, version, module.includePrerelease));
        return supportedFileInstrumentations.reduce((patchedExports, file)=>{
            file.moduleExports = patchedExports;
            if (this._enabled) {
                this._diag.debug('Applying instrumentation patch for nodejs module file on require hook', {
                    module: module.name,
                    version: module.moduleVersion,
                    fileName: file.name,
                    baseDir
                });
                // patch signature is not typed, so we cast it assuming it's correct
                return file.patch(patchedExports, module.moduleVersion);
            }
            return patchedExports;
        }, exports);
    }
    enable() {
        if (this._enabled) {
            return;
        }
        this._enabled = true;
        // already hooked, just call patch again
        if (this._hooks.length > 0) {
            for (const module of this._modules){
                if (typeof module.patch === 'function' && module.moduleExports) {
                    this._diag.debug('Applying instrumentation patch for nodejs module on instrumentation enabled', {
                        module: module.name,
                        version: module.moduleVersion
                    });
                    module.patch(module.moduleExports, module.moduleVersion);
                }
                for (const file of module.files){
                    if (file.moduleExports) {
                        this._diag.debug('Applying instrumentation patch for nodejs module file on instrumentation enabled', {
                            module: module.name,
                            version: module.moduleVersion,
                            fileName: file.name
                        });
                        file.patch(file.moduleExports, module.moduleVersion);
                    }
                }
            }
            return;
        }
        this._warnOnPreloadedModules();
        for (const module of this._modules){
            const hookFn = (exports, name, baseDir)=>{
                if (!baseDir && __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["isAbsolute"](name)) {
                    const parsedPath = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["parse"](name);
                    name = parsedPath.name;
                    baseDir = parsedPath.dir;
                }
                return this._onRequire(module, exports, name, baseDir);
            };
            const onRequire = (exports, name, baseDir)=>{
                return this._onRequire(module, exports, name, baseDir);
            };
            // `RequireInTheMiddleSingleton` does not support absolute paths.
            // For an absolute paths, we must create a separate instance of the
            // require-in-the-middle `Hook`.
            const hook = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["isAbsolute"](module.name) ? new __TURBOPACK__imported__module__$5b$externals$5d2f$require$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$require$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$require$2d$in$2d$the$2d$middle$29$__["Hook"]([
                module.name
            ], {
                internals: true
            }, onRequire) : this._requireInTheMiddleSingleton.register(module.name, onRequire);
            this._hooks.push(hook);
            const esmHook = new __TURBOPACK__imported__module__$5b$externals$5d2f$import$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$import$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$import$2d$in$2d$the$2d$middle$29$__["Hook"]([
                module.name
            ], {
                internals: false
            }, hookFn);
            this._hooks.push(esmHook);
        }
    }
    disable() {
        if (!this._enabled) {
            return;
        }
        this._enabled = false;
        for (const module of this._modules){
            if (typeof module.unpatch === 'function' && module.moduleExports) {
                this._diag.debug('Removing instrumentation patch for nodejs module on instrumentation disabled', {
                    module: module.name,
                    version: module.moduleVersion
                });
                module.unpatch(module.moduleExports, module.moduleVersion);
            }
            for (const file of module.files){
                if (file.moduleExports) {
                    this._diag.debug('Removing instrumentation patch for nodejs module file on instrumentation disabled', {
                        module: module.name,
                        version: module.moduleVersion,
                        fileName: file.name
                    });
                    file.unpatch(file.moduleExports, module.moduleVersion);
                }
            }
        }
    }
    isEnabled() {
        return this._enabled;
    }
}
function isSupported(supportedVersions, version, includePrerelease) {
    if (typeof version === 'undefined') {
        // If we don't have the version, accept the wildcard case only
        return supportedVersions.includes('*');
    }
    return supportedVersions.some((supportedVersion)=>{
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semver$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["satisfies"])(version, supportedVersion, {
            includePrerelease
        });
    });
} //# sourceMappingURL=instrumentation.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/instrumentationNodeModuleDefinition.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 */ __turbopack_context__.s([
    "InstrumentationNodeModuleDefinition",
    ()=>InstrumentationNodeModuleDefinition
]);
class InstrumentationNodeModuleDefinition {
    files;
    name;
    supportedVersions;
    patch;
    unpatch;
    constructor(name, supportedVersions, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patch, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unpatch, files){
        this.files = files || [];
        this.name = name;
        this.supportedVersions = supportedVersions;
        this.patch = patch;
        this.unpatch = unpatch;
    }
} //# sourceMappingURL=instrumentationNodeModuleDefinition.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/instrumentationNodeModuleFile.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InstrumentationNodeModuleFile",
    ()=>InstrumentationNodeModuleFile
]);
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
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
;
class InstrumentationNodeModuleFile {
    name;
    supportedVersions;
    patch;
    unpatch;
    constructor(name, supportedVersions, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patch, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unpatch){
        this.name = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["normalize"])(name);
        this.supportedVersions = supportedVersions;
        this.patch = patch;
        this.unpatch = unpatch;
    }
} //# sourceMappingURL=instrumentationNodeModuleFile.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/semconvStability.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 */ __turbopack_context__.s([
    "SemconvStability",
    ()=>SemconvStability,
    "semconvStabilityFromStr",
    ()=>semconvStabilityFromStr
]);
var SemconvStability;
(function(SemconvStability) {
    /** Emit only stable semantic conventions. */ SemconvStability[SemconvStability["STABLE"] = 1] = "STABLE";
    /** Emit only old semantic conventions. */ SemconvStability[SemconvStability["OLD"] = 2] = "OLD";
    /** Emit both stable and old semantic conventions. */ SemconvStability[SemconvStability["DUPLICATE"] = 3] = "DUPLICATE";
})(SemconvStability || (SemconvStability = {}));
function semconvStabilityFromStr(namespace, str) {
    let semconvStability = SemconvStability.OLD;
    // The same parsing of `str` as `getStringListFromEnv` from the core pkg.
    const entries = str?.split(',').map((v)=>v.trim()).filter((s)=>s !== '');
    for (const entry of entries ?? []){
        if (entry.toLowerCase() === namespace + '/dup') {
            // DUPLICATE takes highest precedence.
            semconvStability = SemconvStability.DUPLICATE;
            break;
        } else if (entry.toLowerCase() === namespace) {
            semconvStability = SemconvStability.STABLE;
        }
    }
    return semconvStability;
} //# sourceMappingURL=semconvStability.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InstrumentationBase",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$instrumentation$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["InstrumentationBase"],
    "InstrumentationNodeModuleDefinition",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentationNodeModuleDefinition$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["InstrumentationNodeModuleDefinition"],
    "InstrumentationNodeModuleFile",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentationNodeModuleFile$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["InstrumentationNodeModuleFile"],
    "SemconvStability",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semconvStability$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["SemconvStability"],
    "isWrapped",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["isWrapped"],
    "registerInstrumentations",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoader$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["registerInstrumentations"],
    "safeExecuteInTheMiddle",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["safeExecuteInTheMiddle"],
    "safeExecuteInTheMiddleAsync",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["safeExecuteInTheMiddleAsync"],
    "semconvStabilityFromStr",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semconvStability$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["semconvStabilityFromStr"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoader$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/autoLoader.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$instrumentation$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/instrumentation.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentationNodeModuleDefinition$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/instrumentationNodeModuleDefinition.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentationNodeModuleFile$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/instrumentationNodeModuleFile.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/utils.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semconvStability$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/semconvStability.js [instrumentation] (ecmascript)");
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

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
 */ __turbopack_context__.s([]);
;
;
;
;
;
;
 //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/autoLoaderUtils.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 * Enable instrumentations
 * @param instrumentations
 * @param tracerProvider
 * @param meterProvider
 */ __turbopack_context__.s([
    "disableInstrumentations",
    ()=>disableInstrumentations,
    "enableInstrumentations",
    ()=>enableInstrumentations
]);
function enableInstrumentations(instrumentations, tracerProvider, meterProvider, loggerProvider) {
    for(let i = 0, j = instrumentations.length; i < j; i++){
        const instrumentation = instrumentations[i];
        if (tracerProvider) {
            instrumentation.setTracerProvider(tracerProvider);
        }
        if (meterProvider) {
            instrumentation.setMeterProvider(meterProvider);
        }
        if (loggerProvider && instrumentation.setLoggerProvider) {
            instrumentation.setLoggerProvider(loggerProvider);
        }
        // instrumentations have been already enabled during creation
        // so enable only if user prevented that by setting enabled to false
        // this is to prevent double enabling but when calling register all
        // instrumentations should be now enabled
        if (!instrumentation.getConfig().enabled) {
            instrumentation.enable();
        }
    }
}
function disableInstrumentations(instrumentations) {
    instrumentations.forEach((instrumentation)=>instrumentation.disable());
} //# sourceMappingURL=autoLoaderUtils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/autoLoader.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "registerInstrumentations",
    ()=>registerInstrumentations
]);
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
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/trace-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$metrics$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/metrics-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$api$2d$logs$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/api-logs/build/esm/index.js [instrumentation] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoaderUtils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/autoLoaderUtils.js [instrumentation] (ecmascript)");
;
;
;
function registerInstrumentations(options) {
    const tracerProvider = options.tracerProvider || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["trace"].getTracerProvider();
    const meterProvider = options.meterProvider || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$metrics$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["metrics"].getMeterProvider();
    const loggerProvider = options.loggerProvider || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$api$2d$logs$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__["logs"].getLoggerProvider();
    const instrumentations = options.instrumentations?.flat() ?? [];
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoaderUtils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["enableInstrumentations"])(instrumentations, tracerProvider, meterProvider, loggerProvider);
    return ()=>{
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoaderUtils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["disableInstrumentations"])(instrumentations);
    };
} //# sourceMappingURL=autoLoader.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/semver.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "satisfies",
    ()=>satisfies
]);
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
 */ // This is a custom semantic versioning implementation compatible with the
// `satisfies(version, range, options?)` function from the `semver` npm package;
// with the exception that the `loose` option is not supported.
//
// The motivation for the custom semver implementation is that
// `semver` package has some initialization delay (lots of RegExp init and compile)
// and this leads to coldstart overhead for the OTEL Lambda Node.js layer.
// Hence, we have implemented lightweight version of it internally with required functionalities.
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/diag-api.js [instrumentation] (ecmascript)");
;
const VERSION_REGEXP = /^(?:v)?(?<version>(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*))(?:-(?<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?<build>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const RANGE_REGEXP = /^(?<op><|>|=|==|<=|>=|~|\^|~>)?\s*(?:v)?(?<version>(?<major>x|X|\*|0|[1-9]\d*)(?:\.(?<minor>x|X|\*|0|[1-9]\d*))?(?:\.(?<patch>x|X|\*|0|[1-9]\d*))?)(?:-(?<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?<build>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const operatorResMap = {
    '>': [
        1
    ],
    '>=': [
        0,
        1
    ],
    '=': [
        0
    ],
    '<=': [
        -1,
        0
    ],
    '<': [
        -1
    ],
    '!=': [
        -1,
        1
    ]
};
function satisfies(version, range, options) {
    // Strict semver format check
    if (!_validateVersion(version)) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error(`Invalid version: ${version}`);
        return false;
    }
    // If range is empty, satisfy check succeeds regardless what version is
    if (!range) {
        return true;
    }
    // Cleanup range
    range = range.replace(/([<>=~^]+)\s+/g, '$1');
    // Parse version
    const parsedVersion = _parseVersion(version);
    if (!parsedVersion) {
        return false;
    }
    const allParsedRanges = [];
    // Check given version whether it satisfies given range expression
    const checkResult = _doSatisfies(parsedVersion, range, allParsedRanges, options);
    // If check result is OK,
    // do another final check for pre-release, if pre-release check is included by option
    if (checkResult && !options?.includePrerelease) {
        return _doPreleaseCheck(parsedVersion, allParsedRanges);
    }
    return checkResult;
}
function _validateVersion(version) {
    return typeof version === 'string' && VERSION_REGEXP.test(version);
}
function _doSatisfies(parsedVersion, range, allParsedRanges, options) {
    if (range.includes('||')) {
        // A version matches a range if and only if
        // every comparator in at least one of the ||-separated comparator sets is satisfied by the version
        const ranges = range.trim().split('||');
        for (const r of ranges){
            if (_checkRange(parsedVersion, r, allParsedRanges, options)) {
                return true;
            }
        }
        return false;
    } else if (range.includes(' - ')) {
        // Hyphen ranges: https://github.com/npm/node-semver#hyphen-ranges-xyz---abc
        range = replaceHyphen(range, options);
    } else if (range.includes(' ')) {
        // Multiple separated ranges and all needs to be satisfied for success
        const ranges = range.trim().replace(/\s{2,}/g, ' ').split(' ');
        for (const r of ranges){
            if (!_checkRange(parsedVersion, r, allParsedRanges, options)) {
                return false;
            }
        }
        return true;
    }
    // Check given parsed version with given range
    return _checkRange(parsedVersion, range, allParsedRanges, options);
}
function _checkRange(parsedVersion, range, allParsedRanges, options) {
    range = _normalizeRange(range, options);
    if (range.includes(' ')) {
        // If there are multiple ranges separated, satisfy each of them
        return _doSatisfies(parsedVersion, range, allParsedRanges, options);
    } else {
        // Validate and parse range
        const parsedRange = _parseRange(range);
        allParsedRanges.push(parsedRange);
        // Check parsed version by parsed range
        return _satisfies(parsedVersion, parsedRange);
    }
}
function _satisfies(parsedVersion, parsedRange) {
    // If range is invalid, satisfy check fails (no error throw)
    if (parsedRange.invalid) {
        return false;
    }
    // If range is empty or wildcard, satisfy check succeeds regardless what version is
    if (!parsedRange.version || _isWildcard(parsedRange.version)) {
        return true;
    }
    // Compare version segment first
    let comparisonResult = _compareVersionSegments(parsedVersion.versionSegments || [], parsedRange.versionSegments || []);
    // If versions segments are equal, compare by pre-release segments
    if (comparisonResult === 0) {
        const versionPrereleaseSegments = parsedVersion.prereleaseSegments || [];
        const rangePrereleaseSegments = parsedRange.prereleaseSegments || [];
        if (!versionPrereleaseSegments.length && !rangePrereleaseSegments.length) {
            comparisonResult = 0;
        } else if (!versionPrereleaseSegments.length && rangePrereleaseSegments.length) {
            comparisonResult = 1;
        } else if (versionPrereleaseSegments.length && !rangePrereleaseSegments.length) {
            comparisonResult = -1;
        } else {
            comparisonResult = _compareVersionSegments(versionPrereleaseSegments, rangePrereleaseSegments);
        }
    }
    // Resolve check result according to comparison operator
    return operatorResMap[parsedRange.op]?.includes(comparisonResult);
}
function _doPreleaseCheck(parsedVersion, allParsedRanges) {
    if (parsedVersion.prerelease) {
        return allParsedRanges.some((r)=>r.prerelease && r.version === parsedVersion.version);
    }
    return true;
}
function _normalizeRange(range, options) {
    range = range.trim();
    range = replaceCaret(range, options);
    range = replaceTilde(range);
    range = replaceXRange(range, options);
    range = range.trim();
    return range;
}
function isX(id) {
    return !id || id.toLowerCase() === 'x' || id === '*';
}
function _parseVersion(versionString) {
    const match = versionString.match(VERSION_REGEXP);
    if (!match) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error(`Invalid version: ${versionString}`);
        return undefined;
    }
    const version = match.groups.version;
    const prerelease = match.groups.prerelease;
    const build = match.groups.build;
    const versionSegments = version.split('.');
    const prereleaseSegments = prerelease?.split('.');
    return {
        op: undefined,
        version,
        versionSegments,
        versionSegmentCount: versionSegments.length,
        prerelease,
        prereleaseSegments,
        prereleaseSegmentCount: prereleaseSegments ? prereleaseSegments.length : 0,
        build
    };
}
function _parseRange(rangeString) {
    if (!rangeString) {
        return {};
    }
    const match = rangeString.match(RANGE_REGEXP);
    if (!match) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error(`Invalid range: ${rangeString}`);
        return {
            invalid: true
        };
    }
    let op = match.groups.op;
    const version = match.groups.version;
    const prerelease = match.groups.prerelease;
    const build = match.groups.build;
    const versionSegments = version.split('.');
    const prereleaseSegments = prerelease?.split('.');
    if (op === '==') {
        op = '=';
    }
    return {
        op: op || '=',
        version,
        versionSegments,
        versionSegmentCount: versionSegments.length,
        prerelease,
        prereleaseSegments,
        prereleaseSegmentCount: prereleaseSegments ? prereleaseSegments.length : 0,
        build
    };
}
function _isWildcard(s) {
    return s === '*' || s === 'x' || s === 'X';
}
function _parseVersionString(v) {
    const n = parseInt(v, 10);
    return isNaN(n) ? v : n;
}
function _normalizeVersionType(a, b) {
    if (typeof a === typeof b) {
        if (typeof a === 'number') {
            return [
                a,
                b
            ];
        } else if (typeof a === 'string') {
            return [
                a,
                b
            ];
        } else {
            throw new Error('Version segments can only be strings or numbers');
        }
    } else {
        return [
            String(a),
            String(b)
        ];
    }
}
function _compareVersionStrings(v1, v2) {
    if (_isWildcard(v1) || _isWildcard(v2)) {
        return 0;
    }
    const [parsedV1, parsedV2] = _normalizeVersionType(_parseVersionString(v1), _parseVersionString(v2));
    if (parsedV1 > parsedV2) {
        return 1;
    } else if (parsedV1 < parsedV2) {
        return -1;
    }
    return 0;
}
function _compareVersionSegments(v1, v2) {
    for(let i = 0; i < Math.max(v1.length, v2.length); i++){
        const res = _compareVersionStrings(v1[i] || '0', v2[i] || '0');
        if (res !== 0) {
            return res;
        }
    }
    return 0;
}
////////////////////////////////////////////////////////////////////////////////
// The rest of this file is adapted from portions of https://github.com/npm/node-semver/tree/868d4bb
// License:
/*
 * The ISC License
 *
 * Copyright (c) Isaac Z. Schlueter and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
 * IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */ const LETTERDASHNUMBER = '[a-zA-Z0-9-]';
const NUMERICIDENTIFIER = '0|[1-9]\\d*';
const NONNUMERICIDENTIFIER = `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`;
const GTLT = '((?:<|>)?=?)';
const PRERELEASEIDENTIFIER = `(?:${NUMERICIDENTIFIER}|${NONNUMERICIDENTIFIER})`;
const PRERELEASE = `(?:-(${PRERELEASEIDENTIFIER}(?:\\.${PRERELEASEIDENTIFIER})*))`;
const BUILDIDENTIFIER = `${LETTERDASHNUMBER}+`;
const BUILD = `(?:\\+(${BUILDIDENTIFIER}(?:\\.${BUILDIDENTIFIER})*))`;
const XRANGEIDENTIFIER = `${NUMERICIDENTIFIER}|x|X|\\*`;
const XRANGEPLAIN = `[v=\\s]*(${XRANGEIDENTIFIER})` + `(?:\\.(${XRANGEIDENTIFIER})` + `(?:\\.(${XRANGEIDENTIFIER})` + `(?:${PRERELEASE})?${BUILD}?` + `)?)?`;
const XRANGE = `^${GTLT}\\s*${XRANGEPLAIN}$`;
const XRANGE_REGEXP = new RegExp(XRANGE);
const HYPHENRANGE = `^\\s*(${XRANGEPLAIN})` + `\\s+-\\s+` + `(${XRANGEPLAIN})` + `\\s*$`;
const HYPHENRANGE_REGEXP = new RegExp(HYPHENRANGE);
const LONETILDE = '(?:~>?)';
const TILDE = `^${LONETILDE}${XRANGEPLAIN}$`;
const TILDE_REGEXP = new RegExp(TILDE);
const LONECARET = '(?:\\^)';
const CARET = `^${LONECARET}${XRANGEPLAIN}$`;
const CARET_REGEXP = new RegExp(CARET);
// Borrowed from https://github.com/npm/node-semver/blob/868d4bbe3d318c52544f38d5f9977a1103e924c2/classes/range.js#L285
//
// ~, ~> --> * (any, kinda silly)
// ~2, ~2.x, ~2.x.x, ~>2, ~>2.x ~>2.x.x --> >=2.0.0 <3.0.0-0
// ~2.0, ~2.0.x, ~>2.0, ~>2.0.x --> >=2.0.0 <2.1.0-0
// ~1.2, ~1.2.x, ~>1.2, ~>1.2.x --> >=1.2.0 <1.3.0-0
// ~1.2.3, ~>1.2.3 --> >=1.2.3 <1.3.0-0
// ~1.2.0, ~>1.2.0 --> >=1.2.0 <1.3.0-0
// ~0.0.1 --> >=0.0.1 <0.1.0-0
function replaceTilde(comp) {
    const r = TILDE_REGEXP;
    return comp.replace(r, (_, M, m, p, pr)=>{
        let ret;
        if (isX(M)) {
            ret = '';
        } else if (isX(m)) {
            ret = `>=${M}.0.0 <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
            // ~1.2 == >=1.2.0 <1.3.0-0
            ret = `>=${M}.${m}.0 <${M}.${+m + 1}.0-0`;
        } else if (pr) {
            ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
        } else {
            // ~1.2.3 == >=1.2.3 <1.3.0-0
            ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
        }
        return ret;
    });
}
// Borrowed from https://github.com/npm/node-semver/blob/868d4bbe3d318c52544f38d5f9977a1103e924c2/classes/range.js#L329
//
// ^ --> * (any, kinda silly)
// ^2, ^2.x, ^2.x.x --> >=2.0.0 <3.0.0-0
// ^2.0, ^2.0.x --> >=2.0.0 <3.0.0-0
// ^1.2, ^1.2.x --> >=1.2.0 <2.0.0-0
// ^1.2.3 --> >=1.2.3 <2.0.0-0
// ^1.2.0 --> >=1.2.0 <2.0.0-0
// ^0.0.1 --> >=0.0.1 <0.0.2-0
// ^0.1.0 --> >=0.1.0 <0.2.0-0
function replaceCaret(comp, options) {
    const r = CARET_REGEXP;
    const z = options?.includePrerelease ? '-0' : '';
    return comp.replace(r, (_, M, m, p, pr)=>{
        let ret;
        if (isX(M)) {
            ret = '';
        } else if (isX(m)) {
            ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
            if (M === '0') {
                ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
            } else {
                ret = `>=${M}.${m}.0${z} <${+M + 1}.0.0-0`;
            }
        } else if (pr) {
            if (M === '0') {
                if (m === '0') {
                    ret = `>=${M}.${m}.${p}-${pr} <${M}.${m}.${+p + 1}-0`;
                } else {
                    ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
                }
            } else {
                ret = `>=${M}.${m}.${p}-${pr} <${+M + 1}.0.0-0`;
            }
        } else {
            if (M === '0') {
                if (m === '0') {
                    ret = `>=${M}.${m}.${p}${z} <${M}.${m}.${+p + 1}-0`;
                } else {
                    ret = `>=${M}.${m}.${p}${z} <${M}.${+m + 1}.0-0`;
                }
            } else {
                ret = `>=${M}.${m}.${p} <${+M + 1}.0.0-0`;
            }
        }
        return ret;
    });
}
// Borrowed from https://github.com/npm/node-semver/blob/868d4bbe3d318c52544f38d5f9977a1103e924c2/classes/range.js#L390
function replaceXRange(comp, options) {
    const r = XRANGE_REGEXP;
    return comp.replace(r, (ret, gtlt, M, m, p, pr)=>{
        const xM = isX(M);
        const xm = xM || isX(m);
        const xp = xm || isX(p);
        const anyX = xp;
        if (gtlt === '=' && anyX) {
            gtlt = '';
        }
        // if we're including prereleases in the match, then we need
        // to fix this to -0, the lowest possible prerelease value
        pr = options?.includePrerelease ? '-0' : '';
        if (xM) {
            if (gtlt === '>' || gtlt === '<') {
                // nothing is allowed
                ret = '<0.0.0-0';
            } else {
                // nothing is forbidden
                ret = '*';
            }
        } else if (gtlt && anyX) {
            // we know patch is an x, because we have any x at all.
            // replace X with 0
            if (xm) {
                m = 0;
            }
            p = 0;
            if (gtlt === '>') {
                // >1 => >=2.0.0
                // >1.2 => >=1.3.0
                gtlt = '>=';
                if (xm) {
                    M = +M + 1;
                    m = 0;
                    p = 0;
                } else {
                    m = +m + 1;
                    p = 0;
                }
            } else if (gtlt === '<=') {
                // <=0.7.x is actually <0.8.0, since any 0.7.x should
                // pass.  Similarly, <=7.x is actually <8.0.0, etc.
                gtlt = '<';
                if (xm) {
                    M = +M + 1;
                } else {
                    m = +m + 1;
                }
            }
            if (gtlt === '<') {
                pr = '-0';
            }
            ret = `${gtlt + M}.${m}.${p}${pr}`;
        } else if (xm) {
            ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
        } else if (xp) {
            ret = `>=${M}.${m}.0${pr} <${M}.${+m + 1}.0-0`;
        }
        return ret;
    });
}
// Borrowed from https://github.com/npm/node-semver/blob/868d4bbe3d318c52544f38d5f9977a1103e924c2/classes/range.js#L488
//
// 1.2 - 3.4.5 => >=1.2.0 <=3.4.5
// 1.2.3 - 3.4 => >=1.2.0 <3.5.0-0 Any 3.4.x will do
// 1.2 - 3.4 => >=1.2.0 <3.5.0-0
function replaceHyphen(comp, options) {
    const r = HYPHENRANGE_REGEXP;
    return comp.replace(r, (_, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr)=>{
        if (isX(fM)) {
            from = '';
        } else if (isX(fm)) {
            from = `>=${fM}.0.0${options?.includePrerelease ? '-0' : ''}`;
        } else if (isX(fp)) {
            from = `>=${fM}.${fm}.0${options?.includePrerelease ? '-0' : ''}`;
        } else if (fpr) {
            from = `>=${from}`;
        } else {
            from = `>=${from}${options?.includePrerelease ? '-0' : ''}`;
        }
        if (isX(tM)) {
            to = '';
        } else if (isX(tm)) {
            to = `<${+tM + 1}.0.0-0`;
        } else if (isX(tp)) {
            to = `<${tM}.${+tm + 1}.0-0`;
        } else if (tpr) {
            to = `<=${tM}.${tm}.${tp}-${tpr}`;
        } else if (options?.includePrerelease) {
            to = `<${tM}.${tm}.${+tp + 1}-0`;
        } else {
            to = `<=${to}`;
        }
        return `${from} ${to}`.trim();
    });
} //# sourceMappingURL=semver.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/shimmer.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>shimmer,
    "massUnwrap",
    ()=>massUnwrap,
    "massWrap",
    ()=>massWrap,
    "unwrap",
    ()=>unwrap,
    "wrap",
    ()=>wrap
]);
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
 */ // Default to complaining loudly when things don't go according to plan.
// eslint-disable-next-line no-console
let logger = console.error.bind(console);
// Sets a property on an object, preserving its enumerability.
// This function assumes that the property is already writable.
function defineProperty(obj, name, value) {
    const enumerable = !!obj[name] && Object.prototype.propertyIsEnumerable.call(obj, name);
    Object.defineProperty(obj, name, {
        configurable: true,
        enumerable,
        writable: true,
        value
    });
}
const wrap = (nodule, name, wrapper)=>{
    if (!nodule || !nodule[name]) {
        logger('no original function ' + String(name) + ' to wrap');
        return;
    }
    if (!wrapper) {
        logger('no wrapper function');
        logger(new Error().stack);
        return;
    }
    const original = nodule[name];
    if (typeof original !== 'function' || typeof wrapper !== 'function') {
        logger('original object and wrapper must be functions');
        return;
    }
    const wrapped = wrapper(original, name);
    defineProperty(wrapped, '__original', original);
    defineProperty(wrapped, '__unwrap', ()=>{
        if (nodule[name] === wrapped) {
            defineProperty(nodule, name, original);
        }
    });
    defineProperty(wrapped, '__wrapped', true);
    defineProperty(nodule, name, wrapped);
    return wrapped;
};
const massWrap = (nodules, names, wrapper)=>{
    if (!nodules) {
        logger('must provide one or more modules to patch');
        logger(new Error().stack);
        return;
    } else if (!Array.isArray(nodules)) {
        nodules = [
            nodules
        ];
    }
    if (!(names && Array.isArray(names))) {
        logger('must provide one or more functions to wrap on modules');
        return;
    }
    nodules.forEach((nodule)=>{
        names.forEach((name)=>{
            wrap(nodule, name, wrapper);
        });
    });
};
const unwrap = (nodule, name)=>{
    if (!nodule || !nodule[name]) {
        logger('no function to unwrap.');
        logger(new Error().stack);
        return;
    }
    const wrapped = nodule[name];
    if (!wrapped.__unwrap) {
        logger('no original to unwrap to -- has ' + String(name) + ' already been unwrapped?');
    } else {
        wrapped.__unwrap();
        return;
    }
};
const massUnwrap = (nodules, names)=>{
    if (!nodules) {
        logger('must provide one or more modules to patch');
        logger(new Error().stack);
        return;
    } else if (!Array.isArray(nodules)) {
        nodules = [
            nodules
        ];
    }
    if (!(names && Array.isArray(names))) {
        logger('must provide one or more functions to unwrap on modules');
        return;
    }
    nodules.forEach((nodule)=>{
        names.forEach((name)=>{
            unwrap(nodule, name);
        });
    });
};
function shimmer(options) {
    if (options && options.logger) {
        if (typeof options.logger !== 'function') {
            logger("new logger isn't a function, not replacing");
        } else {
            logger = options.logger;
        }
    }
}
shimmer.wrap = wrap;
shimmer.massWrap = massWrap;
shimmer.unwrap = unwrap;
shimmer.massUnwrap = massUnwrap; //# sourceMappingURL=shimmer.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/instrumentation.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InstrumentationAbstract",
    ()=>InstrumentationAbstract
]);
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
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/diag-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$metrics$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/metrics-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/trace-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$api$2d$logs$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/api-logs/build/esm/index.js [instrumentation] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/shimmer.js [instrumentation] (ecmascript)");
;
;
;
class InstrumentationAbstract {
    instrumentationName;
    instrumentationVersion;
    _config = {};
    _tracer;
    _meter;
    _logger;
    _diag;
    constructor(instrumentationName, instrumentationVersion, config){
        this.instrumentationName = instrumentationName;
        this.instrumentationVersion = instrumentationVersion;
        this.setConfig(config);
        this._diag = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].createComponentLogger({
            namespace: instrumentationName
        });
        this._tracer = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["trace"].getTracer(instrumentationName, instrumentationVersion);
        this._meter = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$metrics$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["metrics"].getMeter(instrumentationName, instrumentationVersion);
        this._logger = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$api$2d$logs$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__["logs"].getLogger(instrumentationName, instrumentationVersion);
        this._updateMetricInstruments();
    }
    /* Api to wrap instrumented method */ _wrap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["wrap"];
    /* Api to unwrap instrumented methods */ _unwrap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["unwrap"];
    /* Api to mass wrap instrumented method */ _massWrap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["massWrap"];
    /* Api to mass unwrap instrumented methods */ _massUnwrap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["massUnwrap"];
    /* Returns meter */ get meter() {
        return this._meter;
    }
    /**
     * Sets MeterProvider to this plugin
     * @param meterProvider
     */ setMeterProvider(meterProvider) {
        this._meter = meterProvider.getMeter(this.instrumentationName, this.instrumentationVersion);
        this._updateMetricInstruments();
    }
    /* Returns logger */ get logger() {
        return this._logger;
    }
    /**
     * Sets LoggerProvider to this plugin
     * @param loggerProvider
     */ setLoggerProvider(loggerProvider) {
        this._logger = loggerProvider.getLogger(this.instrumentationName, this.instrumentationVersion);
    }
    /**
     * @experimental
     *
     * Get module definitions defined by {@link init}.
     * This can be used for experimental compile-time instrumentation.
     *
     * @returns an array of {@link InstrumentationModuleDefinition}
     */ getModuleDefinitions() {
        const initResult = this.init() ?? [];
        if (!Array.isArray(initResult)) {
            return [
                initResult
            ];
        }
        return initResult;
    }
    /**
     * Sets the new metric instruments with the current Meter.
     */ _updateMetricInstruments() {
        return;
    }
    /* Returns InstrumentationConfig */ getConfig() {
        return this._config;
    }
    /**
     * Sets InstrumentationConfig to this plugin
     * @param config
     */ setConfig(config) {
        // copy config first level properties to ensure they are immutable.
        // nested properties are not copied, thus are mutable from the outside.
        this._config = {
            enabled: true,
            ...config
        };
    }
    /**
     * Sets TraceProvider to this plugin
     * @param tracerProvider
     */ setTracerProvider(tracerProvider) {
        this._tracer = tracerProvider.getTracer(this.instrumentationName, this.instrumentationVersion);
    }
    /* Returns tracer */ get tracer() {
        return this._tracer;
    }
    /**
     * Execute span customization hook, if configured, and log any errors.
     * Any semantics of the trigger and info are defined by the specific instrumentation.
     * @param hookHandler The optional hook handler which the user has configured via instrumentation config
     * @param triggerName The name of the trigger for executing the hook for logging purposes
     * @param span The span to which the hook should be applied
     * @param info The info object to be passed to the hook, with useful data the hook may use
     */ _runSpanCustomizationHook(hookHandler, triggerName, span, info) {
        if (!hookHandler) {
            return;
        }
        try {
            hookHandler(span, info);
        } catch (e) {
            this._diag.error(`Error running span customization hook due to exception in handler`, {
                triggerName
            }, e);
        }
    }
} //# sourceMappingURL=instrumentation.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/ModuleNameTrie.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 */ __turbopack_context__.s([
    "ModuleNameSeparator",
    ()=>ModuleNameSeparator,
    "ModuleNameTrie",
    ()=>ModuleNameTrie
]);
const ModuleNameSeparator = '/';
/**
 * Node in a `ModuleNameTrie`
 */ class ModuleNameTrieNode {
    hooks = [];
    children = new Map();
}
class ModuleNameTrie {
    _trie = new ModuleNameTrieNode();
    _counter = 0;
    /**
     * Insert a module hook into the trie
     *
     * @param {Hooked} hook Hook
     */ insert(hook) {
        let trieNode = this._trie;
        for (const moduleNamePart of hook.moduleName.split(ModuleNameSeparator)){
            let nextNode = trieNode.children.get(moduleNamePart);
            if (!nextNode) {
                nextNode = new ModuleNameTrieNode();
                trieNode.children.set(moduleNamePart, nextNode);
            }
            trieNode = nextNode;
        }
        trieNode.hooks.push({
            hook,
            insertedId: this._counter++
        });
    }
    /**
     * Search for matching hooks in the trie
     *
     * @param {string} moduleName Module name
     * @param {boolean} maintainInsertionOrder Whether to return the results in insertion order
     * @param {boolean} fullOnly Whether to return only full matches
     * @returns {Hooked[]} Matching hooks
     */ search(moduleName, { maintainInsertionOrder, fullOnly } = {}) {
        let trieNode = this._trie;
        const results = [];
        let foundFull = true;
        for (const moduleNamePart of moduleName.split(ModuleNameSeparator)){
            const nextNode = trieNode.children.get(moduleNamePart);
            if (!nextNode) {
                foundFull = false;
                break;
            }
            if (!fullOnly) {
                results.push(...nextNode.hooks);
            }
            trieNode = nextNode;
        }
        if (fullOnly && foundFull) {
            results.push(...trieNode.hooks);
        }
        if (results.length === 0) {
            return [];
        }
        if (results.length === 1) {
            return [
                results[0].hook
            ];
        }
        if (maintainInsertionOrder) {
            results.sort((a, b)=>a.insertedId - b.insertedId);
        }
        return results.map(({ hook })=>hook);
    }
} //# sourceMappingURL=ModuleNameTrie.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/RequireInTheMiddleSingleton.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "RequireInTheMiddleSingleton",
    ()=>RequireInTheMiddleSingleton
]);
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
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f$require$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$require$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$require$2d$in$2d$the$2d$middle$29$__ = __turbopack_context__.i("[externals]/require-in-the-middle [external] (require-in-the-middle, cjs, [project]/metacto/metacto-internal/context-stack/node_modules/require-in-the-middle)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$ModuleNameTrie$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/ModuleNameTrie.js [instrumentation] (ecmascript)");
;
;
;
/**
 * Whether Mocha is running in this process
 * Inspired by https://github.com/AndreasPizsa/detect-mocha
 *
 * @type {boolean}
 */ const isMocha = [
    'afterEach',
    'after',
    'beforeEach',
    'before',
    'describe',
    'it'
].every((fn)=>{
    // @ts-expect-error TS7053: Element implicitly has an 'any' type
    return typeof /*TURBOPACK member replacement*/ __turbopack_context__.g[fn] === 'function';
});
class RequireInTheMiddleSingleton {
    _moduleNameTrie = new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$ModuleNameTrie$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["ModuleNameTrie"]();
    static _instance;
    constructor(){
        this._initialize();
    }
    _initialize() {
        new __TURBOPACK__imported__module__$5b$externals$5d2f$require$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$require$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$require$2d$in$2d$the$2d$middle$29$__["Hook"](// Intercept all `require` calls; we will filter the matching ones below
        null, {
            internals: true
        }, (exports, name, basedir)=>{
            // For internal files on Windows, `name` will use backslash as the path separator
            const normalizedModuleName = normalizePathSeparators(name);
            const matches = this._moduleNameTrie.search(normalizedModuleName, {
                maintainInsertionOrder: true,
                // For core modules (e.g. `fs`), do not match on sub-paths (e.g. `fs/promises').
                // This matches the behavior of `require-in-the-middle`.
                // `basedir` is always `undefined` for core modules.
                fullOnly: basedir === undefined
            });
            for (const { onRequire } of matches){
                exports = onRequire(exports, name, basedir);
            }
            return exports;
        });
    }
    /**
     * Register a hook with `require-in-the-middle`
     *
     * @param {string} moduleName Module name
     * @param {OnRequireFn} onRequire Hook function
     * @returns {Hooked} Registered hook
     */ register(moduleName, onRequire) {
        const hooked = {
            moduleName,
            onRequire
        };
        this._moduleNameTrie.insert(hooked);
        return hooked;
    }
    /**
     * Get the `RequireInTheMiddleSingleton` singleton
     *
     * @returns {RequireInTheMiddleSingleton} Singleton of `RequireInTheMiddleSingleton`
     */ static getInstance() {
        // Mocha runs all test suites in the same process
        // This prevents test suites from sharing a singleton
        if (isMocha) return new RequireInTheMiddleSingleton();
        return this._instance = this._instance ?? new RequireInTheMiddleSingleton();
    }
}
/**
 * Normalize the path separators to forward slash in a module name or path
 *
 * @param {string} moduleNameOrPath Module name or path
 * @returns {string} Normalized module name or path
 */ function normalizePathSeparators(moduleNameOrPath) {
    return __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["sep"] !== __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$ModuleNameTrie$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["ModuleNameSeparator"] ? moduleNameOrPath.split(__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["sep"]).join(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$ModuleNameTrie$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["ModuleNameSeparator"]) : moduleNameOrPath;
} //# sourceMappingURL=RequireInTheMiddleSingleton.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/utils.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 * function to execute patched function and being able to catch errors
 * @param execute - function to be executed
 * @param onFinish - callback to run when execute finishes
 */ __turbopack_context__.s([
    "isWrapped",
    ()=>isWrapped,
    "safeExecuteInTheMiddle",
    ()=>safeExecuteInTheMiddle,
    "safeExecuteInTheMiddleAsync",
    ()=>safeExecuteInTheMiddleAsync
]);
function safeExecuteInTheMiddle(execute, onFinish, preventThrowingError) {
    let error;
    let result;
    try {
        result = execute();
    } catch (e) {
        error = e;
    } finally{
        onFinish(error, result);
        if (error && !preventThrowingError) {
            // eslint-disable-next-line no-unsafe-finally
            throw error;
        }
        // eslint-disable-next-line no-unsafe-finally
        return result;
    }
}
async function safeExecuteInTheMiddleAsync(execute, onFinish, preventThrowingError) {
    let error;
    let result;
    try {
        result = await execute();
    } catch (e) {
        error = e;
    } finally{
        await onFinish(error, result);
        if (error && !preventThrowingError) {
            // eslint-disable-next-line no-unsafe-finally
            throw error;
        }
        // eslint-disable-next-line no-unsafe-finally
        return result;
    }
}
function isWrapped(func) {
    return typeof func === 'function' && typeof func.__original === 'function' && typeof func.__unwrap === 'function' && func.__wrapped === true;
} //# sourceMappingURL=utils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/instrumentation.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InstrumentationBase",
    ()=>InstrumentationBase
]);
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
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$util__$5b$external$5d$__$28$util$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/util [external] (util, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semver$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/semver.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/shimmer.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentation$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/instrumentation.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$RequireInTheMiddleSingleton$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/RequireInTheMiddleSingleton.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$import$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$import$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$import$2d$in$2d$the$2d$middle$29$__ = __turbopack_context__.i("[externals]/import-in-the-middle [external] (import-in-the-middle, cjs, [project]/metacto/metacto-internal/context-stack/node_modules/import-in-the-middle)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/diag-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$require$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$require$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$require$2d$in$2d$the$2d$middle$29$__ = __turbopack_context__.i("[externals]/require-in-the-middle [external] (require-in-the-middle, cjs, [project]/metacto/metacto-internal/context-stack/node_modules/require-in-the-middle)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/fs [external] (fs, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/utils.js [instrumentation] (ecmascript)");
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
class InstrumentationBase extends __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentation$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["InstrumentationAbstract"] {
    _modules;
    _hooks = [];
    _requireInTheMiddleSingleton = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$RequireInTheMiddleSingleton$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["RequireInTheMiddleSingleton"].getInstance();
    _enabled = false;
    constructor(instrumentationName, instrumentationVersion, config){
        super(instrumentationName, instrumentationVersion, config);
        let modules = this.init();
        if (modules && !Array.isArray(modules)) {
            modules = [
                modules
            ];
        }
        this._modules = modules || [];
        if (this._config.enabled) {
            this.enable();
        }
    }
    _wrap = (moduleExports, name, wrapper)=>{
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["isWrapped"])(moduleExports[name])) {
            this._unwrap(moduleExports, name);
        }
        if (!__TURBOPACK__imported__module__$5b$externals$5d2f$util__$5b$external$5d$__$28$util$2c$__cjs$29$__["types"].isProxy(moduleExports)) {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["wrap"])(moduleExports, name, wrapper);
        } else {
            const wrapped = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["wrap"])(Object.assign({}, moduleExports), name, wrapper);
            Object.defineProperty(moduleExports, name, {
                value: wrapped
            });
            return wrapped;
        }
    };
    _unwrap = (moduleExports, name)=>{
        if (!__TURBOPACK__imported__module__$5b$externals$5d2f$util__$5b$external$5d$__$28$util$2c$__cjs$29$__["types"].isProxy(moduleExports)) {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["unwrap"])(moduleExports, name);
        } else {
            return Object.defineProperty(moduleExports, name, {
                value: moduleExports[name]
            });
        }
    };
    _massWrap = (moduleExportsArray, names, wrapper)=>{
        if (!moduleExportsArray) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error('must provide one or more modules to patch');
            return;
        } else if (!Array.isArray(moduleExportsArray)) {
            moduleExportsArray = [
                moduleExportsArray
            ];
        }
        if (!(names && Array.isArray(names))) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error('must provide one or more functions to wrap on modules');
            return;
        }
        moduleExportsArray.forEach((moduleExports)=>{
            names.forEach((name)=>{
                this._wrap(moduleExports, name, wrapper);
            });
        });
    };
    _massUnwrap = (moduleExportsArray, names)=>{
        if (!moduleExportsArray) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error('must provide one or more modules to patch');
            return;
        } else if (!Array.isArray(moduleExportsArray)) {
            moduleExportsArray = [
                moduleExportsArray
            ];
        }
        if (!(names && Array.isArray(names))) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error('must provide one or more functions to wrap on modules');
            return;
        }
        moduleExportsArray.forEach((moduleExports)=>{
            names.forEach((name)=>{
                this._unwrap(moduleExports, name);
            });
        });
    };
    _warnOnPreloadedModules() {
        this._modules.forEach((module)=>{
            const { name } = module;
            try {
                const resolvedModule = (()=>{
                    const e = new Error("Cannot find module as expression is too dynamic");
                    e.code = 'MODULE_NOT_FOUND';
                    throw e;
                })();
                if (__turbopack_context__.c[resolvedModule]) {
                    // Module is already cached, which means the instrumentation hook might not work
                    this._diag.warn(`Module ${name} has been loaded before ${this.instrumentationName} so it might not work, please initialize it before requiring ${name}`);
                }
            } catch  {
            // Module isn't available, we can simply skip
            }
        });
    }
    _extractPackageVersion(baseDir) {
        try {
            const json = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["readFileSync"])(__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"](baseDir, 'package.json'), {
                encoding: 'utf8'
            });
            const version = JSON.parse(json).version;
            return typeof version === 'string' ? version : undefined;
        } catch  {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].warn('Failed extracting version', baseDir);
        }
        return undefined;
    }
    _onRequire(module, exports, name, baseDir) {
        if (!baseDir) {
            if (typeof module.patch === 'function') {
                module.moduleExports = exports;
                if (this._enabled) {
                    this._diag.debug('Applying instrumentation patch for nodejs core module on require hook', {
                        module: module.name
                    });
                    return module.patch(exports);
                }
            }
            return exports;
        }
        const version = this._extractPackageVersion(baseDir);
        module.moduleVersion = version;
        if (module.name === name) {
            // main module
            if (isSupported(module.supportedVersions, version, module.includePrerelease)) {
                if (typeof module.patch === 'function') {
                    module.moduleExports = exports;
                    if (this._enabled) {
                        this._diag.debug('Applying instrumentation patch for module on require hook', {
                            module: module.name,
                            version: module.moduleVersion,
                            baseDir
                        });
                        return module.patch(exports, module.moduleVersion);
                    }
                }
            }
            return exports;
        }
        // internal file
        const files = module.files ?? [];
        const normalizedName = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["normalize"](name);
        const supportedFileInstrumentations = files.filter((f)=>f.name === normalizedName).filter((f)=>isSupported(f.supportedVersions, version, module.includePrerelease));
        return supportedFileInstrumentations.reduce((patchedExports, file)=>{
            file.moduleExports = patchedExports;
            if (this._enabled) {
                this._diag.debug('Applying instrumentation patch for nodejs module file on require hook', {
                    module: module.name,
                    version: module.moduleVersion,
                    fileName: file.name,
                    baseDir
                });
                // patch signature is not typed, so we cast it assuming it's correct
                return file.patch(patchedExports, module.moduleVersion);
            }
            return patchedExports;
        }, exports);
    }
    enable() {
        if (this._enabled) {
            return;
        }
        this._enabled = true;
        // already hooked, just call patch again
        if (this._hooks.length > 0) {
            for (const module of this._modules){
                if (typeof module.patch === 'function' && module.moduleExports) {
                    this._diag.debug('Applying instrumentation patch for nodejs module on instrumentation enabled', {
                        module: module.name,
                        version: module.moduleVersion
                    });
                    module.patch(module.moduleExports, module.moduleVersion);
                }
                for (const file of module.files){
                    if (file.moduleExports) {
                        this._diag.debug('Applying instrumentation patch for nodejs module file on instrumentation enabled', {
                            module: module.name,
                            version: module.moduleVersion,
                            fileName: file.name
                        });
                        file.patch(file.moduleExports, module.moduleVersion);
                    }
                }
            }
            return;
        }
        this._warnOnPreloadedModules();
        for (const module of this._modules){
            const hookFn = (exports, name, baseDir)=>{
                if (!baseDir && __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["isAbsolute"](name)) {
                    const parsedPath = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["parse"](name);
                    name = parsedPath.name;
                    baseDir = parsedPath.dir;
                }
                return this._onRequire(module, exports, name, baseDir);
            };
            const onRequire = (exports, name, baseDir)=>{
                return this._onRequire(module, exports, name, baseDir);
            };
            // `RequireInTheMiddleSingleton` does not support absolute paths.
            // For an absolute paths, we must create a separate instance of the
            // require-in-the-middle `Hook`.
            const hook = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["isAbsolute"](module.name) ? new __TURBOPACK__imported__module__$5b$externals$5d2f$require$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$require$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$require$2d$in$2d$the$2d$middle$29$__["Hook"]([
                module.name
            ], {
                internals: true
            }, onRequire) : this._requireInTheMiddleSingleton.register(module.name, onRequire);
            this._hooks.push(hook);
            const esmHook = new __TURBOPACK__imported__module__$5b$externals$5d2f$import$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$import$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$import$2d$in$2d$the$2d$middle$29$__["Hook"]([
                module.name
            ], {
                internals: false
            }, hookFn);
            this._hooks.push(esmHook);
        }
    }
    disable() {
        if (!this._enabled) {
            return;
        }
        this._enabled = false;
        for (const module of this._modules){
            if (typeof module.unpatch === 'function' && module.moduleExports) {
                this._diag.debug('Removing instrumentation patch for nodejs module on instrumentation disabled', {
                    module: module.name,
                    version: module.moduleVersion
                });
                module.unpatch(module.moduleExports, module.moduleVersion);
            }
            for (const file of module.files){
                if (file.moduleExports) {
                    this._diag.debug('Removing instrumentation patch for nodejs module file on instrumentation disabled', {
                        module: module.name,
                        version: module.moduleVersion,
                        fileName: file.name
                    });
                    file.unpatch(file.moduleExports, module.moduleVersion);
                }
            }
        }
    }
    isEnabled() {
        return this._enabled;
    }
}
function isSupported(supportedVersions, version, includePrerelease) {
    if (typeof version === 'undefined') {
        // If we don't have the version, accept the wildcard case only
        return supportedVersions.includes('*');
    }
    return supportedVersions.some((supportedVersion)=>{
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semver$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["satisfies"])(version, supportedVersion, {
            includePrerelease
        });
    });
} //# sourceMappingURL=instrumentation.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/instrumentationNodeModuleDefinition.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 */ __turbopack_context__.s([
    "InstrumentationNodeModuleDefinition",
    ()=>InstrumentationNodeModuleDefinition
]);
class InstrumentationNodeModuleDefinition {
    name;
    supportedVersions;
    patch;
    unpatch;
    files;
    constructor(name, supportedVersions, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patch, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unpatch, files){
        this.name = name;
        this.supportedVersions = supportedVersions;
        this.patch = patch;
        this.unpatch = unpatch;
        this.files = files || [];
    }
} //# sourceMappingURL=instrumentationNodeModuleDefinition.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/instrumentationNodeModuleFile.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InstrumentationNodeModuleFile",
    ()=>InstrumentationNodeModuleFile
]);
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
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
;
class InstrumentationNodeModuleFile {
    supportedVersions;
    patch;
    unpatch;
    name;
    constructor(name, supportedVersions, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patch, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unpatch){
        this.supportedVersions = supportedVersions;
        this.patch = patch;
        this.unpatch = unpatch;
        this.name = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["normalize"])(name);
    }
} //# sourceMappingURL=instrumentationNodeModuleFile.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/semconvStability.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 */ __turbopack_context__.s([
    "SemconvStability",
    ()=>SemconvStability,
    "semconvStabilityFromStr",
    ()=>semconvStabilityFromStr
]);
var SemconvStability;
(function(SemconvStability) {
    /** Emit only stable semantic conventions. */ SemconvStability[SemconvStability["STABLE"] = 1] = "STABLE";
    /** Emit only old semantic conventions. */ SemconvStability[SemconvStability["OLD"] = 2] = "OLD";
    /** Emit both stable and old semantic conventions. */ SemconvStability[SemconvStability["DUPLICATE"] = 3] = "DUPLICATE";
})(SemconvStability || (SemconvStability = {}));
function semconvStabilityFromStr(namespace, str) {
    let semconvStability = SemconvStability.OLD;
    // The same parsing of `str` as `getStringListFromEnv` from the core pkg.
    const entries = str?.split(',').map((v)=>v.trim()).filter((s)=>s !== '');
    for (const entry of entries ?? []){
        if (entry.toLowerCase() === namespace + '/dup') {
            // DUPLICATE takes highest precedence.
            semconvStability = SemconvStability.DUPLICATE;
            break;
        } else if (entry.toLowerCase() === namespace) {
            semconvStability = SemconvStability.STABLE;
        }
    }
    return semconvStability;
} //# sourceMappingURL=semconvStability.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InstrumentationBase",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$instrumentation$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["InstrumentationBase"],
    "InstrumentationNodeModuleDefinition",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentationNodeModuleDefinition$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["InstrumentationNodeModuleDefinition"],
    "InstrumentationNodeModuleFile",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentationNodeModuleFile$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["InstrumentationNodeModuleFile"],
    "SemconvStability",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semconvStability$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["SemconvStability"],
    "isWrapped",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["isWrapped"],
    "registerInstrumentations",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoader$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["registerInstrumentations"],
    "safeExecuteInTheMiddle",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["safeExecuteInTheMiddle"],
    "safeExecuteInTheMiddleAsync",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["safeExecuteInTheMiddleAsync"],
    "semconvStabilityFromStr",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semconvStability$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["semconvStabilityFromStr"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoader$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/autoLoader.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$instrumentation$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/instrumentation.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentationNodeModuleDefinition$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/instrumentationNodeModuleDefinition.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentationNodeModuleFile$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/instrumentationNodeModuleFile.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/utils.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$fastify$2f$otel$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semconvStability$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@fastify/otel/node_modules/@opentelemetry/instrumentation/build/esm/semconvStability.js [instrumentation] (ecmascript)");
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

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
 */ __turbopack_context__.s([]);
;
;
;
;
;
;
 //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/autoLoaderUtils.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 * Enable instrumentations
 * @param instrumentations
 * @param tracerProvider
 * @param meterProvider
 */ __turbopack_context__.s([
    "disableInstrumentations",
    ()=>disableInstrumentations,
    "enableInstrumentations",
    ()=>enableInstrumentations
]);
function enableInstrumentations(instrumentations, tracerProvider, meterProvider, loggerProvider) {
    for(let i = 0, j = instrumentations.length; i < j; i++){
        const instrumentation = instrumentations[i];
        if (tracerProvider) {
            instrumentation.setTracerProvider(tracerProvider);
        }
        if (meterProvider) {
            instrumentation.setMeterProvider(meterProvider);
        }
        if (loggerProvider && instrumentation.setLoggerProvider) {
            instrumentation.setLoggerProvider(loggerProvider);
        }
        // instrumentations have been already enabled during creation
        // so enable only if user prevented that by setting enabled to false
        // this is to prevent double enabling but when calling register all
        // instrumentations should be now enabled
        if (!instrumentation.getConfig().enabled) {
            instrumentation.enable();
        }
    }
}
function disableInstrumentations(instrumentations) {
    instrumentations.forEach((instrumentation)=>instrumentation.disable());
} //# sourceMappingURL=autoLoaderUtils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/autoLoader.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "registerInstrumentations",
    ()=>registerInstrumentations
]);
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
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/trace-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$metrics$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/metrics-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$api$2d$logs$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/api-logs/build/esm/index.js [instrumentation] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoaderUtils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/autoLoaderUtils.js [instrumentation] (ecmascript)");
;
;
;
function registerInstrumentations(options) {
    const tracerProvider = options.tracerProvider || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["trace"].getTracerProvider();
    const meterProvider = options.meterProvider || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$metrics$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["metrics"].getMeterProvider();
    const loggerProvider = options.loggerProvider || __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$api$2d$logs$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__["logs"].getLoggerProvider();
    const instrumentations = options.instrumentations?.flat() ?? [];
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoaderUtils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["enableInstrumentations"])(instrumentations, tracerProvider, meterProvider, loggerProvider);
    return ()=>{
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoaderUtils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["disableInstrumentations"])(instrumentations);
    };
} //# sourceMappingURL=autoLoader.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/semver.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "satisfies",
    ()=>satisfies
]);
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
 */ // This is a custom semantic versioning implementation compatible with the
// `satisfies(version, range, options?)` function from the `semver` npm package;
// with the exception that the `loose` option is not supported.
//
// The motivation for the custom semver implementation is that
// `semver` package has some initialization delay (lots of RegExp init and compile)
// and this leads to coldstart overhead for the OTEL Lambda Node.js layer.
// Hence, we have implemented lightweight version of it internally with required functionalities.
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/diag-api.js [instrumentation] (ecmascript)");
;
const VERSION_REGEXP = /^(?:v)?(?<version>(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*))(?:-(?<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?<build>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const RANGE_REGEXP = /^(?<op><|>|=|==|<=|>=|~|\^|~>)?\s*(?:v)?(?<version>(?<major>x|X|\*|0|[1-9]\d*)(?:\.(?<minor>x|X|\*|0|[1-9]\d*))?(?:\.(?<patch>x|X|\*|0|[1-9]\d*))?)(?:-(?<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?<build>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const operatorResMap = {
    '>': [
        1
    ],
    '>=': [
        0,
        1
    ],
    '=': [
        0
    ],
    '<=': [
        -1,
        0
    ],
    '<': [
        -1
    ],
    '!=': [
        -1,
        1
    ]
};
function satisfies(version, range, options) {
    // Strict semver format check
    if (!_validateVersion(version)) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error(`Invalid version: ${version}`);
        return false;
    }
    // If range is empty, satisfy check succeeds regardless what version is
    if (!range) {
        return true;
    }
    // Cleanup range
    range = range.replace(/([<>=~^]+)\s+/g, '$1');
    // Parse version
    const parsedVersion = _parseVersion(version);
    if (!parsedVersion) {
        return false;
    }
    const allParsedRanges = [];
    // Check given version whether it satisfies given range expression
    const checkResult = _doSatisfies(parsedVersion, range, allParsedRanges, options);
    // If check result is OK,
    // do another final check for pre-release, if pre-release check is included by option
    if (checkResult && !options?.includePrerelease) {
        return _doPreleaseCheck(parsedVersion, allParsedRanges);
    }
    return checkResult;
}
function _validateVersion(version) {
    return typeof version === 'string' && VERSION_REGEXP.test(version);
}
function _doSatisfies(parsedVersion, range, allParsedRanges, options) {
    if (range.includes('||')) {
        // A version matches a range if and only if
        // every comparator in at least one of the ||-separated comparator sets is satisfied by the version
        const ranges = range.trim().split('||');
        for (const r of ranges){
            if (_checkRange(parsedVersion, r, allParsedRanges, options)) {
                return true;
            }
        }
        return false;
    } else if (range.includes(' - ')) {
        // Hyphen ranges: https://github.com/npm/node-semver#hyphen-ranges-xyz---abc
        range = replaceHyphen(range, options);
    } else if (range.includes(' ')) {
        // Multiple separated ranges and all needs to be satisfied for success
        const ranges = range.trim().replace(/\s{2,}/g, ' ').split(' ');
        for (const r of ranges){
            if (!_checkRange(parsedVersion, r, allParsedRanges, options)) {
                return false;
            }
        }
        return true;
    }
    // Check given parsed version with given range
    return _checkRange(parsedVersion, range, allParsedRanges, options);
}
function _checkRange(parsedVersion, range, allParsedRanges, options) {
    range = _normalizeRange(range, options);
    if (range.includes(' ')) {
        // If there are multiple ranges separated, satisfy each of them
        return _doSatisfies(parsedVersion, range, allParsedRanges, options);
    } else {
        // Validate and parse range
        const parsedRange = _parseRange(range);
        allParsedRanges.push(parsedRange);
        // Check parsed version by parsed range
        return _satisfies(parsedVersion, parsedRange);
    }
}
function _satisfies(parsedVersion, parsedRange) {
    // If range is invalid, satisfy check fails (no error throw)
    if (parsedRange.invalid) {
        return false;
    }
    // If range is empty or wildcard, satisfy check succeeds regardless what version is
    if (!parsedRange.version || _isWildcard(parsedRange.version)) {
        return true;
    }
    // Compare version segment first
    let comparisonResult = _compareVersionSegments(parsedVersion.versionSegments || [], parsedRange.versionSegments || []);
    // If versions segments are equal, compare by pre-release segments
    if (comparisonResult === 0) {
        const versionPrereleaseSegments = parsedVersion.prereleaseSegments || [];
        const rangePrereleaseSegments = parsedRange.prereleaseSegments || [];
        if (!versionPrereleaseSegments.length && !rangePrereleaseSegments.length) {
            comparisonResult = 0;
        } else if (!versionPrereleaseSegments.length && rangePrereleaseSegments.length) {
            comparisonResult = 1;
        } else if (versionPrereleaseSegments.length && !rangePrereleaseSegments.length) {
            comparisonResult = -1;
        } else {
            comparisonResult = _compareVersionSegments(versionPrereleaseSegments, rangePrereleaseSegments);
        }
    }
    // Resolve check result according to comparison operator
    return operatorResMap[parsedRange.op]?.includes(comparisonResult);
}
function _doPreleaseCheck(parsedVersion, allParsedRanges) {
    if (parsedVersion.prerelease) {
        return allParsedRanges.some((r)=>r.prerelease && r.version === parsedVersion.version);
    }
    return true;
}
function _normalizeRange(range, options) {
    range = range.trim();
    range = replaceCaret(range, options);
    range = replaceTilde(range);
    range = replaceXRange(range, options);
    range = range.trim();
    return range;
}
function isX(id) {
    return !id || id.toLowerCase() === 'x' || id === '*';
}
function _parseVersion(versionString) {
    const match = versionString.match(VERSION_REGEXP);
    if (!match) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error(`Invalid version: ${versionString}`);
        return undefined;
    }
    const version = match.groups.version;
    const prerelease = match.groups.prerelease;
    const build = match.groups.build;
    const versionSegments = version.split('.');
    const prereleaseSegments = prerelease?.split('.');
    return {
        op: undefined,
        version,
        versionSegments,
        versionSegmentCount: versionSegments.length,
        prerelease,
        prereleaseSegments,
        prereleaseSegmentCount: prereleaseSegments ? prereleaseSegments.length : 0,
        build
    };
}
function _parseRange(rangeString) {
    if (!rangeString) {
        return {};
    }
    const match = rangeString.match(RANGE_REGEXP);
    if (!match) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error(`Invalid range: ${rangeString}`);
        return {
            invalid: true
        };
    }
    let op = match.groups.op;
    const version = match.groups.version;
    const prerelease = match.groups.prerelease;
    const build = match.groups.build;
    const versionSegments = version.split('.');
    const prereleaseSegments = prerelease?.split('.');
    if (op === '==') {
        op = '=';
    }
    return {
        op: op || '=',
        version,
        versionSegments,
        versionSegmentCount: versionSegments.length,
        prerelease,
        prereleaseSegments,
        prereleaseSegmentCount: prereleaseSegments ? prereleaseSegments.length : 0,
        build
    };
}
function _isWildcard(s) {
    return s === '*' || s === 'x' || s === 'X';
}
function _parseVersionString(v) {
    const n = parseInt(v, 10);
    return isNaN(n) ? v : n;
}
function _normalizeVersionType(a, b) {
    if (typeof a === typeof b) {
        if (typeof a === 'number') {
            return [
                a,
                b
            ];
        } else if (typeof a === 'string') {
            return [
                a,
                b
            ];
        } else {
            throw new Error('Version segments can only be strings or numbers');
        }
    } else {
        return [
            String(a),
            String(b)
        ];
    }
}
function _compareVersionStrings(v1, v2) {
    if (_isWildcard(v1) || _isWildcard(v2)) {
        return 0;
    }
    const [parsedV1, parsedV2] = _normalizeVersionType(_parseVersionString(v1), _parseVersionString(v2));
    if (parsedV1 > parsedV2) {
        return 1;
    } else if (parsedV1 < parsedV2) {
        return -1;
    }
    return 0;
}
function _compareVersionSegments(v1, v2) {
    for(let i = 0; i < Math.max(v1.length, v2.length); i++){
        const res = _compareVersionStrings(v1[i] || '0', v2[i] || '0');
        if (res !== 0) {
            return res;
        }
    }
    return 0;
}
////////////////////////////////////////////////////////////////////////////////
// The rest of this file is adapted from portions of https://github.com/npm/node-semver/tree/868d4bb
// License:
/*
 * The ISC License
 *
 * Copyright (c) Isaac Z. Schlueter and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
 * IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */ const LETTERDASHNUMBER = '[a-zA-Z0-9-]';
const NUMERICIDENTIFIER = '0|[1-9]\\d*';
const NONNUMERICIDENTIFIER = `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`;
const GTLT = '((?:<|>)?=?)';
const PRERELEASEIDENTIFIER = `(?:${NUMERICIDENTIFIER}|${NONNUMERICIDENTIFIER})`;
const PRERELEASE = `(?:-(${PRERELEASEIDENTIFIER}(?:\\.${PRERELEASEIDENTIFIER})*))`;
const BUILDIDENTIFIER = `${LETTERDASHNUMBER}+`;
const BUILD = `(?:\\+(${BUILDIDENTIFIER}(?:\\.${BUILDIDENTIFIER})*))`;
const XRANGEIDENTIFIER = `${NUMERICIDENTIFIER}|x|X|\\*`;
const XRANGEPLAIN = `[v=\\s]*(${XRANGEIDENTIFIER})` + `(?:\\.(${XRANGEIDENTIFIER})` + `(?:\\.(${XRANGEIDENTIFIER})` + `(?:${PRERELEASE})?${BUILD}?` + `)?)?`;
const XRANGE = `^${GTLT}\\s*${XRANGEPLAIN}$`;
const XRANGE_REGEXP = new RegExp(XRANGE);
const HYPHENRANGE = `^\\s*(${XRANGEPLAIN})` + `\\s+-\\s+` + `(${XRANGEPLAIN})` + `\\s*$`;
const HYPHENRANGE_REGEXP = new RegExp(HYPHENRANGE);
const LONETILDE = '(?:~>?)';
const TILDE = `^${LONETILDE}${XRANGEPLAIN}$`;
const TILDE_REGEXP = new RegExp(TILDE);
const LONECARET = '(?:\\^)';
const CARET = `^${LONECARET}${XRANGEPLAIN}$`;
const CARET_REGEXP = new RegExp(CARET);
// Borrowed from https://github.com/npm/node-semver/blob/868d4bbe3d318c52544f38d5f9977a1103e924c2/classes/range.js#L285
//
// ~, ~> --> * (any, kinda silly)
// ~2, ~2.x, ~2.x.x, ~>2, ~>2.x ~>2.x.x --> >=2.0.0 <3.0.0-0
// ~2.0, ~2.0.x, ~>2.0, ~>2.0.x --> >=2.0.0 <2.1.0-0
// ~1.2, ~1.2.x, ~>1.2, ~>1.2.x --> >=1.2.0 <1.3.0-0
// ~1.2.3, ~>1.2.3 --> >=1.2.3 <1.3.0-0
// ~1.2.0, ~>1.2.0 --> >=1.2.0 <1.3.0-0
// ~0.0.1 --> >=0.0.1 <0.1.0-0
function replaceTilde(comp) {
    const r = TILDE_REGEXP;
    return comp.replace(r, (_, M, m, p, pr)=>{
        let ret;
        if (isX(M)) {
            ret = '';
        } else if (isX(m)) {
            ret = `>=${M}.0.0 <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
            // ~1.2 == >=1.2.0 <1.3.0-0
            ret = `>=${M}.${m}.0 <${M}.${+m + 1}.0-0`;
        } else if (pr) {
            ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
        } else {
            // ~1.2.3 == >=1.2.3 <1.3.0-0
            ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
        }
        return ret;
    });
}
// Borrowed from https://github.com/npm/node-semver/blob/868d4bbe3d318c52544f38d5f9977a1103e924c2/classes/range.js#L329
//
// ^ --> * (any, kinda silly)
// ^2, ^2.x, ^2.x.x --> >=2.0.0 <3.0.0-0
// ^2.0, ^2.0.x --> >=2.0.0 <3.0.0-0
// ^1.2, ^1.2.x --> >=1.2.0 <2.0.0-0
// ^1.2.3 --> >=1.2.3 <2.0.0-0
// ^1.2.0 --> >=1.2.0 <2.0.0-0
// ^0.0.1 --> >=0.0.1 <0.0.2-0
// ^0.1.0 --> >=0.1.0 <0.2.0-0
function replaceCaret(comp, options) {
    const r = CARET_REGEXP;
    const z = options?.includePrerelease ? '-0' : '';
    return comp.replace(r, (_, M, m, p, pr)=>{
        let ret;
        if (isX(M)) {
            ret = '';
        } else if (isX(m)) {
            ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
            if (M === '0') {
                ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
            } else {
                ret = `>=${M}.${m}.0${z} <${+M + 1}.0.0-0`;
            }
        } else if (pr) {
            if (M === '0') {
                if (m === '0') {
                    ret = `>=${M}.${m}.${p}-${pr} <${M}.${m}.${+p + 1}-0`;
                } else {
                    ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
                }
            } else {
                ret = `>=${M}.${m}.${p}-${pr} <${+M + 1}.0.0-0`;
            }
        } else {
            if (M === '0') {
                if (m === '0') {
                    ret = `>=${M}.${m}.${p}${z} <${M}.${m}.${+p + 1}-0`;
                } else {
                    ret = `>=${M}.${m}.${p}${z} <${M}.${+m + 1}.0-0`;
                }
            } else {
                ret = `>=${M}.${m}.${p} <${+M + 1}.0.0-0`;
            }
        }
        return ret;
    });
}
// Borrowed from https://github.com/npm/node-semver/blob/868d4bbe3d318c52544f38d5f9977a1103e924c2/classes/range.js#L390
function replaceXRange(comp, options) {
    const r = XRANGE_REGEXP;
    return comp.replace(r, (ret, gtlt, M, m, p, pr)=>{
        const xM = isX(M);
        const xm = xM || isX(m);
        const xp = xm || isX(p);
        const anyX = xp;
        if (gtlt === '=' && anyX) {
            gtlt = '';
        }
        // if we're including prereleases in the match, then we need
        // to fix this to -0, the lowest possible prerelease value
        pr = options?.includePrerelease ? '-0' : '';
        if (xM) {
            if (gtlt === '>' || gtlt === '<') {
                // nothing is allowed
                ret = '<0.0.0-0';
            } else {
                // nothing is forbidden
                ret = '*';
            }
        } else if (gtlt && anyX) {
            // we know patch is an x, because we have any x at all.
            // replace X with 0
            if (xm) {
                m = 0;
            }
            p = 0;
            if (gtlt === '>') {
                // >1 => >=2.0.0
                // >1.2 => >=1.3.0
                gtlt = '>=';
                if (xm) {
                    M = +M + 1;
                    m = 0;
                    p = 0;
                } else {
                    m = +m + 1;
                    p = 0;
                }
            } else if (gtlt === '<=') {
                // <=0.7.x is actually <0.8.0, since any 0.7.x should
                // pass.  Similarly, <=7.x is actually <8.0.0, etc.
                gtlt = '<';
                if (xm) {
                    M = +M + 1;
                } else {
                    m = +m + 1;
                }
            }
            if (gtlt === '<') {
                pr = '-0';
            }
            ret = `${gtlt + M}.${m}.${p}${pr}`;
        } else if (xm) {
            ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
        } else if (xp) {
            ret = `>=${M}.${m}.0${pr} <${M}.${+m + 1}.0-0`;
        }
        return ret;
    });
}
// Borrowed from https://github.com/npm/node-semver/blob/868d4bbe3d318c52544f38d5f9977a1103e924c2/classes/range.js#L488
//
// 1.2 - 3.4.5 => >=1.2.0 <=3.4.5
// 1.2.3 - 3.4 => >=1.2.0 <3.5.0-0 Any 3.4.x will do
// 1.2 - 3.4 => >=1.2.0 <3.5.0-0
function replaceHyphen(comp, options) {
    const r = HYPHENRANGE_REGEXP;
    return comp.replace(r, (_, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr)=>{
        if (isX(fM)) {
            from = '';
        } else if (isX(fm)) {
            from = `>=${fM}.0.0${options?.includePrerelease ? '-0' : ''}`;
        } else if (isX(fp)) {
            from = `>=${fM}.${fm}.0${options?.includePrerelease ? '-0' : ''}`;
        } else if (fpr) {
            from = `>=${from}`;
        } else {
            from = `>=${from}${options?.includePrerelease ? '-0' : ''}`;
        }
        if (isX(tM)) {
            to = '';
        } else if (isX(tm)) {
            to = `<${+tM + 1}.0.0-0`;
        } else if (isX(tp)) {
            to = `<${tM}.${+tm + 1}.0-0`;
        } else if (tpr) {
            to = `<=${tM}.${tm}.${tp}-${tpr}`;
        } else if (options?.includePrerelease) {
            to = `<${tM}.${tm}.${+tp + 1}-0`;
        } else {
            to = `<=${to}`;
        }
        return `${from} ${to}`.trim();
    });
} //# sourceMappingURL=semver.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/shimmer.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>shimmer,
    "massUnwrap",
    ()=>massUnwrap,
    "massWrap",
    ()=>massWrap,
    "unwrap",
    ()=>unwrap,
    "wrap",
    ()=>wrap
]);
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
 */ // Default to complaining loudly when things don't go according to plan.
// eslint-disable-next-line no-console
let logger = console.error.bind(console);
// Sets a property on an object, preserving its enumerability.
// This function assumes that the property is already writable.
function defineProperty(obj, name, value) {
    const enumerable = !!obj[name] && Object.prototype.propertyIsEnumerable.call(obj, name);
    Object.defineProperty(obj, name, {
        configurable: true,
        enumerable,
        writable: true,
        value
    });
}
const wrap = (nodule, name, wrapper)=>{
    if (!nodule || !nodule[name]) {
        logger('no original function ' + String(name) + ' to wrap');
        return;
    }
    if (!wrapper) {
        logger('no wrapper function');
        logger(new Error().stack);
        return;
    }
    const original = nodule[name];
    if (typeof original !== 'function' || typeof wrapper !== 'function') {
        logger('original object and wrapper must be functions');
        return;
    }
    const wrapped = wrapper(original, name);
    defineProperty(wrapped, '__original', original);
    defineProperty(wrapped, '__unwrap', ()=>{
        if (nodule[name] === wrapped) {
            defineProperty(nodule, name, original);
        }
    });
    defineProperty(wrapped, '__wrapped', true);
    defineProperty(nodule, name, wrapped);
    return wrapped;
};
const massWrap = (nodules, names, wrapper)=>{
    if (!nodules) {
        logger('must provide one or more modules to patch');
        logger(new Error().stack);
        return;
    } else if (!Array.isArray(nodules)) {
        nodules = [
            nodules
        ];
    }
    if (!(names && Array.isArray(names))) {
        logger('must provide one or more functions to wrap on modules');
        return;
    }
    nodules.forEach((nodule)=>{
        names.forEach((name)=>{
            wrap(nodule, name, wrapper);
        });
    });
};
const unwrap = (nodule, name)=>{
    if (!nodule || !nodule[name]) {
        logger('no function to unwrap.');
        logger(new Error().stack);
        return;
    }
    const wrapped = nodule[name];
    if (!wrapped.__unwrap) {
        logger('no original to unwrap to -- has ' + String(name) + ' already been unwrapped?');
    } else {
        wrapped.__unwrap();
        return;
    }
};
const massUnwrap = (nodules, names)=>{
    if (!nodules) {
        logger('must provide one or more modules to patch');
        logger(new Error().stack);
        return;
    } else if (!Array.isArray(nodules)) {
        nodules = [
            nodules
        ];
    }
    if (!(names && Array.isArray(names))) {
        logger('must provide one or more functions to unwrap on modules');
        return;
    }
    nodules.forEach((nodule)=>{
        names.forEach((name)=>{
            unwrap(nodule, name);
        });
    });
};
function shimmer(options) {
    if (options && options.logger) {
        if (typeof options.logger !== 'function') {
            logger("new logger isn't a function, not replacing");
        } else {
            logger = options.logger;
        }
    }
}
shimmer.wrap = wrap;
shimmer.massWrap = massWrap;
shimmer.unwrap = unwrap;
shimmer.massUnwrap = massUnwrap; //# sourceMappingURL=shimmer.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/instrumentation.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InstrumentationAbstract",
    ()=>InstrumentationAbstract
]);
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
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/diag-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$metrics$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/metrics-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/trace-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$api$2d$logs$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/api-logs/build/esm/index.js [instrumentation] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/shimmer.js [instrumentation] (ecmascript)");
;
;
;
class InstrumentationAbstract {
    instrumentationName;
    instrumentationVersion;
    _config = {};
    _tracer;
    _meter;
    _logger;
    _diag;
    constructor(instrumentationName, instrumentationVersion, config){
        this.instrumentationName = instrumentationName;
        this.instrumentationVersion = instrumentationVersion;
        this.setConfig(config);
        this._diag = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].createComponentLogger({
            namespace: instrumentationName
        });
        this._tracer = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$trace$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["trace"].getTracer(instrumentationName, instrumentationVersion);
        this._meter = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$metrics$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["metrics"].getMeter(instrumentationName, instrumentationVersion);
        this._logger = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$api$2d$logs$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__["logs"].getLogger(instrumentationName, instrumentationVersion);
        this._updateMetricInstruments();
    }
    /* Api to wrap instrumented method */ _wrap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["wrap"];
    /* Api to unwrap instrumented methods */ _unwrap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["unwrap"];
    /* Api to mass wrap instrumented method */ _massWrap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["massWrap"];
    /* Api to mass unwrap instrumented methods */ _massUnwrap = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["massUnwrap"];
    /* Returns meter */ get meter() {
        return this._meter;
    }
    /**
     * Sets MeterProvider to this plugin
     * @param meterProvider
     */ setMeterProvider(meterProvider) {
        this._meter = meterProvider.getMeter(this.instrumentationName, this.instrumentationVersion);
        this._updateMetricInstruments();
    }
    /* Returns logger */ get logger() {
        return this._logger;
    }
    /**
     * Sets LoggerProvider to this plugin
     * @param loggerProvider
     */ setLoggerProvider(loggerProvider) {
        this._logger = loggerProvider.getLogger(this.instrumentationName, this.instrumentationVersion);
    }
    /**
     * @experimental
     *
     * Get module definitions defined by {@link init}.
     * This can be used for experimental compile-time instrumentation.
     *
     * @returns an array of {@link InstrumentationModuleDefinition}
     */ getModuleDefinitions() {
        const initResult = this.init() ?? [];
        if (!Array.isArray(initResult)) {
            return [
                initResult
            ];
        }
        return initResult;
    }
    /**
     * Sets the new metric instruments with the current Meter.
     */ _updateMetricInstruments() {
        return;
    }
    /* Returns InstrumentationConfig */ getConfig() {
        return this._config;
    }
    /**
     * Sets InstrumentationConfig to this plugin
     * @param config
     */ setConfig(config) {
        // copy config first level properties to ensure they are immutable.
        // nested properties are not copied, thus are mutable from the outside.
        this._config = {
            enabled: true,
            ...config
        };
    }
    /**
     * Sets TraceProvider to this plugin
     * @param tracerProvider
     */ setTracerProvider(tracerProvider) {
        this._tracer = tracerProvider.getTracer(this.instrumentationName, this.instrumentationVersion);
    }
    /* Returns tracer */ get tracer() {
        return this._tracer;
    }
    /**
     * Execute span customization hook, if configured, and log any errors.
     * Any semantics of the trigger and info are defined by the specific instrumentation.
     * @param hookHandler The optional hook handler which the user has configured via instrumentation config
     * @param triggerName The name of the trigger for executing the hook for logging purposes
     * @param span The span to which the hook should be applied
     * @param info The info object to be passed to the hook, with useful data the hook may use
     */ _runSpanCustomizationHook(hookHandler, triggerName, span, info) {
        if (!hookHandler) {
            return;
        }
        try {
            hookHandler(span, info);
        } catch (e) {
            this._diag.error(`Error running span customization hook due to exception in handler`, {
                triggerName
            }, e);
        }
    }
} //# sourceMappingURL=instrumentation.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/ModuleNameTrie.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 */ __turbopack_context__.s([
    "ModuleNameSeparator",
    ()=>ModuleNameSeparator,
    "ModuleNameTrie",
    ()=>ModuleNameTrie
]);
const ModuleNameSeparator = '/';
/**
 * Node in a `ModuleNameTrie`
 */ class ModuleNameTrieNode {
    hooks = [];
    children = new Map();
}
class ModuleNameTrie {
    _trie = new ModuleNameTrieNode();
    _counter = 0;
    /**
     * Insert a module hook into the trie
     *
     * @param {Hooked} hook Hook
     */ insert(hook) {
        let trieNode = this._trie;
        for (const moduleNamePart of hook.moduleName.split(ModuleNameSeparator)){
            let nextNode = trieNode.children.get(moduleNamePart);
            if (!nextNode) {
                nextNode = new ModuleNameTrieNode();
                trieNode.children.set(moduleNamePart, nextNode);
            }
            trieNode = nextNode;
        }
        trieNode.hooks.push({
            hook,
            insertedId: this._counter++
        });
    }
    /**
     * Search for matching hooks in the trie
     *
     * @param {string} moduleName Module name
     * @param {boolean} maintainInsertionOrder Whether to return the results in insertion order
     * @param {boolean} fullOnly Whether to return only full matches
     * @returns {Hooked[]} Matching hooks
     */ search(moduleName, { maintainInsertionOrder, fullOnly } = {}) {
        let trieNode = this._trie;
        const results = [];
        let foundFull = true;
        for (const moduleNamePart of moduleName.split(ModuleNameSeparator)){
            const nextNode = trieNode.children.get(moduleNamePart);
            if (!nextNode) {
                foundFull = false;
                break;
            }
            if (!fullOnly) {
                results.push(...nextNode.hooks);
            }
            trieNode = nextNode;
        }
        if (fullOnly && foundFull) {
            results.push(...trieNode.hooks);
        }
        if (results.length === 0) {
            return [];
        }
        if (results.length === 1) {
            return [
                results[0].hook
            ];
        }
        if (maintainInsertionOrder) {
            results.sort((a, b)=>a.insertedId - b.insertedId);
        }
        return results.map(({ hook })=>hook);
    }
} //# sourceMappingURL=ModuleNameTrie.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/RequireInTheMiddleSingleton.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "RequireInTheMiddleSingleton",
    ()=>RequireInTheMiddleSingleton
]);
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
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f$require$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$require$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$require$2d$in$2d$the$2d$middle$29$__ = __turbopack_context__.i("[externals]/require-in-the-middle [external] (require-in-the-middle, cjs, [project]/metacto/metacto-internal/context-stack/node_modules/require-in-the-middle)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$ModuleNameTrie$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/ModuleNameTrie.js [instrumentation] (ecmascript)");
;
;
;
/**
 * Whether Mocha is running in this process
 * Inspired by https://github.com/AndreasPizsa/detect-mocha
 *
 * @type {boolean}
 */ const isMocha = [
    'afterEach',
    'after',
    'beforeEach',
    'before',
    'describe',
    'it'
].every((fn)=>{
    // @ts-expect-error TS7053: Element implicitly has an 'any' type
    return typeof /*TURBOPACK member replacement*/ __turbopack_context__.g[fn] === 'function';
});
class RequireInTheMiddleSingleton {
    _moduleNameTrie = new __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$ModuleNameTrie$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["ModuleNameTrie"]();
    static _instance;
    constructor(){
        this._initialize();
    }
    _initialize() {
        new __TURBOPACK__imported__module__$5b$externals$5d2f$require$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$require$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$require$2d$in$2d$the$2d$middle$29$__["Hook"](// Intercept all `require` calls; we will filter the matching ones below
        null, {
            internals: true
        }, (exports, name, basedir)=>{
            // For internal files on Windows, `name` will use backslash as the path separator
            const normalizedModuleName = normalizePathSeparators(name);
            const matches = this._moduleNameTrie.search(normalizedModuleName, {
                maintainInsertionOrder: true,
                // For core modules (e.g. `fs`), do not match on sub-paths (e.g. `fs/promises').
                // This matches the behavior of `require-in-the-middle`.
                // `basedir` is always `undefined` for core modules.
                fullOnly: basedir === undefined
            });
            for (const { onRequire } of matches){
                exports = onRequire(exports, name, basedir);
            }
            return exports;
        });
    }
    /**
     * Register a hook with `require-in-the-middle`
     *
     * @param {string} moduleName Module name
     * @param {OnRequireFn} onRequire Hook function
     * @returns {Hooked} Registered hook
     */ register(moduleName, onRequire) {
        const hooked = {
            moduleName,
            onRequire
        };
        this._moduleNameTrie.insert(hooked);
        return hooked;
    }
    /**
     * Get the `RequireInTheMiddleSingleton` singleton
     *
     * @returns {RequireInTheMiddleSingleton} Singleton of `RequireInTheMiddleSingleton`
     */ static getInstance() {
        // Mocha runs all test suites in the same process
        // This prevents test suites from sharing a singleton
        if (isMocha) return new RequireInTheMiddleSingleton();
        return this._instance = this._instance ?? new RequireInTheMiddleSingleton();
    }
}
/**
 * Normalize the path separators to forward slash in a module name or path
 *
 * @param {string} moduleNameOrPath Module name or path
 * @returns {string} Normalized module name or path
 */ function normalizePathSeparators(moduleNameOrPath) {
    return __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["sep"] !== __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$ModuleNameTrie$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["ModuleNameSeparator"] ? moduleNameOrPath.split(__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["sep"]).join(__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$ModuleNameTrie$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["ModuleNameSeparator"]) : moduleNameOrPath;
} //# sourceMappingURL=RequireInTheMiddleSingleton.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/utils.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 * function to execute patched function and being able to catch errors
 * @param execute - function to be executed
 * @param onFinish - callback to run when execute finishes
 */ __turbopack_context__.s([
    "isWrapped",
    ()=>isWrapped,
    "safeExecuteInTheMiddle",
    ()=>safeExecuteInTheMiddle,
    "safeExecuteInTheMiddleAsync",
    ()=>safeExecuteInTheMiddleAsync
]);
function safeExecuteInTheMiddle(execute, onFinish, preventThrowingError) {
    let error;
    let result;
    try {
        result = execute();
    } catch (e) {
        error = e;
    } finally{
        onFinish(error, result);
        if (error && !preventThrowingError) {
            // eslint-disable-next-line no-unsafe-finally
            throw error;
        }
        // eslint-disable-next-line no-unsafe-finally
        return result;
    }
}
async function safeExecuteInTheMiddleAsync(execute, onFinish, preventThrowingError) {
    let error;
    let result;
    try {
        result = await execute();
    } catch (e) {
        error = e;
    } finally{
        onFinish(error, result);
        if (error && !preventThrowingError) {
            // eslint-disable-next-line no-unsafe-finally
            throw error;
        }
        // eslint-disable-next-line no-unsafe-finally
        return result;
    }
}
function isWrapped(func) {
    return typeof func === 'function' && typeof func.__original === 'function' && typeof func.__unwrap === 'function' && func.__wrapped === true;
} //# sourceMappingURL=utils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/instrumentation.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InstrumentationBase",
    ()=>InstrumentationBase
]);
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
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$util__$5b$external$5d$__$28$util$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/util [external] (util, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semver$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/semver.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/shimmer.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentation$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/instrumentation.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$RequireInTheMiddleSingleton$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/RequireInTheMiddleSingleton.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$import$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$import$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$import$2d$in$2d$the$2d$middle$29$__ = __turbopack_context__.i("[externals]/import-in-the-middle [external] (import-in-the-middle, cjs, [project]/metacto/metacto-internal/context-stack/node_modules/import-in-the-middle)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/diag-api.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$require$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$require$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$require$2d$in$2d$the$2d$middle$29$__ = __turbopack_context__.i("[externals]/require-in-the-middle [external] (require-in-the-middle, cjs, [project]/metacto/metacto-internal/context-stack/node_modules/require-in-the-middle)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/fs [external] (fs, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/utils.js [instrumentation] (ecmascript)");
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
class InstrumentationBase extends __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentation$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["InstrumentationAbstract"] {
    _modules;
    _hooks = [];
    _requireInTheMiddleSingleton = __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$RequireInTheMiddleSingleton$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["RequireInTheMiddleSingleton"].getInstance();
    _enabled = false;
    constructor(instrumentationName, instrumentationVersion, config){
        super(instrumentationName, instrumentationVersion, config);
        let modules = this.init();
        if (modules && !Array.isArray(modules)) {
            modules = [
                modules
            ];
        }
        this._modules = modules || [];
        if (this._config.enabled) {
            this.enable();
        }
    }
    _wrap = (moduleExports, name, wrapper)=>{
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["isWrapped"])(moduleExports[name])) {
            this._unwrap(moduleExports, name);
        }
        if (!__TURBOPACK__imported__module__$5b$externals$5d2f$util__$5b$external$5d$__$28$util$2c$__cjs$29$__["types"].isProxy(moduleExports)) {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["wrap"])(moduleExports, name, wrapper);
        } else {
            const wrapped = (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["wrap"])(Object.assign({}, moduleExports), name, wrapper);
            Object.defineProperty(moduleExports, name, {
                value: wrapped
            });
            return wrapped;
        }
    };
    _unwrap = (moduleExports, name)=>{
        if (!__TURBOPACK__imported__module__$5b$externals$5d2f$util__$5b$external$5d$__$28$util$2c$__cjs$29$__["types"].isProxy(moduleExports)) {
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$shimmer$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["unwrap"])(moduleExports, name);
        } else {
            return Object.defineProperty(moduleExports, name, {
                value: moduleExports[name]
            });
        }
    };
    _massWrap = (moduleExportsArray, names, wrapper)=>{
        if (!moduleExportsArray) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error('must provide one or more modules to patch');
            return;
        } else if (!Array.isArray(moduleExportsArray)) {
            moduleExportsArray = [
                moduleExportsArray
            ];
        }
        if (!(names && Array.isArray(names))) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error('must provide one or more functions to wrap on modules');
            return;
        }
        moduleExportsArray.forEach((moduleExports)=>{
            names.forEach((name)=>{
                this._wrap(moduleExports, name, wrapper);
            });
        });
    };
    _massUnwrap = (moduleExportsArray, names)=>{
        if (!moduleExportsArray) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error('must provide one or more modules to patch');
            return;
        } else if (!Array.isArray(moduleExportsArray)) {
            moduleExportsArray = [
                moduleExportsArray
            ];
        }
        if (!(names && Array.isArray(names))) {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].error('must provide one or more functions to wrap on modules');
            return;
        }
        moduleExportsArray.forEach((moduleExports)=>{
            names.forEach((name)=>{
                this._unwrap(moduleExports, name);
            });
        });
    };
    _warnOnPreloadedModules() {
        this._modules.forEach((module)=>{
            const { name } = module;
            try {
                const resolvedModule = (()=>{
                    const e = new Error("Cannot find module as expression is too dynamic");
                    e.code = 'MODULE_NOT_FOUND';
                    throw e;
                })();
                if (__turbopack_context__.c[resolvedModule]) {
                    // Module is already cached, which means the instrumentation hook might not work
                    this._diag.warn(`Module ${name} has been loaded before ${this.instrumentationName} so it might not work, please initialize it before requiring ${name}`);
                }
            } catch  {
            // Module isn't available, we can simply skip
            }
        });
    }
    _extractPackageVersion(baseDir) {
        try {
            const json = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["readFileSync"])(__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["join"](baseDir, 'package.json'), {
                encoding: 'utf8'
            });
            const version = JSON.parse(json).version;
            return typeof version === 'string' ? version : undefined;
        } catch  {
            __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].warn('Failed extracting version', baseDir);
        }
        return undefined;
    }
    _onRequire(module, exports, name, baseDir) {
        if (!baseDir) {
            if (typeof module.patch === 'function') {
                module.moduleExports = exports;
                if (this._enabled) {
                    this._diag.debug('Applying instrumentation patch for nodejs core module on require hook', {
                        module: module.name
                    });
                    return module.patch(exports);
                }
            }
            return exports;
        }
        const version = this._extractPackageVersion(baseDir);
        module.moduleVersion = version;
        if (module.name === name) {
            // main module
            if (isSupported(module.supportedVersions, version, module.includePrerelease)) {
                if (typeof module.patch === 'function') {
                    module.moduleExports = exports;
                    if (this._enabled) {
                        this._diag.debug('Applying instrumentation patch for module on require hook', {
                            module: module.name,
                            version: module.moduleVersion,
                            baseDir
                        });
                        return module.patch(exports, module.moduleVersion);
                    }
                }
            }
            return exports;
        }
        // internal file
        const files = module.files ?? [];
        const normalizedName = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["normalize"](name);
        const supportedFileInstrumentations = files.filter((f)=>f.name === normalizedName).filter((f)=>isSupported(f.supportedVersions, version, module.includePrerelease));
        return supportedFileInstrumentations.reduce((patchedExports, file)=>{
            file.moduleExports = patchedExports;
            if (this._enabled) {
                this._diag.debug('Applying instrumentation patch for nodejs module file on require hook', {
                    module: module.name,
                    version: module.moduleVersion,
                    fileName: file.name,
                    baseDir
                });
                // patch signature is not typed, so we cast it assuming it's correct
                return file.patch(patchedExports, module.moduleVersion);
            }
            return patchedExports;
        }, exports);
    }
    enable() {
        if (this._enabled) {
            return;
        }
        this._enabled = true;
        // already hooked, just call patch again
        if (this._hooks.length > 0) {
            for (const module of this._modules){
                if (typeof module.patch === 'function' && module.moduleExports) {
                    this._diag.debug('Applying instrumentation patch for nodejs module on instrumentation enabled', {
                        module: module.name,
                        version: module.moduleVersion
                    });
                    module.patch(module.moduleExports, module.moduleVersion);
                }
                for (const file of module.files){
                    if (file.moduleExports) {
                        this._diag.debug('Applying instrumentation patch for nodejs module file on instrumentation enabled', {
                            module: module.name,
                            version: module.moduleVersion,
                            fileName: file.name
                        });
                        file.patch(file.moduleExports, module.moduleVersion);
                    }
                }
            }
            return;
        }
        this._warnOnPreloadedModules();
        for (const module of this._modules){
            const hookFn = (exports, name, baseDir)=>{
                if (!baseDir && __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["isAbsolute"](name)) {
                    const parsedPath = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["parse"](name);
                    name = parsedPath.name;
                    baseDir = parsedPath.dir;
                }
                return this._onRequire(module, exports, name, baseDir);
            };
            const onRequire = (exports, name, baseDir)=>{
                return this._onRequire(module, exports, name, baseDir);
            };
            // `RequireInTheMiddleSingleton` does not support absolute paths.
            // For an absolute paths, we must create a separate instance of the
            // require-in-the-middle `Hook`.
            const hook = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["isAbsolute"](module.name) ? new __TURBOPACK__imported__module__$5b$externals$5d2f$require$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$require$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$require$2d$in$2d$the$2d$middle$29$__["Hook"]([
                module.name
            ], {
                internals: true
            }, onRequire) : this._requireInTheMiddleSingleton.register(module.name, onRequire);
            this._hooks.push(hook);
            const esmHook = new __TURBOPACK__imported__module__$5b$externals$5d2f$import$2d$in$2d$the$2d$middle__$5b$external$5d$__$28$import$2d$in$2d$the$2d$middle$2c$__cjs$2c$__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f$import$2d$in$2d$the$2d$middle$29$__["Hook"]([
                module.name
            ], {
                internals: false
            }, hookFn);
            this._hooks.push(esmHook);
        }
    }
    disable() {
        if (!this._enabled) {
            return;
        }
        this._enabled = false;
        for (const module of this._modules){
            if (typeof module.unpatch === 'function' && module.moduleExports) {
                this._diag.debug('Removing instrumentation patch for nodejs module on instrumentation disabled', {
                    module: module.name,
                    version: module.moduleVersion
                });
                module.unpatch(module.moduleExports, module.moduleVersion);
            }
            for (const file of module.files){
                if (file.moduleExports) {
                    this._diag.debug('Removing instrumentation patch for nodejs module file on instrumentation disabled', {
                        module: module.name,
                        version: module.moduleVersion,
                        fileName: file.name
                    });
                    file.unpatch(file.moduleExports, module.moduleVersion);
                }
            }
        }
    }
    isEnabled() {
        return this._enabled;
    }
}
function isSupported(supportedVersions, version, includePrerelease) {
    if (typeof version === 'undefined') {
        // If we don't have the version, accept the wildcard case only
        return supportedVersions.includes('*');
    }
    return supportedVersions.some((supportedVersion)=>{
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semver$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["satisfies"])(version, supportedVersion, {
            includePrerelease
        });
    });
} //# sourceMappingURL=instrumentation.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/instrumentationNodeModuleDefinition.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 */ __turbopack_context__.s([
    "InstrumentationNodeModuleDefinition",
    ()=>InstrumentationNodeModuleDefinition
]);
class InstrumentationNodeModuleDefinition {
    name;
    supportedVersions;
    patch;
    unpatch;
    files;
    constructor(name, supportedVersions, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patch, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unpatch, files){
        this.name = name;
        this.supportedVersions = supportedVersions;
        this.patch = patch;
        this.unpatch = unpatch;
        this.files = files || [];
    }
} //# sourceMappingURL=instrumentationNodeModuleDefinition.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/instrumentationNodeModuleFile.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InstrumentationNodeModuleFile",
    ()=>InstrumentationNodeModuleFile
]);
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
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
;
class InstrumentationNodeModuleFile {
    supportedVersions;
    patch;
    unpatch;
    name;
    constructor(name, supportedVersions, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patch, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unpatch){
        this.supportedVersions = supportedVersions;
        this.patch = patch;
        this.unpatch = unpatch;
        this.name = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["normalize"])(name);
    }
} //# sourceMappingURL=instrumentationNodeModuleFile.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/semconvStability.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

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
 */ __turbopack_context__.s([
    "SemconvStability",
    ()=>SemconvStability,
    "semconvStabilityFromStr",
    ()=>semconvStabilityFromStr
]);
var SemconvStability;
(function(SemconvStability) {
    /** Emit only stable semantic conventions. */ SemconvStability[SemconvStability["STABLE"] = 1] = "STABLE";
    /** Emit only old semantic conventions. */ SemconvStability[SemconvStability["OLD"] = 2] = "OLD";
    /** Emit both stable and old semantic conventions. */ SemconvStability[SemconvStability["DUPLICATE"] = 3] = "DUPLICATE";
})(SemconvStability || (SemconvStability = {}));
function semconvStabilityFromStr(namespace, str) {
    let semconvStability = SemconvStability.OLD;
    // The same parsing of `str` as `getStringListFromEnv` from the core pkg.
    const entries = str?.split(',').map((v)=>v.trim()).filter((s)=>s !== '');
    for (const entry of entries ?? []){
        if (entry.toLowerCase() === namespace + '/dup') {
            // DUPLICATE takes highest precedence.
            semconvStability = SemconvStability.DUPLICATE;
            break;
        } else if (entry.toLowerCase() === namespace) {
            semconvStability = SemconvStability.STABLE;
        }
    }
    return semconvStability;
} //# sourceMappingURL=semconvStability.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "InstrumentationBase",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$instrumentation$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["InstrumentationBase"],
    "InstrumentationNodeModuleDefinition",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentationNodeModuleDefinition$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["InstrumentationNodeModuleDefinition"],
    "InstrumentationNodeModuleFile",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentationNodeModuleFile$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["InstrumentationNodeModuleFile"],
    "SemconvStability",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semconvStability$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["SemconvStability"],
    "isWrapped",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["isWrapped"],
    "registerInstrumentations",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoader$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["registerInstrumentations"],
    "safeExecuteInTheMiddle",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["safeExecuteInTheMiddle"],
    "safeExecuteInTheMiddleAsync",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["safeExecuteInTheMiddleAsync"],
    "semconvStabilityFromStr",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semconvStability$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["semconvStabilityFromStr"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$index$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$autoLoader$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/autoLoader.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$platform$2f$node$2f$instrumentation$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/platform/node/instrumentation.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentationNodeModuleDefinition$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/instrumentationNodeModuleDefinition.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$instrumentationNodeModuleFile$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/instrumentationNodeModuleFile.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$utils$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/utils.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$prisma$2f$instrumentation$2f$node_modules$2f40$opentelemetry$2f$instrumentation$2f$build$2f$esm$2f$semconvStability$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@prisma/instrumentation/node_modules/@opentelemetry/instrumentation/build/esm/semconvStability.js [instrumentation] (ecmascript)");
}),
];

//# debugId=45edcae4-b5a8-5e7f-2208-7117a1f2c804
//# sourceMappingURL=06187_680a7b82._.js.map