/** Minimal key-value storage, so app logic can run against browser.storage.local or an in-memory map. */
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export function browserStore(area: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> }): Store {
  return {
    async get<T>(key: string) {
      return (await area.get(key))[key] as T | undefined;
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
  };
}

export function memoryStore(initial: Record<string, unknown> = {}): Store & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
  };
}
