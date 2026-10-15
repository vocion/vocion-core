/**
 * A TypeScript program over the `/api/v1` route files, so the OpenAPI
 * generator can ask the type checker what each route answers (#1196).
 *
 * The program uses the package's own `tsconfig.json`, so `@/` imports and
 * `next/server` resolve exactly as they do for `tsc`. Nothing is emitted and
 * nothing is checked up front: the checker works out only the types it is
 * asked about, which keeps this to a few seconds over the whole API.
 */
import { dirname } from 'node:path';
import ts from 'typescript';
import { fromRepoRoot } from '../repo-root';

/** The package's compiler settings: the same ones `tsc` uses for the app. */
const TSCONFIG_PATH = fromRepoRoot('packages/core/tsconfig.json');

/**
 * A compiler host that serves some files from memory and reads the rest from
 * disk. Tests use it to put fixture routes beside the real ones, so their
 * imports resolve against the real `node_modules` and `@/` paths.
 */
class InMemoryFilesHost implements ts.CompilerHost {
  private readonly disk: ts.CompilerHost;
  private readonly files: ReadonlyMap<string, string>;
  private readonly languageVersion: ts.ScriptTarget;

  constructor(options: ts.CompilerOptions, files: ReadonlyMap<string, string>) {
    this.disk = ts.createCompilerHost(options, true);
    this.files = files;
    this.languageVersion = options.target ?? ts.ScriptTarget.ESNext;
  }

  getSourceFile(fileName: string, languageVersion: ts.ScriptTarget | ts.CreateSourceFileOptions): ts.SourceFile | undefined {
    const inMemory = this.files.get(fileName);
    if (inMemory !== undefined) {
      return ts.createSourceFile(fileName, inMemory, languageVersion ?? this.languageVersion, true);
    }
    return this.disk.getSourceFile(fileName, languageVersion);
  }

  fileExists(fileName: string): boolean {
    return this.files.has(fileName) || this.disk.fileExists(fileName);
  }

  readFile(fileName: string): string | undefined {
    return this.files.get(fileName) ?? this.disk.readFile(fileName);
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return this.disk.getDefaultLibFileName(options);
  }

  writeFile(): void {
    // Nothing is emitted.
  }

  getCurrentDirectory(): string {
    return this.disk.getCurrentDirectory();
  }

  getCanonicalFileName(fileName: string): string {
    return this.disk.getCanonicalFileName(fileName);
  }

  useCaseSensitiveFileNames(): boolean {
    return this.disk.useCaseSensitiveFileNames();
  }

  getNewLine(): string {
    return this.disk.getNewLine();
  }

  directoryExists(directoryName: string): boolean {
    // A directory holding only in-memory files exists for the program, or
    // module resolution never looks inside it for a relative import.
    const prefix = directoryName.endsWith('/') ? directoryName : `${directoryName}/`;
    if ([...this.files.keys()].some(fileName => fileName.startsWith(prefix))) {
      return true;
    }
    return this.disk.directoryExists?.(directoryName) ?? true;
  }

  getDirectories(path: string): string[] {
    return this.disk.getDirectories?.(path) ?? [];
  }

  realpath(path: string): string {
    return this.files.has(path) ? path : (this.disk.realpath?.(path) ?? path);
  }
}

/** The package's compiler options, for reading types only. */
function compilerOptions(): ts.CompilerOptions {
  const { config, error } = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile);
  if (error) {
    throw new Error(`Could not read ${TSCONFIG_PATH}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
  }
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, dirname(TSCONFIG_PATH));
  // Reading types needs none of the build settings, and `incremental`
  // without an output file is an error for a program made in memory.
  return { ...options, noEmit: true, incremental: false, composite: false, tsBuildInfoFile: undefined };
}

/**
 * A program over the given route files and everything they import.
 * @param routeFiles - Absolute paths of the route files.
 * @param inMemoryFiles - Files to serve from memory instead of disk, by
 * absolute path; tests use it for fixture routes.
 */
export function createRouteProgram(routeFiles: string[], inMemoryFiles: ReadonlyMap<string, string> = new Map()): ts.Program {
  const options = compilerOptions();
  return ts.createProgram({ rootNames: routeFiles, options, host: new InMemoryFilesHost(options, inMemoryFiles) });
}
