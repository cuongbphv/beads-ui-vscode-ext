<!-- beads-pm-kit v0.1.0 skill:guide.vi surface:doc -->

# Chạy trọn một vòng

[English](guide.md) · [简体中文](guide.zh-cn.md)

Chín skill, một vòng. Bạn viết spec, board đầy việc, việc được làm xong, rồi chính board nói cho
bạn biết đang ở đâu và bao giờ xong. Xong thì viết spec tiếp và chạy vòng mới.

```
       spec dạng markdown
                │
                ▼
         bead-split ──────────► epic + task con trên board
                │
                ▼
        bead-estimate ────────► mọi task con đều có size
                │
                ▼
        bead-pm-loop ─────────► kiểm tra gate, rồi làm một vòng
           │      │              (bead-loop → bead-take, hoặc bead-fleet)
           │      └───────────► bead-report    đang ở đâu
           │                    bead-forecast  bao giờ xong
           ▼
        bead-audit ───────────► "xong" có xong thật không?
                │
                └─────────────► phát sinh việc mới → quay lại bead-split
```

Tên skill giống nhau trên mọi harness. Trong Claude Code và Cursor bạn gõ `/bead-report`; trong
Codex là `$bead-report`. Ngoài ra không khác gì.

Nếu chỉ nhớ được một điều, hãy nhớ điều này: **vòng lặp có quyền chặn bạn lại.** Một nửa công việc
của mấy skill này là từ chối chạy tiếp khi board đang ở trạng thái mà chạy tiếp chỉ cho ra một câu
trả lời sai nhưng nghe rất tự tin. Khi nó dừng, đó là nó đang làm việc, không phải nó lỗi.

## Trước vòng đầu tiên

Bạn cần CLI `bd`, một board, và kit đã cài. `doctor` sẽ chỉ ra thiếu cái nào và in luôn cách sửa,
nên chạy nó trước và đọc kỹ output:

```bash
cd ~/Projects/beads-pm-kit
bin/bd-kit doctor  --into ~/Projects/du-an-cua-toi
bin/bd-kit install --into ~/Projects/du-an-cua-toi
bin/bd-kit doctor  --into ~/Projects/du-an-cua-toi   # chạy lại: phải về 0 failure
```

`install` sẽ không ghi gì nếu chưa có `bd` trong PATH hoặc project chưa có thư mục `.beads` — cài
skill vào một repo không chạy được chúng thì chỉ để lại một mớ hướng dẫn không ai làm theo được. Nó
in các lệnh cài `bd` và `bd init` thay vì cài bừa. Nếu bạn biết mình đang làm gì thì `--force` bỏ
qua chỗ này.

Có hai file được cài mà bạn nên biết tên. `.beads/PRIME.md` ghi đè `bd prime` — đây là đường duy
nhất đưa quy ước label và size vào **mọi** session trên **mọi** harness, kể cả khi không skill nào
được load. `scripts/pm/board.py` là nơi mọi con số ra đời: `bead-report` và `bead-forecast` đều gọi
nó, và đó là lý do duy nhất khiến hai skill này không thể nói khác nhau.

## 1. Nạp việc vào board — `bead-split`

Bạn đang có spec, roadmap hay plan nằm trong một file markdown. Skill này biến nó thành một epic
kèm các task con, và phân loại từng task con theo việc agent có thể làm xong hay không.

```
/bead-split docs/plan.md                          # xem trước, không ghi gì
/bead-split docs/plan.md --section "Phase 2"       # chỉ một mục
/bead-split docs/plan.md --apply                  # tạo thật
```

Mặc định là xem trước, và bạn nên xem thật. Một label sai ở đây sửa mất một dòng; để nó lên board
rồi thì thành nợ ngầm. Nếu file là tài liệu chứ không phải spec, skill sẽ dừng lại hỏi thay vì băm
một cái README thành đống task giả.

Mỗi task con nhận đúng một label phân loại, và đây là hợp đồng mà cả vòng lặp dựa vào:

