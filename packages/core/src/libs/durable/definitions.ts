/**
 * Every durable definition this build runs, imported once by the executor
 * before it launches so DBOS knows each by name. A definition module only
 * registers itself; its work is imported lazily inside `run`. Processes a
 * plugin defines (the software factory's request flow) run as data through
 * the one flow runner (`flow.ts`), never as a definition of their own here.
 */
import '@/services/workflows/durableWorkflowRun';
import './flow';
