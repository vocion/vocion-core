;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="a6d70b7e-81fe-c511-7829-736afeaf61cc")}catch(e){}}();
module.exports = [
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/util.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const fs = __turbopack_context__.r("[externals]/fs [external] (fs, cjs)");
const module$1 = __turbopack_context__.r("[externals]/module [external] (module, cjs)");
const path = __turbopack_context__.r("[externals]/path [external] (path, cjs)");
/**
 * Returns the version of Next.js installed in the project, or undefined if it cannot be determined.
 */ function getNextjsVersion() {
    const nextjsPackageJsonPath = resolveNextjsPackageJson();
    if (nextjsPackageJsonPath) {
        try {
            const nextjsPackageJson = JSON.parse(fs.readFileSync(nextjsPackageJsonPath, {
                encoding: 'utf-8'
            }));
            return nextjsPackageJson.version;
        } catch  {
        // noop
        }
    }
    return undefined;
}
function resolveNextjsPackageJson() {
    try {
        return module$1.createRequire(`${process.cwd()}/`).resolve('next/package.json');
    } catch  {
        return undefined;
    }
}
/**
 * Checks if the current Next.js version supports the runAfterProductionCompile hook.
 * This hook was introduced in Next.js 15.4.1. (https://github.com/vercel/next.js/pull/77345)
 *
 * @param version - version string to check.
 * @returns true if Next.js version is 15.4.1 or higher
 */ function supportsProductionCompileHook(version) {
    const versionToCheck = version;
    if (!versionToCheck) {
        return false;
    }
    const { major, minor, patch } = core.parseSemver(versionToCheck);
    if (major === undefined || minor === undefined || patch === undefined) {
        return false;
    }
    if (major > 15) {
        return true;
    }
    // For major version 15, check if it's 15.4.1 or higher
    if (major === 15) {
        if (minor > 4) {
            return true;
        }
        if (minor === 4 && patch >= 1) {
            return true;
        }
        return false;
    }
    return false;
}
/**
 * Checks if the current Next.js version supports the `condition` field in Turbopack rules.
 * This field was introduced in Next.js 16.
 *
 * @param version - version string to check.
 * @returns true if Next.js version is 16 or higher
 */ function supportsTurbopackRuleCondition(version) {
    if (!version) {
        return false;
    }
    const { major } = core.parseSemver(version);
    if (major === undefined) {
        return false;
    }
    return major >= 16;
}
/**
 * Checks if the current Next.js version supports native debug ids for turbopack.
 * This feature was first introduced in Next.js v15.6.0-canary.36 and marked stable in Next.js v16
 *
 * @param version - version string to check.
 * @returns true if Next.js version supports native debug ids for turbopack builds
 */ function supportsNativeDebugIds(version) {
    if (!version) {
        return false;
    }
    const { major, minor, prerelease } = core.parseSemver(version);
    if (major === undefined || minor === undefined) {
        return false;
    }
    // Next.js 16+ supports native debug ids
    if (major >= 16) {
        return true;
    }
    // For Next.js 15, check if it's 15.6.0-canary.36+
    if (major === 15 && prerelease?.startsWith('canary.')) {
        // Any canary version 15.7+ supports native debug ids
        if (minor > 6) {
            return true;
        }
        // For 15.6 canary versions, check if it's canary.36 or higher
        if (minor === 6) {
            const canaryNumber = parseInt(prerelease.split('.')[1] || '0', 10);
            if (canaryNumber >= 36) {
                return true;
            }
        }
    }
    return false;
}
/**
 * Checks if the given Next.js version requires the `experimental.instrumentationHook` option.
 * Next.js 15.0.0 and higher (including certain RC and canary versions) no longer require this option
 * and will print a warning if it is set.
 *
 * @param version - version string to check.
 * @returns true if the version requires the instrumentationHook option to be set
 */ function requiresInstrumentationHook(version) {
    if (!version) {
        return true; // Default to requiring it if version cannot be determined
    }
    const { major, minor, patch, prerelease } = core.parseSemver(version);
    if (major === undefined || minor === undefined || patch === undefined) {
        return true; // Default to requiring it if parsing fails
    }
    // Next.js 16+ never requires the hook
    if (major >= 16) {
        return false;
    }
    // Next.js 14 and below always require the hook
    if (major < 15) {
        return true;
    }
    // At this point, we know it's Next.js 15.x.y
    // Stable releases (15.0.0+) don't require the hook
    if (!prerelease) {
        return false;
    }
    // Next.js 15.x.y with x > 0 or y > 0 don't require the hook
    if (minor > 0 || patch > 0) {
        return false;
    }
    // Check specific prerelease versions that don't require the hook
    if (prerelease.startsWith('rc.')) {
        const rcNumber = parseInt(prerelease.split('.')[1] || '0', 10);
        return rcNumber === 0; // Only rc.0 requires the hook
    }
    if (prerelease.startsWith('canary.')) {
        const canaryNumber = parseInt(prerelease.split('.')[1] || '0', 10);
        return canaryNumber < 124; // canary.124+ doesn't require the hook
    }
    // All other 15.0.0 prerelease versions (alpha, beta, etc.) require the hook
    return true;
}
/**
 * Determines which bundler is actually being used based on environment variables,
 * and CLI flags.
 *
 * @returns 'turbopack' or 'webpack'
 */ function detectActiveBundler() {
    const turbopackEnv = ("TURBOPACK compile-time value", true);
    // Check if TURBOPACK env var is set to a truthy value (excluding falsy strings like 'false', '0', '')
    const isTurbopackEnabled = turbopackEnv && turbopackEnv !== 'false' && turbopackEnv !== '0';
    if (isTurbopackEnabled || process.argv.includes('--turbo')) {
        return 'turbopack';
    } else //TURBOPACK unreachable
    ;
}
/**
 * Extract modules from project directory's package.json
 */ function getPackageModules(projectDir) {
    try {
        const packageJson = path.join(projectDir, 'package.json');
        const packageJsonContent = fs.readFileSync(packageJson, 'utf8');
        const packageJsonObject = JSON.parse(packageJsonContent);
        return {
            ...packageJsonObject.dependencies,
            ...packageJsonObject.devDependencies
        };
    } catch  {
        return {};
    }
}
exports.detectActiveBundler = detectActiveBundler;
exports.getNextjsVersion = getNextjsVersion;
exports.getPackageModules = getPackageModules;
exports.requiresInstrumentationHook = requiresInstrumentationHook;
exports.supportsNativeDebugIds = supportsNativeDebugIds;
exports.supportsProductionCompileHook = supportsProductionCompileHook;
exports.supportsTurbopackRuleCondition = supportsTurbopackRuleCondition; //# sourceMappingURL=util.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/buildTime.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const childProcess = __turbopack_context__.r("[externals]/child_process [external] (child_process, cjs)");
const fs = __turbopack_context__.r("[externals]/fs [external] (fs, cjs)");
const path = __turbopack_context__.r("[externals]/path [external] (path, cjs)");
/**
 * Adds Sentry-related build-time variables to `nextConfig.env`.
 *
 * Note: this mutates `userNextConfig`.
 *
 * @param userNextConfig - The user's Next.js config object
 * @param userSentryOptions - The Sentry build options passed to `withSentryConfig`
 * @param releaseName - The resolved release name, if any
 */ function setUpBuildTimeVariables(userNextConfig, userSentryOptions, releaseName) {
    const assetPrefix = userNextConfig.assetPrefix || userNextConfig.basePath || '';
    const basePath = userNextConfig.basePath ?? '';
    const rewritesTunnelPath = userSentryOptions.tunnelRoute !== undefined && userNextConfig.output !== 'export' && typeof userSentryOptions.tunnelRoute === 'string' ? `${basePath}${userSentryOptions.tunnelRoute}` : undefined;
    const buildTimeVariables = {
        // Make sure that if we have a windows path, the backslashes are interpreted as such (rather than as escape
        // characters)
        _sentryRewriteFramesDistDir: userNextConfig.distDir?.replace(/\\/g, '\\\\') || '.next',
        // Get the path part of `assetPrefix`, minus any trailing slash. (We use a placeholder for the origin if
        // `assetPrefix` doesn't include one. Since we only care about the path, it doesn't matter what it is.)
        _sentryRewriteFramesAssetPrefixPath: assetPrefix ? new URL(assetPrefix, 'http://dogs.are.great').pathname.replace(/\/$/, '') : ''
    };
    if (userNextConfig.assetPrefix) {
        buildTimeVariables._assetsPrefix = userNextConfig.assetPrefix;
    }
    if (userSentryOptions._experimental?.thirdPartyOriginStackFrames) {
        buildTimeVariables._experimentalThirdPartyOriginStackFrames = 'true';
    }
    if (rewritesTunnelPath) {
        buildTimeVariables._sentryRewritesTunnelPath = rewritesTunnelPath;
    }
    if (basePath) {
        buildTimeVariables._sentryBasePath = basePath;
    }
    if (userNextConfig.assetPrefix) {
        buildTimeVariables._sentryAssetPrefix = userNextConfig.assetPrefix;
    }
    if (userSentryOptions._experimental?.thirdPartyOriginStackFrames) {
        buildTimeVariables._experimentalThirdPartyOriginStackFrames = 'true';
    }
    if (releaseName) {
        buildTimeVariables._sentryRelease = releaseName;
    }
    if (typeof userNextConfig.env === 'object') {
        userNextConfig.env = {
            ...buildTimeVariables,
            ...userNextConfig.env
        };
    } else if (userNextConfig.env === undefined) {
        userNextConfig.env = buildTimeVariables;
    }
}
/**
 * Returns the current git SHA (HEAD), if available.
 *
 * This is a best-effort helper and returns `undefined` if git isn't available or the cwd isn't a git repo.
 */ function getGitRevision() {
    let gitRevision;
    try {
        gitRevision = childProcess.execSync('git rev-parse HEAD', {
            stdio: [
                'ignore',
                'pipe',
                'ignore'
            ]
        }).toString().trim();
    } catch  {
    // noop
    }
    return gitRevision;
}
/**
 * Reads the project's `instrumentation-client.(js|ts)` file contents, if present.
 *
 * @returns The file contents, or `undefined` if the file can't be found/read
 */ function getInstrumentationClientFileContents() {
    const potentialInstrumentationClientFileLocations = [
        [
            'src',
            'instrumentation-client.ts'
        ],
        [
            'src',
            'instrumentation-client.js'
        ],
        [
            'instrumentation-client.ts'
        ],
        [
            'instrumentation-client.js'
        ]
    ];
    for (const pathSegments of potentialInstrumentationClientFileLocations){
        try {
            return fs.readFileSync(path.join(process.cwd(), ...pathSegments), 'utf-8');
        } catch  {
        // noop
        }
    }
}
exports.getGitRevision = getGitRevision;
exports.getInstrumentationClientFileContents = getInstrumentationClientFileContents;
exports.setUpBuildTimeVariables = setUpBuildTimeVariables; //# sourceMappingURL=buildTime.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/deprecatedWebpackOptions.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const util = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/util.js [instrumentation] (ecmascript)");
/**
 * Migrates deprecated top-level webpack options to the new `webpack.*` path for backward compatibility.
 * The new path takes precedence over deprecated options. This mutates the userSentryOptions object.
 */ function migrateDeprecatedWebpackOptions(userSentryOptions) {
    // Initialize webpack options if not present
    userSentryOptions.webpack = userSentryOptions.webpack || {};
    const webpack = userSentryOptions.webpack;
    const withDeprecatedFallback = (newValue, deprecatedValue, message)=>{
        if (deprecatedValue !== undefined) {
            // eslint-disable-next-line no-console
            console.warn(message);
        }
        return newValue ?? deprecatedValue;
    };
    const deprecatedMessage = (deprecatedPath, newPath)=>{
        const message = `[@sentry/nextjs] DEPRECATION WARNING: ${deprecatedPath} is deprecated and will be removed in a future version. Use ${newPath} instead.`;
        // In Turbopack builds, webpack configuration is not applied, so webpack-scoped options won't have any effect.
        if (util.detectActiveBundler() === 'turbopack' && newPath.startsWith('webpack.')) {
            return `${message} (Not supported with Turbopack.)`;
        }
        return message;
    };
    /* eslint-disable deprecation/deprecation */ // Migrate each deprecated option to the new path, but only if the new path isn't already set
    webpack.autoInstrumentServerFunctions = withDeprecatedFallback(webpack.autoInstrumentServerFunctions, userSentryOptions.autoInstrumentServerFunctions, deprecatedMessage('autoInstrumentServerFunctions', 'webpack.autoInstrumentServerFunctions'));
    webpack.autoInstrumentMiddleware = withDeprecatedFallback(webpack.autoInstrumentMiddleware, userSentryOptions.autoInstrumentMiddleware, deprecatedMessage('autoInstrumentMiddleware', 'webpack.autoInstrumentMiddleware'));
    webpack.autoInstrumentAppDirectory = withDeprecatedFallback(webpack.autoInstrumentAppDirectory, userSentryOptions.autoInstrumentAppDirectory, deprecatedMessage('autoInstrumentAppDirectory', 'webpack.autoInstrumentAppDirectory'));
    webpack.excludeServerRoutes = withDeprecatedFallback(webpack.excludeServerRoutes, userSentryOptions.excludeServerRoutes, deprecatedMessage('excludeServerRoutes', 'webpack.excludeServerRoutes'));
    webpack.unstable_sentryWebpackPluginOptions = withDeprecatedFallback(webpack.unstable_sentryWebpackPluginOptions, userSentryOptions.unstable_sentryWebpackPluginOptions, deprecatedMessage('unstable_sentryWebpackPluginOptions', 'webpack.unstable_sentryWebpackPluginOptions'));
    webpack.disableSentryConfig = withDeprecatedFallback(webpack.disableSentryConfig, userSentryOptions.disableSentryWebpackConfig, deprecatedMessage('disableSentryWebpackConfig', 'webpack.disableSentryConfig'));
    // Handle treeshake.removeDebugLogging specially since it's nested
    if (userSentryOptions.disableLogger !== undefined) {
        webpack.treeshake = webpack.treeshake || {};
        webpack.treeshake.removeDebugLogging = withDeprecatedFallback(webpack.treeshake.removeDebugLogging, userSentryOptions.disableLogger, deprecatedMessage('disableLogger', 'webpack.treeshake.removeDebugLogging'));
    }
    webpack.automaticVercelMonitors = withDeprecatedFallback(webpack.automaticVercelMonitors, userSentryOptions.automaticVercelMonitors, deprecatedMessage('automaticVercelMonitors', 'webpack.automaticVercelMonitors'));
    webpack.reactComponentAnnotation = withDeprecatedFallback(webpack.reactComponentAnnotation, userSentryOptions.reactComponentAnnotation, deprecatedMessage('reactComponentAnnotation', 'webpack.reactComponentAnnotation'));
}
exports.migrateDeprecatedWebpackOptions = migrateDeprecatedWebpackOptions; //# sourceMappingURL=deprecatedWebpackOptions.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/getBuildPluginOptions.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const path = __turbopack_context__.r("[externals]/path [external] (path, cjs)");
const LOGGER_PREFIXES = {
    'webpack-nodejs': '[@sentry/nextjs - Node.js]',
    'webpack-edge': '[@sentry/nextjs - Edge]',
    'webpack-client': '[@sentry/nextjs - Client]',
    'after-production-compile-webpack': '[@sentry/nextjs - After Production Compile (Webpack)]',
    'after-production-compile-turbopack': '[@sentry/nextjs - After Production Compile (Turbopack)]'
};
// File patterns for source map operations
// We use both glob patterns and directory paths for the sourcemap upload and deletion
// -> Direct CLI invocation handles file paths better than glob patterns
// -> Webpack/Bundler needs glob patterns as this is the format that is used by the plugin
const FILE_PATTERNS = {
    SERVER: {
        GLOB: 'server/**',
        PATH: 'server'
    },
    SERVERLESS: 'serverless/**',
    STATIC_CHUNKS: {
        GLOB: 'static/chunks/**',
        PATH: 'static/chunks'
    },
    STATIC_CHUNKS_PAGES: {
        GLOB: 'static/chunks/pages/**',
        PATH: 'static/chunks/pages'
    },
    STATIC_CHUNKS_APP: {
        GLOB: 'static/chunks/app/**',
        PATH: 'static/chunks/app'
    },
    MAIN_CHUNKS: 'static/chunks/main-*',
    FRAMEWORK_CHUNKS: 'static/chunks/framework-*',
    FRAMEWORK_CHUNKS_DOT: 'static/chunks/framework.*',
    POLYFILLS_CHUNKS: 'static/chunks/polyfills-*',
    WEBPACK_CHUNKS: 'static/chunks/webpack-*',
    PAGE_CLIENT_REFERENCE_MANIFEST: '**/page_client-reference-manifest.js',
    SERVER_REFERENCE_MANIFEST: '**/server-reference-manifest.js',
    NEXT_FONT_MANIFEST: '**/next-font-manifest.js',
    MIDDLEWARE_BUILD_MANIFEST: '**/middleware-build-manifest.js',
    INTERCEPTION_ROUTE_REWRITE_MANIFEST: '**/interception-route-rewrite-manifest.js',
    ROUTE_CLIENT_REFERENCE_MANIFEST: '**/route_client-reference-manifest.js',
    MIDDLEWARE_REACT_LOADABLE_MANIFEST: '**/middleware-react-loadable-manifest.js'
};
// Source map file extensions to delete
const SOURCEMAP_EXTENSIONS = [
    '*.js.map',
    '*.mjs.map',
    '*.cjs.map',
    '*.css.map'
];
/**
 * Normalizes Windows paths to POSIX format for glob patterns
 */ function normalizePathForGlob(distPath) {
    return distPath.replace(/\\/g, '/');
}
/**
 * These functions are used to get the correct pattern for the sourcemap upload based on the build tool and the usage context
 * -> Direct CLI invocation handles file paths better than glob patterns
 */ function getServerPattern({ useDirectoryPath = false }) {
    return useDirectoryPath ? FILE_PATTERNS.SERVER.PATH : FILE_PATTERNS.SERVER.GLOB;
}
function getStaticChunksPattern({ useDirectoryPath = false }) {
    return useDirectoryPath ? FILE_PATTERNS.STATIC_CHUNKS.PATH : FILE_PATTERNS.STATIC_CHUNKS.GLOB;
}
function getStaticChunksPagesPattern({ useDirectoryPath = false }) {
    return useDirectoryPath ? FILE_PATTERNS.STATIC_CHUNKS_PAGES.PATH : FILE_PATTERNS.STATIC_CHUNKS_PAGES.GLOB;
}
function getStaticChunksAppPattern({ useDirectoryPath = false }) {
    return useDirectoryPath ? FILE_PATTERNS.STATIC_CHUNKS_APP.PATH : FILE_PATTERNS.STATIC_CHUNKS_APP.GLOB;
}
/**
 * Creates file patterns for source map uploads based on build tool and options
 */ function createSourcemapUploadAssetPatterns(normalizedDistPath, buildTool, widenClientFileUpload = false) {
    const assets = [];
    if (buildTool.startsWith('after-production-compile')) {
        assets.push(path.posix.join(normalizedDistPath, getServerPattern({
            useDirectoryPath: true
        })));
        if (buildTool === 'after-production-compile-turbopack') {
            // In turbopack we always want to upload the full static chunks directory
            // as the build output is not split into pages|app chunks
            assets.push(path.posix.join(normalizedDistPath, getStaticChunksPattern({
                useDirectoryPath: true
            })));
        } else {
            // Webpack client builds in after-production-compile mode
            if (widenClientFileUpload) {
                assets.push(path.posix.join(normalizedDistPath, getStaticChunksPattern({
                    useDirectoryPath: true
                })));
            } else {
                assets.push(path.posix.join(normalizedDistPath, getStaticChunksPagesPattern({
                    useDirectoryPath: true
                })), path.posix.join(normalizedDistPath, getStaticChunksAppPattern({
                    useDirectoryPath: true
                })));
            }
        }
    } else {
        if (buildTool === 'webpack-nodejs' || buildTool === 'webpack-edge') {
            // Server builds
            assets.push(path.posix.join(normalizedDistPath, getServerPattern({
                useDirectoryPath: false
            })), path.posix.join(normalizedDistPath, FILE_PATTERNS.SERVERLESS));
        } else if (buildTool === 'webpack-client') {
            // Client builds
            if (widenClientFileUpload) {
                assets.push(path.posix.join(normalizedDistPath, getStaticChunksPattern({
                    useDirectoryPath: false
                })));
            } else {
                assets.push(path.posix.join(normalizedDistPath, getStaticChunksPagesPattern({
                    useDirectoryPath: false
                })), path.posix.join(normalizedDistPath, getStaticChunksAppPattern({
                    useDirectoryPath: false
                })));
            }
        }
    }
    return assets;
}
/**
 * Creates ignore patterns for source map uploads
 */ function createSourcemapUploadIgnorePattern(normalizedDistPath, widenClientFileUpload = false) {
    const ignore = [];
    // We only add main-* files if the user has not opted into it
    if (!widenClientFileUpload) {
        ignore.push(path.posix.join(normalizedDistPath, FILE_PATTERNS.MAIN_CHUNKS));
    }
    // Always ignore these patterns
    ignore.push(path.posix.join(normalizedDistPath, FILE_PATTERNS.FRAMEWORK_CHUNKS), path.posix.join(normalizedDistPath, FILE_PATTERNS.FRAMEWORK_CHUNKS_DOT), path.posix.join(normalizedDistPath, FILE_PATTERNS.POLYFILLS_CHUNKS), path.posix.join(normalizedDistPath, FILE_PATTERNS.WEBPACK_CHUNKS), // Next.js internal manifest files that don't have source maps
    // These files are auto-generated by Next.js and do not contain user code.
    // Ignoring them prevents "Could not determine source map reference" warnings.
    FILE_PATTERNS.PAGE_CLIENT_REFERENCE_MANIFEST, FILE_PATTERNS.SERVER_REFERENCE_MANIFEST, FILE_PATTERNS.NEXT_FONT_MANIFEST, FILE_PATTERNS.MIDDLEWARE_BUILD_MANIFEST, FILE_PATTERNS.INTERCEPTION_ROUTE_REWRITE_MANIFEST, FILE_PATTERNS.ROUTE_CLIENT_REFERENCE_MANIFEST, FILE_PATTERNS.MIDDLEWARE_REACT_LOADABLE_MANIFEST);
    return ignore;
}
/**
 * Creates file patterns for deletion after source map upload
 */ function createFilesToDeleteAfterUploadPattern(normalizedDistPath, buildTool, deleteSourcemapsAfterUpload, useRunAfterProductionCompileHook = false) {
    if (!deleteSourcemapsAfterUpload) {
        return undefined;
    }
    // We don't want to delete source maps for server builds as this led to errors on Vercel in the past
    // See: https://github.com/getsentry/sentry-javascript/issues/13099
    if (buildTool === 'webpack-nodejs' || buildTool === 'webpack-edge') {
        return undefined;
    }
    // Skip deletion for webpack client builds when using the experimental hook
    if (buildTool === 'webpack-client' && useRunAfterProductionCompileHook) {
        return undefined;
    }
    return SOURCEMAP_EXTENSIONS.map((ext)=>path.posix.join(normalizedDistPath, 'static', '**', ext));
}
/**
 * Determines if sourcemap uploads should be skipped
 */ function shouldSkipSourcemapUpload(buildTool, useRunAfterProductionCompileHook = false) {
    return useRunAfterProductionCompileHook && buildTool.startsWith('webpack');
}
/**
 * Source rewriting function for webpack sources
 */ function rewriteWebpackSources(source) {
    return source.replace(/^webpack:\/\/(?:_N_E\/)?/, '');
}
/**
 * Creates release configuration
 */ function createReleaseConfig(releaseName, sentryBuildOptions) {
    if (releaseName !== undefined) {
        return {
            inject: false,
            name: releaseName,
            create: sentryBuildOptions.release?.create,
            finalize: sentryBuildOptions.release?.finalize,
            dist: sentryBuildOptions.release?.dist,
            vcsRemote: sentryBuildOptions.release?.vcsRemote,
            setCommits: sentryBuildOptions.release?.setCommits,
            deploy: sentryBuildOptions.release?.deploy,
            ...sentryBuildOptions.webpack?.unstable_sentryWebpackPluginOptions?.release
        };
    }
    return {
        inject: false,
        create: false,
        finalize: false
    };
}
/**
 * Merges default ignore patterns with user-provided ignore patterns.
 * User patterns are appended to the defaults to ensure internal Next.js
 * files are always ignored while allowing users to add additional patterns.
 */ function mergeIgnorePatterns(defaultPatterns, userPatterns) {
    if (!userPatterns) {
        return defaultPatterns;
    }
    const userPatternsArray = Array.isArray(userPatterns) ? userPatterns : [
        userPatterns
    ];
    return [
        ...defaultPatterns,
        ...userPatternsArray
    ];
}
/**
 * Get Sentry Build Plugin options for both webpack and turbopack builds.
 * These options can be used in two ways:
 * 1. The options can be built in a single operation after the production build completes
 * 2. The options can be built in multiple operations, one for each webpack build
 */ function getBuildPluginOptions({ sentryBuildOptions, releaseName, distDirAbsPath, buildTool, useRunAfterProductionCompileHook }) {
    // We need to convert paths to posix because Glob patterns use `\` to escape
    // glob characters. This clashes with Windows path separators.
    // See: https://www.npmjs.com/package/glob
    const normalizedDistDirAbsPath = normalizePathForGlob(distDirAbsPath);
    const loggerPrefix = LOGGER_PREFIXES[buildTool];
    const widenClientFileUpload = sentryBuildOptions.widenClientFileUpload ?? false;
    const deleteSourcemapsAfterUpload = sentryBuildOptions.sourcemaps?.deleteSourcemapsAfterUpload ?? false;
    const sourcemapUploadAssets = createSourcemapUploadAssetPatterns(normalizedDistDirAbsPath, buildTool, widenClientFileUpload);
    const sourcemapUploadIgnore = createSourcemapUploadIgnorePattern(normalizedDistDirAbsPath, widenClientFileUpload);
    const finalIgnorePatterns = mergeIgnorePatterns(sourcemapUploadIgnore, sentryBuildOptions.sourcemaps?.ignore);
    const userFilesToDeleteAfterUpload = sentryBuildOptions.sourcemaps?.filesToDeleteAfterUpload;
    if (sentryBuildOptions.debug && userFilesToDeleteAfterUpload !== undefined) {
        // eslint-disable-next-line no-console
        console.debug('[@sentry/nextjs] Skipping auto-deletion of source maps as user has provided filesToDeleteAfterUpload:', userFilesToDeleteAfterUpload);
    }
    const filesToDeleteAfterUpload = userFilesToDeleteAfterUpload !== undefined ? Array.isArray(userFilesToDeleteAfterUpload) ? userFilesToDeleteAfterUpload : [
        userFilesToDeleteAfterUpload
    ] : createFilesToDeleteAfterUploadPattern(normalizedDistDirAbsPath, buildTool, deleteSourcemapsAfterUpload, useRunAfterProductionCompileHook);
    const skipSourcemapsUpload = shouldSkipSourcemapUpload(buildTool, useRunAfterProductionCompileHook);
    return {
        authToken: sentryBuildOptions.authToken,
        headers: sentryBuildOptions.headers,
        org: sentryBuildOptions.org,
        project: sentryBuildOptions.project,
        telemetry: sentryBuildOptions.telemetry,
        debug: sentryBuildOptions.debug,
        errorHandler: sentryBuildOptions.errorHandler,
        reactComponentAnnotation: buildTool.startsWith('after-production-compile') ? undefined : {
            ...sentryBuildOptions.webpack?.reactComponentAnnotation,
            ...sentryBuildOptions.webpack?.unstable_sentryWebpackPluginOptions?.reactComponentAnnotation
        },
        silent: sentryBuildOptions.silent,
        url: sentryBuildOptions.sentryUrl,
        sourcemaps: {
            disable: skipSourcemapsUpload ? true : sentryBuildOptions.sourcemaps?.disable ?? false,
            rewriteSources: rewriteWebpackSources,
            assets: sentryBuildOptions.sourcemaps?.assets ?? sourcemapUploadAssets,
            ignore: finalIgnorePatterns,
            filesToDeleteAfterUpload,
            ...sentryBuildOptions.webpack?.unstable_sentryWebpackPluginOptions?.sourcemaps
        },
        release: createReleaseConfig(releaseName, sentryBuildOptions),
        bundleSizeOptimizations: {
            ...sentryBuildOptions.bundleSizeOptimizations
        },
        _metaOptions: {
            loggerPrefixOverride: loggerPrefix,
            telemetry: {
                metaFramework: 'nextjs'
            }
        },
        ...sentryBuildOptions.webpack?.unstable_sentryWebpackPluginOptions
    };
}
exports.getBuildPluginOptions = getBuildPluginOptions;
exports.normalizePathForGlob = normalizePathForGlob; //# sourceMappingURL=getBuildPluginOptions.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/handleRunAfterProductionCompile.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const getBuildPluginOptions = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/getBuildPluginOptions.js [instrumentation] (ecmascript)");
/**
 * This function is called by Next.js after the production build is complete.
 * It is used to upload sourcemaps to Sentry.
 */ async function handleRunAfterProductionCompile({ releaseName, distDir, buildTool, usesNativeDebugIds }, sentryBuildOptions) {
    if (sentryBuildOptions.debug) {
        // eslint-disable-next-line no-console
        console.debug('[@sentry/nextjs] Running runAfterProductionCompile logic.');
    }
    const { createSentryBuildPluginManager } = core.loadModule('@sentry/bundler-plugin-core', module) ?? {};
    if (!createSentryBuildPluginManager) {
        // eslint-disable-next-line no-console
        console.warn('[@sentry/nextjs] Could not load build manager package. Will not run runAfterProductionCompile logic.');
        return;
    }
    const options = getBuildPluginOptions.getBuildPluginOptions({
        sentryBuildOptions,
        releaseName,
        distDirAbsPath: distDir,
        buildTool: `after-production-compile-${buildTool}`
    });
    const sentryBuildPluginManager = createSentryBuildPluginManager(options, {
        buildTool,
        loggerPrefix: '[@sentry/nextjs - After Production Compile]'
    });
    await sentryBuildPluginManager.telemetry.emitBundlerPluginExecutionSignal();
    await sentryBuildPluginManager.createRelease();
    // Skip debug ID injection if sourcemaps are disabled which are only relevant for sourcemap correlation
    if (!usesNativeDebugIds && sentryBuildOptions.sourcemaps?.disable !== true) {
        await sentryBuildPluginManager.injectDebugIds([
            distDir
        ]);
    }
    await sentryBuildPluginManager.uploadSourcemaps([
        distDir
    ], {
        // We don't want to prepare the artifacts because we injected debug ids manually before
        prepareArtifacts: false
    });
    await sentryBuildPluginManager.deleteArtifacts();
}
exports.handleRunAfterProductionCompile = handleRunAfterProductionCompile; //# sourceMappingURL=handleRunAfterProductionCompile.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/turbopack/generateValueInjectionRules.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const path = __turbopack_context__.r("[externals]/path [external] (path, cjs)");
const util = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/util.js [instrumentation] (ecmascript)");
/**
 * Generate the value injection rules for client and server in turbopack config.
 */ function generateValueInjectionRules({ routeManifest, nextJsVersion, tunnelPath, vercelCronsConfig }) {
    const rules = [];
    const isomorphicValues = {};
    let clientValues = {};
    let serverValues = {};
    if (nextJsVersion) {
        // This is used to determine version-based dev-symbolication behavior
        isomorphicValues._sentryNextJsVersion = nextJsVersion;
    }
    if (routeManifest) {
        clientValues._sentryRouteManifest = JSON.stringify(routeManifest);
    }
    // Inject tunnel route path for both client and server
    if (tunnelPath) {
        isomorphicValues._sentryRewritesTunnelPath = tunnelPath;
    }
    // Inject Vercel crons config for server-side cron auto-instrumentation
    if (vercelCronsConfig) {
        serverValues._sentryVercelCronsConfig = JSON.stringify(vercelCronsConfig);
    }
    // Inject server modules (matching webpack's __SENTRY_SERVER_MODULES__ behavior)
    // Use process.cwd() to get the project directory at build time
    serverValues.__SENTRY_SERVER_MODULES__ = util.getPackageModules(process.cwd());
    if (Object.keys(isomorphicValues).length > 0) {
        clientValues = {
            ...clientValues,
            ...isomorphicValues
        };
        serverValues = {
            ...serverValues,
            ...isomorphicValues
        };
    }
    const hasConditionSupport = nextJsVersion ? util.supportsTurbopackRuleCondition(nextJsVersion) : false;
    // Client value injection
    if (Object.keys(clientValues).length > 0) {
        rules.push({
            matcher: '**/instrumentation-client.*',
            rule: {
                // Only run on user code, not node_modules or Next.js internals
                // condition field is only supported in Next.js 16+
                ...hasConditionSupport ? {
                    condition: {
                        not: 'foreign'
                    }
                } : {},
                loaders: [
                    {
                        loader: path.resolve(("TURBOPACK compile-time value", "/ROOT/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/turbopack"), '..', 'loaders', 'valueInjectionLoader.js'),
                        options: {
                            values: clientValues
                        }
                    }
                ]
            }
        });
    }
    // Server value injection
    if (Object.keys(serverValues).length > 0) {
        rules.push({
            matcher: '**/instrumentation.*',
            rule: {
                // Only run on user code, not node_modules or Next.js internals
                // condition field is only supported in Next.js 16+
                ...hasConditionSupport ? {
                    condition: {
                        not: 'foreign'
                    }
                } : {},
                loaders: [
                    {
                        loader: path.resolve(("TURBOPACK compile-time value", "/ROOT/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/turbopack"), '..', 'loaders', 'valueInjectionLoader.js'),
                        options: {
                            values: serverValues
                        }
                    }
                ]
            }
        });
    }
    return rules;
}
exports.generateValueInjectionRules = generateValueInjectionRules; //# sourceMappingURL=generateValueInjectionRules.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/turbopack/constructTurbopackConfig.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const path = __turbopack_context__.r("[externals]/path [external] (path, cjs)");
const util = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/util.js [instrumentation] (ecmascript)");
const generateValueInjectionRules = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/turbopack/generateValueInjectionRules.js [instrumentation] (ecmascript)");
/**
 * Construct a Turbopack config object from a Next.js config object and a Turbopack options object.
 *
 * @param userNextConfig - The Next.js config object.
 * @param userSentryOptions - The Sentry build options object.
 * @param routeManifest - The route manifest object.
 * @param nextJsVersion - The Next.js version.
 * @param vercelCronsConfig - The Vercel crons configuration from vercel.json.
 * @returns The Turbopack config object.
 */ function constructTurbopackConfig({ userNextConfig, userSentryOptions, routeManifest, nextJsVersion, vercelCronsConfig }) {
    // If sourcemaps are disabled, we don't need to enable native debug ids as this will add build time.
    const shouldEnableNativeDebugIds = (util.supportsNativeDebugIds(nextJsVersion ?? '') && userNextConfig?.turbopack?.debugIds) ?? userSentryOptions?.sourcemaps?.disable !== true;
    const newConfig = {
        ...userNextConfig.turbopack,
        ...shouldEnableNativeDebugIds ? {
            debugIds: true
        } : {}
    };
    const tunnelPath = userSentryOptions?.tunnelRoute !== undefined && userNextConfig.output !== 'export' && typeof userSentryOptions.tunnelRoute === 'string' ? `${userNextConfig.basePath ?? ''}${userSentryOptions.tunnelRoute}` : undefined;
    const valueInjectionRules = generateValueInjectionRules.generateValueInjectionRules({
        routeManifest,
        nextJsVersion,
        tunnelPath,
        vercelCronsConfig
    });
    for (const { matcher, rule } of valueInjectionRules){
        newConfig.rules = safelyAddTurbopackRule(newConfig.rules, {
            matcher,
            rule
        });
    }
    // Add module metadata injection loader for thirdPartyErrorFilterIntegration support.
    // This is only added when turbopackApplicationKey is set AND the Next.js version supports the
    // `condition` field in Turbopack rules (Next.js 16+). Without `condition: { not: 'foreign' }`,
    // the loader would tag node_modules as first-party, defeating the purpose.
    const applicationKey = userSentryOptions?._experimental?.turbopackApplicationKey;
    if (applicationKey && nextJsVersion && util.supportsTurbopackRuleCondition(nextJsVersion)) {
        newConfig.rules = safelyAddTurbopackRule(newConfig.rules, {
            matcher: '*.{ts,tsx,js,jsx,mjs,cjs}',
            rule: {
                condition: {
                    not: 'foreign'
                },
                loaders: [
                    {
                        loader: path.resolve(("TURBOPACK compile-time value", "/ROOT/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/turbopack"), '..', 'loaders', 'moduleMetadataInjectionLoader.js'),
                        options: {
                            applicationKey
                        }
                    }
                ]
            }
        });
    }
    return newConfig;
}
/**
 * Safely add a Turbopack rule to the existing rules.
 *
 * @param existingRules - The existing rules.
 * @param matcher - The matcher for the rule.
 * @param rule - The rule to add.
 * @returns The updated rules object.
 */ function safelyAddTurbopackRule(existingRules, { matcher, rule }) {
    if (!existingRules) {
        return {
            [matcher]: rule
        };
    }
    // If the rule already exists, we don't want to mess with it.
    if (existingRules[matcher]) {
        core.debug.log(`[@sentry/nextjs] - Turbopack rule already exists for ${matcher}. Please remove it from your Next.js config in order for Sentry to work properly.`);
        return existingRules;
    }
    return {
        ...existingRules,
        [matcher]: rule
    };
}
exports.constructTurbopackConfig = constructTurbopackConfig;
exports.safelyAddTurbopackRule = safelyAddTurbopackRule; //# sourceMappingURL=constructTurbopackConfig.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/webpack.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const fs = __turbopack_context__.r("[externals]/fs [external] (fs, cjs)");
const module$1 = __turbopack_context__.r("[externals]/module [external] (module, cjs)");
const path = __turbopack_context__.r("[externals]/path [external] (path, cjs)");
const getBuildPluginOptions = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/getBuildPluginOptions.js [instrumentation] (ecmascript)");
const util = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/util.js [instrumentation] (ecmascript)");
/* eslint-disable complexity */ /* eslint-disable max-lines */ // Next.js runs webpack 3 times, once for the client, the server, and for edge. Because we don't want to print certain
// warnings 3 times, we keep track of them here.
let showedMissingGlobalErrorWarningMsg = false;
/**
 * Construct the function which will be used as the nextjs config's `webpack` value.
 *
 * Sets:
 *   - `devtool`, to ensure high-quality sourcemaps are generated
 *   - `entry`, to include user's sentry config files (where `Sentry.init` is called) in the build
 *   - `plugins`, to add SentryWebpackPlugin
 *
 * @param userNextConfig The user's existing nextjs config, as passed to `withSentryConfig`
 * @param userSentryOptions The user's SentryWebpackPlugin config, as passed to `withSentryConfig`
 * @returns The function to set as the nextjs config's `webpack` value
 */ function constructWebpackConfigFunction({ userNextConfig = {}, userSentryOptions = {}, releaseName, routeManifest, nextJsVersion, useRunAfterProductionCompileHook, vercelCronsConfigResult }) {
    // Will be called by nextjs and passed its default webpack configuration and context data about the build (whether
    // we're building server or client, whether we're in dev, what version of webpack we're using, etc). Note that
    // `incomingConfig` and `buildContext` are referred to as `config` and `options` in the nextjs docs.
    return function newWebpackFunction(incomingConfig, buildContext) {
        const { isServer, dev: isDev, dir: projectDir } = buildContext;
        const runtime = isServer ? buildContext.nextRuntime === 'edge' ? 'edge' : 'server' : 'client';
        // Default page extensions per https://github.com/vercel/next.js/blob/f1dbc9260d48c7995f6c52f8fbcc65f08e627992/packages/next/server/config-shared.ts#L161
        const pageExtensions = userNextConfig.pageExtensions || [
            'tsx',
            'ts',
            'jsx',
            'js'
        ];
        const dotPrefixedPageExtensions = pageExtensions.map((ext)=>`.${ext}`);
        const pageExtensionRegex = pageExtensions.map(core.escapeStringForRegex).join('|');
        const nextVersion = nextJsVersion || util.getNextjsVersion();
        const { major } = core.parseSemver(nextVersion || '');
        // We add `.ts` and `.js` back in because `pageExtensions` might not be relevant to the instrumentation file
        // e.g. user's setting `.mdx`. In that case we still want to default look up
        // `instrumentation.ts` and `instrumentation.js`
        const instrumentationFile = getInstrumentationFile(projectDir, dotPrefixedPageExtensions.concat([
            '.ts',
            '.js'
        ]));
        if (runtime !== 'client') {
            warnAboutDeprecatedConfigFiles(projectDir, instrumentationFile, runtime);
        }
        if (runtime === 'server') {
            // was added in v15 (https://github.com/vercel/next.js/pull/67539)
            if (major && major >= 15) {
                warnAboutMissingOnRequestErrorHandler(instrumentationFile);
            }
        }
        let rawNewConfig = {
            ...incomingConfig
        };
        // if user has custom webpack config (which always takes the form of a function), run it so we have actual values to
        // work with
        if ('webpack' in userNextConfig && typeof userNextConfig.webpack === 'function') {
            rawNewConfig = userNextConfig.webpack(rawNewConfig, buildContext);
        }
        // This mutates `rawNewConfig` in place, but also returns it in order to switch its type to one in which
        // `newConfig.module.rules` is required, so we don't have to keep asserting its existence
        const newConfig = setUpModuleRules(rawNewConfig);
        // Determine which cron config to use based on strategy
        // - 'spans': injected as global for span-based detection (App Router + Pages Router)
        // - 'wrapper': passed to wrapping loader for Pages Router API handler wrapping
        const { strategy: cronsStrategy, config: cronsConfig } = vercelCronsConfigResult;
        const vercelCronsConfigForGlobal = cronsStrategy === 'spans' ? cronsConfig : undefined;
        const vercelCronsConfigForWrapper = cronsStrategy === 'wrapper' ? cronsConfig : undefined;
        // Add a loader which will inject code that sets global values
        addValueInjectionLoader({
            newConfig,
            userNextConfig,
            userSentryOptions,
            buildContext,
            releaseName,
            routeManifest,
            nextJsVersion,
            vercelCronsConfig: vercelCronsConfigForGlobal
        });
        addOtelWarningIgnoreRule(newConfig);
        // Add edge runtime polyfills when building for edge in dev mode
        if (major && major === 13 && runtime === 'edge' && isDev) {
            addEdgeRuntimePolyfills(newConfig, buildContext);
        }
        let pagesDirPath;
        const maybePagesDirPath = path.join(projectDir, 'pages');
        const maybeSrcPagesDirPath = path.join(projectDir, 'src', 'pages');
        if (fs.existsSync(maybePagesDirPath) && fs.lstatSync(maybePagesDirPath).isDirectory()) {
            pagesDirPath = maybePagesDirPath;
        } else if (fs.existsSync(maybeSrcPagesDirPath) && fs.lstatSync(maybeSrcPagesDirPath).isDirectory()) {
            pagesDirPath = maybeSrcPagesDirPath;
        }
        let appDirPath;
        const maybeAppDirPath = path.join(projectDir, 'app');
        const maybeSrcAppDirPath = path.join(projectDir, 'src', 'app');
        if (fs.existsSync(maybeAppDirPath) && fs.lstatSync(maybeAppDirPath).isDirectory()) {
            appDirPath = maybeAppDirPath;
        } else if (fs.existsSync(maybeSrcAppDirPath) && fs.lstatSync(maybeSrcAppDirPath).isDirectory()) {
            appDirPath = maybeSrcAppDirPath;
        }
        const apiRoutesPath = pagesDirPath ? path.join(pagesDirPath, 'api') : undefined;
        const middlewareLocationFolder = pagesDirPath ? path.join(pagesDirPath, '..') : appDirPath ? path.join(appDirPath, '..') : projectDir;
        const staticWrappingLoaderOptions = {
            appDir: appDirPath,
            pagesDir: pagesDirPath,
            pageExtensionRegex,
            excludeServerRoutes: userSentryOptions.webpack?.excludeServerRoutes,
            nextjsRequestAsyncStorageModulePath: getRequestAsyncStorageModuleLocation(projectDir, rawNewConfig.resolve?.modules),
            isDev
        };
        const normalizeLoaderResourcePath = (resourcePath)=>{
            // `resourcePath` may be an absolute path or a path relative to the context of the webpack config
            let absoluteResourcePath;
            if (path.isAbsolute(resourcePath)) {
                absoluteResourcePath = resourcePath;
            } else {
                absoluteResourcePath = path.join(projectDir, resourcePath);
            }
            return path.normalize(absoluteResourcePath);
        };
        const isPageResource = (resourcePath)=>{
            const normalizedAbsoluteResourcePath = normalizeLoaderResourcePath(resourcePath);
            return pagesDirPath !== undefined && normalizedAbsoluteResourcePath.startsWith(pagesDirPath + path.sep) && !normalizedAbsoluteResourcePath.startsWith(apiRoutesPath + path.sep) && dotPrefixedPageExtensions.some((ext)=>normalizedAbsoluteResourcePath.endsWith(ext));
        };
        const isApiRouteResource = (resourcePath)=>{
            const normalizedAbsoluteResourcePath = normalizeLoaderResourcePath(resourcePath);
            return normalizedAbsoluteResourcePath.startsWith(apiRoutesPath + path.sep) && dotPrefixedPageExtensions.some((ext)=>normalizedAbsoluteResourcePath.endsWith(ext));
        };
        const possibleMiddlewareLocations = pageExtensions.flatMap((middlewareFileEnding)=>{
            return [
                path.join(middlewareLocationFolder, `middleware.${middlewareFileEnding}`),
                path.join(middlewareLocationFolder, `proxy.${middlewareFileEnding}`)
            ];
        });
        const isMiddlewareResource = (resourcePath)=>{
            const normalizedAbsoluteResourcePath = normalizeLoaderResourcePath(resourcePath);
            return possibleMiddlewareLocations.includes(normalizedAbsoluteResourcePath);
        };
        const isServerComponentResource = (resourcePath)=>{
            const normalizedAbsoluteResourcePath = normalizeLoaderResourcePath(resourcePath);
            // ".js, .jsx, or .tsx file extensions can be used for Pages"
            // https://beta.nextjs.org/docs/routing/pages-and-layouts#pages:~:text=.js%2C%20.jsx%2C%20or%20.tsx%20file%20extensions%20can%20be%20used%20for%20Pages.
            return appDirPath !== undefined && normalizedAbsoluteResourcePath.startsWith(appDirPath + path.sep) && !!normalizedAbsoluteResourcePath.match(// eslint-disable-next-line @sentry-internal/sdk/no-regexp-constructor
            new RegExp(`[\\\\/](page|layout|loading|head|not-found)\\.(${pageExtensionRegex})$`));
        };
        const isRouteHandlerResource = (resourcePath)=>{
            const normalizedAbsoluteResourcePath = normalizeLoaderResourcePath(resourcePath);
            return appDirPath !== undefined && normalizedAbsoluteResourcePath.startsWith(appDirPath + path.sep) && !!normalizedAbsoluteResourcePath.match(// eslint-disable-next-line @sentry-internal/sdk/no-regexp-constructor
            new RegExp(`[\\\\/]route\\.(${pageExtensionRegex})$`));
        };
        if (isServer && userSentryOptions.webpack?.autoInstrumentServerFunctions !== false) {
            // It is very important that we insert our loaders at the beginning of the array because we expect any sort of transformations/transpilations (e.g. TS -> JS) to already have happened.
            // Wrap pages
            newConfig.module.rules.unshift({
                test: isPageResource,
                use: [
                    {
                        loader: path.resolve(("TURBOPACK compile-time value", "/ROOT/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config"), 'loaders', 'wrappingLoader.js'),
                        options: {
                            ...staticWrappingLoaderOptions,
                            wrappingTargetKind: 'page'
                        }
                    }
                ]
            });
            // Wrap api routes
            newConfig.module.rules.unshift({
                test: isApiRouteResource,
                use: [
                    {
                        loader: path.resolve(("TURBOPACK compile-time value", "/ROOT/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config"), 'loaders', 'wrappingLoader.js'),
                        options: {
                            ...staticWrappingLoaderOptions,
                            vercelCronsConfig: vercelCronsConfigForWrapper,
                            wrappingTargetKind: 'api-route'
                        }
                    }
                ]
            });
            // Wrap middleware
            const canWrapStandaloneMiddleware = userNextConfig.output !== 'standalone' || !major || major < 16;
            if ((userSentryOptions.webpack?.autoInstrumentMiddleware ?? true) && canWrapStandaloneMiddleware) {
                newConfig.module.rules.unshift({
                    test: isMiddlewareResource,
                    use: [
                        {
                            loader: path.resolve(("TURBOPACK compile-time value", "/ROOT/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config"), 'loaders', 'wrappingLoader.js'),
                            options: {
                                ...staticWrappingLoaderOptions,
                                wrappingTargetKind: 'middleware'
                            }
                        }
                    ]
                });
            }
        }
        if (isServer && userSentryOptions.webpack?.autoInstrumentAppDirectory !== false) {
            // Wrap server components
            newConfig.module.rules.unshift({
                test: isServerComponentResource,
                use: [
                    {
                        loader: path.resolve(("TURBOPACK compile-time value", "/ROOT/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config"), 'loaders', 'wrappingLoader.js'),
                        options: {
                            ...staticWrappingLoaderOptions,
                            wrappingTargetKind: 'server-component'
                        }
                    }
                ]
            });
            // Wrap route handlers
            newConfig.module.rules.unshift({
                test: isRouteHandlerResource,
                use: [
                    {
                        loader: path.resolve(("TURBOPACK compile-time value", "/ROOT/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config"), 'loaders', 'wrappingLoader.js'),
                        options: {
                            ...staticWrappingLoaderOptions,
                            wrappingTargetKind: 'route-handler'
                        }
                    }
                ]
            });
        }
        if (appDirPath) {
            const hasGlobalErrorFile = pageExtensions.map((extension)=>`global-error.${extension}`).some((globalErrorFile)=>fs.existsSync(path.join(appDirPath, globalErrorFile)));
            if (!hasGlobalErrorFile && !showedMissingGlobalErrorWarningMsg && !process.env.SENTRY_SUPPRESS_GLOBAL_ERROR_HANDLER_FILE_WARNING) {
                // eslint-disable-next-line no-console
                console.log("[@sentry/nextjs] It seems like you don't have a global error handler set up. It is recommended that you add a 'global-error.js' file with Sentry instrumentation so that React rendering errors are reported to Sentry. Read more: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#react-render-errors-in-app-router (you can suppress this warning by setting SENTRY_SUPPRESS_GLOBAL_ERROR_HANDLER_FILE_WARNING=1 as environment variable)");
                showedMissingGlobalErrorWarningMsg = true;
            }
        }
        if (!isServer) {
            // Tell webpack to inject the client config files (containing the client-side `Sentry.init()` call) into the appropriate output
            // bundles. Store a separate reference to the original `entry` value to avoid an infinite loop. (If we don't do
            // this, we'll have a statement of the form `x.y = () => f(x.y)`, where one of the things `f` does is call `x.y`.
            // Since we're setting `x.y` to be a callback (which, by definition, won't run until some time later), by the time
            // the function runs (causing `f` to run, causing `x.y` to run), `x.y` will point to the callback itself, rather
            // than its original value. So calling it will call the callback which will call `f` which will call `x.y` which
            // will call the callback which will call `f` which will call `x.y`... and on and on. Theoretically this could also
            // be fixed by using `bind`, but this is way simpler.)
            const origEntryProperty = newConfig.entry;
            newConfig.entry = async ()=>addSentryToClientEntryProperty(origEntryProperty, buildContext);
            const clientSentryConfigFileName = getClientSentryConfigFile(projectDir);
            if (clientSentryConfigFileName) {
                // eslint-disable-next-line no-console
                console.warn(`[@sentry/nextjs] DEPRECATION WARNING: It is recommended renaming your \`${clientSentryConfigFileName}\` file, or moving its content to \`instrumentation-client.ts\`. When using Turbopack \`${clientSentryConfigFileName}\` will no longer work. Read more about the \`instrumentation-client.ts\` file: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client`);
            }
        }
        const isStaticExport = userNextConfig?.output === 'export';
        // We don't want to do any webpack plugin stuff OR any source maps stuff in dev mode or for the server on static-only builds.
        // Symbolication for dev-mode errors is done elsewhere.
        if (!(isDev || isStaticExport && isServer)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { sentryWebpackPlugin } = core.loadModule('@sentry/webpack-plugin', module) ?? {};
            if (sentryWebpackPlugin) {
                if (!userSentryOptions.sourcemaps?.disable) {
                    // Source maps can be configured in 3 ways:
                    // 1. (next config): productionBrowserSourceMaps
                    // 2. (next config): experimental.serverSourceMaps
                    // 3. custom webpack configuration
                    //
                    // We only update this if no explicit value is set
                    // (Next.js defaults to `false`: https://github.com/vercel/next.js/blob/5f4f96c133bd6b10954812cc2fef6af085b82aa5/packages/next/src/build/webpack/config/blocks/base.ts#L61)
                    if (!newConfig.devtool) {
                        core.debug.log(`[@sentry/nextjs] Automatically enabling source map generation for ${runtime} build.`);
                        // `hidden-source-map` produces the same sourcemaps as `source-map`, but doesn't include the `sourceMappingURL`
                        // comment at the bottom. For folks who aren't publicly hosting their sourcemaps, this is helpful because then
                        // the browser won't look for them and throw errors into the console when it can't find them. Because this is a
                        // front-end-only problem, and because `sentry-cli` handles sourcemaps more reliably with the comment than
                        // without, the option to use `hidden-source-map` only applies to the client-side build.
                        if (isServer) {
                            newConfig.devtool = 'source-map';
                        } else {
                            newConfig.devtool = 'hidden-source-map';
                        }
                    }
                    // enable source map deletion if not explicitly disabled
                    if (!isServer && userSentryOptions.sourcemaps?.deleteSourcemapsAfterUpload === undefined) {
                        core.debug.warn('[@sentry/nextjs] Source maps will be automatically deleted after being uploaded to Sentry. If you want to keep the source maps, set the `sourcemaps.deleteSourcemapsAfterUpload` option to false in `withSentryConfig()`. If you do not want to generate and upload sourcemaps at all, set the `sourcemaps.disable` option to true.');
                        userSentryOptions.sourcemaps = {
                            ...userSentryOptions.sourcemaps,
                            deleteSourcemapsAfterUpload: true
                        };
                    }
                }
                newConfig.plugins = newConfig.plugins || [];
                const { config: userNextConfig, dir, nextRuntime } = buildContext;
                const buildTool = isServer ? nextRuntime === 'edge' ? 'webpack-edge' : 'webpack-nodejs' : 'webpack-client';
                const projectDir = getBuildPluginOptions.normalizePathForGlob(dir);
                const distDir = getBuildPluginOptions.normalizePathForGlob(userNextConfig.distDir ?? '.next');
                const distDirAbsPath = path.posix.join(projectDir, distDir);
                const sentryWebpackPluginInstance = sentryWebpackPlugin(getBuildPluginOptions.getBuildPluginOptions({
                    sentryBuildOptions: userSentryOptions,
                    releaseName,
                    distDirAbsPath,
                    buildTool,
                    useRunAfterProductionCompileHook
                }));
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                sentryWebpackPluginInstance._name = 'sentry-webpack-plugin'; // For tests and debugging. Serves no other purpose.
                newConfig.plugins.push(sentryWebpackPluginInstance);
            }
        }
        if (userSentryOptions.webpack?.treeshake) {
            setupTreeshakingFromConfig(userSentryOptions, newConfig, buildContext);
        }
        // We inject a map of dependencies that the nextjs app has, as we cannot reliably extract them at runtime, sadly
        newConfig.plugins = newConfig.plugins || [];
        newConfig.plugins.push(new buildContext.webpack.DefinePlugin({
            __SENTRY_SERVER_MODULES__: JSON.stringify(util.getPackageModules(projectDir))
        }));
        return newConfig;
    };
}
/**
 * Modify the webpack `entry` property so that the code in `sentry.client.config.js` is
 * included in the the necessary bundles.
 *
 * @param currentEntryProperty The value of the property before Sentry code has been injected
 * @param buildContext Object passed by nextjs containing metadata about the build
 * @returns The value which the new `entry` property (which will be a function) will return (TODO: this should return
 * the function, rather than the function's return value)
 */ async function addSentryToClientEntryProperty(currentEntryProperty, buildContext) {
    // The `entry` entry in a webpack config can be a string, array of strings, object, or function. By default, nextjs
    // sets it to an async function which returns the promise of an object of string arrays. Because we don't know whether
    // someone else has come along before us and changed that, we need to check a few things along the way. The one thing
    // we know is that it won't have gotten *simpler* in form, so we only need to worry about the object and function
    // options. See https://webpack.js.org/configuration/entry-context/#entry.
    const { dir: projectDir, dev: isDevMode } = buildContext;
    const newEntryProperty = typeof currentEntryProperty === 'function' ? await currentEntryProperty() : {
        ...currentEntryProperty
    };
    const clientSentryConfigFileName = getClientSentryConfigFile(projectDir);
    const instrumentationClientFileName = getInstrumentationClientFile(projectDir);
    const filesToInject = [];
    if (clientSentryConfigFileName) {
        // we need to turn the filename into a path so webpack can find it
        filesToInject.push(`./${clientSentryConfigFileName}`);
    }
    if (instrumentationClientFileName) {
        // we need to turn the filename into a path so webpack can find it
        filesToInject.push(`./${instrumentationClientFileName}`);
    }
    // inject into all entry points which might contain user's code
    for(const entryPointName in newEntryProperty){
        if (entryPointName === 'pages/_app' || // entrypoint for `/app` pages
        entryPointName === 'main-app') {
            addFilesToWebpackEntryPoint(newEntryProperty, entryPointName, filesToInject, isDevMode);
        }
    }
    return newEntryProperty;
}
/**
 * Gets the content of the user's instrumentation file
 */ function getInstrumentationFile(projectDir, dotPrefixedExtensions) {
    const paths = dotPrefixedExtensions.flatMap((extension)=>[
            [
                'src',
                `instrumentation${extension}`
            ],
            [
                `instrumentation${extension}`
            ]
        ]);
    for (const pathSegments of paths){
        try {
            return fs.readFileSync(path.resolve(projectDir, ...pathSegments), {
                encoding: 'utf-8'
            });
        } catch  {
        // no-op
        }
    }
    return null;
}
/**
 * Make sure the instrumentation file has a `onRequestError` Handler
 */ function warnAboutMissingOnRequestErrorHandler(instrumentationFile) {
    if (!instrumentationFile) {
        if (!process.env.SENTRY_SUPPRESS_INSTRUMENTATION_FILE_WARNING) {
            // eslint-disable-next-line no-console
            console.warn('[@sentry/nextjs] Could not find a Next.js instrumentation file. This indicates an incomplete configuration of the Sentry SDK. An instrumentation file is required for the Sentry SDK to be initialized on the server: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#create-initialization-config-files (you can suppress this warning by setting SENTRY_SUPPRESS_INSTRUMENTATION_FILE_WARNING=1 as environment variable)');
        }
        return;
    }
    if (!instrumentationFile.includes('onRequestError')) {
        // eslint-disable-next-line no-console
        console.warn('[@sentry/nextjs] Could not find `onRequestError` hook in instrumentation file. This indicates outdated configuration of the Sentry SDK. Use `Sentry.captureRequestError` to instrument the `onRequestError` hook: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#errors-from-nested-react-server-components');
    }
}
/**
 * Searches for old `sentry.(server|edge).config.ts` files and Next.js instrumentation hooks and warns if there are "old"
 * config files and no signs of them inside the instrumentation hook.
 *
 * @param projectDir The root directory of the project, where config files would be located
 * @param platform Either "server" or "edge", so that we know which file to look for
 */ function warnAboutDeprecatedConfigFiles(projectDir, instrumentationFile, platform) {
    const hasInstrumentationHookWithIndicationsOfSentry = instrumentationFile && (instrumentationFile.includes('@sentry/') || instrumentationFile.match(/sentry\.(server|edge)\.config(\.(ts|js))?/));
    if (hasInstrumentationHookWithIndicationsOfSentry) {
        return;
    }
    for (const filename of [
        `sentry.${platform}.config.ts`,
        `sentry.${platform}.config.js`
    ]){
        if (fs.existsSync(path.resolve(projectDir, filename))) {
            // eslint-disable-next-line no-console
            console.warn(`[@sentry/nextjs] It appears you've configured a \`${filename}\` file. Please ensure to put this file's content into the \`register()\` function of a Next.js instrumentation file instead. To ensure correct functionality of the SDK, \`Sentry.init\` must be called inside of an instrumentation file. Learn more about setting up an instrumentation file in Next.js: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation. You can safely delete the \`${filename}\` file afterward.`);
        }
    }
}
/**
 * Searches for a `sentry.client.config.ts|js` file and returns its file name if it finds one. (ts being prioritized)
 *
 * @param projectDir The root directory of the project, where config files would be located
 */ function getClientSentryConfigFile(projectDir) {
    const possibilities = [
        'sentry.client.config.ts',
        'sentry.client.config.js'
    ];
    for (const filename of possibilities){
        if (fs.existsSync(path.resolve(projectDir, filename))) {
            return filename;
        }
    }
}
/**
 * Searches for a `instrumentation-client.ts|js` file and returns its file name if it finds one. (ts being prioritized)
 *
 * @param projectDir The root directory of the project, where config files would be located
 */ function getInstrumentationClientFile(projectDir) {
    const possibilities = [
        [
            'src',
            'instrumentation-client.js'
        ],
        [
            'src',
            'instrumentation-client.ts'
        ],
        [
            'instrumentation-client.js'
        ],
        [
            'instrumentation-client.ts'
        ]
    ];
    for (const pathParts of possibilities){
        if (fs.existsSync(path.resolve(projectDir, ...pathParts))) {
            return path.join(...pathParts);
        }
    }
}
/**
 * Add files to a specific element of the given `entry` webpack config property.
 *
 * @param entryProperty The existing `entry` config object
 * @param entryPointName The key where the file should be injected
 * @param filesToInsert An array of paths to the injected files
 */ function addFilesToWebpackEntryPoint(entryProperty, entryPointName, filesToInsert, isDevMode) {
    // BIG FAT NOTE: Order of insertion seems to matter here. If we insert the new files before the `currentEntrypoint`s,
    // the Next.js dev server breaks. Because we generally still want the SDK to be initialized as early as possible we
    // still keep it at the start of the entrypoints if we are not in dev mode.
    // can be a string, array of strings, or object whose `import` property is one of those two
    const currentEntryPoint = entryProperty[entryPointName];
    let newEntryPoint = currentEntryPoint;
    if (typeof currentEntryPoint === 'string' || Array.isArray(currentEntryPoint)) {
        newEntryPoint = Array.isArray(currentEntryPoint) ? currentEntryPoint : [
            currentEntryPoint
        ];
        if (newEntryPoint.some((entry)=>filesToInsert.includes(entry))) {
            return;
        }
        if (isDevMode) {
            // Inserting at beginning breaks dev mode so we insert at the end
            newEntryPoint.push(...filesToInsert);
        } else {
            // In other modes we insert at the beginning so that the SDK initializes as early as possible
            newEntryPoint.unshift(...filesToInsert);
        }
    } else if (typeof currentEntryPoint === 'object' && 'import' in currentEntryPoint) {
        const currentImportValue = currentEntryPoint.import;
        const newImportValue = Array.isArray(currentImportValue) ? currentImportValue : [
            currentImportValue
        ];
        if (newImportValue.some((entry)=>filesToInsert.includes(entry))) {
            return;
        }
        if (isDevMode) {
            // Inserting at beginning breaks dev mode so we insert at the end
            newImportValue.push(...filesToInsert);
        } else {
            // In other modes we insert at the beginning so that the SDK initializes as early as possible
            newImportValue.unshift(...filesToInsert);
        }
        newEntryPoint = {
            ...currentEntryPoint,
            import: newImportValue
        };
    } else {
        // eslint-disable-next-line no-console
        console.error('Sentry Logger [Error]:', `Could not inject SDK initialization code into entry point ${entryPointName}, as its current value is not in a recognized format.\n`, 'Expected: string | Array<string> | { [key:string]: any, import: string | Array<string> }\n', `Got: ${currentEntryPoint}`);
    }
    if (newEntryPoint) {
        entryProperty[entryPointName] = newEntryPoint;
    }
}
/**
 * Ensure that `newConfig.module.rules` exists. Modifies the given config in place but also returns it in order to
 * change its type.
 *
 * @param newConfig A webpack config object which may or may not contain `module` and `module.rules`
 * @returns The same object, with an empty `module.rules` array added if necessary
 */ function setUpModuleRules(newConfig) {
    newConfig.module = {
        ...newConfig.module,
        rules: [
            ...newConfig.module?.rules || []
        ]
    };
    // Surprising that we have to assert the type here, since we've demonstrably guaranteed the existence of
    // `newConfig.module.rules` just above, but ¯\_(ツ)_/¯
    return newConfig;
}
/**
 * Adds loaders to inject values on the global object based on user configuration.
 */ // TODO: Remove this loader and replace it with a nextConfig.env (https://web.archive.org/web/20240917153554/https://nextjs.org/docs/app/api-reference/next-config-js/env) or define based (https://github.com/vercel/next.js/discussions/71476) approach.
// In order to remove this loader though we need to make sure the minimum supported Next.js version includes this PR (https://github.com/vercel/next.js/pull/61194), otherwise the nextConfig.env based approach will not work, as our SDK code is not processed by Next.js.
function addValueInjectionLoader({ newConfig, userNextConfig, userSentryOptions, buildContext, releaseName, routeManifest, nextJsVersion, vercelCronsConfig }) {
    const assetPrefix = userNextConfig.assetPrefix || userNextConfig.basePath || '';
    // Check if release creation is disabled to prevent injection that breaks build determinism
    const shouldCreateRelease = userSentryOptions.release?.create !== false;
    const releaseToInject = releaseName && shouldCreateRelease ? releaseName : undefined;
    const isomorphicValues = {
        // `rewritesTunnel` set by the user in Next.js config
        _sentryRewritesTunnelPath: userSentryOptions.tunnelRoute !== undefined && userNextConfig.output !== 'export' && typeof userSentryOptions.tunnelRoute === 'string' ? `${userNextConfig.basePath ?? ''}${userSentryOptions.tunnelRoute}` : undefined,
        // The webpack plugin's release injection breaks the `app` directory so we inject the release manually here instead.
        // Having a release defined in dev-mode spams releases in Sentry so we only set one in non-dev mode
        // Only inject if release creation is not explicitly disabled (to maintain build determinism)
        SENTRY_RELEASE: releaseToInject && !buildContext.dev ? {
            id: releaseToInject
        } : undefined,
        _sentryBasePath: buildContext.dev ? userNextConfig.basePath : undefined,
        // This is used to determine version-based dev-symbolication behavior
        _sentryNextJsVersion: nextJsVersion
    };
    const serverValues = {
        ...isomorphicValues,
        // Make sure that if we have a windows path, the backslashes are interpreted as such (rather than as escape
        // characters)
        _sentryRewriteFramesDistDir: userNextConfig.distDir?.replace(/\\/g, '\\\\') || '.next',
        // Inject Vercel crons config for server-side cron auto-instrumentation
        _sentryVercelCronsConfig: vercelCronsConfig ? JSON.stringify(vercelCronsConfig) : undefined
    };
    const clientValues = {
        ...isomorphicValues,
        // Get the path part of `assetPrefix`, minus any trailing slash. (We use a placeholder for the origin if
        // `assetPrefix` doesn't include one. Since we only care about the path, it doesn't matter what it is.)
        _sentryRewriteFramesAssetPrefixPath: assetPrefix ? new URL(assetPrefix, 'http://dogs.are.great').pathname.replace(/\/$/, '') : '',
        _sentryAssetPrefix: userNextConfig.assetPrefix,
        _sentryExperimentalThirdPartyOriginStackFrames: userSentryOptions._experimental?.thirdPartyOriginStackFrames ? 'true' : undefined,
        _sentryRouteManifest: JSON.stringify(routeManifest)
    };
    if (buildContext.isServer) {
        newConfig.module.rules.push({
            // TODO: Find a more bulletproof way of matching. For now this is fine and doesn't hurt anyone. It merely sets some globals.
            test: /(src[\\/])?instrumentation.(js|ts)/,
            use: [
                {
                    loader: path.resolve(("TURBOPACK compile-time value", "/ROOT/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config"), 'loaders/valueInjectionLoader.js'),
                    options: {
                        values: serverValues
                    }
                }
            ]
        });
    } else {
        newConfig.module.rules.push({
            test: /(?:sentry\.client\.config\.(jsx?|tsx?)|(?:src[\\/])?instrumentation-client\.(js|ts))$/,
            use: [
                {
                    loader: path.resolve(("TURBOPACK compile-time value", "/ROOT/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config"), 'loaders/valueInjectionLoader.js'),
                    options: {
                        values: clientValues
                    }
                }
            ]
        });
    }
}
function resolveNextPackageDirFromDirectory(basedir) {
    try {
        return path.dirname(module$1.createRequire(`${basedir}/`).resolve('next/package.json'));
    } catch  {
        // Should not happen in theory
        return undefined;
    }
}
const POTENTIAL_REQUEST_ASYNC_STORAGE_LOCATIONS = [
    // Original location of RequestAsyncStorage
    // https://github.com/vercel/next.js/blob/46151dd68b417e7850146d00354f89930d10b43b/packages/next/src/client/components/request-async-storage.ts
    'next/dist/client/components/request-async-storage.js',
    // Introduced in Next.js 13.4.20
    // https://github.com/vercel/next.js/blob/e1bc270830f2fc2df3542d4ef4c61b916c802df3/packages/next/src/client/components/request-async-storage.external.ts
    'next/dist/client/components/request-async-storage.external.js',
    // Introduced in Next.js 15.0.0-canary.180
    // https://github.com/vercel/next.js/blob/541167b9b0fed6af9f36472e632863ffec41f18c/packages/next/src/server/app-render/work-unit-async-storage.external.ts
    'next/dist/server/app-render/work-unit-async-storage.external.js',
    // Introduced in Next.js 15.0.0-canary.182
    // https://github.com/vercel/next.js/blob/f35159e5e80138ca7373f57b47edcaae3bcf1728/packages/next/src/client/components/work-unit-async-storage.external.ts
    'next/dist/client/components/work-unit-async-storage.external.js'
];
function getRequestAsyncStorageModuleLocation(webpackContextDir, webpackResolvableModuleLocations) {
    if (webpackResolvableModuleLocations === undefined) {
        return undefined;
    }
    const absoluteWebpackResolvableModuleLocations = webpackResolvableModuleLocations.map((loc)=>path.resolve(webpackContextDir, loc));
    for (const webpackResolvableLocation of absoluteWebpackResolvableModuleLocations){
        const nextPackageDir = resolveNextPackageDirFromDirectory(webpackResolvableLocation);
        if (nextPackageDir) {
            const asyncLocalStorageLocation = POTENTIAL_REQUEST_ASYNC_STORAGE_LOCATIONS.find((loc)=>fs.existsSync(path.join(nextPackageDir, '..', loc)));
            if (asyncLocalStorageLocation) {
                return asyncLocalStorageLocation;
            }
        }
    }
    return undefined;
}
function addOtelWarningIgnoreRule(newConfig) {
    const ignoreRules = [
        // Inspired by @matmannion: https://github.com/getsentry/sentry-javascript/issues/12077#issuecomment-2180307072
        (warning, compilation)=>{
            // This is wrapped in try-catch because we are vendoring types for this hook and we can't be 100% sure that we are accessing API that is there
            try {
                if (!warning.module) {
                    return false;
                }
                const isDependencyThatMayRaiseCriticalDependencyMessage = /@opentelemetry\/instrumentation/.test(warning.module.readableIdentifier(compilation.requestShortener)) || /@prisma\/instrumentation/.test(warning.module.readableIdentifier(compilation.requestShortener));
                const isCriticalDependencyMessage = /Critical dependency/.test(warning.message);
                return isDependencyThatMayRaiseCriticalDependencyMessage && isCriticalDependencyMessage;
            } catch  {
                return false;
            }
        },
        // We provide these objects in addition to the hook above to provide redundancy in case the hook fails.
        {
            module: /@opentelemetry\/instrumentation/,
            message: /Critical dependency/
        },
        {
            module: /@prisma\/instrumentation/,
            message: /Critical dependency/
        },
        {
            module: /require-in-the-middle/,
            message: /Critical dependency/
        }
    ];
    if (newConfig.ignoreWarnings === undefined) {
        newConfig.ignoreWarnings = ignoreRules;
    } else if (Array.isArray(newConfig.ignoreWarnings)) {
        newConfig.ignoreWarnings.push(...ignoreRules);
    }
}
function addEdgeRuntimePolyfills(newConfig, buildContext) {
    // Use ProvidePlugin to inject performance global only when accessed
    newConfig.plugins = newConfig.plugins || [];
    newConfig.plugins.push(new buildContext.webpack.ProvidePlugin({
        performance: [
            path.resolve(("TURBOPACK compile-time value", "/ROOT/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config"), 'polyfills', 'perf_hooks.js'),
            'performance'
        ]
    }));
    // Add module resolution aliases for problematic Node.js modules in edge runtime
    newConfig.resolve = newConfig.resolve || {};
    newConfig.resolve.alias = {
        ...newConfig.resolve.alias,
        // Redirect perf_hooks imports to a polyfilled version
        perf_hooks: path.resolve(("TURBOPACK compile-time value", "/ROOT/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config"), 'polyfills', 'perf_hooks.js')
    };
}
/**
 * Sets up the tree-shaking flags based on the user's configuration.
 * https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/tree-shaking/
 */ function setupTreeshakingFromConfig(userSentryOptions, newConfig, buildContext) {
    const defines = {};
    newConfig.plugins = newConfig.plugins || [];
    if (userSentryOptions.webpack?.treeshake?.removeDebugLogging) {
        defines.__SENTRY_DEBUG__ = false;
    }
    if (userSentryOptions.webpack?.treeshake?.removeTracing) {
        defines.__SENTRY_TRACING__ = false;
    }
    if (userSentryOptions.webpack?.treeshake?.excludeReplayIframe) {
        defines.__RRWEB_EXCLUDE_IFRAME__ = true;
    }
    if (userSentryOptions.webpack?.treeshake?.excludeReplayShadowDOM) {
        defines.__RRWEB_EXCLUDE_SHADOW_DOM__ = true;
    }
    if (userSentryOptions.webpack?.treeshake?.excludeReplayCompressionWorker) {
        defines.__SENTRY_EXCLUDE_REPLAY_WORKER__ = true;
    }
    // Only add DefinePlugin if there are actual defines to set
    if (Object.keys(defines).length > 0) {
        newConfig.plugins.push(new buildContext.webpack.DefinePlugin(defines));
    }
}
exports.constructWebpackConfigFunction = constructWebpackConfigFunction; //# sourceMappingURL=webpack.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/constants.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
// Packages we auto-instrument need to be external for instrumentation to work
// Next.js externalizes some packages by default, see: https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages
// Others we need to add ourselves
//
// NOTE: 'ai' (Vercel AI SDK) is intentionally NOT included in this list.
// When externalized, Next.js doesn't properly handle the package's conditional exports,
// specifically the "react-server" export condition. This causes client-side code to be
// loaded in server components instead of the appropriate server-side functions.
const DEFAULT_SERVER_EXTERNAL_PACKAGES = [
    'amqplib',
    'connect',
    'dataloader',
    'express',
    'generic-pool',
    'graphql',
    '@hapi/hapi',
    'ioredis',
    'kafkajs',
    'koa',
    'lru-memoizer',
    'mongodb',
    'mongoose',
    'mysql',
    'mysql2',
    'knex',
    'pg',
    'pg-pool',
    '@node-redis/client',
    '@redis/client',
    'redis',
    'tedious'
];
exports.DEFAULT_SERVER_EXTERNAL_PACKAGES = DEFAULT_SERVER_EXTERNAL_PACKAGES; //# sourceMappingURL=constants.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/getFinalConfigObjectBundlerUtils.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const handleRunAfterProductionCompile = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/handleRunAfterProductionCompile.js [instrumentation] (ecmascript)");
const constructTurbopackConfig = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/turbopack/constructTurbopackConfig.js [instrumentation] (ecmascript)");
const util = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/util.js [instrumentation] (ecmascript)");
const webpack = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/webpack.js [instrumentation] (ecmascript)");
const constants = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/constants.js [instrumentation] (ecmascript)");
/**
 * Information about the active bundler and feature support based on Next.js version.
 */ /**
 * Detects which bundler is active (webpack vs turbopack) and whether turbopack features are supported.
 */ function getBundlerInfo(nextJsVersion) {
    const activeBundler = util.detectActiveBundler();
    const isTurbopack = activeBundler === 'turbopack';
    const isWebpack = activeBundler === 'webpack';
    const isTurbopackSupported = util.supportsProductionCompileHook(nextJsVersion ?? '');
    return {
        isTurbopack,
        isWebpack,
        isTurbopackSupported
    };
}
/**
 * Warns if turbopack is in use but the detected Next.js version is unsupported.
 */ function maybeWarnAboutUnsupportedTurbopack(nextJsVersion, bundlerInfo) {
    // Warn if using turbopack with an unsupported Next.js version
    if (!bundlerInfo.isTurbopackSupported && bundlerInfo.isTurbopack) {
        // eslint-disable-next-line no-console
        console.warn(`[@sentry/nextjs] WARNING: You are using the Sentry SDK with Turbopack. The Sentry SDK is compatible with Turbopack on Next.js version 15.4.1 or later. You are currently on ${nextJsVersion}. Please upgrade to a newer Next.js version to use the Sentry SDK with Turbopack.`);
    }
}
/**
 * Warns if `useRunAfterProductionCompileHook` is enabled in webpack mode but the Next.js version is unsupported.
 */ function maybeWarnAboutUnsupportedRunAfterProductionCompileHook(nextJsVersion, userSentryOptions, bundlerInfo) {
    // Webpack case - warn if trying to use runAfterProductionCompile hook with unsupported Next.js version
    if (userSentryOptions.useRunAfterProductionCompileHook && !util.supportsProductionCompileHook(nextJsVersion ?? '') && bundlerInfo.isWebpack) {
        // eslint-disable-next-line no-console
        console.warn('[@sentry/nextjs] The configured `useRunAfterProductionCompileHook` option is not compatible with your current Next.js version. This option is only supported on Next.js version 15.4.1 or later. Will not run source map and release management logic.');
    }
}
/**
 * Constructs turbopack config when turbopack is active.
 */ function maybeConstructTurbopackConfig(incomingUserNextConfigObject, userSentryOptions, routeManifest, nextJsVersion, bundlerInfo, vercelCronsConfigResult) {
    if (!bundlerInfo.isTurbopack) {
        return undefined;
    }
    // Only pass crons config if the span-based approach is enabled
    const vercelCronsConfig = vercelCronsConfigResult.strategy === 'spans' ? vercelCronsConfigResult.config : undefined;
    return constructTurbopackConfig.constructTurbopackConfig({
        userNextConfig: incomingUserNextConfigObject,
        userSentryOptions,
        routeManifest,
        nextJsVersion,
        vercelCronsConfig
    });
}
/**
 * Resolves whether to use the `runAfterProductionCompile` hook based on options and bundler.
 */ function resolveUseRunAfterProductionCompileHookOption(userSentryOptions, bundlerInfo) {
    // If not explicitly set, turbopack uses the runAfterProductionCompile hook (as there are no alternatives), webpack does not.
    return userSentryOptions.useRunAfterProductionCompileHook ?? (bundlerInfo.isTurbopack ? true : false);
}
/**
 * Hooks into Next.js' `compiler.runAfterProductionCompile` to run Sentry release/sourcemap handling.
 *
 * Note: this mutates `incomingUserNextConfigObject`.
 */ function maybeSetUpRunAfterProductionCompileHook({ incomingUserNextConfigObject, userSentryOptions, releaseName, nextJsVersion, bundlerInfo, turboPackConfig, shouldUseRunAfterProductionCompileHook }) {
    if (!shouldUseRunAfterProductionCompileHook) {
        return;
    }
    if (!util.supportsProductionCompileHook(nextJsVersion ?? '')) {
        return;
    }
    if (incomingUserNextConfigObject?.compiler?.runAfterProductionCompile === undefined) {
        incomingUserNextConfigObject.compiler ??= {};
        incomingUserNextConfigObject.compiler.runAfterProductionCompile = async ({ distDir })=>{
            await handleRunAfterProductionCompile.handleRunAfterProductionCompile({
                releaseName,
                distDir,
                buildTool: bundlerInfo.isTurbopack ? 'turbopack' : 'webpack',
                usesNativeDebugIds: bundlerInfo.isTurbopack ? turboPackConfig?.debugIds : undefined
            }, userSentryOptions);
        };
        return;
    }
    if (typeof incomingUserNextConfigObject.compiler.runAfterProductionCompile === 'function') {
        incomingUserNextConfigObject.compiler.runAfterProductionCompile = new Proxy(incomingUserNextConfigObject.compiler.runAfterProductionCompile, {
            async apply (target, thisArg, argArray) {
                const { distDir } = argArray[0] ?? {
                    distDir: '.next'
                };
                await target.apply(thisArg, argArray);
                await handleRunAfterProductionCompile.handleRunAfterProductionCompile({
                    releaseName,
                    distDir,
                    buildTool: bundlerInfo.isTurbopack ? 'turbopack' : 'webpack',
                    usesNativeDebugIds: bundlerInfo.isTurbopack ? turboPackConfig?.debugIds : undefined
                }, userSentryOptions);
            }
        });
        return;
    }
    // eslint-disable-next-line no-console
    console.warn('[@sentry/nextjs] The configured `compiler.runAfterProductionCompile` option is not a function. Will not run source map and release management logic.');
}
/**
 * For supported turbopack builds, auto-enables browser sourcemaps and defaults to deleting them after upload.
 *
 * Note: this mutates both `incomingUserNextConfigObject` and `userSentryOptions`.
 */ function maybeEnableTurbopackSourcemaps(incomingUserNextConfigObject, userSentryOptions, bundlerInfo) {
    // Enable source maps for turbopack builds
    if (!bundlerInfo.isTurbopackSupported || !bundlerInfo.isTurbopack || userSentryOptions.sourcemaps?.disable) {
        return;
    }
    // Only set if not already configured by user
    if (incomingUserNextConfigObject.productionBrowserSourceMaps !== undefined) {
        return;
    }
    if (userSentryOptions.debug) {
        // eslint-disable-next-line no-console
        console.log('[@sentry/nextjs] Automatically enabling browser source map generation for turbopack build.');
    }
    incomingUserNextConfigObject.productionBrowserSourceMaps = true;
    // Enable source map deletion if not explicitly disabled
    if (userSentryOptions.sourcemaps?.deleteSourcemapsAfterUpload !== undefined) {
        return;
    }
    if (userSentryOptions.debug) {
        // eslint-disable-next-line no-console
        console.warn('[@sentry/nextjs] Source maps will be automatically deleted after being uploaded to Sentry. If you want to keep the source maps, set the `sourcemaps.deleteSourcemapsAfterUpload` option to false in `withSentryConfig()`. If you do not want to generate and upload sourcemaps at all, set the `sourcemaps.disable` option to true.');
    }
    userSentryOptions.sourcemaps = {
        ...userSentryOptions.sourcemaps,
        deleteSourcemapsAfterUpload: true
    };
}
/**
 * Returns the patch which ensures server-side auto-instrumented packages are externalized.
 */ function getServerExternalPackagesPatch(incomingUserNextConfigObject, nextMajor) {
    if (nextMajor && nextMajor >= 15) {
        return {
            serverExternalPackages: [
                ...incomingUserNextConfigObject.serverExternalPackages || [],
                ...constants.DEFAULT_SERVER_EXTERNAL_PACKAGES
            ]
        };
    }
    return {
        experimental: {
            ...incomingUserNextConfigObject.experimental,
            serverComponentsExternalPackages: [
                ...incomingUserNextConfigObject.experimental?.serverComponentsExternalPackages || [],
                ...constants.DEFAULT_SERVER_EXTERNAL_PACKAGES
            ]
        }
    };
}
/**
 * Returns the patch for injecting Sentry's webpack config function (if enabled and applicable).
 */ function getWebpackPatch({ incomingUserNextConfigObject, userSentryOptions, releaseName, routeManifest, nextJsVersion, shouldUseRunAfterProductionCompileHook, bundlerInfo, vercelCronsConfigResult }) {
    if (!bundlerInfo.isWebpack || userSentryOptions.webpack?.disableSentryConfig) {
        return {};
    }
    return {
        webpack: webpack.constructWebpackConfigFunction({
            userNextConfig: incomingUserNextConfigObject,
            userSentryOptions,
            releaseName,
            routeManifest,
            nextJsVersion,
            useRunAfterProductionCompileHook: shouldUseRunAfterProductionCompileHook,
            vercelCronsConfigResult
        })
    };
}
/**
 * Returns the patch for adding turbopack config (if enabled and supported).
 */ function getTurbopackPatch(bundlerInfo, turboPackConfig) {
    if (!bundlerInfo.isTurbopackSupported || !bundlerInfo.isTurbopack) {
        return {};
    }
    return {
        turbopack: turboPackConfig
    };
}
exports.getBundlerInfo = getBundlerInfo;
exports.getServerExternalPackagesPatch = getServerExternalPackagesPatch;
exports.getTurbopackPatch = getTurbopackPatch;
exports.getWebpackPatch = getWebpackPatch;
exports.maybeConstructTurbopackConfig = maybeConstructTurbopackConfig;
exports.maybeEnableTurbopackSourcemaps = maybeEnableTurbopackSourcemaps;
exports.maybeSetUpRunAfterProductionCompileHook = maybeSetUpRunAfterProductionCompileHook;
exports.maybeWarnAboutUnsupportedRunAfterProductionCompileHook = maybeWarnAboutUnsupportedRunAfterProductionCompileHook;
exports.maybeWarnAboutUnsupportedTurbopack = maybeWarnAboutUnsupportedTurbopack;
exports.resolveUseRunAfterProductionCompileHookOption = resolveUseRunAfterProductionCompileHookOption; //# sourceMappingURL=getFinalConfigObjectBundlerUtils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/manifest/createRouteManifest.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const fs = __turbopack_context__.r("[externals]/fs [external] (fs, cjs)");
const path = __turbopack_context__.r("[externals]/path [external] (path, cjs)");
let manifestCache = null;
let lastAppDirPath = null;
let lastIncludeRouteGroups = undefined;
function isPageFile(filename) {
    return filename === 'page.tsx' || filename === 'page.jsx' || filename === 'page.ts' || filename === 'page.js';
}
function isRouteGroup(name) {
    return name.startsWith('(') && name.endsWith(')');
}
function normalizeRouteGroupPath(routePath) {
    // Remove route group segments from the path
    // Using positive lookahead with (?=[^)\/]*\)) to avoid polynomial matching
    return routePath.replace(/\/\((?=[^)/]*\))[^)/]+\)/g, '');
}
function getDynamicRouteSegment(name) {
    if (name.startsWith('[[...') && name.endsWith(']]')) {
        // Optional catchall: [[...param]]
        const paramName = name.slice(5, -2); // Remove [[... and ]]
        return `:${paramName}*?`; // Mark with ? as optional
    } else if (name.startsWith('[...') && name.endsWith(']')) {
        // Required catchall: [...param]
        const paramName = name.slice(4, -1); // Remove [... and ]
        return `:${paramName}*`;
    }
    // Regular dynamic: [param]
    return `:${name.slice(1, -1)}`;
}
function buildRegexForDynamicRoute(routePath) {
    const segments = routePath.split('/').filter(Boolean);
    const regexSegments = [];
    const paramNames = [];
    let hasOptionalCatchall = false;
    for (const segment of segments){
        if (segment.startsWith(':')) {
            const paramName = segment.substring(1);
            if (paramName.endsWith('*?')) {
                // Optional catchall: matches zero or more segments
                const cleanParamName = paramName.slice(0, -2);
                paramNames.push(cleanParamName);
                // Handling this special case in pattern construction below
                hasOptionalCatchall = true;
            } else if (paramName.endsWith('*')) {
                // Required catchall: matches one or more segments
                const cleanParamName = paramName.slice(0, -1);
                paramNames.push(cleanParamName);
                regexSegments.push('(.+)');
            } else {
                // Regular dynamic segment
                paramNames.push(paramName);
                regexSegments.push('([^/]+)');
            }
        } else {
            // Static segment - escape regex special characters including route group parentheses
            regexSegments.push(segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
    }
    let pattern;
    if (hasOptionalCatchall) {
        if (regexSegments.length === 0) {
            // If the optional catchall happens at the root, accept any path starting
            // with a slash. Need capturing group for parameter extraction.
            pattern = '^/(.*)$';
        } else {
            // For optional catchall, make the trailing slash and segments optional
            // This allows matching both /catchall and /catchall/anything
            const staticParts = regexSegments.join('/');
            pattern = `^/${staticParts}(?:/(.*))?$`;
        }
    } else {
        pattern = `^/${regexSegments.join('/')}$`;
    }
    return {
        regex: pattern,
        paramNames,
        hasOptionalPrefix: hasOptionalPrefix(paramNames)
    };
}
/**
 * Detect if the first parameter is a common i18n prefix segment
 * Common patterns: locale, lang, language
 */ function hasOptionalPrefix(paramNames) {
    const firstParam = paramNames[0];
    if (firstParam === undefined) {
        return false;
    }
    return firstParam === 'locale' || firstParam === 'lang' || firstParam === 'language';
}
/**
 * Check if a page file exports generateStaticParams (ISR/SSG indicator)
 */ function checkForGenerateStaticParams(pageFilePath) {
    try {
        const content = fs.readFileSync(pageFilePath, 'utf8');
        // check for generateStaticParams export
        // the regex covers `export function generateStaticParams`, `export async function generateStaticParams`, `export const generateStaticParams`
        return /export\s+(async\s+)?function\s+generateStaticParams|export\s+const\s+generateStaticParams/.test(content);
    } catch  {
        return false;
    }
}
function scanAppDirectory(dir, basePath = '', includeRouteGroups = false) {
    const dynamicRoutes = [];
    const staticRoutes = [];
    const isrRoutes = [];
    try {
        const entries = fs.readdirSync(dir, {
            withFileTypes: true
        });
        const pageFile = entries.find((entry)=>isPageFile(entry.name));
        if (pageFile) {
            // Conditionally normalize the path based on includeRouteGroups option
            const routePath = includeRouteGroups ? basePath || '/' : normalizeRouteGroupPath(basePath || '/');
            const isDynamic = routePath.includes(':');
            // Check if this page has generateStaticParams (ISR/SSG indicator)
            const pageFilePath = path.join(dir, pageFile.name);
            const hasGenerateStaticParams = checkForGenerateStaticParams(pageFilePath);
            if (hasGenerateStaticParams) {
                isrRoutes.push(routePath);
            }
            if (isDynamic) {
                const { regex, paramNames, hasOptionalPrefix } = buildRegexForDynamicRoute(routePath);
                dynamicRoutes.push({
                    path: routePath,
                    regex,
                    paramNames,
                    hasOptionalPrefix
                });
            } else {
                staticRoutes.push({
                    path: routePath
                });
            }
        }
        for (const entry of entries){
            if (entry.isDirectory()) {
                const fullPath = path.join(dir, entry.name);
                let routeSegment;
                const isDynamic = entry.name.startsWith('[') && entry.name.endsWith(']');
                const isRouteGroupDir = isRouteGroup(entry.name);
                if (isRouteGroupDir) {
                    if (includeRouteGroups) {
                        routeSegment = entry.name;
                    } else {
                        routeSegment = '';
                    }
                } else if (isDynamic) {
                    routeSegment = getDynamicRouteSegment(entry.name);
                } else {
                    routeSegment = entry.name;
                }
                const newBasePath = routeSegment ? `${basePath}/${routeSegment}` : basePath;
                const subRoutes = scanAppDirectory(fullPath, newBasePath, includeRouteGroups);
                dynamicRoutes.push(...subRoutes.dynamicRoutes);
                staticRoutes.push(...subRoutes.staticRoutes);
                isrRoutes.push(...subRoutes.isrRoutes);
            }
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Error building route manifest:', error);
    }
    return {
        dynamicRoutes,
        staticRoutes,
        isrRoutes
    };
}
/**
 * Returns a route manifest for the given app directory
 */ function createRouteManifest(options) {
    let targetDir;
    if (options?.appDirPath) {
        targetDir = options.appDirPath;
    } else {
        const projectDir = process.cwd();
        const maybeAppDirPath = path.join(projectDir, 'app');
        const maybeSrcAppDirPath = path.join(projectDir, 'src', 'app');
        if (fs.existsSync(maybeAppDirPath) && fs.lstatSync(maybeAppDirPath).isDirectory()) {
            targetDir = maybeAppDirPath;
        } else if (fs.existsSync(maybeSrcAppDirPath) && fs.lstatSync(maybeSrcAppDirPath).isDirectory()) {
            targetDir = maybeSrcAppDirPath;
        }
    }
    if (!targetDir) {
        return {
            isrRoutes: [],
            dynamicRoutes: [],
            staticRoutes: []
        };
    }
    // Check if we can use cached version
    if (manifestCache && lastAppDirPath === targetDir && lastIncludeRouteGroups === options?.includeRouteGroups) {
        return manifestCache;
    }
    const { dynamicRoutes, staticRoutes, isrRoutes } = scanAppDirectory(targetDir, options?.basePath, options?.includeRouteGroups);
    const manifest = {
        dynamicRoutes,
        staticRoutes,
        isrRoutes
    };
    // set cache
    manifestCache = manifest;
    lastAppDirPath = targetDir;
    lastIncludeRouteGroups = options?.includeRouteGroups;
    return manifest;
}
exports.createRouteManifest = createRouteManifest; //# sourceMappingURL=createRouteManifest.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/tunnel.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
/**
 * Generates a random tunnel route path that's less likely to be blocked by ad-blockers
 */ function generateRandomTunnelRoute() {
    // Generate a random 8-character alphanumeric string
    const randomString = core._INTERNAL_safeMathRandom().toString(36).substring(2, 10);
    return `/${randomString}`;
}
/**
 * Resolves the tunnel route based on the user's configuration and the environment.
 * @param tunnelRoute - The user-provided tunnel route option
 */ function resolveTunnelRoute(tunnelRoute) {
    if (process.env.__SENTRY_TUNNEL_ROUTE__) {
        // Reuse cached value from previous build (server/client)
        return process.env.__SENTRY_TUNNEL_ROUTE__;
    }
    const resolvedTunnelRoute = typeof tunnelRoute === 'string' ? tunnelRoute : generateRandomTunnelRoute();
    // Cache for subsequent builds (only during build time)
    // Turbopack runs the config twice, so we need a shared context to avoid generating a new tunnel route for each build.
    // env works well here
    // https://linear.app/getsentry/issue/JS-549/adblock-plus-blocking-requests-to-sentry-and-monitoring-tunnel
    if (resolvedTunnelRoute) {
        process.env.__SENTRY_TUNNEL_ROUTE__ = resolvedTunnelRoute;
    }
    return resolvedTunnelRoute;
}
/**
 * Injects rewrite rules into the Next.js config provided by the user to tunnel
 * requests from the `tunnelPath` to Sentry.
 *
 * See https://nextjs.org/docs/api-reference/next.config.js/rewrites.
 */ function setUpTunnelRewriteRules(userNextConfig, tunnelPath) {
    const originalRewrites = userNextConfig.rewrites;
    // Allow overriding the tunnel destination for E2E tests via environment variable
    const destinationOverride = process.env._SENTRY_TUNNEL_DESTINATION_OVERRIDE;
    // Make sure destinations are statically defined at build time
    const destination = destinationOverride || 'https://o:orgid.ingest.sentry.io/api/:projectid/envelope/?hsts=0';
    const destinationWithRegion = destinationOverride || 'https://o:orgid.ingest.:region.sentry.io/api/:projectid/envelope/?hsts=0';
    // This function doesn't take any arguments at the time of writing but we future-proof
    // here in case Next.js ever decides to pass some
    userNextConfig.rewrites = async (...args)=>{
        const tunnelRouteRewrite = {
            // Matched rewrite routes will look like the following: `[tunnelPath]?o=[orgid]&p=[projectid]`
            // Nextjs will automatically convert `source` into a regex for us
            source: `${tunnelPath}(/?)`,
            has: [
                {
                    type: 'query',
                    key: 'o',
                    value: '(?<orgid>\\d*)'
                },
                {
                    type: 'query',
                    key: 'p',
                    value: '(?<projectid>\\d*)'
                }
            ],
            destination
        };
        const tunnelRouteRewriteWithRegion = {
            // Matched rewrite routes will look like the following: `[tunnelPath]?o=[orgid]&p=[projectid]?r=[region]`
            // Nextjs will automatically convert `source` into a regex for us
            source: `${tunnelPath}(/?)`,
            has: [
                {
                    type: 'query',
                    key: 'o',
                    value: '(?<orgid>\\d*)'
                },
                {
                    type: 'query',
                    key: 'p',
                    value: '(?<projectid>\\d*)'
                },
                {
                    type: 'query',
                    key: 'r',
                    value: '(?<region>[a-z]{2})'
                }
            ],
            destination: destinationWithRegion
        };
        // Order of these is important, they get applied first to last.
        const newRewrites = [
            tunnelRouteRewriteWithRegion,
            tunnelRouteRewrite
        ];
        if (typeof originalRewrites !== 'function') {
            return newRewrites;
        }
        // @ts-expect-error Expected 0 arguments but got 1 - this is from the future-proofing mentioned above, so we don't care about it
        const originalRewritesResult = await originalRewrites(...args);
        if (Array.isArray(originalRewritesResult)) {
            return [
                ...newRewrites,
                ...originalRewritesResult
            ];
        } else {
            return {
                ...originalRewritesResult,
                beforeFiles: [
                    ...newRewrites,
                    ...originalRewritesResult.beforeFiles || []
                ]
            };
        }
    };
}
exports.resolveTunnelRoute = resolveTunnelRoute;
exports.setUpTunnelRewriteRules = setUpTunnelRewriteRules; //# sourceMappingURL=tunnel.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/getFinalConfigObjectUtils.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const node = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node/build/cjs/index.js [instrumentation] (ecmascript)");
const fs = __turbopack_context__.r("[externals]/fs [external] (fs, cjs)");
const path = __turbopack_context__.r("[externals]/path [external] (path, cjs)");
const createRouteManifest = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/manifest/createRouteManifest.js [instrumentation] (ecmascript)");
const util = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/util.js [instrumentation] (ecmascript)");
const buildTime = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/buildTime.js [instrumentation] (ecmascript)");
const tunnel = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/tunnel.js [instrumentation] (ecmascript)");
let showedExportModeTunnelWarning = false;
let showedExperimentalBuildModeWarning = false;
/**
 * Resolves the Sentry release name to use for build-time behavior.
 *
 * Note: if `release.create === false`, we avoid falling back to git to preserve build determinism.
 */ function resolveReleaseName(userSentryOptions) {
    const shouldCreateRelease = userSentryOptions.release?.create !== false;
    return shouldCreateRelease ? userSentryOptions.release?.name ?? node.getSentryRelease() ?? buildTime.getGitRevision() : userSentryOptions.release?.name;
}
/**
 * Applies tunnel-route rewrites, if configured.
 *
 * Note: this mutates `userSentryOptions` (to store the resolved tunnel route) and `incomingUserNextConfigObject`.
 */ function maybeSetUpTunnelRouteRewriteRules(incomingUserNextConfigObject, userSentryOptions) {
    if (!userSentryOptions.tunnelRoute) {
        return;
    }
    if (incomingUserNextConfigObject.output === 'export') {
        if (!showedExportModeTunnelWarning) {
            showedExportModeTunnelWarning = true;
            // eslint-disable-next-line no-console
            console.warn('[@sentry/nextjs] The Sentry Next.js SDK `tunnelRoute` option will not work in combination with Next.js static exports. The `tunnelRoute` option uses server-side features that cannot be accessed in export mode. If you still want to tunnel Sentry events, set up your own tunnel: https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option');
        }
        return;
    }
    // Update the global options object to use the resolved value everywhere
    const resolvedTunnelRoute = tunnel.resolveTunnelRoute(userSentryOptions.tunnelRoute);
    userSentryOptions.tunnelRoute = resolvedTunnelRoute || undefined;
    tunnel.setUpTunnelRewriteRules(incomingUserNextConfigObject, resolvedTunnelRoute);
}
/**
 * Handles Next's experimental build-mode warning/early return behavior.
 *
 * @returns `true` if Sentry config processing should be skipped for the current process invocation
 */ function shouldReturnEarlyInExperimentalBuildMode() {
    if (!process.argv.includes('--experimental-build-mode')) {
        return false;
    }
    if (!showedExperimentalBuildModeWarning) {
        showedExperimentalBuildModeWarning = true;
        // eslint-disable-next-line no-console
        console.warn('[@sentry/nextjs] The Sentry Next.js SDK does not currently fully support next build --experimental-build-mode');
    }
    // Next.js v15.3.0-canary.1 splits the experimental build into two phases:
    // 1. compile: Code compilation
    // 2. generate: Environment variable inlining and prerendering (We don't instrument this phase, we inline in the compile phase)
    //
    // We assume a single "full" build and reruns Webpack instrumentation in both phases.
    // During the generate step it collides with Next.js's inliner
    // producing malformed JS and build failures.
    // We skip Sentry processing during generate to avoid this issue.
    return process.argv.includes('generate');
}
/**
 * Creates the route manifest used for client-side route name normalization, unless disabled.
 */ function maybeCreateRouteManifest(incomingUserNextConfigObject, userSentryOptions) {
    // Handle deprecated option with warning
    // eslint-disable-next-line deprecation/deprecation
    if (userSentryOptions.disableManifestInjection) {
        // eslint-disable-next-line no-console
        console.warn('[@sentry/nextjs] The `disableManifestInjection` option is deprecated. Use `routeManifestInjection: false` instead.');
    }
    // If explicitly disabled, skip
    if (userSentryOptions.routeManifestInjection === false) {
        return undefined;
    }
    // Still check the deprecated option if the new option is not set
    // eslint-disable-next-line deprecation/deprecation
    if (userSentryOptions.routeManifestInjection === undefined && userSentryOptions.disableManifestInjection) {
        return undefined;
    }
    const manifest = createRouteManifest.createRouteManifest({
        basePath: incomingUserNextConfigObject.basePath
    });
    // Apply route exclusion filter if configured
    const excludeFilter = userSentryOptions.routeManifestInjection?.exclude;
    return filterRouteManifest(manifest, excludeFilter);
}
/**
 * Filters routes from the manifest based on the exclude filter.
 * (Exported only for testing)
 */ function filterRouteManifest(manifest, excludeFilter) {
    if (!excludeFilter) {
        return manifest;
    }
    const shouldExclude = (route)=>{
        if (typeof excludeFilter === 'function') {
            return excludeFilter(route);
        }
        return excludeFilter.some((pattern)=>core.isMatchingPattern(route, pattern));
    };
    return {
        staticRoutes: manifest.staticRoutes.filter((r)=>!shouldExclude(r.path)),
        dynamicRoutes: manifest.dynamicRoutes.filter((r)=>!shouldExclude(r.path)),
        isrRoutes: manifest.isrRoutes.filter((r)=>!shouldExclude(r))
    };
}
/**
 * Adds `experimental.clientTraceMetadata` for supported Next.js versions.
 */ function maybeSetClientTraceMetadataOption(incomingUserNextConfigObject, nextJsVersion) {
    // Add the `clientTraceMetadata` experimental option based on Next.js version. The option got introduced in Next.js version 15.0.0 (actually 14.3.0-canary.64).
    // Adding the option on lower versions will cause Next.js to print nasty warnings we wouldn't confront our users with.
    if (nextJsVersion) {
        const { major, minor } = core.parseSemver(nextJsVersion);
        if (major !== undefined && minor !== undefined && (major >= 15 || major === 14 && minor >= 3)) {
            incomingUserNextConfigObject.experimental = incomingUserNextConfigObject.experimental || {};
            incomingUserNextConfigObject.experimental.clientTraceMetadata = [
                'baggage',
                'sentry-trace',
                ...incomingUserNextConfigObject.experimental?.clientTraceMetadata || []
            ];
        }
    } else {
        // eslint-disable-next-line no-console
        console.log("[@sentry/nextjs] The Sentry SDK was not able to determine your Next.js version. If you are using Next.js version 15 or greater, please add `experimental.clientTraceMetadata: ['sentry-trace', 'baggage']` to your Next.js config to enable pageload tracing for App Router.");
    }
}
/**
 * Ensures Next.js' `experimental.instrumentationHook` is set for versions which require it.
 */ function maybeSetInstrumentationHookOption(incomingUserNextConfigObject, nextJsVersion) {
    // From Next.js version (15.0.0-canary.124) onwards, Next.js does no longer require the `experimental.instrumentationHook` option and will
    // print a warning when it is set, so we need to conditionally provide it for lower versions.
    if (nextJsVersion && util.requiresInstrumentationHook(nextJsVersion)) {
        if (incomingUserNextConfigObject.experimental?.instrumentationHook === false) {
            // eslint-disable-next-line no-console
            console.warn('[@sentry/nextjs] You turned off the `experimental.instrumentationHook` option. Note that Sentry will not be initialized if you did not set it up inside `instrumentation.(js|ts)`.');
        }
        incomingUserNextConfigObject.experimental = {
            instrumentationHook: true,
            ...incomingUserNextConfigObject.experimental
        };
        return;
    }
    if (nextJsVersion) {
        return;
    }
    // If we cannot detect a Next.js version for whatever reason, the sensible default is to set the `experimental.instrumentationHook`, even though it may create a warning.
    if (incomingUserNextConfigObject.experimental && 'instrumentationHook' in incomingUserNextConfigObject.experimental) {
        if (incomingUserNextConfigObject.experimental.instrumentationHook === false) {
            // eslint-disable-next-line no-console
            console.warn('[@sentry/nextjs] You set `experimental.instrumentationHook` to `false`. If you are using Next.js version 15 or greater, you can remove that option. If you are using Next.js version 14 or lower, you need to set `experimental.instrumentationHook` in your `next.config.(js|mjs)` to `true` for the SDK to be properly initialized in combination with `instrumentation.(js|ts)`.');
        }
    } else {
        // eslint-disable-next-line no-console
        console.log("[@sentry/nextjs] The Sentry SDK was not able to determine your Next.js version. If you are using Next.js version 15 or greater, Next.js will probably show you a warning about the `experimental.instrumentationHook` being set. To silence Next.js' warning, explicitly set the `experimental.instrumentationHook` option in your `next.config.(js|mjs|ts)` to `undefined`. If you are on Next.js version 14 or lower, you can silence this particular warning by explicitly setting the `experimental.instrumentationHook` option in your `next.config.(js|mjs)` to `true`.");
        incomingUserNextConfigObject.experimental = {
            instrumentationHook: true,
            ...incomingUserNextConfigObject.experimental
        };
    }
}
/**
 * Warns if the project has an `instrumentation-client` file but doesn't export `onRouterTransitionStart`.
 */ function warnIfMissingOnRouterTransitionStartHook(userSentryOptions) {
    // We wanna check whether the user added a `onRouterTransitionStart` handler to their client instrumentation file.
    const instrumentationClientFileContents = buildTime.getInstrumentationClientFileContents();
    if (instrumentationClientFileContents !== undefined && !instrumentationClientFileContents.includes('onRouterTransitionStart') && !userSentryOptions.suppressOnRouterTransitionStartWarning) {
        // eslint-disable-next-line no-console
        console.warn('[@sentry/nextjs] ACTION REQUIRED: To instrument navigations, the Sentry SDK requires you to export an `onRouterTransitionStart` hook from your `instrumentation-client.(js|ts)` file. You can do so by adding `export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;` to the file.');
    }
}
/**
 * Parses the major Next.js version number from a semver string.
 */ function getNextMajor(nextJsVersion) {
    if (!nextJsVersion) {
        return undefined;
    }
    const { major } = core.parseSemver(nextJsVersion);
    return major;
}
/**
 * Reads the Vercel crons configuration from vercel.json.
 * Returns undefined if vercel.json doesn't exist or doesn't contain crons.
 */ function readVercelCronsConfig() {
    try {
        const vercelJsonPath = path.join(process.cwd(), 'vercel.json');
        const vercelJsonContents = fs.readFileSync(vercelJsonPath, 'utf8');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const cronsConfig = JSON.parse(vercelJsonContents).crons;
        if (cronsConfig && Array.isArray(cronsConfig) && cronsConfig.length > 0) {
            return cronsConfig;
        }
        return undefined;
    } catch (e) {
        if (e.code === 'ENOENT') {
            return undefined;
        }
        core.debug.error('[@sentry/nextjs] Failed to read vercel.json for automatic cron job monitoring instrumentation', e);
        return undefined;
    }
}
/** Strategy for Vercel cron monitoring instrumentation */ /**
 * Reads and returns the Vercel crons configuration from vercel.json along with
 * information about which instrumentation approach to use.
 *
 * - `_experimental.vercelCronsMonitoring`: New span-based approach (works for both App Router and Pages Router)
 * - `automaticVercelMonitors`: Old wrapper-based approach (Pages Router only)
 *
 * If both are enabled, the new approach is preferred and a warning is logged.
 */ function maybeGetVercelCronsConfig(userSentryOptions) {
    const result = {
        config: undefined,
        strategy: undefined
    };
    if (!process.env.VERCEL) {
        return result;
    }
    const experimentalEnabled = userSentryOptions._experimental?.vercelCronsMonitoring === true;
    const legacyEnabled = userSentryOptions.webpack?.automaticVercelMonitors === true;
    if (!experimentalEnabled && !legacyEnabled) {
        return result;
    }
    const config = readVercelCronsConfig();
    if (!config) {
        return result;
    }
    result.config = config;
    if (experimentalEnabled && legacyEnabled) {
        core.debug.warn("[@sentry/nextjs] Both '_experimental.vercelCronsMonitoring' and 'webpack.automaticVercelMonitors' are enabled. " + "Using the new span-based approach from '_experimental.vercelCronsMonitoring'. " + "You can remove 'webpack.automaticVercelMonitors' from your config.");
        result.strategy = 'spans';
    } else if (experimentalEnabled) {
        core.debug.log('[@sentry/nextjs] Creating Sentry cron monitors for your Vercel Cron Jobs using span-based instrumentation.');
        result.strategy = 'spans';
    } else {
        core.debug.log("[@sentry/nextjs] Creating Sentry cron monitors for your Vercel Cron Jobs. You can disable this feature by setting the 'automaticVercelMonitors' option to false in your Next.js config.");
        result.strategy = 'wrapper';
    }
    return result;
}
exports.filterRouteManifest = filterRouteManifest;
exports.getNextMajor = getNextMajor;
exports.maybeCreateRouteManifest = maybeCreateRouteManifest;
exports.maybeGetVercelCronsConfig = maybeGetVercelCronsConfig;
exports.maybeSetClientTraceMetadataOption = maybeSetClientTraceMetadataOption;
exports.maybeSetInstrumentationHookOption = maybeSetInstrumentationHookOption;
exports.maybeSetUpTunnelRouteRewriteRules = maybeSetUpTunnelRouteRewriteRules;
exports.resolveReleaseName = resolveReleaseName;
exports.shouldReturnEarlyInExperimentalBuildMode = shouldReturnEarlyInExperimentalBuildMode;
exports.warnIfMissingOnRouterTransitionStartHook = warnIfMissingOnRouterTransitionStartHook; //# sourceMappingURL=getFinalConfigObjectUtils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/getFinalConfigObject.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const util = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/util.js [instrumentation] (ecmascript)");
const buildTime = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/buildTime.js [instrumentation] (ecmascript)");
const deprecatedWebpackOptions = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/deprecatedWebpackOptions.js [instrumentation] (ecmascript)");
const getFinalConfigObjectBundlerUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/getFinalConfigObjectBundlerUtils.js [instrumentation] (ecmascript)");
const getFinalConfigObjectUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/getFinalConfigObjectUtils.js [instrumentation] (ecmascript)");
/**
 * Materializes the final Next.js config object with Sentry's build-time integrations applied.
 *
 * Note: this mutates both `incomingUserNextConfigObject` and `userSentryOptions` (to apply defaults/migrations).
 */ function getFinalConfigObject(incomingUserNextConfigObject, userSentryOptions) {
    deprecatedWebpackOptions.migrateDeprecatedWebpackOptions(userSentryOptions);
    const releaseName = getFinalConfigObjectUtils.resolveReleaseName(userSentryOptions);
    getFinalConfigObjectUtils.maybeSetUpTunnelRouteRewriteRules(incomingUserNextConfigObject, userSentryOptions);
    if (getFinalConfigObjectUtils.shouldReturnEarlyInExperimentalBuildMode()) {
        return incomingUserNextConfigObject;
    }
    const routeManifest = getFinalConfigObjectUtils.maybeCreateRouteManifest(incomingUserNextConfigObject, userSentryOptions);
    const vercelCronsConfigResult = getFinalConfigObjectUtils.maybeGetVercelCronsConfig(userSentryOptions);
    buildTime.setUpBuildTimeVariables(incomingUserNextConfigObject, userSentryOptions, releaseName);
    const nextJsVersion = util.getNextjsVersion();
    const nextMajor = getFinalConfigObjectUtils.getNextMajor(nextJsVersion);
    getFinalConfigObjectUtils.maybeSetClientTraceMetadataOption(incomingUserNextConfigObject, nextJsVersion);
    getFinalConfigObjectUtils.maybeSetInstrumentationHookOption(incomingUserNextConfigObject, nextJsVersion);
    getFinalConfigObjectUtils.warnIfMissingOnRouterTransitionStartHook(userSentryOptions);
    const bundlerInfo = getFinalConfigObjectBundlerUtils.getBundlerInfo(nextJsVersion);
    getFinalConfigObjectBundlerUtils.maybeWarnAboutUnsupportedTurbopack(nextJsVersion, bundlerInfo);
    getFinalConfigObjectBundlerUtils.maybeWarnAboutUnsupportedRunAfterProductionCompileHook(nextJsVersion, userSentryOptions, bundlerInfo);
    const turboPackConfig = getFinalConfigObjectBundlerUtils.maybeConstructTurbopackConfig(incomingUserNextConfigObject, userSentryOptions, routeManifest, nextJsVersion, bundlerInfo, vercelCronsConfigResult);
    const shouldUseRunAfterProductionCompileHook = getFinalConfigObjectBundlerUtils.resolveUseRunAfterProductionCompileHookOption(userSentryOptions, bundlerInfo);
    getFinalConfigObjectBundlerUtils.maybeSetUpRunAfterProductionCompileHook({
        incomingUserNextConfigObject,
        userSentryOptions,
        releaseName,
        nextJsVersion,
        bundlerInfo,
        turboPackConfig,
        shouldUseRunAfterProductionCompileHook
    });
    getFinalConfigObjectBundlerUtils.maybeEnableTurbopackSourcemaps(incomingUserNextConfigObject, userSentryOptions, bundlerInfo);
    return {
        ...incomingUserNextConfigObject,
        ...getFinalConfigObjectBundlerUtils.getServerExternalPackagesPatch(incomingUserNextConfigObject, nextMajor),
        ...getFinalConfigObjectBundlerUtils.getWebpackPatch({
            incomingUserNextConfigObject,
            userSentryOptions,
            releaseName,
            routeManifest,
            nextJsVersion,
            shouldUseRunAfterProductionCompileHook,
            bundlerInfo,
            vercelCronsConfigResult
        }),
        ...getFinalConfigObjectBundlerUtils.getTurbopackPatch(bundlerInfo, turboPackConfig)
    };
}
exports.getFinalConfigObject = getFinalConfigObject; //# sourceMappingURL=getFinalConfigObject.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/index.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const getFinalConfigObject = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/getFinalConfigObject.js [instrumentation] (ecmascript)");
/**
 * Wraps a user's Next.js config and applies Sentry build-time behavior (instrumentation + sourcemap upload).
 *
 * Supports both object and function Next.js configs.
 *
 * @param nextConfig - The user's exported Next.js config
 * @param sentryBuildOptions - Options to configure Sentry's build-time behavior
 * @returns The wrapped Next.js config (same shape as the input)
 */ function withSentryConfig(nextConfig, sentryBuildOptions = {}) {
    const castNextConfig = nextConfig || {};
    if (typeof castNextConfig === 'function') {
        return function(...webpackConfigFunctionArgs) {
            const maybePromiseNextConfig = castNextConfig.apply(this, webpackConfigFunctionArgs);
            if (core.isThenable(maybePromiseNextConfig)) {
                return maybePromiseNextConfig.then((promiseResultNextConfig)=>{
                    return getFinalConfigObject.getFinalConfigObject(promiseResultNextConfig, sentryBuildOptions);
                });
            }
            return getFinalConfigObject.getFinalConfigObject(maybePromiseNextConfig, sentryBuildOptions);
        };
    } else {
        return getFinalConfigObject.getFinalConfigObject(castNextConfig, sentryBuildOptions);
    }
}
exports.withSentryConfig = withSentryConfig; //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/debug-build.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

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
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/devErrorSymbolicationEventProcessor.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const stackTraceParser = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/stacktrace-parser/dist/stack-trace-parser.esm.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/debug-build.js [instrumentation] (ecmascript)");
const globalWithInjectedValues = core.GLOBAL_OBJ;
/**
 * Constructs the base URL for the Next.js dev server, including the port and base path.
 * Returns only the base path when running in the browser (client-side) for relative URLs.
 */ function getDevServerBaseUrl() {
    let basePath = process.env._sentryBasePath ?? globalWithInjectedValues._sentryBasePath ?? '';
    // Prefix the basepath with a slash if it doesn't have one
    if (basePath !== '' && !basePath.match(/^\//)) {
        basePath = `/${basePath}`;
    }
    // eslint-disable-next-line no-restricted-globals
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    const devServerPort = process.env.PORT || '3000';
    return `http://localhost:${devServerPort}${basePath}`;
}
/**
 * Fetches a URL with a 3-second timeout using AbortController.
 */ async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), 3000);
    return core.suppressTracing(()=>fetch(url, {
            ...options,
            signal: controller.signal
        }).finally(()=>{
            clearTimeout(timer);
        }));
}
/**
 * Event processor that will symbolicate errors by using the webpack/nextjs dev server that is used to show stack traces
 * in the dev overlay.
 */ async function devErrorSymbolicationEventProcessor(event, hint) {
    // Filter out spans for requests resolving source maps for stack frames in dev mode
    if (event.type === 'transaction') {
        event.spans = event.spans?.filter((span)=>{
            const httpUrlAttribute = span.data?.['http.url'];
            if (typeof httpUrlAttribute === 'string') {
                return !httpUrlAttribute.includes('__nextjs_original-stack-frame'); // could also be __nextjs_original-stack-frames (plural)
            }
            return true;
        });
    }
    // Due to changes across Next.js versions, there are a million things that can go wrong here so we just try-catch the
    // entire event processor. Symbolicated stack traces are just a nice to have.
    try {
        if (hint.originalException && hint.originalException instanceof Error && hint.originalException.stack) {
            const frames = stackTraceParser.parse(hint.originalException.stack);
            const nextJsVersion = globalWithInjectedValues._sentryNextJsVersion;
            // If we for whatever reason don't have a Next.js version,
            // we don't want to symbolicate as this previously lead to infinite loops
            if (!nextJsVersion) {
                return event;
            }
            const parsedNextjsVersion = core.parseSemver(nextJsVersion);
            let resolvedFrames;
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            if (parsedNextjsVersion.major > 15 || parsedNextjsVersion.major === 15 && parsedNextjsVersion.minor >= 2) {
                const r = await resolveStackFrames(frames);
                if (r === null) {
                    return event;
                }
                resolvedFrames = r;
            } else {
                resolvedFrames = await Promise.all(frames.map((frame)=>resolveStackFrame(frame, hint.originalException)));
            }
            if (event.exception?.values?.[0]?.stacktrace?.frames) {
                event.exception.values[0].stacktrace.frames = event.exception.values[0].stacktrace.frames.map((frame, i, frames)=>{
                    const resolvedFrame = resolvedFrames[frames.length - 1 - i];
                    if (!resolvedFrame?.originalStackFrame || !resolvedFrame.originalCodeFrame) {
                        return {
                            ...frame,
                            platform: frame.filename?.startsWith('node:internal') ? 'nodejs' : undefined,
                            in_app: false
                        };
                    }
                    const { contextLine, preContextLines, postContextLines } = parseOriginalCodeFrame(resolvedFrame.originalCodeFrame);
                    return {
                        ...frame,
                        pre_context: preContextLines,
                        context_line: contextLine,
                        post_context: postContextLines,
                        function: resolvedFrame.originalStackFrame.methodName,
                        filename: resolvedFrame.originalStackFrame.file ? stripWebpackInternalPrefix(resolvedFrame.originalStackFrame.file) : undefined,
                        lineno: resolvedFrame.originalStackFrame.lineNumber || resolvedFrame.originalStackFrame.line1 || undefined,
                        colno: resolvedFrame.originalStackFrame.column || resolvedFrame.originalStackFrame.column1 || undefined
                    };
                });
            }
        }
    } catch  {
        return event;
    }
    return event;
}
async function resolveStackFrame(frame, error) {
    try {
        if (!(frame.file?.startsWith('webpack-internal:') || frame.file?.startsWith('file:'))) {
            return null;
        }
        const params = new URLSearchParams();
        params.append('isServer', String(false)); // doesn't matter since it is overwritten by isAppDirectory
        params.append('isEdgeServer', String(false)); // doesn't matter since it is overwritten by isAppDirectory
        params.append('isAppDirectory', String(true)); // will force server to do more thorough checking
        params.append('errorMessage', error.toString());
        Object.keys(frame).forEach((key)=>{
            params.append(key, (frame[key] ?? '').toString());
        });
        const baseUrl = getDevServerBaseUrl();
        const res = await fetchWithTimeout(`${baseUrl}/__nextjs_original-stack-frame?${params.toString()}`);
        if (!res.ok || res.status === 204) {
            return null;
        }
        const body = await res.json();
        return {
            originalCodeFrame: body.originalCodeFrame,
            originalStackFrame: body.originalStackFrame
        };
    } catch (e) {
        debugBuild.DEBUG_BUILD && core.debug.error('Failed to symbolicate event with Next.js dev server', e);
        return null;
    }
}
async function resolveStackFrames(frames) {
    try {
        const postBody = {
            frames: frames.filter((frame)=>{
                return !!frame.file;
            }).map((frame)=>{
                // https://github.com/vercel/next.js/blob/df0573a478baa8b55478a7963c473dddd59a5e40/packages/next/src/client/components/react-dev-overlay/server/middleware-turbopack.ts#L129
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                frame.file = frame.file.replace(/^rsc:\/\/React\/[^/]+\//, '').replace(/\?\d+$/, '');
                return {
                    file: frame.file,
                    methodName: frame.methodName ?? '<unknown>',
                    arguments: [],
                    lineNumber: frame.lineNumber ?? 0,
                    column: frame.column ?? 0,
                    line1: frame.lineNumber ?? 0,
                    column1: frame.column ?? 0
                };
            }),
            isServer: false,
            isEdgeServer: false,
            isAppDirectory: true
        };
        const baseUrl = getDevServerBaseUrl();
        const res = await fetchWithTimeout(`${baseUrl}/__nextjs_original-stack-frames`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(postBody)
        });
        if (!res.ok || res.status === 204) {
            return null;
        }
        const body = await res.json();
        return body.map((frame)=>{
            return {
                originalCodeFrame: frame.value.originalCodeFrame,
                originalStackFrame: frame.value.originalStackFrame
            };
        });
    } catch (e) {
        debugBuild.DEBUG_BUILD && core.debug.error('Failed to symbolicate event with Next.js dev server', e);
        return null;
    }
}
function parseOriginalCodeFrame(codeFrame) {
    const preProcessedLines = codeFrame// Remove ASCII control characters that are used for syntax highlighting
    .replace(// eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').split('\n')// Remove line that is supposed to indicate where the error happened
    .filter((line)=>!line.match(/^\s*\|/))// Find the error line
    .map((line)=>({
            line,
            isErrorLine: !!line.match(/^>/)
        }))// Remove the leading part that is just for prettier output
    .map((lineObj)=>({
            ...lineObj,
            line: lineObj.line.replace(/^.*\|/, '')
        }));
    const preContextLines = [];
    let contextLine = undefined;
    const postContextLines = [];
    let reachedContextLine = false;
    for (const preProcessedLine of preProcessedLines){
        if (preProcessedLine.isErrorLine) {
            contextLine = preProcessedLine.line;
            reachedContextLine = true;
        } else if (reachedContextLine) {
            postContextLines.push(preProcessedLine.line);
        } else {
            preContextLines.push(preProcessedLine.line);
        }
    }
    return {
        contextLine,
        preContextLines,
        postContextLines
    };
}
/**
 * Strips webpack-internal prefixes from filenames to clean up stack traces.
 *
 * Examples:
 * - "webpack-internal:///./components/file.tsx" -> "./components/file.tsx"
 * - "webpack-internal:///(app-pages-browser)/./components/file.tsx" -> "./components/file.tsx"
 */ function stripWebpackInternalPrefix(filename) {
    if (!filename) {
        return filename;
    }
    const webpackInternalRegex = /^webpack-internal:(?:\/+)?(?:\([^)]*\)\/)?(.+)$/;
    const match = filename.match(webpackInternalRegex);
    return match ? match[1] : filename;
}
exports.devErrorSymbolicationEventProcessor = devErrorSymbolicationEventProcessor; //# sourceMappingURL=devErrorSymbolicationEventProcessor.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/getVercelEnv.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
/**
 * Returns an environment setting value determined by Vercel's `VERCEL_ENV` environment variable.
 *
 * @param isClient Flag to indicate whether to use the `NEXT_PUBLIC_` prefixed version of the environment variable.
 */ function getVercelEnv(isClient) {
    const vercelEnvVar = isClient ? process.env.NEXT_PUBLIC_VERCEL_ENV : process.env.VERCEL_ENV;
    return vercelEnvVar ? `vercel-${vercelEnvVar}` : undefined;
}
exports.getVercelEnv = getVercelEnv; //# sourceMappingURL=getVercelEnv.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/nextSpanAttributes.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const ATTR_NEXT_SPAN_TYPE = 'next.span_type';
const ATTR_NEXT_SPAN_NAME = 'next.span_name';
const ATTR_NEXT_ROUTE = 'next.route';
const ATTR_NEXT_SEGMENT = 'next.segment';
exports.ATTR_NEXT_ROUTE = ATTR_NEXT_ROUTE;
exports.ATTR_NEXT_SEGMENT = ATTR_NEXT_SEGMENT;
exports.ATTR_NEXT_SPAN_NAME = ATTR_NEXT_SPAN_NAME;
exports.ATTR_NEXT_SPAN_TYPE = ATTR_NEXT_SPAN_TYPE; //# sourceMappingURL=nextSpanAttributes.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/span-attributes-with-logic-attached.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
/**
 * If this attribute is attached to a transaction, the Next.js SDK will drop that transaction.
 */ const TRANSACTION_ATTR_SHOULD_DROP_TRANSACTION = 'sentry.drop_transaction';
const TRANSACTION_ATTR_SENTRY_TRACE_BACKFILL = 'sentry.sentry_trace_backfill';
const TRANSACTION_ATTR_SENTRY_ROUTE_BACKFILL = 'sentry.route_backfill';
exports.TRANSACTION_ATTR_SENTRY_ROUTE_BACKFILL = TRANSACTION_ATTR_SENTRY_ROUTE_BACKFILL;
exports.TRANSACTION_ATTR_SENTRY_TRACE_BACKFILL = TRANSACTION_ATTR_SENTRY_TRACE_BACKFILL;
exports.TRANSACTION_ATTR_SHOULD_DROP_TRANSACTION = TRANSACTION_ATTR_SHOULD_DROP_TRANSACTION; //# sourceMappingURL=span-attributes-with-logic-attached.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/isBuild.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const constants = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/next/constants.js [instrumentation] (ecmascript)");
/**
 * Decide if the currently running process is part of the build phase or happening at runtime.
 */ function isBuild() {
    return process.env.NEXT_PHASE === constants.PHASE_PRODUCTION_BUILD;
}
exports.isBuild = isBuild; //# sourceMappingURL=isBuild.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/responseEnd.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/debug-build.js [instrumentation] (ecmascript)");
/**
 * Flushes pending Sentry events with a 2 second timeout and in a way that cannot create unhandled promise rejections.
 */ async function flushSafelyWithTimeout() {
    try {
        debugBuild.DEBUG_BUILD && core.debug.log('Flushing events...');
        await core.flush(2000);
        debugBuild.DEBUG_BUILD && core.debug.log('Done flushing events');
    } catch (e) {
        debugBuild.DEBUG_BUILD && core.debug.log('Error while flushing events:\n', e);
    }
}
/**
 * Uses platform-specific waitUntil function to wait for the provided task to complete without blocking.
 */ function waitUntil(task) {
    // If deployed on Cloudflare, use the Cloudflare waitUntil function to flush the events
    if (isCloudflareWaitUntilAvailable()) {
        cloudflareWaitUntil(task);
        return;
    }
    // otherwise, use vercel's
    core.vercelWaitUntil(task);
}
/**
 * Gets the Cloudflare context from the global object.
 * Relevant to opennext
 * https://github.com/opennextjs/opennextjs-cloudflare/blob/b53a046bd5c30e94a42e36b67747cefbf7785f9a/packages/cloudflare/src/cli/templates/init.ts#L17
 */ function _getOpenNextCloudflareContext() {
    const openNextCloudflareContextSymbol = Symbol.for('__cloudflare-context__');
    return core.GLOBAL_OBJ[openNextCloudflareContextSymbol]?.ctx;
}
/**
 * Function that delays closing of a Cloudflare lambda until the provided promise is resolved.
 */ function cloudflareWaitUntil(task) {
    _getOpenNextCloudflareContext()?.waitUntil(task);
}
/**
 * Checks if the Cloudflare waitUntil function is available globally.
 */ function isCloudflareWaitUntilAvailable() {
    return typeof _getOpenNextCloudflareContext()?.waitUntil === 'function';
}
exports.cloudflareWaitUntil = cloudflareWaitUntil;
exports.flushSafelyWithTimeout = flushSafelyWithTimeout;
exports.isCloudflareWaitUntilAvailable = isCloudflareWaitUntilAvailable;
exports.waitUntil = waitUntil; //# sourceMappingURL=responseEnd.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/urls.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const HeaderKeys = {
    FORWARDED_PROTO: 'x-forwarded-proto',
    FORWARDED_HOST: 'x-forwarded-host',
    HOST: 'host',
    REFERER: 'referer'
};
/**
 * Replaces route parameters in a path template with their values
 * @param path - The path template containing parameters in [paramName] format
 * @param params - Optional route parameters to replace in the template
 * @returns The path with parameters replaced
 */ function substituteRouteParams(path, params) {
    return path;
}
/**
 * Normalizes a path by removing route groups
 * @param path - The path to normalize
 * @returns The normalized path
 */ function sanitizeRoutePath(path) {
    const cleanedSegments = path.split('/').filter((segment)=>segment && !(segment.startsWith('(') && segment.endsWith(')')));
    return cleanedSegments.length > 0 ? `/${cleanedSegments.join('/')}` : '/';
}
/**
 * Constructs a full URL from the component route, parameters, and headers.
 *
 * @param componentRoute - The route template to construct the URL from
 * @param params - Optional route parameters to replace in the template
 * @param headersDict - Optional headers containing protocol and host information
 * @param pathname - Optional pathname coming from parent span "http.target"
 * @returns A sanitized URL string
 */ function buildUrlFromComponentRoute(componentRoute, params, headersDict, pathname) {
    const parameterizedPath = substituteRouteParams(componentRoute);
    // If available, the pathname from the http.target of the HTTP request server span takes precedence over the parameterized path.
    // Spans such as generateMetadata and Server Component rendering are typically direct children of that span.
    const path = pathname ?? sanitizeRoutePath(parameterizedPath);
    const protocol = headersDict?.[HeaderKeys.FORWARDED_PROTO];
    const host = headersDict?.[HeaderKeys.FORWARDED_HOST] || headersDict?.[HeaderKeys.HOST];
    if (!protocol || !host) {
        return path;
    }
    const fullUrl = `${protocol}://${host}${path}`;
    const urlObject = core.parseStringToURLObject(fullUrl);
    if (!urlObject) {
        return path;
    }
    return core.getSanitizedUrlStringFromUrlObject(urlObject);
}
/**
 * Returns a sanitized URL string from the referer header if it exists and is valid.
 *
 * @param headersDict - Optional headers containing the referer
 * @returns A sanitized URL string or undefined if referer is missing/invalid
 */ function extractSanitizedUrlFromRefererHeader(headersDict) {
    const referer = headersDict?.[HeaderKeys.REFERER];
    if (!referer) {
        return undefined;
    }
    try {
        const refererUrl = new URL(referer);
        return core.getSanitizedUrlStringFromUrlObject(refererUrl);
    } catch  {
        return undefined;
    }
}
/**
 * Returns a sanitized URL string using the referer header if available,
 * otherwise constructs the URL from the component route, params, and headers.
 *
 * @param componentRoute - The route template to construct the URL from
 * @param params - Optional route parameters to replace in the template
 * @param headersDict - Optional headers containing protocol, host, and referer
 * @param pathname - Optional pathname coming from root span "http.target"
 * @returns A sanitized URL string
 */ function getSanitizedRequestUrl(componentRoute, params, headersDict, pathname) {
    const refererUrl = extractSanitizedUrlFromRefererHeader(headersDict);
    if (refererUrl) {
        return refererUrl;
    }
    return buildUrlFromComponentRoute(componentRoute, params, headersDict, pathname);
}
exports.buildUrlFromComponentRoute = buildUrlFromComponentRoute;
exports.extractSanitizedUrlFromRefererHeader = extractSanitizedUrlFromRefererHeader;
exports.getSanitizedRequestUrl = getSanitizedRequestUrl;
exports.sanitizeRoutePath = sanitizeRoutePath;
exports.substituteRouteParams = substituteRouteParams; //# sourceMappingURL=urls.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/setUrlProcessingMetadata.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const urls = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/urls.js [instrumentation] (ecmascript)");
/**
 * Sets the URL processing metadata for the event.
 */ function setUrlProcessingMetadata(event) {
    // Skip if not a server-side transaction
    if (event.type !== 'transaction' || event.contexts?.trace?.op !== 'http.server' || !event.contexts?.trace?.data) {
        return;
    }
    // Only add URL if sendDefaultPii is enabled, as URLs may contain PII
    const client = core.getClient();
    if (!client?.getOptions().sendDefaultPii) {
        return;
    }
    const traceData = event.contexts.trace.data;
    // Get the route from trace data
    const componentRoute = traceData['next.route'] || traceData['http.route'];
    const httpTarget = traceData['http.target'];
    if (!componentRoute) {
        return;
    }
    // Extract headers
    const isolationScopeData = event.sdkProcessingMetadata?.capturedSpanIsolationScope?.getScopeData();
    const headersDict = isolationScopeData?.sdkProcessingMetadata?.normalizedRequest?.headers;
    const url = urls.getSanitizedRequestUrl(componentRoute, undefined, headersDict, httpTarget?.toString());
    // Add URL to the isolation scope's normalizedRequest so requestDataIntegration picks it up
    if (url && isolationScopeData?.sdkProcessingMetadata) {
        isolationScopeData.sdkProcessingMetadata.normalizedRequest = isolationScopeData.sdkProcessingMetadata.normalizedRequest || {};
        isolationScopeData.sdkProcessingMetadata.normalizedRequest.url = url;
    }
}
exports.setUrlProcessingMetadata = setUrlProcessingMetadata; //# sourceMappingURL=setUrlProcessingMetadata.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/server/distDirRewriteFramesIntegration.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const path = __turbopack_context__.r("[externals]/path [external] (path, cjs)");
const distDirRewriteFramesIntegration = core.defineIntegration(({ distDirName })=>{
    // nextjs always puts the build directory at the project root level, which is also where you run `next start` from, so
    // we can read in the project directory from the currently running process
    const distDirAbsPath = path.resolve(distDirName).replace(/(\/|\\)$/, ''); // We strip trailing slashes because "app:///_next" also doesn't have one
    // eslint-disable-next-line @sentry-internal/sdk/no-regexp-constructor -- user input is escaped
    const SOURCEMAP_FILENAME_REGEX = new RegExp(core.escapeStringForRegex(distDirAbsPath));
    const rewriteFramesInstance = core.rewriteFramesIntegration({
        iteratee: (frame)=>{
            frame.filename = frame.filename?.replace(SOURCEMAP_FILENAME_REGEX, 'app:///_next');
            return frame;
        }
    });
    return {
        ...rewriteFramesInstance,
        name: 'DistDirRewriteFrames'
    };
});
exports.distDirRewriteFramesIntegration = distDirRewriteFramesIntegration; //# sourceMappingURL=distDirRewriteFramesIntegration.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/addHeadersAsAttributes.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
/**
 * Extracts HTTP request headers as span attributes and optionally applies them to a span.
 */ function addHeadersAsAttributes(headers, span) {
    if (!headers) {
        return {};
    }
    const headersDict = headers instanceof Headers || typeof headers === 'object' && 'get' in headers ? core.winterCGHeadersToDict(headers) : headers;
    const headerAttributes = core.httpHeadersToSpanAttributes(headersDict, core.getClient()?.getOptions().sendDefaultPii ?? false);
    if (span) {
        span.setAttributes(headerAttributes);
    }
    return headerAttributes;
}
exports.addHeadersAsAttributes = addHeadersAsAttributes; //# sourceMappingURL=addHeadersAsAttributes.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/dropMiddlewareTunnelRequests.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const semanticConventions = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/semantic-conventions/build/esm/index.js [instrumentation] (ecmascript)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const opentelemetry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/opentelemetry/build/cjs/index.js [instrumentation] (ecmascript)");
const nextSpanAttributes = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/nextSpanAttributes.js [instrumentation] (ecmascript)");
const spanAttributesWithLogicAttached = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/span-attributes-with-logic-attached.js [instrumentation] (ecmascript)");
const globalWithInjectedValues = core.GLOBAL_OBJ;
/**
 * Drops spans for tunnel requests from middleware or fetch instrumentation.
 * This catches both:
 * 1. Requests to the local tunnel route (before rewrite)
 * 2. Requests to Sentry ingest (after rewrite)
 */ function dropMiddlewareTunnelRequests(span, attrs) {
    // When the user brings their own OTel setup (skipOpenTelemetrySetup: true), we should not
    // mutate their spans with Sentry-internal attributes as it pollutes their tracing backends.
    if (core.getClient()?.getOptions()?.skipOpenTelemetrySetup) {
        return;
    }
    // Only filter middleware spans or HTTP fetch spans
    const isMiddleware = attrs?.[nextSpanAttributes.ATTR_NEXT_SPAN_TYPE] === 'Middleware.execute';
    // The fetch span could be originating from rewrites re-writing a tunnel request
    // So we want to filter it out
    const isFetchSpan = attrs?.[core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN] === 'auto.http.otel.node_fetch';
    // If the span is not a middleware span or a fetch span, return
    if (!isMiddleware && !isFetchSpan) {
        return;
    }
    // Check if this is either a tunnel route request or a Sentry ingest request
    const isTunnel = isTunnelRouteSpan(attrs || {});
    const isSentry = opentelemetry.isSentryRequestSpan(span);
    if (isTunnel || isSentry) {
        // Mark the span to be dropped
        span.setAttribute(spanAttributesWithLogicAttached.TRANSACTION_ATTR_SHOULD_DROP_TRANSACTION, true);
    }
}
/**
 * Checks if a span's HTTP target matches the tunnel route.
 */ function isTunnelRouteSpan(spanAttributes) {
    const tunnelPath = globalWithInjectedValues._sentryRewritesTunnelPath || ("TURBOPACK compile-time value", "/monitoring");
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    // eslint-disable-next-line deprecation/deprecation
    const httpTarget = spanAttributes[semanticConventions.SEMATTRS_HTTP_TARGET];
    if (typeof httpTarget === 'string') {
        // Extract pathname from the target (e.g., "/tunnel?o=123&p=456" -> "/tunnel")
        const pathname = httpTarget.split('?')[0] || '';
        return pathname.startsWith(tunnelPath);
    }
    return false;
}
exports.dropMiddlewareTunnelRequests = dropMiddlewareTunnelRequests; //# sourceMappingURL=dropMiddlewareTunnelRequests.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/tracingUtils.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const semanticConventions = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/semantic-conventions/build/esm/index.js [instrumentation] (ecmascript)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/debug-build.js [instrumentation] (ecmascript)");
const nextSpanAttributes = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/nextSpanAttributes.js [instrumentation] (ecmascript)");
const spanAttributesWithLogicAttached = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/span-attributes-with-logic-attached.js [instrumentation] (ecmascript)");
const PAGE_SEGMENT = '__PAGE__';
const commonIsolationScopeMap = new WeakMap();
/**
 * Takes a shared (garbage collectable) object between resources, e.g. a headers object shared between Next.js server components and returns a common propagation context.
 *
 * @param commonObject The shared object.
 * @param isolationScope The isolationScope that should be shared between all the resources if no isolation scope was created yet.
 * @returns the shared isolation scope.
 */ function commonObjectToIsolationScope(commonObject) {
    if (typeof commonObject === 'object' && commonObject) {
        const memoIsolationScope = commonIsolationScopeMap.get(commonObject);
        if (memoIsolationScope) {
            return memoIsolationScope;
        } else {
            const newIsolationScope = new core.Scope();
            commonIsolationScopeMap.set(commonObject, newIsolationScope);
            return newIsolationScope;
        }
    } else {
        return new core.Scope();
    }
}
let nextjsEscapedAsyncStorage;
/**
 * Will mark the execution context of the callback as "escaped" from Next.js internal tracing by unsetting the active
 * span and propagation context. When an execution passes through this function multiple times, it is a noop after the
 * first time.
 */ function escapeNextjsTracing(cb) {
    const MaybeGlobalAsyncLocalStorage = core.GLOBAL_OBJ.AsyncLocalStorage;
    if (!MaybeGlobalAsyncLocalStorage) {
        debugBuild.DEBUG_BUILD && core.debug.warn("Tried to register AsyncLocalStorage async context strategy in a runtime that doesn't support AsyncLocalStorage.");
        return cb();
    }
    if (!nextjsEscapedAsyncStorage) {
        nextjsEscapedAsyncStorage = new MaybeGlobalAsyncLocalStorage();
    }
    if (nextjsEscapedAsyncStorage.getStore()) {
        return cb();
    } else {
        return core.startNewTrace(()=>{
            return nextjsEscapedAsyncStorage.run(true, ()=>{
                return cb();
            });
        });
    }
}
/**
 * Ideally this function never lands in the develop branch.
 *
 * Drops the entire span tree this function was called in, if it was a span tree created by Next.js.
 */ function dropNextjsRootContext() {
    // When the user brings their own OTel setup (skipOpenTelemetrySetup: true), we should not
    // mutate their spans with Sentry-internal attributes like `sentry.drop_transaction`
    if (core.getClient()?.getOptions()?.skipOpenTelemetrySetup) {
        return;
    }
    const nextJsOwnedSpan = core.getActiveSpan();
    if (nextJsOwnedSpan) {
        const rootSpan = core.getRootSpan(nextJsOwnedSpan);
        const rootSpanAttributes = core.spanToJSON(rootSpan).data;
        if (rootSpanAttributes?.['next.span_type']) {
            core.getRootSpan(nextJsOwnedSpan)?.setAttribute(spanAttributesWithLogicAttached.TRANSACTION_ATTR_SHOULD_DROP_TRANSACTION, true);
        }
    }
}
/**
 * Checks if the span is a resolve segment span.
 * @param spanAttributes The attributes of the span to check.
 * @returns True if the span is a resolve segment span, false otherwise.
 */ function isResolveSegmentSpan(spanAttributes) {
    return spanAttributes[nextSpanAttributes.ATTR_NEXT_SPAN_TYPE] === 'NextNodeServer.getLayoutOrPageModule' && spanAttributes[nextSpanAttributes.ATTR_NEXT_SPAN_NAME] === 'resolve segment modules' && typeof spanAttributes[nextSpanAttributes.ATTR_NEXT_SEGMENT] === 'string';
}
/**
 * Returns the enhanced name for a resolve segment span.
 * @param segment The segment of the resolve segment span.
 * @param route The route of the resolve segment span.
 * @returns The enhanced name for the resolve segment span.
 */ function getEnhancedResolveSegmentSpanName({ segment, route }) {
    if (segment === PAGE_SEGMENT) {
        return `resolve page server component "${route}"`;
    }
    if (segment === '') {
        return 'resolve root layout server component';
    }
    return `resolve layout server component "${segment}"`;
}
/**
 * Maybe enhances the span name for a resolve segment span.
 * If the span is not a resolve segment span, this function does nothing.
 * @param activeSpan The active span.
 * @param spanAttributes The attributes of the span to check.
 * @param rootSpanAttributes The attributes of the according root span.
 */ function maybeEnhanceServerComponentSpanName(activeSpan, spanAttributes, rootSpanAttributes) {
    if (!isResolveSegmentSpan(spanAttributes)) {
        return;
    }
    const segment = spanAttributes[nextSpanAttributes.ATTR_NEXT_SEGMENT];
    const route = rootSpanAttributes[semanticConventions.ATTR_HTTP_ROUTE];
    const enhancedName = getEnhancedResolveSegmentSpanName({
        segment,
        route: typeof route === 'string' ? route : ''
    });
    activeSpan.updateName(enhancedName);
    activeSpan.setAttributes({
        'sentry.nextjs.ssr.function.type': segment === PAGE_SEGMENT ? 'Page' : 'Layout',
        'sentry.nextjs.ssr.function.route': route
    });
    activeSpan.setAttribute(core.SEMANTIC_ATTRIBUTE_SENTRY_OP, 'function.nextjs');
}
exports.commonObjectToIsolationScope = commonObjectToIsolationScope;
exports.dropNextjsRootContext = dropNextjsRootContext;
exports.escapeNextjsTracing = escapeNextjsTracing;
exports.getEnhancedResolveSegmentSpanName = getEnhancedResolveSegmentSpanName;
exports.isResolveSegmentSpan = isResolveSegmentSpan;
exports.maybeEnhanceServerComponentSpanName = maybeEnhanceServerComponentSpanName; //# sourceMappingURL=tracingUtils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/server/vercelCronsMonitoring.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/debug-build.js [instrumentation] (ecmascript)");
// Attribute keys for storing cron check-in data on spans
const ATTR_SENTRY_CRON_CHECK_IN_ID = 'sentry.cron.checkInId';
const ATTR_SENTRY_CRON_MONITOR_SLUG = 'sentry.cron.monitorSlug';
const ATTR_SENTRY_CRON_START_TIME = 'sentry.cron.startTime';
const ATTR_SENTRY_CRON_SCHEDULE = 'sentry.cron.schedule';
/**
 * Gets the Vercel crons configuration that was injected at build time.
 */ function getVercelCronsConfig() {
    const globalWithCronsConfig = globalThis;
    if (!globalWithCronsConfig._sentryVercelCronsConfig) {
        return undefined;
    }
    try {
        return JSON.parse(globalWithCronsConfig._sentryVercelCronsConfig);
    } catch  {
        debugBuild.DEBUG_BUILD && core.debug.log('[@sentry/nextjs] Failed to parse Vercel crons config');
        return undefined;
    }
}
/**
 * Checks if the request is a Vercel cron request and starts a check-in if it matches a configured cron.
 */ function maybeStartCronCheckIn(span, route) {
    const vercelCronsConfig = getVercelCronsConfig();
    if (!vercelCronsConfig || !route) {
        return;
    }
    // The strategy here is to check if the request is a Vercel cron
    // request by checking the user agent, vercel always sets the user agent to 'vercel-cron/1.0'
    const headers = core.getIsolationScope().getScopeData().sdkProcessingMetadata?.normalizedRequest?.headers;
    if (!headers) {
        return;
    }
    const userAgent = Array.isArray(headers['user-agent']) ? headers['user-agent'][0] : headers['user-agent'];
    if (!userAgent?.includes('vercel-cron')) {
        return;
    }
    const matchedCron = vercelCronsConfig.find((cron)=>cron.path === route);
    if (!matchedCron?.path || !matchedCron.schedule) {
        return;
    }
    // Use raw path as monitor slug to match legacy wrapApiHandlerWithSentryVercelCrons behavior,
    // so migration from automaticVercelMonitors to vercelCronsMonitoring keeps the same monitors.
    const monitorSlug = matchedCron.path;
    const startTime = core._INTERNAL_safeDateNow() / 1000;
    const checkInId = core.captureCheckIn({
        monitorSlug,
        status: 'in_progress'
    }, {
        maxRuntime: 60 * 12,
        schedule: {
            type: 'crontab',
            value: matchedCron.schedule
        }
    });
    debugBuild.DEBUG_BUILD && core.debug.log(`[Cron] Started check-in for "${monitorSlug}" with ID "${checkInId}"`);
    // Store marking attributes on the span so we can complete the check-in later
    span.setAttribute(ATTR_SENTRY_CRON_CHECK_IN_ID, checkInId);
    span.setAttribute(ATTR_SENTRY_CRON_MONITOR_SLUG, monitorSlug);
    span.setAttribute(ATTR_SENTRY_CRON_START_TIME, startTime);
    span.setAttribute(ATTR_SENTRY_CRON_SCHEDULE, matchedCron.schedule);
}
/**
 * Completes a Vercel cron check-in when a span ends.
 * Should be called from the spanEnd event handler.
 */ function maybeCompleteCronCheckIn(span) {
    const spanData = core.spanToJSON(span).data;
    const checkInId = spanData?.[ATTR_SENTRY_CRON_CHECK_IN_ID];
    const monitorSlug = spanData?.[ATTR_SENTRY_CRON_MONITOR_SLUG];
    const startTime = spanData?.[ATTR_SENTRY_CRON_START_TIME];
    const schedule = spanData?.[ATTR_SENTRY_CRON_SCHEDULE];
    if (!checkInId || !monitorSlug || typeof startTime !== 'number') {
        return;
    }
    const duration = core._INTERNAL_safeDateNow() / 1000 - startTime;
    const spanStatus = core.spanToJSON(span).status;
    // Span status is 'ok' for success, undefined for unset, or an error message like 'internal_error'
    const checkInStatus = spanStatus && spanStatus !== 'ok' ? 'error' : 'ok';
    // Include monitor_config for upsert in case the in_progress check-in was lost
    const monitorConfig = typeof schedule === 'string' ? {
        maxRuntime: 60 * 12,
        schedule: {
            type: 'crontab',
            value: schedule
        }
    } : undefined;
    core.captureCheckIn({
        checkInId: checkInId,
        monitorSlug: monitorSlug,
        status: checkInStatus,
        duration
    }, monitorConfig);
    // Cleanup marking attributes so they don't pollute user span data
    span.setAttribute(ATTR_SENTRY_CRON_CHECK_IN_ID, undefined);
    span.setAttribute(ATTR_SENTRY_CRON_MONITOR_SLUG, undefined);
    span.setAttribute(ATTR_SENTRY_CRON_START_TIME, undefined);
    span.setAttribute(ATTR_SENTRY_CRON_SCHEDULE, undefined);
    debugBuild.DEBUG_BUILD && core.debug.log(`[Cron] Completed check-in for "${monitorSlug}" with status "${checkInStatus}"`);
}
exports.maybeCompleteCronCheckIn = maybeCompleteCronCheckIn;
exports.maybeStartCronCheckIn = maybeStartCronCheckIn; //# sourceMappingURL=vercelCronsMonitoring.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/server/handleOnSpanStart.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const api = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/api/build/esm/index.js [instrumentation] (ecmascript)");
const semanticConventions = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/semantic-conventions/build/esm/index.js [instrumentation] (ecmascript)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const opentelemetry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/opentelemetry/build/cjs/index.js [instrumentation] (ecmascript)");
const nextSpanAttributes = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/nextSpanAttributes.js [instrumentation] (ecmascript)");
const addHeadersAsAttributes = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/addHeadersAsAttributes.js [instrumentation] (ecmascript)");
const dropMiddlewareTunnelRequests = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/dropMiddlewareTunnelRequests.js [instrumentation] (ecmascript)");
const tracingUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/tracingUtils.js [instrumentation] (ecmascript)");
const vercelCronsMonitoring = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/server/vercelCronsMonitoring.js [instrumentation] (ecmascript)");
/**
 * Handles the on span start event for Next.js spans.
 * This function is used to enhance the span with additional information such as the route, the method, the headers, etc.
 * It is called for every span that is started by Next.js.
 * @param span The span that is starting.
 */ function handleOnSpanStart(span) {
    const spanAttributes = core.spanToJSON(span).data;
    const rootSpan = core.getRootSpan(span);
    const rootSpanAttributes = core.spanToJSON(rootSpan).data;
    const isRootSpan = span === rootSpan;
    dropMiddlewareTunnelRequests.dropMiddlewareTunnelRequests(span, spanAttributes);
    // What we do in this glorious piece of code, is hoist any information about parameterized routes from spans emitted
    // by Next.js via the `next.route` attribute, up to the transaction by setting the http.route attribute.
    if (typeof spanAttributes?.[nextSpanAttributes.ATTR_NEXT_ROUTE] === 'string') {
        // Only hoist the http.route attribute if the transaction doesn't already have it
        if (// eslint-disable-next-line deprecation/deprecation
        (rootSpanAttributes?.[semanticConventions.ATTR_HTTP_REQUEST_METHOD] || rootSpanAttributes?.[semanticConventions.SEMATTRS_HTTP_METHOD]) && !rootSpanAttributes?.[semanticConventions.ATTR_HTTP_ROUTE]) {
            const route = spanAttributes[nextSpanAttributes.ATTR_NEXT_ROUTE].replace(/\/route$/, '');
            rootSpan.updateName(route);
            rootSpan.setAttribute(semanticConventions.ATTR_HTTP_ROUTE, route);
            // Preserving the original attribute despite internally not depending on it
            rootSpan.setAttribute(nextSpanAttributes.ATTR_NEXT_ROUTE, route);
            // Update the isolation scope's transaction name so that non-transaction events
            // (e.g. captureMessage, captureException) also get the parameterized route.
            // eslint-disable-next-line deprecation/deprecation
            const method = rootSpanAttributes?.[semanticConventions.ATTR_HTTP_REQUEST_METHOD] || rootSpanAttributes?.[semanticConventions.SEMATTRS_HTTP_METHOD];
            if (typeof method === 'string') {
                core.getIsolationScope().setTransactionName(`${method} ${route}`);
            }
            // Check if this is a Vercel cron request and start a check-in
            vercelCronsMonitoring.maybeStartCronCheckIn(rootSpan, route);
        }
    }
    if (spanAttributes?.[nextSpanAttributes.ATTR_NEXT_SPAN_TYPE] === 'Middleware.execute') {
        const middlewareName = spanAttributes[nextSpanAttributes.ATTR_NEXT_SPAN_NAME];
        if (typeof middlewareName === 'string') {
            rootSpan.updateName(middlewareName);
            rootSpan.setAttribute(semanticConventions.ATTR_HTTP_ROUTE, middlewareName);
            rootSpan.setAttribute(nextSpanAttributes.ATTR_NEXT_SPAN_NAME, middlewareName);
        }
        span.setAttribute(core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN, 'auto');
    }
    // We want to skip span data inference for any spans generated by Next.js. Reason being that Next.js emits spans
    // with patterns (e.g. http.server spans) that will produce confusing data.
    if (spanAttributes?.[nextSpanAttributes.ATTR_NEXT_SPAN_TYPE] !== undefined) {
        span.setAttribute(core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN, 'auto');
    }
    if (isRootSpan) {
        const headers = core.getIsolationScope().getScopeData().sdkProcessingMetadata?.normalizedRequest?.headers;
        addHeadersAsAttributes.addHeadersAsAttributes(headers, rootSpan);
    }
    // We want to fork the isolation scope for incoming requests
    if (spanAttributes?.[nextSpanAttributes.ATTR_NEXT_SPAN_TYPE] === 'BaseServer.handleRequest' && isRootSpan) {
        const scopes = core.getCapturedScopesOnSpan(span);
        const isolationScope = (scopes.isolationScope || core.getIsolationScope()).clone();
        const scope = scopes.scope || core.getCurrentScope();
        const currentScopesPointer = opentelemetry.getScopesFromContext(api.context.active());
        if (currentScopesPointer) {
            currentScopesPointer.isolationScope = isolationScope;
        }
        core.setCapturedScopesOnSpan(span, scope, isolationScope);
    }
    tracingUtils.maybeEnhanceServerComponentSpanName(span, spanAttributes, rootSpanAttributes);
}
exports.handleOnSpanStart = handleOnSpanStart; //# sourceMappingURL=handleOnSpanStart.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/server/prepareSafeIdGeneratorContext.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/debug-build.js [instrumentation] (ecmascript)");
// Inline AsyncLocalStorage interface from current types
// Avoids conflict with resolving it from getBuiltinModule
/**
 * Prepares the global object to generate safe random IDs in cache components contexts
 * See: https://github.com/getsentry/sentry-javascript/blob/ceb003c15973c2d8f437dfb7025eedffbc8bc8b0/packages/core/src/utils/propagationContext.ts#L1
 */ function prepareSafeIdGeneratorContext() {
    const sym = Symbol.for('__SENTRY_SAFE_RANDOM_ID_WRAPPER__');
    const globalWithSymbol = core.GLOBAL_OBJ;
    // Get initial snapshot - if unavailable, don't set up the wrapper at all
    const initialSnapshot = getAsyncLocalStorageSnapshot();
    if (!initialSnapshot) {
        return;
    }
    // We store a wrapper function instead of the raw snapshot because in serverless
    // environments (e.g., Cloudflare Workers), the snapshot is bound to the request
    // context it was created in. Once that request ends, the snapshot becomes invalid.
    // The wrapper catches this and creates a fresh snapshot for the current request context.
    let cachedSnapshot = initialSnapshot;
    globalWithSymbol[sym] = (callback)=>{
        try {
            return cachedSnapshot(callback);
        } catch (error) {
            // Only handle AsyncLocalStorage-related errors, rethrow others
            if (!isAsyncLocalStorageError(error)) {
                throw error;
            }
            // Snapshot likely stale, try to get a fresh one and retry
            const freshSnapshot = getAsyncLocalStorageSnapshot();
            // No snapshot available, fall back to direct execution
            if (!freshSnapshot) {
                return callback();
            }
            // Update the cached snapshot
            cachedSnapshot = freshSnapshot;
            // Retry the callback with the fresh snapshot
            try {
                return cachedSnapshot(callback);
            } catch (retryError) {
                // Only fall back for AsyncLocalStorage errors, rethrow others
                if (!isAsyncLocalStorageError(retryError)) {
                    throw retryError;
                }
                // If fresh snapshot also fails with ALS error, fall back to direct execution
                return callback();
            }
        }
    };
    debugBuild.DEBUG_BUILD && core.debug.log('[@sentry/nextjs] Prepared safe random ID generator context');
}
function getAsyncLocalStorage() {
    // May exist in the Next.js runtime globals
    // Doesn't exist in some of our tests
    if (typeof AsyncLocalStorage !== 'undefined') {
        return AsyncLocalStorage;
    }
    // Try to resolve it dynamically without synchronously importing the module
    // This is done to avoid importing the module synchronously at the top
    // which means this is safe across runtimes
    if ('getBuiltinModule' in process && typeof process.getBuiltinModule === 'function') {
        const { AsyncLocalStorage: AsyncLocalStorage1 } = process.getBuiltinModule('async_hooks') ?? {};
        return AsyncLocalStorage1;
    }
    return undefined;
}
function getAsyncLocalStorageSnapshot() {
    const als = getAsyncLocalStorage();
    if (!als || typeof als.snapshot !== 'function') {
        debugBuild.DEBUG_BUILD && core.debug.warn('[@sentry/nextjs] No AsyncLocalStorage found in the runtime or AsyncLocalStorage.snapshot() is not available, skipping safe random ID generator context preparation, you may see some errors with cache components.');
        return undefined;
    }
    return als.snapshot();
}
function isAsyncLocalStorageError(error) {
    return error instanceof Error && error.message.includes('AsyncLocalStorage');
}
exports.prepareSafeIdGeneratorContext = prepareSafeIdGeneratorContext; //# sourceMappingURL=prepareSafeIdGeneratorContext.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/_error.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const responseEnd = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/responseEnd.js [instrumentation] (ecmascript)");
/**
 * Capture the exception passed by nextjs to the `_error` page, adding context data as appropriate.
 *
 * This will not capture the exception if the status code is < 500 or if the pathname is not provided and will thus not return an event ID.
 *
 * @param contextOrProps The data passed to either `getInitialProps` or `render` by nextjs
 * @returns The Sentry event ID, or `undefined` if no event was captured
 */ async function captureUnderscoreErrorException(contextOrProps) {
    const { req, res, err } = contextOrProps;
    // 404s (and other 400-y friends) can trigger `_error`, but we don't want to send them to Sentry
    const statusCode = res?.statusCode || contextOrProps.statusCode;
    if (statusCode && statusCode < 500) {
        return;
    }
    // In previous versions of the suggested `_error.js` page in which this function is meant to be used, there was a
    // workaround for https://github.com/vercel/next.js/issues/8592 which involved an extra call to this function, in the
    // custom error component's `render` method, just in case it hadn't been called by `getInitialProps`. Now that that
    // issue has been fixed, the second call is unnecessary, but since it lives in user code rather than our code, users
    // have to be the ones to get rid of it, and guaraneteedly, not all of them will. So, rather than capture the error
    // twice, we just bail if we sense we're in that now-extraneous second call. (We can tell which function we're in
    // because Nextjs passes `pathname` to `getInitialProps` but not to `render`.)
    if (!contextOrProps.pathname) {
        return;
    }
    // If the error was already captured (e.g., by wrapped functions in data fetchers),
    // return the existing event ID instead of capturing it again (needed for lastEventId() to work)
    if (err && core.isAlreadyCaptured(err)) {
        responseEnd.waitUntil(responseEnd.flushSafelyWithTimeout());
        return core.getIsolationScope().lastEventId();
    }
    const eventId = core.withScope((scope)=>{
        if (req) {
            const normalizedRequest = core.httpRequestToRequestData(req);
            scope.setSDKProcessingMetadata({
                normalizedRequest
            });
        }
        // If third-party libraries (or users themselves) throw something falsy, we want to capture it as a message (which
        // is what passing a string to `captureException` will wind up doing)
        return core.captureException(err || `_error.js called with falsy error (${err})`, {
            mechanism: {
                type: 'auto.function.nextjs.underscore_error',
                handled: false,
                data: {
                    function: '_error.getInitialProps'
                }
            }
        });
    });
    responseEnd.waitUntil(responseEnd.flushSafelyWithTimeout());
    return eventId;
}
exports.captureUnderscoreErrorException = captureUnderscoreErrorException; //# sourceMappingURL=_error.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/isUseCacheFunction.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
// Vendored from: https://github.com/vercel/next.js/blob/canary/packages/next/src/lib/client-and-server-references.ts
function extractInfoFromServerReferenceId(id) {
    const infoByte = parseInt(id.slice(0, 2), 16);
    // eslint-disable-next-line no-bitwise
    const typeBit = infoByte >> 7 & 0x1;
    // eslint-disable-next-line no-bitwise
    const argMask = infoByte >> 1 & 0x3f;
    // eslint-disable-next-line no-bitwise
    const restArgs = infoByte & 0x1;
    const usedArgs = Array(6);
    for(let index = 0; index < 6; index++){
        const bitPosition = 5 - index;
        // eslint-disable-next-line no-bitwise
        const bit = argMask >> bitPosition & 0x1;
        usedArgs[index] = bit === 1;
    }
    return {
        type: typeBit === 1 ? 'use-cache' : 'server-action',
        usedArgs: usedArgs,
        hasRestArgs: restArgs === 1
    };
}
function isServerReference(value) {
    return value.$$typeof === Symbol.for('react.server.reference');
}
/**
 * Check if the function is a use cache function.
 *
 * @param value - The function to check.
 * @returns true if the function is a use cache function, false otherwise.
 */ function isUseCacheFunction(value) {
    if (!isServerReference(value)) {
        return false;
    }
    const { type } = extractInfoFromServerReferenceId(value.$$id);
    return type === 'use-cache';
}
exports.isUseCacheFunction = isUseCacheFunction; //# sourceMappingURL=isUseCacheFunction.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/nextSpan.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/debug-build.js [instrumentation] (ecmascript)");
const isBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/isBuild.js [instrumentation] (ecmascript)");
const isUseCacheFunction = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/isUseCacheFunction.js [instrumentation] (ecmascript)");
function shouldNoopSpan(callback) {
    const isBuildContext = isBuild.isBuild();
    const isUseCacheFunctionContext = callback ? isUseCacheFunction.isUseCacheFunction(callback) : false;
    if (isUseCacheFunctionContext) {
        debugBuild.DEBUG_BUILD && core.debug.log('Skipping span creation in Cache Components context');
    }
    return isBuildContext || isUseCacheFunctionContext;
}
function createNonRecordingSpan() {
    return new core.SentryNonRecordingSpan({
        traceId: '00000000000000000000000000000000',
        spanId: '0000000000000000'
    });
}
/**
 * Next.js-specific implementation of `startSpan` that skips span creation
 * in Cache Components contexts (which render at build time).
 *
 * When in a Cache Components context, we execute the callback with a non-recording span
 * and return early without creating an actual span, since spans don't make sense at build/cache time.
 *
 * @param options - Options for starting the span
 * @param callback - Callback function that receives the span
 * @returns The return value of the callback
 */ function startSpan(options, callback) {
    if (shouldNoopSpan(callback)) {
        return callback(createNonRecordingSpan());
    }
    return core.startSpan(options, callback);
}
/**
 *
 * When in a Cache Components context, we execute the callback with a non-recording span
 * and return early without creating an actual span, since spans don't make sense at build/cache time.
 *
 * @param options - Options for starting the span
 * @param callback - Callback function that receives the span and finish function
 * @returns The return value of the callback
 */ function startSpanManual(options, callback) {
    if (shouldNoopSpan(callback)) {
        const nonRecordingSpan = createNonRecordingSpan();
        return callback(nonRecordingSpan, ()=>nonRecordingSpan.end());
    }
    return core.startSpanManual(options, callback);
}
/**
 *
 * When in a Cache Components context, we return a non-recording span and return early
 * without creating an actual span, since spans don't make sense at build/cache time.
 *
 * @param options - Options for starting the span
 * @returns A non-recording span (in Cache Components context) or the created span
 */ function startInactiveSpan(options) {
    if (shouldNoopSpan()) {
        return createNonRecordingSpan();
    }
    return core.startInactiveSpan(options);
}
exports.startInactiveSpan = startInactiveSpan;
exports.startSpan = startSpan;
exports.startSpanManual = startSpanManual; //# sourceMappingURL=nextSpan.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/wrapperUtils.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const spanAttributesWithLogicAttached = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/span-attributes-with-logic-attached.js [instrumentation] (ecmascript)");
/**
 * Wraps a function that potentially throws. If it does, the error is passed to `captureException` and rethrown.
 *
 * Note: This function turns the wrapped function into an asynchronous one.
 */ // eslint-disable-next-line @typescript-eslint/no-explicit-any
