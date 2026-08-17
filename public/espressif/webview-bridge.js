(() => {
  let savedState = {};
  const send = (message) => parent.postMessage({ __espIdfBridge: true, message }, "*");

  window.acquireVsCodeApi = () => ({
    postMessage: send,
    getState: () => savedState,
    setState: (state) => {
      savedState = state;
      return state;
    }
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.('a[href^="command:"]');
    if (!link) return;
    event.preventDefault();
    send({ command: "commandLink", target: link.getAttribute("href").slice(8) });
  });

  const ready = () => send({ command: "__webviewReady" });
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", ready, { once: true });
  else queueMicrotask(ready);
})();
