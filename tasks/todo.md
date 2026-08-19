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