function withErrorInstrumentation(origFunction) {
    return async function(...origFunctionArguments) {
        try {
            return await origFunction.apply(this, origFunctionArguments);
        } catch (e) {
            // TODO: Extract error logic from `withSentry` in here or create a new wrapper with said logic or something like that.
            core.captureException(e, {
                // TODO: check if origFunction.name actually returns the correct name or minified garbage
                // in this case, we can add another argument to this wrapper with the respective function name
                mechanism: {
                    handled: false,
                    type: 'auto.function.nextjs.wrapped',
                    data: {
                        function: origFunction.name
                    }
                }
            });
            throw e;
        }
    };
}
/**
 * Calls a server-side data fetching function (that takes a `req` and `res` object in its context) with tracing
 * instrumentation. A transaction will be created for the incoming request (if it doesn't already exist) in addition to
 * a span for the wrapped data fetching function.
 *
 * All of the above happens in an isolated domain, meaning all thrown errors will be associated with the correct span.
 *
 * @param origDataFetcher The data fetching method to call.
 * @param origFunctionArguments The arguments to call the data fetching method with.
 * @param req The data fetching function's request object.
 * @param res The data fetching function's response object.
 * @param options Options providing details for the created transaction and span.
 * @returns what the data fetching method call returned.
 */ // eslint-disable-next-line @typescript-eslint/no-explicit-any
