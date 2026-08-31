#!/bin/bash
#
# setup.sh —— waggle のローカル開発環境を用意する。
#
# ここでやること:
#   1. Apple Container の道具が入っているかを見る。
#   2. `waggle` の DNS ドメインが登録されていなければ、続けずに止まる。
#   3. submodule を初期化する。
#   4. .env.example を写して .env を作る (subject は実行者の名前にする)。
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
# いないと container-compose は、起動後に `container exec` で **各コンテナの中の**
# /etc/hosts へ相手の行を追記する方式に落ちる (ホスト側の /etc/hosts は触らない)。
#
# その追記は非 root のコンテナ (browserhive=uid 1000、chromium=uid 999) では
# 書き込めずに失敗するが、container-compose は exec の終了状態を見ず stderr も
# 捨てるので **何も言わない**。しかも root のコンテナ (postgres、seaweedfs、
# replay) では成功するため、「一部のサービスだけ名前が引けない」という追いにくい
# 症状になる。だからここで大きな音を立てて止める。
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
# 一覧はここに持たず、.env.example を写す。**独自の一覧を持つと必ずずれる** ——
# 以前ここは heredoc で 5 個だけ書いていて、`required` な 7 個のうち 4 個
# (WAGGLE_S3_*) が最初から欠けた .env が出来ていた。docs が案内するとおりに
# 進めた人が `pnpm run api` で落ちる、という形で表に出る。
#
# 雛形の側は scripts/check-env.mjs が src/ と scripts/ の実際の読み取りと
# 突き合わせているので、変数が増えればここも自動的に追随する。
#
# WAGGLE_DEV_* は認証ではない。誰が投げたかを記録に残すための足場で、
# 検証は一切されない —— .env を書き換えれば誰にでも成りすませる。本物の
# identity provider が決まるまでの繋ぎなので、そのつもりで扱うこと。
cp .env.example .env

# subject だけは実行者の名前にする。雛形には中立な `dev` が入っている。
# `sed -i` の書式が BSD と GNU で違うので、一時ファイルを経由する。
sed "s/^WAGGLE_DEV_SUBJECT=.*/WAGGLE_DEV_SUBJECT=${USER:-dev}/" .env > .env.tmp
mv .env.tmp .env
echo "Created .env (from .env.example)"

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

The archive API additionally needs the two OpenFGA ids, which do not exist
until the model has been deployed. Paste them into .env:

  pnpm run fga:migrate && pnpm run fga:deploy   # prints store id and model id
  pnpm run api                                  # then http://127.0.0.1:7070/
EOF
