---
description: Lặp qua board beads, mỗi vòng nhận đúng MỘT bead tự làm được và giao bằng bằng chứng
argument-hint: "[--include-partial] [--dry-run]"
---

Bạn đang chạy một vòng của `/bead-loop`. Tham số: **$ARGUMENTS**

**Một vòng = MỘT bead.** Làm xong thì kết thúc lượt, không nhận bead thứ hai trong
cùng lượt — context phình lên là cách chắc chắn nhất để vòng sau đọc sai board.

## 0. Nhãn phân loại — nguồn duy nhất

Mọi bead không phải epic trên board phải mang đúng một trong ba nhãn này (gán từ
description + notes + acceptance của từng bead, kèm lý do đo được trong notes):

| Nhãn | Nghĩa | Loop được làm gì |
|---|---|---|
| `auto-ok` | Toàn bộ điều kiện đóng đạt được bằng code + test trong repo | Làm trọn, **được** `bd close` |
| `auto-partial` | Phần code làm được trong repo, nhưng chuẩn đóng đòi tài nguyên ngoài (CI thật xanh, môi trường thật) | Làm phần code, **KHÔNG** `bd close` — dừng ở `--append-notes` |
| `needs-human` | Chuẩn đóng đòi người: hạ tầng thật, credential vai người, chi phí ngoài, bên thứ ba, soak nhiều giờ, hoặc một quyết định của user | **Không đụng** |

**Bead không có nhãn nào trong ba nhãn trên = CHƯA phân loại, không phải "tự làm
được".** Gặp là dừng và báo, tuyệt đối không suy ra nhãn từ tiêu đề — unmeasured is
not zero. Nhãn mới phải kèm lý do đo được ghi vào notes của chính bead đó.

## 1. Chọn bead

Thay `<args>` bằng đúng chuỗi `$ARGUMENTS` của lượt này. Bốn chi tiết đã đo, mỗi
cái đều làm script sai **lặng** nếu bỏ:

- `ARGS=` phải đi qua **env** — heredoc `python - <<PY` không nhận `sys.argv`, nên
  không có nó thì `--include-partial` thành no-op không báo lỗi.
- **Không ghi board ra `/tmp`.** Git Bash map `/tmp` vào `%TEMP%`, Python trên
  Windows hiểu `/tmp` là `C:\tmp` — `bd … > /tmp/board.json` ghi thành công rồi
  Python `FileNotFoundError` ngay dòng sau. Đọc `bd` qua `subprocess` là xong.
- **Ứng viên phải lấy từ `bd ready`, không phải `bd list`.** `bd list` không biết
  dependency: đã đo trên board thật, bộ lọc dựa trên `bd list` chọn nhầm một bead
  `open` + đúng nhãn + không assignee trong khi bead khác đang chặn nó — sai thứ tự
  phụ thuộc mà không báo gì. `bd ready` là thứ duy nhất blocker-aware (help của nó:
  "Excludes in_progress, blocked, deferred, and hooked issues").
- **`--label-any` của `bd ready` KHÔNG lọc** — đã đo: kết quả trả về gồm cả nhiều
  bead không mang nhãn yêu cầu (kể cả bead `needs-human`). Dạng AND `--label <x>`
  thì đúng. Vì `--include-partial` cần OR hai nhãn, **lọc nhãn làm trong Python** —
  một đường code, không dựa vào một flag đã đo là hỏng. Đừng "tối ưu" nó về
  `--label-any` khi chưa đo lại trên phiên bản `bd` đang dùng.

