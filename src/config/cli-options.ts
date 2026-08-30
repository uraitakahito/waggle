/**
 * client の CLI オプション解析。
 *
 * `--server`・`--tls-ca-cert`・`--database-url` は、コマンドラインで省くと対応する
 * 環境変数 (`BROWSERHIVE_SERVER`・`BROWSERHIVE_TLS_CA_CERT`・`DATABASE_URL`) に
 * 落ちる。ジョブごとの旗 —— 形式のスイッチ、`--limit`、`--dismiss-banners`、
 * `--accept-language`、そして取り込みの調整 (`--device-pixel-ratios`・
 * `--operation-delay-ms`・`--behaviors`・`--no-site-behaviors`) —— には、意図的に
 * 環境変数の対応物を用意していない: これらは呼ぶ側の意図であって、配備の設定では
 * ないため。同じ調整に対する環境変数は BrowserHive 自身が持っていて、server 全体の
 * 既定値を決めているのはそちら。
 *
 * `--server` に commander 層の既定値は無く、`configureClient` が `DEFAULT_TARGET` に
 * 落とす。OpenAPI の SDK は `servers[0].url` から既定値を焼き込んでいたので、宛先に
 * ついては spec が唯一の出どころだった —— `.proto` はサービスを記述するもので、
 * どこで待ち受けるかは書かない。だからその既定値はいま `src/rpc/client.ts` に在り、
 * 下でもそう述べている。
 */
import { Command, InvalidArgumentError, Option } from "commander";
import { logger } from "../logger.js";
import { maskPassword } from "../db/pool.js";
import { DEFAULT_TARGET } from "../rpc/client.js";
import type { CaptureFormats, CaptureSettings } from "../types/capture.js";

export interface ClientOptions {
  server?: string;
  databaseUrl: string;
  png?: boolean;
  webp?: boolean;
  html?: boolean;
  links?: boolean;
  mhtml?: boolean;
  wacz?: boolean;
  limit?: number;
  tlsCaCert?: string;
  dismissBanners?: boolean;
  acceptLanguage?: string;
  devicePixelRatios?: number[];
  operationDelayMs?: number;
  behaviors?: string[];
  siteBehaviors?: boolean;
  session?: "isolated" | "shared";
  /**
   * 受理された取り込みを 1 件ずつ待ち、成功したものを台帳に足す。
   * `--no-collect` は投げて終わり、結果は後から `waggle fga:reconcile` が
   * 永続化された manifest から拾う。
   */
  collect?: boolean;
  captureTimeoutMs?: number;
}

const parsePositiveInt = (value: string): number => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    throw new InvalidArgumentError("Must be a positive integer");
  }
  return num;
};

const parseNonNegativeInt = (value: string): number => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) {
    throw new InvalidArgumentError("Must be a non-negative integer");
  }
  return num;
};

// `--behaviors ""` と空を渡すことには意味がある: built-in を全部切りつつ、server の
// site behaviors には触れない。刈るのは id の前後の空白だけ。
//
// BrowserHive v4.0.0 より前は、これが **効いていなかった**。空のリストは wire 上で
// 「指定なし」と区別が付かず、server は自分の既定を走らせていた。v4 で `behaviors`
// が message に包まれ presence を持ったので、いまは意図どおりに届く。
// 倍率をカンマ区切りのリストで受けるのは、順序に意味があるため: 画像は最後の要素の
// 倍率で出る。`--device-pixel-ratio` を繰り返す形でも同じことは言えるが、1 つの
// リストなら順序が 1 箇所で見える。範囲 (1–3) と重複禁止は server が強制する ——
// protobuf に移ってから、値の制約はすべてそちらに寄せている。
const parseRatioList = (value: string): number[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const n = Number(part);
      if (!Number.isInteger(n)) {
        throw new InvalidArgumentError(`"${part}" is not an integer`);
      }
      return n;
    });

/**
 * BrowserHive が同梱している built-in。`Behavior` の oneof の枝と 1 対 1。
 *
 * ここで検査するのは、通してしまうと **黙って何も走らない** から: server 側の
 * runner は id で登録済みのクラスを探し、見つからなければ何も言わずに飛ばす。
 * 打ち間違いが「成功したが空の取り込み」に化ける。
 */
const KNOWN_BEHAVIORS = ["autoscroll", "autofetch", "autoplay"];

