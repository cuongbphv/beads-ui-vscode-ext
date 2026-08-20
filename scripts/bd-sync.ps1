# bd-sync.ps1 — bản Windows (máy nhà) của scripts/bd-sync.sh. Cùng hợp đồng:
#   .\scripts\bd-sync.ps1 pull    # mở phiên:  git pull --ff-only + bd dolt pull
#   .\scripts\bd-sync.ps1 push    # đóng phiên: git push          + bd dolt push
#   .\scripts\bd-sync.ps1 status
# 403 toàn tuyến từ gitlab = VPN/proxy rớt, KHÔNG phải lỗi credentials.
param([Parameter(Mandatory = $true)][ValidateSet('pull', 'push', 'status')][string]$Cmd)

$ErrorActionPreference = 'Stop'

function Test-Remote {
    $out = git ls-remote --heads origin 2>&1
    if ($LASTEXITCODE -eq 0) { return $true }
    if ("$out" -match '403') {
        Write-Warning "Remote 403 toàn tuyến → VPN/proxy rớt (KHÔNG phải lỗi credentials). Bật VPN rồi chạy lại."
    } else {
        Write-Warning "Không với tới remote: $out"
    }
    return $false
}

switch ($Cmd) {
    'pull' {
        if (-not (Test-Remote)) { exit 2 }
        git pull --ff-only
        if ($LASTEXITCODE -ne 0) { Write-Error 'Không fast-forward được — xử tay rồi chạy lại.'; exit 1 }
        bd dolt pull
        if ($LASTEXITCODE -ne 0) { exit 1 }
        Write-Host '✓ pull xong cả hai kênh. bd ready để xem việc.'
    }
    'push' {
        if (-not (Test-Remote)) { exit 2 }
        git diff --quiet; $dirty1 = $LASTEXITCODE
        git diff --cached --quiet; $dirty2 = $LASTEXITCODE
        if ($dirty1 -ne 0 -or $dirty2 -ne 0) {
            Write-Warning 'Còn thay đổi tracked chưa commit — commit (git commit --only <path>) rồi push. Không push cây dở.'
            git status --short | Select-String -NotMatch '^\?\?' | Select-Object -First 10
            exit 1
        }
        git push
        if ($LASTEXITCODE -ne 0) { exit 1 }
        bd dolt push
        if ($LASTEXITCODE -ne 0) { exit 1 }
        $refs = git ls-remote origin 2>$null | Select-String 'dolt'
        if ($refs) { Write-Host '✓ push xong cả hai kênh — refs dolt CÓ THẬT trên remote.' }
        else { Write-Error 'git push ok nhưng KHÔNG thấy refs dolt trên remote — bd dolt push chưa ăn.'; exit 1 }
    }
    'status' {
        git fetch -q 2>$null | Out-Null
        $branch = git branch --show-current
        git rev-list --left-right --count "origin/$branch...HEAD"
        $refs = git ls-remote origin 2>$null | Select-String 'dolt'
        if ($refs) { Write-Host 'refs dolt trên remote: ✓ có' } else { Write-Host 'refs dolt trên remote: ✗ chưa thấy (hoặc offline)' }
        bd stats
    }
}
