/**
 * Structural types for the parts of the Cordis plugin contract this bundle
 * touches. Deliberately minimal: the plugin is plain ESM so it installs into a
 * dsh profile without a build step, and depending on `@deepseek-ai/*` types
 * here would tie LFI's typecheck to an upstream package it never imports.
 */

/** One appended durable session event. */
export interface SessionEvent {
  type: string;
  seq: number;
  time: number;
  data: Record<string, unknown>;
}

/** The pending tool call a `tools/pre-execute` listener decides on. */
export interface ToolExecution {
  name: string;
}

/** A pre-dispatch decision. */
export type PreToolDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "ask"; reason?: string };

/** The events this plugin subscribes to. */
export interface PluginContext {
  on(
    event: "session/event",
    listener: (session: unknown, event: SessionEvent) => void,
  ): () => void;
  on(
    event: "tools/pre-execute",
    listener: (
      execution: ToolExecution,
      next: () => Promise<PreToolDecision>,
    ) => Promise<PreToolDecision>,
  ): () => void;
}

export declare const name: string;
export declare const internals: { stdout: { write(chunk: string): unknown } };
export declare function apply(ctx: PluginContext): void;
