import { z } from 'zod';

/** JSON extension payload: recursively excludes undefined, functions and non-JSON native values. */
export const jsonValueSchema = z.json();
export type JsonValue = z.infer<typeof jsonValueSchema>;
