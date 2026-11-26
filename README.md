# 기술·가정 수업 진행 사이트

하이러닝·다했어요 대신 쓰는 수업 전용 사이트. 학생은 `index.html`, 선생님(전자칠판)은 `teacher.html`.
계획: `docs/plan/수업진행-웹사이트.md` · 의도: `docs/intent/수업진행-웹사이트.md`

| 파일 | 내용 |
|---|---|
| `index.html` | 학생 화면: 반·번호·코드로 입장 → 이름 확인 → 교과서 PDF / 단원 HTML 보기, 핵심 요약 제출 |
| `teacher.html` | 선생님 화면: 자료 띄우기, 화면 고정, 요약 모아 칠판에 띄우기, 학생별 요약 내려받기·인쇄, 차시·명단 관리 |
| `app.js`, `style.css` | 두 화면이 같이 쓰는 코드와 모양 |
| `supabase/schema.sql` | 데이터 표 + 권한 규칙 + 비공개 저장소 + 실시간 |
| `supabase/functions/create-students/` | 명단으로 학생 계정과 6자리 코드를 만드는 함수 |
| `test/rls.test.mjs` | 권한 규칙 자동 검사 |

## 처음 한 번 설치 (약 30분)

### 1. Supabase 프로젝트 만들기
1. https://supabase.com 에 가입하고 **New project** (무료 요금제, 지역은 Seoul).
2. 왼쪽 **SQL Editor** → `supabase/schema.sql` 내용을 통째로 붙여 넣고 **Run**.
3. **Authentication → Sign In / Providers** 맨 위 *Allow new users to sign up* 끄고 **Save**
   (꼭 해야 한다. 켜 두면 아무나 가입해서 교과서 PDF 를 볼 수 있다. 학생 계정은 함수가 만든다).

### 2. 선생님 계정
1. **Authentication → Users → Add user**: 선생님 이메일과 비밀번호 입력, *Auto Confirm User* 체크.
2. **SQL Editor** 에서 아래 한 줄 실행 (이메일만 바꿔서):
   ```sql
   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"teacher"}' where email = '선생님@이메일';
   ```

### 3. 학생 계정 만드는 함수 올리기
**Edge Functions → Deploy a new function → Via Editor** → 이름 `create-students` →
`supabase/functions/create-students/index.ts` 내용을 붙여 넣고 **Deploy**.

### 4. 사이트에 주소와 키 넣기
**Project Settings → API Keys** 에서 Project URL 과 **publishable(또는 anon) 키**를 복사해 `app.js` 위쪽 두 줄에 넣는다.
`secret` / `service_role` 키는 절대 넣지 않는다 (그 키는 모든 권한을 가진다).

### 5. 깃허브 페이지에 올리기
1. 깃허브에 새 저장소를 만들고 이 폴더의 파일을 올린다 (교과서 PDF·학생 이름은 올리지 않는다. `.gitignore` 가 PDF 를 막는다).
2. 저장소 **Settings → Pages → Branch: main / (root)** → 저장. 몇 분 뒤 `https://<아이디>.github.io/<저장소>/` 가 학생 주소, 뒤에 `teacher.html` 을 붙이면 선생님 주소.

## 학기 시작할 때
1. `teacher.html` 로그인 → **관리** 탭 → 엑셀에서 *반, 번호, 이름* 세 칸을 복사해 붙여 넣기 → **계정 만들기**.
2. 나온 **코드표를 바로 인쇄**한다. 코드는 그때 한 번만 보이고 어디에도 저장되지 않는다.
3. 코드를 잃어버린 학생: 그 학생 줄만 다시 붙여 넣고 *코드를 새로 발급* 체크 후 계정 만들기.

> 학교 정보 담당자 확인 전에는 가짜 이름(예: `1,1,가짜학생`)으로만 쓴다.

## 차시 준비
**관리** 탭 → 순서·제목, 교과서 단원 PDF, PPT용 PDF(PowerPoint 에서 *PDF 로 저장*), 단원 HTML(`work/<단원>/<단원>.html`), 젭퀴즈 링크 → **저장**.
파일은 Supabase 비공개 저장소에 들어가고, 로그인한 사람만 볼 수 있다.

## 수업 시간
1. 반과 차시를 고른다. 반을 바꾸면 그 반이 멈춰 있던 자료·쪽에서 이어 간다.
2. **화면 고정 켜짐**: 학생 화면이 선생님과 같은 자료, 같은 PDF 쪽으로 맞춰진다. 늦게 들어온 학생도 들어오자마자 맞춰진다.
   단원 HTML 안의 단계는 학생이 자유롭게 움직인다. **꺼짐**이면 학생이 자유롭게 넘긴다.
3. 학생은 교과서 옆 칸에 요약을 쓰고 **제출**. 다시 내면 덮어쓴다. 제출 전 글은 그 노트북에 임시 저장된다.
4. **요약** 탭: 제출 현황이 바로바로 올라온다. 체크하고 **고른 요약 크게 보기** → 칠판 전체 화면 (Esc 로 닫기).
5. **판서**: 교과서·PPT 아래 **✏ 판서**를 켜고 색·굵기를 골라 쓴다. **지우개**는 닿은 선을 지우고, **판서 지우기**는 지금 쪽을 통째로 지운다.
   판서는 반·차시·자료·쪽마다 저장되어 같은 반 학생 화면에 바로 나타나고, 다음 시간에 그 반에서 열면 그대로 있다. 다른 반에는 안 보인다.
   학생은 **✏ 밑줄**로 형광펜·펜을 쓸 수 있다. 학생 표시는 그 노트북에만 저장된다.
6. **패널** 버튼: 오른쪽 패널을 숨겨 자료를 크게 본다.

## 수행평가 기록 모으기
**학생별** 탭 → 학생 고르기 → 차시 순서대로 모든 요약이 보인다 → **파일로 내려받기**(HTML) 또는 **인쇄 / PDF 저장**.

## 주의
- Supabase 무료 프로젝트는 **일주일 동안 안 쓰면 멈춘다**. 방학 뒤 첫 수업 전에 Supabase 대시보드에 들어가 **Restore project** 를 누른다 (데이터는 남아 있다).
- 무료 한도: 저장소 1GB, 파일 하나 50MB. 교과서는 단원별로 나눈 PDF 를 올린다.
- 단원 HTML 은 사이트 로그인 정보와 분리된 상자(sandbox) 안에서 열린다. 그래서 단원 HTML 학습지의 "자동 저장"은 새로 고치면 사라진다.

## 기능을 추가한 뒤 (2026-11 판서·PPT 추가)
Supabase **SQL Editor** 에 `supabase/schema.sql` 을 다시 통째로 붙여 넣고 **Run** 한다 (여러 번 실행해도 안전하다).

## 권한 규칙 검사 (코드를 고쳤을 때)
```powershell
cd class-site\test; npm i --no-save @electric-sql/pglite; node rls.test.mjs
```
"RLS 검사 모두 통과" 가 나오면 된다. 학생이 남의 요약·다른 반 상태·다른 반 판서를 못 보고, 고정·자료·판서를 못 바꾸는지 확인한다.
