/**
 * BrowserHive とやり取りする、取り込み形式の旗。
 *
 * 上流の `submitCapture` が `captureFormats` に期待する boolean の形をそのまま
 * 写している。6 つとも必須で (1.6.0 の spec が `additionalProperties: false`)、
 * どれも既定は `false`。少なくとも 1 つが `true` でなければ server が受け付けない。
 */
export interface CaptureFormats {
  png: boolean;
  webp: boolean;
  html: boolean;
  links: boolean;
  mhtml: boolean;
  wacz: boolean;
}

/**
 * 1 回の実行が **どう** 撮るか。**何を** 撮るか (URL。`urls` テーブルから来る) の
 * 反対側。
 *
 * URL ごとではなく実行ごとの設定で、これは `dismissBanners` と `acceptLanguage` が
 * 元からそうだったのに合わせている: CLI が意図を 1 度述べ、その実行の全エントリが
 * それを継ぐ。1 回の実行の中で URL ごとに変えたくなったら、その設定は `urls`
 * テーブルのほうに属する。
 *
 * ここの optional な field はどれも server 側に既定値があるので、設定しない field は
 * **リクエストの body から省く**。`undefined` として送るのではない —— それが、
 * BrowserHive の今の既定値を waggle が知らないままで `--device-pixel-ratios` の
 * ような旗を opt-in に保つ仕掛けになっている。
 */
export interface CaptureSettings {
  captureFormats: CaptureFormats;
  dismissBanners: boolean;
  acceptLanguage?: string;
  /**
   * 読み込む device pixel ratio を、読み込む順に。各要素は 1–3 の整数で、同じ値を
   * 2 度置くことはできない。それ以外は server が INVALID_ARGUMENT で拒む。
   *
   * 要素数がそのまま読み込みの回数になるので、所要時間も WARC のバイト数も要素数に
   * 比例して増える。順序に意味がある: PNG / WebP は読み込みが全部終わってから 1 度
   * だけ撮るので、**最後の要素**の倍率で出る —— `[2, 1]` と書けば画像は 1x で残る。
   *
   * `deviceScaleFactor` と `archiveMode` を置き換えたもの。BrowserHive が v3.6.0 で
   * 削除した (proto の `reserved 13, 14`。番号を再利用してはならない —— 旧 client の
   * `archive_mode = MULTIPASS` が `device_pixel_ratios = [2]` として読まれるため)。
   */
  devicePixelRatios?: number[];
  operationDelayMs?: number;
  /**
   * この取り込みが、同じ worker の前のタスクから状態を持ち越すか。
   *
   *   isolated (既定) —— 使い捨ての BrowserContext。cookie / HTTP キャッシュ /
   *                      localStorage / sessionStorage / IndexedDB が空から始まる。
   *   shared          —— worker が持ち回る context とタブを使う。後始末は無い。
   *
   * BrowserHive v5.0.0 で `cache` と `resetState` を置き換えたもの。あの 3 つの
   * つまみはどれも origin ストレージを覆っておらず、localStorage からフィードを
   * 復元するページ (www.yahoo.co.jp) がアーカイブに入らないことに気づけなかった。
   */
  session?: "isolated" | "shared";
  behaviors?: {
    builtins?: string[];
    siteBehaviors?: boolean;
  };
}
