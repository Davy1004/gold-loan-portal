export interface ToolCall {
  id: string;
  name: string;
  /** JSON string exactly as the model produced it (may be malformed - the executor handles that). */
  arguments: string;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; name: string; content: string };

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema generated from the same Zod schema the REST API validates with. */
  parameters: Record<string, unknown>;
}

export interface LlmResult {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface LlmProvider {
  readonly name: string;
  chat(messages: ChatMessage[], tools: ToolDef[]): Promise<LlmResult>;
}
