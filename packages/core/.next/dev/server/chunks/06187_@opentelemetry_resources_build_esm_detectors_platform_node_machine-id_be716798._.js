;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="6988bf03-1bc3-ae32-c62b-b4afc63a4aa1")}catch(e){}}();
module.exports = [
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/resources/build/esm/detectors/platform/node/machine-id/execAsync.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "execAsync",
    ()=>execAsync
]);
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f$child_process__$5b$external$5d$__$28$child_process$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/child_process [external] (child_process, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$util__$5b$external$5d$__$28$util$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/util [external] (util, cjs)");
;
;
const execAsync = __TURBOPACK__imported__module__$5b$externals$5d2f$util__$5b$external$5d$__$28$util$2c$__cjs$29$__["promisify"](__TURBOPACK__imported__module__$5b$externals$5d2f$child_process__$5b$external$5d$__$28$child_process$2c$__cjs$29$__["exec"]); //# sourceMappingURL=execAsync.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/resources/build/esm/detectors/platform/node/machine-id/getMachineId-win.js [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getMachineId",
    ()=>getMachineId
]);
/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f$process__$5b$external$5d$__$28$process$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/process [external] (process, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$resources$2f$build$2f$esm$2f$detectors$2f$platform$2f$node$2f$machine$2d$id$2f$execAsync$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/resources/build/esm/detectors/platform/node/machine-id/execAsync.js [instrumentation] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/diag-api.js [instrumentation] (ecmascript)");
;
;
;
async function getMachineId() {
    const args = 'QUERY HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid';
    let command = '%windir%\\System32\\REG.exe';
    if (__TURBOPACK__imported__module__$5b$externals$5d2f$process__$5b$external$5d$__$28$process$2c$__cjs$29$__["arch"] === 'ia32' && 'PROCESSOR_ARCHITEW6432' in __TURBOPACK__imported__module__$5b$externals$5d2f$process__$5b$external$5d$__$28$process$2c$__cjs$29$__["env"]) {
        command = '%windir%\\sysnative\\cmd.exe /c ' + command;
    }
    try {
        const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$resources$2f$build$2f$esm$2f$detectors$2f$platform$2f$node$2f$machine$2d$id$2f$execAsync$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["execAsync"])(`${command} ${args}`);
        const parts = result.stdout.split('REG_SZ');
        if (parts.length === 2) {
            return parts[1].trim();
        }
    } catch (e) {
        __TURBOPACK__imported__module__$5b$project$5d2f$metacto$2f$metacto$2d$internal$2f$context$2d$stack$2f$node_modules$2f40$opentelemetry$2f$api$2f$build$2f$esm$2f$diag$2d$api$2e$js__$5b$instrumentation$5d$__$28$ecmascript$29$__["diag"].debug(`error reading machine id: ${e}`);
    }
    return undefined;
} //# sourceMappingURL=getMachineId-win.js.map
}),
];

//# debugId=6988bf03-1bc3-ae32-c62b-b4afc63a4aa1
//# sourceMappingURL=06187_%40opentelemetry_resources_build_esm_detectors_platform_node_machine-id_be716798._.js.map