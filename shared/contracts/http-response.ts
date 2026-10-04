import type { z } from 'zod';

/** Wire response contract, independent of HTTP handlers and implementation classes. */
export type HttpResponseContract = {
  kind: 'json' | 'text' | 'binary' | 'event-stream' | 'empty';
  statuses: readonly number[];
  media?: string;
  schema?: z.ZodType;
};
