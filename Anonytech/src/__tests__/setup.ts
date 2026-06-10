/**
 * Test setup — provides localStorage for all tests.
 * Runs before every test file automatically.
 */
const store: Record<string, string> = {};

const localStorageMock = {
  getItem: (key: string): string | null => {
    return store[key] ?? null;
  },
  setItem: (key: string, value: string): void => {
    store[key] = String(value);
  },
  removeItem: (key: string): void => {
    delete store[key];
  },
  clear: (): void => {
    Object.keys(store).forEach(key => delete store[key]);
  },
  get length(): number {
    return Object.keys(store).length;
  },
  key: (index: number): string | null => {
    return Object.keys(store)[index] ?? null;
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Also mock document.documentElement for setTheme()
if (!globalThis.document) {
  (globalThis as any).document = {
    documentElement: {
      classList: {
        add: () => {},
        remove: () => {},
      },
    },
  };
}