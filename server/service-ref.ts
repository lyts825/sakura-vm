declare const serviceType: unique symbol;

/** The provider owns the type. Consumers do not choose a return type at lookup. */
export type ServiceRef<T> = Readonly<{
  pluginId: string;
  key: string;
  version: number;
  [serviceType]?: (value: T) => T;
}>;

export function serviceRef<T>(pluginId: string, key: string, version = 1): ServiceRef<T> {
  return Object.freeze({ pluginId, key, version });
}