const parseIdList = (value: string): string[] => {
  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  for (const id of ids) {
    if (!KNOWN_BEHAVIORS.includes(id)) {
      throw new InvalidArgumentError(
        `Unknown behavior "${id}". Known: ${KNOWN_BEHAVIORS.join(", ")}`,
      );
    }
  }
  return ids;
};

// 空文字と空白だけの値はここで弾く。長さと印字可能 ASCII の制約は server 側 ——
// BrowserHive の RPC ハンドラ —— が強制する。protobuf は値域を書けないので、
// 転送方式が変わったときにその検査は契約からコードへ移った。
const parseNonEmpty = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new InvalidArgumentError("Must be a non-empty string");
  }
  return trimmed;
};

export const createProgram = (): Command => {
  const program = new Command();

  program
    .name("waggle")
    .description(
      "BrowserHive capture client — submit capture requests sourced from Postgres, then record the results in the archive ledger",
    )
    .addOption(
      new Option(
        "--database-url <url>",
        "Postgres connection string (e.g. postgres://user:pass@host:5432/db). Required.",
      )
        .env("DATABASE_URL")
        .makeOptionMandatory(true),
    )
    .addOption(
      new Option(
        "--server <host:port>",
        `BrowserHive gRPC address. Defaults to ${DEFAULT_TARGET}. A URL scheme is accepted and stripped.`,
      ).env("BROWSERHIVE_SERVER"),
    )
    .option("--png", "Capture PNG screenshot")
    .option("--webp", "Capture WebP screenshot")
    .option("--html", "Capture HTML")
    .option("--links", "Extract <a href> links to a .links.json file")
    .option("--mhtml", "Capture page as MHTML single-file archive")
    .option("--wacz", "Record the session as a WACZ replayable archive")
    .addOption(
      new Option("--limit <n>", "Maximum number of entries to read from the data file").argParser(
        parsePositiveInt,
      ),
    )
    .option("--dismiss-banners", "Run banner / modal dismissal before capturing (best-effort)")
    .addOption(
      new Option(
        "--accept-language <bcp47>",
        'Accept-Language header to forward upstream for every entry (e.g. "ja-JP,ja;q=0.9,en;q=0.8")',
      ).argParser(parseNonEmpty),
    )
    .addOption(
      new Option(
        "--device-pixel-ratios <list>",
        'Comma-separated device pixel ratios to load at, in load order (e.g. "1,2"). One load per entry; PNG/WebP come out at the last one.',
      ).argParser(parseRatioList),
    )
    .addOption(
      new Option(
        "--operation-delay-ms <ms>",
        "Delay before each browser operation, in ms. Slows a capture down enough to watch in a chrome://inspect screencast.",
      ).argParser(parseNonNegativeInt),
    )
    .addOption(
      new Option(
        "--behaviors <ids>",
        'Comma-separated built-in behavior ids (e.g. "autoscroll,autofetch"). ' +
          "What you list is what runs — omit the flag to take BrowserHive's default set, " +
          'or pass "" to run none.',
      ).argParser(parseIdList),
    )
    .option(
      "--no-site-behaviors",
      "Skip the site-specific behaviors BrowserHive bundles (they are considered on every capture by default)",
    )
    .addOption(
      new Option(
        "--session <mode>",
        "Whether a capture carries state over from the previous task on the same BrowserHive worker: " +
          "isolated (default — a throwaway BrowserContext, so cookies and origin storage start empty) | " +
          "shared (reuse the worker's context and tab; state survives between captures)",
      ).choices(["isolated", "shared"]),
    )
    .option(
      "--no-collect",
      "Submit and exit without waiting for results (fga:reconcile picks them up from the bucket later)",
    )
    .option(
      "--capture-timeout-ms <ms>",
      "Cap the wait for one capture, overriding the budget the server declares (default: wait as long as the server says it may take)",
      parsePositiveInt,
    )
    .addOption(
      new Option(
        "--tls-ca-cert <path>",
        "CA certificate file path for TLS (enables TLS when specified)",
      ).env("BROWSERHIVE_TLS_CA_CERT"),
    )
    .allowExcessArguments(false)
    .allowUnknownOption(false)
    .showHelpAfterError(true);

  return program;
};

