(function () {
  "use strict";
  const pending = new Map();
  let sequence = 0;

  function request(action, fields) {
    const requestId = "vokie-ui-" + Date.now() + "-" + (++sequence);
    const payload = Object.assign({
      type: "vokie_plugin_request",
      requestId: requestId,
      action: action
    }, fields || {});

    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        pending.delete(requestId);
        reject(new Error("Vokie did not respond to " + action + " in time."));
      }, 7000);
      pending.set(requestId, {resolve: resolve, reject: reject, timer: timer});
      parent.postMessage(payload, "*");
    });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== parent || !event.data || typeof event.data !== "object") return;
    const requestId = event.data.requestId;
    const item = pending.get(requestId);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(requestId);
    if (event.data.ok === false || event.data.error) {
      item.reject(new Error(event.data.error || "Vokie rejected the request."));
    } else {
      item.resolve(event.data);
    }
  });

  window.vokiePlugin = Object.freeze({
    getState: function () {
      return request("get_state");
    },
    getAudioInputs: function (query) {
      return request("query_audio_inputs", {query: query || {}});
    },
    configure: function (config) {
      return request("configure", {config: config});
    }
  });
})();
