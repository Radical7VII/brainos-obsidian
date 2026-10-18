/**
 * Stable seam for a future BrainOS AI adapter.
 *
 * The graph and Markdown workflow never call a provider directly. A provider
 * can later be registered by the plugin host without changing thought-file or
 * graph persistence, and callers can pass an AbortSignal for cancellation.
 */
export type AIContext = {
  thoughtPath?: string;
  nodePaths?: string[];
  sessionId?: string;
};

export type AIRequest = {
  prompt: string;
  context?: AIContext;
  signal?: AbortSignal;
};

export type AIResponse = {
  text: string;
  provider: string;
  model?: string;
};

export interface BrainOSAIProvider {
  readonly id: string;
  complete(request: AIRequest): Promise<AIResponse>;
}

/** Default provider until the user explicitly configures an API adapter. */
export class UnconfiguredAIProvider implements BrainOSAIProvider {
  readonly id = "unconfigured";

  async complete(_request: AIRequest): Promise<AIResponse> {
    throw new Error("尚未配置 BrainOS AI 提供方；图谱和 Markdown 工作流可独立使用");
  }
}
