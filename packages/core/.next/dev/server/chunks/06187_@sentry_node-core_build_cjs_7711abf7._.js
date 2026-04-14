;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="1e9a6c8e-6f4a-b4e1-fdb3-f41d7a82f136")}catch(e){}}();
module.exports = [
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/otel/instrument.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const instrumentation = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript)");
/** Exported only for tests. */ const INSTRUMENTED = {};
/**
 * Instrument an OpenTelemetry instrumentation once.
 * This will skip running instrumentation again if it was already instrumented.
 */ function generateInstrumentOnce(name, // eslint-disable-next-line @typescript-eslint/no-explicit-any
creatorOrClass, optionsCallback) {
    if (optionsCallback) {
        return _generateInstrumentOnceWithOptions(name, creatorOrClass, optionsCallback);
    }
    return _generateInstrumentOnce(name, creatorOrClass);
}
// The plain version without handling of options
// Should not be used with custom options that are mutated in the creator!
function _generateInstrumentOnce(name, creator) {
    return Object.assign((options)=>{
        const instrumented = INSTRUMENTED[name];
        if (instrumented) {
            // If options are provided, ensure we update them
            if (options) {
                instrumented.setConfig(options);
            }
            return instrumented;
        }
        const instrumentation$1 = creator(options);
        INSTRUMENTED[name] = instrumentation$1;
        instrumentation.registerInstrumentations({
            instrumentations: [
                instrumentation$1
            ]
        });
        return instrumentation$1;
    }, {
        id: name
    });
}
// This version handles options properly
function _generateInstrumentOnceWithOptions(name, instrumentationClass, optionsCallback) {
    return Object.assign((_options)=>{
        const options = optionsCallback(_options);
        const instrumented = INSTRUMENTED[name];
        if (instrumented) {
            // Ensure we update options
            instrumented.setConfig(options);
            return instrumented;
        }
        const instrumentation$1 = new instrumentationClass(options);
        INSTRUMENTED[name] = instrumentation$1;
        instrumentation.registerInstrumentations({
            instrumentations: [
                instrumentation$1
            ]
        });
        return instrumentation$1;
    }, {
        id: name
    });
}
/**
 * Ensure a given callback is called when the instrumentation is actually wrapping something.
 * This can be used to ensure some logic is only called when the instrumentation is actually active.
 *
 * This function returns a function that can be invoked with a callback.
 * This callback will either be invoked immediately
 * (e.g. if the instrumentation was already wrapped, or if _wrap could not be patched),
 * or once the instrumentation is actually wrapping something.
 *
 * Make sure to call this function right after adding the instrumentation, otherwise it may be too late!
 * The returned callback can be used any time, and also multiple times.
 */ function instrumentWhenWrapped(instrumentation) {
    let isWrapped = false;
    let callbacks = [];
    if (!hasWrap(instrumentation)) {
        isWrapped = true;
    } else {
        const originalWrap = instrumentation['_wrap'];
        instrumentation['_wrap'] = (...args)=>{
            isWrapped = true;
            callbacks.forEach((callback)=>callback());
            callbacks = [];
            return originalWrap(...args);
        };
    }
    const registerCallback = (callback)=>{
        if (isWrapped) {
            callback();
        } else {
            callbacks.push(callback);
        }
    };
    return registerCallback;
}
function hasWrap(instrumentation) {
    return typeof instrumentation['_wrap'] === 'function';
}
exports.INSTRUMENTED = INSTRUMENTED;
exports.generateInstrumentOnce = generateInstrumentOnce;
exports.instrumentWhenWrapped = instrumentWhenWrapped; //# sourceMappingURL=instrument.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/debug-build.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
/**
 * This serves as a build time flag that will be true by default, but false in non-debug builds or if users replace `__SENTRY_DEBUG__` in their generated code.
 *
 * ATTENTION: This constant must never cross package boundaries (i.e. be exported) to guarantee that it can be used for tree shaking.
 */ const DEBUG_BUILD = typeof __SENTRY_DEBUG__ === 'undefined' || __SENTRY_DEBUG__;
exports.DEBUG_BUILD = DEBUG_BUILD; //# sourceMappingURL=debug-build.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/constants.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const INSTRUMENTATION_NAME = '@sentry/instrumentation-http';
/** We only want to capture request bodies up to 1mb. */ const MAX_BODY_BYTE_LENGTH = 1024 * 1024;
exports.INSTRUMENTATION_NAME = INSTRUMENTATION_NAME;
exports.MAX_BODY_BYTE_LENGTH = MAX_BODY_BYTE_LENGTH; //# sourceMappingURL=constants.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/captureRequestBody.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/debug-build.js [instrumentation] (ecmascript)");
const constants = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/constants.js [instrumentation] (ecmascript)");
/**
 * This method patches the request object to capture the body.
 * Instead of actually consuming the streamed body ourselves, which has potential side effects,
 * we monkey patch `req.on('data')` to intercept the body chunks.
 * This way, we only read the body if the user also consumes the body, ensuring we do not change any behavior in unexpected ways.
 */ function patchRequestToCaptureBody(req, isolationScope, maxIncomingRequestBodySize, integrationName) {
    let bodyByteLength = 0;
    const chunks = [];
    debugBuild.DEBUG_BUILD && core.debug.log(integrationName, 'Patching request.on');
    /**
   * We need to keep track of the original callbacks, in order to be able to remove listeners again.
   * Since `off` depends on having the exact same function reference passed in, we need to be able to map
   * original listeners to our wrapped ones.
   */ const callbackMap = new WeakMap();
    const maxBodySize = maxIncomingRequestBodySize === 'small' ? 1000 : maxIncomingRequestBodySize === 'medium' ? 10000 : constants.MAX_BODY_BYTE_LENGTH;
    try {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        req.on = new Proxy(req.on, {
            apply: (target, thisArg, args)=>{
                const [event, listener, ...restArgs] = args;
                if (event === 'data') {
                    debugBuild.DEBUG_BUILD && core.debug.log(integrationName, `Handling request.on("data") with maximum body size of ${maxBodySize}b`);
                    const callback = new Proxy(listener, {
                        apply: (target, thisArg, args)=>{
                            try {
                                const chunk = args[0];
                                const bufferifiedChunk = Buffer.from(chunk);
                                if (bodyByteLength < maxBodySize) {
                                    chunks.push(bufferifiedChunk);
                                    bodyByteLength += bufferifiedChunk.byteLength;
                                } else if (debugBuild.DEBUG_BUILD) {
                                    core.debug.log(integrationName, `Dropping request body chunk because maximum body length of ${maxBodySize}b is exceeded.`);
                                }
                            } catch (err) {
                                debugBuild.DEBUG_BUILD && core.debug.error(integrationName, 'Encountered error while storing body chunk.');
                            }
                            return Reflect.apply(target, thisArg, args);
                        }
                    });
                    callbackMap.set(listener, callback);
                    return Reflect.apply(target, thisArg, [
                        event,
                        callback,
                        ...restArgs
                    ]);
                }
                return Reflect.apply(target, thisArg, args);
            }
        });
        // Ensure we also remove callbacks correctly
        // eslint-disable-next-line @typescript-eslint/unbound-method
        req.off = new Proxy(req.off, {
            apply: (target, thisArg, args)=>{
                const [, listener] = args;
                const callback = callbackMap.get(listener);
                if (callback) {
                    callbackMap.delete(listener);
                    const modifiedArgs = args.slice();
                    modifiedArgs[1] = callback;
                    return Reflect.apply(target, thisArg, modifiedArgs);
                }
                return Reflect.apply(target, thisArg, args);
            }
        });
        req.on('end', ()=>{
            try {
                const body = Buffer.concat(chunks).toString('utf-8');
                if (body) {
                    // Using Buffer.byteLength here, because the body may contain characters that are not 1 byte long
                    const bodyByteLength = Buffer.byteLength(body, 'utf-8');
                    const truncatedBody = bodyByteLength > maxBodySize ? `${Buffer.from(body).subarray(0, maxBodySize - 3).toString('utf-8')}...` : body;
                    isolationScope.setSDKProcessingMetadata({
                        normalizedRequest: {
                            data: truncatedBody
                        }
                    });
                }
            } catch (error) {
                if (debugBuild.DEBUG_BUILD) {
                    core.debug.error(integrationName, 'Error building captured request body', error);
                }
            }
        });
    } catch (error) {
        if (debugBuild.DEBUG_BUILD) {
            core.debug.error(integrationName, 'Error patching request to capture body', error);
        }
    }
}
exports.patchRequestToCaptureBody = patchRequestToCaptureBody; //# sourceMappingURL=captureRequestBody.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/httpServerIntegration.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const diagnosticsChannel = __turbopack_context__.r("[externals]/node:diagnostics_channel [external] (node:diagnostics_channel, cjs)");
const api = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/index.js [instrumentation] (ecmascript)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/debug-build.js [instrumentation] (ecmascript)");
const captureRequestBody = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/captureRequestBody.js [instrumentation] (ecmascript)");
const HTTP_SERVER_INSTRUMENTED_KEY = api.createContextKey('sentry_http_server_instrumented');
const INTEGRATION_NAME = 'Http.Server';
const clientToRequestSessionAggregatesMap = new Map();
// We keep track of emit functions we wrapped, to avoid double wrapping
// We do this instead of putting a non-enumerable property on the function, because
// sometimes the property seems to be migrated to forks of the emit function, which we do not want to happen
// This was the case in the nestjs-distributed-tracing E2E test
const wrappedEmitFns = new WeakSet();
/**
 * Add a callback to the request object that will be called when the request is started.
 * The callback will receive the next function to continue processing the request.
 */ function addStartSpanCallback(request, callback) {
    core.addNonEnumerableProperty(request, '_startSpanCallback', new WeakRef(callback));
}
const _httpServerIntegration = (options = {})=>{
    const _options = {
        sessions: options.sessions ?? true,
        sessionFlushingDelayMS: options.sessionFlushingDelayMS ?? 60000,
        maxRequestBodySize: options.maxRequestBodySize ?? 'medium',
        ignoreRequestBody: options.ignoreRequestBody
    };
    return {
        name: INTEGRATION_NAME,
        setupOnce () {
            const onHttpServerRequestStart = (_data)=>{
                const data = _data;
                instrumentServer(data.server, _options);
            };
            diagnosticsChannel.subscribe('http.server.request.start', onHttpServerRequestStart);
        },
        afterAllSetup (client) {
            if (debugBuild.DEBUG_BUILD && client.getIntegrationByName('Http')) {
                core.debug.warn('It seems that you have manually added `httpServerIntegration` while `httpIntegration` is also present. Make sure to remove `httpServerIntegration` when adding `httpIntegration`.');
            }
        }
    };
};
/**
 * This integration handles request isolation, trace continuation and other core Sentry functionality around incoming http requests
 * handled via the node `http` module.
 *
 * This version uses OpenTelemetry for context propagation and span management.
 *
 * @see {@link ../../light/integrations/httpServerIntegration.ts} for the lightweight version without OpenTelemetry
 */ const httpServerIntegration = _httpServerIntegration;
/**
 * Instrument a server to capture incoming requests.
 *
 */ function instrumentServer(server, { ignoreRequestBody, maxRequestBodySize, sessions, sessionFlushingDelayMS }) {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalEmit = server.emit;
    if (wrappedEmitFns.has(originalEmit)) {
        return;
    }
    const newEmit = new Proxy(originalEmit, {
        apply (target, thisArg, args) {
            // Only traces request events
            if (args[0] !== 'request') {
                return target.apply(thisArg, args);
            }
            const client = core.getClient();
            // Make sure we do not double execute our wrapper code, for edge cases...
            // Without this check, if we double-wrap emit, for whatever reason, you'd get two http.server spans (one the children of the other)
            if (api.context.active().getValue(HTTP_SERVER_INSTRUMENTED_KEY) || !client) {
                return target.apply(thisArg, args);
            }
            debugBuild.DEBUG_BUILD && core.debug.log(INTEGRATION_NAME, 'Handling incoming request');
            const isolationScope = core.getIsolationScope().clone();
            const request = args[1];
            const response = args[2];
            const normalizedRequest = core.httpRequestToRequestData(request);
            // request.ip is non-standard but some frameworks set this
            const ipAddress = request.ip || request.socket?.remoteAddress;
            const url = request.url || '/';
            if (maxRequestBodySize !== 'none' && !ignoreRequestBody?.(url, request)) {
                captureRequestBody.patchRequestToCaptureBody(request, isolationScope, maxRequestBodySize, INTEGRATION_NAME);
            }
            // Update the isolation scope, isolate this request
            isolationScope.setSDKProcessingMetadata({
                normalizedRequest,
                ipAddress
            });
            // attempt to update the scope's `transactionName` based on the request URL
            // Ideally, framework instrumentations coming after the HttpInstrumentation
            // update the transactionName once we get a parameterized route.
            const httpMethod = (request.method || 'GET').toUpperCase();
            const httpTargetWithoutQueryFragment = core.stripUrlQueryAndFragment(url);
            const bestEffortTransactionName = `${httpMethod} ${httpTargetWithoutQueryFragment}`;
            isolationScope.setTransactionName(bestEffortTransactionName);
            if (sessions && client) {
                recordRequestSession(client, {
                    requestIsolationScope: isolationScope,
                    response,
                    sessionFlushingDelayMS: sessionFlushingDelayMS ?? 60000
                });
            }
            return core.withIsolationScope(isolationScope, ()=>{
                // Set a new propagationSpanId for this request
                // We rely on the fact that `withIsolationScope()` will implicitly also fork the current scope
                // This way we can save an "unnecessary" `withScope()` invocation
                core.getCurrentScope().getPropagationContext().propagationSpanId = core.generateSpanId();
                const ctx = api.propagation.extract(api.context.active(), normalizedRequest.headers).setValue(HTTP_SERVER_INSTRUMENTED_KEY, true);
                return api.context.with(ctx, ()=>{
                    // This is used (optionally) by the httpServerSpansIntegration to attach _startSpanCallback to the request object
                    client.emit('httpServerRequest', request, response, normalizedRequest);
                    const callback = request._startSpanCallback?.deref();
                    if (callback) {
                        return callback(()=>target.apply(thisArg, args));
                    }
                    return target.apply(thisArg, args);
                });
            });
        }
    });
    wrappedEmitFns.add(newEmit);
    server.emit = newEmit;
}
/**
 * Starts a session and tracks it in the context of a given isolation scope.
 * When the passed response is finished, the session is put into a task and is
 * aggregated with other sessions that may happen in a certain time window
 * (sessionFlushingDelayMs).
 *
 * The sessions are always aggregated by the client that is on the current scope
 * at the time of ending the response (if there is one).
 */ // Exported for unit tests
function recordRequestSession(client, { requestIsolationScope, response, sessionFlushingDelayMS }) {
    requestIsolationScope.setSDKProcessingMetadata({
        requestSession: {
            status: 'ok'
        }
    });
    response.once('close', ()=>{
        const requestSession = requestIsolationScope.getScopeData().sdkProcessingMetadata.requestSession;
        if (client && requestSession) {
            debugBuild.DEBUG_BUILD && core.debug.log(`Recorded request session with status: ${requestSession.status}`);
            const roundedDate = new Date();
            roundedDate.setSeconds(0, 0);
            const dateBucketKey = roundedDate.toISOString();
            const existingClientAggregate = clientToRequestSessionAggregatesMap.get(client);
            const bucket = existingClientAggregate?.[dateBucketKey] || {
                exited: 0,
                crashed: 0,
                errored: 0
            };
            bucket[({
                ok: 'exited',
                crashed: 'crashed',
                errored: 'errored'
            })[requestSession.status]]++;
            if (existingClientAggregate) {
                existingClientAggregate[dateBucketKey] = bucket;
            } else {
                debugBuild.DEBUG_BUILD && core.debug.log('Opened new request session aggregate.');
                const newClientAggregate = {
                    [dateBucketKey]: bucket
                };
                clientToRequestSessionAggregatesMap.set(client, newClientAggregate);
                const flushPendingClientAggregates = ()=>{
                    clearTimeout(timeout);
                    unregisterClientFlushHook();
                    clientToRequestSessionAggregatesMap.delete(client);
                    const aggregatePayload = Object.entries(newClientAggregate).map(([timestamp, value])=>({
                            started: timestamp,
                            exited: value.exited,
                            errored: value.errored,
                            crashed: value.crashed
                        }));
                    client.sendSession({
                        aggregates: aggregatePayload
                    });
                };
                const unregisterClientFlushHook = client.on('flush', ()=>{
                    debugBuild.DEBUG_BUILD && core.debug.log('Sending request session aggregate due to client flush');
                    flushPendingClientAggregates();
                });
                const timeout = setTimeout(()=>{
                    debugBuild.DEBUG_BUILD && core.debug.log('Sending request session aggregate due to flushing schedule');
                    flushPendingClientAggregates();
                }, sessionFlushingDelayMS).unref();
            }
        }
    });
}
exports.addStartSpanCallback = addStartSpanCallback;
exports.httpServerIntegration = httpServerIntegration;
exports.recordRequestSession = recordRequestSession; //# sourceMappingURL=httpServerIntegration.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/httpServerSpansIntegration.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const node_events = __turbopack_context__.r("[externals]/node:events [external] (node:events, cjs)");
const api = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/index.js [instrumentation] (ecmascript)");
const core$1 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/core/build/esm/index.js [instrumentation] (ecmascript)");
const semanticConventions = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/semantic-conventions/build/esm/index.js [instrumentation] (ecmascript)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/debug-build.js [instrumentation] (ecmascript)");
const httpServerIntegration = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/httpServerIntegration.js [instrumentation] (ecmascript)");
const INTEGRATION_NAME = 'Http.ServerSpans';
// Tree-shakable guard to remove all code related to tracing
const _httpServerSpansIntegration = (options = {})=>{
    const ignoreStaticAssets = options.ignoreStaticAssets ?? true;
    const ignoreIncomingRequests = options.ignoreIncomingRequests;
    const ignoreStatusCodes = options.ignoreStatusCodes ?? [
        [
            401,
            404
        ],
        // 300 and 304 are possibly valid status codes we do not want to filter
        [
            301,
            303
        ],
        [
            305,
            399
        ]
    ];
    const { onSpanCreated } = options;
    // eslint-disable-next-line deprecation/deprecation
    const { requestHook, responseHook, applyCustomAttributesOnSpan } = options.instrumentation ?? {};
    return {
        name: INTEGRATION_NAME,
        setup (client) {
            // If no tracing, we can just skip everything here
            if (typeof __SENTRY_TRACING__ !== 'undefined' && !__SENTRY_TRACING__) {
                return;
            }
            client.on('httpServerRequest', (_request, _response, normalizedRequest)=>{
                // Type-casting this here because we do not want to put the node types into core
                const request = _request;
                const response = _response;
                const startSpan = (next)=>{
                    if (shouldIgnoreSpansForIncomingRequest(request, {
                        ignoreStaticAssets,
                        ignoreIncomingRequests
                    })) {
                        debugBuild.DEBUG_BUILD && core.debug.log(INTEGRATION_NAME, 'Skipping span creation for incoming request', request.url);
                        return next();
                    }
                    const fullUrl = normalizedRequest.url || request.url || '/';
                    const urlObj = core.parseStringToURLObject(fullUrl);
                    const headers = request.headers;
                    const userAgent = headers['user-agent'];
                    const ips = headers['x-forwarded-for'];
                    const httpVersion = request.httpVersion;
                    const host = headers.host;
                    const hostname = host?.replace(/^(.*)(:[0-9]{1,5})/, '$1') || 'localhost';
                    const tracer = client.tracer;
                    const scheme = fullUrl.startsWith('https') ? 'https' : 'http';
                    const method = normalizedRequest.method || request.method?.toUpperCase() || 'GET';
                    const httpTargetWithoutQueryFragment = urlObj ? urlObj.pathname : core.stripUrlQueryAndFragment(fullUrl);
                    const bestEffortTransactionName = `${method} ${httpTargetWithoutQueryFragment}`;
                    // We use the plain tracer.startSpan here so we can pass the span kind
                    const span = tracer.startSpan(bestEffortTransactionName, {
                        kind: api.SpanKind.SERVER,
                        attributes: {
                            // Sentry specific attributes
                            [core.SEMANTIC_ATTRIBUTE_SENTRY_OP]: 'http.server',
                            [core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.http.otel.http',
                            'sentry.http.prefetch': isKnownPrefetchRequest(request) || undefined,
                            // Old Semantic Conventions attributes - added for compatibility with what `@opentelemetry/instrumentation-http` output before
                            'http.url': fullUrl,
                            'http.method': normalizedRequest.method,
                            'http.target': urlObj ? `${urlObj.pathname}${urlObj.search}` : httpTargetWithoutQueryFragment,
                            'http.host': host,
                            'net.host.name': hostname,
                            'http.client_ip': typeof ips === 'string' ? ips.split(',')[0] : undefined,
                            'http.user_agent': userAgent,
                            'http.scheme': scheme,
                            'http.flavor': httpVersion,
                            'net.transport': httpVersion?.toUpperCase() === 'QUIC' ? 'ip_udp' : 'ip_tcp',
                            ...getRequestContentLengthAttribute(request),
                            ...core.httpHeadersToSpanAttributes(normalizedRequest.headers || {}, client.getOptions().sendDefaultPii ?? false)
                        }
                    });
                    // TODO v11: Remove the following three hooks, only onSpanCreated should remain
                    requestHook?.(span, request);
                    responseHook?.(span, response);
                    applyCustomAttributesOnSpan?.(span, request, response);
                    onSpanCreated?.(span, request, response);
                    const rpcMetadata = {
                        type: core$1.RPCType.HTTP,
                        span
                    };
                    return api.context.with(core$1.setRPCMetadata(api.trace.setSpan(api.context.active(), span), rpcMetadata), ()=>{
                        api.context.bind(api.context.active(), request);
                        api.context.bind(api.context.active(), response);
                        // Ensure we only end the span once
                        // E.g. error can be emitted before close is emitted
                        let isEnded = false;
                        function endSpan(status) {
                            if (isEnded) {
                                return;
                            }
                            isEnded = true;
                            const newAttributes = getIncomingRequestAttributesOnResponse(request, response);
                            span.setAttributes(newAttributes);
                            span.setStatus(status);
                            span.end();
                            // Update the transaction name if the route has changed
                            const route = newAttributes['http.route'];
                            if (route) {
                                core.getIsolationScope().setTransactionName(`${request.method?.toUpperCase() || 'GET'} ${route}`);
                            }
                        }
                        response.on('close', ()=>{
                            endSpan(core.getSpanStatusFromHttpCode(response.statusCode));
                        });
                        response.on(node_events.errorMonitor, ()=>{
                            const httpStatus = core.getSpanStatusFromHttpCode(response.statusCode);
                            // Ensure we def. have an error status here
                            endSpan(httpStatus.code === core.SPAN_STATUS_ERROR ? httpStatus : {
                                code: core.SPAN_STATUS_ERROR
                            });
                        });
                        return next();
                    });
                };
                httpServerIntegration.addStartSpanCallback(request, startSpan);
            });
        },
        processEvent (event) {
            // Drop transaction if it has a status code that should be ignored
            if (event.type === 'transaction') {
                const statusCode = event.contexts?.trace?.data?.['http.response.status_code'];
                if (typeof statusCode === 'number') {
                    const shouldDrop = shouldFilterStatusCode(statusCode, ignoreStatusCodes);
                    if (shouldDrop) {
                        debugBuild.DEBUG_BUILD && core.debug.log('Dropping transaction due to status code', statusCode);
                        return null;
                    }
                }
            }
            return event;
        },
        afterAllSetup (client) {
            if (!debugBuild.DEBUG_BUILD) {
                return;
            }
            if (client.getIntegrationByName('Http')) {
                core.debug.warn('It seems that you have manually added `httpServerSpansIntergation` while `httpIntegration` is also present. Make sure to remove `httpIntegration` when adding `httpServerSpansIntegration`.');
            }
            if (!client.getIntegrationByName('Http.Server')) {
                core.debug.error('It seems that you have manually added `httpServerSpansIntergation` without adding `httpServerIntegration`. This is a requiement for spans to be created - please add the `httpServerIntegration` integration.');
            }
        }
    };
};
/**
 * This integration emits spans for incoming requests handled via the node `http` module.
 * It requires the `httpServerIntegration` to be present.
 */ const httpServerSpansIntegration = _httpServerSpansIntegration;
function isKnownPrefetchRequest(req) {
    // Currently only handles Next.js prefetch requests but may check other frameworks in the future.
    return req.headers['next-router-prefetch'] === '1';
}
/**
 * Check if a request is for a common static asset that should be ignored by default.
 *
 * Only exported for tests.
 */ function isStaticAssetRequest(urlPath) {
    const path = core.stripUrlQueryAndFragment(urlPath);
    // Common static file extensions
    if (path.match(/\.(ico|png|jpg|jpeg|gif|svg|css|js|woff|woff2|ttf|eot|webp|avif)$/)) {
        return true;
    }
    // Common metadata files
    if (path.match(/^\/(robots\.txt|sitemap\.xml|manifest\.json|browserconfig\.xml)$/)) {
        return true;
    }
    return false;
}
function shouldIgnoreSpansForIncomingRequest(request, { ignoreStaticAssets, ignoreIncomingRequests }) {
    if (core$1.isTracingSuppressed(api.context.active())) {
        return true;
    }
    // request.url is the only property that holds any information about the url
    // it only consists of the URL path and query string (if any)
    const urlPath = request.url;
    const method = request.method?.toUpperCase();
    // We do not capture OPTIONS/HEAD requests as spans
    if (method === 'OPTIONS' || method === 'HEAD' || !urlPath) {
        return true;
    }
    // Default static asset filtering
    if (ignoreStaticAssets && method === 'GET' && isStaticAssetRequest(urlPath)) {
        return true;
    }
    if (ignoreIncomingRequests?.(urlPath, request)) {
        return true;
    }
    return false;
}
function getRequestContentLengthAttribute(request) {
    const length = getContentLength(request.headers);
    if (length == null) {
        return {};
    }
    if (isCompressed(request.headers)) {
        return {
            ['http.request_content_length']: length
        };
    } else {
        return {
            ['http.request_content_length_uncompressed']: length
        };
    }
}
function getContentLength(headers) {
    const contentLengthHeader = headers['content-length'];
    if (contentLengthHeader === undefined) return null;
    const contentLength = parseInt(contentLengthHeader, 10);
    if (isNaN(contentLength)) return null;
    return contentLength;
}
function isCompressed(headers) {
    const encoding = headers['content-encoding'];
    return !!encoding && encoding !== 'identity';
}
function getIncomingRequestAttributesOnResponse(request, response) {
    // take socket from the request,
    // since it may be detached from the response object in keep-alive mode
    const { socket } = request;
    const { statusCode, statusMessage } = response;
    const newAttributes = {
        [semanticConventions.ATTR_HTTP_RESPONSE_STATUS_CODE]: statusCode,
        // eslint-disable-next-line deprecation/deprecation
        [semanticConventions.SEMATTRS_HTTP_STATUS_CODE]: statusCode,
        'http.status_text': statusMessage?.toUpperCase()
    };
    const rpcMetadata = core$1.getRPCMetadata(api.context.active());
    if (socket) {
        const { localAddress, localPort, remoteAddress, remotePort } = socket;
        // eslint-disable-next-line deprecation/deprecation
        newAttributes[semanticConventions.SEMATTRS_NET_HOST_IP] = localAddress;
        // eslint-disable-next-line deprecation/deprecation
        newAttributes[semanticConventions.SEMATTRS_NET_HOST_PORT] = localPort;
        // eslint-disable-next-line deprecation/deprecation
        newAttributes[semanticConventions.SEMATTRS_NET_PEER_IP] = remoteAddress;
        newAttributes['net.peer.port'] = remotePort;
    }
    // eslint-disable-next-line deprecation/deprecation
    newAttributes[semanticConventions.SEMATTRS_HTTP_STATUS_CODE] = statusCode;
    newAttributes['http.status_text'] = (statusMessage || '').toUpperCase();
    if (rpcMetadata?.type === core$1.RPCType.HTTP && rpcMetadata.route !== undefined) {
        const routeName = rpcMetadata.route;
        newAttributes[semanticConventions.ATTR_HTTP_ROUTE] = routeName;
    }
    return newAttributes;
}
/**
 * If the given status code should be filtered for the given list of status codes/ranges.
 */ function shouldFilterStatusCode(statusCode, dropForStatusCodes) {
    return dropForStatusCodes.some((code)=>{
        if (typeof code === 'number') {
            return code === statusCode;
        }
        const [min, max] = code;
        return statusCode >= min && statusCode <= max;
    });
}
exports.httpServerSpansIntegration = httpServerSpansIntegration;
exports.isStaticAssetRequest = isStaticAssetRequest; //# sourceMappingURL=httpServerSpansIntegration.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/getRequestUrl.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
/** Build a full URL from request options. */ function getRequestUrl(requestOptions) {
    const protocol = requestOptions.protocol || '';
    const hostname = requestOptions.hostname || requestOptions.host || '';
    // Don't log standard :80 (http) and :443 (https) ports to reduce the noise
    // Also don't add port if the hostname already includes a port
    const port = !requestOptions.port || requestOptions.port === 80 || requestOptions.port === 443 || /^(.*):(\d+)$/.test(hostname) ? '' : `:${requestOptions.port}`;
    const path = requestOptions.path ? requestOptions.path : '/';
    return `${protocol}//${hostname}${port}${path}`;
}
exports.getRequestUrl = getRequestUrl; //# sourceMappingURL=getRequestUrl.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/baggage.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
/**
 * Merge two baggage headers into one, where the existing one takes precedence.
 * The order of the existing baggage will be preserved, and new entries will be added to the end.
 */ function mergeBaggageHeaders(existing, baggage) {
    if (!existing) {
        return baggage;
    }
    const existingBaggageEntries = core.parseBaggageHeader(existing);
    const newBaggageEntries = core.parseBaggageHeader(baggage);
    if (!newBaggageEntries) {
        return existing;
    }
    // Existing entries take precedence, ensuring order remains stable for minimal changes
    const mergedBaggageEntries = {
        ...existingBaggageEntries
    };
    Object.entries(newBaggageEntries).forEach(([key, value])=>{
        if (!mergedBaggageEntries[key]) {
            mergedBaggageEntries[key] = value;
        }
    });
    return core.objectToBaggageHeader(mergedBaggageEntries);
}
exports.mergeBaggageHeaders = mergeBaggageHeaders; //# sourceMappingURL=baggage.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/outgoingHttpRequest.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/debug-build.js [instrumentation] (ecmascript)");
const baggage = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/baggage.js [instrumentation] (ecmascript)");
const LOG_PREFIX = '@sentry/instrumentation-http';
/** Add a breadcrumb for outgoing requests. */ function addRequestBreadcrumb(request, response) {
    const data = getBreadcrumbData(request);
    const statusCode = response?.statusCode;
    const level = core.getBreadcrumbLogLevelFromHttpStatusCode(statusCode);
    core.addBreadcrumb({
        category: 'http',
        data: {
            status_code: statusCode,
            ...data
        },
        type: 'http',
        level
    }, {
        event: 'response',
        request,
        response
    });
}
/**
 * Add trace propagation headers to an outgoing request.
 * This must be called _before_ the request is sent!
 */ // eslint-disable-next-line complexity
function addTracePropagationHeadersToOutgoingRequest(request, propagationDecisionMap) {
    const url = getRequestUrl(request);
    const { tracePropagationTargets, propagateTraceparent } = core.getClient()?.getOptions() || {};
    const headersToAdd = core.shouldPropagateTraceForUrl(url, tracePropagationTargets, propagationDecisionMap) ? core.getTraceData({
        propagateTraceparent
    }) : undefined;
    if (!headersToAdd) {
        return;
    }
    const { 'sentry-trace': sentryTrace, baggage: baggage$1, traceparent } = headersToAdd;
    if (sentryTrace && !request.getHeader('sentry-trace')) {
        try {
            request.setHeader('sentry-trace', sentryTrace);
            debugBuild.DEBUG_BUILD && core.debug.log(LOG_PREFIX, 'Added sentry-trace header to outgoing request');
        } catch (error) {
            debugBuild.DEBUG_BUILD && core.debug.error(LOG_PREFIX, 'Failed to add sentry-trace header to outgoing request:', core.isError(error) ? error.message : 'Unknown error');
        }
    }
    if (traceparent && !request.getHeader('traceparent')) {
        try {
            request.setHeader('traceparent', traceparent);
            debugBuild.DEBUG_BUILD && core.debug.log(LOG_PREFIX, 'Added traceparent header to outgoing request');
        } catch (error) {
            debugBuild.DEBUG_BUILD && core.debug.error(LOG_PREFIX, 'Failed to add traceparent header to outgoing request:', core.isError(error) ? error.message : 'Unknown error');
        }
    }
    if (baggage$1) {
        const newBaggage = baggage.mergeBaggageHeaders(request.getHeader('baggage'), baggage$1);
        if (newBaggage) {
            try {
                request.setHeader('baggage', newBaggage);
                debugBuild.DEBUG_BUILD && core.debug.log(LOG_PREFIX, 'Added baggage header to outgoing request');
            } catch (error) {
                debugBuild.DEBUG_BUILD && core.debug.error(LOG_PREFIX, 'Failed to add baggage header to outgoing request:', core.isError(error) ? error.message : 'Unknown error');
            }
        }
    }
}
function getBreadcrumbData(request) {
    try {
        // `request.host` does not contain the port, but the host header does
        const host = request.getHeader('host') || request.host;
        const url = new URL(request.path, `${request.protocol}//${host}`);
        const parsedUrl = core.parseUrl(url.toString());
        const data = {
            url: core.getSanitizedUrlString(parsedUrl),
            'http.method': request.method || 'GET'
        };
        if (parsedUrl.search) {
            data['http.query'] = parsedUrl.search;
        }
        if (parsedUrl.hash) {
            data['http.fragment'] = parsedUrl.hash;
        }
        return data;
    } catch  {
        return {};
    }
}
/** Convert an outgoing request to request options. */ function getRequestOptions(request) {
    return {
        method: request.method,
        protocol: request.protocol,
        host: request.host,
        hostname: request.host,
        path: request.path,
        headers: request.getHeaders()
    };
}
function getRequestUrl(request) {
    const hostname = request.getHeader('host') || request.host;
    const protocol = request.protocol;
    const path = request.path;
    return `${protocol}//${hostname}${path}`;
}
exports.addRequestBreadcrumb = addRequestBreadcrumb;
exports.addTracePropagationHeadersToOutgoingRequest = addTracePropagationHeadersToOutgoingRequest;
exports.getRequestOptions = getRequestOptions; //# sourceMappingURL=outgoingHttpRequest.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/SentryHttpInstrumentation.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const diagnosticsChannel = __turbopack_context__.r("[externals]/node:diagnostics_channel [external] (node:diagnostics_channel, cjs)");
const api = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/index.js [instrumentation] (ecmascript)");
const core$1 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/core/build/esm/index.js [instrumentation] (ecmascript)");
const instrumentation = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/debug-build.js [instrumentation] (ecmascript)");
const getRequestUrl = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/getRequestUrl.js [instrumentation] (ecmascript)");
const constants = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/constants.js [instrumentation] (ecmascript)");
const outgoingHttpRequest = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/outgoingHttpRequest.js [instrumentation] (ecmascript)");
/**
 * This custom HTTP instrumentation is used to isolate incoming requests and annotate them with additional information.
 * It does not emit any spans.
 *
 * The reason this is isolated from the OpenTelemetry instrumentation is that users may overwrite this,
 * which would lead to Sentry not working as expected.
 *
 * Important note: Contrary to other OTEL instrumentation, this one cannot be unwrapped.
 * It only does minimal things though and does not emit any spans.
 *
 * This is heavily inspired & adapted from:
 * https://github.com/open-telemetry/opentelemetry-js/blob/f8ab5592ddea5cba0a3b33bf8d74f27872c0367f/experimental/packages/opentelemetry-instrumentation-http/src/http.ts
 */ class SentryHttpInstrumentation extends instrumentation.InstrumentationBase {
    constructor(config = {}){
        super(constants.INSTRUMENTATION_NAME, core.SDK_VERSION, config);
        this._propagationDecisionMap = new core.LRUMap(100);
        this._ignoreOutgoingRequestsMap = new WeakMap();
    }
    /** @inheritdoc */ init() {
        // We register handlers when either http or https is instrumented
        // but we only want to register them once, whichever is loaded first
        let hasRegisteredHandlers = false;
        const onHttpClientResponseFinish = (_data)=>{
            const data = _data;
            this._onOutgoingRequestFinish(data.request, data.response);
        };
        const onHttpClientRequestError = (_data)=>{
            const data = _data;
            this._onOutgoingRequestFinish(data.request, undefined);
        };
        const onHttpClientRequestCreated = (_data)=>{
            const data = _data;
            this._onOutgoingRequestCreated(data.request);
        };
        const wrap = (moduleExports)=>{
            if (hasRegisteredHandlers) {
                return moduleExports;
            }
            hasRegisteredHandlers = true;
            diagnosticsChannel.subscribe('http.client.response.finish', onHttpClientResponseFinish);
            // When an error happens, we still want to have a breadcrumb
            // In this case, `http.client.response.finish` is not triggered
            diagnosticsChannel.subscribe('http.client.request.error', onHttpClientRequestError);
            // NOTE: This channel only exist since Node 22
            // Before that, outgoing requests are not patched
            // and trace headers are not propagated, sadly.
            if (this.getConfig().propagateTraceInOutgoingRequests) {
                diagnosticsChannel.subscribe('http.client.request.created', onHttpClientRequestCreated);
            }
            return moduleExports;
        };
        const unwrap = ()=>{
            diagnosticsChannel.unsubscribe('http.client.response.finish', onHttpClientResponseFinish);
            diagnosticsChannel.unsubscribe('http.client.request.error', onHttpClientRequestError);
            diagnosticsChannel.unsubscribe('http.client.request.created', onHttpClientRequestCreated);
        };
        /**
     * You may be wondering why we register these diagnostics-channel listeners
     * in such a convoluted way (as InstrumentationNodeModuleDefinition...)˝,
     * instead of simply subscribing to the events once in here.
     * The reason for this is timing semantics: These functions are called once the http or https module is loaded.
     * If we'd subscribe before that, there seem to be conflicts with the OTEL native instrumentation in some scenarios,
     * especially the "import-on-top" pattern of setting up ESM applications.
     */ return [
            new instrumentation.InstrumentationNodeModuleDefinition('http', [
                '*'
            ], wrap, unwrap),
            new instrumentation.InstrumentationNodeModuleDefinition('https', [
                '*'
            ], wrap, unwrap)
        ];
    }
    /**
   * This is triggered when an outgoing request finishes.
   * It has access to the final request and response objects.
   */ _onOutgoingRequestFinish(request, response) {
        debugBuild.DEBUG_BUILD && core.debug.log(constants.INSTRUMENTATION_NAME, 'Handling finished outgoing request');
        const _breadcrumbs = this.getConfig().breadcrumbs;
        const breadCrumbsEnabled = typeof _breadcrumbs === 'undefined' ? true : _breadcrumbs;
        // Note: We cannot rely on the map being set by `_onOutgoingRequestCreated`, because that is not run in Node <22
        const shouldIgnore = this._ignoreOutgoingRequestsMap.get(request) ?? this._shouldIgnoreOutgoingRequest(request);
        this._ignoreOutgoingRequestsMap.set(request, shouldIgnore);
        if (breadCrumbsEnabled && !shouldIgnore) {
            outgoingHttpRequest.addRequestBreadcrumb(request, response);
        }
    }
    /**
   * This is triggered when an outgoing request is created.
   * It has access to the request object, and can mutate it before the request is sent.
   */ _onOutgoingRequestCreated(request) {
        const shouldIgnore = this._ignoreOutgoingRequestsMap.get(request) ?? this._shouldIgnoreOutgoingRequest(request);
        this._ignoreOutgoingRequestsMap.set(request, shouldIgnore);
        if (shouldIgnore) {
            return;
        }
        outgoingHttpRequest.addTracePropagationHeadersToOutgoingRequest(request, this._propagationDecisionMap);
    }
    /**
   * Check if the given outgoing request should be ignored.
   */ _shouldIgnoreOutgoingRequest(request) {
        if (core$1.isTracingSuppressed(api.context.active())) {
            return true;
        }
        const ignoreOutgoingRequests = this.getConfig().ignoreOutgoingRequests;
        if (!ignoreOutgoingRequests) {
            return false;
        }
        const options = outgoingHttpRequest.getRequestOptions(request);
        const url = getRequestUrl.getRequestUrl(request);
        return ignoreOutgoingRequests(url, options);
    }
}
exports.SentryHttpInstrumentation = SentryHttpInstrumentation; //# sourceMappingURL=SentryHttpInstrumentation.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/index.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const instrument = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/otel/instrument.js [instrumentation] (ecmascript)");
const httpServerIntegration = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/httpServerIntegration.js [instrumentation] (ecmascript)");
const httpServerSpansIntegration = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/httpServerSpansIntegration.js [instrumentation] (ecmascript)");
const SentryHttpInstrumentation = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/SentryHttpInstrumentation.js [instrumentation] (ecmascript)");
const INTEGRATION_NAME = 'Http';
const instrumentSentryHttp = instrument.generateInstrumentOnce(`${INTEGRATION_NAME}.sentry`, (options)=>{
    return new SentryHttpInstrumentation.SentryHttpInstrumentation(options);
});
/**
 * The http integration instruments Node's internal http and https modules.
 * It creates breadcrumbs for outgoing HTTP requests which will be attached to the currently active span.
 */ const httpIntegration = core.defineIntegration((options = {})=>{
    const serverOptions = {
        sessions: options.trackIncomingRequestsAsSessions,
        sessionFlushingDelayMS: options.sessionFlushingDelayMS,
        ignoreRequestBody: options.ignoreIncomingRequestBody,
        maxRequestBodySize: options.maxIncomingRequestBodySize
    };
    const serverSpansOptions = {
        ignoreIncomingRequests: options.ignoreIncomingRequests,
        ignoreStaticAssets: options.ignoreStaticAssets,
        ignoreStatusCodes: options.dropSpansForIncomingRequestStatusCodes
    };
    const httpInstrumentationOptions = {
        breadcrumbs: options.breadcrumbs,
        propagateTraceInOutgoingRequests: true,
        ignoreOutgoingRequests: options.ignoreOutgoingRequests
    };
    const server = httpServerIntegration.httpServerIntegration(serverOptions);
    const serverSpans = httpServerSpansIntegration.httpServerSpansIntegration(serverSpansOptions);
    // In node-core, for now we disable incoming requests spans by default
    // we may revisit this in a future release
    const spans = options.spans ?? false;
    const disableIncomingRequestSpans = options.disableIncomingRequestSpans ?? false;
    const enabledServerSpans = spans && !disableIncomingRequestSpans;
    return {
        name: INTEGRATION_NAME,
        setup (client) {
            if (enabledServerSpans) {
                serverSpans.setup(client);
            }
        },
        setupOnce () {
            server.setupOnce();
            instrumentSentryHttp(httpInstrumentationOptions);
        },
        processEvent (event) {
            // Note: We always run this, even if spans are disabled
            // The reason being that e.g. the remix integration disables span creation here but still wants to use the ignore status codes option
            return serverSpans.processEvent(event);
        }
    };
});
exports.httpIntegration = httpIntegration;
exports.instrumentSentryHttp = instrumentSentryHttp; //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/nodeVersion.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const NODE_VERSION = core.parseSemver(process.versions.node);
const NODE_MAJOR = NODE_VERSION.major;
const NODE_MINOR = NODE_VERSION.minor;
exports.NODE_MAJOR = NODE_MAJOR;
exports.NODE_MINOR = NODE_MINOR;
exports.NODE_VERSION = NODE_VERSION; //# sourceMappingURL=nodeVersion.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/outgoingFetchRequest.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const baggage = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/baggage.js [instrumentation] (ecmascript)");
const SENTRY_TRACE_HEADER = 'sentry-trace';
const SENTRY_BAGGAGE_HEADER = 'baggage';
// For baggage, we make sure to merge this into a possibly existing header
const BAGGAGE_HEADER_REGEX = /baggage: (.*)\r\n/;
/**
 * Add trace propagation headers to an outgoing fetch/undici request.
 *
 * Checks if the request URL matches trace propagation targets,
 * then injects sentry-trace, traceparent, and baggage headers.
 */ // eslint-disable-next-line complexity
function addTracePropagationHeadersToFetchRequest(request, propagationDecisionMap) {
    const url = getAbsoluteUrl(request.origin, request.path);
    // Manually add the trace headers, if it applies
    // Note: We do not use `propagation.inject()` here, because our propagator relies on an active span
    // Which we do not have in this case
    // The propagator _may_ overwrite this, but this should be fine as it is the same data
    const { tracePropagationTargets, propagateTraceparent } = core.getClient()?.getOptions() || {};
    const addedHeaders = core.shouldPropagateTraceForUrl(url, tracePropagationTargets, propagationDecisionMap) ? core.getTraceData({
        propagateTraceparent
    }) : undefined;
    if (!addedHeaders) {
        return;
    }
    const { 'sentry-trace': sentryTrace, baggage: baggage$1, traceparent } = addedHeaders;
    // We do not want to overwrite existing headers here
    // If the core UndiciInstrumentation is registered, it will already have set the headers
    // We do not want to add any then
    if (Array.isArray(request.headers)) {
        const requestHeaders = request.headers;
        // We do not want to overwrite existing header here, if it was already set
        if (sentryTrace && !requestHeaders.includes(SENTRY_TRACE_HEADER)) {
            requestHeaders.push(SENTRY_TRACE_HEADER, sentryTrace);
        }
        if (traceparent && !requestHeaders.includes('traceparent')) {
            requestHeaders.push('traceparent', traceparent);
        }
        // For baggage, we make sure to merge this into a possibly existing header
        const existingBaggagePos = requestHeaders.findIndex((header)=>header === SENTRY_BAGGAGE_HEADER);
        if (baggage$1 && existingBaggagePos === -1) {
            requestHeaders.push(SENTRY_BAGGAGE_HEADER, baggage$1);
        } else if (baggage$1) {
            const existingBaggage = requestHeaders[existingBaggagePos + 1];
            const merged = baggage.mergeBaggageHeaders(existingBaggage, baggage$1);
            if (merged) {
                requestHeaders[existingBaggagePos + 1] = merged;
            }
        }
    } else {
        const requestHeaders = request.headers;
        // We do not want to overwrite existing header here, if it was already set
        if (sentryTrace && !requestHeaders.includes(`${SENTRY_TRACE_HEADER}:`)) {
            request.headers += `${SENTRY_TRACE_HEADER}: ${sentryTrace}\r\n`;
        }
        if (traceparent && !requestHeaders.includes('traceparent:')) {
            request.headers += `traceparent: ${traceparent}\r\n`;
        }
        const existingBaggage = request.headers.match(BAGGAGE_HEADER_REGEX)?.[1];
        if (baggage$1 && !existingBaggage) {
            request.headers += `${SENTRY_BAGGAGE_HEADER}: ${baggage$1}\r\n`;
        } else if (baggage$1) {
            const merged = baggage.mergeBaggageHeaders(existingBaggage, baggage$1);
            if (merged) {
                request.headers = request.headers.replace(BAGGAGE_HEADER_REGEX, `baggage: ${merged}\r\n`);
            }
        }
    }
}
/** Add a breadcrumb for an outgoing fetch/undici request. */ function addFetchRequestBreadcrumb(request, response) {
    const data = getBreadcrumbData(request);
    const statusCode = response.statusCode;
    const level = core.getBreadcrumbLogLevelFromHttpStatusCode(statusCode);
    core.addBreadcrumb({
        category: 'http',
        data: {
            status_code: statusCode,
            ...data
        },
        type: 'http',
        level
    }, {
        event: 'response',
        request,
        response
    });
}
function getBreadcrumbData(request) {
    try {
        const url = getAbsoluteUrl(request.origin, request.path);
        const parsedUrl = core.parseUrl(url);
        const data = {
            url: core.getSanitizedUrlString(parsedUrl),
            'http.method': request.method || 'GET'
        };
        if (parsedUrl.search) {
            data['http.query'] = parsedUrl.search;
        }
        if (parsedUrl.hash) {
            data['http.fragment'] = parsedUrl.hash;
        }
        return data;
    } catch  {
        return {};
    }
}
/** Get the absolute URL from an origin and path. */ function getAbsoluteUrl(origin, path = '/') {
    try {
        const url = new URL(path, origin);
        return url.toString();
    } catch  {
        // fallback: Construct it on our own
        const url = `${origin}`;
        if (url.endsWith('/') && path.startsWith('/')) {
            return `${url}${path.slice(1)}`;
        }
        if (!url.endsWith('/') && !path.startsWith('/')) {
            return `${url}/${path}`;
        }
        return `${url}${path}`;
    }
}
exports.addFetchRequestBreadcrumb = addFetchRequestBreadcrumb;
exports.addTracePropagationHeadersToFetchRequest = addTracePropagationHeadersToFetchRequest;
exports.getAbsoluteUrl = getAbsoluteUrl; //# sourceMappingURL=outgoingFetchRequest.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/node-fetch/SentryNodeFetchInstrumentation.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const api = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/index.js [instrumentation] (ecmascript)");
const core$1 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/core/build/esm/index.js [instrumentation] (ecmascript)");
const instrumentation = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const diagch = __turbopack_context__.r("[externals]/diagnostics_channel [external] (diagnostics_channel, cjs)");
const nodeVersion = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/nodeVersion.js [instrumentation] (ecmascript)");
const outgoingFetchRequest = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/outgoingFetchRequest.js [instrumentation] (ecmascript)");
/**
 * This custom node-fetch instrumentation is used to instrument outgoing fetch requests.
 * It does not emit any spans.
 *
 * The reason this is isolated from the OpenTelemetry instrumentation is that users may overwrite this,
 * which would lead to Sentry not working as expected.
 *
 * This is heavily inspired & adapted from:
 * https://github.com/open-telemetry/opentelemetry-js-contrib/blob/28e209a9da36bc4e1f8c2b0db7360170ed46cb80/plugins/node/instrumentation-undici/src/undici.ts
 */ class SentryNodeFetchInstrumentation extends instrumentation.InstrumentationBase {
    // Keep ref to avoid https://github.com/nodejs/node/issues/42170 bug and for
    // unsubscribing.
    constructor(config = {}){
        super('@sentry/instrumentation-node-fetch', core.SDK_VERSION, config);
        this._channelSubs = [];
        this._propagationDecisionMap = new core.LRUMap(100);
        this._ignoreOutgoingRequestsMap = new WeakMap();
    }
    /** No need to instrument files/modules. */ init() {
        return undefined;
    }
    /** Disable the instrumentation. */ disable() {
        super.disable();
        this._channelSubs.forEach((sub)=>sub.unsubscribe());
        this._channelSubs = [];
    }
    /** Enable the instrumentation. */ enable() {
        // "enabled" handling is currently a bit messy with InstrumentationBase.
        // If constructed with `{enabled: false}`, this `.enable()` is still called,
        // and `this.getConfig().enabled !== this.isEnabled()`, creating confusion.
        //
        // For now, this class will setup for instrumenting if `.enable()` is
        // called, but use `this.getConfig().enabled` to determine if
        // instrumentation should be generated. This covers the more likely common
        // case of config being given a construction time, rather than later via
        // `instance.enable()`, `.disable()`, or `.setConfig()` calls.
        super.enable();
        // This method is called by the super-class constructor before ours is
        // called. So we need to ensure the property is initalized.
        this._channelSubs = this._channelSubs || [];
        // Avoid to duplicate subscriptions
        if (this._channelSubs.length > 0) {
            return;
        }
        this._subscribeToChannel('undici:request:create', this._onRequestCreated.bind(this));
        this._subscribeToChannel('undici:request:headers', this._onResponseHeaders.bind(this));
    }
    /**
   * This method is called when a request is created.
   * You can still mutate the request here before it is sent.
   */ _onRequestCreated({ request }) {
        const config = this.getConfig();
        const enabled = config.enabled !== false;
        if (!enabled) {
            return;
        }
        const shouldIgnore = this._shouldIgnoreOutgoingRequest(request);
        // We store this decisision for later so we do not need to re-evaluate it
        // Additionally, the active context is not correct in _onResponseHeaders, so we need to make sure it is evaluated here
        this._ignoreOutgoingRequestsMap.set(request, shouldIgnore);
        if (shouldIgnore) {
            return;
        }
        outgoingFetchRequest.addTracePropagationHeadersToFetchRequest(request, this._propagationDecisionMap);
    }
    /**
   * This method is called when a response is received.
   */ _onResponseHeaders({ request, response }) {
        const config = this.getConfig();
        const enabled = config.enabled !== false;
        if (!enabled) {
            return;
        }
        const _breadcrumbs = config.breadcrumbs;
        const breadCrumbsEnabled = typeof _breadcrumbs === 'undefined' ? true : _breadcrumbs;
        const shouldIgnore = this._ignoreOutgoingRequestsMap.get(request);
        if (breadCrumbsEnabled && !shouldIgnore) {
            outgoingFetchRequest.addFetchRequestBreadcrumb(request, response);
        }
    }
    /** Subscribe to a diagnostics channel. */ _subscribeToChannel(diagnosticChannel, onMessage) {
        // `diagnostics_channel` had a ref counting bug until v18.19.0.
        // https://github.com/nodejs/node/pull/47520
        const useNewSubscribe = nodeVersion.NODE_MAJOR > 18 || nodeVersion.NODE_MAJOR === 18 && nodeVersion.NODE_MINOR >= 19;
        let unsubscribe;
        if (useNewSubscribe) {
            diagch.subscribe?.(diagnosticChannel, onMessage);
            unsubscribe = ()=>diagch.unsubscribe?.(diagnosticChannel, onMessage);
        } else {
            const channel = diagch.channel(diagnosticChannel);
            channel.subscribe(onMessage);
            unsubscribe = ()=>channel.unsubscribe(onMessage);
        }
        this._channelSubs.push({
            name: diagnosticChannel,
            unsubscribe
        });
    }
    /**
   * Check if the given outgoing request should be ignored.
   */ _shouldIgnoreOutgoingRequest(request) {
        if (core$1.isTracingSuppressed(api.context.active())) {
            return true;
        }
        // Add trace propagation headers
        const url = outgoingFetchRequest.getAbsoluteUrl(request.origin, request.path);
        const ignoreOutgoingRequests = this.getConfig().ignoreOutgoingRequests;
        if (typeof ignoreOutgoingRequests !== 'function' || !url) {
            return false;
        }
        return ignoreOutgoingRequests(url);
    }
}
exports.SentryNodeFetchInstrumentation = SentryNodeFetchInstrumentation; //# sourceMappingURL=SentryNodeFetchInstrumentation.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/node-fetch/index.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const instrument = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/otel/instrument.js [instrumentation] (ecmascript)");
const SentryNodeFetchInstrumentation = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/node-fetch/SentryNodeFetchInstrumentation.js [instrumentation] (ecmascript)");
const INTEGRATION_NAME = 'NodeFetch';
const instrumentSentryNodeFetch = instrument.generateInstrumentOnce(`${INTEGRATION_NAME}.sentry`, SentryNodeFetchInstrumentation.SentryNodeFetchInstrumentation, (options)=>{
    return options;
});
const _nativeNodeFetchIntegration = (options = {})=>{
    return {
        name: 'NodeFetch',
        setupOnce () {
            instrumentSentryNodeFetch(options);
        }
    };
};
const nativeNodeFetchIntegration = core.defineIntegration(_nativeNodeFetchIntegration);
exports.nativeNodeFetchIntegration = nativeNodeFetchIntegration; //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/otel/contextManager.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const contextAsyncHooks = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/context-async-hooks/build/src/index.js [instrumentation] (ecmascript)");
const opentelemetry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/opentelemetry/build/cjs/index.js [instrumentation] (ecmascript)");
/**
 * This is a custom ContextManager for OpenTelemetry, which extends the default AsyncLocalStorageContextManager.
 * It ensures that we create a new hub per context, so that the OTEL Context & the Sentry Scopes are always in sync.
 *
 * Note that we currently only support AsyncHooks with this,
 * but since this should work for Node 14+ anyhow that should be good enough.
 */ const SentryContextManager = opentelemetry.wrapContextManagerClass(contextAsyncHooks.AsyncLocalStorageContextManager);
exports.SentryContextManager = SentryContextManager; //# sourceMappingURL=contextManager.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/otel/logger.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const api = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/index.js [instrumentation] (ecmascript)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
/**
 * Setup the OTEL logger to use our own debug logger.
 */ function setupOpenTelemetryLogger() {
    // Disable diag, to ensure this works even if called multiple times
    api.diag.disable();
    api.diag.setLogger({
        error: core.debug.error,
        warn: core.debug.warn,
        info: core.debug.log,
        debug: core.debug.log,
        verbose: core.debug.log
    }, api.DiagLogLevel.DEBUG);
}
exports.setupOpenTelemetryLogger = setupOpenTelemetryLogger; //# sourceMappingURL=logger.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/childProcess.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const diagnosticsChannel = __turbopack_context__.r("[externals]/node:diagnostics_channel [external] (node:diagnostics_channel, cjs)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const INTEGRATION_NAME = 'ChildProcess';
/**
 * Capture breadcrumbs and events for child processes and worker threads.
 */ const childProcessIntegration = core.defineIntegration((options = {})=>{
    return {
        name: INTEGRATION_NAME,
        setup () {
            diagnosticsChannel.channel('child_process').subscribe((event)=>{
                if (event && typeof event === 'object' && 'process' in event) {
                    captureChildProcessEvents(event.process, options);
                }
            });
            diagnosticsChannel.channel('worker_threads').subscribe((event)=>{
                if (event && typeof event === 'object' && 'worker' in event) {
                    captureWorkerThreadEvents(event.worker, options);
                }
            });
        }
    };
});
function captureChildProcessEvents(child, options) {
    let hasExited = false;
    let data;
    child.on('spawn', ()=>{
        // This is Sentry getting macOS OS context
        if (child.spawnfile === '/usr/bin/sw_vers') {
            hasExited = true;
            return;
        }
        data = {
            spawnfile: child.spawnfile
        };
        if (options.includeChildProcessArgs) {
            data.spawnargs = child.spawnargs;
        }
    }).on('exit', (code)=>{
        if (!hasExited) {
            hasExited = true;
            // Only log for non-zero exit codes
            if (code !== null && code !== 0) {
                core.addBreadcrumb({
                    category: 'child_process',
                    message: `Child process exited with code '${code}'`,
                    level: code === 0 ? 'info' : 'warning',
                    data
                });
            }
        }
    }).on('error', (error)=>{
        if (!hasExited) {
            hasExited = true;
            core.addBreadcrumb({
                category: 'child_process',
                message: `Child process errored with '${error.message}'`,
                level: 'error',
                data
            });
        }
    });
}
function captureWorkerThreadEvents(worker, options) {
    let threadId;
    worker.on('online', ()=>{
        threadId = worker.threadId;
    }).on('error', (error)=>{
        if (options.captureWorkerErrors !== false) {
            core.captureException(error, {
                mechanism: {
                    type: 'auto.child_process.worker_thread',
                    handled: false,
                    data: {
                        threadId: String(threadId)
                    }
                }
            });
        } else {
            core.addBreadcrumb({
                category: 'worker_thread',
                message: `Worker thread errored with '${error.message}'`,
                level: 'error',
                data: {
                    threadId
                }
            });
        }
    });
}
exports.childProcessIntegration = childProcessIntegration; //# sourceMappingURL=childProcess.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/context.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const node_child_process = __turbopack_context__.r("[externals]/node:child_process [external] (node:child_process, cjs)");
const node_fs = __turbopack_context__.r("[externals]/node:fs [external] (node:fs, cjs)");
const os = __turbopack_context__.r("[externals]/node:os [external] (node:os, cjs)");
const node_path = __turbopack_context__.r("[externals]/node:path [external] (node:path, cjs)");
const util = __turbopack_context__.r("[externals]/node:util [external] (node:util, cjs)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
/* eslint-disable max-lines */ const readFileAsync = util.promisify(node_fs.readFile);
const readDirAsync = util.promisify(node_fs.readdir);
// Process enhanced with methods from Node 18, 20, 22 as @types/node
// is on `14.18.0` to match minimum version requirements of the SDK
const INTEGRATION_NAME = 'Context';
const _nodeContextIntegration = (options = {})=>{
    let cachedContext;
    const _options = {
        app: true,
        os: true,
        device: true,
        culture: true,
        cloudResource: true,
        ...options
    };
    /** Add contexts to the event. Caches the context so we only look it up once. */ async function addContext(event) {
        if (cachedContext === undefined) {
            cachedContext = _getContexts();
        }
        const updatedContext = _updateContext(await cachedContext);
        // TODO(v11): conditional with `sendDefaultPii` here?
        event.contexts = {
            ...event.contexts,
            app: {
                ...updatedContext.app,
                ...event.contexts?.app
            },
            os: {
                ...updatedContext.os,
                ...event.contexts?.os
            },
            device: {
                ...updatedContext.device,
                ...event.contexts?.device
            },
            culture: {
                ...updatedContext.culture,
                ...event.contexts?.culture
            },
            cloud_resource: {
                ...updatedContext.cloud_resource,
                ...event.contexts?.cloud_resource
            }
        };
        return event;
    }
    /** Get the contexts from node. */ async function _getContexts() {
        const contexts = {};
        if (_options.os) {
            contexts.os = await getOsContext();
        }
        if (_options.app) {
            contexts.app = getAppContext();
        }
        if (_options.device) {
            contexts.device = getDeviceContext(_options.device);
        }
        if (_options.culture) {
            const culture = getCultureContext();
            if (culture) {
                contexts.culture = culture;
            }
        }
        if (_options.cloudResource) {
            contexts.cloud_resource = getCloudResourceContext();
        }
        return contexts;
    }
    return {
        name: INTEGRATION_NAME,
        processEvent (event) {
            return addContext(event);
        }
    };
};
/**
 * Capture context about the environment and the device that the client is running on, to events.
 */ const nodeContextIntegration = core.defineIntegration(_nodeContextIntegration);
/**
 * Updates the context with dynamic values that can change
 */ function _updateContext(contexts) {
    // Only update properties if they exist
    if (contexts.app?.app_memory) {
        contexts.app.app_memory = process.memoryUsage().rss;
    }
    if (contexts.app?.free_memory && typeof process.availableMemory === 'function') {
        const freeMemory = process.availableMemory?.();
        if (freeMemory != null) {
            contexts.app.free_memory = freeMemory;
        }
    }
    if (contexts.device?.free_memory) {
        contexts.device.free_memory = os.freemem();
    }
    return contexts;
}
/**
 * Returns the operating system context.
 *
 * Based on the current platform, this uses a different strategy to provide the
 * most accurate OS information. Since this might involve spawning subprocesses
 * or accessing the file system, this should only be executed lazily and cached.
 *
 *  - On macOS (Darwin), this will execute the `sw_vers` utility. The context
 *    has a `name`, `version`, `build` and `kernel_version` set.
 *  - On Linux, this will try to load a distribution release from `/etc` and set
 *    the `name`, `version` and `kernel_version` fields.
 *  - On all other platforms, only a `name` and `version` will be returned. Note
 *    that `version` might actually be the kernel version.
 */ async function getOsContext() {
    const platformId = os.platform();
    switch(platformId){
        case 'darwin':
            return getDarwinInfo();
        case 'linux':
            return getLinuxInfo();
        default:
            return {
                name: PLATFORM_NAMES[platformId] || platformId,
                version: os.release()
            };
    }
}
function getCultureContext() {
    try {
        if (typeof process.versions.icu !== 'string') {
            // Node was built without ICU support
            return;
        }
        // Check that node was built with full Intl support. Its possible it was built without support for non-English
        // locales which will make resolvedOptions inaccurate
        //
        // https://nodejs.org/api/intl.html#detecting-internationalization-support
        const january = new Date(9e8);
        const spanish = new Intl.DateTimeFormat('es', {
            month: 'long'
        });
        if (spanish.format(january) === 'enero') {
            const options = Intl.DateTimeFormat().resolvedOptions();
            return {
                locale: options.locale,
                timezone: options.timeZone
            };
        }
    } catch  {
    //
    }
    return;
}
/**
 * Get app context information from process
 */ function getAppContext() {
    const app_memory = process.memoryUsage().rss;
    // eslint-disable-next-line @sentry-internal/sdk/no-unsafe-random-apis
    const app_start_time = new Date(Date.now() - process.uptime() * 1000).toISOString();
    // https://nodejs.org/api/process.html#processavailablememory
    const appContext = {
        app_start_time,
        app_memory
    };
    if (typeof process.availableMemory === 'function') {
        const freeMemory = process.availableMemory?.();
        if (freeMemory != null) {
            appContext.free_memory = freeMemory;
        }
    }
    return appContext;
}
/**
 * Gets device information from os
 */ function getDeviceContext(deviceOpt) {
    const device = {};
    // Sometimes os.uptime() throws due to lacking permissions: https://github.com/getsentry/sentry-javascript/issues/8202
    let uptime;
    try {
        uptime = os.uptime();
    } catch  {
    // noop
    }
    // os.uptime or its return value seem to be undefined in certain environments (e.g. Azure functions).
    // Hence, we only set boot time, if we get a valid uptime value.
    // @see https://github.com/getsentry/sentry-javascript/issues/5856
    if (typeof uptime === 'number') {
        // eslint-disable-next-line @sentry-internal/sdk/no-unsafe-random-apis
        device.boot_time = new Date(Date.now() - uptime * 1000).toISOString();
    }
    device.arch = os.arch();
    if (deviceOpt === true || deviceOpt.memory) {
        device.memory_size = os.totalmem();
        device.free_memory = os.freemem();
    }
    if (deviceOpt === true || deviceOpt.cpu) {
        const cpuInfo = os.cpus();
        const firstCpu = cpuInfo?.[0];
        if (firstCpu) {
            device.processor_count = cpuInfo.length;
            device.cpu_description = firstCpu.model;
            device.processor_frequency = firstCpu.speed;
        }
    }
    return device;
}
/** Mapping of Node's platform names to actual OS names. */ const PLATFORM_NAMES = {
    aix: 'IBM AIX',
    freebsd: 'FreeBSD',
    openbsd: 'OpenBSD',
    sunos: 'SunOS',
    win32: 'Windows',
    ohos: 'OpenHarmony',
    android: 'Android'
};
/** Linux version file to check for a distribution. */ /** Mapping of linux release files located in /etc to distributions. */ const LINUX_DISTROS = [
    {
        name: 'fedora-release',
        distros: [
            'Fedora'
        ]
    },
    {
        name: 'redhat-release',
        distros: [
            'Red Hat Linux',
            'Centos'
        ]
    },
    {
        name: 'redhat_version',
        distros: [
            'Red Hat Linux'
        ]
    },
    {
        name: 'SuSE-release',
        distros: [
            'SUSE Linux'
        ]
    },
    {
        name: 'lsb-release',
        distros: [
            'Ubuntu Linux',
            'Arch Linux'
        ]
    },
    {
        name: 'debian_version',
        distros: [
            'Debian'
        ]
    },
    {
        name: 'debian_release',
        distros: [
            'Debian'
        ]
    },
    {
        name: 'arch-release',
        distros: [
            'Arch Linux'
        ]
    },
    {
        name: 'gentoo-release',
        distros: [
            'Gentoo Linux'
        ]
    },
    {
        name: 'novell-release',
        distros: [
            'SUSE Linux'
        ]
    },
    {
        name: 'alpine-release',
        distros: [
            'Alpine Linux'
        ]
    }
];
/** Functions to extract the OS version from Linux release files. */ const LINUX_VERSIONS = {
    alpine: (content)=>content,
    arch: (content)=>matchFirst(/distrib_release=(.*)/, content),
    centos: (content)=>matchFirst(/release ([^ ]+)/, content),
    debian: (content)=>content,
    fedora: (content)=>matchFirst(/release (..)/, content),
    mint: (content)=>matchFirst(/distrib_release=(.*)/, content),
    red: (content)=>matchFirst(/release ([^ ]+)/, content),
    suse: (content)=>matchFirst(/VERSION = (.*)\n/, content),
    ubuntu: (content)=>matchFirst(/distrib_release=(.*)/, content)
};
/**
 * Executes a regular expression with one capture group.
 *
 * @param regex A regular expression to execute.
 * @param text Content to execute the RegEx on.
 * @returns The captured string if matched; otherwise undefined.
 */ function matchFirst(regex, text) {
    const match = regex.exec(text);
    return match ? match[1] : undefined;
}
/** Loads the macOS operating system context. */ async function getDarwinInfo() {
    // Default values that will be used in case no operating system information
    // can be loaded. The default version is computed via heuristics from the
    // kernel version, but the build ID is missing.
    const darwinInfo = {
        kernel_version: os.release(),
        name: 'Mac OS X',
        version: `10.${Number(os.release().split('.')[0]) - 4}`
    };
    try {
        // We try to load the actual macOS version by executing the `sw_vers` tool.
        // This tool should be available on every standard macOS installation. In
        // case this fails, we stick with the values computed above.
        const output = await new Promise((resolve, reject)=>{
            node_child_process.execFile('/usr/bin/sw_vers', (error, stdout)=>{
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        });
        darwinInfo.name = matchFirst(/^ProductName:\s+(.*)$/m, output);
        darwinInfo.version = matchFirst(/^ProductVersion:\s+(.*)$/m, output);
        darwinInfo.build = matchFirst(/^BuildVersion:\s+(.*)$/m, output);
    } catch  {
    // ignore
    }
    return darwinInfo;
}
/** Returns a distribution identifier to look up version callbacks. */ function getLinuxDistroId(name) {
    return name.split(' ')[0].toLowerCase();
}
/** Loads the Linux operating system context. */ async function getLinuxInfo() {
    // By default, we cannot assume anything about the distribution or Linux
    // version. `os.release()` returns the kernel version and we assume a generic
    // "Linux" name, which will be replaced down below.
    const linuxInfo = {
        kernel_version: os.release(),
        name: 'Linux'
    };
    try {
        // We start guessing the distribution by listing files in the /etc
        // directory. This is were most Linux distributions (except Knoppix) store
        // release files with certain distribution-dependent meta data. We search
        // for exactly one known file defined in `LINUX_DISTROS` and exit if none
        // are found. In case there are more than one file, we just stick with the
        // first one.
        const etcFiles = await readDirAsync('/etc');
        const distroFile = LINUX_DISTROS.find((file)=>etcFiles.includes(file.name));
        if (!distroFile) {
            return linuxInfo;
        }
        // Once that file is known, load its contents. To make searching in those
        // files easier, we lowercase the file contents. Since these files are
        // usually quite small, this should not allocate too much memory and we only
        // hold on to it for a very short amount of time.
        const distroPath = node_path.join('/etc', distroFile.name);
        const contents = (await readFileAsync(distroPath, {
            encoding: 'utf-8'
        })).toLowerCase();
        // Some Linux distributions store their release information in the same file
        // (e.g. RHEL and Centos). In those cases, we scan the file for an
        // identifier, that basically consists of the first word of the linux
        // distribution name (e.g. "red" for Red Hat). In case there is no match, we
        // just assume the first distribution in our list.
        const { distros } = distroFile;
        linuxInfo.name = distros.find((d)=>contents.indexOf(getLinuxDistroId(d)) >= 0) || distros[0];
        // Based on the found distribution, we can now compute the actual version
        // number. This is different for every distribution, so several strategies
        // are computed in `LINUX_VERSIONS`.
        const id = getLinuxDistroId(linuxInfo.name);
        linuxInfo.version = LINUX_VERSIONS[id]?.(contents);
    } catch  {
    // ignore
    }
    return linuxInfo;
}
/**
 * Grabs some information about hosting provider based on best effort.
 */ function getCloudResourceContext() {
    if (process.env.VERCEL) {
        // https://vercel.com/docs/concepts/projects/environment-variables/system-environment-variables#system-environment-variables
        return {
            'cloud.provider': 'vercel',
            'cloud.region': process.env.VERCEL_REGION
        };
    } else if (process.env.AWS_REGION) {
        // https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html
        return {
            'cloud.provider': 'aws',
            'cloud.region': process.env.AWS_REGION,
            'cloud.platform': process.env.AWS_EXECUTION_ENV
        };
    } else if (process.env.GCP_PROJECT) {
        // https://cloud.google.com/composer/docs/how-to/managing/environment-variables#reserved_variables
        return {
            'cloud.provider': 'gcp'
        };
    } else if (process.env.ALIYUN_REGION_ID) {
        // TODO: find where I found these environment variables - at least gc.github.com returns something
        return {
            'cloud.provider': 'alibaba_cloud',
            'cloud.region': process.env.ALIYUN_REGION_ID
        };
    } else if (process.env.WEBSITE_SITE_NAME && process.env.REGION_NAME) {
        // https://learn.microsoft.com/en-us/azure/app-service/reference-app-settings?tabs=kudu%2Cdotnet#app-environment
        return {
            'cloud.provider': 'azure',
            'cloud.region': process.env.REGION_NAME
        };
    } else if (process.env.IBM_CLOUD_REGION) {
        // TODO: find where I found these environment variables - at least gc.github.com returns something
        return {
            'cloud.provider': 'ibm_cloud',
            'cloud.region': process.env.IBM_CLOUD_REGION
        };
    } else if (process.env.TENCENTCLOUD_REGION) {
        // https://www.tencentcloud.com/document/product/583/32748
        return {
            'cloud.provider': 'tencent_cloud',
            'cloud.region': process.env.TENCENTCLOUD_REGION,
            'cloud.account.id': process.env.TENCENTCLOUD_APPID,
            'cloud.availability_zone': process.env.TENCENTCLOUD_ZONE
        };
    } else if (process.env.NETLIFY) {
        // https://docs.netlify.com/configure-builds/environment-variables/#read-only-variables
        return {
            'cloud.provider': 'netlify'
        };
    } else if (process.env.FLY_REGION) {
        // https://fly.io/docs/reference/runtime-environment/
        return {
            'cloud.provider': 'fly.io',
            'cloud.region': process.env.FLY_REGION
        };
    } else if (process.env.DYNO) {
        // https://devcenter.heroku.com/articles/dynos#local-environment-variables
        return {
            'cloud.provider': 'heroku'
        };
    } else {
        return undefined;
    }
}
exports.getAppContext = getAppContext;
exports.getDeviceContext = getDeviceContext;
exports.nodeContextIntegration = nodeContextIntegration;
exports.readDirAsync = readDirAsync;
exports.readFileAsync = readFileAsync; //# sourceMappingURL=context.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/contextlines.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const node_fs = __turbopack_context__.r("[externals]/node:fs [external] (node:fs, cjs)");
const node_readline = __turbopack_context__.r("[externals]/node:readline [external] (node:readline, cjs)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/debug-build.js [instrumentation] (ecmascript)");
const LRU_FILE_CONTENTS_CACHE = new core.LRUMap(10);
const LRU_FILE_CONTENTS_FS_READ_FAILED = new core.LRUMap(20);
const DEFAULT_LINES_OF_CONTEXT = 7;
const INTEGRATION_NAME = 'ContextLines';
// Determines the upper bound of lineno/colno that we will attempt to read. Large colno values are likely to be
// minified code while large lineno values are likely to be bundled code.
// Exported for testing purposes.
const MAX_CONTEXTLINES_COLNO = 1000;
const MAX_CONTEXTLINES_LINENO = 10000;
/**
 * Get or init map value
 */ function emplace(map, key, contents) {
    const value = map.get(key);
    if (value === undefined) {
        map.set(key, contents);
        return contents;
    }
    return value;
}
/**
 * Determines if context lines should be skipped for a file.
 * - .min.(mjs|cjs|js) files are and not useful since they dont point to the original source
 * - node: prefixed modules are part of the runtime and cannot be resolved to a file
 * - data: skip json, wasm and inline js https://nodejs.org/api/esm.html#data-imports
 */ function shouldSkipContextLinesForFile(path) {
    // Test the most common prefix and extension first. These are the ones we
    // are most likely to see in user applications and are the ones we can break out of first.
    if (path.startsWith('node:')) return true;
    if (path.endsWith('.min.js')) return true;
    if (path.endsWith('.min.cjs')) return true;
    if (path.endsWith('.min.mjs')) return true;
    if (path.startsWith('data:')) return true;
    return false;
}
/**
 * Determines if we should skip contextlines based off the max lineno and colno values.
 */ function shouldSkipContextLinesForFrame(frame) {
    if (frame.lineno !== undefined && frame.lineno > MAX_CONTEXTLINES_LINENO) return true;
    if (frame.colno !== undefined && frame.colno > MAX_CONTEXTLINES_COLNO) return true;
    return false;
}
/**
 * Checks if we have all the contents that we need in the cache.
 */ function rangeExistsInContentCache(file, range) {
    const contents = LRU_FILE_CONTENTS_CACHE.get(file);
    if (contents === undefined) return false;
    for(let i = range[0]; i <= range[1]; i++){
        if (contents[i] === undefined) {
            return false;
        }
    }
    return true;
}
/**
 * Creates contiguous ranges of lines to read from a file. In the case where context lines overlap,
 * the ranges are merged to create a single range.
 */ function makeLineReaderRanges(lines, linecontext) {
    if (!lines.length) {
        return [];
    }
    let i = 0;
    const line = lines[0];
    if (typeof line !== 'number') {
        return [];
    }
    let current = makeContextRange(line, linecontext);
    const out = [];
    // eslint-disable-next-line no-constant-condition
    while(true){
        if (i === lines.length - 1) {
            out.push(current);
            break;
        }
        // If the next line falls into the current range, extend the current range to lineno + linecontext.
        const next = lines[i + 1];
        if (typeof next !== 'number') {
            break;
        }
        if (next <= current[1]) {
            current[1] = next + linecontext;
        } else {
            out.push(current);
            current = makeContextRange(next, linecontext);
        }
        i++;
    }
    return out;
}
/**
 * Extracts lines from a file and stores them in a cache.
 */ function getContextLinesFromFile(path, ranges, output) {
    return new Promise((resolve, _reject)=>{
        // It is important *not* to have any async code between createInterface and the 'line' event listener
        // as it will cause the 'line' event to
        // be emitted before the listener is attached.
        const stream = node_fs.createReadStream(path);
        const lineReaded = node_readline.createInterface({
            input: stream
        });
        // We need to explicitly destroy the stream to prevent memory leaks,
        // removing the listeners on the readline interface is not enough.
        // See: https://github.com/nodejs/node/issues/9002 and https://github.com/getsentry/sentry-javascript/issues/14892
        function destroyStreamAndResolve() {
            stream.destroy();
            resolve();
        }
        // Init at zero and increment at the start of the loop because lines are 1 indexed.
        let lineNumber = 0;
        let currentRangeIndex = 0;
        const range = ranges[currentRangeIndex];
        if (range === undefined) {
            // We should never reach this point, but if we do, we should resolve the promise to prevent it from hanging.
            destroyStreamAndResolve();
            return;
        }
        let rangeStart = range[0];
        let rangeEnd = range[1];
        // We use this inside Promise.all, so we need to resolve the promise even if there is an error
        // to prevent Promise.all from short circuiting the rest.
        function onStreamError(e) {
            // Mark file path as failed to read and prevent multiple read attempts.
            LRU_FILE_CONTENTS_FS_READ_FAILED.set(path, 1);
            debugBuild.DEBUG_BUILD && core.debug.error(`Failed to read file: ${path}. Error: ${e}`);
            lineReaded.close();
            lineReaded.removeAllListeners();
            destroyStreamAndResolve();
        }
        // We need to handle the error event to prevent the process from crashing in < Node 16
        // https://github.com/nodejs/node/pull/31603
        stream.on('error', onStreamError);
        lineReaded.on('error', onStreamError);
        lineReaded.on('close', destroyStreamAndResolve);
        lineReaded.on('line', (line)=>{
            lineNumber++;
            if (lineNumber < rangeStart) return;
            // !Warning: This mutates the cache by storing the snipped line into the cache.
            output[lineNumber] = core.snipLine(line, 0);
            if (lineNumber >= rangeEnd) {
                if (currentRangeIndex === ranges.length - 1) {
                    // We need to close the file stream and remove listeners, else the reader will continue to run our listener;
                    lineReaded.close();
                    lineReaded.removeAllListeners();
                    return;
                }
                currentRangeIndex++;
                const range = ranges[currentRangeIndex];
                if (range === undefined) {
                    // This should never happen as it means we have a bug in the context.
                    lineReaded.close();
                    lineReaded.removeAllListeners();
                    return;
                }
                rangeStart = range[0];
                rangeEnd = range[1];
            }
        });
    });
}
/**
 * Adds surrounding (context) lines of the line that an exception occurred on to the event.
 * This is done by reading the file line by line and extracting the lines. The extracted lines are stored in
 * a cache to prevent multiple reads of the same file. Failures to read a file are similarly cached to prevent multiple
 * failing reads from happening.
 */ /* eslint-disable complexity */ async function addSourceContext(event, contextLines) {
    // keep a lookup map of which files we've already enqueued to read,
    // so we don't enqueue the same file multiple times which would cause multiple i/o reads
    const filesToLines = {};
    if (contextLines > 0 && event.exception?.values) {
        for (const exception of event.exception.values){
            if (!exception.stacktrace?.frames?.length) {
                continue;
            }
            // Maps preserve insertion order, so we iterate in reverse, starting at the
            // outermost frame and closer to where the exception has occurred (poor mans priority)
            for(let i = exception.stacktrace.frames.length - 1; i >= 0; i--){
                const frame = exception.stacktrace.frames[i];
                const filename = frame?.filename;
                if (!frame || typeof filename !== 'string' || typeof frame.lineno !== 'number' || shouldSkipContextLinesForFile(filename) || shouldSkipContextLinesForFrame(frame)) {
                    continue;
                }
                const filesToLinesOutput = filesToLines[filename];
                if (!filesToLinesOutput) filesToLines[filename] = [];
                // @ts-expect-error this is defined above
                filesToLines[filename].push(frame.lineno);
            }
        }
    }
    const files = Object.keys(filesToLines);
    if (files.length == 0) {
        return event;
    }
    const readlinePromises = [];
    for (const file of files){
        // If we failed to read this before, dont try reading it again.
        if (LRU_FILE_CONTENTS_FS_READ_FAILED.get(file)) {
            continue;
        }
        const filesToLineRanges = filesToLines[file];
        if (!filesToLineRanges) {
            continue;
        }
        // Sort ranges so that they are sorted by line increasing order and match how the file is read.
        filesToLineRanges.sort((a, b)=>a - b);
        // Check if the contents are already in the cache and if we can avoid reading the file again.
        const ranges = makeLineReaderRanges(filesToLineRanges, contextLines);
        if (ranges.every((r)=>rangeExistsInContentCache(file, r))) {
            continue;
        }
        const cache = emplace(LRU_FILE_CONTENTS_CACHE, file, {});
        readlinePromises.push(getContextLinesFromFile(file, ranges, cache));
    }
    // The promise rejections are caught in order to prevent them from short circuiting Promise.all
    await Promise.all(readlinePromises).catch(()=>{
        debugBuild.DEBUG_BUILD && core.debug.log('Failed to read one or more source files and resolve context lines');
    });
    // Perform the same loop as above, but this time we can assume all files are in the cache
    // and attempt to add source context to frames.
    if (contextLines > 0 && event.exception?.values) {
        for (const exception of event.exception.values){
            if (exception.stacktrace?.frames && exception.stacktrace.frames.length > 0) {
                addSourceContextToFrames(exception.stacktrace.frames, contextLines, LRU_FILE_CONTENTS_CACHE);
            }
        }
    }
    return event;
}
/* eslint-enable complexity */ /** Adds context lines to frames */ function addSourceContextToFrames(frames, contextLines, cache) {
    for (const frame of frames){
        // Only add context if we have a filename and it hasn't already been added
        if (frame.filename && frame.context_line === undefined && typeof frame.lineno === 'number') {
            const contents = cache.get(frame.filename);
            if (contents === undefined) {
                continue;
            }
            addContextToFrame(frame.lineno, frame, contextLines, contents);
        }
    }
}
/**
 * Clears the context lines from a frame, used to reset a frame to its original state
 * if we fail to resolve all context lines for it.
 */ function clearLineContext(frame) {
    delete frame.pre_context;
    delete frame.context_line;
    delete frame.post_context;
}
/**
 * Resolves context lines before and after the given line number and appends them to the frame;
 */ function addContextToFrame(lineno, frame, contextLines, contents) {
    // When there is no line number in the frame, attaching context is nonsensical and will even break grouping.
    // We already check for lineno before calling this, but since StackFrame lineno ism optional, we check it again.
    if (frame.lineno === undefined || contents === undefined) {
        debugBuild.DEBUG_BUILD && core.debug.error('Cannot resolve context for frame with no lineno or file contents');
        return;
    }
    frame.pre_context = [];
    for(let i = makeRangeStart(lineno, contextLines); i < lineno; i++){
        // We always expect the start context as line numbers cannot be negative. If we dont find a line, then
        // something went wrong somewhere. Clear the context and return without adding any linecontext.
        const line = contents[i];
        if (line === undefined) {
            clearLineContext(frame);
            debugBuild.DEBUG_BUILD && core.debug.error(`Could not find line ${i} in file ${frame.filename}`);
            return;
        }
        frame.pre_context.push(line);
    }
    // We should always have the context line. If we dont, something went wrong, so we clear the context and return
    // without adding any linecontext.
    if (contents[lineno] === undefined) {
        clearLineContext(frame);
        debugBuild.DEBUG_BUILD && core.debug.error(`Could not find line ${lineno} in file ${frame.filename}`);
        return;
    }
    frame.context_line = contents[lineno];
    const end = makeRangeEnd(lineno, contextLines);
    frame.post_context = [];
    for(let i = lineno + 1; i <= end; i++){
        // Since we dont track when the file ends, we cant clear the context if we dont find a line as it could
        // just be that we reached the end of the file.
        const line = contents[i];
        if (line === undefined) {
            break;
        }
        frame.post_context.push(line);
    }
}
// Helper functions for generating line context ranges. They take a line number and the number of lines of context to
// include before and after the line and generate an inclusive range of indices.
// Compute inclusive end context range
function makeRangeStart(line, linecontext) {
    return Math.max(1, line - linecontext);
}
// Compute inclusive start context range
function makeRangeEnd(line, linecontext) {
    return line + linecontext;
}
// Determine start and end indices for context range (inclusive);
function makeContextRange(line, linecontext) {
    return [
        makeRangeStart(line, linecontext),
        makeRangeEnd(line, linecontext)
    ];
}
/** Exported only for tests, as a type-safe variant. */ const _contextLinesIntegration = (options = {})=>{
    const contextLines = options.frameContextLines !== undefined ? options.frameContextLines : DEFAULT_LINES_OF_CONTEXT;
    return {
        name: INTEGRATION_NAME,
        processEvent (event) {
            return addSourceContext(event, contextLines);
        }
    };
};
/**
 * Capture the lines before and after the frame's context.
 */ const contextLinesIntegration = core.defineIntegration(_contextLinesIntegration);
exports.MAX_CONTEXTLINES_COLNO = MAX_CONTEXTLINES_COLNO;
exports.MAX_CONTEXTLINES_LINENO = MAX_CONTEXTLINES_LINENO;
exports._contextLinesIntegration = _contextLinesIntegration;
exports.addContextToFrame = addContextToFrame;
exports.contextLinesIntegration = contextLinesIntegration; //# sourceMappingURL=contextlines.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/debug.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
let cachedDebuggerEnabled;
/**
 * Was the debugger enabled when this function was first called?
 */ async function isDebuggerEnabled() {
    if (cachedDebuggerEnabled === undefined) {
        try {
            // Node can be built without inspector support
            const inspector = await __turbopack_context__.A("[externals]/node:inspector [external] (node:inspector, cjs, async loader)");
            cachedDebuggerEnabled = !!inspector.url();
        } catch  {
            cachedDebuggerEnabled = false;
        }
    }
    return cachedDebuggerEnabled;
}
exports.isDebuggerEnabled = isDebuggerEnabled; //# sourceMappingURL=debug.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/local-variables/common.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
/**
 * The key used to store the local variables on the error object.
 */ const LOCAL_VARIABLES_KEY = '__SENTRY_ERROR_LOCAL_VARIABLES__';
/**
 * Creates a rate limiter that will call the disable callback when the rate limit is reached and the enable callback
 * when a timeout has occurred.
 * @param maxPerSecond Maximum number of calls per second
 * @param enable Callback to enable capture
 * @param disable Callback to disable capture
 * @returns A function to call to increment the rate limiter count
 */ function createRateLimiter(maxPerSecond, enable, disable) {
    let count = 0;
    let retrySeconds = 5;
    let disabledTimeout = 0;
    setInterval(()=>{
        if (disabledTimeout === 0) {
            if (count > maxPerSecond) {
                retrySeconds *= 2;
                disable(retrySeconds);
                // Cap at one day
                if (retrySeconds > 86400) {
                    retrySeconds = 86400;
                }
                disabledTimeout = retrySeconds;
            }
        } else {
            disabledTimeout -= 1;
            if (disabledTimeout === 0) {
                enable();
            }
        }
        count = 0;
    }, 1000).unref();
    return ()=>{
        count += 1;
    };
}
// Add types for the exception event data
/** Could this be an anonymous function? */ function isAnonymous(name) {
    return name !== undefined && (name.length === 0 || name === '?' || name === '<anonymous>');
}
/** Do the function names appear to match? */ function functionNamesMatch(a, b) {
    return a === b || `Object.${a}` === b || a === `Object.${b}` || isAnonymous(a) && isAnonymous(b);
}
exports.LOCAL_VARIABLES_KEY = LOCAL_VARIABLES_KEY;
exports.createRateLimiter = createRateLimiter;
exports.functionNamesMatch = functionNamesMatch;
exports.isAnonymous = isAnonymous; //# sourceMappingURL=common.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/local-variables/local-variables-async.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const node_worker_threads = __turbopack_context__.r("[externals]/node:worker_threads [external] (node:worker_threads, cjs)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debug = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/debug.js [instrumentation] (ecmascript)");
const common = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/local-variables/common.js [instrumentation] (ecmascript)");
// This string is a placeholder that gets overwritten with the worker code.
const base64WorkerScript = 'LyohIEBzZW50cnkvbm9kZS1jb3JlIDEwLjQyLjAgKDA3YzkxOTApIHwgaHR0cHM6Ly9naXRodWIuY29tL2dldHNlbnRyeS9zZW50cnktamF2YXNjcmlwdCAqLwppbXBvcnR7U2Vzc2lvbiBhcyBlfWZyb20ibm9kZTppbnNwZWN0b3IvcHJvbWlzZXMiO2ltcG9ydHt3b3JrZXJEYXRhIGFzIHR9ZnJvbSJub2RlOndvcmtlcl90aHJlYWRzIjtjb25zdCBuPWdsb2JhbFRoaXMsaT17fTtjb25zdCBvPSJfX1NFTlRSWV9FUlJPUl9MT0NBTF9WQVJJQUJMRVNfXyI7Y29uc3QgYT10O2Z1bmN0aW9uIHMoLi4uZSl7YS5kZWJ1ZyYmZnVuY3Rpb24oZSl7aWYoISgiY29uc29sZSJpbiBuKSlyZXR1cm4gZSgpO2NvbnN0IHQ9bi5jb25zb2xlLG89e30sYT1PYmplY3Qua2V5cyhpKTthLmZvckVhY2goZT0+e2NvbnN0IG49aVtlXTtvW2VdPXRbZV0sdFtlXT1ufSk7dHJ5e3JldHVybiBlKCl9ZmluYWxseXthLmZvckVhY2goZT0+e3RbZV09b1tlXX0pfX0oKCk9PmNvbnNvbGUubG9nKCJbTG9jYWxWYXJpYWJsZXMgV29ya2VyXSIsLi4uZSkpfWFzeW5jIGZ1bmN0aW9uIGMoZSx0LG4saSl7Y29uc3Qgbz1hd2FpdCBlLnBvc3QoIlJ1bnRpbWUuZ2V0UHJvcGVydGllcyIse29iamVjdElkOnQsb3duUHJvcGVydGllczohMH0pO2lbbl09by5yZXN1bHQuZmlsdGVyKGU9PiJsZW5ndGgiIT09ZS5uYW1lJiYhaXNOYU4ocGFyc2VJbnQoZS5uYW1lLDEwKSkpLnNvcnQoKGUsdCk9PnBhcnNlSW50KGUubmFtZSwxMCktcGFyc2VJbnQodC5uYW1lLDEwKSkubWFwKGU9PmUudmFsdWU/LnZhbHVlKX1hc3luYyBmdW5jdGlvbiByKGUsdCxuLGkpe2NvbnN0IG89YXdhaXQgZS5wb3N0KCJSdW50aW1lLmdldFByb3BlcnRpZXMiLHtvYmplY3RJZDp0LG93blByb3BlcnRpZXM6ITB9KTtpW25dPW8ucmVzdWx0Lm1hcChlPT5bZS5uYW1lLGUudmFsdWU/LnZhbHVlXSkucmVkdWNlKChlLFt0LG5dKT0+KGVbdF09bixlKSx7fSl9ZnVuY3Rpb24gdShlLHQpe2UudmFsdWUmJigidmFsdWUiaW4gZS52YWx1ZT92b2lkIDA9PT1lLnZhbHVlLnZhbHVlfHxudWxsPT09ZS52YWx1ZS52YWx1ZT90W2UubmFtZV09YDwke2UudmFsdWUudmFsdWV9PmA6dFtlLm5hbWVdPWUudmFsdWUudmFsdWU6ImRlc2NyaXB0aW9uImluIGUudmFsdWUmJiJmdW5jdGlvbiIhPT1lLnZhbHVlLnR5cGU/dFtlLm5hbWVdPWA8JHtlLnZhbHVlLmRlc2NyaXB0aW9ufT5gOiJ1bmRlZmluZWQiPT09ZS52YWx1ZS50eXBlJiYodFtlLm5hbWVdPSI8dW5kZWZpbmVkPiIpKX1hc3luYyBmdW5jdGlvbiBsKGUsdCl7Y29uc3Qgbj1hd2FpdCBlLnBvc3QoIlJ1bnRpbWUuZ2V0UHJvcGVydGllcyIse29iamVjdElkOnQsb3duUHJvcGVydGllczohMH0pLGk9e307Zm9yKGNvbnN0IHQgb2Ygbi5yZXN1bHQpaWYodC52YWx1ZT8ub2JqZWN0SWQmJiJBcnJheSI9PT10LnZhbHVlLmNsYXNzTmFtZSl7Y29uc3Qgbj10LnZhbHVlLm9iamVjdElkO2F3YWl0IGMoZSxuLHQubmFtZSxpKX1lbHNlIGlmKHQudmFsdWU/Lm9iamVjdElkJiYiT2JqZWN0Ij09PXQudmFsdWUuY2xhc3NOYW1lKXtjb25zdCBuPXQudmFsdWUub2JqZWN0SWQ7YXdhaXQgcihlLG4sdC5uYW1lLGkpfWVsc2UgdC52YWx1ZSYmdSh0LGkpO3JldHVybiBpfWxldCBmOyhhc3luYyBmdW5jdGlvbigpe2NvbnN0IHQ9bmV3IGU7dC5jb25uZWN0VG9NYWluVGhyZWFkKCkscygiQ29ubmVjdGVkIHRvIG1haW4gdGhyZWFkIik7bGV0IG49ITE7dC5vbigiRGVidWdnZXIucmVzdW1lZCIsKCk9PntuPSExfSksdC5vbigiRGVidWdnZXIucGF1c2VkIixlPT57bj0hMCxhc3luYyBmdW5jdGlvbihlLHtyZWFzb246dCxkYXRhOntvYmplY3RJZDpufSxjYWxsRnJhbWVzOml9KXtpZigiZXhjZXB0aW9uIiE9PXQmJiJwcm9taXNlUmVqZWN0aW9uIiE9PXQpcmV0dXJuO2lmKGY/LigpLG51bGw9PW4pcmV0dXJuO2NvbnN0IGE9W107Zm9yKGxldCB0PTA7dDxpLmxlbmd0aDt0Kyspe2NvbnN0e3Njb3BlQ2hhaW46bixmdW5jdGlvbk5hbWU6byx0aGlzOnN9PWlbdF0sYz1uLmZpbmQoZT0+ImxvY2FsIj09PWUudHlwZSkscj0iZ2xvYmFsIiE9PXMuY2xhc3NOYW1lJiZzLmNsYXNzTmFtZT9gJHtzLmNsYXNzTmFtZX0uJHtvfWA6bztpZih2b2lkIDA9PT1jPy5vYmplY3Qub2JqZWN0SWQpYVt0XT17ZnVuY3Rpb246cn07ZWxzZXtjb25zdCBuPWF3YWl0IGwoZSxjLm9iamVjdC5vYmplY3RJZCk7YVt0XT17ZnVuY3Rpb246cix2YXJzOm59fX1hd2FpdCBlLnBvc3QoIlJ1bnRpbWUuY2FsbEZ1bmN0aW9uT24iLHtmdW5jdGlvbkRlY2xhcmF0aW9uOmBmdW5jdGlvbigpIHsgdGhpcy4ke299ID0gdGhpcy4ke299IHx8ICR7SlNPTi5zdHJpbmdpZnkoYSl9OyB9YCxzaWxlbnQ6ITAsb2JqZWN0SWQ6bn0pLGF3YWl0IGUucG9zdCgiUnVudGltZS5yZWxlYXNlT2JqZWN0Iix7b2JqZWN0SWQ6bn0pfSh0LGUucGFyYW1zKS50aGVuKGFzeW5jKCk9PntuJiZhd2FpdCB0LnBvc3QoIkRlYnVnZ2VyLnJlc3VtZSIpfSxhc3luYyBlPT57biYmYXdhaXQgdC5wb3N0KCJEZWJ1Z2dlci5yZXN1bWUiKX0pfSksYXdhaXQgdC5wb3N0KCJEZWJ1Z2dlci5lbmFibGUiKTtjb25zdCBpPSExIT09YS5jYXB0dXJlQWxsRXhjZXB0aW9ucztpZihhd2FpdCB0LnBvc3QoIkRlYnVnZ2VyLnNldFBhdXNlT25FeGNlcHRpb25zIix7c3RhdGU6aT8iYWxsIjoidW5jYXVnaHQifSksaSl7Y29uc3QgZT1hLm1heEV4Y2VwdGlvbnNQZXJTZWNvbmR8fDUwO2Y9ZnVuY3Rpb24oZSx0LG4pe2xldCBpPTAsbz01LGE9MDtyZXR1cm4gc2V0SW50ZXJ2YWwoKCk9PnswPT09YT9pPmUmJihvKj0yLG4obyksbz44NjQwMCYmKG89ODY0MDApLGE9byk6KGEtPTEsMD09PWEmJnQoKSksaT0wfSwxZTMpLnVucmVmKCksKCk9PntpKz0xfX0oZSxhc3luYygpPT57cygiUmF0ZS1saW1pdCBsaWZ0ZWQuIiksYXdhaXQgdC5wb3N0KCJEZWJ1Z2dlci5zZXRQYXVzZU9uRXhjZXB0aW9ucyIse3N0YXRlOiJhbGwifSl9LGFzeW5jIGU9PntzKGBSYXRlLWxpbWl0IGV4Y2VlZGVkLiBEaXNhYmxpbmcgY2FwdHVyaW5nIG9mIGNhdWdodCBleGNlcHRpb25zIGZvciAke2V9IHNlY29uZHMuYCksYXdhaXQgdC5wb3N0KCJEZWJ1Z2dlci5zZXRQYXVzZU9uRXhjZXB0aW9ucyIse3N0YXRlOiJ1bmNhdWdodCJ9KX0pfX0pKCkuY2F0Y2goZT0+e3MoIkZhaWxlZCB0byBzdGFydCBkZWJ1Z2dlciIsZSl9KSxzZXRJbnRlcnZhbCgoKT0+e30sMWU0KTs=';
function log(...args) {
    core.debug.log('[LocalVariables]', ...args);
}
/**
 * Adds local variables to exception frames
 */ const localVariablesAsyncIntegration = core.defineIntegration((integrationOptions = {})=>{
    function addLocalVariablesToException(exception, localVariables) {
        // Filter out frames where the function name is `new Promise` since these are in the error.stack frames
        // but do not appear in the debugger call frames
        const frames = (exception.stacktrace?.frames || []).filter((frame)=>frame.function !== 'new Promise');
        for(let i = 0; i < frames.length; i++){
            // Sentry frames are in reverse order
            const frameIndex = frames.length - i - 1;
            const frameLocalVariables = localVariables[i];
            const frame = frames[frameIndex];
            if (!frame || !frameLocalVariables) {
                break;
            }
            if (// We need to have vars to add
            frameLocalVariables.vars === undefined || frame.in_app === false && integrationOptions.includeOutOfAppFrames !== true || // The function names need to match
            !common.functionNamesMatch(frame.function, frameLocalVariables.function)) {
                continue;
            }
            frame.vars = frameLocalVariables.vars;
        }
    }
    function addLocalVariablesToEvent(event, hint) {
        if (hint.originalException && typeof hint.originalException === 'object' && common.LOCAL_VARIABLES_KEY in hint.originalException && Array.isArray(hint.originalException[common.LOCAL_VARIABLES_KEY])) {
            for (const exception of event.exception?.values || []){
                addLocalVariablesToException(exception, hint.originalException[common.LOCAL_VARIABLES_KEY]);
            }
            hint.originalException[common.LOCAL_VARIABLES_KEY] = undefined;
        }
        return event;
    }
    async function startInspector() {
        // We load inspector dynamically because on some platforms Node is built without inspector support
        const inspector = await __turbopack_context__.A("[externals]/node:inspector [external] (node:inspector, cjs, async loader)");
        if (!inspector.url()) {
            inspector.open(0);
        }
    }
    function startWorker(options) {
        const worker = new node_worker_threads.Worker(new URL(`data:application/javascript;base64,${base64WorkerScript}`), {
            workerData: options,
            // We don't want any Node args to be passed to the worker
            execArgv: [],
            env: {
                ...process.env,
                NODE_OPTIONS: undefined
            }
        });
        process.on('exit', ()=>{
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            worker.terminate();
        });
        worker.once('error', (err)=>{
            log('Worker error', err);
        });
        worker.once('exit', (code)=>{
            log('Worker exit', code);
        });
        // Ensure this thread can't block app exit
        worker.unref();
    }
    return {
        name: 'LocalVariablesAsync',
        async setup (client) {
            const clientOptions = client.getOptions();
            if (!clientOptions.includeLocalVariables) {
                return;
            }
            if (await debug.isDebuggerEnabled()) {
                core.debug.warn('Local variables capture has been disabled because the debugger was already enabled');
                return;
            }
            const options = {
                ...integrationOptions,
                debug: core.debug.isEnabled()
            };
            startInspector().then(()=>{
                try {
                    startWorker(options);
                } catch (e) {
                    core.debug.error('Failed to start worker', e);
                }
            }, (e)=>{
                core.debug.error('Failed to start inspector', e);
            });
        },
        processEvent (event, hint) {
            return addLocalVariablesToEvent(event, hint);
        }
    };
});
exports.base64WorkerScript = base64WorkerScript;
exports.localVariablesAsyncIntegration = localVariablesAsyncIntegration; //# sourceMappingURL=local-variables-async.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/local-variables/local-variables-sync.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const nodeVersion = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/nodeVersion.js [instrumentation] (ecmascript)");
const debug = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/debug.js [instrumentation] (ecmascript)");
const common = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/local-variables/common.js [instrumentation] (ecmascript)");
/** Creates a unique hash from stack frames */ function hashFrames(frames) {
    if (frames === undefined) {
        return;
    }
    // Only hash the 10 most recent frames (ie. the last 10)
    return frames.slice(-10).reduce((acc, frame)=>`${acc},${frame.function},${frame.lineno},${frame.colno}`, '');
}
/**
 * We use the stack parser to create a unique hash from the exception stack trace
 * This is used to lookup vars when the exception passes through the event processor
 */ function hashFromStack(stackParser, stack) {
    if (stack === undefined) {
        return undefined;
    }
    return hashFrames(stackParser(stack, 1));
}
/** Creates a container for callbacks to be called sequentially */ function createCallbackList(complete) {
    // A collection of callbacks to be executed last to first
    let callbacks = [];
    let completedCalled = false;
    function checkedComplete(result) {
        callbacks = [];
        if (completedCalled) {
            return;
        }
        completedCalled = true;
        complete(result);
    }
    // complete should be called last
    callbacks.push(checkedComplete);
    function add(fn) {
        callbacks.push(fn);
    }
    function next(result) {
        const popped = callbacks.pop() || checkedComplete;
        try {
            popped(result);
        } catch  {
            // If there is an error, we still want to call the complete callback
            checkedComplete(result);
        }
    }
    return {
        add,
        next
    };
}
/**
 * Promise API is available as `Experimental` and in Node 19 only.
 *
 * Callback-based API is `Stable` since v14 and `Experimental` since v8.
 * Because of that, we are creating our own `AsyncSession` class.
 *
 * https://nodejs.org/docs/latest-v19.x/api/inspector.html#promises-api
 * https://nodejs.org/docs/latest-v14.x/api/inspector.html
 */ class AsyncSession {
    /** Throws if inspector API is not available */ constructor(_session){
        this._session = _session;
    //
    }
    static async create(orDefault) {
        if (orDefault) {
            return orDefault;
        }
        const inspector = await __turbopack_context__.A("[externals]/node:inspector [external] (node:inspector, cjs, async loader)");
        return new AsyncSession(new inspector.Session());
    }
    /** @inheritdoc */ configureAndConnect(onPause, captureAll) {
        this._session.connect();
        this._session.on('Debugger.paused', (event)=>{
            onPause(event, ()=>{
                // After the pause work is complete, resume execution or the exception context memory is leaked
                this._session.post('Debugger.resume');
            });
        });
        this._session.post('Debugger.enable');
        this._session.post('Debugger.setPauseOnExceptions', {
            state: captureAll ? 'all' : 'uncaught'
        });
    }
    setPauseOnExceptions(captureAll) {
        this._session.post('Debugger.setPauseOnExceptions', {
            state: captureAll ? 'all' : 'uncaught'
        });
    }
    /** @inheritdoc */ getLocalVariables(objectId, complete) {
        this._getProperties(objectId, (props)=>{
            const { add, next } = createCallbackList(complete);
            for (const prop of props){
                if (prop.value?.objectId && prop.value.className === 'Array') {
                    const id = prop.value.objectId;
                    add((vars)=>this._unrollArray(id, prop.name, vars, next));
                } else if (prop.value?.objectId && prop.value.className === 'Object') {
                    const id = prop.value.objectId;
                    add((vars)=>this._unrollObject(id, prop.name, vars, next));
                } else if (prop.value) {
                    add((vars)=>this._unrollOther(prop, vars, next));
                }
            }
            next({});
        });
    }
    /**
   * Gets all the PropertyDescriptors of an object
   */ _getProperties(objectId, next) {
        this._session.post('Runtime.getProperties', {
            objectId,
            ownProperties: true
        }, (err, params)=>{
            if (err) {
                next([]);
            } else {
                next(params.result);
            }
        });
    }
    /**
   * Unrolls an array property
   */ _unrollArray(objectId, name, vars, next) {
        this._getProperties(objectId, (props)=>{
            vars[name] = props.filter((v)=>v.name !== 'length' && !isNaN(parseInt(v.name, 10))).sort((a, b)=>parseInt(a.name, 10) - parseInt(b.name, 10)).map((v)=>v.value?.value);
            next(vars);
        });
    }
    /**
   * Unrolls an object property
   */ _unrollObject(objectId, name, vars, next) {
        this._getProperties(objectId, (props)=>{
            vars[name] = props.map((v)=>[
                    v.name,
                    v.value?.value
                ]).reduce((obj, [key, val])=>{
                obj[key] = val;
                return obj;
            }, {});
            next(vars);
        });
    }
    /**
   * Unrolls other properties
   */ _unrollOther(prop, vars, next) {
        if (prop.value) {
            if ('value' in prop.value) {
                if (prop.value.value === undefined || prop.value.value === null) {
                    vars[prop.name] = `<${prop.value.value}>`;
                } else {
                    vars[prop.name] = prop.value.value;
                }
            } else if ('description' in prop.value && prop.value.type !== 'function') {
                vars[prop.name] = `<${prop.value.description}>`;
            } else if (prop.value.type === 'undefined') {
                vars[prop.name] = '<undefined>';
            }
        }
        next(vars);
    }
}
const INTEGRATION_NAME = 'LocalVariables';
/**
 * Adds local variables to exception frames
 */ const _localVariablesSyncIntegration = (options = {}, sessionOverride)=>{
    const cachedFrames = new core.LRUMap(20);
    let rateLimiter;
    let shouldProcessEvent = false;
    function addLocalVariablesToException(exception) {
        const hash = hashFrames(exception.stacktrace?.frames);
        if (hash === undefined) {
            return;
        }
        // Check if we have local variables for an exception that matches the hash
        // remove is identical to get but also removes the entry from the cache
        const cachedFrame = cachedFrames.remove(hash);
        if (cachedFrame === undefined) {
            return;
        }
        // Filter out frames where the function name is `new Promise` since these are in the error.stack frames
        // but do not appear in the debugger call frames
        const frames = (exception.stacktrace?.frames || []).filter((frame)=>frame.function !== 'new Promise');
        for(let i = 0; i < frames.length; i++){
            // Sentry frames are in reverse order
            const frameIndex = frames.length - i - 1;
            const cachedFrameVariable = cachedFrame[i];
            const frameVariable = frames[frameIndex];
            // Drop out if we run out of frames to match up
            if (!frameVariable || !cachedFrameVariable) {
                break;
            }
            if (// We need to have vars to add
            cachedFrameVariable.vars === undefined || frameVariable.in_app === false && options.includeOutOfAppFrames !== true || // The function names need to match
            !common.functionNamesMatch(frameVariable.function, cachedFrameVariable.function)) {
                continue;
            }
            frameVariable.vars = cachedFrameVariable.vars;
        }
    }
    function addLocalVariablesToEvent(event) {
        for (const exception of event.exception?.values || []){
            addLocalVariablesToException(exception);
        }
        return event;
    }
    let setupPromise;
    async function setup() {
        const client = core.getClient();
        const clientOptions = client?.getOptions();
        if (!clientOptions?.includeLocalVariables) {
            return;
        }
        // Only setup this integration if the Node version is >= v18
        // https://github.com/getsentry/sentry-javascript/issues/7697
        const unsupportedNodeVersion = nodeVersion.NODE_MAJOR < 18;
        if (unsupportedNodeVersion) {
            core.debug.log('The `LocalVariables` integration is only supported on Node >= v18.');
            return;
        }
        if (await debug.isDebuggerEnabled()) {
            core.debug.warn('Local variables capture has been disabled because the debugger was already enabled');
            return;
        }
        try {
            const session = await AsyncSession.create(sessionOverride);
            const handlePaused = (stackParser, { params: { reason, data, callFrames } }, complete)=>{
                if (reason !== 'exception' && reason !== 'promiseRejection') {
                    complete();
                    return;
                }
                rateLimiter?.();
                // data.description contains the original error.stack
                const exceptionHash = hashFromStack(stackParser, data.description);
                if (exceptionHash == undefined) {
                    complete();
                    return;
                }
                const { add, next } = createCallbackList((frames)=>{
                    cachedFrames.set(exceptionHash, frames);
                    complete();
                });
                // Because we're queuing up and making all these calls synchronously, we can potentially overflow the stack
                // For this reason we only attempt to get local variables for the first 5 frames
                for(let i = 0; i < Math.min(callFrames.length, 5); i++){
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    const { scopeChain, functionName, this: obj } = callFrames[i];
                    const localScope = scopeChain.find((scope)=>scope.type === 'local');
                    // obj.className is undefined in ESM modules
                    const fn = obj.className === 'global' || !obj.className ? functionName : `${obj.className}.${functionName}`;
                    if (localScope?.object.objectId === undefined) {
                        add((frames)=>{
                            frames[i] = {
                                function: fn
                            };
                            next(frames);
                        });
                    } else {
                        const id = localScope.object.objectId;
                        add((frames)=>session.getLocalVariables(id, (vars)=>{
                                frames[i] = {
                                    function: fn,
                                    vars
                                };
                                next(frames);
                            }));
                    }
                }
                next([]);
            };
            const captureAll = options.captureAllExceptions !== false;
            session.configureAndConnect((ev, complete)=>handlePaused(clientOptions.stackParser, ev, complete), captureAll);
            if (captureAll) {
                const max = options.maxExceptionsPerSecond || 50;
                rateLimiter = common.createRateLimiter(max, ()=>{
                    core.debug.log('Local variables rate-limit lifted.');
                    session.setPauseOnExceptions(true);
                }, (seconds)=>{
                    core.debug.log(`Local variables rate-limit exceeded. Disabling capturing of caught exceptions for ${seconds} seconds.`);
                    session.setPauseOnExceptions(false);
                });
            }
            shouldProcessEvent = true;
        } catch (error) {
            core.debug.log('The `LocalVariables` integration failed to start.', error);
        }
    }
    return {
        name: INTEGRATION_NAME,
        setupOnce () {
            setupPromise = setup();
        },
        async processEvent (event) {
            await setupPromise;
            if (shouldProcessEvent) {
                return addLocalVariablesToEvent(event);
            }
            return event;
        },
        // These are entirely for testing
        _getCachedFramesCount () {
            return cachedFrames.size;
        },
        _getFirstCachedFrame () {
            return cachedFrames.values()[0];
        }
    };
};
/**
 * Adds local variables to exception frames.
 */ const localVariablesSyncIntegration = core.defineIntegration(_localVariablesSyncIntegration);
exports.createCallbackList = createCallbackList;
exports.hashFrames = hashFrames;
exports.hashFromStack = hashFromStack;
exports.localVariablesSyncIntegration = localVariablesSyncIntegration; //# sourceMappingURL=local-variables-sync.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/local-variables/index.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const nodeVersion = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/nodeVersion.js [instrumentation] (ecmascript)");
const localVariablesAsync = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/local-variables/local-variables-async.js [instrumentation] (ecmascript)");
const localVariablesSync = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/local-variables/local-variables-sync.js [instrumentation] (ecmascript)");
const localVariablesIntegration = (options = {})=>{
    return nodeVersion.NODE_VERSION.major < 19 ? localVariablesSync.localVariablesSyncIntegration(options) : localVariablesAsync.localVariablesAsyncIntegration(options);
};
exports.localVariablesIntegration = localVariablesIntegration; //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/detection.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const nodeVersion = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/nodeVersion.js [instrumentation] (ecmascript)");
/** Detect CommonJS. */ function isCjs() {
    try {
        return ("TURBOPACK compile-time value", "object") !== 'undefined' && typeof module.exports !== 'undefined';
    } catch  {
        return false;
    }
}
let hasWarnedAboutNodeVersion;
/**
 * Check if the current Node.js version supports module.register
 */ function supportsEsmLoaderHooks() {
    if (isCjs()) {
        return false;
    }
    if (nodeVersion.NODE_MAJOR >= 21 || nodeVersion.NODE_MAJOR === 20 && nodeVersion.NODE_MINOR >= 6 || nodeVersion.NODE_MAJOR === 18 && nodeVersion.NODE_MINOR >= 19) {
        return true;
    }
    if (!hasWarnedAboutNodeVersion) {
        hasWarnedAboutNodeVersion = true;
        core.consoleSandbox(()=>{
            // eslint-disable-next-line no-console
            console.warn(`[Sentry] You are using Node.js v${process.versions.node} in ESM mode ("import syntax"). The Sentry Node.js SDK is not compatible with ESM in Node.js versions before 18.19.0 or before 20.6.0. Please either build your application with CommonJS ("require() syntax"), or upgrade your Node.js version.`);
        });
    }
    return false;
}
exports.isCjs = isCjs;
exports.supportsEsmLoaderHooks = supportsEsmLoaderHooks; //# sourceMappingURL=detection.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/modules.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const node_fs = __turbopack_context__.r("[externals]/node:fs [external] (node:fs, cjs)");
const node_path = __turbopack_context__.r("[externals]/node:path [external] (node:path, cjs)");
const detection = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/detection.js [instrumentation] (ecmascript)");
let moduleCache;
const INTEGRATION_NAME = 'Modules';
/**
 * `__SENTRY_SERVER_MODULES__` can be replaced at build time with the modules loaded by the server.
 * Right now, we leverage this in Next.js to circumvent the problem that we do not get access to these things at runtime.
 */ const SERVER_MODULES = typeof __SENTRY_SERVER_MODULES__ === 'undefined' ? {} : __SENTRY_SERVER_MODULES__;
const _modulesIntegration = ()=>{
    return {
        name: INTEGRATION_NAME,
        processEvent (event) {
            event.modules = {
                ...event.modules,
                ..._getModules()
            };
            return event;
        },
        getModules: _getModules
    };
};
/**
 * Add node modules / packages to the event.
 * For this, multiple sources are used:
 * - They can be injected at build time into the __SENTRY_SERVER_MODULES__ variable (e.g. in Next.js)
 * - They are extracted from the dependencies & devDependencies in the package.json file
 * - They are extracted from the require.cache (CJS only)
 */ const modulesIntegration = _modulesIntegration;
function getRequireCachePaths() {
    try {
        return ("TURBOPACK compile-time truthy", 1) ? Object.keys(__turbopack_context__.c) : "TURBOPACK unreachable";
    } catch  {
        return [];
    }
}
/** Extract information about package.json modules */ function collectModules() {
    return {
        ...SERVER_MODULES,
        ...getModulesFromPackageJson(),
        ...detection.isCjs() ? collectRequireModules() : {}
    };
}
/** Extract information about package.json modules from require.cache */ function collectRequireModules() {
    const mainPaths = /*TURBOPACK member replacement*/ __turbopack_context__.t.main?.paths || [];
    const paths = getRequireCachePaths();
    // We start with the modules from package.json (if possible)
    // These may be overwritten by more specific versions from the require.cache
    const infos = {};
    const seen = new Set();
    paths.forEach((path)=>{
        let dir = path;
        /** Traverse directories upward in the search of package.json file */ const updir = ()=>{
            const orig = dir;
            dir = node_path.dirname(orig);
            if (!dir || orig === dir || seen.has(orig)) {
                return undefined;
            }
            if (mainPaths.indexOf(dir) < 0) {
                return updir();
            }
            const pkgfile = node_path.join(orig, 'package.json');
            seen.add(orig);
            if (!node_fs.existsSync(pkgfile)) {
                return updir();
            }
            try {
                const info = JSON.parse(node_fs.readFileSync(pkgfile, 'utf8'));
                infos[info.name] = info.version;
            } catch  {
            // no-empty
            }
        };
        updir();
    });
    return infos;
}
/** Fetches the list of modules and the versions loaded by the entry file for your node.js app. */ function _getModules() {
    if (!moduleCache) {
        moduleCache = collectModules();
    }
    return moduleCache;
}
function getPackageJson() {
    try {
        const filePath = node_path.join(process.cwd(), 'package.json');
        const packageJson = JSON.parse(node_fs.readFileSync(filePath, 'utf8'));
        return packageJson;
    } catch  {
        return {};
    }
}
function getModulesFromPackageJson() {
    const packageJson = getPackageJson();
    return {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
    };
}
exports.modulesIntegration = modulesIntegration; //# sourceMappingURL=modules.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/errorhandling.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/debug-build.js [instrumentation] (ecmascript)");
const DEFAULT_SHUTDOWN_TIMEOUT = 2000;
/**
 * @hidden
 */ function logAndExitProcess(error) {
    core.consoleSandbox(()=>{
        // eslint-disable-next-line no-console
        console.error(error);
    });
    const client = core.getClient();
    if (client === undefined) {
        debugBuild.DEBUG_BUILD && core.debug.warn('No NodeClient was defined, we are exiting the process now.');
        /*TURBOPACK member replacement*/ __turbopack_context__.g.process.exit(1);
        return;
    }
    const options = client.getOptions();
    const timeout = options?.shutdownTimeout && options.shutdownTimeout > 0 ? options.shutdownTimeout : DEFAULT_SHUTDOWN_TIMEOUT;
    client.close(timeout).then((result)=>{
        if (!result) {
            debugBuild.DEBUG_BUILD && core.debug.warn('We reached the timeout for emptying the request buffer, still exiting now!');
        }
        /*TURBOPACK member replacement*/ __turbopack_context__.g.process.exit(1);
    }, (error)=>{
        debugBuild.DEBUG_BUILD && core.debug.error(error);
    });
}
exports.logAndExitProcess = logAndExitProcess; //# sourceMappingURL=errorhandling.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/onuncaughtexception.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const worker_threads = __turbopack_context__.r("[externals]/worker_threads [external] (worker_threads, cjs)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/debug-build.js [instrumentation] (ecmascript)");
const errorhandling = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/errorhandling.js [instrumentation] (ecmascript)");
const INTEGRATION_NAME = 'OnUncaughtException';
/**
 * Add a global exception handler.
 */ const onUncaughtExceptionIntegration = core.defineIntegration((options = {})=>{
    const optionsWithDefaults = {
        exitEvenIfOtherHandlersAreRegistered: false,
        ...options
    };
    return {
        name: INTEGRATION_NAME,
        setup (client) {
            // errors in worker threads are already handled by the childProcessIntegration
            // also we don't want to exit the Node process on worker thread errors
            if (!worker_threads.isMainThread) {
                return;
            }
            /*TURBOPACK member replacement*/ __turbopack_context__.g.process.on('uncaughtException', makeErrorHandler(client, optionsWithDefaults));
        }
    };
});
/** Exported only for tests */ function makeErrorHandler(client, options) {
    const timeout = 2000;
    let caughtFirstError = false;
    let caughtSecondError = false;
    let calledFatalError = false;
    let firstError;
    const clientOptions = client.getOptions();
    return Object.assign((error)=>{
        let onFatalError = errorhandling.logAndExitProcess;
        if (options.onFatalError) {
            onFatalError = options.onFatalError;
        } else if (clientOptions.onFatalError) {
            onFatalError = clientOptions.onFatalError;
        }
        // Attaching a listener to `uncaughtException` will prevent the node process from exiting. We generally do not
        // want to alter this behaviour so we check for other listeners that users may have attached themselves and adjust
        // exit behaviour of the SDK accordingly:
        // - If other listeners are attached, do not exit.
        // - If the only listener attached is ours, exit.
        const userProvidedListenersCount = /*TURBOPACK member replacement*/ __turbopack_context__.g.process.listeners('uncaughtException').filter((listener)=>{
            // There are 3 listeners we ignore:
            return(// as soon as we're using domains this listener is attached by node itself
            listener.name !== 'domainUncaughtExceptionClear' && // the handler we register for tracing
            listener.tag !== 'sentry_tracingErrorCallback' && // the handler we register in this integration
            listener._errorHandler !== true);
        }).length;
        const processWouldExit = userProvidedListenersCount === 0;
        const shouldApplyFatalHandlingLogic = options.exitEvenIfOtherHandlersAreRegistered || processWouldExit;
        if (!caughtFirstError) {
            // this is the first uncaught error and the ultimate reason for shutting down
            // we want to do absolutely everything possible to ensure it gets captured
            // also we want to make sure we don't go recursion crazy if more errors happen after this one
            firstError = error;
            caughtFirstError = true;
            if (core.getClient() === client) {
                core.captureException(error, {
                    originalException: error,
                    captureContext: {
                        level: 'fatal'
                    },
                    mechanism: {
                        handled: false,
                        type: 'auto.node.onuncaughtexception'
                    }
                });
            }
            if (!calledFatalError && shouldApplyFatalHandlingLogic) {
                calledFatalError = true;
                onFatalError(error);
            }
        } else {
            if (shouldApplyFatalHandlingLogic) {
                if (calledFatalError) {
                    // we hit an error *after* calling onFatalError - pretty boned at this point, just shut it down
                    debugBuild.DEBUG_BUILD && core.debug.warn('uncaught exception after calling fatal error shutdown callback - this is bad! forcing shutdown');
                    errorhandling.logAndExitProcess(error);
                } else if (!caughtSecondError) {
                    // two cases for how we can hit this branch:
                    //   - capturing of first error blew up and we just caught the exception from that
                    //     - quit trying to capture, proceed with shutdown
                    //   - a second independent error happened while waiting for first error to capture
                    //     - want to avoid causing premature shutdown before first error capture finishes
                    // it's hard to immediately tell case 1 from case 2 without doing some fancy/questionable domain stuff
                    // so let's instead just delay a bit before we proceed with our action here
                    // in case 1, we just wait a bit unnecessarily but ultimately do the same thing
                    // in case 2, the delay hopefully made us wait long enough for the capture to finish
                    // two potential nonideal outcomes:
                    //   nonideal case 1: capturing fails fast, we sit around for a few seconds unnecessarily before proceeding correctly by calling onFatalError
                    //   nonideal case 2: case 2 happens, 1st error is captured but slowly, timeout completes before capture and we treat second error as the sendErr of (nonexistent) failure from trying to capture first error
                    // note that after hitting this branch, we might catch more errors where (caughtSecondError && !calledFatalError)
                    //   we ignore them - they don't matter to us, we're just waiting for the second error timeout to finish
                    caughtSecondError = true;
                    setTimeout(()=>{
                        if (!calledFatalError) {
                            // it was probably case 1, let's treat err as the sendErr and call onFatalError
                            calledFatalError = true;
                            onFatalError(firstError, error);
                        }
                    }, timeout); // capturing could take at least sendTimeout to fail, plus an arbitrary second for how long it takes to collect surrounding source etc
                }
            }
        }
    }, {
        _errorHandler: true
    });
}
exports.makeErrorHandler = makeErrorHandler;
exports.onUncaughtExceptionIntegration = onUncaughtExceptionIntegration; //# sourceMappingURL=onuncaughtexception.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/onunhandledrejection.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const errorhandling = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/errorhandling.js [instrumentation] (ecmascript)");
const INTEGRATION_NAME = 'OnUnhandledRejection';
const DEFAULT_IGNORES = [
    {
        name: 'AI_NoOutputGeneratedError'
    },
    {
        name: 'AbortError'
    }
];
const _onUnhandledRejectionIntegration = (options = {})=>{
    const opts = {
        mode: options.mode ?? 'warn',
        ignore: [
            ...DEFAULT_IGNORES,
            ...options.ignore ?? []
        ]
    };
    return {
        name: INTEGRATION_NAME,
        setup (client) {
            /*TURBOPACK member replacement*/ __turbopack_context__.g.process.on('unhandledRejection', makeUnhandledPromiseHandler(client, opts));
        }
    };
};
const onUnhandledRejectionIntegration = core.defineIntegration(_onUnhandledRejectionIntegration);
/** Extract error info safely */ function extractErrorInfo(reason) {
    // Check if reason is an object (including Error instances, not just plain objects)
    if (typeof reason !== 'object' || reason === null) {
        return {
            name: '',
            message: String(reason ?? '')
        };
    }
    const errorLike = reason;
    const name = typeof errorLike.name === 'string' ? errorLike.name : '';
    const message = typeof errorLike.message === 'string' ? errorLike.message : String(reason);
    return {
        name,
        message
    };
}
/** Check if a matcher matches the reason */ function isMatchingReason(matcher, errorInfo) {
    // name/message matcher
    const nameMatches = matcher.name === undefined || core.isMatchingPattern(errorInfo.name, matcher.name, true);
    const messageMatches = matcher.message === undefined || core.isMatchingPattern(errorInfo.message, matcher.message);
    return nameMatches && messageMatches;
}
/** Match helper */ function matchesIgnore(list, reason) {
    const errorInfo = extractErrorInfo(reason);
    return list.some((matcher)=>isMatchingReason(matcher, errorInfo));
}
/** Core handler */ function makeUnhandledPromiseHandler(client, options) {
    return function sendUnhandledPromise(reason, promise) {
        // Only handle for the active client
        if (core.getClient() !== client) {
            return;
        }
        // Skip if configured to ignore
        if (matchesIgnore(options.ignore ?? [], reason)) {
            return;
        }
        const level = options.mode === 'strict' ? 'fatal' : 'error';
        // this can be set in places where we cannot reliably get access to the active span/error
        // when the error bubbles up to this handler, we can use this to set the active span
        const activeSpanForError = reason && typeof reason === 'object' ? reason._sentry_active_span : undefined;
        const activeSpanWrapper = activeSpanForError ? (fn)=>core.withActiveSpan(activeSpanForError, fn) : (fn)=>fn();
        activeSpanWrapper(()=>{
            core.captureException(reason, {
                originalException: promise,
                captureContext: {
                    extra: {
                        unhandledPromiseRejection: true
                    },
                    level
                },
                mechanism: {
                    handled: false,
                    type: 'auto.node.onunhandledrejection'
                }
            });
        });
        handleRejection(reason, options.mode);
    };
}
/**
 * Handler for `mode` option
 */ function handleRejection(reason, mode) {
    // https://github.com/nodejs/node/blob/7cf6f9e964aa00772965391c23acda6d71972a9a/lib/internal/process/promises.js#L234-L240
    const rejectionWarning = 'This error originated either by ' + 'throwing inside of an async function without a catch block, ' + 'or by rejecting a promise which was not handled with .catch().' + ' The promise rejected with the reason:';
    /* eslint-disable no-console */ if (mode === 'warn') {
        core.consoleSandbox(()=>{
            console.warn(rejectionWarning);
            console.error(reason && typeof reason === 'object' && 'stack' in reason ? reason.stack : reason);
        });
    } else if (mode === 'strict') {
        core.consoleSandbox(()=>{
            console.warn(rejectionWarning);
        });
        errorhandling.logAndExitProcess(reason);
    }
/* eslint-enable no-console */ }
exports.makeUnhandledPromiseHandler = makeUnhandledPromiseHandler;
exports.onUnhandledRejectionIntegration = onUnhandledRejectionIntegration; //# sourceMappingURL=onunhandledrejection.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/processSession.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const INTEGRATION_NAME = 'ProcessSession';
/**
 * Records a Session for the current process to track release health.
 */ const processSessionIntegration = core.defineIntegration(()=>{
    return {
        name: INTEGRATION_NAME,
        setupOnce () {
            core.startSession();
            // Emitted in the case of healthy sessions, error of `mechanism.handled: true` and unhandledrejections because
            // The 'beforeExit' event is not emitted for conditions causing explicit termination,
            // such as calling process.exit() or uncaught exceptions.
            // Ref: https://nodejs.org/api/process.html#process_event_beforeexit
            process.on('beforeExit', ()=>{
                const session = core.getIsolationScope().getSession();
                // Only call endSession, if the Session exists on Scope and SessionStatus is not a
                // Terminal Status i.e. Exited or Crashed because
                // "When a session is moved away from ok it must not be updated anymore."
                // Ref: https://develop.sentry.dev/sdk/sessions/
                if (session?.status !== 'ok') {
                    core.endSession();
                }
            });
        }
    };
});
exports.processSessionIntegration = processSessionIntegration; //# sourceMappingURL=processSession.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/spotlight.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const http = __turbopack_context__.r("[externals]/node:http [external] (node:http, cjs)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const INTEGRATION_NAME = 'Spotlight';
const _spotlightIntegration = (options = {})=>{
    const _options = {
        sidecarUrl: options.sidecarUrl || 'http://localhost:8969/stream'
    };
    return {
        name: INTEGRATION_NAME,
        setup (client) {
            try {
                if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
                ;
            } catch  {
            // ignore
            }
            connectToSpotlight(client, _options);
        }
    };
};
/**
 * Use this integration to send errors and transactions to Spotlight.
 *
 * Learn more about spotlight at https://spotlightjs.com
 *
 * Important: This integration only works with Node 18 or newer.
 */ const spotlightIntegration = core.defineIntegration(_spotlightIntegration);
function connectToSpotlight(client, options) {
    const spotlightUrl = parseSidecarUrl(options.sidecarUrl);
    if (!spotlightUrl) {
        return;
    }
    let failedRequests = 0;
    client.on('beforeEnvelope', (envelope)=>{
        if (failedRequests > 3) {
            core.debug.warn('[Spotlight] Disabled Sentry -> Spotlight integration due to too many failed requests');
            return;
        }
        const serializedEnvelope = core.serializeEnvelope(envelope);
        core.suppressTracing(()=>{
            const req = http.request({
                method: 'POST',
                path: spotlightUrl.pathname,
                hostname: spotlightUrl.hostname,
                port: spotlightUrl.port,
                headers: {
                    'Content-Type': 'application/x-sentry-envelope'
                }
            }, (res)=>{
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
                    // Reset failed requests counter on success
                    failedRequests = 0;
                }
                res.on('data', ()=>{
                // Drain socket
                });
                res.on('end', ()=>{
                // Drain socket
                });
                res.setEncoding('utf8');
            });
            req.on('error', ()=>{
                failedRequests++;
                core.debug.warn('[Spotlight] Failed to send envelope to Spotlight Sidecar');
            });
            req.write(serializedEnvelope);
            req.end();
        });
    });
}
function parseSidecarUrl(url) {
    try {
        return new URL(`${url}`);
    } catch  {
        core.debug.warn(`[Spotlight] Invalid sidecar URL: ${url}`);
        return undefined;
    }
}
exports.INTEGRATION_NAME = INTEGRATION_NAME;
exports.spotlightIntegration = spotlightIntegration; //# sourceMappingURL=spotlight.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/systemError.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const util = __turbopack_context__.r("[externals]/node:util [external] (node:util, cjs)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const INTEGRATION_NAME = 'NodeSystemError';
function isSystemError(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    if (!('errno' in error) || typeof error.errno !== 'number') {
        return false;
    }
    // Appears this is the recommended way to check for Node.js SystemError
    // https://github.com/nodejs/node/issues/46869
    return util.getSystemErrorMap().has(error.errno);
}
/**
 * Captures context for Node.js SystemError errors.
 */ const systemErrorIntegration = core.defineIntegration((options = {})=>{
    return {
        name: INTEGRATION_NAME,
        processEvent: (event, hint, client)=>{
            if (!isSystemError(hint.originalException)) {
                return event;
            }
            const error = hint.originalException;
            const errorContext = {
                ...error
            };
            if (!client.getOptions().sendDefaultPii && options.includePaths !== true) {
                delete errorContext.path;
                delete errorContext.dest;
            }
            event.contexts = {
                ...event.contexts,
                node_system_error: errorContext
            };
            for (const exception of event.exception?.values || []){
                if (exception.value) {
                    if (error.path && exception.value.includes(error.path)) {
                        exception.value = exception.value.replace(`'${error.path}'`, '').trim();
                    }
                    if (error.dest && exception.value.includes(error.dest)) {
                        exception.value = exception.value.replace(`'${error.dest}'`, '').trim();
                    }
                }
            }
            return event;
        }
    };
});
exports.systemErrorIntegration = systemErrorIntegration; //# sourceMappingURL=systemError.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/proxy/base.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const http = __turbopack_context__.r("[externals]/node:http [external] (node:http, cjs)");
__turbopack_context__.r("[externals]/node:https [external] (node:https, cjs)");
/**
 * This code was originally forked from https://github.com/TooTallNate/proxy-agents/tree/b133295fd16f6475578b6b15bd9b4e33ecb0d0b7
 * With the following LICENSE:
 *
 * (The MIT License)
 *
 * Copyright (c) 2013 Nathan Rajlich <nathan@tootallnate.net>*
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * 'Software'), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:*
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.*
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */ const INTERNAL = Symbol('AgentBaseInternalState');
class Agent extends http.Agent {
    // Set by `http.Agent` - missing from `@types/node`
    constructor(opts){
        super(opts);
        this[INTERNAL] = {};
    }
    /**
   * Determine whether this is an `http` or `https` request.
   */ isSecureEndpoint(options) {
        if (options) {
            // First check the `secureEndpoint` property explicitly, since this
            // means that a parent `Agent` is "passing through" to this instance.
            if (typeof options.secureEndpoint === 'boolean') {
                return options.secureEndpoint;
            }
            // If no explicit `secure` endpoint, check if `protocol` property is
            // set. This will usually be the case since using a full string URL
            // or `URL` instance should be the most common usage.
            if (typeof options.protocol === 'string') {
                return options.protocol === 'https:';
            }
        }
        // Finally, if no `protocol` property was set, then fall back to
        // checking the stack trace of the current call stack, and try to
        // detect the "https" module.
        const { stack } = new Error();
        if (typeof stack !== 'string') return false;
        return stack.split('\n').some((l)=>l.indexOf('(https.js:') !== -1 || l.indexOf('node:https:') !== -1);
    }
    createSocket(req, options, cb) {
        const connectOpts = {
            ...options,
            secureEndpoint: this.isSecureEndpoint(options)
        };
        Promise.resolve().then(()=>this.connect(req, connectOpts)).then((socket)=>{
            if (socket instanceof http.Agent) {
                // @ts-expect-error `addRequest()` isn't defined in `@types/node`
                return socket.addRequest(req, connectOpts);
            }
            this[INTERNAL].currentSocket = socket;
            // @ts-expect-error `createSocket()` isn't defined in `@types/node`
            super.createSocket(req, options, cb);
        }, cb);
    }
    createConnection() {
        const socket = this[INTERNAL].currentSocket;
        this[INTERNAL].currentSocket = undefined;
        if (!socket) {
            throw new Error('No socket was returned in the `connect()` function');
        }
        return socket;
    }
    get defaultPort() {
        return this[INTERNAL].defaultPort ?? (this.protocol === 'https:' ? 443 : 80);
    }
    set defaultPort(v) {
        if (this[INTERNAL]) {
            this[INTERNAL].defaultPort = v;
        }
    }
    get protocol() {
        return this[INTERNAL].protocol ?? (this.isSecureEndpoint() ? 'https:' : 'http:');
    }
    set protocol(v) {
        if (this[INTERNAL]) {
            this[INTERNAL].protocol = v;
        }
    }
}
exports.Agent = Agent; //# sourceMappingURL=base.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/proxy/parse-proxy-response.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
function debugLog(...args) {
    core.debug.log('[https-proxy-agent:parse-proxy-response]', ...args);
}
function parseProxyResponse(socket) {
    return new Promise((resolve, reject)=>{
        // we need to buffer any HTTP traffic that happens with the proxy before we get
        // the CONNECT response, so that if the response is anything other than an "200"
        // response code, then we can re-play the "data" events on the socket once the
        // HTTP parser is hooked up...
        let buffersLength = 0;
        const buffers = [];
        function read() {
            const b = socket.read();
            if (b) ondata(b);
            else socket.once('readable', read);
        }
        function cleanup() {
            socket.removeListener('end', onend);
            socket.removeListener('error', onerror);
            socket.removeListener('readable', read);
        }
        function onend() {
            cleanup();
            debugLog('onend');
            reject(new Error('Proxy connection ended before receiving CONNECT response'));
        }
        function onerror(err) {
            cleanup();
            debugLog('onerror %o', err);
            reject(err);
        }
        function ondata(b) {
            buffers.push(b);
            buffersLength += b.length;
            const buffered = Buffer.concat(buffers, buffersLength);
            const endOfHeaders = buffered.indexOf('\r\n\r\n');
            if (endOfHeaders === -1) {
                // keep buffering
                debugLog('have not received end of HTTP headers yet...');
                read();
                return;
            }
            const headerParts = buffered.subarray(0, endOfHeaders).toString('ascii').split('\r\n');
            const firstLine = headerParts.shift();
            if (!firstLine) {
                socket.destroy();
                return reject(new Error('No header received from proxy CONNECT response'));
            }
            const firstLineParts = firstLine.split(' ');
            const statusCode = +(firstLineParts[1] || 0);
            const statusText = firstLineParts.slice(2).join(' ');
            const headers = {};
            for (const header of headerParts){
                if (!header) continue;
                const firstColon = header.indexOf(':');
                if (firstColon === -1) {
                    socket.destroy();
                    return reject(new Error(`Invalid header from proxy CONNECT response: "${header}"`));
                }
                const key = header.slice(0, firstColon).toLowerCase();
                const value = header.slice(firstColon + 1).trimStart();
                const current = headers[key];
                if (typeof current === 'string') {
                    headers[key] = [
                        current,
                        value
                    ];
                } else if (Array.isArray(current)) {
                    current.push(value);
                } else {
                    headers[key] = value;
                }
            }
            debugLog('got proxy server response: %o %o', firstLine, headers);
            cleanup();
            resolve({
                connect: {
                    statusCode,
                    statusText,
                    headers
                },
                buffered
            });
        }
        socket.on('error', onerror);
        socket.on('end', onend);
        read();
    });
}
exports.parseProxyResponse = parseProxyResponse; //# sourceMappingURL=parse-proxy-response.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/proxy/index.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const net = __turbopack_context__.r("[externals]/node:net [external] (node:net, cjs)");
const tls = __turbopack_context__.r("[externals]/node:tls [external] (node:tls, cjs)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const base = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/proxy/base.js [instrumentation] (ecmascript)");
const parseProxyResponse = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/proxy/parse-proxy-response.js [instrumentation] (ecmascript)");
function debugLog(...args) {
    core.debug.log('[https-proxy-agent]', ...args);
}
/**
 * The `HttpsProxyAgent` implements an HTTP Agent subclass that connects to
 * the specified "HTTP(s) proxy server" in order to proxy HTTPS requests.
 *
 * Outgoing HTTP requests are first tunneled through the proxy server using the
 * `CONNECT` HTTP request method to establish a connection to the proxy server,
 * and then the proxy server connects to the destination target and issues the
 * HTTP request from the proxy server.
 *
 * `https:` requests have their socket connection upgraded to TLS once
 * the connection to the proxy server has been established.
 */ class HttpsProxyAgent extends base.Agent {
    static __initStatic() {
        this.protocols = [
            'http',
            'https'
        ];
    }
    constructor(proxy, opts){
        super(opts);
        this.options = {};
        this.proxy = typeof proxy === 'string' ? new URL(proxy) : proxy;
        this.proxyHeaders = opts?.headers ?? {};
        debugLog('Creating new HttpsProxyAgent instance: %o', this.proxy.href);
        // Trim off the brackets from IPv6 addresses
        const host = (this.proxy.hostname || this.proxy.host).replace(/^\[|\]$/g, '');
        const port = this.proxy.port ? parseInt(this.proxy.port, 10) : this.proxy.protocol === 'https:' ? 443 : 80;
        this.connectOpts = {
            // Attempt to negotiate http/1.1 for proxy servers that support http/2
            ALPNProtocols: [
                'http/1.1'
            ],
            ...opts ? omit(opts, 'headers') : null,
            host,
            port
        };
    }
    /**
   * Called when the node-core HTTP client library is creating a
   * new HTTP request.
   */ async connect(req, opts) {
        const { proxy } = this;
        if (!opts.host) {
            throw new TypeError('No "host" provided');
        }
        // Create a socket connection to the proxy server.
        let socket;
        if (proxy.protocol === 'https:') {
            debugLog('Creating `tls.Socket`: %o', this.connectOpts);
            const servername = this.connectOpts.servername || this.connectOpts.host;
            socket = tls.connect({
                ...this.connectOpts,
                servername: servername && net.isIP(servername) ? undefined : servername
            });
        } else {
            debugLog('Creating `net.Socket`: %o', this.connectOpts);
            socket = net.connect(this.connectOpts);
        }
        const headers = typeof this.proxyHeaders === 'function' ? this.proxyHeaders() : {
            ...this.proxyHeaders
        };
        const host = net.isIPv6(opts.host) ? `[${opts.host}]` : opts.host;
        let payload = `CONNECT ${host}:${opts.port} HTTP/1.1\r\n`;
        // Inject the `Proxy-Authorization` header if necessary.
        if (proxy.username || proxy.password) {
            const auth = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
            headers['Proxy-Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
        }
        headers.Host = `${host}:${opts.port}`;
        if (!headers['Proxy-Connection']) {
            headers['Proxy-Connection'] = this.keepAlive ? 'Keep-Alive' : 'close';
        }
        for (const name of Object.keys(headers)){
            payload += `${name}: ${headers[name]}\r\n`;
        }
        const proxyResponsePromise = parseProxyResponse.parseProxyResponse(socket);
        socket.write(`${payload}\r\n`);
        const { connect, buffered } = await proxyResponsePromise;
        req.emit('proxyConnect', connect);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore Not EventEmitter in Node types
        this.emit('proxyConnect', connect, req);
        if (connect.statusCode === 200) {
            req.once('socket', resume);
            if (opts.secureEndpoint) {
                // The proxy is connecting to a TLS server, so upgrade
                // this socket connection to a TLS connection.
                debugLog('Upgrading socket connection to TLS');
                const servername = opts.servername || opts.host;
                return tls.connect({
                    ...omit(opts, 'host', 'path', 'port'),
                    socket,
                    servername: net.isIP(servername) ? undefined : servername
                });
            }
            return socket;
        }
        // Some other status code that's not 200... need to re-play the HTTP
        // header "data" events onto the socket once the HTTP machinery is
        // attached so that the node core `http` can parse and handle the
        // error status code.
        // Close the original socket, and a new "fake" socket is returned
        // instead, so that the proxy doesn't get the HTTP request
        // written to it (which may contain `Authorization` headers or other
        // sensitive data).
        //
        // See: https://hackerone.com/reports/541502
        socket.destroy();
        const fakeSocket = new net.Socket({
            writable: false
        });
        fakeSocket.readable = true;
        // Need to wait for the "socket" event to re-play the "data" events.
        req.once('socket', (s)=>{
            debugLog('Replaying proxy buffer for failed request');
            // Replay the "buffered" Buffer onto the fake `socket`, since at
            // this point the HTTP module machinery has been hooked up for
            // the user.
            s.push(buffered);
            s.push(null);
        });
        return fakeSocket;
    }
}
HttpsProxyAgent.__initStatic();
function resume(socket) {
    socket.resume();
}
function omit(obj, ...keys) {
    const ret = {};
    let key;
    for(key in obj){
        if (!keys.includes(key)) {
            ret[key] = obj[key];
        }
    }
    return ret;
}
exports.HttpsProxyAgent = HttpsProxyAgent; //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/transports/http.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const http = __turbopack_context__.r("[externals]/node:http [external] (node:http, cjs)");
const https = __turbopack_context__.r("[externals]/node:https [external] (node:https, cjs)");
const node_stream = __turbopack_context__.r("[externals]/node:stream [external] (node:stream, cjs)");
const node_zlib = __turbopack_context__.r("[externals]/node:zlib [external] (node:zlib, cjs)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const index = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/proxy/index.js [instrumentation] (ecmascript)");
// Estimated maximum size for reasonable standalone event
const GZIP_THRESHOLD = 1024 * 32;
/**
 * Gets a stream from a Uint8Array or string
 * Readable.from is ideal but was added in node.js v12.3.0 and v10.17.0
 */ function streamFromBody(body) {
    return new node_stream.Readable({
        read () {
            this.push(body);
            this.push(null);
        }
    });
}
/**
 * Creates a Transport that uses native the native 'http' and 'https' modules to send events to Sentry.
 */ function makeNodeTransport(options) {
    let urlSegments;
    try {
        urlSegments = new URL(options.url);
    } catch (e) {
        core.consoleSandbox(()=>{
            // eslint-disable-next-line no-console
            console.warn('[@sentry/node]: Invalid dsn or tunnel option, will not send any events. The tunnel option must be a full URL when used.');
        });
        return core.createTransport(options, ()=>Promise.resolve({}));
    }
    const isHttps = urlSegments.protocol === 'https:';
    // Proxy prioritization: http => `options.proxy` | `process.env.http_proxy`
    // Proxy prioritization: https => `options.proxy` | `process.env.https_proxy` | `process.env.http_proxy`
    const proxy = applyNoProxyOption(urlSegments, options.proxy || (isHttps ? process.env.https_proxy : undefined) || process.env.http_proxy);
    const nativeHttpModule = isHttps ? https : http;
    const keepAlive = options.keepAlive === undefined ? false : options.keepAlive;
    // TODO(v11): Evaluate if we can set keepAlive to true. This would involve testing for memory leaks in older node
    // versions(>= 8) as they had memory leaks when using it: #2555
    const agent = proxy ? new index.HttpsProxyAgent(proxy) : new nativeHttpModule.Agent({
        keepAlive,
        maxSockets: 30,
        timeout: 2000
    });
    const requestExecutor = createRequestExecutor(options, options.httpModule ?? nativeHttpModule, agent);
    return core.createTransport(options, requestExecutor);
}
/**
 * Honors the `no_proxy` env variable with the highest priority to allow for hosts exclusion.
 *
 * @param transportUrl The URL the transport intends to send events to.
 * @param proxy The client configured proxy.
 * @returns A proxy the transport should use.
 */ function applyNoProxyOption(transportUrlSegments, proxy) {
    const { no_proxy } = process.env;
    const urlIsExemptFromProxy = no_proxy?.split(',').some((exemption)=>transportUrlSegments.host.endsWith(exemption) || transportUrlSegments.hostname.endsWith(exemption));
    if (urlIsExemptFromProxy) {
        return undefined;
    } else {
        return proxy;
    }
}
/**
 * Creates a RequestExecutor to be used with `createTransport`.
 */ function createRequestExecutor(options, httpModule, agent) {
    const { hostname, pathname, port, protocol, search } = new URL(options.url);
    return function makeRequest(request) {
        return new Promise((resolve, reject)=>{
            // This ensures we do not generate any spans in OpenTelemetry for the transport
            core.suppressTracing(()=>{
                let body = streamFromBody(request.body);
                const headers = {
                    ...options.headers
                };
                if (request.body.length > GZIP_THRESHOLD) {
                    headers['content-encoding'] = 'gzip';
                    body = body.pipe(node_zlib.createGzip());
                }
                const hostnameIsIPv6 = hostname.startsWith('[');
                const req = httpModule.request({
                    method: 'POST',
                    agent,
                    headers,
                    // Remove "[" and "]" from IPv6 hostnames
                    hostname: hostnameIsIPv6 ? hostname.slice(1, -1) : hostname,
                    path: `${pathname}${search}`,
                    port,
                    protocol,
                    ca: options.caCerts
                }, (res)=>{
                    res.on('data', ()=>{
                    // Drain socket
                    });
                    res.on('end', ()=>{
                    // Drain socket
                    });
                    res.setEncoding('utf8');
                    // "Key-value pairs of header names and values. Header names are lower-cased."
                    // https://nodejs.org/api/http.html#http_message_headers
                    const retryAfterHeader = res.headers['retry-after'] ?? null;
                    const rateLimitsHeader = res.headers['x-sentry-rate-limits'] ?? null;
                    resolve({
                        statusCode: res.statusCode,
                        headers: {
                            'retry-after': retryAfterHeader,
                            'x-sentry-rate-limits': Array.isArray(rateLimitsHeader) ? rateLimitsHeader[0] || null : rateLimitsHeader
                        }
                    });
                });
                req.on('error', reject);
                body.pipe(req);
            });
        });
    };
}
exports.makeNodeTransport = makeNodeTransport; //# sourceMappingURL=http.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/spotlight.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
/**
 * Parse the spotlight option with proper precedence:
 * - `false` or explicit string from options: use as-is
 * - `true`: enable spotlight, but prefer a custom URL from the env var if set
 * - `undefined`: defer entirely to the env var (bool or URL)
 */ function getSpotlightConfig(optionsSpotlight) {
    if (optionsSpotlight === false) {
        return false;
    }
    if (typeof optionsSpotlight === 'string') {
        return optionsSpotlight;
    }
    // optionsSpotlight is true or undefined
    const envBool = core.envToBool(process.env.SENTRY_SPOTLIGHT, {
        strict: true
    });
    const envUrl = envBool === null && process.env.SENTRY_SPOTLIGHT ? process.env.SENTRY_SPOTLIGHT : undefined;
    return optionsSpotlight === true ? envUrl ?? true : envBool ?? envUrl; // undefined: use env var (bool or URL)
}
exports.getSpotlightConfig = getSpotlightConfig; //# sourceMappingURL=spotlight.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/module.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const node_path = __turbopack_context__.r("[externals]/node:path [external] (node:path, cjs)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
/** normalizes Windows paths */ function normalizeWindowsPath(path) {
    return path.replace(/^[A-Z]:/, '') // remove Windows-style prefix
    .replace(/\\/g, '/'); // replace all `\` instances with `/`
}
/** Creates a function that gets the module name from a filename */ function createGetModuleFromFilename(basePath = process.argv[1] ? core.dirname(process.argv[1]) : process.cwd(), isWindows = node_path.sep === '\\') {
    const normalizedBase = isWindows ? normalizeWindowsPath(basePath) : basePath;
    return (filename)=>{
        if (!filename) {
            return;
        }
        const normalizedFilename = isWindows ? normalizeWindowsPath(filename) : filename;
        // eslint-disable-next-line prefer-const
        let { dir, base: file, ext } = node_path.posix.parse(normalizedFilename);
        if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
            file = file.slice(0, ext.length * -1);
        }
        // The file name might be URI-encoded which we want to decode to
        // the original file name.
        const decodedFile = decodeURIComponent(file);
        if (!dir) {
            // No dirname whatsoever
            dir = '.';
        }
        const n = dir.lastIndexOf('/node_modules');
        if (n > -1) {
            return `${dir.slice(n + 14).replace(/\//g, '.')}:${decodedFile}`;
        }
        // Let's see if it's a part of the main module
        // To be a part of main module, it has to share the same base
        if (dir.startsWith(normalizedBase)) {
            const moduleName = dir.slice(normalizedBase.length + 1).replace(/\//g, '.');
            return moduleName ? `${moduleName}:${decodedFile}` : decodedFile;
        }
        return decodedFile;
    };
}
exports.createGetModuleFromFilename = createGetModuleFromFilename; //# sourceMappingURL=module.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/api.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const module$1 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/module.js [instrumentation] (ecmascript)");
/**
 * Returns a release dynamically from environment variables.
 */ // eslint-disable-next-line complexity
function getSentryRelease(fallback) {
    // Always read first as Sentry takes this as precedence
    if (process.env.SENTRY_RELEASE) {
        return process.env.SENTRY_RELEASE;
    }
    // This supports the variable that sentry-webpack-plugin injects
    if (core.GLOBAL_OBJ.SENTRY_RELEASE?.id) {
        return core.GLOBAL_OBJ.SENTRY_RELEASE.id;
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
/** Node.js stack parser */ const defaultStackParser = core.createStackParser(core.nodeStackLineParser(module$1.createGetModuleFromFilename()));
exports.defaultStackParser = defaultStackParser;
exports.getSentryRelease = getSentryRelease; //# sourceMappingURL=api.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/client.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const os = __turbopack_context__.r("[externals]/node:os [external] (node:os, cjs)");
const api = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/index.js [instrumentation] (ecmascript)");
const instrumentation = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const opentelemetry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/opentelemetry/build/cjs/index.js [instrumentation] (ecmascript)");
const worker_threads = __turbopack_context__.r("[externals]/worker_threads [external] (worker_threads, cjs)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/debug-build.js [instrumentation] (ecmascript)");
const DEFAULT_CLIENT_REPORT_FLUSH_INTERVAL_MS = 60000; // 60s was chosen arbitrarily
/** A client for using Sentry with Node & OpenTelemetry. */ class NodeClient extends core.ServerRuntimeClient {
    constructor(options){
        const serverName = options.includeServerName === false ? undefined : options.serverName || /*TURBOPACK member replacement*/ __turbopack_context__.g.process.env.SENTRY_NAME || os.hostname();
        const clientOptions = {
            ...options,
            platform: 'node',
            // Use provided runtime or default to 'node' with current process version
            runtime: options.runtime || {
                name: 'node',
                version: /*TURBOPACK member replacement*/ __turbopack_context__.g.process.version
            },
            serverName
        };
        if (options.openTelemetryInstrumentations) {
            instrumentation.registerInstrumentations({
                instrumentations: options.openTelemetryInstrumentations
            });
        }
        core.applySdkMetadata(clientOptions, 'node');
        core.debug.log(`Initializing Sentry: process: ${process.pid}, thread: ${worker_threads.isMainThread ? 'main' : `worker-${worker_threads.threadId}`}.`);
        super(clientOptions);
        if (this.getOptions().enableLogs) {
            this._logOnExitFlushListener = ()=>{
                core._INTERNAL_flushLogsBuffer(this);
            };
            if (serverName) {
                this.on('beforeCaptureLog', (log)=>{
                    log.attributes = {
                        ...log.attributes,
                        'server.address': serverName
                    };
                });
            }
            process.on('beforeExit', this._logOnExitFlushListener);
        }
    }
    /** Get the OTEL tracer. */ get tracer() {
        if (this._tracer) {
            return this._tracer;
        }
        const name = '@sentry/node';
        const version = core.SDK_VERSION;
        const tracer = api.trace.getTracer(name, version);
        this._tracer = tracer;
        return tracer;
    }
    /** @inheritDoc */ // @ts-expect-error - PromiseLike is a subset of Promise
    async flush(timeout) {
        await this.traceProvider?.forceFlush();
        if (this.getOptions().sendClientReports) {
            this._flushOutcomes();
        }
        return super.flush(timeout);
    }
    /** @inheritDoc */ // @ts-expect-error - PromiseLike is a subset of Promise
    async close(timeout) {
        if (this._clientReportInterval) {
            clearInterval(this._clientReportInterval);
        }
        if (this._clientReportOnExitFlushListener) {
            process.off('beforeExit', this._clientReportOnExitFlushListener);
        }
        if (this._logOnExitFlushListener) {
            process.off('beforeExit', this._logOnExitFlushListener);
        }
        const allEventsSent = await super.close(timeout);
        if (this.traceProvider) {
            await this.traceProvider.shutdown();
        }
        return allEventsSent;
    }
    /**
   * Will start tracking client reports for this client.
   *
   * NOTICE: This method will create an interval that is periodically called and attach a `process.on('beforeExit')`
   * hook. To clean up these resources, call `.close()` when you no longer intend to use the client. Not doing so will
   * result in a memory leak.
   */ // The reason client reports need to be manually activated with this method instead of just enabling them in a
    // constructor, is that if users periodically and unboundedly create new clients, we will create more and more
    // intervals and beforeExit listeners, thus leaking memory. In these situations, users are required to call
    // `client.close()` in order to dispose of the acquired resources.
    // We assume that calling this method in Sentry.init() is a sensible default, because calling Sentry.init() over and
    // over again would also result in memory leaks.
    // Note: We have experimented with using `FinalizationRegisty` to clear the interval when the client is garbage
    // collected, but it did not work, because the cleanup function never got called.
    startClientReportTracking() {
        const clientOptions = this.getOptions();
        if (clientOptions.sendClientReports) {
            this._clientReportOnExitFlushListener = ()=>{
                this._flushOutcomes();
            };
            this._clientReportInterval = setInterval(()=>{
                debugBuild.DEBUG_BUILD && core.debug.log('Flushing client reports based on interval.');
                this._flushOutcomes();
            }, clientOptions.clientReportFlushInterval ?? DEFAULT_CLIENT_REPORT_FLUSH_INTERVAL_MS)// Unref is critical for not preventing the process from exiting because the interval is active.
            .unref();
            process.on('beforeExit', this._clientReportOnExitFlushListener);
        }
    }
    /** @inheritDoc */ _setupIntegrations() {
        // Clear AI provider skip registrations before setting up integrations
        // This ensures a clean state between different client initializations
        // (e.g., when LangChain skips OpenAI in one client, but a subsequent client uses OpenAI standalone)
        core._INTERNAL_clearAiProviderSkips();
        super._setupIntegrations();
    }
    /** Custom implementation for OTEL, so we can handle scope-span linking. */ _getTraceInfoFromScope(scope) {
        if (!scope) {
            return [
                undefined,
                undefined
            ];
        }
        return opentelemetry.getTraceContextForScope(this, scope);
    }
}
exports.NodeClient = NodeClient; //# sourceMappingURL=client.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/esmLoader.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const importInTheMiddle = __turbopack_context__.r("[externals]/import-in-the-middle [external] (import-in-the-middle, cjs, [project]/metacto/metacto-internal/context-stack/node_modules/import-in-the-middle)");
const moduleModule = __turbopack_context__.r("[externals]/module [external] (module, cjs)");
const detection = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/detection.js [instrumentation] (ecmascript)");
var _documentCurrentScript = typeof document !== 'undefined' ? document.currentScript : null;
/**
 * Initialize the ESM loader - This method is private and not part of the public
 * API.
 *
 * @ignore
 */ function initializeEsmLoader() {
    if (!detection.supportsEsmLoaderHooks()) {
        return;
    }
    if (!core.GLOBAL_OBJ._sentryEsmLoaderHookRegistered) {
        core.GLOBAL_OBJ._sentryEsmLoaderHookRegistered = true;
        try {
            const { addHookMessagePort } = importInTheMiddle.createAddHookMessageChannel();
            // @ts-expect-error register is available in these versions
            moduleModule.register('import-in-the-middle/hook.mjs', typeof document === 'undefined' ? __turbopack_context__.r("[externals]/url [external] (url, cjs)").pathToFileURL(("TURBOPACK compile-time value", "/ROOT/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/esmLoader.js")).href : _documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === 'SCRIPT' && _documentCurrentScript.src || new URL('sdk/esmLoader.js', document.baseURI).href, {
                data: {
                    addHookMessagePort,
                    include: []
                },
                transferList: [
                    addHookMessagePort
                ]
            });
        } catch (error) {
            core.debug.warn("Failed to register 'import-in-the-middle' hook", error);
        }
    }
}
exports.initializeEsmLoader = initializeEsmLoader; //# sourceMappingURL=esmLoader.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/index.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const opentelemetry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/opentelemetry/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/debug-build.js [instrumentation] (ecmascript)");
const childProcess = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/childProcess.js [instrumentation] (ecmascript)");
const context = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/context.js [instrumentation] (ecmascript)");
const contextlines = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/contextlines.js [instrumentation] (ecmascript)");
const index = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/index.js [instrumentation] (ecmascript)");
const index$2 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/local-variables/index.js [instrumentation] (ecmascript)");
const modules = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/modules.js [instrumentation] (ecmascript)");
const index$1 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/node-fetch/index.js [instrumentation] (ecmascript)");
const onuncaughtexception = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/onuncaughtexception.js [instrumentation] (ecmascript)");
const onunhandledrejection = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/onunhandledrejection.js [instrumentation] (ecmascript)");
const processSession = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/processSession.js [instrumentation] (ecmascript)");
const spotlight = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/spotlight.js [instrumentation] (ecmascript)");
const systemError = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/systemError.js [instrumentation] (ecmascript)");
const http = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/transports/http.js [instrumentation] (ecmascript)");
const detection = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/detection.js [instrumentation] (ecmascript)");
const spotlight$1 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/spotlight.js [instrumentation] (ecmascript)");
const api = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/api.js [instrumentation] (ecmascript)");
const client = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/client.js [instrumentation] (ecmascript)");
const esmLoader = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/esmLoader.js [instrumentation] (ecmascript)");
/**
 * Get default integrations for the Node-Core SDK.
 */ function getDefaultIntegrations() {
    return [
        // Common
        // TODO(v11): Replace with `eventFiltersIntegration` once we remove the deprecated `inboundFiltersIntegration`
        // eslint-disable-next-line deprecation/deprecation
        core.inboundFiltersIntegration(),
        core.functionToStringIntegration(),
        core.linkedErrorsIntegration(),
        core.requestDataIntegration(),
        systemError.systemErrorIntegration(),
        core.conversationIdIntegration(),
        // Native Wrappers
        core.consoleIntegration(),
        index.httpIntegration(),
        index$1.nativeNodeFetchIntegration(),
        // Global Handlers
        onuncaughtexception.onUncaughtExceptionIntegration(),
        onunhandledrejection.onUnhandledRejectionIntegration(),
        // Event Info
        contextlines.contextLinesIntegration(),
        index$2.localVariablesIntegration(),
        context.nodeContextIntegration(),
        childProcess.childProcessIntegration(),
        processSession.processSessionIntegration(),
        modules.modulesIntegration()
    ];
}
/**
 * Initialize Sentry for Node.
 */ function init(options = {}) {
    return _init(options, getDefaultIntegrations);
}
/**
 * Initialize Sentry for Node, without any integrations added by default.
 */ function initWithoutDefaultIntegrations(options = {}) {
    return _init(options, ()=>[]);
}
/**
 * Initialize Sentry for Node, without performance instrumentation.
 */ function _init(_options = {}, getDefaultIntegrationsImpl) {
    const options = getClientOptions(_options, getDefaultIntegrationsImpl);
    if (options.debug === true) {
        if (debugBuild.DEBUG_BUILD) {
            core.debug.enable();
        } else {
            // use `console.warn` rather than `debug.warn` since by non-debug bundles have all `debug.x` statements stripped
            core.consoleSandbox(()=>{
                // eslint-disable-next-line no-console
                console.warn('[Sentry] Cannot initialize SDK with `debug` option using a non-debug bundle.');
            });
        }
    }
    if (options.registerEsmLoaderHooks !== false) {
        esmLoader.initializeEsmLoader();
    }
    opentelemetry.setOpenTelemetryContextAsyncContextStrategy();
    const scope = core.getCurrentScope();
    scope.update(options.initialScope);
    if (options.spotlight && !options.integrations.some(({ name })=>name === spotlight.INTEGRATION_NAME)) {
        options.integrations.push(spotlight.spotlightIntegration({
            sidecarUrl: typeof options.spotlight === 'string' ? options.spotlight : undefined
        }));
    }
    core.applySdkMetadata(options, 'node-core');
    const client$1 = new client.NodeClient(options);
    // The client is on the current scope, from where it generally is inherited
    core.getCurrentScope().setClient(client$1);
    client$1.init();
    core.debug.log(`SDK initialized from ${detection.isCjs() ? 'CommonJS' : 'ESM'}`);
    client$1.startClientReportTracking();
    updateScopeFromEnvVariables();
    opentelemetry.enhanceDscWithOpenTelemetryRootSpanName(client$1);
    opentelemetry.setupEventContextTrace(client$1);
    // Ensure we flush events when vercel functions are ended
    // See: https://vercel.com/docs/functions/functions-api-reference#sigterm-signal
    if (process.env.VERCEL) {
        process.on('SIGTERM', async ()=>{
            // We have 500ms for processing here, so we try to make sure to have enough time to send the events
            await client$1.flush(200);
        });
    }
    return client$1;
}
/**
 * Validate that your OpenTelemetry setup is correct.
 */ function validateOpenTelemetrySetup() {
    if (!debugBuild.DEBUG_BUILD) {
        return;
    }
    const setup = opentelemetry.openTelemetrySetupCheck();
    const required = [
        'SentryContextManager',
        'SentryPropagator'
    ];
    if (core.hasSpansEnabled()) {
        required.push('SentrySpanProcessor');
    }
    for (const k of required){
        if (!setup.includes(k)) {
            core.debug.error(`You have to set up the ${k}. Without this, the OpenTelemetry & Sentry integration will not work properly.`);
        }
    }
    if (!setup.includes('SentrySampler')) {
        core.debug.warn('You have to set up the SentrySampler. Without this, the OpenTelemetry & Sentry integration may still work, but sample rates set for the Sentry SDK will not be respected. If you use a custom sampler, make sure to use `wrapSamplingDecision`.');
    }
}
function getClientOptions(options, getDefaultIntegrationsImpl) {
    const release = getRelease(options.release);
    const spotlight = spotlight$1.getSpotlightConfig(options.spotlight);
    const tracesSampleRate = getTracesSampleRate(options.tracesSampleRate);
    const mergedOptions = {
        ...options,
        dsn: options.dsn ?? process.env.SENTRY_DSN,
        environment: options.environment ?? process.env.SENTRY_ENVIRONMENT,
        sendClientReports: options.sendClientReports ?? true,
        transport: options.transport ?? http.makeNodeTransport,
        stackParser: core.stackParserFromStackParserOptions(options.stackParser || api.defaultStackParser),
        release,
        tracesSampleRate,
        spotlight,
        debug: core.envToBool(options.debug ?? process.env.SENTRY_DEBUG)
    };
    const integrations = options.integrations;
    const defaultIntegrations = options.defaultIntegrations ?? getDefaultIntegrationsImpl(mergedOptions);
    return {
        ...mergedOptions,
        integrations: core.getIntegrationsToSetup({
            defaultIntegrations,
            integrations
        })
    };
}
function getRelease(release) {
    if (release !== undefined) {
        return release;
    }
    const detectedRelease = api.getSentryRelease();
    if (detectedRelease !== undefined) {
        return detectedRelease;
    }
    return undefined;
}
function getTracesSampleRate(tracesSampleRate) {
    if (tracesSampleRate !== undefined) {
        return tracesSampleRate;
    }
    const sampleRateFromEnv = process.env.SENTRY_TRACES_SAMPLE_RATE;
    if (!sampleRateFromEnv) {
        return undefined;
    }
    const parsed = parseFloat(sampleRateFromEnv);
    return isFinite(parsed) ? parsed : undefined;
}
/**
 * Update scope and propagation context based on environmental variables.
 *
 * See https://github.com/getsentry/rfcs/blob/main/text/0071-continue-trace-over-process-boundaries.md
 * for more details.
 */ function updateScopeFromEnvVariables() {
    if (core.envToBool(process.env.SENTRY_USE_ENVIRONMENT) !== false) {
        const sentryTraceEnv = process.env.SENTRY_TRACE;
        const baggageEnv = process.env.SENTRY_BAGGAGE;
        const propagationContext = core.propagationContextFromHeaders(sentryTraceEnv, baggageEnv);
        core.getCurrentScope().setPropagationContext(propagationContext);
    }
}
exports.getDefaultIntegrations = getDefaultIntegrations;
exports.init = init;
exports.initWithoutDefaultIntegrations = initWithoutDefaultIntegrations;
exports.validateOpenTelemetrySetup = validateOpenTelemetrySetup; //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/scope.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const api = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/index.js [instrumentation] (ecmascript)");
const opentelemetry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/opentelemetry/build/cjs/index.js [instrumentation] (ecmascript)");
/**
 * Update the active isolation scope.
 * Should be used with caution!
 */ function setIsolationScope(isolationScope) {
    const scopes = opentelemetry.getScopesFromContext(api.context.active());
    if (scopes) {
        scopes.isolationScope = isolationScope;
    }
}
exports.setIsolationScope = setIsolationScope; //# sourceMappingURL=scope.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/createMissingInstrumentationContext.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const detection = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/detection.js [instrumentation] (ecmascript)");
const createMissingInstrumentationContext = (pkg)=>({
        package: pkg,
        'javascript.is_cjs': detection.isCjs()
    });
exports.createMissingInstrumentationContext = createMissingInstrumentationContext; //# sourceMappingURL=createMissingInstrumentationContext.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/ensureIsWrapped.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const instrumentation = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/instrumentation/build/esm/index.js [instrumentation] (ecmascript)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const createMissingInstrumentationContext = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/createMissingInstrumentationContext.js [instrumentation] (ecmascript)");
const detection = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/detection.js [instrumentation] (ecmascript)");
/**
 * Checks and warns if a framework isn't wrapped by opentelemetry.
 */ function ensureIsWrapped(maybeWrappedFunction, name) {
    const clientOptions = core.getClient()?.getOptions();
    if (!clientOptions?.disableInstrumentationWarnings && !instrumentation.isWrapped(maybeWrappedFunction) && core.isEnabled() && core.hasSpansEnabled(clientOptions)) {
        core.consoleSandbox(()=>{
            if (detection.isCjs()) {
                // eslint-disable-next-line no-console
                console.warn(`[Sentry] ${name} is not instrumented. This is likely because you required/imported ${name} before calling \`Sentry.init()\`.`);
            } else {
                // eslint-disable-next-line no-console
                console.warn(`[Sentry] ${name} is not instrumented. Please make sure to initialize Sentry in a separate file that you \`--import\` when running node, see: https://docs.sentry.io/platforms/javascript/guides/${name}/install/esm/.`);
            }
        });
        core.getGlobalScope().setContext('missing_instrumentation', createMissingInstrumentationContext.createMissingInstrumentationContext(name));
    }
}
exports.ensureIsWrapped = ensureIsWrapped; //# sourceMappingURL=ensureIsWrapped.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/anr/index.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const util = __turbopack_context__.r("[externals]/node:util [external] (node:util, cjs)");
const node_worker_threads = __turbopack_context__.r("[externals]/node:worker_threads [external] (node:worker_threads, cjs)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const nodeVersion = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/nodeVersion.js [instrumentation] (ecmascript)");
const debug = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/debug.js [instrumentation] (ecmascript)");
const { isPromise } = util.types;
// This string is a placeholder that gets overwritten with the worker code.
const base64WorkerScript = 'LyohIEBzZW50cnkvbm9kZS1jb3JlIDEwLjQyLjAgKDA3YzkxOTApIHwgaHR0cHM6Ly9naXRodWIuY29tL2dldHNlbnRyeS9zZW50cnktamF2YXNjcmlwdCAqLwppbXBvcnR7U2Vzc2lvbiBhcyB0fWZyb20ibm9kZTppbnNwZWN0b3IiO2ltcG9ydHt3b3JrZXJEYXRhIGFzIG4scGFyZW50UG9ydCBhcyBlfWZyb20ibm9kZTp3b3JrZXJfdGhyZWFkcyI7aW1wb3J0e3Bvc2l4IGFzIHIsc2VwIGFzIG99ZnJvbSJub2RlOnBhdGgiO2ltcG9ydCphcyBpIGZyb20ibm9kZTpodHRwIjtpbXBvcnQqYXMgcyBmcm9tIm5vZGU6aHR0cHMiO2ltcG9ydHtSZWFkYWJsZSBhcyBjfWZyb20ibm9kZTpzdHJlYW0iO2ltcG9ydHtjcmVhdGVHemlwIGFzIHV9ZnJvbSJub2RlOnpsaWIiO2ltcG9ydCphcyBhIGZyb20ibm9kZTpuZXQiO2ltcG9ydCphcyBmIGZyb20ibm9kZTp0bHMiO2NvbnN0IGg9InVuZGVmaW5lZCI9PXR5cGVvZiBfX1NFTlRSWV9ERUJVR19ffHxfX1NFTlRSWV9ERUJVR19fLHA9Z2xvYmFsVGhpcyxkPSIxMC40Mi4wIjtmdW5jdGlvbiBsKCl7cmV0dXJuIG0ocCkscH1mdW5jdGlvbiBtKHQpe2NvbnN0IG49dC5fX1NFTlRSWV9fPXQuX19TRU5UUllfX3x8e307cmV0dXJuIG4udmVyc2lvbj1uLnZlcnNpb258fGQsbltkXT1uW2RdfHx7fX1mdW5jdGlvbiBnKHQsbixlPXApe2NvbnN0IHI9ZS5fX1NFTlRSWV9fPWUuX19TRU5UUllfX3x8e30sbz1yW2RdPXJbZF18fHt9O3JldHVybiBvW3RdfHwob1t0XT1uKCkpfWNvbnN0IHk9e307ZnVuY3Rpb24gYih0KXtpZighKCJjb25zb2xlImluIHApKXJldHVybiB0KCk7Y29uc3Qgbj1wLmNvbnNvbGUsZT17fSxyPU9iamVjdC5rZXlzKHkpO3IuZm9yRWFjaCh0PT57Y29uc3Qgcj15W3RdO2VbdF09blt0XSxuW3RdPXJ9KTt0cnl7cmV0dXJuIHQoKX1maW5hbGx5e3IuZm9yRWFjaCh0PT57blt0XT1lW3RdfSl9fWZ1bmN0aW9uIHYoKXtyZXR1cm4gdygpLmVuYWJsZWR9ZnVuY3Rpb24gXyh0LC4uLm4pe2gmJnYoKSYmYigoKT0+e3AuY29uc29sZVt0XShgU2VudHJ5IExvZ2dlciBbJHt0fV06YCwuLi5uKX0pfWZ1bmN0aW9uIHcoKXtyZXR1cm4gaD9nKCJsb2dnZXJTZXR0aW5ncyIsKCk9Pih7ZW5hYmxlZDohMX0pKTp7ZW5hYmxlZDohMX19Y29uc3QgUz17ZW5hYmxlOmZ1bmN0aW9uKCl7dygpLmVuYWJsZWQ9ITB9LGRpc2FibGU6ZnVuY3Rpb24oKXt3KCkuZW5hYmxlZD0hMX0saXNFbmFibGVkOnYsbG9nOmZ1bmN0aW9uKC4uLnQpe18oImxvZyIsLi4udCl9LHdhcm46ZnVuY3Rpb24oLi4udCl7Xygid2FybiIsLi4udCl9LGVycm9yOmZ1bmN0aW9uKC4uLnQpe18oImVycm9yIiwuLi50KX19LCQ9L2NhcHR1cmVNZXNzYWdlfGNhcHR1cmVFeGNlcHRpb24vO2Z1bmN0aW9uIEUodCl7cmV0dXJuIHRbdC5sZW5ndGgtMV18fHt9fWNvbnN0IHg9Ijxhbm9ueW1vdXM+Ijtjb25zdCBOPU9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7ZnVuY3Rpb24gQyh0LG4pe3JldHVybiBOLmNhbGwodCk9PT1gW29iamVjdCAke259XWB9ZnVuY3Rpb24gQSh0KXtyZXR1cm4gQyh0LCJTdHJpbmciKX1mdW5jdGlvbiBqKHQpe3JldHVybiBDKHQsIk9iamVjdCIpfWZ1bmN0aW9uIGsodCl7cmV0dXJuIEJvb2xlYW4odD8udGhlbiYmImZ1bmN0aW9uIj09dHlwZW9mIHQudGhlbil9ZnVuY3Rpb24gVCh0LG4pe3RyeXtyZXR1cm4gdCBpbnN0YW5jZW9mIG59Y2F0Y2h7cmV0dXJuITF9fWNvbnN0IEk9cDtmdW5jdGlvbiBSKHQsbil7Y29uc3QgZT10LHI9W107aWYoIWU/LnRhZ05hbWUpcmV0dXJuIiI7aWYoSS5IVE1MRWxlbWVudCYmZSBpbnN0YW5jZW9mIEhUTUxFbGVtZW50JiZlLmRhdGFzZXQpe2lmKGUuZGF0YXNldC5zZW50cnlDb21wb25lbnQpcmV0dXJuIGUuZGF0YXNldC5zZW50cnlDb21wb25lbnQ7aWYoZS5kYXRhc2V0LnNlbnRyeUVsZW1lbnQpcmV0dXJuIGUuZGF0YXNldC5zZW50cnlFbGVtZW50fXIucHVzaChlLnRhZ05hbWUudG9Mb3dlckNhc2UoKSk7Y29uc3Qgbz1uPy5sZW5ndGg/bi5maWx0ZXIodD0+ZS5nZXRBdHRyaWJ1dGUodCkpLm1hcCh0PT5bdCxlLmdldEF0dHJpYnV0ZSh0KV0pOm51bGw7aWYobz8ubGVuZ3RoKW8uZm9yRWFjaCh0PT57ci5wdXNoKGBbJHt0WzBdfT0iJHt0WzFdfSJdYCl9KTtlbHNle2UuaWQmJnIucHVzaChgIyR7ZS5pZH1gKTtjb25zdCB0PWUuY2xhc3NOYW1lO2lmKHQmJkEodCkpe2NvbnN0IG49dC5zcGxpdCgvXHMrLyk7Zm9yKGNvbnN0IHQgb2YgbilyLnB1c2goYC4ke3R9YCl9fWNvbnN0IGk9WyJhcmlhLWxhYmVsIiwidHlwZSIsIm5hbWUiLCJ0aXRsZSIsImFsdCJdO2Zvcihjb25zdCB0IG9mIGkpe2NvbnN0IG49ZS5nZXRBdHRyaWJ1dGUodCk7biYmci5wdXNoKGBbJHt0fT0iJHtufSJdYCl9cmV0dXJuIHIuam9pbigiIil9ZnVuY3Rpb24gTyh0KXtpZihmdW5jdGlvbih0KXtzd2l0Y2goTi5jYWxsKHQpKXtjYXNlIltvYmplY3QgRXJyb3JdIjpjYXNlIltvYmplY3QgRXhjZXB0aW9uXSI6Y2FzZSJbb2JqZWN0IERPTUV4Y2VwdGlvbl0iOmNhc2UiW29iamVjdCBXZWJBc3NlbWJseS5FeGNlcHRpb25dIjpyZXR1cm4hMDtkZWZhdWx0OnJldHVybiBUKHQsRXJyb3IpfX0odCkpcmV0dXJue21lc3NhZ2U6dC5tZXNzYWdlLG5hbWU6dC5uYW1lLHN0YWNrOnQuc3RhY2ssLi4uRCh0KX07aWYobj10LCJ1bmRlZmluZWQiIT10eXBlb2YgRXZlbnQmJlQobixFdmVudCkpe2NvbnN0IG49e3R5cGU6dC50eXBlLHRhcmdldDpQKHQudGFyZ2V0KSxjdXJyZW50VGFyZ2V0OlAodC5jdXJyZW50VGFyZ2V0KSwuLi5EKHQpfTtyZXR1cm4idW5kZWZpbmVkIiE9dHlwZW9mIEN1c3RvbUV2ZW50JiZUKHQsQ3VzdG9tRXZlbnQpJiYobi5kZXRhaWw9dC5kZXRhaWwpLG59cmV0dXJuIHQ7dmFyIG59ZnVuY3Rpb24gUCh0KXt0cnl7cmV0dXJuIG49dCwidW5kZWZpbmVkIiE9dHlwZW9mIEVsZW1lbnQmJlQobixFbGVtZW50KT9mdW5jdGlvbih0LG49e30pe2lmKCF0KXJldHVybiI8dW5rbm93bj4iO3RyeXtsZXQgZT10O2NvbnN0IHI9NSxvPVtdO2xldCBpPTAscz0wO2NvbnN0IGM9IiA+ICIsdT1jLmxlbmd0aDtsZXQgYTtjb25zdCBmPUFycmF5LmlzQXJyYXkobik/bjpuLmtleUF0dHJzLGg9IUFycmF5LmlzQXJyYXkobikmJm4ubWF4U3RyaW5nTGVuZ3RofHw4MDtmb3IoO2UmJmkrKzxyJiYoYT1SKGUsZiksISgiaHRtbCI9PT1hfHxpPjEmJnMrby5sZW5ndGgqdSthLmxlbmd0aD49aCkpOylvLnB1c2goYSkscys9YS5sZW5ndGgsZT1lLnBhcmVudE5vZGU7cmV0dXJuIG8ucmV2ZXJzZSgpLmpvaW4oYyl9Y2F0Y2h7cmV0dXJuIjx1bmtub3duPiJ9fSh0KTpPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwodCl9Y2F0Y2h7cmV0dXJuIjx1bmtub3duPiJ9dmFyIG59ZnVuY3Rpb24gRCh0KXtpZigib2JqZWN0Ij09dHlwZW9mIHQmJm51bGwhPT10KXtjb25zdCBuPXt9O2Zvcihjb25zdCBlIGluIHQpT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHQsZSkmJihuW2VdPXRbZV0pO3JldHVybiBufXJldHVybnt9fWxldCBVLE07ZnVuY3Rpb24gTCh0KXtpZih2b2lkIDAhPT1VKXJldHVybiBVP1UodCk6dCgpO2NvbnN0IG49U3ltYm9sLmZvcigiX19TRU5UUllfU0FGRV9SQU5ET01fSURfV1JBUFBFUl9fIiksZT1wO3JldHVybiBuIGluIGUmJiJmdW5jdGlvbiI9PXR5cGVvZiBlW25dPyhVPWVbbl0sVSh0KSk6KFU9bnVsbCx0KCkpfWZ1bmN0aW9uIEIoKXtyZXR1cm4gTCgoKT0+TWF0aC5yYW5kb20oKSl9ZnVuY3Rpb24gVygpe3JldHVybiBMKCgpPT5EYXRlLm5vdygpKX1mdW5jdGlvbiB6KHQsbj0wKXtyZXR1cm4ic3RyaW5nIiE9dHlwZW9mIHR8fDA9PT1ufHx0Lmxlbmd0aDw9bj90OmAke3Quc2xpY2UoMCxuKX0uLi5gfWZ1bmN0aW9uIEYodD1mdW5jdGlvbigpe2NvbnN0IHQ9cDtyZXR1cm4gdC5jcnlwdG98fHQubXNDcnlwdG99KCkpe3RyeXtpZih0Py5yYW5kb21VVUlEKXJldHVybiBMKCgpPT50LnJhbmRvbVVVSUQoKSkucmVwbGFjZSgvLS9nLCIiKX1jYXRjaHt9cmV0dXJuIE18fChNPVsxZTddKzFlMys0ZTMrOGUzKzFlMTEpLE0ucmVwbGFjZSgvWzAxOF0vZyx0PT4odF4oMTYqQigpJjE1KT4+dC80KS50b1N0cmluZygxNikpfWZ1bmN0aW9uIEcoKXtyZXR1cm4gVygpLzFlM31sZXQgSDtmdW5jdGlvbiBKKCl7cmV0dXJuKEg/PyhIPWZ1bmN0aW9uKCl7Y29uc3R7cGVyZm9ybWFuY2U6dH09cDtpZighdD8ubm93fHwhdC50aW1lT3JpZ2luKXJldHVybiBHO2NvbnN0IG49dC50aW1lT3JpZ2luO3JldHVybigpPT4obitMKCgpPT50Lm5vdygpKSkvMWUzfSgpKSkoKX1mdW5jdGlvbiBZKHQpe2NvbnN0IG49SigpLGU9e3NpZDpGKCksaW5pdDohMCx0aW1lc3RhbXA6bixzdGFydGVkOm4sZHVyYXRpb246MCxzdGF0dXM6Im9rIixlcnJvcnM6MCxpZ25vcmVEdXJhdGlvbjohMSx0b0pTT046KCk9PmZ1bmN0aW9uKHQpe3JldHVybntzaWQ6YCR7dC5zaWR9YCxpbml0OnQuaW5pdCxzdGFydGVkOm5ldyBEYXRlKDFlMyp0LnN0YXJ0ZWQpLnRvSVNPU3RyaW5nKCksdGltZXN0YW1wOm5ldyBEYXRlKDFlMyp0LnRpbWVzdGFtcCkudG9JU09TdHJpbmcoKSxzdGF0dXM6dC5zdGF0dXMsZXJyb3JzOnQuZXJyb3JzLGRpZDoibnVtYmVyIj09dHlwZW9mIHQuZGlkfHwic3RyaW5nIj09dHlwZW9mIHQuZGlkP2Ake3QuZGlkfWA6dm9pZCAwLGR1cmF0aW9uOnQuZHVyYXRpb24sYWJub3JtYWxfbWVjaGFuaXNtOnQuYWJub3JtYWxfbWVjaGFuaXNtLGF0dHJzOntyZWxlYXNlOnQucmVsZWFzZSxlbnZpcm9ubWVudDp0LmVudmlyb25tZW50LGlwX2FkZHJlc3M6dC5pcEFkZHJlc3MsdXNlcl9hZ2VudDp0LnVzZXJBZ2VudH19fShlKX07cmV0dXJuIHQmJlYoZSx0KSxlfWZ1bmN0aW9uIFYodCxuPXt9KXtpZihuLnVzZXImJighdC5pcEFkZHJlc3MmJm4udXNlci5pcF9hZGRyZXNzJiYodC5pcEFkZHJlc3M9bi51c2VyLmlwX2FkZHJlc3MpLHQuZGlkfHxuLmRpZHx8KHQuZGlkPW4udXNlci5pZHx8bi51c2VyLmVtYWlsfHxuLnVzZXIudXNlcm5hbWUpKSx0LnRpbWVzdGFtcD1uLnRpbWVzdGFtcHx8SigpLG4uYWJub3JtYWxfbWVjaGFuaXNtJiYodC5hYm5vcm1hbF9tZWNoYW5pc209bi5hYm5vcm1hbF9tZWNoYW5pc20pLG4uaWdub3JlRHVyYXRpb24mJih0Lmlnbm9yZUR1cmF0aW9uPW4uaWdub3JlRHVyYXRpb24pLG4uc2lkJiYodC5zaWQ9MzI9PT1uLnNpZC5sZW5ndGg/bi5zaWQ6RigpKSx2b2lkIDAhPT1uLmluaXQmJih0LmluaXQ9bi5pbml0KSwhdC5kaWQmJm4uZGlkJiYodC5kaWQ9YCR7bi5kaWR9YCksIm51bWJlciI9PXR5cGVvZiBuLnN0YXJ0ZWQmJih0LnN0YXJ0ZWQ9bi5zdGFydGVkKSx0Lmlnbm9yZUR1cmF0aW9uKXQuZHVyYXRpb249dm9pZCAwO2Vsc2UgaWYoIm51bWJlciI9PXR5cGVvZiBuLmR1cmF0aW9uKXQuZHVyYXRpb249bi5kdXJhdGlvbjtlbHNle2NvbnN0IG49dC50aW1lc3RhbXAtdC5zdGFydGVkO3QuZHVyYXRpb249bj49MD9uOjB9bi5yZWxlYXNlJiYodC5yZWxlYXNlPW4ucmVsZWFzZSksbi5lbnZpcm9ubWVudCYmKHQuZW52aXJvbm1lbnQ9bi5lbnZpcm9ubWVudCksIXQuaXBBZGRyZXNzJiZuLmlwQWRkcmVzcyYmKHQuaXBBZGRyZXNzPW4uaXBBZGRyZXNzKSwhdC51c2VyQWdlbnQmJm4udXNlckFnZW50JiYodC51c2VyQWdlbnQ9bi51c2VyQWdlbnQpLCJudW1iZXIiPT10eXBlb2Ygbi5lcnJvcnMmJih0LmVycm9ycz1uLmVycm9ycyksbi5zdGF0dXMmJih0LnN0YXR1cz1uLnN0YXR1cyl9ZnVuY3Rpb24gSyh0LG4sZT0yKXtpZighbnx8Im9iamVjdCIhPXR5cGVvZiBufHxlPD0wKXJldHVybiBuO2lmKHQmJjA9PT1PYmplY3Qua2V5cyhuKS5sZW5ndGgpcmV0dXJuIHQ7Y29uc3Qgcj17Li4udH07Zm9yKGNvbnN0IHQgaW4gbilPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobix0KSYmKHJbdF09SyhyW3RdLG5bdF0sZS0xKSk7cmV0dXJuIHJ9ZnVuY3Rpb24gWigpe3JldHVybiBGKCl9ZnVuY3Rpb24gcSgpe3JldHVybiBGKCkuc3Vic3RyaW5nKDE2KX1jb25zdCBRPSJfc2VudHJ5U3BhbiI7ZnVuY3Rpb24gWCh0LG4pe24/ZnVuY3Rpb24odCxuLGUpe3RyeXtPYmplY3QuZGVmaW5lUHJvcGVydHkodCxuLHt2YWx1ZTplLHdyaXRhYmxlOiEwLGNvbmZpZ3VyYWJsZTohMH0pfWNhdGNoe2gmJlMubG9nKGBGYWlsZWQgdG8gYWRkIG5vbi1lbnVtZXJhYmxlIHByb3BlcnR5ICIke259IiB0byBvYmplY3RgLHQpfX0odCxRLG4pOmRlbGV0ZSB0W1FdfWZ1bmN0aW9uIHR0KHQpe3JldHVybiB0W1FdfWNsYXNzIG50e2NvbnN0cnVjdG9yKCl7dGhpcy50PSExLHRoaXMubz1bXSx0aGlzLmk9W10sdGhpcy51PVtdLHRoaXMuaD1bXSx0aGlzLnA9e30sdGhpcy5sPXt9LHRoaXMubT17fSx0aGlzLnY9e30sdGhpcy5fPXt9LHRoaXMuUz17fSx0aGlzLk49e3RyYWNlSWQ6WigpLHNhbXBsZVJhbmQ6QigpfX1jbG9uZSgpe2NvbnN0IHQ9bmV3IG50O3JldHVybiB0LnU9Wy4uLnRoaXMudV0sdC5sPXsuLi50aGlzLmx9LHQubT17Li4udGhpcy5tfSx0LnY9ey4uLnRoaXMudn0sdC5fPXsuLi50aGlzLl99LHRoaXMuXy5mbGFncyYmKHQuXy5mbGFncz17dmFsdWVzOlsuLi50aGlzLl8uZmxhZ3MudmFsdWVzXX0pLHQucD10aGlzLnAsdC5DPXRoaXMuQyx0LkE9dGhpcy5BLHQuaj10aGlzLmosdC5rPXRoaXMuayx0Lmk9Wy4uLnRoaXMuaV0sdC5oPVsuLi50aGlzLmhdLHQuUz17Li4udGhpcy5TfSx0Lk49ey4uLnRoaXMuTn0sdC5UPXRoaXMuVCx0Lkk9dGhpcy5JLHQuUj10aGlzLlIsWCh0LHR0KHRoaXMpKSx0fXNldENsaWVudCh0KXt0aGlzLlQ9dH1zZXRMYXN0RXZlbnRJZCh0KXt0aGlzLkk9dH1nZXRDbGllbnQoKXtyZXR1cm4gdGhpcy5UfWxhc3RFdmVudElkKCl7cmV0dXJuIHRoaXMuSX1hZGRTY29wZUxpc3RlbmVyKHQpe3RoaXMuby5wdXNoKHQpfWFkZEV2ZW50UHJvY2Vzc29yKHQpe3JldHVybiB0aGlzLmkucHVzaCh0KSx0aGlzfXNldFVzZXIodCl7cmV0dXJuIHRoaXMucD10fHx7ZW1haWw6dm9pZCAwLGlkOnZvaWQgMCxpcF9hZGRyZXNzOnZvaWQgMCx1c2VybmFtZTp2b2lkIDB9LHRoaXMuQSYmVih0aGlzLkEse3VzZXI6dH0pLHRoaXMuTygpLHRoaXN9Z2V0VXNlcigpe3JldHVybiB0aGlzLnB9c2V0Q29udmVyc2F0aW9uSWQodCl7cmV0dXJuIHRoaXMuUj10fHx2b2lkIDAsdGhpcy5PKCksdGhpc31zZXRUYWdzKHQpe3JldHVybiB0aGlzLmw9ey4uLnRoaXMubCwuLi50fSx0aGlzLk8oKSx0aGlzfXNldFRhZyh0LG4pe3JldHVybiB0aGlzLnNldFRhZ3Moe1t0XTpufSl9c2V0QXR0cmlidXRlcyh0KXtyZXR1cm4gdGhpcy5tPXsuLi50aGlzLm0sLi4udH0sdGhpcy5PKCksdGhpc31zZXRBdHRyaWJ1dGUodCxuKXtyZXR1cm4gdGhpcy5zZXRBdHRyaWJ1dGVzKHtbdF06bn0pfXJlbW92ZUF0dHJpYnV0ZSh0KXtyZXR1cm4gdCBpbiB0aGlzLm0mJihkZWxldGUgdGhpcy5tW3RdLHRoaXMuTygpKSx0aGlzfXNldEV4dHJhcyh0KXtyZXR1cm4gdGhpcy52PXsuLi50aGlzLnYsLi4udH0sdGhpcy5PKCksdGhpc31zZXRFeHRyYSh0LG4pe3JldHVybiB0aGlzLnY9ey4uLnRoaXMudixbdF06bn0sdGhpcy5PKCksdGhpc31zZXRGaW5nZXJwcmludCh0KXtyZXR1cm4gdGhpcy5rPXQsdGhpcy5PKCksdGhpc31zZXRMZXZlbCh0KXtyZXR1cm4gdGhpcy5DPXQsdGhpcy5PKCksdGhpc31zZXRUcmFuc2FjdGlvbk5hbWUodCl7cmV0dXJuIHRoaXMuaj10LHRoaXMuTygpLHRoaXN9c2V0Q29udGV4dCh0LG4pe3JldHVybiBudWxsPT09bj9kZWxldGUgdGhpcy5fW3RdOnRoaXMuX1t0XT1uLHRoaXMuTygpLHRoaXN9c2V0U2Vzc2lvbih0KXtyZXR1cm4gdD90aGlzLkE9dDpkZWxldGUgdGhpcy5BLHRoaXMuTygpLHRoaXN9Z2V0U2Vzc2lvbigpe3JldHVybiB0aGlzLkF9dXBkYXRlKHQpe2lmKCF0KXJldHVybiB0aGlzO2NvbnN0IG49ImZ1bmN0aW9uIj09dHlwZW9mIHQ/dCh0aGlzKTp0LGU9biBpbnN0YW5jZW9mIG50P24uZ2V0U2NvcGVEYXRhKCk6aihuKT90OnZvaWQgMCx7dGFnczpyLGF0dHJpYnV0ZXM6byxleHRyYTppLHVzZXI6cyxjb250ZXh0czpjLGxldmVsOnUsZmluZ2VycHJpbnQ6YT1bXSxwcm9wYWdhdGlvbkNvbnRleHQ6Zixjb252ZXJzYXRpb25JZDpofT1lfHx7fTtyZXR1cm4gdGhpcy5sPXsuLi50aGlzLmwsLi4ucn0sdGhpcy5tPXsuLi50aGlzLm0sLi4ub30sdGhpcy52PXsuLi50aGlzLnYsLi4uaX0sdGhpcy5fPXsuLi50aGlzLl8sLi4uY30scyYmT2JqZWN0LmtleXMocykubGVuZ3RoJiYodGhpcy5wPXMpLHUmJih0aGlzLkM9dSksYS5sZW5ndGgmJih0aGlzLms9YSksZiYmKHRoaXMuTj1mKSxoJiYodGhpcy5SPWgpLHRoaXN9Y2xlYXIoKXtyZXR1cm4gdGhpcy51PVtdLHRoaXMubD17fSx0aGlzLm09e30sdGhpcy52PXt9LHRoaXMucD17fSx0aGlzLl89e30sdGhpcy5DPXZvaWQgMCx0aGlzLmo9dm9pZCAwLHRoaXMuaz12b2lkIDAsdGhpcy5BPXZvaWQgMCx0aGlzLlI9dm9pZCAwLFgodGhpcyx2b2lkIDApLHRoaXMuaD1bXSx0aGlzLnNldFByb3BhZ2F0aW9uQ29udGV4dCh7dHJhY2VJZDpaKCksc2FtcGxlUmFuZDpCKCl9KSx0aGlzLk8oKSx0aGlzfWFkZEJyZWFkY3J1bWIodCxuKXtjb25zdCBlPSJudW1iZXIiPT10eXBlb2Ygbj9uOjEwMDtpZihlPD0wKXJldHVybiB0aGlzO2NvbnN0IHI9e3RpbWVzdGFtcDpHKCksLi4udCxtZXNzYWdlOnQubWVzc2FnZT96KHQubWVzc2FnZSwyMDQ4KTp0Lm1lc3NhZ2V9O3JldHVybiB0aGlzLnUucHVzaChyKSx0aGlzLnUubGVuZ3RoPmUmJih0aGlzLnU9dGhpcy51LnNsaWNlKC1lKSx0aGlzLlQ/LnJlY29yZERyb3BwZWRFdmVudCgiYnVmZmVyX292ZXJmbG93IiwibG9nX2l0ZW0iKSksdGhpcy5PKCksdGhpc31nZXRMYXN0QnJlYWRjcnVtYigpe3JldHVybiB0aGlzLnVbdGhpcy51Lmxlbmd0aC0xXX1jbGVhckJyZWFkY3J1bWJzKCl7cmV0dXJuIHRoaXMudT1bXSx0aGlzLk8oKSx0aGlzfWFkZEF0dGFjaG1lbnQodCl7cmV0dXJuIHRoaXMuaC5wdXNoKHQpLHRoaXN9Y2xlYXJBdHRhY2htZW50cygpe3JldHVybiB0aGlzLmg9W10sdGhpc31nZXRTY29wZURhdGEoKXtyZXR1cm57YnJlYWRjcnVtYnM6dGhpcy51LGF0dGFjaG1lbnRzOnRoaXMuaCxjb250ZXh0czp0aGlzLl8sdGFnczp0aGlzLmwsYXR0cmlidXRlczp0aGlzLm0sZXh0cmE6dGhpcy52LHVzZXI6dGhpcy5wLGxldmVsOnRoaXMuQyxmaW5nZXJwcmludDp0aGlzLmt8fFtdLGV2ZW50UHJvY2Vzc29yczp0aGlzLmkscHJvcGFnYXRpb25Db250ZXh0OnRoaXMuTixzZGtQcm9jZXNzaW5nTWV0YWRhdGE6dGhpcy5TLHRyYW5zYWN0aW9uTmFtZTp0aGlzLmosc3Bhbjp0dCh0aGlzKSxjb252ZXJzYXRpb25JZDp0aGlzLlJ9fXNldFNES1Byb2Nlc3NpbmdNZXRhZGF0YSh0KXtyZXR1cm4gdGhpcy5TPUsodGhpcy5TLHQsMiksdGhpc31zZXRQcm9wYWdhdGlvbkNvbnRleHQodCl7cmV0dXJuIHRoaXMuTj10LHRoaXN9Z2V0UHJvcGFnYXRpb25Db250ZXh0KCl7cmV0dXJuIHRoaXMuTn1jYXB0dXJlRXhjZXB0aW9uKHQsbil7Y29uc3QgZT1uPy5ldmVudF9pZHx8RigpO2lmKCF0aGlzLlQpcmV0dXJuIGgmJlMud2FybigiTm8gY2xpZW50IGNvbmZpZ3VyZWQgb24gc2NvcGUgLSB3aWxsIG5vdCBjYXB0dXJlIGV4Y2VwdGlvbiEiKSxlO2NvbnN0IHI9bmV3IEVycm9yKCJTZW50cnkgc3ludGhldGljRXhjZXB0aW9uIik7cmV0dXJuIHRoaXMuVC5jYXB0dXJlRXhjZXB0aW9uKHQse29yaWdpbmFsRXhjZXB0aW9uOnQsc3ludGhldGljRXhjZXB0aW9uOnIsLi4ubixldmVudF9pZDplfSx0aGlzKSxlfWNhcHR1cmVNZXNzYWdlKHQsbixlKXtjb25zdCByPWU/LmV2ZW50X2lkfHxGKCk7aWYoIXRoaXMuVClyZXR1cm4gaCYmUy53YXJuKCJObyBjbGllbnQgY29uZmlndXJlZCBvbiBzY29wZSAtIHdpbGwgbm90IGNhcHR1cmUgbWVzc2FnZSEiKSxyO2NvbnN0IG89ZT8uc3ludGhldGljRXhjZXB0aW9uPz9uZXcgRXJyb3IodCk7cmV0dXJuIHRoaXMuVC5jYXB0dXJlTWVzc2FnZSh0LG4se29yaWdpbmFsRXhjZXB0aW9uOnQsc3ludGhldGljRXhjZXB0aW9uOm8sLi4uZSxldmVudF9pZDpyfSx0aGlzKSxyfWNhcHR1cmVFdmVudCh0LG4pe2NvbnN0IGU9dC5ldmVudF9pZHx8bj8uZXZlbnRfaWR8fEYoKTtyZXR1cm4gdGhpcy5UPyh0aGlzLlQuY2FwdHVyZUV2ZW50KHQsey4uLm4sZXZlbnRfaWQ6ZX0sdGhpcyksZSk6KGgmJlMud2FybigiTm8gY2xpZW50IGNvbmZpZ3VyZWQgb24gc2NvcGUgLSB3aWxsIG5vdCBjYXB0dXJlIGV2ZW50ISIpLGUpfU8oKXt0aGlzLnR8fCh0aGlzLnQ9ITAsdGhpcy5vLmZvckVhY2godD0+e3QodGhpcyl9KSx0aGlzLnQ9ITEpfX1jbGFzcyBldHtjb25zdHJ1Y3Rvcih0LG4pe2xldCBlLHI7ZT10fHxuZXcgbnQscj1ufHxuZXcgbnQsdGhpcy5QPVt7c2NvcGU6ZX1dLHRoaXMuRD1yfXdpdGhTY29wZSh0KXtjb25zdCBuPXRoaXMuVSgpO2xldCBlO3RyeXtlPXQobil9Y2F0Y2godCl7dGhyb3cgdGhpcy5NKCksdH1yZXR1cm4gayhlKT9lLnRoZW4odD0+KHRoaXMuTSgpLHQpLHQ9Pnt0aHJvdyB0aGlzLk0oKSx0fSk6KHRoaXMuTSgpLGUpfWdldENsaWVudCgpe3JldHVybiB0aGlzLmdldFN0YWNrVG9wKCkuY2xpZW50fWdldFNjb3BlKCl7cmV0dXJuIHRoaXMuZ2V0U3RhY2tUb3AoKS5zY29wZX1nZXRJc29sYXRpb25TY29wZSgpe3JldHVybiB0aGlzLkR9Z2V0U3RhY2tUb3AoKXtyZXR1cm4gdGhpcy5QW3RoaXMuUC5sZW5ndGgtMV19VSgpe2NvbnN0IHQ9dGhpcy5nZXRTY29wZSgpLmNsb25lKCk7cmV0dXJuIHRoaXMuUC5wdXNoKHtjbGllbnQ6dGhpcy5nZXRDbGllbnQoKSxzY29wZTp0fSksdH1NKCl7cmV0dXJuISh0aGlzLlAubGVuZ3RoPD0xKSYmISF0aGlzLlAucG9wKCl9fWZ1bmN0aW9uIHJ0KCl7Y29uc3QgdD1tKGwoKSk7cmV0dXJuIHQuc3RhY2s9dC5zdGFja3x8bmV3IGV0KGcoImRlZmF1bHRDdXJyZW50U2NvcGUiLCgpPT5uZXcgbnQpLGcoImRlZmF1bHRJc29sYXRpb25TY29wZSIsKCk9Pm5ldyBudCkpfWZ1bmN0aW9uIG90KHQpe3JldHVybiBydCgpLndpdGhTY29wZSh0KX1mdW5jdGlvbiBpdCh0LG4pe2NvbnN0IGU9cnQoKTtyZXR1cm4gZS53aXRoU2NvcGUoKCk9PihlLmdldFN0YWNrVG9wKCkuc2NvcGU9dCxuKHQpKSl9ZnVuY3Rpb24gc3QodCl7cmV0dXJuIHJ0KCkud2l0aFNjb3BlKCgpPT50KHJ0KCkuZ2V0SXNvbGF0aW9uU2NvcGUoKSkpfWZ1bmN0aW9uIGN0KHQpe2NvbnN0IG49bSh0KTtyZXR1cm4gbi5hY3M/bi5hY3M6e3dpdGhJc29sYXRpb25TY29wZTpzdCx3aXRoU2NvcGU6b3Qsd2l0aFNldFNjb3BlOml0LHdpdGhTZXRJc29sYXRpb25TY29wZToodCxuKT0+c3QobiksZ2V0Q3VycmVudFNjb3BlOigpPT5ydCgpLmdldFNjb3BlKCksZ2V0SXNvbGF0aW9uU2NvcGU6KCk9PnJ0KCkuZ2V0SXNvbGF0aW9uU2NvcGUoKX19ZnVuY3Rpb24gdXQoKXtyZXR1cm4gY3QobCgpKS5nZXRDdXJyZW50U2NvcGUoKS5nZXRDbGllbnQoKX1mdW5jdGlvbiBhdCh0KXtpZih0KXtpZigib2JqZWN0Ij09dHlwZW9mIHQmJiJkZXJlZiJpbiB0JiYiZnVuY3Rpb24iPT10eXBlb2YgdC5kZXJlZil0cnl7cmV0dXJuIHQuZGVyZWYoKX1jYXRjaHtyZXR1cm59cmV0dXJuIHR9fWZ1bmN0aW9uIGZ0KHQpe2NvbnN0IG49dDtyZXR1cm57c2NvcGU6bi5fc2VudHJ5U2NvcGUsaXNvbGF0aW9uU2NvcGU6YXQobi5fc2VudHJ5SXNvbGF0aW9uU2NvcGUpfX1jb25zdCBodD0vXnNlbnRyeS0vO2Z1bmN0aW9uIHB0KHQpe2NvbnN0IG49ZnVuY3Rpb24odCl7aWYoIXR8fCFBKHQpJiYhQXJyYXkuaXNBcnJheSh0KSlyZXR1cm47aWYoQXJyYXkuaXNBcnJheSh0KSlyZXR1cm4gdC5yZWR1Y2UoKHQsbik9Pntjb25zdCBlPWR0KG4pO3JldHVybiBPYmplY3QuZW50cmllcyhlKS5mb3JFYWNoKChbbixlXSk9Pnt0W25dPWV9KSx0fSx7fSk7cmV0dXJuIGR0KHQpfSh0KTtpZighbilyZXR1cm47Y29uc3QgZT1PYmplY3QuZW50cmllcyhuKS5yZWR1Y2UoKHQsW24sZV0pPT57aWYobi5tYXRjaChodCkpe3Rbbi5zbGljZSg3KV09ZX1yZXR1cm4gdH0se30pO3JldHVybiBPYmplY3Qua2V5cyhlKS5sZW5ndGg+MD9lOnZvaWQgMH1mdW5jdGlvbiBkdCh0KXtyZXR1cm4gdC5zcGxpdCgiLCIpLm1hcCh0PT57Y29uc3Qgbj10LmluZGV4T2YoIj0iKTtpZigtMT09PW4pcmV0dXJuW107cmV0dXJuW3Quc2xpY2UoMCxuKSx0LnNsaWNlKG4rMSldLm1hcCh0PT57dHJ5e3JldHVybiBkZWNvZGVVUklDb21wb25lbnQodC50cmltKCkpfWNhdGNoe3JldHVybn19KX0pLnJlZHVjZSgodCxbbixlXSk9PihuJiZlJiYodFtuXT1lKSx0KSx7fSl9Y29uc3QgbHQ9L15vKFxkKylcLi87ZnVuY3Rpb24gbXQodCxuPSExKXtjb25zdHtob3N0OmUscGF0aDpyLHBhc3M6byxwb3J0OmkscHJvamVjdElkOnMscHJvdG9jb2w6YyxwdWJsaWNLZXk6dX09dDtyZXR1cm5gJHtjfTovLyR7dX0ke24mJm8/YDoke299YDoiIn1AJHtlfSR7aT9gOiR7aX1gOiIifS8ke3I/YCR7cn0vYDpyfSR7c31gfWZ1bmN0aW9uIGd0KHQpe2NvbnN0IG49dC5nZXRPcHRpb25zKCkse2hvc3Q6ZX09dC5nZXREc24oKXx8e307bGV0IHI7cmV0dXJuIG4ub3JnSWQ/cj1TdHJpbmcobi5vcmdJZCk6ZSYmKHI9ZnVuY3Rpb24odCl7Y29uc3Qgbj10Lm1hdGNoKGx0KTtyZXR1cm4gbj8uWzFdfShlKSkscn1mdW5jdGlvbiB5dCh0KXtjb25zdHtzcGFuSWQ6bix0cmFjZUlkOmUsaXNSZW1vdGU6cn09dC5zcGFuQ29udGV4dCgpLG89cj9uOnd0KHQpLnBhcmVudF9zcGFuX2lkLGk9ZnQodCkuc2NvcGU7cmV0dXJue3BhcmVudF9zcGFuX2lkOm8sc3Bhbl9pZDpyP2k/LmdldFByb3BhZ2F0aW9uQ29udGV4dCgpLnByb3BhZ2F0aW9uU3BhbklkfHxxKCk6bix0cmFjZV9pZDplfX1mdW5jdGlvbiBidCh0KXtyZXR1cm4gdCYmdC5sZW5ndGg+MD90Lm1hcCgoe2NvbnRleHQ6e3NwYW5JZDp0LHRyYWNlSWQ6bix0cmFjZUZsYWdzOmUsLi4ucn0sYXR0cmlidXRlczpvfSk9Pih7c3Bhbl9pZDp0LHRyYWNlX2lkOm4sc2FtcGxlZDoxPT09ZSxhdHRyaWJ1dGVzOm8sLi4ucn0pKTp2b2lkIDB9ZnVuY3Rpb24gdnQodCl7cmV0dXJuIm51bWJlciI9PXR5cGVvZiB0P190KHQpOkFycmF5LmlzQXJyYXkodCk/dFswXSt0WzFdLzFlOTp0IGluc3RhbmNlb2YgRGF0ZT9fdCh0LmdldFRpbWUoKSk6SigpfWZ1bmN0aW9uIF90KHQpe3JldHVybiB0Pjk5OTk5OTk5OTk/dC8xZTM6dH1mdW5jdGlvbiB3dCh0KXtpZihmdW5jdGlvbih0KXtyZXR1cm4iZnVuY3Rpb24iPT10eXBlb2YgdC5nZXRTcGFuSlNPTn0odCkpcmV0dXJuIHQuZ2V0U3BhbkpTT04oKTtjb25zdHtzcGFuSWQ6bix0cmFjZUlkOmV9PXQuc3BhbkNvbnRleHQoKTtpZihmdW5jdGlvbih0KXtjb25zdCBuPXQ7cmV0dXJuISEobi5hdHRyaWJ1dGVzJiZuLnN0YXJ0VGltZSYmbi5uYW1lJiZuLmVuZFRpbWUmJm4uc3RhdHVzKX0odCkpe2NvbnN0e2F0dHJpYnV0ZXM6cixzdGFydFRpbWU6byxuYW1lOmksZW5kVGltZTpzLHN0YXR1czpjLGxpbmtzOnV9PXQ7cmV0dXJue3NwYW5faWQ6bix0cmFjZV9pZDplLGRhdGE6cixkZXNjcmlwdGlvbjppLHBhcmVudF9zcGFuX2lkOiJwYXJlbnRTcGFuSWQiaW4gdD90LnBhcmVudFNwYW5JZDoicGFyZW50U3BhbkNvbnRleHQiaW4gdD90LnBhcmVudFNwYW5Db250ZXh0Py5zcGFuSWQ6dm9pZCAwLHN0YXJ0X3RpbWVzdGFtcDp2dChvKSx0aW1lc3RhbXA6dnQocyl8fHZvaWQgMCxzdGF0dXM6U3QoYyksb3A6clsic2VudHJ5Lm9wIl0sb3JpZ2luOnJbInNlbnRyeS5vcmlnaW4iXSxsaW5rczpidCh1KX19cmV0dXJue3NwYW5faWQ6bix0cmFjZV9pZDplLHN0YXJ0X3RpbWVzdGFtcDowLGRhdGE6e319fWZ1bmN0aW9uIFN0KHQpe2lmKHQmJjAhPT10LmNvZGUpcmV0dXJuIDE9PT10LmNvZGU/Im9rIjp0Lm1lc3NhZ2V8fCJpbnRlcm5hbF9lcnJvciJ9ZnVuY3Rpb24gJHQodCl7cmV0dXJuIHQuX3NlbnRyeVJvb3RTcGFufHx0fWZ1bmN0aW9uIEV0KHQpe2NvbnN0IG49dXQoKTtpZighbilyZXR1cm57fTtjb25zdCBlPSR0KHQpLHI9d3QoZSksbz1yLmRhdGEsaT1lLnNwYW5Db250ZXh0KCkudHJhY2VTdGF0ZSxzPWk/LmdldCgic2VudHJ5LnNhbXBsZV9yYXRlIik/P29bInNlbnRyeS5zYW1wbGVfcmF0ZSJdPz9vWyJzZW50cnkucHJldmlvdXNfdHJhY2Vfc2FtcGxlX3JhdGUiXTtmdW5jdGlvbiBjKHQpe3JldHVybiJudW1iZXIiIT10eXBlb2YgcyYmInN0cmluZyIhPXR5cGVvZiBzfHwodC5zYW1wbGVfcmF0ZT1gJHtzfWApLHR9Y29uc3QgdT1lLl9mcm96ZW5Ec2M7aWYodSlyZXR1cm4gYyh1KTtjb25zdCBhPWk/LmdldCgic2VudHJ5LmRzYyIpLGY9YSYmcHQoYSk7aWYoZilyZXR1cm4gYyhmKTtjb25zdCBoPWZ1bmN0aW9uKHQsbil7Y29uc3QgZT1uLmdldE9wdGlvbnMoKSx7cHVibGljS2V5OnJ9PW4uZ2V0RHNuKCl8fHt9LG89e2Vudmlyb25tZW50OmUuZW52aXJvbm1lbnR8fCJwcm9kdWN0aW9uIixyZWxlYXNlOmUucmVsZWFzZSxwdWJsaWNfa2V5OnIsdHJhY2VfaWQ6dCxvcmdfaWQ6Z3Qobil9O3JldHVybiBuLmVtaXQoImNyZWF0ZURzYyIsbyksb30odC5zcGFuQ29udGV4dCgpLnRyYWNlSWQsbikscD1vWyJzZW50cnkuc291cmNlIl0sZD1yLmRlc2NyaXB0aW9uO3JldHVybiJ1cmwiIT09cCYmZCYmKGgudHJhbnNhY3Rpb249ZCksZnVuY3Rpb24oKXtpZigiYm9vbGVhbiI9PXR5cGVvZiBfX1NFTlRSWV9UUkFDSU5HX18mJiFfX1NFTlRSWV9UUkFDSU5HX18pcmV0dXJuITE7Y29uc3QgdD11dCgpPy5nZXRPcHRpb25zKCk7cmV0dXJuISghdHx8bnVsbD09dC50cmFjZXNTYW1wbGVSYXRlJiYhdC50cmFjZXNTYW1wbGVyKX0oKSYmKGguc2FtcGxlZD1TdHJpbmcoZnVuY3Rpb24odCl7Y29uc3R7dHJhY2VGbGFnczpufT10LnNwYW5Db250ZXh0KCk7cmV0dXJuIDE9PT1ufShlKSksaC5zYW1wbGVfcmFuZD1pPy5nZXQoInNlbnRyeS5zYW1wbGVfcmFuZCIpPz9mdChlKS5zY29wZT8uZ2V0UHJvcGFnYXRpb25Db250ZXh0KCkuc2FtcGxlUmFuZC50b1N0cmluZygpKSxjKGgpLG4uZW1pdCgiY3JlYXRlRHNjIixoLGUpLGh9ZnVuY3Rpb24geHQodCxuPTEwMCxlPTEvMCl7dHJ5e3JldHVybiBOdCgiIix0LG4sZSl9Y2F0Y2godCl7cmV0dXJue0VSUk9SOmAqKm5vbi1zZXJpYWxpemFibGUqKiAoJHt0fSlgfX19ZnVuY3Rpb24gTnQodCxuLGU9MS8wLHI9MS8wLG89ZnVuY3Rpb24oKXtjb25zdCB0PW5ldyBXZWFrU2V0O2Z1bmN0aW9uIG4obil7cmV0dXJuISF0LmhhcyhuKXx8KHQuYWRkKG4pLCExKX1mdW5jdGlvbiBlKG4pe3QuZGVsZXRlKG4pfXJldHVybltuLGVdfSgpKXtjb25zdFtpLHNdPW87aWYobnVsbD09bnx8WyJib29sZWFuIiwic3RyaW5nIl0uaW5jbHVkZXModHlwZW9mIG4pfHwibnVtYmVyIj09dHlwZW9mIG4mJk51bWJlci5pc0Zpbml0ZShuKSlyZXR1cm4gbjtjb25zdCBjPWZ1bmN0aW9uKHQsbil7dHJ5e2lmKCJkb21haW4iPT09dCYmbiYmIm9iamVjdCI9PXR5cGVvZiBuJiZuLkwpcmV0dXJuIltEb21haW5dIjtpZigiZG9tYWluRW1pdHRlciI9PT10KXJldHVybiJbRG9tYWluRW1pdHRlcl0iO2lmKCJ1bmRlZmluZWQiIT10eXBlb2YgZ2xvYmFsJiZuPT09Z2xvYmFsKXJldHVybiJbR2xvYmFsXSI7aWYoInVuZGVmaW5lZCIhPXR5cGVvZiB3aW5kb3cmJm49PT13aW5kb3cpcmV0dXJuIltXaW5kb3ddIjtpZigidW5kZWZpbmVkIiE9dHlwZW9mIGRvY3VtZW50JiZuPT09ZG9jdW1lbnQpcmV0dXJuIltEb2N1bWVudF0iO2lmKCJvYmplY3QiPT10eXBlb2YoZT1uKSYmbnVsbCE9PWUmJihlLl9faXNWdWV8fGUuQnx8ZS5fX3ZfaXNWTm9kZSkpcmV0dXJuIGZ1bmN0aW9uKHQpe3JldHVybiJfX3ZfaXNWTm9kZSJpbiB0JiZ0Ll9fdl9pc1ZOb2RlPyJbVnVlVk5vZGVdIjoiW1Z1ZVZpZXdNb2RlbF0ifShuKTtpZihmdW5jdGlvbih0KXtyZXR1cm4gaih0KSYmIm5hdGl2ZUV2ZW50ImluIHQmJiJwcmV2ZW50RGVmYXVsdCJpbiB0JiYic3RvcFByb3BhZ2F0aW9uImluIHR9KG4pKXJldHVybiJbU3ludGhldGljRXZlbnRdIjtpZigibnVtYmVyIj09dHlwZW9mIG4mJiFOdW1iZXIuaXNGaW5pdGUobikpcmV0dXJuYFske259XWA7aWYoImZ1bmN0aW9uIj09dHlwZW9mIG4pcmV0dXJuYFtGdW5jdGlvbjogJHtmdW5jdGlvbih0KXt0cnl7cmV0dXJuIHQmJiJmdW5jdGlvbiI9PXR5cGVvZiB0JiZ0Lm5hbWV8fHh9Y2F0Y2h7cmV0dXJuIHh9fShuKX1dYDtpZigic3ltYm9sIj09dHlwZW9mIG4pcmV0dXJuYFske1N0cmluZyhuKX1dYDtpZigiYmlnaW50Ij09dHlwZW9mIG4pcmV0dXJuYFtCaWdJbnQ6ICR7U3RyaW5nKG4pfV1gO2NvbnN0IHI9ZnVuY3Rpb24odCl7Y29uc3Qgbj1PYmplY3QuZ2V0UHJvdG90eXBlT2YodCk7cmV0dXJuIG4/LmNvbnN0cnVjdG9yP24uY29uc3RydWN0b3IubmFtZToibnVsbCBwcm90b3R5cGUifShuKTtyZXR1cm4vXkhUTUwoXHcqKUVsZW1lbnQkLy50ZXN0KHIpP2BbSFRNTEVsZW1lbnQ6ICR7cn1dYDpgW29iamVjdCAke3J9XWB9Y2F0Y2godCl7cmV0dXJuYCoqbm9uLXNlcmlhbGl6YWJsZSoqICgke3R9KWB9dmFyIGV9KHQsbik7aWYoIWMuc3RhcnRzV2l0aCgiW29iamVjdCAiKSlyZXR1cm4gYztpZihuLl9fc2VudHJ5X3NraXBfbm9ybWFsaXphdGlvbl9fKXJldHVybiBuO2NvbnN0IHU9Im51bWJlciI9PXR5cGVvZiBuLl9fc2VudHJ5X292ZXJyaWRlX25vcm1hbGl6YXRpb25fZGVwdGhfXz9uLl9fc2VudHJ5X292ZXJyaWRlX25vcm1hbGl6YXRpb25fZGVwdGhfXzplO2lmKDA9PT11KXJldHVybiBjLnJlcGxhY2UoIm9iamVjdCAiLCIiKTtpZihpKG4pKXJldHVybiJbQ2lyY3VsYXIgfl0iO2NvbnN0IGE9bjtpZihhJiYiZnVuY3Rpb24iPT10eXBlb2YgYS50b0pTT04pdHJ5e3JldHVybiBOdCgiIixhLnRvSlNPTigpLHUtMSxyLG8pfWNhdGNoe31jb25zdCBmPUFycmF5LmlzQXJyYXkobik/W106e307bGV0IGg9MDtjb25zdCBwPU8obik7Zm9yKGNvbnN0IHQgaW4gcCl7aWYoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChwLHQpKWNvbnRpbnVlO2lmKGg+PXIpe2ZbdF09IltNYXhQcm9wZXJ0aWVzIH5dIjticmVha31jb25zdCBuPXBbdF07Zlt0XT1OdCh0LG4sdS0xLHIsbyksaCsrfXJldHVybiBzKG4pLGZ9ZnVuY3Rpb24gQ3QodCxuKXtjb25zdCBlPW4ucmVwbGFjZSgvXFwvZywiLyIpLnJlcGxhY2UoL1t8XFx7fSgpW1xdXiQrKj8uXS9nLCJcXCQmIik7bGV0IHI9dDt0cnl7cj1kZWNvZGVVUkkodCl9Y2F0Y2h7fXJldHVybiByLnJlcGxhY2UoL1xcL2csIi8iKS5yZXBsYWNlKC93ZWJwYWNrOlwvPy9nLCIiKS5yZXBsYWNlKG5ldyBSZWdFeHAoYChmaWxlOi8vKT8vKiR7ZX0vKmAsImlnIiksImFwcDovLy8iKX1mdW5jdGlvbiBBdCh0LG49W10pe3JldHVyblt0LG5dfWZ1bmN0aW9uIGp0KHQsbil7Y29uc3QgZT10WzFdO2Zvcihjb25zdCB0IG9mIGUpe2lmKG4odCx0WzBdLnR5cGUpKXJldHVybiEwfXJldHVybiExfWZ1bmN0aW9uIGt0KHQpe2NvbnN0IG49bShwKTtyZXR1cm4gbi5lbmNvZGVQb2x5ZmlsbD9uLmVuY29kZVBvbHlmaWxsKHQpOihuZXcgVGV4dEVuY29kZXIpLmVuY29kZSh0KX1mdW5jdGlvbiBUdCh0KXtjb25zdFtuLGVdPXQ7bGV0IHI9SlNPTi5zdHJpbmdpZnkobik7ZnVuY3Rpb24gbyh0KXsic3RyaW5nIj09dHlwZW9mIHI/cj0ic3RyaW5nIj09dHlwZW9mIHQ/cit0OltrdChyKSx0XTpyLnB1c2goInN0cmluZyI9PXR5cGVvZiB0P2t0KHQpOnQpfWZvcihjb25zdCB0IG9mIGUpe2NvbnN0W24sZV09dDtpZihvKGBcbiR7SlNPTi5zdHJpbmdpZnkobil9XG5gKSwic3RyaW5nIj09dHlwZW9mIGV8fGUgaW5zdGFuY2VvZiBVaW50OEFycmF5KW8oZSk7ZWxzZXtsZXQgdDt0cnl7dD1KU09OLnN0cmluZ2lmeShlKX1jYXRjaHt0PUpTT04uc3RyaW5naWZ5KHh0KGUpKX1vKHQpfX1yZXR1cm4ic3RyaW5nIj09dHlwZW9mIHI/cjpmdW5jdGlvbih0KXtjb25zdCBuPXQucmVkdWNlKCh0LG4pPT50K24ubGVuZ3RoLDApLGU9bmV3IFVpbnQ4QXJyYXkobik7bGV0IHI9MDtmb3IoY29uc3QgbiBvZiB0KWUuc2V0KG4scikscis9bi5sZW5ndGg7cmV0dXJuIGV9KHIpfWNvbnN0IEl0PXtzZXNzaW9uOiJzZXNzaW9uIixzZXNzaW9uczoic2Vzc2lvbiIsYXR0YWNobWVudDoiYXR0YWNobWVudCIsdHJhbnNhY3Rpb246InRyYW5zYWN0aW9uIixldmVudDoiZXJyb3IiLGNsaWVudF9yZXBvcnQ6ImludGVybmFsIix1c2VyX3JlcG9ydDoiZGVmYXVsdCIscHJvZmlsZToicHJvZmlsZSIscHJvZmlsZV9jaHVuazoicHJvZmlsZSIscmVwbGF5X2V2ZW50OiJyZXBsYXkiLHJlcGxheV9yZWNvcmRpbmc6InJlcGxheSIsY2hlY2tfaW46Im1vbml0b3IiLGZlZWRiYWNrOiJmZWVkYmFjayIsc3Bhbjoic3BhbiIscmF3X3NlY3VyaXR5OiJzZWN1cml0eSIsbG9nOiJsb2dfaXRlbSIsbWV0cmljOiJtZXRyaWMiLHRyYWNlX21ldHJpYzoibWV0cmljIn07ZnVuY3Rpb24gUnQodCl7aWYoIXQ/LnNkaylyZXR1cm47Y29uc3R7bmFtZTpuLHZlcnNpb246ZX09dC5zZGs7cmV0dXJue25hbWU6bix2ZXJzaW9uOmV9fWZ1bmN0aW9uIE90KHQsbixlLHIpe2NvbnN0IG89UnQoZSksaT10LnR5cGUmJiJyZXBsYXlfZXZlbnQiIT09dC50eXBlP3QudHlwZToiZXZlbnQiOyFmdW5jdGlvbih0LG4pe2lmKCFuKXJldHVybiB0O2NvbnN0IGU9dC5zZGt8fHt9O3Quc2RrPXsuLi5lLG5hbWU6ZS5uYW1lfHxuLm5hbWUsdmVyc2lvbjplLnZlcnNpb258fG4udmVyc2lvbixpbnRlZ3JhdGlvbnM6Wy4uLnQuc2RrPy5pbnRlZ3JhdGlvbnN8fFtdLC4uLm4uaW50ZWdyYXRpb25zfHxbXV0scGFja2FnZXM6Wy4uLnQuc2RrPy5wYWNrYWdlc3x8W10sLi4ubi5wYWNrYWdlc3x8W11dLHNldHRpbmdzOnQuc2RrPy5zZXR0aW5nc3x8bi5zZXR0aW5ncz97Li4udC5zZGs/LnNldHRpbmdzLC4uLm4uc2V0dGluZ3N9OnZvaWQgMH19KHQsZT8uc2RrKTtjb25zdCBzPWZ1bmN0aW9uKHQsbixlLHIpe2NvbnN0IG89dC5zZGtQcm9jZXNzaW5nTWV0YWRhdGE/LmR5bmFtaWNTYW1wbGluZ0NvbnRleHQ7cmV0dXJue2V2ZW50X2lkOnQuZXZlbnRfaWQsc2VudF9hdDoobmV3IERhdGUpLnRvSVNPU3RyaW5nKCksLi4ubiYme3NkazpufSwuLi4hIWUmJnImJntkc246bXQocil9LC4uLm8mJnt0cmFjZTpvfX19KHQsbyxyLG4pO2RlbGV0ZSB0LnNka1Byb2Nlc3NpbmdNZXRhZGF0YTtyZXR1cm4gQXQocyxbW3t0eXBlOml9LHRdXSl9Y29uc3QgUHQ9Il9fU0VOVFJZX1NVUFBSRVNTX1RSQUNJTkdfXyI7ZnVuY3Rpb24gRHQodCl7Y29uc3Qgbj1jdChsKCkpO3JldHVybiBuLnN1cHByZXNzVHJhY2luZz9uLnN1cHByZXNzVHJhY2luZyh0KTpmdW5jdGlvbiguLi50KXtjb25zdCBuPWN0KGwoKSk7aWYoMj09PXQubGVuZ3RoKXtjb25zdFtlLHJdPXQ7cmV0dXJuIGU/bi53aXRoU2V0U2NvcGUoZSxyKTpuLndpdGhTY29wZShyKX1yZXR1cm4gbi53aXRoU2NvcGUodFswXSl9KG49PntuLnNldFNES1Byb2Nlc3NpbmdNZXRhZGF0YSh7W1B0XTohMH0pO2NvbnN0IGU9dCgpO3JldHVybiBuLnNldFNES1Byb2Nlc3NpbmdNZXRhZGF0YSh7W1B0XTp2b2lkIDB9KSxlfSl9Y2xhc3MgVXR7Y29uc3RydWN0b3IodCl7dGhpcy5XPTAsdGhpcy5GPVtdLHRoaXMuRyh0KX10aGVuKHQsbil7cmV0dXJuIG5ldyBVdCgoZSxyKT0+e3RoaXMuRi5wdXNoKFshMSxuPT57aWYodCl0cnl7ZSh0KG4pKX1jYXRjaCh0KXtyKHQpfWVsc2UgZShuKX0sdD0+e2lmKG4pdHJ5e2Uobih0KSl9Y2F0Y2godCl7cih0KX1lbHNlIHIodCl9XSksdGhpcy5IKCl9KX1jYXRjaCh0KXtyZXR1cm4gdGhpcy50aGVuKHQ9PnQsdCl9ZmluYWxseSh0KXtyZXR1cm4gbmV3IFV0KChuLGUpPT57bGV0IHIsbztyZXR1cm4gdGhpcy50aGVuKG49PntvPSExLHI9bix0JiZ0KCl9LG49PntvPSEwLHI9bix0JiZ0KCl9KS50aGVuKCgpPT57bz9lKHIpOm4ocil9KX0pfUgoKXtpZigwPT09dGhpcy5XKXJldHVybjtjb25zdCB0PXRoaXMuRi5zbGljZSgpO3RoaXMuRj1bXSx0LmZvckVhY2godD0+e3RbMF18fCgxPT09dGhpcy5XJiZ0WzFdKHRoaXMuSiksMj09PXRoaXMuVyYmdFsyXSh0aGlzLkopLHRbMF09ITApfSl9Ryh0KXtjb25zdCBuPSh0LG4pPT57MD09PXRoaXMuVyYmKGsobik/bi50aGVuKGUscik6KHRoaXMuVz10LHRoaXMuSj1uLHRoaXMuSCgpKSl9LGU9dD0+e24oMSx0KX0scj10PT57bigyLHQpfTt0cnl7dChlLHIpfWNhdGNoKHQpe3IodCl9fX1mdW5jdGlvbiBNdCh0LG4pe2NvbnN0e2ZpbmdlcnByaW50OmUsc3BhbjpyLGJyZWFkY3J1bWJzOm8sc2RrUHJvY2Vzc2luZ01ldGFkYXRhOml9PW47IWZ1bmN0aW9uKHQsbil7Y29uc3R7ZXh0cmE6ZSx0YWdzOnIsdXNlcjpvLGNvbnRleHRzOmksbGV2ZWw6cyx0cmFuc2FjdGlvbk5hbWU6Y309bjtPYmplY3Qua2V5cyhlKS5sZW5ndGgmJih0LmV4dHJhPXsuLi5lLC4uLnQuZXh0cmF9KTtPYmplY3Qua2V5cyhyKS5sZW5ndGgmJih0LnRhZ3M9ey4uLnIsLi4udC50YWdzfSk7T2JqZWN0LmtleXMobykubGVuZ3RoJiYodC51c2VyPXsuLi5vLC4uLnQudXNlcn0pO09iamVjdC5rZXlzKGkpLmxlbmd0aCYmKHQuY29udGV4dHM9ey4uLmksLi4udC5jb250ZXh0c30pO3MmJih0LmxldmVsPXMpO2MmJiJ0cmFuc2FjdGlvbiIhPT10LnR5cGUmJih0LnRyYW5zYWN0aW9uPWMpfSh0LG4pLHImJmZ1bmN0aW9uKHQsbil7dC5jb250ZXh0cz17dHJhY2U6eXQobiksLi4udC5jb250ZXh0c30sdC5zZGtQcm9jZXNzaW5nTWV0YWRhdGE9e2R5bmFtaWNTYW1wbGluZ0NvbnRleHQ6RXQobiksLi4udC5zZGtQcm9jZXNzaW5nTWV0YWRhdGF9O2NvbnN0IGU9JHQobikscj13dChlKS5kZXNjcmlwdGlvbjtyJiYhdC50cmFuc2FjdGlvbiYmInRyYW5zYWN0aW9uIj09PXQudHlwZSYmKHQudHJhbnNhY3Rpb249cil9KHQsciksZnVuY3Rpb24odCxuKXt0LmZpbmdlcnByaW50PXQuZmluZ2VycHJpbnQ/QXJyYXkuaXNBcnJheSh0LmZpbmdlcnByaW50KT90LmZpbmdlcnByaW50Olt0LmZpbmdlcnByaW50XTpbXSxuJiYodC5maW5nZXJwcmludD10LmZpbmdlcnByaW50LmNvbmNhdChuKSk7dC5maW5nZXJwcmludC5sZW5ndGh8fGRlbGV0ZSB0LmZpbmdlcnByaW50fSh0LGUpLGZ1bmN0aW9uKHQsbil7Y29uc3QgZT1bLi4udC5icmVhZGNydW1ic3x8W10sLi4ubl07dC5icmVhZGNydW1icz1lLmxlbmd0aD9lOnZvaWQgMH0odCxvKSxmdW5jdGlvbih0LG4pe3Quc2RrUHJvY2Vzc2luZ01ldGFkYXRhPXsuLi50LnNka1Byb2Nlc3NpbmdNZXRhZGF0YSwuLi5ufX0odCxpKX1jb25zdCBMdD1TeW1ib2wuZm9yKCJTZW50cnlCdWZmZXJGdWxsRXJyb3IiKTtmdW5jdGlvbiBCdCh0PTEwMCl7Y29uc3Qgbj1uZXcgU2V0O2Z1bmN0aW9uIGUodCl7bi5kZWxldGUodCl9cmV0dXJue2dldCAkKCl7cmV0dXJuIEFycmF5LmZyb20obil9LGFkZDpmdW5jdGlvbihyKXtpZighKG4uc2l6ZTx0KSlyZXR1cm4gbz1MdCxuZXcgVXQoKHQsbik9PntuKG8pfSk7dmFyIG87Y29uc3QgaT1yKCk7cmV0dXJuIG4uYWRkKGkpLGkudGhlbigoKT0+ZShpKSwoKT0+ZShpKSksaX0sZHJhaW46ZnVuY3Rpb24odCl7aWYoIW4uc2l6ZSlyZXR1cm4gZT0hMCxuZXcgVXQodD0+e3QoZSl9KTt2YXIgZTtjb25zdCByPVByb21pc2UuYWxsU2V0dGxlZChBcnJheS5mcm9tKG4pKS50aGVuKCgpPT4hMCk7aWYoIXQpcmV0dXJuIHI7Y29uc3Qgbz1bcixuZXcgUHJvbWlzZShuPT57cmV0dXJuIm9iamVjdCI9PXR5cGVvZihlPXNldFRpbWVvdXQoKCk9Pm4oITEpLHQpKSYmImZ1bmN0aW9uIj09dHlwZW9mIGUudW5yZWYmJmUudW5yZWYoKSxlO3ZhciBlfSldO3JldHVybiBQcm9taXNlLnJhY2Uobyl9fX1mdW5jdGlvbiBXdCh0LHtzdGF0dXNDb2RlOm4saGVhZGVyczplfSxyPVcoKSl7Y29uc3Qgbz17Li4udH0saT1lPy5bIngtc2VudHJ5LXJhdGUtbGltaXRzIl0scz1lPy5bInJldHJ5LWFmdGVyIl07aWYoaSlmb3IoY29uc3QgdCBvZiBpLnRyaW0oKS5zcGxpdCgiLCIpKXtjb25zdFtuLGUsLCxpXT10LnNwbGl0KCI6Iiw1KSxzPXBhcnNlSW50KG4sMTApLGM9MWUzKihpc05hTihzKT82MDpzKTtpZihlKWZvcihjb25zdCB0IG9mIGUuc3BsaXQoIjsiKSkibWV0cmljX2J1Y2tldCI9PT10JiZpJiYhaS5zcGxpdCgiOyIpLmluY2x1ZGVzKCJjdXN0b20iKXx8KG9bdF09citjKTtlbHNlIG8uYWxsPXIrY31lbHNlIHM/by5hbGw9citmdW5jdGlvbih0LG49VygpKXtjb25zdCBlPXBhcnNlSW50KGAke3R9YCwxMCk7aWYoIWlzTmFOKGUpKXJldHVybiAxZTMqZTtjb25zdCByPURhdGUucGFyc2UoYCR7dH1gKTtyZXR1cm4gaXNOYU4ocik/NmU0OnItbn0ocyxyKTo0Mjk9PT1uJiYoby5hbGw9cis2ZTQpO3JldHVybiBvfWZ1bmN0aW9uIHp0KHQsbixlPUJ0KHQuYnVmZmVyU2l6ZXx8NjQpKXtsZXQgcj17fTtyZXR1cm57c2VuZDpmdW5jdGlvbih0KXtjb25zdCBvPVtdO2lmKGp0KHQsKHQsbik9Pntjb25zdCBlPWZ1bmN0aW9uKHQpe3JldHVybiBJdFt0XX0obik7KGZ1bmN0aW9uKHQsbixlPVcoKSl7cmV0dXJuIGZ1bmN0aW9uKHQsbil7cmV0dXJuIHRbbl18fHQuYWxsfHwwfSh0LG4pPmV9KShyLGUpfHxvLnB1c2godCl9KSwwPT09by5sZW5ndGgpcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7fSk7Y29uc3QgaT1BdCh0WzBdLG8pLHM9dD0+eyFmdW5jdGlvbih0LG4pe3JldHVybiBqdCh0LCh0LGUpPT5uLmluY2x1ZGVzKGUpKX0oaSxbImNsaWVudF9yZXBvcnQiXSk/anQoaSwodCxuKT0+e30pOmgmJlMud2FybihgRHJvcHBpbmcgY2xpZW50IHJlcG9ydC4gV2lsbCBub3Qgc2VuZCBvdXRjb21lcyAocmVhc29uOiAke3R9KS5gKX07cmV0dXJuIGUuYWRkKCgpPT5uKHtib2R5OlR0KGkpfSkudGhlbih0PT40MTM9PT10LnN0YXR1c0NvZGU/KGgmJlMuZXJyb3IoIlNlbnRyeSByZXNwb25kZWQgd2l0aCBzdGF0dXMgY29kZSA0MTMuIEVudmVsb3BlIHdhcyBkaXNjYXJkZWQgZHVlIHRvIGV4Y2VlZGluZyBzaXplIGxpbWl0cy4iKSxzKCJzZW5kX2Vycm9yIiksdCk6KGgmJnZvaWQgMCE9PXQuc3RhdHVzQ29kZSYmKHQuc3RhdHVzQ29kZTwyMDB8fHQuc3RhdHVzQ29kZT49MzAwKSYmUy53YXJuKGBTZW50cnkgcmVzcG9uZGVkIHdpdGggc3RhdHVzIGNvZGUgJHt0LnN0YXR1c0NvZGV9IHRvIHNlbnQgZXZlbnQuYCkscj1XdChyLHQpLHQpLHQ9Pnt0aHJvdyBzKCJuZXR3b3JrX2Vycm9yIiksaCYmUy5lcnJvcigiRW5jb3VudGVyZWQgZXJyb3IgcnVubmluZyB0cmFuc3BvcnQgcmVxdWVzdDoiLHQpLHR9KSkudGhlbih0PT50LHQ9PntpZih0PT09THQpcmV0dXJuIGgmJlMuZXJyb3IoIlNraXBwZWQgc2VuZGluZyBldmVudCBiZWNhdXNlIGJ1ZmZlciBpcyBmdWxsLiIpLHMoInF1ZXVlX292ZXJmbG93IiksUHJvbWlzZS5yZXNvbHZlKHt9KTt0aHJvdyB0fSl9LGZsdXNoOnQ9PmUuZHJhaW4odCl9fWNvbnN0IEZ0PS9eKFxTKzpcXHxcLz8pKFtcc1xTXSo/KSgoPzpcLnsxLDJ9fFteL1xcXSs/fCkoXC5bXi4vXFxdKnwpKSg/OlsvXFxdKikkLztmdW5jdGlvbiBHdCh0KXtjb25zdCBuPWZ1bmN0aW9uKHQpe2NvbnN0IG49dC5sZW5ndGg+MTAyND9gPHRydW5jYXRlZD4ke3Quc2xpY2UoLTEwMjQpfWA6dCxlPUZ0LmV4ZWMobik7cmV0dXJuIGU/ZS5zbGljZSgxKTpbXX0odCksZT1uWzBdfHwiIjtsZXQgcj1uWzFdO3JldHVybiBlfHxyPyhyJiYocj1yLnNsaWNlKDAsci5sZW5ndGgtMSkpLGUrcik6Ii4ifWZ1bmN0aW9uIEh0KHQsbj0hMSl7cmV0dXJuIShufHx0JiYhdC5zdGFydHNXaXRoKCIvIikmJiF0Lm1hdGNoKC9eW0EtWl06LykmJiF0LnN0YXJ0c1dpdGgoIi4iKSYmIXQubWF0Y2goL15bYS16QS1aXShbYS16QS1aMC05LlwtK10pKjpcL1wvLykpJiZ2b2lkIDAhPT10JiYhdC5pbmNsdWRlcygibm9kZV9tb2R1bGVzLyIpfWNvbnN0IEp0PVN5bWJvbCgiQWdlbnRCYXNlSW50ZXJuYWxTdGF0ZSIpO2NsYXNzIFl0IGV4dGVuZHMgaS5BZ2VudHtjb25zdHJ1Y3Rvcih0KXtzdXBlcih0KSx0aGlzW0p0XT17fX1pc1NlY3VyZUVuZHBvaW50KHQpe2lmKHQpe2lmKCJib29sZWFuIj09dHlwZW9mIHQuc2VjdXJlRW5kcG9pbnQpcmV0dXJuIHQuc2VjdXJlRW5kcG9pbnQ7aWYoInN0cmluZyI9PXR5cGVvZiB0LnByb3RvY29sKXJldHVybiJodHRwczoiPT09dC5wcm90b2NvbH1jb25zdHtzdGFjazpufT1uZXcgRXJyb3I7cmV0dXJuInN0cmluZyI9PXR5cGVvZiBuJiZuLnNwbGl0KCJcbiIpLnNvbWUodD0+LTEhPT10LmluZGV4T2YoIihodHRwcy5qczoiKXx8LTEhPT10LmluZGV4T2YoIm5vZGU6aHR0cHM6IikpfWNyZWF0ZVNvY2tldCh0LG4sZSl7Y29uc3Qgcj17Li4ubixzZWN1cmVFbmRwb2ludDp0aGlzLmlzU2VjdXJlRW5kcG9pbnQobil9O1Byb21pc2UucmVzb2x2ZSgpLnRoZW4oKCk9PnRoaXMuY29ubmVjdCh0LHIpKS50aGVuKG89PntpZihvIGluc3RhbmNlb2YgaS5BZ2VudClyZXR1cm4gby5hZGRSZXF1ZXN0KHQscik7dGhpc1tKdF0uY3VycmVudFNvY2tldD1vLHN1cGVyLmNyZWF0ZVNvY2tldCh0LG4sZSl9LGUpfWNyZWF0ZUNvbm5lY3Rpb24oKXtjb25zdCB0PXRoaXNbSnRdLmN1cnJlbnRTb2NrZXQ7aWYodGhpc1tKdF0uY3VycmVudFNvY2tldD12b2lkIDAsIXQpdGhyb3cgbmV3IEVycm9yKCJObyBzb2NrZXQgd2FzIHJldHVybmVkIGluIHRoZSBgY29ubmVjdCgpYCBmdW5jdGlvbiIpO3JldHVybiB0fWdldCBkZWZhdWx0UG9ydCgpe3JldHVybiB0aGlzW0p0XS5kZWZhdWx0UG9ydD8/KCJodHRwczoiPT09dGhpcy5wcm90b2NvbD80NDM6ODApfXNldCBkZWZhdWx0UG9ydCh0KXt0aGlzW0p0XSYmKHRoaXNbSnRdLmRlZmF1bHRQb3J0PXQpfWdldCBwcm90b2NvbCgpe3JldHVybiB0aGlzW0p0XS5wcm90b2NvbD8/KHRoaXMuaXNTZWN1cmVFbmRwb2ludCgpPyJodHRwczoiOiJodHRwOiIpfXNldCBwcm90b2NvbCh0KXt0aGlzW0p0XSYmKHRoaXNbSnRdLnByb3RvY29sPXQpfX1mdW5jdGlvbiBWdCguLi50KXtTLmxvZygiW2h0dHBzLXByb3h5LWFnZW50OnBhcnNlLXByb3h5LXJlc3BvbnNlXSIsLi4udCl9ZnVuY3Rpb24gS3QodCl7cmV0dXJuIG5ldyBQcm9taXNlKChuLGUpPT57bGV0IHI9MDtjb25zdCBvPVtdO2Z1bmN0aW9uIGkoKXtjb25zdCBjPXQucmVhZCgpO2M/ZnVuY3Rpb24oYyl7by5wdXNoKGMpLHIrPWMubGVuZ3RoO2NvbnN0IHU9QnVmZmVyLmNvbmNhdChvLHIpLGE9dS5pbmRleE9mKCJcclxuXHJcbiIpO2lmKC0xPT09YSlyZXR1cm4gVnQoImhhdmUgbm90IHJlY2VpdmVkIGVuZCBvZiBIVFRQIGhlYWRlcnMgeWV0Li4uIiksdm9pZCBpKCk7Y29uc3QgZj11LnN1YmFycmF5KDAsYSkudG9TdHJpbmcoImFzY2lpIikuc3BsaXQoIlxyXG4iKSxoPWYuc2hpZnQoKTtpZighaClyZXR1cm4gdC5kZXN0cm95KCksZShuZXcgRXJyb3IoIk5vIGhlYWRlciByZWNlaXZlZCBmcm9tIHByb3h5IENPTk5FQ1QgcmVzcG9uc2UiKSk7Y29uc3QgcD1oLnNwbGl0KCIgIiksZD0rKHBbMV18fDApLGw9cC5zbGljZSgyKS5qb2luKCIgIiksbT17fTtmb3IoY29uc3QgbiBvZiBmKXtpZighbiljb250aW51ZTtjb25zdCByPW4uaW5kZXhPZigiOiIpO2lmKC0xPT09cilyZXR1cm4gdC5kZXN0cm95KCksZShuZXcgRXJyb3IoYEludmFsaWQgaGVhZGVyIGZyb20gcHJveHkgQ09OTkVDVCByZXNwb25zZTogIiR7bn0iYCkpO2NvbnN0IG89bi5zbGljZSgwLHIpLnRvTG93ZXJDYXNlKCksaT1uLnNsaWNlKHIrMSkudHJpbVN0YXJ0KCkscz1tW29dOyJzdHJpbmciPT10eXBlb2Ygcz9tW29dPVtzLGldOkFycmF5LmlzQXJyYXkocyk/cy5wdXNoKGkpOm1bb109aX1WdCgiZ290IHByb3h5IHNlcnZlciByZXNwb25zZTogJW8gJW8iLGgsbSkscygpLG4oe2Nvbm5lY3Q6e3N0YXR1c0NvZGU6ZCxzdGF0dXNUZXh0OmwsaGVhZGVyczptfSxidWZmZXJlZDp1fSl9KGMpOnQub25jZSgicmVhZGFibGUiLGkpfWZ1bmN0aW9uIHMoKXt0LnJlbW92ZUxpc3RlbmVyKCJlbmQiLGMpLHQucmVtb3ZlTGlzdGVuZXIoImVycm9yIix1KSx0LnJlbW92ZUxpc3RlbmVyKCJyZWFkYWJsZSIsaSl9ZnVuY3Rpb24gYygpe3MoKSxWdCgib25lbmQiKSxlKG5ldyBFcnJvcigiUHJveHkgY29ubmVjdGlvbiBlbmRlZCBiZWZvcmUgcmVjZWl2aW5nIENPTk5FQ1QgcmVzcG9uc2UiKSl9ZnVuY3Rpb24gdSh0KXtzKCksVnQoIm9uZXJyb3IgJW8iLHQpLGUodCl9dC5vbigiZXJyb3IiLHUpLHQub24oImVuZCIsYyksaSgpfSl9ZnVuY3Rpb24gWnQoLi4udCl7Uy5sb2coIltodHRwcy1wcm94eS1hZ2VudF0iLC4uLnQpfWNsYXNzIHF0IGV4dGVuZHMgWXR7c3RhdGljIF9faW5pdFN0YXRpYygpe3RoaXMucHJvdG9jb2xzPVsiaHR0cCIsImh0dHBzIl19Y29uc3RydWN0b3IodCxuKXtzdXBlcihuKSx0aGlzLm9wdGlvbnM9e30sdGhpcy5wcm94eT0ic3RyaW5nIj09dHlwZW9mIHQ/bmV3IFVSTCh0KTp0LHRoaXMucHJveHlIZWFkZXJzPW4/LmhlYWRlcnM/P3t9LFp0KCJDcmVhdGluZyBuZXcgSHR0cHNQcm94eUFnZW50IGluc3RhbmNlOiAlbyIsdGhpcy5wcm94eS5ocmVmKTtjb25zdCBlPSh0aGlzLnByb3h5Lmhvc3RuYW1lfHx0aGlzLnByb3h5Lmhvc3QpLnJlcGxhY2UoL15cW3xcXSQvZywiIikscj10aGlzLnByb3h5LnBvcnQ/cGFyc2VJbnQodGhpcy5wcm94eS5wb3J0LDEwKToiaHR0cHM6Ij09PXRoaXMucHJveHkucHJvdG9jb2w/NDQzOjgwO3RoaXMuY29ubmVjdE9wdHM9e0FMUE5Qcm90b2NvbHM6WyJodHRwLzEuMSJdLC4uLm4/WHQobiwiaGVhZGVycyIpOm51bGwsaG9zdDplLHBvcnQ6cn19YXN5bmMgY29ubmVjdCh0LG4pe2NvbnN0e3Byb3h5OmV9PXRoaXM7aWYoIW4uaG9zdCl0aHJvdyBuZXcgVHlwZUVycm9yKCdObyAiaG9zdCIgcHJvdmlkZWQnKTtsZXQgcjtpZigiaHR0cHM6Ij09PWUucHJvdG9jb2wpe1p0KCJDcmVhdGluZyBgdGxzLlNvY2tldGA6ICVvIix0aGlzLmNvbm5lY3RPcHRzKTtjb25zdCB0PXRoaXMuY29ubmVjdE9wdHMuc2VydmVybmFtZXx8dGhpcy5jb25uZWN0T3B0cy5ob3N0O3I9Zi5jb25uZWN0KHsuLi50aGlzLmNvbm5lY3RPcHRzLHNlcnZlcm5hbWU6dCYmYS5pc0lQKHQpP3ZvaWQgMDp0fSl9ZWxzZSBadCgiQ3JlYXRpbmcgYG5ldC5Tb2NrZXRgOiAlbyIsdGhpcy5jb25uZWN0T3B0cykscj1hLmNvbm5lY3QodGhpcy5jb25uZWN0T3B0cyk7Y29uc3Qgbz0iZnVuY3Rpb24iPT10eXBlb2YgdGhpcy5wcm94eUhlYWRlcnM/dGhpcy5wcm94eUhlYWRlcnMoKTp7Li4udGhpcy5wcm94eUhlYWRlcnN9LGk9YS5pc0lQdjYobi5ob3N0KT9gWyR7bi5ob3N0fV1gOm4uaG9zdDtsZXQgcz1gQ09OTkVDVCAke2l9OiR7bi5wb3J0fSBIVFRQLzEuMVxyXG5gO2lmKGUudXNlcm5hbWV8fGUucGFzc3dvcmQpe2NvbnN0IHQ9YCR7ZGVjb2RlVVJJQ29tcG9uZW50KGUudXNlcm5hbWUpfToke2RlY29kZVVSSUNvbXBvbmVudChlLnBhc3N3b3JkKX1gO29bIlByb3h5LUF1dGhvcml6YXRpb24iXT1gQmFzaWMgJHtCdWZmZXIuZnJvbSh0KS50b1N0cmluZygiYmFzZTY0Iil9YH1vLkhvc3Q9YCR7aX06JHtuLnBvcnR9YCxvWyJQcm94eS1Db25uZWN0aW9uIl18fChvWyJQcm94eS1Db25uZWN0aW9uIl09dGhpcy5rZWVwQWxpdmU/IktlZXAtQWxpdmUiOiJjbG9zZSIpO2Zvcihjb25zdCB0IG9mIE9iamVjdC5rZXlzKG8pKXMrPWAke3R9OiAke29bdF19XHJcbmA7Y29uc3QgYz1LdChyKTtyLndyaXRlKGAke3N9XHJcbmApO2NvbnN0e2Nvbm5lY3Q6dSxidWZmZXJlZDpofT1hd2FpdCBjO2lmKHQuZW1pdCgicHJveHlDb25uZWN0Iix1KSx0aGlzLmVtaXQoInByb3h5Q29ubmVjdCIsdSx0KSwyMDA9PT11LnN0YXR1c0NvZGUpe2lmKHQub25jZSgic29ja2V0IixRdCksbi5zZWN1cmVFbmRwb2ludCl7WnQoIlVwZ3JhZGluZyBzb2NrZXQgY29ubmVjdGlvbiB0byBUTFMiKTtjb25zdCB0PW4uc2VydmVybmFtZXx8bi5ob3N0O3JldHVybiBmLmNvbm5lY3Qoey4uLlh0KG4sImhvc3QiLCJwYXRoIiwicG9ydCIpLHNvY2tldDpyLHNlcnZlcm5hbWU6YS5pc0lQKHQpP3ZvaWQgMDp0fSl9cmV0dXJuIHJ9ci5kZXN0cm95KCk7Y29uc3QgcD1uZXcgYS5Tb2NrZXQoe3dyaXRhYmxlOiExfSk7cmV0dXJuIHAucmVhZGFibGU9ITAsdC5vbmNlKCJzb2NrZXQiLHQ9PntadCgiUmVwbGF5aW5nIHByb3h5IGJ1ZmZlciBmb3IgZmFpbGVkIHJlcXVlc3QiKSx0LnB1c2goaCksdC5wdXNoKG51bGwpfSkscH19ZnVuY3Rpb24gUXQodCl7dC5yZXN1bWUoKX1mdW5jdGlvbiBYdCh0LC4uLm4pe2NvbnN0IGU9e307bGV0IHI7Zm9yKHIgaW4gdCluLmluY2x1ZGVzKHIpfHwoZVtyXT10W3JdKTtyZXR1cm4gZX1xdC5fX2luaXRTdGF0aWMoKTtmdW5jdGlvbiB0bih0KXtyZXR1cm4gdC5yZXBsYWNlKC9eW0EtWl06LywiIikucmVwbGFjZSgvXFwvZywiLyIpfWNvbnN0IG5uPW47bGV0IGVuLHJuPTAsb249e307ZnVuY3Rpb24gc24odCl7bm4uZGVidWcmJmNvbnNvbGUubG9nKGBbQU5SIFdvcmtlcl0gJHt0fWApfXZhciBjbix1bixhbjtjb25zdCBmbj1mdW5jdGlvbih0KXtsZXQgbjt0cnl7bj1uZXcgVVJMKHQudXJsKX1jYXRjaChuKXtyZXR1cm4gYigoKT0+e2NvbnNvbGUud2FybigiW0BzZW50cnkvbm9kZV06IEludmFsaWQgZHNuIG9yIHR1bm5lbCBvcHRpb24sIHdpbGwgbm90IHNlbmQgYW55IGV2ZW50cy4gVGhlIHR1bm5lbCBvcHRpb24gbXVzdCBiZSBhIGZ1bGwgVVJMIHdoZW4gdXNlZC4iKX0pLHp0KHQsKCk9PlByb21pc2UucmVzb2x2ZSh7fSkpfWNvbnN0IGU9Imh0dHBzOiI9PT1uLnByb3RvY29sLHI9ZnVuY3Rpb24odCxuKXtjb25zdHtub19wcm94eTplfT1wcm9jZXNzLmVudixyPWU/LnNwbGl0KCIsIikuc29tZShuPT50Lmhvc3QuZW5kc1dpdGgobil8fHQuaG9zdG5hbWUuZW5kc1dpdGgobikpO3JldHVybiByP3ZvaWQgMDpufShuLHQucHJveHl8fChlP3Byb2Nlc3MuZW52Lmh0dHBzX3Byb3h5OnZvaWQgMCl8fHByb2Nlc3MuZW52Lmh0dHBfcHJveHkpLG89ZT9zOmksYT12b2lkIDAhPT10LmtlZXBBbGl2ZSYmdC5rZWVwQWxpdmUsZj1yP25ldyBxdChyKTpuZXcgby5BZ2VudCh7a2VlcEFsaXZlOmEsbWF4U29ja2V0czozMCx0aW1lb3V0OjJlM30pLGg9ZnVuY3Rpb24odCxuLGUpe2NvbnN0e2hvc3RuYW1lOnIscGF0aG5hbWU6byxwb3J0OmkscHJvdG9jb2w6cyxzZWFyY2g6YX09bmV3IFVSTCh0LnVybCk7cmV0dXJuIGZ1bmN0aW9uKGYpe3JldHVybiBuZXcgUHJvbWlzZSgoaCxwKT0+e0R0KCgpPT57bGV0IGQ9ZnVuY3Rpb24odCl7cmV0dXJuIG5ldyBjKHtyZWFkKCl7dGhpcy5wdXNoKHQpLHRoaXMucHVzaChudWxsKX19KX0oZi5ib2R5KTtjb25zdCBsPXsuLi50LmhlYWRlcnN9O2YuYm9keS5sZW5ndGg+MzI3NjgmJihsWyJjb250ZW50LWVuY29kaW5nIl09Imd6aXAiLGQ9ZC5waXBlKHUoKSkpO2NvbnN0IG09ci5zdGFydHNXaXRoKCJbIiksZz1uLnJlcXVlc3Qoe21ldGhvZDoiUE9TVCIsYWdlbnQ6ZSxoZWFkZXJzOmwsaG9zdG5hbWU6bT9yLnNsaWNlKDEsLTEpOnIscGF0aDpgJHtvfSR7YX1gLHBvcnQ6aSxwcm90b2NvbDpzLGNhOnQuY2FDZXJ0c30sdD0+e3Qub24oImRhdGEiLCgpPT57fSksdC5vbigiZW5kIiwoKT0+e30pLHQuc2V0RW5jb2RpbmcoInV0ZjgiKTtjb25zdCBuPXQuaGVhZGVyc1sicmV0cnktYWZ0ZXIiXT8/bnVsbCxlPXQuaGVhZGVyc1sieC1zZW50cnktcmF0ZS1saW1pdHMiXT8/bnVsbDtoKHtzdGF0dXNDb2RlOnQuc3RhdHVzQ29kZSxoZWFkZXJzOnsicmV0cnktYWZ0ZXIiOm4sIngtc2VudHJ5LXJhdGUtbGltaXRzIjpBcnJheS5pc0FycmF5KGUpP2VbMF18fG51bGw6ZX19KX0pO2cub24oImVycm9yIixwKSxkLnBpcGUoZyl9KX0pfX0odCx0Lmh0dHBNb2R1bGU/P28sZik7cmV0dXJuIHp0KHQsaCl9KHt1cmw6KGNuPW5uLmRzbix1bj1ubi50dW5uZWwsYW49bm4uc2RrTWV0YWRhdGEuc2RrLHVufHxgJHtmdW5jdGlvbih0KXtyZXR1cm5gJHtmdW5jdGlvbih0KXtjb25zdCBuPXQucHJvdG9jb2w/YCR7dC5wcm90b2NvbH06YDoiIixlPXQucG9ydD9gOiR7dC5wb3J0fWA6IiI7cmV0dXJuYCR7bn0vLyR7dC5ob3N0fSR7ZX0ke3QucGF0aD9gLyR7dC5wYXRofWA6IiJ9L2FwaS9gfSh0KX0ke3QucHJvamVjdElkfS9lbnZlbG9wZS9gfShjbil9PyR7ZnVuY3Rpb24odCxuKXtjb25zdCBlPXtzZW50cnlfdmVyc2lvbjoiNyJ9O3JldHVybiB0LnB1YmxpY0tleSYmKGUuc2VudHJ5X2tleT10LnB1YmxpY0tleSksbiYmKGUuc2VudHJ5X2NsaWVudD1gJHtuLm5hbWV9LyR7bi52ZXJzaW9ufWApLG5ldyBVUkxTZWFyY2hQYXJhbXMoZSkudG9TdHJpbmcoKX0oY24sYW4pfWApfSk7YXN5bmMgZnVuY3Rpb24gaG4oKXtpZihlbil7c24oIlNlbmRpbmcgYWJub3JtYWwgc2Vzc2lvbiIpLFYoZW4se3N0YXR1czoiYWJub3JtYWwiLGFibm9ybWFsX21lY2hhbmlzbToiYW5yX2ZvcmVncm91bmQiLHJlbGVhc2U6bm4ucmVsZWFzZSxlbnZpcm9ubWVudDpubi5lbnZpcm9ubWVudH0pO2NvbnN0IHQ9ZnVuY3Rpb24odCxuLGUscil7Y29uc3Qgbz1SdChlKTtyZXR1cm4gQXQoe3NlbnRfYXQ6KG5ldyBEYXRlKS50b0lTT1N0cmluZygpLC4uLm8mJntzZGs6b30sLi4uISFyJiZuJiZ7ZHNuOm10KG4pfX0sWyJhZ2dyZWdhdGVzImluIHQ/W3t0eXBlOiJzZXNzaW9ucyJ9LHRdOlt7dHlwZToic2Vzc2lvbiJ9LHQudG9KU09OKCldXSl9KGVuLG5uLmRzbixubi5zZGtNZXRhZGF0YSxubi50dW5uZWwpO3NuKEpTT04uc3RyaW5naWZ5KHQpKSxhd2FpdCBmbi5zZW5kKHQpO3RyeXtlPy5wb3N0TWVzc2FnZSgic2Vzc2lvbi1lbmRlZCIpfWNhdGNoe319fWZ1bmN0aW9uIHBuKHQpe2lmKCF0KXJldHVybjtjb25zdCBuPWZ1bmN0aW9uKHQpe2lmKCF0Lmxlbmd0aClyZXR1cm5bXTtjb25zdCBuPUFycmF5LmZyb20odCk7cmV0dXJuL3NlbnRyeVdyYXBwZWQvLnRlc3QoRShuKS5mdW5jdGlvbnx8IiIpJiZuLnBvcCgpLG4ucmV2ZXJzZSgpLCQudGVzdChFKG4pLmZ1bmN0aW9ufHwiIikmJihuLnBvcCgpLCQudGVzdChFKG4pLmZ1bmN0aW9ufHwiIikmJm4ucG9wKCkpLG4uc2xpY2UoMCw1MCkubWFwKHQ9Pih7Li4udCxmaWxlbmFtZTp0LmZpbGVuYW1lfHxFKG4pLmZpbGVuYW1lLGZ1bmN0aW9uOnQuZnVuY3Rpb258fCI/In0pKX0odCk7aWYobm4uYXBwUm9vdFBhdGgpZm9yKGNvbnN0IHQgb2Ygbil0LmZpbGVuYW1lJiYodC5maWxlbmFtZT1DdCh0LmZpbGVuYW1lLG5uLmFwcFJvb3RQYXRoKSk7cmV0dXJuIG59YXN5bmMgZnVuY3Rpb24gZG4odCxuKXtpZihybj49bm4ubWF4QW5yRXZlbnRzKXJldHVybjtybis9MSxhd2FpdCBobigpLHNuKCJTZW5kaW5nIGV2ZW50Iik7Y29uc3QgZT17ZXZlbnRfaWQ6RigpLGNvbnRleHRzOm5uLmNvbnRleHRzLHJlbGVhc2U6bm4ucmVsZWFzZSxlbnZpcm9ubWVudDpubi5lbnZpcm9ubWVudCxkaXN0Om5uLmRpc3QscGxhdGZvcm06Im5vZGUiLGxldmVsOiJlcnJvciIsZXhjZXB0aW9uOnt2YWx1ZXM6W3t0eXBlOiJBcHBsaWNhdGlvbk5vdFJlc3BvbmRpbmciLHZhbHVlOmBBcHBsaWNhdGlvbiBOb3QgUmVzcG9uZGluZyBmb3IgYXQgbGVhc3QgJHtubi5hbnJUaHJlc2hvbGR9IG1zYCxzdGFja3RyYWNlOntmcmFtZXM6cG4odCl9LG1lY2hhbmlzbTp7dHlwZToiQU5SIn19XX0sdGFnczpubi5zdGF0aWNUYWdzfTtuJiZmdW5jdGlvbih0LG4pe2lmKE10KHQsbiksIXQuY29udGV4dHM/LnRyYWNlKXtjb25zdHt0cmFjZUlkOmUscGFyZW50U3BhbklkOnIscHJvcGFnYXRpb25TcGFuSWQ6b309bi5wcm9wYWdhdGlvbkNvbnRleHQ7dC5jb250ZXh0cz17dHJhY2U6e3RyYWNlX2lkOmUsc3Bhbl9pZDpvfHxxKCkscGFyZW50X3NwYW5faWQ6cn0sLi4udC5jb250ZXh0c319fShlLG4pLGZ1bmN0aW9uKHQpe2lmKDA9PT1PYmplY3Qua2V5cyhvbikubGVuZ3RoKXJldHVybjtjb25zdCBuPW5uLmFwcFJvb3RQYXRoP3t9Om9uO2lmKG5uLmFwcFJvb3RQYXRoKWZvcihjb25zdFt0LGVdb2YgT2JqZWN0LmVudHJpZXMob24pKW5bQ3QodCxubi5hcHBSb290UGF0aCldPWU7Y29uc3QgZT1uZXcgTWFwO2Zvcihjb25zdCByIG9mIHQuZXhjZXB0aW9uPy52YWx1ZXN8fFtdKWZvcihjb25zdCB0IG9mIHIuc3RhY2t0cmFjZT8uZnJhbWVzfHxbXSl7Y29uc3Qgcj10LmFic19wYXRofHx0LmZpbGVuYW1lO3ImJm5bcl0mJmUuc2V0KHIsbltyXSl9aWYoZS5zaXplPjApe2NvbnN0IG49W107Zm9yKGNvbnN0W3Qscl1vZiBlLmVudHJpZXMoKSluLnB1c2goe3R5cGU6InNvdXJjZW1hcCIsY29kZV9maWxlOnQsZGVidWdfaWQ6cn0pO3QuZGVidWdfbWV0YT17aW1hZ2VzOm59fX0oZSk7Y29uc3Qgcj1PdChlLG5uLmRzbixubi5zZGtNZXRhZGF0YSxubi50dW5uZWwpO3NuKEpTT04uc3RyaW5naWZ5KHIpKSxhd2FpdCBmbi5zZW5kKHIpLGF3YWl0IGZuLmZsdXNoKDJlMykscm4+PW5uLm1heEFuckV2ZW50cyYmc2V0VGltZW91dCgoKT0+e3Byb2Nlc3MuZXhpdCgwKX0sNWUzKX1sZXQgbG47aWYoc24oIlN0YXJ0ZWQiKSxubi5jYXB0dXJlU3RhY2tUcmFjZSl7c24oIkNvbm5lY3RpbmcgdG8gZGVidWdnZXIiKTtjb25zdCBuPW5ldyB0O24uY29ubmVjdFRvTWFpblRocmVhZCgpLHNuKCJDb25uZWN0ZWQgdG8gZGVidWdnZXIiKTtjb25zdCBlPW5ldyBNYXA7bi5vbigiRGVidWdnZXIuc2NyaXB0UGFyc2VkIix0PT57ZS5zZXQodC5wYXJhbXMuc2NyaXB0SWQsdC5wYXJhbXMudXJsKX0pLG4ub24oIkRlYnVnZ2VyLnBhdXNlZCIsdD0+e2lmKCJvdGhlciI9PT10LnBhcmFtcy5yZWFzb24pdHJ5e3NuKCJEZWJ1Z2dlciBwYXVzZWQiKTtjb25zdCBpPVsuLi50LnBhcmFtcy5jYWxsRnJhbWVzXSxzPW5uLmFwcFJvb3RQYXRoP2Z1bmN0aW9uKHQ9KHByb2Nlc3MuYXJndlsxXT9HdChwcm9jZXNzLmFyZ3ZbMV0pOnByb2Nlc3MuY3dkKCkpLG49IlxcIj09PW8pe2NvbnN0IGU9bj90bih0KTp0O3JldHVybiB0PT57aWYoIXQpcmV0dXJuO2NvbnN0IG89bj90bih0KTp0O2xldHtkaXI6aSxiYXNlOnMsZXh0OmN9PXIucGFyc2Uobyk7Ii5qcyIhPT1jJiYiLm1qcyIhPT1jJiYiLmNqcyIhPT1jfHwocz1zLnNsaWNlKDAsLTEqYy5sZW5ndGgpKTtjb25zdCB1PWRlY29kZVVSSUNvbXBvbmVudChzKTtpfHwoaT0iLiIpO2NvbnN0IGE9aS5sYXN0SW5kZXhPZigiL25vZGVfbW9kdWxlcyIpO2lmKGE+LTEpcmV0dXJuYCR7aS5zbGljZShhKzE0KS5yZXBsYWNlKC9cLy9nLCIuIil9OiR7dX1gO2lmKGkuc3RhcnRzV2l0aChlKSl7Y29uc3QgdD1pLnNsaWNlKGUubGVuZ3RoKzEpLnJlcGxhY2UoL1wvL2csIi4iKTtyZXR1cm4gdD9gJHt0fToke3V9YDp1fXJldHVybiB1fX0obm4uYXBwUm9vdFBhdGgpOigpPT57fSxjPWkubWFwKHQ9PmZ1bmN0aW9uKHQsbixlKXtjb25zdCByPW4/bi5yZXBsYWNlKC9eZmlsZTpcL1wvLywiIik6dm9pZCAwLG89dC5sb2NhdGlvbi5jb2x1bW5OdW1iZXI/dC5sb2NhdGlvbi5jb2x1bW5OdW1iZXIrMTp2b2lkIDAsaT10LmxvY2F0aW9uLmxpbmVOdW1iZXI/dC5sb2NhdGlvbi5saW5lTnVtYmVyKzE6dm9pZCAwO3JldHVybntmaWxlbmFtZTpyLG1vZHVsZTplKHIpLGZ1bmN0aW9uOnQuZnVuY3Rpb25OYW1lfHwiPyIsY29sbm86byxsaW5lbm86aSxpbl9hcHA6cj9IdChyKTp2b2lkIDB9fSh0LGUuZ2V0KHQubG9jYXRpb24uc2NyaXB0SWQpLHMpKSx1PXNldFRpbWVvdXQoKCk9PntkbihjKS50aGVuKG51bGwsKCk9PntzbigiU2VuZGluZyBBTlIgZXZlbnQgZmFpbGVkLiIpfSl9LDVlMyk7bi5wb3N0KCJSdW50aW1lLmV2YWx1YXRlIix7ZXhwcmVzc2lvbjoiZ2xvYmFsLl9fU0VOVFJZX0dFVF9TQ09QRVNfXygpOyIsc2lsZW50OiEwLHJldHVybkJ5VmFsdWU6ITB9LCh0LGUpPT57dCYmc24oYEVycm9yIGV4ZWN1dGluZyBzY3JpcHQ6ICcke3QubWVzc2FnZX0nYCksY2xlYXJUaW1lb3V0KHUpO2NvbnN0IHI9ZT8ucmVzdWx0P2UucmVzdWx0LnZhbHVlOnZvaWQgMDtuLnBvc3QoIkRlYnVnZ2VyLnJlc3VtZSIpLG4ucG9zdCgiRGVidWdnZXIuZGlzYWJsZSIpLGRuKGMscikudGhlbihudWxsLCgpPT57c24oIlNlbmRpbmcgQU5SIGV2ZW50IGZhaWxlZC4iKX0pfSl9Y2F0Y2godCl7dGhyb3cgbi5wb3N0KCJEZWJ1Z2dlci5yZXN1bWUiKSxuLnBvc3QoIkRlYnVnZ2VyLmRpc2FibGUiKSx0fX0pLGxuPSgpPT57dHJ5e24ucG9zdCgiRGVidWdnZXIuZW5hYmxlIiwoKT0+e24ucG9zdCgiRGVidWdnZXIucGF1c2UiKX0pfWNhdGNoe319fWNvbnN0e3BvbGw6bW59PWZ1bmN0aW9uKHQsbixlLHIpe2NvbnN0IG89dCgpO2xldCBpPSExLHM9ITA7cmV0dXJuIHNldEludGVydmFsKCgpPT57Y29uc3QgdD1vLmdldFRpbWVNcygpOyExPT09aSYmdD5uK2UmJihpPSEwLHMmJnIoKSksdDxuK2UmJihpPSExKX0sMjApLHtwb2xsOigpPT57by5yZXNldCgpfSxlbmFibGVkOnQ9PntzPXR9fX0oZnVuY3Rpb24oKXtsZXQgdD1wcm9jZXNzLmhydGltZSgpO3JldHVybntnZXRUaW1lTXM6KCk9Pntjb25zdFtuLGVdPXByb2Nlc3MuaHJ0aW1lKHQpO3JldHVybiBNYXRoLmZsb29yKDFlMypuK2UvMWU2KX0scmVzZXQ6KCk9Pnt0PXByb2Nlc3MuaHJ0aW1lKCl9fX0sbm4ucG9sbEludGVydmFsLG5uLmFuclRocmVzaG9sZCxmdW5jdGlvbigpe3NuKCJXYXRjaGRvZyB0aW1lb3V0IiksbG4/KHNuKCJQYXVzaW5nIGRlYnVnZ2VyIHRvIGNhcHR1cmUgc3RhY2sgdHJhY2UiKSxsbigpKTooc24oIkNhcHR1cmluZyBldmVudCB3aXRob3V0IGEgc3RhY2sgdHJhY2UiKSxkbigpLnRoZW4obnVsbCwoKT0+e3NuKCJTZW5kaW5nIEFOUiBldmVudCBmYWlsZWQgb24gd2F0Y2hkb2cgdGltZW91dC4iKX0pKX0pO2U/Lm9uKCJtZXNzYWdlIix0PT57dC5zZXNzaW9uJiYoZW49WSh0LnNlc3Npb24pKSx0LmRlYnVnSW1hZ2VzJiYob249dC5kZWJ1Z0ltYWdlcyksbW4oKX0pOw==';
const DEFAULT_INTERVAL = 50;
const DEFAULT_HANG_THRESHOLD = 5000;
function log(message, ...args) {
    core.debug.log(`[ANR] ${message}`, ...args);
}
function globalWithScopeFetchFn() {
    return core.GLOBAL_OBJ;
}
/** Fetches merged scope data */ function getScopeData() {
    const scope = core.getCombinedScopeData(core.getIsolationScope(), core.getCurrentScope());
    // We remove attachments because they likely won't serialize well as json
    scope.attachments = [];
    // We can't serialize event processor functions
    scope.eventProcessors = [];
    return scope;
}
/**
 * Gets contexts by calling all event processors. This shouldn't be called until all integrations are setup
 */ async function getContexts(client) {
    let event = {
        message: 'ANR'
    };
    const eventHint = {};
    for (const processor of client.getEventProcessors()){
        if (event === null) break;
        event = await processor(event, eventHint);
    }
    return event?.contexts || {};
}
const INTEGRATION_NAME = 'Anr';
// eslint-disable-next-line deprecation/deprecation
const _anrIntegration = (options = {})=>{
    if (nodeVersion.NODE_VERSION.major < 16 || nodeVersion.NODE_VERSION.major === 16 && nodeVersion.NODE_VERSION.minor < 17) {
        throw new Error('ANR detection requires Node 16.17.0 or later');
    }
    let worker;
    let client;
    // Hookup the scope fetch function to the global object so that it can be called from the worker thread via the
    // debugger when it pauses
    const gbl = globalWithScopeFetchFn();
    gbl.__SENTRY_GET_SCOPES__ = getScopeData;
    return {
        name: INTEGRATION_NAME,
        startWorker: ()=>{
            if (worker) {
                return;
            }
            if (client) {
                worker = _startWorker(client, options);
            }
        },
        stopWorker: ()=>{
            if (worker) {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                worker.then((stop)=>{
                    stop();
                    worker = undefined;
                });
            }
        },
        async setup (initClient) {
            client = initClient;
            if (options.captureStackTrace && await debug.isDebuggerEnabled()) {
                core.debug.warn('ANR captureStackTrace has been disabled because the debugger was already enabled');
                options.captureStackTrace = false;
            }
            // setImmediate is used to ensure that all other integrations have had their setup called first.
            // This allows us to call into all integrations to fetch the full context
            setImmediate(()=>this.startWorker());
        }
    };
};
// eslint-disable-next-line deprecation/deprecation
/**
 * Application Not Responding (ANR) integration for Node.js applications.
 *
 * @deprecated The ANR integration has been deprecated. Use `eventLoopBlockIntegration` from `@sentry/node-native` instead.
 *
 * Detects when the Node.js main thread event loop is blocked for more than the configured
 * threshold (5 seconds by default) and reports these as Sentry events.
 *
 * ANR detection uses a worker thread to monitor the event loop in the main app thread.
 * The main app thread sends a heartbeat message to the ANR worker thread every 50ms by default.
 * If the ANR worker does not receive a heartbeat message for the configured threshold duration,
 * it triggers an ANR event.
 *
 * - Node.js 16.17.0 or higher
 * - Only supported in the Node.js runtime (not browsers)
 * - Not supported for Node.js clusters
 *
 * Overhead should be minimal:
 * - Main thread: Only polling the ANR worker over IPC every 50ms
 * - Worker thread: Consumes around 10-20 MB of RAM
 * - When ANR detected: Brief pause in debugger to capture stack trace (negligible compared to the blocking)
 *
 * @example
 * ```javascript
 * Sentry.init({
 *   dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
 *   integrations: [
 *     Sentry.anrIntegration({
 *       anrThreshold: 5000,
 *       captureStackTrace: true,
 *       pollInterval: 50,
 *     }),
 *   ],
 * });
 * ```
 */ const anrIntegration = core.defineIntegration(_anrIntegration);
/**
 * Starts the ANR worker thread
 *
 * @returns A function to stop the worker
 */ async function _startWorker(client, // eslint-disable-next-line deprecation/deprecation
integrationOptions) {
    const dsn = client.getDsn();
    if (!dsn) {
        return ()=>{
        //
        };
    }
    const contexts = await getContexts(client);
    // These will not be accurate if sent later from the worker thread
    delete contexts.app?.app_memory;
    delete contexts.device?.free_memory;
    const initOptions = client.getOptions();
    const sdkMetadata = client.getSdkMetadata() || {};
    if (sdkMetadata.sdk) {
        sdkMetadata.sdk.integrations = initOptions.integrations.map((i)=>i.name);
    }
    const options = {
        debug: core.debug.isEnabled(),
        dsn,
        tunnel: initOptions.tunnel,
        environment: initOptions.environment || 'production',
        release: initOptions.release,
        dist: initOptions.dist,
        sdkMetadata,
        appRootPath: integrationOptions.appRootPath,
        pollInterval: integrationOptions.pollInterval || DEFAULT_INTERVAL,
        anrThreshold: integrationOptions.anrThreshold || DEFAULT_HANG_THRESHOLD,
        captureStackTrace: !!integrationOptions.captureStackTrace,
        maxAnrEvents: integrationOptions.maxAnrEvents || 1,
        staticTags: integrationOptions.staticTags || {},
        contexts
    };
    if (options.captureStackTrace) {
        const inspector = await __turbopack_context__.A("[externals]/node:inspector [external] (node:inspector, cjs, async loader)");
        if (!inspector.url()) {
            inspector.open(0);
        }
    }
    const worker = new node_worker_threads.Worker(new URL(`data:application/javascript;base64,${base64WorkerScript}`), {
        workerData: options,
        // We don't want any Node args to be passed to the worker
        execArgv: [],
        env: {
            ...process.env,
            NODE_OPTIONS: undefined
        }
    });
    process.on('exit', ()=>{
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        worker.terminate();
    });
    const timer = setInterval(()=>{
        try {
            const currentSession = core.getIsolationScope().getSession();
            // We need to copy the session object and remove the toJSON method so it can be sent to the worker
            // serialized without making it a SerializedSession
            const session = currentSession ? {
                ...currentSession,
                toJSON: undefined
            } : undefined;
            // message the worker to tell it the main event loop is still running
            worker.postMessage({
                session,
                debugImages: core.getFilenameToDebugIdMap(initOptions.stackParser)
            });
        } catch  {
        //
        }
    }, options.pollInterval);
    // Timer should not block exit
    timer.unref();
    worker.on('message', (msg)=>{
        if (msg === 'session-ended') {
            log('ANR event sent from ANR worker. Clearing session in this thread.');
            core.getIsolationScope().setSession(undefined);
        }
    });
    worker.once('error', (err)=>{
        clearInterval(timer);
        log('ANR worker error', err);
    });
    worker.once('exit', (code)=>{
        clearInterval(timer);
        log('ANR worker exit', code);
    });
    // Ensure this thread can't block app exit
    worker.unref();
    return ()=>{
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        worker.terminate();
        clearInterval(timer);
    };
}
/**
 * @see {@link disableBlockDetectionForCallback}
 *
 * @deprecated The ANR integration has been deprecated. Use `eventLoopBlockIntegration` from `@sentry/node-native` instead.
 */ /**
 * Temporarily disables ANR detection for the duration of a callback function.
 *
 * This utility function allows you to disable ANR detection during operations that
 * are expected to block the event loop, such as intensive computational tasks or
 * synchronous I/O operations.
 *
 * @deprecated The ANR integration has been deprecated. Use `eventLoopBlockIntegration` from `@sentry/node-native` instead.
 */ function disableAnrDetectionForCallback(callback) {
    const integration = core.getClient()?.getIntegrationByName(INTEGRATION_NAME);
    if (!integration) {
        return callback();
    }
    integration.stopWorker();
    const result = callback();
    if (isPromise(result)) {
        return result.finally(()=>integration.startWorker());
    }
    integration.startWorker();
    return result;
}
exports.anrIntegration = anrIntegration;
exports.base64WorkerScript = base64WorkerScript;
exports.disableAnrDetectionForCallback = disableAnrDetectionForCallback; //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/logs/capture.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const util = __turbopack_context__.r("[externals]/node:util [external] (node:util, cjs)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
/**
 * Additional metadata to capture the log with.
 */ /**
 * Capture a log with the given level.
 *
 * @param level - The level of the log.
 * @param message - The message to log.
 * @param attributes - Arbitrary structured data that stores information about the log - e.g., userId: 100.
 */ function captureLog(level, ...args) {
    const [messageOrMessageTemplate, paramsOrAttributes, maybeAttributesOrMetadata, maybeMetadata] = args;
    if (Array.isArray(paramsOrAttributes)) {
        // type-casting here because from the type definitions we know that `maybeAttributesOrMetadata` is an attributes object (or undefined)
        const attributes = {
            ...maybeAttributesOrMetadata
        };
        attributes['sentry.message.template'] = messageOrMessageTemplate;
        paramsOrAttributes.forEach((param, index)=>{
            attributes[`sentry.message.parameter.${index}`] = param;
        });
        const message = util.format(messageOrMessageTemplate, ...paramsOrAttributes);
        core._INTERNAL_captureLog({
            level,
            message,
            attributes
        }, maybeMetadata?.scope);
    } else {
        core._INTERNAL_captureLog({
            level,
            message: messageOrMessageTemplate,
            attributes: paramsOrAttributes
        }, // type-casting here because from the type definitions we know that `maybeAttributesOrMetadata` is a metadata object (or undefined)
        maybeAttributesOrMetadata?.scope ?? maybeMetadata?.scope);
    }
}
exports.captureLog = captureLog; //# sourceMappingURL=capture.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/logs/exports.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const capture = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/logs/capture.js [instrumentation] (ecmascript)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
/**
 * @summary Capture a log with the `trace` level. Requires the `enableLogs` option to be enabled.
 *
 * You can either pass a message and attributes or a message template, params and attributes.
 *
 * @example
 *
 * ```
 * Sentry.logger.trace('Starting database connection', {
 *   database: 'users',
 *   connectionId: 'conn_123'
 * });
 * ```
 *
 * @example With template strings
 *
 * ```
 * Sentry.logger.trace('Database connection %s established for %s',
 *   ['successful', 'users'],
 *   { connectionId: 'conn_123' }
 * );
 * ```
 */ function trace(...args) {
    capture.captureLog('trace', ...args);
}
/**
 * @summary Capture a log with the `debug` level. Requires the `enableLogs` option to be enabled.
 *
 * You can either pass a message and attributes or a message template, params and attributes.
 *
 * @example
 *
 * ```
 * Sentry.logger.debug('Cache miss for user profile', {
 *   userId: 'user_123',
 *   cacheKey: 'profile:user_123'
 * });
 * ```
 *
 * @example With template strings
 *
 * ```
 * Sentry.logger.debug('Cache %s for %s: %s',
 *   ['miss', 'user profile', 'key not found'],
 *   { userId: 'user_123' }
 * );
 * ```
 */ function debug(...args) {
    capture.captureLog('debug', ...args);
}
/**
 * @summary Capture a log with the `info` level. Requires the `enableLogs` option to be enabled.
 *
 * You can either pass a message and attributes or a message template, params and attributes.
 *
 * @example
 *
 * ```
 * Sentry.logger.info('User profile updated', {
 *   userId: 'user_123',
 *   updatedFields: ['email', 'preferences']
 * });
 * ```
 *
 * @example With template strings
 *
 * ```
 * Sentry.logger.info('User %s updated their %s',
 *   ['John Doe', 'profile settings'],
 *   { userId: 'user_123' }
 * );
 * ```
 */ function info(...args) {
    capture.captureLog('info', ...args);
}
/**
 * @summary Capture a log with the `warn` level. Requires the `enableLogs` option to be enabled.
 *
 * You can either pass a message and attributes or a message template, params and attributes.
 *
 * @example
 *
 * ```
 * Sentry.logger.warn('Rate limit approaching', {
 *   endpoint: '/api/users',
 *   currentRate: '95/100',
 *   resetTime: '2024-03-20T10:00:00Z'
 * });
 * ```
 *
 * @example With template strings
 *
 * ```
 * Sentry.logger.warn('Rate limit %s for %s: %s',
 *   ['approaching', '/api/users', '95/100 requests'],
 *   { resetTime: '2024-03-20T10:00:00Z' }
 * );
 * ```
 */ function warn(...args) {
    capture.captureLog('warn', ...args);
}
/**
 * @summary Capture a log with the `error` level. Requires the `enableLogs` option to be enabled.
 *
 * You can either pass a message and attributes or a message template, params and attributes.
 *
 * @example
 *
 * ```
 * Sentry.logger.error('Failed to process payment', {
 *   orderId: 'order_123',
 *   errorCode: 'PAYMENT_FAILED',
 *   amount: 99.99
 * });
 * ```
 *
 * @example With template strings
 *
 * ```
 * Sentry.logger.error('Payment processing failed for order %s: %s',
 *   ['order_123', 'insufficient funds'],
 *   { amount: 99.99 }
 * );
 * ```
 */ function error(...args) {
    capture.captureLog('error', ...args);
}
/**
 * @summary Capture a log with the `fatal` level. Requires the `enableLogs` option to be enabled.
 *
 * You can either pass a message and attributes or a message template, params and attributes.
 *
 * @example
 *
 * ```
 * Sentry.logger.fatal('Database connection pool exhausted', {
 *   database: 'users',
 *   activeConnections: 100,
 *   maxConnections: 100
 * });
 * ```
 *
 * @example With template strings
 *
 * ```
 * Sentry.logger.fatal('Database %s: %s connections active',
 *   ['connection pool exhausted', '100/100'],
 *   { database: 'users' }
 * );
 * ```
 */ function fatal(...args) {
    capture.captureLog('fatal', ...args);
}
exports.fmt = core.fmt;
exports.debug = debug;
exports.error = error;
exports.fatal = fatal;
exports.info = info;
exports.trace = trace;
exports.warn = warn; //# sourceMappingURL=exports.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/winston.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/debug-build.js [instrumentation] (ecmascript)");
const capture = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/logs/capture.js [instrumentation] (ecmascript)");
const DEFAULT_CAPTURED_LEVELS = [
    'trace',
    'debug',
    'info',
    'warn',
    'error',
    'fatal'
];
// See: https://github.com/winstonjs/triple-beam
const LEVEL_SYMBOL = Symbol.for('level');
const MESSAGE_SYMBOL = Symbol.for('message');
const SPLAT_SYMBOL = Symbol.for('splat');
/**
 * Options for the Sentry Winston transport.
 */ /**
 * Creates a new Sentry Winston transport that fowards logs to Sentry. Requires the `enableLogs` option to be enabled.
 *
 * Supports Winston 3.x.x.
 *
 * @param TransportClass - The Winston transport class to extend.
 * @returns The extended transport class.
 *
 * @example
 * ```ts
 * const winston = require('winston');
 * const Transport = require('winston-transport');
 *
 * const SentryWinstonTransport = Sentry.createSentryWinstonTransport(Transport);
 *
 * const logger = winston.createLogger({
 *   transports: [new SentryWinstonTransport()],
 * });
 * ```
 */ function createSentryWinstonTransport(// eslint-disable-next-line @typescript-eslint/no-explicit-any
TransportClass, sentryWinstonOptions) {
    // @ts-ignore - We know this is safe because SentryWinstonTransport extends TransportClass
    class SentryWinstonTransport extends TransportClass {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(options){
            super(options);
            this._levels = new Set(sentryWinstonOptions?.levels ?? DEFAULT_CAPTURED_LEVELS);
        }
        /**
     * Forwards a winston log to the Sentry SDK.
     */ log(info, callback) {
            try {
                setImmediate(()=>{
                    // @ts-ignore - We know this is safe because SentryWinstonTransport extends TransportClass
                    this.emit('logged', info);
                });
                if (!isObject(info)) {
                    return;
                }
                const levelFromSymbol = info[LEVEL_SYMBOL];
                // See: https://github.com/winstonjs/winston?tab=readme-ov-file#streams-objectmode-and-info-objects
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { level, message, timestamp, ...attributes } = info;
                // Remove all symbols from the remaining attributes
                attributes[LEVEL_SYMBOL] = undefined;
                attributes[MESSAGE_SYMBOL] = undefined;
                attributes[SPLAT_SYMBOL] = undefined;
                const customLevel = sentryWinstonOptions?.customLevelMap?.[levelFromSymbol];
                const winstonLogLevel = WINSTON_LEVEL_TO_LOG_SEVERITY_LEVEL_MAP[levelFromSymbol];
                const logSeverityLevel = customLevel ?? winstonLogLevel ?? 'info';
                if (this._levels.has(logSeverityLevel)) {
                    capture.captureLog(logSeverityLevel, message, {
                        ...attributes,
                        'sentry.origin': 'auto.log.winston'
                    });
                } else if (!customLevel && !winstonLogLevel) {
                    debugBuild.DEBUG_BUILD && core.debug.log(`Winston log level ${levelFromSymbol} is not captured by Sentry. Please add ${levelFromSymbol} to the "customLevelMap" option of the Sentry Winston transport.`);
                }
            } catch  {
            // do nothing
            }
            if (callback) {
                callback();
            }
        }
    }
    return SentryWinstonTransport;
}
function isObject(anything) {
    return typeof anything === 'object' && anything != null;
}
// npm
// {
//   error: 0,
//   warn: 1,
//   info: 2,
//   http: 3,
//   verbose: 4,
//   debug: 5,
//   silly: 6
// }
//
// syslog
// {
//   emerg: 0,
//   alert: 1,
//   crit: 2,
//   error: 3,
//   warning: 4,
//   notice: 5,
//   info: 6,
//   debug: 7,
// }
const WINSTON_LEVEL_TO_LOG_SEVERITY_LEVEL_MAP = {
    // npm
    silly: 'trace',
    // npm and syslog
    debug: 'debug',
    // npm
    verbose: 'debug',
    // npm
    http: 'debug',
    // npm and syslog
    info: 'info',
    // syslog
    notice: 'info',
    // npm
    warn: 'warn',
    // syslog
    warning: 'warn',
    // npm and syslog
    error: 'error',
    // syslog
    emerg: 'fatal',
    // syslog
    alert: 'fatal',
    // syslog
    crit: 'fatal'
};
exports.createSentryWinstonTransport = createSentryWinstonTransport; //# sourceMappingURL=winston.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/pino.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const diagnosticsChannel = __turbopack_context__.r("[externals]/node:diagnostics_channel [external] (node:diagnostics_channel, cjs)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const SENTRY_TRACK_SYMBOL = Symbol('sentry-track-pino-logger');
/**
 * Gets a custom Pino key from a logger instance by searching for the symbol.
 * Pino uses non-global symbols like Symbol('pino.messageKey'): https://github.com/pinojs/pino/blob/8a816c0b1f72de5ae9181f3bb402109b66f7d812/lib/symbols.js
 */ function getPinoKey(logger, symbolName, defaultKey) {
    const symbols = Object.getOwnPropertySymbols(logger);
    const symbolString = `Symbol(${symbolName})`;
    for (const sym of symbols){
        if (sym.toString() === symbolString) {
            const value = logger[sym];
            return typeof value === 'string' ? value : defaultKey;
        }
    }
    return defaultKey;
}
const DEFAULT_OPTIONS = {
    error: {
        levels: [],
        handled: true
    },
    log: {
        levels: [
            'trace',
            'debug',
            'info',
            'warn',
            'error',
            'fatal'
        ]
    }
};
function stripIgnoredFields(result) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { level, time, pid, hostname, ...rest } = result;
    return rest;
}
const _pinoIntegration = core.defineIntegration((userOptions = {})=>{
    const options = {
        autoInstrument: userOptions.autoInstrument !== false,
        error: {
            ...DEFAULT_OPTIONS.error,
            ...userOptions.error
        },
        log: {
            ...DEFAULT_OPTIONS.log,
            ...userOptions.log
        }
    };
    function shouldTrackLogger(logger) {
        const override = logger[SENTRY_TRACK_SYMBOL];
        return override === 'track' || override !== 'ignore' && options.autoInstrument;
    }
    return {
        name: 'Pino',
        setup: (client)=>{
            const enableLogs = !!client.getOptions().enableLogs;
            const integratedChannel = diagnosticsChannel.tracingChannel('pino_asJson');
            function onPinoStart(self, args, result) {
                if (!shouldTrackLogger(self)) {
                    return;
                }
                const resultObj = stripIgnoredFields(result);
                const [captureObj, message, levelNumber] = args;
                const level = self?.levels?.labels?.[levelNumber] || 'info';
                const messageKey = getPinoKey(self, 'pino.messageKey', 'msg');
                const logMessage = message || resultObj?.[messageKey] || '';
                if (enableLogs && options.log.levels.includes(level)) {
                    const attributes = {
                        ...resultObj,
                        'sentry.origin': 'auto.log.pino',
                        'pino.logger.level': levelNumber
                    };
                    core._INTERNAL_captureLog({
                        level,
                        message: logMessage,
                        attributes
                    });
                }
                if (options.error.levels.includes(level)) {
                    const captureContext = {
                        level: core.severityLevelFromString(level)
                    };
                    core.withScope((scope)=>{
                        scope.addEventProcessor((event)=>{
                            event.logger = 'pino';
                            core.addExceptionMechanism(event, {
                                handled: options.error.handled,
                                type: 'auto.log.pino'
                            });
                            return event;
                        });
                        const error = captureObj[getPinoKey(self, 'pino.errorKey', 'err')];
                        if (error) {
                            core.captureException(error, captureContext);
                            return;
                        }
                        core.captureMessage(logMessage, captureContext);
                    });
                }
            }
            integratedChannel.end.subscribe((data)=>{
                const { instance, arguments: args, result } = data;
                onPinoStart(instance, args, JSON.parse(result));
            });
        }
    };
});
/**
 * Integration for Pino logging library.
 * Captures Pino logs as Sentry logs and optionally captures some log levels as events.
 *
 * By default, all Pino loggers will be captured. To ignore a specific logger, use `pinoIntegration.untrackLogger(logger)`.
 *
 * If you disable automatic instrumentation with `autoInstrument: false`, you can mark specific loggers to be tracked with `pinoIntegration.trackLogger(logger)`.
 *
 * Requires Pino >=v8.0.0 and Node >=20.6.0 or >=18.19.0
 */ const pinoIntegration = Object.assign(_pinoIntegration, {
    trackLogger (logger) {
        if (logger && typeof logger === 'object' && 'levels' in logger) {
            logger[SENTRY_TRACK_SYMBOL] = 'track';
        }
    },
    untrackLogger (logger) {
        if (logger && typeof logger === 'object' && 'levels' in logger) {
            logger[SENTRY_TRACK_SYMBOL] = 'ignore';
        }
    }
});
exports.pinoIntegration = pinoIntegration; //# sourceMappingURL=pino.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/addOriginToSpan.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
/** Adds an origin to an OTEL Span. */ function addOriginToSpan(span, origin) {
    span.setAttribute(core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN, origin);
}
exports.addOriginToSpan = addOriginToSpan; //# sourceMappingURL=addOriginToSpan.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/cron/common.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const replacements = [
    [
        'january',
        '1'
    ],
    [
        'february',
        '2'
    ],
    [
        'march',
        '3'
    ],
    [
        'april',
        '4'
    ],
    [
        'may',
        '5'
    ],
    [
        'june',
        '6'
    ],
    [
        'july',
        '7'
    ],
    [
        'august',
        '8'
    ],
    [
        'september',
        '9'
    ],
    [
        'october',
        '10'
    ],
    [
        'november',
        '11'
    ],
    [
        'december',
        '12'
    ],
    [
        'jan',
        '1'
    ],
    [
        'feb',
        '2'
    ],
    [
        'mar',
        '3'
    ],
    [
        'apr',
        '4'
    ],
    [
        'may',
        '5'
    ],
    [
        'jun',
        '6'
    ],
    [
        'jul',
        '7'
    ],
    [
        'aug',
        '8'
    ],
    [
        'sep',
        '9'
    ],
    [
        'oct',
        '10'
    ],
    [
        'nov',
        '11'
    ],
    [
        'dec',
        '12'
    ],
    [
        'sunday',
        '0'
    ],
    [
        'monday',
        '1'
    ],
    [
        'tuesday',
        '2'
    ],
    [
        'wednesday',
        '3'
    ],
    [
        'thursday',
        '4'
    ],
    [
        'friday',
        '5'
    ],
    [
        'saturday',
        '6'
    ],
    [
        'sun',
        '0'
    ],
    [
        'mon',
        '1'
    ],
    [
        'tue',
        '2'
    ],
    [
        'wed',
        '3'
    ],
    [
        'thu',
        '4'
    ],
    [
        'fri',
        '5'
    ],
    [
        'sat',
        '6'
    ]
];
/**
 * Replaces names in cron expressions
 */ function replaceCronNames(cronExpression) {
    return replacements.reduce(// eslint-disable-next-line @sentry-internal/sdk/no-regexp-constructor
    (acc, [name, replacement])=>acc.replace(new RegExp(name, 'gi'), replacement), cronExpression);
}
exports.replaceCronNames = replaceCronNames; //# sourceMappingURL=common.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/cron/cron.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const common = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/cron/common.js [instrumentation] (ecmascript)");
const ERROR_TEXT = 'Automatic instrumentation of CronJob only supports crontab string';
/**
 * Instruments the `cron` library to send a check-in event to Sentry for each job execution.
 *
 * ```ts
 * import * as Sentry from '@sentry/node';
 * import { CronJob } from 'cron';
 *
 * const CronJobWithCheckIn = Sentry.cron.instrumentCron(CronJob, 'my-cron-job');
 *
 * // use the constructor
 * const job = new CronJobWithCheckIn('* * * * *', () => {
 *  console.log('You will see this message every minute');
 * });
 *
 * // or from
 * const job = CronJobWithCheckIn.from({ cronTime: '* * * * *', onTick: () => {
 *   console.log('You will see this message every minute');
 * });
 * ```
 */ function instrumentCron(lib, monitorSlug) {
    let jobScheduled = false;
    return new Proxy(lib, {
        construct (target, args) {
            const [cronTime, onTick, onComplete, start, timeZone, ...rest] = args;
            if (typeof cronTime !== 'string') {
                throw new Error(ERROR_TEXT);
            }
            if (jobScheduled) {
                throw new Error(`A job named '${monitorSlug}' has already been scheduled`);
            }
            jobScheduled = true;
            const cronString = common.replaceCronNames(cronTime);
            async function monitoredTick(context, onComplete) {
                return core.withMonitor(monitorSlug, async ()=>{
                    try {
                        await onTick(context, onComplete);
                    } catch (e) {
                        core.captureException(e, {
                            mechanism: {
                                handled: false,
                                type: 'auto.function.cron.instrumentCron'
                            }
                        });
                        throw e;
                    }
                }, {
                    schedule: {
                        type: 'crontab',
                        value: cronString
                    },
                    timezone: timeZone || undefined
                });
            }
            return new target(cronTime, monitoredTick, onComplete, start, timeZone, ...rest);
        },
        get (target, prop) {
            if (prop === 'from') {
                return (param)=>{
                    const { cronTime, onTick, timeZone } = param;
                    if (typeof cronTime !== 'string') {
                        throw new Error(ERROR_TEXT);
                    }
                    if (jobScheduled) {
                        throw new Error(`A job named '${monitorSlug}' has already been scheduled`);
                    }
                    jobScheduled = true;
                    const cronString = common.replaceCronNames(cronTime);
                    param.onTick = async (context, onComplete)=>{
                        return core.withMonitor(monitorSlug, async ()=>{
                            try {
                                await onTick(context, onComplete);
                            } catch (e) {
                                core.captureException(e, {
                                    mechanism: {
                                        handled: false,
                                        type: 'auto.function.cron.instrumentCron'
                                    }
                                });
                                throw e;
                            }
                        }, {
                            schedule: {
                                type: 'crontab',
                                value: cronString
                            },
                            timezone: timeZone || undefined
                        });
                    };
                    return target.from(param);
                };
            } else {
                return target[prop];
            }
        }
    });
}
exports.instrumentCron = instrumentCron; //# sourceMappingURL=cron.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/cron/node-cron.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const common = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/cron/common.js [instrumentation] (ecmascript)");
/**
 * Wraps the `node-cron` library with check-in monitoring.
 *
 * ```ts
 * import * as Sentry from "@sentry/node";
 * import * as cron from "node-cron";
 *
 * const cronWithCheckIn = Sentry.cron.instrumentNodeCron(cron);
 *
 * cronWithCheckIn.schedule(
 *   "* * * * *",
 *   () => {
 *     console.log("running a task every minute");
 *   },
 *   { name: "my-cron-job" },
 * );
 * ```
 */ function instrumentNodeCron(lib, monitorConfig = {}) {
    return new Proxy(lib, {
        get (target, prop) {
            if (prop === 'schedule' && target.schedule) {
                // When 'get' is called for schedule, return a proxied version of the schedule function
                return new Proxy(target.schedule, {
                    apply (target, thisArg, argArray) {
                        const [expression, callback, options] = argArray;
                        const name = options?.name;
                        const timezone = options?.timezone;
                        if (!name) {
                            throw new Error('Missing "name" for scheduled job. A name is required for Sentry check-in monitoring.');
                        }
                        const monitoredCallback = async (...args)=>{
                            return core.withMonitor(name, async ()=>{
                                // We have to manually catch here and capture the exception because node-cron swallows errors
                                // https://github.com/node-cron/node-cron/issues/399
                                try {
                                    return await callback(...args);
                                } catch (e) {
                                    core.captureException(e, {
                                        mechanism: {
                                            handled: false,
                                            type: 'auto.function.node-cron.instrumentNodeCron'
                                        }
                                    });
                                    throw e;
                                }
                            }, {
                                schedule: {
                                    type: 'crontab',
                                    value: common.replaceCronNames(expression)
                                },
                                timezone,
                                ...monitorConfig
                            });
                        };
                        return target.apply(thisArg, [
                            expression,
                            monitoredCallback,
                            options
                        ]);
                    }
                });
            } else {
                return target[prop];
            }
        }
    });
}
exports.instrumentNodeCron = instrumentNodeCron; //# sourceMappingURL=node-cron.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/cron/node-schedule.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const common = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/cron/common.js [instrumentation] (ecmascript)");
/**
 * Instruments the `node-schedule` library to send a check-in event to Sentry for each job execution.
 *
 * ```ts
 * import * as Sentry from '@sentry/node';
 * import * as schedule from 'node-schedule';
 *
 * const scheduleWithCheckIn = Sentry.cron.instrumentNodeSchedule(schedule);
 *
 * const job = scheduleWithCheckIn.scheduleJob('my-cron-job', '* * * * *', () => {
 *  console.log('You will see this message every minute');
 * });
 * ```
 */ function instrumentNodeSchedule(lib) {
    return new Proxy(lib, {
        get (target, prop) {
            if (prop === 'scheduleJob') {
                // eslint-disable-next-line @typescript-eslint/unbound-method
                return new Proxy(target.scheduleJob, {
                    apply (target, thisArg, argArray) {
                        const [nameOrExpression, expressionOrCallback, callback] = argArray;
                        if (typeof nameOrExpression !== 'string' || typeof expressionOrCallback !== 'string' || typeof callback !== 'function') {
                            throw new Error("Automatic instrumentation of 'node-schedule' requires the first parameter of 'scheduleJob' to be a job name string and the second parameter to be a crontab string");
                        }
                        const monitorSlug = nameOrExpression;
                        const expression = expressionOrCallback;
                        async function monitoredCallback() {
                            return core.withMonitor(monitorSlug, async ()=>{
                                await callback?.();
                            }, {
                                schedule: {
                                    type: 'crontab',
                                    value: common.replaceCronNames(expression)
                                }
                            });
                        }
                        return target.apply(thisArg, [
                            monitorSlug,
                            expression,
                            monitoredCallback
                        ]);
                    }
                });
            }
            return target[prop];
        }
    });
}
exports.instrumentNodeSchedule = instrumentNodeSchedule; //# sourceMappingURL=node-schedule.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/cron/index.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const cron$1 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/cron/cron.js [instrumentation] (ecmascript)");
const nodeCron = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/cron/node-cron.js [instrumentation] (ecmascript)");
const nodeSchedule = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/cron/node-schedule.js [instrumentation] (ecmascript)");
/** Methods to instrument cron libraries for Sentry check-ins */ const cron = {
    instrumentCron: cron$1.instrumentCron,
    instrumentNodeCron: nodeCron.instrumentNodeCron,
    instrumentNodeSchedule: nodeSchedule.instrumentNodeSchedule
};
exports.cron = cron; //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/index.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const index$3 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/index.js [instrumentation] (ecmascript)");
const httpServerSpansIntegration = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/httpServerSpansIntegration.js [instrumentation] (ecmascript)");
const httpServerIntegration = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/httpServerIntegration.js [instrumentation] (ecmascript)");
const SentryHttpInstrumentation = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/http/SentryHttpInstrumentation.js [instrumentation] (ecmascript)");
const index$5 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/node-fetch/index.js [instrumentation] (ecmascript)");
const SentryNodeFetchInstrumentation = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/node-fetch/SentryNodeFetchInstrumentation.js [instrumentation] (ecmascript)");
const contextManager = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/otel/contextManager.js [instrumentation] (ecmascript)");
const logger = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/otel/logger.js [instrumentation] (ecmascript)");
const instrument = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/otel/instrument.js [instrumentation] (ecmascript)");
const index$2 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/index.js [instrumentation] (ecmascript)");
const scope = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/scope.js [instrumentation] (ecmascript)");
const client = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/client.js [instrumentation] (ecmascript)");
const ensureIsWrapped = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/ensureIsWrapped.js [instrumentation] (ecmascript)");
const processSession = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/processSession.js [instrumentation] (ecmascript)");
const opentelemetry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/opentelemetry/build/cjs/index.js [instrumentation] (ecmascript)");
const index = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/anr/index.js [instrumentation] (ecmascript)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const _exports = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/logs/exports.js [instrumentation] (ecmascript)");
const context = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/context.js [instrumentation] (ecmascript)");
const contextlines = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/contextlines.js [instrumentation] (ecmascript)");
const index$4 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/local-variables/index.js [instrumentation] (ecmascript)");
const modules = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/modules.js [instrumentation] (ecmascript)");
const onuncaughtexception = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/onuncaughtexception.js [instrumentation] (ecmascript)");
const onunhandledrejection = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/onunhandledrejection.js [instrumentation] (ecmascript)");
const spotlight = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/spotlight.js [instrumentation] (ecmascript)");
const systemError = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/systemError.js [instrumentation] (ecmascript)");
const childProcess = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/childProcess.js [instrumentation] (ecmascript)");
const winston = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/winston.js [instrumentation] (ecmascript)");
const pino = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/integrations/pino.js [instrumentation] (ecmascript)");
const api = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/api.js [instrumentation] (ecmascript)");
const module$1 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/module.js [instrumentation] (ecmascript)");
const addOriginToSpan = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/addOriginToSpan.js [instrumentation] (ecmascript)");
const getRequestUrl = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/getRequestUrl.js [instrumentation] (ecmascript)");
const esmLoader = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/sdk/esmLoader.js [instrumentation] (ecmascript)");
const detection = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/detection.js [instrumentation] (ecmascript)");
const createMissingInstrumentationContext = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/utils/createMissingInstrumentationContext.js [instrumentation] (ecmascript)");
const http = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/transports/http.js [instrumentation] (ecmascript)");
const index$1 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/cron/index.js [instrumentation] (ecmascript)");
const nodeVersion = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node-core/build/cjs/nodeVersion.js [instrumentation] (ecmascript)");
exports.httpIntegration = index$3.httpIntegration;
exports.httpServerSpansIntegration = httpServerSpansIntegration.httpServerSpansIntegration;
exports.httpServerIntegration = httpServerIntegration.httpServerIntegration;
exports.SentryHttpInstrumentation = SentryHttpInstrumentation.SentryHttpInstrumentation;
exports.nativeNodeFetchIntegration = index$5.nativeNodeFetchIntegration;
exports.SentryNodeFetchInstrumentation = SentryNodeFetchInstrumentation.SentryNodeFetchInstrumentation;
exports.SentryContextManager = contextManager.SentryContextManager;
exports.setupOpenTelemetryLogger = logger.setupOpenTelemetryLogger;
exports.INSTRUMENTED = instrument.INSTRUMENTED;
exports.generateInstrumentOnce = instrument.generateInstrumentOnce;
exports.instrumentWhenWrapped = instrument.instrumentWhenWrapped;
exports.getDefaultIntegrations = index$2.getDefaultIntegrations;
exports.init = index$2.init;
exports.initWithoutDefaultIntegrations = index$2.initWithoutDefaultIntegrations;
exports.validateOpenTelemetrySetup = index$2.validateOpenTelemetrySetup;
exports.setIsolationScope = scope.setIsolationScope;
exports.NodeClient = client.NodeClient;
exports.ensureIsWrapped = ensureIsWrapped.ensureIsWrapped;
exports.processSessionIntegration = processSession.processSessionIntegration;
exports.setNodeAsyncContextStrategy = opentelemetry.setOpenTelemetryContextAsyncContextStrategy;
exports.anrIntegration = index.anrIntegration;
exports.disableAnrDetectionForCallback = index.disableAnrDetectionForCallback;
exports.SDK_VERSION = core.SDK_VERSION;
exports.SEMANTIC_ATTRIBUTE_SENTRY_OP = core.SEMANTIC_ATTRIBUTE_SENTRY_OP;
exports.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN = core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN;
exports.SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE = core.SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE;
exports.SEMANTIC_ATTRIBUTE_SENTRY_SOURCE = core.SEMANTIC_ATTRIBUTE_SENTRY_SOURCE;
exports.Scope = core.Scope;
exports.addBreadcrumb = core.addBreadcrumb;
exports.addEventProcessor = core.addEventProcessor;
exports.addIntegration = core.addIntegration;
exports.captureCheckIn = core.captureCheckIn;
exports.captureConsoleIntegration = core.captureConsoleIntegration;
exports.captureEvent = core.captureEvent;
exports.captureException = core.captureException;
exports.captureFeedback = core.captureFeedback;
exports.captureMessage = core.captureMessage;
exports.captureSession = core.captureSession;
exports.close = core.close;
exports.consoleIntegration = core.consoleIntegration;
exports.consoleLoggingIntegration = core.consoleLoggingIntegration;
exports.continueTrace = core.continueTrace;
exports.createConsolaReporter = core.createConsolaReporter;
exports.createTransport = core.createTransport;
exports.dedupeIntegration = core.dedupeIntegration;
exports.endSession = core.endSession;
exports.envToBool = core.envToBool;
exports.eventFiltersIntegration = core.eventFiltersIntegration;
exports.extraErrorDataIntegration = core.extraErrorDataIntegration;
exports.featureFlagsIntegration = core.featureFlagsIntegration;
exports.flush = core.flush;
exports.functionToStringIntegration = core.functionToStringIntegration;
exports.getActiveSpan = core.getActiveSpan;
exports.getClient = core.getClient;
exports.getCurrentScope = core.getCurrentScope;
exports.getGlobalScope = core.getGlobalScope;
exports.getIsolationScope = core.getIsolationScope;
exports.getRootSpan = core.getRootSpan;
exports.getSpanDescendants = core.getSpanDescendants;
exports.getSpanStatusFromHttpCode = core.getSpanStatusFromHttpCode;
exports.getTraceData = core.getTraceData;
exports.getTraceMetaTags = core.getTraceMetaTags;
exports.inboundFiltersIntegration = core.inboundFiltersIntegration;
exports.instrumentSupabaseClient = core.instrumentSupabaseClient;
exports.isEnabled = core.isEnabled;
exports.isInitialized = core.isInitialized;
exports.lastEventId = core.lastEventId;
exports.linkedErrorsIntegration = core.linkedErrorsIntegration;
exports.metrics = core.metrics;
exports.parameterize = core.parameterize;
exports.profiler = core.profiler;
exports.requestDataIntegration = core.requestDataIntegration;
exports.rewriteFramesIntegration = core.rewriteFramesIntegration;
exports.setContext = core.setContext;
exports.setCurrentClient = core.setCurrentClient;
exports.setExtra = core.setExtra;
exports.setExtras = core.setExtras;
exports.setHttpStatus = core.setHttpStatus;
exports.setMeasurement = core.setMeasurement;
exports.setTag = core.setTag;
exports.setTags = core.setTags;
exports.setUser = core.setUser;
exports.spanToBaggageHeader = core.spanToBaggageHeader;
exports.spanToJSON = core.spanToJSON;
exports.spanToTraceHeader = core.spanToTraceHeader;
exports.startInactiveSpan = core.startInactiveSpan;
exports.startNewTrace = core.startNewTrace;
exports.startSession = core.startSession;
exports.startSpan = core.startSpan;
exports.startSpanManual = core.startSpanManual;
exports.supabaseIntegration = core.supabaseIntegration;
exports.suppressTracing = core.suppressTracing;
exports.trpcMiddleware = core.trpcMiddleware;
exports.updateSpanName = core.updateSpanName;
exports.withActiveSpan = core.withActiveSpan;
exports.withIsolationScope = core.withIsolationScope;
exports.withMonitor = core.withMonitor;
exports.withScope = core.withScope;
exports.wrapMcpServerWithSentry = core.wrapMcpServerWithSentry;
exports.zodErrorsIntegration = core.zodErrorsIntegration;
exports.logger = _exports;
exports.nodeContextIntegration = context.nodeContextIntegration;
exports.contextLinesIntegration = contextlines.contextLinesIntegration;
exports.localVariablesIntegration = index$4.localVariablesIntegration;
exports.modulesIntegration = modules.modulesIntegration;
exports.onUncaughtExceptionIntegration = onuncaughtexception.onUncaughtExceptionIntegration;
exports.onUnhandledRejectionIntegration = onunhandledrejection.onUnhandledRejectionIntegration;
exports.spotlightIntegration = spotlight.spotlightIntegration;
exports.systemErrorIntegration = systemError.systemErrorIntegration;
exports.childProcessIntegration = childProcess.childProcessIntegration;
exports.createSentryWinstonTransport = winston.createSentryWinstonTransport;
exports.pinoIntegration = pino.pinoIntegration;
exports.defaultStackParser = api.defaultStackParser;
exports.getSentryRelease = api.getSentryRelease;
exports.createGetModuleFromFilename = module$1.createGetModuleFromFilename;
exports.addOriginToSpan = addOriginToSpan.addOriginToSpan;
exports.getRequestUrl = getRequestUrl.getRequestUrl;
exports.initializeEsmLoader = esmLoader.initializeEsmLoader;
exports.isCjs = detection.isCjs;
exports.createMissingInstrumentationContext = createMissingInstrumentationContext.createMissingInstrumentationContext;
exports.makeNodeTransport = http.makeNodeTransport;
exports.cron = index$1.cron;
exports.NODE_VERSION = nodeVersion.NODE_VERSION; //# sourceMappingURL=index.js.map
}),
];

//# debugId=1e9a6c8e-6f4a-b4e1-fdb3-f41d7a82f136
//# sourceMappingURL=06187_%40sentry_node-core_build_cjs_7711abf7._.js.map