| Label | Nghĩa là gì | Agent được làm gì |
|---|---|---|
| `auto-ok` | mọi điều kiện đóng đều nằm trong code và test của repo này | làm hết, kể cả `bd close` |
| `auto-partial` | phần code làm được ở đây, nhưng để đóng cần thứ bên ngoài — CI xanh thật, môi trường thật | viết code rồi dừng, ghi note; **không** được đóng |
| `needs-human` | muốn đóng phải có người: credential, chi phí, bên thứ ba, một quyết định | không được chạm vào |

Cái gì không đo được thì là `needs-human`. Tuyệt đối không đoán label từ cái tiêu đề — một bead
chưa đo không đồng nghĩa với một bead nhỏ.

## 2. Làm cho nó đo được — `bead-estimate`

Bead không có size thì vô hình với mọi con số về sau. Đây chính là bước giữ cho báo cáo tiến độ của
bạn không trở thành một kiểu nói dối bằng cách im lặng.

```
/bead-estimate --backfill                # xem trước size cho mọi bead chưa có
/bead-estimate --backfill --apply        # ghi thật
/bead-estimate beads-abc123              # một bead, ghi trực tiếp
/bead-estimate --epic beads-xyz789       # các con của một epic
```

Size tính bằng điểm, lưu ở label để bạn thấy được trên board, và mirror sang `estimated_minutes`
của `bd` để script không phải parse chuỗi:

`size:XS` 0.5 đ · `size:S` 1 đ · `size:M` 3 đ · `size:L` 8 đ · `size:XL` 13 đ

`size:L` là mức lớn nhất được phép nhận. `size:XL` không phải một estimate — nó là lời thừa nhận
rằng chưa ai hiểu việc này, nên skill từ chối cho nhận và bắt bạn chia nhỏ. Epic thì không bao giờ
được size trực tiếp; size của epic là tổng của các con. Vừa là nguyên tắc, vừa là tự vệ: `bd` copy
label của cha xuống con mới, nên một label size trên epic sẽ âm thầm phá toàn bộ số liệu bên dưới.

Bản thân con số estimate đến từ lịch sử, không đến từ cảm giác. Skill cố tình chỉ đọc tiêu đề, label
và type trước, vì phần description thường chứa phỏng đoán của người khác, mà một con số đã nhìn thấy
thì rất khó gạt ra khỏi đầu. Sau đó nó chấm điểm tương đồng với các bead đã đóng và định giá bead
mới theo thời gian thực tế của những bead đó:

```bash
python3 scripts/pm/board.py refclass                 # mọi bead chưa có size
python3 scripts/pm/board.py refclass --id beads-abc  # chỉ một bead
```

Hãy đọc cột `basis` trước, đừng đọc con số trước. `refclass` nghĩa là nó tìm được từ ba bead đã đóng
thật sự giống trở lên, và đề xuất có giá trị. `pert` nghĩa là không tìm được, phải ước lượng từ phạm
vi của chính bead đó. `unusable` nghĩa là mấy bead khớp duy nhất lại là loại được đóng sau khi tạo
vài phút, nên thời lượng của chúng đo công việc giấy tờ chứ không đo công việc thật.

Cái cuối đáng nói kỹ, vì nó xảy ra ngay trên board thật đầu tiên: mười bảy bead chưa có size đều trả
về `size:XS` kèm trung vị nghe rất chắc chắn, dựa trên những "bead tương tự" mà điểm giống duy nhất
là cùng issue type. Một tập tham chiếu toàn trùng hợp còn tệ hơn thừa nhận là không có, nên bây giờ
có ngưỡng tương đồng và ngưỡng hợp lý, và tool nói thẳng "không có reference class dùng được" thay vì
bịa ra một cái.

## 3. Làm việc — `bead-pm-loop`

Đây là vòng bạn thực sự chạy, lặp đi lặp lại.

```
/bead-pm-loop                      # một bead, có gate
/bead-pm-loop --fleet 4            # đổi sang bốn bead độc lập chạy song song
/bead-pm-loop --dry-run            # chỉ chạy gate, không làm gì
/bead-pm-loop --report-every 3     # báo cáo mỗi 3 vòng thay vì mỗi 5
```