function withTracedServerSideDataFetcher(origDataFetcher, req, res, options) {
    return async function(...args) {
        const normalizedRequest = core.httpRequestToRequestData(req);
        core.getCurrentScope().setTransactionName(`${options.dataFetchingMethodName} (${options.dataFetcherRouteName})`);
        core.getIsolationScope().setSDKProcessingMetadata({
            normalizedRequest
        });
        const span = core.getActiveSpan();
        // Only set the route backfill if the span is not for /_error
        if (span && options.requestedRouteName !== '/_error') {
            const root = core.getRootSpan(span);
            root.setAttribute(spanAttributesWithLogicAttached.TRANSACTION_ATTR_SENTRY_ROUTE_BACKFILL, options.requestedRouteName);
        }
        const { 'sentry-trace': sentryTrace, baggage } = core.getTraceData();
        return {
            sentryTrace: sentryTrace,
            baggage: baggage,
            data: await origDataFetcher.apply(this, args)
        };
    };
}
/**
 * Call a data fetcher and trace it. Only traces the function if there is an active transaction on the scope.
 *
 * We only do the following until we move transaction creation into this function: When called, the wrapped function
 * will also update the name of the active transaction with a parameterized route provided via the `options` argument.
 */ // eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callDataFetcherTraced(origFunction, origFunctionArgs) {
    try {
        return await origFunction(...origFunctionArgs);
    } catch (e) {
        core.captureException(e, {
            mechanism: {
                handled: false,
                type: 'auto.function.nextjs.data_fetcher'
            }
        });
        throw e;
    }
}
exports.callDataFetcherTraced = callDataFetcherTraced;
exports.withErrorInstrumentation = withErrorInstrumentation;
exports.withTracedServerSideDataFetcher = withTracedServerSideDataFetcher; //# sourceMappingURL=wrapperUtils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapGetStaticPropsWithSentry.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const isBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/isBuild.js [instrumentation] (ecmascript)");
const wrapperUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/wrapperUtils.js [instrumentation] (ecmascript)");
/**
 * Create a wrapped version of the user's exported `getStaticProps` function
 *
 * @param origGetStaticProps The user's `getStaticProps` function
 * @param parameterizedRoute The page's parameterized route
 * @returns A wrapped version of the function
 */ function wrapGetStaticPropsWithSentry(origGetStaticPropsa, _parameterizedRoute) {
    return new Proxy(origGetStaticPropsa, {
        apply: async (wrappingTarget, thisArg, args)=>{
            if (isBuild.isBuild()) {
                return wrappingTarget.apply(thisArg, args);
            }
            const errorWrappedGetStaticProps = wrapperUtils.withErrorInstrumentation(wrappingTarget);
            return wrapperUtils.callDataFetcherTraced(errorWrappedGetStaticProps, args);
        }
    });
}
exports.wrapGetStaticPropsWithSentry = wrapGetStaticPropsWithSentry; //# sourceMappingURL=wrapGetStaticPropsWithSentry.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapGetInitialPropsWithSentry.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const isBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/isBuild.js [instrumentation] (ecmascript)");
const wrapperUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/wrapperUtils.js [instrumentation] (ecmascript)");
/**
 * Create a wrapped version of the user's exported `getInitialProps` function
 *
 * @param origGetInitialProps The user's `getInitialProps` function
 * @param parameterizedRoute The page's parameterized route
 * @returns A wrapped version of the function
 */ function wrapGetInitialPropsWithSentry(origGetInitialProps) {
    return new Proxy(origGetInitialProps, {
        apply: async (wrappingTarget, thisArg, args)=>{
            if (isBuild.isBuild()) {
                return wrappingTarget.apply(thisArg, args);
            }
            const [context] = args;
            const { req, res } = context;
            const errorWrappedGetInitialProps = wrapperUtils.withErrorInstrumentation(wrappingTarget);
            // Generally we can assume that `req` and `res` are always defined on the server:
            // https://nextjs.org/docs/api-reference/data-fetching/get-initial-props#context-object
            // This does not seem to be the case in dev mode. Because we have no clean way of associating the the data fetcher
            // span with each other when there are no req or res objects, we simply do not trace them at all here.
            if (req && res) {
                const tracedGetInitialProps = wrapperUtils.withTracedServerSideDataFetcher(errorWrappedGetInitialProps, req, res, {
                    dataFetcherRouteName: context.pathname,
                    requestedRouteName: context.pathname,
                    dataFetchingMethodName: 'getInitialProps'
                });
                const { data: initialProps, baggage, sentryTrace } = await tracedGetInitialProps.apply(thisArg, args) ?? {}; // Next.js allows undefined to be returned from a getInitialPropsFunction.
                if (typeof initialProps === 'object' && initialProps !== null) {
                    // The Next.js serializer throws on undefined values so we need to guard for it (#12102)
                    if (sentryTrace) {
                        initialProps._sentryTraceData = sentryTrace;
                    }
                    // The Next.js serializer throws on undefined values so we need to guard for it (#12102)
                    if (baggage) {
                        initialProps._sentryBaggage = baggage;
                    }
                }
                return initialProps;
            } else {
                return errorWrappedGetInitialProps.apply(thisArg, args);
            }
        }
    });
}
exports.wrapGetInitialPropsWithSentry = wrapGetInitialPropsWithSentry; //# sourceMappingURL=wrapGetInitialPropsWithSentry.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapAppGetInitialPropsWithSentry.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const isBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/isBuild.js [instrumentation] (ecmascript)");
const wrapperUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/wrapperUtils.js [instrumentation] (ecmascript)");
/**
 * Create a wrapped version of the user's exported `getInitialProps` function in
 * a custom app ("_app.js").
 *
 * @param origAppGetInitialProps The user's `getInitialProps` function
 * @param parameterizedRoute The page's parameterized route
 * @returns A wrapped version of the function
 */ function wrapAppGetInitialPropsWithSentry(origAppGetInitialProps) {
    return new Proxy(origAppGetInitialProps, {
        apply: async (wrappingTarget, thisArg, args)=>{
            if (isBuild.isBuild()) {
                return wrappingTarget.apply(thisArg, args);
            }
            const [context] = args;
            const { req, res } = context.ctx;
            const errorWrappedAppGetInitialProps = wrapperUtils.withErrorInstrumentation(wrappingTarget);
            // Generally we can assume that `req` and `res` are always defined on the server:
            // https://nextjs.org/docs/api-reference/data-fetching/get-initial-props#context-object
            // This does not seem to be the case in dev mode. Because we have no clean way of associating the the data fetcher
            // span with each other when there are no req or res objects, we simply do not trace them at all here.
            if (req && res) {
                const tracedGetInitialProps = wrapperUtils.withTracedServerSideDataFetcher(errorWrappedAppGetInitialProps, req, res, {
                    dataFetcherRouteName: '/_app',
                    requestedRouteName: context.ctx.pathname,
                    dataFetchingMethodName: 'getInitialProps'
                });
                const { data: appGetInitialProps, sentryTrace, baggage } = await tracedGetInitialProps.apply(thisArg, args);
                if (typeof appGetInitialProps === 'object' && appGetInitialProps !== null) {
                    // Per definition, `pageProps` is not optional, however an increased amount of users doesn't seem to call
                    // `App.getInitialProps(appContext)` in their custom `_app` pages which is required as per
                    // https://nextjs.org/docs/advanced-features/custom-app - resulting in missing `pageProps`.
                    // For this reason, we just handle the case where `pageProps` doesn't exist explicitly.
                    if (!appGetInitialProps.pageProps) {
                        appGetInitialProps.pageProps = {};
                    }
                    // The Next.js serializer throws on undefined values so we need to guard for it (#12102)
                    if (sentryTrace) {
                        appGetInitialProps.pageProps._sentryTraceData = sentryTrace;
                    }
                    // The Next.js serializer throws on undefined values so we need to guard for it (#12102)
                    if (baggage) {
                        appGetInitialProps.pageProps._sentryBaggage = baggage;
                    }
                }
                return appGetInitialProps;
            } else {
                return errorWrappedAppGetInitialProps.apply(thisArg, args);
            }
        }
    });
}
exports.wrapAppGetInitialPropsWithSentry = wrapAppGetInitialPropsWithSentry; //# sourceMappingURL=wrapAppGetInitialPropsWithSentry.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapDocumentGetInitialPropsWithSentry.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const isBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/isBuild.js [instrumentation] (ecmascript)");
const wrapperUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/wrapperUtils.js [instrumentation] (ecmascript)");
/**
 * Create a wrapped version of the user's exported `getInitialProps` function in
 * a custom document ("_document.js").
 *
 * @param origDocumentGetInitialProps The user's `getInitialProps` function
 * @param parameterizedRoute The page's parameterized route
 * @returns A wrapped version of the function
 */ function wrapDocumentGetInitialPropsWithSentry(origDocumentGetInitialProps) {
    return new Proxy(origDocumentGetInitialProps, {
        apply: async (wrappingTarget, thisArg, args)=>{
            if (isBuild.isBuild()) {
                return wrappingTarget.apply(thisArg, args);
            }
            const [context] = args;
            const { req, res } = context;
            const errorWrappedGetInitialProps = wrapperUtils.withErrorInstrumentation(wrappingTarget);
            // Generally we can assume that `req` and `res` are always defined on the server:
            // https://nextjs.org/docs/api-reference/data-fetching/get-initial-props#context-object
            // This does not seem to be the case in dev mode. Because we have no clean way of associating the the data fetcher
            // span with each other when there are no req or res objects, we simply do not trace them at all here.
            if (req && res) {
                const tracedGetInitialProps = wrapperUtils.withTracedServerSideDataFetcher(errorWrappedGetInitialProps, req, res, {
                    dataFetcherRouteName: '/_document',
                    requestedRouteName: context.pathname,
                    dataFetchingMethodName: 'getInitialProps'
                });
                const { data } = await tracedGetInitialProps.apply(thisArg, args);
                return data;
            } else {
                return errorWrappedGetInitialProps.apply(thisArg, args);
            }
        }
    });
}
exports.wrapDocumentGetInitialPropsWithSentry = wrapDocumentGetInitialPropsWithSentry; //# sourceMappingURL=wrapDocumentGetInitialPropsWithSentry.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapErrorGetInitialPropsWithSentry.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const isBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/isBuild.js [instrumentation] (ecmascript)");
const wrapperUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/wrapperUtils.js [instrumentation] (ecmascript)");
/**
 * Create a wrapped version of the user's exported `getInitialProps` function in
 * a custom error page ("_error.js").
 *
 * @param origErrorGetInitialProps The user's `getInitialProps` function
 * @param parameterizedRoute The page's parameterized route
 * @returns A wrapped version of the function
 */ function wrapErrorGetInitialPropsWithSentry(origErrorGetInitialProps) {
    return new Proxy(origErrorGetInitialProps, {
        apply: async (wrappingTarget, thisArg, args)=>{
            if (isBuild.isBuild()) {
                return wrappingTarget.apply(thisArg, args);
            }
            const [context] = args;
            const { req, res } = context;
            const errorWrappedGetInitialProps = wrapperUtils.withErrorInstrumentation(wrappingTarget);
            // Generally we can assume that `req` and `res` are always defined on the server:
            // https://nextjs.org/docs/api-reference/data-fetching/get-initial-props#context-object
            // This does not seem to be the case in dev mode. Because we have no clean way of associating the the data fetcher
            // span with each other when there are no req or res objects, we simply do not trace them at all here.
            if (req && res) {
                const tracedGetInitialProps = wrapperUtils.withTracedServerSideDataFetcher(errorWrappedGetInitialProps, req, res, {
                    dataFetcherRouteName: '/_error',
                    requestedRouteName: context.pathname,
                    dataFetchingMethodName: 'getInitialProps'
                });
                const { data: errorGetInitialProps, baggage, sentryTrace } = await tracedGetInitialProps.apply(thisArg, args);
                if (typeof errorGetInitialProps === 'object' && errorGetInitialProps !== null) {
                    if (sentryTrace) {
                        // The Next.js serializer throws on undefined values so we need to guard for it (#12102)
                        errorGetInitialProps._sentryTraceData = sentryTrace;
                    }
                    // The Next.js serializer throws on undefined values so we need to guard for it (#12102)
                    if (baggage) {
                        errorGetInitialProps._sentryBaggage = baggage;
                    }
                }
                return errorGetInitialProps;
            } else {
                return errorWrappedGetInitialProps.apply(thisArg, args);
            }
        }
    });
}
exports.wrapErrorGetInitialPropsWithSentry = wrapErrorGetInitialPropsWithSentry; //# sourceMappingURL=wrapErrorGetInitialPropsWithSentry.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapGetServerSidePropsWithSentry.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const isBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/isBuild.js [instrumentation] (ecmascript)");
const wrapperUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/wrapperUtils.js [instrumentation] (ecmascript)");
/**
 * Create a wrapped version of the user's exported `getServerSideProps` function
 *
 * @param origGetServerSideProps The user's `getServerSideProps` function
 * @param parameterizedRoute The page's parameterized route
 * @returns A wrapped version of the function
 */ function wrapGetServerSidePropsWithSentry(origGetServerSideProps, parameterizedRoute) {
    return new Proxy(origGetServerSideProps, {
        apply: async (wrappingTarget, thisArg, args)=>{
            if (isBuild.isBuild()) {
                return wrappingTarget.apply(thisArg, args);
            }
            const [context] = args;
            const { req, res } = context;
            const errorWrappedGetServerSideProps = wrapperUtils.withErrorInstrumentation(wrappingTarget);
            const tracedGetServerSideProps = wrapperUtils.withTracedServerSideDataFetcher(errorWrappedGetServerSideProps, req, res, {
                dataFetcherRouteName: parameterizedRoute,
                requestedRouteName: parameterizedRoute,
                dataFetchingMethodName: 'getServerSideProps'
            });
            const { data: serverSideProps, baggage, sentryTrace } = await tracedGetServerSideProps.apply(thisArg, args);
            if (typeof serverSideProps === 'object' && serverSideProps !== null && 'props' in serverSideProps) {
                // The Next.js serializer throws on undefined values so we need to guard for it (#12102)
                if (sentryTrace) {
                    serverSideProps.props._sentryTraceData = sentryTrace;
                }
                // The Next.js serializer throws on undefined values so we need to guard for it (#12102)
                if (baggage) {
                    serverSideProps.props._sentryBaggage = baggage;
                }
            }
            return serverSideProps;
        }
    });
}
exports.wrapGetServerSidePropsWithSentry = wrapGetServerSidePropsWithSentry; //# sourceMappingURL=wrapGetServerSidePropsWithSentry.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/nextNavigationErrorUtils.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
/**
 * Determines whether input is a Next.js not-found error.
 * https://beta.nextjs.org/docs/api-reference/notfound#notfound
 */ function isNotFoundNavigationError(subject) {
    return core.isError(subject) && [
        'NEXT_NOT_FOUND',
        'NEXT_HTTP_ERROR_FALLBACK;404'
    ].includes(subject.digest);
}
/**
 * Determines whether input is a Next.js redirect error.
 * https://beta.nextjs.org/docs/api-reference/redirect#redirect
 */ function isRedirectNavigationError(subject) {
    return core.isError(subject) && typeof subject.digest === 'string' && subject.digest.startsWith('NEXT_REDIRECT;') // a redirect digest looks like "NEXT_REDIRECT;[redirect path]"
    ;
}
exports.isNotFoundNavigationError = isNotFoundNavigationError;
exports.isRedirectNavigationError = isRedirectNavigationError; //# sourceMappingURL=nextNavigationErrorUtils.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/wrapServerComponentWithSentry.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const nextNavigationErrorUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/nextNavigationErrorUtils.js [instrumentation] (ecmascript)");
const responseEnd = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/responseEnd.js [instrumentation] (ecmascript)");
/**
 * Wraps an `app` directory server component with Sentry error instrumentation.
 */ // eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapServerComponentWithSentry(appDirComponent, context) {
    // Even though users may define server components as async functions, for the client bundles
    // Next.js will turn them into synchronous functions and it will transform any `await`s into instances of the `use`
    // hook. 🤯
    return new Proxy(appDirComponent, {
        apply: (originalFunction, thisArg, args)=>{
            const isolationScope = core.getIsolationScope();
            const headersDict = context.headers ? core.winterCGHeadersToDict(context.headers) : undefined;
            isolationScope.setSDKProcessingMetadata({
                normalizedRequest: {
                    headers: headersDict
                }
            });
            return core.handleCallbackErrors(()=>originalFunction.apply(thisArg, args), (error)=>{
                const span = core.getActiveSpan();
                const { componentRoute, componentType } = context;
                let shouldCapture = true;
                isolationScope.setTransactionName(`${componentType} Server Component (${componentRoute})`);
                if (span) {
                    if (nextNavigationErrorUtils.isNotFoundNavigationError(error)) {
                        // We don't want to report "not-found"s
                        shouldCapture = false;
                        span.setStatus({
                            code: core.SPAN_STATUS_ERROR,
                            message: 'not_found'
                        });
                    } else if (nextNavigationErrorUtils.isRedirectNavigationError(error)) {
                        // We don't want to report redirects
                        shouldCapture = false;
                        span.setStatus({
                            code: core.SPAN_STATUS_OK
                        });
                    } else {
                        span.setStatus({
                            code: core.SPAN_STATUS_ERROR,
                            message: 'internal_error'
                        });
                    }
                }
                if (shouldCapture) {
                    core.captureException(error, {
                        mechanism: {
                            handled: false,
                            type: 'auto.function.nextjs.server_component'
                        }
                    });
                }
            }, ()=>{
                responseEnd.waitUntil(responseEnd.flushSafelyWithTimeout());
            });
        }
    });
}
exports.wrapServerComponentWithSentry = wrapServerComponentWithSentry; //# sourceMappingURL=wrapServerComponentWithSentry.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/wrapRouteHandlerWithSentry.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const nextNavigationErrorUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/nextNavigationErrorUtils.js [instrumentation] (ecmascript)");
const responseEnd = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/responseEnd.js [instrumentation] (ecmascript)");
const tracingUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/tracingUtils.js [instrumentation] (ecmascript)");
/**
 * Wraps a Next.js App Router Route handler with Sentry error and performance instrumentation.
 *
 * NOTICE: This wrapper is for App Router API routes. If you are looking to wrap Pages Router API routes use `wrapApiHandlerWithSentry` instead.
 */ // eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapRouteHandlerWithSentry(routeHandler, context) {
    const { method, parameterizedRoute, headers } = context;
    return new Proxy(routeHandler, {
        apply: async (originalFunction, thisArg, args)=>{
            const activeSpan = core.getActiveSpan();
            const rootSpan = activeSpan ? core.getRootSpan(activeSpan) : undefined;
            let edgeRuntimeIsolationScopeOverride;
            if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
            ;
            return core.withIsolationScope(("TURBOPACK compile-time falsy", 0) ? "TURBOPACK unreachable" : core.getIsolationScope(), ()=>{
                return core.withScope(async (scope)=>{
                    scope.setTransactionName(`${method} ${parameterizedRoute}`);
                    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
                    ;
                    const response = await core.handleCallbackErrors(()=>originalFunction.apply(thisArg, args), (error)=>{
                        // Next.js throws errors when calling `redirect()`. We don't wanna report these.
                        if (nextNavigationErrorUtils.isRedirectNavigationError(error)) ;
                        else if (nextNavigationErrorUtils.isNotFoundNavigationError(error)) {
                            if (activeSpan) {
                                core.setHttpStatus(activeSpan, 404);
                            }
                            if (rootSpan) {
                                core.setHttpStatus(rootSpan, 404);
                            }
                        } else {
                            core.captureException(error, {
                                mechanism: {
                                    handled: false,
                                    type: 'auto.function.nextjs.route_handler'
                                }
                            });
                        }
                    }, ()=>{
                        responseEnd.waitUntil(responseEnd.flushSafelyWithTimeout());
                    });
                    try {
                        if (response.status) {
                            if (activeSpan) {
                                core.setHttpStatus(activeSpan, response.status);
                            }
                            if (rootSpan) {
                                core.setHttpStatus(rootSpan, response.status);
                            }
                        }
                    } catch  {
                    // best effort - response may be undefined?
                    }
                    return response;
                });
            });
        }
    });
}
exports.wrapRouteHandlerWithSentry = wrapRouteHandlerWithSentry; //# sourceMappingURL=wrapRouteHandlerWithSentry.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapApiHandlerWithSentryVercelCrons.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
/**
 * Wraps a function with Sentry crons instrumentation by automatically sending check-ins for the given Vercel crons config.
 */ // eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapApiHandlerWithSentryVercelCrons(handler, vercelCronsConfig) {
    return new Proxy(handler, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apply: (originalFunction, thisArg, args)=>{
            if (!args?.[0]) {
                return originalFunction.apply(thisArg, args);
            }
            const [req] = args;
            let maybePromiseResult;
            const cronsKey = 'nextUrl' in req ? req.nextUrl.pathname : req.url;
            const userAgentHeader = 'nextUrl' in req ? req.headers.get('user-agent') : req.headers['user-agent'];
            if (!vercelCronsConfig || // do nothing if vercel crons config is missing
            !userAgentHeader?.includes('vercel-cron') // do nothing if endpoint is not called from vercel crons
            ) {
                return originalFunction.apply(thisArg, args);
            }
            const vercelCron = vercelCronsConfig.find((vercelCron)=>vercelCron.path === cronsKey);
            if (!vercelCron?.path || !vercelCron.schedule) {
                return originalFunction.apply(thisArg, args);
            }
            const monitorSlug = vercelCron.path;
            const checkInId = core.captureCheckIn({
                monitorSlug,
                status: 'in_progress'
            }, {
                maxRuntime: 60 * 12,
                schedule: {
                    type: 'crontab',
                    value: vercelCron.schedule
                }
            });
            const startTime = core._INTERNAL_safeDateNow() / 1000;
            const handleErrorCase = ()=>{
                core.captureCheckIn({
                    checkInId,
                    monitorSlug,
                    status: 'error',
                    duration: core._INTERNAL_safeDateNow() / 1000 - startTime
                });
            };
            try {
                maybePromiseResult = originalFunction.apply(thisArg, args);
            } catch (e) {
                handleErrorCase();
                throw e;
            }
            if (typeof maybePromiseResult === 'object' && maybePromiseResult !== null && 'then' in maybePromiseResult) {
                Promise.resolve(maybePromiseResult).then(()=>{
                    core.captureCheckIn({
                        checkInId,
                        monitorSlug,
                        status: 'ok',
                        duration: core._INTERNAL_safeDateNow() / 1000 - startTime
                    });
                }, ()=>{
                    handleErrorCase();
                });
                // It is very important that we return the original promise here, because Next.js attaches various properties
                // to that promise and will throw if they are not on the returned value.
                return maybePromiseResult;
            } else {
                core.captureCheckIn({
                    checkInId,
                    monitorSlug,
                    status: 'ok',
                    duration: core._INTERNAL_safeDateNow() / 1000 - startTime
                });
                return maybePromiseResult;
            }
        }
    });
}
exports.wrapApiHandlerWithSentryVercelCrons = wrapApiHandlerWithSentryVercelCrons; //# sourceMappingURL=wrapApiHandlerWithSentryVercelCrons.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/wrapMiddlewareWithSentry.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const responseEnd = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/responseEnd.js [instrumentation] (ecmascript)");
/**
 * Wraps Next.js middleware with Sentry error and performance instrumentation.
 *
 * @param middleware The middleware handler.
 * @returns a wrapped middleware handler.
 */ function wrapMiddlewareWithSentry(middleware) {
    return new Proxy(middleware, {
        apply: async (wrappingTarget, thisArg, args)=>{
            const tunnelRoute = '_sentryRewritesTunnelPath' in globalThis ? globalThis._sentryRewritesTunnelPath : undefined;
            if (tunnelRoute && typeof tunnelRoute === 'string') {
                const req = args[0];
                // Check if the current request matches the tunnel route
                if (req instanceof Request) {
                    const url = new URL(req.url);
                    const isTunnelRequest = url.pathname.startsWith(tunnelRoute);
                    if (isTunnelRequest) {
                        // Create a simple response that mimics NextResponse.next() so we don't need to import internals here
                        // which breaks next 13 apps
                        // https://github.com/vercel/next.js/blob/c12c9c1f78ad384270902f0890dc4cd341408105/packages/next/src/server/web/spec-extension/response.ts#L146
                        return new Response(null, {
                            status: 200,
                            headers: {
                                'x-middleware-next': '1'
                            }
                        });
                    }
                }
            }
            // TODO: We still should add central isolation scope creation for when our build-time instrumentation does not work anymore with turbopack.
            return core.withIsolationScope((isolationScope)=>{
                const req = args[0];
                const currentScope = core.getCurrentScope();
                let spanName;
                let spanSource;
                if (req instanceof Request) {
                    isolationScope.setSDKProcessingMetadata({
                        normalizedRequest: core.winterCGRequestToRequestData(req)
                    });
                    spanName = `middleware ${req.method}`;
                    spanSource = 'url';
                } else {
                    spanName = 'middleware';
                    spanSource = 'component';
                }
                currentScope.setTransactionName(spanName);
                const activeSpan = core.getActiveSpan();
                if (activeSpan) {
                    // If there is an active span, it likely means that the automatic Next.js OTEL instrumentation worked and we can
                    // rely on that for parameterization.
                    spanName = 'middleware';
                    spanSource = 'component';
                    const rootSpan = core.getRootSpan(activeSpan);
                    if (rootSpan) {
                        core.setCapturedScopesOnSpan(rootSpan, currentScope, isolationScope);
                    }
                }
                return core.startSpan({
                    name: spanName,
                    op: 'http.server.middleware',
                    attributes: {
                        [core.SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: spanSource,
                        [core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.function.nextjs.wrap_middleware'
                    }
                }, ()=>{
                    return core.handleCallbackErrors(()=>wrappingTarget.apply(thisArg, args), (error)=>{
                        core.captureException(error, {
                            mechanism: {
                                type: 'auto.function.nextjs.wrap_middleware',
                                handled: false
                            }
                        });
                    }, ()=>{
                        responseEnd.waitUntil(responseEnd.flushSafelyWithTimeout());
                    });
                });
            });
        }
    });
}
exports.wrapMiddlewareWithSentry = wrapMiddlewareWithSentry; //# sourceMappingURL=wrapMiddlewareWithSentry.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapPageComponentWithSentry.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
function isReactClassComponent(target) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return typeof target === 'function' && target?.prototype?.isReactComponent;
}
/**
 * Wraps a page component with Sentry error instrumentation.
 */ function wrapPageComponentWithSentry(pageComponent) {
    if (isReactClassComponent(pageComponent)) {
        return class SentryWrappedPageComponent extends pageComponent {
            render(...args) {
                return core.withIsolationScope(()=>{
                    const scope = core.getCurrentScope();
                    // We extract the sentry trace data that is put in the component props by datafetcher wrappers
                    const sentryTraceData = typeof this.props === 'object' && this.props !== null && '_sentryTraceData' in this.props && typeof this.props._sentryTraceData === 'string' ? this.props._sentryTraceData : undefined;
                    if (sentryTraceData) {
                        const traceparentData = core.extractTraceparentData(sentryTraceData);
                        scope.setContext('trace', {
                            span_id: traceparentData?.parentSpanId,
                            trace_id: traceparentData?.traceId
                        });
                    }
                    try {
                        return super.render(...args);
                    } catch (e) {
                        core.captureException(e, {
                            mechanism: {
                                handled: false,
                                type: 'auto.function.nextjs.page_class'
                            }
                        });
                        throw e;
                    }
                });
            }
        };
    } else if (typeof pageComponent === 'function') {
        return new Proxy(pageComponent, {
            apply (target, thisArg, argArray) {
                return core.withIsolationScope(()=>{
                    const scope = core.getCurrentScope();
                    // We extract the sentry trace data that is put in the component props by datafetcher wrappers
                    const sentryTraceData = argArray?.[0]?._sentryTraceData;
                    if (sentryTraceData) {
                        const traceparentData = core.extractTraceparentData(sentryTraceData);
                        scope.setContext('trace', {
                            span_id: traceparentData?.parentSpanId,
                            trace_id: traceparentData?.traceId
                        });
                    }
                    try {
                        return target.apply(thisArg, argArray);
                    } catch (e) {
                        core.captureException(e, {
                            mechanism: {
                                handled: false,
                                type: 'auto.function.nextjs.page_function'
                            }
                        });
                        throw e;
                    }
                });
            }
        });
    } else {
        return pageComponent;
    }
}
exports.wrapPageComponentWithSentry = wrapPageComponentWithSentry; //# sourceMappingURL=wrapPageComponentWithSentry.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/wrapGenerationFunctionWithSentry.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const nextNavigationErrorUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/nextNavigationErrorUtils.js [instrumentation] (ecmascript)");
const responseEnd = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/responseEnd.js [instrumentation] (ecmascript)");
/**
 * Wraps a generation function (e.g. generateMetadata) with Sentry error instrumentation.
 */ // eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapGenerationFunctionWithSentry(generationFunction, context) {
    return new Proxy(generationFunction, {
        apply: (originalFunction, thisArg, args)=>{
            const isolationScope = core.getIsolationScope();
            let headers = undefined;
            // We try-catch here just in case anything goes wrong with the async storage since it is Next.js internal API
            try {
                headers = context.requestAsyncStorage?.getStore()?.headers;
            } catch  {
            /** empty */ }
            const headersDict = headers ? core.winterCGHeadersToDict(headers) : undefined;
            isolationScope.setSDKProcessingMetadata({
                normalizedRequest: {
                    headers: headersDict
                }
            });
            return core.handleCallbackErrors(()=>originalFunction.apply(thisArg, args), (error)=>{
                const span = core.getActiveSpan();
                const { componentRoute, componentType, generationFunctionIdentifier } = context;
                let shouldCapture = true;
                isolationScope.setTransactionName(`${componentType}.${generationFunctionIdentifier} (${componentRoute})`);
                if (span) {
                    if (nextNavigationErrorUtils.isNotFoundNavigationError(error)) {
                        // We don't want to report "not-found"s
                        shouldCapture = false;
                        span.setStatus({
                            code: core.SPAN_STATUS_ERROR,
                            message: 'not_found'
                        });
                    } else if (nextNavigationErrorUtils.isRedirectNavigationError(error)) {
                        // We don't want to report redirects
                        shouldCapture = false;
                        span.setStatus({
                            code: core.SPAN_STATUS_OK
                        });
                    } else {
                        span.setStatus({
                            code: core.SPAN_STATUS_ERROR,
                            message: 'internal_error'
                        });
                    }
                }
                if (shouldCapture) {
                    core.captureException(error, {
                        mechanism: {
                            handled: false,
                            type: 'auto.function.nextjs.generation_function',
                            data: {
                                function: generationFunctionIdentifier
                            }
                        }
                    });
                }
            }, ()=>{
                responseEnd.waitUntil(responseEnd.flushSafelyWithTimeout());
            });
        }
    });
}
exports.wrapGenerationFunctionWithSentry = wrapGenerationFunctionWithSentry; //# sourceMappingURL=wrapGenerationFunctionWithSentry.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/withServerActionInstrumentation.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const responseEnd = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/responseEnd.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/debug-build.js [instrumentation] (ecmascript)");
const nextNavigationErrorUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/nextNavigationErrorUtils.js [instrumentation] (ecmascript)");
/**
 * Wraps a Next.js Server Action implementation with Sentry Error and Performance instrumentation.
 */ function withServerActionInstrumentation(...args) {
    if (typeof args[1] === 'function') {
        const [serverActionName, callback] = args;
        return withServerActionInstrumentationImplementation(serverActionName, {}, callback);
    } else {
        const [serverActionName, options, callback] = args;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return withServerActionInstrumentationImplementation(serverActionName, options, callback);
    }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withServerActionInstrumentationImplementation(serverActionName, options, callback) {
    return core.withIsolationScope(async (isolationScope)=>{
        const sendDefaultPii = core.getClient()?.getOptions().sendDefaultPii;
        let sentryTraceHeader;
        let baggageHeader;
        const fullHeadersObject = {};
        try {
            const awaitedHeaders = await options.headers;
            sentryTraceHeader = awaitedHeaders?.get('sentry-trace') ?? undefined;
            baggageHeader = awaitedHeaders?.get('baggage');
            awaitedHeaders?.forEach((value, key)=>{
                fullHeadersObject[key] = value;
            });
        } catch  {
            debugBuild.DEBUG_BUILD && core.debug.warn("Sentry wasn't able to extract the tracing headers for a server action. Will not trace this request.");
        }
        isolationScope.setTransactionName(`serverAction/${serverActionName}`);
        isolationScope.setSDKProcessingMetadata({
            normalizedRequest: {
                headers: fullHeadersObject
            }
        });
        // Normally, there is an active span here (from Next.js OTEL) and we just use that as parent
        // Else, we manually continueTrace from the incoming headers
        const continueTraceIfNoActiveSpan = core.getActiveSpan() ? (_opts, callback)=>callback() : core.continueTrace;
        return continueTraceIfNoActiveSpan({
            sentryTrace: sentryTraceHeader,
            baggage: baggageHeader
        }, async ()=>{
            try {
                return await core.startSpan({
                    op: 'function.server_action',
                    name: `serverAction/${serverActionName}`,
                    forceTransaction: true,
                    attributes: {
                        [core.SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'route',
                        [core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.function.nextjs.server_action'
                    }
                }, async (span)=>{
                    const result = await core.handleCallbackErrors(callback, (error)=>{
                        if (nextNavigationErrorUtils.isNotFoundNavigationError(error)) {
                            // We don't want to report "not-found"s
                            span.setStatus({
                                code: core.SPAN_STATUS_ERROR,
                                message: 'not_found'
                            });
                        } else if (nextNavigationErrorUtils.isRedirectNavigationError(error)) {
                        // Don't do anything for redirects
                        } else {
                            span.setStatus({
                                code: core.SPAN_STATUS_ERROR,
                                message: 'internal_error'
                            });
                            core.captureException(error, {
                                mechanism: {
                                    handled: false,
                                    type: 'auto.function.nextjs.server_action'
                                }
                            });
                        }
                    });
                    if (options.recordResponse !== undefined ? options.recordResponse : sendDefaultPii) {
                        core.getIsolationScope().setExtra('server_action_result', result);
                    }
                    if (options.formData) {
                        options.formData.forEach((value, key)=>{
                            core.getIsolationScope().setExtra(`server_action_form_data.${key}`, typeof value === 'string' ? value : '[non-string value]');
                        });
                    }
                    return result;
                });
            } finally{
                responseEnd.waitUntil(responseEnd.flushSafelyWithTimeout());
            }
        });
    });
}
exports.withServerActionInstrumentation = withServerActionInstrumentation; //# sourceMappingURL=withServerActionInstrumentation.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/captureRequestError.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const responseEnd = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/responseEnd.js [instrumentation] (ecmascript)");
/**
 * Reports errors passed to the the Next.js `onRequestError` instrumentation hook.
 */ function captureRequestError(error, request, errorContext) {
    core.withScope((scope)=>{
        scope.setSDKProcessingMetadata({
            normalizedRequest: {
                headers: core.headersToDict(request.headers),
                method: request.method
            }
        });
        scope.setContext('nextjs', {
            request_path: request.path,
            router_kind: errorContext.routerKind,
            router_path: errorContext.routePath,
            route_type: errorContext.routeType
        });
        scope.setTransactionName(`${request.method} ${errorContext.routePath}`);
        core.captureException(error, {
            mechanism: {
                handled: false,
                type: 'auto.function.nextjs.on_request_error'
            }
        });
        responseEnd.waitUntil(responseEnd.flushSafelyWithTimeout());
    });
}
exports.captureRequestError = captureRequestError; //# sourceMappingURL=captureRequestError.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapApiHandlerWithSentry.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const responseEnd = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/responseEnd.js [instrumentation] (ecmascript)");
const tracingUtils = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/tracingUtils.js [instrumentation] (ecmascript)");
/**
 * Wrap the given API route handler with error nad performance monitoring.
 *
 * @param apiHandler The handler exported from the user's API page route file, which may or may not already be
 * wrapped with `withSentry`
 * @param parameterizedRoute The page's parameterized route.
 * @returns The wrapped handler which will always return a Promise.
 */ function wrapApiHandlerWithSentry(apiHandler, parameterizedRoute) {
    return new Proxy(apiHandler, {
        apply: (wrappingTarget, thisArg, args)=>{
            tracingUtils.dropNextjsRootContext();
            return tracingUtils.escapeNextjsTracing(()=>{
                const [req, res] = args;
                if (!req) {
                    core.debug.log(`Wrapped API handler on route "${parameterizedRoute}" was not passed a request object. Will not instrument.`);
                    return wrappingTarget.apply(thisArg, args);
                } else if (!res) {
                    core.debug.log(`Wrapped API handler on route "${parameterizedRoute}" was not passed a response object. Will not instrument.`);
                    return wrappingTarget.apply(thisArg, args);
                }
                // Prevent double wrapping of the same request.
                if (req.__withSentry_applied__) {
                    return wrappingTarget.apply(thisArg, args);
                }
                req.__withSentry_applied__ = true;
                return core.withIsolationScope((isolationScope)=>{
                    // Normally, there is an active span here (from Next.js OTEL) and we just use that as parent
                    // Else, we manually continueTrace from the incoming headers
                    const continueTraceIfNoActiveSpan = core.getActiveSpan() ? (_opts, callback)=>callback() : core.continueTrace;
                    return continueTraceIfNoActiveSpan({
                        sentryTrace: req.headers && core.isString(req.headers['sentry-trace']) ? req.headers['sentry-trace'] : undefined,
                        baggage: req.headers?.baggage
                    }, ()=>{
                        const reqMethod = `${(req.method || 'GET').toUpperCase()} `;
                        const normalizedRequest = core.httpRequestToRequestData(req);
                        isolationScope.setSDKProcessingMetadata({
                            normalizedRequest
                        });
                        isolationScope.setTransactionName(`${reqMethod}${parameterizedRoute}`);
                        return core.startSpanManual({
                            name: `${reqMethod}${parameterizedRoute}`,
                            op: 'http.server',
                            forceTransaction: true,
                            attributes: {
                                [core.SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'route',
                                [core.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.http.nextjs'
                            }
                        }, async (span)=>{
                            // eslint-disable-next-line @typescript-eslint/unbound-method
                            res.end = new Proxy(res.end, {
                                apply (target, thisArg, argArray) {
                                    core.setHttpStatus(span, res.statusCode);
                                    span.end();
                                    responseEnd.waitUntil(responseEnd.flushSafelyWithTimeout());
                                    return target.apply(thisArg, argArray);
                                }
                            });
                            try {
                                return await wrappingTarget.apply(thisArg, args);
                            } catch (e) {
                                // In case we have a primitive, wrap it in the equivalent wrapper class (string -> String, etc.) so that we can
                                // store a seen flag on it. (Because of the one-way-on-Vercel-one-way-off-of-Vercel approach we've been forced
                                // to take, it can happen that the same thrown object gets caught in two different ways, and flagging it is a
                                // way to prevent it from actually being reported twice.)
                                const objectifiedErr = core.objectify(e);
                                core.captureException(objectifiedErr, {
                                    mechanism: {
                                        type: 'auto.http.nextjs.api_handler',
                                        handled: false,
                                        data: {
                                            wrapped_handler: wrappingTarget.name,
                                            function: 'withSentry'
                                        }
                                    }
                                });
                                core.setHttpStatus(span, 500);
                                span.end();
                                // we need to await the flush here to ensure that the error is captured
                                // as the runtime freezes as soon as the error is thrown below
                                await responseEnd.flushSafelyWithTimeout();
                                // We rethrow here so that nextjs can do with the error whatever it would normally do. (Sometimes "whatever it
                                // would normally do" is to allow the error to bubble up to the global handlers - another reason we need to mark
                                // the error as already having been captured.)
                                throw objectifiedErr;
                            }
                        });
                    });
                });
            });
        }
    });
}
exports.wrapApiHandlerWithSentry = wrapApiHandlerWithSentry; //# sourceMappingURL=wrapApiHandlerWithSentry.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/server/index.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const semanticConventions = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@opentelemetry/semantic-conventions/build/esm/index.js [instrumentation] (ecmascript)");
const core = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/core/build/cjs/index.js [instrumentation] (ecmascript)");
const node = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node/build/cjs/index.js [instrumentation] (ecmascript)");
const debugBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/debug-build.js [instrumentation] (ecmascript)");
const devErrorSymbolicationEventProcessor = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/devErrorSymbolicationEventProcessor.js [instrumentation] (ecmascript)");
const getVercelEnv = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/getVercelEnv.js [instrumentation] (ecmascript)");
const nextSpanAttributes = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/nextSpanAttributes.js [instrumentation] (ecmascript)");
const spanAttributesWithLogicAttached = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/span-attributes-with-logic-attached.js [instrumentation] (ecmascript)");
const isBuild = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/isBuild.js [instrumentation] (ecmascript)");
const responseEnd = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/responseEnd.js [instrumentation] (ecmascript)");
const setUrlProcessingMetadata = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/setUrlProcessingMetadata.js [instrumentation] (ecmascript)");
const distDirRewriteFramesIntegration = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/server/distDirRewriteFramesIntegration.js [instrumentation] (ecmascript)");
const handleOnSpanStart = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/server/handleOnSpanStart.js [instrumentation] (ecmascript)");
const prepareSafeIdGeneratorContext = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/server/prepareSafeIdGeneratorContext.js [instrumentation] (ecmascript)");
const vercelCronsMonitoring = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/server/vercelCronsMonitoring.js [instrumentation] (ecmascript)");
const _error = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/_error.js [instrumentation] (ecmascript)");
const nextSpan = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/nextSpan.js [instrumentation] (ecmascript)");
const wrapGetStaticPropsWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapGetStaticPropsWithSentry.js [instrumentation] (ecmascript)");
const wrapGetInitialPropsWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapGetInitialPropsWithSentry.js [instrumentation] (ecmascript)");
const wrapAppGetInitialPropsWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapAppGetInitialPropsWithSentry.js [instrumentation] (ecmascript)");
const wrapDocumentGetInitialPropsWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapDocumentGetInitialPropsWithSentry.js [instrumentation] (ecmascript)");
const wrapErrorGetInitialPropsWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapErrorGetInitialPropsWithSentry.js [instrumentation] (ecmascript)");
const wrapGetServerSidePropsWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapGetServerSidePropsWithSentry.js [instrumentation] (ecmascript)");
const wrapServerComponentWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/wrapServerComponentWithSentry.js [instrumentation] (ecmascript)");
const wrapRouteHandlerWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/wrapRouteHandlerWithSentry.js [instrumentation] (ecmascript)");
const wrapApiHandlerWithSentryVercelCrons = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapApiHandlerWithSentryVercelCrons.js [instrumentation] (ecmascript)");
const wrapMiddlewareWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/wrapMiddlewareWithSentry.js [instrumentation] (ecmascript)");
const wrapPageComponentWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapPageComponentWithSentry.js [instrumentation] (ecmascript)");
const wrapGenerationFunctionWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/wrapGenerationFunctionWithSentry.js [instrumentation] (ecmascript)");
const withServerActionInstrumentation = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/withServerActionInstrumentation.js [instrumentation] (ecmascript)");
const captureRequestError = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/captureRequestError.js [instrumentation] (ecmascript)");
const wrapApiHandlerWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapApiHandlerWithSentry.js [instrumentation] (ecmascript)");
// import/export got a false positive, and affects most of our index barrel files
// can be removed once following issue is fixed: https://github.com/import-js/eslint-plugin-import/issues/703
/* eslint-disable import/export */ const globalWithInjectedValues = core.GLOBAL_OBJ;
/**
 * A passthrough error boundary for the server that doesn't depend on any react. Error boundaries don't catch SSR errors
 * so they should simply be a passthrough.
 */ const ErrorBoundary = (props)=>{
    if (!props.children) {
        return null;
    }
    if (typeof props.children === 'function') {
        return props.children();
    }
    // since Next.js >= 10 requires React ^16.6.0 we are allowed to return children like this here
    return props.children;
};
/**
 * A passthrough redux enhancer for the server that doesn't depend on anything from the `@sentry/react` package.
 */ function createReduxEnhancer() {
    return (createStore)=>createStore;
}
/**
 * A passthrough error boundary wrapper for the server that doesn't depend on any react. Error boundaries don't catch
 * SSR errors so they should simply be a passthrough.
 */ // eslint-disable-next-line @typescript-eslint/no-explicit-any
function withErrorBoundary(WrappedComponent) {
    return WrappedComponent;
}
/**
 * Just a passthrough since we're on the server and showing the report dialog on the server doesn't make any sense.
 */ function showReportDialog() {
    return;
}
/**
 * Returns the runtime configuration for the SDK based on the environment.
 * When running on OpenNext/Cloudflare, returns cloudflare runtime config.
 */ function getCloudflareRuntimeConfig() {
    if (responseEnd.isCloudflareWaitUntilAvailable()) {
        // todo: add version information?
        return {
            runtime: {
                name: 'cloudflare'
            }
        };
    }
    return undefined;
}
/** Inits the Sentry NextJS SDK on node. */ // eslint-disable-next-line complexity
function init(options) {
    prepareSafeIdGeneratorContext.prepareSafeIdGeneratorContext();
    if (isBuild.isBuild()) {
        return;
    }
    if (!debugBuild.DEBUG_BUILD && options.debug) {
        // eslint-disable-next-line no-console
        console.warn('[@sentry/nextjs] You have enabled `debug: true`, but Sentry debug logging was removed from your bundle (likely via `withSentryConfig({ disableLogger: true })` / `webpack.treeshake.removeDebugLogging: true`). Set that option to `false` to see Sentry debug output.');
    }
    const customDefaultIntegrations = node.getDefaultIntegrations(options).filter((integration)=>integration.name !== 'Http').concat(// We are using the HTTP integration without instrumenting incoming HTTP requests because Next.js does that by itself.
    node.httpIntegration({
        disableIncomingRequestSpans: true
    }));
    // Turn off Next.js' own fetch instrumentation (only when we manage OTEL)
    // https://github.com/lforst/nextjs-fork/blob/1994fd186defda77ad971c36dc3163db263c993f/packages/next/src/server/lib/patch-fetch.ts#L245
    // Enable with custom OTel setup: https://github.com/getsentry/sentry-javascript/issues/17581
    if (!options.skipOpenTelemetrySetup) {
        process.env.NEXT_OTEL_FETCH_DISABLED = '1';
    }
    // This value is injected at build time, based on the output directory specified in the build config. Though a default
    // is set there, we set it here as well, just in case something has gone wrong with the injection.
    const distDirName = ("TURBOPACK compile-time value", ".next") || globalWithInjectedValues._sentryRewriteFramesDistDir;
    if ("TURBOPACK compile-time truthy", 1) {
        customDefaultIntegrations.push(distDirRewriteFramesIntegration.distDirRewriteFramesIntegration({
            distDirName
        }));
    }
    // Detect if running on OpenNext/Cloudflare and get runtime config
    const cloudflareConfig = getCloudflareRuntimeConfig();
    const opts = {
        environment: options.environment || process.env.SENTRY_ENVIRONMENT || getVercelEnv.getVercelEnv(false) || ("TURBOPACK compile-time value", "development"),
        release: ("TURBOPACK compile-time value", "f77c34005cf7212cf9e4ebdc5143587e9dbea7ca") || globalWithInjectedValues._sentryRelease,
        defaultIntegrations: customDefaultIntegrations,
        ...options,
        // Override runtime to 'cloudflare' when running on OpenNext/Cloudflare
        ...cloudflareConfig
    };
    if (debugBuild.DEBUG_BUILD && opts.debug) {
        core.debug.enable();
    }
    debugBuild.DEBUG_BUILD && core.debug.log('Initializing SDK...');
    if (sdkAlreadyInitialized()) {
        debugBuild.DEBUG_BUILD && core.debug.log('SDK already initialized');
        return;
    }
    // Use appropriate SDK metadata based on the runtime environment
    core.applySdkMetadata(opts, 'nextjs', [
        'nextjs',
        cloudflareConfig ? 'cloudflare' : 'node'
    ]);
    const client = node.init(opts);
    client?.on('beforeSampling', ({ spanAttributes }, samplingDecision)=>{
        // There are situations where the Next.js Node.js server forwards requests for the Edge Runtime server (e.g. in
        // middleware) and this causes spans for Sentry ingest requests to be created. These are not exempt from our tracing
        // because we didn't get the chance to do `suppressTracing`, since this happens outside of userland.
        // We need to drop these spans.
        if (// eslint-disable-next-line deprecation/deprecation
        typeof spanAttributes[semanticConventions.SEMATTRS_HTTP_TARGET] === 'string' && // eslint-disable-next-line deprecation/deprecation
        spanAttributes[semanticConventions.SEMATTRS_HTTP_TARGET].includes('sentry_key') && // eslint-disable-next-line deprecation/deprecation
        spanAttributes[semanticConventions.SEMATTRS_HTTP_TARGET].includes('sentry_client') || typeof spanAttributes[semanticConventions.ATTR_URL_QUERY] === 'string' && spanAttributes[semanticConventions.ATTR_URL_QUERY].includes('sentry_key') && spanAttributes[semanticConventions.ATTR_URL_QUERY].includes('sentry_client')) {
            samplingDecision.decision = false;
        }
    });
    client?.on('spanStart', handleOnSpanStart.handleOnSpanStart);
    client?.on('spanEnd', vercelCronsMonitoring.maybeCompleteCronCheckIn);
    core.getGlobalScope().addEventProcessor(Object.assign((event)=>{
        if (event.type === 'transaction') {
            // Filter out transactions for static assets
            // This regex matches the default path to the static assets (`_next/static`) and could potentially filter out too many transactions.
            // We match `/_next/static/` anywhere in the transaction name because its location may change with the basePath setting.
            if (event.transaction?.match(/^GET (\/.*)?\/_next\/static\//)) {
                return null;
            }
            // Filter out transactions for requests to the tunnel route
            if (globalWithInjectedValues._sentryRewritesTunnelPath && event.transaction === `POST ${globalWithInjectedValues._sentryRewritesTunnelPath}` || ("TURBOPACK compile-time value", "/monitoring") && event.transaction === `POST ${"TURBOPACK compile-time value", "/monitoring"}`) {
                return null;
            }
            // Filter out requests to resolve source maps for stack frames in dev mode
            if (event.transaction?.match(/\/__nextjs_original-stack-frame/)) {
                return null;
            }
            // Filter out /404 transactions which seem to be created excessively
            if (// Pages router
            event.transaction === '/404' || // App router (could be "GET /404", "POST /404", ...)
            event.transaction?.match(/^(GET|HEAD|POST|PUT|DELETE|CONNECT|OPTIONS|TRACE|PATCH) \/(404|_not-found)$/)) {
                return null;
            }
            // Filter transactions that we explicitly want to drop.
            if (event.contexts?.trace?.data?.[spanAttributesWithLogicAttached.TRANSACTION_ATTR_SHOULD_DROP_TRANSACTION]) {
                return null;
            }
            // Next.js 13 sometimes names the root transactions like this containing useless tracing.
            if (event.transaction === 'NextServer.getRequestHandler') {
                return null;
            }
            // Next.js 13 is not correctly picking up tracing data for trace propagation so we use a back-fill strategy
            if (typeof event.contexts?.trace?.data?.[spanAttributesWithLogicAttached.TRANSACTION_ATTR_SENTRY_TRACE_BACKFILL] === 'string') {
                const traceparentData = core.extractTraceparentData(event.contexts.trace.data[spanAttributesWithLogicAttached.TRANSACTION_ATTR_SENTRY_TRACE_BACKFILL]);
                if (traceparentData?.parentSampled === false) {
                    return null;
                }
            }
            return event;
        } else {
            return event;
        }
    }, {
        id: 'NextLowQualityTransactionsFilter'
    }));
    core.getGlobalScope().addEventProcessor(Object.assign((event, hint)=>{
        if (event.type !== undefined) {
            return event;
        }
        const originalException = hint.originalException;
        const isPostponeError = typeof originalException === 'object' && originalException !== null && '$$typeof' in originalException && originalException.$$typeof === Symbol.for('react.postpone');
        if (isPostponeError) {
            // Postpone errors are used for partial-pre-rendering (PPR)
            return null;
        }
        // We don't want to capture suspense errors as they are simply used by React/Next.js for control flow
        const exceptionMessage = event.exception?.values?.[0]?.value;
        if (exceptionMessage?.includes('Suspense Exception: This is not a real error!') || exceptionMessage?.includes('Suspense Exception: This is not a real error, and should not leak')) {
            return null;
        }
        return event;
    }, {
        id: 'DropReactControlFlowErrors'
    }));
    // Use the preprocessEvent hook instead of an event processor, so that the users event processors receive the most
    // up-to-date value, but also so that the logic that detects changes to the transaction names to set the source to
    // "custom", doesn't trigger.
    client?.on('preprocessEvent', (event)=>{
        // Enhance route handler transactions
        if (event.type === 'transaction' && event.contexts?.trace?.data?.[nextSpanAttributes.ATTR_NEXT_SPAN_TYPE] === 'BaseServer.handleRequest') {
            event.contexts.trace.data[core.SEMANTIC_ATTRIBUTE_SENTRY_OP] = 'http.server';
            event.contexts.trace.op = 'http.server';
            if (event.transaction) {
                event.transaction = core.stripUrlQueryAndFragment(event.transaction);
            }
            // eslint-disable-next-line deprecation/deprecation
            const method = event.contexts.trace.data[semanticConventions.SEMATTRS_HTTP_METHOD];
            // eslint-disable-next-line deprecation/deprecation
            const target = event.contexts?.trace?.data?.[semanticConventions.SEMATTRS_HTTP_TARGET];
            const route = event.contexts.trace.data[semanticConventions.ATTR_HTTP_ROUTE] || event.contexts.trace.data[nextSpanAttributes.ATTR_NEXT_ROUTE];
            const spanName = event.contexts.trace.data[nextSpanAttributes.ATTR_NEXT_SPAN_NAME];
            if (typeof method === 'string' && typeof route === 'string' && !route.startsWith('middleware')) {
                const cleanRoute = route.replace(/\/route$/, '');
                event.transaction = `${method} ${cleanRoute}`;
                event.contexts.trace.data[core.SEMANTIC_ATTRIBUTE_SENTRY_SOURCE] = 'route';
                // Preserve next.route in case it did not get hoisted
                event.contexts.trace.data[nextSpanAttributes.ATTR_NEXT_ROUTE] = cleanRoute;
            }
            // backfill transaction name for pages that would otherwise contain unparameterized routes
            if (event.contexts.trace.data[spanAttributesWithLogicAttached.TRANSACTION_ATTR_SENTRY_ROUTE_BACKFILL] && event.transaction !== 'GET /_app') {
                event.transaction = `${method} ${event.contexts.trace.data[spanAttributesWithLogicAttached.TRANSACTION_ATTR_SENTRY_ROUTE_BACKFILL]}`;
            }
            const middlewareMatch = typeof spanName === 'string' && spanName.match(/^middleware (GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/);
            if (middlewareMatch) {
                const normalizedName = `middleware ${middlewareMatch[1]}`;
                event.transaction = normalizedName;
                event.contexts.trace.op = 'http.server.middleware';
            }
            // Next.js overrides transaction names for page loads that throw an error
            // but we want to keep the original target name
            if (event.transaction === 'GET /_error' && target) {
                event.transaction = `${method ? `${method} ` : ''}${target}`;
            }
        }
        // Next.js 13 is not correctly picking up tracing data for trace propagation so we use a back-fill strategy
        if (event.type === 'transaction' && typeof event.contexts?.trace?.data?.[spanAttributesWithLogicAttached.TRANSACTION_ATTR_SENTRY_TRACE_BACKFILL] === 'string') {
            const traceparentData = core.extractTraceparentData(event.contexts.trace.data[spanAttributesWithLogicAttached.TRANSACTION_ATTR_SENTRY_TRACE_BACKFILL]);
            if (traceparentData?.traceId) {
                event.contexts.trace.trace_id = traceparentData.traceId;
            }
            if (traceparentData?.parentSpanId) {
                event.contexts.trace.parent_span_id = traceparentData.parentSpanId;
            }
        }
        setUrlProcessingMetadata.setUrlProcessingMetadata(event);
    });
    if ("TURBOPACK compile-time truthy", 1) {
        core.getGlobalScope().addEventProcessor(devErrorSymbolicationEventProcessor.devErrorSymbolicationEventProcessor);
    }
    try {
        // @ts-expect-error `process.turbopack` is a magic string that will be replaced by Next.js
        if ("TURBOPACK compile-time truthy", 1) {
            core.getGlobalScope().setTag('turbopack', true);
        }
    } catch  {
    // Noop
    // The statement above can throw because process is not defined on the client
    }
    debugBuild.DEBUG_BUILD && core.debug.log('SDK successfully initialized');
    return client;
}
function sdkAlreadyInitialized() {
    return !!core.getClient();
}
exports.captureUnderscoreErrorException = _error.captureUnderscoreErrorException;
exports.startInactiveSpan = nextSpan.startInactiveSpan;
exports.startSpan = nextSpan.startSpan;
exports.startSpanManual = nextSpan.startSpanManual;
exports.wrapGetStaticPropsWithSentry = wrapGetStaticPropsWithSentry.wrapGetStaticPropsWithSentry;
exports.wrapGetInitialPropsWithSentry = wrapGetInitialPropsWithSentry.wrapGetInitialPropsWithSentry;
exports.wrapAppGetInitialPropsWithSentry = wrapAppGetInitialPropsWithSentry.wrapAppGetInitialPropsWithSentry;
exports.wrapDocumentGetInitialPropsWithSentry = wrapDocumentGetInitialPropsWithSentry.wrapDocumentGetInitialPropsWithSentry;
exports.wrapErrorGetInitialPropsWithSentry = wrapErrorGetInitialPropsWithSentry.wrapErrorGetInitialPropsWithSentry;
exports.wrapGetServerSidePropsWithSentry = wrapGetServerSidePropsWithSentry.wrapGetServerSidePropsWithSentry;
exports.wrapServerComponentWithSentry = wrapServerComponentWithSentry.wrapServerComponentWithSentry;
exports.wrapRouteHandlerWithSentry = wrapRouteHandlerWithSentry.wrapRouteHandlerWithSentry;
exports.wrapApiHandlerWithSentryVercelCrons = wrapApiHandlerWithSentryVercelCrons.wrapApiHandlerWithSentryVercelCrons;
exports.wrapMiddlewareWithSentry = wrapMiddlewareWithSentry.wrapMiddlewareWithSentry;
exports.wrapPageComponentWithSentry = wrapPageComponentWithSentry.wrapPageComponentWithSentry;
exports.wrapGenerationFunctionWithSentry = wrapGenerationFunctionWithSentry.wrapGenerationFunctionWithSentry;
exports.withServerActionInstrumentation = withServerActionInstrumentation.withServerActionInstrumentation;
exports.captureRequestError = captureRequestError.captureRequestError;
exports.wrapApiHandlerWithSentry = wrapApiHandlerWithSentry.wrapApiHandlerWithSentry;
exports.ErrorBoundary = ErrorBoundary;
exports.createReduxEnhancer = createReduxEnhancer;
exports.init = init;
exports.showReportDialog = showReportDialog;
exports.withErrorBoundary = withErrorBoundary;
Object.prototype.hasOwnProperty.call(node, '__proto__') && !Object.prototype.hasOwnProperty.call(exports, '__proto__') && Object.defineProperty(exports, '__proto__', {
    enumerable: true,
    value: node['__proto__']
});
Object.keys(node).forEach((k)=>{
    if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) exports[k] = node[k];
}); //# sourceMappingURL=index.js.map
}),
"[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/index.server.js [instrumentation] (ecmascript)", ((__turbopack_context__, module, exports) => {

Object.defineProperty(exports, Symbol.toStringTag, {
    value: 'Module'
});
const index$1 = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/config/withSentryConfig/index.js [instrumentation] (ecmascript)");
const index = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/server/index.js [instrumentation] (ecmascript)");
const node = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/node/build/cjs/index.js [instrumentation] (ecmascript)");
const captureRequestError = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/captureRequestError.js [instrumentation] (ecmascript)");
const _error = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/_error.js [instrumentation] (ecmascript)");
const nextSpan = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/utils/nextSpan.js [instrumentation] (ecmascript)");
const withServerActionInstrumentation = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/withServerActionInstrumentation.js [instrumentation] (ecmascript)");
const wrapApiHandlerWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapApiHandlerWithSentry.js [instrumentation] (ecmascript)");
const wrapApiHandlerWithSentryVercelCrons = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapApiHandlerWithSentryVercelCrons.js [instrumentation] (ecmascript)");
const wrapAppGetInitialPropsWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapAppGetInitialPropsWithSentry.js [instrumentation] (ecmascript)");
const wrapDocumentGetInitialPropsWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapDocumentGetInitialPropsWithSentry.js [instrumentation] (ecmascript)");
const wrapErrorGetInitialPropsWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapErrorGetInitialPropsWithSentry.js [instrumentation] (ecmascript)");
const wrapGenerationFunctionWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/wrapGenerationFunctionWithSentry.js [instrumentation] (ecmascript)");
const wrapGetInitialPropsWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapGetInitialPropsWithSentry.js [instrumentation] (ecmascript)");
const wrapGetServerSidePropsWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapGetServerSidePropsWithSentry.js [instrumentation] (ecmascript)");
const wrapGetStaticPropsWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapGetStaticPropsWithSentry.js [instrumentation] (ecmascript)");
const wrapMiddlewareWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/wrapMiddlewareWithSentry.js [instrumentation] (ecmascript)");
const wrapPageComponentWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/pages-router-instrumentation/wrapPageComponentWithSentry.js [instrumentation] (ecmascript)");
const wrapRouteHandlerWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/wrapRouteHandlerWithSentry.js [instrumentation] (ecmascript)");
const wrapServerComponentWithSentry = __turbopack_context__.r("[project]/metacto/metacto-internal/context-stack/node_modules/@sentry/nextjs/build/cjs/common/wrapServerComponentWithSentry.js [instrumentation] (ecmascript)");
exports.withSentryConfig = index$1.withSentryConfig;
exports.ErrorBoundary = index.ErrorBoundary;
exports.createReduxEnhancer = index.createReduxEnhancer;
exports.init = index.init;
exports.showReportDialog = index.showReportDialog;
exports.withErrorBoundary = index.withErrorBoundary;
exports.captureRequestError = captureRequestError.captureRequestError;
exports.captureUnderscoreErrorException = _error.captureUnderscoreErrorException;
exports.startInactiveSpan = nextSpan.startInactiveSpan;
exports.startSpan = nextSpan.startSpan;
exports.startSpanManual = nextSpan.startSpanManual;
exports.withServerActionInstrumentation = withServerActionInstrumentation.withServerActionInstrumentation;
exports.wrapApiHandlerWithSentry = wrapApiHandlerWithSentry.wrapApiHandlerWithSentry;
exports.wrapApiHandlerWithSentryVercelCrons = wrapApiHandlerWithSentryVercelCrons.wrapApiHandlerWithSentryVercelCrons;
exports.wrapAppGetInitialPropsWithSentry = wrapAppGetInitialPropsWithSentry.wrapAppGetInitialPropsWithSentry;
exports.wrapDocumentGetInitialPropsWithSentry = wrapDocumentGetInitialPropsWithSentry.wrapDocumentGetInitialPropsWithSentry;
exports.wrapErrorGetInitialPropsWithSentry = wrapErrorGetInitialPropsWithSentry.wrapErrorGetInitialPropsWithSentry;
exports.wrapGenerationFunctionWithSentry = wrapGenerationFunctionWithSentry.wrapGenerationFunctionWithSentry;
exports.wrapGetInitialPropsWithSentry = wrapGetInitialPropsWithSentry.wrapGetInitialPropsWithSentry;
exports.wrapGetServerSidePropsWithSentry = wrapGetServerSidePropsWithSentry.wrapGetServerSidePropsWithSentry;
exports.wrapGetStaticPropsWithSentry = wrapGetStaticPropsWithSentry.wrapGetStaticPropsWithSentry;
exports.wrapMiddlewareWithSentry = wrapMiddlewareWithSentry.wrapMiddlewareWithSentry;
exports.wrapPageComponentWithSentry = wrapPageComponentWithSentry.wrapPageComponentWithSentry;
exports.wrapRouteHandlerWithSentry = wrapRouteHandlerWithSentry.wrapRouteHandlerWithSentry;
exports.wrapServerComponentWithSentry = wrapServerComponentWithSentry.wrapServerComponentWithSentry;
Object.prototype.hasOwnProperty.call(node, '__proto__') && !Object.prototype.hasOwnProperty.call(exports, '__proto__') && Object.defineProperty(exports, '__proto__', {
    enumerable: true,
    value: node['__proto__']
});
Object.keys(node).forEach((k)=>{
    if (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) exports[k] = node[k];
}); //# sourceMappingURL=index.server.js.map
}),
];

//# debugId=a6d70b7e-81fe-c511-7829-736afeaf61cc
//# sourceMappingURL=06187_%40sentry_nextjs_build_cjs_18c2dbf7._.js.map