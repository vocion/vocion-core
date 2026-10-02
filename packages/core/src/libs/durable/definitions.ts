/**
 * Every durable definition this build runs, imported once by the executor
 * before it launches so DBOS knows each by name. A definition module only
 * registers itself; its work is imported lazily inside `run`.
 */
import '@/services/workflows/durableWorkflowRun';
