type StoredCookie = { name: string; value: string };

export type MutableCookieJar = {
  getAll(): StoredCookie[];
  get(name: string): StoredCookie | undefined;
  set(name: string, value: string): void;
  clear(): void;
  replaceWith(cookies: StoredCookie[]): void;
};

function createJar(): MutableCookieJar {
  const store = new Map<string, string>();

  return {
    getAll: () => [...store.entries()].map(([name, value]) => ({ name, value })),
    get: (name) => (store.has(name) ? { name, value: store.get(name) as string } : undefined),
    set: (name, value) => {
      if (value === "") store.delete(name);
      else store.set(name, value);
    },
    clear: () => store.clear(),
    replaceWith: (cookies) => {
      store.clear();
      for (const cookie of cookies) store.set(cookie.name, cookie.value);
    },
  };
}

export const cookieJar = createJar();
