import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  blankOptionalEnv,
  collectEnv,
  fgaFrom,
  MissingEnvError,
  OPTIONAL_ENV,
  REQUIRED_ENV,
  storageFrom,
  type Need,
} from "../src/config/env.js";
import { identityFrom } from "../src/config/identity.js";

/**
 * この describe が触る環境変数。テストの中で消したり足したりするので、
 * 前後で退避と復元をする —— vitest は同じプロセスで走るので、片付けを
 * 忘れると別のテストに漏れる。
 */
const TOUCHED = [
  "WAGGLE_S3_ENDPOINT",
  "WAGGLE_S3_BUCKET",
  "WAGGLE_S3_ACCESS_KEY_ID",
  "WAGGLE_S3_SECRET_ACCESS_KEY",
  "WAGGLE_S3_REGION",
  "WAGGLE_S3_FORCE_PATH_STYLE",
  "WAGGLE_FGA_STORE_ID",
  "WAGGLE_FGA_MODEL_ID",
  "WAGGLE_DEV_SUBJECT",
  "WAGGLE_DEV_ORGANIZATIONS",
];

const S3_REQUIRED = [
  "WAGGLE_S3_ENDPOINT",
  "WAGGLE_S3_BUCKET",
  "WAGGLE_S3_ACCESS_KEY_ID",
  "WAGGLE_S3_SECRET_ACCESS_KEY",
];

describe("collectEnv", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of TOUCHED) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    saved.clear();
  });

  const setS3 = (): void => {
    process.env["WAGGLE_S3_ENDPOINT"] = "http://127.0.0.1:8333";
    process.env["WAGGLE_S3_BUCKET"] = "browserhive";
    process.env["WAGGLE_S3_ACCESS_KEY_ID"] = "key";
    process.env["WAGGLE_S3_SECRET_ACCESS_KEY"] = "secret";
  };

  const setFga = (): void => {
    process.env["WAGGLE_FGA_STORE_ID"] = "store";
    process.env["WAGGLE_FGA_MODEL_ID"] = "model";
  };

  // これが要点。1 個ずつ throw していた頃は、4 つ欠けていれば 4 回起動し直す
  // ことになり、しかも「あと何個あるのか」が最後まで分からなかった。
  it("reports every missing variable at once, not just the first", () => {
    try {
      collectEnv(storageFrom);
      expect.unreachable("should have thrown");
    } catch (caught) {
      expect(caught).toBeInstanceOf(MissingEnvError);
      expect((caught as MissingEnvError).names).toEqual(S3_REQUIRED);
    }
  });

  // **範囲は起動 1 回であって factory 1 つではない。** api/server.ts は S3 と
  // OpenFGA を続けて建てるので、これが分かれていると往復が 2 回残る。
  it("collects across several builders in one scope", () => {
    try {
      collectEnv((need: Need) => ({ storage: storageFrom(need), fga: fgaFrom(need) }));
      expect.unreachable("should have thrown");
    } catch (caught) {
      expect((caught as MissingEnvError).names).toEqual([
        ...S3_REQUIRED,
        "WAGGLE_FGA_STORE_ID",
        "WAGGLE_FGA_MODEL_ID",
      ]);
    }
  });

  // client/run.ts が identity と storage をまとめて建てる形。
  it("collects across modules", () => {
    try {
      collectEnv((need: Need) => ({ identity: identityFrom(need), storage: storageFrom(need) }));
      expect.unreachable("should have thrown");
    } catch (caught) {
      expect((caught as MissingEnvError).names).toEqual(["WAGGLE_DEV_SUBJECT", ...S3_REQUIRED]);
    }
  });

  // `.env` にはよくある形: 行はあるが右辺が空。設定したつもりで設定できていない
  // ので、無いのと同じに扱う (required と同じ判定)。
  it("treats an empty value as missing", () => {
    setS3();
    process.env["WAGGLE_S3_BUCKET"] = "";
    try {
      collectEnv(storageFrom);
      expect.unreachable("should have thrown");
    } catch (caught) {
      expect((caught as MissingEnvError).names).toEqual(["WAGGLE_S3_BUCKET"]);
    }
  });

  it("names the template in the message, since the names alone do not say what to put in", () => {
    try {
      collectEnv(storageFrom);
      expect.unreachable("should have thrown");
    } catch (caught) {
      expect((caught as Error).message).toContain("WAGGLE_S3_ENDPOINT");
      expect((caught as Error).message).toContain(".env.example");
    }
  });

  it("builds the value when nothing is missing", () => {
    setS3();
    expect(collectEnv(storageFrom)).toEqual({
      endpoint: "http://127.0.0.1:8333",
      region: "us-east-1",
      bucket: "browserhive",
      accessKeyId: "key",
      secretAccessKey: "secret",
      forcePathStyle: false,
    });
  });

  // optional は collectEnv の外なので、欠けていても報告されない。
  it("leaves optional variables to their defaults", () => {
    setS3();
    setFga();
    expect(collectEnv(fgaFrom)).toEqual({
      apiUrl: "http://localhost:8090",
      storeId: "store",
      modelId: "model",
      apiToken: "dev-key",
    });
  });
});

/**
 * 「設定されているが空」の検査。
 *
 * `guardEnv()` は module body で `process.exit` するのでテストから直接は呼べない。
 * 判定そのものは `blankOptionalEnv()` に切り出してあるので、そちらを見る。
 */
describe("blankOptionalEnv", () => {
  const saved = new Map<string, string | undefined>();
  const touch = (name: string, value: string | undefined): void => {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    saved.clear();
  });

  it("reports an optional variable that is set but empty", () => {
    touch("LOG_LEVEL", "");
    expect(blankOptionalEnv()).toContain("LOG_LEVEL");
  });

  it("says nothing about an optional variable that is absent", () => {
    touch("LOG_LEVEL", undefined);
    expect(blankOptionalEnv()).not.toContain("LOG_LEVEL");
  });

  // **二重報告をしないこと。** required が空なのは collectEnv の担当で、
  // ここが同じ誤りをもう一度言うと、どちらを直せばよいのか分からなくなる。
  it("leaves an empty required variable to collectEnv", () => {
    touch("WAGGLE_S3_BUCKET", "");
    expect(blankOptionalEnv()).not.toContain("WAGGLE_S3_BUCKET");
    expect(() => collectEnv(storageFrom)).toThrow(MissingEnvError);
  });

  it("reports only the optional half when both are empty", () => {
    touch("WAGGLE_S3_BUCKET", "");
    touch("LOG_LEVEL", "");
    expect(blankOptionalEnv()).toEqual(["LOG_LEVEL"]);
  });

  // 両方に載っている名前があると、報告する側が二重になる。
  it("keeps the required and optional lists disjoint", () => {
    const overlap = REQUIRED_ENV.filter((name) =>
      (OPTIONAL_ENV as readonly string[]).includes(name),
    );
    expect(overlap).toEqual([]);
  });
});
