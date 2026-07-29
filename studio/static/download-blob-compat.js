(() => {
  "use strict";

  const nativeDownloadBlob = window.downloadBlob;
  if (typeof nativeDownloadBlob !== "function") return;

  window.downloadBlob = function compatibleDownloadBlob(...args) {
    if (args.length === 2 && args[0] instanceof Blob && typeof args[1] === "string") {
      const [blob, filename] = args;
      return nativeDownloadBlob(filename, blob.type || "application/octet-stream", blob);
    }
    return nativeDownloadBlob(...args);
  };
})();
