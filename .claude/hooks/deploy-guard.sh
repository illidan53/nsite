#!/usr/bin/env bash
# Stop hook：nsite 有未上线的改动（未提交的文件，或未推送到 origin/main 的提交）时，
# 不让 Claude 结束本轮，而是要求先检查、提交、（改了 infra/ 或 api/ 时）pulumi up、推送并确认部署。
# 已经因本 hook 继续过一次仍未完成时放行，并提醒用户，避免死循环。

set -uo pipefail
input=$(cat)
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

dirty=$(git status --porcelain --untracked-files=normal)
git fetch -q origin main 2>/dev/null || true
ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
[ -z "$dirty" ] && [ "$ahead" = "0" ] && exit 0

files=$(printf '%s\n' "$dirty" | grep -c . || true)
infra=$({ git diff --name-only origin/main...HEAD 2>/dev/null; printf '%s\n' "$dirty" | cut -c4-; } | grep -E '^(infra|api)/' | sort -u | tr '\n' ' ')
active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)

if [ "$active" = "true" ]; then
  jq -n --arg m "nsite 仍有未上线的改动（未提交 $files 个文件、未推送 $ahead 个提交），自动上线没有完成，请查看上面的说明。" \
    '{systemMessage: $m}'
  exit 0
fi

steps=()
steps+=("npm run lint && npm test && npm run build")
steps+=("git add -A，写清楚的提交说明（结尾带 Co-Authored-By 署名），不要提交密钥或站长 IP 明文")
if [ -n "$infra" ]; then
  steps+=("这些基础设施/后端文件有改动：${infra}—— 先 cd infra && AWS_PROFILE=nphunter-sso pulumi preview -s illidan53/nsite-infra/prod 确认，再 pulumi up --yes")
fi
steps+=("git push origin main，等 GitHub Actions 的 Deploy 跑完并成功")
steps+=("在 https://global-network.nphunter.gg 上核对改动已生效")
list=""
for i in "${!steps[@]}"; do list="$list$((i + 1))) ${steps[$i]}；"$'\n'; done
list="${list}如果检查失败、AWS SSO 过期或需要用户决定，停下来说明具体阻塞点，不要硬推。"

jq -n --arg r "nsite 有未上线的改动（未提交 $files 个文件、未推送 $ahead 个提交）。按“改完自动上线”的约定，结束前请完成：
$list" '{decision: "block", reason: $r}'
exit 0
