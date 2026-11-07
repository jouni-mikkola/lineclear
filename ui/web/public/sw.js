// Lineclear's service worker: shows a push for each new Inbox item and opens the Inbox on a tap.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let a = {};
  try {
    a = e.data ? e.data.json() : {};
  } catch {
    // a push with no JSON still shows something
  }
  const badge =
    self.navigator && "setAppBadge" in self.navigator && typeof a.badge === "number"
      ? (a.badge > 0 ? self.navigator.setAppBadge(a.badge) : self.navigator.clearAppBadge()).catch(() => undefined)
      : undefined;
  e.waitUntil(
    Promise.all([badge, self.registration.showNotification(a.title || "Lineclear", { body: a.body || "", tag: a.tag, icon: "/icon-192.png", data: {} })]),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      return open ? open.focus().then((c) => c.navigate("/inbox")) : self.clients.openWindow("/inbox");
    }),
  );
});
