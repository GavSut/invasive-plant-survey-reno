// A normal reload can reuse both the offline cache and the HTTP cache.
// Ask the latest worker to replace its app files from the network first.
function waitForActivation(worker) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("The site update timed out. Reconnect and try again.")), 30000);
    function finish(error) {
      clearTimeout(timer);
      worker.removeEventListener("statechange", check);
      if (error) reject(error);
      else resolve();
    }
    function check() {
      if (worker.state === "activated") finish();
      else if (worker.state === "redundant") finish(new Error("The update could not be installed. Try again."));
    }
    worker.addEventListener("statechange", check);
    check();
  });
}

export async function refreshSiteFiles() {
  if (!navigator.onLine) throw new Error("Reconnect to the internet before refreshing the site.");
  if (!navigator.serviceWorker) throw new Error("Site refresh is unavailable in this browser. Open the site in Safari, Chrome, or Firefox.");

  const registration = await navigator.serviceWorker.register("./service-worker.js", {
    scope: "./", updateViaCache: "none",
  });
  await registration.update();
  const worker = registration.installing || registration.waiting || registration.active;
  if (!worker) throw new Error("The site update is not ready. Try again.");
  await waitForActivation(worker);

  await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => finish(new Error("Fresh site files could not be confirmed. Reconnect and try again.")), 45000);
    function finish(error) {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      if (error) reject(error);
      else resolve();
    }
    channel.port1.onmessage = ({ data }) => {
      if (data?.ok === true) finish();
      else finish(new Error(data?.error || "The site cache could not be refreshed."));
    };
    try {
      worker.postMessage({ type: "REFRESH_SITE_FILES" }, [channel.port2]);
    } catch (error) {
      finish(error);
    }
  });

  const url = new URL("./", window.location.href);
  url.searchParams.set("site-refresh", String(Date.now()));
  window.location.replace(url.href);
}
