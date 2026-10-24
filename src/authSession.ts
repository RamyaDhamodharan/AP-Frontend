export type RefreshRequest = () => Promise<string | null>;

export function createAuthSession(refreshRequest: RefreshRequest) {
  let accessToken = "";
  let pendingRefresh: Promise<string | null> | null = null;
  let generation = 0;

  return {
    getAccessToken() {
      return accessToken;
    },
    setAccessToken(token: string) {
      generation += 1;
      accessToken = token;
    },
    clear() {
      generation += 1;
      accessToken = "";
    },
    refresh() {
      if (!pendingRefresh) {
        const startedAt = generation;
        pendingRefresh = Promise.resolve()
          .then(refreshRequest)
          .then(token => {
            if (generation !== startedAt || !token) return null;
            accessToken = token;
            return token;
          })
          .catch(() => null)
          .finally(() => {
            pendingRefresh = null;
          });
      }
      return pendingRefresh;
    },
    restore() {
      return this.refresh();
    },
  };
}