Nó không quyết định bead nào tiếp theo — `bead-loop` làm việc đó, còn `bead-take` mới là cái làm
việc trong một git worktree riêng. Phần `bead-pm-loop` thêm vào là tất cả những gì một board cần để
còn quản được sau nhiều vòng, và nó kiểm hết trước mỗi vòng:

- **Giới hạn WIP.** Mỗi người một bead đang làm. Vượt hạn thì đóng nốt việc đang dở, đừng nhận thêm
  cho ra vẻ đang bận.
- **Có estimate mới được nhận.** Bead được chọn phải có đúng một label size, `size:L` trở xuống.
  Chưa có size thì nó được size ngay trong vòng này chứ không bị bỏ qua — size mất mấy phút, còn bỏ
  qua thì mất mọi dự báo về sau.
- **Việc để lâu.** Bead không ai chạm trong 7 ngày, hoặc đang làm quá 3 ngày, đều được liệt kê kèm
  người phụ trách. Không bao giờ tự động chuyển tay.
- **Phình phạm vi.** Nếu điểm tạo mới vượt điểm đóng được ba tuần liền, vòng lặp dừng và bắt bạn
  quyết: cắt phạm vi, dời ngày, hay chấp nhận trễ. Chạy nhanh hơn không sửa được phạm vi phình ra,
  và giả vờ ngược lại chính là cách một dự án chết dần trong im lặng.
- **Bất biến của board.** Bead không thuộc epic nào, bead không có label phân loại, epic mang label
  size, bead mang hai label size. Mấy cái này dừng vòng, vì một con số bình quân trên board đã hỏng
  còn tệ hơn không có số nào.

Bạn vẫn gọi lẻ được khi cần: `/bead-take <id>` cho một bead cụ thể, `/bead-loop` cho một vòng không
gate, `/bead-fleet --batch 4` cho một lô song song. Dùng `bead-fleet` khi có mấy bead `auto-ok` đã
sẵn sàng và chạm vào các file khác nhau; nó cho mỗi bead một worktree riêng, **kiểm chứng** thứ mỗi
agent khai báo chứ không tin, rồi rebase và fast-forward từng cái một.

## 4. Xem đang ở đâu — `bead-report`

```
/bead-report                        # cả board
/bead-report beads-xyz789           # một epic
python3 scripts/pm/board.py report   # y hệt, gọi thẳng module
```

Sáu mục, luôn cùng thứ tự, để báo cáo tuần này so được với tuần trước: số lượng, mức hoàn thành,
dòng chảy công việc, velocity, rủi ro, việc nên làm tiếp. Mục nào không có gì thì in `— none` chứ
không biến mất.

Mấy chỗ nên đọc kỹ:

**Mức hoàn thành có hai con số và một chỉ số phủ.** Theo số lượng, theo điểm, rồi bao nhiêu bead
đang mở thực sự đã có size. Khi độ phủ dưới 60%, báo cáo nói thẳng rằng con số theo điểm chỉ đang
mô tả phần việc đã xong và gần như không nói gì về phần còn lại. Trên board thật đầu tiên, nó hiện
*100% theo điểm* trong khi 0/17 bead đang mở có size — đúng, và vô dụng nếu không có câu cảnh báo
nằm ngay bên cạnh.

**Việc bị chặn được gom theo cái đang chặn nó.** "5 bead bị chặn" thì bạn không làm gì được với nó.
"5 bead này đều đang xếp sau `beads-7pi`, mà bead đó đang `auto-ok` và chưa ai nhận" thì làm được
ngay, và thường đó là việc đáng làm nhất trên board bất kể mấy ô priority ghi gì.

**Velocity đi kèm chế độ tin cậy, không chỉ là một con số.** Từ 5 bead có size đóng trong kỳ trở
lên thì là `measured`. Được 2–4 thì là `provisional`, dải rộng ra có chủ ý và ngày pessimistic là
ngày để lên kế hoạch. Dưới 2 thì không có ngày nào cả, chỉ có danh sách cần gì để có. Cái này tồn
tại vì lần chạy đầu cho ra 5.86 điểm/ngày từ ba bead đã đóng — một con số vô nghĩa nhưng có dấu
thập phân nên nghe rất thật.

