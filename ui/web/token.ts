// The server sets a token in a cookie when a page loads. Each POST sends it back in a header, so only these pages can answer.
const token = document.cookie.match(/(?:^|;\s*)lineclear_token=([^;]+)/)?.[1];
const plain = window.fetch.bind(window);
window.fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => {
  if (token && init?.method && init.method !== "GET")
    return plain(input, { ...init, headers: { ...(init.headers as Record<string, string>), "x-lineclear-token": token } });
  return plain(input, init);
}, plain);