```bash
ARGS="<args>" PYTHONIOENCODING=utf-8 python - <<'PY'
import json,os,subprocess
def bd(*a):
    r=subprocess.run(['bd',*a],capture_output=True,text=True,encoding='utf-8')
    if r.returncode: print('bd %s that bai rc=%d'%(' '.join(a),r.returncode),r.stderr[:400]); raise SystemExit(1)
    return json.loads(r.stdout)
CLS={'auto-ok','auto-partial','needs-human'}
# (1) Guard "chua phan loai" phai doc CA board: bd ready co y an in_progress/blocked/deferred.
alls=bd('list','--all','--json')
non=[i for i in alls if i['status'] in ('open','in_progress','deferred','blocked') and i['issue_type']!='epic']
unlabeled=[i['id'] for i in non if not (set(i.get('labels') or []) & CLS)]
if unlabeled: print('DUNG — bead chua phan loai:',unlabeled); raise SystemExit(1)
# (2) Ung vien: bd ready = blocker-aware; --exclude-type/--unassigned DA do la chay dung.
want={'auto-ok'} | ({'auto-partial'} if '--include-partial' in os.environ.get('ARGS','') else set())
ready=bd('ready','--json','--exclude-type','epic','--unassigned','-n','0')
c=[i for i in ready if set(i.get('labels') or []) & want]
c.sort(key=lambda x:(x['priority'],x['id']))
# (3) Bead dung nhan nhung BI CHAN: in ra. Khong de no bien mat im lang ("no silent caps").
rid={i['id'] for i in ready}
held=[i['id'] for i in non if (set(i.get('labels') or []) & want) and i['id'] not in rid
      and i['status']=='open' and not (i.get('assignee') or '')]
if held: print('BI CHAN (dung nhan, chua san sang):',held)
if not c: print('HET VIEC'); raise SystemExit(0)
i=c[0]; print('CHON',i['id'],'P%d'%i['priority'],sorted(set(i['labels'])&CLS),i['title'])
print('CON LAI',len(c)-1,[x['id'] for x in c[1:]])
PY
```

Năm điều kiện lọc, tất cả đều load-bearing:

- **Không có blocker đang mở** — do `bd ready` lo. Đây là điều kiện dễ quên nhất vì
  bead bị chặn nhìn *giống hệt* bead rảnh trong `bd list`.
- `status == 'open'` — bỏ `in_progress` (có session/agent khác đang làm),
  `deferred` (hoãn **có chủ đích**, bỏ hoãn là quyết định của user), `blocked`.
  `bd ready` đã loại cả bốn; guard "chưa phân loại" vẫn phải tự đọc `bd list --all`
  vì nó cần thấy **mọi** bead active, kể cả những cái `ready` cố tình ẩn.
- `assignee` rỗng — bead đã có người claim thì không nhận, **bất kể nhãn**
  (bead `needs-human` vẫn có thể đang được claim ở worktree/máy khác).
- `issue_type != 'epic'` — epic là vỏ chứa, đóng khi con đóng hết, không phải việc
  thi công. Không bao giờ `/bead-take` một epic.
- Có nhãn thuộc `want` — mặc định chỉ `auto-ok`. Lọc trong Python (xem trên).

Dòng `BI CHAN` không phải trang trí: nó là cách duy nhất phân biệt "hết việc" với
"còn việc nhưng đang xếp sau một bead khác". `HET VIEC` kèm một danh sách `BI CHAN`
dài nghĩa là nên làm bead chặn trước, chứ không phải dừng vòng lặp.

`HET VIEC` → dừng vòng lặp:
- Đang trong `/loop` dynamic: gọi `ScheduleWakeup` với `stop: true`.
- Báo cáo số bead `auto-partial` và `needs-human` còn lại **kèm lý do từng cái**
  (đọc notes), để user biết chính xác việc gì đang chờ mình — không báo số lượng suông.

`--dry-run` → in bead sẽ chọn rồi dừng, không claim, không sửa gì.

## 2. Làm bead

Invoke skill `bead-take` với id vừa chọn. Nó đã mang toàn bộ quy trình: đọc kỹ
`bd show` (điều kiện đóng nằm trong NOTES, note RE-MEASURE mới nhất đáng tin hơn
description), worktree riêng nhánh từ `<BASE>` (nhánh tích hợp của dự án — xem
định nghĩa trong `bead-take`), TDD/systematic-debugging theo loại bead, đo trước
khi sửa, `git commit --only <path>`, đóng bằng bằng chứng.

Bốn điều `/bead-loop` thêm vào, chỉ áp cho chế độ lặp:

