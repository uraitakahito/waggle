#!/bin/bash
#
# setup.sh —— waggle のローカル開発環境を用意する。
#
# ここでやること:
#   1. Apple Container の道具が入っているかを見る。
#   2. `waggle` の DNS ドメインが登録されていなければ、続けずに止まる。
#   3. submodule を初期化する。
#   4. host 側の接続文字列と、開発用の仮 identity を .env に書く。
#

set -e

cd "$(dirname "$0")"

# `--help` は、上のヘッダコメントをそのまま出力にする。ヘルプ本文を別に持つと、
# コメントと出力の 2 つが独立にずれていくので、出どころを 1 つにしている。
#
#   sed -n '3,10p'      このファイルの 3–10 行目、つまりヘッダの塊だけを取る
#   sed 's/^# \{0,1\}//' 各行の先頭の `# ` を剥がす (空行は `#` だけなので 1 文字も可)
#
# **行の範囲は直書きなので、ヘッダを増減させたらここも直すこと。** 直し忘れると
# 出力が途中で切れるか、`set -e` などの次の行まではみ出す —— どちらも
# 「--help を叩いた人にしか見えない」壊れ方で、テストは緑のまま。
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "ERROR: unexpected argument: $1" >&2
  echo "Run '$0 --help' for usage." >&2
  exit 1
fi

# --- 道具立て -------------------------------------------------------------
for cmd in container container-compose git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: \`$cmd\` is required but not on PATH." >&2
    echo "Install Apple Container and container-compose (Homebrew), then re-run." >&2
    exit 1
  fi
done

# --- DNS ドメイン ---------------------------------------------------------
# docker-compose.yml の project 名が、そのまま DNS ドメインになる。登録されて
# いないと container-compose は /etc/hosts を書き換える方式に落ちるが、これは
# このスタックの非 root コンテナ (browserhive、chromium) では黙って失敗する ——
# 症状が「名前がなぜか解決しない」になるので、ここで大きな音を立てて止める。
if ! container system dns ls 2>/dev/null | grep -qx "waggle"; then
  echo "ERROR: the 'waggle' DNS domain is not registered." >&2
  echo "" >&2
  echo "    sudo container system dns create waggle" >&2
  echo "" >&2
  echo "Run that once (it needs sudo), then re-run this script." >&2
  exit 1
fi

# --- 上流の submodule -----------------------------------------------------
echo "Initialising upstream submodule..."
git submodule update --init --recursive
git submodule status --recursive | sed 's/^/  /'

# --- .env を書く ----------------------------------------------------------
# host 側が必要とするものだけ: waggle は host で動き、スタックへはプラット
# フォームの DNS を通って届く。サービス間の配線は docker-compose.yml に在る。
#
# WAGGLE_DEV_* は認証ではない。誰が投げたかを記録に残すための足場で、
# 検証は一切されない —— .env を書き換えれば誰にでも成りすませる。本物の
# identity provider が決まるまでの繋ぎなので、そのつもりで扱うこと。
cat > .env <<EOF
DATABASE_URL=postgres://waggle:waggle@postgres.waggle:5432/waggle
BROWSERHIVE_SERVER=browserhive.waggle:50051
LOG_LEVEL=info
WAGGLE_DEV_SUBJECT=${USER:-dev}
WAGGLE_DEV_ORGANIZATIONS=acme
EOF
echo "Created .env"

cat <<'EOF'

Setup complete.

  container-compose up -d -b                  # build and start the stack
  until grpcurl -plaintext -import-path proto -proto browserhive/v1/capture.proto \
    localhost:50051 browserhive.v1.CaptureService/GetStatus >/dev/null 2>&1; do sleep 1; done

Then work on the host — there is no dev container; the stack is reachable by
name:

  pnpm install
  pnpm run db:migrate && pnpm run db:seed
  pnpm run dev --webp --limit 3
EOF
