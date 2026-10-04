/** A service contract contains public operations and data, never lifecycle or implementation slots. */
export type ServiceInterface<T> = Readonly<
  Pick<
    T,
    Exclude<
      keyof T,
      'constructor' | 'machines' | 'engine' | 'options' | 'file' | 'dataFile' | 'init' | 'close'
    >
  >
>;
