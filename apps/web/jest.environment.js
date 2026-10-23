const JSDOMEnvironment = require("jest-environment-jsdom").default || require("jest-environment-jsdom");

class CustomEnvironment extends JSDOMEnvironment {
  constructor(config, context) {
    super(config, context);

    // Forward Node 20+ native Web APIs into JSDOM environment
    if (typeof Request !== "undefined") {
      this.global.Request = Request;
    }
    if (typeof Response !== "undefined") {
      this.global.Response = Response;
    }
    if (typeof Headers !== "undefined") {
      this.global.Headers = Headers;
    }
    if (typeof FormData !== "undefined") {
      this.global.FormData = FormData;
    }
    if (typeof fetch !== "undefined") {
      this.global.fetch = fetch;
    }

    try {
      const { indexedDB, IDBKeyRange } = require("fake-indexeddb");
      this.global.indexedDB = indexedDB;
      this.global.IDBKeyRange = IDBKeyRange;
    } catch {
      // ignore if fake-indexeddb not loaded
    }
  }
}

module.exports = CustomEnvironment;
