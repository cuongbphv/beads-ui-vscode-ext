#!/usr/bin/env bash
# bd-sync — đồng bộ CẶP code + beads giữa các máy, một lệnh.
#
#   scripts/bd-sync.sh pull     # mở phiên:  git pull --ff-only  +  bd dolt pull
#   scripts/bd-sync.sh push     # đóng phiên: git push           +  bd dolt push
#   scripts/bd-sync.sh status   # ahead/behind + beads stats + dolt ref trên remote
#
# Vì sao tồn tại: code và trạng thái việc là HAI kênh trên cùng một remote
# (branch thường + refs/dolt/data). Quên một kênh là hai máy kể hai câu chuyện.
#
# Chữ ký lỗi đã trả giá (handoff 2026-08-03): gitlab sau proxy — VPN rớt
# là 403 cho MỌI request kể cả ẩn danh. Đó là lỗi MẠNG, không phải lỗi quyền;
# script này phân biệt hộ để không ai đi cấu hình lại credentials vô ích.
set -u

REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)

preflight() {
  local out
  out=$(git ls-remote --heads origin 2>&1 >/dev/null) && return 0
  if printf '%s' "$out" | grep -q "403"; then
    echo "✗ Remote trả 403 toàn tuyến → gần như chắc chắn VPN/proxy rớt (KHÔNG phải lỗi credentials)." >&2
    echo "  Bật VPN rồi chạy lại. Kiểm nhanh: curl -sS -o /dev/null -w '%{http_code}\n' $REMOTE_URL" >&2
  else
    echo "✗ Không với tới remote:" >&2
    printf '%s\n' "$out" | head -3 >&2
  fi
  return 2
}

case "${1:-}" in
  pull)
    preflight || exit 2
    echo "== git pull --ff-only =="
    git pull --ff-only || { echo "✗ Không fast-forward được — có commit local chưa push hoặc lịch sử rẽ nhánh. Xử tay rồi chạy lại." >&2; exit 1; }
    echo "== bd dolt pull =="
    if ! bd dolt pull; then
      echo "✗ bd dolt pull FAIL — kênh beads CHƯA đồng bộ (git thì đã pull rồi)." >&2
      echo "  Nếu lỗi là timeout/connect: VPN chập chờn — đợi ổn định rồi chạy lại CHỈ 'bd dolt pull'." >&2
      exit 1
    fi
    echo "✓ pull xong cả hai kênh. bd ready để xem việc."
    ;;
  push)
    preflight || exit 2
    if ! git diff --quiet || ! git diff --cached --quiet; then
      echo "⚠ Còn thay đổi chưa commit (tracked):" >&2
      git status --short | grep -v '^??' | head -10 >&2
      echo "  Commit trước (git commit --only <path>) rồi push — không push cây dở." >&2
      exit 1
    fi
    echo "== git push =="
    git push || exit 1
    echo "== bd dolt push =="
    if ! bd dolt push; then
      echo "✗ bd dolt push FAIL — code đã lên nhưng kênh beads CHƯA. Chạy lại 'bd dolt push' khi mạng ổn." >&2
      exit 1
    fi
    echo "== xác nhận refs/dolt trên remote (đừng tin lời khai, hỏi remote) =="
    if git ls-remote origin 2>/dev/null | grep -q dolt; then
      echo "✓ push xong cả hai kênh — refs dolt CÓ THẬT trên remote."
    else
      echo "✗ git push ok nhưng KHÔNG thấy refs dolt trên remote — bd dolt push chưa ăn. Đọc output phía trên." >&2
      exit 1
    fi
    ;;
  status)
    echo "== git (so với origin, cần mạng để fetch số mới) =="
    if git fetch -q 2>/dev/null; then
      git rev-list --left-right --count origin/"$(git branch --show-current)"...HEAD \
        | awk '{print "  behind " $1 "  ·  ahead " $2}'
    else
      echo "  (offline — số dưới đây so với lần fetch cuối)"
      git rev-list --left-right --count origin/"$(git branch --show-current)"...HEAD \
        | awk '{print "  behind " $1 "  ·  ahead " $2}'
    fi
    echo "== refs dolt trên remote =="
    if git ls-remote origin 2>/dev/null | grep -q dolt; then echo "  ✓ có"; else echo "  ✗ chưa thấy (chưa từng bd dolt push thành công, hoặc offline)"; fi
    echo "== beads local =="
    bd stats 2>/dev/null | sed -n '4,9p'
    ;;
  *)
    echo "Usage: scripts/bd-sync.sh {pull|push|status}" >&2
    exit 64
    ;;
esac