## 5. Xem bao giờ xong — `bead-forecast`

```
/bead-forecast                          # mọi epic
/bead-forecast --epic beads-xyz789      # một epic
/bead-forecast --apply                  # ghi snapshot lên epic
```

Ba mốc ngày cho mỗi epic — lạc quan, khả năng cao, bi quan — và luôn kèm danh sách những thứ làm
dải ngày rộng ra như vậy: bead chưa có size nên không nằm trong tổng còn lại, chuỗi bị chặn và bead
nào mà mấy mốc ngày đang mặc định là sẽ chạy trước, việc `needs-human` mà không velocity nào của
agent áp vào được, và liệu cách tính thời lượng có bao gồm quãng bead nằm chờ trong backlog hay
không. Một dự báo thiếu danh sách đó chỉ là một con số đóng giả kế hoạch.

Với `--apply` nó ghi snapshot lên epic dưới dạng metadata kèm một note, và đó là thứ duy nhất skill
này ghi. Lý do phải ghi lại là để lần sau: `forecast` mở đầu bằng việc **tự cho điểm dự báo lần
trước** — bao nhiêu điểm đã dịch chuyển, epic còn đúng hẹn so với mốc khả năng cao hay đã quá mốc bi
quan và quá mấy ngày, velocity có nhảy hơn gấp đôi hay không. Phép tính chỉ nói được là ngày đã
trượt. Còn lý do nào trong danh sách kia mới là lý do thật thì chỉ bạn nói được, và đúng một câu đó
là toàn bộ giá trị của việc này.

## 6. Kiểm lại lời khai — `bead-audit`

```
/bead-audit                          # cả board
/bead-audit beads-xyz789             # một epic
/bead-audit auto-partial             # mọi bead mang một label
```

Dùng khi chữ "đã xong" bắt đầu nghe hơi lạc quan. Nó tỏa ra nhiều agent chỉ-đọc để đo lại, mỗi agent
trả về DONE, NOT DONE hay PARTIAL kèm bằng chứng cụ thể — file và số dòng, lệnh đã chạy, exit code
nhận được. Không có bằng chứng thì tính là NOT DONE. Chỉ nói miệng thì tính là PARTIAL.

Sau đó chỉ vòng chính được đóng hay sửa bead. Chỗ tách vai này quan trọng: một agent vừa được quyền
phán vừa được quyền đóng thì luôn có động cơ phán cho nhẹ.

Đầu ra là bảng tiến độ trước/sau theo từng epic, một bộ prompt độc lập cho phần nợ mà agent xử được,
và một danh sách riêng cho phần cần người. Danh sách cuối thường là nguồn của lần `bead-split` tiếp
theo, và vòng lặp khép lại.

## Khi skill dừng thay vì chạy

| Nó nói | Sự thật đằng sau | Làm gì |
|---|---|---|
| có bead chưa phân loại | ai đó tạo bead mà không gắn lane | gắn label kèm lý do đo được, hoặc `needs-human` |
| `size:XL`, cần chia nhỏ | estimate đó là lời thừa nhận chưa hiểu việc | chia thành task con, rồi size từng con |
| forecast bị giữ lại | dưới 2 bead có size đã đóng; ngày nào cũng là bịa | size các bead đang mở, đóng 5 cái, rồi hỏi lại |
| độ phủ thấp | phần lớn việc đang mở chưa có size, nên cột điểm chỉ tả quá khứ | `/bead-estimate --backfill` |
| SCOPE ALARM | ba tuần liền nhận vào nhiều hơn làm xong | cần bạn quyết: cắt, dời, hay chấp nhận |
| epic mang label size | số liệu tổng hợp bên dưới đã sai | bỏ label đó đi, size các con |
| cái này trông như tài liệu | bạn trỏ `bead-split` vào một README | trỏ vào spec, hoặc chỉ rõ mục cần lấy |

