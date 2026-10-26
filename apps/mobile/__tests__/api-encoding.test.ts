import { dirname } from "node:path";

import { createApiClient } from "@sting/app-core";

/**
 * ردّ الإعادة بعد استئناف الجلسة (401 ← تجديد ← إعادة) يُبنى بـ`Response` الخاص بـRN (whatwg-fetch)، وهو
 * يقرأ ArrayBuffer حرفاً لكل بايت؛ فكان العربي يظهر «Ø¨Ø­Ø±ÙŠ» في تقرير المبيعات (0005 §١٩٨).
 */
// `Response` الذي يعمل في RN فعلاً: whatwg-fetch كما تحمله react-native (Jest يعطي Response الخاص بـNode)
/* eslint-disable @typescript-eslint/no-require-imports */
const rnDir = dirname(require.resolve("react-native/package.json"));
const rnFetch = require(require.resolve("whatwg-fetch", { paths: [rnDir] })) as {
  Response: typeof Response;
};
/* eslint-enable @typescript-eslint/no-require-imports */

class ForeignResponse {
  constructor(
    private readonly body: string,
    readonly status: number,
  ) {}
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  readonly statusText = "";
  readonly headers = new rnFetch.Response("").headers;
  text() {
    return Promise.resolve(this.body);
  }
  json() {
    return Promise.resolve(JSON.parse(this.body) as unknown);
  }
  arrayBuffer() {
    return Promise.resolve(new TextEncoder().encode(this.body).buffer);
  }
  clone() {
    return new ForeignResponse(this.body, this.status);
  }
}

describe("عميل الـAPI على الجوال", () => {
  const original = globalThis.Response;
  beforeAll(() => {
    globalThis.Response = rnFetch.Response;
  });
  afterAll(() => {
    globalThis.Response = original;
  });

  it("العربي سليم في ردّ الإعادة بعد استئناف الجلسة", async () => {
    let token = "old";
    const api = createApiClient({
      baseUrl: "http://x",
      getAccessToken: () => token,
      resume: () => {
        token = "new";
        return Promise.resolve({ access: "new" });
      },
      fetch: ((req: Request) =>
        Promise.resolve(
          req.headers.get("Authorization") === "Bearer new"
            ? new ForeignResponse('{"name":"بحري — المزاد"}', 200)
            : new ForeignResponse("{}", 401),
        )) as unknown as typeof fetch,
    });
    const r = await api.GET("/api/org/audit", { params: { query: {} } });
    expect(r.response.status).toBe(200);
    expect(r.data).toEqual({ name: "بحري — المزاد" });
  });
});
