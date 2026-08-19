# 段 6 — waggle を gRPC/Protobuf クライアントへ

browserhive v3.0.0 で transport が gRPC になった。waggle は生成 SDK
(`src/http/generated/`, 6 ファイル / 1,140 行) 越しに HTTP を叩いているので、
そこを丸ごと差し替える。破壊的変更でよい。

## 6a 道具立て

- [ ] `@grpc/grpc-js` + `ts-proto` + `@bufbuild/buf` を入れ、`@hey-api/*` を抜く
- [ ] `buf.gen.yaml`(browserhive と同じ opt)を置く
- [ ] scripts: `openapi:sync` → `proto:sync`、`openapi:generate` → `proto:generate`、
      `openapi:check` → `proto:check`
- [ ] `openapi-ts.config.ts` と `openapi/browserhive.yaml` を削除

## 6b 生成

- [ ] submodule から `capture.proto` を取り込み、`src/rpc/generated/` を生成
- [ ] `src/http/generated/` を削除

## 6c クライアント

- [ ] `src/client/openapi-client.ts` → `src/rpc/client.ts`(grpc-js のクライアント)
- [ ] `--tls-ca-cert` を実際に効かせる(grpc-js は CA を直接受け取る。
      NODE_EXTRA_CA_CERTS 頼みの「情報提供だけ」から実装へ)

## 6d 呼び出し側

- [ ] `src/client/submit.ts` — 202 判定 → gRPC の status code
- [ ] `src/archive/watch.ts` — 202/200/404 → `CaptureState` + `NOT_FOUND`
- [ ] `src/archive/register.ts` — **`report.status !== "success"` が壊れる**。
      マニフェストの enum が `CAPTURE_STATUS_SUCCESS` になったため。無言で
      「1 件も登録しない」に落ちるので、ここは必ず直す
- [ ] `src/archive/reconcile.ts` — マニフェストの型を生成物から取る

## 6e CLI

- [ ] `--server` の既定を `localhost:50051` に(SDK の baked-in baseUrl が消える)

## 6f テスト

- [ ] fetch を差し替えていたテストを grpc クライアントの差し替えへ

## 6g docs / リリース

- [ ] docs の `POST /v1/captures` 等を RPC 名へ
- [ ] submodule を v3.0.0 に上げてリリース

## 持ち越し

- browserhive の `@grpc/reflection` が未使用のまま dependencies に残っている
  (`src/rpc/server.ts` のコメントが「載せていない」と書いている)。次の
  patch で外す

---

## 結果 (2026-08-19)

段 6 は完了。全項目済み。加えて、移行の過程で **browserhive 側の欠陥を 2 件**
見つけて別途リリースした。

### waggle 側で見つけた欠陥

- **`register.ts` の `report.status !== "success"`**。マニフェストが protobuf
  JSON になり `CAPTURE_STATUS_SUCCESS` になるので、この比較は型が通るのに常に真
  = 台帳に 1 件も載らない。ログには「capture produced no archive」としか出ない。
  enum 比較に直し、マニフェストは生成物の `fromJSON` で読むようにした
  (`src/archive/manifest.ts`)
- **Dockerfile が `COPY openapi/`** で消えたディレクトリを指していた。冒頭の
  コメントも全滅 (`Dockerfile.prod` / `compose.prod.yaml` / `--data` / `--jpeg`
  はどれも存在しない)
- **architecture の「waggle はポーリングしない」が嘘**。`watch.ts` と
  `reconcile.ts` がある

### browserhive 側で見つけた欠陥

- **v3.0.1**: `RpcServer` が `coordinator.initialize()` を呼んでいない。
  v3.0.0 は capture を 1 件も受け付けない
- **v3.0.2**: `Dockerfile.prod` が段 2 で消した `redocly.yaml` /
  `openapi-ts.config.ts` / `dist/openapi.dereferenced.json` を COPY していた。
  本番イメージがビルドできない

### 副次的に直したもの

- **`lib.dom` を落とせた**。必要だったのは hey-api の fetch クライアントの
  ためだけで、AWS SDK は要らなかった (実際に外して確認)
- **CI が submodule を clone できなくなっていた** (browserhive の private 化の
  副作用。私の変更とは無関係に develop / main も落ちる)。GitHub App トークンを
  使う形にした。**App の作成と secret 登録は別途必要**

### 持ち越し

- browserhive の `@grpc/reflection` が未使用のまま dependencies に残っている

### end-to-end 検証 (2026-08-19)

`./scripts/prod-smoke.sh` が **exit 0**。Apple Container 上に Postgres /
SeaweedFS / OpenFGA / chromium x2 / BrowserHive v3.0.2 を立てて実際に 1 件
キャプチャした。

  msg="Request accepted"   taskId=e1cd3689-… labels=["ledger"]
  msg="archive registered" archiveId=e344a736-…
  msg="Request summary"    accepted=1 rejected=0 durationMs=6122

2 行目が register.ts の修正 (protobuf JSON のマニフェストを enum で読む) が
効いている証拠。直す前はここが「capture produced no archive」になる。

3 回走らせて 3 回とも別の欠陥を出した:

  1 回目 — browserhive のイメージがビルドできない (-> v3.0.2)
  2 回目 — @bufbuild/protobuf が production 依存に無い (-> 検査を追加)
  3 回目 — 通った

### 残っているもの

**waggle のリリースは CI 待ち。** `Docs sync guard` が GitHub App の設定待ちで
赤い (browserhive の private 化の副作用。この PR とは無関係に develop / main も
落ちる)。App を作って UPSTREAM_APP_ID / UPSTREAM_APP_KEY を登録すれば緑になる。