Không cái nào trong đây là lỗi. Tất cả đều là skill từ chối đưa cho bạn một câu trả lời tự tin mà nó
không chứng minh được — và đó là lý do duy nhất để tin những câu trả lời mà nó có đưa.

## Tra nhanh

| Skill | Để làm gì | Có ghi vào board? |
|---|---|---|
| `bead-split` | spec markdown → epic + task con đã size và phân loại | chỉ khi `--apply` |
| `bead-estimate` | size bead theo lịch sử đo được | một id thì có; `--backfill` và `--epic` chỉ khi `--apply` |
| `bead-take` | một bead, một worktree, đóng kèm bằng chứng | có |
| `bead-loop` | một bead sẵn sàng mỗi vòng | có |
| `bead-fleet` | một lô song song, mỗi bead một worktree | có |
| `bead-pm-loop` | vẫn vòng đó nhưng có gate và nhịp báo cáo | có |
| `bead-report` | đang ở đâu | không |
| `bead-forecast` | bao giờ xong | chỉ khi `--apply`, và chỉ metadata kèm note |
| `bead-audit` | "xong" có thật không | có, chỉ vòng chính |

Không skill nào chạy `git push` hay `bd dolt push`. Chúng báo file đã sửa và những lệnh chúng **không**
chạy. Đây là chủ ý: miễn là history còn thẳng và chưa push, một lệnh `git reset --hard` xoá sạch cả
một đêm chạy tự động — và đó là tấm lưới an toàn duy nhất mà toàn bộ chuyện này có.

## Sửa một skill

Các file trong `.claude/`, `.cursor/` và `.agents/` là file sinh ra. Mỗi file mang một dòng stamp, và
sửa trực tiếp một file nghĩa là `bd-kit update` sẽ **từ chối** ghi đè chứ không âm thầm xoá mất bản
sửa của bạn. Hãy sửa ở kit:

```bash
cd ~/Projects/beads-pm-kit
$EDITOR skills/bead-report/skill.md         # bản viết tay duy nhất
node tools/sync-codex.js bead-report        # sau khi đã đọc lại codex.md đối chiếu với nó
npm test && bin/bd-kit check
node tools/fixed-point.js ../du-an-cua-toi  # không có gì đổi ngoài ý muốn
bin/bd-kit install --into ../du-an-cua-toi
```

`docs/authoring.md` nói về bộ token và các field theo từng bề mặt. `docs/transforms.md` liệt kê mọi
điểm khác nhau giữa ba bề mặt — nếu một khác biệt không có trong danh sách đó thì ba bề mặt không
khác nhau ở chỗ đó, và cái bạn thấy trong bản đã cài là drift.

## Cái gì đã chạy thật

Nói thẳng cho rõ, vì một tài liệu nói quá về mức độ đã kiểm chứng còn tệ hơn không có tài liệu.

Đã đo trên board thật 75 bead trong lúc viết kit này: `board.py report`, `forecast` và `refclass` ở
mọi mode, một snapshot `pm.forecast` thật được ghi rồi đọc lại qua đường calibration, cùng
`bd-kit install`, `diff`, `doctor` và `uninstall`. Ba chỗ "từ chối trả lời" nói ở trên — chế độ tin
cậy của velocity, cảnh báo độ phủ, hai ngưỡng của reference class — tồn tại vì chính board đó đã cho
ra câu trả lời sai nhưng tự tin trước đó, và mỗi chỗ đều có test dựng lại đúng tình huống.

Chưa chạy lại trong phiên đó: `bead-split`, `bead-take`, `bead-loop`, `bead-fleet` và `bead-audit`
chạy trọn luồng. Năm skill này có trước kit và đã được dùng thật trên board này; kit lấy chúng vào
gần như nguyên vẹn, chỉ thêm hai dòng và chuẩn hoá sáu chỗ câu chữ, và `tools/fixed-point.js` so
từng bề mặt sinh ra với file cũ để chứng minh đúng điều đó. Nên hãy coi mô tả từng bước của chúng là
**đã ghi thành tài liệu**, chứ không phải vừa mới đo lại; muốn biết chính xác đổi những gì thì đọc
`docs/migration.md`.
