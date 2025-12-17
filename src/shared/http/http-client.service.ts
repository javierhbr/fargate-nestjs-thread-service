import { Injectable } from '@nestjs/common';
import { Pool, Dispatcher } from 'undici';
import { PinoLoggerService } from '../logging/pino-logger.service';
import { Readable } from 'stream';

export interface HttpRequestOptions {
  method?: Dispatcher.HttpMethod;
  headers?: Record<string, string>;
  body?: string | Buffer | Readable;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export interface HttpResponse<T = unknown> {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: T;
}

export interface StreamResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Readable;
}

@Injectable()
export class HttpClientService {
  private readonly pools: Map<string, Pool> = new Map();
  private readonly defaultTimeout = 30000;
  private readonly defaultMaxRetries = 3;
  private readonly defaultRetryDelay = 1000;

  constructor(private readonly logger: PinoLoggerService) {
    this.logger.setContext(HttpClientService.name);
  }

  private getPool(baseUrl: string): Pool {
    let pool = this.pools.get(baseUrl);
    if (!pool) {
      pool = new Pool(baseUrl, {
        connections: 10,
        pipelining: 1,
        keepAliveTimeout: 30000,
        keepAliveMaxTimeout: 60000,
      });
      this.pools.set(baseUrl, pool);
    }
    return pool;
  }

  async request<T = unknown>(
    url: string,
    options: HttpRequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const parsedUrl = new URL(url);
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
    const path = parsedUrl.pathname + parsedUrl.search;

    const pool = this.getPool(baseUrl);
    const maxRetries = options.maxRetries ?? this.defaultMaxRetries;
    const retryDelay = options.retryDelay ?? this.defaultRetryDelay;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await pool.request({
          path,
          method: options.method || 'GET',
          headers: options.headers,
          body: options.body,
          headersTimeout: options.timeout ?? this.defaultTimeout,
          bodyTimeout: options.timeout ?? this.defaultTimeout,
        });

        const bodyText = await response.body.text();
        let body: T;

        try {
          body = JSON.parse(bodyText) as T;
        } catch {
          body = bodyText as unknown as T;
        }

        return {
          statusCode: response.statusCode,
          headers: response.headers as Record<string, string | string[] | undefined>,
          body,
        };
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          { url, attempt, error: lastError.message },
          'HTTP request failed, retrying',
        );

        if (attempt < maxRetries) {
          await this.delay(retryDelay * Math.pow(2, attempt));
        }
      }
    }

    this.logger.error(
      { url, maxRetries, error: lastError?.message },
      'HTTP request failed after all retries',
    );
    throw lastError;
  }

  async requestStream(
    url: string,
    options: HttpRequestOptions = {},
  ): Promise<StreamResponse> {
    const parsedUrl = new URL(url);
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
    const path = parsedUrl.pathname + parsedUrl.search;

    const pool = this.getPool(baseUrl);

    const response = await pool.request({
      path,
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
      headersTimeout: options.timeout ?? this.defaultTimeout,
    });

    return {
      statusCode: response.statusCode,
      headers: response.headers as Record<string, string | string[] | undefined>,
      body: Readable.from(response.body),
    };
  }

  async get<T = unknown>(
    url: string,
    options?: Omit<HttpRequestOptions, 'method' | 'body'>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  async post<T = unknown>(
    url: string,
    body: unknown,
    options?: Omit<HttpRequestOptions, 'method'>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  }

  async downloadToStream(
    url: string,
    options?: Omit<HttpRequestOptions, 'method' | 'body'>,
  ): Promise<StreamResponse> {
    return this.requestStream(url, { ...options, method: 'GET' });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async destroy(): Promise<void> {
    const closePromises = Array.from(this.pools.values()).map((pool) => pool.close());
    await Promise.all(closePromises);
    this.pools.clear();
  }
}
