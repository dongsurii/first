# 🏇 MCP 경마장

ChatGPT 웹 채팅에서 "전진!"이라고 말하면 강의실 화면 속 경주마가 달리는 MCP 실습 게임입니다.

| 경로 | 용도 |
|---|---|
| `/mcp` | ChatGPT 커스텀 커넥터가 연결할 MCP 주소 (Streamable HTTP, 인증 없음) |
| `/` | 프로젝터에 띄울 실시간 경주 화면 |
| `/admin.html` | 강사용: 출발 / 재경기 / 초기화 / 내보내기 |

MCP 도구: `join_race(nickname)` → 참가 코드 발급, `move_forward(playerCode)` → 전진(3초 쿨다운, 0~12칸 랜덤), `race_status()` → 순위 조회

## 배포 (Render 예시)
ChatGPT는 공개 HTTPS 주소에만 연결할 수 있습니다(localhost 불가).
1. 이 폴더를 GitHub 저장소로 push
2. Render → New → Web Service → 저장소 선택
   - Build: `npm install` / Start: `npm start`
   - Environment: `ADMIN_KEY` = 원하는 비밀번호
3. 발급된 주소 예: `https://horse-race-xxxx.onrender.com`
   - MCP URL: `https://horse-race-xxxx.onrender.com/mcp`

> 게임 상태는 메모리에 저장됩니다. 인스턴스는 1개로 유지하세요. 무료 플랜은 15분 동안 접속이 없으면 잠들어서 첫 접속이 느리니, 수업 시작 전에 화면을 한 번 열어 깨워두세요.

## 수강생: ChatGPT에 연결
1. 설정 → 앱(Apps & Connectors) → 고급 설정 → **개발자 모드** 켜기
2. 앱/커넥터 만들기 → 이름 `경마장`, MCP URL 입력, 인증 **없음** → 생성
3. 새 채팅에서 + → 개발자 모드 → `경마장` 선택
4. "닉네임 민수로 경주 참가할래" → 출발 신호 후 "전진!"

## 환경변수
`ADMIN_KEY`(필수), `PORT`(3000), `TRACK_LENGTH`(100), `COOLDOWN_MS`(3000), `MAX_PLAYERS`(40)

## 로컬 실행
```bash
npm install && ADMIN_KEY=secret npm start
```