export const parseClientOptions = (argv: string[]): ClientOptions => {
  const program = createProgram();
  program.parse(argv);

  const opts = program.opts<{
    databaseUrl: string;
    server?: string;
    png?: boolean;
    webp?: boolean;
    html?: boolean;
    links?: boolean;
    mhtml?: boolean;
    wacz?: boolean;
    limit?: number;
    tlsCaCert?: string;
    dismissBanners?: boolean;
    acceptLanguage?: string;
    devicePixelRatios?: number[];
    operationDelayMs?: number;
    behaviors?: string[];
    siteBehaviors?: boolean;
    session?: "isolated" | "shared";
    collect?: boolean;
    captureTimeoutMs?: number;
  }>();

  return {
    databaseUrl: opts.databaseUrl,
    ...(opts.collect !== undefined && { collect: opts.collect }),
    ...(opts.captureTimeoutMs !== undefined && { captureTimeoutMs: opts.captureTimeoutMs }),
    ...(opts.server !== undefined && { server: opts.server }),
    ...(opts.png !== undefined && { png: opts.png }),
    ...(opts.webp !== undefined && { webp: opts.webp }),
    ...(opts.html !== undefined && { html: opts.html }),
    ...(opts.links !== undefined && { links: opts.links }),
    ...(opts.mhtml !== undefined && { mhtml: opts.mhtml }),
    ...(opts.wacz !== undefined && { wacz: opts.wacz }),
    ...(opts.limit !== undefined && { limit: opts.limit }),
    ...(opts.tlsCaCert !== undefined && { tlsCaCert: opts.tlsCaCert }),
    ...(opts.dismissBanners !== undefined && { dismissBanners: opts.dismissBanners }),
    ...(opts.acceptLanguage !== undefined && { acceptLanguage: opts.acceptLanguage }),
    ...(opts.devicePixelRatios !== undefined && { devicePixelRatios: opts.devicePixelRatios }),
    ...(opts.operationDelayMs !== undefined && { operationDelayMs: opts.operationDelayMs }),
    ...(opts.behaviors !== undefined && { behaviors: opts.behaviors }),
    // commander がここを `false` にするのは --no-site-behaviors を渡したときだけ。
    // 既定の `true` は「指定なし」の意味なので、wire に出してはならない。
    ...(opts.siteBehaviors === false && { siteBehaviors: false }),
    ...(opts.session !== undefined && { session: opts.session }),
  };
};

export const getCaptureFormats = (options: ClientOptions): CaptureFormats => {
  return {
    png: options.png ?? false,
    webp: options.webp ?? false,
    html: options.html ?? false,
    links: options.links ?? false,
    mhtml: options.mhtml ?? false,
    wacz: options.wacz ?? false,
  };
};

/**
 * 実行ごとの取り込み設定を、`submitRequest` がリクエストの body へ展開する
 * オブジェクトに畳む。
 *
 * `captureFormats` と `dismissBanners` は必ず在る —— 前者は server が要求し、
 * 後者は素の boolean の既定値を持つため。それ以外は呼ぶ側が実際に求めたときだけ
 * 入れるので、残りには BrowserHive が自分の既定値を当て続ける。
 */
export const getCaptureSettings = (options: ClientOptions): CaptureSettings => {
  const behaviors = {
    ...(options.behaviors !== undefined && { builtins: options.behaviors }),
    ...(options.siteBehaviors === false && { siteBehaviors: false }),
  };

  // #region capture-settings
  return {
    captureFormats: getCaptureFormats(options),
    dismissBanners: options.dismissBanners ?? false,
    ...(options.acceptLanguage !== undefined && { acceptLanguage: options.acceptLanguage }),
    ...(options.devicePixelRatios !== undefined && {
      devicePixelRatios: options.devicePixelRatios,
    }),
    ...(options.operationDelayMs !== undefined && { operationDelayMs: options.operationDelayMs }),
    ...(Object.keys(behaviors).length > 0 && { behaviors }),
    ...(options.session !== undefined && { session: options.session }),
  };
  // #endregion capture-settings
};

export const logClientConfig = (options: ClientOptions): void => {
  const settings = getCaptureSettings(options);
  logger.info(
    {
      server: options.server ?? DEFAULT_TARGET,
      // CA が名指しされているときに限って TLS が有効になる —— 宛先には scheme が
      // 無いので、食い違う余地がない。
      tls: options.tlsCaCert
        ? { enabled: true, caCertPath: options.tlsCaCert }
        : { enabled: false },
      database: maskPassword(options.databaseUrl),
      // 実際に送られる settings をそのままログに出す。妙な取り込みが起きたとき、
      // どの旗が効いていたのかを推測せず、この 1 行から説明できるようにするため。
      capture: settings,
      limit: options.limit ?? null,
    },
    "Client configuration",
  );
};
