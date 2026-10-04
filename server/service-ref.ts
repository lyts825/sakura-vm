declare const serviceType: unique symbol;

/** A provider chooses one explicitly versioned interface and its runtime member descriptor. */
export type ServiceContract<T = unknown> = Readonly<{
  id: string;
  version: number;
  members: readonly string[];
  optional?: readonly string[];
  methods?: readonly string[];
  properties?: Readonly<Record<string, string | ServiceContract<any>>>;
  returns?: Readonly<Record<string, string | ServiceContract<any>>>;
  [serviceType]?: (value: T) => T;
}>;

/** The provider owns the type. Consumers do not choose a return type at lookup. */
export type ServiceRef<T> = Readonly<{
  pluginId: string;
  key: string;
  version: number;
  contractId: string;
  contract?: ServiceContract<T>;
  [serviceType]?: (value: T) => T;
}>;

export function serviceRef<T>(pluginId: string, key: string, contract: ServiceContract<T>): ServiceRef<T>;
export function serviceRef<T = unknown>(pluginId: string, key: string, version?: number): ServiceRef<T>;
export function serviceRef<T>(pluginId: string, key: string, contract?: ServiceContract<T> | number): ServiceRef<T> {
  if (contract && typeof contract === 'object')
    return Object.freeze({ pluginId, key, version: contract.version, contractId: contract.id, contract });
  // Convenience lookups resolve descriptors from the provider directory;
  // registering a new provider still requires an explicit declared contract.
  return Object.freeze({ pluginId, key, version: contract || 1, contractId: '' });
}
