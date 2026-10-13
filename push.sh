#!/usr/bin/env bash
# AI 小镇 — GitHub 推送自检与一键推送
# 用法：bash push.sh
# 配好 SSH 公钥后，这个脚本会自动完成推送。
set -uo pipefail

cd "$(dirname "$0")" || exit 1

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'

echo "${BOLD}AI 小镇 — 推送自检${OFF}"
echo "${DIM}$(pwd)${OFF}"
echo

# ---------- 1. 网络 ----------
echo "${BOLD}1/5 网络${OFF}"
if timeout 12 bash -c 'cat < /dev/null > /dev/tcp/ssh.github.com/443' 2>/dev/null; then
  echo "  ${GREEN}✓${OFF} ssh.github.com:443 可达"
else
  echo "  ${RED}✗${OFF} ssh.github.com:443 不可达"
  echo "    ${YELLOW}检查网络或代理后重试${OFF}"
  exit 1
fi

# ---------- 2. 密钥 ----------
echo "${BOLD}2/5 SSH 密钥${OFF}"
KEY="$HOME/.ssh/id_ed25519"
if [ -f "$KEY" ]; then
  echo "  ${GREEN}✓${OFF} 私钥存在：$KEY"
  echo "  ${DIM}公钥指纹 $(ssh-keygen -lf "$KEY.pub" 2>/dev/null | awk '{print $2}')${OFF}"
else
  echo "  ${RED}✗${OFF} 私钥不存在，正在生成…"
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  ssh-keygen -t ed25519 -C "ai-town-push@$(hostname)" -f "$KEY" -N "" -q && echo "  ${GREEN}✓${OFF} 已生成"
fi

# ---------- 3. 认证 ----------
# 本机坑点：$HOME 与 /etc/passwd 的家目录不一致，ssh 读不到 ~/.ssh/config，
# 所以一律用 SSH_WRAP 显式传参（脚本同目录的 .ssh/git-ssh.sh）。
echo "${BOLD}3/5 GitHub 认证${OFF}"
SSH_WRAP="${SSH_WRAP:-$HOME/.ssh/git-ssh.sh}"
if [ ! -x "$SSH_WRAP" ]; then
  echo "  ${RED}✗${OFF} 找不到 $SSH_WRAP"
  exit 1
fi
AUTH_OUT=$(timeout 25 "$SSH_WRAP" -T git@github.com 2>&1 || true)
if echo "$AUTH_OUT" | grep -q "successfully authenticated"; then
  WHO=$(echo "$AUTH_OUT" | grep -o 'Hi [^!]*' | head -1)
  echo "  ${GREEN}✓${OFF} 认证成功（$WHO）"
else
  echo "  ${RED}✗${OFF} 认证失败"
  if echo "$AUTH_OUT" | grep -q "Permission denied"; then
    echo
    echo "  ${YELLOW}这个公钥还没加到 GitHub，需要做一次（只需一次）：${OFF}"
    echo "    1. 浏览器打开  https://github.com/settings/keys"
    echo "    2. 点 ${BOLD}New SSH key${OFF}，Title 随便填（如 fnOS-j1900）"
    echo "    3. Key 框里粘贴下面这一整行，然后点 Add SSH key："
    echo
    echo "${GREEN}$(cat "$KEY.pub")${OFF}"
    echo
    echo "  加好后重新运行：${BOLD}bash push.sh${OFF}"
  else
    echo "  ${DIM}$AUTH_OUT${OFF}"
  fi
  exit 1
fi

# ---------- 4. 待推送内容 ----------
echo "${BOLD}4/5 待推送${OFF}"
git -c core.sshCommand="$SSH_WRAP" fetch origin --quiet 2>/dev/null || true
AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo "?")
BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")
echo "  本地领先 $AHEAD 个提交，落后 $BEHIND 个"
if [ -n "$(git status --porcelain)" ]; then
  echo "  ${YELLOW}!${OFF} 有未提交改动："
  git status --short | sed 's/^/      /'
else
  echo "  ${GREEN}✓${OFF} 工作区干净"
fi
if [ "$AHEAD" = "0" ]; then
  echo "  ${GREEN}✓${OFF} 已与远程同步，无需推送"
  exit 0
fi

# ---------- 5. 推送 ----------
echo "${BOLD}5/5 推送${OFF}"
if git -c core.sshCommand="$SSH_WRAP" push origin main; then
  echo
  echo "${GREEN}${BOLD}✓ 推送完成${OFF}"
  git log --oneline -3 | sed 's/^/    /'
else
  echo "  ${RED}✗${OFF} 推送失败。若提示 non-fast-forward，先运行：\n    git -c core.sshCommand=\"$SSH_WRAP\" pull --rebase origin main"
  exit 1
fi
