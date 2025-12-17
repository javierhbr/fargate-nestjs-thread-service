export interface DispatchOptions {
  priority?: 'high' | 'normal' | 'low';
  timeout?: number;
  retryCount?: number;
  maxRetries?: number;
}

export interface DispatchResult {
  taskId: string;
  dispatched: boolean;
  destination: 'internal' | 'overflow';
  error?: string;
}

export interface BatchDispatchResult {
  total: number;
  successful: number;
  failed: number;
  results: DispatchResult[];
}
