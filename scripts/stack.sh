#!/usr/bin/env bash
#
# 開発スタックの起動と停止。**これが唯一の起動方法。**
#
# ## なぜ包むのか
#
# 署名を使うには 2 つのことが同時に要る:
#
#   1. `wacz-signer` と `tsa` が起きていること      → --profile signing
#   2. BrowserHive が署名の宛先を知っていること  → --env-file signing.env
#
# `container-compose` に `COMPOSE_PROFILES` は無いので、この 2 つを 1 つの設定から
# 導くには薄い層が要る。生の `container-compose up` を叩くと片方だけを渡せてしまい、
# **「宛先は在るが相手が居ない」状態が作れる** —— 実際にそうなっていて、署名を
# 有効にした取り込みが全部 `ENOTFOUND wacz-signer.capture-ledger` で落ちた。
#
# 出どころは `.env` の `CAPTURE_LEDGER_CAPTURE_SIGNING` **1 つだけ**。同じ変数を capture-ledger 自身も
# 読む (`config/capture-formats.ts`) ので、「署名を頼む側」と「署名を用意する側」が
# 食い違えない。
#
# ## 使い方
#
#   ./scripts/stack.sh up            # 起動 (-d -b は既定で付く)
#   ./scripts/stack.sh down          # 停止
#   ./scripts/stack.sh up --profile capture-fixtures --profile search
#
# 余分な引数はそのまま container-compose へ渡る。`fixtures` と `search` を包まないのは、
# どちらも黙っては壊れないから —— fixtures は実行時に種として選ぶもので、search は
# URL が空なら capture-ledger が口ごと出さない。
set -euo pipefail

cd "$(dirname "$0")/.."

SUBCOMMAND="${1:-up}"
shift || true

# `.env` から 1 行だけ読む。`source` しないのは、`.env` の他の値 (パスワードなど) を
# この shell に持ち込まないため。
signing_enabled() {
  [ -f .env ] || return 1
  grep -qE '^[[:space:]]*CAPTURE_LEDGER_CAPTURE_SIGNING[[:space:]]*=[[:space:]]*1[[:space:]]*$' .env
}

# **空配列の展開は `set -u` に当たる。** macOS の bash は 3.2 で、そこでは
# `"${arr[@]}"` が「未定義の変数」として落ちる (実測)。`${arr[@]+...}` の形にすると
# 空のときは何も展開されず、素通りする。
profile_args=()
env_args=()

if signing_enabled; then
  profile_args=(--profile signing)
  env_args=(--env-file signing.env)
  echo "署名: 有効 (.env の CAPTURE_LEDGER_CAPTURE_SIGNING=1)"
  echo "  → --profile signing   wacz-signer と tsa を起こす"
  echo "  → --env-file signing.env   BrowserHive に署名の宛先を渡す"
else
  echo "署名: 無効"
  echo "  wacz-signer と tsa は起こさない。BrowserHive は署名の宛先を持たない ——"
  echo "  署名を要求した取り込みは 'no signing service is configured' で失敗する。"
  echo "  有効にするには .env に CAPTURE_LEDGER_CAPTURE_SIGNING=1 を書く。"
fi
echo

case "${SUBCOMMAND}" in
  up)
    # submodule の版を build 引数として渡す。渡さないと image は "unknown" を名乗り、
    # **その値が archive に焼き込まれる**。詳しくは scripts/submodule-versions.sh。
    # shellcheck source=scripts/submodule-versions.sh
    . "$(dirname "$0")/submodule-versions.sh"
    export_submodule_versions

    # `-d -b` を既定にするのは、docs がずっとそう案内してきたから。
    exec container-compose ${profile_args[@]+"${profile_args[@]}"} up -d -b ${env_args[@]+"${env_args[@]}"} "$@"
    ;;
  down)
    # down にも profile を渡す。渡さないと、profile の中のサービスが
    # 「このスタックのもの」と見なされず止め残る。
    exec container-compose ${profile_args[@]+"${profile_args[@]}"} down ${env_args[@]+"${env_args[@]}"} "$@"
    ;;
  *)
    echo "使い方: $0 [up|down] [container-compose への追加の引数...]" >&2
    exit 2
    ;;
esac