1. **Bead `auto-partial` không được `bd close`.** Kết thúc bằng
   `bd update <id> --append-notes "RE-MEASURE <ngày> (HEAD <sha>): <đã làm gì, commit nào, còn thiếu gì và VÌ SAO cần người>"`.
   Đóng nó là biến "chưa đo" thành "đã pass" — chính xác cái ngược lại của việc
   phân loại nó.
2. **Commit code TRƯỚC khi `bd close`.** `bd close` có tự sinh commit quét working
   tree hay không phụ thuộc cấu hình `bd` của từng repo, không phải hợp đồng nó bảo
   đảm — commit trước là *rẻ và vô hại*, còn giả định ngược lại thì tốn một commit
   sai mới phát hiện.
3. **Không tự `git push`, không tự `bd sync`.** Profile conservative; báo cáo lệnh
   đề xuất và để user chạy.
4. **Chạy song song nhiều bead trong một lượt là ngoại lệ, do user yêu cầu** — khi
   đó mỗi bead một worktree riêng (`git worktree add -b work/bead-<id> ../wt-<id>
   <BASE>`; `git worktree add … <BASE>` **không** kèm `-b` sẽ bị git từ chối khi
   nhánh đó đang checkout ở cây chính). Hai số đo cho chế độ này:
   `bd` **đọc được** từ worktree — nó resolve board qua `.beads/metadata.json` (file
   **được track**, nên worktree có), trả đúng board thật; nhưng **ghi** đồng thời từ
   nhiều worktree thì chưa đo, nên mọi `bd update`/`bd close` giữ ở **một** nơi
   (cây chính) do session điều phối làm.

## 3. Việc phát sinh

`bd create` ngay, gán `--parent <epic>` **và** một nhãn phân loại kèm lý do đo được.
Không TodoWrite, không markdown checkbox, không mở rộng scope bead đang làm.

Board có bất biến: **mọi bead active truy được về một epic**. Bead mới không có epic
nào phù hợp thì tạo epic — đừng nhét tạm vào một epic "nợ chung" không liên quan.
Kiểm bất biến:

```bash
PYTHONIOENCODING=utf-8 python - <<'PY'
import json,io,subprocess
d=json.loads(subprocess.run(['bd','list','--all','--json'],capture_output=True,text=True,encoding='utf-8').stdout)
by={i['id']:i for i in d}
def anc(i):
    out=[];cur=i;seen=set()
    while (p:=cur.get('parent')) and p not in seen:
        seen.add(p);out.append(p);cur=by.get(p) or {}
    return out
bad=[i['id'] for i in d if i['status']!='closed' and i['issue_type']!='epic'
     and not any(by.get(c,{}).get('issue_type')=='epic' for c in anc(i))]
print('KHONG CO EPIC:',bad or 'none')
PY
```

## 4. Báo cáo cuối vòng

Một khối ngắn, rồi kết thúc lượt:

- bead đã làm + nhãn của nó
- file đã đổi
- lệnh verify đã chạy + **exit code thật** (`rc=0` mà không có output là tín hiệu
  lỗi, không phải pass; `rc=$?` là của lệnh CUỐI trong pipe — đừng đọc của `tail`)
- **verdict test đọc từ output máy-đọc-được, không từ dòng summary.** Đã đo trên
  Windows/Git Bash: dòng summary cuối của test runner **bị cắt** khỏi output đã
  capture, nên `grep passed` ra rỗng **không** có nghĩa là đỏ, và `rc=0` một mình
  **không** chứng minh có test nào đã chạy. Hai cách đã đo là chạy: xuất report
  máy-đọc (`--junitxml=<file>` với pytest, `--reporter=json`/tương đương với runner
  khác) rồi đọc số `tests/failures/errors/skipped`, hoặc đếm ký tự tiến trình trên
  các dòng progress. Ngoài ra: **đọc config của test runner trước khi thêm flag** —
  flag xung đột với config sẵn có (vd. tắt một plugin mà `addopts` vẫn truyền tham
  số của plugin đó) làm runner chết trước khi chạy test nào.
- bead đã `close` hay chỉ `append-notes`, và vì sao
- còn bao nhiêu bead `auto-ok` trong hàng
- lệnh commit/push đề xuất (không tự chạy)
